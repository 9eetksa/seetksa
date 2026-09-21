import test from 'node:test';
import assert from 'node:assert/strict';
import {createImpersonationService} from '../server/impersonation-service.mjs';
import {impersonationHandler} from '../api/impersonation.js';

const actor='10000000-0000-4000-8000-000000000001';
const actorSession='20000000-0000-4000-8000-000000000001';
const target='10000000-0000-4000-8000-000000000002';
const targetSession='20000000-0000-4000-8000-000000000002';
const id='30000000-0000-4000-8000-000000000001';
const now=Date.parse('2026-09-12T17:00:00Z');
const jwt=(sub,session_id,extra={})=>`header.${Buffer.from(JSON.stringify({sub,session_id,exp:Math.floor(now/1000)+3600,role:'authenticated',...extra})).toString('base64url')}.signature`;
const actorToken=jwt(actor,actorSession),targetToken=jwt(target,targetSession);
const env={VITE_SUPABASE_URL:'https://project.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'service-secret',ONBOARDING_ENCRYPTION_KEY:'a'.repeat(64)};
function harness({role='super_admin',targetRole='employee',accessError=null,otpUser=target,otpToken=targetToken,auditError=null}={}){
 const calls=[],requests=[],owner={id:actor,app_metadata:{role}},user={id:target,email:'client@example.test',phone:'966500000000',app_metadata:{role:targetRole},user_metadata:{display_name:'العميل'}};
 let sealed=null;
 const admin={auth:{getUser:async()=>({data:{user:owner},error:null}),admin:{generateLink:async input=>{calls.push(['generateLink',input]);return {data:{properties:{hashed_token:'otp-private'},user},error:null};},signOut:async(...args)=>{calls.push(['signOut',...args]);return {error:null};}}},rpc:async(name,args)=>{
  calls.push([name,args]);
  if(name==='platform_impersonation_open')return {data:{id,expires_at:new Date(now+900000).toISOString(),target,email:user.email},error:null};
  if(name==='platform_impersonation_seal'){sealed=args.p_cipher;return {data:null,error:null};}
  if(name==='platform_impersonation_access')return {data:accessError?null:{id,expires_at:new Date(now+900000).toISOString(),target,token_cipher:sealed,user},error:accessError};
  if(name==='platform_impersonation_close')return {data:sealed,error:null};
  if(name==='platform_impersonation_log'&&auditError)return {data:null,error:auditError};
  return {data:null,error:null};
 }};
 const anonymous={auth:{verifyOtp:async input=>{calls.push(['verifyOtp',input]);return {data:{session:{access_token:otpToken,refresh_token:'never-return-refresh'},user:{...user,id:otpUser}},error:null};}}};
 const service=createImpersonationService(env,{now:()=>now,createClient:(_url,key)=>key===env.SUPABASE_SERVICE_ROLE_KEY?admin:anonymous,transport:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json','content-range':'0-1/2','set-cookie':'secret=no'}});}});
 const start=()=>service({action:'start',userId:target},actorToken);
 return {service,start,calls,requests,revokeAccess:()=>{accessError={code:'42501',message:'session_expired'};},get sealed(){return sealed;}};
}

test('starts a bound server-only target session without disclosing credentials',async()=>{
 const h=harness(),result=await h.start();
 assert.equal(result.id,id);assert.equal(result.user.id,target);
 const text=JSON.stringify(result);
 for(const secret of [targetToken,'otp-private','never-return-refresh','service-secret',h.sealed])assert.ok(!text.includes(secret));
 assert.ok(h.sealed&&!h.sealed.includes(targetToken));
 const seal=h.calls.find(([name])=>name==='platform_impersonation_seal')[1];
 assert.equal(seal.p_actor,actor);assert.equal(seal.p_actor_session,actorSession);assert.equal(seal.p_target_session,targetSession);
});

test('non-superadmins cannot create or proxy impersonation sessions',async()=>{
 for(const role of ['admin','employee','client']){
  const h=harness({role});
  await assert.rejects(h.start(),{status:403});
  assert.equal(h.calls.length,0);
 }
});

test('customer records cannot be impersonated even if a stale backend returns a binding',async()=>{
 const h=harness({targetRole:'client'});
 await assert.rejects(h.start(),error=>error.status===403);
 assert.equal(h.requests.length,0);
});

test('mismatched target auth session is rejected and locally revoked',async()=>{
 const h=harness({otpUser:actor});
 await assert.rejects(h.start());
 assert.ok(!h.calls.some(([name])=>name==='platform_impersonation_seal'));
 assert.ok(h.calls.some(([name,token,scope])=>name==='signOut'&&token===targetToken&&scope==='local'));
});

test('forged stale or revoked bindings fail closed before data forwarding',async()=>{
 const h=harness();await h.start();h.revokeAccess();
 await assert.rejects(h.service({action:'proxy',sessionId:id,path:'/rest/v1/work_requests',method:'GET'},actorToken),{status:403});
 assert.equal(h.requests.length,0);
});

test('actor JWT must match verified user and include a valid live session claim',async()=>{
 for(const token of [jwt(target,actorSession),jwt(actor,'invalid'),jwt(actor,actorSession,{exp:1})]){
  const h=harness();await assert.rejects(h.service({action:'start',userId:target},token),{status:401});
  assert.equal(h.calls.length,0);
 }
});

test('REST proxy uses target JWT and restricted headers then records mutations',async()=>{
 const h=harness();await h.start();
 const result=await h.service({action:'proxy',sessionId:id,path:'/rest/v1/rpc/work_action',method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'accept',p:{part:target}})},actorToken);
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.headers.Authorization,`Bearer ${targetToken}`);
 assert.equal(h.requests[0].options.headers.apikey,env.VITE_SUPABASE_PUBLISHABLE_KEY);
 assert.ok(h.calls.some(([name])=>name==='platform_impersonation_log'));
 assert.equal(result.status,200);assert.equal(result.headers['content-range'],'0-1/2');
 assert.equal(result.headers['set-cookie'],undefined);
});

