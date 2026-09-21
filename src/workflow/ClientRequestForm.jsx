import React,{useEffect,useRef,useState} from 'react';
import {Paperclip,CheckCircle2,X} from 'lucide-react';
import {call,repository,uploadFile,workError} from './data';
import DatePicker from '../shared/DatePicker';
import {endOfRiyadhDay,riyadhDate} from '../shared/date-only';
import {useSessionState,useSessionStore} from '../shared/session-state';
import {DriveLinkField} from './DriveResource';
import {normalizeDriveUrl,requestDriveUrl} from './drive-resources';

const localDate=value=>value?riyadhDate(value):'';
const fileKey=file=>`${file.name}:${file.size}:${file.lastModified}`;
export default function ClientRequestForm({draft,service,formKey,onClose,onSent}){
 const prefix=`client:request-form:${formKey||draft?.id||'new'}:`;
 const store=useSessionStore();
 const [identity,setIdentity]=useSessionState(prefix+'identity',()=>({requestId:draft?.id||null,submissionKey:draft?.id||crypto.randomUUID()}));
 const [finishedKeys,setFinishedKeys]=useSessionState(prefix+'finished',[]);
 const [title,setTitle]=useSessionState(prefix+'title',draft?.title||'');
 const [driveUrl,setDriveUrl,driveDraft]=useSessionState(prefix+'drive-url',requestDriveUrl(draft));
 const dialog=useRef(null),locked=useRef(false),created=useRef(identity.requestId),submission=useRef(identity.submissionKey),abort=useRef(null),finished=useRef(new Set(finishedKeys)),uploadedFiles=useRef(new Map());
 const [brief,setBrief]=useSessionState(prefix+'brief',draft?.brief||''),[priority,setPriority]=useSessionState(prefix+'priority',draft?.priority||'normal'),[due,setDue]=useSessionState(prefix+'due',localDate(draft?.requested_due_at)),[files,setFiles]=useSessionState(prefix+'files',[]),[savedFiles,setSavedFiles]=useState([]),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
 function close(){store?.clearPrefix(prefix);onClose();}
 function sent(id){store?.clearPrefix(prefix);onSent(id);}
 function rememberRequest(id){created.current=id;setIdentity(current=>({...current,requestId:id}));}
 useEffect(()=>{setIdentity(identity);const old=document.activeElement;dialog.current.showModal();let live=true;if(created.current)repository.clientDetail(created.current).then(x=>{if(live){driveDraft.initialize(requestDriveUrl(x.request));setSavedFiles(x.files);setFiles(current=>current.filter(file=>!finished.current.has(fileKey(file))));if(x.request.status!=='draft')sent(x.request.id);}}).catch(e=>{if(live)setError(workError(e));});return()=>{live=false;abort.current?.abort();old?.focus?.();};},[]);
 function addFiles(e){
  const additions=Array.from(e.currentTarget.files||[]);
  setFiles(previous=>{
   const keys=new Set(previous.map(fileKey));
   return [...previous,...additions.filter(file=>{const key=fileKey(file);if(keys.has(key))return false;keys.add(key);return true;})];
  });
  e.currentTarget.value='';
 }
 async function submit(e){
  e.preventDefault();if(locked.current)return;
  if(title.trim().length<3||title.trim().length>200){setError('اكتب عنوانا واضحا للطلب من 3 إلى 200 حرف');return;}
  if(brief.trim().length<10){setError('وضح طلبك بعشر حروف على الأقل');return;}
  if(!due||new Date(endOfRiyadhDay(due))<=new Date()){setError('حدد تاريخ التسليم اليوم أو في المستقبل');return;}
  locked.current=true;setBusy(true);setError('');
  try{
   const drive_url=normalizeDriveUrl(driveUrl);
   const values={title:title.trim(),brief:brief.trim(),priority,requested_due_at:endOfRiyadhDay(due),submission_key:submission.current,...(drive_url?{drive_url}:{}),specifications:service?{'الخدمة المطلوبة':service.name,'معرف الخدمة':service.id}:{}};
   if(!created.current){const response=await call('create',values);rememberRequest(response.request_id);}
   let current=await repository.request(created.current);
   if(current.status!=='draft'){sent(current.id);return;}
   const pending=[];
   for(let i=0;i<files.length;i++){
    const file=files[i],key=fileKey(file);if(finished.current.has(key))continue;
    let uploaded=uploadedFiles.current.get(key);
    if(!uploaded){
     setUploading(true);abort.current=new AbortController();
     uploaded=await uploadFile(current.id,'brief',file,{signal:abort.current.signal,onProgress:n=>setProgress(`رفع الملف ${i+1} من ${files.length} بنسبة ${n}%`)});
     uploadedFiles.current.set(key,uploaded);
    }
    pending.push({key,...uploaded});
   }
   if(pending.length){
    setUploading(false);
    setProgress('جار حفظ مرفقات الطلب');
    current=await repository.request(current.id);
    try{await call('attach',{request_id:current.id,version:current.version,files:pending.map(({object_path,filename})=>({object_path,filename}))});}
    catch(e){const receipts=await Promise.all(pending.map(file=>repository.receipt('attach',file.object_path).catch(()=>null)));if(!receipts.every(Boolean))throw e;}
    for(const uploaded of pending){finished.current.add(uploaded.key);uploadedFiles.current.delete(uploaded.key);repository.forgetUpload(uploaded.cache_key);}
    setFinishedKeys([...finished.current]);
   }
   current=await repository.request(current.id);
   if(requestDriveUrl(current))values.drive_url=drive_url;
   await call('submit_request',{...values,request_id:current.id,version:current.version});
   sent(current.id);
  }catch(e){
   if(!created.current){const stored=await repository.request(submission.current).catch(()=>null);if(stored)rememberRequest(stored.id);}
   const stored=created.current?await repository.request(created.current).catch(()=>null):null;
   if(stored&&stored.status!=='draft'){sent(stored.id);return;}
   setError(e.message==='upload_paused'?'توقف الرفع مؤقتا اختر إرسال الطلب لاستكماله':`${workError(e)}${created.current?' طلبك محفوظ ويمكنك استكماله من مشاريعي':''}`);
  }finally{locked.current=false;setBusy(false);setUploading(false);setProgress('');}
 }
 return <dialog className="c-dialog c-root" ref={dialog} aria-labelledby="client-request-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
  <form className="c-request-form" onSubmit={submit}><header className="c-dialog-head"><div><span className="c-kicker">نبدأ من فكرتك</span><h2 id="client-request-title">{draft?'إكمال طلبك':'إنشاء طلب'}</h2></div><button type="button" aria-label="إغلاق إنشاء الطلب" disabled={busy} onClick={close}><X size={20} aria-hidden="true"/></button></header>
   <div className="c-dialog-intro"><p className="c-muted">صف ما تحتاجه والباقي على فريق الإشراف</p><span>ثلاث خطوات واضحة</span></div>
   {error&&<p className="c-notice c-error" role="alert">{error}</p>}
   <fieldset className="c-request-fields" disabled={busy}>
    <section className="c-form-section" aria-labelledby="request-brief-title"><header className="c-form-section-head"><span aria-hidden="true">١</span><div><h3 id="request-brief-title">تفاصيل الطلب</h3><p>وضح الفكرة والنتيجة التي تريد الوصول إليها</p></div></header>
     {service&&<div className="c-selected-service"><span>الخدمة المختارة</span><strong>{service.name}</strong><small>{service.description}</small></div>}
     <label><span className="c-field-label">عنوان الطلب <small>{title.length} من 200</small></span><input name="title" value={title} onChange={e=>setTitle(e.target.value)} required minLength={3} maxLength={200} placeholder="مثال تصميم هوية معرض سعودي دنت" aria-describedby="request-title-hint"/><small id="request-title-hint" className="c-muted">عنوان مختصر يميز طلبك ويظهر للفريق في المهمة</small></label>
     <label className="c-brief-field"><span className="c-field-label">وصف الطلب <small>{brief.length} من 12000</small></span><textarea value={brief} onChange={e=>setBrief(e.target.value)} required minLength={10} maxLength={12000} rows={6} placeholder="اكتب لنا ما تحتاجه وأي تفاصيل تساعدنا"/></label>
    </section>
    <section className="c-form-section" aria-labelledby="request-schedule-title"><header className="c-form-section-head"><span aria-hidden="true">٢</span><div><h3 id="request-schedule-title">الأولوية والموعد</h3><p>حدد مستوى الاستعجال وتاريخ التسليم المطلوب</p></div></header>
     <div className="c-form-row"><fieldset className="c-priority"><legend>حالة الطلب</legend>{[['normal','عادي'],['urgent','مستعجل']].map(([id,label])=><label key={id} className={priority===id?'is-selected':''}><input type="radio" name="priority" value={id} checked={priority===id} onChange={()=>setPriority(id)}/>{label}</label>)}</fieldset>
      <DatePicker label="تاريخ التسليم المطلوب" value={due} onChange={setDue} required disabled={busy} min={riyadhDate()} hint="التسليم حتى نهاية اليوم المختار بتوقيت الرياض"/></div>
    </section>
    <section className="c-form-section" aria-labelledby="request-files-title"><header className="c-form-section-head"><span aria-hidden="true">٣</span><div><h3 id="request-files-title">المرفقات</h3><p>اجمع الملفات التي تساعد الفريق على فهم طلبك</p></div></header>
     <label className="c-upload c-upload-append"><span><Paperclip size={20} aria-hidden="true"/>إضافة ملفات للطلب <small>اختياري</small></span><span className="c-file-picker">اختيار المرفقات</span><input type="file" multiple onChange={addFiles} aria-label="إضافة صور وفيديوهات وملفات للطلب"/><small>يمكنك إضافة الصور والفيديوهات والملفات على أكثر من مرة</small></label>
     {(files.length>0||savedFiles.length>0)&&<><p className="c-upload-count" role="status">المرفقات المضافة {files.length+savedFiles.length}</p><ul className="c-file-list">{savedFiles.map(f=><li key={f.id}><CheckCircle2 size={16} aria-hidden="true"/><span className="c-file-name" dir="auto">{f.filename}</span></li>)}{files.map(f=><li key={fileKey(f)}><Paperclip size={16} aria-hidden="true"/><span className="c-file-name" dir="auto">{f.name}</span><small>{Math.max(.1,f.size/1024**2).toFixed(1)} MB</small>{!finished.current.has(fileKey(f))&&<button type="button" aria-label={`إزالة المرفق ${f.name}`} onClick={()=>setFiles(previous=>previous.filter(item=>fileKey(item)!==fileKey(f)))}><X size={16} aria-hidden="true"/></button>}</li>)}</ul></>}
     <DriveLinkField value={driveUrl} onChange={setDriveUrl} disabled={busy}/>
    </section>
   </fieldset>
   {progress&&<p className="c-notice c-upload-progress" role="status">{progress}</p>}
   <footer className="c-actions c-dialog-actions"><button className="c-primary" disabled={busy} type="submit">{busy?'جار إرسال طلبك':'إرسال الطلب لالمشرف المسؤول'}</button>{uploading&&<button type="button" onClick={()=>abort.current?.abort()}>إيقاف الرفع مؤقتا</button>}</footer>
  </form>
 </dialog>;
}
