import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Archive,ArrowUpRight,Check,ImagePlus,Images,LoaderCircle,Pencil,Plus,RotateCcw,Search,Star,Trash2,X} from 'lucide-react';
import AttachmentPreview from '../workflow/AttachmentPreview';
import {repository} from '../workflow/data';
import {portfolioRepository,portfolioPreview,portfolioDownload,portfolioError} from './portfolio-data';
import {useSessionState,useSessionStore} from '../shared/session-state';
import './works-manager.css';

const imageTypes=new Set(['image/jpeg','image/png','image/webp','image/avif','image/gif']);
const workDraft=work=>({id:work.id,version:work.version,name:work.name,description:work.description,project_url:work.project_url||'',status:work.status,portfolio_media:work.portfolio_media.map(({id,source,object_path,filename,mime_type,byte_size,is_cover,position})=>({id,source,object_path,filename,mime_type,byte_size,is_cover,position}))});
function LocalImage({file,alt}){
 const [url,setUrl]=useState('');
 useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);
 return url?<img src={url} alt={alt}/>:null;
}
function Cover({file,alt}) {
 const [url,setUrl]=useState(''),[error,setError]=useState(false);
 useEffect(()=>{let live=true;setUrl('');setError(false);if(file)portfolioPreview(file).then(value=>{if(live)setUrl(value);},()=>{if(live)setError(true);});return()=>{live=false;};},[file?.object_path]);
 if(error)return <span className="pm-image-loading">تعذر تحميل الصورة</span>;
 return url?<img src={url} alt={alt} loading="lazy" onError={()=>setError(true)}/>:<span className="pm-image-loading" role="status"><LoaderCircle className="pm-spin" size={22}/><span className="pm-sr">جار تحميل الصورة</span></span>;
}
export default function WorksManager({user,preview=false}) {
 const [works,setWorks]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [query,setQuery]=useSessionState('portfolio.search','',{validate:value=>typeof value==='string'}),[filter,setFilter]=useSessionState('portfolio.filter','active',{validate:value=>['active','archived','all'].includes(value)});
 const [editing,setEditing,editingState]=useSessionState('portfolio.editing',null,{validate:value=>value===null||Boolean(value&&value.id&&typeof value.name==='string'&&typeof value.description==='string'&&Array.isArray(value.portfolio_media))});
 const [viewing,setViewing]=useSessionState('portfolio.viewing',null,{validate:value=>value===null||typeof value==='string'}),[busy,setBusy]=useState('');
 const session=useSessionStore();
 const [deleting,setDeleting]=useState(null),[deleteError,setDeleteError]=useState('');
 const viewingWork=works.find(work=>work.id===viewing);
 function closeEditor(){if(editing)session?.clearPrefix(`portfolio.editor.${editing.id}.`);editingState.clear();}
 function closeGallery(){if(viewing)session?.clearPrefix(`portfolio.gallery.${viewing}.`);setViewing(null);}
 const load=async()=>{setLoading(true);setError('');try{setWorks(await portfolioRepository.list());}catch{setError('تعذر تحميل الأعمال تحقق من الاتصال وأعد المحاولة');}finally{setLoading(false);}};
 useEffect(()=>{load();},[]);
 const shown=useMemo(()=>works.filter(work=>(filter==='all'||work.status===filter)&&`${work.name} ${work.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[works,filter,query]);
 async function archive(work){if(preview||busy)return;setBusy(work.id);setError('');try{await portfolioRepository.save({...work,status:work.status==='active'?'archived':'active',media:[...work.portfolio_media].sort((a,b)=>a.position-b.position)});setNotice(work.status==='active'?'تم نقل العمل إلى الأرشيف':'تمت استعادة العمل إلى المكتبة');await load();}catch(e){setError(portfolioError(e));}finally{setBusy('');}}
 async function removeWork(){
  if(preview||busy||!deleting)return;
  setBusy(deleting.id);setDeleteError('');
  try{
   const result=await portfolioRepository.remove(deleting);
   setWorks(current=>current.filter(work=>work.id!==deleting.id));
   session?.clearPrefix(`portfolio.editor.${deleting.id}.`);
   session?.clearPrefix(`portfolio.gallery.${deleting.id}.`);
   setDeleting(null);
   setNotice(result.cleanupPending?'تم حذف العمل من المكتبة والرئيسية وتعذر حذف بعض ملفاته المخزنة':'تم حذف العمل من المكتبة والصفحة الرئيسية');
  }catch(e){setDeleteError(portfolioError(e));}finally{setBusy('');}
 }
 return <section className="pm-root" aria-label="إدارة أعمالنا">
  <header className="pm-intro"><div><span className="a-eyebrow">مكتبة صيت</span><h2>أعمال تستحق العرض</h2><p>نظم صور كل عمل وتفاصيله ورابطه في مكان واحد</p></div><button className="a-primary" disabled={preview} onClick={()=>setEditing({id:crypto.randomUUID(),version:0,name:'',description:'',project_url:'',status:'active',portfolio_media:[]})}><Plus size={19}/>إضافة عمل</button></header>
  <div className="pm-summary"><span><b>{works.filter(w=>w.status==='active').length}</b>أعمال في المكتبة</span><span><b>{works.filter(w=>w.status==='archived').length}</b>أعمال مؤرشفة</span><p>الصور الأصلية محفوظة مع كل عمل</p></div>
  <div className="pm-toolbar"><label className="pm-search"><Search size={18}/><input type="search" aria-label="البحث في الأعمال" placeholder="ابحث باسم العمل أو وصفه" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="pm-filters" aria-label="تصفية الأعمال">{[['active','المكتبة'],['archived','الأرشيف'],['all','الكل']].map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div></div>
  {error&&<div className="pm-message pm-error" role="alert">{error}<button onClick={load}><RotateCcw size={16}/>إعادة المحاولة</button></div>}
  {notice&&<div className="pm-message" role="status">{notice}<button aria-label="إغلاق الرسالة" onClick={()=>setNotice('')}><X size={17}/></button></div>}
  {loading?<div className="pm-empty" role="status"><LoaderCircle className="pm-spin"/>جار تحميل الأعمال</div>:shown.length?<div className="pm-grid">{shown.map(work=>{const media=[...work.portfolio_media].sort((a,b)=>a.position-b.position);const cover=media.find(f=>f.is_cover)||media[0];return <article className="pm-card" key={work.id}>
   <button className="pm-cover" aria-label={`عرض صور ${work.name}`} onClick={()=>setViewing(work.id)}><Cover file={cover} alt={work.name}/><span className="pm-cover-count"><Images size={15}/>{media.length} صور</span>{work.status==='archived'&&<span className="pm-archived">مؤرشف</span>}</button>
   <div className="pm-card-body"><h3>{work.name}</h3><p>{work.description}</p><div className="pm-card-meta"><span>تحديث {new Date(work.updated_at).toLocaleDateString('ar-SA',{day:'numeric',month:'long',year:'numeric'})}</span>{work.project_url&&<a href={work.project_url} target="_blank" rel="noopener noreferrer">رابط العمل<ArrowUpRight size={16}/></a>}</div><div className="pm-card-actions"><button disabled={preview||Boolean(busy)} onClick={()=>setEditing(workDraft(work))}><Pencil size={16}/>تعديل العمل</button><button disabled={preview||Boolean(busy)} onClick={()=>archive(work)}>{busy===work.id?<LoaderCircle className="pm-spin" size={16}/>:work.status==='active'?<Archive size={16}/>:<RotateCcw size={16}/>}<span>{work.status==='active'?'أرشفة':'استعادة'}</span></button><button className="pm-delete" disabled={preview||Boolean(busy)} aria-label={`حذف عمل ${work.name}`} onClick={()=>{setDeleteError('');setDeleting(work);}}><Trash2 size={16}/>حذف</button></div></div>
  </article>;})}</div>:<div className="pm-empty"><Images size={36}/><h3>{query?'لا توجد أعمال مطابقة':filter==='archived'?'الأرشيف خال':'ابدأ بأول عمل'}</h3><p>{query?'جرب اسما آخر أو اعرض جميع الأعمال':filter==='archived'?'ستجد هنا الأعمال التي تختار أرشفتها':'أضف صورة رئيسية وقدم قصة العمل'}</p></div>}
  {editing&&!preview&&<WorkEditor key={editing.id} work={editing} user={user} onClose={closeEditor} onSaved={()=>{closeEditor();setNotice('تم حفظ العمل في المكتبة');load();}}/>}
  {viewingWork&&<WorkGallery key={viewingWork.id} work={{...viewingWork,media:[...viewingWork.portfolio_media].sort((a,b)=>a.position-b.position)}} onClose={closeGallery}/>}
  {deleting&&<DeleteWorkDialog work={deleting} busy={Boolean(busy)} error={deleteError} onClose={()=>setDeleting(null)} onConfirm={removeWork}/>}
 </section>;
}
function DeleteWorkDialog({work,busy,error,onClose,onConfirm}) {
 const dialog=useRef(null),cancel=useRef(null);
 useEffect(()=>{const focus=document.activeElement;dialog.current.showModal();cancel.current.focus();return()=>{dialog.current?.close();if(focus?.isConnected)focus.focus();else document.querySelector('.pm-intro button')?.focus();};},[]);
 return <dialog ref={dialog} className="pm-dialog pm-delete-dialog" aria-labelledby="pm-delete-title" aria-describedby="pm-delete-description" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header><h2 id="pm-delete-title">حذف العمل</h2><button disabled={busy} onClick={onClose} aria-label="إغلاق تأكيد الحذف"><X size={20}/></button></header>
  <p id="pm-delete-description">سيُحذف «{work.name}» نهائيا من المكتبة والصفحة الرئيسية ولا يمكن استعادته</p>
  {error&&<div className="pm-message pm-error" role="alert">{error}</div>}
  <footer><button ref={cancel} disabled={busy} onClick={onClose}>إلغاء</button><button className="pm-delete-confirm" disabled={busy} onClick={onConfirm}>{busy?<LoaderCircle className="pm-spin" size={17}/>:<Trash2 size={17}/>} {busy?'جار الحذف':'حذف نهائي'}</button></footer>
 </dialog>;
}
function WorkGallery({work,onClose}) {
 const dialog=useRef(null),[selectedId,setSelectedId]=useSessionState(`portfolio.gallery.${work.id}.selected`,null,{validate:value=>value===null||typeof value==='string'});
 const selected=work.media.find(file=>file.id===selectedId);
 useEffect(()=>{const focus=document.activeElement;dialog.current.showModal();return()=>{dialog.current?.close();if(focus?.isConnected)focus.focus();};},[]);
 return <dialog className="pm-dialog pm-gallery" ref={dialog} onCancel={e=>{e.preventDefault();onClose();}} aria-labelledby="pm-gallery-title"><header><div><span className="a-eyebrow">ملفات العمل</span><h2 id="pm-gallery-title">{work.name}</h2></div><button onClick={onClose} aria-label="إغلاق صور العمل"><X size={20}/></button></header><p>{work.description}</p><div className="pm-gallery-grid">{work.media.map(file=><button key={file.id} onClick={()=>setSelectedId(file.id)} aria-label={`معاينة ${file.filename}`}><Cover file={file} alt={file.filename}/><span>{file.is_cover?'الصورة الرئيسية':'صورة من العمل'}</span></button>)}</div>{selected&&<AttachmentPreview file={selected} onClose={()=>setSelectedId(null)} resolvePreview={portfolioPreview} downloadOriginal={portfolioDownload}/>}</dialog>;
}
function WorkEditor({work,user,onClose,onSaved}) {
 const dialog=useRef(null),input=useRef(null),controller=useRef(null),uploaded=useRef(new Map());
 const [form,setForm,formState]=useSessionState(`portfolio.editor.${work.id}.form`,()=>({name:work.name,description:work.description,project_url:work.project_url||''}),{validate:value=>Boolean(value&&typeof value.name==='string'&&typeof value.description==='string'&&typeof value.project_url==='string')});
 const [media,setMedia,mediaState]=useSessionState(`portfolio.editor.${work.id}.media`,()=>[...work.portfolio_media].sort((a,b)=>a.position-b.position),{validate:Array.isArray}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(null);
 useEffect(()=>{formState.initialize({name:work.name,description:work.description,project_url:work.project_url||''});mediaState.initialize([...work.portfolio_media].sort((a,b)=>a.position-b.position));},[work,formState,mediaState]);
 useEffect(()=>{const focus=document.activeElement;dialog.current.showModal();return()=>{controller.current?.abort();dialog.current?.close();if(focus?.isConnected)focus.focus();};},[]);
 function addFiles(event){const chosen=Array.from(event.target.files||[]);event.target.value='';const valid=chosen.filter(file=>imageTypes.has(file.type));if(valid.length!==chosen.length)setError('اختر صورا بصيغة JPG أو PNG أو WebP أو AVIF أو GIF');else setError('');setMedia(current=>{const additions=valid.filter(file=>!current.some(m=>m.file&&m.file.name===file.name&&m.file.size===file.size&&m.file.lastModified===file.lastModified)).map(file=>({id:crypto.randomUUID(),source:'storage',file,filename:file.name,mime_type:file.type,byte_size:file.size,is_cover:false}));return [...current,...additions].map((item,index)=>({...item,is_cover:item.is_cover||(!current.some(m=>m.is_cover)&&index===0)}));});}
 function remove(id){setMedia(current=>{const next=current.filter(file=>file.id!==id);if(!next.some(file=>file.is_cover)&&next[0])next[0]={...next[0],is_cover:true};return next;});}
 async function save(event){event.preventDefault();if(busy)return;setError('');if(!media.length){setError('أضف صورة رئيسية للعمل');return;}if(media.some(item=>!item.file&&!item.object_path)){setError('تعذر استعادة إحدى الصور أعد إضافتها قبل حفظ العمل');return;}let link=form.project_url.trim();if(link){try{const parsed=new URL(link);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();link=parsed.href;}catch{setError('أدخل رابطا كاملا يبدأ بـ https:// أو http://');return;}}
  controller.current=new AbortController();setBusy(true);try{const ready=[];for(let index=0;index<media.length;index++){const item=media[index];let file=item;if(item.file){let receipt=uploaded.current.get(item.id);if(!receipt){setProgress({index:index+1,total:media.length,name:item.filename,percent:0});receipt=await portfolioRepository.upload(work.id,user.id,item.file,{signal:controller.current.signal,onProgress:percent=>setProgress({index:index+1,total:media.length,name:item.filename,percent})});uploaded.current.set(item.id,receipt);}file={...item,...receipt};}const {file:raw,localUrl,cache_key,...persisted}=file;ready.push({...persisted,position:index});}
   setProgress(null);await portfolioRepository.save({...form,project_url:link,id:work.id,version:work.version,status:work.status,media:ready});uploaded.current.forEach(receipt=>repository.forgetUpload(receipt.cache_key));onSaved();
  }catch(e){setError(portfolioError(e));}finally{setBusy(false);setProgress(null);controller.current=null;}}
 return <dialog className="pm-dialog" ref={dialog} aria-labelledby="pm-editor-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><form onSubmit={save}>
  <header><div><span className="a-eyebrow">مكتبة الأعمال</span><h2 id="pm-editor-title">{work.version?'تعديل العمل':'إضافة عمل'}</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="إغلاق نموذج العمل"><X size={20}/></button></header>
  <p className="pm-editor-lead">صورة رئيسية وتفاصيل مختصرة تكفي لتقديم العمل ويمكنك إضافة صور أخرى</p>
  {error&&<div className="pm-message pm-error" role="alert">{error}</div>}
  <label>اسم العمل<input aria-label="اسم العمل" required maxLength={150} value={form.name} disabled={busy} onChange={e=>setForm({...form,name:e.target.value})} placeholder="اسم المشروع أو العلامة"/></label>
  <label>وصف العمل<textarea aria-label="وصف العمل" required maxLength={6000} rows={4} value={form.description} disabled={busy} onChange={e=>setForm({...form,description:e.target.value})} placeholder="الفكرة وما قدمه فريق صيت"/></label>
  <label>رابط العمل <span className="pm-optional">اختياري</span><input aria-label="رابط العمل" type="url" dir="ltr" maxLength={2048} value={form.project_url} disabled={busy} onChange={e=>setForm({...form,project_url:e.target.value})} placeholder="https://"/></label>
  <section className="pm-media-section" aria-label="صور العمل"><div className="pm-media-heading"><div><h3>صور العمل</h3><p>اختر الصورة الرئيسية وأضف الواجهات عند الحاجة</p></div><input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,image/avif,image/gif" multiple onChange={addFiles}/><button type="button" disabled={busy} onClick={()=>input.current.click()}><ImagePlus size={18}/>إضافة صور</button></div>
   {!media.length?<button className="pm-upload-empty" type="button" onClick={()=>input.current.click()}><ImagePlus size={28}/><b>أضف الصورة الرئيسية</b><span>نحتفظ بالصور بجودتها الأصلية</span></button>:<div className="pm-editor-media">{media.map(item=><article key={item.id} className={item.is_cover?'is-cover':''}><div className="pm-thumb">{item.file?<LocalImage file={item.file} alt={item.filename}/>:<Cover file={item} alt={item.filename}/>}</div><span className="pm-filename" title={item.filename}>{item.filename}</span><div><button type="button" disabled={busy} aria-pressed={item.is_cover} onClick={()=>setMedia(current=>current.map(file=>({...file,is_cover:file.id===item.id})))}>{item.is_cover?<Check size={15}/>:<Star size={15}/>}<span>{item.is_cover?'الرئيسية':'تعيين رئيسية'}</span></button><button type="button" disabled={busy} onClick={()=>remove(item.id)} aria-label={`إزالة ${item.filename}`}><X size={16}/></button></div></article>)}</div>}
  </section>
  {progress&&<div className="pm-upload-progress" role="status"><span>رفع الصورة {progress.index} من {progress.total}</span><b>{progress.percent}%</b><progress value={progress.percent} max="100"/><small dir="auto">{progress.name}</small><button type="button" onClick={()=>controller.current?.abort()}>إيقاف الرفع</button></div>}
  <footer><button type="submit" className="a-primary" disabled={busy}>{busy?<LoaderCircle className="pm-spin" size={18}/>:<Check size={18}/>}<span>{busy?'جار حفظ العمل':'حفظ العمل'}</span></button><button type="button" disabled={busy} onClick={onClose}>إلغاء</button></footer>
 </form></dialog>;
}
