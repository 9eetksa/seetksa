import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {notificationSummary} from '../supabase/functions/_shared/notification-summary.js';
import {outboundNotificationMessage,matchesNotificationDispatch,createNotificationContextLoader} from '../supabase/functions/_shared/notification-message.js';
import {reconcileUncertainDeliveries} from '../api/work-notifications.js';

test('inherited database event wording is interpreted using Seet supervisor labels',()=>{
 const summary=notificationSummary({message:'تحديث رقابي على الطلب\nالإجراء استلام مسؤول التواصل للطلب'});
 assert.equal(summary.status,'استلم المشرف المسؤول الطلب');
 const missing=notificationSummary({message:'يراجع مسؤول التواصل بيانات مطلوبة',department_name:'التصوير'});
 assert.equal(missing.status,'قسم التصوير يحتاج بيانات إضافية');
});

test('internal clarification staff copy describes the event without exposing its body',()=>{
 const item={request_title:'حملة تجريبية',client_name:'عميل تجريبي',recipient_role:'employee',message:'تحديث رقابي على الطلب\nالإجراء أضاف المشرف المسؤول توضيحا داخليا للطلب\nالتفاصيل معلومة داخلية خاصة'};
 assert.equal(notificationSummary(item).kind,'internal_clarification');
 assert.equal(outboundNotificationMessage(item),'أضاف المشرف المسؤول توضيحا داخليا لطلب حملة تجريبية للعميل عميل تجريبي');
 assert.doesNotMatch(outboundNotificationMessage({...item,recipient_role:'client'}),/توضيح|داخلية|خاصة/);
});

test('new requests with attachments announce the client and title without attachment details',()=>{
 const context={request_title:'تصميم الحملة',client_name:'عميل تجريبي'};
 const messages=['طلب جديد لدى المشرف المسؤول\nتصميم الحملة','تحديث رقابي على الطلب\nالإجراء إرسال طلب جديد\nعنوان الطلب تصميم الحملة\nالعميل عميل تجريبي\nمسميات مرفقات العميل\nملف خاص.jpg\nمحتوى الطلب\nبيانات داخلية'];
 for(const message of messages)for(const recipient_role of ['employee','admin','super_admin']){
  const item={...context,message,recipient_role};
  assert.equal(outboundNotificationMessage(item),'طلب جديد من العميل عميل تجريبي بعنوان تصميم الحملة بانتظار استلام المشرف المسؤول');
  assert.equal(notificationSummary(item).status,'طلب جديد بانتظار استلام المشرف المسؤول');
  assert.doesNotMatch(outboundNotificationMessage(item),/مرفق|ملف خاص|بيانات داخلية/);
 }
 assert.equal(outboundNotificationMessage({...context,recipient_role:'client',message:'تم إرسال طلبك بنجاح\nتصميم الحملة'}),'تم تحويل طلبكم للمشرف المسؤول بانتظار الاستلام');
 assert.equal(notificationSummary({...context,message:'تحديث رقابي على الطلب\nالإجراء إضافة مرفق إلى الطلب'}).status,'تم تحديث المرفقات');
});

test('administrative decisions tell the affected employee what to do and preserve the explanation',()=>{
 const notices=[
  'كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد',
  'نقلت الإدارة مهمتك إلى موظف آخر',
  'قررت الإدارة استمرارك في تنفيذ المهمة',
  'أعادت الإدارة المهمة إليك يرجى استلامها وتحديد موعد التسليم',
  'وجهت الإدارة المهمة إلى قسم التصميم يرجى استلامها وتحديد موعد التسليم',
  'وجهت الإدارة المهمة إلى قسم التصوير',
  'أبقت الإدارة المهمة لدى قسم التصميم',
  'قررت الإدارة إلزام القسم بتوفير المخرجات',
  'قررت الإدارة متابعة المهمة دون انتظار مخرجات القسم',
  'قررت الإدارة إلزامك بتوفير المخرجات المطلوبة للقسم',
  'قررت الإدارة متابعة مهمة القسم الآخر دون انتظار مخرجاتك',
 ];
 for(const action of notices){
  const notice={message:action+'\nتوضيح الإدارة المهمة ضمن اختصاص القسم\nيرجى التنسيق مع المشرف',recipient_role:'employee',request_title:'تصميم الحملة',client_name:'عميل تجريبي'};
  const message=outboundNotificationMessage(notice);
  assert.equal(message,`${action} لطلب تصميم الحملة للعميل عميل تجريبي\nتوضيح الإدارة المهمة ضمن اختصاص القسم يرجى التنسيق مع المشرف`);
  assert.equal(notificationSummary(notice).status,action);
  assert.doesNotMatch(message,/[A-Za-z]|https?:|مرجع|تم تحديث قرار الإدارة/);
  // Database eligibility prevents client delivery The formatter is a second privacy boundary
  assert.equal(outboundNotificationMessage({...notice,recipient_role:'client'}),'طلبكم قيد المتابعة لدى الفريق');
  assert.equal(outboundNotificationMessage({...notice,recipient_role:'unknown'}),'يوجد تحديث جديد على الطلب');
 }
});

