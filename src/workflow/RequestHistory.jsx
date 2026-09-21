import React,{useId,useState} from 'react';
import {events as eventLabels,when} from './data';
import {requestHistoryContext} from './request-history';

export default function RequestHistory({rows,events,parts,routes,services,request,manager,title='سجل رحلة الطلب'}){
 const [limit,setLimit]=useState(5),listId=useId();
 return <details className="w-history w-request-history"><summary>{title} <span className="w-count" dir="ltr">{rows.length}</span></summary>
  {!rows.length?<p className="w-history-empty">لا توجد أحداث مسجلة حتى الآن</p>:<>
   <ol className="w-history-list" id={listId}>{rows.slice(0,limit).map(row=>{
    const context=requestHistoryContext(row,{events,parts,routes,services});
    const title=row.kind==='assign'&&context.department?`إحالة مهمة إلى قسم ${context.department}`:eventLabels[row.kind]||row.kind;
    const task=context.scope||request.title;
    return <li key={row.id}><details className="w-history-event"><summary>
     <span className="w-history-event-heading"><strong>{title}{row.kind!=='assign'&&context.department&&<span className="w-history-department">{context.department}</span>}{!context.department&&(context.hasPart||row.kind==='assign')&&<span className="w-history-department">القسم غير متاح في هذا السجل</span>}</strong><time dateTime={row.created_at}>{when(row.created_at)}</time></span>
     <span className="w-history-task">{context.scope?'المهمة المرتبطة':'الطلب'} {task}</span>
     <span className="w-history-event-toggle"><span className="w-history-show">التفاصيل</span><span className="w-history-hide">إخفاء التفاصيل</span></span>
    </summary><div className="w-history-event-body">
     {context.scope&&<p><span>وصف المهمة الحالي</span>{context.scope}</p>}
     {!context.scope&&<p><span>الطلب المرتبط</span>{request.title}</p>}
     {manager&&row.actor_name&&<p><span>بواسطة</span>{row.actor_name}</p>}
     {manager&&row.next_name&&<p><span>{row.previous_name&&row.previous_name!==row.next_name?'تغيير المكلف':'المكلف وقت الإجراء'}</span>{row.previous_name&&row.previous_name!==row.next_name?`من ${row.previous_name} إلى ${row.next_name}`:row.next_name}</p>}
     {row.note&&<p><span>ملاحظة الإجراء</span>{row.note}</p>}
    </div></details></li>;
   })}</ol>
   {(rows.length>5)&&<div className="w-history-controls"><span>عرض <b dir="ltr">{Math.min(limit,rows.length)}</b> من <b dir="ltr">{rows.length}</b></span>{limit<rows.length&&<button type="button" aria-controls={listId} onClick={()=>setLimit(value=>value+5)}>عرض المزيد</button>}{limit>5&&<button type="button" aria-controls={listId} onClick={()=>setLimit(5)}>اختصار السجل</button>}</div>}
  </>}
 </details>;
}
