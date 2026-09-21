import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "../auth/supabase";
import { endImpersonation, getEffectiveUser, getImpersonation, hasImpersonation, subscribeImpersonation } from '../auth/impersonation';
import { clearSessionState, getSessionStore } from '../shared/session-state';
import { allowed, publicAccountData } from "../auth/account-rules";
import BrandAtmosphere from '../BrandAtmosphere';
import "./admin.css";

const PlatformContext = createContext(null);
// Only an entirely unconfigured development environment uses the authored defaults
// A configured backend must still load its settings and maintenance state
const localPreview = import.meta.env.DEV
  && !import.meta.env.VITE_SUPABASE_URL
  && !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const previewRecord = localPreview ? { config: {}, version: null } : null;
export const usePlatform = () => useContext(PlatformContext);
export async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return publicAccountData(data);
}
export const platformError = (error) =>
  error?.message?.includes("version_conflict")
    ? "تم تعديل الصفحة من جلسة أخرى أعد تحميل الإعدادات قبل الحفظ"
    : error?.message?.includes("session_expired")
      ? "انتهت جلسة الدخول بالنيابة ارجع إلى حسابك"
      : "تعذر إكمال العملية أعد المحاولة";
export const safeColor = (value) =>
  /^#[0-9a-f]{6}$/i.test(value || "") ? value : undefined;
