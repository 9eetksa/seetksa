import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {clientAccountService} from './client-account-service.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY=2*1024*1024;
const fail=(status,message)=>Object.assign(new Error(message),{status});
const denied=()=>fail(403,'هذه العملية غير متاحة أثناء الدخول بالنيابة');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{transport:WebSocket}};
const TABLES=new Set(['work_requests','work_parts','work_events','work_attachments','work_deliveries','work_dependencies','work_services','work_staff','work_memberships','work_grants','work_escalations','work_notifications','work_notification_signals','work_notification_preferences','portfolio_works','portfolio_media','platform_settings','account_profiles']);
const RPCS=new Set(['work_action','work_control_action','client_board','client_logo_commit','client_profile_update','platform_profile','platform_update_profile','work_audit','work_board','work_clients','work_delivery_health','work_department_directory','work_department_save','work_directory','work_employee_performance','work_mark_notifications_read','work_notification_settings','work_request_clients','work_retry_notification','work_routes','work_service_save','work_catalog_service_save','work_setup','work_upload_limit','work_request_detail','work_file_receipt','work_request_snapshot','work_notifications_page','work_service_catalog','work_workspace','work_control_center','platform_save','platform_users','platform_account_directory','platform_audit','portfolio_save']);
const BUCKETS=new Set(['work-files','client-logos','portfolio-assets','platform-designs']);
const WRITE_RPCS=new Set(['work_action','work_control_action','client_logo_commit','client_profile_update','platform_update_profile','work_department_save','work_mark_notifications_read','work_notification_settings','work_retry_notification','work_service_save','work_catalog_service_save','work_setup','platform_save','portfolio_save']);
const CLIENT_ACTIONS=new Set(['client-phone-start','client-phone-verify']);
// Operational reads keep target account authorization inside each RPC
for(const name of ['work_task_dashboard','work_team_overview','work_department_performance','work_employee_of_month'])RPCS.add(name);
// All delegated workflow mutations require durable auditing before target-authorized dispatch
for(const name of ['work_department_inquiry_action','work_client_resource_action','work_output_action','work_override_task_due','work_department_team_save']){
 RPCS.add(name);WRITE_RPCS.add(name);
}
for(const name of ['work_personal_planner','work_task_due_changes','work_reschedule_task_due','work_review_task_due_change','work_planner_action','work_planner_moves'])RPCS.add(name);
for(const name of ['work_reschedule_task_due','work_review_task_due_change','work_planner_action'])WRITE_RPCS.add(name);

function claims(token){
 try{
  if(typeof token!=='string'||token.length>16000)throw new Error();
  const parts=token.split('.');if(parts.length!==3)throw new Error();
  const value=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  if(!UUID.test(value.sub||'')||!UUID.test(value.session_id||'')||!Number.isFinite(value.exp)||value.role!=='authenticated')throw new Error();
  return value;
 }catch{throw fail(401,'انتهت الجلسة سجل الدخول مجددا');}
}

function safeUser(user){
 if(!user||!UUID.test(user.id||''))throw denied();
 const metadata=user.app_metadata||{};
 return {id:user.id,email:metadata.phone_only?'':user.email||'',phone:user.phone||'',app_metadata:{role:metadata.role,phone_only:metadata.phone_only===true,account_type:metadata.account_type,permissions:Array.isArray(metadata.permissions)?metadata.permissions:[],job_title:metadata.job_title||'',must_change_password:metadata.must_change_password===true||metadata.must_change_password==='true'},user_metadata:{display_name:user.user_metadata?.display_name||''}};
}

function objectBody(value){
 if(value===null||value===undefined||value==='')return {};
 if(typeof value!=='string'||Buffer.byteLength(value)>MAX_BODY)throw fail(400,'بيانات الطلب غير صالحة');
 try{const body=JSON.parse(value);if(!body||Array.isArray(body)||typeof body!=='object')throw new Error();return body;}
 catch{throw fail(400,'بيانات الطلب غير صالحة');}
}

