import React, { useEffect, useRef, useState } from 'react';
import { useSessionState } from '../shared/session-state';
import { ArrowLeft, Search, Users, X } from 'lucide-react';
import { rpc, platformError } from './platform';
import { accountAccessLabel } from './AccountStatusDialog';
import { deliveryLabel } from './AccountDialog';
import { adminPermissions, accountTypeLabels } from '../auth/account-rules';
import { events, states } from '../workflow/data';
import { isStaffAccount, loadAccountDepartments } from './account-departments';
import './account-directory.css';

const roles = accountTypeLabels;
const filters = {search:'',role:'all',status:'all',login:'all',sort:'newest',page:0};
const validFilters = value => value && typeof value === 'object' && Object.keys(value).length === Object.keys(filters).length &&
  typeof value.search === 'string' && ['all','client','employee','admin','super_admin','unset','collaborator','supervisor'].includes(value.role) &&
  ['all','active','temporary','suspended','deleted'].includes(value.status) && ['all','signed_in','never','pending'].includes(value.login) &&
  ['newest','oldest','name','last_login'].includes(value.sort) && Number.isSafeInteger(value.page) && value.page >= 0;
const auditLabels = {account_suspend:'إيقاف دائم للحساب',account_suspend_until:'إيقاف مؤقت للحساب',account_reactivate:'إعادة تفعيل الحساب',account_delete:'حذف الحساب',impersonation_start:'بدء الدخول بالنيابة',impersonation_end:'إنهاء الدخول بالنيابة',impersonation_action:'إجراء بالنيابة عن الحساب',impersonation_work_event:'تحديث عمل بالنيابة',role_change:'تعديل الصلاحية',profile_update:'تحديث البيانات',employee_updated:'تحديث بيانات الموظف',client_email_updated:'تحديث البريد',client_phone_updated:'تحديث الجوال',account_created:'إنشاء الحساب',first_password_changed:'تعيين كلمة المرور',invitation_resent:'إعادة إرسال الدعوة',permissions_change:'تحديث الصلاحيات'};
export function accountDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'غير مسجل';
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{year:'numeric',month:'long',day:'numeric'}).format(new Date(value));
}

function AccountDepartments({user,departments,status}) {
 const message=user.role==='client'?'لا ينطبق':!isStaffAccount(user)?'غير محدد':status==='error'?'تعذر عرض الأقسام':status==='loading'?'جار تحميل الأقسام':!departments?.length?'غير مرتبط بقسم':null;
 return <span className="ad-departments" id={`account-departments-${user.id}`}><span className="ad-departments-label">الأقسام</span>{message?<span className="ad-department-empty">{message}</span>:departments.map(department=><span className={`ad-department-tag${department.responsible?' is-lead':''}`} key={department.id}><span>{department.name}</span>{department.responsible&&<small>مسؤول القسم</small>}</span>)}</span>;
}

