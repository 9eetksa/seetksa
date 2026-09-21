import {coordinatorTasksFor,coordinatorTaskLabels} from './coordinator-tasks.js';

export const COMPLETED_PAGE_SIZE=10;

// Keep the server's authorized scope and fetch beyond its 40-request pages
// before filtering completed tasks or calculating the visible pages
export async function collectTaskPages(first,loadPage){
 const fields={requests:'id',parts:'id',coordinator_tasks:'task_key',escalations:'id'};
 const merged=Object.fromEntries(Object.entries(fields).map(([field,key])=>[field,new Map((first[field]||[]).map(item=>[item[key],item]))]));
 let batch=first,page=1;
 while((batch.requests||[]).length===40){
  batch=await loadPage(page++);
  const previous=merged.requests.size;
  for(const [field,key] of Object.entries(fields))for(const item of batch[field]||[])merged[field].set(item[key],item);
  if(batch.requests?.length===40&&merged.requests.size===previous)throw new Error('تعذر استكمال صفحات المهام أعد المحاولة');
 }
 return {...first,...Object.fromEntries(Object.entries(merged).map(([field,items])=>[field,[...items.values()]]))};
}

export function completedTaskRows(source,requests,userId,includeCoordination){
 return requests.flatMap(request=>[
  ...(source.parts||[]).filter(part=>part.request_id===request.id&&part.assignee_id===userId&&part.status==='approved').map(part=>({...request,rowKey:`part:${part.id}`,taskLabel:`تسليم ${source.services?.find(service=>service.id===part.service_id)?.name||'القسم'}`})),
  ...(includeCoordination?coordinatorTasksFor(source,request.id,userId).filter(task=>task.status==='completed').map(task=>({...request,rowKey:`coordination:${task.task_key}`,taskLabel:coordinatorTaskLabels[task.kind]||'مهمة التواصل'})):[])
 ]);
}

export function completedTaskPage(rows,priority,page){
 const filtered=rows.filter(row=>priority==='all'||(row.priority==='urgent'?'urgent':'normal')===priority);
 const pages=Math.max(1,Math.ceil(filtered.length/COMPLETED_PAGE_SIZE));
 const current=Math.min(Math.max(0,page),pages-1);
 return {rows:filtered.slice(current*COMPLETED_PAGE_SIZE,(current+1)*COMPLETED_PAGE_SIZE),total:filtered.length,page:current,pages,hasNext:current+1<pages};
}
