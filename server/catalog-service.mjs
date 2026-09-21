import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const resources = new Set(["services", "portfolio"]);
const serviceFields =
  "id,name,slug,category,description,icon,active,default_target_minutes,default_effort_points,sort_order";
const legacyServiceFields = "id,name,active";
const portfolioFields =
  "id,name,description,project_url,status,version,created_at,updated_at,portfolio_media(id,work_id,source,object_path,filename,mime_type,byte_size,position,is_cover)";
const tokenPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const accountRoles = new Set(["client", "employee", "admin", "super_admin"]);

export class CatalogError extends Error {
  constructor(status, code, message = "تعذر تحميل الكتالوج") {
    super(message);
    this.name = "CatalogError";
    this.status = status;
    this.code = code;
  }
}

const failure = (status, code, message) =>
  new CatalogError(status, code, message);

function validConfiguration(env) {
  const url = String(env.VITE_SUPABASE_URL || "");
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || "");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const local =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  return (
    (parsed.protocol === "https:" || local) &&
    url.length <= 2048 &&
    key.length > 0 &&
    key.length <= 4096
  );
}

function timedFetch(transport, timeoutMs) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) forwardAbort();
    else init.signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      return await transport(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", forwardAbort);
    }
  };
}

function within(promise, timeoutMs) {
  let timeout;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(
      () => reject(failure(504, "catalog_timeout")),
      timeoutMs,
    );
  });
  return Promise.race([Promise.resolve(promise), expired]).finally(() =>
    clearTimeout(timeout),
  );
}

function normalizeInteger(value, fallback, minimum = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : fallback;
}

function normalizeNumber(value, fallback, minimum = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? number : fallback;
}

function normalizeServices(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.active !== false)
    .map((row, index) => ({
      id: String(row.id),
      name: String(row.name || ""),
      slug:
        typeof row.slug === "string" && row.slug.trim()
          ? row.slug.trim()
          : String(row.id),
      category:
        typeof row.category === "string" && row.category.trim()
          ? row.category.trim()
          : "خدمات صيت",
      description:
        typeof row.description === "string" && row.description.trim()
          ? row.description
          : "خدمة متخصصة مرتبطة مباشرة بمسار الطلب والتنفيذ",
      icon:
        typeof row.icon === "string" && row.icon.trim()
          ? row.icon.trim()
          : "sparkles",
      active: row.active !== false,
      default_target_minutes: normalizeInteger(
        row.default_target_minutes,
        4320,
        1,
      ),
      default_effort_points: normalizeNumber(
        row.default_effort_points,
        5,
        0.5,
      ),
      sort_order: normalizeInteger(row.sort_order, (index + 1) * 10, 0),
    }))
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order ||
        left.name.localeCompare(right.name, "ar"),
    );
}

function normalizePortfolio(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: String(row.id),
    name: String(row.name || ""),
    description: String(row.description || ""),
    project_url: typeof row.project_url === "string" ? row.project_url : null,
    status: row.status === "archived" ? "archived" : "active",
    version: normalizeInteger(row.version, 1, 1),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    portfolio_media: (Array.isArray(row.portfolio_media)
      ? row.portfolio_media
      : []
    )
      .map((media) => ({
        id: String(media.id),
        work_id: String(media.work_id),
        source: media.source === "storage" ? "storage" : "packaged",
        object_path: String(media.object_path || ""),
        filename: String(media.filename || ""),
        mime_type: String(media.mime_type || ""),
        byte_size:
          media.byte_size === null
            ? null
            : normalizeInteger(media.byte_size, null, 0),
        position: normalizeInteger(media.position, 0, 0),
        is_cover: media.is_cover === true,
      }))
      .sort(
        (left, right) =>
          left.position - right.position || left.id.localeCompare(right.id),
      ),
  }));
}

function missingServiceMetadata(error) {
  return error?.code === "42703" || error?.code === "PGRST204";
}

function queryFailure(error) {
  if (error?.code === "42501" || error?.code === "PGRST301")
    return failure(403, "catalog_forbidden");
  return failure(502, "catalog_upstream");
}

function identityFailure(error) {
  if (error?.name === "AuthRetryableFetchError") {
    return /abort|timeout|timed out/i.test(String(error.message || ""))
      ? failure(504, "catalog_timeout")
      : failure(502, "catalog_upstream");
  }
  const status = Number(error?.status) || 0;
  if (status >= 500 || status === 429)
    return failure(502, "catalog_upstream");
  return failure(401, "catalog_unauthorized", "سجل الدخول للمتابعة");
}

async function readServices(client, timeoutMs) {
  let response = await within(
    client
      .from("work_services")
      .select(serviceFields)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .limit(100),
    timeoutMs,
  );
  if (response.error && missingServiceMetadata(response.error)) {
    response = await within(
      client
        .from("work_services")
        .select(legacyServiceFields)
        .order("name", { ascending: true })
        .limit(100),
      timeoutMs,
    );
  }
  if (response.error) throw queryFailure(response.error);
  return normalizeServices(response.data);
}

async function readPortfolio(client, timeoutMs) {
  const response = await within(
    client
      .from("portfolio_works")
      .select(portfolioFields)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(100, { foreignTable: "portfolio_media" })
      .limit(50),
    timeoutMs,
  );
  if (response.error) throw queryFailure(response.error);
  return normalizePortfolio(response.data);
}

export function createCatalogService(
  env,
  {
    createSupabaseClient = createClient,
    transport = fetch,
    timeoutMs = 6000,
  } = {},
) {
  const boundedTimeout = Math.min(Math.max(Number(timeoutMs) || 6000, 10), 15000);
  return async ({ resource, token }) => {
    if (!resources.has(resource))
      throw failure(400, "catalog_resource", "طلب الكتالوج غير صالح");
    if (
      typeof token !== "string" ||
      token.length < 16 ||
      token.length > 8192 ||
      !tokenPattern.test(token)
    )
      throw failure(401, "catalog_unauthorized", "سجل الدخول للمتابعة");
    if (!validConfiguration(env))
      throw failure(503, "catalog_unavailable");

    const client = createSupabaseClient(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        realtime: { transport: WebSocket },
        global: {
          headers: { Authorization: `Bearer ${token}` },
          fetch: timedFetch(transport, boundedTimeout),
        },
      },
    );

    let identity;
    try {
      identity = await within(client.auth.getUser(token), boundedTimeout);
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      if (error?.name === "AbortError" || error?.name === "TimeoutError")
        throw failure(504, "catalog_timeout");
      throw failure(502, "catalog_upstream");
    }
    const user = identity.data?.user;
    if (identity.error) throw identityFailure(identity.error);
    if (!user?.id)
      throw failure(401, "catalog_unauthorized", "سجل الدخول للمتابعة");
    const bannedUntil = Date.parse(user.banned_until || "");
    const mustChange = user.app_metadata?.must_change_password;
    if (
      user.is_anonymous ||
      !accountRoles.has(user.app_metadata?.role) ||
      mustChange === true ||
      mustChange === "true" ||
      (Number.isFinite(bannedUntil) && bannedUntil > Date.now())
    )
      throw failure(403, "catalog_forbidden");

    try {
      const data =
        resource === "services"
          ? await readServices(client, boundedTimeout)
          : await readPortfolio(client, boundedTimeout);
      return { userId: user.id, data };
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      if (error?.name === "AbortError" || error?.name === "TimeoutError")
        throw failure(504, "catalog_timeout");
      throw failure(502, "catalog_upstream");
    }
  };
}
