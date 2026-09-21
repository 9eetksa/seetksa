import {supabase} from '../auth/supabase';
import {result, uploadFile} from '../workflow/data';
import {getCatalog,invalidateCatalog} from '../data/catalog-gateway';
import {notifyPortfolioChanged} from '../data/portfolio-updates';
import {hasImpersonation} from '../auth/impersonation';

export const portfolioRepository = {
 list: () => getCatalog('portfolio'),
 async save(data){
  try{const saved=await result(supabase.rpc('portfolio_save',{p:data}));invalidateCatalog('portfolio');notifyPortfolioChanged();return saved;}
  catch(error){
   // A lost response must not turn a committed save into a stale-version trap
   const current=await result(supabase.from('portfolio_works').select('*,portfolio_media(*)').eq('id',data.id).maybeSingle()).catch(()=>null);
   const stored=[...(current?.portfolio_media||[])].sort((a,b)=>a.position-b.position);
   const expected=data.media||[];
   if(current&&current.version===Number(data.version)+1&&current.name===data.name.trim()&&current.description===data.description.trim()
    &&current.project_url===(data.project_url?.trim()||null)&&current.status===data.status&&stored.length===expected.length
    &&stored.every((file,index)=>['id','source','object_path','filename','mime_type'].every(key=>file[key]===expected[index][key])
     &&file.is_cover===Boolean(expected[index].is_cover)&&String(file.byte_size??'')===String(expected[index].byte_size??''))){invalidateCatalog('portfolio');notifyPortfolioChanged();return current.id;}
   throw error;
  }
 },
 async remove(work){
  if(hasImpersonation())throw Object.assign(new Error('أنه الدخول بالنيابة قبل حذف العمل'),{userFacing:true});
  const {data,error}=await supabase.auth.getSession();
  if(error||!data.session?.access_token)throw Object.assign(new Error('سجل الدخول للمتابعة'),{userFacing:true});
  const response=await fetch('/api/portfolio',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({id:work.id,version:work.version})});
  const body=await response.json();
  if(!response.ok)throw Object.assign(new Error(body.error||'تعذر حذف العمل'),{userFacing:true});
  invalidateCatalog('portfolio');notifyPortfolioChanged();return body;
 },
 upload: (work,user,file,options) => uploadFile(work,user,file,{...options,bucket:'portfolio-assets'}),
};
export async function portfolioPreview(file) {
 if(file.source==='packaged' && /^\/portfolio\/(saudi-dent|one-minute|sukkar|hdeer)(-portrait\.webp|\.jpg)$/.test(file.object_path))return file.object_path;
 if(file.source!=='storage')throw new Error('invalid_media');
 const data=await result(supabase.storage.from('portfolio-assets').createSignedUrl(file.object_path,3600));
 return data.signedUrl;
}
export async function portfolioDownload(file) {
 const url=new URL(await portfolioPreview(file),window.location.origin);
 if(file.source==='storage')url.searchParams.set('download',file.filename);
 const anchor=document.createElement('a');
 anchor.href=url.href;anchor.download=file.filename;anchor.rel='noopener';
 document.body.append(anchor);anchor.click();anchor.remove();
}
export function portfolioError(error) {
 if(error?.userFacing)return error.message;
 if(error?.message?.includes('version_conflict'))return 'تغير هذا العمل لدى مستخدم آخر أغلق النافذة ثم افتحه من جديد لعرض آخر نسخة';
 if(error?.message?.includes('forbidden'))return 'إدارة الأعمال متاحة للأدمن والسوبر أدمن فقط';
 if(error?.message==='upload_paused')return 'تم إيقاف الرفع يمكنك متابعة الحفظ من هنا';
 if(error?.message?.includes('invalid_portfolio')||error?.message?.includes('portfolio_cover_required'))return 'راجع بيانات العمل واختر صورة رئيسية صالحة';
 return 'تعذر حفظ التغييرات تحقق من الاتصال ثم أعد المحاولة';
}