test('legacy assignments remain actionable and only direct administrative templates expose explanations',()=>{
 const notice={recipient_role:'employee',message:'أحيلت إليك مهمة بقرار الإدارة يرجى الاستلام وتحديد الموعد',request_title:'تصميم الحملة'};
 assert.match(outboundNotificationMessage(notice),/^كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد/);
 assert.doesNotMatch(outboundNotificationMessage(notice),/توضيح الإدارة/);
 const decision={...notice,message:'صدر قرار الإدارة بشأن المهمة\nالمهمة ضمن اختصاص القسم'};
 assert.match(outboundNotificationMessage(decision),/توضيح الإدارة المهمة ضمن اختصاص القسم$/);
 assert.doesNotMatch(outboundNotificationMessage({...notice,message:'تم استلام المهمة وجار تنفيذها\nتوضيح الإدارة نص لا يخص هذا الإشعار'}),/نص لا يخص|توضيح الإدارة/);
 assert.doesNotMatch(outboundNotificationMessage({...notice,message:'تحديث رقابي على الطلب\nالإجراء اتخاذ قرار إداري على تصعيد\nتفاصيل الإجراء\nنص داخلي'}),/نص داخلي/);
});

test('administrative explanations are bounded Arabic copy without opaque links or references',()=>{
 const notice={recipient_role:'employee',message:'قررت الإدارة استمرارك في تنفيذ المهمة\nتوضيح الإدارة السبب: المهمة ضمن اختصاص القسم https://private.test/path ABC-123 user@example.test '+ 'مطلوب '.repeat(100)};
 const text=outboundNotificationMessage(notice);
 assert.match(text,/توضيح الإدارة السبب المهمة ضمن اختصاص القسم/);
 assert.doesNotMatch(text,/[A-Za-z@/:]|123/);
 assert.ok(text.split('\nتوضيح الإدارة ')[1].length<=180);
 assert.match(notice.message,/private.test/); // Stored input remains unchanged
});

test('direct department requests stay concise and distinguish data from files',()=>{
 for(const kind of ['بيانات','مرفقات']){
  const message=`قسم التصوير يحتاج ${kind} إضافية`;
  assert.equal(outboundNotificationMessage({message,recipient_role:'client',request_title:'عنوان طويل لا يضاف للإشعار'}),message);
  assert.equal(notificationSummary({message}).status,message);
 }
});

const item={id:'notification-id',request_id:'request-id',recipient:'recipient-id',
  dispatch_token:'c04a8a40-a402-4222-b91c-f169d56cd772',
  message:'تحديث رقابي على الطلب\nالإجراء الرد على طلب مخرجات قسم\nالطلب 25\nعنوان الطلب تصميم الهوية\nالعميل عميل تجريبي\nرقم التواصل +966500000001\nالقسم المرتبط بالإجراء التصميم\nتفاصيل الإجراء\nملاحظة داخلية سرية\nمسميات ملفات التسليم\nprivate-file.pdf',
  client_name:'عميل تجريبي',client_phone:'+966500000001'};

test('in-app summary shows only title status and client name',()=>{
  const summary=notificationSummary(item);
  assert.equal(summary.clientName,'عميل تجريبي');
  assert.equal(summary.status,'يوجد رد من قسم التصميم');
  assert.doesNotMatch(JSON.stringify(summary),/private-file|سرية|966500000001/);
});

