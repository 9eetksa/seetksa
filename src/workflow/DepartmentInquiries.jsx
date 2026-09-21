import React,{useEffect,useId,useRef,useState} from 'react';
import {AlertCircle,Files,MessageSquare,X,Trash2,UploadCloud} from 'lucide-react';
import {useSessionState,useSessionStore} from '../shared/session-state';
import {call,repository,uploadFile,when,workError} from './data';
import AttachmentActions from './AttachmentActions';
import {DriveLinkField,DriveResource} from './DriveResource';
import {normalizeDriveUrl} from './drive-resources';
import {inquiryGroups,isCoordinatorInquiry,selectedInquiries} from './inquiry-groups';
import './department-inquiries.css';

export function InquiryTriggers({inquiries=[],onOpen}){
 if(!inquiries.length)return null;
 return <div className="w-inquiry-triggers">{inquiryGroups(inquiries).map(({key:kind,label,rows,pending,answered})=>{
  const Icon=kind==='files'?Files:MessageSquare;
  return <button type="button" key={kind} aria-haspopup="dialog" onClick={()=>onOpen({kind})}><Icon size={21} aria-hidden="true"/><span><strong>{label}</strong><small>{answered>0&&<span className="w-inquiry-received">{answered} ردود متاحة</span>}{pending>0&&<span>{pending} بانتظار الرد</span>}{!answered&&!pending&&<span>{rows.length} {kind==='internal'?'توضيحات للفريق':'طلبات سابقة'}</span>}</small></span>{pending>0&&<AlertCircle className="w-inquiry-alert" size={18} aria-label="يوجد طلب معلق"/>}</button>;
 })}</div>;
}

function InquiryReply({inquiry,request,onSaved}){
 const prefix=`client:request:${request.id}:inquiry:${inquiry.id}:`,store=useSessionStore();
 const [reason,setReason]=useSessionState(prefix+'reason',''),[files,setFiles]=useSessionState(prefix+'files',[]);
 const [driveUrl,setDriveUrl]=useSessionState(prefix+'drive-url','');
 const [key,setKey]=useSessionState(prefix+'key',null),[version,setVersion]=useSessionState(prefix+'version',request.version);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(null),[sent,setSent]=useState(false);
 const locked=useRef(false),control=useRef(null);
 useEffect(()=>{if(!key)setKey(crypto.randomUUID());setVersion(version);return()=>control.current?.abort();},[]);
 async function submit(event){
  event.preventDefault();if(locked.current)return;locked.current=true;setBusy(true);setError('');
  control.current=new AbortController();const uploaded=[];
  try{
   const drive_url=normalizeDriveUrl(driveUrl);
   if(inquiry.kind==='files'&&!files.length&&!drive_url)throw new Error('inquiry_resource_required');
   for(const [index,file] of files.entries())uploaded.push(await uploadFile(request.id,'brief',file,{signal:control.current.signal,onProgress:percent=>setProgress({name:file.name,index:index+1,total:files.length,percent})}));
   await call('reply_department',{request_id:request.id,inquiry_id:inquiry.id,submission_key:key,version,reason,...(drive_url?{drive_url}:{}),files:uploaded.map(({object_path,filename})=>({object_path,filename}))});
   setSent(true);uploaded.forEach(file=>repository.forgetUpload(file.cache_key));store?.clearPrefix(prefix);setFiles([]);setReason('');setDriveUrl('');
   await onSaved();
  }catch(error){
   setError(error.message==='upload_paused'?'توقف الرفع ويمكنك استكماله':workError(error));
   // A conflict is displayed before the user may retry against a new snapshot
   if(error.message?.includes('version_conflict')){const snapshot=await repository.request(request.id).catch(()=>null);if(snapshot)setVersion(snapshot.version);}
  }finally{locked.current=false;setBusy(false);setProgress(null);}
 }
 if(sent)return <div className="w-inquiry-reply"><p role="status">وصل ردك إلى القسم</p>{error&&<><p role="alert">تعذر تحديث العرض بعد حفظ الرد</p><button type="button" onClick={()=>onSaved().catch(()=>setError('تعذر التحديث'))}>تحديث العرض</button></>}</div>;
 return <form className="w-inquiry-reply" onSubmit={submit}>
  <p>يصل ردك مباشرة إلى القسم وتتاح البيانات والمرفقات للأقسام المشاركة في طلبك</p>
  <label>{inquiry.kind==='files'?'ملاحظة على المرفقات اختياري':'ردك على القسم'}<textarea value={reason} onChange={event=>setReason(event.target.value)} rows={3} required={inquiry.kind==='data'} minLength={inquiry.kind==='data'?3:undefined} maxLength={4000} disabled={busy}/></label>
  <label className="w-inquiry-upload"><UploadCloud size={22} aria-hidden="true"/><strong>{inquiry.kind==='files'?'إضافة المرفقات المطلوبة':'إضافة مرفقات مع الرد'}</strong><span>اختيار الملفات بصيغتها الأصلية</span><input type="file" multiple disabled={busy} onChange={event=>{const selected=Array.from(event.target.files||[]);setFiles(current=>{const identities=new Set(current.map(file=>`${file.name}:${file.size}:${file.lastModified}`));return [...current,...selected.filter(file=>{const id=`${file.name}:${file.size}:${file.lastModified}`;if(identities.has(id))return false;identities.add(id);return true;})];});event.target.value='';}}/></label>
  {files.map((file,index)=><div className="w-inquiry-file" key={`${file.name}:${file.lastModified}:${index}`}><span dir="auto">{file.name}</span><button type="button" disabled={busy} aria-label={`إزالة ${file.name}`} onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))}><Trash2 size={17}/></button></div>)}
  <DriveLinkField value={driveUrl} onChange={setDriveUrl} disabled={busy}/>
  {progress&&<div role="status"><span dir="auto">{progress.name}</span><progress aria-label={`رفع الملف ${progress.index} من ${progress.total}`} max="100" value={progress.percent}/></div>}
  {error&&<p className="w-error" role="alert">{error}</p>}
  <button type="submit" className="a-primary" disabled={busy||!key||inquiry.kind==='files'&&!files.length&&!driveUrl.trim()}>{busy?'جار إرسال الرد':'إرسال الرد للقسم'}</button>
 </form>;
}

