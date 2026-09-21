-- Acknowledgement at routing is distinct from the department accepting execution
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('provision_private.work_event_client_notice_required(bigint)'::regprocedure);
 needle=$old$'release_delivery','request_attachments'$old$;
 if strpos(body,needle)=0 then raise exception 'revision_recipient_anchor_missing'; end if;
 body=replace(body,needle,$new$'release_delivery','route_revision','request_attachments'$new$);
 -- Only the curated acknowledgement is client-facing  Internal event details stay private
 body=replace(body,'select event_row.client_visible', 'select (event_row.client_visible or event_row.kind=''route_revision'')');
 body=replace(body,$old$event_row.kind='release_delivery'$old$,$new$event_row.kind in('release_delivery','route_revision')$new$);
 execute body;
 body=pg_get_functiondef('provision_private.work_client_event_message(bigint)'::regprocedure);
 needle=$old$when 'release_delivery' then$old$;
 if strpos(body,needle)=0 then raise exception 'revision_client_copy_anchor_missing'; end if;
 body=replace(body,needle,$new$when 'route_revision' then 'قبل مسؤول التواصل طلب التعديل وأحاله إلى القسم المختص وسنبلغك عند بدء التنفيذ'||E'\n'||request_row.title
  when 'release_delivery' then$new$);
 execute body;
 body=pg_get_functiondef('provision_private.work_event_action_label(text)'::regprocedure);
 needle=$old$when 'assign' then 'إحالة الطلب إلى قسم'$old$;
 if strpos(body,needle)=0 then raise exception 'revision_event_label_anchor_missing'; end if;
 body=replace(body,needle,needle||$new$
  when 'route_revision' then 'قبول تعديل العميل وإحالته إلى القسم'
$new$);
 execute body;
end $migration$;
