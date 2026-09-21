import {probeNotificationQueue} from '../_shared/notification-watchdog.js';
import {createClient} from 'npm:@supabase/supabase-js@2.109.0';
import {timingSafeEqual} from 'node:crypto';
import {outboundNotificationMessage,matchesNotificationDispatch,createNotificationContextLoader} from '../_shared/notification-message.js';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function phoneDigits(value:string){
 let phone=String(value||'').replace(/[\s()-]/g,'').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632));
 if(phone.startsWith('00'))phone='+'+phone.slice(2);
 if(/^05\d{8}$/.test(phone))phone='+966'+phone.slice(1);
 else if(/^5\d{8}$/.test(phone))phone='+966'+phone;
 else if(/^9665\d{8}$/.test(phone))phone='+'+phone;
 return /^\+[1-9]\d{7,14}$/.test(phone)?phone.slice(1):null;
}

async function providerInstanceState(apiUrl:string,instance:string,token:string){
 const response=await fetch(`${apiUrl}/waInstance${instance}/getStateInstance/${token}`,{method:'GET',signal:AbortSignal.timeout(8000)});
 if(!response.ok)return 'unavailable';
 const body=await response.json().catch(()=>({}));
 return typeof body.stateInstance==='string'?body.stateInstance:'unavailable';
}

async function providerInstanceStatus(apiUrl:string,instance:string,token:string){
 const state=await providerInstanceState(apiUrl,instance,token);
 if(state!=='suspended')return {state,retryAt:null as string|null};
 try{
  const response=await fetch(`${apiUrl}/waInstance${instance}/getWaSettings/${token}`,{method:'GET',signal:AbortSignal.timeout(8000)});
  if(!response.ok)return {state,retryAt:null as string|null};
  const body=await response.json().catch(()=>({}));
  const suspendedUntil=Number(body.suspendedUntil);
  const retryAt=Number.isFinite(suspendedUntil)&&suspendedUntil*1000>Date.now()
   ?new Date(suspendedUntil*1000+5000).toISOString():null;
  return {state,retryAt};
 }catch{return {state,retryAt:null as string|null};}
}

function providerUnavailable(state:string){
 return ['unavailable','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended'].includes(state);
}

