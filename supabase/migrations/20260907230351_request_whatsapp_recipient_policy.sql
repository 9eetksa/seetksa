begin;

-- Request notifications remain visible to super admins in the platform
-- Account notifications have no request_id and keep their existing channels
create function provision_private.work_request_whatsapp_policy()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.request_id is not null and new.whatsapp in ('pending','failed','unknown','sending')
  and exists(select 1 from auth.users u where u.id=new.recipient and u.raw_app_meta_data->>'role'='super_admin') then
  new.whatsapp='suppressed';
  new.last_error='recipient_in_app_only';
 end if;
 return new;
end;
$$;
revoke all on function provision_private.work_request_whatsapp_policy() from public,anon,authenticated;
create trigger work_request_whatsapp_policy
before insert or update of whatsapp,recipient,request_id on public.work_notifications
for each row execute function provision_private.work_request_whatsapp_policy();

update public.work_notifications n
set whatsapp='suppressed',last_error='recipient_in_app_only'
from auth.users u
where u.id=n.recipient and u.raw_app_meta_data->>'role'='super_admin'
 and n.request_id is not null and n.whatsapp in ('pending','failed','unknown','sending');

-- Recheck the current recipient role when claiming to cover later role changes
create or replace function public.work_notification_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update public.work_notifications n set whatsapp='suppressed',last_error='recipient_in_app_only'
 from auth.users u where u.id=n.recipient and u.raw_app_meta_data->>'role'='super_admin'
 and n.request_id is not null and n.whatsapp in ('pending','failed','unknown','sending');
 update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted'
 where whatsapp='sending' and next_attempt<now()-interval '2 minutes';
 with candidates as (
  select n.id from public.work_notifications n join auth.users u on u.id=n.recipient
  where n.whatsapp in ('pending','failed') and n.attempts<5 and n.next_attempt<=now()
   and (n.request_id is null or u.raw_app_meta_data->>'role' is distinct from 'super_admin')
  order by n.created_at for update of n skip locked limit 15
 ), claimed as (
  update public.work_notifications n set whatsapp='sending',attempts=attempts+1,next_attempt=now()
  from candidates c where n.id=c.id returning n.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'recipient',c.recipient,'message',c.message,
  'request_id',c.request_id,'attempts',c.attempts,'claimed_at',c.next_attempt,
  'phone',coalesce(nullif(p.phone,''),u.phone))),'[]') into result
 from claimed c join auth.users u on u.id=c.recipient left join public.account_profiles p on p.user_id=c.recipient;
 return result;
end;
$$;
revoke all on function public.work_notification_claim() from public,anon,authenticated;
grant execute on function public.work_notification_claim() to service_role;

-- Notify the client at the same routing step as the assigned employee
-- Employee delivery still goes through coordinator review before client release
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$perform provision_private.work_notify(target,r.id,'أحيلت إليك مهمة جديدة يرجى الاستلام وتحديد موعد التسليم' || E'\n' || a.scope || E'\nحالة المهمة ' || case when a.priority='urgent' then 'مستعجل' else 'عادي' end);$old$;
 if strpos(body,needle)=0 then raise exception 'request_notification_routing_shape'; end if;
 body=replace(body,needle,needle||$new$
   perform provision_private.work_notify(r.client_id,r.id,'وجه مسؤول التواصل طلبك إلى قسم ' || (select name from public.work_services where id=sid) || E'\n' || r.title);$new$);
 execute body;
end;
$migration$;

commit;
