// Run only after the account lifecycle and impersonation migrations are deployed
// node --env-file=.env.local scripts/check-account-access.mjs
// Add --browser-only for a targeted browser rerun with disposable identities
// Add --storage-only for a targeted signed logo upload and deletion check
// This check creates four disposable QA accounts and never touches real workflow rows
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createImpersonationService} from '../server/impersonation-service.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanupArgument=process.argv.find(value=>value.startsWith('--cleanup-run='));
const cleanupOnly=!!cleanupArgument,requestedRun=cleanupArgument?.slice('--cleanup-run='.length);
const browserOnly=process.argv.includes('--browser-only');
const storageOnly=process.argv.includes('--storage-only');
if(browserOnly&&storageOnly)throw new Error('choose_one_qa_mode');
if(cleanupOnly&&!uuid.test(requestedRun||''))throw new Error('invalid_qa_run');
const env=process.env,runId=requestedRun||randomUUID(),records=[],delegations=[],lifecycleIds=new Set();
const sdkOptions={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{transport:WebSocket}};
const service=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,sdkOptions);
const impersonate=createImpersonationService(env);
const invoke=promisify(execFile);
const npxScript=join(dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
const artifact=join(process.cwd(),'.tools',`account-access-qa-${runId}.json`);
let passed=0,failed=0,phase=0,failurePhase=0,lastHttpStatus=0,errorStatus=0,storageWarnings=0,removed=0,logoPath=null;
const must=result=>{if(result.error)throw new Error('qa_operation_failed');return result.data;};
const mark=condition=>{assert.ok(condition);passed++;};
const expectDenied=async operation=>{
 let denied=false;
 try{const response=await operation();denied=response?.error!=null||[401,403].includes(response?.status);}
 catch(error){denied=[401,403].includes(error.status);}
 mark(denied);
};
const checkpoint=async()=>writeFile(artifact,JSON.stringify({run_id:runId,ids:records.map(record=>record.user.id),lifecycle_ids:[...lifecycleIds]},null,2),'utf8');
const publicClient=()=>createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,sdkOptions);
async function sql(query){
 // The Windows npx launcher truncates multiline positional SQL arguments
 const statement=query.replace(/\s+/g,' ').trim();
 const result=await invoke(process.execPath,[npxScript,'supabase','db','query','--linked','--yes','--output-format','json',statement],{cwd:process.cwd(),windowsHide:true,timeout:45000,maxBuffer:512*1024});
 // CLI output is intentionally not printed because database errors can contain data
 const output=JSON.parse(result.stdout);if(output.error)throw new Error('qa_sql_failed');return output;
}
function cleanupSql(){
 assert.ok(uuid.test(runId));assert.ok(records.every(record=>uuid.test(record.user.id)));
 const ids=records.map(record=>`'${record.user.id}'::uuid`).join(',');
 return `do $qa$ declare targets uuid[]; begin
 select array_agg(u.id) into targets from auth.users u left join provision_private.account_lifecycle l on l.user_id=u.id where u.id in (${ids}) and (
 (u.raw_app_meta_data->>'portal_qa'='true' and u.raw_app_meta_data->>'qa_account_access'='${runId}')
 or (u.id in (${[...lifecycleIds].map(id=>`'${id}'::uuid`).join(',')||'null::uuid'}) and u.deleted_at is not null and l.state='deleted'
 and l.original_role in('client','employee','admin') and l.original_email='account-access-${runId}-'||l.original_role||'@example.invalid' and l.changed_by in (${ids})));
 if coalesce(cardinality(targets),0)<>${records.length} then raise exception 'qa_identity_guard_failed'; end if;
 if exists(select 1 from public.work_requests where client_id=any(targets) or coordinator_id=any(targets))
 or exists(select 1 from public.work_parts where assignee_id=any(targets))
 or exists(select 1 from public.work_events where actor=any(targets)) then raise exception 'qa_workflow_guard_failed'; end if;
 delete from provision_private.account_impersonation where actor=any(targets) and target=any(targets);
 delete from provision_private.impersonation where actor=any(targets) and target=any(targets);
 delete from provision_private.audit where actor=any(targets) and (effective_user is null or effective_user=any(targets));
 delete from provision_private.account_lifecycle where user_id=any(targets) and (changed_by is null or changed_by=any(targets));
 if exists(select 1 from provision_private.account_impersonation where actor=any(targets) or target=any(targets)) then raise exception 'qa_private_cleanup_failed'; end if;
 end $qa$;`;
}
let owner;
async function proxy(delegation,path,{method='POST',body={}}={}){
 const response=await impersonate({action:'proxy',sessionId:delegation.id,path,method,...(!['GET','HEAD'].includes(method)?{body:JSON.stringify(body)}:{})},owner.token);
 lastHttpStatus=response.status;return response;
}
async function proxyRpc(delegation,name,body={}){
 const response=await proxy(delegation,`/rest/v1/rpc/${name}`,{body});
 assert.ok(response.status>=200&&response.status<300);
 return response.body?JSON.parse(response.body):null;
}

