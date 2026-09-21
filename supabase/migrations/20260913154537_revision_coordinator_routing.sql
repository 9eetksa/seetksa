-- Client changes wait for coordinator routing then reuse normal task acceptance
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$elsif action in ('accept','missing','reject','scope','routing','dependency','deliver') then$old$;
 if strpos(body,needle)=0 then raise exception 'revision_routing_anchor_missing'; end if;
 body=replace(body,needle,$new$elsif action='route_revision' then
   if a.id is null or not(provision_private.work_coordinator() or provision_private.work_manage(a.service_id)) then raise exception 'forbidden' using errcode='42501'; end if;
   if r.status<>'active' or a.status<>'revision' then raise exception 'invalid_state'; end if;
   select * into d from public.work_deliveries where request_id=r.id and part_id=a.id and status='changes' order by created_at desc,id limit 1;
   if d.id is null then raise exception 'invalid_state'; end if;
   update public.work_parts set status='offered',accepted_at=null where id=a.id;
   note=d.feedback;
   perform provision_private.work_notify(a.assignee_id,r.id,'أحال مسؤول التواصل تعديل العميل إلى قسمك يرجى الاستلام وتحديد الموعد' || E'\n' || coalesce(d.feedback,''));
  elsif action in ('accept','missing','reject','scope','routing','dependency','deliver') then$new$);
 needle=$old$if a.status not in ('working','revision') or provision_private.work_dependency_blocked(a.id) then raise exception 'dependency_pending'; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'revision_delivery_anchor_missing'; end if;
 body=replace(body,needle,$new$if a.status='revision' then raise exception 'revision_routing_required'; end if;
    if a.status<>'working' or provision_private.work_dependency_blocked(a.id) then raise exception 'dependency_pending'; end if;$new$);
 body=replace(body,'العميل طلب تعديلات على التسليم وهي قيد التنفيذ لديك','العميل طلب تعديلات على التسليم بانتظار إحالة مسؤول التواصل');
 needle=$old$perform provision_private.work_notify(r.client_id,r.id,'تم استلام التعديلات وجار تنفيذها');$old$;
 if strpos(body,needle)=0 then raise exception 'revision_notice_anchor_missing'; end if;
 body=replace(body,needle,$new$perform provision_private.work_notify(r.client_id,r.id,'وصل طلب التعديل إلى مسؤول التواصل لإحالته للقسم');
    perform provision_private.work_notify(r.coordinator_id,r.id,'طلب العميل تعديلا يحتاج إحالتك إلى القسم الذي سلّم العمل' || E'\n' || why);$new$);
 execute body;
end $migration$;
