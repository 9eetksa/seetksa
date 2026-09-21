import React from 'react';
import {ArrowLeft,Search,Clock3,AlertTriangle,Paperclip} from 'lucide-react';
import {dateLabel} from '../shared/date-only';
import {dashboardTitles} from './task-dashboard';
import {states,when} from './data';
import './task-dashboard.css';

export default function TaskDashboardRows({dashboard,bucket,search,onSearch,priority,onPriority,sort,onSort,onBucket,page,onPage,onOpen,loading,refreshing,error,onRetry}){
 const review=bucket.startsWith('client_review'),late=bucket==='overdue'||bucket==='personal_overdue';
 const items=loading||error?[]:dashboard?.items||[];
 const date=value=>value?dateLabel(value):'لم يحدد';
 return <section className="w-dashboard-results" aria-label={dashboardTitles[bucket]} aria-busy={loading||refreshing}>
  <header><h3>{review?dashboardTitles.client_review:dashboardTitles[bucket]}</h3><p>{review?`تبدأ مهلة المراجعة من إرسال المخرجات للعميل وتصبح متأخرة بعد ${dashboard?.review_hours||48} ساعة`:late?'مهام تجاوزت موعد الموظف ولم تصل إلى مراجعة المشرف':'افتح عنوان الطلب للاطلاع على المهام واتخاذ الإجراء'}</p></header>
  {['all','active','intake','completed'].includes(bucket)&&<nav className="w-review-filters" aria-label="حالة طلبات العملاء">{[['all','كل الطلبات'],['active','قيد التنفيذ'],['intake','بانتظار التوجيه'],['completed','مكتملة']].map(([id,label])=><button type="button" key={id} aria-pressed={bucket===id} onClick={()=>onBucket(id)}>{label}</button>)}</nav>}
  {review&&<nav className="w-review-filters" aria-label="حالة مراجعة المشرف">{[['client_review','كل المراجعات'],['client_review_pending','ضمن المهلة'],['client_review_overdue','متأخرة']].map(([id,label])=><button type="button" key={id} aria-pressed={bucket===id} onClick={()=>onBucket(id)}>{label}<bdi>{dashboard?.counts?.[id]??'—'}</bdi></button>)}</nav>}
  <div className="w-dashboard-tools">
   <label><span><Search size={15} aria-hidden="true"/>البحث في الطلبات</span><input type="search" value={search} onChange={e=>onSearch(e.target.value)} placeholder="اسم العميل أو عنوان الطلب أو رقمه"/></label>
   <label>الأولوية<select value={priority} onChange={e=>onPriority(e.target.value)}><option value="all">كل الأولويات</option><option value="normal">عادي</option><option value="urgent">مستعجل</option></select></label>
   <label>الترتيب<select value={sort} onChange={e=>onSort(e.target.value)}><option value="latest">الأحدث أولا</option><option value="oldest">الأقدم أولا</option><option value="due">أقرب موعد</option><option value="priority">المستعجل أولا</option></select></label>
  </div>
  <p className="w-dashboard-caption" role="status">{loading?'جار تحميل النتائج':refreshing?'جار تحديث النتائج':error?'تعذر تحميل النتائج':`${dashboard?.total??0} ${late?'مهمة':review?'مراجعة':'طلب'}`}</p>
  {error&&<div className="w-error" role="alert">{error}<button type="button" onClick={onRetry}>إعادة المحاولة</button></div>}
  <div className="w-dashboard-list">{items.map(row=><article key={row.id} className={`w-dashboard-row${row.review_overdue||late?' is-late':''}`}>
   <div className="w-dashboard-subject"><span className="w-dashboard-reference">طلب <bdi>{row.request_number}</bdi>{row.attachment_count!=null&&<span aria-label={`${row.attachment_count} مرفقات الطلب`}><Paperclip size={13} aria-hidden="true"/><bdi>{row.attachment_count}</bdi></span>}<span className={`w-row-priority ${row.priority==='urgent'?'is-urgent':''}`}>{row.priority==='urgent'?'مستعجل':'عادي'}</span></span><button type="button" onClick={()=>onOpen(row.request_id)}><strong>{row.request_title}</strong><ArrowLeft size={16} aria-hidden="true"/></button><span>{row.client_name||'اسم العميل غير متاح'}</span></div>
   <dl><div><dt>{row.department?'القسم والموظف':'تاريخ تقديم الطلب'}</dt><dd>{row.department?<>{row.department}<small>{row.employee||'الموظف غير محدد'}</small></>:date(row.created_at)}</dd></div><div><dt>{review?'أرسلت لمراجعة المشرف':row.part_id?'موعد تسليم الموظف':'الموعد المطلوب من العميل'}</dt><dd>{review?when(row.released_at):date(row.part_id?row.due_at:row.requested_due_at)}{!review&&<small>{!row.part_id?'رغبة العميل وليست موعد التسليم المعتمد':!row.due_at?'يحدد عند استلام المهمة':''}</small>}</dd></div><div><dt>{review?'حالة المراجعة':'حالة المهمة'}</dt><dd className={row.review_overdue||late?'w-dashboard-late':''}>{review?<><Clock3 size={15} aria-hidden="true"/>{row.review_overdue?'تأخر العميل في المراجعة':'بانتظار اعتماد المشرف'}<small>تنتهي المهلة {when(row.review_due_at)}</small></>:late?<><AlertTriangle size={15} aria-hidden="true"/>تجاوز موعد التسليم</>:states[row.status]||'قيد المتابعة'}</dd></div></dl>
  </article>)}</div>
  {!loading&&!error&&!items.length&&<p className="w-rows-empty">لا توجد نتائج مطابقة في هذا القسم</p>}
  <footer className="w-dashboard-pages"><button type="button" disabled={page===0||loading||refreshing} onClick={()=>onPage(page-1)}>السابق</button><span>الصفحة <bdi>{page+1}</bdi> من <bdi>{Math.max(1,dashboard?.pages||1)}</bdi></span><button type="button" disabled={!dashboard?.has_next||loading||refreshing||!!error} onClick={()=>onPage(page+1)}>التالي</button></footer>
 </section>;
}
