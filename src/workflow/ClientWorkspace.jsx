import {riyadhDate} from '../shared/date-only';
import React,{useEffect,useRef,useState} from 'react';
import {useSessionState,useSessionStore} from '../shared/session-state';
import {Plus,ArrowRight,ArrowUpLeft,FolderOpen,CheckCircle2,Clock3,MessageSquare,Layers3,BellRing,UserRound,Menu,X,UploadCloud,File,Trash2} from 'lucide-react';
import {repository,call,when,workError,uploadFile} from './data';
import Notifications from './Notifications';
import ClientRequestForm from './ClientRequestForm';
import ClientProfile from './ClientProfile';
import ClientRequestTimeline from './ClientRequestTimeline';
import {InquiryTriggers,InquiryDialog} from './DepartmentInquiries';
import ClientAttachments from './ClientAttachments';
import {DriveResource} from './DriveResource';
import {requestDriveUrl} from './drive-resources';
import AttachmentActions from './AttachmentActions';
import AttachmentPreview from './AttachmentPreview';
import ServiceCatalog from './ServiceCatalog';
import NotificationCenter from './NotificationCenter';
import {groupDeliveryFiles} from './attachment-files';
import {clientSchedule} from './client-schedule';
import './workflow.css';
import './client-workspace.css';
import './client-request-detail.css';

// Re-enable the client catalog in phase two without changing the shared staff/admin catalog
const CLIENT_SERVICE_CATALOG_ENABLED=false;

const statusTone=r=>r.status==='draft'?'draft':r.status==='declined'?'declined':r.status==='completed'?'completed':r.ready?'ready':r.status==='new'?'intake':r.status==='needs_info'?'needs-info':'working';
const statusLabels={draft:'لم يرسل بعد',declined:'تعذر اعتماد الطلب',completed:'منتهي وتم استلامه',ready:'جاهز للاستلام',intake:'بانتظار استلام المشرف المسؤول','needs-info':'نحتاج معلومات منك',working:'قيد العمل'};
const label=r=>statusLabels[statusTone(r)];
const numberFormatter=new Intl.NumberFormat('en-US',{useGrouping:false});
const projectDateFormatter=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',calendar:'gregory',numberingSystem:'latn',day:'numeric',month:'long',year:'numeric'});
const projectDate=value=>{
 if(!value)return null;
 const day=riyadhDate(value);
 return day?<time dateTime={day}>{projectDateFormatter.format(new Date(`${day}T12:00:00+03:00`))}</time>:null;
};
function DepartmentDates({departments,limit=2}){
 const item=department=><li key={department.id} className={department.dueAt?'is-confirmed':'is-pending'}><span title={department.name}>{department.name}<small className={`c-department-task-state${department.status==='needs_info'?' needs-info':''}`}>{department.statusLabel}</small></span><span>{department.dueAt?projectDate(department.dueAt):department.state==='unaccepted'?'بانتظار الاستلام':'قيد اعتماد الموعد'}</span></li>;
 return <div className="c-department-dates"><span className="c-department-label"><Layers3 size={15} aria-hidden="true"/>تسليم الأقسام</span><ul className="c-department-list" aria-label="مواعيد تسليم الأقسام">{departments.slice(0,limit).map(item)}</ul>{departments.length>limit&&<details className="c-department-more"><summary>بقية الأقسام <b dir="ltr">+{departments.length-limit}</b></summary><ul className="c-department-list">{departments.slice(limit).map(item)}</ul></details>}</div>;
}
const projectNext=r=>r.status==='draft'
 ?{label:'إكمال الطلب',hint:'الطلب محفوظ بانتظار إرسالك',tone:'action'}
 :r.status==='declined'
  ?{label:'عرض سبب القرار',hint:'قرار الإدارة موضح داخل الطلب',tone:'action'}
 :r.ready
  ?{label:'مراجعة واستلام',hint:'التسليم جاهز وينتظر قرارك',tone:'action'}
  :r.status==='needs_info'
   ?{label:'إرسال المعلومات',hint:'الفريق ينتظر معلوماتك',tone:'action'}
   :r.status==='completed'
    ?{label:'عرض المشروع',hint:'تم الاستلام رسميا',tone:'complete'}
    :r.status==='new'
     ?{label:'عرض التفاصيل',hint:'لدى المشرف المسؤول',tone:'waiting'}
     :{label:'متابعة التقدم',hint:'الفريق يعمل على طلبك',tone:'working'};

