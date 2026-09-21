// Summarize the known notification envelopes without rendering their private details
// Match only the action line so filenames and user notes cannot become statuses
const statuses = [
  [/رفض الإدارة لطلب مخرجات قسم/, 'رفضت الإدارة طلب المخرجات', 'attention'],
  [/جاهزية مخرجات قسم/, 'مخرجات القسم جاهزة', 'review'],
  [/تحديد موعد التسليم بعد استلام المخرجات/, 'تم تحديد موعد التسليم بعد استلام المخرجات', 'working'],
  [/رفض الطلب قبل التوزيع|تعذر اعتماد الطلب/, 'الطلب مرفوض', 'attention'],
  [/طلب تعديلات|طلب تعديل|استلام التعديلات|قيد التعديل|إحالة تعديل العميل/, 'تعديلات مطلوبة', 'attention'],
  [/اعتمد العميل|اعتماد العميل|تم تسجيل اعتمادك/, 'تم اعتماد التسليم', 'done'],
  [/مراجعة العميل للتسليم/, 'تمت مراجعة التسليم', 'done'],
  [/إرسال التسليم إلى العميل|بانتظار مراجعتك|يرجى مراجعة التسليم/, 'جاهز للمراجعة', 'review'],
  [/رفع تسليم داخلي|تسليم القسم|وصل تسليم الفريق|وصل التسليم بعد التعديل/, 'تسليم جديد من القسم', 'review'],
  [/طلب مرفقات|نحتاج مرفقات|يحتاج مرفقات/, 'مرفقات مطلوبة', 'attention'],
  [/بيانات إضافية|بيانات ناقصة|تحتاج استكمال بيانات|يراجع المشرف المسؤول بيانات مطلوبة/, 'بيانات مطلوبة', 'attention'],
  [/استكمال بيانات|اكتملت البيانات|تم استكمال/, 'تم استكمال البيانات', 'done'],
  [/رفض موعد|موعد بديل|يراجع الفريق الموعد المقترح/, 'تم تعديل موعد التسليم', 'attention'],
  [/اعتماد موعد|اعتمد.*موعد|تم تثبيت موعد/, 'تم اعتماد موعد التسليم', 'done'],
  [/استلام المشرف المسؤول|استلم فريق الإشراف|استلام المهمة من قبل فريق الإشراف/, 'استلم المشرف المسؤول الطلب', 'working'],
  [/طلبك قيد المتابعة مع المشرف المسؤول|تجاوز مهلة إجراء المشرف المسؤول/, 'الطلب قيد المتابعة لدى المشرف المسؤول', 'attention'],
  [/استلام القسم للمهمة|استلام المهمة وجار|استلام المهمة وتحديد|إلزام قسم|يمكنك بدء تنفيذ/, 'قيد التنفيذ', 'working'],
  [/إنشاء طلب|تم إنشاء طلبك|إرسال طلب جديد|تم إرسال طلبك|طلب جديد/, 'طلب جديد', 'waiting'],
  [/إحالة الطلب إلى قسم|توجيه طلبك|أحيلت إليك مهمة|وزع مسؤول القسم/, 'بانتظار استلام القسم', 'waiting'],
  [/طلب مخرجات|يحتاج مخرجاتك|يجري التنسيق بين أقسام/, 'بانتظار مخرجات قسم', 'waiting'],
  [/إحالة تسليم|إتاحة مخرجات|اعتمدت المخرجات|اعتمد المشرف المسؤول مخرجات|انتقل العمل إلى المرحلة التالية/, 'تم تسليم المخرجات', 'done'],
  [/إضافة مرفق|أضيف مرفق/, 'تم تحديث المرفقات', 'neutral'],
  [/تجاوز مهلة/, 'متأخر عن الموعد', 'attention'],
  [/تعذر التنفيذ|خارج النطاق|خطأ في الإحالة|معالجة عائق|يراجع المشرف المسؤول نطاق|يراجع المشرف المسؤول توجيه/, 'بانتظار قرار الإدارة', 'attention'],
  [/قرار إداري|قرار الإدارة|تمت معالجة إجراء داخلي|تم تحديث مسار العمل/, 'تم تحديث قرار الإدارة', 'neutral'],
  [/نقل.*المهمة/, 'تم تحديث إسناد المهمة', 'neutral'],
];

