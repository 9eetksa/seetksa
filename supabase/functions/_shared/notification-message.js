import {notificationSummary} from './notification-summary.js';

const platformUrl='/login';
const staffRoles=new Set(['employee','admin','super_admin']);
// Notification copy only Never alter stored request titles or user inputs
const arabicLabel=(value,max=80)=>{
  const label=String(value||'').replace(/\s+/g,' ').trim();
  if(!/[\u0600-\u06ff]/.test(label)||/[A-Za-z@/:]/.test(label))return '';
  return label.replace(/[.,،…·]/g,' ').replace(/\s+/g,' ').slice(0,max).trim();
};
export function clientStatusMessage(item){
  const {status,kind}=notificationSummary({...item,department_name:arabicLabel(item.department_name)});
  if(kind==='new_request')return 'تم تحويل طلبكم للمشرف المسؤول بانتظار الاستلام';
  if(kind==='internal_clarification')return 'طلبكم قيد المتابعة لدى الفريق';
  if(kind==='routing')return 'طلبكم قيد المتابعة لدى المشرف المسؤول';
  if(kind==='output_internal')return 'طلبكم قيد المتابعة لدى الفريق';
  if(kind==='admin_decision')return 'طلبكم قيد المتابعة لدى الفريق';
  if(kind==='task_due_internal')return 'طلبكم قيد المتابعة لدى الفريق';
  if(kind==='admin_due_changed')return 'تم تحديث موعد تسليم طلبكم';
  if(status==='استلم المشرف المسؤول الطلب')return 'استلم المشرف المسؤول طلبكم';
  if(status==='بانتظار استلام المشرف المسؤول')return 'تم تحويل طلبكم للمشرف المسؤول بانتظار الاستلام';
  if(status.startsWith('استلم ')&&status.endsWith('المهمة وجار العمل عليها')){
    const title=arabicLabel(item.request_title);
    const section=(arabicLabel(status)||'استلم القسم المهمة وجار العمل عليها').match(/^استلم (.+) المهمة/)[1];
    return `استلم ${section} مهمة ${title||'طلبكم'} وجار العمل عليها`;
  }
  if(status.startsWith('تم تحويل المهمة إلى '))return (arabicLabel(status)||'تم تحويل المهمة إلى القسم بانتظار الاستلام').replace('المهمة','طلبكم');
  const labels={
    'طلب جديد':'تم استلام طلبك',
    'الطلب قيد المتابعة لدى المشرف المسؤول':'طلبكم قيد المتابعة لدى المشرف المسؤول',
    'بانتظار استلام القسم':'طلبك بانتظار بدء التنفيذ',
    'قيد التنفيذ':'طلبك قيد التنفيذ',
    'جاهز للمراجعة':'طلبك جاهز للمراجعة',
    'تم اعتماد التسليم':'تم اعتماد تسليم طلبك',
    'تمت مراجعة التسليم':'تمت مراجعة تسليم طلبك',
    'تعديلات مطلوبة':'يجري العمل على تعديلات طلبك',
    'بيانات مطلوبة':'طلبك يحتاج استكمال البيانات',
    'مرفقات مطلوبة':'طلبك يحتاج استكمال البيانات',
    'تم استكمال البيانات':'تم استكمال بيانات طلبك',
    'الطلب مرفوض':'تعذر قبول طلبك',
    'تم تعديل موعد التسليم':'تم تحديث موعد طلبك',
    'تم اعتماد موعد التسليم':'تم اعتماد موعد طلبك',
  };
  return labels[status]||arabicLabel(status)||'يوجد تحديث جديد على طلبكم';
}
function dispatchLink(item){
  const attempt=String(item.dispatch_token||'').trim();
  if(!attempt)throw new TypeError('missing_dispatch_token');
  return `${platformUrl}#notice-${attempt}`;
}