function ClientProjectRow({request:r,profile,onOpen}){
 const card=useRef(null),[schedule,setSchedule]=useState(null),[scheduleError,setScheduleError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(r.status==='draft')return;
  let active=true,visible=false,busy=false,timer;
  const load=async()=>{
   if(!active||!visible||document.hidden||busy)return;
   busy=true;
   try{const next=await repository.clientSchedule(r.id);if(active){setSchedule(next);setScheduleError(false);}}
   catch{if(active){setSchedule(null);setScheduleError(true);}}
   finally{busy=false;}
  };
  const observe=entries=>{visible=entries.some(entry=>entry.isIntersecting);clearInterval(timer);if(visible){load();timer=setInterval(load,30000);}};
  const observer=new IntersectionObserver(observe,{rootMargin:'100px'});
  observer.observe(card.current);
  const resume=()=>{if(!document.hidden)load();};
  document.addEventListener('visibilitychange',resume);
  return()=>{active=false;observer.disconnect();clearInterval(timer);document.removeEventListener('visibilitychange',resume);};
 },[r.id,r.version,r.status,attempt]);
 const next=projectNext(r),contact=profile?.contact_name?.trim();
 const submitted=projectDate(schedule?.submittedAt||r.submitted_at),due=projectDate(r.requested_due_at);
 const received=r.status==='completed'&&projectDate(r.received_at);
 return <article ref={card} className={`c-project-row is-${next.tone}`} aria-labelledby={`project-title-${r.id}`}>
  <header className="c-project-head">
   <div className="c-project-copy"><span className="c-project-number">طلب <b dir="ltr">{numberFormatter.format(r.number)}</b></span><h3 id={`project-title-${r.id}`}>{r.title}</h3></div>
   <div className="c-tags"><span className="c-status" data-status={statusTone(r)}>{label(r)}</span>{r.priority==='urgent'&&<span className="c-urgent" data-status="urgent">مستعجل</span>}</div>
  </header>
  <dl className="c-project-meta">
   <div className="c-project-uploader"><dt><UserRound size={15} aria-hidden="true"/>مسؤول الرفع</dt><dd title="المسؤول المسجل في الحساب">{contact||'غير محدد'}</dd></div>
   <div><dt><UploadCloud size={15} aria-hidden="true"/>تاريخ الإرسال</dt><dd>{r.status==='draft'?'لم يرسل بعد':submitted||(!schedule&&!scheduleError?'جار التحميل':'غير متاح')}</dd></div>
   <div className="c-project-expected"><dt><Clock3 size={15} aria-hidden="true"/>الموعد المطلوب</dt><dd>{due||'لم يحدد'}<small>طلب العميل وليس موعدا نهائيا</small></dd></div>
  </dl>
  {schedule?.departments.length?<DepartmentDates departments={schedule.departments}/>:<div className="c-department-empty">{scheduleError?<><span>تعذر تحميل مواعيد الأقسام</span><button type="button" onClick={()=>setAttempt(value=>value+1)}>إعادة المحاولة</button></>:<><Layers3 size={15} aria-hidden="true"/><span>{r.status==='draft'?'تظهر مواعيد الأقسام بعد إرسال الطلب':!schedule?'جار تحميل مواعيد الأقسام':['completed','declined'].includes(r.status)?'لا توجد مواعيد أقسام متاحة':'تحدد مواعيد الأقسام بعد استلام المهام'}</span></>}</div>}
  <button type="button" className="c-project-open" aria-label={`${next.label} طلب ${r.number} ${r.title}`} onClick={()=>onOpen(r.id)}><span>{next.label}</span><ArrowUpLeft size={19} aria-hidden="true"/></button>
  {received&&<p className="c-project-outcome"><CheckCircle2 size={15} aria-hidden="true"/>تم الاستلام {received}</p>}
 </article>;
}

