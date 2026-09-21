// Inspect the provider queue without sending clearing or retrying a message
// Persist only message identities and counts Never persist the returned bodies
export async function probeNotificationQueue(env,db,transport=fetch,state='unavailable'){
 const claim=await db.rpc('work_notification_probe_claim',{p_state:state});
 if(claim.error)throw new Error('watchdog_claim_failed');
 if(!claim.data)return {skipped:true};
 let ids=[],error=null;
 try{
  const response=await transport(`${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/showMessagesQueue/${env.GREEN_API_TOKEN}`,{method:'GET',signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw new Error('provider_queue_unavailable');
  const queue=await response.json();
  if(!Array.isArray(queue)||queue.length>500)throw new Error('provider_queue_invalid');
  for(const item of queue){
   const values=item.messageID?[item.messageID]:Array.isArray(item.messagesIDs)?item.messagesIDs:[];
   if(!values.length||values.some(value=>typeof value!=='string'||value.length<1||value.length>200))throw new Error('provider_queue_invalid');
   ids.push(...values);
  }
  ids=[...new Set(ids)].slice(0,500);
 }catch{error='provider_queue_unavailable';ids=[];}
 const saved=await db.rpc('work_notification_probe_finish',{p_token:claim.data,p_queue_ids:ids,p_error:error});
 if(saved.error)throw new Error('watchdog_save_failed');
 return {queued:ids.length,error};
}
