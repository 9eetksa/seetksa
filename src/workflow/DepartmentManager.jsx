import React,{useEffect,useId,useRef,useState} from 'react';
import {
 Activity,AlertTriangle,BarChart3,Building2,Camera,CheckCircle2,Code2,Film,
 Megaphone,MessageSquare,PackageCheck,Palette,PenTool,Plus,Printer,
 RefreshCw,Save,Search,ShieldCheck,ShoppingBag,Sparkles,Users,Pencil,Trash2,X
} from 'lucide-react';
import {repository,workError} from './data';
import {useSessionState} from '../shared/session-state';
import {
 createDepartmentDraft,departmentDraftFingerprint,departmentBaseline,changeDepartmentMember,changeDepartmentLead,
 departmentToDraft,prepareDepartmentPayload
} from './department-team';
import './department-manager.css';
import './department-cards.css';
import {teamPeriodRange} from '../admin/team-overview-periods';
import {invalidateCatalog} from '../data/catalog-gateway';

function DepartmentIdentityDialog({value,busy,error,onClose,onSave}){
 const dialog=useRef(null),focusTarget=useRef(null),title=useId();
 const [name,setName]=useState(value.department.name);
 const deleting=value.action==='delete';
 useEffect(()=>{const previous=document.activeElement;dialog.current.showModal();focusTarget.current?.focus();if(!deleting)focusTarget.current?.select();return()=>{dialog.current?.close();if(previous?.isConnected)previous.focus();else document.querySelector('.dep-manager-heading button')?.focus();};},[]);
 return <dialog ref={dialog} className="dep-card-dialog dep-identity-dialog" aria-labelledby={title} aria-describedby={deleting?title+'-description':undefined} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <form onSubmit={event=>{event.preventDefault();if(!busy)onSave(deleting?null:name.trim());}}>
   <header className="dep-modal-heading"><h3 id={title}>{deleting?'حذف القسم':'تعديل مسمى القسم'}</h3><button type="button" disabled={busy} onClick={onClose} aria-label="إغلاق"><X size={20}/></button></header>
   <div className="dep-identity-body">
    {deleting?<p id={title+'-description'}>هل تريد حذف قسم «{value.department.name}» نهائيا؟ ستبقى حسابات الموظفين ولن يُحذف القسم إذا كان مرتبطا بطلبات أو مهام</p>:<label>اسم القسم<input ref={focusTarget} value={name} onChange={event=>setName(event.target.value)} minLength={2} maxLength={100} required disabled={busy} autoComplete="off"/></label>}
    {error&&<p className="dep-message is-error" role="alert">{error}</p>}
    <footer><button ref={deleting?focusTarget:undefined} className="dep-secondary-button" type="button" disabled={busy} onClick={onClose}>إلغاء</button><button className={deleting?'dep-primary-button dep-confirm-delete':'dep-primary-button'} type="submit" disabled={busy||(!deleting&&(name.trim().length<2||name.trim()===value.department.name))}>{busy?'جار الحفظ':deleting?'حذف نهائي':'حفظ المسمى'}</button></footer>
   </div>
  </form>
 </dialog>;
}

const icons=[
 ['building-2','مبنى',Building2],['printer','طباعة',Printer],
 ['palette','تصميم',Palette],['megaphone','تواصل',Megaphone],
 ['camera','تصوير',Camera],['film','مونتاج',Film],['code','تقنية',Code2],
 ['pen-tool','كتابة',PenTool],['message-square','محادثات',MessageSquare],
 ['shopping-bag','تجارة',ShoppingBag],['chart','تحليل',BarChart3],
 ['package-check','تسليم',PackageCheck],['sparkles','إبداع',Sparkles]
];
const iconMap=Object.fromEntries(icons.map(([value,,Icon])=>[value,Icon]));
const roleNames={super_admin:'سوبر أدمن',admin:'أدمن',employee:'موظف',coordinator:'مسؤول تواصل'};
const numberFormat=new Intl.NumberFormat('ar-SA',{maximumFractionDigits:1});

