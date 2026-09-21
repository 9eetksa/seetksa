import React,{useId,useState} from 'react';
import {Check,ArrowLeft} from 'lucide-react';
import './request-roadmap.css';

// Presentation only  The caller owns workflow state and all permitted actions
export default function RequestRoadmap({steps,current,status,description,children,renderStep,compact=false}){
 const id=useId();
 const [selection,setSelection]=useState(null);
 const selected=steps.find(step=>step.id===selection)||steps.find(step=>step.id===current)||steps[0];
 if(!selected)return null;
 return <section className={`request-roadmap${compact?' request-roadmap-compact':''}`} dir="rtl" aria-labelledby={`${id}-title`}>
  <header className="request-roadmap-heading"><div>{!compact&&<span>رحلة المشروع</span>}<h3 id={`${id}-title`}>{compact?'رحلة الطلب':'خريطة طريق الطلب'}</h3></div><small>اختر مرحلة لعرض تفاصيلها</small></header>
  <ol className="request-roadmap-track" aria-label="مراحل الطلب">{steps.map((step,index)=><li key={step.id} className={`${step.id===current?'is-current':step.state==='done'?'is-done':'is-waiting'}`}>
   <button type="button" aria-current={step.id===current?'step':undefined} aria-pressed={selected.id===step.id} aria-controls={`${id}-detail`} onClick={()=>setSelection(step.id)}>
    <span className="request-roadmap-dot" aria-hidden="true">{step.state==='done'&&step.id!==current?<Check size={16}/>:index+1}</span><span>{compact?step.shortTitle||step.title:step.title}</span><small>{step.id===current?'المرحلة الحالية':step.state==='done'?'مكتملة':'ضمن المسار'}</small>
   </button>
  </li>)}</ol>
  <div className="request-roadmap-detail" id={`${id}-detail`}>
   <div className="request-roadmap-now"><span>{selected.id===current?'الطلب الآن':'تفاصيل المرحلة'}</span><strong>{selected.id===current?status:selected.label||selected.title}</strong><p>{selected.id===current?description:selected.description}</p></div>
   {renderStep?.(selected)}
   {selected.id!==current&&<button type="button" className="request-roadmap-return" onClick={()=>setSelection(current)}>العودة للمرحلة الحالية<ArrowLeft size={16} aria-hidden="true"/></button>}
  </div>
  {children}
 </section>;
}
