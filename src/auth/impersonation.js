import { supabase } from './supabase';

const storageKey = 'seet-acting-session';
const listeners = new Set();
let sessionId = window.sessionStorage.getItem(storageKey);
let current = null;
let generation = 0;
let refreshing = null;
const expired = () => Object.assign(new Error('انتهت جلسة الدخول بالنيابة ارجع إلى حسابك'), { userFacing: true, status: 403 });
const unavailable = () => Object.assign(new Error('الحساب غير متاح للدخول أو انتهت جلسته تواصل مع مسؤول المنصة أو سجل الدخول مجددا'), { userFacing: true, status: 403 });
export const getImpersonation = () => current;
export const hasImpersonation = () => Boolean(sessionId);
export const subscribeImpersonation = listener => { listeners.add(listener); return () => listeners.delete(listener); };
function publish(value) {
  current = value;
  for (const listener of listeners) listener(value);
}
function clear() {
  generation++;
  refreshing = null;
  sessionId = null;
  window.sessionStorage.removeItem(storageKey);
  publish(null);
}
function authIdentity(session) {
  if (!session?.access_token) return null;
  let id;
  try { id = JSON.parse(atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).session_id; } catch {}
  return `${session.user?.id || ''}:${id || session.access_token}`;
}
export async function checkAccountAccess(accessToken) {
  const token = accessToken || (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) throw unavailable();
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/platform_access_check`, {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ p_allow_onboarding: true }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(unavailable(), { status: response.status });
  if (!result?.user_id) throw unavailable();
  return result;
}
async function request(body) {
  const {data, error} = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw expired();
  const expectedAuth = authIdentity(data.session);
  const response = await fetch('/api/impersonation', {
    method: 'POST', cache: 'no-store',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`},
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  const latest = await supabase.auth.getSession();
  if (latest.error || authIdentity(latest.data.session) !== expectedAuth) throw expired();
  if (!response.ok) throw Object.assign(new Error(result.error || 'تعذر التحقق من جلسة الدخول بالنيابة'), {userFacing:true,status:response.status});
  return result;
}
export async function startImpersonation(userId) {
  if (sessionId) throw Object.assign(new Error('أنه جلسة الدخول الحالية قبل الدخول إلى حساب آخر'), { userFacing: true, status: 409 });
  const openingGeneration = ++generation;
  let value;
  try {
    value = await request({action:'start',userId});
  } catch (error) {
    // A refused start still invalidated pending owner reads  Let subscribers
    // verify the unchanged owner again instead of keeping a stale empty role
    if (generation === openingGeneration && !sessionId) publish(null);
    throw error;
  }
  if (generation !== openingGeneration) {
    if (value?.id) void request({action:'end',sessionId:value.id}).catch(() => {});
    throw expired();
  }
  if (!value?.id || !value.user?.id || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at)<=Date.now()) throw expired();
  sessionId = value.id;
  window.sessionStorage.setItem(storageKey, sessionId);
  publish(value);
  return value;
}
export async function refreshImpersonation() {
  if (!sessionId) return null;
  if (refreshing?.sessionId === sessionId && refreshing.generation === generation) return refreshing.promise;
  const expected = sessionId, expectedGeneration = generation;
  const promise = request({action:'status',sessionId:expected}).then(value => {
    if (sessionId !== expected || generation !== expectedGeneration) throw expired();
    if (value.id !== expected || !value.user?.id || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at)<=Date.now()) throw expired();
    publish(value);
    return value;
  }).catch(error => {
    if (sessionId===expected && generation===expectedGeneration && [401,403,404,410].includes(error.status)) clear();
    throw error;
  }).finally(() => { if (refreshing?.promise === promise) refreshing=null; });
  refreshing = { sessionId: expected, generation: expectedGeneration, promise };
  return promise;
}
export async function endImpersonation() {
  const expected = sessionId;
  // Invalidate all in-flight delegated responses before restoring the owner UI
  clear();
  if (expected) await request({action:'end',sessionId:expected});
}
export async function getEffectiveUser() {
  const expectedGeneration = generation, expectedSession = sessionId;
  try {
    if (!expectedSession) {
      const session = await supabase.auth.getSession();
      if (session.error) throw session.error;
      if (!session.data.session) return { data: { user: null }, error: null };
      const result = await supabase.auth.getUser(session.data.session.access_token);
      if (generation !== expectedGeneration || sessionId !== expectedSession) throw expired();
      if (result.error || !result.data.user) return result;
      const access = await checkAccountAccess(session.data.session.access_token);
      if (access.user_id !== result.data.user.id || (access.role || null) !== (result.data.user.app_metadata?.role || null) || generation !== expectedGeneration || sessionId !== expectedSession) throw unavailable();
      return result;
    }
    const value = current || await refreshImpersonation();
    if (!value || Date.parse(value.expires_at)<=Date.now() || generation !== expectedGeneration || sessionId !== expectedSession) throw expired();
    return {data:{user:value.user},error:null};
  } catch (error) { return {data:{user:null},error}; }
}
export async function delegatedAccountRequest(body) {
  if (!sessionId) throw expired();
  if (!['client-phone-start','client-phone-verify'].includes(body.action))
    throw Object.assign(new Error('ارجع إلى حساب السوبر أدمن لتنفيذ هذا الإجراء'), {userFacing:true,status:403});
  const activeId = sessionId, activeGeneration = generation;
  const result = await request({action:'client-account',sessionId:activeId,body});
  if (generation!==activeGeneration || sessionId!==activeId) throw expired();
  return result;
}
export async function uploadWithEffectiveAccess(bucket, path, file, options = {}) {
  if (!sessionId) return supabase.storage.from(bucket).upload(path, file, options);
  const expected = sessionId;
  const signed = await supabase.storage.from(bucket).createSignedUploadUrl(path, {upsert:options.upsert===true});
  if (signed.error) return signed;
  if (sessionId!==expected) throw expired();
  return supabase.storage.from(bucket).uploadToSignedUrl(path, signed.data.token, file, options);
}