test('WhatsApp is one Arabic sentence without contacts references links or private content for every role',()=>{
  for(const role of ['employee','admin','super_admin']){
    const message=outboundNotificationMessage({...item,recipient_role:role});
    assert.match(message,/للعميل عميل تجريبي/);
    assert.doesNotMatch(message,/[A-Za-z@\n]|966500000001|سرية|مسميات|تفاصيل|مرجع الإشعار/);
  }
  for(const role of ['unknown',undefined]){
    const message=outboundNotificationMessage({...item,recipient_role:role});
    assert.doesNotMatch(message,/عميل تجريبي|966500000001/);
    assert.equal(message,'يوجد تحديث جديد على الطلب');
  }
  const clientMessage=outboundNotificationMessage({...item,recipient_role:'client'});
  assert.equal(clientMessage,'يوجد رد من قسم التصميم');
  assert.doesNotMatch(clientMessage,/[0-9٠-٩]|https?:|عميل تجريبي|تصميم الهوية|pdf/);
});

test('recovery retains old markers but never attributes an unmarked sentence to an attempt',()=>{
  const sent=outboundNotificationMessage({...item,recipient_role:'employee'});
  assert.equal(matchesNotificationDispatch(sent,{...item,client_name:'اسم جديد',client_phone:'changed'}),false);
  assert.equal(matchesNotificationDispatch(sent,{...item,dispatch_token:'different-attempt'}),false);
  const legacy=`صيت\n${item.message}\nمرجع الإشعار ${item.id} ${item.dispatch_token}\n/login`;
  assert.equal(matchesNotificationDispatch(legacy,item),true);
  const previousCompact=`صيت\nعنوان قديم\n/login#notice-${item.dispatch_token}`;
  assert.equal(matchesNotificationDispatch(previousCompact,item),true);
  assert.equal(matchesNotificationDispatch(previousCompact,{...item,dispatch_token:'other'}),false);
});

test('user editable role never authorizes contacts and request reads are cached within the batch',async()=>{
  let reads=0;
  const db={auth:{admin:{getUserById:async()=>({data:{user:{app_metadata:{role:'client'},user_metadata:{role:'admin'}}}})}},
    from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>{
      reads++;
      return {data:table==='work_requests'?{title:'تصميم الهوية',number:25,client_id:'client-id'}:{display_name:'عميل تجريبي',phone:'+966500000001'}};
    }})})})};
  const enrich=createNotificationContextLoader(db);
  const [first,second]=await Promise.all([enrich(item),enrich(item)]);
  assert.equal(reads,3);
  assert.equal(first.recipient_role,'client');
  assert.doesNotMatch(outboundNotificationMessage(second),/966500000001/);
});

test('an ambiguous status-only client send is neither linked to the wrong request nor resent',async()=>{
  let finished;
  const pending={...item,phone:'+966500000001',dispatch_started_at:'2026-09-18T12:00:00Z',recovery_token:'recovery'};
  const db={rpc:async(name,payload)=>{
    if(name==='work_notification_uncertain_claim')return {data:[pending]};
    finished=payload;return {data:{matched:0}};
  }};
  await reconcileUncertainDeliveries({GREEN_API_URL:'https://example.greenapi.com'},db,async()=>({ok:true,json:async()=>[
    {idMessage:'provider-id',sendByApi:true,statusMessage:'delivered',chatId:'966500000001@c.us',
      timestamp:Date.parse('2026-09-18T12:00:01Z')/1000,textMessage:outboundNotificationMessage({...item,recipient_role:'client'})}
  ]}));
  assert.deepEqual(finished,{p_matches:[],p_retries:[]});
});

