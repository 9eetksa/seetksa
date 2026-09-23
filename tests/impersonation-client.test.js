import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const owner = { id: '10000000-0000-4000-8000-000000000001', app_metadata: { role: 'super_admin' } };
const target = { id: '10000000-0000-4000-8000-000000000002', email: 'client@example.test', app_metadata: { role: 'client' } };
const sessionId = '20000000-0000-4000-8000-000000000001';
const actorToken = 'original-owner-access-token';
const context = () => ({ id: sessionId, user: target, expires_at: new Date(Date.now() + 600000).toISOString() });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let buildSerial = 0;

async function harness({ savedSession = null, transport, getUser } = {}) {
  const memory = new Map(savedSession ? [['seet-acting-session', savedSession]] : []);
  const requests = [];
  const oldWindow = globalThis.window;
  const oldFetch = globalThis.fetch;
  const oldHarness = globalThis.__actingTest;
  globalThis.window = { sessionStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) } };
  globalThis.__actingTest = { supabase: { auth: {
    getSession: async () => ({ data: { session: { access_token: actorToken, user: owner } }, error: null }),
    getUser: getUser || (async () => ({ data: { user: owner }, error: null })),
  } } };
  globalThis.fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    requests.push({ input, init, body });
    if (transport) return transport(body, input, init);
    if (String(input).endsWith('/rpc/platform_access_check')) return json({ user_id: owner.id, role: owner.app_metadata.role });
    if (body?.action === 'end') return json({ success: true });
    if (body?.action === 'proxy') return json({ status: 200, body: JSON.stringify({ user_id: target.id }), headers: { 'content-type': 'application/json' } });
    return json(context());
  };
  const source = await readFile(new URL('../src/auth/impersonation.js', import.meta.url), 'utf8');
  const bundled = await build({
    stdin: { contents: source, sourcefile: 'impersonation.js' },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://project.supabase.co"', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '"sb_publishable_test"' },
    plugins: [{ name: 'stub-supabase', setup(builder) {
      builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const supabase = globalThis.__actingTest.supabase;', loader: 'js' }));
    } }],
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + `\n// fixture ${++buildSerial}`).toString('base64')}`);
  return { module, requests, memory, restore() { globalThis.window = oldWindow; globalThis.fetch = oldFetch; globalThis.__actingTest = oldHarness; } };
}

test('delegated browsing stores only an opaque session and proxies data with original authorization', async () => {
  const h = await harness();
  try {
    await h.module.startImpersonation(target.id);
    assert.deepEqual([...h.memory], [['seet-acting-session', sessionId]]);
    const response = await h.module.impersonationFetch('https://project.supabase.co/rest/v1/work_requests?select=id', { headers: { Authorization: 'must-not-forward', 'accept-profile': 'private', Prefer: 'count=exact' } });
    assert.equal((await response.json()).user_id, target.id);
    const proxied = h.requests.at(-1);
    assert.equal(proxied.input, '/api/impersonation');
    assert.equal(proxied.init.headers.Authorization, `Bearer ${actorToken}`);
    assert.equal(proxied.body.sessionId, sessionId);
    assert.equal(proxied.body.headers.authorization, undefined);
    assert.equal(proxied.body.headers['accept-profile'], undefined);
  } finally { h.restore(); }
});

test('ending delegation discards an in-flight response from the previous target', async () => {
  const delayed = pending();
  const started = pending();
  const h = await harness({ transport: async body => {
    if (body.action === 'proxy') { started.resolve(); return delayed.promise; }
    return json(body.action === 'end' ? { success: true } : context());
  } });
  try {
    await h.module.startImpersonation(target.id);
    const response = h.module.impersonationFetch('https://project.supabase.co/rest/v1/work_requests');
    await started.promise;
    await h.module.endImpersonation();
    delayed.resolve(json({ status: 200, body: '{"private":true}', headers: {} }));
    await assert.rejects(response, { status: 403 });
    assert.equal(h.module.getImpersonation(), null);
    assert.equal(h.memory.size, 0);
  } finally { h.restore(); }
});

test('late start cannot reenter an account after the owner already ended delegation', async () => {
  const delayed = pending();
  const started = pending();
  const h = await harness({ transport: body => {
    if (body.action === 'start') { started.resolve(); return delayed.promise; }
    return json({ success: true });
  } });
  try {
    const opening = h.module.startImpersonation(target.id);
    await started.promise;
    await h.module.endImpersonation();
    delayed.resolve(json(context()));
    await opening.catch(() => {});
    assert.equal(h.module.getImpersonation(), null);
    assert.equal(h.memory.size, 0);
  } finally { h.restore(); }
});

test('a pending owner identity read cannot overwrite the impersonated identity', async () => {
  const delayed = pending();
  const h = await harness({ getUser: () => delayed.promise });
  try {
    const originalRead = h.module.getEffectiveUser();
    await h.module.startImpersonation(target.id);
    delayed.resolve({ data: { user: owner }, error: null });
    const result = await originalRead;
    assert.notEqual(result.data?.user?.id, owner.id);
    assert.equal(h.module.getImpersonation().user.id, target.id);
  } finally { h.restore(); }
});

test('failed bootstrap retains the delegation boundary without falling back to owner data', async () => {
  let ownerReads = 0;
  const h = await harness({ savedSession: sessionId, transport: () => json({ error: 'provider_unavailable' }, 503), getUser: async () => { ownerReads++; return { data: { user: owner }, error: null }; } });
  try {
    const result = await h.module.getEffectiveUser();
    assert.equal(result.data.user, null);
    assert.equal(result.error.status, 503);
    assert.equal(ownerReads, 0);
    assert.equal(h.module.hasImpersonation(), true);
    await assert.rejects(h.module.impersonationFetch('https://project.supabase.co/rest/v1/work_requests'), { status: 503 });
    assert.ok(h.requests.every(request => request.input === '/api/impersonation'));
  } finally { h.restore(); }
});

test('original account access gate bypasses the delegation proxy and binds its explicit bearer', async () => {
  const h = await harness();
  try {
    await h.module.startImpersonation(target.id);
    const access = await h.module.checkAccountAccess(actorToken);
    const check = h.requests.at(-1);
    assert.equal(access.user_id, owner.id);
    assert.equal(check.input, 'https://project.supabase.co/rest/v1/rpc/platform_access_check');
    assert.equal(check.init.headers.Authorization, `Bearer ${actorToken}`);
    assert.deepEqual(check.body, { p_allow_onboarding: true });
    assert.equal(h.module.getImpersonation().user.id, target.id);
  } finally { h.restore(); }
});

test('revoked database access rejects an otherwise authenticated original account', async () => {
  const h = await harness({ transport: () => json({ message: 'forbidden' }, 403) });
  try {
    const result = await h.module.getEffectiveUser();
    assert.equal(result.data.user, null);
    assert.equal(result.error.status, 403);
  } finally { h.restore(); }
});

test('an original data response begun before entering another account is discarded', async () => {
  const delayed = pending();
  const began = pending();
  const h = await harness({ transport: (body, input) => {
    if (String(input).startsWith('https://project.supabase.co')) { began.resolve(); return delayed.promise; }
    return json(context());
  } });
  try {
    const response = h.module.impersonationFetch('https://project.supabase.co/rest/v1/work_requests');
    await began.promise;
    await h.module.startImpersonation(target.id);
    delayed.resolve(json({ owner_private: true }));
    await assert.rejects(response, { status: 403 });
  } finally { h.restore(); }
});

test('late delegated phone mutation cannot update the restored owner view', async () => {
  const delayed = pending();
  const began = pending();
  const h = await harness({ transport: body => {
    if (body.action === 'client-account') { began.resolve(); return delayed.promise; }
    return json(body.action === 'end' ? { success: true } : context());
  } });
  try {
    await h.module.startImpersonation(target.id);
    const result = h.module.delegatedAccountRequest({ action: 'client-phone-start', phone: '+966500000000' });
    await began.promise;
    await h.module.endImpersonation();
    delayed.resolve(json({ success: true }));
    await assert.rejects(result, { status: 403 });
  } finally { h.restore(); }
});
