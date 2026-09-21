import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Palette,
  Users,
  UserPlus,
  ShieldCheck,
  Wrench,
  ArrowUpRight,
  Images,
  ListTodo,
  Layers3,
  Gauge,
  BellRing,
  Building2,
  Menu,
  X,
  Search,
} from "lucide-react";
import { supabase } from "../auth/supabase";
import { usePlatform, rpc, platformError, useCmsTree } from "./platform";
import './dashboard-cosmos.css';
import Overview from "./Overview";
import AccountDialog from "./AccountDialog";
import AccountDirectory from "./AccountDirectory";
import { allowed, accountContact } from "../auth/account-rules";
import { accountRequest } from "../auth/supabase";
import Notifications from '../workflow/Notifications';
import ClientEmailDialog from './ClientEmailDialog';
import AccountStatusDialog from './AccountStatusDialog';
import { startImpersonation } from '../auth/impersonation';
import { useSessionState } from '../shared/session-state';
import './account-access.css';
import {missionIdFromDestination} from '../missions/mission-navigation';

const TeamWork=lazy(()=>import('../workflow/TeamWork'));
const MissionWorkspace=lazy(()=>import('../missions/MissionWorkspace'));
const WorksManager=lazy(()=>import('./WorksManager'));
const ServiceCatalog=lazy(()=>import('../workflow/ServiceCatalog'));
const DepartmentManager=lazy(()=>import('../workflow/DepartmentManager'));
const PerformancePanel=lazy(()=>import('../workflow/PerformancePanel'));
const NotificationCenter=lazy(()=>import('../workflow/NotificationCenter'));
const generalTabs = ['overview','work','available','legacy','platform','services','performance','notifications','portfolio'];
const tabPermissions = {
  users: 'users.read',
  departments: 'departments.manage',
  appearance: 'appearance.edit',
  maintenance: 'maintenance.manage',
  audit: 'audit.read',
};

function PanelLoading({page=false}){
  return <section className={page?'a-loading':'a-section a-table-empty'} dir="rtl" role="status" aria-live="polite" aria-busy="true"><strong>جار تحميل مساحة العمل</strong></section>;
}

