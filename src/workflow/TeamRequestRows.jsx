import React,{useEffect,useState} from 'react';
import {ArrowLeft,Paperclip,Search} from 'lucide-react';
import {repository,states} from './data';
import './team-request-rows.css';

const formatDate=value=>{
 const date=value?new Date(value):null;
 return date&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Riyadh'}).format(date):'غير محدد';
};
export default function TeamRequestRows({rows,total,pages,search,onSearch,priority,onPriority,sort,onSort,page,onPage,hasNext,loading,refreshing,onOpen,teamFollowup=false}){
 const [attachments,setAttachments]=useState(null),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 const requestKey=rows.map(row=>`${row.id}:${row.version}`).join('|');
 useEffect(()=>{
  let live=true;setAttachments(null);setFailed(false);
  repository.requestAttachmentCounts(rows.map(row=>row.id)).then(counts=>{if(live)setAttachments(counts);}).catch(()=>{if(live)setFailed(true);});
  return()=>{live=false;};
 },[requestKey,attempt]);
 const visible=rows.filter(row=>priority==='all'||(row.priority==='urgent'?'urgent':'normal')===priority);
 return <section className="w-request-rows" aria-label="قائمة المهام">
  {teamFollowup&&<header className="w-followup-heading"><h3>متابعة مهام الفريق</h3><p>تابع الطلبات النشطة وحالة الأقسام المشاركة وافتح الطلب للتفاصيل</p></header>}
  <div className="w-rows-tools">
   <label className="w-rows-search"><span><Search size={16} aria-hidden="true"/>البحث في المهام</span><input type="search" value={search} onChange={event=>onSearch(event.target.value)} placeholder="عنوان الطلب أو رقمه"/></label>
   <label><span>حالة الطلب من العميل</span><select value={priority} onChange={event=>onPriority(event.target.value)}><option value="all">كل الحالات</option><option value="normal">عادي</option><option value="urgent">مستعجل</option></select></label>
   <label><span>الترتيب</span><select value={sort} onChange={event=>onSort(event.target.value)}><option value="latest">الأحدث أولا</option><option value="urgent">المستعجل أولا</option><option value="requested">أقرب موعد طلبه العميل</option></select></label>
  </div>
  <div className="w-rows-caption"><span role="status">{loading?'جار تحميل المهام':refreshing?'جار تحديث المهام':total!=null?`${visible.length} من ${total} ${teamFollowup?'طلب نشط':'مهمة مكتملة'}`:`${visible.length} طلب في هذه الصفحة`}</span><span>الموعد المطلوب من العميل لا يمثل التسليم النهائي</span></div>
  {failed&&<div className="w-rows-retry" role="status">تعذر تحميل عدد المرفقات<button type="button" onClick={()=>setAttempt(value=>value+1)}>إعادة المحاولة</button></div>}
  <div className="w-rows-scroll" tabIndex={0} role="region" aria-label="جدول المهام">
   <table>
    <thead><tr><th scope="col">اسم العميل</th><th scope="col">تاريخ الرفع</th><th scope="col">عنوان الطلب</th><th scope="col">المرفقات</th><th scope="col">التسليم المطلوب</th><th scope="col">حالة الطلب</th></tr></thead>
    <tbody>{!loading&&visible.map(row=><tr key={row.rowKey||row.id}>
     <td data-label="اسم العميل"><span className="w-row-client" dir="auto">{row.clientName||'اسم العميل غير متاح'}</span></td>
     <td data-label="تاريخ الرفع"><time dateTime={row.created_at}>{formatDate(row.created_at)}</time></td>
     <td data-label="عنوان الطلب" className="w-row-title"><button type="button" onClick={()=>onOpen(row.id)}><span dir="auto">{row.title}</span><ArrowLeft size={16} aria-hidden="true"/></button>{row.taskLabel&&<small className="w-row-task-label">{row.taskLabel}</small>}{teamFollowup&&<ul className="w-row-departments" aria-label="حالة الأقسام المشاركة">{row.departmentStatuses?.length?row.departmentStatuses.map(part=><li key={part.id}><span>{part.name}</span><span>{part.status==='review'?'بانتظار المراجعة':states[part.status]||'الحالة غير متاحة'}</span></li>):<li>بانتظار تحديد الأقسام</li>}</ul>}</td>
     <td data-label="المرفقات"><span className="w-row-files"><Paperclip size={15} aria-hidden="true"/><span dir="ltr" aria-label={attachments?.[row.id]==null?(failed||attachments?'العدد غير متاح':'جار تحميل العدد'):`${attachments[row.id]} مرفقات`}>{attachments?.[row.id]??(failed||attachments?'غير متاح':'جار التحميل')}</span></span></td>
     <td data-label="التسليم المطلوب"><time dateTime={row.requested_due_at||undefined}>{formatDate(row.requested_due_at)}</time></td>
     <td data-label="حالة الطلب"><span className={`w-row-priority ${row.priority==='urgent'?'is-urgent':''}`}>{row.priority==='urgent'?'مستعجل':'عادي'}</span></td>
    </tr>)}</tbody>
   </table>
  </div>
  {!loading&&!visible.length&&<p className="w-rows-empty">لا توجد مهام مطابقة</p>}
  <footer><button type="button" disabled={!page||refreshing||loading} onClick={()=>onPage(page-1)}>السابق</button><span>الصفحة <b dir="ltr">{page+1}</b>{pages!=null&&<> من <b dir="ltr">{pages}</b></>}</span><button type="button" disabled={!hasNext||refreshing||loading} onClick={()=>onPage(page+1)}>التالي</button></footer>
 </section>;
}
