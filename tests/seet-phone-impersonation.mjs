import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function testSeetPhoneImpersonation(db){
 const actor=randomUUID(),target=randomUUID(),actorSession=randomUUID();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 await db.exec('reset role');
 for(const [id,role,phone] of [[actor,'super_admin','966511111101'],[target,'employee','966511111102']]){
  await q("insert into auth.users(id,phone,phone_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)",[id,phone,JSON.stringify({role,phone_only:true})]);
 }
 await q('insert into auth.sessions(id,user_id) values($1,$2)',[actorSession,actor]);
 const open=async()=>(await q('select public.platform_impersonation_open($1,$2,$3) v',[actor,actorSession,target]))[0].v;
 const active=async(sid,user=target)=>(await q('select provision_private.session_active($1,$2) v',[user,sid]))[0].v;
 const seal=async(id)=>q('select public.platform_impersonation_seal($1,$2,$3,$1,$4)',[id,actor,actorSession,'encrypted-fixture'.repeat(5)]);
 const opened=await open();assert.equal(opened.credential_method,'delegated_jwt');assert.equal(opened.user.id,target);
 assert.equal(await active(opened.id),false);await seal(opened.id);assert.equal(await active(opened.id),true);
 assert.equal(await active(opened.id,actor),false);
 assert.equal((await q('select count(*)::int n from auth.sessions where user_id=$1',[target]))[0].n,0);
 await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[target,JSON.stringify({sub:target,role:'authenticated',session_id:opened.id,seet_delegation:opened.id})]);
 await db.exec('set role authenticated');
 assert.equal((await q('select provision_private.account_ready() ready'))[0].ready,true);
 await q('select public.seet_mission_context()');
 await assert.rejects(q('select public.platform_impersonation_open($1,$2,$3)',[actor,actorSession,target]),/permission denied/);
 await db.exec('reset role');
 await q("update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"permissions\":[\"changed\"]}'::jsonb where id=$1",[target]);
 assert.equal(await active(opened.id),false);
 await q("update auth.users set raw_app_meta_data=raw_app_meta_data-'permissions' where id=$1",[target]);
 assert.equal(await active(opened.id),true);
 await q("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[actor]);
 assert.equal(await active(opened.id),false);await q('update auth.users set banned_until=null where id=$1',[actor]);
 await q('select public.platform_impersonation_close($1,$2,$3)',[opened.id,actor,actorSession]);assert.equal(await active(opened.id),false);
 const another=await open();await seal(another.id);
 await q('delete from auth.sessions where id=$1',[actorSession]);assert.equal(await active(another.id),false);
 await assert.rejects(q('select public.platform_impersonation_access($1,$2,$3)',[another.id,actor,actorSession]),/forbidden/);
 await q('insert into auth.sessions(id,user_id) values($1,$2)',[actorSession,actor]);
 await q("update provision_private.account_impersonation set expires_at=now()-interval '1 second' where id=$1",[another.id]);assert.equal(await active(another.id),false);
 await q("update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"must_change_password\":true}'::jsonb where id=$1",[target]);
 await assert.rejects(open(),/target_onboarding/);
 console.log('PASS phone delegation: target RLS, no Auth identity/session mutation, closed/expired/revoked actor, metadata change, onboarding and RPC privileges');
}
