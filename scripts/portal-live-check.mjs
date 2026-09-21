// Explicit opt-in integration check against the configured Supabase project
// Uses disposable Resend test sink addresses and never sends to a real customer
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { trustedRole } from '../src/auth/access.js';

const url = process.env.VITE_SUPABASE_URL;
const options = { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const client = () => createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, options);
const statePath = new URL('../.tools/portal-qa-users.json', import.meta.url);
const mode = process.argv[2];
const check = error => { if (error) throw new Error(`Auth check failed: ${error.code || error.status || 'unknown'}`); };

if (mode === 'setup') {
  try { await readFile(statePath); throw new Error('Existing QA users must be cleaned up first'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const records = [];
  await mkdir(new URL('../.tools/', import.meta.url), { recursive: true });
  for (const role of ['client', 'employee', 'unassigned']) {
    const email = `delivered+provision-${role}-${randomUUID()}@resend.dev`;
    const password = randomBytes(24).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { ...(role === 'unassigned' ? {} : { role }), portal_qa: true } });
    check(error);
    records.push({ id: data.user.id, email, password, role });
    await writeFile(statePath, JSON.stringify(records), { mode: 0o600 });
  }
  console.log('Created three disposable QA accounts');
} else if (mode === 'verify') {
  const records = JSON.parse(await readFile(statePath, 'utf8'));
  for (const record of records) {
    const auth = client();
    const { error } = await auth.auth.signInWithPassword({ email: record.email, password: record.password });
    check(error);
    const { data: verified, error: verifyError } = await auth.auth.getUser();
    check(verifyError);
    assert.equal(trustedRole(verified.user), record.role === 'unassigned' ? null : record.role);
    if (record.role === 'client') {
      const { error: editError } = await auth.auth.updateUser({ data: { role: 'employee' } });
      check(editError);
      const { data: after } = await auth.auth.getUser();
      assert.equal(trustedRole(after.user), 'client');
      const { data: session } = await auth.auth.getSession();
      await fetch(`${url}/auth/v1/user`, {
        method: 'PUT', headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_metadata: { role: 'employee' } }),
      });
      const { data: final } = await auth.auth.getUser();
      assert.equal(trustedRole(final.user), 'client');
    }
    await auth.auth.signOut();
    console.log(`PASS verified ${record.role} account and authorization`);
  }
  const record = records.find(item => item.role === 'employee');
  const { data: recovery, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: record.email, options: { redirectTo: 'http://localhost:5173/reset-password' } });
  check(error);
  const auth = client();
  const { error: recoveryError } = await auth.auth.verifyOtp({ token_hash: recovery.properties.hashed_token, type: 'recovery' });
  check(recoveryError);
  const nextPassword = randomBytes(24).toString('base64url');
  const { error: updateError } = await auth.auth.updateUser({ password: nextPassword });
  check(updateError);
  const oldPassword = record.password;
  record.password = nextPassword;
  await writeFile(statePath, JSON.stringify(records), { mode: 0o600 });
  await auth.auth.signOut();
  const oldLogin = await auth.auth.signInWithPassword({ email: record.email, password: oldPassword });
  assert.ok(oldLogin.error);
  const newLogin = await auth.auth.signInWithPassword({ email: record.email, password: nextPassword });
  check(newLogin.error);
  await auth.auth.signOut();
  const reuse = await auth.auth.verifyOtp({ token_hash: recovery.properties.hashed_token, type: 'recovery' });
  assert.ok(reuse.error);
  console.log('PASS password recovery updates credentials and rejects reused tokens');
} else if (mode === 'recovery-link') {
  const records = JSON.parse(await readFile(statePath, 'utf8'));
  const record = records.find(item => item.role === 'client');
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: record.email, options: { redirectTo: 'http://localhost:5173/reset-password' } });
  check(error);
  await writeFile(new URL('../.tools/portal-qa-recovery.txt', import.meta.url), data.properties.action_link, { mode: 0o600 });
  console.log('Prepared disposable recovery link for browser verification');
} else if (mode === 'cleanup') {
  const records = JSON.parse(await readFile(statePath, 'utf8'));
  for (const record of records) {
    const { data, error } = await admin.auth.admin.getUserById(record.id);
    check(error);
    assert.equal(data.user.app_metadata.portal_qa, true);
    assert.equal(data.user.email, record.email);
    assert.match(record.email, /^delivered\+provision-.*@resend\.dev$/);
    const { error: deleteError } = await admin.auth.admin.deleteUser(record.id);
    check(deleteError);
  }
  await unlink(statePath);
  await unlink(new URL('../.tools/portal-qa-recovery.txt', import.meta.url)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  console.log('Removed all disposable QA accounts and local credentials');
} else {
  throw new Error('Use setup, verify, recovery-link or cleanup');
}
