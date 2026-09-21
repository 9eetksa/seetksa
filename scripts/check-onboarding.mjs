// Integration check uses disposable Supabase accounts and mocked delivery providers
// Run manually with node scripts/check-onboarding.mjs
import { loadEnv } from "vite";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  createAccountService,
  decryptPassword,
} from "../server/account-service.mjs";
const env = loadEnv("development", process.cwd(), ""),
  options = {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket },
  };
const admin = createClient(
    env.VITE_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    options,
  ),
  client = () =>
    createClient(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
      options,
    );
const must = (r) => {
  if (r.error) throw new Error(r.error.code || r.error.message);
  return r.data;
};
const userIds = [],
  inviteIds = [];
let checks = 0;
const pass = (label) => {
  checks++;
  console.log("PASS " + label);
};
try {
  const owner = client(),
    link = must(
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email: "ahmed.abumoalla95@gmail.com",
      }),
    );
  const ownerSession = must(
    await owner.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    }),
  ).session;
  let calls = 0,
    failWhatsapp = true;
  const service = createAccountService(env, async (url) => {
    calls++;
    return new Response(
      JSON.stringify(
        url.includes("resend")
          ? { id: randomUUID() }
          : failWhatsapp
            ? { error: "test failure" }
            : { idMessage: randomUUID() },
      ),
      { status: url.includes("resend") || !failWhatsapp ? 200 : 503 },
    );
  });
  const input = {
    action: "create",
    requestId: randomUUID(),
    name: "Onboarding QA",
    email: `onboarding-${Date.now()}@resend.dev`,
    phone: "+15005550006",
    role: "employee",
    jobTitle: "QA Designer",
  };
  inviteIds.push(input.requestId);
  const created = await service(input, ownerSession.access_token);
  userIds.push(created.invitation.user_id);
  assert.equal(created.invitation.email_status, "sent");
  assert.equal(created.invitation.whatsapp_status, "failed");
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(created).includes("password"));
  pass("account created with independent delivery statuses");
  failWhatsapp = false;
  await service(input, ownerSession.access_token);
  assert.equal(calls, 3);
  await service(input, ownerSession.access_token);
  assert.equal(calls, 3);
  pass("idempotent creation and failed channel retry");
  const invite = must(
    await admin
      .from("account_invitations")
      .select("*")
      .eq("id", input.requestId)
      .single(),
  );
  const temporary = decryptPassword(
    invite.password_cipher,
    env.ONBOARDING_ENCRYPTION_KEY,
  );
  const employee = client();
  let session = must(
    await employee.auth.signInWithPassword({
      email: input.email,
      password: temporary,
    }),
  ).session;
  assert.equal(session.user.app_metadata.must_change_password, true);
  for (const name of ["platform_profile", "platform_users", "platform_audit"])
    assert.ok((await employee.rpc(name)).error);
  assert.ok((await employee.from("account_invitations").select("*")).error);
  assert.ok(
    (await employee.rpc("platform_phone_email", { p_phone: input.phone }))
      .error,
  );
  pass("first login and service-only data protected in database");
  await assert.rejects(
    () => service({ ...input, requestId: randomUUID() }, session.access_token),
    (e) => e.status === 403,
  );
  await assert.rejects(
    () =>
      service(
        {
          action: "change-password",
          password: "abcdefgh1@",
          confirmation: "abcdefgh1@",
        },
        session.access_token,
      ),
    (e) => e.status === 400,
  );
  pass("unauthorized creation and weak password rejected");
  const phone = await service(
    { action: "phone-login", identifier: input.phone, password: temporary },
    null,
    "qa-check",
  );
  assert.equal(phone.session.user.id, session.user.id);
  pass("mobile password login");
  const changed = await service(
    {
      action: "change-password",
      password: "QA_Valid12345",
      confirmation: "QA_Valid12345",
    },
    session.access_token,
  );
  must(await employee.auth.setSession(changed.session));
  session = must(await employee.auth.refreshSession()).session;
  assert.equal(session.user.app_metadata.must_change_password, false);
  assert.equal(
    must(await employee.rpc("platform_profile")).job_title,
    "QA Designer",
  );
  assert.ok(
    (
      await client().auth.signInWithPassword({
        email: input.email,
        password: temporary,
      })
    ).error,
  );
  assert.equal(
    must(
      await admin
        .from("account_invitations")
        .select("password_cipher")
        .eq("id", input.requestId)
        .single(),
    ).password_cipher,
    null,
  );
  pass("first password change unlocks account and erases temporary credential");
  const newLogin = await service(
    {
      action: "phone-login",
      identifier: input.phone,
      password: "QA_Valid12345",
    },
    null,
    "qa-check",
  );
  assert.equal(newLogin.session.user.id, session.user.id);
  pass("mobile login after changing password");
  must(
    await admin.auth.admin.updateUserById(session.user.id, {
      app_metadata: {
        role: "admin",
        permissions: ["users.read"],
        must_change_password: false,
      },
    }),
  );
  must(await employee.auth.refreshSession());
  assert.ok(Array.isArray(must(await employee.rpc("platform_users"))));
  assert.ok((await employee.rpc("platform_audit")).error);
  assert.ok(
    (
      await employee.rpc("platform_permissions", {
        p_user: session.user.id,
        p_permissions: ["audit.read"],
      })
    ).error,
  );
  const settings = must(
    await admin
      .from("platform_settings")
      .select("config,version")
      .eq("id", true)
      .single(),
  );
  assert.ok(
    (
      await employee.rpc("platform_save", {
        p_config: {
          ...settings.config,
          maintenance: !settings.config.maintenance,
        },
        p_version: settings.version,
      })
    ).error,
  );
  pass("admin permissions enforced server-side");
  must(
    await owner.rpc("platform_permissions", {
      p_user: session.user.id,
      p_permissions: ["audit.read"],
    }),
  );
  assert.ok((await employee.rpc("platform_users")).error);
  assert.ok(Array.isArray(must(await employee.rpc("platform_audit"))));
  pass("permission revocation is immediate with existing token");
  await owner.auth.signOut({ scope: "local" });
  const stateResponse = await fetch(
    `${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/getStateInstance/${env.GREEN_API_TOKEN}`,
  );
  const state = await stateResponse.json();
  assert.equal(state.stateInstance, "authorized");
  pass("live Green API instance authorized");
  console.log(
    `${checks} integration checks passed without sending test WhatsApp messages`,
  );
} finally {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  for (const id of inviteIds)
    await admin.from("account_invitations").delete().eq("id", id);
}
