import test from 'node:test';
import assert from 'node:assert/strict';
import {probeNotificationQueue} from '../supabase/functions/_shared/notification-watchdog.js';
const env={GREEN_API_URL:'https://example.greenapi.com',GREEN_API_INSTANCE_ID:'123',GREEN_API_TOKEN:'test'};
test('queue monitor records identities without message bodies and never sends or clears',async()=>{
 const calls=[],db={rpc:async(name,p)=>{calls.push({name,p});return {data:name.endsWith('claim')?'lease':null};}};
 const result=await probeNotificationQueue(env,db,async(url,options)=>{
  assert(url.includes('/showMessagesQueue/'));assert.equal(options.method,'GET');
  return {ok:true,json:async()=>[{messageID:'message-one',body:{chatId:'private',message:'private body'}},{messagesIDs:['message-two','message-one']}]};
 },'authorized');
 assert.deepEqual(result,{queued:2,error:null});
 assert.deepEqual(calls.at(-1).p,{p_token:'lease',p_queue_ids:['message-one','message-two'],p_error:null});
 assert(!JSON.stringify(calls).includes('private'));
});
test('provider failures are reported as unknown queue health rather than an empty queue',async()=>{
 for(const response of [{ok:false},{ok:true,json:async()=>({wrong:true})},{ok:true,json:async()=>[{body:{}}]}]){
  const calls=[],db={rpc:async(name,p)=>{calls.push(p);return {data:name.endsWith('claim')?'lease':null};}};
  const result=await probeNotificationQueue(env,db,async()=>response,'unavailable');
  assert.equal(result.error,'provider_queue_unavailable');assert.equal(calls.at(-1).p_error,'provider_queue_unavailable');
 }
});
test('only the probe lease holder contacts the provider and database failures surface',async()=>{
 const never=async()=>assert.fail('provider must not be called');
 assert.deepEqual(await probeNotificationQueue(env,{rpc:async()=>({data:null})},never),{skipped:true});
 await assert.rejects(()=>probeNotificationQueue(env,{rpc:async()=>({error:{}})},never),/watchdog_claim_failed/);
});
