import React,{useEffect,useRef,useState} from 'react';
import {Building2,CheckCircle2,FileImage,ImagePlus,ShieldCheck,UserRound} from 'lucide-react';
import {repository,workError} from './data';
import {accountRequest} from '../auth/supabase';
import {normalizePhone} from '../auth/account-rules';
import {useSessionState} from '../shared/session-state';

const LOGO_TYPES=new Set(['image/png','image/jpeg','image/webp']);
const LOGO_MAX_BYTES=5*1024*1024;

export default function ClientProfile({onChanged}){
 const [profile,setProfile]=useState(null);
 const [name,setName,nameDraft]=useSessionState('client:profile:name','');
 const [contactName,setContactName,contactDraft]=useSessionState('client:profile:contact','');
 const [phone,setPhone,phoneDraft]=useSessionState('client:profile:phone','');
 const [code,setCode]=useState('');
 const [challenge,setChallenge]=useState(null);
 const [logoFile,setLogoFile,logoDraft]=useSessionState('client:profile:logo',null);
 const [logoPreview,setLogoPreview]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [wait,setWait]=useState(0);
 const locked=useRef(false);
 const codeInput=useRef(null);
 const logoInput=useRef(null);
 const localLogoUrl=useRef('');

 function releaseLocalLogo(){
  if(!localLogoUrl.current)return;
  URL.revokeObjectURL(localLogoUrl.current);
  localLogoUrl.current='';
 }
 function applyProfile(nextProfile){
  setProfile(nextProfile);
  nameDraft.initialize(nextProfile.display_name||'');
  contactDraft.initialize(nextProfile.contact_name||'');
  phoneDraft.initialize(nextProfile.phone||'');
  if(!localLogoUrl.current)setLogoPreview(nextProfile.logo_url||'');
 }
 async function load({identity=false,phone=false}={}){
  const nextProfile=await repository.clientProfile();
  if(identity){nameDraft.clear();contactDraft.clear();}
  if(phone)phoneDraft.clear();
  applyProfile(nextProfile);
  onChanged?.(nextProfile);
 }
 function resetLogoSelection(){
  releaseLocalLogo();
  logoDraft.clear();
  setLogoPreview(profile?.logo_url||'');
  if(logoInput.current)logoInput.current.value='';
 }
 function selectLogo(event){
  const file=event.target.files?.[0];
  setError('');
  setMessage('');
  if(!file){resetLogoSelection();return;}
  if(!LOGO_TYPES.has(file.type)){
   resetLogoSelection();
   setError('اختر شعارا بصيغة PNG أو JPEG أو WEBP');
   return;
  }
  if(file.size>LOGO_MAX_BYTES){
   resetLogoSelection();
   setError('حجم الشعار يجب ألا يتجاوز 5 MB');
   return;
  }
  setLogoFile(file);
 }

 useEffect(()=>{
  let live=true;
  repository.clientProfile().then(nextProfile=>{
   if(live)applyProfile(nextProfile);
  }).catch(reason=>{
   if(live)setError(workError(reason));
  });
  return()=>{live=false;releaseLocalLogo();};
 },[]);
 useEffect(()=>{
  releaseLocalLogo();
  if(logoFile)localLogoUrl.current=URL.createObjectURL(logoFile);
  setLogoPreview(localLogoUrl.current||profile?.logo_url||'');
  return releaseLocalLogo;
 },[logoFile,profile?.logo_url]);
 useEffect(()=>{
  if(!wait)return;
  const id=setTimeout(()=>setWait(value=>Math.max(0,value-1)),1000);
  return()=>clearTimeout(id);
 },[wait]);
 useEffect(()=>{if(challenge)codeInput.current?.focus();},[challenge]);

 async function run(action){
  if(locked.current)return;
  locked.current=true;
  setBusy(true);
  setError('');
  setMessage('');
  try{await action();}
  catch(reason){setError(workError(reason));}
  finally{locked.current=false;setBusy(false);}
 }
 async function send(){
  const normalized=normalizePhone(phone);
  if(!normalized){setError('أدخل رقم جوال صحيحا مع مفتاح الدولة');return;}
  await run(async()=>{
   const response=await accountRequest({action:'client-phone-start',phone:normalized});
   setChallenge(response);
   setCode('');
   setWait(response.retryAfter);
   setMessage(response.delivery==='accepted'?'أرسلنا رمز التحقق إلى واتساب على الرقم الجديد':'طلبنا إرسال الرمز إن لم يصلك يمكنك إعادة الإرسال بعد دقيقة');
  });
 }

 const identityUnchanged=name.trim()===profile?.display_name&&(contactName.trim()||'')===(profile?.contact_name||'');

 return <section className="c-account">
  <div className="c-section-heading">
   <span className="c-kicker">حسابك</span>
   <h2>بياناتك في مكان واحد</h2>
   <p>يمكنك تحديث هوية الحساب واعتماد رقم جوال جديد عبر واتساب</p>
  </div>
  {error&&<p className="c-notice c-error" role="alert">{error}</p>}
  {message&&<p className="c-notice" role="status"><CheckCircle2 size={18}/>{message}</p>}
  {!profile?<button type="button" disabled={busy} onClick={()=>run(load)}>تحميل بيانات الحساب</button>:<div className="c-profile-grid">
   <form className="c-profile-identity-form" onSubmit={event=>{
    event.preventDefault();
    run(async()=>{
     await repository.saveClientProfile({display_name:name.trim(),contact_name:contactName.trim()||null,phone:profile.phone});
     setMessage('تم حفظ هوية الحساب');
     await load({identity:true});
    });
   }}>
    <header className="c-profile-card-heading">
     <span aria-hidden="true"><UserRound size={19}/></span>
     <div><h3>هوية الحساب</h3><p>بيانات الجهة والشخص المسؤول عن المتابعة</p></div>
    </header>
    <label>
     اسم الحساب أو الجهة
     <input value={name} onChange={event=>setName(event.target.value)} autoComplete="organization" required maxLength={120} disabled={busy}/>
    </label>
    <label>
     <span className="c-field-label"><span>اسم الشخص المسؤول</span><small>اختياري</small></span>
     <input value={contactName} onChange={event=>setContactName(event.target.value)} autoComplete="name" maxLength={120} disabled={busy}/>
    </label>
    <label>
     البريد المعتمد
     <input type="email" dir="ltr" value={profile.email||''} readOnly aria-describedby="client-email-note"/>
    </label>
    <p id="client-email-note" className="c-muted"><ShieldCheck size={17}/>تعديل البريد متاح للسوبر أدمن فقط</p>
    <button className="c-primary" disabled={busy||!name.trim()||identityUnchanged}>حفظ هوية الحساب</button>
   </form>

   <form className="c-profile-logo-form" onSubmit={event=>{
    event.preventDefault();
    run(async()=>{
     await repository.uploadClientLogo(logoFile);
     releaseLocalLogo();
     logoDraft.clear();
     if(logoInput.current)logoInput.current.value='';
     setMessage('تم رفع شعار الحساب');
     await load();
    });
   }}>
    <header className="c-profile-card-heading">
     <span aria-hidden="true"><ImagePlus size={19}/></span>
     <div><h3>شعار العميل</h3><p>شعار دائم يظهر مع هوية الحساب</p></div>
    </header>
    <div className="c-logo-stage">
     <div className="c-logo-preview">
      {logoPreview?<img src={logoPreview} alt="شعار العميل" onError={()=>setLogoPreview('')}/>:<Building2 size={34} aria-hidden="true"/>}
     </div>
     <div className="c-logo-copy">
      <strong>{profile.logo_path?'شعار الحساب محفوظ':'لم يرفع شعار بعد'}</strong>
      <p id="client-logo-help">استخدم صورة واضحة بصيغة PNG أو JPEG أو WEBP بحد أقصى 5 MB</p>
     </div>
    </div>
    <label className="c-logo-picker">
     <span><ImagePlus size={18}/>اختيار شعار</span>
     <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={selectLogo} disabled={busy} aria-describedby="client-logo-help"/>
    </label>
    {logoFile&&<div className="c-logo-file" role="status">
     <FileImage size={18} aria-hidden="true"/>
     <span dir="auto">{logoFile.name}</span>
     <button type="button" disabled={busy} onClick={resetLogoSelection}>إزالة</button>
    </div>}
    <button className="c-primary" disabled={busy||!logoFile}>رفع الشعار</button>
   </form>

   <form className="c-phone-form" onSubmit={event=>{
    event.preventDefault();
    if(!challenge){send();return;}
    run(async()=>{
     await accountRequest({action:'client-phone-verify',challengeId:challenge.challengeId,phone:challenge.phone,code});
     setChallenge(null);
     setCode('');
     await load({phone:true});
     setMessage('تم التحقق واعتماد رقم الجوال الجديد');
    });
   }}>
    <h3>رقم الجوال</h3>
    <p>رقمك المعتمد حاليا <b dir="ltr">{profile.phone}</b></p>
    <label>رقم الجوال الجديد<input type="tel" dir="ltr" autoComplete="tel" value={phone} maxLength={30} onChange={event=>{setPhone(event.target.value);setChallenge(null);setCode('');setMessage('');}} disabled={busy||!!challenge} required placeholder="05xxxxxxxx"/></label>
    {challenge&&<><p>أدخل الرمز المرسل إلى <b dir="ltr">{challenge.phone}</b></p><label>رمز التحقق<input ref={codeInput} inputMode="numeric" autoComplete="one-time-code" dir="ltr" value={code} onChange={event=>setCode(event.target.value.replace(/[٠-٩]/g,character=>String(character.charCodeAt(0)-1632)).replace(/\D/g,'').slice(0,6))} required minLength={6} maxLength={6} disabled={busy}/></label><small>الرمز صالح لخمس دقائق ورقمك الحالي يبقى معتمدا حتى نجاح التحقق</small></>}
    <div className="c-actions">
     <button className="c-primary" disabled={busy||(!challenge&&(wait>0||normalizePhone(phone)===profile.phone))}>{busy?'جار المتابعة':challenge?'تحقق واعتمد الجوال':'إرسال رمز واتساب'}</button>
     {challenge&&<><button type="button" disabled={busy||wait>0} onClick={send}>{wait>0?`إعادة الإرسال بعد ${wait} ثانية`:'إعادة إرسال الرمز'}</button><button type="button" disabled={busy} onClick={()=>{setChallenge(null);setCode('');}}>تغيير الرقم</button></>}
    </div>
   </form>
  </div>}
 </section>;
}