test('intake and department acceptance distinguish receiving from waiting for every audience',()=>{
 const intake={...item,message:'تحديث رقابي على الطلب\nالإجراء استلام المشرف المسؤول للطلب'};
 assert.equal(outboundNotificationMessage({...intake,recipient_role:'client'}),'استلم المشرف المسؤول طلبكم');
 assert.equal(outboundNotificationMessage({...intake,recipient_role:'admin'}),'استلم المشرف المسؤول طلب العميل عميل تجريبي');
 const received={...item,request_title:'تصميم الهوية',department_name:'التصميم',message:'تم استلام المهمة وجار تنفيذها'};
 for(const role of ['client','employee','admin','super_admin']){
  const text=outboundNotificationMessage({...received,recipient_role:role});
  assert.match(text,/استلم قسم التصميم مهمة تصميم الهوية/);
  assert.match(text,/وجار العمل عليها$/);
  assert.match(text,/تصميم الهوية/);
  assert.doesNotMatch(text,/[A-Za-z@\n]|مرجع|966500000001/);
 }
 assert.match(outboundNotificationMessage({...received,message:'تم توجيه طلبك إلى قسم التصميم',recipient_role:'admin'}),/بانتظار الاستلام/);
 assert.equal(outboundNotificationMessage({...received,message:'طلب جديد يحتاج مراجعة فريق الإشراف',recipient_role:'admin'}),'طلب جديد من العميل عميل تجريبي بعنوان تصميم الهوية بانتظار استلام المشرف المسؤول');
 assert.equal(outboundNotificationMessage({...received,message:'طلبك قيد المتابعة مع المشرف المسؤول لاستكمال الإجراء المطلوب',recipient_role:'client'}),'طلبكم قيد المتابعة لدى المشرف المسؤول');
});

test('English labels and URLs never leak through custom titles names or departments',()=>{
 for(const role of ['client','admin']){
  const message=outboundNotificationMessage({...item,recipient_role:role,request_title:'Campaign https://example.test',client_name:'Client ABC',department_name:'Design',message:'تم استلام المهمة وجار تنفيذها'});
  assert.doesNotMatch(message,/[A-Za-z@/:]|dispatch|مرجع/);
 }
});

test('department context follows the exact event and respects client visibility',async()=>{
 for(const visible of [true,false]){
  const tables={work_requests:{id:'request-id',title:'تصميم الهوية',number:25,client_id:'client-id'},account_profiles:{display_name:'عميل تجريبي'},work_notifications:{event_key:'journey:event:42:client',request_id:'request-id',recipient:'recipient-id'},work_events:{request_id:'request-id',part_id:'part-id'},work_parts:{request_id:'request-id',service_id:'service-id'},work_services:{name:'التصميم',active:true,client_visible:visible}};
  const db={auth:{admin:{getUserById:async()=>({data:{user:{app_metadata:{role:'client'}}}})}},from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:tables[table]})})})})};
  const enriched=await createNotificationContextLoader(db)(item);
  assert.equal(enriched.department_name,visible?'التصميم':'');
  tables.work_events.request_id='another-request';
  assert.equal((await createNotificationContextLoader(db)(item)).department_name,'');
 }
});

test('unmarked staff messages cannot cause duplicate retry even when wording or context changed',async()=>{
 let finished;
 const pending={...item,phone:'+966500000001',dispatch_started_at:'2026-09-18T12:00:00Z',recovery_token:'recovery'};
 const db={rpc:async(name,payload)=>name==='work_notification_uncertain_claim'?{data:[pending]}:(finished=payload,{data:{matched:0}})};
 await reconcileUncertainDeliveries({GREEN_API_URL:'https://example.greenapi.com'},db,async()=>({ok:true,json:async()=>[{idMessage:'provider-id',sendByApi:true,statusMessage:'delivered',chatId:'966500000001@c.us',timestamp:Date.parse('2026-09-18T12:00:01Z')/1000,textMessage:'استلم قسم التصميم المهمة وجار العمل عليها للعميل السابق'}]}));
 assert.deepEqual(finished,{p_matches:[],p_retries:[]});
});

