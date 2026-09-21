import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
import {probeNotificationQueue} from '../supabase/functions/_shared/notification-watchdog.js';
import {timingSafeEqual} from 'node:crypto';
import {normalizePhone} from '../src/auth/account-rules.js';
import {outboundNotificationMessage,matchesNotificationDispatch,createNotificationContextLoader} from '../supabase/functions/_shared/notification-message.js';
export {outboundNotificationMessage};
export const config={maxDuration:60};
export async function providerInstanceState(env,transport=fetch){
 const response=await transport(`${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/getStateInstance/${env.GREEN_API_TOKEN}`,{method:'GET',signal:AbortSignal.timeout(8000)});
 if(!response.ok)return 'unavailable';
 const body=await response.json().catch(()=>({}));
 return typeof body.stateInstance==='string'?body.stateInstance:'unavailable';
}
export async function providerInstanceStatus(env,transport=fetch,now=Date.now()){
 const state=await providerInstanceState(env,transport);
 if(state!=='suspended')return {state,retryAt:null};
 try{
  const response=await transport(`${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/getWaSettings/${env.GREEN_API_TOKEN}`,{method:'GET',signal:AbortSignal.timeout(8000)});
  if(!response.ok)return {state,retryAt:null};
  const body=await response.json().catch(()=>({}));
  const suspendedUntil=Number(body.suspendedUntil);
  const retryAt=Number.isFinite(suspendedUntil)&&suspendedUntil*1000>now
   ?new Date(suspendedUntil*1000+5000).toISOString():null;
  return {state,retryAt};
 }catch{return {state,retryAt:null};}
}
export function providerUnavailable(state){
 return ['unavailable','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended'].includes(state);
}
const journalDeliveryStatuses=new Set(['pending','sent','yellowCard','delivered','read','failed','noAccount','notInGroup']);
export async function reconcileUncertainDeliveries(env,db,transport=fetch){
 const claim=await db.rpc('work_notification_uncertain_claim');
 if(claim.error)throw claim.error;
 const items=Array.isArray(claim.data)?claim.data:[];
 if(!items.length)return 0;
 const response=await transport(`${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/lastOutgoingMessages/${env.GREEN_API_TOKEN}?minutes=1440`,{method:'GET',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`uncertain_journal_${response.status}`);
 const journal=await response.json().catch(()=>[]);
 if(!Array.isArray(journal))throw new TypeError('invalid_uncertain_journal');
 const available=journal.filter(entry=>entry?.sendByApi===true&&typeof entry.idMessage==='string'&&journalDeliveryStatuses.has(entry.statusMessage));
 const used=new Set(),matches=[],retries=[];
 for(const item of items){
  const phone=normalizePhone(item.phone||'');
  const chatId=phone?`${phone.replace(/^\+/,'')}@c.us`:'';
  const dispatchAt=Date.parse(item.dispatch_started_at||'');
  const match=available.find(entry=>{
   const occurredAt=Number(entry.timestamp)*1000;
   return !used.has(entry.idMessage)&&entry.chatId===chatId&&matchesNotificationDispatch(entry.textMessage,item)
    &&Number.isFinite(occurredAt)&&(!Number.isFinite(dispatchAt)||occurredAt>=dispatchAt-120000);
  });
  if(!match){
   // Compact messages for every role have no attempt marker Text alone cannot
   // establish identity Any possible send in this window prevents a blind retry
   const possibleSend=available.some(entry=>entry.chatId===chatId
    &&(!Number.isFinite(dispatchAt)||Number(entry.timestamp)*1000>=dispatchAt-120000));
   if(!possibleSend)retries.push({id:item.id,dispatch_token:item.dispatch_token,recovery_token:item.recovery_token});
   continue;
  }
  used.add(match.idMessage);
  const timestamp=Number(match.timestamp);
  matches.push({id:item.id,dispatch_token:item.dispatch_token,recovery_token:item.recovery_token,
   provider_id:match.idMessage,status:match.statusMessage,
   occurred_at:Number.isFinite(timestamp)&&timestamp>0?new Date(timestamp*1000).toISOString():null});
 }
 const finish=await db.rpc('work_notification_uncertain_finish',{p_matches:matches,p_retries:retries});
 if(finish.error)throw finish.error;
 const settled=Number(finish.data?.matched);
 return Number.isFinite(settled)?settled:matches.length;
}
export async function reconcileProviderJournal(env,db,transport=fetch){
 const claim=await db.rpc('work_notification_journal_claim');
 if(claim.error)throw claim.error;
 const providerIds=Array.isArray(claim.data)?claim.data.filter(value=>typeof value==='string'&&value):[];
 if(!providerIds.length)return 0;
 const response=await transport(`${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/lastOutgoingMessages/${env.GREEN_API_TOKEN}?minutes=1440`,{method:'GET',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`journal_${response.status}`);
 const journal=await response.json().catch(()=>[]);
 if(!Array.isArray(journal))throw new TypeError('invalid_journal');
 const candidates=new Set(providerIds),latest=new Map();
 for(const entry of journal){
  const id=typeof entry?.idMessage==='string'?entry.idMessage.trim():'';
  if(!id||!candidates.has(id)||entry.sendByApi!==true||!journalDeliveryStatuses.has(entry.statusMessage))continue;
  if(!latest.has(id)||Number(entry.timestamp)>Number(latest.get(id).timestamp))latest.set(id,entry);
 }
 const receipts=[];
 for(const [providerId,entry] of latest){
  const timestamp=Number(entry.timestamp);
  const date=Number.isFinite(timestamp)&&timestamp>0?new Date(timestamp*1000):null;
  receipts.push({
   provider_id:providerId,
   status:entry.statusMessage,
   description:typeof entry.description==='string'?entry.description.slice(0,1000):'journal_reconciliation',
   occurred_at:date&&!Number.isNaN(date.getTime())?date.toISOString():null
  });
 }
 if(receipts.length){
  const outcome=await db.rpc('work_notification_delivery_batch',{p_receipts:receipts});
  if(outcome.error)throw outcome.error;
 }
 const finish=await db.rpc('work_notification_journal_finish',{p_provider_ids:providerIds});
 if(finish.error)throw finish.error;
 return receipts.length;
}
export function workNotificationHandler(env,transport=fetch){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const expected=env.WORK_DISPATCH_SECRET?.trim();
  const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'').trim();
  if(req.method!=='POST')return res.status(405).json({error:'method'});
  if(!expected||Buffer.byteLength(expected)!==Buffer.byteLength(supplied)||!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))return res.status(401).json({error:'unauthorized'});
  if(!/^https:\/\/[a-z0-9.-]+\.greenapi\.com$/.test(env.GREEN_API_URL||'')||!env.GREEN_API_TOKEN||!env.GREEN_API_INSTANCE_ID)return res.status(503).json({error:'not_configured'});
  const db=createClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket}});
  const providerStatus=await providerInstanceStatus(env,transport).catch(()=>({state:'unavailable',retryAt:null}));
  const providerState=providerStatus.state;
  try{await probeNotificationQueue(env,db,transport,providerState);}
  catch{console.error('work_notification_watchdog_failed');}
  if(['authorized','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended'].includes(providerState)){
   const channel=await db.rpc('work_notification_channel_update',{p_state:providerState,p_description:providerStatus.retryAt?`suspended_until ${providerStatus.retryAt}`:null,p_occurred_at:new Date().toISOString()});
   if(channel.error)console.error('work_notification_channel_state_not_saved');
  }
  let reconciled=0;
  try{reconciled=await reconcileProviderJournal(env,db,transport);}
  catch{console.error('work_notification_journal_reconciliation_failed');}
  if(providerUnavailable(providerState)){
   const nextAttempt=providerStatus.retryAt||new Date(Date.now()+60000).toISOString();
   await db.from('work_notifications').update({whatsapp:'failed',last_error:`provider_${providerState}`,next_attempt:nextAttempt})
    .in('whatsapp',['pending','failed']).lt('attempts',5).or('whatsapp.eq.pending,last_error.like.provider_%');
   return res.status(503).json({error:'provider_unavailable',state:providerState,reconciled});
  }
  let uncertain=0;
  try{uncertain=await reconcileUncertainDeliveries(env,db,transport);}
  catch{console.error('work_notification_uncertain_reconciliation_failed');}
  const {data:items,error}=await db.rpc('work_notification_claim');
  if(error)return res.status(502).json({error:'queue_unavailable'});
  let accepted=0,saveErrors=0;
  const contextFor=createNotificationContextLoader(db);
  await Promise.all(items.map(async item=>{
   const phone=normalizePhone(item.phone||'');
   let patch={whatsapp:'failed',last_error:'invalid_phone'};
   let sendStarted=false;
   if(phone)try{
    const message=outboundNotificationMessage(await contextFor(item));
    sendStarted=true;
    const response=await transport(`${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/sendMessage/${env.GREEN_API_TOKEN}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chatId:`${phone.replace(/^\+/,'')}@c.us`,message}),signal:AbortSignal.timeout(12000)});
    const body=await response.json().catch(()=>({}));
    if(response.ok&&typeof body.idMessage==='string'&&body.idMessage.trim()){patch={whatsapp:'sent',provider_id:body.idMessage.trim(),provider_checked_at:new Date().toISOString(),last_error:'provider_accepted_waiting_delivery'};accepted++;}
    else patch=response.status>=400&&response.status<500?{whatsapp:'failed',last_error:`provider_${response.status}`}:{whatsapp:'unknown',last_error:`provider_${response.status}`,attempts:5};
   }catch{patch=sendStarted?{whatsapp:'unknown',last_error:'delivery_unconfirmed',attempts:5}:{whatsapp:'failed',last_error:'notification_context_unavailable'};}
   patch.next_attempt=new Date(Date.now()+Math.min(3600000,60000*2**item.attempts)).toISOString();
   let saved=false;
   for(let attempt=0;attempt<2&&!saved;attempt++){
    const outcome=await db.from('work_notifications').update(patch).eq('id',item.id).eq('whatsapp','sending').eq('attempts',item.attempts).eq('next_attempt',item.claimed_at).eq('dispatch_token',item.dispatch_token).select('id');
    saved=!outcome.error&&outcome.data?.length===1;
    if(!saved){
     const existing=await db.from('work_notifications').select('whatsapp,provider_id,last_error,next_attempt,dispatch_token').eq('id',item.id).maybeSingle();
     saved=!existing.error&&existing.data?.dispatch_token===item.dispatch_token&&existing.data?.whatsapp===patch.whatsapp&&existing.data?.provider_id===(patch.provider_id||null)&&existing.data?.last_error===patch.last_error&&Date.parse(existing.data.next_attempt)===Date.parse(patch.next_attempt);
    }
   }
   if(!saved){saveErrors++;console.error('work_notification_outcome_not_saved',item.id);}
  }));
  return res.status(saveErrors?502:200).json({processed:items.length,accepted,reconciled,uncertain,saveErrors});
 };
}
export default workNotificationHandler(process.env);