const readableActionText = (value) => {
  const color = safeColor(value) || "#0d0b0b";
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.223 ? "#171414" : "#f4f2f2";
};
export function safeImage(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    const allowed = new URL(import.meta.env.VITE_SUPABASE_URL).origin;
    return url.origin === allowed &&
      url.pathname.startsWith("/storage/v1/object/public/platform-designs/")
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function PlatformProvider({ children }) {
  const [record, setRecord] = useState(previewRecord),
    [error, setError] = useState(""),
    [user, setUser] = useState(localPreview ? null : undefined);
  const [draft, updateDraft] = useState(null),
    [selection, updateSelection] = useState(null);
  const dirty = useRef(false);
  const draftVersion = useRef(null), recordRef = useRef(null), draftStore = useRef(null), identity = useRef(null);
  const [sessionScope,setSessionScope] = useState(null);
  const [identityError,setIdentityError]=useState(''),[identityRetry,setIdentityRetry]=useState(0);
  recordRef.current=record;
  function setDraft(next) {
    dirty.current = !!next;
    if(next){
      draftVersion.current ??= recordRef.current?.version ?? null;
      if(draftVersion.current!==null)draftStore.current?.set('cms.draft',{config:next,version:draftVersion.current});
    }else{
      draftVersion.current=null;
      draftStore.current?.clear('cms.draft');
    }
    updateDraft(next);
  }
  function setSelection(next){draftStore.current?.set('cms.selection',next);updateSelection(next);}
  function clearVisibleDraft(){dirty.current=false;draftVersion.current=null;updateDraft(null);updateSelection(null);}
  async function refresh() {
    if (localPreview) return previewRecord;
    if (!supabase) throw new Error('platform_settings_unavailable');
    // This exact appearance query is public by RLS  Loading it anonymously
    // keeps home editor and account recovery reachable after delegation ends
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/platform_settings?select=config,version&id=eq.true`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Accept: 'application/vnd.pgrst.object+json' },
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.config || data.version == null) throw new Error('platform_settings_unavailable');
    if (!dirty.current || !recordRef.current) setRecord(data);
    setError("");
    return data;
  }
  useEffect(() => {
    if (!supabase) {
      setUser(null);
      if (!localPreview) setError("تعذر الاتصال بالمنصة");
      return;
    }
    refresh().catch(() => setError("تعذر تحميل إعدادات المنصة"));
    let active = true;
    let identityRevision = 0;
    let authOwnerId;
    const verify = () => {
      const revision = ++identityRevision;
      return getEffectiveUser()
        .then(async ({ data,error:verificationError }) => {
          if(verificationError)throw verificationError;
          const auth=await supabase.auth.getSession();
          if(!active||revision!==identityRevision)return;
          const verified=data.user,acting=getImpersonation();
          const ownerId=auth.data.session?.user.id||null;
          if(verified&&!acting&&verified.id!==ownerId)return;
          if(acting&&acting.user?.id!==verified?.id)return;
          if(authOwnerId!==undefined&&authOwnerId!==ownerId)return;
          authOwnerId=ownerId;setIdentityError('');
          const scope=verified&&auth.data.session?.user.id?`${auth.data.session.user.id}:${acting?.id||'own'}:${verified.id}:${verified.app_metadata?.role||''}`:null;
          const mayEdit=verified&&['content.edit','appearance.edit','maintenance.manage'].some(permission=>allowed(verified,permission));
          if(identity.current!==scope){
            clearVisibleDraft();identity.current=scope;draftStore.current=getSessionStore(scope);setSessionScope(scope);
            const saved=mayEdit?draftStore.current?.get('cms.draft',null):null;
            if(mayEdit)updateSelection(draftStore.current?.get('cms.selection',null)||null);
            if(saved?.config&&typeof saved.config==='object'&&Number.isFinite(saved.version)){
              draftVersion.current=saved.version;dirty.current=true;updateDraft(saved.config);
            }
          }else if(!mayEdit&&dirty.current)clearVisibleDraft();
          setUser(verified);
        })
        .catch(failure => { if (active && revision === identityRevision) {setUser([401,403].includes(failure.status)?null:undefined);setIdentityError('تعذر التحقق من الحساب تحقق من اتصالك وأعد المحاولة');clearVisibleDraft();identity.current=null;draftStore.current=null;setSessionScope(null);} });
    };
    verify();
    let actingId=getImpersonation()?.id||null;
    const stopActing = subscribeImpersonation(() => {
      const nextActingId=getImpersonation()?.id||null;
      if(actingId!==nextActingId){identityRevision++;setUser(undefined);clearVisibleDraft();}
      actingId=nextActingId;
      verify();
      refresh().catch(() => setError('تعذر تحميل إعدادات المنصة'));
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event,next) => {
      const nextOwnerId=next?.user.id||null;
      if(authOwnerId!==undefined&&authOwnerId!==nextOwnerId){identityRevision++;clearSessionState();clearVisibleDraft();identity.current=null;draftStore.current=null;setSessionScope(null);setUser(undefined);}
      authOwnerId=nextOwnerId;
      if(event==='SIGNED_OUT'){clearSessionState();clearVisibleDraft();identity.current=null;draftStore.current=null;setSessionScope(null);setUser(null);}
      setTimeout(verify, 0);
    });
    const timer = setInterval(() => refresh().catch(() => {}), 30000);
    return () => {
      active = false;
      identityRevision++;
      subscription.unsubscribe();
      stopActing();
      clearInterval(timer);
    };
  }, [identityRetry]);
  const config = draft || record?.config || {};
  const can = (permission) => allowed(user, permission);
  const owner =
    user?.app_metadata?.role === "super_admin" &&
    !user?.app_metadata?.must_change_password;
  const editor =
    can("content.edit") && window.location.pathname === "/admin/editor";
  async function save(next = draft) {
    if (localPreview) throw new Error('platform_settings_unavailable');
    if (!record || !next) return;
    const version = await rpc("platform_save", {
      p_config: next,
      p_version: draftVersion.current ?? record.version,
    });
    setRecord({ config: next, version });
    setDraft(null);
    return version;
  }
  const theme = config.theme || {};
  const style = {
    "--s-bg": safeColor(theme.background),
    "--s-deep": safeColor(theme.background),
    "--s-lime": safeColor(theme.accent),
    "--s-white": safeColor(theme.text),
    "--s-panel": safeColor(theme.panel),
    "--s-action-text": readableActionText(safeColor(theme.accent) || "#f28c8c"),
  };
  const publicPage = ![
    "/login",
    "/forgot-password",
    "/reset-password",
    "/change-password",
  ].includes(window.location.pathname);
  // Account validation and delegated-session exit must remain reachable even
  // when a stale delegated session prevents the first settings fetch
  const portalDashboard = ['/client/dashboard','/employee/dashboard','/admin/dashboard','/admin/workspace'].includes(window.location.pathname);
  if (!record && publicPage && !portalDashboard)
    return (
      <div className="a-loading" dir="rtl" role="status">
        <BrandAtmosphere />
        {error || "جار تحميل المنصة"}
        {error && (
          <button onClick={() => refresh().catch(() => {})}>
            إعادة المحاولة
          </button>
        )}
      </div>
    );
  if (config.maintenance && !can("maintenance.manage") && publicPage)
    return (
      <div className="a-maintenance" dir="rtl">
        <BrandAtmosphere />
        <img src="/brand/seet-logo-light.svg" alt="صيت" />
        <h1>{config.maintenanceTitle || "نعود إليك بتجربة أفضل"}</h1>
        <p>{config.maintenanceMessage || "المنصة تحت الصيانة سنعود قريبا"}</p>
        {hasImpersonation() && <button type="button" onClick={() => endImpersonation().catch(() => setError('تم إنهاء الدخول على هذا الجهاز وتعذر تأكيد الإنهاء على الخادم'))}>إنهاء الدخول بالنيابة والعودة لحسابي</button>}
        <a href="/login">دخول الإدارة</a>
      </div>
    );
  if (safeImage(theme.backgroundImage))
    style["--a-background-image"] =
      `url("${safeImage(theme.backgroundImage)}")`;
  return (
    <PlatformContext.Provider
      value={{
        config,
        record,
        refresh,
        draft,
        setDraft,
        save,
        owner,
        user,
        authReady: user !== undefined,
        sessionScope,
        identityError,
        retryIdentity:()=>setIdentityRetry(value=>value+1),
        can,
        editor,
        selection,
        setSelection,
      }}
    >
      <div className="a-platform" style={style}>
        <BrandAtmosphere />
        {children}
      </div>
    </PlatformContext.Provider>
  );
}

// Transform only authored React elements before rendering
// Text remains escaped by React and uploaded assets use a single trusted bucket
export function useCmsTree(scope) {
  const platform = usePlatform();
  return (tree) => {
    if (!platform) return tree;
    const { config, editor, setSelection } = platform;
    function visit(node, path) {
      if (!React.isValidElement(node)) return node;
      const id = `${scope}/${node.props.id || path}`;
      const custom = config.elements?.[id] || {};
      if (custom.hidden && !editor) return null;
      const native = typeof node.type === "string";
      if (!native && node.type !== React.Fragment) return node;
      const raw = React.Children.toArray(node.props.children);
      const textOnly =
        raw.length > 0 &&
        (["h1", "h2", "h3", "p"].includes(node.type) ||
          raw.every(
            (c) =>
              typeof c === "string" ||
              typeof c === "number" ||
              c?.type === "br",
          ));
      const textContent = (child) =>
        typeof child === "string" || typeof child === "number"
          ? String(child)
          : child?.type === "br"
            ? "\n"
            : React.isValidElement(child)
              ? React.Children.toArray(child.props.children)
                  .map(textContent)
                  .join("")
              : "";
      const editable =
        native &&
        (textOnly ||
          ["img", "section", "article"].includes(node.type) ||
          /(?:card|project|grid)/.test(node.props.className || ""));
      const children =
        typeof custom.text === "string" && textOnly
          ? custom.text
          : raw.map((child, i) => visit(child, `${path}/${child?.key || i}`));
      const props = native
        ? {
            "data-cms-id": editable ? id : undefined,
            "data-cms-text": textOnly
              ? raw.map(textContent).join("")
              : undefined,
            "data-cms-hidden": custom.hidden || undefined,
            draggable:
              editor &&
              editable &&
              (["section", "article"].includes(node.type) ||
                /(?:card|s-project$)/.test(node.props.className || ""))
                ? true
                : node.props.draggable,
            style: {
              ...node.props.style,
              display: [1, 2, 3, 4].includes(custom.columns)
                ? "grid"
                : node.props.style?.display,
              color: safeColor(custom.color) || node.props.style?.color,
              backgroundColor:
                safeColor(custom.background) ||
                node.props.style?.backgroundColor,
              order: Number.isFinite(custom.order)
                ? custom.order
                : node.props.style?.order,
              gridTemplateColumns: [1, 2, 3, 4].includes(custom.columns)
                ? `repeat(${custom.columns}, minmax(0, 1fr))`
                : node.props.style?.gridTemplateColumns,
              gap:
                Number.isFinite(custom.gap) &&
                custom.gap >= 0 &&
                custom.gap <= 80
                  ? `${custom.gap}px`
                  : node.props.style?.gap,
            },
          }
        : {};
      if (node.type === "img" && safeImage(custom.image))
        props.src = safeImage(custom.image);
      if (safeImage(custom.design) && node.type !== "img") {
        props.style.backgroundImage = `url("${safeImage(custom.design)}")`;
        props.style.backgroundSize = "cover";
        props.style.backgroundPosition = "center";
        props["data-cms-design"] = true;
        props["aria-label"] =
          node.props["aria-label"] || raw.map(textContent).join("") || "بطاقة";
      }
      if (safeImage(custom.backdrop)) {
        props.style.backgroundImage = `url("${safeImage(custom.backdrop)}")`;
        props.style.backgroundSize = "cover";
        props.style.backgroundPosition = "center";
      }
      if (editor && editable)
        props.onClick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          setSelection({
            id,
            tag: node.type,
            text:
              typeof custom.text === "string"
                ? custom.text
                : props["data-cms-text"],
            label: textOnly
              ? props["data-cms-text"]?.slice(0, 45)
              : node.props.alt ||
                {
                  home: "بداية الصفحة",
                  services: "الخدمات",
                  work: "الأعمال",
                  about: "من نحن",
                  process: "رحلتنا",
                  contact: "التواصل",
                  portals: "البوابات",
                }[node.props.id] ||
                "بطاقة",
          });
        };
      if (
        editor &&
        editable &&
        !["a", "button", "input", "select", "textarea"].includes(node.type)
      ) {
        props.tabIndex = 0;
        props.onKeyDown = (event) => {
          if (event.key === "Enter" || event.key === " ") props.onClick(event);
        };
      }
      return React.cloneElement(
        node,
        props,
        ...(Array.isArray(children) ? children : [children]),
      );
    }
    return visit(tree, "root");
  };
}
