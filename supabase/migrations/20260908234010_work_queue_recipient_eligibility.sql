begin;

-- Queued messages must respect current account availability at claim time
-- Historical accepted sends and onboarding notifications remain untouched
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_notification_claim()'::regprocedure);
 needle=$old$update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted'$old$;
 if strpos(body,needle)=0 then raise exception 'queue_recipient_suppression_guard'; end if;
 body=replace(body,needle,$new$update public.work_notifications n set whatsapp='suppressed',last_error='recipient_unavailable'
 from auth.users u where u.id=n.recipient and n.whatsapp in ('pending','failed','unknown','sending')
 and (coalesce(u.is_anonymous,false) or (u.banned_until is not null and u.banned_until>=now())
  or coalesce(u.raw_app_meta_data->>'role','') not in ('client','employee','admin','super_admin'));
 update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted'$new$);
 needle=$old$and (n.request_id is null or u.raw_app_meta_data->>'role' is distinct from 'super_admin')$old$;
 if strpos(body,needle)=0 then raise exception 'queue_recipient_claim_guard'; end if;
 body=replace(body,needle,needle||$new$
   and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<now())
   and u.raw_app_meta_data->>'role' in ('client','employee','admin','super_admin')$new$);
 execute body;

 -- Workload warnings are advisory for both internal release paths
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$exists(select 1 from public.work_escalations where part_id=handoff_part.id and status='open')$old$;
 if strpos(body,needle)=0 then raise exception 'queue_advisory_handoff_guard'; end if;
 body=replace(body,needle,$new$exists(select 1 from public.work_escalations where part_id=handoff_part.id and status='open' and kind<>'overload')$new$);
 execute body;
end;
$migration$;

commit;
