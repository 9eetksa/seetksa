import React,{useEffect,useId,useRef,useState} from 'react';
import {useSessionState,useSessionStore} from '../shared/session-state';
import {Plus,ArrowLeft,FolderOpen,RefreshCw,AlertTriangle,CheckCircle2,Clock3,Search,SlidersHorizontal,UploadCloud,File,Trash2,Building2,UserRound,UsersRound,Mail,Phone,MessageCircle,X} from 'lucide-react';
import {repository,call,states,when,workError,uploadFile} from './data';
import {InquiryTriggers,InquiryDialog} from './DepartmentInquiries';
import {OutputAssignments,OutputRequests} from './OutputRequests';
import {outputDepartmentChoices,validateOutputSelection} from './output-requests';
import Notifications from './Notifications';
import WorkSettings from './WorkSettings';
import AttachmentActions from './AttachmentActions';
import AttachmentPreview from './AttachmentPreview';
import TeamRequestRoadmap from './TeamRequestRoadmap';
import TeamRequestRows from './TeamRequestRows';
import TaskDashboardRows from './TaskDashboardRows';
import TaskPlanner from './TaskPlanner';
import TaskDueInbox from './TaskDueInbox';
import PlannerMoveHistory from './PlannerMoveHistory';
import {plannerMoveAction} from './task-planner';
import {dashboardBucket,employeeTaskOverdue} from './task-dashboard';
import {personalTaskPresentation} from './task-presentation';
import {DriveLinkField,RequestDriveResources} from './DriveResource';
import {additionalDriveKey,driveSpecificationKey,normalizeDriveUrl,requestDriveUrls} from './drive-resources';
import RequestHistory from './RequestHistory';
import RequestInterventions from './RequestInterventions';
import {completedTaskRows,completedTaskPage} from './completed-task-pages';
import {coordinatorTasksFor,coordinatorTaskSummary,coordinatorTaskLabels} from './coordinator-tasks';
import {partsForView,requestsForView,teamFollowupRows} from './work-view-scope';
import './workflow.css';
import './task-detail.css';
import DatePicker from '../shared/DatePicker';
import {dateLabel,endOfRiyadhDay,riyadhDate} from '../shared/date-only';
const empty={requests:[],parts:[],services:[],staff:[],grants:[],escalations:[],due_reviews:[],intake_controls:[],coordinator_tasks:[]};
const finishedParts=['approved','forwarded','internal_done'];
const asRecord=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const firstText=(...values)=>{
 for(const value of values){if(typeof value==='string'&&value.trim())return value.trim();}
 return '';
};
const contactLike=value=>value.includes('@')||/^\+?[\d\s()-]{7,}$/.test(value);
const safeLogo=value=>/^(?:https?:\/\/|\/(?!\/))/i.test(value)?value:'';
const requestClientIdentity=(source,request)=>{
 const clientId=firstText(request.client_id,request.client?.id,request.client_profile?.id,request.client_identity?.id);
 const directories=[source.clients,source.client_directory,source.customers,source.accounts].filter(Array.isArray);
 const listed=directories.flat().find(item=>item?.id===clientId)||{};
 const embedded=asRecord(request.client_identity||request.client||request.client_profile||request.customer);
 const client={...asRecord(listed),...embedded};
 const contact={...asRecord(listed.contact),...asRecord(client.contact),...asRecord(request.client_contact)};
 const coordinatorId=firstText(request.coordinator_id,request.coordinator?.id);
 const coordinator={...asRecord((source.staff||[]).find(item=>item?.id===coordinatorId)),...asRecord(request.coordinator)};
 const name=firstText(request.client_name,request.client_display_name,request.customer_name,typeof request.client==='string'?request.client:'',client.company_name,client.organization_name,client.display_name,client.name);
 const responsibleName=firstText(request.client_contact_name,request.client_responsible_name,request.contact_name,client.contact_name,client.responsible_name,client.representative_name,contact.display_name,contact.name,contact.person_name);
 const coordinatorName=firstText(request.coordinator_name,request.owner_name,coordinator.display_name,coordinator.name);
 return {
  clientId,
  name,
  logo:safeLogo(firstText(request.client_logo_url,request.client_logo,client.logo_url,client.logo,client.avatar_url)),
  responsibleName,
  coordinatorName,
  email:firstText(request.client_email,request.contact_email,client.email,contact.email),
  phone:firstText(request.client_phone,request.contact_phone,client.phone,contact.phone),
  whatsapp:firstText(request.client_whatsapp,request.contact_whatsapp,client.whatsapp,contact.whatsapp)
 };
};
function ClientMark({logo,name}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[logo]);
 return <span className="w-client-mark">{logo&&!failed?<img src={logo} alt={`شعار ${name||'العميل'}`} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:<Building2 size={20} aria-hidden="true"/>}</span>;
}
function ClientIdentity({source,request,canViewContact=false,showContactMethods=canViewContact,variant='card',departmentOwner=''}){
 const identity=requestClientIdentity(source,request);
 const routeVariant=variant==='route';
 const visibleName=(routeVariant||!canViewContact)&&contactLike(identity.name)?'':identity.name;
 const visibleResponsible=!canViewContact&&contactLike(identity.responsibleName)?'':identity.responsibleName;
 const visibleCoordinator=!canViewContact&&contactLike(identity.coordinatorName)?'':identity.coordinatorName;
 const visibleDepartmentOwner=contactLike(departmentOwner)?'':departmentOwner;
 const contacts=[
  {id:'email',label:'البريد الإلكتروني',value:identity.email,Icon:Mail},
  {id:'phone',label:'الجوال',value:identity.phone,Icon:Phone},
  {id:'whatsapp',label:'واتساب',value:identity.whatsapp,Icon:MessageCircle}
 ].filter((item,index,items)=>item.value&&items.findIndex(other=>other.value.toLowerCase()===item.value.toLowerCase())===index);
 const missingName=identity.clientId?'اسم العميل غير متاح في بيانات الطلب':'هوية العميل غير متاحة في بيانات الطلب';
 const responsibleFallback=visibleCoordinator?'':request.coordinator_id?'اسم المشرف المسؤول غير متاح':'لم يحدد المشرف المسؤول';
 if(variant==='compact')return <span className="w-client-inline"><Building2 size={15} aria-hidden="true"/><span>{visibleName||'اسم العميل غير متاح'}</span></span>;
 return <span className={`w-client-identity is-${variant}`}>
  <ClientMark logo={identity.logo} name={visibleName}/>
  <span className="w-client-copy"><small className="w-client-label">{routeVariant?'العميل':'بيانات العميل'}</small><strong className="w-client-name">{visibleName||(routeVariant?'اسم العميل غير متاح':missingName)}</strong>
   {!routeVariant&&visibleResponsible&&<span className="w-client-owner"><UserRound size={14} aria-hidden="true"/>مسؤول العميل {visibleResponsible}</span>}
   {!routeVariant&&visibleCoordinator&&<span className="w-client-owner"><UserRound size={14} aria-hidden="true"/>المشرف المسؤول {visibleCoordinator}</span>}
   {variant==='detail'&&!visibleResponsible&&!visibleCoordinator&&<span className="w-client-owner"><UserRound size={14} aria-hidden="true"/>{responsibleFallback}</span>}
   {routeVariant&&<span className="w-client-owner"><UserRound size={14} aria-hidden="true"/>{visibleDepartmentOwner?`مسؤول القسم ${visibleDepartmentOwner}`:'اسم مسؤول القسم غير متاح'}</span>}
  </span>
  {canViewContact&&showContactMethods&&contacts.length>0&&<span className="w-client-contacts">{contacts.map(({id,label,value,Icon})=><span className="w-client-contact" key={id}><Icon size={14} aria-hidden="true"/><small>{label}</small><span className="w-client-contact-value" dir="ltr">{value}</span></span>)}</span>}
  {canViewContact&&showContactMethods&&!contacts.length&&variant==='detail'&&<small className="w-client-contact-empty">وسائل التواصل غير متاحة في بيانات الطلب</small>}
 </span>;
}
const requestInfoFor=(source,request,scope,userId,now=Date.now())=>{
 const parts=(source.parts||[]).filter(part=>part.request_id===request.id);
 const personal=parts.filter(part=>part.assignee_id===userId);
 const coordination=coordinatorTaskSummary(coordinatorTasksFor(source,request.id,userId),now);
 const scopeParts=partsForView(source,request.id,scope,userId);
 const relevant=scopeParts.filter(part=>!finishedParts.includes(part.status));
 const ownComplete=scope==='mine'&&(personal.length>0||coordination.completed.length>0)&&!relevant.length&&!coordination.open;
 const dates=relevant.map(part=>new Date(part.due_at).getTime()).filter(date=>Number.isFinite(date)&&date>0);
 const due=dates.length?Math.min(...dates):Infinity;
 const offered=relevant.some(part=>part.status==='offered'||part.status==='waiting'&&!part.accepted_at)||scope==='mine'&&coordination.offered;
 return {
  parts,
  scopeParts,
  coordination,
  active:request.status==='active',
  intake:['new','needs_info'].includes(request.status)||parts.some(part=>part.status==='needs_info'),
  open:personal.some(part=>!finishedParts.includes(part.status))||coordination.open,
  accomplished:personal.some(part=>part.status==='approved')||coordination.completed.length>0,
  approved:personal.some(part=>part.status==='approved'),
  due,
  offered,
  ownComplete,
  urgent:request.priority==='urgent'||relevant.some(part=>part.priority==='urgent'),
  overdue:!['completed','declined'].includes(request.status)&&relevant.some(part=>employeeTaskOverdue(part,now)),
  waiting:relevant.some(part=>part.status==='waiting'),
  review:relevant.some(part=>part.status==='review')||scope==='mine'&&coordination.review,
  revision:relevant.some(part=>part.status==='revision')||scope==='mine'&&coordination.revision,
  needsInfo:request.status==='needs_info'||relevant.some(part=>part.status==='needs_info')||scope==='mine'&&coordination.waiting,
  escalated:relevant.some(part=>part.status==='escalated')||(source.escalations||[]).some(item=>item.request_id===request.id&&item.status==='open')
 };
};
const assignmentCandidates=(staff,serviceId,excludedId)=>staff
 .filter(employee=>employee.id!==excludedId&&Array.isArray(employee.services)&&employee.services.includes(serviceId))
 .sort((left,right)=>{
  const leftCapacity=Math.max(1,Number(left.capacity)||1),rightCapacity=Math.max(1,Number(right.capacity)||1);
  const leftOpen=Math.max(0,Number(left.open_count)||0),rightOpen=Math.max(0,Number(right.open_count)||0);
  return leftOpen/leftCapacity-rightOpen/rightCapacity||leftOpen-rightOpen||String(left.name||'').localeCompare(String(right.name||''),'ar');
 });
