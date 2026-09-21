import { createClient } from "@supabase/supabase-js";
import { normalizePhone } from "./account-rules";
import { impersonationFetch, hasImpersonation, delegatedAccountRequest } from './impersonation';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const authConfigured = Boolean(
  url && key?.startsWith("sb_publishable_"),
);

// Supabase broadcasts events by storageKey even with sessionStorage
// Isolate tabs so a recovery link cannot replace another tab's account
let tabId = window.sessionStorage.getItem("seet-auth-tab");
if (!tabId) {
  tabId = window.crypto.randomUUID();
  window.sessionStorage.setItem("seet-auth-tab", tabId);
}

// Remembered sessions share device storage while recovery remains per-tab
// Only Auth session tokens are stored here and never account passwords
const recoveryTab =
  window.location.pathname === "/reset-password" ||
  /(?:^|[&#])type=recovery(?:&|$)/.test(window.location.hash);
const remembered =
  !recoveryTab && window.localStorage.getItem("seet-remember") === "true";
export const supabase = authConfigured
  ? createClient(url, key, {
      global: { fetch: impersonationFetch },
      auth: {
        storage: remembered ? window.localStorage : window.sessionStorage,
        storageKey: remembered
          ? "seet-auth-device"
          : `seet-auth-${tabId}`,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    })
  : null;

export async function accountRequest(body, authenticated = true) {
  if (hasImpersonation()) return delegatedAccountRequest(body);
  const token = authenticated
    ? (await supabase.auth.getSession()).data.session?.access_token
    : null;
  const response = await fetch("/api/accounts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(result.error || "تعذر إكمال الطلب"), {
      userFacing: true,
      status: response.status,
    });
  return result;
}
export async function signIn(identifier, password, remember = false) {
  let result;
  if (identifier.includes("@"))
    result = await supabase.auth.signInWithPassword({
      email: identifier.trim(),
      password,
    });
  else {
    const phone = normalizePhone(identifier);
    if (!phone) return { error: { code: "invalid_credentials" } };
    result = await supabase.auth.signInWithPassword({ phone, password });
  }
  return finishSignIn(result, remember);
}

function finishSignIn(result, remember) {
  if (!result.error && remember && !remembered) {
    window.localStorage.setItem("seet-remember", "true");
    window.localStorage.setItem(
      "seet-auth-device",
      JSON.stringify(result.data.session),
    );
    window.location.assign("/login");
  }
  return result;
}

export async function requestPhoneOtp(identifier) {
  const phone = normalizePhone(identifier);
  if (!phone) return { error: { code: 'invalid_phone', userFacing: true, message: 'أدخل رقم جوال صحيحا مع رمز الدولة أو بصيغة 05xxxxxxxx' } };
  return supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } });
}

export async function verifyPhoneOtp(identifier, token, remember = false) {
  const phone = normalizePhone(identifier);
  if (!phone) return { error: { code: 'invalid_phone', userFacing: true, message: 'أدخل رقم جوال صحيحا' } };
  if (!/^\d{6}$/.test(token)) return { error: { code: 'invalid_otp', userFacing: true, message: 'أدخل رمز الدخول المكون من 6 أرقام' } };
  return finishSignIn(await supabase.auth.verifyOtp({ phone, token, type: 'sms' }), remember);
}

export async function sendRecovery(email) {
  return supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: new URL("/reset-password", window.location.origin).href,
  });
}
