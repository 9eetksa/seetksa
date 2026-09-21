import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  temporaryPassword,
  encryptPassword,
  decryptPassword,
  isAuthorizedOwner,
} from "../server/account-service.mjs";
import {
  normalizePhone,
  validateNewAccount,
  allowed,
  adminPermissions,
} from "../src/auth/account-rules.js";
test("temporary passwords match eight uppercase letters and digits with both classes", () => {
  for (let i = 0; i < 1000; i++) {
    const p = temporaryPassword();
    assert.match(p, /^[A-Z0-9]{8}$/);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[0-9]/);
  }
});
test("stored temporary passwords are authenticated ciphertext", () => {
  const key = randomBytes(32).toString("hex"),
    p = temporaryPassword(),
    encrypted = encryptPassword(p, key);
  assert.equal(decryptPassword(encrypted, key), p);
  assert.notEqual(encryptPassword(p, key), encrypted);
  assert.throws(() =>
    decryptPassword(encrypted, randomBytes(32).toString("hex")),
  );
});
test("Saudi and international mobile formats normalize consistently", () => {
  for (const p of [
    "0508424401",
    "٥٠٨٤٢٤٤٠١",
    "966508424401",
    "+966 50 842 4401",
    "00966508424401",
  ])
    assert.equal(normalizePhone(p), "+966508424401");
  assert.equal(normalizePhone("+15005550006"), "+15005550006");
  for (const p of ["hello", "050", "+000000000"])
    assert.equal(normalizePhone(p), null);
});
test("account validation limits roles and requires employee job title", () => {
  const base = {
    name: "Test Account",
    email: "test@example.com",
    phone: "0508424401",
    role: "client",
  };
  assert.equal(validateNewAccount(base).value.contactName, "");
  assert.equal(
    validateNewAccount({ ...base, contactName: "  Ahmed Ali  " }).value
      .contactName,
    "Ahmed Ali",
  );
  assert.ok(validateNewAccount({ ...base, contactName: "A".repeat(121) }).error);
  assert.ok(validateNewAccount({ ...base, role: "super_admin" }).error);
  assert.ok(validateNewAccount({ ...base, role: "employee" }).error);
  assert.ok(
    validateNewAccount({ ...base, role: "employee", jobTitle: "Designer" })
      .value,
  );
  assert.ok(
    validateNewAccount({ ...base, role: "admin", permissions: {} }).error,
  );
  assert.ok(
    validateNewAccount({ ...base, role: "admin", permissions: ["super_admin"] })
      .error,
  );
});
test("permissions fail closed for pending accounts and client metadata", () => {
  assert.equal(adminPermissions["departments.manage"], "إدارة الأقسام");
  assert.equal(
    allowed(
      { app_metadata: { role: "admin", permissions: ["departments.manage"] } },
      "departments.manage",
    ),
    true,
  );
  assert.equal(
    allowed(
      { app_metadata: { role: "super_admin", must_change_password: true } },
      "users.read",
    ),
    false,
  );
  assert.equal(
    allowed(
      { app_metadata: { role: "admin", permissions: ["users.read"] } },
      "content.edit",
    ),
    false,
  );
  assert.equal(
    allowed(
      { app_metadata: { role: "admin", permissions: ["users.read"] } },
      "users.read",
    ),
    true,
  );
  assert.equal(
    allowed(
      {
        app_metadata: { role: "client" },
        user_metadata: { permissions: ["users.read"] },
      },
      "users.read",
    ),
    false,
  );
});
test("owner service rejects anonymous pending and banned identities", () => {
  const owner={app_metadata:{role:"super_admin"},is_anonymous:false};
  assert.equal(isAuthorizedOwner(owner),true);
  assert.equal(isAuthorizedOwner({...owner,is_anonymous:true}),false);
  assert.equal(isAuthorizedOwner({...owner,app_metadata:{...owner.app_metadata,must_change_password:true}}),false);
  assert.equal(isAuthorizedOwner({...owner,banned_until:"2099-01-01T00:00:00Z"},Date.parse("2026-01-01T00:00:00Z")),false);
  assert.equal(isAuthorizedOwner({...owner,banned_until:"2020-01-01T00:00:00Z"},Date.parse("2026-01-01T00:00:00Z")),true);
});
