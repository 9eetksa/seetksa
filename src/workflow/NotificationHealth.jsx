import React,{useEffect,useState} from 'react';
import {RefreshCw,ShieldCheck,AlertTriangle} from 'lucide-react';
import {repository,when} from './data';

const explanations={
 worker_stale:'تأخرت متابعة عامل الإرسال ويحتاج الاتصال بالخدمة إلى مراجعة',
 provider_unavailable:'اتصال واتساب غير جاهز وستستكمل الرسائل المؤكدة بعد عودته',
 probe_failed:'تعذر التحقق من طابور Green API ولا يمكن تأكيد حالته الآن',
 provider_queue_stalled:'توجد رسائل في طابور Green API لم تتقدم منذ خمس دقائق',
 dispatch_stalled:'تأخر تجهيز بعض الرسائل ويتابع العامل استكمالها بأمان',
 uncertain:'توجد رسائل نتيجتها غير مؤكدة وتحتاج مراجعة قبل أي إعادة إرسال',
 failed:'توجد رسائل استنفدت محاولات الإرسال وتحتاج مراجعة الاتصال أو رقم المستلم',
 awaiting_delivery:'قبل المزود رسائل لم يصل تأكيد تسليمها بعد وقد يكون المستلم غير متصل'
};

export default function NotificationHealth(){
 const [data,setData]=useState(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  let live=true,running=false;
  async function refresh(){
   if(running)return;running=true;if(live)setBusy(true);
   try{const next=await repository.notificationMonitor();if(live){setData(next);setError(false);}}
   catch{if(live)setError(true);}
   finally{running=false;if(live)setBusy(false);}
  }
  refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},60000);
  return()=>{live=false;clearInterval(timer);};
 },[revision]);
 const attention=error||data?.issue;
 const Icon=attention?AlertTriangle:ShieldCheck;
 return <section className="op-whatsapp-health" aria-label="متابعة وصول رسائل واتساب" aria-busy={busy}>
  <div><Icon size={22} aria-hidden="true"/><h3>متابعة وصول رسائل واتساب</h3><button type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={17} aria-hidden="true"/>تحديث الحالة</button></div>
  <p role={attention?'alert':'status'}>{error?'تعذر تحميل حالة الإرسال أعد المحاولة':!data?'جار التحقق من حالة الإرسال':data.issue?explanations[data.issue]||'تحتاج حالة الإرسال إلى مراجعة':'المتابعة الآلية تعمل ولا توجد مؤشرات تعليق حاليا'}</p>
  {data&&!error&&<><dl><div><dt>بانتظار الإرسال</dt><dd>{data.queued}</dd></div><div><dt>في طابور المزود</dt><dd>{data.provider_queue}{data.provider_queue>=500?'+':''}</dd></div><div><dt>بانتظار تأكيد التسليم</dt><dd>{data.awaiting_delivery}</dd></div><div><dt>تحتاج مراجعة</dt><dd>{data.uncertain+data.failed}</dd></div></dl><small>آخر تحقق {when(data.checked_at)}</small></>}
  <small>تفحص المنصة الإرسال كل دقيقة وتراجع تأكيدات المزود دوريا ولا تعيد الرسائل غير المؤكدة تلقائيا</small>
 </section>;
}