const personId=person=>String(person?.id??person?.user_id??'');
const personName=person=>person?.name||person?.full_name||person?.display_name||person?.email||'عضو الفريق';
const personTitle=person=>person?.job_title||person?.title||roleNames[person?.role]||'موظف';
const personPhone=person=>person?.phone||person?.phone_number||person?.mobile||'';

function normalizeDirectory(payload){
 const departments=Array.isArray(payload?.departments)?[...payload.departments]:[];
 const staff=Array.isArray(payload?.staff)?payload.staff.filter(person=>personId(person)):[];
 departments.sort((a,b)=>Number(a.sort_order??100)-Number(b.sort_order??100)||String(a.name||'').localeCompare(String(b.name||''),'ar'));
 staff.sort((a,b)=>personName(a).localeCompare(personName(b),'ar'));
 return {departments,staff};
}

function pickDepartment(directory,id,slug){
 return directory.departments.find(item=>item.id===id)
  ||directory.departments.find(item=>item.slug===slug)
  ||directory.departments[0]
  ||null;
}

function ErrorText({id,message}){
 return message?<span className="dep-field-error" id={id} role="alert">{message}</span>:null;
}

export default function DepartmentManager({onDirtyChange,initialDepartmentId}){
 const prefix=useId().replace(/:/g,'');
 const formRef=useRef(null);
 const nameRef=useRef(null);
 const requestedDepartmentRef=useRef(null);
 const modalRef=useRef(null);
 const [editorOpen,setEditorOpen]=useSessionState('departments.editorOpen',false,{validate:value=>typeof value==='boolean'});
 const [ratings,setRatings]=useState(null),[ratingError,setRatingError]=useState('');
 const [ratingRevision,setRatingRevision]=useState(0);
 const [departments,setDepartments]=useState([]);
 const [staff,setStaff]=useState([]);
 const [selectedId,setSelectedId,selectionState]=useSessionState('departments.selected',null,{validate:value=>value===null||typeof value==='string'});
 const [editor,setEditor,editorState]=useSessionState('departments.editor',null,{validate:value=>value===null||Boolean(value&&value.draft&&typeof value.baseline==='string'&&Array.isArray(value.draft.member_ids))});
 const draft=editor?.draft?departmentToDraft(editor.draft):null,baseline=departmentBaseline(editor?.baseline);
 const setDraft=next=>setEditor(current=>({...current,draft:typeof next==='function'?next(departmentToDraft(current?.draft)):next}));
 const [departmentSearch,setDepartmentSearch]=useSessionState('departments.search','',{validate:value=>typeof value==='string'});
 const [staffSearch,setStaffSearch]=useSessionState('departments.staffSearch','',{validate:value=>typeof value==='string'});
 const [staffFilter,setStaffFilter]=useSessionState('departments.staffFilter','all',{validate:value=>['all','selected','available'].includes(value)});
 const [filter,setFilter]=useSessionState('departments.filter','all',{validate:value=>['all','active','inactive'].includes(value)});
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [errors,setErrors]=useState({});
 const [identity,setIdentity]=useState(null),[identityError,setIdentityError]=useState('');

 useEffect(()=>{
  let live=true;
  setRatingError('');
  repository.departmentPerformance(teamPeriodRange('month')).then(result=>{if(live)setRatings(result);})
   .catch(reason=>{if(live)setRatingError(workError(reason));});
  return()=>{live=false;};
 },[ratingRevision]);
 useEffect(()=>{
  if(!editorOpen||!draft||loading)return;
  const dialog=modalRef.current,previous=document.activeElement;
  dialog.showModal();
  return()=>{dialog.close();if(previous?.isConnected)previous.focus();};
 },[editorOpen,Boolean(draft),loading]);

 useEffect(()=>{
  let active=true;
  repository.departmentDirectory().then(payload=>{
   if(!active)return;
   const directory=normalizeDirectory(payload);
   const selected=directory.departments.find(item=>item.id===(selectedId||initialDepartmentId))||directory.departments[0]||null;
   requestedDepartmentRef.current=initialDepartmentId;
   setDepartments(directory.departments);
   setStaff(directory.staff);
   if(selected){
    const next=departmentToDraft(selected);
    selectionState.initialize(selected.id);
    const savedEditor={draft:next,baseline:departmentDraftFingerprint(next)};
    if(editor&&departmentDraftFingerprint(editor.draft)===departmentBaseline(editor.baseline))setEditor(savedEditor);
    else editorState.initialize(savedEditor);
    if(initialDepartmentId)setEditorOpen(true);
   }
  }).catch(reason=>{if(active)setError(workError(reason));})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[]);

 const dirty=Boolean(draft&&departmentDraftFingerprint(draft)!==baseline);
 const departmentTerm=departmentSearch.trim().toLocaleLowerCase('ar');
 const staffTerm=staffSearch.trim().toLocaleLowerCase('ar');
 const visibleDepartments=departments.filter(department=>{
  if(filter==='active'&&department.active===false)return false;
  if(filter==='inactive'&&department.active!==false)return false;
  if(!departmentTerm)return true;
  return [department.name,department.category,department.description,
   ...(Array.isArray(department.responsibilities)?department.responsibilities.map(item=>item?.text??item):[]),
   ...(Array.isArray(department.tasks)?department.tasks.map(item=>item?.text??item?.title??item):[])
  ].some(value=>String(value||'').toLocaleLowerCase('ar').includes(departmentTerm));
 });
 const visibleStaff=staff.filter(person=>{
  if(staffFilter==='selected'&&!draft?.member_ids.includes(personId(person)))return false;
  if(staffFilter==='available'&&person.departments?.length)return false;
  return [personName(person),personTitle(person),person.email,personPhone(person),...(person.departments||[]).map(item=>item.name)]
   .some(value=>String(value||'').toLocaleLowerCase('ar').includes(staffTerm));
 });

 const activeCount=departments.filter(department=>department.active!==false).length;

 useEffect(()=>{
  if(!initialDepartmentId||loading||requestedDepartmentRef.current===initialDepartmentId)return;
  const selected=departments.find(item=>item.id===initialDepartmentId);
  if(!selected)return;
  requestedDepartmentRef.current=initialDepartmentId;
  if(confirmDiscard()){loadDraft(selected);setEditorOpen(true);}
 },[initialDepartmentId,loading,departments]);

 useEffect(()=>{
  onDirtyChange?.(dirty);
  return()=>onDirtyChange?.(false);
 },[dirty,onDirtyChange]);

 function confirmDiscard(){
  return !dirty||window.confirm('لديك تعديلات غير محفوظة هل تريد تجاهلها');
 }
 function loadDraft(department){
  const next=departmentToDraft(department);
  setSelectedId(department.id);
  editorState.clear();
  editorState.initialize({draft:next,baseline:departmentDraftFingerprint(next)});
  setErrors({});
  setNotice('');
  setStaffSearch('');
  setStaffFilter('all');
 }
 function openDepartment(department){
  if(loading||busy)return;
  if(department.id===selectedId){if(!dirty)loadDraft(department);setEditorOpen(true);return;}
  if(confirmDiscard()){loadDraft(department);setEditorOpen(true);}
 }
 function startDepartment(){
  if(loading||busy||!confirmDiscard())return;
  const next=createDepartmentDraft();
  setSelectedId('new');
  setEditor({draft:next,baseline:departmentDraftFingerprint(next)});
  setEditorOpen(true);
  setErrors({});
  setNotice('');
  setStaffSearch('');
  setStaffFilter('all');
  requestAnimationFrame(()=>nameRef.current?.focus());
 }
 function openIdentity(department,action){
  if(loading||busy||!confirmDiscard())return;
  loadDraft(department);setIdentityError('');setIdentity({department,action});
 }
 async function saveIdentity(name){
  if(busy||!identity)return;
  setBusy(true);setIdentityError('');setNotice('');
  try{
   const saved=await repository.departmentIdentity(identity.action,identity.department,name);
   invalidateCatalog('services');
   setDepartments(current=>saved.deleted?current.filter(department=>department.id!==saved.id):current.map(department=>department.id===saved.id?{...department,...saved}:department));
   editorState.clear();setEditorOpen(false);setIdentity(null);
   await refresh(saved.deleted?null:saved.id,saved.deleted?null:identity.department.slug);
   setNotice(saved.deleted?'تم حذف القسم دون حذف حسابات موظفيه':'تم تعديل اسم القسم');
  }catch(reason){setIdentityError(workError(reason));}finally{setBusy(false);}
 }
 function patch(field,value){
  setDraft(current=>({...current,[field]:value}));
  setErrors(current=>{
   if(!current[field]&&!(field==='member_ids'&&current.members))return current;
   const next={...current};
   delete next[field];
   if(field==='member_ids')delete next.members;
   return next;
  });
 }
 function toggleMember(id,checked){
  setDraft(current=>changeDepartmentMember(current,id,checked));
  setErrors(current=>({...current,members:undefined,lead_user_ids:undefined}));
 }
 function toggleLead(id,checked){
  setDraft(current=>changeDepartmentLead(current,id,checked));
  setErrors(current=>({...current,members:undefined,lead_user_ids:undefined}));
 }
 function install(payload,id,slug){
  const directory=normalizeDirectory(payload);
  const selected=pickDepartment(directory,id,slug);
  setDepartments(directory.departments);
  setStaff(directory.staff);
  if(!selected){setSelectedId(null);editorState.clear();editorState.initialize(null);return;}
  loadDraft(selected);
 }
 async function refresh(id=selectedId,slug=draft?.slug){
  setLoading(true);setError('');
  try{install(await repository.departmentDirectory(),id,slug);setRatingRevision(value=>value+1);return true;}
  catch(reason){setError(workError(reason));return false;}
  finally{setLoading(false);}
 }
 async function reload(){
  if(busy||!confirmDiscard())return;
  setNotice('');
  await refresh();
 }
 async function save(event){
  event.preventDefault();
  if(loading||busy||!draft)return;
  const prepared=prepareDepartmentPayload(draft,staff);
  if(!prepared.valid){
   setErrors(prepared.errors);
   setNotice('');
   requestAnimationFrame(()=>formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
   return;
  }
  setBusy(true);setError('');setNotice('');
  try{
   const result=await repository.saveDepartmentTeam(prepared.payload);
   const saved=Array.isArray(result)?result[0]:result?.department||result;
   editorState.clear();
   const refreshed=await refresh(saved?.id||prepared.payload.id,prepared.payload.slug);
   if(!refreshed){
    const next=departmentToDraft({...draft,...saved,version:saved?.version??(prepared.payload.version===null?null:prepared.payload.version+1)});
    setSelectedId(next.id||'new');
    editorState.initialize({draft:next,baseline:departmentDraftFingerprint(next)});
    return;
   }
   setErrors({});
   setNotice('تم حفظ القسم وتحديث عضويات الموظفين في بياناتهم');
   setEditorOpen(false);
  }catch(reason){setError(workError(reason));}
  finally{setBusy(false);}
 }

 return <section className="dep-manager" dir="rtl" aria-labelledby="department-manager-title" aria-busy={loading||busy}>
  <header className="dep-manager-heading">
   <div><span className="dep-eyebrow">هيكل الفريق</span><h2 id="department-manager-title">إدارة الأقسام</h2>
    <p>حدد أعضاء كل قسم ومسؤوليه وتابع أداء الفريق</p></div>
   <div className="dep-heading-actions">
    <button type="button" className="dep-secondary-button" onClick={reload} disabled={loading||busy}><RefreshCw size={18} aria-hidden="true"/>تحديث</button>
    <button type="button" className="dep-primary-button" onClick={startDepartment} disabled={loading||busy}><Plus size={18} aria-hidden="true"/>إضافة قسم</button>
   </div>
  </header>

  {notice&&<div className="dep-message is-success" role="status" aria-live="polite"><CheckCircle2 size={19} aria-hidden="true"/><span>{notice}</span></div>}
  {error&&<div className="dep-message is-error" role="alert"><AlertTriangle size={19} aria-hidden="true"/><span>{error}</span><button type="button" onClick={reload} disabled={loading}>إعادة المحاولة</button></div>}

  <div className="dep-cards-toolbar">
   <label className="dep-search-field"><Search size={18} aria-hidden="true"/><input aria-label="البحث في الأقسام" type="search" value={departmentSearch} onChange={event=>setDepartmentSearch(event.target.value)} placeholder="ابحث عن قسم"/></label>
   <select aria-label="حالة الأقسام" value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">كل الأقسام</option><option value="active">المفعلة</option><option value="inactive">المتوقفة</option></select>
   <span>{departments.length} قسم</span><span>{activeCount} مفعل</span>
  </div>
  {loading&&!departments.length?<p role="status">جار تحميل الأقسام</p>:<div className="dep-cards-grid">
   {visibleDepartments.map(department=>{
    const members=department.members||[],leads=members.filter(member=>member.member_role==='lead');
    const leaders=leads.map(lead=>staff.find(person=>personId(person)===lead.user_id)),Icon=iconMap[department.icon]||Building2;
    const rating=ratings?.departments?.find(row=>row.id===department.id);
    const pending=dirty&&draft?.id===department.id;
    return <article className="dep-card" key={department.id}>
     <header><span className="dep-card-icon"><Icon size={23} aria-hidden="true"/></span><div><h3>{department.name}</h3><span className="dep-card-state">{department.active?'مفعل':'متوقف'}</span></div></header>
     <div className="dep-card-lead"><span>مسؤولو القسم</span>{leaders.length?leaders.map((leader,index)=><strong key={leads[index].user_id}>{personName(leader)}</strong>):<strong>لم يحدد</strong>}</div>
     {pending&&<p className="dep-card-draft" role="status">لديك تعديلات غير محفوظة على أعضاء القسم ومسؤوليه</p>}
     <div className="dep-card-members"><span>فريق القسم <bdi>{members.length}</bdi></span><div>{members.length?members.map(member=><span key={member.user_id}>{personName(staff.find(person=>personId(person)===member.user_id))}{member.member_role==='lead'&&<ShieldCheck size={13} aria-label="مسؤول القسم"/>}</span>):<small>لم يحدد أعضاء القسم</small>}</div></div>
     <div className="dep-card-rating"><div><span>تقييم القسم هذا الشهر</span><strong>{ratingError?'تعذر التحميل':!rating?'جار التحميل':rating.insufficient_data?'التقييم قيد الاكتمال':`${rating.performance_score} / 100`}</strong></div>
      {rating?.insufficient_data&&<p className="dep-card-rating-hint">يكتمل التقييم عند إنجاز 5 مهام و10 نقاط جهد خلال الشهر</p>}
      {rating&&<dl><div><dt>منجز</dt><dd>{rating.completed_count}</dd></div><div><dt>الإنتاجية</dt><dd>{rating.productivity_score==null?'غير متاح':`${rating.productivity_score}%`}</dd></div><div><dt>السرعة</dt><dd>{rating.speed_score==null?'غير متاح':`${rating.speed_score}%`}</dd></div></dl>}
     </div>
     <button type="button" className="dep-secondary-button" onClick={()=>openDepartment(department)} disabled={loading||busy}><Users size={17} aria-hidden="true"/>تحديد الأعضاء والمسؤولين</button>
     <div className="dep-identity-actions"><button type="button" className="dep-secondary-button" disabled={loading||busy} onClick={()=>openIdentity(department,'rename')} aria-label={`تعديل اسم ${department.name}`}><Pencil size={16} aria-hidden="true"/>تعديل المسمى</button><button type="button" className="dep-secondary-button dep-delete-button" disabled={loading||busy} onClick={()=>openIdentity(department,'delete')} aria-label={`حذف قسم ${department.name}`}><Trash2 size={16} aria-hidden="true"/>حذف القسم</button></div>
    </article>;
   })}
   {!visibleDepartments.length&&<p role="status">{departments.length?'لا توجد أقسام مطابقة للبحث':'أضف أول قسم وحدد مسؤوله وفريقه'}</p>}
  </div>}
  {identity&&<DepartmentIdentityDialog key={identity.department.id+identity.action} value={identity} busy={busy} error={identityError} onClose={()=>setIdentity(null)} onSave={saveIdentity}/>}
  <details className="dep-rating-policy"><summary>كيف يقاس أداء الأقسام</summary><p>تقييم مستقل من مهام القسم خلال الشهر الحالي بتوقيت الرياض يجمع سرعة التنفيذ بنسبة 65% والإنتاجية بنسبة 35% والنتيجة تحتاج خمس مهام منجزة وعشر نقاط جهد على الأقل</p><p>الإنتاجية تقيس الجهد المنجز من العمل المسند خلال الفترة مع المهام السابقة المنجزة فيها والسرعة تقارن الوقت الفعلي بالوقت المستهدف وقد تشمل أوقاتا تقديرية للمهام القديمة</p></details>
  {editorOpen&&draft&&<dialog ref={modalRef} className="dep-card-dialog" aria-labelledby={prefix+'-dialog-title'} onCancel={event=>{event.preventDefault();if(!busy)setEditorOpen(false);}}>
   <div className="dep-modal-heading"><div><small>{draft.id?'تعديل القسم':'إضافة قسم'}</small><h3 id={prefix+'-dialog-title'}>{draft.name.trim()||'قسم جديد'}</h3><span className="dep-modal-save-status" role="status">{dirty?'تعديلات غير محفوظة':'البيانات محفوظة'}</span></div><div className="dep-modal-actions"><button type="submit" form={prefix+'-department-form'} className="dep-primary-button" disabled={busy||loading||!dirty}>{busy?'جار الحفظ':'حفظ التعديلات'}</button><button type="button" disabled={busy} onClick={()=>setEditorOpen(false)}>إغلاق</button></div></div>
   {error&&<p className="dep-message is-error" role="alert">{error}</p>}
    <form id={prefix+'-department-form'} ref={formRef} className="dep-editor" onSubmit={save} noValidate><fieldset className="dep-editor-lock" disabled={loading||busy}>
     <div className="dep-editor-layout">
      <div className="dep-form-sections">
       <section className="dep-form-section" aria-labelledby={prefix+'-team-title'}>
        {!draft.id&&<div className="dep-field"><label htmlFor={prefix+'-name'}>اسم القسم</label>
         <input ref={nameRef} id={prefix+'-name'} value={draft.name} onChange={event=>patch('name',event.target.value)}
          required minLength="2" maxLength="100" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name?prefix+'-name-error':undefined}/>
         <ErrorText id={prefix+'-name-error'} message={errors.name}/></div>}
        <div className="dep-section-heading"><span className="dep-section-icon"><Users size={18} aria-hidden="true"/></span>
         <div><h4 id={prefix+'-team-title'}>الأعضاء والمسؤولون</h4><p>يمكن اختيار أكثر من مسؤول للقسم واختيار المسؤول يضيفه إلى الأعضاء تلقائيا</p></div></div>
        <div className="dep-team-toolbar">
         <label className="dep-search-field dep-staff-search" htmlFor={prefix+'-staff-search'}>
          <span className="dep-sr-only">البحث بالاسم أو الجوال أو البريد أو القسم</span><Search size={18} aria-hidden="true"/>
          <input id={prefix+'-staff-search'} type="search" value={staffSearch} onChange={event=>setStaffSearch(event.target.value)}
           placeholder="ابحث بالاسم أو الجوال أو البريد"/>
         </label>
         <label className="dep-filter-field" htmlFor={prefix+'-staff-filter'}>
          <span className="dep-sr-only">عرض أعضاء الفريق</span>
          <select id={prefix+'-staff-filter'} value={staffFilter} onChange={event=>setStaffFilter(event.target.value)}>
           <option value="all">كل الموظفين</option><option value="selected">أعضاء هذا القسم</option><option value="available">دون قسم</option>
          </select>
         </label>
        </div>
        <div className="dep-team-count" role="status" aria-live="polite"><span>{numberFormat.format(visibleStaff.length)} موظف في العرض</span>
         <strong>{numberFormat.format(draft.member_ids.length)} أعضاء <span aria-hidden="true">/</span> {numberFormat.format(draft.lead_user_ids.length)} مسؤولون</strong></div>
        <div className="dep-team-table-wrap" role="group" tabIndex="-1" aria-label="اختيار أعضاء القسم ومسؤوليه"
         aria-invalid={Boolean(errors.members||errors.lead_user_ids)}
         aria-describedby={[errors.members&&prefix+'-members-error',errors.lead_user_ids&&prefix+'-lead-error'].filter(Boolean).join(' ')||undefined}>
         <table className="dep-team-table">
          <caption className="dep-sr-only">موظفو القسم مع اختيار العضوية والمسؤولية</caption>
          <thead><tr><th scope="col">الموظف</th><th scope="col" className="dep-check-column">عضو</th><th scope="col" className="dep-check-column">مسؤول</th></tr></thead>
          <tbody>{visibleStaff.map(person=>{
           const id=personId(person),selected=draft.member_ids.includes(id),lead=draft.lead_user_ids.includes(id);
           return <tr key={id} className={selected?'is-selected':undefined}>
            <th scope="row"><span className="dep-table-name">{personName(person)}</span><small>{personTitle(person)}</small>
             {person.departments?.length>0&&<div className="dep-table-departments">{person.departments.map(department=><span key={department.id}>{department.name}</span>)}</div>}
            </th>
            <td><label className="dep-table-check"><input type="checkbox" checked={selected} onChange={event=>toggleMember(id,event.target.checked)} aria-label={'عضوية '+personName(person)+' في القسم'}/></label></td>
            <td><label className="dep-table-check"><input type="checkbox" checked={lead} onChange={event=>toggleLead(id,event.target.checked)} aria-label={'مسؤولية '+personName(person)+' عن القسم'}/></label></td>
           </tr>;
          })}</tbody>
         </table>
         {!visibleStaff.length&&<p className="dep-table-empty" role="status">{staff.length?'لا توجد نتائج مطابقة للبحث':'لا يوجد موظفون متاحون'}</p>}
        </div>
        <ErrorText id={prefix+'-members-error'} message={errors.members}/>
        <ErrorText id={prefix+'-lead-error'} message={errors.lead_user_ids}/>
       </section>



      </div>

      <div className="dep-summary-column">

       <div className="dep-save-panel">
        <span><Save size={17} aria-hidden="true"/>{dirty?'تعديلات جاهزة للحفظ':'البيانات محدثة'}</span>
        <button type="submit" className="dep-primary-button" disabled={busy||!dirty}>
         {busy?<Activity className="dep-spin" size={18} aria-hidden="true"/>:<Save size={18} aria-hidden="true"/>}
         {busy?'جار حفظ القسم':'حفظ القسم'}
        </button>
       </div>
      </div>
     </div>
    </fieldset></form>
  </dialog>}
 </section>;
}