test('department metadata migration retains recipient guards and client service visibility',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20260918175105_compact_notification_department_context.sql',import.meta.url),'utf8');
 assert.match(sql,/provision_private\.account_ready\(\)/);
 assert.equal((sql.match(/notification\.recipient=auth\.uid\(\)/g)||[]).length,2);
 assert.equal((sql.match(/provision_private\.work_notification_readable\(notification.id\)/g)||[]).length,2);
 assert.match(sql,/work_role\(\)='client' and service.active and service.client_visible/);
 assert.match(sql,/event.request_id=notification.request_id/);
 assert.match(sql,/part.request_id=notification.request_id/);
 assert.match(sql,/revoke all on function public.work_notifications_page\(integer\) from public,anon/);
 assert.doesNotMatch(sql,/profile\.phone|account\.phone|service_role|alter table|create policy/);
});
test('routing reports are concise and use the reporting department before reassignment',()=>{
 const notice={request_title:'عنوان طويل لا حاجة لإرساله',client_name:'العميل التجريبي',department_name:'التصميم',message:'تحديث رقابي على الطلب\nالإجراء إبلاغ القسم عن خطأ في الإحالة\nالقسم المرتبط بالإجراء التصوير\nمحتوى الطلب تفاصيل خاصة'};
 assert.equal(outboundNotificationMessage({...notice,recipient_role:'admin'}),'خطأ في توجيه مهمة العميل العميل التجريبي من التواصل حسب إفادة قسم التصوير');
 assert.match(notificationSummary(notice).status,/حسب إفادة قسم التصوير$/);
 assert.doesNotMatch(outboundNotificationMessage({...notice,recipient_role:'super_admin'}),/عنوان|خاصة|[A-Za-z@/:\n]/);
 assert.equal(outboundNotificationMessage({...notice,recipient_role:'client'}),'طلبكم قيد المتابعة لدى المشرف المسؤول');
});

test('missing-data notices identify the affected department without exposing its instructions',()=>{
 const notice={recipient_role:'client',department_name:'التصوير',message:'يراجع المشرف المسؤول بيانات مطلوبة لاستكمال العمل وسيتواصل معك عند الحاجة\nتفاصيل تكليف داخلية'};
 assert.equal(outboundNotificationMessage(notice),'قسم التصوير يحتاج بيانات إضافية');
});

test('output task notices distinguish assignment rejection and the required delivery date',()=>{
 const cases=[
  ['قسم التصميم طلب مخرجات قسم التصوير','طلب مخرجات من قسم التصميم بانتظار استلامك'],
  ['رفضت الإدارة طلبك لمخرجات قسم التصوير','رفضت الإدارة طلبك لمخرجات قسم التصوير'],
  ['مخرجات قسم التصوير جاهزة حدد موعد تسليم مهمتك','مخرجات قسم التصوير جاهزة حدد موعد تسليم مهمتك'],
  ['مخرجات قسم التصوير جاهزة وبانتظار بقية المخرجات','مخرجات قسم التصوير جاهزة وبانتظار بقية المخرجات'],
 ];
 for(const [message,status] of cases){
  const notice={recipient_role:'employee',message:`${message}\nتعليمات داخلية خاصة https://private.test`};
  assert.equal(notificationSummary(notice).status,status);
  assert.match(outboundNotificationMessage(notice),new RegExp(`^${status}`));
  assert.doesNotMatch(outboundNotificationMessage(notice),/تعليمات|خاصة|[A-Za-z@/:\n]/);
  assert.equal(outboundNotificationMessage({...notice,recipient_role:'client'}),'طلبكم قيد المتابعة لدى الفريق');
 }
 assert.equal(notificationSummary({message:'تحديث رقابي على الطلب\nالإجراء رفض الإدارة لطلب مخرجات قسم'}).status,'رفضت الإدارة طلب المخرجات');
 assert.equal(outboundNotificationMessage({recipient_role:'client',message:'تم توجيه طلبك إلى قسم التصوير واستلم القسم المهمة'}),'استلم قسم التصوير مهمة طلبكم وجار العمل عليها');
});

test('an administrative deadline change preserves the actual Arabic date in the employee notice',()=>{
 const message='عدلت الإدارة موعد تسليم مهمتك إلى ٢١ سبتمبر ٢٠٢٦';
 assert.equal(outboundNotificationMessage({recipient_role:'employee',message}),message+' لطلب إشعار المنصة');
 assert.equal(outboundNotificationMessage({recipient_role:'client',message}),'تم تحديث موعد تسليم طلبكم');
 assert.doesNotMatch(outboundNotificationMessage({recipient_role:'employee',message}),/[A-Za-z@/:\n]/);
});
