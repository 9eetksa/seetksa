import React from 'react';
import {AlertTriangle,ArrowLeft} from 'lucide-react';
import {kinds} from './data';
import {openRequestInterventions} from './request-interventions';

export default function RequestInterventions({request,escalations,parts,dependencies,routes,services,staff,manage,busy,onResolve}){
 const open=openRequestInterventions(escalations,request.id);
 if(!open.length)return null;
 return <section className="w-request-interventions" aria-label="تدخلات الإدارة">
  <header><h4><AlertTriangle size={18} aria-hidden="true"/>تدخلات الإدارة <bdi>{open.length}</bdi></h4><p>راجع سبب التدخل ثم اختر القرار المناسب للمهمة</p></header>
  {open.map(escalation=>{
   const part=parts.find(item=>item.id===escalation.part_id);
   const dependency=dependencies.find(item=>item.id===escalation.dependency_id);
   const upstream=parts.find(item=>item.id===dependency?.upstream_id)||routes.find(item=>item.id===dependency?.upstream_id);
   const department=services.find(item=>item.id===(part?.service_id||request.service_id))?.name||'الطلب';
   const employee=staff.find(item=>item.id===part?.assignee_id)?.name;
   const unavailable=['completed','declined'].includes(request.status)?'انتهى الطلب':part?.output_cancelled?'ألغيت هذه المهمة':['approved','forwarded','internal_done'].includes(part?.status)?'اكتمل عمل هذا القسم':escalation.part_id&&!part?'تفاصيل المهمة غير متاحة':!manage(part?.service_id||request.service_id)?'اتخاذ القرار يحتاج صلاحية إدارة القسم':null;
   return <article className="w-escalation" key={escalation.id}>
    <div><div className="w-intervention-context"><strong>{kinds[escalation.kind]||'تدخل إداري'}</strong><span>{department}</span>{employee&&<span>{employee}</span>}</div><p>{escalation.reason||'راجع تفاصيل المهمة لاتخاذ القرار'}</p></div>
    {unavailable?<p className="w-intervention-unavailable">{unavailable}</p>:<button type="button" className="a-primary" disabled={busy} aria-label={`اتخاذ قرار بشأن ${kinds[escalation.kind]||'التدخل'} في ${department}`} onClick={()=>onResolve(part,{escalation,canEnforceDependency:manage(upstream?.service_id)})}>اتخاذ قرار<ArrowLeft size={16} aria-hidden="true"/></button>}
   </article>;
  })}
 </section>;
}
