import test from 'node:test';
import assert from 'node:assert/strict';
import {greenApiWebhookHandler,webhookAuthorized} from '../api/green-api-webhook.js';
import {providerUnavailable} from '../api/work-notifications.js';

function response(){
 return {
  statusCode:200,
  headers:{},
  body:null,
  setHeader(name,value){this.headers[name.toLowerCase()]=value;},
  status(code){this.statusCode=code;return this;},
  json(body){this.body=body;return this;}
 };
}

test('provider states with unavailable sending are blocked before queue claiming',()=>{
 for(const state of ['unavailable','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended'])assert.equal(providerUnavailable(state),true);
 assert.equal(providerUnavailable('authorized'),false);
});

test('Green API webhook requires its bearer secret',async()=>{
 assert.equal(webhookAuthorized('webhook-secret','Bearer webhook-secret'),true);
 assert.equal(webhookAuthorized('webhook-secret','Bearer wrong-secret-1'),false);
 let databaseCreated=false;
 const handler=greenApiWebhookHandler({GREEN_API_WEBHOOK_SECRET:'webhook-secret'}, {
  createSupabaseClient(){databaseCreated=true;return {rpc:async()=>({error:null})};}
 });
 const res=response();
 await handler({method:'POST',headers:{authorization:'Bearer wrong-secret-1'},body:{}},res);
 assert.equal(res.statusCode,401);
 assert.equal(res.headers['www-authenticate'],'Bearer');
 assert.equal(databaseCreated,false);
});

test('Green API delivery statuses are forwarded to the protected RPC',async()=>{
 const calls=[];
 const env={
  GREEN_API_WEBHOOK_SECRET:'webhook-secret',
  VITE_SUPABASE_URL:'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'service-role'
 };
 const handler=greenApiWebhookHandler(env,{
  createSupabaseClient(url,key){
   assert.equal(url,env.VITE_SUPABASE_URL);
   assert.equal(key,env.SUPABASE_SERVICE_ROLE_KEY);
   return {rpc:async(name,payload)=>{calls.push({name,payload});return {error:null};}};
  }
 });
 const statuses=['sent','delivered','read','failed','noAccount','notInGroup','yellowCard','suspended'];
 for(const status of statuses){
  const res=response();
  await handler({
   method:'POST',
   headers:{authorization:'Bearer webhook-secret'},
   body:{typeWebhook:'outgoingMessageStatus',idMessage:'3EB0123456789ABC',status,timestamp:1789191000,description:'provider status',sendByApi:true}
  },res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.body,{ok:true});
 }
 assert.equal(calls.length,statuses.length);
 for(const [index,status] of statuses.entries()){
  const temporary=['yellowCard','suspended'].includes(status);
  assert.equal(calls[index].name,temporary?'work_notification_channel_update':'work_notification_delivery_update');
  if(temporary)assert.equal(calls[index].payload.p_state,status);
  else{
   assert.equal(calls[index].payload.p_provider_id,'3EB0123456789ABC');
   assert.equal(calls[index].payload.p_status,status);
  }
  assert.equal(calls[index].payload.p_description,'provider status');
  assert.equal(calls[index].payload.p_occurred_at,'2026-09-12T05:30:00.000Z');
 }
});

test('Green API webhook ignores delivery events that are not explicitly API sends',async()=>{
 const calls=[];
 const handler=greenApiWebhookHandler({
  GREEN_API_WEBHOOK_SECRET:'webhook-secret',
  VITE_SUPABASE_URL:'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'service-role'
 },{
  createSupabaseClient(){return {rpc:async(name,payload)=>{calls.push({name,payload});return {error:null};}};}
 });
 for(const sendByApi of [undefined,false]){
  const res=response();
  await handler({
   method:'POST',
   headers:{authorization:'Bearer webhook-secret'},
   body:{typeWebhook:'outgoingMessageStatus',idMessage:'3EB0123456789ABC',status:'delivered',sendByApi}
  },res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.body,{ok:true,ignored:true});
 }
 assert.deepEqual(calls,[]);
});

test('Green API instance state changes are forwarded to the channel RPC',async()=>{
 const calls=[];
 const handler=greenApiWebhookHandler({
  GREEN_API_WEBHOOK_SECRET:'webhook-secret',
  VITE_SUPABASE_URL:'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'service-role'
 },{
  createSupabaseClient(){return {rpc:async(name,payload)=>{calls.push({name,payload});return {error:null};}};}
 });
 const res=response();
 await handler({
  method:'POST',
  headers:{authorization:'Bearer webhook-secret'},
  body:{typeWebhook:'stateInstanceChanged',stateInstance:'suspended',timestamp:1789191000,description:'temporary restriction'}
 },res);
 assert.equal(res.statusCode,200);
 assert.deepEqual(calls,[{
  name:'work_notification_channel_update',
  payload:{p_state:'suspended',p_description:'temporary restriction',p_occurred_at:'2026-09-12T05:30:00.000Z'}
 }]);
});

test('Green API webhook rejects a different configured instance',async()=>{
 let databaseCreated=false;
 const handler=greenApiWebhookHandler({
  GREEN_API_WEBHOOK_SECRET:'webhook-secret',
  GREEN_API_INSTANCE_ID:'710700000001',
  VITE_SUPABASE_URL:'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'service-role'
 },{
  createSupabaseClient(){databaseCreated=true;return {rpc:async()=>({error:null})};}
 });
 const res=response();
 await handler({
  method:'POST',
  headers:{authorization:'Bearer webhook-secret'},
  body:{typeWebhook:'outgoingMessageStatus',instanceData:{idInstance:710700000002},idMessage:'3EB0123456789ABC',status:'delivered'}
 },res);
 assert.equal(res.statusCode,401);
 assert.equal(databaseCreated,false);
});
