import {isDateOnly,riyadhDate} from '../shared/date-only.js';

const dayMs=86400000;
const stageByStatus={offered:'new',working:'active',waiting:'waiting',needs_info:'waiting',escalated:'waiting',revision:'waiting',review:'review',approved:'completed',internal_done:'completed',forwarded:'completed'};
const stageByBucket={new:'new',accepted:'active',overdue:'active',waiting:'waiting',review:'review',completed:'completed'};
const dayTime=date=>Date.parse(`${date}T00:00:00Z`);
const dayString=time=>new Date(time).toISOString().slice(0,10);

function monthStart(month){
 if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month)||!isDateOnly(`${month}-01`))throw new RangeError('invalid_calendar_month');
 return new Date(`${month}-01T00:00:00Z`);
}

export function calendarDays(month){
 const first=monthStart(month),start=first.getTime()-first.getUTCDay()*dayMs;
 return Array.from({length:42},(_,index)=>{
  const date=dayString(start+index*dayMs);
  return {date,inMonth:date.slice(0,7)===month};
 });
}

export function shiftMonth(month,delta){
 if(!Number.isSafeInteger(delta))throw new RangeError('invalid_month_offset');
 const date=monthStart(month);date.setUTCMonth(date.getUTCMonth()+delta);
 if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<1||date.getUTCFullYear()>9999)throw new RangeError('invalid_calendar_month');
 return date.toISOString().slice(0,7);
}

export function plannerStage(task){
 const stage=stageByStatus[task.status]||stageByBucket[task.bucket]||'waiting';
 return task.output_due_required&&stage==='active'?'waiting':stage;
}

export function workloadGroups(tasks){
 const groups=new Map();
 for(const task of tasks){
  const department=String(task.department||'').trim()||'قسم غير محدد';
  if(!groups.has(department))groups.set(department,{department,total:0,active:0,overdue:0,undated:0});
  const group=groups.get(department),unfinished=plannerStage(task)!=='completed';
  const overdue=typeof task.employee_overdue==='boolean'?task.employee_overdue:task.bucket==='overdue';
  group.total+=1;
  if(unfinished)group.active+=1;
  if(unfinished&&overdue)group.overdue+=1;
  if(!riyadhDate(task.due_at??null))group.undated+=1;
 }
 return [...groups.values()].sort((a,b)=>a.department.localeCompare(b.department,'ar'));
}

// Bounds are inclusive days A missing acceptance is a deadline point rather than invented work
export function timelineSpan(task,start,end){
 const due=riyadhDate(task.due_at??null),accepted=riyadhDate(task.accepted_at??null);
 if(!due||!isDateOnly(start)||!isDateOnly(end)||start>end)return null;
 const viewStart=dayTime(start),viewEnd=dayTime(end)+dayMs,total=viewEnd-viewStart;
 if(!accepted){
  if(due<start||due>end)return null;
  return {start:due,end:due,left:(dayTime(due)-viewStart)/total*100,width:0};
 }
 if(accepted>due||due<start||accepted>end)return null;
 const clippedStart=accepted<start?start:accepted,clippedEnd=due>end?end:due;
 return {start:clippedStart,end:clippedEnd,left:(dayTime(clippedStart)-viewStart)/total*100,width:(dayTime(clippedEnd)+dayMs-dayTime(clippedStart))/total*100};
}
