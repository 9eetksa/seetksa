import React,{useEffect,useRef,useState} from 'react';
import {accountRequest} from '../auth/supabase';
import {workError} from '../workflow/data';
import {useSessionState} from '../shared/session-state';
export default function ClientEmailDialog({client,onClose:dismiss,onSaved}){
 const ref=useRef(null),locked=useRef(false);const [email,setEmail,draft]=useSessionState(`client-email:${client.id}`,client.email||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const onClose=()=>{draft.clear();dismiss();};
 useEffect(()=>{const old=document.activeElement;ref.current.showModal();return()=>old?.focus?.();},[]);
 async function submit(e){e.preventDefault();if(locked.current)return;locked.current=true;setBusy(true);setError('');let saved=false;try{await accountRequest({action:'update-client-email',userId:client.id,email});saved=true;}catch(e){setError(workError(e));}finally{locked.current=false;setBusy(false);}if(saved){onClose();onSaved();}}
 return <dialog className="a-account-dialog" dir="rtl" ref={ref} aria-labelledby="client-email-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><header><h2 id="client-email-title">تعديل بريد العميل</h2><button disabled={busy} onClick={onClose}>إغلاق</button></header><p>{client.display_name}</p>{error&&<p role="alert" className="a-notice">{error}</p>}<form onSubmit={submit}><fieldset disabled={busy}><label>البريد الإلكتروني الجديد<input type="email" dir="ltr" autoComplete="off" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label><p>سيعتمد البريد الجديد للدخول إلى حساب العميل</p><button className="a-primary" disabled={busy}>{busy?'جار الحفظ':'اعتماد البريد الجديد'}</button></fieldset></form></dialog>;
}
