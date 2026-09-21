import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountService} from '../server/account-service.mjs';
import {validateNewAccount,publicAccountData,accountContact} from '../src/auth/account-rules.js';

test('phone-only input accepts four account types and cannot request an owner role',()=>{
 for(const role of ['collaborator','employee','admin','supervisor']) {
  const result=validateNewAccount({name:'Test',phone:'0500000000',role,jobTitle:'Test',phone_only:true,email:'discard@example.invalid'});
  assert.equal(result.value.email,'');assert.equal(result.value.phone_only,true);
 }
 assert.ok(validateNewAccount({name:'Test',phone:'0500000000',role:'super_admin'}).error);
 assert.ok(validateNewAccount({name:'Test',phone:'wrong',role:'supervisor'}).error);
});

test('internal identifiers never render as contact data and file results remain intact',()=>{
 const email='internal@accounts.seet.invalid',blob=new Blob(['file']);
 assert.deepEqual(publicAccountData({email,people:[{email:'real@example.com'}, {email}]}),{email:'',people:[{email:'real@example.com'},{email:''}]});
 assert.equal(publicAccountData(blob),blob);
 assert.equal(accountContact({email,phone:'+966500000000',app_metadata:{phone_only:true}}),'+966500000000');
});
test('phone account delegates OTP to native Auth without email or leaking credentials',async()=>{
 const saved=globalThis.fetch,owner={id:'00000000-0000-4000-8000-000000000001',app_metadata:{role:'super_admin'}},uid='00000000-0000-4000-8000-000000000002';
 let invitation,created,otpRequests=[];
 const json=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):null;
  if(path==='/auth/v1/user')return json(owner);
  if(path==='/rest/v1/rpc/platform_access_check')return json({user_id:owner.id});
  if(path==='/rest/v1/account_invitations'){
   if(init.method==='POST')invitation={...body};
   else if(init.method==='PATCH')Object.assign(invitation,body);
   return json(init.method==='GET'?invitation:[]);
  }
  if(path==='/rest/v1/rpc/platform_invite_lock')return json(invitation);
  if(path==='/rest/v1/rpc/platform_find_invite_user')return json(null);
  if(path==='/auth/v1/admin/users'){created=body;return json({id:uid,...body});}
  if(path==='/auth/v1/otp'){otpRequests.push(body);return json({});}
  if(path==='/rest/v1/account_profiles'||path==='/rest/v1/rpc/platform_server_audit')return json(null);
  throw Error(`Unexpected request ${path}`);
 };
 const env={VITE_SUPABASE_URL:'https://seet.example.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'test-publishable',SUPABASE_SERVICE_ROLE_KEY:'test-service',ONBOARDING_ENCRYPTION_KEY:'a'.repeat(64),APP_URL:'http://localhost:5175'};
 try {
   const service=createAccountService(env,async()=>{throw Error('Direct provider call forbidden for native OTP');});
   const result=await service({action:'create',requestId:'00000000-0000-4000-8000-000000000003',role:'supervisor',name:'Test',phone:'0500000000',phone_only:true},'token');
   assert.equal(created.email,undefined);assert.equal(created.app_metadata.role,'employee');assert.equal(created.app_metadata.account_type,'supervisor');assert.equal(created.app_metadata.must_change_password,true);
   assert.equal(otpRequests.length,1);assert.equal(otpRequests[0].phone,'+966500000000');assert.equal(otpRequests[0].create_user,false);
   assert.equal(result.invitation.whatsapp_status,'pending');
   // The real projection cannot return ciphertext; this mock deliberately does.
   assert.ok(!JSON.stringify(result).includes(created.password));
   assert.equal(invitation.email,'');
 } finally {globalThis.fetch=saved;}
});
