import { supabase } from "../auth/supabase";
import { hasImpersonation, subscribeImpersonation } from '../auth/impersonation';

const allowedResources = new Set(["services", "portfolio"]);
const cache = new Map();
const inFlight = new Map();
const cacheMs = 1500;
export function invalidateCatalog(resource) {
  generation += 1;
  for (const key of cache.keys()) if (key.endsWith(`:${resource}`)) cache.delete(key);
  for (const key of inFlight.keys()) if (key.endsWith(`:${resource}`)) inFlight.delete(key);
}
const responseLimit = 2 * 1024 * 1024;
const tokenPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
let activeUser = null;
let generation = 0;
subscribeImpersonation(()=>{generation++;activeUser=null;cache.clear();inFlight.clear();});

const gatewayError = (status = 500) =>
  Object.assign(new Error("تعذر تحميل البيانات"), {
    status,
    userFacing: true,
  });

function selectUser(userId) {
  if (activeUser === userId) return generation;
  activeUser = userId;
  generation += 1;
  cache.clear();
  return generation;
}

async function request(resource, session, key, requestGeneration) {
  const previous = cache.get(key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `/api/catalog?${new URLSearchParams({ resource })}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          ...(previous?.etag ? { "If-None-Match": previous.etag } : {}),
        },
        signal: controller.signal,
      },
    );
    if (response.status === 304 && previous) {
      if (generation === requestGeneration && activeUser === session.user.id)
        cache.set(key, { ...previous, expiresAt: Date.now() + cacheMs });
      return previous.data;
    }
    if (!response.ok) throw gatewayError(response.status);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > responseLimit) throw gatewayError(502);
    const raw = await response.text();
    if (raw.length > responseLimit) throw gatewayError(502);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw gatewayError(502);
    }
    if (!body || !Array.isArray(body.data)) throw gatewayError(502);
    if (generation === requestGeneration && activeUser === session.user.id)
      cache.set(key, {
        data: body.data,
        etag: response.headers.get("etag"),
        expiresAt: Date.now() + cacheMs,
      });
    return body.data;
  } catch (error) {
    if (error?.name === "AbortError") throw gatewayError(504);
    if (error?.userFacing) throw error;
    throw gatewayError();
  } finally {
    clearTimeout(timer);
  }
}

export async function getCatalog(resource) {
  if (!allowedResources.has(resource)) throw gatewayError(400);
  if (hasImpersonation()) {
    const response = resource === 'services'
      ? await supabase.rpc('work_service_catalog',{p_include_inactive:false})
      : await supabase.from('portfolio_works').select('id,name,description,project_url,status,version,created_at,updated_at,portfolio_media(id,work_id,source,object_path,filename,mime_type,byte_size,position,is_cover)').order('updated_at',{ascending:false});
    if (response.error) throw gatewayError(403);
    return response.data || [];
  }
  let authResult;
  try {
    if (!supabase?.auth) throw gatewayError(503);
    authResult = await supabase.auth.getSession();
  } catch (error) {
    if (error?.userFacing) throw error;
    throw gatewayError(503);
  }
  const { data, error } = authResult;
  const session = data?.session;
  if (
    error ||
    typeof session?.user?.id !== "string" ||
    !session.user.id ||
    typeof session.access_token !== "string" ||
    session.access_token.length < 16 ||
    session.access_token.length > 8192 ||
    !tokenPattern.test(session.access_token)
  )
    throw gatewayError(401);
  const requestGeneration = selectUser(session.user.id);
  const key = `${session.user.id}:${resource}`;
  const stored = cache.get(key);
  if (stored?.expiresAt > Date.now()) return stored.data;
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = request(resource, session, key, requestGeneration);
  inFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}
