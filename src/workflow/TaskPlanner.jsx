import React,{useEffect,useId,useRef,useState} from 'react';
import {CalendarDays,Columns3,List,Table2,GanttChart,ChartNoAxesColumn,Search,ArrowLeft,ArrowRight,Clock3,RefreshCw,X,GripVertical,MoveRight} from 'lucide-react';
import {useSessionState} from '../shared/session-state';
import DatePicker from '../shared/DatePicker';
import {dateLabel,riyadhDate} from '../shared/date-only';
import {repository,call,workError} from './data';
import {plannerBuckets,plannerLastDate,scheduleChange,collectPlannerTasks,plannerMoveAction} from './task-planner';
import {plannerStage} from './planner-views';
import {PlannerList,PlannerCalendar,PlannerTimeline,PlannerWorkload} from './PlannerViews';
import './task-planner.css';
import './planner-views.css';

function useCompactPlanner(){
 const [compact,setCompact]=useState(()=>window.matchMedia('(max-width: 700px)').matches);
 useEffect(()=>{const media=window.matchMedia('(max-width: 700px)'),change=()=>setCompact(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 return compact;
}
export function PlannerDialog({title,children,onClose,busy=false}){
 const ref=useRef(null),id=useId();
 useEffect(()=>{const dialog=ref.current,previous=document.activeElement;dialog.showModal();return()=>{dialog.close();if(previous?.isConnected)previous.focus();};},[]);
 return <dialog ref={ref} className="w-dialog w-planner-dialog" aria-labelledby={id} onCancel={event=>{event.preventDefault();event.stopPropagation();if(!busy)onClose();}}>
  <header><h3 id={id}>{title}</h3><button type="button" aria-label="إغلاق النافذة" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true"/></button></header>{children}
 </dialog>;
}
export function PlannerPager({page=0,hasNext,total,onPage,busy=false}){
 return <div className="w-planner-pager"><button type="button" aria-label="الصفحة السابقة" disabled={busy||page===0} onClick={()=>onPage(page-1)}><ArrowRight size={16} aria-hidden="true"/></button><span>صفحة <bdi>{page+1}</bdi>{Number.isFinite(total)&&<> من <bdi>{Math.max(1,Math.ceil(total/40))}</bdi></>}</span><button type="button" aria-label="الصفحة التالية" disabled={busy||!hasNext} onClick={()=>onPage(page+1)}><ArrowLeft size={16} aria-hidden="true"/></button></div>;
}
function TaskCard({task,onOpen,onSchedule,onMove,drag}){
 const bucket=plannerBuckets.find(item=>item.id===task.bucket)||plannerBuckets[3];
 const movable=Boolean(onMove&&['active','waiting','review','completed'].some(target=>plannerMoveAction(task,target)));
 return <article className={`w-planner-task is-${bucket.tone}`} draggable={Boolean(drag&&movable)} onDragStart={event=>{if(!drag||!movable){event.preventDefault();return;}event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',task.part_id);drag.start(task);}} onDragEnd={()=>drag?.end()}>
  <div className="w-planner-task-meta"><span>{task.department}</span><span className={`w-planner-priority ${task.priority==='urgent'?'is-urgent':''}`}>{task.priority==='urgent'?'مستعجل':'عادي'}</span></div>
  <button type="button" className="w-planner-task-title" onClick={()=>onOpen(task.request_id,task.part_id)}>{task.request_title}</button>
  <div className="w-planner-client"><span>{task.client_name||'العميل'}</span><small>طلب <bdi>{task.request_number}</bdi></small></div>
  {task.scope&&<p className="w-planner-scope">{task.scope}</p>}
  <div className="w-planner-task-date"><Clock3 size={15} aria-hidden="true"/><span>{task.due_at?<time dateTime={task.due_at}>{dateLabel(task.due_at)}</time>:'الموعد يحدد عند الاستلام'}</span><small>{bucket.label}</small></div>
  {task.pending_due_change&&<p className="w-planner-pending">طلب تأجيل إلى {dateLabel(task.pending_due_change.proposed_due_at)} بانتظار الإدارة</p>}
  <footer><button type="button" onClick={()=>onOpen(task.request_id,task.part_id)}>{task.bucket==='new'?'فتح واستلام المهمة':'فتح المهمة'}<ArrowLeft size={14} aria-hidden="true"/></button>
   {(task.can_reschedule||task.can_request_extension)&&!task.pending_due_change&&<button type="button" onClick={()=>onSchedule(task)}><CalendarDays size={15} aria-hidden="true"/>{task.due_locked_by_admin?'طلب تأجيل':'تعديل الموعد'}</button>}
  </footer>
  {movable&&<div className="w-planner-move-tools"><button type="button" className="w-planner-move-grip" aria-label={`سحب مهمة ${task.request_title}`} onPointerDown={event=>{if(event.pointerType==='mouse')return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.start(task);}} onPointerUp={event=>{if(event.pointerType==='mouse')return;if(event.currentTarget.hasPointerCapture(event.pointerId)){event.currentTarget.releasePointerCapture(event.pointerId);const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-drop-stage]')?.dataset.dropStage;drag.end();if(target)onMove(task,target);}}} onPointerCancel={()=>drag.end()} onClick={event=>{if(event.detail===0)onMove(task);}}><GripVertical size={16}/><span>نقل المهمة</span></button><button type="button" onClick={()=>onMove(task)}><MoveRight size={15}/>اختيار الإجراء</button></div>}
 </article>;
}
function ScheduleDialog({draft,setDraft,onClose,onSaved,user}){
 const task=draft.task,[busy,setBusy]=useState(false),[error,setError]=useState(''),[verified,setVerified]=useState(false),lock=useRef(false);
 const change=scheduleChange(task,draft.date),late=Boolean(change.later);
 useEffect(()=>{
  let live=true;
  repository.detail(task.request_id).then(detail=>{
   const current=detail.parts?.find(part=>part.id===task.part_id&&part.assignee_id===user.id);
   if(!current)throw new Error('forbidden');
   if(current.due_at!==task.due_at&&Date.parse(current.due_at)!==Date.parse(task.due_at))throw new Error('version_conflict');
   if(live)setVerified(true);
  }).catch(reason=>{if(live)setError(workError(reason));});
  return()=>{live=false;};
 },[task.request_id,task.part_id,user.id]);
 async function submit(event){
  event.preventDefault();if(lock.current||!verified)return;
  const next=scheduleChange(task,draft.date);
  if(next.error){setError(next.error);return;}
  if(next.later&&draft.reason.trim().length<3){setError('وضح سبب طلب التأجيل');return;}
  lock.current=true;setBusy(true);setError('');
  try{const result=await call('reschedule_task_due',{request_id:task.request_id,part_id:task.part_id,version:task.request_version,expected_due_at:task.due_at,due_at:next.due,reason:draft.reason,submission_key:draft.key});onSaved(result);}
  catch(reason){setError(workError(reason));}finally{lock.current=false;setBusy(false);}
 }
 return <PlannerDialog title="تنظيم موعد المهمة" onClose={onClose} busy={busy}><form onSubmit={submit}>
  <div className="w-planner-dialog-context"><strong>{task.request_title}</strong><span>{task.department} للعميل {task.client_name}</span></div>
  <div className="w-planner-date-pair"><span>الموعد الحالي<strong>{dateLabel(task.due_at)}</strong></span><span>{task.due_locked_by_admin?'حددته الإدارة':'موعدك المعتمد'}<small>نهاية اليوم بتوقيت الرياض</small></span></div>
  <DatePicker label="الموعد الجديد" name="due_at" value={draft.date} onChange={date=>setDraft(value=>({...value,date}))} min={riyadhDate()} max={plannerLastDate()} required disabled={busy}/>
  {late&&<label>سبب التأجيل<textarea required minLength={3} maxLength={2000} value={draft.reason} onChange={event=>setDraft(value=>({...value,reason:event.target.value}))} disabled={busy}/></label>}
  <p className="w-planner-policy">{late?'يصل طلب التأجيل للإدارة ويبقى موعدك الحالي معتمدا حتى الموافقة':task.due_locked_by_admin?'الموعد محدد من الإدارة ويمكنك طلب تأجيله للمراجعة':'تقديم الموعد يحدث تاريخ تسليم المهمة مباشرة'}</p>
  {error&&<p className="w-error" role="alert">{error}</p>}
  <div className="w-planner-form-actions"><button type="submit" className="a-primary" disabled={busy||!verified}>{busy?'جار الحفظ':late?'إرسال طلب التأجيل':'حفظ الموعد الجديد'}</button><button type="button" onClick={onClose} disabled={busy}>إلغاء</button></div>
 </form></PlannerDialog>;
}
const viewTypes=[{id:'list',label:'قائمة',Icon:List},{id:'table',label:'جدول',Icon:Table2},{id:'board',label:'كانبان',Icon:Columns3},{id:'calendar',label:'تقويم',Icon:CalendarDays},{id:'timeline',label:'خط زمني',Icon:GanttChart},{id:'workload',label:'توزيع مهامي',Icon:ChartNoAxesColumn}];
const boardStages=[{id:'new',label:'بانتظار استلامي',tone:'new'},{id:'active',label:'قيد التنفيذ',tone:'accepted'},{id:'waiting',label:'بانتظار إجراء',tone:'waiting'},{id:'review',label:'تحت المراجعة',tone:'review'},{id:'completed',label:'مكتملة',tone:'completed'}];
export default function TaskPlanner({user,onOpen,onChanged,onTransition,refreshKey=0}){
 const [savedMode,setMode]=useSessionState('planner:mode','board',{validate:value=>value==='schedule'||viewTypes.some(view=>view.id===value)}),mode=savedMode==='schedule'?'calendar':savedMode;
 const [filter,setFilter]=useSessionState('planner:filter','all',{validate:value=>value==='all'||plannerBuckets.some(item=>item.id===value)});
 const [search,setSearch]=useSessionState('planner:search',''),[pages,setPages]=useSessionState('planner:pages',{});
 const [department,setDepartment]=useSessionState('planner:department','all'),[priority,setPriority]=useSessionState('planner:priority','all');
 const [month,setMonth]=useSessionState('planner:month',riyadhDate().slice(0,7),{validate:value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(value)}),[day,setDay]=useSessionState('planner:day',riyadhDate());
 const [draft,setDraft]=useSessionState('planner:date-draft',null),[tick,setTick]=useState(0),[result,setResult]=useState({}),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true);
 const compact=useCompactPlanner();
 const [dragging,setDragging]=useState(null),[moveTask,setMoveTask]=useState(null),[moving,setMoving]=useState(false);
 useEffect(()=>{
  let live=true,running=false;
  async function load(){
   if(running)return;running=true;setLoading(true);
   try{const next=await collectPlannerTasks(page=>repository.personalPlanner({bucket:'all',page,sort:'due'}),()=>live);if(live&&next)setResult({owner:user.id,...next});}
   catch(reason){if(live)setResult(previous=>({...previous,error:reason?.message==='planner_snapshot_changed'?'تغيرت المهام أثناء تحميلها أعد المحاولة':workError(reason)}));}
   finally{running=false;if(live)setLoading(false);}
  }
  void load();const timer=setInterval(()=>{if(!document.hidden&&!draft)void load();},15000);
  return()=>{live=false;clearInterval(timer);};
 },[user.id,tick,Boolean(draft),refreshKey]);
 const ready=result.owner===user.id,counts=ready?result.counts:null,allTasks=ready?result.items:[];
 const departments=[...new Set(allTasks.map(task=>task.department))].sort((a,b)=>a.localeCompare(b,'ar'));
 const query=search.trim().toLocaleLowerCase('ar');
 const effectiveFilter=compact&&mode==='board'&&filter==='all'?'accepted':filter;
 const tasks=allTasks.filter(task=>(effectiveFilter==='all'||task.bucket===effectiveFilter)&&(department==='all'||task.department===department)&&(priority==='all'||task.priority===priority)&&(!query||[task.request_title,task.client_name,task.department,String(task.request_number)].some(value=>String(value||'').toLocaleLowerCase('ar').includes(query))));
 const page=Math.min(pages[mode]||0,Math.max(0,Math.ceil(tasks.length/40)-1)),pageTasks=tasks.slice(page*40,(page+1)*40);
 function choose(value){setFilter(value);setPages({});}
 function changeMonth(value){setMonth(value);setDay(value===riyadhDate().slice(0,7)?riyadhDate():`${value}-01`);}
 function schedule(task){setNotice('');setDraft({task,date:riyadhDate(task.due_at),reason:'',key:crypto.randomUUID()});}
 async function move(task,target){
  if(moving)return;
  if(!target){setMoveTask(task);return;}
  if(!plannerMoveAction(task,target)){setNotice('هذا الانتقال غير متاح للمهمة يجب إكمال إجراءات مرحلتها الحالية');return;}
  setMoving(true);setNotice('');
  try{await onTransition(task,target);setMoveTask(null);}catch(reason){setNotice(workError(reason));}finally{setMoving(false);setDragging(null);}
 }
 const renderTask=task=><TaskCard key={task.part_id} task={task} onOpen={onOpen} onSchedule={schedule} onMove={mode==='board'&&!moving&&onTransition?move:null} drag={mode==='board'&&!moving&&onTransition?{start:setDragging,end:()=>setDragging(null)}:null}/>;
 const shownStages=compact?boardStages.filter(stage=>stage.id===(effectiveFilter==='accepted'||effectiveFilter==='overdue'?'active':effectiveFilter)):boardStages;
 return <section className="w-planner" aria-labelledby="personal-planner-title">
  <header className="w-planner-heading"><div><span className="w-planner-eyebrow">جدول عملك</span><h3 id="personal-planner-title">مخطط مهامي</h3><p>مهامك الحالية ومواعيدها المعتمدة بالعرض الذي يناسب عملك</p></div></header>
  <div className="w-planner-view-tabs" aria-label="طريقة عرض المهام">{viewTypes.map(({id,label,Icon})=><button type="button" key={id} aria-pressed={mode===id} onClick={()=>setMode(id)}><Icon size={16} aria-hidden="true"/>{label}</button>)}</div>
  <div className="w-planner-tools"><label className="w-planner-search"><Search size={17} aria-hidden="true"/><span className="w-planner-sr">البحث في مهامي</span><input aria-label="البحث في مهامي" placeholder="اسم المهمة أو العميل" value={search} onChange={event=>{setSearch(event.target.value);setPages({});}}/></label><label className="w-planner-select"><span>القسم</span><select value={department} onChange={event=>{setDepartment(event.target.value);setPages({});}}><option value="all">كل أقسامي</option>{departments.map(name=><option key={name}>{name}</option>)}</select></label><label className="w-planner-select"><span>الأولوية</span><select value={priority} onChange={event=>{setPriority(event.target.value);setPages({});}}><option value="all">كل الأولويات</option><option value="normal">عادي</option><option value="urgent">مستعجل</option></select></label><button type="button" aria-label="تحديث مخطط المهام" disabled={loading} onClick={()=>setTick(value=>value+1)}><RefreshCw size={17} aria-hidden="true"/></button></div>
  <div className="w-planner-filters" aria-label="حالة المهام">{[{id:'all',label:'كل المهام'},...plannerBuckets].filter(item=>!(compact&&mode==='board'&&item.id==='all')).map(item=><button key={item.id} type="button" data-tone={item.tone} aria-pressed={effectiveFilter===item.id} onClick={()=>choose(item.id)}>{item.label}<bdi>{counts?.[item.id]??'—'}</bdi></button>)}</div>
  {notice&&<p className="w-planner-notice" role="status">{notice}</p>}
  {result.error&&<div className="w-planner-error" role="alert"><span>{result.error}{ready&&<small>تظهر آخر بيانات تم تحميلها</small>}</span><button type="button" onClick={()=>setTick(value=>value+1)}>إعادة المحاولة</button></div>}
  <div className="w-planner-content" aria-busy={loading}>
  {dragging&&compact&&<div className="w-planner-touch-targets" aria-label="اسحب المهمة إلى الإجراء المطلوب">{boardStages.filter(stage=>plannerMoveAction(dragging,stage.id)).map(stage=><button type="button" key={stage.id} data-drop-stage={stage.id} onClick={()=>move(dragging,stage.id)}>{stage.label}</button>)}<button type="button" onClick={()=>setDragging(null)}>إلغاء</button></div>}
  {!ready?<p className="w-planner-empty" role="status">{loading?'جار تحميل مهامك':'لم يتم تحميل المهام'}</p>:<>
   {mode==='board'?<><div className="w-planner-kanban">{shownStages.map(stage=>{const entries=tasks.filter(task=>plannerStage(task)===stage.id);return <section key={stage.id} className={`w-planner-lane is-${stage.tone} ${dragging&&plannerMoveAction(dragging,stage.id)?'is-drop-target':''}`} data-drop-stage={stage.id} onDragOver={event=>{if(dragging&&plannerMoveAction(dragging,stage.id)){event.preventDefault();event.dataTransfer.dropEffect='move';}}} onDrop={event=>{event.preventDefault();if(dragging&&event.dataTransfer.getData('text/plain')===dragging.part_id)void move(dragging,stage.id);}} aria-label={stage.label}><header><span className="w-planner-dot"/><h4>{stage.label}</h4><bdi>{entries.length}</bdi></header><div className="w-planner-lane-items" tabIndex={0} aria-label={`مهام ${stage.label}`}>{entries.length?entries.map(renderTask):<p className="w-planner-empty">لا توجد مهام في هذه الحالة</p>}</div></section>;})}</div></>:mode==='calendar'?<PlannerCalendar tasks={tasks} month={month} onMonth={changeMonth} day={day} onDay={setDay} compact={compact} renderTask={renderTask} onOpen={onOpen}/>:mode==='timeline'?<PlannerTimeline tasks={tasks} month={month} onMonth={changeMonth} onOpen={onOpen} compact={compact} renderTask={renderTask}/>:!tasks.length?<p className="w-planner-empty">لا توجد مهام تطابق الخيارات المحددة</p>:mode==='workload'?<PlannerWorkload tasks={tasks} renderTask={renderTask}/>:<><PlannerList tasks={pageTasks} table={mode==='table'} compact={compact} onOpen={onOpen} onSchedule={schedule}/>{tasks.length>40&&<PlannerPager page={page} total={tasks.length} hasNext={(page+1)*40<tasks.length} onPage={value=>setPages(current=>({...current,[mode]:value}))}/>}</>}
  </>}
  </div>
  {draft&&<ScheduleDialog key={draft.key} draft={draft} setDraft={setDraft} user={user} onClose={()=>setDraft(null)} onSaved={result=>{setDraft(null);setTick(value=>value+1);setNotice(result.outcome==='pending'?'أرسل طلب التأجيل للإدارة ويبقى موعدك الحالي معتمدا':'تم تحديث موعد المهمة');onChanged?.();}}/>}
  {moveTask&&<PlannerDialog title="نقل المهمة" busy={moving} onClose={()=>setMoveTask(null)}><div className="w-planner-dialog-context"><strong>{moveTask.request_title}</strong><span>{moveTask.department}</span></div><p className="w-planner-policy">أكمل متطلبات الإجراء وسجل ملاحظة لتثبيت الحالة الجديدة</p><div className="w-planner-move-options">{boardStages.filter(stage=>plannerMoveAction(moveTask,stage.id)).map(stage=><button type="button" key={stage.id} disabled={moving} onClick={()=>move(moveTask,stage.id)}><MoveRight size={16}/>{stage.id==='active'?'استلام وتحديد الموعد':stage.id==='review'?'رفع المخرجات للمراجعة':stage.id==='completed'?'تسليم المخرجات للقسم':'طلب بيانات أو مرفقات'}</button>)}</div></PlannerDialog>}
 </section>;
}
