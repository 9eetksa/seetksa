import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useSyncExternalStore} from 'react';

const PREFIX='seet-ui-v1:';
const DB='seet-ui-files-v1';
const SessionContext=createContext(null);
const stores=new Map();
let database;

function storage(){try{return window.sessionStorage;}catch{return null;}}
function tabId(){
 const target=storage();
 let id=target?.getItem(`${PREFIX}tab`);
 if(!id){id=crypto.randomUUID();target?.setItem(`${PREFIX}tab`,id);}
 return id;
}
function openFiles(){
 if(!database)database=new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'}).createIndex('scope','scope');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 }).catch(error=>{database=null;throw error;});
 return database;
}
async function fileTransaction(mode,run){
 const db=await openFiles();
 return new Promise((resolve,reject)=>{
  const transaction=db.transaction('files',mode),objects=transaction.objectStore('files');
  const result=run(objects);
  transaction.oncomplete=()=>resolve(result?.result);
  transaction.onerror=()=>reject(transaction.error);
  transaction.onabort=()=>reject(transaction.error||new Error('draft_storage_unavailable'));
 });
}
function hasFileReference(value){
 if(!value||typeof value!=='object')return false;
 return value.__provisionFile===1||Object.values(value).some(hasFileReference);
}

class SessionStore{
 constructor(scope){
  this.scope=scope;
  this.prefix=scope?`${PREFIX}${encodeURIComponent(scope)}:`:null;
  this.values=new Map();this.defaults=new Map();this.saved=new Set();this.listeners=new Map();
  this.files=new Map();this.fileIds=new WeakMap();this.pending=new Set();this.statusListeners=new Set();
  this.status={ready:true,pending:false,error:false};this.disposed=false;
  if(!scope)return;
  try{
   this.fileScope=`${tabId()}:${scope}`;
   const target=storage();
   if(!target)throw new Error('draft_storage_unavailable');
   for(let i=0;i<target.length;i++){
    const name=target.key(i);
    if(!name?.startsWith(this.prefix))continue;
    try{
     const record=JSON.parse(target.getItem(name));
     if(record?.version!==1)continue;
     this.values.set(name.slice(this.prefix.length),record.value);this.saved.add(name.slice(this.prefix.length));
    }catch{target.removeItem(name);i--;}
   }
   if([...this.values.values()].some(hasFileReference)){
    this.status={...this.status,ready:false};
    this.loading=fileTransaction('readonly',objects=>objects.index('scope').getAll(this.fileScope))
     .then(entries=>{for(const entry of entries||[])this.files.set(entry.id,entry.file);})
     .catch(()=>this.updateStatus({error:true}))
     .finally(()=>{
      for(const [key,value] of this.values)this.values.set(key,this.decode(value));
      this.updateStatus({ready:true});
     });
   }
  }catch{this.updateStatus({error:true});}
 }
 updateStatus(patch){this.status={...this.status,...patch};for(const notify of this.statusListeners)notify();}
 subscribeStatus=notify=>{this.statusListeners.add(notify);return()=>this.statusListeners.delete(notify);};
 getStatus=()=>this.status;
 subscribe(key,notify){
  if(!this.listeners.has(key))this.listeners.set(key,new Set());
  this.listeners.get(key).add(notify);
  return()=>this.listeners.get(key)?.delete(notify);
 }
 notify(key){for(const notify of this.listeners.get(key)||[])notify();}
 get(key,initial,options={}){
  if(!this.defaults.has(key))this.defaults.set(key,typeof initial==='function'?initial():initial);
  if(!this.values.has(key))this.values.set(key,this.defaults.get(key));
  let value=this.values.get(key);
  if(options.validate&&!options.validate(value)){
   this.remove(key);value=this.defaults.get(key);this.values.set(key,value);
  }
  return value;
 }
 decode(value){
  if(!value||typeof value!=='object')return value;
  if(value.__provisionFile===1){
   const file=this.files.get(value.id);
   if(!file){this.updateStatus({error:true});return null;}
   const restored=file instanceof File?file:new File([file],value.name,{type:value.type,lastModified:value.lastModified});
   this.fileIds.set(restored,value.id);return restored;
  }
  if(Array.isArray(value))return value.flatMap(item=>{const decoded=this.decode(item);return item?.__provisionFile===1&&!decoded?[]:[decoded];});
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,this.decode(item)]));
 }
 encode(value,writes){
   if(value instanceof File){
   let id=this.fileIds.get(value);
   if(!id){
    id=`${this.fileScope}:${crypto.randomUUID()}`;this.fileIds.set(value,id);this.files.set(id,value);
    writes.push({id,scope:this.fileScope,file:value,createdAt:Date.now()});
   }
   return {__provisionFile:1,id,name:value.name,type:value.type,lastModified:value.lastModified};
  }
  if(Array.isArray(value))return value.map(item=>this.encode(item,writes));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,this.encode(item,writes)]));
  return value;
 }
 set(key,next,options={}){
  if(this.disposed)return;
  const value=typeof next==='function'?next(this.get(key,undefined)):next;
  this.values.set(key,value);this.saved.add(key);this.notify(key);
  if(!this.prefix)return;
  try{
   const safe=options.omit&&value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([name])=>!options.omit.includes(name))):value;
   const writes=[],encoded=this.encode(safe,writes),target=storage();
   if(!target)throw new Error('draft_storage_unavailable');
   target.setItem(`${this.prefix}${key}`,JSON.stringify({version:1,value:encoded}));
   if(writes.length){
    const pending=fileTransaction('readwrite',objects=>{for(const entry of writes)objects.put(entry);});
    this.pending.add(pending);this.updateStatus({pending:true});
    pending.catch(()=>this.updateStatus({error:true})).finally(()=>{this.pending.delete(pending);this.updateStatus({pending:this.pending.size>0});});
   }
  }catch{this.updateStatus({error:true});}
 }
 initialize(key,value){
  if(this.saved.has(key))return;
  this.values.set(key,value);this.defaults.set(key,value);this.notify(key);
 }
 remove(key){
  this.saved.delete(key);this.values.delete(key);
  try{if(this.prefix)storage()?.removeItem(`${this.prefix}${key}`);}catch{this.updateStatus({error:true});}
 }
 forget(key){this.saved.delete(key);try{if(this.prefix)storage()?.removeItem(`${this.prefix}${key}`);}catch{this.updateStatus({error:true});}}
 clear(key){this.remove(key);this.defaults.delete(key);this.notify(key);}
 clearPrefix(prefix){for(const key of new Set([...this.values.keys(),...this.saved]))if(key.startsWith(prefix))this.clear(key);}
}

