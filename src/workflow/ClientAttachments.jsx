import React,{useEffect,useId,useRef,useState} from 'react';
import {ArrowUpLeft,Files,FileText,Image,Film,Music2,X} from 'lucide-react';
import AttachmentActions from './AttachmentActions';
import './client-attachments.css';

function fileIdentity(filename){
 const extension=filename?.includes('.')?filename.split('.').pop().toLowerCase():'';
 const Icon=['png','jpg','jpeg','webp','gif','svg','avif'].includes(extension)?Image
  :['mp4','mov','webm','m4v'].includes(extension)?Film
  :['mp3','wav','m4a','ogg'].includes(extension)?Music2:FileText;
 return {Icon,label:extension&&extension.length<=8?extension.toUpperCase():'ملف'};
}

export default function ClientAttachments({files,onPreview}){
 const [open,setOpen]=useState(false);
 const trigger=useRef(null),dialog=useRef(null),id=useId();
 useEffect(()=>{
  if(!open)return;
  const modal=dialog.current,opener=trigger.current;
  modal.showModal();
  return()=>{modal.close();if(opener?.isConnected)opener.focus();};
 },[open]);
 function closeOnBackdrop(event){
  if(event.target!==event.currentTarget)return;
  const {left,right,top,bottom}=event.currentTarget.getBoundingClientRect();
  if(event.clientX<left||event.clientX>right||event.clientY<top||event.clientY>bottom)setOpen(false);
 }
 return <>
  <button ref={trigger} type="button" className="c-attachments-trigger" aria-label={`عرض مرفقات الطلب وعددها ${files.length}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(true)}>
   <span className="c-attachments-symbol" aria-hidden="true"><Files size={25} strokeWidth={1.5}/><span className="c-attachments-count" dir="ltr">{files.length}</span></span>
   <span className="c-attachments-caption"><strong>مرفقات الطلب</strong><small>استعراض الملفات</small></span>
   <ArrowUpLeft className="c-attachments-open" size={18} aria-hidden="true"/>
  </button>
  {open&&<dialog ref={dialog} id={id} className="c-attachments-dialog c-root" dir="rtl" aria-labelledby={`${id}-title`} aria-describedby={`${id}-count`} onCancel={event=>{event.preventDefault();setOpen(false);}} onClick={closeOnBackdrop}>
   <header className="c-attachments-header">
    <div><h3 id={`${id}-title`}>مرفقات الطلب</h3><p id={`${id}-count`}>عدد المرفقات <b dir="ltr">{files.length}</b></p></div>
    <button type="button" className="c-attachments-close" aria-label="إغلاق المرفقات" autoFocus onClick={()=>setOpen(false)}><X size={20} aria-hidden="true"/></button>
   </header>
   <ul className="c-attachments-list">{files.map(file=>{
    const {Icon,label}=fileIdentity(file.filename);
    return <li key={file.id||file.object_path} className="c-attachment-item">
     <span className="c-attachment-type" aria-hidden="true"><Icon size={22} strokeWidth={1.5}/><span dir="auto">{label}</span></span>
     <div className="c-attachment-content"><p dir="auto">{file.filename}</p><AttachmentActions file={file} onPreview={onPreview} showName={false}/></div>
    </li>;
   })}</ul>
  </dialog>}
 </>;
}
