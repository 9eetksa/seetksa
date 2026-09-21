import {supabase} from '../auth/supabase';
import {publicAccountData} from '../auth/account-rules';
import {getEffectiveUser,getImpersonation,hasImpersonation,refreshImpersonation,subscribeImpersonation,uploadWithEffectiveAccess} from '../auth/impersonation';
import * as tus from 'tus-js-client';
import {clientSchedule} from './client-schedule';
import {collectTaskPages} from './completed-task-pages.js';
export const states={new:'طلب جديد',needs_info:'نقص بيانات',active:'قيد التنفيذ',completed:'مكتمل',declined:'مرفوض',offered:'بانتظار الاستلام',working:'قيد التنفيذ',escalated:'بانتظار قرار الإدارة',waiting:'بانتظار مخرجات قسم',review:'بانتظار اعتماد المشرف',forwarded:'تم التسليم للقسم التالي',internal_done:'تم تسليم المخرجات للأقسام',revision:'تعديلات مطلوبة',approved:'معتمد',pending:'بانتظار الرد',accepted:'مقبول',rejected:'مرفوض',waived:'ألغت الإدارة الاعتماد'};
export const kinds={overload:'ضغط العمل',rejection:'رفض التنفيذ',scope:'خارج النطاق',dependency:'اعتماد بين الأقسام',routing:'خطأ في الإحالة'};
export const events={employee_due_advanced:'تقديم موعد التسليم من الموظف',employee_due_requested:'طلب تأجيل موعد التسليم',employee_due_approved:'موافقة الإدارة على تأجيل الموعد',employee_due_rejected:'رفض الإدارة تأجيل الموعد',admin_due_changed:'تعديل موعد التسليم من الإدارة',output_request:'طلب مخرجات من قسم آخر',output_ready:'تسليم المخرجات للقسم المستفيد',output_rejected:'رفض الإدارة لطلب المخرجات',output_due:'تحديد موعد التسليم بعد المخرجات',delegate:'توزيع المهمة على فريق القسم',route_revision:'إحالة التعديلات للقسم',create:'رفع الطلب',submit_request:'إرسال طلب العميل',intake:'اعتماد فريق الإشراف',assign:'إحالة إلى قسم',accept:'استلام المهمة',force_start:'فرض الاستلام بقرار الإدارة',force_dependency_waived:'إلغاء شرط الانتظار بقرار الإدارة',missing:'طلب بيانات ناقصة',reject:'تصعيد رفض التنفيذ',scope:'تصعيد التعديلات خارج النطاق',routing:'تصعيد خطأ الإحالة',dependency:'طلب مخرجات قسم',dependency_reply:'رد القسم',deliver:'تسليم القسم لالمشرف المسؤول',release_delivery:'إرسال التسليم لمراجعة المشرف',release_dependencies:'تسليم المخرجات للأقسام',handoff:'إحالة المخرجات لقسم آخر',resolve:'قرار الإدارة',review:'مراجعة المشرف',attach:'إضافة مرفق',request_info:'طلب استكمال البيانات',supply_info:'استكمال البيانات',due_approved:'اعتماد موعد التسليم',due_auto_approved:'اعتماد موعد التسليم تلقائيا',due_rejected:'تعديل موعد التسليم بقرار الإدارة',request_attachments:'طلب مرفقات إضافية',decline_intake:'رفض الطلب'};
events.internal_clarification='توضيح داخلي من المشرف المسؤول';
const progressByState={offered:8,needs_info:18,working:45,revision:65,waiting:68,escalated:70,review:82,forwarded:92,internal_done:100,approved:100};
export const taskProgress=status=>progressByState[status]??0;
export const when=value=>value?`${new Date(value).toLocaleDateString('ar-SA',{dateStyle:'medium'})} الساعة ${new Date(value).toLocaleTimeString('ar-SA',{timeStyle:'short'})}`:'لم يحدد بعد';
export async function result(query){const {data,error}=await query;if(error)throw error;return publicAccountData(data);}
const controlActions=new Set(['approve_due','reject_due','request_attachments','decline_intake']);
const plannerActions={reschedule_task_due:'work_reschedule_task_due',review_task_due_change:'work_review_task_due_change',planner_transition:'work_planner_action'};
export const call=(action,p={})=>result(supabase.rpc(['create','submit_request','reply_department'].includes(action)&&Object.hasOwn(p,'drive_url')?'work_client_resource_action':plannerActions[action]||(action==='override_task_due'?'work_override_task_due':['request_outputs','deliver_outputs','reject_outputs','commit_output_due'].includes(action)?'work_output_action':action==='reply_department'||action==='missing'&&p.inquiry_kind?'work_department_inquiry_action':controlActions.has(action)?'work_control_action':'work_action'),action==='planner_transition'?p:plannerActions[action]||action==='override_task_due'?{p}:{action,p}));
const missingRpc=error=>error?.code==='PGRST202'||error?.code==='42883';
async function rpcWithLegacy(name,args,legacy){
 const response=await supabase.rpc(name,args);
 if(!response.error)return response.data;
 if(missingRpc(response.error)&&legacy)return legacy();
 throw response.error;
}
export function workError(e){
 if(e?.message?.includes('notification_retry_unsafe'))return 'نتيجة الرسالة غير مؤكدة أو سبق قبولها لدى المزود وتحتاج مراجعة قبل إعادة إرسالها';
 if(e?.userFacing)return e.message;
 if(e?.message?.includes('task_rejection_locked'))return 'أعادت الإدارة المهمة إليك لاستكمالها ولا يمكن طلب تعذر التنفيذ مجددا';
 if(e?.message?.includes('task_routing_locked'))return 'أكدت الإدارة إحالة المهمة إلى قسمك ولا يمكن الإبلاغ عن خطأ الإحالة مجددا';
 if(e?.message?.includes('invalid_drive_url'))return 'أضف رابط مشاركة صالحا من Google Drive يبدأ بـ https://';
 if(e?.message?.includes('inquiry_resource_required'))return 'أضف رابط Google Drive أو ارفع المرفقات المطلوبة';
 if(e?.code==='PGRST202'||e?.code==='42703')return 'هذه الخطوة تحتاج استكمال تحديث المنصة';
 const code=e?.message||'';
 if(code.includes('planner_note_required'))return 'سجل ملاحظة نقل المهمة من ثلاثة أحرف على الأقل';
 if(code.includes('planner_action_already_applied'))return 'سبق تنفيذ الإجراء أعد فتح المهمة لمراجعة حالتها الحالية';
 if(code.includes('admin_due_locked'))return 'هذا الموعد محدد من الإدارة يمكنك طلب تأجيله أو التواصل معها لتقديمه';
 if(code.includes('due_change_pending'))return 'يوجد طلب تأجيل لهذه المهمة بانتظار قرار الإدارة';
 if(code.includes('due_conflict'))return 'تغير موعد المهمة أو الموظف المكلف أعد فتح الطلب لمراجعة البيانات الحالية';
 if(code.includes('due_change_stale'))return 'تغير موعد المهمة أو الموظف المكلف أعد فتح الطلب لمراجعة البيانات الحالية';
 if(code.includes('output_accept_required'))return 'استلم مهمة المخرجات قبل طلب بيانات أو مرفقات من العميل';
 if(code.includes('output_distribution_required'))return 'حدد الموظف المكلف بمخرجات القسم أولا ثم يستلم المهمة ويحدد موعده';
 if(code.includes('output_department_lead_unavailable'))return 'لا يوجد مسؤول قسم متاح لاستلام المخرجات المطلوبة تواصل مع الإدارة لتحديد مسؤول القسم';
 if(code.includes('output_department_unavailable')||code.includes('output_request_rejected'))return 'هذا القسم غير متاح لطلب مخرجات جديد في هذه المهمة راجع حالة طلب المخرجات';
 if(code.includes('output_due_required'))return 'حدد موعد تسليم مهمتك بعد جاهزية المخرجات المطلوبة';
 if(code.includes('output_delivery_required'))return 'استخدم تسليم المخرجات للقسم لإرسال ملفات هذه المهمة';
 if(code.includes('invalid_employee'))return 'اختر موظفا متاحا ومسجلا في القسم المطلوب';
 if(code.includes('department_lead_membership_required'))return 'الموظف مسؤول هذا القسم عين مسؤولا بديلا من إدارة الأقسام قبل إزالة ارتباطه';
 if(code.includes('service_department_setup_required'))return 'حدد أعضاء القسم ومسؤوليه من إدارة الأقسام قبل تفعيل الخدمة';
 if(code.includes('department_team_editor_required'))return 'هذا القسم له أكثر من مسؤول حدث الصفحة ثم افتح إدارة الأقسام لحفظ الفريق';
 if(code.includes('invalid_service'))return 'راجع بيانات الخدمة والوقت المستهدف ووزن الجهد ثم أعد الحفظ';
 if(code.includes('department_version_conflict'))return 'تم تعديل القسم من جلسة أخرى أعد تحميل أحدث البيانات ثم أعد التعديل';
 if(code.includes('version_conflict'))return 'تغير الطلب أثناء عملك تم تحديثه راجع البيانات وأعد المحاولة';
 if(code.includes('dependency_cycle'))return 'هذا الاعتماد ينشئ حلقة بين الأقسام اختر قسما آخر';
 if(code.includes('revision_routing_required'))return 'ينتظر التعديل إحالة المشرف المسؤول ثم استلام القسم';
 if(code.includes('dependency_pending'))return 'استكمل الاعتمادات المطلوبة بين الأقسام قبل التسليم';
 if(code.includes('invalid_due'))return 'حدد تاريخا وساعة للتسليم في المستقبل';
 if(code.includes('invalid_replacement_due'))return 'حدد موعدا بديلا في المستقبل يختلف عن الموعد المقترح';
 if(code.includes('invalid_service'))return 'اختر الخدمة المناسبة للطلب';
 if(code.includes('invalid_departments'))return 'اختر قسما واحدا أو قسمين على الأقل للطلب متعدد الأقسام';
 if(code.includes('duplicate_department'))return 'اختر كل قسم مرة واحدة في التوجيه';
 if(code.includes('invalid_dependency'))return 'اختر قسما آخر من أقسام الطلب ووضح المخرجات المطلوبة';
 if(code.includes('internal_requires_client_approval'))return 'هذا التسليم مرتبط باعتماد مطلوب من العميل أرسله للمراجعة أولا';
 if(code.includes('internal_open_escalation'))return 'يوجد قرار إداري معلق على تسليم هذا القسم';
 if(code.includes('invalid_logo'))return 'اختر شعارا صالحا بصيغة PNG أو JPEG أو WEBP وبحجم لا يتجاوز 5 MB';
 if(code.includes('invalid_profile'))return 'راجع اسم الحساب واسم الشخص المسؤول';
 if(code.includes('invalid_reason'))return 'وضح سبب القرار بثلاثة أحرف على الأقل';
 if(code.includes('invalid_input'))return 'راجع بيانات الأقسام والموظفين والمطلوب من كل قسم';
 if(code.includes('upload_session_expired'))return 'انتهت جلسة الدخول سجل الدخول ثم أكمل رفع المرفقات';
 if(code.includes('handoff_requires_client_approval'))return 'هذا التسليم مرتبط باعتماد مطلوب من العميل أرسله للمراجعة قبل متابعة الإحالة';
 if(code.includes('handoff_open_escalation'))return 'يوجد قرار إداري معلق على هذه المهمة يلزم حسمه قبل الإحالة';
 if(code.includes('client_phone_unverified'))return 'اعتمد تغيير الجوال برمز واتساب أولا';
 if(code.includes('submission_conflict'))return 'الطلب محفوظ ببيانات مختلفة افتحه من مشاريعك لإكماله';
 if(code.includes('invalid_assignment'))return 'اختر موظفا مسجلا في القسم المطلوب';
 if(code.includes('invalid_department_member'))return 'راجع أعضاء القسم وحدد مسؤولا من الفريق المختار';
 if(code.includes('invalid_department_name'))return 'اكتب اسم القسم من حرفين إلى 100 حرف';
 if(code.includes('department_in_use'))return 'لا يمكن حذف قسم مرتبط بطلبات أو مهام أو سجل عمل يمكنك تعديل مسماه';
 if(code.includes('invalid_department'))return 'راجع اسم القسم ومسؤولياته ومهامه وإعداداته';
 if(code.includes('department_has_open_work'))return 'لا يمكن تعطيل قسم لديه مهام مفتوحة';
 if(code.includes('department_conflict'))return 'يوجد قسم أو بند آخر بالقيمة نفسها راجع البيانات';
 if(code.includes('upload_limit'))return 'حجم الملف أكبر من الحد المفعل حاليا في التخزين';
 if(code.includes('work_rate_limit'))return 'طلبات كثيرة خلال وقت قصير انتظر دقيقة ثم أعد المحاولة';
 if(code.includes('forbidden'))return 'لا تملك صلاحية هذا الإجراء';
 if(code.includes('invalid_state'))return 'الإجراء غير متاح في الحالة الحالية للمهمة';
 return 'تعذر إكمال العملية تحقق من الاتصال وأعد المحاولة';
}
export async function uploadFile(request,part,file,{onProgress=()=>{},signal,bucket='work-files'}={}){
 if(!file)throw new Error('invalid_file');
 if(signal?.aborted)throw new Error('upload_paused');
 // Storage owns the configured limits Upload originals without a second UI cap
 const ext=file.name.split('.').pop()?.toLowerCase();
 const path=`${request}/${part}/${crypto.randomUUID()}.${/^[a-z0-9]{1,8}$/.test(ext)?ext:'bin'}`;
 const {data:{session},error:sessionError}=await supabase.auth.getSession();
 if(sessionError)throw sessionError;
 if(!session)throw new Error('forbidden');
 const acting=getImpersonation();
 if(hasImpersonation()&&!acting)throw new Error('upload_session_expired');
 // Upload original bytes directly to private Storage in bounded chunks
 // A stable fingerprint resumes interrupted files without reading them into memory
 const fingerprint=`${bucket==='work-files'?'work-v1':`media-v1:${bucket}`}:${acting?`${acting.user.id}:${acting.id}`:session.user.id}:${request}:${part}:${file.name}:${file.size}:${file.lastModified}`;
 const completedKey=`seet-upload-complete:${fingerprint}`;
 try{
  const existing=JSON.parse(localStorage.getItem(completedKey)||'null');
  if(existing?.filename===file.name&&existing.object_path?.startsWith(`${request}/${part}/`)){
   const check=await supabase.storage.from(bucket).createSignedUrl(existing.object_path,30);
   if(!check.error&&!signal?.aborted){onProgress(100);return {...existing,cache_key:completedKey};}
  }
 }catch{/* Optional local resume metadata must not prevent upload */}
 let actualPath=path;
 await new Promise((resolve,reject)=>{
  const endpoint=new URL(`/storage/v1/upload/resumable${acting?'/sign':''}`,import.meta.env.VITE_SUPABASE_URL.replace('.supabase.co','.storage.supabase.co')).href;
  let settled=false;
  let uploadSignature=null,lastVerified=0;
  const trustedUrl=value=>{try{const parsed=new URL(value);return !parsed.username&&!parsed.password&&(parsed.href===endpoint||parsed.href.startsWith(`${endpoint}/`));}catch{return false;}};
  const settle=(error)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);if(error)reject(error);else resolve();};
  const upload=new tus.Upload(file,{endpoint,chunkSize:6*1024*1024,retryDelays:[0,3000,5000,10000,20000],uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,
   headers:{apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY},
   metadata:{bucketName:bucket,objectName:path,contentType:file.type||'application/octet-stream',cacheControl:'3600'},
   fingerprint:async()=>fingerprint,
   // XHR appends repeated headers Set Authorization once with the current token
   onBeforeRequest:async req=>{
    if(settled||signal?.aborted)throw new Error('upload_paused');
    if(!trustedUrl(req.getURL()))throw new Error('invalid_upload_url');
    if(acting){
     if(getImpersonation()?.id!==acting.id||Date.parse(acting.expires_at)<=Date.now())throw new Error('upload_session_expired');
     if(Date.now()-lastVerified>30000){await refreshImpersonation();lastVerified=Date.now();}
     if(getImpersonation()?.id!==acting.id||!uploadSignature)throw new Error('upload_session_expired');
     req.setHeader('x-signature',uploadSignature);
    }else{
     const {data,error}=await supabase.auth.getSession();if(error)throw error;
     if(settled||signal?.aborted)throw new Error('upload_paused');
     if(hasImpersonation()||!data.session||data.session.user.id!==session.user.id)throw new Error('upload_session_expired');
     req.setHeader('authorization',`Bearer ${data.session.access_token}`);
    }
   },
   onProgress:(bytes,total)=>{if(!settled)onProgress(total?Math.min(100,Math.round(bytes/total*100)):0);},
   onError:settle,
   onSuccess:()=>settle()
  });
  const cancel=()=>{if(settled)return;settle(new Error('upload_paused'));upload.abort(false).catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted){cancel();return;}
  upload.findPreviousUploads().catch(()=>[]).then(async previous=>{
   if(settled)return;
   if(signal?.aborted)return cancel();
   const match=previous.find(u=>u.metadata?.bucketName===bucket&&u.metadata.objectName?.startsWith(`${request}/${part}/`)&&trustedUrl(u.uploadUrl)&&!u.parallelUploadUrls);
   if(match){
    actualPath=match.metadata.objectName;
    // TUS can create a fresh session after expiry Keep its object path aligned
    // with the resumed path returned for transactional attachment registration
    upload.options.metadata.objectName=actualPath;
   upload.resumeFromPreviousUpload(match);
   }
   if(acting){
    const signed=await result(supabase.storage.from(bucket).createSignedUploadUrl(actualPath,{upsert:false}));
    if(getImpersonation()?.id!==acting.id||settled)throw new Error('upload_session_expired');
    uploadSignature=signed.token;lastVerified=Date.now();
   }
   upload.start();
  }).catch(settle);
 });
 const uploaded={object_path:actualPath,filename:file.name};
 try{localStorage.setItem(completedKey,JSON.stringify(uploaded));}catch{/* Upload remains usable without device persistence */}
 return {...uploaded,cache_key:completedKey};
}

