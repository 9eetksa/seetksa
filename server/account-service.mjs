import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import {
  randomInt,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from "node:crypto";
import {
  validateNewAccount,
  validateEmployeeUpdate,
  normalizePhone,
  accountTypeLabels,
} from "../src/auth/account-rules.js";
import { passwordIssue } from "../src/auth/access.js";
import {clientAccountService} from './client-account-service.mjs';
import {accountLifecycleService} from './account-lifecycle-service.mjs';

export const temporaryPassword = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value;
  do {
    value = Array.from(
      { length: 8 },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
  } while (!/[A-Z]/.test(value) || !/[0-9]/.test(value));
  return value;
};
export function encryptPassword(password, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decryptPassword(value, key) {
  const bytes = Buffer.from(value, "base64"),
    cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "hex"),
      bytes.subarray(0, 12),
    );
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
const error = (status, message) =>
  Object.assign(new Error(message), { status });
const must = (r) => {
  if (r.error) throw error(502, "تعذر إكمال العملية في قاعدة البيانات");
  return r.data;
};
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isAuthorizedOwner(user,now=Date.now()) {
  const bannedUntil=Date.parse(user?.banned_until||'');
  const passwordChange=user?.app_metadata?.must_change_password;
  return !!user&&!user.is_anonymous&&user.app_metadata?.role==='super_admin'&&passwordChange!==true&&passwordChange!=='true'&&(!Number.isFinite(bannedUntil)||bannedUntil<=now);
}
export function createAccountService(env, transport = fetch) {
  const admin = createClient(
    env.VITE_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    options,
  );
  const encryption = env.ONBOARDING_ENCRYPTION_KEY;
  const clientAccount = clientAccountService(admin,env,transport);
  const lifecycle = accountLifecycleService(admin);
  const update = async (id, values) =>
    must(await admin.from("account_invitations").update(values).eq("id", id));
  async function identity(token) {
    if (!token) throw error(401, "سجل الدخول للمتابعة");
    const { data, error: failure } = await admin.auth.getUser(token);
    if (failure || !data.user)
      throw error(401, "انتهت الجلسة سجل الدخول مجددا");
    const scoped = createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,{
      ...options,global:{headers:{Authorization:`Bearer ${token}`}},
    });
    const access = await scoped.rpc('platform_access_check',{p_allow_onboarding:true});
    if(access.error || access.data?.user_id!==data.user.id)
      throw error(403,'الحساب غير متاح أو انتهت الجلسة سجل الدخول مجددا');
    return data.user;
  }
  function owner(user) {
    if (!isAuthorizedOwner(user))
      throw error(403, "هذه العملية متاحة للسوبر أدمن فقط");
  }
  function ready(phoneOnly = false) {
    if (
      !/^[a-f0-9]{64}$/i.test(encryption || "") ||
      (!phoneOnly && (!env.RESEND_API_KEY || !env.GREEN_API_TOKEN || !env.GREEN_API_INSTANCE_ID ||
      !/^https:\/\/[a-z0-9.-]+\.greenapi\.com$/.test(env.GREEN_API_URL || "")))
    )
      throw error(503, "إرسال بيانات الحساب غير متاح حاليا");
  }
  async function lock(id) {
    const result = await admin.rpc("platform_invite_lock", { p_id: id });
    if (result.error)
      throw error(409, "الطلب قيد التنفيذ انتظر قليلا ثم أعد المحاولة");
    return result.data;
  }
  async function sendChannel(url, body, headers) {
    try {
      const response = await transport(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(18000),
      });
      const data = await response.json().catch(() => ({}));
      return response.ok && typeof (data.id || data.idMessage) === 'string' && (data.id || data.idMessage).trim()
        ? { status: "sent", id: data.id || data.idMessage || null }
        : { status: "failed", id: null };
    } catch {
      return { status: "unknown", id: null };
    }
  }
  async function deliver(invite, user, password) {
    if (user.app_metadata.phone_only) {
      const client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,options);
      const sent=await client.auth.signInWithOtp({phone:`+${user.phone.replace(/^\+/, '')}`,options:{shouldCreateUser:false}});
      if(sent.error){await update(invite.id,{whatsapp_status:'failed'});throw error(503,'تم حفظ الحساب وتعذر طلب رمز واتساب أعد الإرسال من قائمة الحسابات');}
      await update(invite.id,{whatsapp_status:'pending'});
      return {invitation:{id:invite.id,user_id:user.id,whatsapp_status:'pending',expires_at:new Date(Date.now()+300000).toISOString()}};
    }
    const role = accountTypeLabels[user.app_metadata.account_type || user.app_metadata.role];
    const text = `مرحبا ${user.user_metadata.display_name}\nتم إنشاء حسابك في صيت بصفتك ${role}\nرقم الجوال\n+${user.phone.replace(/^\+/, "")}\nرمز الدخول المؤقت\n${password}\nرابط تسجيل الدخول\n${env.APP_URL}/login\nأدخل رقم الجوال والرمز مكان كلمة المرور ثم عين كلمة مرور جديدة عند أول دخول\nالرمز صالح لمدة 24 ساعة ويلغى بعد تغيير كلمة المرور\nلا تشارك الرمز مع أي شخص\nكلمة المرور الجديدة لا تقل عن 8 خانات وتحتوي على حرف إنجليزي كبير ورقم ورمز مثل _ أو @`;
    const tasks = [];
    if (user.email && !user.app_metadata.phone_only && invite.email_status !== "sent")
      tasks.push(
        (async () => {
          const r = await sendChannel(
            "https://api.resend.com/emails",
            {
              from: `Seet <${env.SMTP_FROM_EMAIL}>`,
              to: [user.email],
              subject: "بيانات حسابك في صيت",
              text,
            },
            {
              Authorization: `Bearer ${env.RESEND_API_KEY}`,
              "Idempotency-Key": `invite-${invite.id}-${invite.generation}`,
            },
          );
          await update(invite.id, { email_status: r.status, email_id: r.id });
          return r;
        })(),
      );
    if (invite.whatsapp_status !== "sent")
      tasks.push(
        (async () => {
          const r = await sendChannel(
            `${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/sendMessage/${env.GREEN_API_TOKEN}`,
            {
              chatId: `${user.phone.replace(/^\+/, "")}@c.us`,
              message: text,
              linkPreview: false,
            },
            {},
          );
          await update(invite.id, {
            whatsapp_status: r.status,
            whatsapp_id: r.id,
          });
          return r;
        })(),
      );
    await Promise.all(tasks);
    const result = must(
      await admin
        .from("account_invitations")
        .select("id,user_id,email_status,whatsapp_status,expires_at")
        .eq("id", invite.id)
        .single(),
    );
    return { invitation: result };
  }
  async function create(input, user) {
    owner(user);
    if (!uuid.test(input.requestId || ""))
      throw error(400, "أعد فتح نموذج الإضافة");
    const parsed = validateNewAccount(input);
    if (parsed.error) throw error(400, parsed.error);
    const value = parsed.value;
    if (value.role !== 'client') ready(value.phone_only);
    value.permissions.sort();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
    must(
      await admin
        .from("account_invitations")
        .upsert(
          {
            id: input.requestId,
            actor: user.id,
            fingerprint,
            email: value.email,
            phone: value.phone,
          },
          { onConflict: "id", ignoreDuplicates: true },
        ),
    );
    let invite = await lock(input.requestId);
    try {
      if (invite.actor !== user.id || invite.fingerprint !== fingerprint)
        throw error(409, "هذا الطلب مرتبط ببيانات مختلفة");
      let target;
      if (invite.user_id)
        target = must(await admin.auth.admin.getUserById(invite.user_id)).user;
      else {
        const recovered = must(
          await admin.rpc("platform_find_invite_user", { p_id: invite.id }),
        );
        if (recovered) {
          target = must(await admin.auth.admin.getUserById(recovered)).user;
          await update(invite.id, { user_id: target.id });
        } else {
          const password = temporaryPassword();
          invite.password_cipher = value.role === 'client' ? null : encryptPassword(password, encryption);
          invite.expires_at = new Date(Date.now() + 86400000).toISOString();
          await update(invite.id, {
            password_cipher: invite.password_cipher,
            expires_at: invite.expires_at,
          });
          const result = await admin.auth.admin.createUser({
            ...(value.email ? {email:value.email,email_confirm:true} : {}),
            phone: value.phone,
            password,
            ...(value.role === 'client' ? {ban_duration:'876000h'} : {}),
            phone_confirm: true,
            user_metadata: { display_name: value.name },
            app_metadata: {
              role: ['collaborator','supervisor'].includes(value.role) ? 'employee' : value.role,
              account_type: value.role,
              phone_only: value.phone_only,
              job_title: value.jobTitle || (['collaborator','supervisor'].includes(value.role) ? accountTypeLabels[value.role] : ''),
              permissions: value.permissions,
              must_change_password: value.role !== 'client',
              ...(value.role === 'client' ? {no_portal:true} : {}),
              temporary_password_expires_at: invite.expires_at,
              onboarding_request: invite.id,
            },
          });
          if (result.error)
            throw error(
              result.error.code?.includes("exists") ? 409 : 400,
              result.error.code?.includes("exists")
                ? "البريد أو الجوال مرتبط بحساب موجود"
                : "تعذر إنشاء الحساب تحقق من بيانات الحساب ورقم الجوال",
            );
          target = result.data.user;
          await update(invite.id, { user_id: target.id });
          must(
            await admin.rpc("platform_server_audit", {
              p_actor: user.id,
              p_target: target.id,
              p_action: "account_created",
            }),
          );
        }
      }
      must(
        await admin
          .from("account_profiles")
          .upsert({
            user_id: target.id,
            display_name: value.name,
            phone: value.phone,
            contact_name: value.contactName,
            updated_by: user.id,
          }),
      );
      if (value.role === 'client') return {invitation:{id:invite.id,user_id:target.id,completed:true,record_only:true}};
      if (!target.app_metadata.must_change_password)
        return {
          invitation: { id: invite.id, user_id: target.id, completed: true },
        };
      if (Date.parse(invite.expires_at) < Date.now())
        throw error(
          409,
          "انتهت صلاحية بيانات الدخول أصدر كلمة مؤقتة جديدة من الحسابات",
        );
      return await deliver(
        invite,
        target,
        decryptPassword(invite.password_cipher, encryption),
      );
    } finally {
      await update(invite.id, { locked_until: null });
    }
  }
  async function resend(input, user) {
    owner(user);
    if (!uuid.test(input.invitationId || ""))
      throw error(400, "الحساب غير صالح");
    let invite = await lock(input.invitationId);
    try {
      if (!invite.user_id) throw error(409, "أكمل إنشاء الحساب أولا");
      let target = must(
        await admin.auth.admin.getUserById(invite.user_id),
      ).user;
      ready(!target.email || target.app_metadata.phone_only);
      if (target.app_metadata?.role === 'client') throw error(403, 'العميل سجل مرجعي دون بيانات دخول');
      if (!target.app_metadata.must_change_password)
        throw error(409, "صاحب الحساب عين كلمة مروره بالفعل");
      if (input.rotate || Date.parse(invite.expires_at) < Date.now()) {
        const password = temporaryPassword();
        invite = {
          ...invite,
          password_cipher: encryptPassword(password, encryption),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          generation: invite.generation + 1,
          email_status: "pending",
          whatsapp_status: "pending",
        };
        target = must(
          await admin.auth.admin.updateUserById(target.id, {
            password,
            app_metadata: {
              temporary_password_expires_at: invite.expires_at,
            },
          }),
        ).user;
        await update(invite.id, {
          password_cipher: invite.password_cipher,
          expires_at: invite.expires_at,
          generation: invite.generation,
          email_status: "pending",
          whatsapp_status: "pending",
        });
      }
      const result = await deliver(
        invite,
        target,
        decryptPassword(invite.password_cipher, encryption),
      );
      must(
        await admin.rpc("platform_server_audit", {
          p_actor: user.id,
          p_target: target.id,
          p_action: "invitation_resent",
        }),
      );
      return result;
    } finally {
      await update(invite.id, { locked_until: null });
    }
  }
  async function updateEmployee(input, user) {
    owner(user);
    if (user.is_anonymous || Date.parse(user.banned_until || "") > Date.now())
      throw error(403, "هذه العملية متاحة للسوبر أدمن فقط");
    if (!uuid.test(input.userId || ""))
      throw error(400, "حساب الموظف غير صالح");
    const parsed = validateEmployeeUpdate(input);
    if (parsed.error) throw error(400, parsed.error);
    const targetResult = await admin.auth.admin.getUserById(input.userId);
    if (targetResult.error || !targetResult.data.user)
      throw error(404, "لم يتم العثور على حساب الموظف");
    const target = targetResult.data.user;
    if (target.app_metadata?.role !== "employee" || target.is_anonymous)
      throw error(403, "يمكن تعديل بيانات حسابات الموظفين فقط");

    const value = parsed.value;
    // Auth applies these fields in one transaction The deferred database guard
    // validates this server-issued receipt then synchronizes the profile and audit
    const result = await admin.auth.admin.updateUserById(target.id, {
      ...(value.email ? {email:value.email} : {}),
      phone: value.phone,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { display_name: value.name },
      app_metadata: {
        job_title: value.jobTitle,
        employee_profile_edit: {
          actor_id: user.id,
          request_id: randomUUID(),
          ...(value.workProfile ? { work_profile: value.workProfile } : {}),
        },
      },
    });
    if (result.error) {
      const duplicate = ["email_exists", "phone_exists", "user_already_exists"].includes(result.error.code);
      throw error(
        duplicate ? 409 : 400,
        duplicate
          ? "البريد أو الجوال مرتبط بحساب موجود"
          : "تعذر حفظ بيانات الموظف أغلق النافذة وافتحها لتحديث إعداداته ثم تحقق من البيانات وحاول مجددا",
      );
    }
    return { success: true };
  }
  async function changePassword(input, user, token) {
    // identity() validated this exact access token with Auth before these claims are read.
    let verifiedByOtp=false;
    try {verifiedByOtp=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).amr?.some(item=>item.method==='otp')===true;} catch {}
    const issue = passwordIssue(
      String(input.password || ""),
      String(input.confirmation || ""),
    );
    if (issue) throw error(400, issue);
    let invite;
    if (user.app_metadata.must_change_password) {
      const row = must(
        await admin
          .from("account_invitations")
          .select("id")
          .eq("user_id", user.id)
          .single(),
      );
      invite = await lock(row.id);
    }
    try {
      if (invite) {
        if (Date.parse(invite.expires_at) < Date.now() && !verifiedByOtp)
          throw error(
            403,
            "انتهت صلاحية كلمة المرور المؤقتة اطلب من مسؤول المنصة إرسال كلمة جديدة",
          );
        if (
          input.password === decryptPassword(invite.password_cipher, encryption)
        )
          throw error(400, "اختر كلمة مرور مختلفة عن الكلمة المؤقتة");
      }
      const result = await admin.auth.admin.updateUserById(user.id, {
        password: input.password,
        app_metadata: {
          must_change_password: false,
          temporary_password_expires_at: null,
        },
      });
      if (result.error)
        throw error(400, "تعذر تحديث كلمة المرور اختر كلمة مختلفة وحاول مجددا");
      if (invite) {
        await update(invite.id, {
          password_cipher: null,
          completed_at: new Date().toISOString(),
        });
        must(
          await admin.rpc("platform_server_audit", {
            p_actor: user.id,
            p_target: user.id,
            p_action: "first_password_changed",
          }),
        );
      }
      await admin.auth.admin.signOut(token, "global");
      const client = createClient(
        env.VITE_SUPABASE_URL,
        env.VITE_SUPABASE_PUBLISHABLE_KEY,
        options,
      );
      const signed = must(
        await client.auth.signInWithPassword({
          ...(result.data.user.email ? {email:result.data.user.email} : {phone:result.data.user.phone}),
          password: input.password,
        }),
      );
      return { success: true, session: signed.session };
    } finally {
      if (invite) await update(invite.id, { locked_until: null });
    }
  }
  async function phoneLogin(input, ip) {
    const phone = normalizePhone(input.identifier);
    const password = String(input.password || "");
    const hash = (value) =>
      createHmac("sha256", encryption).update(value).digest("hex");
    const checks = await Promise.all([
      admin.rpc("platform_login_limit", { p_key: hash("ip:" + ip), p_max: 30 }),
      admin.rpc("platform_login_limit", {
        p_key: hash("phone:" + (phone || "invalid")),
        p_max: 8,
      }),
    ]);
    if (checks.some((r) => !must(r)))
      throw error(429, "محاولات كثيرة انتظر خمس دقائق ثم حاول مجددا");
    const email = phone
      ? must(await admin.rpc("platform_phone_email", { p_phone: phone }))
      : null;
    const client = createClient(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
      options,
    );
    const result = await client.auth.signInWithPassword({
      ...(email ? {email} : {phone:phone || '+10000000000'}),
      password: password.slice(0, 128),
    });
    if (!phone || result.error)
      throw error(401, "البريد الإلكتروني أو الجوال أو كلمة المرور غير صحيحة");
    return { session: result.data.session };
  }
  return async (input, token, ip = "local") => {
    if (input.action === "phone-login") return phoneLogin(input, ip);
    const user = await identity(token);
    if (input.action === 'account-lifecycle') return lifecycle(input,user,token);
    if (["client-phone-start","client-phone-verify","update-client-email"].includes(input.action))
      return clientAccount(input,user,token);
    if (input.action === "create") return create(input, user);
    if (input.action === "resend") return resend(input, user);
    if (input.action === "update-employee") return updateEmployee(input, user);
    if (input.action === "change-password")
      return changePassword(input, user, token);
    throw error(400, "طلب غير معروف");
  };
}
