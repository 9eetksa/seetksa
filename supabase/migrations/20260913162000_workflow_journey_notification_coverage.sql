-- Client journey acknowledgements are independent of internal event/file visibility
-- Each supported transition has one durable event-scoped notification
create or replace function provision_private.work_event_client_notice_required(p_event_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select event_row.kind in(
  'create','submit_request','intake','request_info','supply_info','assign','accept',
  'missing','reject','routing','dependency','dependency_reply','deliver','scope','resolve',
  'release_dependencies','force_start','force_dependency_waived','release_delivery','review',
  'attach','handoff','due_approved','due_rejected','due_auto_approved','request_attachments',
  'decline_intake','intake_overdue','route_revision'
 ) from public.work_events event_row join public.work_requests request_row on request_row.id=event_row.request_id
 where event_row.id=p_event_id and request_row.status<>'draft'),false)
$$;

do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('provision_private.work_client_event_message(bigint)'::regprocedure);
 needle=$old$when 'release_delivery' then$old$;
 if strpos(body,needle)=0 then raise exception 'journey_message_anchor_missing'; end if;
 body=replace(body,needle,$new$when 'deliver' then case when changes
   then 'وصل التسليم بعد التعديل إلى مسؤول التواصل للمراجعة وسنبلغك عندما يصبح جاهزا لاعتمادك'
   else 'وصل تسليم الفريق إلى مسؤول التواصل للمراجعة وسنبلغك عندما يصبح جاهزا لاعتمادك' end||E'\n'||request_row.title
  when 'missing' then 'يراجع مسؤول التواصل بيانات مطلوبة لاستكمال العمل وسيتواصل معك عند الحاجة'||E'\n'||request_row.title
  when 'reject' then 'يتابع مسؤول التواصل معالجة عائق في تنفيذ طلبك'||E'\n'||request_row.title
  when 'routing' then 'يراجع مسؤول التواصل توجيه طلبك إلى الفريق المناسب'||E'\n'||request_row.title
  when 'scope' then 'يراجع مسؤول التواصل نطاق التعديلات المطلوبة على طلبك'||E'\n'||request_row.title
  when 'resolve' then 'تمت معالجة إجراء داخلي لاستكمال طلبك'||E'\n'||request_row.title
  when 'dependency' then 'يجري التنسيق بين أقسام الفريق لاستكمال طلبك'||E'\n'||request_row.title
  when 'dependency_reply' then 'تم تحديث التنسيق بين أقسام الفريق بشأن طلبك'||E'\n'||request_row.title
  when 'release_dependencies' then 'اعتمد مسؤول التواصل مخرجات العمل الداخلية لاستكمال المرحلة التالية'||E'\n'||request_row.title
  when 'force_dependency_waived' then 'تم تحديث مسار العمل لاستكمال طلبك'||E'\n'||request_row.title
  when 'handoff' then 'انتقل العمل إلى المرحلة التالية داخل الفريق'||E'\n'||request_row.title
  when 'due_approved' then 'تم اعتماد موعد تنفيذ المهمة داخل الفريق وسيوافيك مسؤول التواصل بموعد التسليم النهائي'||E'\n'||request_row.title
  when 'due_auto_approved' then 'تم تثبيت موعد تنفيذ المهمة داخل الفريق وسيوافيك مسؤول التواصل بموعد التسليم النهائي'||E'\n'||request_row.title
  when 'due_rejected' then 'يراجع الفريق الموعد المقترح لتنفيذ طلبك'||E'\n'||request_row.title
  when 'intake_overdue' then 'طلبك قيد المتابعة مع مسؤول التواصل لاستكمال الإجراء المطلوب'||E'\n'||request_row.title
  when 'review' then case when length(trim(coalesce(event_row.note,'')))>0
   then 'وصل طلب التعديل إلى مسؤول التواصل لإحالته إلى القسم'
   else 'تم تسجيل اعتمادك للتسليم بنجاح' end||E'\n'||request_row.title
  when 'release_delivery' then$new$);
 execute body;
 -- Promote direct client fragments for every supported event into its one stable envelope
 body=pg_get_functiondef('provision_private.work_event_broadcast()'::regprocedure);
 needle=$old$if new.kind in('intake','request_info','assign','accept','force_start','release_delivery') then$old$;
 if strpos(body,needle)=0 then raise exception 'journey_dedupe_anchor_missing'; end if;
 body=replace(body,needle,$new$if provision_private.work_event_client_notice_required(new.id) then$new$);
 execute body;
end $migration$;
