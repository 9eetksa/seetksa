const text=value=>typeof value==='string'?value.trim():'';

// Audit rows omit part_id so join only by the exact event identity
// Parts must be the caller's authorized task panels and routes supply names only
export function requestHistoryContext(row,{events=[],parts=[],routes=[],services=[]}={}){
 const event=events.find(event=>String(event.id)===String(row.id));
 const partId=row.part_id||event?.part_id;
 const part=partId?parts.find(part=>part.id===partId):null;
 const route=partId?routes.find(route=>route.id===partId):null;
 const serviceId=part?.service_id||route?.service_id;
 return {
  department:text(route?.service)||text(services.find(service=>service.id===serviceId)?.name),
  scope:text(part?.scope),
  hasPart:Boolean(partId),
 };
}