test('denies auth admin RPC traversal external URLs schema headers and table mutations',async()=>{
 const h=harness();await h.start();
 const attempts=[
  {path:'/auth/v1/user',method:'PUT'},
  {path:'/rest/v1/rpc/platform_role',method:'POST'},
  {path:'/rest/v1/rpc/platform_account_brief',method:'POST'},
  {path:'/rest/v1/rpc/platform_impersonation_access',method:'POST'},
  {path:'/rest/v1/account_invitations',method:'GET'},
  {path:'/rest/v1/work_requests',method:'DELETE'},
  {path:'/rest/v1/../auth/v1/user',method:'GET'},
  {path:'/rest/v1/%252e%252e/auth/v1/user',method:'GET'},
  {path:'https://evil.example/rest/v1/work_requests',method:'GET'},
  {path:'/rest/v1/work_requests',method:'GET',headers:{'accept-profile':'provision_private'}},
  {path:'/rest/v1/work_requests',method:'GET',headers:{authorization:'Bearer attacker'}},
 ];
 for(const attempt of attempts)await assert.rejects(h.service({action:'proxy',sessionId:id,...attempt},actorToken),error=>[400,403].includes(error.status));
 assert.equal(h.requests.length,0);
});

test('department inquiries and replies retain target authorization payloads and mandatory auditing',async()=>{
 const h=harness();await h.start();
 const path='/rest/v1/rpc/work_department_inquiry_action';
 for(const method of ['GET','HEAD'])await assert.rejects(h.service({action:'proxy',sessionId:id,path,method},actorToken),{status:403});
 const payloads=[
  {action:'missing',p:{request_id:target,part_id:actor,version:3,submission_key:id,inquiry_kind:'data',reason:'بيانات مطلوبة من العميل'}},
  {action:'missing',p:{request_id:target,part_id:actor,version:3,submission_key:id,inquiry_kind:'files',reason:'مرفقات مطلوبة من العميل'}},
  {action:'reply_department',p:{request_id:target,inquiry_id:actor,version:4,submission_key:id,reason:'رد العميل',files:[]}},
 ];
 for(const payload of payloads){
  const response=await h.service({action:'proxy',sessionId:id,path,method:'POST',body:JSON.stringify(payload)},actorToken);
  assert.equal(response.status,200);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),payload);
  assert.equal(h.requests.at(-1).options.headers.Authorization,`Bearer ${targetToken}`);
 }
 const audits=h.calls.filter(([name])=>name==='platform_impersonation_log');
 assert.equal(audits.length,payloads.length);
 assert(audits.every(([,args])=>args.p_resource==='rest/v1/rpc/work_department_inquiry_action'&&args.p_operation==='POST'));
 const blocked=harness({auditError:{message:'database_unavailable'}});await blocked.start();
 await assert.rejects(blocked.service({action:'proxy',sessionId:id,path,method:'POST',body:JSON.stringify(payloads[0])},actorToken),{status:409});
 assert.equal(blocked.requests.length,0);
 h.revokeAccess();
 await assert.rejects(h.service({action:'proxy',sessionId:id,path,method:'POST',body:JSON.stringify(payloads[0])},actorToken),{status:403});
 assert.equal(h.requests.length,payloads.length);
});

