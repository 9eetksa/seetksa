import {createClient} from '@supabase/supabase-js';
import WebSocket from 'ws';
import {timingSafeEqual} from 'node:crypto';

export const config={api:{bodyParser:{sizeLimit:'64kb'}}};
const temporaryFailureStatuses=new Set(['yellowCard','suspended']);
const deliveryStatuses=new Set(['sent','delivered','read','failed','noAccount','notInGroup',...temporaryFailureStatuses]);
const instanceStates=new Set(['authorized','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended']);

function bearerToken(value){
 const match=String(value||'').match(/^Bearer ([^\s]+)$/);
 return match?match[1].trim():'';
}

export function webhookAuthorized(expectedValue,authorization){
 const expected=String(expectedValue||'').trim();
 const supplied=bearerToken(authorization);
 if(!expected||!supplied||Buffer.byteLength(expected)!==Buffer.byteLength(supplied))return false;
 return timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
}

function webhookBody(value){
 if(Buffer.isBuffer(value))value=value.toString('utf8');
 if(typeof value==='string')return JSON.parse(value);
 if(value&&typeof value==='object'&&!Array.isArray(value))return value;
 throw new TypeError('invalid_body');
}

function occurredAt(value){
 const seconds=Number(value);
 if(!Number.isFinite(seconds)||seconds<=0)return null;
 const date=new Date(seconds*1000);
 return Number.isNaN(date.getTime())?null:date.toISOString();
}

export function greenApiWebhookHandler(env,{createSupabaseClient=(url,key)=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:WebSocket}})}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){
   res.setHeader('Allow','POST');
   return res.status(405).json({error:'method'});
  }
  if(!env.GREEN_API_WEBHOOK_SECRET)return res.status(503).json({error:'not_configured'});
  if(!webhookAuthorized(env.GREEN_API_WEBHOOK_SECRET,req.headers.authorization)){
   res.setHeader('WWW-Authenticate','Bearer');
   return res.status(401).json({error:'unauthorized'});
  }
  let payload;
  try{payload=webhookBody(req.body);}
  catch{return res.status(400).json({error:'invalid_body'});}
  if(!['outgoingMessageStatus','stateInstanceChanged'].includes(payload.typeWebhook))return res.status(200).json({ok:true,ignored:true});
  const incomingInstance=payload.instanceData?.idInstance;
  if(env.GREEN_API_INSTANCE_ID&&String(incomingInstance||'')!==String(env.GREEN_API_INSTANCE_ID))return res.status(401).json({error:'instance'});
  if(!env.VITE_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return res.status(503).json({error:'database_not_configured'});
  const db=createSupabaseClient(env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
  const description=typeof payload.description==='string'?payload.description.slice(0,1000):null;
  let outcome;
  if(payload.typeWebhook==='stateInstanceChanged'){
   const state=typeof payload.stateInstance==='string'?payload.stateInstance:'';
   if(!instanceStates.has(state))return res.status(200).json({ok:true,ignored:true});
   outcome=await db.rpc('work_notification_channel_update',{
    p_state:state,
    p_description:description,
    p_occurred_at:occurredAt(payload.timestamp)
   });
  }else{
   if(payload.sendByApi!==true)return res.status(200).json({ok:true,ignored:true});
   const status=typeof payload.status==='string'?payload.status:'';
   const providerId=typeof payload.idMessage==='string'?payload.idMessage.trim():'';
   if(!deliveryStatuses.has(status)||providerId.length<8||providerId.length>200)return res.status(200).json({ok:true,ignored:true});
   if(temporaryFailureStatuses.has(status)){
    outcome=await db.rpc('work_notification_channel_update',{
     p_state:status,
     p_description:description,
     p_occurred_at:occurredAt(payload.timestamp)
    });
   }else{
    outcome=await db.rpc('work_notification_delivery_update',{
     p_provider_id:providerId,
     p_status:status,
     p_description:description,
     p_occurred_at:occurredAt(payload.timestamp)
    });
   }
  }
  const {error}=outcome;
  if(error)return res.status(502).json({error:'delivery_update_failed'});
  return res.status(200).json({ok:true});
 };
}

export default greenApiWebhookHandler(process.env);