try{
 phase=1;
 assert.ok(existsSync(npxScript),'CLI runtime missing');
 if(cleanupOnly){
  const saved=JSON.parse(await readFile(artifact,'utf8'));assert.equal(saved.run_id,runId);assert.ok(Array.isArray(saved.ids)&&saved.ids.every(id=>uuid.test(id)));
  for(const id of saved.lifecycle_ids||[]){assert.ok(uuid.test(id)&&saved.ids.includes(id));lifecycleIds.add(id);}
  for(const id of saved.ids){
   const result=await service.auth.admin.getUserById(id);
   if(result.error?.status===404||result.error?.code==='user_not_found')continue;
   const user=must(result).user;
   if(!(user.deleted_at&&lifecycleIds.has(id))){assert.equal(user.app_metadata.portal_qa,true);assert.equal(user.app_metadata.qa_account_access,runId);}
   records.push({user,role:user.app_metadata.role});
  }
 }else{
 // Verify cleanup access before creating the first account
 await sql("do $qa$ begin if to_regclass('provision_private.account_impersonation') is null or to_regclass('provision_private.account_lifecycle') is null then raise exception 'qa_migrations_missing'; end if; end $qa$");
 await mkdir(dirname(artifact),{recursive:true});
 for(const role of (storageOnly?['super_admin','client']:['super_admin','client','employee','admin'])){
  phase++;
  const password=`QA_${randomUUID()}9@`,email=`account-access-${runId}-${role}@example.invalid`;
  const user=must(await service.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{role,permissions:role==='admin'?['users.read']:[],portal_qa:true,qa_account_access:runId},user_metadata:{display_name:'حساب تحقق مؤقت'}})).user;
  const record={user,role,password};records.push(record);await checkpoint();
  record.client=publicClient();record.session=must(await record.client.auth.signInWithPassword({email,password})).session;record.token=record.session.access_token;
 }
 owner=records[0];
 if(storageOnly){
  phase=500;
  const client=records.find(record=>record.role==='client');
  const delegation=await impersonate({action:'start',userId:client.user.id},owner.token);delegations.push(delegation);
  mark(delegation.user.id===client.user.id);
  logoPath=`${client.user.id}/logo`;
  const signedResponse=await proxy(delegation,`/storage/v1/object/upload/sign/client-logos/${logoPath}`,{body:{}});
  assert.equal(signedResponse.status,200);
  const signed=JSON.parse(signedResponse.body),uploadToken=new URL(signed.url,env.VITE_SUPABASE_URL).searchParams.get('token');assert.ok(uploadToken);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=','base64');
  must(await publicClient().storage.from('client-logos').uploadToSignedUrl(logoPath,uploadToken,png,{contentType:'image/png',cacheControl:'0'}));
  mark(await proxyRpc(delegation,'client_logo_commit',{p_path:logoPath})===logoPath);
  const profile=await proxyRpc(delegation,'platform_profile');mark(profile.user_id===client.user.id&&profile.logo_path===logoPath);
  await expectDenied(()=>proxy(delegation,`/storage/v1/object/upload/sign/client-logos/${owner.user.id}/logo`,{body:{}}));
  phase=501;await proxyRpc(delegation,'client_logo_commit',{p_path:null});
  const removal=await proxy(delegation,'/storage/v1/object/client-logos',{method:'DELETE',body:{prefixes:[logoPath]}});
  mark(removal.status>=200&&removal.status<300);
  phase=502;
  const missing=await proxy(delegation,'/rest/v1/rpc/client_logo_commit',{body:{p_path:logoPath}});mark(missing.status>=400);
  logoPath=null;
  await impersonate({action:'end',sessionId:delegation.id},owner.token);
  mark(must(await owner.client.rpc('platform_access_check')).user_id===owner.user.id);
  await writeFile(join(process.cwd(),'.tools','account-access-storage-result.json'),JSON.stringify({run_id:runId,passed,status:removal.status},null,2),'utf8');
 }
 if(!browserOnly&&!storageOnly){
 for(const record of records.slice(1)){
  phase++;
  const delegation=await impersonate({action:'start',userId:record.user.id},owner.token);delegations.push(delegation);
  mark(delegation.user.id===record.user.id&&delegation.user.app_metadata.role===record.role);
  const profile=await proxyRpc(delegation,'platform_profile');mark(profile.user_id===record.user.id&&profile.role===record.role);
  if(record.role==='client'){
   const board=await proxyRpc(delegation,'client_board',{p_filter:'all',p_search:'',p_page:0});mark(Array.isArray(board.items)&&board.items.length===0);
   await expectDenied(()=>proxy(delegation,'/rest/v1/rpc/platform_users'));
   await expectDenied(()=>proxy(delegation,'/rest/v1/rpc/platform_account_directory'));
   await expectDenied(()=>proxy(delegation,'/rest/v1/rpc/platform_account_brief',{body:{p_user:record.user.id}}));
   await expectDenied(()=>proxy(delegation,'/rest/v1/rpc/platform_impersonation_open',{body:{p_actor:owner.user.id}}));
   await expectDenied(()=>proxy(delegation,'/auth/v1/user',{method:'GET'}));
   phase++;
   logoPath=`${record.user.id}/logo`;
   const signedResponse=await proxy(delegation,`/storage/v1/object/upload/sign/client-logos/${logoPath}`,{body:{}});
   assert.equal(signedResponse.status,200);
   const signed=JSON.parse(signedResponse.body),signedUrl=new URL(signed.url,env.VITE_SUPABASE_URL),uploadToken=signedUrl.searchParams.get('token');
   assert.ok(uploadToken);
   const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=','base64');
   must(await publicClient().storage.from('client-logos').uploadToSignedUrl(logoPath,uploadToken,png,{contentType:'image/png',cacheControl:'0'}));
   mark(await proxyRpc(delegation,'client_logo_commit',{p_path:logoPath})===logoPath);
   const photo=await proxyRpc(delegation,'platform_profile');mark(photo.logo_path===logoPath);
   await expectDenied(()=>proxy(delegation,`/storage/v1/object/upload/sign/client-logos/${owner.user.id}/logo`,{body:{}}));
   // Optional removal diagnostics cannot prevent the role and browser checks
   try{
    phase=701;await proxyRpc(delegation,'client_logo_commit',{p_path:null});
    phase=702;
    const removedLogo=await proxy(delegation,'/storage/v1/object/client-logos',{method:'DELETE',body:{prefixes:[logoPath]}});
    if(removedLogo.status>=200&&removedLogo.status<300){
     phase=703;const missingLogo=await proxy(delegation,'/rest/v1/rpc/client_logo_commit',{body:{p_path:logoPath}});mark(missingLogo.status>=400);logoPath=null;
    }else{
     storageWarnings++;let detail={};try{detail=JSON.parse(removedLogo.body);}catch{}
     const sanitize=value=>String(value||'').slice(0,600).replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,'[redacted]');
     await writeFile(join(process.cwd(),'.tools','account-access-storage-diagnostic.json'),JSON.stringify({run_id:runId,status:removedLogo.status,error:sanitize(detail.error||detail.code),message:sanitize(detail.message)},null,2),'utf8');
    }
   }catch{storageWarnings++;}
  }else{
   const workspace=await proxyRpc(delegation,'work_workspace',{p_page:0,p_view:'mine',p_search:''});mark(!!workspace&&typeof workspace==='object');
   if(record.role==='admin'){
    const directory=await proxyRpc(delegation,'platform_account_directory',{p_search:runId,p_role:'all',p_status:'all',p_login:'all',p_sort:'newest',p_page:0});
    mark(Array.isArray(directory.items)&&directory.items.every(row=>row.role!=='super_admin'));
    await expectDenied(()=>proxy(delegation,'/rest/v1/rpc/platform_account_brief',{body:{p_user:record.user.id}}));
   }
  }
  await expectDenied(()=>impersonate({action:'start',userId:owner.user.id},record.token));
  await impersonate({action:'end',sessionId:delegation.id},owner.token);
  await expectDenied(()=>impersonate({action:'status',sessionId:delegation.id},owner.token));
  mark(must(await record.client.rpc('platform_access_check')).user_id===record.user.id);
  mark(must(await owner.client.rpc('platform_access_check')).user_id===owner.user.id);
 }
 }
 if(process.argv.includes('--browser')||browserOnly){
  phase=900;
  const {runBrowserChecks}=await import('./check-account-access-ui.mjs');
  try{
   const result=await runBrowserChecks({ownerSession:owner.session,fixtures:records.map(record=>({id:record.user.id,email:record.user.email,role:record.role})),baseUrl:env.QA_BASE_URL||'http://localhost:5173'});
   if(typeof result?.passed==='number')passed+=result.passed;
   else if(Array.isArray(result?.checks))passed+=result.checks.filter(check=>check.passed).length;
  }catch(error){
   failed++;failurePhase=phase;
   const message=String(error.message||'browser_check_failed').slice(0,2500).replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,'[redacted]');
   await writeFile(join(process.cwd(),'.tools','account-access-browser-integration.json'),JSON.stringify({run_id:runId,phase,message},null,2),'utf8');
  }
 }
 if(!browserOnly&&!storageOnly){
 phase=1000;
 const lifecycleTarget=records.find(record=>record.role==='employee');
 lifecycleIds.add(lifecycleTarget.user.id);await checkpoint();
 const apiBase=new URL(env.QA_BASE_URL||'http://localhost:5173');assert.ok(['localhost','127.0.0.1'].includes(apiBase.hostname));
 const lifecycle=async(operation,extra={})=>{
  const response=await fetch(new URL('/api/accounts',apiBase),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${owner.token}`},body:JSON.stringify({action:'account-lifecycle',userId:lifecycleTarget.user.id,operation,reason:'تحقق آلي بحساب مؤقت',...extra})});
  lastHttpStatus=response.status;assert.equal(response.status,200);return response.json();
 };
 const relogin=async()=>{
  lifecycleTarget.client=publicClient();
  lifecycleTarget.session=must(await lifecycleTarget.client.auth.signInWithPassword({email:lifecycleTarget.user.email,password:lifecycleTarget.password})).session;
  lifecycleTarget.token=lifecycleTarget.session.access_token;
  mark(must(await lifecycleTarget.client.rpc('platform_access_check')).user_id===lifecycleTarget.user.id);
 };
 mark((await lifecycle('suspend-until',{until:new Date(Date.now()+600000).toISOString()})).access_status==='temporary');
 await expectDenied(()=>lifecycleTarget.client.rpc('platform_access_check'));
 mark((await lifecycle('reactivate')).access_status==='active');await relogin();
 phase=1001;
 mark((await lifecycle('suspend')).access_status==='suspended');
 await expectDenied(()=>lifecycleTarget.client.rpc('platform_access_check'));
 mark((await lifecycle('reactivate')).access_status==='active');await relogin();
 phase=1002;
 const deleted=await lifecycle('delete',{confirmation:lifecycleTarget.user.email});
 mark(deleted.access_status==='deleted'&&deleted.identity_deleted===true&&deleted.identity_cleanup_pending===false);
 await expectDenied(()=>lifecycleTarget.client.rpc('platform_access_check'));
 await expectDenied(()=>publicClient().auth.signInWithPassword({email:lifecycleTarget.user.email,password:lifecycleTarget.password}));
 mark(must(await owner.client.rpc('platform_access_check')).user_id===owner.user.id);
 }
 }
}catch(error){
 failed++;failurePhase=phase;errorStatus=Number(error.status)||0;
}finally{
 for(const delegation of delegations){
  if(owner?.token)await impersonate({action:'end',sessionId:delegation.id},owner.token).catch(()=>{});
 }
 if(logoPath){
  try{
   phase=101;
   const fixture=records.find(record=>`${record.user.id}/logo`===logoPath);
   assert.ok(fixture?.user.app_metadata?.portal_qa&&fixture.user.app_metadata.qa_account_access===runId);
   must(await service.storage.from('client-logos').remove([logoPath]));logoPath=null;
  }catch{failed++;}
 }
 for(const record of records)if(record.client)await record.client.auth.signOut({scope:'local'}).catch(()=>{});
 if(records.length){
  try{
   // Independently recheck exact identities before removing restrictive private FKs
   for(const record of records){
    const user=must(await service.auth.admin.getUserById(record.user.id)).user;
    if(!(user.deleted_at&&lifecycleIds.has(user.id))){assert.equal(user.app_metadata.portal_qa,true);assert.equal(user.app_metadata.qa_account_access,runId);}
   }
   phase=102;
   await sql(cleanupSql());
   phase=103;
   const ids=records.map(record=>`'${record.user.id}'::uuid`).join(',');
   const cleaned=await sql(`select count(*) as remaining from provision_private.account_impersonation where actor in (${ids}) or target in (${ids})`);
   assert.equal(Number(cleaned.rows?.[0]?.remaining),0);
   phase=104;
   for(const record of [...records].reverse()){
    must(await service.auth.admin.deleteUser(record.user.id));removed++;
   }
  }catch{failed++;}
 }
 console.log(JSON.stringify({passed,failed,phase,failure_phase:failurePhase,http_status:lastHttpStatus,error_status:errorStatus,storage_warnings:storageWarnings,created:records.length,removed,remaining:records.length-removed}));
 if(failed||removed!==records.length)process.exitCode=1;
}