export function useSessionStore(){return useContext(SessionContext);}
export function getSessionStore(scope){
 if(!scope)return null;
 if(!stores.has(scope))stores.set(scope,new SessionStore(scope));
 return stores.get(scope);
}
export function useSessionState(key,initial,options={}){
 const context=useSessionStore(),fallback=useRef(null);
 const optionsRef=useRef(options);optionsRef.current=options;
 if(!fallback.current)fallback.current=new SessionStore(null);
 const store=context||fallback.current;
 const subscribe=useMemo(()=>notify=>store.subscribe(key,notify),[store,key]);
 const value=useSyncExternalStore(subscribe,()=>store.get(key,initial,options));
 const setValue=useCallback(next=>store.set(key,next,optionsRef.current),[store,key]);
 const controls=useMemo(()=>({
  get restored(){return store.saved.has(key);},
  clear:()=>store.clear(key),
  forget:()=>store.forget(key),
  initialize:value=>store.initialize(key,value),
 }),[store,key]);
 return [value,setValue,controls];
}

export function SessionStateProvider({scope,disabled=false,children}){
 const store=useMemo(()=>{
  if(disabled||!scope)return new SessionStore(null);
  return getSessionStore(scope);
 },[scope,disabled]);
 const status=useSyncExternalStore(store.subscribeStatus,store.getStatus);
 useEffect(()=>{
  if(!status.pending&&!status.error)return;
  const guard=event=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',guard);
  return()=>window.removeEventListener('beforeunload',guard);
 },[status.pending,status.error]);
 return <SessionContext.Provider value={store}>
  {status.error&&<p className="c-notice c-error" dir="rtl" role="alert">تعذر استعادة أو حفظ بعض المدخلات على هذا الجهاز تأكد من المرفقات واحفظ عملك قبل تحديث الصفحة</p>}
  {status.ready?children:<main className="a-loading" dir="rtl" role="status">جار استعادة بيانات الصفحة</main>}
 </SessionContext.Provider>;
}

export function clearSessionState(){
 let filePrefix;
 try{filePrefix=`${storage()?.getItem(`${PREFIX}tab`)}:`;}catch{}
 const pending=[...stores.values()].flatMap(store=>[...store.pending]);
 for(const store of stores.values())store.disposed=true;
 stores.clear();
 try{
  const target=storage();
  for(let i=(target?.length||0)-1;i>=0;i--){const key=target.key(i);if(key?.startsWith(PREFIX)&&key!==`${PREFIX}tab`)target.removeItem(key);}
  target?.setItem(`${PREFIX}tab`,crypto.randomUUID());
 }catch{/* Sign-out must remain available even when browser storage is blocked */}
 if(filePrefix&&filePrefix!=='null:'&&filePrefix!=='undefined:'){
  void Promise.allSettled(pending).then(()=>fileTransaction('readwrite',objects=>{
   const request=objects.openCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor){if(cursor.key.startsWith(filePrefix))cursor.delete();cursor.continue();}};
  })).catch(()=>{});
 }
}
