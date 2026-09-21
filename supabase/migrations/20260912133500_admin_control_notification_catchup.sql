begin;

-- The first control-envelope catch-up only targeted super admins
-- Recover the same mandatory detailed alert for every active admin without duplicating existing rows
insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
select account.id,event.request_id,provision_private.work_event_message(event.id),
 case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
 'control:event:'||event.id::text||':admin'
from public.work_events event
join public.work_requests request on request.id=event.request_id
cross join auth.users account
where event.kind in('routing','reject','scope')
 and event.created_at>=now()-interval '48 hours'
 and request.status<>'draft'
 and account.raw_app_meta_data->>'role' in('admin','super_admin')
 and not coalesce(account.is_anonymous,false)
 and (account.banned_until is null or account.banned_until<now())
 and (not request.test or account.raw_app_meta_data->>'portal_qa'='true')
 and exists(
  select 1 from public.work_escalations escalation
  where escalation.request_id=event.request_id and escalation.status='open'
   and (event.part_id is null or escalation.part_id=event.part_id)
   and abs(extract(epoch from(escalation.created_at-event.created_at)))<=10
 )
on conflict(recipient,event_key) where event_key is not null do nothing;

do $verify_admin_control_catchup$
begin
 if exists(
  select 1
  from public.work_events event
  join public.work_requests request on request.id=event.request_id
  cross join auth.users account
  where event.kind in('routing','reject','scope')
   and event.created_at>=now()-interval '48 hours'
   and request.status<>'draft'
   and account.raw_app_meta_data->>'role' in('admin','super_admin')
   and not coalesce(account.is_anonymous,false)
   and (account.banned_until is null or account.banned_until<now())
   and (not request.test or account.raw_app_meta_data->>'portal_qa'='true')
   and exists(
    select 1 from public.work_escalations escalation
    where escalation.request_id=event.request_id and escalation.status='open'
     and (event.part_id is null or escalation.part_id=event.part_id)
     and abs(extract(epoch from(escalation.created_at-event.created_at)))<=10
   )
   and not exists(
    select 1 from public.work_notifications notification
    where notification.recipient=account.id
     and notification.event_key='control:event:'||event.id::text||':admin'
   )
 ) then raise exception 'admin_control_notification_catchup_failed'; end if;
end;
$verify_admin_control_catchup$;

commit;
