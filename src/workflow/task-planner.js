import {endOfRiyadhDay,riyadhDate} from '../shared/date-only.js';

export const plannerBuckets=[
 {id:'new',label:'بانتظار استلامي',tone:'new'},
 {id:'accepted',label:'قيد التنفيذ',tone:'accepted'},
 {id:'overdue',label:'متأخرة',tone:'overdue'},
 {id:'waiting',label:'بانتظار إجراء',tone:'waiting'},
 {id:'review',label:'تحت المراجعة',tone:'review'},
 {id:'completed',label:'مكتملة',tone:'completed'},
];
export function plannerLastDate(now=Date.now()){
 const end=new Date(now);end.setUTCFullYear(end.getUTCFullYear()+2);end.setUTCDate(end.getUTCDate()-1);
 return riyadhDate(end);
}
export function scheduleChange(task,date,now=Date.now()){
 let due;
 try{due=endOfRiyadhDay(date);}catch{return {error:'اختر موعد التسليم الجديد'};}
 if(Date.parse(due)<=now)return {error:'اختر اليوم أو يوما لاحقا'};
 if(date>plannerLastDate(now))return {error:'اختر موعدا ضمن السنتين القادمتين'};
 if(riyadhDate(task.due_at)===date)return {error:'اختر موعدا يختلف عن الموعد الحالي'};
 const later=Date.parse(due)>Date.parse(task.due_at);
 if(!later&&task.due_locked_by_admin)return {error:'الموعد محدد من الإدارة تواصل معها لتقديمه'};
 return {due,later};
}
export function scheduleGroups(rows){
 const groups=new Map();
 for(const row of rows){
  const key=riyadhDate(row.due_at)||'undated';
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 return [...groups].sort(([a],[b])=>a.localeCompare(b));
}

export async function collectPlannerTasks(loadPage,isCurrent=()=>true){
 const first=await loadPage(0),tasks=new Map();
 let batch=first,page=0;
 while(isCurrent()){
  const before=tasks.size;
  for(const task of batch.items||[])tasks.set(task.part_id,task);
  if(!batch.has_next){
   if(tasks.size!==first.total||batch.total!==first.total)throw new Error('planner_snapshot_changed');
   return {items:[...tasks.values()],counts:batch.counts||first.counts};
  }
  if(tasks.size===before)throw new Error('planner_snapshot_changed');
  batch=await loadPage(++page);
 }
 return null;
}

export function plannerMoveAction(task,target){
 if(task.client_review_pending||task.output_cancelled)return null;
 if(target==='active'&&(task.status==='offered'||task.status==='waiting'&&!task.accepted_at))return 'accept';
 if(task.status==='working'&&!task.output_due_required){
  if(target==='review'&&!task.output_parent_id)return 'deliver';
  if(target==='completed'&&task.output_parent_id)return 'deliver_outputs';
 }
 if(target==='waiting'&&['offered','working'].includes(task.status)&&(!task.output_parent_id||task.accepted_at))return 'missing';
 return null;
}