// Read the existing schema while the client release migration is deferred
// RLS still applies and every query is explicitly scoped to the signed-in client
let clientBoardRetryAt=0;
async function currentClientBoard(filter,search,page){
 const {user}=await result(getEffectiveUser());
 if(user?.app_metadata?.role!=='client')throw new Error('forbidden');
 const select='id,number,title,status,created_at,version,work_parts(id,status),work_deliveries(part_id,status)';
 const scope=(query,kind)=>{
  query=query.eq('client_id',user.id);
  if(kind==='intake')query=query.eq('status','new');
  if(kind==='working')query=query.in('status',['active','needs_info']);
  if(kind==='completed')query=query.eq('status','completed');
  if(kind==='ready')query=query.eq('work_parts.status','review');
  return query;
 };
 const count=async kind=>{
  const response=await scope(supabase.from('work_requests').select(kind==='ready'?'id,work_parts!inner(id)':'id',{count:'exact',head:true}),kind);
  if(response.error)throw response.error;
  return response.count||0;
 };
 const list=async()=>{
  // Existing requests have no urgency field until the release migration
  if(filter==='urgent')return [];
  let query=scope(supabase.from('work_requests').select(filter==='ready'?select.replace('work_parts(','work_parts!inner('):select),filter);
  const term=String(search||'').trim().slice(0,100);
  if(/^\d+$/.test(term))query=query.eq('number',term);
  else if(term)query=query.ilike('title',`%${term}%`);
  const start=Math.max(0,Math.min(Number(page)||0,100000))*20;
  const rows=await result(query.order('created_at',{ascending:false}).range(start,start+19));
  return rows.map(({work_parts,work_deliveries,...r})=>({...r,ready:(work_deliveries||[]).some(d=>d.status==='pending'&&(work_parts||[]).some(p=>p.id===d.part_id&&p.status==='review'))}));
 };
 const [items,all,intake,working,completed,ready]=await Promise.all([list(),count('all'),count('intake'),count('working'),count('completed'),count('ready')]);
 return {items,counts:{all,intake,working,completed,ready}};
}

