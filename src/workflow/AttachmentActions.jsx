import React,{useRef,useState} from 'react';
import {Download,Eye} from 'lucide-react';
import {saveOriginal} from './attachment-files';
import './attachment-actions.css';

export default function AttachmentActions({file,onPreview,showName=true}){
 const lock=useRef(false);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 async function download(){
  if(lock.current)return;
  lock.current=true;setSaving(true);setError('');
  try{await saveOriginal(file);}catch{setError('تعذر بدء التحميل أعد المحاولة');}
  finally{lock.current=false;setSaving(false);}
 }
 return <div className={`file-actions${showName?' has-filename':''}`}>
  <button type="button" className="file-preview-button" aria-label={`معاينة ${file.filename}`} onClick={()=>onPreview(file)}><Eye size={18} aria-hidden="true"/><span>{showName?file.filename:'معاينة الملف'}</span></button>
  <button type="button" disabled={saving} aria-label={`تحميل ${file.filename} بصيغته الأصلية`} onClick={download}><Download size={18} aria-hidden="true"/>{saving?'جار بدء التحميل':'تحميل'}</button>
  {error&&<span className="file-action-error" role="alert">{error}</span>}
 </div>;
}
