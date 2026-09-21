import {coordinatorTasksFor} from './coordinator-tasks.js';

// Presentation scope only — database authorization remains authoritative
export function partsForView(source,requestId,view,userId){
 const parts=(source.parts||[]).filter(part=>part.request_id===requestId);
 if(view==='mine')return parts.filter(part=>part.assignee_id===userId);
 if(view==='department')return parts.filter(part=>(source.lead_services||[]).includes(part.service_id));
 return parts;
}

export function requestsForView(source,userId,view,manager=false){
 const requests=source.requests||[];
 if(view!=='mine'&&view!=='department'&&(manager||source.coordinator))return requests;
 const scope=view==='department'?'department':'mine';
 return requests.filter(request=>partsForView(source,request.id,scope,userId).length>0
  ||scope==='mine'&&coordinatorTasksFor(source,request.id,userId).length>0);
}

export function departmentProgress(routes,parts,services,userId,leadServices=[]){
 const rows=new Map();
 for(const route of routes)rows.set(route.id,route);
 for(const part of parts)rows.set(part.id,{...rows.get(part.id),...part});
 return [...rows.values()].map((part,index)=>({
  id:part.id,service_id:part.service_id,
  name:services.find(service=>service.id===part.service_id)?.name||part.service||'القسم',
  status:part.status,
  own:part.assignee_id===userId,
  department:leadServices.includes(part.service_id)||parts.some(own=>own.assignee_id===userId&&own.service_id===part.service_id),
  position:part.route_position??index,
 })).sort((a,b)=>a.position-b.position);
}

export function teamFollowupRows(source,requests){
 if(!source.coordinator)return [];
 return requests.filter(request=>request.status==='active').map(request=>({...request,
  departmentStatuses:departmentProgress([],(source.parts||[]).filter(part=>part.request_id===request.id),source.services||[],'').map(({id,name,status})=>({id,name,status})),
 }));
}
