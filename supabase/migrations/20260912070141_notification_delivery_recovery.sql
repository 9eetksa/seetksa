begin;

-- Promote the direct submission messages by event type instead of matching authored copy
create or replace function provision_private.work_event_broadcast()
returns trigger language plpgsql security definer set search_path='' as $$
declare request_row public.work_requests; label text; prefix text; control_key text;
begin
 select * into request_row from public.work_requests where id=new.request_id;
 if request_row.status='draft' then return null; end if;
 prefix=txid_current()::text||':'||request_row.id::text||':';
 if new.kind in('create','submit_request') then
  control_key='control:request:'||request_row.id::text||':submitted';
  with candidate as(
   select distinct on(notification.recipient) notification.id
   from public.work_notifications notification
   where notification.request_id=request_row.id and notification.event_key like prefix||'%'
   order by notification.recipient,notification.created_at,notification.id
  )
  update public.work_notifications notification
  set event_key=control_key,whatsapp=case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
   last_error=case when account.raw_app_meta_data->>'portal_qa'='true' then notification.last_error else null end,
   next_attempt=case when account.raw_app_meta_data->>'portal_qa'='true' then notification.next_attempt else now() end
  from candidate,auth.users account
  where candidate.id=notification.id and account.id=notification.recipient
   and not exists(select 1 from public.work_notifications existing where existing.id<>notification.id and existing.recipient=notification.recipient and existing.event_key=control_key);
  return null;
 end if;
 if new.kind in('dependency','due_approved','due_rejected','request_attachments','decline_intake') then return null; end if;
 label=case new.kind when 'intake' then 'استلام مسؤول التواصل'
  when 'assign' then 'إحالة مهمة' when 'accept' then 'استلام الموظف للمهمة' when 'deliver' then 'تسليم جديد'
  when 'review' then 'مراجعة العميل للتسليم' when 'attach' then 'مرفق جديد' when 'request_info' then 'طلب بيانات إضافية'
  when 'supply_info' then 'استكمال بيانات الطلب' when 'resolve' then 'قرار الإدارة' else 'تحديث على الطلب' end;
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select account.id,request_row.id,label||E'\n'||request_row.title,case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,prefix||'event'
 from auth.users account
 where (account.raw_app_meta_data->>'role' in('admin','super_admin') or exists(select 1 from public.work_staff staff where staff.user_id=account.id and staff.coordinator))
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
  and not exists(select 1 from public.work_notifications notification where notification.recipient=account.id and notification.event_key like prefix||'%')
 on conflict(recipient,event_key) where event_key is not null do nothing;
 return null;
end;
$$;
revoke all on function provision_private.work_event_broadcast() from public,anon,authenticated;

-- Claim only outcomes that are safe to retry
-- An interrupted external call is uncertain and must wait for an explicit owner retry
create or replace function public.work_notification_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update public.work_notifications notification set whatsapp='suppressed',last_error='recipient_in_app_only'
 from auth.users account
 where account.id=notification.recipient and account.raw_app_meta_data->>'role'='super_admin'
  and notification.request_id is not null and notification.whatsapp in('pending','failed','unknown','sending')
  and coalesce(notification.event_key,'') not like 'control:%';
 update public.work_notifications notification set whatsapp='suppressed',last_error='recipient_unavailable'
 from auth.users account
 where account.id=notification.recipient and notification.whatsapp in('pending','failed','unknown','sending')
  and (coalesce(account.is_anonymous,false) or (account.banned_until is not null and account.banned_until>=now())
   or coalesce(account.raw_app_meta_data->>'role','') not in('client','employee','admin','super_admin'));
 update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted',attempts=greatest(attempts,5)
 where whatsapp='sending' and next_attempt<now()-interval '2 minutes';
 with candidates as(
  select notification.id
  from public.work_notifications notification
  join auth.users account on account.id=notification.recipient
  where notification.whatsapp in('pending','failed') and notification.attempts<5 and notification.next_attempt<=now()
   and (notification.request_id is null or account.raw_app_meta_data->>'role' is distinct from 'super_admin' or coalesce(notification.event_key,'') like 'control:%')
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and account.raw_app_meta_data->>'role' in('client','employee','admin','super_admin')
  order by (coalesce(notification.event_key,'') like 'control:%') desc,notification.created_at
  for update of notification skip locked limit 15
 ),claimed as(
  update public.work_notifications notification set whatsapp='sending',attempts=attempts+1,next_attempt=now()
  from candidates candidate where notification.id=candidate.id returning notification.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',claimed.id,'recipient',claimed.recipient,'message',claimed.message,
  'request_id',claimed.request_id,'attempts',claimed.attempts,'claimed_at',claimed.next_attempt,
  'phone',coalesce(nullif(profile.phone,''),account.phone))),'[]') into result
 from claimed
 join auth.users account on account.id=claimed.recipient
 left join public.account_profiles profile on profile.user_id=claimed.recipient
 where claimed.whatsapp='sending';
 return result;
end;
$$;
revoke all on function public.work_notification_claim() from public,anon,authenticated;
grant execute on function public.work_notification_claim() to service_role;

-- Recover the currently suppressed owner alert without duplicating accepted provider messages
with candidate as(
 select distinct on(notification.recipient,notification.request_id) notification.id,notification.request_id
 from public.work_notifications notification
 join public.work_requests request on request.id=notification.request_id
 join auth.users account on account.id=notification.recipient
 where request.status='new' and request.intake_action_at is null
  and account.raw_app_meta_data->>'role'='super_admin'
  and notification.whatsapp='suppressed' and notification.last_error='recipient_in_app_only'
  and abs(extract(epoch from(notification.created_at-request.submitted_at)))<=5
 order by notification.recipient,notification.request_id,notification.created_at,notification.id
)
update public.work_notifications notification
set whatsapp='pending',last_error=null,next_attempt=now(),attempts=0,
 event_key='control:request:'||notification.request_id::text||':submitted'
from candidate
where candidate.id=notification.id
 and not exists(
  select 1 from public.work_notifications existing
  where existing.recipient=notification.recipient and existing.id<>notification.id
   and existing.event_key='control:request:'||notification.request_id::text||':submitted'
 );

-- Unknown means the provider outcome cannot be proven
-- Stop automatic retries to prevent duplicate external messages and keep owner retry available
update public.work_notifications set attempts=greatest(attempts,5)
where whatsapp='unknown' and attempts<5;

comment on function provision_private.work_event_broadcast() is 'Promotes request submission notices to mandatory control notifications by workflow event type';

commit;
