// The detail RPC scopes these rows to one request and intentionally omits request_id
export function openRequestInterventions(escalations,requestId){
 return (Array.isArray(escalations)?escalations:[]).filter(row=>row.id&&row.status==='open'&&(!row.request_id||row.request_id===requestId));
}