const roles = {
  client: "عميل",
  employee: "موظف",
  admin: "أدمن",
  super_admin: "سوبر أدمن",
};
const actions = {
  platform_save: "تحديث المنصة",
  role_change: "تعديل الصلاحية",
  impersonation_start: "بدء الدخول بالنيابة",
  impersonation_end: "إنهاء الدخول بالنيابة",
  profile_update: "تحديث بيانات الحساب",
  employee_updated: "تعديل بيانات الموظف",
  client_email_updated: "تعديل بريد العميل",
  client_phone_updated: "اعتماد جوال العميل",
  account_created: "إنشاء حساب",
  invitation_resent: "إعادة إرسال بيانات الدخول",
  first_password_changed: "تعيين كلمة المرور الخاصة",
  permissions_change: "تحديث صلاحيات الأدمن",
  work_service: "إضافة خدمة",
  work_staff: "تحديث إعدادات موظف",
  work_staff_profile: "تحديث أقسام الموظف وارتباطه الوظيفي",
  work_grant: "تحديث صلاحيات خدمة",
  work_notification_retry: "إعادة إرسال إشعار",
  work_department_create: "إنشاء قسم",
  work_department_update: "تحديث قسم",
  work_department_rename: "تعديل اسم قسم",
  work_department_delete: "حذف قسم",
  seet_operations_access: "تحديث صلاحية الأوبريشن",
  seet_mission_publish: "نشر مهمة الفريق",
  seet_mission_update_draft: "تعديل مسودة المهمة",
  seet_mission_capacity: "تحديث مقاعد المهمة",
  seet_mission_invite: "توزيع مهمة الفريق",
  seet_mission_review_join: "مراجعة طلب انضمام",
  seet_mission_review_unable: "مراجعة تعذر التنفيذ",
  seet_mission_close: "إكمال مهمة الفريق",
  account_suspended: "إيقاف حساب",
  account_temporarily_suspended: "إيقاف حساب مؤقتا",
  account_reactivated: "إعادة تفعيل حساب",
  account_deleted: "حذف حساب",
  account_suspend: "إيقاف دائم لحساب",
  account_suspend_until: "إيقاف حساب مؤقتا",
  account_reactivate: "إعادة تفعيل حساب",
  account_delete: "حذف حساب",
  impersonation_action: "إجراء بالنيابة عن حساب",
  impersonation_work_event: "تحديث عمل بالنيابة عن حساب",
};
export default function Admin({ account, onLogout, preview = false, initialTab = 'overview' }) {
  const pageHeading = useRef(null);
  const cms = useCmsTree("control");
  const p = usePlatform();
  const owner = account.role === "super_admin";
  const can = (permission) => allowed(account.user, permission);
  const [addAccount, setAddAccount] = useSessionState('admin.account.create', false, {validate:value=>typeof value==='boolean'});
  const [dialogTarget,setDialogTarget] = useSessionState('admin.account.dialog', null, {validate:value=>value===null||Boolean(value&&typeof value.id==='string'&&['permissions','employee','clientEmail','status'].includes(value.kind)&&Object.keys(value).length===2)});
  const [loadedDialog,setLoadedDialog] = useState(null),[dialogError,setDialogError] = useState(''),[dialogRetry,setDialogRetry] = useState(0);
  const dialogAccount = loadedDialog?.id===dialogTarget?.id&&loadedDialog?.kind===dialogTarget?.kind ? loadedDialog?.account : null;
  const permissionsAccount=dialogTarget?.kind==='permissions'?dialogAccount:null;
  const employeeAccount=dialogTarget?.kind==='employee'?dialogAccount:null;
  const clientEmailAccount=dialogTarget?.kind==='clientEmail'?dialogAccount:null;
  const statusAccount=dialogTarget?.kind==='status'?dialogAccount:null;
  const openAccountDialog=(kind,value)=>{setLoadedDialog(null);setAddAccount(false);setDialogTarget(value?{kind,id:value.id}:null);};
  const setPermissionsAccount=value=>openAccountDialog('permissions',value);
  const setEmployeeAccount=value=>openAccountDialog('employee',value);
  const setClientEmailAccount=value=>openAccountDialog('clientEmail',value);
  const setStatusAccount=value=>openAccountDialog('status',value);
  const [workRequest,setWorkRequest]=useState(null),[navigationOpen,setNavigationOpen]=useState(false),[navigationQuery,setNavigationQuery]=useState(''),[departmentDirty,setDepartmentDirty]=useState(false),[departmentId,setDepartmentId]=useState(null);
  const [accountRevision,setAccountRevision] = useState(0);
  const [missionRequest,setMissionRequest] = useState(null);
  function openWork(destination) {
    const missionId=missionIdFromDestination(destination);
    if(missionId){if(selectTab('work'))setMissionRequest(missionId);}
    else if(destination){if(selectTab('legacy'))setWorkRequest(destination);}
    else selectTab(can('users.read')?'users':'overview');
  }
  const reloadUsers = async () => { setAccountRevision(value=>value+1); };
  const permittedTab = value => generalTabs.includes(value) || (Object.hasOwn(tabPermissions, value) && can(tabPermissions[value]));
  const [savedTab, setTab] = useSessionState('admin.tab', initialTab === 'users' && owner ? 'users' : 'overview', { validate: permittedTab });
  const tab = permittedTab(savedTab) ? savedTab : 'overview';
  const [users, setUsers] = useState([]),
    [audit, setAudit] = useState([]),
    [auditAction, setAuditAction] = useSessionState('admin.audit.action', 'all', { validate: value => typeof value === 'string' }),
    [page, setPage] = useSessionState('admin.audit.page', 0, { validate: value => Number.isSafeInteger(value) && value >= 0 }),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(fn) {
    if (preview) return;
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e.userFacing ? e.message : platformError(e));
    } finally {
      setBusy(false);
    }
  }
  async function employeeSaved() {
    setBusy(true);
    setMessage("تم حفظ بيانات الموظف");
    try {
      await reloadUsers();
    } catch {
      setMessage(
        "تم حفظ بيانات الموظف وتعذر تحديث القائمة أعد تحميل الصفحة لعرض البيانات الجديدة",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (tab === "platform")
      run(async () => {
        const [accounts, activity] = await Promise.all([
          can("users.read")
            ? rpc("platform_users", { p_search: "", p_page: 0 })
            : [],
          can("audit.read") ? rpc("platform_audit", { p_page: 0 }) : [],
        ]);
        setUsers(accounts);
        setAudit(activity);
      });
    if (tab === "audit")
      run(async () => setAudit(await rpc("platform_audit", { p_page: page })));
  }, [tab, page]);
  useEffect(() => {
    if (initialTab === 'users' && owner) setTab('users');
  }, [initialTab, owner]);
  useEffect(() => {
    if (!dialogTarget || !owner || preview) return;
    let active=true;
    setLoadedDialog(null);
    setDialogError('');
    rpc('platform_account_brief',{p_user:dialogTarget.id}).then(result=>{
      if(!active)return;
      const target=result?.account;
      const expectedRole={permissions:'admin',employee:'employee',clientEmail:'client'}[dialogTarget.kind];
      const available=target?.id===dialogTarget.id && (!expectedRole||target.role===expectedRole) &&
        (target.access_status!=='deleted'||(dialogTarget.kind==='status'&&target.identity_cleanup_pending)) &&
        (dialogTarget.kind!=='status'||target.id!==account.user.id);
      if(!available){setDialogTarget(null);setMessage('تغيرت بيانات الحساب أعد فتحه من قائمة الحسابات');return;}
      setLoadedDialog({...dialogTarget,account:target});
    }).catch(failure=>{if(active)setDialogError(platformError(failure));});
    return()=>{active=false;};
  }, [dialogTarget?.id,dialogTarget?.kind,dialogRetry,owner,preview,account.user.id]);
  const tabs = [
    ["overview", LayoutDashboard, "نظرة عامة"],
    ["work", ListTodo, "إدارة المهام"],
    ["available", Layers3, "مهام متاحة"],
    ["departments", Building2, "إدارة الأقسام"],
    ["performance", Gauge, "أداء الفريق"],
    ["notifications", BellRing, "مركز الإشعارات"],
    ["portfolio", Images, "أعمالنا"],
    ["users", Users, "إدارة الحسابات"],
    ["platform", LayoutDashboard, "ملخص المنصة"],
    ["appearance", Palette, "الهوية والمظهر"],
    ["maintenance", Wrench, "وضع الصيانة"],
    ["audit", ShieldCheck, "سجل الإدارة"],
  ].filter(([id]) => permittedTab(id));
  const navigationTerm = navigationQuery.trim().toLocaleLowerCase('ar');
  const navigationTabs = tabs.filter(([, , label]) => !navigationTerm || label.toLocaleLowerCase('ar').includes(navigationTerm));
  const editorVisible = can("content.edit") && (!navigationTerm || "المحرر المباشر".includes(navigationTerm));
  const auditActionOptions = [...new Set([
    ...audit.map((entry) => entry.action).filter(Boolean),
    ...(auditAction !== "all" ? [auditAction] : []),
  ])].sort((left, right) => String(actions[left] || left).localeCompare(String(actions[right] || right), "ar"));
  const visibleAudit = audit.filter((entry) => auditAction === "all" || entry.action === auditAction);
  const patch = (key, value) => p.setDraft({ ...p.config, [key]: value });
  function canLeaveDepartments(destination) {
    return tab !== "departments" || destination === "departments" || !departmentDirty || window.confirm("لديك تعديلات غير محفوظة هل تريد تجاهلها");
  }
  function selectTab(id) {
    if (!canLeaveDepartments(id)) return false;
    const moveFocus = navigationOpen;
    setTab(id);
    setPage(0);
    setMessage("");
    setNavigationOpen(false);
    if (moveFocus) requestAnimationFrame(() => pageHeading.current?.focus());
    return true;
  }
  return cms(
    <div className="a-admin" dir="rtl">
      {dialogTarget&&owner&&!preview&&!dialogAccount&&<section className="a-notice" role={dialogError?'alert':'status'}>{dialogError||'جار استعادة بيانات الحساب'}{dialogError&&<button type="button" onClick={()=>setDialogRetry(value=>value+1)}>إعادة المحاولة</button>}<button type="button" onClick={()=>setDialogTarget(null)}>إغلاق</button></section>}
      {statusAccount&&owner&&!preview&&<AccountStatusDialog account={statusAccount} onClose={()=>setStatusAccount(null)} onSaved={label=>run(async()=>{await reloadUsers();setMessage(label);})}/>}
      {clientEmailAccount&&owner&&!preview&&<ClientEmailDialog client={clientEmailAccount} onClose={()=>setClientEmailAccount(null)} onSaved={()=>run(async()=>{await reloadUsers();setMessage('تم اعتماد بريد العميل الجديد');})}/>}
      {(addAccount || permissionsAccount || employeeAccount) &&
        owner &&
        !preview && (
          <AccountDialog
            admin={permissionsAccount}
            employee={employeeAccount}
            onClose={() => {
              setAddAccount(false);
              setPermissionsAccount(null);
              setEmployeeAccount(null);
            }}
            onAdded={() => run(reloadUsers)}
            onSaved={employeeSaved}
          />
        )}
      <aside className={`a-sidebar ${navigationOpen?'is-open':''}`}>
        <a href="/">
          <img src="/brand/seet-logo-light.svg" alt="صيت" />
        </a>
        <span className="a-eyebrow">إدارة المنصة</span>
        <button type="button" className="a-navigation-toggle" aria-controls="admin-navigation" aria-expanded={navigationOpen} onClick={()=>setNavigationOpen(open=>!open)}>{navigationOpen?<X size={20}/>:<Menu size={20}/>}القائمة</button>
        <div className="a-sidebar-search" role="search" aria-label="البحث في أقسام الإدارة">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={navigationQuery}
            onChange={(event) => setNavigationQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setNavigationQuery("");
            }}
            placeholder="ابحث في أقسام الإدارة"
            aria-label="البحث في أقسام الإدارة"
          />
          {navigationQuery && (
            <button type="button" onClick={() => setNavigationQuery("")} aria-label="مسح بحث القائمة">
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <nav id="admin-navigation" aria-label="أقسام لوحة الإدارة">
          {navigationTabs.map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => selectTab(id)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
          {editorVisible && (
            <a href="/admin/editor">
              <Palette size={19} />
              المحرر المباشر
            </a>
          )}
          {!navigationTabs.length && !editorVisible && (
            <p className="a-sidebar-empty" role="status">لا توجد أقسام مطابقة</p>
          )}
        </nav>
        <div className="a-owner">
          <ShieldCheck size={20} />
          <span>
            {owner ? "سوبر أدمن" : "أدمن"}
            <small dir="ltr">{accountContact(account.user)}</small>
          </span>
        </div>
        <button className="a-sidebar-logout" onClick={()=>{if(canLeaveDepartments())onLogout();}}>تسجيل الخروج</button>
      </aside>
      <main className="a-admin-main">
        <header className="a-heading">
          <div>
            <span className="a-eyebrow">مساحة التحكم</span>
            <h1 ref={pageHeading} tabIndex={-1}>{tabs.find((t) => t[0] === tab)?.[2]}</h1>
            <p className="a-page-description">{{overview:'أولويات الفريق وقرارات التنفيذ في مساحة واحدة',work:'انشر المهام وحدد متطلبات الأقسام وتابع الإنجاز',available:'المهام المنشورة ومتطلبات الأقسام وفرص الانضمام',legacy:'الطلبات السابقة وأدوات المتابعة والتخطيط المرتبطة بها',platform:'الحسابات والنشاط وأدوات إدارة المنصة',services:'نظم قدرات المنصة وأزمنة التنفيذ وأوزان الجهد',departments:'أنشئ الأقسام وحدد مسؤولياتها ومهامها وفريقها',performance:'اقرأ سرعة الإنجاز وحجم العمل بقياس عادل وخاص',notifications:'تابع إشعارات المنصة وواتساب وتحكم في القنوات',portfolio:'نظم الأعمال المعتمدة وجهزها للعرض',permissions:'وزع مسؤوليات الأقسام وفق احتياج الفريق',users:'إدارة بيانات الحسابات ومستويات الوصول',appearance:'ضبط هوية المنصة وتفاصيل العرض',maintenance:'التحكم في إتاحة المنصة للزوار',audit:'سجل القرارات والتحديثات الإدارية'}[tab]}</p>
          </div>
          <div className="a-heading-actions a-header-tools" role="group" aria-label="إجراءات سريعة">
            {owner && (
              <button type="button" className="a-toolbar-add" onClick={() => {setDialogTarget(null);setAddAccount(true);}}>
                <UserPlus size={19} aria-hidden="true" />
                إضافة حساب
              </button>
            )}
            {!preview&&<Notifications user={account.user} onOpen={openWork}/>}
            <a className="a-button a-toolbar-site" href="/">
              عرض الموقع <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
        </header>
        {message && (
          <p className="a-notice" role="status">
            {message}
          </p>
        )}
        {(tab === "platform" || tab === "overview" && preview) && (
          <Overview
            preview={preview}
            access={{
              users: can("users.read"),
              audit: can("audit.read"),
              content: can("content.edit"),
              appearance: can("appearance.edit"),
              maintenance: can("maintenance.manage"),
            }}
            platform={p}
            users={users}
            audit={audit}
            busy={busy}
            onTab={(next) => {
              if (tabs.some((t) => t[0] === next)) selectTab(next);
            }}
          />
        )}
        <Suspense fallback={<PanelLoading/>}>
          {['overview','work','available'].includes(tab) && !preview && <MissionWorkspace key={tab} user={account.user} initialMission={tab==='work'?missionRequest:null} initialView={tab==='available'?'available':'overview'}/>}
          {tab === 'legacy' && !preview && <TeamWork key={tab} user={account.user} initialRequest={workRequest} externalNotifications onDepartments={()=>selectTab('departments')}/>}
          {tab === 'services' && !preview && <ServiceCatalog editable={can('services.manage')} onDepartments={can('departments.manage')?id=>{setDepartmentId(id);selectTab('departments');}:undefined}/>} 
          {tab === 'departments' && !preview && can('departments.manage')&&<DepartmentManager initialDepartmentId={departmentId} onDirtyChange={setDepartmentDirty}/>}
          {tab === 'performance' && !preview && <PerformancePanel/>}
          {tab === 'notifications' && !preview && <NotificationCenter user={account.user} onOpen={openWork}/>}
          {tab === 'portfolio' && <WorksManager user={account.user} preview={preview}/>} 
        </Suspense>
        {tab === "users" && <AccountDirectory owner={owner} preview={preview} busy={busy} message={message} revision={accountRevision} renderActions={u=><>
                  <label>
                    الصلاحية
                    <select
                      value={u.role || ""}
                      disabled={busy || !owner || u.id === account.user.id || u.access_status === 'deleted'}
                      onChange={(e) =>
                        run(async () => {
                          await rpc("platform_role", {
                            p_user: u.id,
                            p_role: e.target.value,
                          });
                          await reloadUsers();
                          setMessage("تم تحديث الصلاحية");
                        })
                      }
                    >
                      <option value="" disabled>
                        غير محدد
                      </option>
                      {Object.entries(roles).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {owner && (
                    <div className="a-user-actions">
                      {u.role==='client'&&!preview&&<button disabled={busy || u.access_status === 'deleted'} onClick={()=>setClientEmailAccount(u)}>تعديل بريد العميل</button>}
                      {u.role === "employee" && !preview && (
                        <button
                          disabled={busy || u.access_status === 'deleted'}
                          onClick={() => setEmployeeAccount(u)}
                        >
                          تعديل بيانات الموظف
                        </button>
                      )}
                      {u.role === "admin" && (
                        <button
                          disabled={busy || u.access_status === 'deleted'}
                          onClick={() => setPermissionsAccount(u)}
                        >
                          تحديد الصلاحيات
                        </button>
                      )}
                      {u.invitation_id && u.must_change_password && (!u.access_status || u.access_status === 'active') && (
                        <>
                          {((u.email && !u.phone_only && u.email_status !== "sent") ||
                            u.whatsapp_status !== "sent") && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await accountRequest({
                                    action: "resend",
                                    invitationId: u.invitation_id,
                                  });
                                  await reloadUsers();
                                  setMessage(
                                    "تم تحديث حالة إرسال بيانات الدخول",
                                  );
                                })
                              }
                            >
                              إعادة محاولة الإرسال
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await accountRequest({
                                  action: "resend",
                                  invitationId: u.invitation_id,
                                  rotate: true,
                                });
                                await reloadUsers();
                                setMessage(
                                  "تم إصدار كلمة مرور مؤقتة جديدة وتحديث حالة الإرسال",
                                );
                              })
                            }
                          >
                            إصدار كلمة مؤقتة جديدة
                          </button>
                        </>
                      )}
                      <button
                        disabled={
                          busy ||
                          u.id === account.user.id ||
                          u.role === "super_admin" ||
                          u.role === "client" ||
                          !u.role ||
                          u.must_change_password ||
                          preview ||
                          (u.access_status && u.access_status !== 'active')
                        }
                        onClick={() =>
                          run(() => startImpersonation(u.id))
                        }
                      >
                        الدخول بهذا الحساب
                      </button>
                      {!preview && u.id !== account.user.id && <button type="button" disabled={busy || (u.access_status === 'deleted' && !u.identity_cleanup_pending)} onClick={()=>setStatusAccount(u)}>{u.identity_cleanup_pending?'إكمال حذف الحساب':'إدارة حالة الحساب'}</button>}
                    </div>
                  )}
        </>}/>}
        {tab === "appearance" && (
          <section className="a-section">
            <h2>ألوان المنصة</h2>
            <p>تظهر التعديلات في المعاينة وتصبح عامة عند النشر</p>
            <div className="a-colors">
              {[
                ["accent", "اللون الأساسي", "#f28c8c"],
                ["background", "الخلفية", "#0d0b0b"],
                ["panel", "البطاقات", "#171414"],
                ["text", "النص", "#f4f2f2"],
              ].map(([id, label, fallback]) => (
                <label key={id}>
                  {label}
                  <input
                    type="color"
                    value={p.config.theme?.[id] || fallback}
                    onChange={(e) =>
                      patch("theme", {
                        ...p.config.theme,
                        [id]: e.target.value,
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <a href="/admin/editor">تخصيص صور الخلفية والبطاقات</a>
            <div className="a-actions">
              <button
                disabled={busy || !p.draft}
                onClick={() =>
                  run(async () => {
                    await p.save();
                    setMessage("تم نشر المظهر");
                  })
                }
              >
                نشر المظهر
              </button>
              <button disabled={busy} onClick={() => p.setDraft(null)}>
                إلغاء التعديلات
              </button>
            </div>
          </section>
        )}
        {tab === "maintenance" && (
          <section className="a-section">
            <h2>مساحة هادئة للتحديث</h2>
            <p>يبقى دخول السوبر أدمن متاحا أثناء الصيانة</p>
            <label className="a-toggle">
              <input
                type="checkbox"
                checked={!!p.config.maintenance}
                onChange={(e) => patch("maintenance", e.target.checked)}
              />
              تفعيل وضع الصيانة
            </label>
            <label>
              عنوان صفحة الصيانة
              <input
                value={p.config.maintenanceTitle || ""}
                placeholder="نعود إليك بتجربة أفضل"
                onChange={(e) => patch("maintenanceTitle", e.target.value)}
              />
            </label>
            <label>
              رسالة الزوار
              <textarea
                value={p.config.maintenanceMessage || ""}
                onChange={(e) => patch("maintenanceMessage", e.target.value)}
              />
            </label>
            <button
              disabled={busy || !p.draft}
              onClick={() =>
                run(async () => {
                  await p.save();
                  setMessage("تم تحديث وضع الصيانة");
                })
              }
            >
              حفظ وضع الصيانة
            </button>
          </section>
        )}
        {tab === "audit" && (
          <section className="a-section">
            <div className="a-section-heading">
              <div><span className="a-eyebrow">قرارات الإدارة</span><h2>سجل الإدارة الخاص</h2></div>
              <span className="a-list-count" role="status" aria-live="polite">{busy?'جار تحديث السجل':auditAction==='all'?`${audit.length} عملية في هذه الصفحة`:`${visibleAudit.length} من ${audit.length} عملية في هذه الصفحة`}</span>
            </div>
            <p>يظهر صاحب الحساب في التعديلات ويحفظ هذا السجل المنفذ الفعلي</p>
            <div className="a-data-filter-bar" aria-label="فلاتر سجل الإدارة">
              <div className="a-data-filter-fields">
                <label className="a-filter-field">
                  <span>نوع الإجراء</span>
                  <select value={auditAction} onChange={(event) => setAuditAction(event.target.value)}>
                    <option value="all">كل الإجراءات</option>
                    {auditActionOptions.map((action) => <option value={action} key={action}>{actions[action] || action}</option>)}
                  </select>
                </label>
              </div>
              {auditAction !== "all" && <button type="button" className="a-filter-reset" onClick={() => setAuditAction("all")}>مسح فلتر الصفحة</button>}
            </div>
            <div className="a-audit">
              {visibleAudit.map((a) => (
                <article key={a.id}>
                  <strong>{actions[a.action] || a.action}</strong>
                  <time>{new Date(a.created_at).toLocaleString("ar-SA")}</time>
                  <span>
                    المنفذ <b dir="ltr">{a.actor}</b>
                  </span>
                  <span>
                    باسم <b dir="ltr">{a.effective_user}</b>
                  </span>
                </article>
              ))}
              {!busy && !visibleAudit.length && (
                <div className="a-table-empty" role="status"><ShieldCheck size={28}/><h3>لا توجد عمليات مطابقة</h3><p>غير نوع الإجراء أو امسح فلتر الصفحة</p></div>
              )}
            </div>
            <div className="a-pagination">
              <button
                disabled={!page || busy}
                onClick={() => setPage(page - 1)}
              >
                السابق
              </button>
              <span>{page + 1}</span>
              <button
                disabled={audit.length < 50 || busy}
                onClick={() => setPage(page + 1)}
              >
                التالي
              </button>
            </div>
          </section>
        )}
      </main>
    </div>,
  );
}