export default function ClientWorkspace({user,onLogout}){
 const store=useSessionStore();
 const [requestedView,setView]=useSessionState('client:view','projects',{validate:value=>['projects','services','receive','notifications','account'].includes(value)}),[filter,setFilter]=useSessionState('client:filter','all',{validate:value=>['all','intake','working','ready','completed','urgent'].includes(value)}),[search,setSearch]=useSessionState('client:search',''),[page,setPage]=useSessionState('client:page',0,{validate:value=>Number.isInteger(value)&&value>=0}),[board,setBoard]=useState({items:[],counts:{}}),[profile,setProfile]=useState(null),[selected,setSelected]=useSessionState('client:selected',null),[form,setFormState]=useState(null),[formLocation,setFormLocation]=useSessionState('client:form-location',null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[navigationOpen,setNavigationOpen]=useState(false);
 const view=requestedView==='services'&&!CLIENT_SERVICE_CATALOG_ENABLED?'projects':requestedView;
 const [restoreAttempt,setRestoreAttempt]=useState(0);
 const revision=useRef(0),mounted=useRef(true),heading=useRef(null),navigationToggle=useRef(null),navigationClose=useRef(null);
 function setForm(next){if(!next&&formLocation)store?.clearPrefix(`client:request-form:${formLocation.key}:`);setFormState(next);setFormLocation(next?{key:crypto.randomUUID(),draftId:next.draft?.id||null,serviceId:next.service?.id||null}:null);}
 useEffect(()=>{
  if(!formLocation||form)return undefined;
  let live=true;
  Promise.all([formLocation.draftId?repository.request(formLocation.draftId):null,formLocation.serviceId?repository.serviceCatalog(false):[]]).then(([draft,services])=>{
   if(!live)return;
   if(draft&&draft.status!=='draft'){setForm(null);setSelected(draft.id);setView('projects');return;}
   setFormState({draft,service:services.find(service=>service.id===formLocation.serviceId)||null});
  }).catch(reason=>{if(live)setError(workError(reason));});
  return()=>{live=false;};
 },[formLocation,form,restoreAttempt]);
 async function refresh(){const serial=++revision.current;const next=await repository.clientBoard(view==='receive'?'ready':filter,search,page);if(mounted.current&&serial===revision.current){setBoard(next);setLoading(false);setError('');}}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;revision.current++;};},[]);
 useEffect(()=>{let live=true;repository.clientProfile().then(p=>{if(live)setProfile(p);}).catch(()=>{});return()=>{live=false;};},[user.id]);
 useEffect(()=>{if(!['projects','receive'].includes(view)){setLoading(false);return undefined;}setLoading(true);const timer=setTimeout(()=>refresh().catch(e=>{if(mounted.current){setError(workError(e));setLoading(false);}}),180);const poll=setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},15000);return()=>{clearTimeout(timer);clearInterval(poll);revision.current++;};},[view,filter,search,page,user.id]);
 useEffect(()=>{heading.current?.focus();},[view]);
 useEffect(()=>{if(!navigationOpen)return undefined;requestAnimationFrame(()=>navigationClose.current?.focus());const close=event=>{if(event.key==='Escape'){setNavigationOpen(false);requestAnimationFrame(()=>navigationToggle.current?.focus());}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[navigationOpen]);
 function navigate(next){const moveFocus=navigationOpen;setView(next);setSelected(null);setPage(0);setSearch('');setError('');setNavigationOpen(false);if(moveFocus)requestAnimationFrame(()=>heading.current?.focus());}
 function selectProjectScope(id){setSelected(null);setPage(0);setSearch('');setError('');if(id==='ready'){setView('receive');setFilter('all');}else{setView('projects');setFilter(id);}setNavigationOpen(false);requestAnimationFrame(()=>heading.current?.focus());}
 async function openRequest(id){if(!id){navigate('account');return;}setError('');try{const r=await repository.request(id);if(r.status==='draft')setForm({draft:r});else{setSelected(id);setView('projects');}}catch(e){setError(workError(e));}}
 const navigation=[['projects',FolderOpen,'مشاريعي',board.counts.all],['services',Layers3,'دليل الخدمات',null],['receive',CheckCircle2,'استلام الطلبات',board.counts.ready],['notifications',BellRing,'مركز الإشعارات',null],['account',UserRound,'بيانات حسابي',null]].filter(([id])=>id!=='services'||CLIENT_SERVICE_CATALOG_ENABLED);
 const viewTitles={projects:'مشاريعي',services:'دليل الخدمات',receive:'استلام الطلبات',notifications:'مركز الإشعارات',account:'بيانات حسابي'};
 const metrics=[
  {id:'all',title:'كل المشاريع',hint:'صورة كاملة',Icon:FolderOpen,count:board.counts.all},
  {id:'intake',title:'بانتظار التواصل',hint:'تحت الاستلام',Icon:Clock3,count:board.counts.intake},
  {id:'working',title:'قيد العمل',hint:'تحت متابعة الفريق',Icon:Layers3,count:board.counts.working},
  {id:'ready',title:'جاهزة لك',hint:'تحتاج مراجعتك',Icon:MessageSquare,count:board.counts.ready},
  {id:'completed',title:'تم استلامها',hint:'مشاريع مكتملة',Icon:CheckCircle2,count:board.counts.completed}
 ];
 return <div className="c-root c-dashboard" dir="rtl">
  <aside className={`c-sidebar ${navigationOpen?'is-open':''}`}><div className="c-sidebar-head"><a href="/" aria-label="صيت الرئيسية"><img src="/brand/seet-logo-light.svg" alt="صيت"/></a><button ref={navigationOpen?navigationClose:navigationToggle} type="button" className="c-navigation-toggle" aria-controls="client-navigation" aria-expanded={navigationOpen} onClick={()=>setNavigationOpen(open=>!open)}>{navigationOpen?<X size={20} aria-hidden="true"/>:<Menu size={20} aria-hidden="true"/>}{navigationOpen?'إغلاق':'القائمة'}</button></div><div className="c-sidebar-label"><span className="c-kicker">مساحة العميل</span><small>إدارة مشاريعك وتسليماتك</small></div><nav id="client-navigation" aria-label="أقسام مساحة العميل">{navigation.map(([id,Icon,title,count])=><button type="button" key={id} aria-current={view===id?'page':undefined} onClick={()=>navigate(id)}><span className="c-sidebar-icon"><Icon size={19} aria-hidden="true"/></span><span className="c-sidebar-link">{title}</span>{count>0&&<b>{numberFormatter.format(count)}</b>}</button>)}</nav><div className="c-sidebar-account"><span className="c-account-icon"><UserRound size={19} aria-hidden="true"/></span><span><small className="c-account-role">حساب العميل</small>{profile?.display_name||'عميل صيت'}<small dir="ltr">{profile?.email||user.email}</small></span></div><button type="button" className="c-sidebar-logout" onClick={onLogout}>تسجيل الخروج</button></aside>
  <main className="c-shell">
  <header className="c-header"><div className="c-header-context"><span className="c-kicker">منصة إدارة مشاريعك</span><strong>{viewTitles[view]}</strong></div><div className="c-actions"><Notifications user={user} onOpen={openRequest}/></div></header>
  <div className="c-intro"><div className="c-intro-copy"><span className="c-kicker">مساحتك مع صيت</span><h1 className="c-client-name" ref={heading} tabIndex={-1}><bdi>{profile?.display_name?.trim()||'مساحة العميل'}</bdi></h1><p className="c-intro-tagline">من فكرتك إلى استلام مشروعك</p><p className="c-intro-description">ارفع طلبك وتابع تقدمه واستلم أعمالك من هنا</p></div><button className="c-primary c-new-request" onClick={()=>{setMessage('');setForm({draft:null,service:null});}}><Plus size={21}/>إنشاء طلب</button></div>
  {['projects','receive'].includes(view)&&<section className="c-metrics" aria-label="ملخص المشاريع">{metrics.map(({id,title,hint,Icon,count})=>{const active=id==='ready'?view==='receive':view==='projects'&&filter===id;const total=numberFormatter.format(Number(count)||0);return <button type="button" key={id} data-status={id} aria-pressed={active} aria-label={`${title} ${total}`} title={hint} onClick={()=>selectProjectScope(id)}><Icon className="c-metric-icon" size={20} aria-hidden="true"/><span className="c-metric-label">{title}</span><strong className="c-metric-count" dir="ltr">{total}</strong></button>;})}</section>}
  {error&&<div className="c-notice c-error" role="alert">{error}<button onClick={()=>{setError('');setRestoreAttempt(value=>value+1);refresh().catch(e=>setError(workError(e)));}}>إعادة المحاولة</button></div>}
  {message&&<p className="c-notice" role="status"><CheckCircle2 size={19}/>{message}</p>}
  {view==='account'?<ClientProfile onChanged={setProfile}/>:view==='services'?<ServiceCatalog onRequest={service=>{setMessage('');setForm({draft:null,service});}}/>:view==='notifications'?<NotificationCenter user={user} onOpen={openRequest}/>:selected?<ClientRequest key={selected} id={selected} onBack={()=>setSelected(null)} onChange={refresh}/>:<section className="c-projects">
   {loading?<div className="c-project-loading" role="status"><span aria-hidden="true"/><strong>جار تحميل مشاريعك</strong><small>نجهز أحدث حالة لكل مشروع</small></div>:!board.items.length?<div className="c-empty"><FolderOpen size={34}/><h3>{search?'لا توجد نتائج مطابقة':view==='receive'?'ستجد تسليماتك هنا فور جاهزيتها':filter==='all'?'نبدأ بأول طلب لك':'لا توجد مشاريع بهذه الحالة'}</h3><p>{view==='receive'?'سنرسل لك إشعارا عندما يكون العمل جاهزا للمراجعة':'صف فكرتك لفريق الإشراف وسنتولى بقية الخطوات'}</p>{view!=='receive'&&<button className="c-primary" onClick={()=>setForm({draft:null})}><Plus size={18}/>إنشاء طلب</button>}</div>:<div className="c-project-list">{board.items.map(r=><ClientProjectRow key={r.id} request={r} profile={profile} onOpen={openRequest}/>)}</div>}
   {(page>0||board.items.length===20)&&<footer className="c-pagination"><button disabled={!page} onClick={()=>setPage(n=>n-1)}>السابق</button><span>الصفحة {page+1}</span><button disabled={board.items.length<20} onClick={()=>setPage(n=>n+1)}>التالي</button></footer>}
  </section>}
  <footer className="c-footer"><span>معك من البداية إلى الأثر</span><a href="/">زيارة موقع صيت <ArrowUpLeft size={15}/></a></footer>
   {form&&<ClientRequestForm key={formLocation?.key} formKey={formLocation?.key} draft={form.draft} service={form.service} onClose={()=>{setForm(null);refresh().catch(()=>{});}} onSent={id=>{setForm(null);setSelected(id);setView('projects');setMessage('وصل طلبك لالمشرف المسؤول وسنطلعك على كل جديد');refresh().catch(()=>{});}}/>}
  </main>
 </div>;
}

function RequestBrief({brief=''}){
 const [expanded,setExpanded]=useState(false);
 const preview=brief.split('\n').slice(0,4).join('\n').slice(0,320);
 const canExpand=preview.length<brief.length;
 return <div className="c-request-description"><h4>وصف الطلب</h4><p className="c-brief" id="client-request-brief">{expanded?brief:preview}</p>{canExpand&&<button type="button" className="c-request-brief-toggle" aria-expanded={expanded} aria-controls="client-request-brief" onClick={()=>setExpanded(value=>!value)}>{expanded?'اختصار الوصف':'عرض الوصف كاملًا'}</button>}</div>;
}

function ClientRequest({id,onBack,onChange}){
 const prefix=`client:request:${id}:`,store=useSessionStore();
 const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reviewLocation,setReviewLocation]=useSessionState(prefix+'review-location',null),[reason,setReason]=useSessionState(prefix+'reply:reason',''),[responseFiles,setResponseFiles]=useSessionState(prefix+'reply:files',[]),[busy,setBusy]=useState(false),[preview,setPreview]=useState(null);
 function setReview(next){if(!next&&reviewLocation)store?.clearPrefix(prefix+`review:${reviewLocation.deliveryId}:${reviewLocation.decision}:`);setReviewLocation(next?{deliveryId:next.delivery.id,decision:next.decision,version:next.version}:null);}
 const [responseProgress,setResponseProgress]=useState(null);
 const [inquirySelection,setInquirySelection]=useSessionState(prefix+'inquiry-selection',null);
 const title=useRef(null),locked=useRef(false),alive=useRef(true);
 async function refresh(){const next=await repository.clientDetail(id);if(alive.current)setData(next);}
 useEffect(()=>{alive.current=true;refresh().catch(e=>{if(alive.current)setError(workError(e));});const timer=setInterval(()=>{if(!document.hidden&&!locked.current)refresh().catch(()=>{});},15000);return()=>{alive.current=false;clearInterval(timer);};},[id]);
 useEffect(()=>{if(data)title.current?.focus();},[!!data]);
 async function supply(e){e.preventDefault();if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');setResponseProgress({message:'جار تجهيز الرد'});try{
  let version=data.request.version,uploaded=[];
  if(responseFiles.length){
   for(const [index,file] of responseFiles.entries()){
    const message=`رفع الملف ${index+1} من ${responseFiles.length}`;
    setResponseProgress({message,filename:file.name,percent:0});
    uploaded.push(await uploadFile(id,'brief',file,{onProgress:percent=>setResponseProgress({message,filename:file.name,percent})}));
   }
   setResponseProgress({message:'جار ربط المرفقات بالطلب'});
   await call('attach',{request_id:id,version,files:uploaded.map(file=>({object_path:file.object_path,filename:file.filename}))});
   version=(await repository.request(id)).version;
  }
  setResponseProgress({message:'جار إرسال الرد لالمشرف المسؤول'});
  await call('supply_info',{request_id:id,version,reason});uploaded.forEach(file=>repository.forgetUpload(file.cache_key));setReason('');setResponseFiles([]);store?.clearPrefix(prefix+'reply:');setNotice('وصل ردك إلى فريق الإشراف');setResponseProgress({message:'تم إرسال الرد بنجاح'});await refresh();await onChange();
 }catch(e){setError(workError(e));setResponseProgress(null);await refresh().catch(()=>{});}finally{locked.current=false;setBusy(false);}}
 if(!data)return <section className="c-detail"><button onClick={onBack}><ArrowRight size={18}/>العودة لمشاريعي</button>{error?<p role="alert">{error}<button onClick={()=>refresh().catch(e=>setError(workError(e)))}>إعادة المحاولة</button></p>:<p role="status">جار تحميل تفاصيل المشروع</p>}</section>;
 const batches=groupDeliveryFiles(data.deliveries);
 const r=data.request,ready=batches.filter(d=>d.files.every(f=>f.status==='pending'&&f.released_at&&f.reviewable!==false)),approved=batches.filter(d=>d.files.every(f=>f.status==='approved')),changes=batches.filter(d=>d.files.every(f=>f.status==='changes'));
 const reviewDelivery=reviewLocation&&ready.find(delivery=>delivery.id===reviewLocation.deliveryId);
 const review=reviewDelivery?{delivery:reviewDelivery,decision:reviewLocation.decision,version:reviewLocation.version}:null;
 const declined=r.status==='declined';
 const declineEvent=[...data.events].filter(event=>event.kind==='decline_intake').sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0))[0];
 const declineReason=declineEvent?.note?.trim()||'تعذر اعتماد الطلب في حالته الحالية';
 const batchTitle=d=>d.files.length===1?d.filename:`${d.files.length} ملفات في تسليم واحد`;
 const needInfo=r.status==='needs_info';
 const informationRequest=[...data.events].filter(event=>['request_info','request_attachments'].includes(event.kind)).sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0))[0];
 const attachmentsRequested=informationRequest?.kind==='request_attachments';
 const renderDeliveries=stage=>(
  <section className="c-deliveries" aria-label={stage==='received'?'التسليمات المستلمة':'مراجعة واستلام التسليمات'}><div className="c-section-heading"><h4>{stage==='received'?'التسليمات المستلمة':'ملفات التسليم'}</h4></div>
   {!approved.length&&(stage==='received'||!ready.length)&&<p className="c-muted">{stage==='received'?'تظهر هنا التسليمات بعد اعتماد استلامها':'سيظهر التسليم هنا بعد إرساله من المشرف المسؤول'}</p>}
   {stage==='review'&&ready.map(d=><article className="c-delivery" key={d.batch_id||d.id}><div><span className="c-status" data-status="ready">جاهز لمراجعتك</span><h4>{batchTitle(d)}</h4>{d.note&&<p className="c-brief">{d.note}</p>}<small>{when(d.created_at)}</small>{d.files.map(f=><AttachmentActions key={f.id} file={f} onPreview={setPreview}/>)}</div><div className="c-actions"><button className="c-primary" onClick={()=>setReview({delivery:d,decision:'approve',version:r.version})}><CheckCircle2 size={17}/>اعتماد واستلام نهائي</button><button onClick={()=>setReview({delivery:d,decision:'changes',version:r.version})}><MessageSquare size={17}/>طلب تعديل</button></div></article>)}
   {approved.map(d=><article className="c-delivery is-received" key={d.batch_id||d.id}><div><span className="c-status" data-status="completed"><CheckCircle2 size={15}/>تم الاستلام رسميا</span><h4>{batchTitle(d)}</h4>{d.received_at&&<small>{when(d.received_at)}</small>}{d.files.map(f=><AttachmentActions key={f.id} file={f} onPreview={setPreview}/>)}</div></article>)}
   {changes.length>0&&<details className="c-revisions"><summary>طلبات التعديل السابقة</summary>{changes.map(d=><article key={d.batch_id||d.id}><strong>{batchTitle(d)}</strong><p className="c-brief">{d.feedback}</p><small>{when(d.created_at)}</small>{d.files.map(f=><AttachmentActions key={f.id} file={f} onPreview={setPreview}/>)}</article>)}</details>}
  </section>
 );
 const schedule=clientSchedule(data);
 return <section className="c-detail"><button className="c-back" onClick={onBack}><ArrowRight size={18}/>العودة لمشاريعي</button><div className="c-detail-head"><div><span className="c-kicker">طلب {r.number}</span><h2 ref={title} tabIndex={-1}>{r.title}</h2></div><div className="c-tags"><span className="c-status" data-status={statusTone({...r,ready:ready.length>0})}>{label({...r,ready:ready.length>0})}</span>{r.priority==='urgent'&&<span className="c-urgent" data-status="urgent">مستعجل</span>}</div></div>
  {error&&<p className="c-notice c-error" role="alert">{error}</p>}{notice&&<p className="c-notice" role="status">{notice}</p>}
  {declined&&<section className="c-info-request" aria-labelledby="client-decline-title"><span className="c-kicker">قرار الإدارة</span><h3 id="client-decline-title">تعذر اعتماد الطلب</h3><div><strong>سبب القرار</strong><p className="c-brief">{declineReason}</p></div>{(declineEvent?.created_at||r.updated_at)&&<small>صدر القرار {when(declineEvent?.created_at||r.updated_at)}</small>}</section>}
  <section className="c-request-info" aria-labelledby="client-request-info-title">
   <h3 id="client-request-info-title">بيانات الطلب</h3>
   <div className="c-request-info-main">
    <RequestBrief key={r.id} brief={r.brief||''}/>
    <dl className="c-request-dates"><div><dt>تاريخ الإرسال</dt><dd>{projectDate(schedule.submittedAt)||'غير متاح'}</dd></div><div><dt>الموعد المطلوب من العميل</dt><dd>{projectDate(r.requested_due_at)||'لم يحدد'}</dd><dd className="c-request-date-note">ليس موعد التسليم النهائي</dd></div></dl>
   </div>
   {schedule.departments.length>0&&<DepartmentDates departments={schedule.departments}/>}
   <div className="c-request-resource-row">{data.files.length>0&&<ClientAttachments files={data.files} onPreview={setPreview}/>}<DriveResource url={requestDriveUrl(r)}/><InquiryTriggers inquiries={data.inquiries} onOpen={setInquirySelection}/></div>
  </section>
  {needInfo&&r.status!=='completed'&&<form className="c-info-request" onSubmit={supply}><h3>{attachmentsRequested?'أرفق المطلوب ونكمل':'معلومة منك ونكمل'}</h3>{informationRequest?.note&&<p>{informationRequest.note}</p>}<div className="w-upload-picker"><UploadCloud size={28} aria-hidden="true"/><strong>{attachmentsRequested?'إضافة المرفقات المطلوبة':'إرفاق ملفات مع الرد'}</strong><label>اختيار الملفات<input type="file" multiple required={attachmentsRequested&&!responseFiles.length} disabled={busy} onChange={event=>{const selectedFiles=Array.from(event.target.files||[]);setResponseFiles(current=>{const keys=new Set(current.map(file=>`${file.name}:${file.size}:${file.lastModified}`));return [...current,...selectedFiles.filter(file=>{const key=`${file.name}:${file.size}:${file.lastModified}`;if(keys.has(key))return false;keys.add(key);return true;})];});event.target.value='';}}/></label>{responseFiles.length>0&&<div className="w-upload-list">{responseFiles.map(file=><div className="w-upload-item" key={`${file.name}:${file.size}:${file.lastModified}`}><File size={18} aria-hidden="true"/><div><b dir="auto">{file.name}</b><small>{Math.max(1,Math.ceil(file.size/1024))} KB</small></div><button type="button" disabled={busy} aria-label={`إزالة ${file.name}`} onClick={()=>setResponseFiles(current=>current.filter(item=>item!==file))}><Trash2 size={17} aria-hidden="true"/></button></div>)}</div>}</div><label>{attachmentsRequested?'ملاحظة على المرفقات':'المعلومات المطلوبة'}<textarea value={reason} onChange={e=>setReason(e.target.value)} required minLength={3} maxLength={4000} rows={3} disabled={busy}/></label><div className="c-response-feedback">{responseProgress&&<div className="c-notice c-upload-progress" role="status" aria-live="polite"><strong>{responseProgress.message}</strong>{responseProgress.filename&&<span dir="auto">{responseProgress.filename}</span>}{responseProgress.percent!=null&&<><progress max="100" value={responseProgress.percent} aria-label="تقدم رفع الملف"/><span>{responseProgress.percent}%</span></>}</div>}{error&&<p className="c-notice c-error" role="alert">{error}</p>}</div><button className="c-primary" disabled={busy||attachmentsRequested&&!responseFiles.length}>{busy?'جار إرسال المطلوب':'إرسال المطلوب لالمشرف المسؤول'}</button></form>}

  <ClientRequestTimeline {...data} renderDeliveries={renderDeliveries} onRespondInquiry={id=>setInquirySelection({id})}/>
  {inquirySelection&&<InquiryDialog selection={inquirySelection} inquiries={data.inquiries} request={r} onClose={()=>setInquirySelection(null)} onPreview={setPreview} onSaved={async()=>{await refresh();await onChange();setNotice('وصل ردك مباشرة إلى القسم');}}/>}
  {review&&<ClientReview spec={review} requestId={id} onClose={()=>setReview(null)} onDone={async()=>{setReview(null);setNotice(review.decision==='approve'?'تم اعتماد التسليم واستلامه رسميا':'وصل طلب التعديل وسنبلغك فور جاهزية النسخة الجديدة');await refresh();await onChange();}}/>}
  {preview&&<AttachmentPreview key={preview.object_path} file={preview} onClose={()=>setPreview(null)}/>}
 </section>;
}