export function outboundNotificationMessage(item){
  if(item.recipient_role==='client')return clientStatusMessage(item);
  if(!staffRoles.has(item.recipient_role))return 'يوجد تحديث جديد على الطلب';
  const summary=notificationSummary(item);
  const title=arabicLabel(summary.title,70),client=arabicLabel(summary.clientName,50);
  const subject=client?`طلب العميل ${client}`:'الطلب';
  const status=arabicLabel(summary.status,140)||'يوجد تحديث جديد على الطلب';
  if(summary.kind==='new_request')return `طلب جديد${client?` من العميل ${client}`:''}${title?` بعنوان ${title}`:''} بانتظار استلام المشرف المسؤول`;
  if(summary.kind==='admin_decision'||summary.kind==='task_due_internal'){
    // Keep the requested explanation concise in outbound copy only
    // Drop opaque links and Latin identifiers without changing the stored decision
    const explanation=arabicLabel(String(summary.explanation||'')
      .replace(/https?:\/\/\S+|www\.\S+|\S*@\S+|\b[A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*\b/g,' ')
      .replace(/[@/:]/g,' '),180);
    return `${status}${title?` لطلب ${title}`:''}${client?` للعميل ${client}`:''}${explanation?`\nتوضيح الإدارة ${explanation}`:''}`;
  }
  if(summary.kind==='routing'){
    const name=arabicLabel(summary.department,50);
    const section=name?(name.startsWith('قسم ')?name:`قسم ${name}`):'القسم';
    return `خطأ في توجيه مهمة ${client?`العميل ${client}`:'عميل'} من التواصل حسب إفادة ${section}`;
  }
  if(status==='بانتظار استلام المشرف المسؤول')return `تم تحويل ${subject} للمشرف المسؤول بانتظار الاستلام`;
  if(status==='استلم المشرف المسؤول الطلب')return `استلم المشرف المسؤول ${subject}`;
  const accepted=status.match(/^استلم (.+) المهمة وجار العمل عليها$/);
  if(accepted)return `استلم ${accepted[1]} مهمة ${title||'الطلب'}${client?` للعميل ${client}`:''} وجار العمل عليها`;
  return `${status}${title?` لطلب ${title}`:''}${client?` للعميل ${client}`:''}`;
}

// Match the immutable dispatch reference instead of mutable customer data
// The caller also checks recipient phone API origin timestamp and message status
export function matchesNotificationDispatch(text,item){
  if(typeof text!=='string')return false;
  const legacy=`صيت\n${item.message}\nمرجع الإشعار ${item.id} ${String(item.dispatch_token||'').trim()}\n${platformUrl}`;
  return text===legacy||(text.startsWith('صيت\n')&&text.split('\n').at(-1)===dispatchLink(item));
}

// Server-only caller supplies the service client after claiming authorized jobs
// Cache only for this dispatch batch Never expose phone metadata to the browser
export function createNotificationContextLoader(db){
  const users=new Map(),requests=new Map(),records=new Map();
  const read=(table,id,columns)=>{
    const key=`${table}:${id}`;
    if(!records.has(key))records.set(key,db.from(table).select(columns).eq('id',id).maybeSingle().then(({data,error})=>{
      if(error)throw error;
      return data;
    }));
    return records.get(key);
  };
  const user=id=>{
    if(!users.has(id))users.set(id,db.auth.admin.getUserById(id).then(({data,error})=>{
      if(error)throw error;
      return data.user;
    }));
    return users.get(id);
  };
  const request=id=>{
    if(!requests.has(id))requests.set(id,(async()=>{
      const response=await db.from('work_requests').select('id,title,number,client_id').eq('id',id).maybeSingle();
      if(response.error)throw response.error;
      if(!response.data)return {};
      const row=response.data;
      const profile=await db.from('account_profiles').select('display_name').eq('user_id',row.client_id).maybeSingle();
      if(profile.error)throw profile.error;
      const account=!profile.data?.display_name?await user(row.client_id):null;
      return {request_title:row.title,request_number:row.number,
        client_name:profile.data?.display_name||account?.user_metadata?.display_name||''};
    })());
    return requests.get(id);
  };
  return async item=>{
    const recipient=await user(item.recipient);
    const context=item.request_id?await request(item.request_id):{};
    const role=recipient?.app_metadata?.role||'';
    let department='';
    if(item.request_id&&(role==='client'||staffRoles.has(role))){
      const notice=await read('work_notifications',item.id,'event_key,request_id,recipient');
      const eventId=notice?.request_id===item.request_id&&notice?.recipient===item.recipient
        ?notice.event_key?.match(/^(?:control|event|journey):event:([0-9]+):(?:admin|coordinator|client)$/)?.[1]:null;
      const event=eventId?await read('work_events',eventId,'request_id,part_id'):null;
      const part=event?.request_id===item.request_id&&event.part_id?await read('work_parts',event.part_id,'request_id,service_id'):null;
      const service=part?.request_id===item.request_id&&part.service_id?await read('work_services',part.service_id,'name,active,client_visible'):null;
      if(service&&(role!=='client'||service.active&&service.client_visible))department=service.name;
    }
    // Auth app_metadata and server event identity determine the audience and department
    return {...item,...context,department_name:department,recipient_role:role};
  };
}
