export const missionStates={draft:'مسودة',published:'منشورة',completed:'مكتملة',invited:'بانتظار الاستلام',working:'قيد التنفيذ',unable_pending:'طلب تعذر التنفيذ',unable:'تعذر التنفيذ',pending:'بانتظار القرار',approved:'تمت الموافقة',rejected:'مرفوض'};
export const missionEventNames={update_draft:'تعديل المسودة',create:'إنشاء المهمة',attach:'إضافة مرفقات',publish:'نشر المهمة',capacity:'تحديث عدد الموظفين',invite:'تكليف الموظفين',join:'طلب انضمام',review_join:'قرار طلب الانضمام',progress:'تحديث التنفيذ',review_unable:'قرار تعذر التنفيذ',close:'إغلاق المهمة',working:'استلام أو تحديث التنفيذ',completed:'إنجاز العمل',unable_pending:'طلب تعذر التنفيذ'};
export function googleResource(value,kind){
 if(!value)return '';
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return '';
  const host=u.hostname.toLowerCase();
  if(kind==='drive')return ['drive.google.com','docs.google.com'].includes(host)?u.href:'';
  return host==='maps.app.goo.gl'||host==='maps.google.com'||host==='goo.gl'&&u.pathname.startsWith('/maps')||['google.com','www.google.com'].includes(host)&&/^\/maps(?:\/|$)/.test(u.pathname)?u.href:'';
 }catch{return '';}
}
export function localDay(value){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function weekDays(offset=0,now=new Date()){const start=new Date(now);start.setHours(0,0,0);start.setDate(start.getDate()-start.getDay()+offset*7);return Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d;});}
export function personalEntries(items){return items.flatMap(m=>(m.mine||[]).map(a=>{const d=(m.departments||[]).find(x=>x.id===a.department_id);return {mission:m,assignment:a,department:d,due_at:d?.due_at,execution_at:d?.execution_at||m.execution_at};}));}
export function canRequestJoin(context,detail){const membership=context.department_ids||context.people?.find(p=>p.id===context.user_id)?.departments||[];return detail.mission.status==='published'&&!detail.departments.some(d=>membership.includes(d.service_id))&&!detail.assignments.some(a=>a.user_id===context.user_id)&&!detail.joins.some(j=>j.user_id===context.user_id);}
export function createPayload(form,submissionKey){
 const title=form.title.trim(),description=form.description.trim();
 if(title.length<3||title.length>200||description.length<10||description.length>12000)throw new Error('mission_fields_required');
 const drive=googleResource(form.drive_url.trim(),'drive'),map=googleResource(form.map_url.trim(),'map');
 if(form.drive_url.trim()&&!drive)throw new Error('invalid_drive_url');
 if(form.map_url.trim()&&!map)throw new Error('invalid_map_url');
 if(!form.execution_at||!form.departments.length)throw new Error('mission_fields_required');
 const departments=form.departments.map(d=>{if(d.requirements.trim().length<3||d.requirements.trim().length>6000||!d.execution_at||!d.due_at||Date.parse(d.execution_at)<Date.parse(form.execution_at)||Date.parse(d.due_at)<Date.parse(d.execution_at))throw new Error('mission_department_dates');return {...d,requirements:d.requirements.trim(),execution_at:new Date(d.execution_at).toISOString(),due_at:new Date(d.due_at).toISOString()};});
 return {submission_key:submissionKey,title,description,drive_url:drive||null,map_url:map||null,execution_at:new Date(form.execution_at).toISOString(),departments};
}
export function eventDescription(event,detail,context){const data=event.details||{},assignment=detail.assignments.find(a=>a.id===data.assignment_id),join=detail.joins.find(j=>j.id===data.join_id),department=detail.departments.find(d=>d.id===(data.department_id||assignment?.department_id||join?.department_id)),person=context.people?.find(p=>p.id===data.user_id);return [department?.name,person?.name||assignment?.name||join?.name,data.status?missionStates[data.status]:null,data.decision==='approve'?'تمت الموافقة':data.decision==='reject'?'تم الرفض':null,data.capacity!=null?`العدد المسموح: ${data.capacity}`:null].filter(Boolean).join(' · ');}
