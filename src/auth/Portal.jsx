import {accountContact,normalizePhone} from './account-rules';
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpLeft,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  CircleCheck,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Home,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import {
  authConfigured,
  sendRecovery,
  signIn,
  requestPhoneOtp,
  verifyPhoneOtp,
  supabase,
  accountRequest,
} from "./supabase";
import { authMessage, passwordIssue, rolePaths, trustedRole } from "./access";
import { checkAccountAccess, endImpersonation, getImpersonation, hasImpersonation, subscribeImpersonation, refreshImpersonation } from './impersonation';
import { SessionStateProvider, clearSessionState } from '../shared/session-state';
import '../admin/account-access.css';

const Admin=lazy(()=>import('../admin/Admin'));
const Workspace=lazy(()=>import('../admin/Workspace'));

const recoveryKey = "seet-recovery-user";
const accountRoles = { client: 'عميل', employee: 'موظف', admin: 'أدمن', super_admin: 'سوبر أدمن' };
function otpError(error){
  if(error?.userFacing)return error.message;
  if(error?.status===429||['over_sms_send_rate_limit','over_request_rate_limit'].includes(error?.code))return 'طلبات كثيرة خلال وقت قصير انتظر قليلا ثم أعد المحاولة';
  if(['otp_expired','invalid_otp','otp_disabled'].includes(error?.code))return 'الرمز غير صحيح أو انتهت صلاحيته راجعه أو اطلب رمزا جديدا';
  if(error?.code==='invalid_phone')return 'أدخل رقم جوال صحيحا';
  return 'تعذر إكمال الدخول بالرمز تحقق من الرقم والاتصال وحاول لاحقا أو استخدم كلمة المرور';
}
const otpDigits=value=>value.replace(/[٠-٩]/g,char=>String(char.charCodeAt(0)-1632)).replace(/[۰-۹]/g,char=>String(char.charCodeAt(0)-1776)).replace(/\D/g,'').slice(0,6);

