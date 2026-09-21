import assert from 'node:assert/strict';

// Vault and pg_net are local recording shims: no secrets or requests leave the test.
export async function testSeetWhatsappAuthHook(db) {
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const role=async name=>{await db.exec('reset role');await db.exec(`set role ${name}`);};
 const employee=id(920001),customer=id(920002),phone='966589920001',otp='123456',fakeToken='TEST_ONLY_GREENAPI_TOKEN_NEVER_VALID';
 const event={user:{id:employee,phone},sms:{otp}};
 const hook=async input=>(await q('select public.seet_send_whatsapp_otp($1) as value',[JSON.stringify(input)]))[0].value;
 const configure=async token=>q('select public.seet_configure_whatsapp($1)',[token]);
 const unavailable={error:{http_code:403,message:'Account unavailable'}};
 await db.exec('reset role');
 await q("insert into auth.users(id,phone,raw_app_meta_data) values($1,$2,'{\"role\":\"employee\",\"account_type\":\"employee\",\"phone_only\":true}'),($3,'966589920002','{\"role\":\"client\"}')",[employee,phone,customer]);
 for(const actor of ['anon','authenticated','service_role']) {await role(actor);await assert.rejects(hook(event),/permission denied/);}
 for(const actor of ['anon','authenticated','supabase_auth_admin']) {await role(actor);await assert.rejects(configure(fakeToken),/permission denied/);}
 await role('supabase_auth_admin');
 assert.deepEqual(await hook(event),{error:{http_code:503,message:'WhatsApp is not configured'}});
 assert.deepEqual(await hook({...event,user:{id:employee,phone:'966589920099'}}),unavailable);
 assert.deepEqual(await hook({...event,user:{id:customer,phone:'966589920002'}}),unavailable);
 for(const invalid of ['', '12345', '1234567', '12x456']) assert.deepEqual(await hook({...event,sms:{otp:invalid}}),unavailable);
 await role('service_role');
 for(const invalid of [null,'short','invalid token with whitespace','a'.repeat(20)+'/injected/path']) await assert.rejects(configure(invalid),/invalid_provider_token/);
 await configure(fakeToken);
 await configure(fakeToken+'_ROTATED');
 await db.exec('reset role');
 assert.equal((await q("select count(*)::integer as count from vault.secrets where name='seet_green_api_token'"))[0].count,1,'configuration rotates one named Vault secret');
 const before=(await q('select count(*)::integer as count from net.http_request_queue'))[0].count;
 for(const disabled of ["banned_until=now()+interval '1 day'","deleted_at=now()","is_anonymous=true"]) {
  await q(`update auth.users set ${disabled} where id=$1`,[employee]);
  await role('supabase_auth_admin');assert.deepEqual(await hook(event),unavailable);
  await db.exec('reset role');await q('update auth.users set banned_until=null,deleted_at=null,is_anonymous=false where id=$1',[employee]);
 }
 await q("update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"must_change_password\":true}' where id=$1",[employee]);
 await role('supabase_auth_admin');
 assert.deepEqual(await hook(event),{});
 await db.exec('reset role');
 assert.equal((await q('select count(*)::integer as count from net.http_request_queue'))[0].count,before+1,'only valid Auth event is queued');
 const queued=(await q('select * from net.http_request_queue order by id desc limit 1'))[0];
 assert.equal(queued.url,`https://7107.api.greenapi.com/waInstance710722692511/sendMessage/${fakeToken}_ROTATED`);
 assert.equal(queued.body.chatId,phone+'@c.us');assert(queued.body.message.includes(otp));assert.equal(queued.body.linkPreview,false);assert.equal(queued.timeout_milliseconds,10000);
 assert.deepEqual(queued.headers,{'Content-Type':'application/json'});
 for(const actor of ['anon','authenticated']) {
  await role(actor);await assert.rejects(q('select * from net.http_request_queue'),/permission denied/);await assert.rejects(q('select * from net._http_response'),/permission denied/);await assert.rejects(q('select * from vault.decrypted_secrets'),/permission denied/);
 }
 await db.exec('reset role');
 // Force a provider queue exception containing a fake sensitive URL/OTP; public output must remain generic.
 await db.exec(`create or replace function net.http_post(url text,headers jsonb default '{}',body jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$begin raise exception 'Fake provider failure TEST_ONLY_GREENAPI_TOKEN_NEVER_VALID 123456'; end$$;`);
 await role('supabase_auth_admin');
 const failed=await hook(event);assert.deepEqual(failed,{error:{http_code:503,message:'WhatsApp request could not be queued'}});
 assert(!JSON.stringify(failed).includes(fakeToken));assert(!JSON.stringify(failed).includes(otp));
 assert.deepEqual(await hook({user:{id:'malformed',phone},sms:{otp}}),failed,'malformed payload cannot expose internal exception details');
 await db.exec('reset role');
 console.log('PASS native WhatsApp Auth hook service configuration grants account admission isolated queue payload and generic secret-free errors');
}