export function InquiryDialog({selection,inquiries=[],request,onClose,onSaved,onPreview}){
 const modal=useRef(null),id=useId();
 useEffect(()=>{const element=modal.current,previous=document.activeElement;element.showModal();return()=>{element.close();if(previous?.isConnected)previous.focus();};},[]);
 const rows=selectedInquiries(inquiries,selection);
 const title=selection.kind==='internal'?'توضيحات المشرف المسؤول':selection.kind==='coordinator'||selection.id&&isCoordinatorInquiry(rows[0]||{})?'طلبات المشرف المسؤول':selection.id?'طلب القسم':selection.kind==='files'?'مرفقات طلبتها الأقسام':'بيانات طلبتها الأقسام';
 return <dialog ref={modal} className="w-inquiry-dialog" dir="rtl" aria-labelledby={id} onCancel={event=>{event.preventDefault();event.stopPropagation();onClose();}}>
  <header><h3 id={id}>{title}</h3><button autoFocus type="button" onClick={onClose} aria-label="إغلاق طلبات البيانات والمرفقات"><X size={20}/></button></header>
  <div className="w-inquiry-body">{!rows.length&&<p>لا توجد طلبات في هذا القسم</p>}{rows.map(item=><article className="w-inquiry-item" key={item.id}>
   <div className="w-inquiry-heading"><h4>{item.source==='internal'?'توضيح للأقسام':isCoordinatorInquiry(item)?item.kind==='files'?'طلب مرفقات من العميل':'طلب بيانات من العميل':/^قسم\s/.test(item.department)?item.department:`قسم ${item.department}`}</h4><span className={item.source==='internal'||item.answered_at?'is-answered':item.closed?'is-closed':'w-inquiry-alert'}>{item.source!=='internal'&&!item.answered_at&&!item.closed&&<AlertCircle size={16}/>} {item.source==='internal'?'داخلي للفريق':item.answered_at?'تم الرد':item.closed?'طلب سابق':'بانتظار رد المشرف'}</span></div>
   {item.created_at&&<small>{when(item.created_at)}</small>}<h5>{item.source==='internal'?'المعلومة التوضيحية':isCoordinatorInquiry(item)?'رسالة المشرف المسؤول':'رسالة القسم'}</h5><p className="w-inquiry-message" dir="auto">{item.message}</p>
   {item.source==='internal'&&<><DriveResource url={item.drive_url}/>{(item.files||[]).map(file=><AttachmentActions key={file.id} file={file} onPreview={onPreview}/>)}</>}
   {item.answered_at&&<div className="w-inquiry-answer"><h5>{item.recorded_by_coordinator?'بيانات سجلها المشرف المسؤول':'رد المشرف'}</h5>{item.response&&<p className="w-inquiry-message" dir="auto">{item.response}</p>}<small>{when(item.answered_at)}</small><DriveResource url={item.response_drive_url}/>{isCoordinatorInquiry(item)&&item.files?.length>0&&<p className="w-inquiry-files-note">مرفقات أضافها العميل أثناء استكمال البيانات ومتاحة أيضا في مرفقات الطلب</p>}{(item.files||[]).map(file=><AttachmentActions key={file.id} file={file} onPreview={onPreview}/>)}</div>}
   {item.can_reply&&<InquiryReply inquiry={item} request={request} onSaved={onSaved}/>}
  </article>)}</div>
 </dialog>;
}
