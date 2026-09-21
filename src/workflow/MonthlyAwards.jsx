import React,{useEffect,useRef,useState} from 'react';
import {Trophy,X} from 'lucide-react';
import {repository,workError} from './data';
import {useSessionState} from '../shared/session-state';
import './monthly-awards.css';

export default function MonthlyAwards(){
 const [open,setOpen]=useSessionState('performance.monthly-awards.open',false,{validate:value=>typeof value==='boolean'});
 const [report,setReport]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [retry,setRetry]=useState(0),modal=useRef(null);
 useEffect(()=>{
  if(!open)return;
  const dialog=modal.current,previous=document.activeElement;dialog.showModal();
  let live=true;setLoading(true);setError('');setReport(null);
  repository.employeeOfMonth().then(result=>{if(live)setReport(result);}).catch(reason=>{if(live)setError(workError(reason));}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;dialog.close();if(previous?.isConnected)previous.focus();};
 },[open,retry]);
 return <><button type="button" className="op-month-button" onClick={()=>setOpen(true)}><Trophy size={19} aria-hidden="true"/>موظف الشهر</button>
  {open&&<dialog className="op-month-dialog" ref={modal} aria-labelledby="monthly-awards-title" onCancel={event=>{event.preventDefault();setOpen(false);}}>
   <header><div><span>أعلى ثلاثة موظفين أداء</span><h2 id="monthly-awards-title">موظف الشهر</h2></div><button type="button" onClick={()=>setOpen(false)} aria-label="إغلاق موظف الشهر"><X size={20}/></button></header>
   <p>نتائج الشهر الحالي حتى اليوم بتوقيت الرياض وفق تقييم الأداء المعتمد</p>
   {loading?<p role="status">جار حساب نتائج الشهر</p>:error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>إعادة المحاولة</button></div>:<>
    <ol>{(report?.people||[]).map(person=><li key={person.id}><span className="op-month-rank">{person.rank}</span><div><h3>{person.name}</h3><p>{person.departments?.map(department=>department.name).join(' و')||'دون قسم'}</p><span>{person.scored_completed_count} مهام منجزة</span></div><strong>{person.performance_score}<small>من 100</small></strong></li>)}</ol>
    {!report?.people?.length&&<p role="status">لم تتوفر بيانات كافية لترتيب موظفي الشهر بعد</p>}
    <p className="op-month-note">تتحدث النتائج خلال الشهر ولا يدخل الترتيب من لديه أقل من خمس مهام منجزة أو عشر نقاط جهد وعند التعادل تقدم نقاط الجهد ثم سرعة التنفيذ</p>
   </>}
  </dialog>}
 </>;
}
