import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
 outboundNotificationMessage,providerInstanceState,providerInstanceStatus,
 reconcileProviderJournal,reconcileUncertainDeliveries
} from '../api/work-notifications.js';

test('WhatsApp worker verifies that the provider instance is authorized', async () => {
  const calls = [];
  const state = await providerInstanceState({
    GREEN_API_URL: 'https://example.greenapi.com',
    GREEN_API_INSTANCE_ID: '1234',
    GREEN_API_TOKEN: 'token',
  }, async url => {
    calls.push(url);
    return { ok: true, json: async () => ({ stateInstance: 'notAuthorized' }) };
  });

  assert.equal(state, 'notAuthorized');
  assert.match(calls[0], /getStateInstance/);
});

test('a suspended provider defers every retry until its declared recovery time',async()=>{
 const calls=[];
 const status=await providerInstanceStatus({
  GREEN_API_URL:'https://example.greenapi.com',
  GREEN_API_INSTANCE_ID:'1234',
  GREEN_API_TOKEN:'token'
 },async url=>{
  calls.push(url);
  return {ok:true,json:async()=>url.includes('getStateInstance')
   ?{stateInstance:'suspended'}:{suspendedUntil:1789213786}};
 },1789210000000);
 assert.deepEqual(status,{state:'suspended',retryAt:'2026-09-12T11:49:51.000Z'});
 assert.match(calls[1],/getWaSettings/);
 const worker=readFileSync(new URL('../api/work-notifications.js',import.meta.url),'utf8');
 assert.match(worker,/\.in\('whatsapp',\['pending','failed'\]\)/);
 assert.match(worker,/last_error.*provider_/s);
});

