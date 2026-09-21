import {dateLabel} from '../shared/date-only';
import React,{useEffect,useRef,useState} from 'react';
import RequestRoadmap from './RequestRoadmap';

export default function TeamRequestRoadmap({request,parts,routes,deliveries,partLabel,staff,reviewContent,renderPart,detailedPartIds=[],showDepartments=true}){
 const [selectedPart,setSelectedPart]=useState(null);
 const complete=request.status==='completed',declined=request.status==='declined';
 const active=parts.filter(part=>!['approved','forwarded','internal_done','review'].includes(part.status));
 const review=parts.filter(part=>part.status==='review');
 const clientReview=deliveries.some(delivery=>delivery.status==='pending'&&!!delivery.released_at);
 const current=complete?'complete':declined?'decision':request.status!=='active'?'intake':clientReview?'client':active.length?'execution':review.length?'review':parts.length?'review':'intake';
 const labels={intake:request.status==='needs_info'?'بانتظار استكمال بيانات العميل':'لدى المشرف المسؤول',execution:active.length===1?partLabel(active[0]):'العمل جار في الأقسام المكلفة',review:'بانتظار مراجعة المشرف المسؤول',client:'بانتظار اعتماد المشرف',complete:'اكتمل المشروع',decision:'تعذر اعتماد الطلب'};
 const descriptions={intake:'مراجعة بيانات الطلب واستكمالها ثم توجيهه إلى الفريق المناسب',execution:'تابع حالة كل قسم وافتح مهمته للوصول إلى الإجراءات والمرفقات',review:'مراجعة المخرجات ثم إتاحتها للقسم التالي أو إرسالها للعميل',client:'المخرجات متاحة للعميل للمراجعة والاعتماد أو طلب التعديل',complete:'تم اعتماد التسليم النهائي ويمكن الرجوع إلى الملفات وسجل الرحلة',decision:'تفاصيل القرار محفوظة في سجل رحلة الطلب'};
 const ids=declined?['intake','decision']:['intake','execution','review','client','complete'];
 if(!showDepartments){labels.execution='الطلب في مرحلة التنفيذ';descriptions.execution='مهام قسمك وإجراءاتها موضحة أسفل مراحل الطلب';}
 const titles={intake:'مراجعة الطلب',execution:'تنفيذ الأقسام',review:'مراجعة المخرجات',client:'اعتماد المشرف',complete:'الاستلام النهائي',decision:'قرار الطلب'};
 const steps=ids.map(id=>{
  const done=complete||(id==='intake'&&request.status==='active')||(id==='execution'&&parts.length>0&&!active.length)||(id==='review'&&clientReview&&!active.length&&!review.some(part=>!deliveries.some(delivery=>delivery.part_id===part.id&&delivery.status==='pending'&&delivery.released_at)));
  return {id,title:titles[id],label:id===current?labels[id]:done?'اكتملت المرحلة':'لم تكتمل هذه المرحلة بعد',description:descriptions[id],state:done?'done':'waiting'};
 });
 const summaryRoutes=showDepartments?[...routes,...parts.filter(part=>detailedPartIds.includes(part.id)&&!routes.some(route=>route.id===part.id))]:[];
 const selectedRoute=summaryRoutes.find(route=>route.id===selectedPart&&detailedPartIds.includes(route.id));
 return <><RequestRoadmap key={`${request.id}-${current}`} steps={steps} current={current} status={labels[current]} description={descriptions[current]} renderStep={step=>step.id==='review'?reviewContent:step.id==='execution'&&summaryRoutes.length>0?<details className="w-stage-departments"><summary>متابعة الأقسام المشاركة <bdi>{summaryRoutes.length}</bdi></summary><ul className="request-roadmap-team">{summaryRoutes.map(route=>{
  const visiblePart=parts.find(item=>item.id===route.id),part=visiblePart||route;
  const owner=staff.find(member=>member.id===part.assignee_id)?.name||route.assignee_name||route.responsible_name;
  const showOwner=owner&&!owner.includes('@')&&!/^\+?[\d\s()-]{7,}$/.test(owner);
  const priority=part.priority==='urgent'?'urgent':part.priority==='normal'?'normal':null;
  const label=<><span className="w-department-task-name"><strong>{route.service||'القسم'}</strong>{priority&&<span className={`w-department-priority is-${priority}`} aria-label={`أولوية المهمة ${priority==='urgent'?'مستعجل':'عادي'}`}>{priority==='urgent'?'مستعجل':'عادي'}</span>}</span><span>{partLabel(part)}</span></>;
  return <li key={route.id}>{detailedPartIds.includes(route.id)?<button type="button" className="w-department-task-trigger" aria-haspopup="dialog" onClick={()=>setSelectedPart(route.id)}>{label}</button>:<div className="request-roadmap-route-label">{label}</div>}<div className="w-department-task-meta"><small>الموظف {showOwner?owner:'غير متاح'}</small><small>{part.due_review_status==='pending'?'موعد مقترح قيد الاعتماد':'موعد تسليم المهمة'} <strong>{part.accepted_at&&part.due_at?dateLabel(part.due_at):part.accepted_at?'قيد تحديد الموعد':'يتحدد عند استلام المهمة'}</strong></small></div></li>;
 })}</ul></details>:null}/>{selectedRoute&&<DepartmentTaskDialog key={selectedRoute.id} name={selectedRoute.service||'القسم'} onClose={()=>setSelectedPart(null)}>{renderPart?.(selectedRoute.id)}</DepartmentTaskDialog>}</>;
}

function DepartmentTaskDialog({name,onClose,children}){
 const ref=useRef(null);
 useEffect(()=>{const dialog=ref.current,previous=document.activeElement;dialog.showModal();return()=>{dialog.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} className="w-dialog w-department-task-dialog" aria-label={`مهمة ${name}`} onCancel={event=>{if(event.target!==event.currentTarget)return;event.preventDefault();event.stopPropagation();onClose();}}><header className="w-toolbar"><h3>مهمة {name}</h3><button type="button" onClick={onClose}>إغلاق مهمة القسم</button></header>{children}</dialog>;
}