const CLIENT_LOGO_BUCKET='client-logos';
const CLIENT_LOGO_TTL_SECONDS=3600;
const CLIENT_LOGO_CACHE_MS=50*60*1000;
const clientLogoCache=new Map();
subscribeImpersonation(()=>{clientLogoCache.clear();clientBoardRetryAt=0;});
const validClientLogoPath=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/logo$/i.test(value);

async function signClientRecords(records){
 const now=Date.now(),paths=[...new Set(records.map(record=>record?.logo_path).filter(validClientLogoPath))],urls=new Map(),pending=[];
 for(const path of paths){
  const cached=clientLogoCache.get(path);
  if(cached&&cached.expiresAt>now)urls.set(path,cached.url);
  else{clientLogoCache.delete(path);pending.push(path);}
 }
 if(pending.length){
  try{
   const {data,error}=await supabase.storage.from(CLIENT_LOGO_BUCKET).createSignedUrls(pending,CLIENT_LOGO_TTL_SECONDS);
   if(!error)(data||[]).forEach((entry,index)=>{
    const path=entry.path||pending[index];
    if(validClientLogoPath(path)&&entry.signedUrl){
     urls.set(path,entry.signedUrl);
     clientLogoCache.set(path,{url:entry.signedUrl,expiresAt:now+CLIENT_LOGO_CACHE_MS});
    }
   });
  }catch{/* A missing logo must not block the request workspace */}
 }
 return records.map(record=>record&&typeof record==='object'?{...record,logo_url:urls.get(record.logo_path)||''}:record);
}