test('submitted requests are critical and uncertain sends reconcile before retry', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20260912070141_notification_delivery_recovery.sql', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../api/work-notifications.js', import.meta.url), 'utf8');
  assert.match(migration, /control:request:/);
  assert.match(migration, /new\.kind in\('create','submit_request'/);
  assert.match(migration, /recipient_in_app_only/);
  assert.match(migration, /worker_interrupted',attempts=greatest\(attempts,5\)/);
  assert.match(migration, /notification\.whatsapp in\('pending','failed'\) and notification\.attempts<5/);
  assert.match(migration, /where whatsapp='unknown' and attempts<5/);
  assert.match(worker, /delivery_unconfirmed',attempts:5/);
  const contract = readFileSync(new URL('../supabase/migrations/20260912140000_workflow_notification_contract.sql', import.meta.url), 'utf8');
  assert.match(contract,/work_notification_uncertain_claim/);
  assert.match(contract,/work_notification_uncertain_finish/);
  assert.match(contract,/provider_journal_not_found/);
  assert.match(contract,/when 'pending' then 'sent'/);
  assert.match(contract,/when 'yellowcard' then 'sent'/);
  assert.match(worker,/reconcileUncertainDeliveries/);
  assert.match(worker,/\.eq\('dispatch_token',item\.dispatch_token\)/);
});

test('uncertain sends bind the exact journal message reference before retrying',async()=>{
 const item={
  id:'56ee70df-6a97-48a6-8116-5336b8700d5a',message:'تحديث الطلب',phone:'+966500000001',
  dispatch_token:'84d9fb0d-917b-43d9-a842-fc80d71f52d0',
  recovery_token:'3121f72a-f96a-473d-a533-081233d38cd1',
  dispatch_started_at:'2026-09-12T05:29:00.000Z'
 };
 const calls=[];
 const db={rpc:async(name,payload)=>{
  calls.push({name,payload});
  if(name==='work_notification_uncertain_claim')return {data:[item],error:null};
  return {data:{matched:1,retried:0},error:null};
 }};
 const matched=await reconcileUncertainDeliveries({
  GREEN_API_URL:'https://example.greenapi.com',GREEN_API_INSTANCE_ID:'1234',GREEN_API_TOKEN:'token'
 },db,async()=>({ok:true,json:async()=>[{
  idMessage:'3EB0000000000099',statusMessage:'delivered',timestamp:1789191000,
  sendByApi:true,chatId:'966500000001@c.us',textMessage:`صيت\n${item.message}\nمرجع الإشعار ${item.id} ${item.dispatch_token}\n/login`
 }]}));
 assert.equal(matched,1);
 assert.deepEqual(calls.map(call=>call.name),['work_notification_uncertain_claim','work_notification_uncertain_finish']);
 assert.equal(calls[1].payload.p_matches[0].id,item.id);
 assert.equal(calls[1].payload.p_matches[0].dispatch_token,item.dispatch_token);
 assert.equal(calls[1].payload.p_matches[0].recovery_token,item.recovery_token);
 assert.equal(calls[1].payload.p_matches[0].provider_id,'3EB0000000000099');
 assert.deepEqual(calls[1].payload.p_retries,[]);
});

test('uncertain retries preserve dispatch and recovery fencing identities',async()=>{
 const item={
  id:'56ee70df-6a97-48a6-8116-5336b8700d5b',message:'تحديث آخر',phone:'+966500000002',
  dispatch_token:'7c3379d7-bbd9-4e91-b5b3-bf499930667f',
  recovery_token:'9238d776-5839-4ed7-b3a9-9b0544f17f90',
  dispatch_started_at:'2026-09-12T05:29:00.000Z'
 };
 const calls=[];
 const db={rpc:async(name,payload)=>{
  calls.push({name,payload});
  if(name==='work_notification_uncertain_claim')return {data:[item],error:null};
  return {data:{matched:0,retried:1},error:null};
 }};
 await reconcileUncertainDeliveries({
  GREEN_API_URL:'https://example.greenapi.com',GREEN_API_INSTANCE_ID:'1234',GREEN_API_TOKEN:'token'
 },db,async()=>({ok:true,json:async()=>[]}));
 assert.deepEqual(calls[1].payload.p_retries,[{
  id:item.id,dispatch_token:item.dispatch_token,recovery_token:item.recovery_token
 }]);
});

test('journal fallback reconciles only matched API messages and always finishes the claimed batch',async()=>{
 const calls=[];
 const providerIds=['3EB0000000000001','3EB0000000000002','3EB0000000000003'];
 const db={rpc:async(name,payload)=>{
  calls.push({name,payload});
  if(name==='work_notification_journal_claim')return {data:providerIds,error:null};
  return {data:{processed:true},error:null};
 }};
 const reconciled=await reconcileProviderJournal({
  GREEN_API_URL:'https://example.greenapi.com',GREEN_API_INSTANCE_ID:'1234',GREEN_API_TOKEN:'token'
 },db,async()=>({ok:true,json:async()=>[
  {idMessage:providerIds[0],statusMessage:'delivered',timestamp:1789191000,sendByApi:true},
  {idMessage:providerIds[1],statusMessage:'suspended',timestamp:1789191001,sendByApi:true},
  {idMessage:providerIds[2],statusMessage:'read',timestamp:1789191002,sendByApi:false},
  {idMessage:'3EB0000000000999',statusMessage:'read',timestamp:1789191003,sendByApi:true}
 ]}));
 assert.equal(reconciled,1);
 assert.deepEqual(calls.map(call=>call.name),[
  'work_notification_journal_claim','work_notification_delivery_batch','work_notification_journal_finish'
 ]);
 assert.deepEqual(calls[1].payload.p_receipts,[{
  provider_id:providerIds[0],status:'delivered',description:'journal_reconciliation',occurred_at:'2026-09-12T05:30:00.000Z'
 }]);
 assert.deepEqual(calls[2].payload.p_provider_ids,providerIds);
});

test('journal fallback is leased bounded indexed and scheduled below the provider request ceiling',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20260912130000_notification_journal_batch_gate.sql',import.meta.url),'utf8');
 const edge=readFileSync(new URL('../supabase/functions/work-notifications/index.ts',import.meta.url),'utf8');
 assert.match(migration,/journal_lease_until=now\(\)\+interval '2 minutes'/);
 assert.match(migration,/journal_checked_at=now\(\)/);
 assert.match(migration,/channel\.journal_checked_at is null or channel\.journal_checked_at<=now\(\)-interval '45 minutes'/);
 assert.match(migration,/coalesce\(notification\.provider_checked_at,notification\.created_at\)<=now\(\)-interval '45 minutes'/);
 assert.match(migration,/limit 500/);
 assert.match(migration,/work_notification_delivery_batch/);
 assert.match(migration,/and exists\(select 1 from public\.work_notifications notification[\s\S]*where notification\.whatsapp='sent'/);
 assert.match(edge,/lastOutgoingMessages\/\$\{token\}\?minutes=1440/);
 assert.match(edge,/entry\.sendByApi!==true/);
 assert.match(edge,/work_notification_delivery_batch/);
});
