import {accountContact} from '../auth/account-rules';
import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import './dashboard-cosmos.css';
import { rpc, platformError, useCmsTree } from "./platform";
import Notifications from '../workflow/Notifications';
import {repository} from '../workflow/data';
import {useSessionState} from '../shared/session-state';
import {missionIdFromDestination} from '../missions/mission-navigation';
import {BellRing,BriefcaseBusiness,Building2,Gauge,UsersRound,ListTodo,Mail,Menu,Phone,Plus,ShieldCheck,Star,UserRound,X} from 'lucide-react';

const TeamWork=lazy(()=>import('../workflow/TeamWork'));
const MissionWorkspace=lazy(()=>import('../missions/MissionWorkspace'));
const NotificationCenter=lazy(()=>import('../workflow/NotificationCenter'));
const PerformancePanel=lazy(()=>import('../workflow/PerformancePanel'));
const CoordinatorClients=lazy(()=>import('../workflow/CoordinatorClients'));

function WorkspaceLoading({page=false}){
  return <div className={page?'a-loading':'a-section a-table-empty'} dir="rtl" role="status" aria-live="polite" aria-busy="true"><strong>جار تحميل مساحة العمل</strong></div>;
}

export default function Workspace(props) {
  if (!['employee','admin','super_admin'].includes(props.role)) return <main className="a-loading" dir="rtl">هذه المساحة مخصصة لفريق صيت</main>;
  return <LegacyWorkspace {...props}/>;
}
function LegacyWorkspace({
  user,
  role,
  onLogout,
  preview = false,
}) {
  const [profile, setProfile] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [employeeTab,setEmployeeTab]=useSessionState('employee.tab','overview',{validate:value=>['overview','tasks','available','operations','legacy','clients','performance','notifications','account'].includes(value)}),[navigationOpen,setNavigationOpen]=useState(false),[workRequest,setWorkRequest]=useState(null);
  const [missionRequest,setMissionRequest]=useState(null),[operations,setOperations]=useState(false);
  function openWork(destination) {
    const missionId=missionIdFromDestination(destination);
    if(missionId){setMissionRequest(missionId);setEmployeeTab('tasks');}
    else if(destination){setWorkRequest(destination);setEmployeeTab('legacy');}
    else setEmployeeTab('notifications');
    setNavigationOpen(false);
  }
  const [coordinator,setCoordinator]=useState(null);
  const [createRequest,setCreateRequest]=useState(false);
  const [showTaskHome,setShowTaskHome]=useState(false);
  useEffect(()=>{
    if(role!=='employee'||preview)return;
    let live=true;
    setCoordinator(null);
    const refresh=()=>repository.employeeAccess(user.id).then(access=>{if(live){setCoordinator(access?.coordinator===true);setOperations(access?.operations_manager===true);}}).catch(()=>{if(live){setCoordinator(false);setOperations(false);}});
    refresh();
    window.addEventListener('focus',refresh);
    return()=>{live=false;window.removeEventListener('focus',refresh);};
  },[role,preview,user.id]);
  useEffect(()=>{if(coordinator===false&&employeeTab==='clients')setEmployeeTab('tasks');},[coordinator,employeeTab,setEmployeeTab]);
  const [workIdentity,setWorkIdentity]=useState(null),[identityLoading,setIdentityLoading]=useState(false);
  const pageHeading=useRef(null);
  const [mobileLayout,setMobileLayout]=useState(()=>window.matchMedia('(max-width: 900px)').matches);
  useEffect(()=>{
    const media=window.matchMedia('(max-width: 900px)');
    const sync=()=>setMobileLayout(media.matches);
    sync();
    media.addEventListener('change',sync);
    return()=>media.removeEventListener('change',sync);
  },[]);
  const cms = useCmsTree(`dashboard-${role}`);
  const employeeProfile = role === "employee" || profile?.role === "employee";
  useEffect(() => {
    if (preview) {
      setProfile({ display_name: "", phone: "", email: "معاينة مساحة العمل" });
      return;
    }
    let live = true;
    rpc("platform_profile", { p_session: null })
      .then((p) => {
        if (live) setProfile(p);
      })
      .catch((e) => {
        if (live) setMessage(platformError(e));
      });
    return () => {
      live = false;
    };
  }, [user.id, preview]);
  useEffect(() => {
    if (role !== 'employee' || preview || employeeTab !== 'account' || workIdentity) return undefined;
    let live = true;
    setIdentityLoading(true);
    repository.performance(30)
      .then(payload => {
        if (!live) return;
        const people = Array.isArray(payload?.people) ? payload.people : [];
        setWorkIdentity(people.find(person => person.id === user.id) || null);
      })
      .catch(() => {
        if (live) setWorkIdentity(null);
      })
      .finally(() => {
        if (live) setIdentityLoading(false);
      });
    return () => {
      live = false;
    };
  }, [employeeTab, preview, role, user.id, workIdentity]);
  async function save(e) {
    e.preventDefault();
    if (employeeProfile || busy || preview) return;
    setBusy(true);
    setMessage("");
    try {
      await rpc("platform_update_profile", {
        p_name: profile.display_name,
        p_phone: profile.phone,
        p_session: null,
      });
      setMessage("تم حفظ التعديل باسم صاحب الحساب");
    } catch (e) {
      setMessage(platformError(e));
    } finally {
      setBusy(false);
    }
  }
  function selectEmployeeTab(id) {
    if(id==='tasks')setMissionRequest(null);
    if(id==='legacy'){setWorkRequest(null);setShowTaskHome(true);}
    const moveFocus=navigationOpen;
    setEmployeeTab(id);
    setNavigationOpen(false);
    if(moveFocus)requestAnimationFrame(()=>pageHeading.current?.focus());
  }
  if (role === "employee" && !preview) {
    const createRequestButton=coordinator&&employeeTab==='legacy'&&<button type="button" className="w-create-request-trigger" aria-label="تسجيل طلب في الأعمال السابقة" title="تسجيل طلب في الأعمال السابقة" onClick={()=>{setCreateRequest(true);setEmployeeTab('legacy');setNavigationOpen(false);}}><Plus size={21} aria-hidden="true"/></button>;
    const employeeTabs=[['overview',BriefcaseBusiness,'مساحة عملي'],['tasks',ListTodo,'مهامي'],['available',Building2,'مهام متاحة'],...(operations?[['operations',UsersRound,'إدارة التنفيذ']]:[]),...(coordinator?[['clients',UsersRound,'العملاء']]:[]),['performance',Gauge,'مؤشرات أدائي'],['notifications',BellRing,'مركز الإشعارات'],['account',UserRound,'بيانات حسابي']];
    const jobTitle=profile?.job_title||workIdentity?.job_title||'المسمى الوظيفي غير محدد';
    const responsibleDepartments=new Set((workIdentity?.responsible_departments||[]).map(department=>department?.id||department?.name||department));
    const departments=(workIdentity?.departments||[]).filter(department=>department?.name).map(department=>({...department,responsible:department.member_role==='lead'||responsibleDepartments.has(department.id)||responsibleDepartments.has(department.name)}));
    return (
      <div className="a-admin w-employee-dashboard" dir="rtl">
        <aside className={`a-sidebar ${navigationOpen?'is-open':''}`}>
          <a href="/" aria-label="صيت الرئيسية"><img src="/brand/seet-logo-light.svg" alt="صيت" /></a>
          <span className="a-eyebrow">مساحة الفريق</span>
          <div className="w-mobile-header-actions">
            {mobileLayout&&createRequestButton}
            {mobileLayout&&<Notifications variant="compact" user={user} onOpen={openWork}/>}
            <button type="button" className="a-navigation-toggle" aria-label={navigationOpen?'إغلاق القائمة':'فتح القائمة'} aria-controls="employee-navigation" aria-expanded={navigationOpen} onClick={()=>setNavigationOpen(open=>!open)}>{navigationOpen?<X size={20} aria-hidden="true"/>:<Menu size={20} aria-hidden="true"/>}</button>
          </div>
          <nav id="employee-navigation" aria-label="أقسام مساحة الموظف">{employeeTabs.map(([id,Icon,label])=><button type="button" key={id} aria-current={employeeTab===id?'page':undefined} onClick={()=>selectEmployeeTab(id)}><Icon size={19}/>{label}</button>)}</nav>
          <div className="a-owner"><ShieldCheck size={20} aria-hidden="true"/><span>{profile?.display_name||'عضو الفريق'}{jobTitle&&<small className="w-owner-title">{jobTitle}</small>}<small dir="ltr">{accountContact(user)}</small></span></div>
          <button type="button" className="a-sidebar-logout" onClick={onLogout}>تسجيل الخروج</button>
        </aside>
        <main className="a-admin-main" ref={pageHeading} tabIndex={-1} aria-label={employeeTabs.find(([id])=>id===employeeTab)?.[2]}>
          {!mobileLayout&&<div className="w-employee-topbar">{createRequestButton}<Notifications variant="compact" user={user} onOpen={openWork}/></div>}
          {message&&<p className="a-notice" role="status">{message}</p>}
          <Suspense fallback={<WorkspaceLoading/>}>
            {['overview','tasks','available','operations'].includes(employeeTab)&&<MissionWorkspace key={employeeTab} user={user} initialMission={employeeTab==='tasks'?missionRequest:null} initialView={employeeTab==='tasks'?'mine':employeeTab}/>}
            {employeeTab==='legacy'&&<TeamWork key={workRequest||'employee-work'} user={user} initialRequest={workRequest} externalNotifications createRequest={createRequest} onCreateRequestHandled={()=>setCreateRequest(false)} showTaskHome={showTaskHome} onTaskHomeHandled={()=>setShowTaskHome(false)}/>}
            {employeeTab==='clients'&&(coordinator?<CoordinatorClients/>:coordinator===null?<WorkspaceLoading/>:null)}
            {employeeTab==='performance'&&<PerformancePanel viewer="self"/>}
            {employeeTab==='notifications'&&<NotificationCenter user={user} onOpen={openWork}/>}
          </Suspense>
          {employeeTab==='account'&&<section className="a-section w-employee-account" aria-labelledby="employee-account-title">
            <header className="w-account-heading"><div className="w-account-avatar" aria-hidden="true"><UserRound size={26}/></div><div><span className="a-eyebrow">الهوية والوصول</span><h2 id="employee-account-title">بيانات حسابي</h2><p>راجع معلوماتك المهنية والأقسام المرتبطة بحسابك</p></div><span className="w-account-role"><ShieldCheck size={16} aria-hidden="true"/>موظف</span></header>
            {profile&&<><div className="w-account-name"><strong>{profile.display_name||'عضو الفريق'}</strong><span><BriefcaseBusiness size={17} aria-hidden="true"/>{jobTitle}</span></div><dl className="w-account-facts">{!user.app_metadata?.phone_only&&<div><dt><Mail size={17} aria-hidden="true"/>البريد الإلكتروني</dt><dd dir="ltr">{accountContact(user)}</dd></div>}<div><dt><Phone size={17} aria-hidden="true"/>رقم الجوال</dt><dd dir={profile.phone?'ltr':'rtl'}>{profile.phone||'غير مسجل'}</dd></div></dl></>}
            <section className="w-account-departments" aria-labelledby="employee-departments-title"><header><Building2 size={19} aria-hidden="true"/><div><span className="a-eyebrow">نطاق العمل</span><h3 id="employee-departments-title">الأقسام والمسؤوليات</h3></div></header>{identityLoading?<p role="status">جار تحميل الأقسام المرتبطة</p>:departments.length?<ul>{departments.map(department=><li key={department.id||department.name}><span>{department.name}</span>{department.responsible&&<strong><Star size={13} aria-hidden="true"/>مسؤول القسم</strong>}</li>)}</ul>:<p>لا توجد أقسام مرتبطة بحسابك</p>}</section>
            <p className="w-account-note">تعديل بيانات الموظف متاح للسوبر أدمن من الحسابات والصلاحيات</p>
            <div className="w-account-actions"><button type="button" className="a-button" onClick={()=>selectEmployeeTab('performance')}>عرض مؤشرات أدائي</button><a className="a-button" href="/forgot-password">تغيير كلمة المرور</a></div>
          </section>}
        </main>
      </div>
    );
  }
  return (
    <div className="a-workspace" dir="rtl">
      <div className="a-top">
        <a href="/" aria-label="الرئيسية">
          <img src="/brand/seet-logo-light.svg" alt="صيت" />
        </a>
        {onLogout && <button onClick={onLogout}>تسجيل الخروج</button>}
      </div>
      {cms(
        <main className="a-workspace-main">
          <span className="a-eyebrow">مساحتك في صيت</span>
          <h1>
            {role === "client"
              ? "لوحة تحكم العميل"
              : role === "employee"
                ? "لوحة تحكم الموظف"
                : "لوحة تحكم الإدارة"}
          </h1>
          <p>كل ما تحتاجه أقرب إليك</p>
          <div className="a-workspace-cards">
            <article id="welcome">
              <h2>أهلا بك في مساحتك</h2>
              <p>هنا تبدأ رحلتك مع صيت</p>
              <a href="/#contact">تواصل مع الفريق</a>
            </article>
            <article id="projects">
              <h2>مشاريعك</h2>
              <p>لا توجد مشاريع مرتبطة بحسابك حاليا</p>
            </article>
            <article id="files">
              <h2>الملفات والتسليمات</h2>
              <p>ستظهر ملفات مشاريعك هنا عند مشاركتها</p>
            </article>
          </div>
        </main>,
      )}
      <section className="a-profile">
        <h2>بيانات الحساب</h2>
        <p dir="ltr">{accountContact(user)}</p>
        {message && <p role="status">{message}</p>}
        {employeeProfile && (
          <p id="employee-profile-hint">تعديل بيانات الموظف متاح للسوبر أدمن فقط من الحسابات والصلاحيات</p>
        )}
        {profile && (
          <form onSubmit={save}>
            <label>
              الاسم
              <input
                maxLength={120}
                readOnly={employeeProfile}
                aria-describedby={employeeProfile ? "employee-profile-hint" : undefined}
                value={profile.display_name}
                onChange={(e) =>
                  setProfile({ ...profile, display_name: e.target.value })
                }
              />
            </label>
            <label>
              رقم الجوال
              <input
                type="tel"
                dir="ltr"
                maxLength={30}
                readOnly={employeeProfile}
                aria-describedby={employeeProfile ? "employee-profile-hint" : undefined}
                value={profile.phone}
                onChange={(e) =>
                  setProfile({ ...profile, phone: e.target.value })
                }
              />
            </label>
            {!employeeProfile && (
              <button disabled={busy || preview}>
                {busy ? "جار الحفظ" : "حفظ بياناتي"}
              </button>
            )}
          </form>
        )}
        <a href="/forgot-password">تغيير كلمة المرور</a>
      </section>
    </div>
  );
}
