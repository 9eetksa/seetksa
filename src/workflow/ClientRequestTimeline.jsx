import React,{useId} from 'react';
import {AlertCircle} from 'lucide-react';
import RequestRoadmap from './RequestRoadmap';
import {when} from './data';
import {clientSchedule} from './client-schedule';
import {dateLabel} from '../shared/date-only';
import './client-request-timeline.css';

const stamp=value=>Date.parse(value||'')||0;
const first=rows=>[...rows].sort((a,b)=>stamp(a.created_at)-stamp(b.created_at))[0];
const latest=rows=>[...rows].sort((a,b)=>stamp(b.created_at)-stamp(a.created_at))[0];
const released=delivery=>!Object.prototype.hasOwnProperty.call(delivery,'released_at')||!!delivery.released_at;
const department=name=>name?(/^قسم\s/.test(name)?name:`قسم ${name}`):'القسم المكلف';
const position=value=>Number.isInteger(value)?value:Number.MAX_SAFE_INTEGER;
const activeStates=new Set(['offered','working','waiting','revision','needs_info','escalated']);
const deliveredStates=new Set(['review','forwarded','internal_done','approved']);
const clientEventCopy={
 create:['رفع الطلب','تم تسجيل طلبكم لدى فريق الإشراف'],
 submit_request:['إرسال الطلب','وصل طلبكم إلى فريق الإشراف'],
 intake:['استلام الطلب','استلم المشرف المسؤول الطلب وبدأ متابعته'],
 request_info:['طلب معلومات إضافية','طلب فريق الإشراف معلومات لاستكمال الطلب'],
 request_attachments:['طلب مرفقات إضافية','طلب فريق الإشراف مرفقات لاستكمال الطلب'],
 supply_info:['استكمال المعلومات','وصلت المعلومات المطلوبة إلى فريق الإشراف'],
 assign:['توجيه الطلب','وجه المشرف المسؤول الطلب إلى قسم مكلف'],
 accept:['بدء تنفيذ المهمة','استلم القسم المهمة وبدأ تنفيذ المطلوب'],
 deliver:['تسليم مخرجات القسم','رفع القسم مخرجات جديدة للمتابعة'],
 release_delivery:['إرسال العمل للمراجعة','أرسل المشرف المسؤول العمل لمراجعتكم'],
 handoff:['الانتقال إلى قسم آخر','أحال المشرف المسؤول المخرجات إلى المرحلة التالية'],
 review:['قرار مراجعة التسليم','تم تسجيل قراركم على التسليم'],
 attach:['إضافة مرفق','أضيف مرفق جديد إلى الطلب'],
 decline_intake:['قرار الإدارة','صدر قرار الإدارة الموضح في تفاصيل الطلب']
};
const clientNoteKinds=new Set(['request_info','request_attachments','supply_info','review','decline_intake']);
const departmentStates={
 offered:['بانتظار استلام القسم','وجه المشرف المسؤول الطلب إلى القسم وبانتظار استلام المهمة'],
 working:['قيد التنفيذ','استلم القسم المهمة ويعمل على تنفيذ المطلوب'],
 waiting:['بانتظار مخرجات قسم آخر','ينتظر القسم وصول المخرجات المطلوبة قبل متابعة التنفيذ'],
 revision:['طلب التعديل لدى المشرف المسؤول','يراجع المشرف المسؤول ملاحظاتكم لإحالتها إلى القسم الذي سلّم العمل'],
 needs_info:['يحتاج بيانات إضافية','طلب القسم بيانات لاستكمال مهمته ويتابعها المشرف المسؤول'],
 escalated:['تحت المتابعة','يتابع المشرف المسؤول والإدارة الخطوة المناسبة لاستكمال الطلب'],
 review:['تم تسليم المطلوب','سلم القسم المطلوب إلى المشرف المسؤول لتحديد الخطوة التالية'],
 forwarded:['سلم القسم المطلوب','أحال المشرف المسؤول المخرجات إلى المرحلة التالية'],
 internal_done:['تم إنجاز عمل القسم','راجع المشرف المسؤول المخرجات وأتاحها للأقسام التي تحتاجها لاستكمال الطلب'],
 approved:['تم اعتماد تسليم القسم','راجعتم تسليم القسم واعتمدتم استلامه رسميا']
};

