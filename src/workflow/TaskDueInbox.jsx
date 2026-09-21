import React,{useEffect,useRef,useState} from 'react';
import {CalendarClock,ArrowLeft} from 'lucide-react';
import {useSessionState} from '../shared/session-state';
import {dateLabel} from '../shared/date-only';
import {repository,call,workError} from './data';
import {PlannerDialog,PlannerPager} from './TaskPlanner';

function ReviewDate({draft,setDraft,onClose,onSaved}){
 const {row}=draft,[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
 async function submit(event){
  event.preventDefault();if(lock.current)return;
  if(draft.reason.trim().length<3){setError('وضح قرار الإدارة');return;}
  lock.current=true;setBusy(true);setError('');
  try{await call('review_task_due_change',{id:row.id,request_id:row.request_id,version:row.request_version,decision:draft.decision,reason:draft.reason,submission_key:draft.key});onSaved();}
  catch(reason){setError(workError(reason));}finally{lock.current=false;setBusy(false);}
 }
 return <PlannerDialog title="مراجعة طلب تأجيل الموعد" onClose={onClose} busy={busy}><form onSubmit={submit}>
  <div className="w-planner-dialog-context"><strong>{row.request_title}</strong><span>{row.employee} في {row.department}</span><span>{row.client_name}</span></div>
  <div className="w-planner-date-pair"><span>الموعد الحالي<strong>{dateLabel(row.effective_due_at||row.original_due_at)}</strong></span><span>الموعد المطلوب<strong>{dateLabel(row.proposed_due_at)}</strong></span></div>
  {row.stale&&<p className="w-planner-policy">تغيرت بيانات المهمة يلزم رفض الطلب القديم ليقدم الموظف طلبا جديدا</p>}
  <div className="w-planner-request-reason"><strong>سبب طلب التأجيل</strong><p>{row.reason}</p></div>
  <label>قرار الإدارة<select value={draft.decision} onChange={event=>setDraft(value=>({...value,decision:event.target.value}))} disabled={busy}><option value="approve" disabled={row.can_review===false||row.stale}>الموافقة على الموعد المطلوب</option><option value="reject">رفض التأجيل وإبقاء الموعد الحالي</option></select></label>
  <label>توضيح الإدارة<textarea required minLength={3} maxLength={2000} value={draft.reason} onChange={event=>setDraft(value=>({...value,reason:event.target.value}))} disabled={busy}/></label>
  <p className="w-planner-policy">{draft.decision==='approve'?'يعتمد الموعد الجديد بعد التأكيد ويصل القرار للموظف':'يبقى موعد التسليم الحالي ويصل سبب الرفض للموظف'}</p>
  {error&&<p className="w-error" role="alert">{error}</p>}
  <div className="w-planner-form-actions"><button type="submit" className="a-primary" disabled={busy}>{busy?'جار الحفظ':'تأكيد قرار الإدارة'}</button><button type="button" onClick={onClose} disabled={busy}>إلغاء</button></div>
 </form></PlannerDialog>;
}
export default function TaskDueInbox({onOpen,onChanged,requestId=null}){
 const prefix=`due-inbox:${requestId||'all'}:`,[open,setOpen]=useSessionState(prefix+'open',false),[page,setPage]=useSessionState(prefix+'page',0),[draft,setDraft]=useSessionState(prefix+'draft',null);
 const [result,setResult]=useState(null),[error,setError]=useState(''),[tick,setTick]=useState(0),[notice,setNotice]=useState('');
 useEffect(()=>{
  let live=true;
  const load=()=>repository.dueChanges({requestId,page}).then(value=>{if(live){setResult({...value,pageKey:page});setError('');}}).catch(reason=>{if(live)setError(workError(reason));});
  void load();const timer=setInterval(()=>{if(!document.hidden&&!draft)void load();},15000);return()=>{live=false;clearInterval(timer);};
 },[page,requestId,tick,Boolean(draft)]);
 const ready=result?.pageKey===page,rows=ready?result.items||[]:[];
 return <div className="w-due-inbox">
  <button type="button" className="w-due-inbox-trigger" onClick={()=>setOpen(true)}><CalendarClock size={19} aria-hidden="true"/><span>طلبات تأجيل المواعيد</span><bdi>{error?'—':result?.total??'—'}</bdi><ArrowLeft size={16} aria-hidden="true"/></button>
  {open&&<PlannerDialog title="طلبات تأجيل المواعيد" onClose={()=>{setOpen(false);setDraft(null);}}>
   <p className="w-planner-policy">الموعد الحالي يبقى معتمدا حتى موافقتك على التأجيل</p>
   {notice&&<p className="w-planner-notice" role="status">{notice}</p>}
   {error?<div className="w-error" role="alert">{error}<button type="button" onClick={()=>setTick(value=>value+1)}>إعادة المحاولة</button></div>:!ready?<p role="status">جار تحميل الطلبات</p>:!rows.length?<p className="w-planner-empty">لا توجد طلبات تأجيل بانتظار قرارك</p>:<div className="w-due-inbox-list">{rows.map(row=><article key={row.id}>
    <div className="w-planner-dialog-context"><strong>{row.request_title}</strong><span>{row.client_name}</span><small>{row.department} يعمل عليها {row.employee}</small></div>
    <div className="w-planner-date-pair"><span>الموعد الحالي<strong>{dateLabel(row.effective_due_at||row.original_due_at)}</strong></span><span>الموعد المطلوب<strong>{dateLabel(row.proposed_due_at)}</strong></span></div>
    <p className="w-planner-request-reason">{row.reason}</p><div className="w-planner-form-actions"><button type="button" className="a-primary" onClick={()=>setDraft({row,decision:row.can_review===false||row.stale?'reject':'approve',reason:'',key:crypto.randomUUID()})}>مراجعة واتخاذ قرار</button><button type="button" onClick={()=>{setOpen(false);onOpen(row.request_id,row.part_id);}}>تفاصيل المهمة</button></div>
   </article>)}</div>}
   {(result?.has_next||page>0)&&<PlannerPager page={page} total={result?.total} hasNext={result?.has_next} onPage={setPage}/>}
  </PlannerDialog>}
  {open&&draft&&<ReviewDate key={draft.key} draft={draft} setDraft={setDraft} onClose={()=>setDraft(null)} onSaved={()=>{setDraft(null);setNotice('تم حفظ القرار وإشعار الموظف');setTick(value=>value+1);onChanged?.();}}/>}
 </div>;
}