const journalDeliveryStatuses=new Set(['pending','sent','yellowCard','delivered','read','failed','noAccount','notInGroup']);
async function reconcileUncertainDeliveries(apiUrl:string,instance:string,token:string,db:ReturnType<typeof createClient>){
 const claim=await db.rpc('work_notification_uncertain_claim');
 if(claim.error)throw claim.error;
 const items=Array.isArray(claim.data)?claim.data:[];
 if(!items.length)return 0;
 const response=await fetch(`${apiUrl}/waInstance${instance}/lastOutgoingMessages/${token}?minutes=1440`,{method:'GET',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`uncertain_journal_${response.status}`);
 const journal=await response.json().catch(()=>[]);
 if(!Array.isArray(journal))throw new TypeError('invalid_uncertain_journal');
 const available=journal.filter(entry=>entry?.sendByApi===true&&typeof entry.idMessage==='string'&&journalDeliveryStatuses.has(entry.statusMessage));
 const used=new Set<string>();
 const matches:Array<{id:string;dispatch_token:string;recovery_token:string;provider_id:string;status:string;occurred_at:string|null}>=[];
 const retries:Array<{id:string;dispatch_token:string;recovery_token:string}>=[];
 for(const item of items){
  const phone=phoneDigits(item.phone||'');
  const chatId=phone?`${phone}@c.us`:'';
  const dispatchAt=Date.parse(item.dispatch_started_at||'');
  const match=available.find(entry=>{
   const occurredAt=Number(entry.timestamp)*1000;
   return !used.has(entry.idMessage)&&entry.chatId===chatId&&matchesNotificationDispatch(entry.textMessage,item)
    &&Number.isFinite(occurredAt)&&(!Number.isFinite(dispatchAt)||occurredAt>=dispatchAt-120000);
  });
  if(!match){
   // Unmarked compact messages cannot be safely attributed by text alone
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
async function reconcileProviderJournal(apiUrl:string,instance:string,token:string,db:ReturnType<typeof createClient>){
 const claim=await db.rpc('work_notification_journal_claim');
 if(claim.error)throw claim.error;
 const providerIds=Array.isArray(claim.data)?claim.data.filter((value:unknown):value is string=>typeof value==='string'&&Boolean(value)):[];
 if(!providerIds.length)return 0;
 const response=await fetch(`${apiUrl}/waInstance${instance}/lastOutgoingMessages/${token}?minutes=1440`,{method:'GET',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`journal_${response.status}`);
 const journal=await response.json().catch(()=>[]);
 if(!Array.isArray(journal))throw new TypeError('invalid_journal');
 const candidates=new Set(providerIds),latest=new Map<string,{idMessage:string;statusMessage:string;timestamp?:number;description?:string}>();
 for(const entry of journal){
  const id=typeof entry?.idMessage==='string'?entry.idMessage.trim():'';
  if(!id||!candidates.has(id)||entry.sendByApi!==true||!journalDeliveryStatuses.has(entry.statusMessage))continue;
  if(!latest.has(id)||Number(entry.timestamp)>Number(latest.get(id)?.timestamp))latest.set(id,entry);
 }
 const receipts:Array<{provider_id:string;status:string;description:string;occurred_at:string|null}>=[];
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

Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'method'},405);
 const expected=Deno.env.get('WORK_DISPATCH_SECRET')?.trim();
 const supplied=(req.headers.get('authorization')||'').replace(/^Bearer /,'').trim();
 const bytes=new TextEncoder();
 if(!expected||bytes.encode(expected).length!==bytes.encode(supplied).length||!timingSafeEqual(bytes.encode(expected),bytes.encode(supplied)))return json({error:'unauthorized'},401);
 const apiUrl=Deno.env.get('GREEN_API_URL')||'',instance=Deno.env.get('GREEN_API_INSTANCE_ID'),token=Deno.env.get('GREEN_API_TOKEN');
 if(!/^https:\/\/[a-z0-9.-]+\.greenapi\.com$/.test(apiUrl)||!instance||!token)return json({error:'not_configured'},503);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const providerStatus=await providerInstanceStatus(apiUrl,instance,token).catch(()=>({state:'unavailable',retryAt:null as string|null}));
 const state=providerStatus.state;
 try{await probeNotificationQueue({GREEN_API_URL:apiUrl,GREEN_API_INSTANCE_ID:instance,GREEN_API_TOKEN:token},db,fetch,state);}
 catch{console.error('work_notification_watchdog_failed');}
 if(['authorized','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended'].includes(state)){
  const channel=await db.rpc('work_notification_channel_update',{p_state:state,p_description:providerStatus.retryAt?`suspended_until ${providerStatus.retryAt}`:null,p_occurred_at:new Date().toISOString()});
  if(channel.error)console.error('work_notification_channel_state_not_saved');
 }
 let reconciled=0;
 try{reconciled=await reconcileProviderJournal(apiUrl,instance,token,db);}
 catch{console.error('work_notification_journal_reconciliation_failed');}
 if(providerUnavailable(state)){
  const nextAttempt=providerStatus.retryAt||new Date(Date.now()+60000).toISOString();
  await db.from('work_notifications').update({whatsapp:'failed',last_error:`provider_${state}`,next_attempt:nextAttempt})
   .in('whatsapp',['pending','failed']).lt('attempts',5).or('whatsapp.eq.pending,last_error.like.provider_%');
 return json({error:'provider_unavailable',state,reconciled},503);
 }
 let uncertain=0;
 try{uncertain=await reconcileUncertainDeliveries(apiUrl,instance,token,db);}
 catch{console.error('work_notification_uncertain_reconciliation_failed');}
 const {data:items,error}=await db.rpc('work_notification_claim');
 if(error)return json({error:'queue_unavailable'},502);
 let accepted=0,saveErrors=0;
 const contextFor=createNotificationContextLoader(db);
 await Promise.all(items.map(async(item:{id:string,recipient:string,request_id:string|null,phone:string,message:string,attempts:number,claimed_at:string,dispatch_token:string})=>{
  const phone=phoneDigits(item.phone);
  let patch:{whatsapp:string,last_error:string|null,provider_id?:string,provider_checked_at?:string,next_attempt?:string,attempts?:number}={whatsapp:'failed',last_error:'invalid_phone'};
  let sendStarted=false;
  if(phone){
   try{
    const message=outboundNotificationMessage(await contextFor(item));
    sendStarted=true;
    const response=await fetch(`${apiUrl}/waInstance${instance}/sendMessage/${token}`,{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({chatId:`${phone}@c.us`,message}),
     signal:AbortSignal.timeout(12000)
    });
    const body=await response.json().catch(()=>({}));
    if(response.ok&&typeof body.idMessage==='string'&&body.idMessage.trim()){patch={whatsapp:'sent',provider_id:body.idMessage.trim(),provider_checked_at:new Date().toISOString(),last_error:'provider_accepted_waiting_delivery'};accepted++;}
    // Definite rejection can retry The outcome of timeout or 5xx may be uncertain
    else patch=response.status>=400&&response.status<500?{whatsapp:'failed',last_error:`provider_${response.status}`}:{whatsapp:'unknown',last_error:`provider_${response.status}`,attempts:5};
   }catch{patch=sendStarted?{whatsapp:'unknown',last_error:'delivery_unconfirmed',attempts:5}:{whatsapp:'failed',last_error:'notification_context_unavailable'};}
  }
  patch.next_attempt=new Date(Date.now()+Math.min(3600000,60000*2**item.attempts)).toISOString();
  // A retry can replace the lease Only settle the attempt we claimed
  let saved=false;
  for(let attempt=0;attempt<2&&!saved;attempt++){
   const outcome=await db.from('work_notifications').update(patch).eq('id',item.id).eq('whatsapp','sending').eq('attempts',item.attempts).eq('next_attempt',item.claimed_at).eq('dispatch_token',item.dispatch_token).select('id');
   saved=!outcome.error&&outcome.data?.length===1;
   if(!saved){
    const existing=await db.from('work_notifications').select('whatsapp,provider_id,last_error,next_attempt,dispatch_token').eq('id',item.id).maybeSingle();
    saved=!existing.error&&existing.data?.dispatch_token===item.dispatch_token&&existing.data?.whatsapp===patch.whatsapp
     &&existing.data?.provider_id===(patch.provider_id||null)
     &&existing.data?.last_error===patch.last_error
     &&Date.parse(existing.data.next_attempt)===Date.parse(patch.next_attempt!);
   }
  }
  if(!saved){saveErrors++;console.error('work_notification_outcome_not_saved',item.id);}
 }));
 return json({processed:items.length,accepted,reconciled,uncertain,saveErrors},saveErrors?502:200);
});
