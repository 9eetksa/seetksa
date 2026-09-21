begin;

-- A coordinator may be enabled after a client submitted an intake request
-- Queue only the missing recipient notification without repeating admin copies
create function provision_private.work_coordinator_intake_catchup(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select u.id,r.id,'طلب بانتظار مسؤول التواصل'||E'\n'||r.title,
  case when u.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
  'intake:'||r.id::text
 from auth.users u
 join public.work_staff s on s.user_id=u.id and s.coordinator
 cross join public.work_requests r
 where u.id=p_user
  and u.raw_app_meta_data->>'role' in ('employee','admin','super_admin')
  and not coalesce(u.is_anonymous,false)
  and (u.banned_until is null or u.banned_until<now())
  and r.status in ('new','needs_info') and r.coordinator_id is null
  and (not r.test or u.raw_app_meta_data->>'portal_qa'='true')
  and not exists(
   select 1 from public.work_notifications n where n.recipient=u.id and n.request_id=r.id
  )
 on conflict(recipient,event_key) where event_key is not null do nothing;
end;
$$;
revoke all on function provision_private.work_coordinator_intake_catchup(uuid)
from public,anon,authenticated;

create function provision_private.work_staff_intake_catchup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not new.coordinator then return null; end if;
 if tg_op='UPDATE' then
  if old.coordinator then return null; end if;
 end if;
 perform provision_private.work_coordinator_intake_catchup(new.user_id);
 return null;
end;
$$;
revoke all on function provision_private.work_staff_intake_catchup()
from public,anon,authenticated;

create trigger work_staff_intake_catchup
after insert or update of coordinator on public.work_staff
for each row execute function provision_private.work_staff_intake_catchup();

-- Recover requests that arrived before the currently configured coordinators
do $$
declare staff_rec record;
begin
 for staff_rec in select s.user_id from public.work_staff s where s.coordinator loop
  perform provision_private.work_coordinator_intake_catchup(staff_rec.user_id);
 end loop;
end;
$$;

commit;
