import {loadEnv} from 'vite';
import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const env=loadEnv('development',process.cwd(),'');
const options={auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket}};
const service=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options);
const must=r=>{if(r.error)throw new Error(r.error.code||r.error.message);return r.data};
const records=[];
try{
 for(const role of ['super_admin','admin','client']){
  const password=`QA_${randomUUID()}9`, email=`directory-${randomUUID()}@resend.dev`;
  const user=must(await service.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{role,permissions:role==='admin'?['users.read']:[],portal_qa:true}})).user;
  const record={user,role};records.push(record);
  must(await service.from('account_profiles').upsert({user_id:user.id,display_name:'Directory QA',phone:'',updated_by:user.id}));
  record.client=createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY,options);
  must(await record.client.auth.signInWithPassword({email,password}));
 }
 const [owner,admin,client]=records;
 const ordinary=must(await admin.client.rpc('platform_users'));
 assert.ok(!ordinary.some(u=>u.role==='super_admin'));
 assert.ok(ordinary.some(u=>u.id===client.user.id));
 assert.deepEqual(must(await admin.client.rpc('platform_users',{p_search:owner.user.email})),[]);
 assert.deepEqual(must(await admin.client.from('account_profiles').select('user_id').eq('user_id',owner.user.id)),[]);
 assert.ok(must(await admin.client.from('account_profiles').select('user_id').eq('user_id',client.user.id)).length===1);
 assert.ok(must(await owner.client.rpc('platform_users',{p_search:owner.user.email})).some(u=>u.id===owner.user.id));
 assert.ok(must(await owner.client.from('account_profiles').select('user_id').eq('user_id',owner.user.id)).length===1);
 assert.ok((await client.client.rpc('platform_users')).error);
 console.log('PASS admin directory and exact search hide super admins');
 console.log('PASS direct profile reads enforce the same boundary');
 console.log('PASS owner visibility and ordinary account visibility preserved');
 console.log('PASS clients cannot list accounts');
}finally{
 for(const record of records){if(record.client)await record.client.auth.signOut({scope:'local'});must(await service.auth.admin.deleteUser(record.user.id))}
 console.log('Disposable directory test accounts removed');
}
