import React,{useEffect,useRef,useState} from 'react';
import {Building2,Users,ShieldCheck,MessageSquare,ArrowLeft,RefreshCw,CheckCircle2} from 'lucide-react';
import {repository,workError} from './data';
import {useSessionState} from '../shared/session-state';

const staffDraft=staff=>({capacity:staff?.capacity||5,coordinator:staff?.coordinator||false,services:[...(staff?.services||[])],expected_services:[...(staff?.services||[])]});

export default function WorkSettings({data,refresh,owner,onDepartments}){
 const [person,setPerson]=useSessionState('settings.person','',{validate:value=>typeof value==='string'});
 const [message,setMessage]=useState(''),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[health,setHealth]=useState([]),[healthLoading,setHealthLoading]=useState(true),[healthError,setHealthError]=useState('');
 const running=useRef(false);
 const settingsStaff=data.settings_staff||[];
 const employees=settingsStaff.filter(staff=>staff.role==='employee'),employee=employees.find(staff=>staff.id===person),admins=settingsStaff.filter(staff=>staff.role==='admin');
 const [draft,setDraft,draftState]=useSessionState(`settings.staff.${person||'unselected'}`,()=>staffDraft(employee),{validate:value=>Boolean(value&&Array.isArray(value.services)&&Array.isArray(value.expected_services)&&typeof value.coordinator==='boolean')});
 const {capacity,coordinator,services}=draft;
 const setCapacity=value=>setDraft(current=>({...current,capacity:value}));
 const setCoordinator=value=>setDraft(current=>({...current,coordinator:value}));
 const setServices=next=>setDraft(current=>({...current,services:typeof next==='function'?next(current.services):next}));
 useEffect(()=>{if(employee)draftState.initialize(staffDraft(employee));},[person,data.settings_staff,draftState]);
 useEffect(()=>{if(!owner)return;let live=true;repository.deliveryHealth().then(rows=>{if(live)setHealth(rows);}).catch(()=>{if(live)setHealthError('تعذر تحميل حالة الرسائل');}).finally(()=>{if(live)setHealthLoading(false);});return()=>{live=false;};},[owner]);
 async function loadHealth(){setHealthLoading(true);setHealthError('');try{setHealth(await repository.deliveryHealth());}catch{setHealthError('تعذر تحميل حالة الرسائل');}finally{setHealthLoading(false);}}
 async function run(fn,success='تم حفظ الإعدادات',onSaved){
  if(running.current)return;running.current=true;setBusy(true);setMessage('');setFailed(false);
  try{await fn();onSaved?.();setMessage(success);try{await refresh();}catch{setMessage(success+' وتعذر تحديث العرض أعد تحميل الصفحة لعرض آخر البيانات');}}
  catch(error){setFailed(true);setMessage(workError(error));}
  finally{running.current=false;setBusy(false);}
 }
 if(!owner)return <div className="w-empty"><ShieldCheck size={30}/><h3>صلاحيات الخدمات</h3><p>إعداد صلاحيات الخدمات متاح للسوبر أدمن</p></div>;
 return <div className="w-settings">
  <div className="w-settings-summary"><div><Building2 size={20}/><strong>{data.services.length}</strong><span>خدمات وأقسام</span></div><div><Users size={20}/><strong>{employees.length}</strong><span>حسابات الموظفين</span></div><div><ShieldCheck size={20}/><strong>{admins.length}</strong><span>حسابات أدمن</span></div></div>
  {message&&<p role={failed?'alert':'status'} className={failed?'w-error':'w-success'}>{message}</p>}
  <section><header className="w-settings-heading"><Building2 size={22}/><div><span className="a-eyebrow">هيكل العمل</span><h3>الخدمات والأقسام</h3></div></header><p className="w-routing-hint">تتم إضافة الأقسام ومسؤولياتها ومهامها من مساحة إدارة الأقسام</p>
   <div className="w-tags">{data.services.length?data.services.map(service=><span key={service.id}>{service.name}{!service.active&&<small>غير مفعلة</small>}</span>):<p>أضف أول خدمة لبدء توزيع العمل</p>}</div>
   {onDepartments&&<button type="button" className="a-primary" onClick={onDepartments}>فتح إدارة الأقسام<ArrowLeft size={17}/></button>}
  </section>
  <section><header className="w-settings-heading"><Users size={22}/><div><span className="a-eyebrow">توزيع المسؤوليات</span><h3>إعداد الموظف</h3></div></header><p className="w-routing-hint">راجع أقسام الموظف واضبط حجم العمل المناسب له</p>
   <form onSubmit={event=>{event.preventDefault();if(!employee)return;run(()=>repository.saveStaffSettings({user_id:person,capacity:Number(capacity),coordinator,services,expected_services:draft.expected_services}),services.length?'تم حفظ أقسام الموظف وإعداداته':'تم حفظ الإعدادات دون ربط أقسام',()=>{draftState.clear();draftState.initialize({...draft,expected_services:[...services]});});}}>
    <label>الموظف<select required disabled={busy} value={person} onChange={event=>setPerson(event.target.value)}><option value="">اختر الموظف</option>{employees.map(staff=><option key={staff.id} value={staff.id}>{staff.name}{staff.pending_setup?' بانتظار تفعيل الحساب':''}</option>)}</select></label>
    {!employees.length&&<p className="w-routing-hint">أضف حسابات الموظفين من صفحة الحسابات أولا</p>}
    {employee&&<div className="w-staff-context"><strong>{employee.name}</strong><span>{employee.open_count||0} مهام مفتوحة حاليا</span></div>}
    {employee?.pending_setup&&<p className="w-routing-hint" role="status">بانتظار تفعيل الحساب يمكنك حفظ إعداد الموظف قبل أن يكمل إعداد كلمة المرور</p>}
    <label>الحد المناسب للمهام المفتوحة<input type="number" required min="1" max="100" disabled={busy||!person} value={capacity} onChange={event=>setCapacity(event.target.value)} aria-describedby="staff-capacity-hint"/></label><small id="staff-capacity-hint" className="w-routing-hint">يساعد في توضيح ضغط العمل عند إحالة المهام</small>
    <label className="w-checkbox"><input type="checkbox" disabled={busy||!person} checked={coordinator} onChange={event=>setCoordinator(event.target.checked)}/>المشرف المسؤول واستقبال الطلبات</label>
    {employee&&<fieldset disabled={busy}><legend>أقسام الموظف</legend><p className="w-routing-hint">حدد الأقسام التي يعمل فيها الموظف ليظهر ضمن فريقها عند توجيه الطلبات</p><div className="w-grant-grid">{data.services.map(service=><label className="w-checkbox" key={service.id}><input type="checkbox" checked={services.includes(service.id)} disabled={!service.active&&!services.includes(service.id)} onChange={event=>setServices(current=>event.target.checked?[...current,service.id]:current.filter(id=>id!==service.id))}/>{service.name}{!service.active?' غير مفعل':''}</label>)}</div>{!services.length&&<p className="w-routing-hint" role="status">لم تحدد أقساما للموظف بعد</p>}</fieldset>}
    <button disabled={busy||!person} className="a-primary">حفظ إعداد الموظف</button>
   </form>
  </section>
  <section className="w-wide"><header className="w-settings-heading"><ShieldCheck size={22}/><div><span className="a-eyebrow">الوصول الإداري</span><h3>صلاحيات الأدمن حسب الخدمة</h3></div></header><p className="w-routing-hint">يتابع الأدمن الطلبات وتحدد صلاحية الخدمة الأقسام التي يمكنه اتخاذ القرارات فيها</p>
   {!admins.length&&<div className="w-inline-empty"><Users size={23}/><p>أضف حساب أدمن من قسم الحسابات أولا</p></div>}
   <div className="w-grant-grid">{admins.map(admin=><fieldset key={admin.id} disabled={busy}><legend>{admin.name}</legend>{data.services.map(service=><label className="w-checkbox" key={service.id}><input type="checkbox" checked={!!data.grants.find(grant=>grant.user_id===admin.id&&grant.service_id===service.id)?.can_manage} onChange={event=>run(()=>repository.setup('grant',{user_id:admin.id,service_id:service.id,can_manage:event.target.checked}))}/>إدارة {service.name}</label>)}</fieldset>)}</div>
  </section>
  <section className="w-wide"><header className="w-settings-heading"><MessageSquare size={22}/><div><span className="a-eyebrow">الوصول إلى المستلمين</span><h3>متابعة إرسال واتساب</h3></div><button type="button" disabled={busy||healthLoading} onClick={loadHealth}><RefreshCw size={17}/>تحديث الحالة</button></header>
   {healthLoading?<p role="status">جار تحميل حالة الرسائل</p>:healthError?<p className="w-error" role="alert">{healthError}</p>:!health.length?<div className="w-inline-empty"><CheckCircle2 size={25}/><div><strong>لا توجد رسائل متعثرة</strong><p>تظهر هنا الرسائل التي تحتاج مراجعة الإرسال</p></div></div>:health.map(notification=><div className="w-delivery" key={notification.id}><strong>{notification.recipient_name}</strong><span className="w-status revision">{notification.whatsapp==='unknown'?'نتيجة الإرسال غير مؤكدة':'تعذر الإرسال'}</span><p>{notification.whatsapp==='unknown'?'تحقق من واتساب قبل إعادة المحاولة لتجنب تكرار الرسالة':'تحقق من رقم الجوال واتصال واتساب'}</p><button disabled={busy} onClick={()=>run(async()=>{await repository.retryNotification(notification.id);await loadHealth();},'تمت إعادة محاولة الإرسال')}>إعادة الإرسال</button></div>)}
  </section>
 </div>;
}