test('task dashboard reads preserve delegated authorization filters and pagination without mutation audits',async()=>{
 const h=harness();await h.start();
 const path='/rest/v1/rpc/work_task_dashboard';
 for(const bucket of ['all','active','client_review','client_review_overdue','personal_overdue']){
  const payload={p_bucket:bucket,p_search:'طلب',p_page:2,p_priority:'urgent',p_sort:'due'};
  const response=await h.service({action:'proxy',sessionId:id,path,method:'POST',body:JSON.stringify(payload)},actorToken);
  assert.equal(response.status,200);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),payload);
  assert.equal(h.requests.at(-1).options.headers.Authorization,`Bearer ${targetToken}`);
 }
 assert.equal(h.calls.filter(([name])=>name==='platform_impersonation_log').length,0);
 h.revokeAccess();
 await assert.rejects(h.service({action:'proxy',sessionId:id,path,method:'POST',body:'{}'},actorToken),{status:403});
 assert.equal(h.requests.length,5);
});

test('team reports and output and deadline actions are available with target authorization and mutation auditing',async()=>{
 const h=harness();await h.start();
 const report={p_start:'2026-09-01',p_end:'2026-09-20'};
 const response=await h.service({action:'proxy',sessionId:id,path:'/rest/v1/rpc/work_team_overview',method:'POST',body:JSON.stringify(report)},actorToken);
 assert.equal(response.status,200);
 assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),report);
 assert.equal(h.calls.filter(([name])=>name==='platform_impersonation_log').length,0);
 const p={request_id:target,part_id:actor,version:3,submission_key:id};
 for(const [name,payload] of [['work_department_performance',report],['work_employee_of_month',{p_month:null}]]){
  const result=await h.service({action:'proxy',sessionId:id,path:`/rest/v1/rpc/${name}`,method:'POST',body:JSON.stringify(payload)},actorToken);
  assert.equal(result.status,200);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),payload);
 }
 const operations=[...['request_outputs','deliver_outputs','reject_outputs','commit_output_due'].map(action=>['work_output_action',{action,p}]),['work_override_task_due',{p:{...p,due_at:'2026-09-25T20:59:59.999Z'}}],...['create','submit_request','reply_department'].map(action=>['work_client_resource_action',{action,p:{...p,drive_url:'https://drive.google.com/drive/folders/shared'}}])];
 operations.push(['work_department_team_save',{p:{id:target,version:3,member_ids:[actor,target],lead_user_ids:[actor,target]}}]);
 for(const [name,payload] of operations){
  const path=`/rest/v1/rpc/${name}`;
  for(const method of ['GET','HEAD'])await assert.rejects(h.service({action:'proxy',sessionId:id,path,method},actorToken),{status:403});
  const result=await h.service({action:'proxy',sessionId:id,path,method:'POST',body:JSON.stringify(payload)},actorToken);
  assert.equal(result.status,200);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),payload);
 }
 assert(h.requests.every(request=>request.options.headers.Authorization===`Bearer ${targetToken}`));
 assert.equal(h.calls.filter(([name])=>name==='platform_impersonation_log').length,operations.length);
 const blocked=harness({auditError:{message:'database_unavailable'}});await blocked.start();
 for(const [name,payload] of operations){
  await assert.rejects(blocked.service({action:'proxy',sessionId:id,path:`/rest/v1/rpc/${name}`,method:'POST',body:JSON.stringify(payload)},actorToken),{status:409});
 }
 assert.equal(blocked.requests.length,0);
});

