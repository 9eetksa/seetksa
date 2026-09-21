// Opt-in integration checks against the configured backend
// Requires a temporary owner session in ignored .tools/owner-session.json
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
};
const url = process.env.VITE_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const owner = createClient(
  url,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  options,
);
const anon = createClient(
  url,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  options,
);
const session = JSON.parse(
  await fs.readFile(".tools/owner-session.json", "utf8"),
);
const must = (result) => {
  if (result.error) throw Error(result.error.message);
  return result.data;
};
must(await owner.auth.setSession(session));
const original = must(
  await owner.from("platform_settings").select("*").single(),
);
const users = [];
let changed = false;
let checks = 0;
let asset;
const denied = (r) => {
  assert.ok(r.error, "Expected backend permission denial");
  checks++;
};
const invoke = async (client, name, args) => must(await client.rpc(name, args));
try {
  for (const role of ["client", "employee", "admin"]) {
    const password = `QA-${randomUUID()}-x9!`;
    const user = must(
      await admin.auth.admin.createUser({
        email: `delivered+admin-qa-${role}-${randomUUID()}@resend.dev`,
        password,
        email_confirm: true,
        app_metadata: { role, portal_qa: true },
      }),
    ).user;
    users.push(user);
    const client = createClient(
      url,
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      options,
    );
    must(await client.auth.signInWithPassword({ email: user.email, password }));
    user.client = client;
    denied(await client.rpc("platform_users"));
    denied(await client.rpc("platform_audit"));
    denied(
      await client.rpc("platform_save", {
        p_config: {},
        p_version: original.version,
      }),
    );
    denied(
      await client.rpc("platform_role", {
        p_user: session.user.id,
        p_role: "client",
      }),
    );
    denied(
      await client
        .from("platform_settings")
        .update({ config: { maintenance: true } })
        .eq("id", true),
    );
    denied(
      await client.rpc("platform_impersonate", { p_user: session.user.id }),
    );
  }
  denied(await anon.rpc("platform_users"));
  denied(
    await owner.rpc("platform_role", {
      p_user: session.user.id,
      p_role: "client",
    }),
  );
  const client = users[0].client;
  must(await client.auth.updateUser({ data: { role: "super_admin" } }));
  denied(await client.rpc("platform_users"));
  const acting = await invoke(owner, "platform_impersonate", {
    p_user: users[0].id,
  });
  const effective = await invoke(owner, "platform_profile", {
    p_session: acting.id,
  });
  assert.equal(effective.user_id, users[0].id);
  checks++;
  denied(await client.rpc("platform_profile", { p_session: acting.id }));
  await invoke(owner, "platform_update_profile", {
    p_name: "QA attributed update",
    p_phone: "0500000000",
    p_session: acting.id,
  });
  const profile = must(
    await client
      .from("account_profiles")
      .select("*")
      .eq("user_id", users[0].id)
      .single(),
  );
  assert.equal(profile.updated_by, users[0].id);
  checks++;
  const audit = await invoke(owner, "platform_audit", {});
  assert.ok(
    audit.some(
      (a) =>
        a.action === "profile_update" &&
        a.actor === session.user.email &&
        a.effective_user === users[0].email,
    ),
  );
  checks++;
  await invoke(owner, "platform_end_impersonation", { p_session: acting.id });
  denied(
    await owner.rpc("platform_update_profile", {
      p_name: "expired",
      p_phone: "",
      p_session: acting.id,
    }),
  );
  const current = must(
    await owner.from("platform_settings").select("*").single(),
  );
  await invoke(owner, "platform_save", {
    p_config: { ...current.config, maintenance: true },
    p_version: current.version,
  });
  changed = true;
  denied(await client.rpc("platform_profile"));
  denied(
    await client.rpc("platform_update_profile", {
      p_name: "maintenance",
      p_phone: "",
    }),
  );
  denied(
    await owner.rpc("platform_save", {
      p_config: {},
      p_version: current.version,
    }),
  );
  const during = must(
    await owner.from("platform_settings").select("*").single(),
  );
  await invoke(owner, "platform_save", {
    p_config: original.config,
    p_version: during.version,
  });
  changed = false;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  denied(
    await client.storage
      .from("platform-designs")
      .upload(`${users[0].id}/qa.png`, bytes, { contentType: "image/png" }),
  );
  asset = `${session.user.id}/qa-${randomUUID()}.png`;
  must(
    await owner.storage
      .from("platform-designs")
      .upload(asset, bytes, { contentType: "image/png" }),
  );
  checks++;
  const publicUrl = owner.storage.from("platform-designs").getPublicUrl(asset)
    .data.publicUrl;
  assert.equal((await fetch(publicUrl)).status, 200);
  checks++;
  denied(
    await owner.storage
      .from("platform-designs")
      .upload(`${session.user.id}/qa.svg`, Buffer.from("<svg/>"), {
        contentType: "image/svg+xml",
      }),
  );
  const auditRead = await client
    .schema("provision_private")
    .from("audit")
    .select("*");
  denied(auditRead);
  console.log(`PASS ${checks} live authorization and attribution checks`);
} finally {
  if (changed) {
    const current = must(
      await owner.from("platform_settings").select("*").single(),
    );
    await invoke(owner, "platform_save", {
      p_config: original.config,
      p_version: current.version,
    });
  }
  if (asset) must(await owner.storage.from("platform-designs").remove([asset]));
  for (const u of users) must(await admin.auth.admin.deleteUser(u.id));
  console.log("Disposable accounts and test asset removed");
}
