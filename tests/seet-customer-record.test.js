import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountService} from '../server/account-service.mjs';

test('customer creation stores a blocked reference without sending or storing login credentials',async()=>{
 const owner={id:'00000000-0000-4000-8000-000000000001',app_metadata:{role:'super_admin'}},customerId='00000000-0000-4000-8000-000000000002';
 const savedFetch=globalThis.fetch,requests=[];let invitation,created;
 const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(url,init={})=>{
  const pathname=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;
  requests.push({pathname,body});
  if(pathname==='/auth/v1/user')return json(owner);
  if(pathname==='/rest/v1/rpc/platform_access_check')return json({user_id:owner.id,role:'super_admin'});
  if(pathname==='/rest/v1/account_invitations'){
   if(init.method==='POST')invitation={...body};else Object.assign(invitation,body);
   return json([]);
  }
  if(pathname==='/rest/v1/rpc/platform_invite_lock')return json(invitation);
  if(pathname==='/rest/v1/rpc/platform_find_invite_user')return json(null);
  if(pathname==='/auth/v1/admin/users'){
   created=body;return json({id:customerId,...body});
  }
  if(pathname==='/rest/v1/rpc/platform_server_audit'||pathname==='/rest/v1/account_profiles')return json(null);
  throw Error(`Unexpected request ${pathname}`);
 };
 try{
  const service=createAccountService({VITE_SUPABASE_URL:'https://seet.example.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'test-server-key'},async()=>{throw Error('Customer invitation must never be sent');});
  const result=await service({action:'create',requestId:'00000000-0000-4000-8000-000000000003',role:'client',name:'جهة تجريبية',email:'customer@example.invalid',phone:'+966500000000',contactName:'جهة التواصل'},'verified-token');
  assert.equal(created.ban_duration,'876000h');
  assert.equal(created.app_metadata.no_portal,true);
  assert.equal(created.app_metadata.must_change_password,false);
  assert.equal(invitation.password_cipher,null);
  assert.equal(result.invitation.record_only,true);
  assert.equal(result.invitation.user_id,customerId);
  assert(!JSON.stringify(result).includes(created.password));
  assert(!requests.some(row=>/invite|generate_link|otp/.test(row.pathname)&&!row.pathname.includes('invite_lock')&&!row.pathname.includes('find_invite_user')));
 }finally{globalThis.fetch=savedFetch;}
});
