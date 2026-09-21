import React,{useEffect,useState} from 'react';
import {repository,states,when,workError} from './data';

export default function PlannerMoveHistory({requestId,version}){
 const [open,setOpen]=useState(false),[result,setResult]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!open)return;
  let live=true;setResult(null);setError('');
  repository.plannerMoves(requestId).then(value=>{if(live)setResult(value);}).catch(reason=>{if(live)setError(workError(reason));});
  return()=>{live=false;};
 },[open,requestId,version,retry]);
 return <details className="w-history w-planner-move-history" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>ملاحظات نقل المهام في الكانبان</summary>{error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>إعادة المحاولة</button></div>:open&&!result?<p role="status">جار تحميل الملاحظات</p>:result&&!result.items?.length?<p>لا توجد ملاحظات نقل مسجلة</p>:<ol>{result?.items?.map(move=><li key={move.id}><div><strong>{move.department}</strong><time dateTime={move.created_at}>{when(move.created_at)}</time></div><small>{move.actor} من {states[move.status_before]||'الحالة السابقة'} إلى {states[move.status_after]||'الحالة الحالية'}</small><p>{move.note}</p></li>)}</ol>}</details>;
}