function StepDate({label,value}){
 if(!stamp(value))return null;
 return <span className="c-journey-date"><span>{label}</span><time dateTime={value}>{when(value)}</time></span>;
}

function StepContent({step,heading:Heading='h4'}){
 return <div className="c-journey-copy"><div className="c-journey-step-head"><Heading>{step.title}</Heading><span className="c-journey-state">{step.label}</span></div><p>{step.description}</p>{step.deadline&&<div className="c-journey-deadline"><span>موعد التسليم المتوقع</span>{step.deadline.dueAt?<time dateTime={step.deadline.dueAt}>{dateLabel(step.deadline.dueAt)}</time>:<span>{step.deadline.state==='unaccepted'?'يتحدد بعد استلام المهمة':'قيد اعتماد الموعد'}</span>}</div>}{step.dates.some(([,value])=>stamp(value))&&<div className="c-journey-dates">{step.dates.map(([label,value])=><StepDate key={label} label={label} value={value}/>)}</div>}
  {step.departments&&<ul className="c-journey-departments" role="list">{step.departments.map(department=><li key={department.id} className={`c-journey-department is-${department.state}`}><StepContent step={department} heading="h5"/></li>)}</ul>}
 </div>;
}

export default function ClientRequestTimeline({request,parts=[],deliveries=[],events=[],routes=[],due_reviews=[],inquiries=[],onRespondInquiry,renderDeliveries}){
 const historyTitleId=useId();
 if(!request)return null;
 const draft=request.status==='draft',complete=request.status==='completed',declined=request.status==='declined';
 const declineEvent=latest(events.filter(event=>event.kind==='decline_intake'));
 const declineReason=declineEvent?.note?.trim()||'تعذر اعتماد الطلب في حالته الحالية';
 const schedule=clientSchedule({request,parts,routes,due_reviews,events});
 const assigned=routes.filter(route=>route.client_visible!==false).map(route=>{
  const part=parts.find(item=>item.id===route.id)||{};
  const history=events.filter(event=>event.part_id===route.id);
  const sent=first(history.filter(event=>event.kind==='assign'));
  return {...route,...part,name:department(route.service),route_position:part.route_position??route.route_position,created_at:part.created_at||sent?.created_at};
 }).sort((a,b)=>position(a.route_position)-position(b.route_position)||stamp(a.created_at)-stamp(b.created_at));
 const ready=deliveries.filter(delivery=>delivery.status==='pending'&&released(delivery)&&(delivery.reviewable===true||parts.some(part=>part.id===delivery.part_id&&part.status==='review')));
 const approved=deliveries.filter(delivery=>delivery.status==='approved');
 const active=assigned.filter(part=>activeStates.has(part.status));
 const awaitingCoordinator=parts.some(part=>part.status==='review'&&!ready.some(delivery=>delivery.part_id===part.id))||(!active.length&&!ready.length&&parts.some(part=>part.status==='internal_done'));
 const intake=first(events.filter(event=>event.kind==='intake'));
 const submitted=first(events.filter(event=>event.kind==='submit_request'))||first(events.filter(event=>event.kind==='create'));
 const received=!draft&&(!!request.coordinator_id||!!intake||assigned.length>0||request.status==='active'||complete||declined);
 const releaseDate=deliveries.map(delivery=>delivery.released_at).filter(value=>stamp(value)).sort((a,b)=>stamp(b)-stamp(a))[0];
 const receivedDate=request.received_at||approved.map(delivery=>delivery.received_at).filter(value=>stamp(value)).sort((a,b)=>stamp(b)-stamp(a))[0];
 let current='communication',status='طلبكم لدى قسم التواصل',description='بانتظار استلام المشرف المسؤول وتوجيه الطلب إلى القسم المناسب';
 if(draft){current='submitted';status='الطلب لم يرسل بعد';description='أكملوا الطلب وأرسلوه ليصل إلى المشرف المسؤول';}
 else if(declined){current='decision';status='تعذر اعتماد الطلب';description='راجع فريق الإدارة الطلب ووضح سبب القرار داخل التفاصيل';}
 else if(complete){current='received';status='تم استلام المشروع رسميا';description='اكتمل طلبكم بعد اعتماد التسليم النهائي';}
 else if(ready.length){current='review';status='الطلب في انتظار مراجعتكم';description=active.length?'يمكنكم مراجعة التسليم المتاح بينما يستكمل الفريق بقية الطلب':'أرسل المشرف المسؤول العمل إليكم للمراجعة والاعتماد أو طلب التعديل';}
 else if(request.status==='needs_info'){status='ننتظر معلومات منكم';description='أرسلوا المعلومات المطلوبة ليكمل المشرف المسؤول طلبكم';}
 else if(active.length){
  const ongoing=active.find(part=>part.status==='revision')||active.find(part=>part.status==='working')||active[0];
  current='departments';
  status=active.length>1?'طلبكم لدى الأقسام المكلفة':`طلبكم لدى ${ongoing.name}`;
  description=active.length>1?active.map(part=>`${part.name} ${departmentStates[part.status]?.[0]||'تحت المتابعة'}`).join(' و'):departmentStates[ongoing.status][1];
 }
 else if(awaitingCoordinator){current='departments';status='لدى المشرف المسؤول لتحديد الخطوة التالية';description='سلم القسم المطلوب والمشرف المسؤول يحدد توجيهه لقسم آخر أو إرساله إليكم للمراجعة';}
 else if(received){status='استلم المشرف المسؤول طلبكم';description='يراجع المطلوب ويحدد القسم المناسب لتنفيذه';}

 const departmentSteps=assigned.map(part=>{
   const partReady=ready.some(delivery=>delivery.part_id===part.id);
   const delivery=latest(deliveries.filter(item=>item.part_id===part.id));
   const deliveryEvent=latest(events.filter(event=>event.part_id===part.id&&event.kind==='deliver'));
   const forwardedTo=assigned.find(item=>item.id===part.forwarded_to);
   const [label,description]=departmentStates[part.status]||['تحت المتابعة','يتابع الفريق حالة المهمة'];
   const inquiry=inquiries.find(item=>item.part_id===part.id&&item.can_reply);
   return {id:`department-${part.id}`,inquiry,title:part.name,state:deliveredStates.has(part.status)?'done':'active',label:inquiry?.kind==='files'?'يحتاج مرفقات إضافية':label,deadline:schedule.departments.find(item=>item.id===part.id),
    description:inquiry?'أكملوا المطلوب من زر الرد ليصل مباشرة إلى القسم':part.status==='forwarded'&&forwardedTo?`أحال المشرف المسؤول المخرجات إلى ${forwardedTo.name}`:part.status==='review'&&partReady?'سلم القسم المطلوب وأرسله المشرف المسؤول إليكم للمراجعة':description,
    dates:[['تم التوجيه',part.created_at],['استلم القسم',part.accepted_at],['آخر تسليم',stamp(deliveryEvent?.created_at)>stamp(delivery?.created_at)?deliveryEvent.created_at:delivery?.created_at],['تمت الإحالة',part.status==='forwarded'?part.forwarded_at:null]]};
  });
 const steps=[
  {id:'submitted',title:'إرسال طلبكم',state:draft?'active':'done',label:draft?'لم يرسل بعد':'تم الإرسال',description:draft?'الطلب محفوظ حتى تكملوا إرساله':'وصل طلبكم إلى قسم التواصل مع وصفه ومرفقاته',dates:[['تم الإرسال',submitted?.created_at]]},
  {id:'communication',title:'استلام المشرف المسؤول',state:request.status==='needs_info'?'active':received?'done':draft?'waiting':'active',label:request.status==='needs_info'?'بانتظار معلوماتكم':declined?'تمت المراجعة':received?'تم الاستلام':'بانتظار الاستلام',description:request.status==='needs_info'?'نحتاج المعلومات المطلوبة لاستكمال طلبكم':declined?'راجع فريق الإدارة الطلب قبل إصدار القرار':received?'استلم المشرف المسؤول الطلب ويتولى توجيهه ومتابعته':'يراجع المشرف المسؤول الطلب ثم يوجهه إلى القسم المناسب',dates:[['تم الاستلام',intake?.created_at]]},
  ...(declined?[{id:'decision',title:'قرار الطلب',state:'active',label:'تعذر اعتماد الطلب',description:declineReason,dates:[['صدر القرار',declineEvent?.created_at||request.updated_at]]}]:[]),
  ...(!declined?[
  {id:'departments',title:'الأقسام المكلفة',state:complete||ready.length&&!active.length?'done':departmentSteps.length||awaitingCoordinator?'active':'waiting',label:awaitingCoordinator?'مراجعة المشرف المسؤول':complete||ready.length?'تم إرسال العمل للمراجعة':departmentSteps.length?'الطلب قيد المتابعة':'بانتظار توجيه الطلب',description:awaitingCoordinator?'يراجع المشرف المسؤول مخرجات الأقسام ويحدد التوجيه التالي أو التسليم لكم':'حالة كل قسم مستقلة ويراجع المشرف المسؤول المخرجات قبل إرسالها إليكم',dates:[['أرسل للمراجعة',releaseDate]],departments:departmentSteps.length?departmentSteps:undefined},
  {id:'review',title:'مراجعتكم للتسليم',state:complete?'done':ready.length?'active':'waiting',label:complete?'تم الاعتماد':ready.length?'بانتظار مراجعتكم':'بانتظار جاهزية التسليم',description:complete?'راجعتم التسليم واعتمدتموه':ready.length?'راجعوا الملفات أدناه ثم اعتمدوا الاستلام أو اطلبوا التعديل':approved.length?'اعتمدتم تسليما سابقا وسنبلغكم عند جاهزية بقية المطلوب':'سيصلكم إشعار عندما يرسل المشرف المسؤول العمل إليكم',dates:[]},
  {id:'received',title:'الاستلام الرسمي',state:complete?'done':'waiting',label:complete?'مكتمل ومستلم':'بعد اعتمادكم النهائي',description:complete?'المشروع محفوظ ضمن مشاريعكم المستلمة':approved.length?'استلمتم بعض التسليمات ويكتمل المشروع عند اعتماد باقي المطلوب':'يكتمل المشروع بعد اعتماد استلامه رسميا',dates:complete?[['تم الاستلام',receivedDate]]:[]}
  ]:[])
 ];
 const clientHistory=events.filter(event=>clientEventCopy[event.kind]).sort((left,right)=>stamp(left.created_at)-stamp(right.created_at));

 const shortTitles={submitted:'إرسال الطلب',communication:'التواصل',departments:'الأقسام',review:'مراجعة التسليم',received:'الاستلام النهائي'};
 return <RequestRoadmap compact key={`${request.id}-${current}`} steps={steps.map(step=>({...step,shortTitle:shortTitles[step.id]}))} current={current} status={status} description={description} renderStep={step=><>
  {step.dates.some(([,value])=>stamp(value))&&<div className="c-journey-dates">{step.dates.map(([label,value])=><StepDate key={label} label={label} value={value}/>)}</div>}
  {step.departments&&<ul className="c-journey-departments">{step.departments.map(part=><li key={part.id} className={`c-journey-department is-${part.state}`}>{part.inquiry&&<button type="button" className="c-department-inquiry-action" aria-haspopup="dialog" onClick={()=>onRespondInquiry?.(part.inquiry.id)}><AlertCircle size={18} aria-hidden="true"/>{part.inquiry.kind==='files'?'مرفقات مطلوبة منك':'بيانات مطلوبة منك'}<span>الرد على القسم</span></button>}{part.state==='done'?<details><summary>{part.title}<span>{part.label}</span></summary><StepContent step={part}/></details>:<StepContent step={part}/>}</li>)}</ul>}
  {['review','received'].includes(step.id)&&renderDeliveries?.(step.id)}
 </>}>
  <details className="c-journey-history">
   <summary id={historyTitleId}>سجل رحلة الطلب<span> {clientHistory.length} تحديث</span></summary>
   {clientHistory.length?<ol className="c-journey-history-list">{clientHistory.map((event,index)=>{const [title,description]=clientEventCopy[event.kind],note=clientNoteKinds.has(event.kind)&&event.note?.trim()?event.note.trim():description;return <li key={event.id||`${event.kind}-${event.created_at}-${index}`}><span aria-hidden="true"/><div><strong>{title}</strong><p>{note}</p>{stamp(event.created_at)>0&&<time dateTime={event.created_at}>{when(event.created_at)}</time>}</div></li>;})}</ol>:<p className="c-journey-history-empty">ستظهر تحديثات الطلب هنا مع تقدم العمل</p>}
  </details>
 </RequestRoadmap>;
}
