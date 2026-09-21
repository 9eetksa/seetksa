import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createCatalogService } from "../server/catalog-service.mjs";
import { catalogHandler } from "../api/catalog.js";

const env = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_catalog_test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-must-not-be-used",
};
const token = `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`;

function fakeClient(responses, auth = {}) {
  const calls = [];
  return {
    calls,
    client: {
      auth: {
        getUser: async (supplied) => ({
          data: {
            user: {
              id: "user-1",
              is_anonymous: false,
              app_metadata: { role: "admin" },
            },
          },
          error: null,
          supplied,
          ...auth,
        }),
      },
      from(table) {
        return {
          select(fields) {
            calls.push({ table, fields });
            const builder = {
              order(column, options) {
                (calls.at(-1).orders ||= []).push({ column, options });
                return builder;
              },
              limit(count, options) {
                (calls.at(-1).limits ||= []).push({ count, options });
                return builder;
              },
              then(resolve, reject) {
                return Promise.resolve(responses.shift()).then(resolve, reject);
              },
            };
            return builder;
          },
        };
      },
    },
  };
}

test("uses the publishable key and forwards the verified JWT to RLS queries", async () => {
  const fake = fakeClient([
    {
      data: [
        {
          id: "work-1",
          name: "عمل",
          description: "وصف",
          project_url: null,
          status: "active",
          version: 2,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
          portfolio_media: [],
        },
      ],
      error: null,
    },
  ]);
  let configuration;
  const service = createCatalogService(env, {
    createSupabaseClient: (url, key, options) => {
      configuration = { url, key, options };
      return fake.client;
    },
  });
  const result = await service({ resource: "portfolio", token });
  assert.equal(configuration.key, env.VITE_SUPABASE_PUBLISHABLE_KEY);
  assert.notEqual(configuration.key, env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(configuration.options.realtime.transport, WebSocket);
  assert.equal(configuration.options.global.headers.Authorization, `Bearer ${token}`);
  assert.equal(result.userId, "user-1");
  assert.equal(result.data[0].id, "work-1");
  assert.equal(fake.calls[0].table, "portfolio_works");
  assert.match(fake.calls[0].fields, /portfolio_media\(id,work_id/);
});

test("falls back to legacy service fields only when metadata columns are absent", async () => {
  const fake = fakeClient([
    { data: null, error: { code: "42703", message: "missing column" } },
    {
      data: [{ id: "service-1", name: "التصميم", active: true }],
      error: null,
    },
  ]);
  const service = createCatalogService(env, {
    createSupabaseClient: () => fake.client,
  });
  const result = await service({ resource: "services", token });
  assert.deepEqual(
    fake.calls.map((call) => call.fields),
    [
      "id,name,slug,category,description,icon,active,default_target_minutes,default_effort_points,sort_order",
      "id,name,active",
    ],
  );
  assert.deepEqual(result.data[0], {
    id: "service-1",
    name: "التصميم",
    slug: "service-1",
    category: "خدمات صيت",
    description: "خدمة متخصصة مرتبطة مباشرة بمسار الطلب والتنفيذ",
    icon: "sparkles",
    active: true,
    default_target_minutes: 4320,
    default_effort_points: 5,
    sort_order: 10,
  });
});

test("preserves fractional effort points in the explicit service contract", async () => {
  const fake = fakeClient([
    {
      data: [
        {
          id: "service-1",
          name: "التصميم",
          slug: "design",
          category: "الهوية والتصميم",
          description: "خدمة تصميم",
          icon: "palette",
          active: true,
          default_target_minutes: 90,
          default_effort_points: 2.5,
          sort_order: 20,
        },
      ],
      error: null,
    },
  ]);
  const service = createCatalogService(env, {
    createSupabaseClient: () => fake.client,
  });
  const result = await service({ resource: "services", token });
  assert.equal(result.data[0].default_effort_points, 2.5);
});

test("hides inactive services and rejects identities that are not ready", async () => {
  const fake = fakeClient([
    {
      data: [
        { id: "active", name: "نشطة", active: true },
        { id: "inactive", name: "متوقفة", active: false },
      ],
      error: null,
    },
  ]);
  const service = createCatalogService(env, { createSupabaseClient: () => fake.client });
  const result = await service({ resource: "services", token });
  assert.deepEqual(result.data.map(row => row.id), ["active"]);

  for (const user of [
    { id: "anonymous", is_anonymous: true, app_metadata: { role: "client" } },
    { id: "pending", is_anonymous: false, app_metadata: { role: "employee", must_change_password: true } },
    { id: "unknown", is_anonymous: false, app_metadata: { role: "unknown" } },
    { id: "banned", is_anonymous: false, banned_until: "2099-01-01T00:00:00Z", app_metadata: { role: "client" } },
  ]) {
    const denied = fakeClient([], { data: { user } });
    const protectedService = createCatalogService(env, { createSupabaseClient: () => denied.client });
    await assert.rejects(protectedService({ resource: "services", token }), error => error.status === 403);
  }
});

test("does not downgrade authorization or upstream failures to the legacy query", async () => {
  for (const [code, status] of [
    ["42501", 403],
    ["PGRST000", 502],
  ]) {
    const fake = fakeClient([
      { data: null, error: { code, message: "private database detail" } },
    ]);
    const service = createCatalogService(env, {
      createSupabaseClient: () => fake.client,
    });
    await assert.rejects(
      service({ resource: "services", token }),
      (error) =>
        error.status === status &&
        error.message === "تعذر تحميل الكتالوج" &&
        !error.message.includes("database"),
    );
    assert.equal(fake.calls.length, 1);
  }
});

test("rejects unknown resources and invalid or oversized tokens before querying", async () => {
  let created = 0;
  const service = createCatalogService(env, {
    createSupabaseClient: () => {
      created += 1;
      return {};
    },
  });
  await assert.rejects(
    service({ resource: "accounts", token }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    service({ resource: "services", token: "short" }),
    (error) => error.status === 401,
  );
  await assert.rejects(
    service({ resource: "services", token: "a".repeat(8193) }),
    (error) => error.status === 401,
  );
  assert.equal(created, 0);
});

test("bounds an unresponsive identity verification call", async () => {
  const service = createCatalogService(env, {
    timeoutMs: 10,
    createSupabaseClient: () => ({
      auth: { getUser: () => new Promise(() => {}) },
    }),
  });
  await assert.rejects(
    service({ resource: "portfolio", token }),
    (error) => error.status === 504 && error.code === "catalog_timeout",
  );
});

test("distinguishes retryable identity failures from invalid credentials", async () => {
  for (const [identityError, status] of [
    [{ name: "AuthRetryableFetchError", message: "This operation was aborted", status: 0 }, 504],
    [{ name: "AuthRetryableFetchError", message: "fetch failed", status: 0 }, 502],
    [{ name: "AuthApiError", message: "invalid JWT", status: 401 }, 401],
  ]) {
    const fake = fakeClient([], { data: { user: null }, error: identityError });
    const service = createCatalogService(env, { createSupabaseClient: () => fake.client });
    await assert.rejects(service({ resource: "services", token }), error => error.status === status);
  }
});

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

test("the GET handler emits private ETags and returns 304 for the same user payload", async () => {
  let serviceEnvironment;
  const handler = catalogHandler(env, {
    createService: (receivedEnvironment) => {
      serviceEnvironment = receivedEnvironment;
      return async () => ({
        userId: "user-1",
        data: [{ id: "service-1" }],
      });
    },
  });
  const first = response();
  await handler(
    {
      method: "GET",
      url: "/api/catalog?resource=services",
      headers: { authorization: `Bearer ${token}` },
    },
    first,
  );
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers.vary, "Authorization");
  assert.match(first.headers["cache-control"], /^private/);
  assert.ok(first.headers.etag);
  assert.deepEqual(serviceEnvironment, {
    VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
  assert.equal(serviceEnvironment.SUPABASE_SERVICE_ROLE_KEY, undefined);

  const second = response();
  await handler(
    {
      method: "GET",
      url: "/api/catalog?resource=services",
      headers: {
        authorization: `Bearer ${token}`,
        "if-none-match": first.headers.etag,
      },
    },
    second,
  );
  assert.equal(second.statusCode, 304);
  assert.equal(second.body, undefined);
});

test("the handler permits GET only and rejects extra or oversized query input", async () => {
  const handler = catalogHandler(env, {
    createService: () => async () => ({ userId: "user-1", data: [] }),
  });
  const method = response();
  await handler(
    { method: "POST", url: "/api/catalog", headers: {} },
    method,
  );
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, "GET");

  const unauthorized = response();
  await handler(
    { method: "GET", url: "/api/catalog?resource=services", headers: {} },
    unauthorized,
  );
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers["www-authenticate"], "Bearer");

  for (const url of [
    "/api/catalog?resource=portfolio&table=users",
    `/api/catalog?resource=services&x=${"a".repeat(1100)}`,
  ]) {
    const invalid = response();
    await handler(
      { method: "GET", url, headers: { authorization: `Bearer ${token}` } },
      invalid,
    );
    assert.ok([400, 414].includes(invalid.statusCode));
    assert.deepEqual(invalid.body, { error: "طلب الكتالوج غير صالح" });
  }
});
