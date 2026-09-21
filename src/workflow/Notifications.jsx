import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {Bell,CheckCheck,X} from 'lucide-react';
import {repository,call} from './data';
import NotificationCopy from './NotificationCopy';
import './notifications.css';
import './notification-dialog.css';
import {notificationDestination} from '../missions/mission-navigation';
export default function Notifications({user,onOpen,variant='default'}){
 const [items,setItems]=useState([]),[unreadCount,setUnreadCount]=useState(0),[open,setOpen]=useState(false),[error,setError]=useState('');
 const panelId=useId(),root=useRef(null),panel=useRef(null),trigger=useRef(null),closeButton=useRef(null),wasOpen=useRef(false);
 const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width: 900px)').matches);
 useEffect(()=>{const media=window.matchMedia('(max-width: 900px)');const sync=()=>setMobile(media.matches);media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);},[]);
 useLayoutEffect(()=>{
  if(!open||!mobile)return;
  const dialog=panel.current;
  const previousOverflow=document.documentElement.style.overflow;
  dialog.showModal();
  document.documentElement.style.overflow='hidden';
  closeButton.current?.focus({preventScroll:true});
  return()=>{if(dialog.open)dialog.close();document.documentElement.style.overflow=previousOverflow;};
 },[open,mobile]);
 useEffect(()=>{if(open){wasOpen.current=true;closeButton.current?.focus();return;}if(wasOpen.current){wasOpen.current=false;trigger.current?.focus();}},[open]);
 useEffect(()=>{if(!open)return;const close=e=>{if(e.key==='Escape'||e.type==='pointerdown'&&!root.current?.contains(e.target))setOpen(false);};window.addEventListener('keydown',close);window.addEventListener('pointerdown',close);return()=>{window.removeEventListener('keydown',close);window.removeEventListener('pointerdown',close);};},[open]);
 useEffect(()=>{
  let live=true;
  const refresh=()=>repository.notifications(user.id).then(payload=>{if(live){const nextItems=Array.isArray(payload)?payload:Array.isArray(payload?.items)?payload.items:[];setItems(nextItems);setUnreadCount(Array.isArray(payload)?nextItems.filter(item=>!item.read_at).length:Math.max(0,Number(payload?.unread_count)||0));setError('');}}).catch(()=>{if(live)setError('تعذر تحديث الإشعارات');});
  refresh();
  const unsubscribe=repository.subscribe(user.id,refresh);
  const timer=setInterval(refresh,15000);
  return()=>{live=false;clearInterval(timer);unsubscribe();};
 },[user.id]);
 const unread=items.filter(i=>!i.read_at);
 async function markAll(){
  try{
   await repository.markAllNotifications();
   const readAt=new Date().toISOString();
   setItems(current=>current.map(item=>item.read_at?item:{...item,read_at:readAt}));
   setUnreadCount(0);
   setError('');
  }catch(e){
   if(e?.code!=='PGRST202'){setError('تعذر تحديث الإشعارات');return;}
   try{await Promise.all(unread.map(item=>call('read_notification',{id:item.id})));setItems(current=>current.map(item=>({...item,read_at:item.read_at||new Date().toISOString()})));setUnreadCount(0);}
   catch{setError('تعذر تحديث الإشعارات');}
  }
 }
 const compact=variant==='compact';
 const Panel=mobile?'dialog':'section';
 const triggerLabel=unreadCount>0?`الإشعارات ${unreadCount} غير مقروء`:'الإشعارات';
 return <div ref={root} className={`w-notifications${compact?' is-compact':''}${open?' is-open':''}`}>
  <button className="w-notification-trigger" ref={trigger} type="button" aria-label={triggerLabel} aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog" onClick={()=>setOpen(!open)}><Bell size={compact?20:18} aria-hidden="true"/>{!compact&&<>الإشعارات</>}{unreadCount>0&&<b dir="ltr" aria-hidden="true">{unreadCount>99?'99+':unreadCount}</b>}</button>
  {!compact&&<span className="w-new-notice" role="status" aria-atomic="true">{unreadCount>0?`${unreadCount} إشعارات غير مقروءة`:''}</span>}
  {open&&<Panel ref={panel} id={panelId} className={`w-notification-panel${mobile?' is-mobile-dialog':''}`} role="dialog" aria-modal={mobile?true:undefined} aria-labelledby={`${panelId}-title`} onCancel={event=>{event.preventDefault();event.stopPropagation();setOpen(false);}}><header><hgroup><h3 id={`${panelId}-title`}>الإشعارات</h3><p>{unreadCount>0?`${unreadCount} غير مقروءة`:'أنت على اطلاع بآخر التحديثات'}</p></hgroup><div>{unreadCount>0&&<button type="button" aria-label="تحديد الكل كمقروء" title="تحديد الكل كمقروء" onClick={markAll}><CheckCheck size={19} aria-hidden="true"/></button>}<button ref={closeButton} type="button" aria-label="إغلاق الإشعارات" title="إغلاق" onClick={()=>setOpen(false)}><X size={19} aria-hidden="true"/></button></div></header>
   {error&&<p role="alert">{error}</p>}{!items.length&&<p className="w-notification-empty">لا توجد إشعارات حتى الآن</p>}
   {items.map(n=><button type="button" className={n.read_at?'':'w-unread'} key={n.id} onClick={async()=>{try{if(!n.read_at)await call('read_notification',{id:n.id});setItems(current=>current.map(i=>i.id===n.id?{...i,read_at:i.read_at||new Date().toISOString()}:i));if(!n.read_at)setUnreadCount(current=>Math.max(0,current-1));onOpen(notificationDestination(n));setOpen(false);}catch{setError('تعذر فتح الإشعار أعد المحاولة');}}}><NotificationCopy item={n}/></button>)}
  </Panel>}
 </div>;
}