function ImpersonationBanner({ acting, busy, message, onExit }) {
  const banner = useRef(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const element = banner.current;
    const layout = element.parentElement;
    const update = () => layout.style.setProperty('--account-session-height', `${element.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { observer.disconnect(); layout.style.removeProperty('--account-session-height'); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((new Date(acting.expires_at).getTime() - now) / 1000));
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const name = acting.user.user_metadata?.display_name || acting.user.user_metadata?.full_name || acting.user.email;
  return <section ref={banner} className="a-account-session" dir="rtl" aria-label="جلسة الدخول بالنيابة">
    <ShieldCheck size={22} aria-hidden="true"/>
    <div className="a-account-session-identity"><strong>أنت داخل الحساب الفعلي <bdi>{name}</bdi></strong><span><bdi>{accountContact(acting.user)}</bdi><span>{accountRoles[trustedRole(acting.user)]}</span><span>تنتهي الجلسة خلال <time dir="ltr">{remaining}</time></span></span>{message&&<p role="alert">{message}</p>}</div>
    <button type="button" className="a-account-session-exit" disabled={busy} onClick={onExit}><LogOut size={18} aria-hidden="true"/>{busy?'جار العودة':'إنهاء الدخول والعودة للسوبر أدمن'}</button>
  </section>;
}
const benefits = [
  [FileText, "متابعة الطلبات", "كل خطوة في مكانها"],
  [FolderOpen, "مراجعة الملفات", "تفاصيل تصنع الفرق"],
  [CircleCheck, "اعتماد التسليم", "من الفكرة إلى الأثر"],
  [MessageSquare, "تواصل مباشر", "أقرب إلى فريقك"],
];

function PasswordField({ id, label, value, onChange, fresh = false }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="p-field">
      <label htmlFor={id}>{label}</label>
      <div className="p-input-wrap">
        <LockKeyhole size={19} aria-hidden="true" />
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          required
          autoComplete={fresh ? "new-password" : "current-password"}
          minLength={fresh ? 8 : undefined}
          maxLength={128}
          aria-describedby={fresh ? "password-help" : undefined}
          dir="ltr"
        />
        <button
          className="p-reveal"
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={`${visible ? "إخفاء" : "إظهار"} ${label}`}
          aria-pressed={visible}
        >
          {visible ? (
            <EyeOff size={20} aria-hidden="true" />
          ) : (
            <Eye size={20} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

function Showcase() {
  return (
    <section className="p-showcase" aria-labelledby="showcase-title">
      <div className="p-showcase-copy">
        <span className="p-eyebrow">مساحة تجمعنا</span>
        <h2 id="showcase-title">
          كل مشروع
          <br />
          <span>في مكان واحد</span>
        </h2>
        <p>
          من أول فكرة إلى التسليم النهائي
          <br />
          رحلة إبداعك أقرب مع صيت
        </p>
      </div>
      <figure className="seet-portal-frame">
        <img src="/brand/official/project-02.webp" width="1172" height="646" alt="من أعمال صيت في تغطية سباق العلا" />
        <figcaption><span>الفكرة تجمعنا</span><strong>والصيت نصنعه معًا</strong></figcaption>
      </figure>
      <div className="p-benefits">
        {benefits.map(([Icon, title, description]) => (
          <div key={title}>
            <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        ))}
      </div>
      <p className="p-showcase-foot">
        أكثر من مجرد وكالة إبداعية <span>نحن شركاء في رحلتك</span>
      </p>
    </section>
  );
}

export default function Portal({ initialPath }) {
  const [path, setPath] = useState(initialPath);
  const tab = 'employee';
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginMode,setLoginMode]=useState('otp');
  const [otpPhone,setOtpPhone]=useState('');
  const [otpCode,setOtpCode]=useState('');
  const [otpSent,setOtpSent]=useState(false);
  const [otpResendAt,setOtpResendAt]=useState(0);
  const [otpCooldown,setOtpCooldown]=useState(0);
  const otpField=useRef(null);
  const [remember, setRemember] = useState(
    localStorage.getItem("seet-remember") === "true",
  );
  const [confirmation, setConfirmation] = useState("");
  const [session, setSession] = useState(undefined);
  const [account, setAccount] = useState(null);
  const [acting, setActing] = useState(getImpersonation);
  const [restoreAccountList, setRestoreAccountList] = useState(false);
  const [actingMessage, setActingMessage] = useState('');
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [checking, setChecking] = useState(authConfigured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [retry, setRetry] = useState(0);
  const [recoveryUser, setRecoveryUser] = useState(() =>
    sessionStorage.getItem(recoveryKey),
  );
  const [cooldown, setCooldown] = useState(0);
  const heading = useRef(null);
  const busyRef = useRef(false);
  const accountRef = useRef(account);
  const authUserRef = useRef(undefined);
  accountRef.current = account;
  const forced = path === "/change-password";
  const reset = path === "/reset-password" || forced;
  const forgot = path === "/forgot-password";
  const dashboard = path.endsWith("/dashboard") || path === "/admin/workspace";
  const effectiveAccount = account?.role === 'super_admin' && acting
    ? { user: acting.user, role: trustedRole(acting.user) }
    : account;

  useEffect(() => {
    let previous = getImpersonation()?.id;
    return subscribeImpersonation(() => {
      const next = getImpersonation();
      if (previous && !next) setRestoreAccountList(true);
      if (next) setRestoreAccountList(false);
      previous = next?.id;
      setActing(next);
      setActingMessage('');
    });
  }, []);

  useEffect(() => {
    if (!acting || account?.role !== 'super_admin') return;
    const refresh = () => refreshImpersonation().catch(() => setActingMessage('تعذر تحديث حالة الجلسة تحقق من اتصالك'));
    const interval = setInterval(refresh, 60000);
    const expiry = setTimeout(() => { endImpersonation().catch(() => setActingMessage('انتهت الجلسة وتعذر تأكيد إنهائها على الخادم')); }, Math.max(0, new Date(acting.expires_at).getTime() - Date.now()));
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      clearTimeout(expiry);
      window.removeEventListener('focus', refresh);
    };
  }, [acting?.id, acting?.expires_at, account?.role]);

  useEffect(() => {
    if (!account || !session?.access_token) return;
    let active = true;
    let checkingAccess = false;
    const verify = async () => {
      if (checkingAccess) return;
      checkingAccess = true;
      try {
        const access = await checkAccountAccess(session.access_token);
        if (access.user_id !== account.user.id || (access.role || null) !== (account.user.app_metadata?.role || null)) {
          throw Object.assign(new Error('تغيرت صلاحية الحساب أعد التحقق للمتابعة'), { userFacing: true, status: 403 });
        }
      } catch (failure) {
        if (!active) return;
        setAccount(null);
        setChecking(false);
        setAccessBlocked([401,403].includes(failure.status));
        setError(authMessage(failure));
      } finally { checkingAccess = false; }
    };
    const interval = setInterval(verify, 30000);
    window.addEventListener('focus', verify);
    return () => { active = false; clearInterval(interval); window.removeEventListener('focus', verify); };
  }, [account?.user.id, account?.role, session?.access_token]);

  function navigate(next, replace = false) {
    window.history[replace ? "replaceState" : "pushState"]({}, "", next);
    setPath(next);
    setPassword("");
    setConfirmation("");
    setError("");
    setSuccess("");
    setOtpCode('');
    setOtpSent(false);
  }
  function changeLoginMode(mode){if(busyRef.current)return;setLoginMode(mode);setOtpCode('');setOtpSent(false);setPassword('');setError('');setSuccess('');}

  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname);
      setError("");
      setSuccess("");
      setPassword("");
      setConfirmation("");
      setOtpCode('');
      setOtpSent(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let authEventSeen = false;
    const receiveSession = (next, event) => {
      const nextUser = next?.user.id || null;
      if (event === 'SIGNED_OUT' || (authUserRef.current && authUserRef.current !== nextUser)) {
        clearSessionState();
        accountRef.current = null;
        setAccount(null);
      }
      authUserRef.current = nextUser;
      setSession(next);
    };
    setChecking(true);
    const deadline = setTimeout(() => {
      if (!active || authEventSeen) return;
      setChecking(false);
      setError("تعذر التحقق من الحساب تحقق من اتصالك وأعد المحاولة");
    }, 12000);
    // Bootstrap explicitly even when the provider initialized Auth before this route mounted
    supabase.auth.getSession().then(({ data, error: failure }) => {
      if (!active || authEventSeen) return;
      clearTimeout(deadline);
      if (failure) {
        setChecking(false);
        setError(authMessage(failure));
      } else receiveSession(data.session);
    }).catch(() => {
      if (!active || authEventSeen) return;
      clearTimeout(deadline);
      setChecking(false);
      setError("تعذر التحقق من الحساب تحقق من اتصالك وأعد المحاولة");
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      authEventSeen = true;
      clearTimeout(deadline);
      if (event === "PASSWORD_RECOVERY") {
        sessionStorage.setItem(recoveryKey, next.user.id);
        setRecoveryUser(next.user.id);
        window.history.replaceState({}, "", "/reset-password");
        setPath("/reset-password");
      }
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        (next &&
          sessionStorage.getItem(recoveryKey) &&
          sessionStorage.getItem(recoveryKey) !== next.user.id)
      ) {
        sessionStorage.removeItem(recoveryKey);
        setRecoveryUser(null);
        if (event === "SIGNED_OUT") setAccount(null);
      }
      receiveSession(next, event);
    });
    return () => {
      active = false;
      clearTimeout(deadline);
      subscription.unsubscribe();
    };
  }, [retry]);

  useEffect(() => {
    if (session === undefined || !supabase) return;
    if (!session) {
      if (hasImpersonation()) void endImpersonation().catch(() => {});
      setAccount(null);
      setAccessBlocked(false);
      setChecking(false);
      return;
    }
    let active = true;
    const sameAccount = accountRef.current?.user.id === session.user.id &&
      accountRef.current?.role === trustedRole(session.user);
    const deadline = setTimeout(() => {
      if (!active) return;
      active = false;
      setAccount(null);
      setChecking(false);
      setError("تعذر التحقق من الحساب تحقق من اتصالك وأعد المحاولة");
    }, 12000);
    if (!sameAccount) {
      setChecking(true);
      setAccount(null);
    }
    setAccessBlocked(false);
    // Keep asynchronous SDK calls outside onAuthStateChange
    supabase.auth
      .getUser(session.access_token)
      .then(async ({ data, error: userError }) => {
        if (!active) return;
        if (userError) throw userError;
        else {
          const role = trustedRole(data.user);
          if (!role) throw Object.assign(new Error('هذه المساحة مخصصة لفريق صيت'),{status:403,userFacing:true});
          const access = await checkAccountAccess(session.access_token);
          if (access.user_id !== data.user.id || (access.role || null) !== (data.user.app_metadata?.role || null)) {
            throw Object.assign(new Error('تغيرت صلاحية الحساب أعد التحقق للمتابعة'), { userFacing: true, status: 403 });
          }
          if (!active) return;
          if (role === 'super_admin' && !data.user.app_metadata?.must_change_password) await refreshImpersonation();
          else if (hasImpersonation()) await endImpersonation();
          if (!active) return;
          setAccount({ user: data.user, role });
          setError('');
        }
        clearTimeout(deadline);
        setChecking(false);
      })
      .catch((failure) => {
        if (active) {
          clearTimeout(deadline);
          setAccount(null);
          setAccessBlocked([401,403].includes(failure.status));
          setError(authMessage(failure));
          setChecking(false);
        }
      });
    return () => {
      active = false;
      clearTimeout(deadline);
    };
  }, [session, retry]);

  useEffect(() => {
    if (checking || session === undefined) return;
    if (acting && account?.role === 'super_admin' && effectiveAccount?.role) {
      const destination = rolePaths[effectiveAccount.role];
      if (path !== destination) navigate(destination, true);
      return;
    }
    if (reset) return;
    if (account?.user.app_metadata?.must_change_password) {
      navigate("/change-password", true);
      return;
    }
    if (dashboard && !session) navigate("/login", true);
    else if (
      effectiveAccount?.role &&
      !recoveryUser &&
      (dashboard || path === "/login")
    ) {
      const destination = rolePaths[effectiveAccount.role];
      if (path !== destination) navigate(destination, true);
    }
  }, [account, effectiveAccount?.role, acting?.id, checking, path, session, recoveryUser, reset, dashboard]);

  useEffect(() => {
    document.title = `${reset ? "استعادة كلمة المرور" : forgot ? "نسيت كلمة المرور" : dashboard ? "لوحة التحكم" : "تسجيل الدخول"} | صيت`;
    heading.current?.focus();
  }, [path, reset, forgot, dashboard]);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(()=>{const remaining=()=>Math.max(0,Math.ceil((otpResendAt-Date.now())/1000));setOtpCooldown(remaining());if(!remaining())return;const timer=setInterval(()=>{const seconds=remaining();setOtpCooldown(seconds);if(!seconds)clearInterval(timer);},1000);return ()=>clearInterval(timer);},[otpResendAt]);
  useEffect(()=>{if(otpSent&&!busy)otpField.current?.focus();},[otpSent,busy]);

  async function sendOtp(){
    if(busyRef.current||!supabase||otpResendAt>Date.now())return;
    const phone=normalizePhone(otpPhone);if(!phone){setError('أدخل رقم جوال صحيحا مع رمز الدولة أو بصيغة 05xxxxxxxx');return;}
    setError('');setSuccess('');setOtpCode('');setOtpResendAt(Date.now()+60000);busyRef.current=true;setBusy(true);
    try{const {error:sendError}=await requestPhoneOtp(phone);if(sendError)throw sendError;setOtpPhone(phone);setOtpSent(true);setOtpResendAt(Date.now()+60000);setSuccess('تم طلب إرسال الرمز عبر واتساب إلى رقم الجوال أدخل الرمز عند وصوله');}
    catch(failure){setError(otpError(failure));if(failure?.status===429)setOtpResendAt(Date.now()+60000);}
    finally{busyRef.current=false;setBusy(false);}
  }

  async function submit(event) {
    event.preventDefault();
    if (busyRef.current || !supabase) return;
    if(!forgot&&!reset&&loginMode==='otp'&&!otpSent){await sendOtp();return;}
    setError("");
    setSuccess("");
    if (reset) {
      const issue = passwordIssue(password, confirmation);
      if (issue) {
        setError(issue);
        return;
      }
      if (!session || (!forced && recoveryUser !== session.user.id)) {
        setError("رابط الاستعادة غير صالح اطلب رابطا جديدا");
        return;
      }
    }
    busyRef.current = true;
    setBusy(true);
    try {
      if (forgot) {
        if (cooldown) return;
        const { error: requestError } = await sendRecovery(email);
        if (requestError) throw requestError;
        setSuccess(
          "إذا كان البريد مرتبطا بحساب فستصلك رسالة تحتوي على رابط استعادة كلمة المرور تحقق من الوارد والبريد غير المرغوب فيه",
        );
        setCooldown(60);
      } else if (reset) {
        const changed = await accountRequest({
          action: "change-password",
          password,
          confirmation,
        });
        const restored = await supabase.auth.setSession(changed.session);
        if (restored.error) throw restored.error;
        if (forced) {
          const { data } = restored;
          setAccount({ user: data.user, role: trustedRole(data.user) });
          setPassword("");
          setConfirmation("");
          navigate(rolePaths[trustedRole(data.user)] || "/login", true);
          return;
        }
        const { error: logoutError } = await supabase.auth.signOut({
          scope: "local",
        });
        sessionStorage.removeItem(recoveryKey);
        setRecoveryUser(null);
        setPassword("");
        setConfirmation("");
        setSuccess(
          "تم تحديث كلمة المرور بنجاح يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة",
        );
        if (logoutError)
          setError(
            "تم تحديث كلمة المرور لكن تعذر إنهاء الجلسة أعد محاولة تسجيل الخروج",
          );
      } else if(loginMode==='otp') {
        const {error:otpFailure}=await verifyPhoneOtp(otpPhone,otpCode,remember);
        if(otpFailure)throw otpFailure;
        setOtpCode('');
      } else {
        const { error: loginError } = await signIn(email, password, remember);
        if (loginError) throw loginError;
        setPassword("");
      }
    } catch (failure) {
      setError(!forgot&&!reset&&loginMode==='otp'?otpError(failure):authMessage(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function logout() {
    if (busyRef.current || !supabase) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (hasImpersonation()) await endImpersonation().catch(() => {});
      const { error: logoutError } = await supabase.auth.signOut({
        scope: "local",
      });
      if (logoutError) throw logoutError;
      localStorage.removeItem("seet-remember");
      localStorage.removeItem("seet-auth-device");
      navigate("/login", true);
    } catch (failure) {
      setError(authMessage(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function exitActing() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActingMessage('');
    try {
      await endImpersonation();
      setRestoreAccountList(true);
      navigate(rolePaths.super_admin, true);
    } catch (failure) {
      setActingMessage(authMessage(failure));
    } finally {
      if (!account) {
        setAccessBlocked(false);
        setRetry(value => value + 1);
      }
      busyRef.current = false;
      setBusy(false);
    }
  }

  const canReset =
    reset && session && (forced || recoveryUser === session.user.id);
  const canDashboard =
    dashboard &&
    effectiveAccount?.role &&
    path === rolePaths[effectiveAccount.role] &&
    !recoveryUser &&
    !account.user.app_metadata?.must_change_password &&
    !effectiveAccount.user.app_metadata?.must_change_password;
  const title = reset
    ? "كلمة مرور جديدة"
    : forgot
      ? "نسيت كلمة المرور"
      : "مرحبا بك في مساحتك";

  if (accessBlocked && !checking)
    return <main className="a-loading" dir="rtl"><section className="a-access-blocked" aria-labelledby="access-blocked-title"><ShieldCheck size={32} aria-hidden="true"/><h1 id="access-blocked-title">تعذر فتح الحساب</h1><p role="alert">{error || 'الحساب غير متاح للدخول تواصل مع مسؤول المنصة'}</p><div><button type="button" className="a-primary" disabled={busy} onClick={()=>{setError('');setRetry(value=>value+1);}}>إعادة التحقق</button>{hasImpersonation()&&<button type="button" disabled={busy} onClick={exitActing}>إنهاء الدخول بالنيابة</button>}<button type="button" disabled={busy} onClick={logout}>تسجيل الخروج</button></div></section></main>;

  if (canDashboard && !checking)
    return <div className={acting?'a-account-session-layout':undefined}>
      {acting&&account.role==='super_admin'&&<ImpersonationBanner acting={acting} busy={busy} message={actingMessage} onExit={exitActing}/>}
      <SessionStateProvider key={`${account.user.id}:${acting?.id||'own'}:${effectiveAccount.user.id}:${effectiveAccount.role}`} scope={`${account.user.id}:${acting?.id||'own'}:${effectiveAccount.user.id}:${effectiveAccount.role}`}>
      <Suspense fallback={<main className="a-loading" dir="rtl" role="status"><div><LoaderCircle className="p-spinner" aria-hidden="true"/>جار تجهيز مساحة العمل</div></main>}>
        {["super_admin", "admin"].includes(effectiveAccount.role)
          ? <Admin account={effectiveAccount} onLogout={acting?exitActing:logout} initialTab={restoreAccountList&&!acting?'users':'overview'}/>
          : <Workspace user={effectiveAccount.user} role={effectiveAccount.role} onLogout={acting?exitActing:logout}/>}
      </Suspense>
      </SessionStateProvider>
    </div>;

  if (dashboard && (checking || session === undefined || error))
    return (
      <main className="a-loading" dir="rtl" aria-busy={checking}>
        {checking ? (
          <div role="status"><LoaderCircle className="p-spinner" aria-hidden="true" /> جار فتح لوحة التحكم</div>
        ) : (
          <div role="alert">
            <p>{error || "تعذر فتح لوحة التحكم أعد المحاولة"}</p>
            <button className="p-primary" onClick={() => { setError(""); setRetry((value) => value + 1); }}>إعادة المحاولة</button>
            {hasImpersonation()&&<button type="button" className="p-secondary" disabled={busy} onClick={exitActing}>إنهاء الدخول بالنيابة والعودة لحسابي</button>}
            <a className="p-secondary" href="/">العودة إلى الرئيسية</a>
          </div>
        )}
      </main>
    );

  return (
    <div className="s-site p-site" dir="rtl">
      <a href="#portal-main" className="s-skip">
        انتقل إلى المحتوى
      </a>
      <header className="p-header">
        <a href="/" className="p-header-logo" aria-label="صيت الرئيسية">
          <img src="/brand/seet-logo-light.svg" alt="صيت" />
        </a>
        <nav aria-label="القائمة الرئيسية">
          <a href="/#work">أعمالنا</a>
          <a href="/#about">من نحن</a>
          <a href="/#services">خدماتنا</a>
          <a href="/#contact">تواصل معنا</a>
        </nav>
        <span className="p-header-note">
          إبداع يصنع الأثر <span aria-hidden="true">✳</span>
        </span>
      </header>
      <main
        id="portal-main"
        className={canDashboard ? "p-dashboard-layout" : "p-layout"}
      >
        {canDashboard && !checking ? (
          <section className="p-dashboard">
            <div className="p-dashboard-top">
              <span className="p-eyebrow">
                <ShieldCheck size={17} aria-hidden="true" />{" "}
                {account.role === "client" ? "مساحة العميل" : "مساحة الفريق"}
              </span>
              <button
                className="p-text-button"
                onClick={logout}
                disabled={busy}
              >
                <LogOut size={18} aria-hidden="true" /> تسجيل الخروج
              </button>
            </div>
            <h1 ref={heading} tabIndex={-1}>
              {account.role === "client"
                ? "لوحة تحكم العميل"
                : "لوحة تحكم الموظف"}
            </h1>
            <p>
              أهلا بك في صيت{" "}
              <span dir="ltr" className="p-account-email">
                {accountContact(account.user)}
              </span>
            </p>
            {error && (
              <p className="p-message p-error" role="alert">
                {error}
              </p>
            )}
            <div className="p-account-strip">
              <ShieldCheck aria-hidden="true" />
              <div>
                <strong>حسابك متصل بأمان</strong>
                <p>
                  {account.role === "client"
                    ? "تم التحقق من صلاحية حساب العميل"
                    : "تم التحقق من صلاحية حساب الموظف"}
                </p>
              </div>
              <CheckCheck aria-hidden="true" />
            </div>
            <section className="p-dashboard-empty">
              <FolderOpen size={46} strokeWidth={1.2} aria-hidden="true" />
              <h2>
                {account.role === "client"
                  ? "هنا تبدأ رحلة مشاريعك"
                  : "مساحتك للعمل والإبداع"}
              </h2>
              <p>
                تم تجهيز بوابتك للدخول
                <br />
                ستتوفر تفاصيل المشاريع بعد تفعيل مساحة العمل
              </p>
              <a className="p-primary" href="/#contact">
                تواصل مع صيت <ArrowLeft size={20} aria-hidden="true" />
              </a>
            </section>
            <div className="p-dashboard-links">
              <button
                className="p-text-button"
                onClick={() => navigate("/forgot-password")}
              >
                <KeyRound size={18} aria-hidden="true" /> تغيير كلمة المرور عبر
                البريد
              </button>
              <a href="/">العودة إلى الموقع الرئيسي</a>
            </div>
          </section>
        ) : (
          <>
            <section className="p-panel" aria-labelledby="portal-title">
              <div className="p-panel-brand">
                <span>مرحبا بك في</span>
                <a href="/" aria-label="صيت الرئيسية">
                  <img src="/brand/seet-logo-light.svg" alt="صيت" />
                </a>
              </div>

              <div className="p-panel-heading">
                {(forgot || reset) && (
                  <span className="p-security-icon">
                    <KeyRound size={24} aria-hidden="true" />
                  </span>
                )}
                <h1 id="portal-title" ref={heading} tabIndex={-1}>
                  {title}
                </h1>
                <p>
                  {forced
                    ? "يلزم تغيير كلمة المرور المؤقتة قبل متابعة حسابك"
                    : reset
                      ? "خطوة جديدة نحو حساب أكثر أمانا"
                      : forgot
                        ? "أدخل بريد حسابك وسنرسل لك رابط استعادة كلمة المرور"
                        : tab === "client"
                          ? "تابع رحلة مشاريعك وكن أقرب إلى كل تفاصيلها"
                          : "مساحتك للإبداع تبدأ هنا أهلا بفريق صيت"}
                </p>
              </div>
              {!authConfigured && (
                <p className="p-message p-error" role="alert">
                  خدمة الدخول غير متاحة حاليا يرجى المحاولة لاحقا
                </p>
              )}
              {error && (
                <p className="p-message p-error" role="alert">
                  {error}
                </p>
              )}
              {success && (
                <p className="p-message p-success" role="status">
                  <Check size={20} aria-hidden="true" />
                  {success}
                </p>
              )}
              {checking ? (
                <div className="p-loading" role="status">
                  <LoaderCircle className="p-spinner" aria-hidden="true" /> جار
                  التحقق من حسابك
                </div>
              ) : reset && success ? (
                <button
                  className="p-primary"
                  onClick={() => navigate("/login")}
                >
                  العودة لتسجيل الدخول{" "}
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
              ) : reset && !canReset ? (
                <div className="p-recovery-invalid">
                  <p>رابط الاستعادة غير صالح أو انتهت صلاحيته</p>
                  <button
                    className="p-primary"
                    onClick={() => navigate("/forgot-password")}
                  >
                    إرسال رابط جديد <Mail size={20} aria-hidden="true" />
                  </button>
                </div>
              ) : session && !forgot && !reset ? (
                <div className="p-session-notice">
                  <p>
                    {recoveryUser
                      ? "أكمل استعادة كلمة المرور للمتابعة"
                      : account && !account.role
                        ? "لم يتم تفعيل دور حسابك بعد يرجى التواصل مع مسؤول المنصة"
                        : "تعذر فتح مساحة حسابك أعد التحقق للمتابعة"}
                  </p>
                  {recoveryUser ? (
                    <button
                      className="p-primary"
                      onClick={() => navigate("/reset-password")}
                    >
                      متابعة استعادة كلمة المرور
                    </button>
                  ) : (
                    <button
                      className="p-secondary"
                      onClick={() => {
                        setError("");
                        setRetry(retry + 1);
                      }}
                    >
                      إعادة التحقق
                    </button>
                  )}
                  <button
                    className="p-text-button"
                    onClick={logout}
                    disabled={busy}
                  >
                    تسجيل الخروج
                  </button>
                </div>
              ) : (
                <form onSubmit={submit} className="p-form" aria-busy={busy}>
                  <fieldset disabled={busy || !authConfigured}>
                    {!forgot&&!reset&&<div className="p-login-methods" role="group" aria-label="طريقة تسجيل الدخول"><button type="button" aria-pressed={loginMode==='otp'} onClick={()=>changeLoginMode('otp')}><MessageSquare size={18} aria-hidden="true"/>رمز واتساب</button><button type="button" aria-pressed={loginMode==='password'} onClick={()=>changeLoginMode('password')}><KeyRound size={18} aria-hidden="true"/>كلمة المرور</button></div>}
                    {!forgot&&!reset&&loginMode==='otp'&&<>
                      <div className="p-field"><label htmlFor="otp-phone">رقم الجوال</label><div className="p-input-wrap"><MessageSquare size={19} aria-hidden="true"/><input id="otp-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="05xxxxxxxx" required value={otpPhone} readOnly={otpSent} onChange={e=>{setOtpPhone(e.target.value);setError('');}} dir="ltr"/></div></div>
                      {otpSent?<><div className="p-field"><label htmlFor="otp-code">رمز الدخول من واتساب</label><div className="p-input-wrap p-otp-input"><ShieldCheck size={19} aria-hidden="true"/><input ref={otpField} id="otp-code" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} pattern="[0-9]{6}" value={otpCode} onChange={e=>setOtpCode(otpDigits(e.target.value))} aria-describedby="otp-help" dir="ltr"/></div><p id="otp-help" className="p-otp-help">رمز من 6 أرقام صالح لمدة 5 دقائق من وقت إرساله</p></div><div className="p-otp-actions"><button type="button" className="p-text-button" disabled={otpCooldown>0} onClick={sendOtp}>{otpCooldown?`إعادة الإرسال بعد ${otpCooldown} ثانية`:'طلب رمز جديد'}</button><button type="button" className="p-text-button" onClick={()=>{setOtpSent(false);setOtpCode('');setError('');setSuccess('');}}>تغيير الرقم</button></div></>:<><p className="p-otp-help">اطلب رمز الدخول عبر واتساب للحساب المرتبط برقمك</p><button type="button" className="p-text-button p-existing-code" onClick={()=>{if(!normalizePhone(otpPhone)){setError('أدخل رقم جوالك أولا ثم أدخل الرمز الذي وصلك');return;}setOtpCode('');setOtpSent(true);setError('');setSuccess('');}}>لدي رمز دخول بالفعل</button></>}
                    </>}
                    {!reset && (forgot||loginMode==='password') && (
                      <div className="p-field">
                        <label htmlFor="email">
                          {forgot
                            ? "البريد الإلكتروني"
                            : "البريد الإلكتروني أو رقم الجوال"}
                        </label>
                        <div className="p-input-wrap">
                          <Mail size={19} aria-hidden="true" />
                          <input
                            id="email"
                            name="email"
                            type={forgot ? "email" : "text"}
                            autoComplete={forgot ? "email" : "username"}
                            placeholder={
                              forgot
                                ? "name@example.com"
                                : "name@example.com أو 05xxxxxxxx"
                            }
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            dir="ltr"
                          />
                        </div>
                      </div>
                    )}
                    {!forgot && (reset||loginMode==='password') && (
                      <PasswordField
                        id="password"
                        label={reset ? "كلمة المرور الجديدة" : "كلمة المرور"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        fresh={reset}
                      />
                    )}
                    {reset && (
                      <>
                        <p id="password-help" className="p-hint">
                          استخدم 8 خانات على الأقل مع حرف إنجليزي كبير ورقم ورمز
                          مميز مثل _ أو @
                        </p>
                        <PasswordField
                          id="confirm-password"
                          label="تأكيد كلمة المرور الجديدة"
                          value={confirmation}
                          onChange={(e) => setConfirmation(e.target.value)}
                          fresh
                        />
                      </>
                    )}
                    {!forgot && !reset && (
                      <div className="p-form-options">
                        <label className="p-remember">
                          <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                          />
                          تذكرني على هذا الجهاز
                        </label>
                        {loginMode==='password'&&<button
                          className="p-text-button"
                          type="button"
                          onClick={() => navigate("/forgot-password")}
                        >
                          نسيت كلمة المرور
                        </button>}
                      </div>
                    )}
                    <button
                      className="p-primary"
                      type="submit"
                      disabled={(forgot&&cooldown>0)||(!forgot&&!reset&&loginMode==='otp'&&(!otpSent?otpCooldown>0:otpCode.length!==6))}
                    >
                      {busy ? (
                        <>
                          <LoaderCircle
                            size={20}
                            className="p-spinner"
                            aria-hidden="true"
                          />{" "}
                          جار تنفيذ الطلب
                        </>
                      ) : (
                        <>
                          {reset
                            ? "حفظ كلمة المرور الجديدة"
                            : forgot
                              ? cooldown
                                ? `إعادة الإرسال بعد ${cooldown} ثانية`
                                : "إرسال رابط الاستعادة"
                              : loginMode==='otp' ? otpSent?'التحقق والدخول':otpCooldown?`طلب رمز جديد بعد ${otpCooldown} ثانية`:'طلب رمز واتساب' : "تسجيل الدخول"}
                          <ArrowLeft size={21} aria-hidden="true" />
                        </>
                      )}
                    </button>
                  </fieldset>
                </form>
              )}
              {(forgot || (reset && !success)) && (
                <button
                  className="p-text-button p-back"
                  onClick={() => (forced ? logout() : navigate("/login"))}
                  disabled={busy}
                >
                  {forced ? "تسجيل الخروج" : "العودة لتسجيل الدخول"}
                </button>
              )}
              <div className="p-divider">
                <span>معك في كل خطوة</span>
              </div>
              <a className="p-secondary" href="/">
                <Home size={18} aria-hidden="true" /> العودة إلى الموقع الرئيسي
              </a>
              <p className="p-panel-foot">
                <LockKeyhole size={13} aria-hidden="true" /> خصوصيتك وأمان حسابك
                أولوية
              </p>
            </section>
            <Showcase />
          </>
        )}
      </main>
      <footer className="p-footer">
        <span>
          صيت <span className="p-footer-dash" aria-hidden="true" /> شركاء
          في صناعة الأثر
        </span>
        <a href="/#contact">تحتاج مساعدة</a>
      </footer>
    </div>
  );
}