function segments(path){
 if(typeof path!=='string'||path.length>16000||!path.startsWith('/')||path.startsWith('//')||/[\\#\u0000-\u001f]/.test(path))throw denied();
 const pathname=path.split('?')[0];
 let decoded;
 try{decoded=decodeURIComponent(pathname);}catch{throw denied();}
 if(/[\\%\u0000-\u001f]/.test(decoded)||/%(?:2f|5c)/i.test(pathname))throw denied();
 const parts=decoded.split('/').slice(1);
 if(parts.some(part=>!part||part==='.'||part==='..'))throw denied();
 return parts;
}

function safeObjectPath(path){
 if(typeof path!=='string'||!path||path.length>2048||/[\\%\u0000-\u001f]/.test(path))throw denied();
 if(path.split('/').some(part=>!part||part==='.'||part==='..'))throw denied();
 return path;
}

function requestHeaders(input={}){
 if(!input||Array.isArray(input)||typeof input!=='object')throw denied();
 const result={};
 for(const [original,value] of Object.entries(input)){
  const name=original.toLowerCase();
  if(typeof value!=='string'||value.length>1000||/[\r\n]/.test(value))throw denied();
  if(name==='content-type'){if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(value))throw denied();result['Content-Type']='application/json';}
  else if(name==='accept'){if(!/^(application\/(json|vnd\.pgrst\.(object|array)\+json)|\*\/\*)$/i.test(value))throw denied();result.Accept=value;}
  else if(name==='prefer'){if(!/^[a-z0-9=, ._-]+$/i.test(value))throw denied();result.Prefer=value;}
  else if(name==='range'){if(!/^\d+-\d*$/.test(value))throw denied();result.Range=value;}
  else if(name==='range-unit'){if(value!=='items')throw denied();result['Range-Unit']=value;}
  else if(name==='x-client-info'){/* SDK version metadata is not forwarded */}
  else if(name==='x-upsert'){if(!['true','false'].includes(value))throw denied();result['x-upsert']=value;}
  else throw denied();
 }
 return result;
}

function proxyRequest(input,remaining,user){
 const parts=segments(input.path),method=String(input.method||'GET').toUpperCase(),headers=requestHeaders(input.headers);
 if(!['GET','HEAD','POST','DELETE'].includes(method))throw denied();
 if((method==='GET'||method==='HEAD')&&input.body!==undefined&&input.body!==null&&input.body!=='')throw denied();
 let body=null,mutation=false;
 if(parts[0]==='rest'&&parts[1]==='v1'){
  if(headers['x-upsert'])throw denied();
  if(parts.length===3&&TABLES.has(parts[2])&&['GET','HEAD'].includes(method))return {method,headers,body,mutation,resource:parts.join('/')};
  if(parts.length!==4||parts[2]!=='rpc'||!RPCS.has(parts[3])||!['GET','HEAD','POST'].includes(method))throw denied();
  const rpc=parts[3];
  if(WRITE_RPCS.has(rpc)&&method!=='POST')throw denied();
  if(method==='POST'){
   const payload=objectBody(input.body);
   // Legacy explicit delegation IDs must never activate a second delegation layer
   if(payload.p_session!==undefined&&payload.p_session!==null)throw denied();
   body=JSON.stringify(payload);headers['Content-Type']='application/json';
  }
  mutation=WRITE_RPCS.has(rpc);
  return {method,headers,body,mutation,resource:parts.join('/')};
 }
 if(parts[0]!=='storage'||parts[1]!=='v1'||parts[2]!=='object'||input.path.includes('?'))throw denied();
 const payload=objectBody(input.body);
 let bucket,object;
 if(parts[3]==='sign'&&method==='POST'){
  bucket=parts[4];object=parts.slice(5).join('/');
  if(!BUCKETS.has(bucket))throw denied();
  if(object)safeObjectPath(object);
  else if(!Array.isArray(payload.paths)||!payload.paths.length||payload.paths.length>100)throw denied();
  else payload.paths.forEach(safeObjectPath);
  const requested=Number(payload.expiresIn);
  if(!Number.isFinite(requested)||requested<=0)throw denied();
  payload.expiresIn=Math.min(Math.floor(requested),remaining);
  if(payload.expiresIn<1)throw fail(403,'انتهت جلسة الدخول بالنيابة');
 }else if(parts[3]==='upload'&&parts[4]==='sign'&&method==='POST'){
  bucket=parts[5];object=parts.slice(6).join('/');
  if(!BUCKETS.has(bucket)||!object)throw denied();safeObjectPath(object);
  if(bucket==='work-files'&&(headers['x-upsert']==='true'||payload.upsert===true))throw denied();
  if(bucket==='client-logos'&&object!==`${user.id}/logo`)throw denied();
  mutation=true;
 }else if(parts[3]==='list'&&parts.length===5&&method==='POST'){
  bucket=parts[4];if(!BUCKETS.has(bucket))throw denied();
  if(payload.prefix)safeObjectPath(payload.prefix.replace(/\/$/,''));
  payload.limit=Math.max(1,Math.min(Number(payload.limit)||100,100));
 }else if(parts.length===4&&BUCKETS.has(parts[3])&&method==='DELETE'){
  bucket=parts[3];if(!Array.isArray(payload.prefixes)||!payload.prefixes.length||payload.prefixes.length>100)throw denied();
  payload.prefixes.forEach(safeObjectPath);mutation=true;
 }else throw denied();
 if(headers['x-upsert']&&!(parts[3]==='upload'&&parts[4]==='sign'))throw denied();
 headers['Content-Type']='application/json';body=JSON.stringify(payload);
 return {method,headers,body,mutation,resource:`storage/${parts[3]}/${bucket}`};
}

export function createImpersonationService(env,{createClient:clientFactory=createClient,transport=fetch,now=Date.now}={}){
 let admin,clientAccount;
 const base=new URL(env.VITE_SUPABASE_URL);
 if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||!env.VITE_SUPABASE_PUBLISHABLE_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)throw fail(503,'الدخول بالنيابة غير متاح حاليا');
 const encryption=env.ONBOARDING_ENCRYPTION_KEY;
 if(!/^[a-f0-9]{64}$/i.test(encryption||''))throw fail(503,'الدخول بالنيابة غير متاح حاليا');
 const key=Buffer.from(encryption,'hex');
 const getAdmin=()=>admin||=(clientFactory(base.origin,env.SUPABASE_SERVICE_ROLE_KEY,options));
 async function rpc(name,args){
  const {data,error}=await getAdmin().rpc(name,args);
  if(error){
   const code=String(error.message||'');
   if(error.code==='42501'||/forbidden|session_expired|invalid_target|unauthorized/.test(code))throw fail(403,'انتهت جلسة الدخول بالنيابة أو لم تعد متاحة');
   if(/rate_limit/.test(code))throw fail(429,'انتظر قليلا قبل بدء جلسة جديدة');
   throw fail(409,'تعذر إكمال الدخول بالنيابة أعد المحاولة');
  }
  return data;
 }
 const binding=(actor,session,id)=>({p_id:id,p_actor:actor,p_actor_session:session});
 const aad=(actor,session,id)=>Buffer.from(`provision-impersonation-v1|${id}|${actor}|${session}`);
 function encrypt(token,actor,session,id){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(actor,session,id));
  const body=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
 }
 function decrypt(ciphertext,actor,session,id){
  try{
   if(typeof ciphertext!=='string'||ciphertext.length>24000)throw new Error();
   const bytes=Buffer.from(ciphertext,'base64');if(bytes.length<29)throw new Error();
   const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAAD(aad(actor,session,id));decipher.setAuthTag(bytes.subarray(12,28));
   return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
  }catch{throw denied();}
 }
 async function identity(token){
  if(!token)throw fail(401,'سجل الدخول للمتابعة');
  const {data,error}=await getAdmin().auth.getUser(token);
  if(error||!data?.user)throw fail(401,'انتهت الجلسة سجل الدخول مجددا');
  const jwt=claims(token),user=data.user;
  if(jwt.sub!==user.id||jwt.exp*1000<=now())throw fail(401,'انتهت الجلسة سجل الدخول مجددا');
  const meta=user.app_metadata||{};
  if(meta.role!=='super_admin'||user.is_anonymous||meta.must_change_password===true||meta.must_change_password==='true'||Date.parse(user.banned_until||'')>now())throw denied();
  return {actor:user.id,session:jwt.session_id};
 }
 async function access(actor,session,id){
  const row=await rpc('platform_impersonation_access',binding(actor,session,id));
  if(!row||row.id!==id||!UUID.test(row.target||'')||!row.user||row.user.id!==row.target)throw denied();
  const remaining=Math.floor((Date.parse(row.expires_at)-now())/1000);
  if(!Number.isFinite(remaining)||remaining<1||!['admin','employee'].includes(row.user.app_metadata?.role)||row.user.is_anonymous||row.user.app_metadata?.must_change_password===true||row.user.app_metadata?.must_change_password==='true'||Date.parse(row.user.banned_until||'')>now())throw denied();
  const token=decrypt(row.token_cipher,actor,session,id),jwt=claims(token);
  if(jwt.sub!==row.target||jwt.exp*1000<=now()||row.target_session&&jwt.session_id!==row.target_session)throw denied();
  return {...row,token,remaining:Math.min(remaining,jwt.exp-Math.floor(now()/1000))};
 }
 async function revoke(token){if(token)await getAdmin().auth.admin.signOut(token,'local').catch(()=>{});}
 return async(input,actorToken)=>{
  if(!input||Array.isArray(input)||typeof input!=='object')throw fail(400,'بيانات الطلب غير صالحة');
  const {actor,session}=await identity(actorToken);
  if(input.action==='start'){
   if(!UUID.test(input.userId||'')||input.userId===actor)throw denied();
   const opened=await rpc('platform_impersonation_open',{p_actor:actor,p_actor_session:session,p_target:input.userId});
   if(!opened||!UUID.test(opened.id||'')||opened.target!==input.userId||typeof opened.email!=='string')throw denied();
   let token;
   try{
    const link=await getAdmin().auth.admin.generateLink({type:'magiclink',email:opened.email});
    if(link.error||link.data?.user?.id!==opened.target||!link.data?.properties?.hashed_token)throw denied();
    // A fresh short-lived SDK object keeps OTP sign-in away from the service-role client
    const auth=clientFactory(base.origin,env.VITE_SUPABASE_PUBLISHABLE_KEY,options);
    const verified=await auth.auth.verifyOtp({type:'magiclink',token_hash:link.data.properties.hashed_token});
    token=verified.data?.session?.access_token;
    if(verified.error||verified.data?.user?.id!==opened.target||!token)throw denied();
    const jwt=claims(token);
    if(jwt.sub!==opened.target||jwt.exp*1000<=now()||jwt.session_id===session)throw denied();
    await rpc('platform_impersonation_seal',{...binding(actor,session,opened.id),p_target_session:jwt.session_id,p_cipher:encrypt(token,actor,session,opened.id)});
    const row=await access(actor,session,opened.id);
    return {id:row.id,expires_at:row.expires_at,user:safeUser(row.user)};
   }catch(error){
    await revoke(token);
    await rpc('platform_impersonation_close',binding(actor,session,opened.id)).catch(()=>{});
    throw error;
   }
  }
  if(!UUID.test(input.sessionId||''))throw denied();
  const id=input.sessionId,args=binding(actor,session,id);
  if(input.action==='end'){
   const ciphertext=await rpc('platform_impersonation_close',args);
   if(ciphertext){let token;try{token=decrypt(ciphertext,actor,session,id);}catch{/* Closing still succeeds after irreversible revocation */}await revoke(token);}
   return {success:true};
  }
  const row=await access(actor,session,id);
  if(input.action==='status')return {id:row.id,expires_at:row.expires_at,user:safeUser(row.user)};
  if(input.action==='client-account'){
   if(!input.body||Array.isArray(input.body)||!CLIENT_ACTIONS.has(input.body.action)||row.user.app_metadata?.role!=='client')throw denied();
   await rpc('platform_impersonation_log',{...args,p_resource:'client-account',p_operation:input.body.action});
   clientAccount||=clientAccountService(getAdmin(),env,transport);
   return clientAccount(input.body,row.user,row.token);
  }
  if(input.action!=='proxy')throw fail(400,'طلب غير معروف');
  const outgoing=proxyRequest(input,row.remaining,row.user);
  if(outgoing.mutation)await rpc('platform_impersonation_log',{...args,p_resource:outgoing.resource,p_operation:outgoing.method});
  // Never use service-role credentials for data forwarding and never accept upstream hosts
  const response=await transport(new URL(input.path,base.origin).href,{method:outgoing.method,headers:{...outgoing.headers,apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${row.token}`},...(outgoing.body!==null?{body:outgoing.body}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
  const headers={};
  for(const name of ['content-type','content-range','range-unit']){const value=response.headers.get(name);if(value)headers[name]=value;}
  return {status:response.status,headers,body:await response.text()};
 };
}