export function notificationSummary(item) {
  if (item.mission_id) {
    const status = String(item.message || '').split(' — ')[0] || 'تحديث المهمة';
    const tone = /تعذر|رفض/.test(status) ? 'attention' : /اكتملت|إنجاز|قبول/.test(status) ? 'done' : 'working';
    return {title:item.request_title || 'مهمة الفريق',status,tone,clientName:'',kind:'mission',explanation:''};
  }
  const lines = String(item.message || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const envelope = lines[0] === 'تحديث رقابي على الطلب';
  const field = label => envelope ? lines.find(line => line.startsWith(`${label} `))?.slice(label.length + 1).trim() : '';
  const action = (envelope ? field('الإجراء') : lines[0] || '')
    .replaceAll('مسؤول التواصل','المشرف المسؤول').replaceAll('فريق التواصل','فريق الإشراف');
  const number = item.request_number || field('الطلب');
  // Only these legacy templates put the request title on the second line
  // Other templates put notes or filenames there and must never be reused
  const titleTemplate = /^(تم إنشاء طلبك بنجاح|تم إرسال طلبك بنجاح|استلم فريق الإشراف طلبك وبدأ العمل عليه|اكتملت البيانات المطلوبة ويواصل الفريق العمل|تم توجيه طلبك إلى |طلبك بانتظار مراجعتك|أضيف مرفق جديد إلى طلبك|طلب جديد يحتاج مراجعة فريق الإشراف|تم استلام المهمة من قبل فريق الإشراف)/;
  const legacyTitle = !envelope && titleTemplate.test(action) ? lines[1] : '';
  const title = item.request_title || field('عنوان الطلب') || legacyTitle || (number ? `طلب ${number}` : item.request_id ? 'تحديث الطلب' : 'إشعار المنصة');
  const department = item.department_name || field('القسم المرتبط بالإجراء') || action.match(/^تم توجيه طلبك إلى قسم (.+)$/)?.[1] || action.match(/^قسم (.+) يحتاج (?:بيانات|مرفقات) إضافية$/)?.[1] || '';
  const clientName = item.client_name || field('العميل') || '';
  if(action==='أضاف المشرف المسؤول توضيحا داخليا للطلب')return {title,clientName,status:'أضاف المشرف المسؤول توضيحا داخليا',tone:'neutral',kind:'internal_clarification'};
  if(!envelope&&/^(?:وجهت الإدارة المهمة إلى قسم |أبقت الإدارة المهمة لدى قسم )\S/.test(action)){
    return {title,clientName,status:action,tone:'attention',kind:'admin_decision',explanation:lines.slice(1).join(' ').replace(/^توضيح الإدارة\s*/, '')};
  }
  // Only direct administrative templates may carry the decision explanation
  // Other event envelopes and free-form notes must not become notification copy
  const adminActions = new Map([
    ['كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد', 'كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد'],
    ['نقلت الإدارة مهمتك إلى موظف آخر', 'نقلت الإدارة مهمتك إلى موظف آخر'],
    ['قررت الإدارة استمرارك في تنفيذ المهمة', 'قررت الإدارة استمرارك في تنفيذ المهمة'],
    ['أعادت الإدارة المهمة إليك يرجى استلامها وتحديد موعد التسليم', 'أعادت الإدارة المهمة إليك يرجى استلامها وتحديد موعد التسليم'],
    ['قررت الإدارة إلزام القسم بتوفير المخرجات', 'قررت الإدارة إلزام القسم بتوفير المخرجات'],
    ['قررت الإدارة متابعة المهمة دون انتظار مخرجات القسم', 'قررت الإدارة متابعة المهمة دون انتظار مخرجات القسم'],
    ['قررت الإدارة إلزامك بتوفير المخرجات المطلوبة للقسم', 'قررت الإدارة إلزامك بتوفير المخرجات المطلوبة للقسم'],
    ['قررت الإدارة متابعة مهمة القسم الآخر دون انتظار مخرجاتك', 'قررت الإدارة متابعة مهمة القسم الآخر دون انتظار مخرجاتك'],
    ['أحيلت إليك مهمة بقرار الإدارة يرجى الاستلام وتحديد الموعد', 'كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد'],
    ['تم نقل المهمة إلى موظف آخر بقرار الإدارة', 'نقلت الإدارة مهمتك إلى موظف آخر'],
    ['صدر قرار الإدارة بشأن المهمة', 'صدر قرار الإدارة بشأن مهمتك يرجى مراجعة القرار داخل المهمة'],
  ]);
  if (!envelope && adminActions.has(action)) {
    const explanation = lines.slice(1).join(' ').replace(/^توضيح الإدارة\s*/, '');
    return {title,clientName,status:adminActions.get(action),tone:'attention',kind:'admin_decision',explanation};
  }
  if (/^عدلت الإدارة موعد تسليم مهمتك إلى .+$/.test(action)) {
    return {title,clientName,status:action,tone:'attention',kind:'admin_due_changed'};
  }
  // These date-change lines are authored by the personal planner RPC
  // Proposed and rejected extensions are internal and never describe a confirmed client date
  if (/^(?:طلب موظف قسم .+ تأجيل موعد التسليم إلى .+|وافقت الإدارة على تأجيل موعد تسليم مهمتك إلى .+|رفضت الإدارة تأجيل موعد تسليم مهمتك ويظل الموعد .+|رفضت الإدارة طلب تأجيل موعد تسليم مهمتك|قدم الموظف موعد تسليم قسم .+ إلى .+)$/.test(action)) {
    const explanation=!envelope&&/^(?:وافقت|رفضت) الإدارة/.test(action)?lines.slice(1).join(' ').replace(/^توضيح الإدارة\s*/, ''):'';
    return {title,clientName,status:action,tone:action.startsWith('وافقت')?'done':'attention',kind:'task_due_internal',explanation};
  }
  if (/^(?:تم تقديم|تحدث) موعد تسليم قسم .+ إلى .+$/.test(action)) {
    return {title,clientName,status:action,tone:'done',kind:'task_due_confirmed'};
  }
  const acceptedOutput=action.match(/^تم توجيه طلبك إلى قسم (.+) واستلم القسم المهمة$/);
  if (acceptedOutput) {
    return {title,clientName,status:`استلم قسم ${acceptedOutput[1]} المهمة وجار العمل عليها`,tone:'working'};
  }
  // These anchored first-line templates are authored by the output-task RPC
  // Never use its following free-text instructions in notifications
  if (/^رفضت الإدارة طلبك لمخرجات قسم .+$/.test(action)) {
    return {title,clientName,status:action,tone:'attention',kind:'output_internal'};
  }
  if (/^مخرجات قسم .+ جاهزة (?:حدد موعد تسليم مهمتك|وبانتظار بقية المخرجات)$/.test(action)) {
    return {title,clientName,status:action,tone:'review',kind:'output_internal'};
  }
  const outputRequest=action.match(/^قسم (.+) طلب مخرجات قسم (.+)$/);
  if (outputRequest) {
    return {title,clientName,status:`طلب مخرجات من قسم ${outputRequest[1]} بانتظار استلامك`,tone:'waiting',kind:'output_internal'};
  }
  if (/خطأ في الإحالة|خطأ في توجيه/.test(action)) {
    const reportingDepartment=field('القسم المرتبط بالإجراء')||department;
    const section=reportingDepartment?(reportingDepartment.startsWith('قسم ')?reportingDepartment:`قسم ${reportingDepartment}`):'القسم المبلّغ';
    return {title,clientName,status:`خطأ في توجيه المهمة حسب إفادة ${section}`,tone:'attention',kind:'routing',department:reportingDepartment};
  }
  if (/الرد على طلب مخرجات|ورد رد|رد القسم|يوجد رد|تم تحديث التنسيق بين أقسام/.test(action)) {
    return {title, clientName, status: department ? `يوجد رد من ${department.startsWith('قسم ')?department:`قسم ${department}`}` : 'يوجد رد من أحد الأقسام', tone: 'review'};
  }
  const match = statuses.find(([pattern]) => pattern.test(action));
  let status=match?.[1] || 'تحديث جديد';
  const section=department?(department.startsWith('قسم ')?department:`قسم ${department}`):'القسم';
  if(status==='طلب جديد')return {title,clientName,status:'طلب جديد بانتظار استلام المشرف المسؤول',tone:'waiting',kind:'new_request'};
  if(status==='بانتظار استلام القسم')status=`تم تحويل المهمة إلى ${section} بانتظار الاستلام`;
  if(status==='قيد التنفيذ')status=`استلم ${section} المهمة وجار العمل عليها`;
  if(status==='بيانات مطلوبة'&&department)status=`${section} يحتاج بيانات إضافية`;
  if(status==='مرفقات مطلوبة'&&department)status=`${section} يحتاج مرفقات إضافية`;
  if(status==='تسليم جديد من القسم')status=`وصل تسليم ${section} لمراجعة المشرف المسؤول`;
  return {title, clientName, status, tone:match?.[2] || 'neutral'};
}