// All database and private Storage reads/mutations use the server-held target
// credential  Auth itself stays on the original owner session for safe return
export async function impersonationFetch(input, init = {}) {
  const address = new URL(typeof input==='string' ? input : input.url || String(input));
  const ownOrigin = new URL(import.meta.env.VITE_SUPABASE_URL).origin;
  if (address.origin!==ownOrigin || !/^\/(rest|storage)\/v1\//.test(address.pathname)) return fetch(input, init);
  const activeId = sessionId, activeGeneration = generation;
  if (!sessionId) {
    const result = await fetch(input, init);
    if (generation!==activeGeneration || sessionId!==activeId) throw expired();
    return result;
  }
  const method = (init.method || 'GET').toUpperCase();
  // Exact-path signed upload capabilities contain no account session credentials
  if (method==='PUT' && address.pathname.startsWith('/storage/v1/object/upload/sign/') && address.searchParams.has('token')) {
    const headers = new Headers(init.headers);
    headers.delete('authorization');
    const result = await fetch(input, {...init,headers});
    if (generation!==activeGeneration || sessionId!==activeId) throw expired();
    return result;
  }
  if (init.body!=null && typeof init.body!=='string') throw new Error('delegated_upload_requires_signed_url');
  const headers = Object.fromEntries([...new Headers(init.headers)].filter(([name]) =>
    ['accept','content-type','prefer','range','range-unit','x-upsert'].includes(name)));
  const result = await request({action:'proxy',sessionId:activeId,path:address.pathname+address.search,method,headers,body:init.body??null});
  if (generation!==activeGeneration || sessionId!==activeId) throw expired();
  return new Response(result.status===204 || method==='HEAD' ? null : result.body, {status:result.status,headers:result.headers});
}