test('personal planner forwards delegated reads and audits deadline changes with target authorization',async()=>{
 const h=harness();await h.start();
 for(const name of ['work_personal_planner','work_task_due_changes','work_planner_moves']){
  const response=await h.service({action:'proxy',sessionId:id,path:`/rest/v1/rpc/${name}`,method:'POST',body:'{}'},actorToken);
  assert.equal(response.status,200);
 }
 assert.equal(h.calls.filter(([name])=>name==='platform_impersonation_log').length,0);
 for(const name of ['work_reschedule_task_due','work_review_task_due_change','work_planner_action']){
  await assert.rejects(h.service({action:'proxy',sessionId:id,path:`/rest/v1/rpc/${name}`,method:'GET'},actorToken),{status:403});
  const payload={p:{request_id:target,version:3,submission_key:id}};
  const response=await h.service({action:'proxy',sessionId:id,path:`/rest/v1/rpc/${name}`,method:'POST',body:JSON.stringify(payload)},actorToken);
  assert.equal(response.status,200);
  assert.deepEqual(JSON.parse(h.requests.at(-1).options.body),payload);
 }
 assert.equal(h.calls.filter(([name])=>name==='platform_impersonation_log').length,3);
 assert(h.requests.every(request=>request.options.headers.Authorization===`Bearer ${targetToken}`));
 const blocked=harness({auditError:{message:'database_unavailable'}});await blocked.start();
 await assert.rejects(blocked.service({action:'proxy',sessionId:id,path:'/rest/v1/rpc/work_reschedule_task_due',method:'POST',body:'{}'},actorToken),{status:409});
 assert.equal(blocked.requests.length,0);
});

test('caps signed file reads to the remaining impersonation lifetime',async()=>{
 const h=harness();await h.start();
 await h.service({action:'proxy',sessionId:id,path:`/storage/v1/object/sign/work-files/${target}/brief/file.pdf`,method:'POST',body:JSON.stringify({expiresIn:3600})},actorToken);
 assert.equal(JSON.parse(h.requests[0].options.body).expiresIn,900);
});

test('current account directory uses target role checks through the read RPC',async()=>{
 const h=harness();await h.start();
 const response=await h.service({action:'proxy',sessionId:id,path:'/rest/v1/rpc/platform_account_directory',method:'POST',body:'{}'},actorToken);
 assert.equal(response.status,200);assert.equal(h.requests[0].options.headers.Authorization,`Bearer ${targetToken}`);
 assert.ok(!h.calls.some(([name])=>name==='platform_impersonation_log'));
});

test('signed work uploads cannot overwrite objects or target another bucket',async()=>{
 const h=harness();await h.start();
 await assert.rejects(h.service({action:'proxy',sessionId:id,path:`/storage/v1/object/upload/sign/work-files/${target}/brief/file.pdf`,method:'POST',headers:{'x-upsert':'true'},body:'{}'},actorToken),{status:403});
 await assert.rejects(h.service({action:'proxy',sessionId:id,path:`/storage/v1/object/upload/sign/secrets/${target}/file`,method:'POST',body:'{}'},actorToken),{status:403});
 assert.equal(h.requests.length,0);
});

test('end closes only the impersonated target session and returns no ciphertext',async()=>{
 const h=harness();await h.start();const result=await h.service({action:'end',sessionId:id},actorToken);
 assert.deepEqual(result,{success:true});
 assert.ok(h.calls.some(([name,token,scope])=>name==='signOut'&&token===targetToken&&scope==='local'));
});

test('delegation does not expose credential or administrative account endpoints',async()=>{
 const h=harness();await h.start();
 await assert.rejects(h.service({action:'client-account',sessionId:id,body:{action:'update-client-email',userId:target,email:'x@example.test'}},actorToken),{status:403});
 assert.equal(h.requests.length,0);
});

test('failed durable audit prevents dispatching the mutation',async()=>{
 const h=harness({auditError:{message:'database_unavailable'}});await h.start();
 await assert.rejects(h.service({action:'proxy',sessionId:id,path:'/rest/v1/rpc/work_action',method:'POST',body:JSON.stringify({action:'accept',p:{}})},actorToken),{status:409});
 assert.equal(h.requests.length,0);
});

test('gateway rejects malformed anonymous oversized and non-JSON requests before service use',async()=>{
 let calls=0;
 const handler=impersonationHandler(env,{serviceFactory:()=>async()=>{calls++;return {success:true};}});
 const request=async req=>{
  const res={headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler(req,res);assert.equal(res.headers['Cache-Control'],'no-store');return res;
 };
 const valid={method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${actorToken}`},body:{action:'status',sessionId:id}};
 assert.equal((await request({...valid,method:'GET'})).code,405);
 assert.equal((await request({...valid,headers:{'content-type':'text/plain'}})).code,415);
 assert.equal((await request({...valid,headers:{'content-type':'application/json'}})).code,401);
 assert.equal((await request({...valid,body:'{broken'})).code,400);
 assert.equal((await request({...valid,body:{oversized:'a'.repeat(2*1024*1024)}})).code,413);
 assert.equal(calls,0);
 assert.equal((await request(valid)).code,200);assert.equal(calls,1);
});