const departmentLead=(staff,serviceId)=>staff.find(employee=>Array.isArray(employee.lead_services)&&employee.lead_services.includes(serviceId)&&employee.services?.includes(serviceId));
const assignmentOption=(employee,index,serviceId)=>`${employee.name}${employee.lead_services?.includes(serviceId)?' مسؤول القسم':index===0&&Number(employee.open_count)<Number(employee.capacity)?' الخيار المقترح':''} لديه ${employee.open_count} من ${employee.capacity} مهام`;
const fileKey=file=>`${file.name}:${file.size}:${file.lastModified}`;
const fileSize=bytes=>bytes>=1024**3?`${(bytes/1024**3).toFixed(1)} GB`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)} MB`:`${Math.ceil(bytes/1024)} KB`;
const controlRequest=(data,item)=>{
 const request=data.requests.find(candidate=>candidate.id===item.request_id);
 return request?{...request,version:item.request_version??request.version}:{id:item.request_id,number:item.request_number,title:item.request_title,version:item.request_version,status:'new'};
};
const countdown=(deadline,now)=>{
 const remaining=Math.max(0,new Date(deadline).getTime()-now),total=Math.floor(remaining/1000),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60),seconds=total%60;
 return `${hours.toLocaleString('ar-SA')} س ${minutes.toLocaleString('ar-SA',{minimumIntegerDigits:2})} د ${seconds.toLocaleString('ar-SA',{minimumIntegerDigits:2})} ث`;
};
function WorkflowControlCenter({data,manager,coordinator,busy,execute,onOpen,onDialog}){
 const dueReviews=manager&&Array.isArray(data.due_reviews)?data.due_reviews:[],intakeControls=(manager||coordinator)&&Array.isArray(data.intake_controls)?data.intake_controls:[];
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{
  if(!dueReviews.length&&!intakeControls.length)return undefined;
  const timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(timer);
 },[dueReviews.length,intakeControls.length]);
 if(!dueReviews.length&&!intakeControls.length)return null;
 const rejectDue=item=>onDialog({action:'reject_due',request:controlRequest(data,item),dueReview:item});
 const intakeAction=(action,item)=>onDialog({action,request:controlRequest(data,item),intakeControl:item});
 return <section className="w-control-center" aria-labelledby="workflow-control-title">
  <header className="w-control-heading"><div><span className="a-eyebrow">متابعة لحظية</span><h3 id="workflow-control-title">مركز التحكم بالتنفيذ</h3><p>المواعيد وطلبات الاستقبال التي تحتاج قرارا الآن</p></div><div className="w-control-totals"><span><b>{dueReviews.length}</b> مواعيد</span><span><b>{intakeControls.length}</b> استقبال</span></div></header>
  {dueReviews.length>0&&<div className="w-control-group"><div className="w-control-group-heading"><div><Clock3 size={19} aria-hidden="true"/><strong>اعتماد مواعيد الأقسام</strong></div><span>مهلة الإدارة ثلاث ساعات</span></div><div className="w-control-grid">{dueReviews.map(item=>{const expired=new Date(item.review_expires_at).getTime()<=now;return <article className={`w-control-card ${expired?'is-overdue':''}`} key={item.id}>
   <header><div><small>طلب {item.request_number}</small><strong>{item.request_title}</strong></div><span className="w-control-clock"><Clock3 size={16} aria-hidden="true"/><time dateTime={item.review_expires_at}>{expired?'انتهت مهلة القرار':countdown(item.review_expires_at,now)}</time></span></header>
   <dl><div><dt>القسم</dt><dd>{item.service_name||'القسم المكلف'}</dd></div><div><dt>الموظف</dt><dd>{item.assignee_name||'موظف الفريق'}</dd></div></dl>
   <p className="w-control-date"><span>الموعد المقترح</span><time dateTime={item.proposed_due_at}>{dateLabel(item.proposed_due_at)}</time></p>
   <div className="w-actions"><button type="button" onClick={()=>onOpen(item.request_id)}>فتح الطلب</button><button type="button" className="a-primary" disabled={busy||expired} onClick={()=>{void execute('approve_due',{request_id:item.request_id,version:item.request_version,due_review_id:item.id}).catch(()=>{});}}>اعتماد الموعد</button><button type="button" className="w-control-reject" disabled={busy||expired} onClick={()=>rejectDue(item)}>رفض وتحديد موعد</button></div>
  </article>;})}</div></div>}
  {intakeControls.length>0&&<div className="w-control-group"><div className="w-control-group-heading"><div><AlertTriangle size={19} aria-hidden="true"/><strong>مهلة استقبال الطلبات</strong></div><span>الإجراء يشمل الاعتماد أو طلب البيانات أو المرفقات</span></div><div className="w-control-grid">{intakeControls.map(item=>{const expired=!!item.overdue||!!item.intake_escalated_at||new Date(item.intake_due_at).getTime()<=now;return <article className={`w-control-card ${expired?'is-overdue':''}`} key={item.request_id}>
   <header><div><small>طلب {item.request_number}</small><strong>{item.request_title}</strong></div><span className="w-control-clock"><Clock3 size={16} aria-hidden="true"/><time dateTime={item.intake_due_at}>{expired?'تحتاج تدخل الإدارة الآن':countdown(item.intake_due_at,now)}</time></span></header>
   <dl><div><dt>وصل الطلب</dt><dd>{when(item.submitted_at)}</dd></div><div><dt>آخر مهلة للإجراء</dt><dd>{when(item.intake_due_at)}</dd></div></dl>
   <div className="w-actions"><button type="button" className="a-primary" onClick={()=>onOpen(item.request_id)}>فتح واتخاذ إجراء</button><button type="button" disabled={busy} onClick={()=>intakeAction('request_attachments',item)}>طلب مرفقات</button>{manager&&<button type="button" className="w-control-reject" disabled={busy} onClick={()=>intakeAction('decline_intake',item)}>رفض الطلب</button>}</div>
  </article>;})}</div></div>}
 </section>;
}
export default function TeamWork({user,settings=false,onLogout,initialRequest,externalNotifications=false,onDepartments,createRequest=false,onCreateRequestHandled,showTaskHome=false,onTaskHomeHandled}){
 const manager=['admin','super_admin'].includes(user.app_metadata?.role),owner=user.app_metadata?.role==='super_admin';
 const store=useSessionStore();
 const [data,setData]=useState(empty),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useSessionState('team:selected',null),[view,setView]=useSessionState('team:view',manager?'all':'mine',{validate:value=>['mine','department','all','intake','deliveries','alerts'].includes(value)}),[search,setSearch]=useSessionState('team:search',''),[page,setPage]=useSessionState('team:page',0,{validate:value=>Number.isInteger(value)&&value>=0}),[dialog,setDialogState]=useState(null),[dialogLocation,setDialogLocation]=useSessionState('team:dialog-location',null),[busy,setBusy]=useState(false),[coordinator,setCoordinator]=useState(false);
 const alive=useRef(true),revision=useRef(0),locked=useRef(false),metricNavigation=useRef(null);
 const [restoreAttempt,setRestoreAttempt]=useState(0);
 const [employeeResults,setEmployeeResults]=useSessionState('team:employee-results',false,{validate:value=>typeof value==='boolean'});
 const [plannerPart,setPlannerPart]=useSessionState('team:planner-part',null);
 const [plannerRevision,setPlannerRevision]=useState(0);
 const metricButtons=useRef(new Map()),resultsBack=useRef(null),openedMetric=useRef(null);
 useEffect(()=>{
  if(!showTaskHome)return;
  metricNavigation.current=null;setEmployeeResults(false);setSelected(null);
  onTaskHomeHandled?.();
 },[showTaskHome,onTaskHomeHandled]);
 const [focus,setFocus]=useSessionState('team:focus','all'),[sort,setSort]=useSessionState('team:sort','latest',{validate:value=>['latest','urgent','due','requested'].includes(value)});
 const [clientPriority,setClientPriority]=useSessionState('team:client-priority','all',{validate:value=>['all','normal','urgent'].includes(value)});
 const [dashboardSort,setDashboardSort]=useSessionState('team:dashboard-sort','latest',{validate:value=>['latest','oldest','due','priority'].includes(value)});
 const bucket=dashboardBucket(focus,manager,coordinator);
 const dashboardMode=Boolean(bucket),dashboardKey=JSON.stringify([bucket||'all',search,page,clientPriority,dashboardSort]);
 const dashboardReady=data.dashboard_key===dashboardKey;
 const completedMode=!manager&&['accomplished','approved'].includes(focus);
 const teamFollowupMode=!manager&&view==='all'&&focus==='active';
 const serverPage=completedMode||teamFollowupMode?0:page;
 const completedReady=data.completed_scope_key===JSON.stringify([user.id,view,search]);
 const teamFollowupReady=data.team_followup_key===JSON.stringify([user.id,search]);
 function setDialog(next){
  if(!next){if(dialogLocation)store?.clearPrefix(`team:action:${dialogLocation.key}:`);setDialogLocation(null);setDialogState(null);return;}
  const key=crypto.randomUUID();
  setDialogLocation({key,plannerMove:next.plannerMove===true,action:next.action,requestId:next.request?.id,version:next.request?.version,partId:next.part?.id,deliveryId:next.delivery?.id,escalationId:next.escalation?.id,dependencyId:next.dependency?.id,dueReviewId:next.dueReview?.id,outputRequestId:next.outputRequest?.id,decision:next.decision,submissionKey:next.submission_key});
  setDialogState({...next,draftKey:key});
 }
 useEffect(()=>{
  if(!dialogLocation||dialog||loading)return undefined;
  let live=true;
  async function restore(){
   const saved=dialogLocation;
   if(saved.action==='create'){
    if(manager||data.coordinator)setDialogState({action:'create',submission_key:saved.submissionKey,draftKey:saved.key});
    return;
   }
   const detail=await repository.detail(saved.requestId,manager);
   const request=detail.request||await repository.request(saved.requestId);
   const parts=detail.parts||[],routes=detail.routes||[],dependencies=detail.dependencies||[];
   const outputRequests=detail.output_requests||[],outputRequest=outputRequests.find(row=>row.id===saved.outputRequestId),outputAssignees=detail.output_assignees||[];
   const part=parts.find(item=>item.id===saved.partId),delivery=(detail.deliveries||[]).find(item=>item.id===saved.deliveryId),escalation=(detail.escalations||[]).find(item=>item.id===saved.escalationId),dependency=dependencies.find(item=>item.id===saved.dependencyId),dueReview=[...(detail.due_reviews||detail.control?.due_reviews||[]),...(data.due_reviews||[])].find(item=>item.id===saved.dueReviewId);
   if(saved.partId&&!part||saved.deliveryId&&!delivery||saved.escalationId&&!escalation||saved.dependencyId&&!dependency||saved.dueReviewId&&!dueReview)throw new Error('not_found');
   if(saved.outputRequestId&&!outputRequest)throw new Error('not_found');
   const upstreamId=dependencies.find(item=>item.id===escalation?.dependency_id)?.upstream_id;
   const upstream=parts.find(item=>item.id===upstreamId)||routes.find(item=>item.id===upstreamId);
   if(live)setDialogState({action:saved.action,plannerMove:saved.plannerMove===true,draftKey:saved.key,submission_key:saved.submissionKey,decision:saved.decision,request:{...request,version:saved.version},part,delivery,escalation,dependency,dueReview,parts,routes,dependencies,outputRequests,outputRequest,outputAssignees,outputServices:detail.output_services,canEnforceDependency:owner||manager&&data.grants.some(grant=>grant.user_id===user.id&&grant.service_id===upstream?.service_id&&grant.can_manage)});
  }
  restore().catch(reason=>{if(live)setError(workError(reason));});
  return()=>{live=false;};
 },[dialogLocation,dialog,loading,restoreAttempt]);
 useEffect(()=>{
  if(!createRequest||loading)return;
  if((manager||coordinator)&&dialogLocation?.action!=='create')setDialog({action:'create',submission_key:crypto.randomUUID()});
  onCreateRequestHandled?.();
 },[createRequest,loading,manager,coordinator,dialogLocation,onCreateRequestHandled]);
 async function refresh(){
  const serial=++revision.current;
  const [next,settingsStaff]=await Promise.all([
   teamFollowupMode&&!dashboardMode?repository.teamFollowupBoard(user,search):completedMode?repository.completedBoard(user,view,search):repository.board(user,dashboardMode?0:page,view,search),
   settings&&owner?repository.settingsStaff():Promise.resolve([])
  ]);
  next.settings_staff=settingsStaff;
  if(!settings&&(manager||next.coordinator||bucket==='personal_overdue')){
   try{next.dashboard=await repository.taskDashboard({bucket:bucket||'all',search,page,priority:clientPriority,sort:dashboardSort});}
   catch(reason){next.dashboard_error=workError(reason);}
   next.dashboard_key=dashboardKey;
  }
  if(selected&&!next.requests.some(r=>r.id===selected)){
   try{const selectedRequest=await repository.request(selected),details=await repository.detail(selected);next.requests.push(selectedRequest);next.parts.push(...(details.parts||[]));}catch(reason){setError(workError(reason));}
  }
  if(alive.current&&serial===revision.current){
   const intent=metricNavigation.current;
   if(intent&&intent.view===view&&page===0&&!search){
    metricNavigation.current=null;
    setSelected(null);
   }
   setData(next);setCoordinator(next.coordinator);setLoading(false);
  }
 }
 useEffect(()=>{alive.current=true;let current=true;setRefreshing(true);const initial=setTimeout(()=>refresh().catch(e=>{if(current){setError(workError(e));setLoading(false);}}).finally(()=>{if(current)setRefreshing(false);}),200);const timer=setInterval(()=>{if(!settings&&!document.hidden&&!locked.current)refresh().catch(()=>{});},15000);return()=>{current=false;alive.current=false;revision.current++;clearTimeout(initial);clearInterval(timer);};},[serverPage,completedMode,teamFollowupMode,user.id,view,search,selected,settings,owner,dashboardKey]);
 const manage=s=>owner||manager&&data.grants.some(g=>g.user_id===user.id&&g.service_id===s&&g.can_manage);
 async function execute(action,p){
  if(locked.current)return;locked.current=true;setBusy(true);setError('');
  try{await (p.planner_note?call('planner_transition',{action,p}):call(action,p));}
  catch(e){
   const paths=(p.files||[]).map(file=>file.object_path);
   if(!p.planner_note&&['deliver','attach'].includes(action)&&paths.length&&(await Promise.all(paths.map(path=>repository.receipt(action,path).catch(()=>null)))).every(Boolean)){setDialog(null);await refresh().catch(()=>setError('تم الحفظ وتعذر تحديث القائمة أعد تحميلها لعرض آخر البيانات'));return;}
   setError(workError(e));await refresh().catch(()=>{});throw e;
  }
  finally{locked.current=false;setBusy(false);}
  setDialog(null);setPlannerRevision(value=>value+1);await refresh().catch(()=>setError('تم الحفظ وتعذر تحديث القائمة أعد تحميلها لعرض آخر البيانات'));
 }
 async function preparePlannerMove(task,target){
  const detail=await repository.detail(task.request_id),request=detail.request||await repository.request(task.request_id);
  const part=detail.parts?.find(item=>item.id===task.part_id&&item.assignee_id===user.id);
  if(!part||request.status!=='active')throw new Error('forbidden');
  if(request.version!==task.request_version)throw new Error('version_conflict');
  const action=plannerMoveAction({...task,...part},target);
  if(!action)throw new Error('invalid_state');
  setDialog({action,request,part,parts:detail.parts,routes:detail.routes||[],dependencies:detail.dependencies||[],outputRequests:detail.output_requests||[],outputAssignees:detail.output_assignees||[],outputServices:detail.output_services,plannerMove:true});
 }
 const visibleRequests=requestsForView(data,user.id,view,manager);
 const request=data.requests.find(r=>r.id===selected);
 const now=Date.now();
 const requestInfo=r=>requestInfoFor(data,r,view==='deliveries'&&!manager&&!coordinator?'mine':view,user.id,now);
 const cards=visibleRequests.map(request=>({request,info:requestInfo(request)}));
 const requestedDate=request=>request.requested_due_at?new Date(request.requested_due_at).getTime():Infinity;
 const list=cards.filter(({info})=>focus==='all'||info[focus]).sort((a,b)=>sort==='requested'||sort==='due'&&!manager?requestedDate(a.request)-requestedDate(b.request):sort==='urgent'?Number(b.info.urgent)-Number(a.info.urgent)||a.info.due-b.info.due:sort==='due'?a.info.due-b.info.due:new Date(b.request.created_at)-new Date(a.request.created_at));
 const requestRows=list.map(({request:r})=>({...r,clientName:requestClientIdentity(data,r).name}));
 const completedPage=completedMode?completedTaskPage(completedTaskRows(data,requestRows,user.id,focus==='accomplished'),clientPriority,page):null;
 const teamFollowupPage=teamFollowupMode?completedTaskPage(teamFollowupRows(data,requestRows),clientPriority,page):null;
 const resultsPage=teamFollowupPage||completedPage;
 async function openRequest(id,partId=null){metricNavigation.current=null;setPlannerPart(partId);setEmployeeResults(true);setSelected(id);if(!data.requests.some(r=>r.id===id)){try{const r=await repository.request(id);setData(d=>({...d,requests:[r,...d.requests]}));}catch(e){setError(workError(e));}}}
 useEffect(()=>{if(initialRequest)openRequest(initialRequest);},[initialRequest]);
 const reviewMetric={id:'team-client-review',tone:'complete',Icon:MessageCircle,label:'متابعة مراجعة المشرف',value:data.dashboard?.counts?.client_review,hint:`${data.dashboard?.counts?.client_review_overdue??'—'} مراجعة متأخرة والبقية بانتظار رد المشرف`,action:'متابعة المراجعات',view:'all',focus:'client_review'};
 const interventionMetric={id:'team-alerts',view:'all',focus:'alerts'};
 const interventionCount=loading||data.dashboard_error||!Number.isFinite(data.dashboard?.counts?.alerts)?null:data.dashboard.counts.alerts;
 const metrics=manager?[
  {id:'team-active',tone:'active',Icon:FolderOpen,label:'طلبات قيد التنفيذ',value:data.dashboard?.counts?.active,hint:'طلبات نشطة لدى أقسام صيت',action:'فتح الطلبات',view:'all',focus:'active'},
  {id:'team-intake',tone:'waiting',Icon:Clock3,label:'بانتظار التوجيه',value:data.dashboard?.counts?.intake,hint:'طلبات تحتاج مراجعة البيانات والإحالة',action:'فتح طلبات التوجيه',view:'all',focus:'intake'},
  {id:'team-overdue',tone:'overdue',Icon:AlertTriangle,label:'المهام المتأخرة',value:data.dashboard?.counts?.overdue,hint:'تجاوزت موعد الموظف ولم تصل لمراجعة المشرف',action:'فتح المهام المتأخرة',view:'all',focus:'overdue',attention:true},
  reviewMetric,
 ]:[
  ...(coordinator?[{id:'team-followup',tone:'team',Icon:UsersRound,label:'متابعة مهام الفريق',value:data.dashboard?.counts?.active,hint:'طلبات نشطة لدى أقسام صيت لمتابعة العمل مع العميل',action:'متابعة الأقسام والطلبات',view:'all',focus:'active'}]:[]),
  {id:'personal-open',tone:'active',Icon:FolderOpen,label:'مهامي المفتوحة',value:data.counts?.open,hint:coordinator?'تشمل استلام الطلبات ومراجعة المخرجات':'المهام المكلف بها حسابك',action:'فتح المهمة',view:'mine',focus:'open'},
  {id:'personal-offered',tone:'waiting',Icon:Clock3,label:'بانتظار استلامي',value:data.counts?.offered,hint:coordinator?'طلبات تحتاج استلامك ومراجعة بياناتها':'حدد موعدك لبدء التنفيذ',action:'فتح مهمة الاستلام',view:'mine',focus:'offered'},
  {id:'personal-overdue',tone:'overdue',Icon:AlertTriangle,label:'مهامي المتأخرة',value:data.counts?.overdue,hint:'تجاوزت موعدك ولم تصل لمراجعة المشرف',action:'فتح المهام المتأخرة',view:'mine',focus:'overdue',attention:true},
  {id:'personal-approved',tone:'complete',Icon:CheckCircle2,label:coordinator?'مهامي المكتملة':'تسليماتي المعتمدة',value:coordinator?data.counts?.completed:data.counts?.approved,hint:coordinator?'أعمال الاستلام والمراجعة التي أنجزتها':'مهام أكملت مراجعة المشرف',action:coordinator?'فتح العمل المنجز':'فتح التسليم المعتمد',view:coordinator?'mine':'deliveries',focus:coordinator?'accomplished':'approved'},
  ...(coordinator?[reviewMetric]:[])
 ];
 function openMetric(metric){
  openedMetric.current=metric.id;metricNavigation.current=null;setEmployeeResults(true);setSelected(null);
  requestAnimationFrame(()=>resultsBack.current?.focus());
  setView(metric.view);setFocus(metric.focus);setPage(0);setSearch('');setClientPriority('all');
 }
 return <div className="w-root" dir="rtl">
  {!settings&&!externalNotifications&&(manager||onLogout)&&<div className="w-toolbar"><Notifications user={user} onOpen={openRequest}/>{onLogout&&<button type="button" onClick={onLogout}>تسجيل الخروج</button>}</div>}
  {settings&&<header className={`w-toolbar w-board-intro ${externalNotifications?'is-embedded':''}`}><div><span className="a-eyebrow">{settings?'تنظيم الفريق':'مساحة الفريق'}</span><h2>{settings?'الصلاحيات والخدمات':'الطلبات والتكليفات'}</h2><p>{settings?'حدد الأقسام والمسؤوليات والطاقة المناسبة لكل موظف':'الأولوية واضحة والخطوة التالية أمامك لكل طلب'}</p></div><div className="w-actions">{!externalNotifications&&<Notifications user={user} onOpen={openRequest}/>} {onLogout&&<button onClick={onLogout}>تسجيل الخروج</button>}</div></header>}
  {error&&<div className="w-error" role="alert">{error}<button onClick={()=>{setError('');setRestoreAttempt(value=>value+1);refresh().catch(e=>setError(workError(e)));}}>إعادة المحاولة</button></div>}
  {settings?<WorkSettings data={data} refresh={refresh} owner={owner} onDepartments={onDepartments}/>:<>
   {manager&&<TaskDueInbox onOpen={openRequest} onChanged={()=>refresh().catch(reason=>setError(workError(reason)))}/>}
   {!employeeResults&&(manager||coordinator)&&<div className="w-dashboard-top"><button type="button" onClick={()=>openMetric({id:'all-requests',view:'all',focus:'all'})}><FolderOpen size={18} aria-hidden="true"/>طلبات العملاء<bdi>{data.dashboard?.counts?.all??'—'}</bdi></button><button type="button" onClick={()=>setDialog({action:'create',submission_key:crypto.randomUUID()})}><Plus size={17} aria-hidden="true"/>تسجيل طلب</button></div>}
   {manager&&<button type="button" className="w-admin-intervention-card" ref={node=>{if(node)metricButtons.current.set('team-alerts',node);else metricButtons.current.delete('team-alerts');}} aria-pressed={employeeResults&&focus==='alerts'} onClick={()=>openMetric(interventionMetric)}>
    <span className="w-admin-intervention-icon"><AlertTriangle size={24} aria-hidden="true"/></span>
    <span className="w-admin-intervention-copy"><strong>مهام تحتاج تدخل الإدارة</strong><small>{data.dashboard_error?'تعذر تحميل عدد التدخلات':interventionCount===0?'لا توجد تدخلات مفتوحة حاليا':'راجع الحالات المعلقة واتخذ القرار من تفاصيل الطلب'}</small></span>
    <span className="w-admin-intervention-count"><bdi>{interventionCount??'—'}</bdi><small>{interventionCount===null?'العدد غير متاح':'تدخل مفتوح'}</small></span>
    <span className="w-admin-intervention-link">فتح المهام<ArrowLeft size={18} aria-hidden="true"/></span>
   </button>}
   {!employeeResults&&data.dashboard_error&&<p className="w-error" role="alert">{data.dashboard_error}</p>}
   {!employeeResults&&<div className="w-metrics">
    {metrics.map(metric=>{const {Icon,label,value,hint,action}=metric,count=loading||!Number.isFinite(value)?'—':value;return <button type="button" key={metric.id} ref={node=>{if(node)metricButtons.current.set(metric.id,node);else metricButtons.current.delete(metric.id);}} data-tone={metric.tone} className={metric.id==='team-followup'?'is-team-followup':metric.attention&&value>0?'is-attention':''} aria-label={`${label} ${count==='—'?'العدد قيد التحميل':`العدد ${count}`} ${action}`} aria-pressed={manager?view===metric.view&&focus===metric.focus:undefined} onClick={()=>openMetric(metric)}><span className="w-metric-heading"><span className="w-metric-icon"><Icon size={20} aria-hidden="true"/></span><span className="w-metric-label">{label}</span></span><strong>{count}</strong><small>{hint}</small><span className="w-metric-action">{action}<ArrowLeft size={15} aria-hidden="true"/></span></button>;})}
   </div>}
   {!employeeResults&&!manager&&!coordinator&&!loading&&<TaskPlanner user={user} onOpen={openRequest} onTransition={preparePlannerMove} refreshKey={plannerRevision} onChanged={()=>refresh().catch(reason=>setError(workError(reason)))}/>}
   {employeeResults&&<div className="w-toolbar"><button type="button" ref={resultsBack} className="a-button" onClick={()=>{metricNavigation.current=null;if(request){setSelected(null);return;}setEmployeeResults(false);setSelected(null);requestAnimationFrame(()=>(metricButtons.current.get(openedMetric.current)||metricButtons.current.values().next().value)?.focus());}}><ArrowLeft size={17} aria-hidden="true"/>{request?'العودة إلى قائمة المهام':'العودة إلى البطاقات'}</button></div>}
   {employeeResults&&(request?<RequestDetail key={request.id} initialPart={plannerPart} request={request} data={data} user={user} manager={manager} coordinator={coordinator} manage={manage} execute={execute} busy={busy} onDialog={setDialog} onClose={()=>setSelected(null)}/>:dashboardMode?<TaskDashboardRows dashboard={data.dashboard} bucket={bucket} search={search} onSearch={value=>{setSearch(value);setPage(0);}} priority={clientPriority} onPriority={value=>{setClientPriority(value);setPage(0);}} sort={dashboardSort} onSort={value=>{setDashboardSort(value);setPage(0);}} onBucket={value=>{setFocus(value);setPage(0);}} page={page} onPage={setPage} loading={loading||!dashboardReady} refreshing={refreshing} error={data.dashboard_error} onRetry={()=>refresh().catch(e=>setError(workError(e)))} onOpen={openRequest}/>:<TeamRequestRows teamFollowup={teamFollowupMode} rows={resultsPage?.rows||requestRows} total={resultsPage?.total} pages={resultsPage?.pages} search={search} onSearch={value=>{metricNavigation.current=null;setSearch(value);setPage(0);}} priority={clientPriority} onPriority={value=>{setClientPriority(value);if(completedMode||teamFollowupMode)setPage(0);}} sort={sort==='due'?'requested':sort} onSort={value=>{setSort(value);if(completedMode||teamFollowupMode)setPage(0);}} page={resultsPage?.page??page} onPage={value=>{metricNavigation.current=null;setPage(value);}} hasNext={resultsPage?.hasNext??data.requests.length>=40} loading={loading||completedMode&&!completedReady||teamFollowupMode&&coordinator&&!teamFollowupReady} refreshing={refreshing} onOpen={openRequest}/>)}

  </>}
  {dialog&&<ActionDialog key={dialog.draftKey} spec={dialog} data={data} user={user} execute={execute} busy={busy} close={()=>setDialog(null)}/>}
 </div>;
}

function RequestDetail({request:r,data,user,manager,coordinator,manage,busy,onDialog,onClose,initialPart}){
 const detailHeading=useRef(null);
 const detailPanel=useRef(null);
 const optionsPanel=useRef(null),optionsId=useId();
 useEffect(()=>{const panel=detailPanel.current,previous=document.activeElement;panel.showModal();return()=>{panel.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 const [extra,setExtra]=useState({events:[],files:[],deliveries:[],dependencies:[],routes:[],escalations:[]}),[load,setLoad]=useState({key:null,status:'loading',error:''}),[attempt,setAttempt]=useState(0),[preview,setPreview]=useState(null);
 const [inquirySelection,setInquirySelection]=useState(null);
 const loadKey=`${r.id}:${r.version}:${manager}:${attempt}`;
 const ready=load.key===loadKey&&load.status==='ready',error=load.key===loadKey?load.error:'';
 useEffect(()=>{if(!ready)return;const target=initialPart&&document.getElementById(`personal-task-${initialPart}`);if(target){target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'instant'});}else{detailHeading.current?.focus({preventScroll:true});detailHeading.current?.closest('.w-detail')?.scrollIntoView({block:'start',behavior:'instant'});}},[r.id,ready,initialPart]);
 useEffect(()=>{let live=true;setLoad({key:loadKey,status:'loading',error:''});repository.detail(r.id,manager).then(next=>{if(live){setExtra(next);setLoad({key:loadKey,status:'ready',error:''});}}).catch(e=>{if(live)setLoad({key:loadKey,status:'error',error:workError(e)});});return()=>{live=false;};},[loadKey,r.id,manager]);
 const currentRequest={...r,...asRecord(extra.request)};
 const coordinationTasks=coordinatorTasksFor(data,currentRequest.id,user.id);
 const parts=extra.parts||data.parts.filter(p=>p.request_id===r.id),edit=manager||coordinator||manage(currentRequest.service_id)||parts.some(part=>manage(part.service_id))||extra.routes.some(route=>route.service_id&&manage(route.service_id));
 const action=(action,part=null,other={})=>{if(!ready||busy)return;optionsPanel.current?.close();onDialog({action,request:currentRequest,part,routes:extra.routes,dependencies:extra.dependencies,parts,outputRequests:extra.output_requests||[],outputAssignees:extra.output_assignees||[],outputServices:extra.output_services,...other});};
 const released=d=>!Object.prototype.hasOwnProperty.call(d,'released_at')||!!d.released_at;
 const partLabel=p=>(extra.output_requests||[]).some(row=>row.upstream_id===p.id&&row.status==='rejected')?'رفضت الإدارة طلب المخرجات':p.output_due_required&&p.status==='working'?'بانتظار تحديد موعد التسليم':p.status==='review'?(extra.deliveries.some(d=>d.part_id===p.id&&d.status==='pending'&&released(d))?'بانتظار مراجعة المشرف':'بانتظار مراجعة المشرف المسؤول'):states[p.status];
 const shownDeliveries=manager||coordinator?extra.deliveries:extra.deliveries.filter(delivery=>parts.some(part=>part.id===delivery.part_id&&(part.assignee_id===user.id||(data.lead_services||[]).includes(part.service_id)))||extra.dependencies.some(dep=>dep.upstream_id===delivery.part_id&&parts.some(part=>part.id===dep.part_id&&(part.assignee_id===user.id||(data.lead_services||[]).includes(part.service_id)))));
 const deliveryGroups=Array.from(shownDeliveries.reduce((groups,delivery)=>{const key=delivery.batch_id||delivery.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(delivery);return groups;},new Map()).values());
 const identitySource={...data,...extra};
 const departmentNames=[...new Set([...parts.map(part=>data.services.find(service=>service.id===part.service_id)?.name),...extra.routes.map(route=>route.service),data.services.find(service=>service.id===currentRequest.service_id)?.name].filter(Boolean))];
 const historyRows=(manager?extra.audit||[]:extra.events||[]).filter(event=>manager||!['due_approved','due_auto_approved'].includes(event.kind));
 const terminal=['completed','declined'].includes(currentRequest.status);
 const intake=!terminal&&edit&&['new','needs_info'].includes(currentRequest.status);
 const visibleParts=manager||coordinator?parts:parts.filter(part=>part.assignee_id===user.id||(data.lead_services||[]).includes(part.service_id));
 const orderedParts=[...visibleParts].sort((a,b)=>Number(b.assignee_id===user.id)-Number(a.assignee_id===user.id));
 const teamOverview=manager||coordinator;
 const reviewNeeded=extra.deliveries.some(delivery=>delivery.status==='pending'&&!released(delivery)&&!delivery.internal_shared_at&&parts.some(part=>part.id===delivery.part_id&&part.status==='review'&&(coordinator||manage(part.service_id))));
 const personalActionParts=!manager&&!coordinator?orderedParts.filter(p=>p.assignee_id===user.id&&['offered','working','waiting','revision'].includes(p.status)):[];
 const followupParts=!teamOverview?orderedParts.filter(p=>!personalActionParts.some(own=>own.id===p.id)):[];
 const taskPresentation=p=>personalTaskPresentation(p,{requestId:currentRequest.id,escalations:extra.escalations,outputRequests:extra.output_requests||[]});
 const personalTaskStatus=p=>{const visual=taskPresentation(p);return <span className="w-personal-task-state"><span className={`w-status ${p.status}`}>{visual.label||partLabel(p)}</span>{visual.overdue&&<span className="w-personal-task-overdue">متأخرة عن الموعد</span>}</span>;};
 const renderTaskActions=p=>p.assignee_id===user.id&&<div className="w-part-actions">
    {p.output_due_required&&p.status==='working'&&<p className="w-output-due-prompt">انتهى انتظار المخرجات حدد موعد تسليم مهمتك لاستكمال العمل</p>}
    <div className="w-actions w-part-primary">
    {p.output_distribution_pending&&p.status==='offered'&&!p.accepted_at&&(data.lead_services||[]).includes(p.service_id)&&<button className="a-primary" onClick={()=>action('delegate',p)}>تحديد الموظف المكلف بالمخرجات</button>}
    {!p.output_distribution_pending&&(p.status==='offered'||p.status==='waiting'&&!p.accepted_at)&&<button className="a-primary" onClick={()=>action('accept',p)}>{extra.deliveries.some(delivery=>delivery.part_id===p.id&&delivery.status==='changes')?'استلام التعديل وتحديد الموعد':'استلام وتحديد الموعد'}</button>}
    {p.status==='working'&&(p.output_due_required?<button className="a-primary" onClick={()=>action('commit_output_due',p)}>تحديد موعد تسليم مهمتي</button>:<button className="a-primary" onClick={()=>action(p.output_parent_id?'deliver_outputs':'deliver',p)}>{p.output_parent_id?'تسليم المخرجات للقسم':extra.deliveries.some(delivery=>delivery.part_id===p.id&&delivery.status==='changes')?'رفع التسليم بعد التعديل':'رفع التسليم'}</button>)}
    {['offered','working'].includes(p.status)&&(!p.output_parent_id||p.accepted_at)&&<button onClick={()=>action('missing',p,{submission_key:crypto.randomUUID()})}>طلب بيانات أو مرفقات من العميل</button>}
    </div>
    {['offered','working','waiting','revision'].includes(p.status)&&<details className="w-action-options"><summary>إجراءات أخرى للمهمة</summary><div className="w-actions">
    {['offered','working','waiting'].includes(p.status)&&<>{p.can_reject!==false&&<button onClick={()=>action('reject',p)}>تعذر التنفيذ</button>}{p.can_report_routing!==false&&<button onClick={()=>action('routing',p)}>خطأ في الإحالة</button>}</>}
    {!p.output_distribution_pending&&['offered','working','waiting'].includes(p.status)&&outputDepartmentChoices(extra.output_services||data.services,p,extra.output_requests).length>0&&<button onClick={()=>action('request_outputs',p)}>أحتاج مخرجات قسم</button>}
    {p.status==='revision'&&<button onClick={()=>action('scope',p)}>التعديلات خارج النطاق</button>}
    </div></details>}
   </div>;
 const renderTask=(p,showActions=true,standalone=false,index=0)=><details className={'w-part-disclosure'+(standalone?' w-supervised-task':'')} data-task-tone={standalone?(p.output_distribution_pending?'waiting':taskPresentation(p).tone):!teamOverview&&showActions&&p.assignee_id===user.id?taskPresentation(p).tone:undefined} id={`request-part-${p.id}`} key={`${p.id}-${p.status}`} open={!finishedParts.includes(p.status)}><summary>{standalone?<>
    <span className="w-supervised-task-index" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>
    <span className="w-supervised-task-title"><small>المهمة {index+1}{p.output_parent_id?' للمخرجات المطلوبة':''}</small><strong>{data.services.find(s=>s.id===p.service_id)?.name||'مهمة القسم'}</strong></span>
    <span className="w-supervised-task-badges"><span className="w-personal-task-state"><span className={`w-status ${p.status}`}>{p.output_distribution_pending?'بانتظار توزيع المهمة':taskPresentation(p).label||partLabel(p)}</span>{taskPresentation(p).overdue&&<span className="w-personal-task-overdue">متأخرة عن الموعد</span>}</span>{['urgent','normal'].includes(p.priority)&&<span className={`w-department-priority is-${p.priority}`}>{p.priority==='urgent'?'مستعجل':'عادي'}</span>}</span>
   </>:<>{data.services.find(s=>s.id===p.service_id)?.name}{!teamOverview&&showActions&&p.assignee_id===user.id?personalTaskStatus(p):<span className={`w-status ${p.status}`}>{partLabel(p)}</span>}</>}</summary><article className="w-part">
   {!standalone&&showActions&&renderTaskActions(p)}
   {manager&&manage(p.service_id)&&currentRequest.status==='active'&&p.accepted_at&&p.due_at&&!p.output_due_required&&!p.client_review_pending&&['working','waiting','needs_info','escalated','review'].includes(p.status)&&<div className="w-actions"><button type="button" disabled={busy} onClick={()=>action('override_task_due',p)}>تعديل موعد التسليم</button></div>}
   {standalone?<div className="w-supervised-task-context">
    <div className="w-supervised-task-brief"><RequestBrief text={p.scope||'حسب وصف الطلب الأساسي ومرفقاته'} label="المطلوب في هذه المهمة"/></div>
    <dl className="w-supervised-task-facts">
     <div><dt><Clock3 size={15} aria-hidden="true"/>موعد التسليم</dt><dd>{p.due_at?<RequestDate value={p.due_at}/>:p.output_distribution_pending?'بعد التوزيع واستلام المهمة':'يحدده الموظف عند الاستلام'}</dd></div>
     <div><dt><UserRound size={15} aria-hidden="true"/>الموظف المكلف</dt><dd>{p.output_distribution_pending?'بانتظار تحديد المنفذ':data.staff.find(s=>s.id===p.assignee_id)?.name||(p.assignee_id===user.id?'أنت':'غير متاح')}</dd></div>
    </dl>
   </div>:<><dl className="w-assignment-facts">
    <div><dt>{p.assignee_id===user.id?'موعد تسليم مهمتك':'موعد تسليم القسم'}</dt><dd>{p.due_at?<RequestDate value={p.due_at}/>:'يحدد عند استلام المهمة'}</dd></div>
    <div><dt>أولوية المهمة</dt><dd className={p.priority==='urgent'?'w-danger':''}>{p.priority==='urgent'?'مستعجل':'عادي'}</dd></div>
    {(manager||coordinator)&&<div><dt>الموظف المسؤول</dt><dd>{data.staff.find(s=>s.id===p.assignee_id)?.name||'موظف الفريق'}</dd></div>}
   </dl>
   {p.scope&&<RequestBrief text={p.scope} label={p.assignee_id===user.id?'المطلوب منك':'المطلوب من القسم'}/>}</>}
   {standalone&&showActions&&renderTaskActions(p)}
   {p.status==='revision'&&<div className="w-intervention"><strong>طلب تعديل من العميل</strong><p className="w-brief">{extra.deliveries.find(delivery=>delivery.part_id===p.id&&delivery.status==='changes')?.feedback}</p><p>بانتظار إحالة المشرف المسؤول إلى القسم ثم استلام التعديل وتحديد موعده</p>{(coordinator||manage(p.service_id))&&<button className="a-primary" disabled={busy} onClick={()=>action('route_revision',p)}>إحالة التعديل للقسم</button>}</div>}
   {currentRequest.status==='active'&&p.status==='offered'&&!p.accepted_at&&(data.lead_services||[]).includes(p.service_id)&&<div className={standalone?'w-supervised-task-next':'w-intervention'}><div><strong>{p.output_distribution_pending?'المطلوب الآن تحديد المنفذ':'توزيع مهمة القسم'}</strong><p>اختر موظفا من القسم ليتولى التنفيذ ويحدد موعد التسليم عند الاستلام</p></div><button type="button" className="a-primary" disabled={busy} onClick={()=>action('delegate',p)}>توزيع على الفريق<ArrowLeft size={16} aria-hidden="true"/></button></div>}
  {currentRequest.status==='active'&&manager&&manage(p.service_id)&&['offered','waiting'].includes(p.status)&&<div className="w-intervention"><p>تدخل الإدارة اختياري ويمكن فرض بدء العمل مع توضيح السبب</p><button disabled={busy} onClick={()=>action('force_start',p)}>فرض الاستلام وبدء العمل</button></div>}
  {extra.dependencies.filter(d=>(d.upstream_id===p.id||d.part_id===p.id)&&!(extra.output_requests||[]).some(row=>row.part_id===d.part_id&&row.upstream_id===d.upstream_id)).map(d=><div className="w-dependency" key={d.id}><b>اعتماد بين الأقسام</b><p>{d.reason}</p><span>{states[d.status]}</span>{d.upstream_id===p.id&&p.assignee_id===user.id&&d.status==='pending'&&<div className="w-actions"><button onClick={()=>action('dependency_reply',p,{dependency:d,decision:'accept'})}>موافق</button><button onClick={()=>action('dependency_reply',p,{dependency:d,decision:'reject'})}>رفض مع السبب</button></div>}</div>)}
  </article></details>;
 const taskDeliveries=(<details className="w-task-disclosure w-task-deliveries" open={reviewNeeded} key={`deliveries-${reviewNeeded}`}><summary><span>التسليمات والملاحظات</span><span className="w-disclosure-count">{deliveryGroups.length}</span></summary><div className="w-disclosure-body">
  {!extra.deliveries.length&&<p>لم ترفع تسليمات بعد</p>}
  {deliveryGroups.map(files=>{
   const d=files[0];
   const part=parts.find(p=>p.id===d.part_id);
   const sourceDepartment=extra.routes.find(route=>route.id===d.part_id)?.service||data.services.find(service=>service.id===part?.service_id)?.name||'القسم';
   const activeDependencies=extra.dependencies.filter(dep=>dep.upstream_id===d.part_id&&dep.status!=='waived');
   const canShare=currentRequest.status==='active'&&activeDependencies.some(dep=>dep.gate==='internal_delivery'&&['pending','accepted'].includes(dep.status))&&!activeDependencies.some(dep=>dep.gate!=='internal_delivery')&&!(extra.escalations||[]).some(escalation=>escalation.part_id===d.part_id&&escalation.kind!=='overload');
   return <article className="w-delivery" key={d.id}>
    <header className="w-delivery-heading"><strong>تسليم {sourceDepartment}</strong><small>{when(d.created_at)}</small></header><p>{files.length>1?`يتضمن ${files.length} ملفات`:'ملف واحد'}</p><div className="w-delivery-files">{files.map(file=><AttachmentActions key={file.id} file={file} onPreview={setPreview}/>)}</div>
    <span className="w-status">{d.internal_shared_at?'متاح للأقسام المستفيدة':d.status==='changes'?'تعديلات مطلوبة':d.status==='approved'?'معتمد':part?.status==='forwarded'?'أحيلت المخرجات للقسم التالي':released(d)?'بانتظار مراجعة المشرف':'لدى المشرف المسؤول'}</span>
    {d.note&&<p>{d.note}</p>}{d.feedback&&<blockquote>{d.feedback}</blockquote>}{Object.keys(d.annotation||{}).length>0&&<pre>{JSON.stringify(d.annotation,null,2)}</pre>}
    {d.status==='pending'&&released(d)&&part?.status==='review'&&((coordinator&&currentRequest.coordinator_id===user.id)||manage(part.service_id))&&<div className="w-actions"><button className="a-primary" disabled={busy} onClick={()=>action('review',part,{delivery:d,decision:'approve'})}>اعتماد التسليم</button><button disabled={busy} onClick={()=>action('review',part,{delivery:d,decision:'changes'})}>طلب تعديل</button></div>}
    {d.status==='pending'&&!released(d)&&!d.internal_shared_at&&part?.status==='review'&&(coordinator||manage(part.service_id))&&<div className="w-actions">
     {canShare&&<button className="a-primary" disabled={busy} onClick={()=>action('release_dependencies',part,{delivery:d})}>إتاحة المخرجات للأقسام</button>}
     <button className="a-primary" disabled={busy} onClick={()=>action('release_delivery',part,{delivery:d})}>إرسال لاعتماد المشرف</button>
     <button disabled={busy||currentRequest.status!=='active'||activeDependencies.length>0} onClick={()=>action('assign',null,{delivery:d})}>إحالة لقسم آخر</button>
    </div>}
   </article>;
  })}
  </div></details>);
 const optionsTrigger=<button type="button" className="w-request-options-trigger" disabled={busy} aria-haspopup="dialog" aria-controls={optionsId} onClick={()=>optionsPanel.current?.showModal()}><SlidersHorizontal size={18} aria-hidden="true"/>خيارات الطلب</button>;
 const requestDrive=requestDriveUrls(currentRequest).length>0;
 const requestSpecifications=Object.entries(currentRequest.specifications||{}).filter(([key])=>key!==additionalDriveKey&&(!requestDrive||key!==driveSpecificationKey));
 const requestSummary=(
  <section className="w-request-summary" aria-label="بيانات الطلب">
   <h4>بيانات الطلب</h4>
   <RequestBrief text={currentRequest.brief||'لم يرفق وصف للطلب'} label="وصف الطلب"/>
   <dl className="w-request-facts">
    <div><dt>الأقسام المعنية</dt><dd className="w-summary-departments">{departmentNames.length?departmentNames.map(name=><span className="w-summary-department" key={name}>{name}</span>):'بانتظار توجيه الطلب'}</dd></div>
    <div><dt>أولوية الطلب</dt><dd className={currentRequest.priority==='urgent'?'w-danger':''}>{currentRequest.priority==='urgent'?'مستعجل':'عادي'}</dd></div>
    <div><dt>الموعد المطلوب من العميل</dt><dd>{currentRequest.requested_due_at?<RequestDate value={currentRequest.requested_due_at}/>:'لم يحدد العميل موعدا'}<small>رغبة العميل وليست موعد التسليم المعتمد</small></dd></div>
   </dl>
   {(requestSpecifications.length>0||extra.files.length>0||requestDrive)&&<div className="w-request-resources">
   <RequestDriveResources request={currentRequest}/>
   {requestSpecifications.length>0&&<details className="w-task-disclosure"><summary>المواصفات المطلوبة</summary><dl className="w-task-specifications">{requestSpecifications.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details>}
   {extra.files.length>0&&<details className="w-task-disclosure"><summary><span>مرفقات الطلب</span><span className="w-disclosure-count">{extra.files.length}</span></summary><div className="w-disclosure-body"><div className="w-files">{extra.files.map(f=><AttachmentActions key={f.id} file={f} onPreview={setPreview}/>)}</div></div></details>}
   </div>}
  </section>
 );
 return <dialog ref={detailPanel} className="w-detail w-task-detail" aria-label="تفاصيل الطلب" onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();event.stopPropagation();onClose();}}>
  <div className="w-task-sheet-bar"><span>تفاصيل الطلب</span><button type="button" onClick={onClose} aria-label="إغلاق تفاصيل الطلب"><span>إغلاق</span><X size={20} aria-hidden="true"/></button></div>
  <div className="w-task-sheet-content">
  <header className="w-toolbar w-task-heading"><div><div className="w-task-kicker"><span>طلب <bdi>{currentRequest.number}</bdi></span><span className={`w-status ${currentRequest.status}`}>{states[currentRequest.status]}</span>{currentRequest.priority==='urgent'&&<span className="w-status revision">مستعجل</span>}</div><h3 ref={detailHeading} tabIndex={-1}>{currentRequest.title}</h3><div className="w-task-heading-meta">{currentRequest.created_at&&<span>تاريخ تقديم الطلب <RequestDate value={currentRequest.created_at}/></span>}</div></div><section className="w-task-heading-client" aria-label="بيانات العميل والتواصل"><ClientIdentity source={identitySource} request={currentRequest} canViewContact={manager||coordinator} variant="detail"/></section></header>
  {!ready?(error?<div className="w-error" role="alert"><span>{error}</span><button type="button" onClick={()=>setAttempt(value=>value+1)}>إعادة تحميل التفاصيل</button></div>:<div className="w-loading-state" role="status"><RefreshCw size={24}/><strong>جار تحميل تفاصيل الطلب</strong><span>نجهز الأقسام والمرفقات والمخرجات المطلوبة</span></div>):<>
  {requestSummary}
  <InquiryTriggers inquiries={extra.inquiries} onOpen={setInquirySelection}/>
  {inquirySelection&&<InquiryDialog selection={inquirySelection} inquiries={extra.inquiries} request={currentRequest} onClose={()=>setInquirySelection(null)} onSaved={()=>{setInquirySelection(null);setAttempt(value=>value+1);}} onPreview={setPreview}/>}
  {manager&&<RequestInterventions request={currentRequest} escalations={extra.escalations} parts={parts} dependencies={extra.dependencies} routes={extra.routes} services={data.services} staff={data.staff} manage={manage} busy={busy} onResolve={(part,options)=>action('resolve',part,options)}/>}
  <div className="w-task-journey"><TeamRequestRoadmap showDepartments={teamOverview} request={currentRequest} parts={parts} routes={extra.routes} deliveries={extra.deliveries} partLabel={partLabel} staff={data.staff||[]} renderPart={id=>{const part=orderedParts.find(part=>part.id===id);return part?renderTask(part):null;}} detailedPartIds={orderedParts.map(part=>part.id)} reviewContent={deliveryGroups.length>0?taskDeliveries:null}/></div>
  {personalActionParts.length>0&&<section className="w-personal-task-actions" aria-label="مهامك في هذا الطلب"><header><h4>مهامك في هذا الطلب</h4><p>راجع المطلوب ثم استلم مهمة قسمك أو اطلب البيانات الناقصة</p></header>{personalActionParts.map(p=><article key={p.id} data-task-tone={taskPresentation(p).tone} id={`personal-task-${p.id}`} tabIndex={-1}><header><div className="w-department-task-name"><h4>{data.services.find(s=>s.id===p.service_id)?.name||'مهمة القسم'}</h4>{['urgent','normal'].includes(p.priority)&&<span className={`w-department-priority is-${p.priority}`}>{p.priority==='urgent'?'مستعجل':'عادي'}</span>}</div>{personalTaskStatus(p)}</header>{p.scope&&<RequestBrief text={p.scope} label={p.output_parent_id?'مخرجات طلبها قسم آخر':'توجيه المشرف المسؤول'}/>}{renderTaskActions(p)}<details className="w-task-disclosure"><summary>تفاصيل مهمتك</summary>{renderTask(p,false)}</details></article>)}</section>}
  {followupParts.length>0&&<section className="w-supervised-tasks" aria-label="متابعة مهام القسم"><header><div><h4>متابعة مهام القسم</h4><p>كل مهمة لها حالة وموعد مستقلان</p></div><span className="w-supervised-task-count">عدد المهام <bdi>{followupParts.length}</bdi></span></header><div className="w-supervised-task-list">{followupParts.map((p,index)=>renderTask(p,true,true,index))}</div></section>}
  <OutputRequests rows={extra.output_requests} manager={manager} busy={busy} onReject={row=>action('reject_outputs',null,{outputRequest:row})} renderFiles={row=><div className="w-delivery-files">{shownDeliveries.filter(file=>file.part_id===row.upstream_id&&file.internal_shared_at).map(file=><AttachmentActions key={file.id} file={file} onPreview={setPreview}/>)}</div>}/>
  {intake&&<section className="w-next-action" aria-label="الإجراء المطلوب الآن"><div><span className="a-eyebrow">خطوتك الآن</span><h4>راجع البيانات واعتمد الطلب</h4><p>{currentRequest.status==='needs_info'?'تحقق من البيانات المستكملة ثم تابع الإحالة':'تأكد من وضوح المطلوب ثم حدد القسم المسؤول'}</p></div><div className="w-next-action-buttons"><button className="a-primary" disabled={busy} onClick={()=>action('intake')}>اعتماد البيانات وتوجيه الطلب<ArrowLeft size={17} aria-hidden="true"/></button>{optionsTrigger}</div></section>}
  {!intake&&!terminal&&edit&&<div className="w-task-option-bar">{optionsTrigger}</div>}
  {!terminal&&edit&&<dialog ref={optionsPanel} id={optionsId} className="w-request-options-dialog" aria-labelledby={`${optionsId}-title`} aria-describedby={`${optionsId}-description`} onCancel={event=>event.stopPropagation()}>
   <header><div><span className="w-options-kicker">طلب <bdi>{currentRequest.number}</bdi></span><h3 id={`${optionsId}-title`}>خيارات الطلب</h3></div><button type="button" autoFocus className="w-options-close" aria-label="إغلاق خيارات الطلب" onClick={()=>optionsPanel.current?.close()}><X size={20} aria-hidden="true"/></button></header>
   <p id={`${optionsId}-description`}>اختر الإجراء المناسب لمتابعة الطلب</p>
   <div className="w-request-option-list">
    {(coordinator||manage(currentRequest.service_id))&&<><button type="button" disabled={busy} onClick={()=>action('request_info')}><MessageCircle size={20} aria-hidden="true"/><span><strong>طلب بيانات من العميل</strong><small>تحديد المعلومات المطلوبة لاستكمال الطلب</small></span><ArrowLeft size={17} aria-hidden="true"/></button>
    <button type="button" disabled={busy} onClick={()=>action('supply_info')}><File size={20} aria-hidden="true"/><span><strong>تسجيل البيانات المستكملة</strong><small>إضافة التفاصيل التي وصلت من العميل</small></span><ArrowLeft size={17} aria-hidden="true"/></button>
    <button type="button" disabled={busy} onClick={()=>action('add_internal_info')}><File size={20} aria-hidden="true"/><span><strong>إضافة توضيح للأقسام</strong><small>معلومات داخلية للفريق المرتبط بالطلب</small></span><ArrowLeft size={17} aria-hidden="true"/></button></>}
    {['new','needs_info'].includes(currentRequest.status)&&(coordinator||manager)&&<button type="button" disabled={busy} onClick={()=>action('request_attachments')}><FolderOpen size={20} aria-hidden="true"/><span><strong>طلب مرفقات من العميل</strong><small>توضيح الملفات اللازمة لتنفيذ الطلب</small></span><ArrowLeft size={17} aria-hidden="true"/></button>}
    {currentRequest.status==='active'&&<button type="button" disabled={busy} onClick={()=>action('assign')}><Building2 size={20} aria-hidden="true"/><span><strong>إحالة إلى الأقسام</strong><small>توجيه العمل إلى الأقسام المعنية</small></span><ArrowLeft size={17} aria-hidden="true"/></button>}
    {(coordinator||manage(currentRequest.service_id))&&<button type="button" disabled={busy} onClick={()=>action('attach')}><UploadCloud size={20} aria-hidden="true"/><span><strong>إرفاق ملف العميل</strong><small>إضافة ملف إلى مرفقات الطلب</small></span><ArrowLeft size={17} aria-hidden="true"/></button>}
    {['new','needs_info'].includes(currentRequest.status)&&manager&&<button type="button" disabled={busy} className="w-option-danger" onClick={()=>action('decline_intake')}><Trash2 size={20} aria-hidden="true"/><span><strong>رفض الطلب</strong><small>توضيح سبب عدم اعتماد الطلب</small></span><ArrowLeft size={17} aria-hidden="true"/></button>}
   </div>
  </dialog>}
  <div className="w-task-support">
  {teamOverview&&<details className="w-task-disclosure"><summary>توزيع الأقسام ومسؤولو التنفيذ</summary><div className="w-disclosure-body">
  <details className="w-history"><summary>تفاصيل توزيع الأقسام</summary>
  {extra.routes.length>0&&<p className="w-routing-hint">{new Set(extra.routes.map(p=>p.service_id||p.service)).size>1?'طلب متعدد الأقسام وكل قسم يحدد حاجته إلى مخرجات الأقسام الأخرى':'طلب لقسم واحد'}</p>}
  <ol className="w-route">{extra.routes.map((p,i)=>{const routePart=parts.find(part=>part.id===p.id),staffMember=(data.staff||[]).find(member=>member.id===(p.assignee_id||routePart?.assignee_id));const departmentOwner=firstText(p.assignee_name,p.responsible_name,p.owner_name,staffMember?.name);return <li key={p.id}><b>{i+1}</b><span>{p.service}</span>{p.status&&<small>{partLabel(p)}</small>}<ClientIdentity source={identitySource} request={currentRequest} canViewContact={manager||coordinator} showContactMethods={false} variant="route" departmentOwner={departmentOwner}/></li>;})}</ol>
  </details>
  </div></details>}
  {coordinationTasks.length>0&&<details className="w-task-disclosure"><summary>سجل مهامي في الطلب</summary><div className="w-disclosure-body">
  {coordinationTasks.length>0&&<section className="w-coordination-tasks" aria-label="مهام الاستلام والمراجعة">
   <header><span className="a-eyebrow">ضمن مهامي</span><h4>دورك في استلام الطلب ومراجعته</h4><p>تحتسب المهمة بعد إكمال الإجراء وتسجل في أدائك</p></header>
   <ul>{coordinationTasks.map(task=><li key={task.task_key}>
    <div><strong>{coordinatorTaskLabels[task.kind]}</strong><small>{task.completed_at?`أنجزتها ${when(task.completed_at)}`:task.assignee_id?'مسندة إليك': 'متاحة للاستلام من فريق الإشراف'}</small></div>
    <span className={`w-status ${task.status==='completed'?'approved':task.status==='waiting'?'needs_info':'working'}`}>{task.status==='completed'?'تم الإنجاز':task.status==='waiting'?'بانتظار بيانات العميل':'تحتاج إجراءك'}</span>
   </li>)}</ul>
  </section>}
  </div></details>}
  <RequestHistory title={teamOverview?undefined:'سجل مهامك في الطلب'} rows={teamOverview?historyRows:historyRows.filter(row=>visibleParts.some(part=>part.id===row.part_id))} events={extra.events} parts={visibleParts} routes={extra.routes} services={data.services} request={currentRequest} manager={manager}/>
  <PlannerMoveHistory requestId={r.id} version={currentRequest.version}/>
  </div>
  </>}
  {preview&&<AttachmentPreview key={preview.object_path} file={preview} onClose={()=>setPreview(null)}/>}
  </div>
 </dialog>;
}

function RequestDate({value}){
 return <time className="w-fact-date" dateTime={value}>{dateLabel(value)}</time>;
}

function RequestBrief({text,label='المطلوب'}){
 const [expanded,setExpanded]=useState(false);
 const long=text.length>220||text.split('\n').length>3;
 return <section className="w-task-brief"><h4>{label}</h4><p className={`w-brief ${long&&!expanded?'is-collapsed':''}`}>{text}</p>{long&&<button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'اختصار الوصف':'قراءة الوصف كاملا'}</button>}</section>;
}

function DepartmentAssignments({services,staff,mode,onMode,assignments,onChange,disabled,defaultPriority='normal'}){
 const emptyAssignment=service_id=>({service_id,assignee_id:departmentLead(staff,service_id)?.id||'',scope:'',priority:defaultPriority});
 const update=(id,key,value)=>onChange(assignments.map(row=>row.service_id===id?{...row,[key]:value}:row));
 return <div className="w-routing-fields">
  <fieldset className="w-routing-mode" disabled={disabled}><legend>نوع الطلب</legend>
   <label><input type="radio" name="route_mode" value="single" checked={mode==='single'} onChange={()=>onMode('single')}/>قسم واحد</label>
   <label><input type="radio" name="route_mode" value="multi" checked={mode==='multi'} onChange={()=>onMode('multi')}/>عدة أقسام</label>
  </fieldset>
  {mode==='single'?<label>القسم<select aria-label="القسم" required disabled={disabled} value={assignments[0]?.service_id||''} onChange={e=>onChange([emptyAssignment(e.target.value)])}><option value="">اختر القسم</option>{services.map(service=><option key={service.id} value={service.id}>{service.name}</option>)}</select></label>:<fieldset className="w-department-options" disabled={disabled}><legend>الأقسام المشاركة في الطلب</legend>
   {services.map(service=><label key={service.id}><input type="checkbox" checked={assignments.some(row=>row.service_id===service.id)} onChange={e=>onChange(e.target.checked?[...assignments,emptyAssignment(service.id)]:assignments.filter(row=>row.service_id!==service.id))}/>{service.name}</label>)}
  </fieldset>}
  {!services.length&&<p role="status">لا توجد أقسام متاحة للإحالة بصلاحياتك الحالية</p>}
  {assignments.map(row=>{
   const employees=assignmentCandidates(staff,row.service_id);
   return <fieldset className="w-department-assignment" key={row.service_id} disabled={disabled}><legend>{services.find(service=>service.id===row.service_id)?.name||'تكليف القسم'}</legend>
    <label>الموظف المسؤول<select aria-label="الموظف المسؤول" required value={row.assignee_id} onChange={e=>update(row.service_id,'assignee_id',e.target.value)}><option value="">اختر الموظف</option>{employees.map((employee,index)=><option key={employee.id} value={employee.id}>{assignmentOption(employee,index,row.service_id)}</option>)}</select></label>
    {!employees.length&&<p className="w-routing-hint">لا يوجد موظف مسجل في هذا القسم</p>}
    {employees.length>0&&<p className="w-routing-hint">{departmentLead(staff,row.service_id)?'مسؤول القسم هو المستلم المقترح ويتولى توزيع المهمة على فريقه ويمكن اختيار عضو مباشرة':'اختر المكلف حسب مسؤوليته والطاقة المتاحة له'}</p>}
    <label>المطلوب من هذا القسم فقط اختياري<textarea aria-label="المطلوب من هذا القسم فقط اختياري" placeholder="عند تركه فارغا يعتمد وصف الطلب الأساسي ومرفقاته" minLength={3} maxLength={6000} value={row.scope} onChange={e=>update(row.service_id,'scope',e.target.value)}/></label>
    <label>أولوية مهمة القسم<select aria-label="أولوية مهمة القسم" value={row.priority} onChange={e=>update(row.service_id,'priority',e.target.value)}><option value="normal">عادي</option><option value="urgent">مستعجل</option></select></label>
   </fieldset>;
  })}
  <p className="w-routing-hint">كل قسم يحدد عند الاستلام ما إذا كان يحتاج مخرجات قسم آخر لبدء عمله</p>
 </div>;
}

function ActionDialog({spec,data,user,execute,busy,close}){
 const services=data.services.filter(s=>s.active&&(user.app_metadata?.role!=='admin'||data.coordinator||data.grants.some(g=>g.user_id===user.id&&g.service_id===s.id&&g.can_manage)));
 const prefix=`team:action:${spec.draftKey}:`;
 const [fields,setFields]=useSessionState(prefix+'fields',{});
 const field=(name,fallback='',key=name)=>({name,value:fields[key]??fallback,onChange:event=>setFields(current=>({...current,[key]:event.target.value}))});
 const dateField=name=>({name,value:fields[name]??(spec.action==='override_task_due'&&name==='due_at'?riyadhDate(spec.part?.due_at):''),onChange:value=>setFields(current=>({...current,[name]:value}))});
 const ref=useRef(null),uploadControl=useRef(null),cachedUpload=useRef(new Map()),submitting=useRef(false),[uploading,setUploading]=useState(false),[progress,setProgress]=useState({}),[files,setFiles]=useSessionState(prefix+'files',[]),[error,setError]=useState(''),[service,setService]=useSessionState(prefix+'service',spec.part?.service_id||spec.request?.requested_service_id||spec.request?.service_id||services[0]?.id||''),[decision,setDecision]=useSessionState(prefix+'decision',spec.decision||(spec.escalation?.kind==='dependency'?(spec.canEnforceDependency?'enforce_dependency':'waive_dependency'):'keep')),[clients,setClients]=useState([]),[clientSearch,setClientSearch]=useSessionState(prefix+'client-search','');
 const batchRouting=spec.action==='intake'&&!(spec.parts||[]).length||spec.action==='assign'&&!spec.delivery;
 const initialService=services.some(s=>s.id===service)?service:services[0]?.id;
 const [routeMode,setRouteMode]=useSessionState(prefix+'route-mode','single'),[assignments,setAssignments]=useSessionState(prefix+'assignments',initialService?[{service_id:initialService,assignee_id:departmentLead(data.staff,initialService)?.id||'',scope:'',priority:spec.request?.priority||'normal'}]:[]);
 const [needsOutputs,setNeedsOutputs]=useSessionState(prefix+'needs-outputs',false),[outputAssignments,setOutputAssignments]=useSessionState(prefix+'output-assignments',[]);
 useEffect(()=>{
  setService(service);setDecision(decision);setAssignments(assignments);
  setFields(current=>({priority:spec.part?.priority||spec.request?.priority||'normal',[`assignee:${service}`]:spec.action==='assign'?departmentLead(data.staff,service)?.id||'':'',...current}));
 },[]);
 const existingDependencies=(spec.dependencies||[]).filter(dependency=>dependency.part_id===spec.part?.id&&dependency.status!=='waived');
 const availableRoutes=(spec.routes||[]).filter(route=>route.id!==spec.part?.id&&route.status!=='forwarded'&&!(spec.dependencies||[]).some(dependency=>dependency.part_id===spec.part?.id&&dependency.upstream_id===route.id));
 const outputServices=spec.outputServices||data.services;
 const outputChoices=outputDepartmentChoices(outputServices,spec.part,spec.outputRequests);
 const requestingOutputs=spec.action==='request_outputs'||spec.action==='accept'&&needsOutputs;
 function changeRouteMode(mode){setRouteMode(mode);if(mode==='single')setAssignments(rows=>rows.length?[rows[0]]:initialService?[{service_id:initialService,assignee_id:departmentLead(data.staff,initialService)?.id||'',scope:'',priority:spec.request?.priority||'normal'}]:[]);}
 const labels={delegate:'توزيع المهمة على الفريق',route_revision:'إحالة تعديل العميل للقسم',create:'تسجيل طلب العميل',intake:'اعتماد بيانات الطلب',assign:'إحالة المهمة',accept:'استلام المهمة',missing:'البيانات المطلوبة',reject:'سبب تعذر التنفيذ',routing:'توضيح خطأ الإحالة',scope:'تصعيد التعديلات خارج النطاق',dependency:'المخرجات المطلوبة من قسم آخر',dependency_reply:'الرد على اعتماد القسم',deliver:'رفع تسليم جديد',resolve:'قرار الإدارة',force_start:'فرض الاستلام وبدء العمل',review:'مراجعة التسليم',release_dependencies:'إتاحة المخرجات للأقسام',attach:'مرفق العميل',request_info:'طلب استكمال البيانات',supply_info:'البيانات المستكملة',reject_due:'رفض الموعد وتحديد البديل',request_attachments:'طلب مرفقات من العميل',decline_intake:'رفض الطلب'};
 Object.assign(labels,{add_internal_info:'إضافة توضيح للأقسام',request_outputs:'طلب مخرجات من الأقسام',deliver_outputs:'تسليم المخرجات للقسم',reject_outputs:'رفض طلب المخرجات',commit_output_due:'تحديد موعد تسليم مهمتي',override_task_due:'تعديل موعد تسليم المهمة'});
 useEffect(()=>{const modal=ref.current,previous=document.activeElement;modal.showModal();return()=>{uploadControl.current?.abort();modal.close();if(previous?.isConnected)previous.focus?.();};},[]);
 useEffect(()=>{if(spec.action!=='create')return;let live=true;const timer=setTimeout(()=>repository.clients(clientSearch).then(c=>{if(live)setClients(c);}).catch(()=>setError('تعذر تحميل العملاء')),200);return()=>{live=false;clearTimeout(timer);};},[clientSearch]);
 const needsReason=['add_internal_info','missing','reject','routing','scope','dependency','resolve','force_start','request_info','supply_info','reject_due','request_attachments','decline_intake','reject_outputs'].includes(spec.action)||spec.action==='dependency_reply'&&decision==='reject';
 const directInquiry=spec.action==='missing'&&data.services.find(service=>service.id===spec.part?.service_id)?.client_visible!==false;
 async function submit(e){e.preventDefault();if(submitting.current)return;submitting.current=true;setError('');const form=new FormData(e.currentTarget),values=Object.fromEntries(form);
  try{
   const p={...values,...(spec.action==='review'?{decision:spec.decision}:{}),submission_key:spec.submission_key||spec.draftKey,request_id:spec.request?.id,version:spec.request?.version,part_id:spec.part?.id,delivery_id:spec.delivery?.id,escalation_id:spec.escalation?.id,dependency_id:spec.dependency?.id,due_review_id:spec.dueReview?.id,output_request_id:spec.outputRequest?.id};
   if(batchRouting){
    if(!assignments.length||routeMode==='multi'&&assignments.length<2){setError(routeMode==='multi'?'اختر قسمين على الأقل للطلب متعدد الأقسام':'اختر القسم المسؤول عن الطلب');return;}
    if(assignments.some(row=>row.scope.trim()&&row.scope.trim().length<3)){setError('عند تحديد المطلوب من القسم اكتب ثلاثة أحرف على الأقل');return;}
    p.route_mode=routeMode;p.assignments=assignments.map(row=>({...row,scope:row.scope.trim()||'حسب وصف الطلب الأساسي ومرفقاته'}));
    delete p.service_id;delete p.assignee_id;delete p.scope;delete p.priority;
   }
   if(spec.action==='assign'&&!batchRouting)p.scope=values.scope?.trim()||'حسب وصف الطلب الأساسي ومرفقاته';
   if(spec.action==='accept')delete p.output_dependency_mode;
   if(spec.action==='resolve'&&decision==='keep')delete p.due_at;
   if(requestingOutputs){
    const invalid=validateOutputSelection(outputAssignments,outputChoices);
    if(invalid){setError(invalid);return;}
    p.outputs=outputAssignments.map(({service_id,reason})=>({service_id,reason:reason.trim()}));
    delete p.due_at;
   }
   if(spec.action==='dependency')p.gate='internal_delivery';
   if(values.due_at)p.due_at=endOfRiyadhDay(values.due_at);
   if(values.requested_due_at)p.requested_due_at=endOfRiyadhDay(values.requested_due_at);
   if(['deliver','deliver_outputs','attach'].includes(spec.action)){
    const driveUrl=spec.action==='attach'?normalizeDriveUrl(fields.drive_url||''):'';
    if(driveUrl)p.drive_url=driveUrl;
    if(!files.length&&!driveUrl){setError(spec.action==='attach'?'أضف رابط Google Drive أو اختر ملفا لإكمال الإرفاق':'اختر ملفا واحدا على الأقل لإكمال الرفع');return;}
    setUploading(true);uploadControl.current=new AbortController();p.files=[];
    for(const file of files){
     const key=fileKey(file);
     if(!cachedUpload.current.has(key)){
      const uploaded=await uploadFile(spec.request.id,spec.part?.id||'brief',file,{onProgress:value=>setProgress(current=>({...current,[key]:value})),signal:uploadControl.current.signal});
      cachedUpload.current.set(key,uploaded);
     }
     const uploaded=cachedUpload.current.get(key);
     p.files.push({object_path:uploaded.object_path,filename:uploaded.filename});
    }
    delete p.file;
    // A large upload may outlive other edits so use the current version at finalization
    p.version=(await repository.request(spec.request.id)).version;
    if(uploadControl.current.signal.aborted)throw new Error('upload_paused');
    setUploading(false);
   }
   if(spec.action==='create'){p.specifications={};if(values.dimensions)p.specifications['المقاسات']=values.dimensions;if(values.quantity)p.specifications['الكمية']=values.quantity;}
   await execute(requestingOutputs?'request_outputs':spec.action,p);
   for(const file of files)repository.forgetUpload(cachedUpload.current.get(fileKey(file))?.cache_key);
  }catch(e){setError(e.message==='upload_paused'?'تم إيقاف الرفع مؤقتا اختر تأكيد الإجراء لاستكماله':workError(e));}
  finally{submitting.current=false;setUploading(false);}
 }
 return <dialog className={`w-dialog ${spec.plannerMove?'w-planner-dialog':''}`} ref={ref} aria-labelledby="work-action-title" onCancel={e=>{if(busy||uploading)e.preventDefault();else close();}}><form onSubmit={submit}><header className="w-toolbar"><h3 id="work-action-title">{spec.action==='release_delivery'?'إرسال التسليم للمشرف':labels[spec.action]}</h3><button type="button" disabled={busy||uploading} onClick={close}>إغلاق</button></header>
  {spec.plannerMove&&<label>ملاحظة نقل المهمة<textarea {...field('planner_note')} required minLength={3} maxLength={2000} disabled={busy||uploading}/><small>تحفظ في سجل المهمة الداخلي ولا تظهر للعميل</small></label>}
  {error&&<p role="alert" className="w-error">{error}</p>}
  {spec.action==='create'&&<><label>ابحث عن العميل<input value={clientSearch} onChange={e=>setClientSearch(e.target.value)}/></label><label>العميل<select aria-label="العميل" {...field('client_id')} required><option value="">اختر العميل</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>عنوان الطلب<input {...field('title')} required minLength={3} maxLength={200}/></label><label>وصف المطلوب<textarea {...field('brief')} required minLength={10} maxLength={12000}/></label><label>المقاسات عند الحاجة<input {...field('dimensions')}/></label><label>الكمية عند الحاجة<input {...field('quantity')} type="number" min="1"/></label></>}
  {batchRouting&&<DepartmentAssignments services={services} staff={data.staff} defaultPriority={spec.request?.priority||'normal'} mode={routeMode} onMode={changeRouteMode} assignments={assignments} onChange={setAssignments} disabled={busy||uploading}/>}
  {spec.action==='delegate'&&<><p>التوزيع متاح لأعضاء القسم نفسه ويستلم المكلف المهمة ويحدد موعده من حسابه</p><label>المكلف من فريق القسم<select {...field('assignee_id')} required disabled={busy}><option value="">اختر عضو الفريق</option>{assignmentCandidates(data.staff,spec.part?.service_id,spec.part?.output_distribution_pending?null:spec.part?.assignee_id).map((employee,index)=><option value={employee.id} key={employee.id}>{assignmentOption(employee,index,spec.part?.service_id)}</option>)}</select></label>{!assignmentCandidates(data.staff,spec.part?.service_id,spec.part?.output_distribution_pending?null:spec.part?.assignee_id).length&&<p role="status">لا يوجد عضو آخر متاح في القسم اطلب من الإدارة إضافة أعضاء الفريق</p>}</>}
  {(spec.action==='create'||spec.action==='assign'&&!batchRouting)&&<label>الخدمة<select aria-label="الخدمة" name="service_id" value={service} required onChange={e=>setService(e.target.value)}>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
  {(spec.action==='create'||spec.action==='assign'&&!batchRouting||spec.action==='resolve'&&decision==='reassign')&&<label>حالة الطلب<select aria-label="حالة الطلب" {...field('priority',spec.part?.priority||spec.request?.priority||'normal')}><option value="normal">عادي</option><option value="urgent">مستعجل</option></select></label>}
  {spec.action==='create'&&<DatePicker label="تاريخ التسليم المطلوب" {...dateField('requested_due_at')} required min={riyadhDate()} disabled={busy||uploading} hint="التسليم حتى نهاية اليوم المختار بتوقيت الرياض"/>}
  {spec.action==='assign'&&spec.request?.requested_due_at&&<p>موعد العميل المطلوب {dateLabel(spec.request.requested_due_at)}</p>}
  {spec.action==='assign'&&spec.delivery&&<p>ستنتقل مخرجات هذا القسم مع الطلب إلى الموظف المختار لاستكمال العمل قبل إرسال النتيجة للعميل</p>}
  {spec.action==='resolve'&&<label>قرار الإدارة<select aria-label="قرار الإدارة" name="decision" value={decision} onChange={e=>setDecision(e.target.value)}>{spec.escalation.kind==='dependency'?<>{spec.canEnforceDependency&&<option value="enforce_dependency">إلزام القسم بتوفير المخرجات</option>}<option value="waive_dependency">إلغاء الاعتماد والسماح بالعمل</option></>:<><option value="keep">إبقاء المهمة وإلزام الموظف</option><option value="reassign">نقل المهمة إلى موظف آخر</option></>}</select></label>}
  {spec.action==='resolve'&&spec.escalation.kind==='dependency'&&!spec.canEnforceDependency&&<p className="w-routing-hint">إلزام القسم الآخر يحتاج صلاحية إدارة ذلك القسم</p>}
  {spec.action==='resolve'&&decision==='reassign'&&<label>القسم الصحيح للمهمة<select aria-label="القسم الصحيح للمهمة" name="service_id" value={service} onChange={e=>setService(e.target.value)}>{services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
  {(spec.action==='assign'&&!batchRouting||spec.action==='resolve'&&decision==='reassign')&&<label>الموظف<select key={service} aria-label="الموظف" {...field('assignee_id',spec.action==='assign'?departmentLead(data.staff,service)?.id||'':'',`assignee:${service}`)} required><option value="">اختر الموظف</option>{assignmentCandidates(data.staff,service,spec.part?.assignee_id).map((employee,index)=><option value={employee.id} key={employee.id}>{assignmentOption(employee,index,service)}</option>)}</select><small className="w-routing-hint">يظهر الاختيار المقترح أولا حسب أقل نسبة إشغال والطاقة المتاحة</small></label>}
  {spec.action==='assign'&&!batchRouting&&<label>المطلوب من هذا القسم فقط اختياري<textarea {...field('scope')} placeholder="عند تركه فارغا يعتمد وصف الطلب الأساسي ومرفقاته" minLength={3} maxLength={6000}/></label>}
  {(spec.action==='accept'&&!needsOutputs||spec.action==='commit_output_due'||spec.action==='override_task_due'||spec.action==='force_start')&&<DatePicker label="تاريخ التسليم" {...dateField('due_at')} required min={riyadhDate()} disabled={busy||uploading} hint="التسليم حتى نهاية اليوم المختار بتوقيت الرياض"/>}
  {spec.action==='resolve'&&decision==='keep'&&spec.escalation.kind!=='overload'&&<p>تعود المهمة للموظف نفسه ليستلمها ويحدد موعد التسليم ويختفي خيار تعذر التنفيذ لهذه المهمة</p>}
  {spec.action==='override_task_due'&&<p>الموعد الحالي {dateLabel(spec.part.due_at)}<br/>يعتمد الموعد الجديد مباشرة ويصل إشعار للموظف</p>}
  {spec.action==='reject_due'&&<><p>الموعد المقترح {dateLabel(spec.dueReview?.proposed_due_at)}</p><DatePicker label="تاريخ التسليم البديل" {...dateField('due_at')} required min={riyadhDate()} disabled={busy||uploading} hint="التسليم حتى نهاية اليوم المختار بتوقيت الرياض"/></>}
  {spec.action==='accept'&&<>
   {existingDependencies.length>0&&<p className="w-routing-hint">هذه المهمة مرتبطة باعتمادات مسجلة ويستمر انتظار المخرجات المطلوبة حتى تتاح للقسم</p>}
   {outputChoices.length>0&&<><fieldset className="w-routing-mode" disabled={busy}><legend>احتياج القسم لبدء العمل</legend>
    <label><input type="radio" name="output_dependency_mode" value="independent" checked={!needsOutputs} onChange={()=>setNeedsOutputs(false)}/>{existingDependencies.length?'لا أحتاج اعتمادا إضافيا':'أستطيع البدء مستقلا'}</label>
    <label><input type="radio" name="output_dependency_mode" value="required" checked={needsOutputs} onChange={()=>setNeedsOutputs(true)}/>أحتاج مخرجات قسم آخر</label>
   </fieldset>
   </>}
  </>}
  {requestingOutputs&&<OutputAssignments services={outputServices} choices={outputChoices} rows={outputAssignments} onChange={setOutputAssignments} disabled={busy||uploading}/>}
  {spec.action==='reject_outputs'&&<p>يرفض هذا الطلب فقط ويمنع إعادة طلب مخرجات القسم نفسه في هذه المهمة</p>}
  {spec.action==='deliver_outputs'&&<p>تصل المخرجات مباشرة إلى القسم الذي طلبها ليحدد موعد تسليم مهمته</p>}
  {spec.action==='commit_output_due'&&<p>حدد موعدك بعد الاطلاع على المخرجات المتاحة ويعتمد الموعد مباشرة</p>}
  {spec.action==='dependency'&&<label>القسم الذي تحتاج مخرجاته<select aria-label="القسم الذي تحتاج مخرجاته" {...field('upstream_id')} required><option value="">اختر القسم</option>{availableRoutes.map(p=><option key={p.id} value={p.id}>{p.service}</option>)}</select></label>}
  {spec.action==='dependency_reply'&&<input type="hidden" name="decision" value={decision}/>}
  {spec.action==='force_start'&&<p>سيبدأ الموظف العمل مباشرة ويلغى انتظار مخرجات الأقسام لهذه المهمة مع تسجيل سبب قرار الإدارة</p>}
  {spec.action==='resolve'&&<p className="w-routing-hint">التدخل اختياري ويمكنك ترك المهمة دون إجراء</p>}
  {spec.action==='request_attachments'&&<p>سيصل للعميل طلب واضح بالمرفقات المطلوبة ويسجل الإجراء ضمن رحلة الطلب</p>}
  {spec.action==='decline_intake'&&<p>سيصل للعميل سبب عدم اعتماد الطلب ويسجل القرار ضمن رحلة الطلب</p>}
  {directInquiry&&<><p>يرسل الطلب مباشرة إلى العميل ويظهر رده للأقسام المشاركة في الطلب</p><label>المطلوب من العميل<select {...field('inquiry_kind','data')}><option value="data">بيانات إضافية</option><option value="files">مرفقات إضافية</option></select></label></>}
  {spec.action==='missing'&&!directInquiry&&<p>هذا القسم داخلي ويصل طلب البيانات إلى المشرف المسؤول</p>}
  {spec.action==='add_internal_info'&&<p>يظهر التوضيح للفريق والأقسام المرتبطة بالطلب فقط ولا يظهر للعميل أو يرسل إليه</p>}
  {needsReason&&<label>{spec.action==='add_internal_info'?'المعلومة التوضيحية':directInquiry?'رسالتك للعميل':spec.action==='reject_due'?'سبب رفض الموعد':spec.action==='request_attachments'?'المرفقات المطلوبة':spec.action==='decline_intake'?'سبب رفض الطلب':['resolve','force_start'].includes(spec.action)?'توضيح القرار':'التفاصيل والسبب'}<textarea {...field('reason')} required minLength={3} maxLength={4000}/></label>}
  {spec.action==='attach'&&<DriveLinkField value={fields.drive_url||''} onChange={value=>setFields(current=>({...current,drive_url:value}))} disabled={busy||uploading}/>}
  {['deliver','deliver_outputs','attach'].includes(spec.action)&&<><div className="w-upload-picker"><UploadCloud size={28}/><strong>{['deliver','deliver_outputs'].includes(spec.action)?'أضف ملفات التسليم':'أضف مرفقات العميل'}</strong><p>ترفع الملفات الأصلية كما هي مع الحفاظ على الاسم والصيغة والجودة</p><label>اختيار الملفات<input name="file" type="file" multiple disabled={busy||uploading} onChange={event=>{const picked=Array.from(event.target.files||[]);setFiles(current=>{const keys=new Set(current.map(fileKey));return [...current,...picked.filter(file=>{const key=fileKey(file);if(keys.has(key))return false;keys.add(key);return true;})];});event.target.value='';}}/></label><small>يمكنك إضافة ملفات أخرى قبل التأكيد واستكمال الرفع بعد انقطاع الاتصال</small></div>{files.length>0&&<div className="w-upload-list"><div className="w-upload-summary"><strong>{files.length===1?'ملف واحد مختار':`${files.length} ملفات مختارة`}</strong><span dir="ltr">{fileSize(files.reduce((total,file)=>total+file.size,0))}</span></div>{files.map(file=>{const key=fileKey(file),percent=progress[key]||0;return <div key={key} className="w-upload-item"><File size={19}/><div><b dir="auto">{file.name}</b><small><span dir="ltr">{fileSize(file.size)}</span>{percent>0&&<span>{percent===100?'جاهز للحفظ':`تم رفع ${percent}%`}</span>}</small>{percent>0&&<progress max="100" value={percent} aria-label={`تقدم رفع ${file.name}`}/>}</div><button type="button" disabled={busy||uploading} aria-label={`إزالة ${file.name}`} onClick={()=>{setFiles(current=>current.filter(item=>fileKey(item)!==key));}}><Trash2 size={17}/></button></div>;})}</div>}{uploading&&<div className="w-upload-running" role="status"><span>جار رفع الملفات الأصلية</span><button type="button" onClick={()=>uploadControl.current?.abort()}>إيقاف مؤقت</button></div>}<label>{['deliver','deliver_outputs'].includes(spec.action)?'ملاحظة على التسليم':'ملاحظة على المرفقات'}<textarea {...field('note')} maxLength={4000}/></label></>}
  {spec.action==='intake'&&<p>{batchRouting?'اعتماد الطلب يؤكد اكتمال بياناته ويحيله إلى الأقسام المختارة ويبلغ العميل باستلام فريق الإشراف':'اعتماد البيانات يؤكد اكتمال الطلب لمتابعته مع الأقسام المكلفة'}</p>}
  {spec.action==='release_dependencies'&&<p>ستتاح المخرجات للأقسام التي وافقت على الاعتماد عليها ليستكمل الفريق العمل قبل إرسال النتيجة النهائية للعميل</p>}
  {spec.action==='route_revision'&&<p>سيحال تعديل العميل إلى الموظف المكلف بالقسم الذي رفع التسليم ليستلمه ويحدد الموعد ثم يرفع النسخة المعدلة للمشرف المسؤول</p>}
  {spec.action==='review'&&<><p>{spec.decision==='approve'?'اعتماد التسليم وإثبات اكتمال مهمة القسم':'إعادة التسليم للقسم مع تحديد التعديلات المطلوبة'}</p><label>ملاحظات المشرف<textarea {...field('reason')} required={spec.decision==='changes'} minLength={spec.decision==='changes'?3:undefined} maxLength={4000}/></label></>}
  {spec.action==='release_delivery'&&<p>سينتقل هذا التسليم إلى المشرف المسؤول لاعتماده أو طلب تعديلات</p>}
  <button className="a-primary" disabled={busy||uploading||batchRouting&&!services.length} type="submit">{uploading?'جار رفع الملفات':busy?'جار الحفظ':spec.action==='force_start'?'فرض الاستلام وبدء العمل':spec.action==='reject_due'?'رفض الموعد واعتماد البديل':spec.action==='request_attachments'?'إرسال طلب المرفقات':spec.action==='decline_intake'?'رفض الطلب':'تأكيد الإجراء'}</button>
  {['resolve','force_start'].includes(spec.action)&&<button type="button" disabled={busy||uploading} onClick={close}>عدم اتخاذ إجراء</button>}
 </form></dialog>;
}
