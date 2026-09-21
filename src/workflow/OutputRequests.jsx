import React,{useId} from 'react';
import {ArrowLeft,PackageCheck,ShieldX,Trash2} from 'lucide-react';
import {dateLabel} from '../shared/date-only';
import './output-requests.css';

export function OutputAssignments({services,choices,rows,onChange,disabled}){
 const id=useId();
 function toggle(service,checked){
  if(!checked){onChange(current=>current.filter(row=>row.service_id!==service.id));return;}
  onChange(current=>[...current,{service_id:service.id,reason:''}]);
 }
 function update(serviceId,field,value){onChange(current=>current.map(row=>row.service_id===serviceId?{...row,[field]:value}:row));}
 return <div className="w-output-assignments">
  <p>يصل طلبك لمسؤول القسم ليعمل عليه أو يوزعه على فريقه وتحدد موعد مهمتك بعد جاهزية المخرجات</p>
  <fieldset className="w-output-choices" disabled={disabled}><legend>الأقسام التي تحتاج مخرجاتها</legend>{choices.map(service=><label key={service.id}><input type="checkbox" checked={rows.some(row=>row.service_id===service.id)} onChange={event=>toggle(service,event.target.checked)}/>{service.name}</label>)}{!choices.length&&<p>لا توجد أقسام متاحة لطلب مخرجات إضافية لهذه المهمة</p>}</fieldset>
  {rows.map(row=>{
   const service=services.find(service=>service.id===row.service_id),available=choices.some(service=>service.id===row.service_id);
   return <section className="w-output-assignment" key={row.service_id} aria-labelledby={`${id}-${row.service_id}`}>
    <header><h4 id={`${id}-${row.service_id}`}>{service?.name||'القسم المختار'}</h4><button type="button" disabled={disabled} aria-label={`إزالة ${service?.name||'القسم'}`} onClick={()=>toggle({id:row.service_id},false)}><Trash2 size={17}/></button></header>
    {!available&&<p role="alert">هذا القسم غير متاح لهذه المهمة احذفه من الاختيار</p>}
    <label>المخرجات المطلوبة<textarea required minLength={3} maxLength={4000} rows={3} disabled={disabled||!available} value={row.reason} onChange={event=>update(row.service_id,'reason',event.target.value)}/></label>
   </section>;
  })}
 </div>;
}

export function OutputRequests({rows=[],onReject,renderFiles,busy,manager=false}){
 if(!rows.length)return null;
 return <details className="w-task-disclosure w-output-requests" open={manager||rows.some(row=>row.status==='ready')||undefined}><summary><span>طلبات المخرجات بين الأقسام</span><span className="w-disclosure-count">{rows.length}</span></summary><div className="w-disclosure-body">
  {manager&&<p className="w-routing-hint">التوجيه نافذ مباشرة وتدخل الإدارة اختياري</p>}
  {rows.map(row=><article key={row.id} className={`w-output-request is-${row.status}`}>
   <div className="w-output-path"><div><small>طلب المخرجات</small><strong>{row.source_employee||'موظف القسم'}</strong><span>{row.source_department}</span></div><ArrowLeft size={18} aria-label="إلى"/><div><small>الموظف المكلف</small><strong>{row.current_target_employee||row.target_employee||'موظف القسم'}</strong><span>{row.target_department}</span></div></div>
   <div className="w-output-state">{row.status==='rejected'?<><ShieldX size={17}/>رفضت الإدارة الطلب</>:row.status==='ready'?<><PackageCheck size={17}/>المخرجات جاهزة</>:row.target_status==='offered'?'بانتظار استلام القسم':row.target_status==='needs_info'?'القسم ينتظر بيانات العميل':row.target_status==='waiting'?'القسم ينتظر مخرجات مرتبطة':'القسم يعمل على المخرجات'}{row.target_due_at&&row.status!=='rejected'&&<span>موعد التسليم <time dateTime={row.target_due_at}>{dateLabel(row.target_due_at)}</time></span>}</div>
   <details className="w-output-message"><summary>المخرجات المطلوبة</summary><p>{row.reason}</p>{row.status==='rejected'&&row.rejection_reason&&<p><strong>سبب رفض الإدارة</strong><br/>{row.rejection_reason}</p>}</details>
   {row.status==='ready'&&renderFiles?.(row)}
   {manager&&row.can_reject&&<button type="button" className="w-output-reject" disabled={busy} onClick={()=>onReject(row)}>رفض طلب المخرجات</button>}
  </article>)}
 </div></details>;
}
