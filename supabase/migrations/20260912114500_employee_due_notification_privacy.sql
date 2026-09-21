begin;

-- A communication coordinator may also be assigned to a department
-- Approval is an administrative control event and must not be delivered to any employee role
do $patch_broadcast$
declare body text; anchor text:='if request_row.coordinator_id is not null and new.kind<>''dependency'' then';
begin
 body=pg_get_functiondef('provision_private.work_event_broadcast()'::regprocedure);
 if position(anchor in body)=0 then raise exception 'work_event_broadcast_coordinator_anchor_missing'; end if;
 body=replace(body,anchor,
  'if request_row.coordinator_id is not null and new.kind not in(''dependency'',''due_approved'',''due_auto_approved'') then');
 execute body;
end;
$patch_broadcast$;

create or replace function provision_private.work_notification_readable(p_notification uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(
  select 1
  from public.work_notifications notification
  left join public.work_events event
   on notification.event_key='event:event:'||event.id::text||':coordinator'
  where notification.id=p_notification and notification.recipient=auth.uid()
   and not(
    provision_private.work_role()='employee'
    and event.kind in('due_approved','due_auto_approved')
   )
 )
$$;
revoke all on function provision_private.work_notification_readable(uuid) from public,anon;
grant execute on function provision_private.work_notification_readable(uuid) to authenticated;

drop policy if exists work_notifications_read on public.work_notifications;
create policy work_notifications_read on public.work_notifications for select to authenticated
using(provision_private.work_notification_readable(id));

create or replace function public.work_notifications_page(p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_page integer:=least(greatest(coalesce(p_page,0),0),10000);
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'items',(select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc),'[]'::jsonb) from(
   select id,request_id,message,created_at,read_at,whatsapp,last_error,
    whatsapp_delivered_at,whatsapp_read_at,provider_status_at
   from public.work_notifications
   where recipient=auth.uid() and provision_private.work_notification_readable(id)
   order by created_at desc limit 40 offset safe_page*40
  )item),
  'unread_count',(select count(*) from public.work_notifications
   where recipient=auth.uid() and read_at is null and provision_private.work_notification_readable(id))
 );
end;
$$;
revoke all on function public.work_notifications_page(integer) from public,anon;
grant execute on function public.work_notifications_page(integer) to authenticated;

-- Stop unsent historical approval notices while retaining their audit rows
update public.work_notifications notification
set whatsapp='suppressed',last_error='employee_due_decision_hidden',next_attempt=now()
from auth.users account,public.work_events event
where account.id=notification.recipient
 and account.raw_app_meta_data->>'role'='employee'
 and notification.event_key='event:event:'||event.id::text||':coordinator'
 and event.kind in('due_approved','due_auto_approved')
 and notification.whatsapp in('pending','failed','unknown','sending');

comment on function provision_private.work_notification_readable(uuid) is
'Enforces recipient ownership and hides administrative due approval events from every employee role';

commit;