export default function AccountDirectory({owner, preview, revision, busy, message, renderActions}) {
  const [query,setQuery] = useSessionState('accounts.filters',filters,{validate:validFilters}), [search,setSearch] = useSessionState('accounts.search','',{validate:value=>typeof value==='string'});
  const [data,setData] = useState(null), [loading,setLoading] = useState(true), [error,setError] = useState('');
  const [selectedId,setSelectedId] = useSessionState('accounts.selected',null,{validate:value=>value===null||typeof value==='string'}), [retry,setRetry] = useState(0);
  const [departmentState,setDepartmentState] = useState(null), [departmentRetry,setDepartmentRetry] = useState(0);
  const selected = data?.items?.find(item=>item.id===selectedId) || (owner && selectedId ? {id:selectedId} : null);
  useEffect(() => {
    let active=true;
    setLoading(true); setError('');
    if (preview) {setData({items:[],total:0,counts:{}});setLoading(false);return;}
    rpc('platform_account_directory',Object.fromEntries(Object.entries(query).map(([key,value])=>[`p_${key}`,value])))
      .then(value=>{if(active){setData(value);if(query.page>0&&!value.items.length)setQuery(previous=>({...previous,page:Math.max(0,Math.ceil(value.total/20)-1)}));}})
      .catch(failure=>{if(active)setError(platformError(failure));})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[query,revision,retry,preview]);
  useEffect(() => {
    if(preview||!data?.items?.length)return;
    let active=true;
    setDepartmentState({source:data,status:'loading',items:{}});
    loadAccountDepartments(data.items)
      .then(items=>{if(active)setDepartmentState({source:data,status:'ready',items});})
      .catch(()=>{if(active)setDepartmentState({source:data,status:'error',items:{}});});
    return ()=>{active=false;};
  },[data,departmentRetry,preview]);
  const departments=departmentState?.source===data?departmentState:null;
  const change=(key,value)=>setQuery(previous=>({...previous,[key]:value,page:0}));
  const reset=()=>{setSearch('');setQuery({...filters});};
  const modified=Object.keys(filters).some(key=>key!=='page'&&query[key]!==filters[key]);
  return <section className="a-section ad-directory" aria-label="حسابات المنصة">
    <div className="a-section-heading"><div><span className="a-eyebrow">العملاء والفريق</span><h2>حسابات المنصة</h2></div><span className="ad-total">{data?.counts?.all??0} حساب</span></div>
    <div className="ad-status-tabs" aria-label="تصفية حالة الحساب">
      {[['all','كل الحسابات'],['active','نشط'],['temporary','موقوف مؤقتا'],['suspended','موقوف دائما'],['deleted','محذوف']].map(([id,label])=><button key={id} type="button" aria-pressed={query.status===id} onClick={()=>change('status',id)}>{label}<span>{data?.counts?.[id]??0}</span></button>)}
    </div>
    <form className="ad-filters" onSubmit={event=>{event.preventDefault();change('search',search.trim());}}>
      <label className="ad-search"><span>البحث عن حساب</span><div><Search size={18} aria-hidden="true"/><input type="search" placeholder="الاسم أو البريد أو الجوال" value={search} onChange={event=>setSearch(event.target.value)}/><button type="submit">بحث</button></div></label>
      <label><span>الدور</span><select value={query.role} onChange={event=>change('role',event.target.value)}><option value="all">كل الأدوار</option>{Object.entries(roles).map(([id,label])=><option key={id} value={id}>{label}</option>)}<option value="unset">غير محدد</option></select></label>
      <label><span>حالة الدخول</span><select value={query.login} onChange={event=>change('login',event.target.value)}><option value="all">الكل</option><option value="signed_in">سبق تسجيل الدخول</option><option value="never">لم يسجل الدخول</option><option value="pending">بانتظار تغيير كلمة المرور</option></select></label>
      <label><span>الترتيب</span><select value={query.sort} onChange={event=>change('sort',event.target.value)}><option value="newest">الأحدث أولا</option><option value="oldest">الأقدم أولا</option><option value="name">الاسم</option><option value="last_login">آخر دخول</option></select></label>
    </form>
    <div className="ad-results"><span role="status" aria-live="polite">{loading?'جار تحميل الحسابات':error?'تعذر تحميل الحسابات':`${data?.total??0} حساب مطابق`}</span>{modified&&<button type="button" onClick={reset}>مسح الفلاتر</button>}</div>
    {!loading&&!error&&departments?.status==='error'&&<div className="ad-departments-notice" role="status"><span>تعذر تحميل الأقسام المرتبطة بالحسابات</span><button type="button" onClick={()=>setDepartmentRetry(value=>value+1)}>إعادة المحاولة</button></div>}
    {error?<div className="ad-empty" role="alert"><p>{error}</p><button onClick={()=>setRetry(value=>value+1)}>إعادة المحاولة</button></div>:loading?<div className="ad-empty" role="status" aria-busy="true">جار تجهيز قائمة الحسابات</div>:!data?.items?.length?<div className="ad-empty"><Users size={28} aria-hidden="true"/><h3>لا توجد حسابات مطابقة</h3><p>غير عبارة البحث أو الفلاتر لعرض الحسابات</p><button onClick={reset}>عرض كل الحسابات</button></div>:<div className="ad-list">
      <div className="ad-columns" aria-hidden="true"><span>الحساب</span><span className="ad-column-departments">القسم</span><span>الدور</span><span>الحالة</span><span className="ad-column-last-login">آخر دخول</span><span>الملخص</span></div>
      {data.items.map(user=><button className="ad-row" type="button" key={user.id} onClick={()=>setSelectedId(user.id)} aria-label={`فتح ملخص حساب ${user.display_name||user.email}`} aria-describedby={`account-departments-${user.id}`}>
        <span className="ad-identity"><span className="ad-avatar" aria-hidden="true">{(user.display_name||user.email||'ح').trim().slice(0,1)}</span><span><strong>{user.display_name||'حساب المنصة'}</strong><bdi>{user.phone || user.email}</bdi>{user.job_title&&<small>{user.job_title}</small>}</span></span>
        <AccountDepartments user={user} departments={departments?.items[user.id]} status={departments?.status||'loading'}/>
        <span className="ad-role">{roles[user.account_type || user.role]||'غير محدد'}</span><span className="ad-access"><span className={`a-access-state is-${user.access_status}`}>{accountAccessLabel(user.access_status)}</span></span>
        <span className="ad-last-login">{user.last_sign_in_at?accountDate(user.last_sign_in_at):'لم يسجل الدخول'}</span><span className="ad-open">عرض الملخص<ArrowLeft size={17} aria-hidden="true"/></span>
      </button>)}
    </div>}
    <div className="a-pagination"><button disabled={loading||!query.page} onClick={()=>setQuery(previous=>({...previous,page:previous.page-1}))}>السابق</button><span>الصفحة {query.page+1} من {Math.max(1,Math.ceil((data?.total??0)/20))}</span><button disabled={loading||error||(query.page+1)*20>=(data?.total??0)} onClick={()=>setQuery(previous=>({...previous,page:previous.page+1}))}>التالي</button></div>
    {selected&&<AccountBrief key={selected.id} account={selected} owner={owner} revision={revision} busy={busy} message={message} onClose={()=>setSelectedId(null)} renderActions={renderActions}/>}
  </section>;
}

function AccountBrief({account,owner,revision,busy,message,onClose,renderActions}) {
  const dialog=useRef(null);
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(owner),[retry,setRetry]=useState(0);
  const [savedTab,setTab]=useSessionState(`accounts.brief.${account.id}.tab`,'overview',{validate:value=>['overview',...(owner?['work','manage']:[])].includes(value)});
  const tab=owner?savedTab:'overview';
  useEffect(()=>{const previous=document.activeElement;dialog.current.showModal();return()=>previous?.focus?.();},[]);
  useEffect(()=>{
    if(!owner)return;
    let live=true;setLoading(true);setError('');
    rpc('platform_account_brief',{p_user:account.id}).then(value=>{if(live)setData(value);}).catch(failure=>{if(live)setError(platformError(failure));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[account.id,owner,revision,retry]);
  const user=data?.account||account;
  return <dialog ref={dialog} className="a-account-dialog ad-brief" dir="rtl" aria-labelledby="account-brief-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header><div><span className="a-eyebrow">ملف الحساب</span><h2 id="account-brief-title">{user.display_name||'حساب المنصة'}</h2><bdi>{user.phone || user.email}</bdi></div><button type="button" onClick={onClose} disabled={busy} aria-label="إغلاق ملخص الحساب"><X size={22} aria-hidden="true"/></button></header>
    <div className="ad-brief-badges"><span>{roles[user.account_type || user.role]||'غير محدد'}</span><span className={`a-access-state is-${user.access_status}`}>{accountAccessLabel(user.access_status)}</span>{user.job_title&&<span>{user.job_title}</span>}</div>
    <nav className="ad-brief-tabs" aria-label="أقسام ملخص الحساب">{[['overview','نظرة عامة'],...(owner?[['work','العمل والنشاط'],['manage','إدارة الحساب']]:[])].map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {loading?<p className="ad-empty" role="status">جار تحميل ملخص الحساب</p>:error?<div className="ad-empty" role="alert"><p>{error}</p><button onClick={()=>setRetry(value=>value+1)}>إعادة المحاولة</button></div>:<>
      {tab==='overview'&&<div className="ad-brief-content">
        {data&&<div className="ad-stats">{[['requests','طلب مرتبط'],['tasks','مهمة مسندة'],['deliveries','تسليم مرفوع'],['completed','طلب مكتمل']].map(([key,label])=><div key={key}><strong>{data.stats[key]}</strong><span>{label}</span></div>)}</div>}
        <section><h3>البيانات الأساسية</h3><dl className="ad-facts">{[['الاسم',user.display_name],['البريد',user.email],['الجوال',user.phone],['اسم جهة التواصل',data?.contact_name],['تاريخ الانضمام',accountDate(user.created_at)],['آخر دخول',user.last_sign_in_at?accountDate(user.last_sign_in_at):'لم يسجل الدخول'],['كلمة المرور',user.role==='client'?'لا يوجد دخول للعميل':user.must_change_password?'بانتظار تعيين كلمة المرور الخاصة':'تم إعداد الحساب'],['تنسيق الطلبات',data?.coordinator?'المشرف المسؤول':null]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt>{label}</dt><dd dir="auto">{value}</dd></div>)}</dl></section>
        {!!data?.departments?.length&&<section><h3>الأقسام والمسؤوليات</h3><div className="ad-tags">{data.departments.map((department,index)=><span key={index}>{department.name}{department.role==='lead'?' — مسؤول القسم':''}</span>)}</div></section>}
        {user.role==='admin'&&<section><h3>الصلاحيات الممنوحة</h3><div className="ad-tags">{user.permissions?.length?user.permissions.map(permission=><span key={permission}>{adminPermissions[permission]||'صلاحية إدارية'}</span>):<p>لا توجد صلاحيات إضافية</p>}</div></section>}
        {user.role!=='client'&&user.invitation_id&&<section><h3>حالة دعوة الحساب</h3><div className="ad-tags">{user.email&&!user.phone_only&&<span>البريد {deliveryLabel(user.email_status)}</span>}<span>واتساب {deliveryLabel(user.whatsapp_status)}</span></div></section>}
        {user.suspension_reason&&<section><h3>سبب آخر إجراء على الحالة</h3><p>{user.suspension_reason}</p>{user.suspended_until&&<p>نهاية الإيقاف {accountDate(user.suspended_until)}</p>}</section>}
      </div>}
      {tab==='work'&&data&&<div className="ad-brief-content"><div className="ad-tags"><span>{data.stats.files} مرفق مرفوع</span><span>{data.stats.events} إجراء في العمل</span></div><section><h3>آخر الطلبات المرتبطة</h3><p className="ad-help">أحدث عشرة طلبات تخص الحساب أو أسندت إليه</p>{data.requests.length?<ul className="ad-requests">{data.requests.map(request=><li key={request.id}><div><small>طلب {request.number}</small><strong>{request.title}</strong></div><span>{states[request.status]||'جار المتابعة'}</span><time>{accountDate(request.updated_at)}</time></li>)}</ul>:<p>لا توجد طلبات مرتبطة بهذا الحساب</p>}</section><section><h3>آخر نشاط في المنصة</h3><p className="ad-help">أحدث عشرين إجراء للحساب والإجراءات الإدارية المرتبطة به</p>{data.activity.length?<ol className="ad-timeline">{data.activity.map(item=><li key={item.id}><strong>{events[item.kind]||auditLabels[item.kind]||'تحديث في المنصة'}</strong><time>{accountDate(item.created_at)}</time>{item.subject&&<p>{item.subject}</p>}{item.note&&<p>{item.note}</p>}</li>)}</ol>:<p>لا يوجد نشاط مسجل حتى الآن</p>}</section></div>}
      {tab==='manage'&&owner&&<div className="ad-management"><h3>إجراءات السوبر أدمن</h3><p>الإجراءات مرتبطة بالحساب المحدد وتسجل في سجل الإدارة</p>{renderActions(user)}</div>}
    </>}
  </dialog>;
}