function ClientReview({spec,requestId,onClose,onDone}){
 const files=spec.delivery.files||[spec.delivery];
 const ref=useRef(null),lock=useRef(false);const [version,setVersion]=useState(spec.version),[reason,setReason]=useSessionState(`client:request:${requestId}:review:${spec.delivery.id}:${spec.decision}:reason`,''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const old=document.activeElement;ref.current.showModal();return()=>old?.focus?.();},[]);
 async function submit(e){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');let saved=false;try{await call('review',{request_id:requestId,version,delivery_id:spec.delivery.id,decision:spec.decision,reason});saved=true;}catch(e){const detail=await repository.clientDetail(requestId).catch(()=>null);if(detail)setVersion(detail.request.version);if(detail&&files.every(file=>detail.deliveries.some(d=>d.id===file.id&&d.status===(spec.decision==='approve'?'approved':'changes'))))saved=true;else setError(workError(e));}finally{lock.current=false;setBusy(false);}if(saved)await onDone().catch(()=>{});}
 return <dialog className="c-dialog c-root" ref={ref} aria-labelledby="client-review-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><form onSubmit={submit}><header className="c-dialog-head"><h2 id="client-review-title">{spec.decision==='approve'?'اعتماد الاستلام النهائي':'طلب تعديل على المشروع'}</h2><button type="button" onClick={onClose} disabled={busy}>إغلاق</button></header><p>{files.length===1?spec.delivery.filename:`يشمل هذا القرار جميع ملفات التسليم وعددها ${files.length}`}</p>{files.length>1&&<ul className="c-file-list">{files.map(file=><li key={file.id}><span className="c-file-name" dir="auto">{file.filename}</span></li>)}</ul>}{error&&<p className="c-notice c-error" role="alert">{error}</p>}
  {spec.decision==='approve'?<><p>بعد الاعتماد تصبح جميع ملفات هذا التسليم مستلمة رسميا ولا يمكن طلب تعديل عليها</p><label className="c-confirm"><input type="checkbox" required checked={accepted} onChange={e=>setAccepted(e.target.checked)} disabled={busy}/>راجعت جميع ملفات التسليم وأوافق على استلامها نهائيا</label></>:<label>ما التعديل الذي تحتاجه<textarea required minLength={3} maxLength={4000} rows={5} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy} placeholder="وضح لنا ملاحظاتك على هذا التسليم"/></label>}
  <button className="c-primary" disabled={busy||(spec.decision==='approve'&&!accepted)}>{busy?'جار الحفظ':spec.decision==='approve'?'تأكيد الاستلام النهائي':'إرسال طلب التعديل'}</button>
 </form></dialog>;
}