async function requestClientDirectory(requests,supplied={}){
 const directory=supplied&&typeof supplied==='object'&&!Array.isArray(supplied)?{...supplied}:{};
 const missing=requests.filter(request=>request?.id&&!request.client&&!directory[request.id]).map(request=>request.id);
 if(missing.length){
  const response=await supabase.rpc('work_request_clients',{p_requests:missing});
  if(response.error&&!missingRpc(response.error))throw response.error;
  if(!response.error&&response.data&&typeof response.data==='object')Object.assign(directory,response.data);
 }
 return directory;
}

async function hydrateRequests(requests,supplied={}){
 const safeRequests=Array.isArray(requests)?requests:[],directory=await requestClientDirectory(safeRequests,supplied);
 const identities=await signClientRecords(safeRequests.map(request=>request?.client||directory[request?.id]||null));
 return {
  requests:safeRequests.map((request,index)=>identities[index]?{...request,client:identities[index]}:request),
  clients:directory
 };
}

async function hydrateWorkspace(workspace){
 if(!workspace||!Array.isArray(workspace.requests))return workspace;
 const hydrated=await hydrateRequests(workspace.requests,workspace.clients);
 return {...workspace,requests:hydrated.requests,clients:hydrated.clients};
}

async function hydrateRequest(request){
 if(!request)return request;
 const hydrated=await hydrateRequests([request]);
 return hydrated.requests[0]||request;
}

