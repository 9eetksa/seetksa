import {supabase} from '../auth/supabase';
import {result,workError} from '../workflow/data';
export const getMissionContext=()=>result(supabase.rpc('seet_mission_context'));
export const getMissionBoard=(view,search='',page=0)=>result(supabase.rpc('seet_mission_board',{p_view:view,p_search:search,p_page:page}));
export const getMissionDetail=id=>result(supabase.rpc('seet_mission_detail',{p_id:id}));
export const missionAction=(action,p)=>result(action==='update_draft'?supabase.rpc('seet_mission_update_draft',{p}):supabase.rpc('seet_mission_action',{p_action:action,p}));
export function missionError(error){
 const code=error?.message||'';
 const messages={mission_fields_required:'أكمل عنوان المهمة ووصفها وتاريخ التنفيذ واختر الأقسام المعنية',mission_department_dates:'حدد المطلوب وتاريخ التنفيذ والتسليم لكل قسم على أن يكون التسليم بعد التنفيذ',invalid_map_url:'أضف رابط Google Maps صالحا يبدأ بـ https://',capacity_required:'يحتاج القسم إلى تحديد عدد الموظفين من الأوبريشن أولا',capacity_exceeded:'اكتمل العدد المحدد لهذا القسم يمكن للأوبريشن زيادة العدد ثم إعادة المحاولة',capacity_below_assigned:'لا يمكن تقليل العدد عن عدد الموظفين المكلفين حاليا',join_not_eligible:'الانضمام متاح لمن هم خارج أقسام المهمة ولم يسبق تكليفهم بها',join_already_pending:'لديك طلب انضمام قيد المراجعة بالفعل',note_required:'اكتب سبب التعذر أو ملاحظة من ثلاثة أحرف على الأقل',mission_not_complete:'لا يمكن إغلاق المهمة حتى اكتمال عمل الأقسام',version_conflict:'تغيرت المهمة أثناء عملك تم تحميل آخر تحديث راجع التفاصيل وأعد المحاولة'};
 Object.assign(messages,{capacity_full:messages.capacity_exceeded,join_already_requested:'سبق تقديم طلب انضمام لهذه المهمة راجع نتيجته في التفاصيل',already_assigned:'هذا الموظف مكلف بالفعل بأحد أقسام المهمة',invalid_file:'راجع نوع المرفق وحجمه وعدد المرفقات المسموح',invalid_due:'تاريخ التنفيذ يحتاج تحديثا قبل نشر المهمة',invalid_input:'راجع البيانات والحقول المطلوبة ثم أعد المحاولة'});
 const match=Object.keys(messages).find(key=>code.includes(key));return match?messages[match]:workError(error);
}
export async function missionDownload(file){
 const data=await result(supabase.storage.from('mission-files').createSignedUrl(file.object_path,120,{download:file.filename}));
 const url=new URL(data.signedUrl),base=new URL(import.meta.env.VITE_SUPABASE_URL);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))||url.host!==base.host)throw new Error('invalid_download_url');
 const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.download=file.filename;link.click();
}
