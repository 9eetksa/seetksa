import test from "node:test";
import assert from "node:assert/strict";
import {
  authMessage,
  passwordIssue,
  rolePaths,
  trustedRole,
} from "../src/auth/access.js";

test("only server-managed staff roles resolve to dashboards", () => {
  assert.equal(trustedRole({app_metadata:{role:'client'}}),null);
  assert.equal(rolePaths.client,undefined);
  for (const role of ["employee"]) {
    assert.equal(
      rolePaths[trustedRole({ app_metadata: { role } })],
      `/${role}/dashboard`,
    );
  }
});

test("client-editable metadata cannot elevate or assign access", () => {
  assert.equal(trustedRole({ user_metadata: { role: "employee" } }), null);
  assert.equal(
    trustedRole({
      app_metadata: { role: "client" },
      user_metadata: { role: "employee" },
    }),
    null,
  );
});

test("missing unknown inherited and anonymous roles fail closed", () => {
  for (const role of [
    undefined,
    null,
    "",
    "owner",
    "Employee",
    "__proto__",
    "constructor",
    "/employee/dashboard",
  ]) {
    assert.equal(trustedRole({ app_metadata: { role } }), null);
  }
  assert.equal(trustedRole(null), null);
  assert.equal(
    trustedRole({ is_anonymous: true, app_metadata: { role: "employee" } }),
    null,
  );
});

test("password reset enforces length and matching confirmation without silently trimming passwords", () => {
  assert.ok(passwordIssue("short", "short"));
  assert.ok(passwordIssue("long-enough-password", "different-password"));
  assert.ok(passwordIssue("long-enough-password ", "long-enough-password"));
  assert.equal(passwordIssue("ABC123_@", "ABC123_@"), "");
  for (const password of ["abcdefgh1@", "ABCDEFGH@", "ABCDEFGH1", "A1_4567", "ABC12345ع"])
    assert.ok(passwordIssue(password, password));
});

test("authentication failures do not expose internal server messages", () => {
  assert.equal(
    authMessage({ status: 429 }),
    "طلبات كثيرة خلال وقت قصير يرجى المحاولة بعد قليل",
  );
  assert.equal(
    authMessage({ code: "invalid_credentials" }),
    "البريد الإلكتروني أو الجوال أو كلمة المرور غير صحيحة",
  );
  assert.ok(
    !authMessage({ message: "sensitive internal database details" }).includes(
      "database",
    ),
  );
});

test("trusted owner and admin have separate routes", () => {
  assert.equal(
    rolePaths[trustedRole({ app_metadata: { role: "super_admin" } })],
    "/admin/dashboard",
  );
  assert.equal(
    rolePaths[trustedRole({ app_metadata: { role: "admin" } })],
    "/admin/workspace",
  );
  assert.equal(trustedRole({ user_metadata: { role: "super_admin" } }), null);
});