async function hydrateDetail(detail){
 if(!detail?.request)return detail;
 return {...detail,request:await hydrateRequest(detail.request)};
}

async function requestEscalations(request,management){
 if(!management||!request?.id||request.number===null||request.number===undefined)return [];
 const board=await result(supabase.rpc('work_board',{p_view:'alerts',p_search:String(request.number),p_page:0}));
 return (Array.isArray(board?.escalations)?board.escalations:[]).filter(escalation=>escalation.request_id===request.id);
}

// All workflow database and Storage access is owned by this repository
export const repository={
 employeeAccess:id=>result(supabase.from('work_staff').select('coordinator,operations_manager').eq('user_id',id).maybeSingle()),
 async requestAttachmentCounts(ids){
  const unique=[...new Set(ids)],counts={};
  // Direct table reads are intentionally revoked for authenticated accounts
  // Reuse the authorized detail RPC without signing or downloading any files
  for(let index=0;index<unique.length;index+=4){
   const batch=await Promise.all(unique.slice(index,index+4).map(async id=>{
    const detail=await result(supabase.rpc('work_request_detail',{p_request:id,p_management:false}));
    if(!Array.isArray(detail?.files))throw new Error('تعذر قراءة عدد المرفقات');
    return [id,detail.files.length];
   }));
   Object.assign(counts,Object.fromEntries(batch));
  }
  return counts;
 },
 async clientBoard(filter,search,page){
  if(Date.now()>=clientBoardRetryAt){
   const response=await supabase.rpc('client_board',{p_filter:filter,p_search:search,p_page:page});
   if(!response.error){clientBoardRetryAt=0;return response.data;}
   if(response.error.code!=='PGRST202')throw response.error;
   clientBoardRetryAt=Date.now()+15000;
  }
  return currentClientBoard(filter,search,page);
 },
 async clientSchedule(id){
  // Fetch only through the existing authorized client view without signing attachments
  const detail=await result(supabase.rpc('work_request_detail',{p_request:id,p_management:false}));
  return clientSchedule(detail);
 },
 async clientProfile(){
  const [profile,auth]=await Promise.all([result(supabase.rpc('platform_profile')),result(getEffectiveUser())]);
  const [signed]=await signClientRecords([profile||{}]);
  return {...signed,email:auth.user?.email||signed.email||'',phone:auth.user?.phone?`+${auth.user.phone.replace(/^\+/,'')}`:signed.phone||''};
 },
 saveClientProfile:profile=>result(supabase.rpc('client_profile_update',{p_display_name:profile.display_name,p_contact_name:profile.contact_name||''})),
 saveClientName:(name,phone)=>result(supabase.rpc('platform_update_profile',{p_name:name,p_phone:phone})),
 async uploadClientLogo(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<1||file.size>5*1024*1024)throw new Error('invalid_logo');
  const {user}=await result(getEffectiveUser());
  if(!user||user.app_metadata?.role!=='client')throw new Error('forbidden');
  const path=`${user.id}/logo`;
  await result(uploadWithEffectiveAccess(CLIENT_LOGO_BUCKET,path,file,{cacheControl:'60',contentType:file.type,upsert:true}));
  await result(supabase.rpc('client_logo_commit',{p_path:path}));
  clientLogoCache.delete(path);
  return path;
 },
 async clientDetail(id){const detail=await rpcWithLegacy('work_request_detail',{p_request:id,p_management:false},async()=>{const [request,files,deliveries,events,parts,routes]=await Promise.all([
   this.request(id),result(supabase.from('work_attachments').select('id,object_path,filename').eq('request_id',id)),
   result(supabase.from('work_deliveries').select('*').eq('request_id',id).order('created_at',{ascending:false})),
   result(supabase.from('work_events').select('id,part_id,kind,note,created_at').eq('request_id',id).eq('client_visible',true).order('id',{ascending:false}).limit(150)),
   result(supabase.from('work_parts').select('id,service_id,status,due_at,accepted_at,created_at,forwarded_to,forwarded_at,route_position').eq('request_id',id)),
   result(supabase.rpc('work_routes',{p_request:id}))
  ]);return {request,files,deliveries,events,parts,routes};});return hydrateDetail(detail);},
 forgetUpload:key=>{if(key)try{localStorage.removeItem(key);}catch{}},
 receipt:(action,path)=>rpcWithLegacy('work_file_receipt',{p_action:action,p_path:path},()=>result(supabase.from(action==='deliver'?'work_deliveries':'work_attachments').select('id').eq('object_path',path).maybeSingle())),
 uploadLimit:()=>result(supabase.rpc('work_upload_limit')),
 setup:(action,p)=>result(supabase.rpc('work_setup',{action,p})),
 saveStaffSettings:p=>result(supabase.rpc('work_staff_settings_save',{p})),
 settingsStaff:()=>result(supabase.rpc('work_settings_staff')),
 clients:search=>result(supabase.rpc('work_clients',{p_search:search})),
 notificationMonitor:()=>result(supabase.rpc('work_notification_monitor')),
 deliveryHealth:()=>result(supabase.rpc('work_delivery_health')),
 retryNotification:id=>result(supabase.rpc('work_retry_notification',{p_id:id})),
 async request(id){const request=await rpcWithLegacy('work_request_snapshot',{p_request:id},()=>result(supabase.from('work_requests').select('*').eq('id',id).single()));return hydrateRequest(request);},
 removeDraft:path=>result(supabase.storage.from('work-files').remove([path])),
 // Preview is inline and long enough for streamed media downloads remain explicit
 preview:async file=>(await result(supabase.storage.from('work-files').createSignedUrl(file.object_path,3600))).signedUrl,
 async download(file){
  const {signedUrl}=await result(supabase.storage.from('work-files').createSignedUrl(file.object_path,3600));
  const url=new URL(signedUrl);
  // Encode the original filename once including Arabic names and spaces
  url.searchParams.set('download',file.filename);
  return url.href;
 },
 async notifications(id){return this.notificationPage(0,id);},
 async notificationPage(page=0,id){
  const payload=await rpcWithLegacy('work_notifications_page',{p_page:page},async()=>{
  let recipient=id;
  if(!recipient){const {user}=await result(getEffectiveUser());recipient=user?.id;}
  if(!recipient)throw new Error('forbidden');
  const items=await result(supabase.from('work_notifications').select('id,request_id,message,created_at,read_at,whatsapp').eq('recipient',recipient).order('created_at',{ascending:false}).range(page*40,page*40+39));
  return {items,unread_count:items.filter(item=>!item.read_at).length};
  });
  const items=Array.isArray(payload)?payload:payload?.items||[];
  if(items.every(item=>Object.hasOwn(item,'request_title')&&Object.hasOwn(item,'client_name')))return payload;
  const ids=[...new Set(items.map(item=>item.request_id).filter(Boolean))];
  if(!ids.length)return payload;
  // One bounded read through the current session and existing request RLS
  // Missing or inaccessible requests keep the concise notification fallback
  let requests=[];
  try{requests=await result(supabase.from('work_requests').select('id,title,number,client_id').in('id',ids))||[];}catch{return payload;}
  const clients=[...new Set(requests.map(request=>request.client_id).filter(Boolean))];
  let profiles=[];
  if(clients.length){try{profiles=await result(supabase.from('account_profiles').select('user_id,display_name').in('user_id',clients))||[];}catch{/* Existing envelopes remain the fallback under profile RLS */}}
  const names=new Map(profiles.map(profile=>[profile.user_id,profile.display_name]));
  const byId=new Map(requests.map(request=>[request.id,request]));
  const enriched=items.map(item=>({...item,request_title:item.request_title||byId.get(item.request_id)?.title,request_number:item.request_number||byId.get(item.request_id)?.number,client_name:item.client_name||names.get(byId.get(item.request_id)?.client_id)}));
  return Array.isArray(payload)?enriched:{...payload,items:enriched};
 },
 notificationSettings:()=>result(supabase.rpc('work_notification_settings')),
 saveNotificationSettings:whatsapp=>result(supabase.rpc('work_notification_settings',{p_whatsapp_enabled:whatsapp})),
 markAllNotifications:()=>result(supabase.rpc('work_mark_notifications_read')),
 performance:(days=30)=>result(supabase.rpc('work_employee_performance',{p_days:days})),
 departmentPerformance:({start,end})=>result(supabase.rpc('work_department_performance',{p_start:start,p_end:end})),
 employeeOfMonth:(month=null)=>result(supabase.rpc('work_employee_of_month',{p_month:month})),
 departmentDirectory:()=>result(supabase.rpc('work_department_directory')),
 saveDepartment:department=>result(supabase.rpc('work_department_save',{p:department})),
 saveDepartmentTeam:department=>result(supabase.rpc('work_department_team_save',{p:department})),
 departmentIdentity:(action,department,name)=>result(supabase.rpc('work_department_identity',{p_action:action,p_id:department.id,p_version:department.version,p_name:name??null})),
 serviceCatalog:(includeInactive=false)=>rpcWithLegacy('work_service_catalog',{p_include_inactive:includeInactive},async()=>{
  let response=await supabase.from('work_services').select('id,name,slug,category,description,icon,active,default_target_minutes,default_effort_points,sort_order').order('sort_order').order('name');
  if(response.error?.code==='42703')response=await supabase.from('work_services').select('id,name,active').order('name');
  if(response.error)throw response.error;
  return (response.data||[]).filter(service=>includeInactive||service.active).map((service,index)=>({category:'خدمات صيت',description:'خدمة متخصصة مرتبطة مباشرة بمسار الطلب والتنفيذ',icon:'sparkles',default_target_minutes:4320,default_effort_points:5,sort_order:(index+1)*10,...service}));
 }),
 saveService:service=>result(supabase.rpc('work_catalog_service_save',{p:service})),
 subscribe:(id,refresh)=>{
  if(hasImpersonation()){
   const timer=setInterval(()=>{if(!document.hidden)refresh();},5000);
   const focus=()=>refresh();window.addEventListener('focus',focus);
   return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};
  }
  // The header bell and notification center can be mounted together. Realtime
  // reuses equal topics and rejects adding handlers to an already joined channel.
  const channel=supabase.channel(`work-notifications-${id}-${crypto.randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table:'work_notification_signals',filter:`recipient=eq.${id}`},refresh).subscribe();return()=>supabase.removeChannel(channel);
 },
 async completedBoard(user,view,search){
  const first=await this.board(user,0,view,search);
  const combined=await collectTaskPages(first,page=>result(supabase.rpc('work_board',{p_page:page,p_view:view,p_search:search})));
  return {...await hydrateWorkspace(combined),completed_scope_key:JSON.stringify([user.id,view,search])};
 },
 taskDashboard:({bucket='all',search='',page=0,priority='all',sort='latest'}={})=>result(supabase.rpc('work_task_dashboard',{p_bucket:bucket,p_search:search,p_page:page,p_priority:priority,p_sort:sort})),
 personalPlanner:({bucket='all',search='',page=0,priority='all',sort='due'}={})=>result(supabase.rpc('work_personal_planner',{p_bucket:bucket,p_search:search,p_page:page,p_priority:priority,p_sort:sort})),
 dueChanges:({requestId=null,page=0}={})=>result(supabase.rpc('work_task_due_changes',{p_request:requestId,p_page:page})),
 plannerMoves:requestId=>result(supabase.rpc('work_planner_moves',{p_request:requestId})),
 async teamFollowupBoard(user,search){
  const first=await this.board(user,0,'all',search);
  // Only the actual server coordinator flag enables cross-team follow-up
  if(!first.coordinator)return first;
  const combined=await collectTaskPages(first,page=>result(supabase.rpc('work_board',{p_page:page,p_view:'all',p_search:search})));
  return {...await hydrateWorkspace(combined),team_followup_key:JSON.stringify([user.id,search])};
 },
 async board(user,page,view,search){
  const [workspace,control]=await Promise.all([
   rpcWithLegacy('work_workspace',{p_page:page,p_view:view,p_search:search},()=>null),
   rpcWithLegacy('work_control_center',{},()=>({due_reviews:[],intake_controls:[]}))
  ]);
  const controls={due_reviews:Array.isArray(control?.due_reviews)?control.due_reviews:[],intake_controls:Array.isArray(control?.intake_controls)?control.intake_controls:[]};
  if(workspace)return hydrateWorkspace({...workspace,...controls});
  const [board,services,self,grants]=await Promise.all([
   result(supabase.rpc('work_board',{p_view:view,p_search:search,p_page:page})),
   result(supabase.from('work_services').select('id,name,active').order('name')),
   result(supabase.from('work_staff').select('capacity,coordinator').eq('user_id',user.id).maybeSingle()),
   result(supabase.from('work_grants').select('user_id,service_id,can_manage'))
  ]);
  const coordinator=!!self?.coordinator;
  const manager=['admin','super_admin'].includes(user.app_metadata?.role);
  const staff=manager||coordinator?await result(supabase.rpc('work_directory')):[];
  return hydrateWorkspace({...board,services,staff,grants,coordinator,...controls});
 },
 async detail(id,management=false){const detail=await rpcWithLegacy('work_request_detail',{p_request:id,p_management:management},async()=>{const [request,events,files,deliveries,dependencies,routes,parts,audit]=await Promise.all([
   this.request(id),result(supabase.from('work_events').select('id,kind,note,created_at').eq('request_id',id).order('id',{ascending:false}).limit(150)),
   result(supabase.from('work_attachments').select('id,object_path,filename').eq('request_id',id)),
   result(supabase.from('work_deliveries').select('*').eq('request_id',id).order('created_at',{ascending:false})),
   result(supabase.from('work_dependencies').select('id,part_id,upstream_id,reason,status,gate').eq('request_id',id)),
   result(supabase.rpc('work_routes',{p_request:id})),
   result(supabase.from('work_parts').select('*').eq('request_id',id)),
   management?result(supabase.rpc('work_audit',{p_request:id})):[]
  ]);return {request,events,files,deliveries,dependencies,routes,parts,audit};});
  const escalations=Array.isArray(detail?.escalations)?detail.escalations:await requestEscalations(detail?.request,management);
  return hydrateDetail({...detail,escalations});
 }
};
