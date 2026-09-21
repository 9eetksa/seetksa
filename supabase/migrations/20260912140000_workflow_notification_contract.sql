begin;

-- Automated control decisions are first class audit events
alter table public.work_events alter column actor drop not null;
alter table public.work_notifications
 add column if not exists dispatch_started_at timestamptz,
 add column if not exists dispatch_token uuid,
 add column if not exists dispatch_phone text,
 add column if not exists recovery_lease_until timestamptz,
 add column if not exists recovery_token uuid;
create index if not exists work_notifications_uncertain_recovery
 on public.work_notifications(recovery_lease_until,dispatch_started_at)
 where whatsapp='unknown' and provider_id is null;

-- Rows created by the previous worker do not carry an attempt identity and cannot be
-- matched safely against the provider journal  Requeue them once under the new contract
update public.work_notifications set
 whatsapp='failed',attempts=greatest(attempts,5),next_attempt=now(),
 last_error='legacy_delivery_outcome_unrecoverable',provider_checked_at=now(),
 recovery_lease_until=null,recovery_token=null
where provider_id is null and dispatch_token is null and (
 whatsapp='unknown' or whatsapp='sending' and next_attempt<now()-interval '2 minutes'
);

create table if not exists provision_private.work_notification_contract(
 id boolean primary key default true check(id),
 enforced_at timestamptz not null
);
revoke all on table provision_private.work_notification_contract from public,anon,authenticated;
grant all on table provision_private.work_notification_contract to service_role;
insert into provision_private.work_notification_contract(id,enforced_at)
values(true,now())
on conflict(id) do update set enforced_at=excluded.enforced_at;

create or replace function provision_private.work_provider_status(value text)
returns text language sql immutable set search_path='' as $$
 select case lower(trim(coalesce(value,'')))
  when 'pending' then 'sent'
  when 'sent' then 'sent'
  when 'yellowcard' then 'sent'
  when 'delivered' then 'delivered'
  when 'read' then 'read'
  when 'failed' then 'failed'
  when 'noaccount' then 'failed'
  when 'notingroup' then 'failed'
  else null
 end
$$;
revoke all on function provision_private.work_provider_status(text) from public,anon,authenticated;

-- Every server generated notification leaves a durable obligation behind
-- The obligation survives accidental outbox deletion and records its intended audience
create table if not exists provision_private.work_notification_requirements(
 recipient uuid not null references auth.users on delete cascade,
 event_key text not null check(length(event_key) between 1 and 500),
 request_id uuid references public.work_requests on delete cascade,
 message text not null check(length(message) between 1 and 12000),
 audience text not null check(audience in('manager','client','coordinator','coordinator_pool','employee','account','retired')),
 delivery_required boolean not null default true,
 fulfilled_at timestamptz,
 created_at timestamptz not null default now(),
 primary key(recipient,event_key)
);
create index if not exists work_notification_requirements_open
 on provision_private.work_notification_requirements(created_at,recipient)
 where fulfilled_at is null and delivery_required;
alter table provision_private.work_notification_requirements enable row level security;
revoke all on table provision_private.work_notification_requirements from public,anon,authenticated;
grant all on table provision_private.work_notification_requirements to service_role;

create table if not exists provision_private.work_event_notification_links(
 event_id bigint not null references public.work_events on delete cascade,
 recipient uuid not null references auth.users on delete cascade,
 audience text not null check(audience='coordinator'),
 event_key text not null check(length(event_key) between 1 and 500),
 created_at timestamptz not null default now(),
 primary key(event_id,recipient,audience),
 unique(recipient,event_key)
);
alter table provision_private.work_event_notification_links enable row level security;
revoke all on table provision_private.work_event_notification_links from public,anon,authenticated;
grant all on table provision_private.work_event_notification_links to service_role;

create or replace function provision_private.work_notification_requirement_capture()
returns trigger language plpgsql security definer set search_path='' as $$
declare role_name text; audience_name text;
begin
 if tg_op='UPDATE' and (
  old.recipient is distinct from new.recipient or old.event_key is distinct from new.event_key
 ) then
  delete from provision_private.work_notification_requirements requirement
  where requirement.recipient=old.recipient and requirement.event_key=old.event_key;
 end if;
 if new.event_key is null then return new; end if;
 select account.raw_app_meta_data->>'role' into role_name from auth.users account where account.id=new.recipient;
 audience_name=case
 when new.event_key like 'control:event:%:admin' then 'manager'
 when new.event_key like 'journey:event:%:client' then 'client'
 when new.event_key like 'event:event:%:coordinator' then 'coordinator'
 when role_name='employee' and exists(
  select 1 from public.work_requests request_row
  where request_row.id=new.request_id and request_row.coordinator_id=new.recipient
 ) and (
  new.event_key like 'control:due:%:proposed'
  or new.event_key like 'control:dependency:%:created' and not exists(
   select 1 from public.work_dependencies link
   join public.work_parts source on source.id=link.upstream_id
   where new.event_key='control:dependency:'||link.id::text||':created' and (
    source.assignee_id=new.recipient or exists(
     select 1 from public.work_memberships membership
     where membership.service_id=source.service_id and membership.user_id=new.recipient
      and membership.member_role='lead'
    )
   )
  )
 ) then 'coordinator'
  when new.request_id is null then 'account'
  when role_name in('admin','super_admin') then 'manager'
  when exists(select 1 from public.work_requests request_row where request_row.id=new.request_id and request_row.client_id=new.recipient) then 'client'
  when role_name='employee' then 'employee'
  else 'retired'
 end;
 insert into provision_private.work_notification_requirements(
  recipient,event_key,request_id,message,audience,delivery_required,fulfilled_at,created_at
 ) values(
  new.recipient,new.event_key,new.request_id,left(new.message,12000),audience_name,
  new.whatsapp<>'suppressed',case when new.whatsapp in('delivered','read','suppressed') then now() end,new.created_at
 ) on conflict(recipient,event_key) do update set
  request_id=excluded.request_id,message=excluded.message,
  audience=provision_private.work_notification_requirements.audience,
  delivery_required=provision_private.work_notification_requirements.delivery_required or excluded.delivery_required,
  fulfilled_at=case
   when new.whatsapp in('delivered','read') then coalesce(provision_private.work_notification_requirements.fulfilled_at,now())
   when new.whatsapp='suppressed' and not provision_private.work_notification_requirements.delivery_required
    then coalesce(provision_private.work_notification_requirements.fulfilled_at,now())
   else null
  end;
 return new;
end;
$$;
revoke all on function provision_private.work_notification_requirement_capture() from public,anon,authenticated;
drop trigger if exists work_notification_requirement_capture on public.work_notifications;
create trigger work_notification_requirement_capture
after insert or update of recipient,request_id,message,whatsapp,event_key on public.work_notifications
for each row execute function provision_private.work_notification_requirement_capture();

-- Classify existing rows fail closed so a later role change cannot expose internal history
insert into provision_private.work_notification_requirements(
 recipient,event_key,request_id,message,audience,delivery_required,fulfilled_at,created_at
)
select notification.recipient,notification.event_key,notification.request_id,left(notification.message,12000),
 case
  when notification.event_key like 'control:event:%:admin' then 'manager'
  when notification.event_key like 'journey:event:%:client' then 'client'
  when notification.event_key like 'event:event:%:coordinator' then 'coordinator'
  when account.raw_app_meta_data->>'role'='employee' and request_row.coordinator_id=notification.recipient and (
   notification.event_key like 'control:due:%:proposed'
   or notification.event_key like 'control:dependency:%:created' and not exists(
    select 1 from public.work_dependencies link
    join public.work_parts source on source.id=link.upstream_id
    where notification.event_key='control:dependency:'||link.id::text||':created' and (
     source.assignee_id=notification.recipient or exists(
      select 1 from public.work_memberships membership
      where membership.service_id=source.service_id and membership.user_id=notification.recipient
       and membership.member_role='lead'
     )
    )
   )
  ) then 'coordinator'
  when account.raw_app_meta_data->>'role'='employee' and request_row.status='new'
   and request_row.coordinator_id is null
   and notification.message like any(array['طلب جديد يحتاج مراجعة فريق التواصل%','طلب جديد لدى مسؤول التواصل%'])
   and exists(
    select 1 from public.work_staff staff
    where staff.user_id=notification.recipient and staff.coordinator
   ) then 'coordinator_pool'
  when account.raw_app_meta_data->>'role'='employee'
   and notification.message like any(array['طلب جديد يحتاج مراجعة فريق التواصل%','طلب جديد لدى مسؤول التواصل%'])
   then 'retired'
  when account.raw_app_meta_data->>'role'='employee'
   and notification.event_key like 'control:due:%:proposed' then 'retired'
  when account.raw_app_meta_data->>'role'='employee'
   and notification.event_key like 'control:dependency:%:created' and not exists(
    select 1 from public.work_dependencies link
    join public.work_parts source on source.id=link.upstream_id
    where notification.event_key='control:dependency:'||link.id::text||':created' and (
     source.assignee_id=notification.recipient or exists(
      select 1 from public.work_memberships membership
      where membership.service_id=source.service_id and membership.user_id=notification.recipient
       and membership.member_role='lead'
     )
    )
   ) then 'retired'
  when notification.request_id is null then 'account'
  when account.raw_app_meta_data->>'role' in('admin','super_admin') then 'manager'
  when request_row.client_id=notification.recipient then 'client'
  when account.raw_app_meta_data->>'role'='employee' then 'employee'
  else 'retired'
 end,
 notification.whatsapp<>'suppressed',
 case when notification.whatsapp in('delivered','read','suppressed') then coalesce(notification.provider_status_at,notification.created_at) end,
 notification.created_at
from public.work_notifications notification
join auth.users account on account.id=notification.recipient
left join public.work_requests request_row on request_row.id=notification.request_id
where notification.event_key is not null
on conflict(recipient,event_key) do nothing;

create or replace function provision_private.work_event_action_label(kind text)
returns text language sql immutable set search_path='' as $$
 select case kind
  when 'create' then 'إنشاء طلب'
  when 'submit_request' then 'إرسال طلب جديد'
  when 'intake' then 'استلام مسؤول التواصل للطلب'
  when 'request_info' then 'طلب بيانات إضافية'
  when 'supply_info' then 'استكمال بيانات الطلب'
  when 'assign' then 'إحالة الطلب إلى قسم'
  when 'accept' then 'استلام القسم للمهمة وتحديد الموعد'
  when 'missing' then 'إبلاغ القسم عن بيانات ناقصة'
  when 'reject' then 'إبلاغ القسم عن تعذر التنفيذ'
  when 'routing' then 'إبلاغ القسم عن خطأ في الإحالة'
  when 'dependency' then 'طلب مخرجات قسم سابق'
  when 'dependency_reply' then 'الرد على طلب مخرجات قسم'
  when 'deliver' then 'رفع تسليم داخلي من القسم'
  when 'scope' then 'إبلاغ القسم عن عمل خارج النطاق'
  when 'resolve' then 'اتخاذ قرار إداري على تصعيد'
  when 'release_dependencies' then 'إتاحة مخرجات لقسم مرتبط'
  when 'force_start' then 'إلزام قسم ببدء التنفيذ'
  when 'force_dependency_waived' then 'إلغاء انتظار مخرجات بقرار إداري'
  when 'release_delivery' then 'إرسال التسليم إلى العميل'
  when 'review' then 'مراجعة العميل للتسليم'
  when 'attach' then 'إضافة مرفق إلى الطلب'
  when 'handoff' then 'إحالة تسليم إلى القسم التالي'
  when 'due_approved' then 'اعتماد موعد تسليم القسم'
  when 'due_rejected' then 'رفض موعد القسم وتحديد موعد بديل'
  when 'due_auto_approved' then 'اعتماد موعد القسم تلقائيا بعد انتهاء مهلة الإدارة'
  when 'request_attachments' then 'طلب مرفقات من العميل'
  when 'decline_intake' then 'رفض الطلب قبل التوزيع'
  when 'intake_overdue' then 'تجاوز مهلة إجراء مسؤول التواصل'
  else 'تحديث داخلي على الطلب'
 end
$$;
revoke all on function provision_private.work_event_action_label(text) from public,anon,authenticated;

-- Keep overload context inside the single detailed management envelope
create or replace function provision_private.work_event_message(event_id bigint)
returns text language plpgsql stable security definer set search_path='' as $$
declare event_row public.work_events; base_message text; overload_notes text;
begin
 select * into event_row from public.work_events event_item where event_item.id=event_id;
 if event_row.id is null then return null; end if;
 base_message=provision_private.work_request_control_message(
  event_row.request_id,
  provision_private.work_event_action_label(event_row.kind),
  event_row.actor,
  event_row.part_id,
  event_row.note
 );
 select string_agg(left(escalation.reason,1200),E'\n\n' order by escalation.created_at,escalation.id)
 into overload_notes
 from public.work_escalations escalation
 where escalation.request_id=event_row.request_id and escalation.kind='overload' and escalation.status='open'
  and (event_row.part_id is null or escalation.part_id=event_row.part_id)
  and escalation.opened_by is not distinct from event_row.actor
  and abs(extract(epoch from(escalation.created_at-event_row.created_at)))<=10;
 return left(base_message||case when overload_notes is not null
  then E'\nتنبيه ضغط العمل\n'||overload_notes else '' end,12000);
end;
$$;
revoke all on function provision_private.work_event_message(bigint) from public,anon,authenticated;

-- An unknown event is private by default  Only this reviewed list can enter the client timeline
create or replace function provision_private.work_event_visibility_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='supply_info' and not exists(
  select 1 from public.work_events issue
  where issue.request_id=new.request_id and issue.kind in('request_info','request_attachments','missing')
   and issue.id>coalesce((select max(resolved.id) from public.work_events resolved
    where resolved.request_id=new.request_id and resolved.kind='supply_info'),0)
 ) then
  raise exception 'invalid_state';
 end if;
 if new.kind not in('create','submit_request','intake','request_info','supply_info','assign','accept','release_delivery','review','attach','request_attachments','decline_intake') then
  new.client_visible=false;
 end if;
 if new.kind='assign' and new.part_id is not null and not exists(
  select 1 from public.work_parts part join public.work_services service on service.id=part.service_id
  where part.id=new.part_id and part.request_id=new.request_id and service.active and service.client_visible
 ) then new.client_visible=false; end if;
 return new;
end;
$$;
revoke all on function provision_private.work_event_visibility_guard() from public,anon,authenticated;

create or replace function provision_private.work_event_client_notice_required(p_event_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((
  select event_row.client_visible
   and (event_row.kind in('create','submit_request','intake','request_info','assign','accept','release_delivery','request_attachments','decline_intake')
    or event_row.kind in('supply_info','attach') and event_row.actor is distinct from request_row.client_id)
   and (event_row.part_id is null or event_row.kind='release_delivery' or exists(
    select 1 from public.work_parts part join public.work_services service on service.id=part.service_id
    where part.id=event_row.part_id and service.active and service.client_visible
   ))
  from public.work_events event_row
  join public.work_requests request_row on request_row.id=event_row.request_id
  where event_row.id=p_event_id and request_row.status<>'draft'
 ),false)
$$;
revoke all on function provision_private.work_event_client_notice_required(bigint) from public,anon,authenticated;

create or replace function provision_private.work_event_coordinator_notice_required(p_event_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((
  select request_row.coordinator_id is not null
   and event_row.actor is distinct from request_row.coordinator_id
   and event_row.kind not in('dependency','handoff','force_dependency_waived','due_approved','due_auto_approved')
   and not(event_row.kind='due_rejected' and part.assignee_id=request_row.coordinator_id)
  from public.work_events event_row
  join public.work_requests request_row on request_row.id=event_row.request_id
  left join public.work_parts part on part.id=event_row.part_id
  where event_row.id=p_event_id and request_row.status<>'draft'
 ),false)
$$;
revoke all on function provision_private.work_event_coordinator_notice_required(bigint) from public,anon,authenticated;

create or replace function provision_private.work_client_event_message(p_event_id bigint)
returns text language plpgsql stable security definer set search_path='' as $$
declare event_row public.work_events; request_row public.work_requests;
 service_name text; service_visible boolean:=false; changes boolean:=false; message text;
begin
 select * into event_row from public.work_events where id=p_event_id;
 if event_row.id is null then return null; end if;
 select * into request_row from public.work_requests where id=event_row.request_id;
 if event_row.part_id is not null then
  select service.name,service.active and service.client_visible
  into service_name,service_visible
  from public.work_parts part join public.work_services service on service.id=part.service_id
  where part.id=event_row.part_id;
  select exists(select 1 from public.work_deliveries delivery
   where delivery.part_id=event_row.part_id and delivery.status='changes') into changes;
 end if;
 message=case event_row.kind
  when 'create' then 'تم إنشاء طلبك بنجاح'||E'\n'||request_row.title
  when 'submit_request' then 'تم إرسال طلبك بنجاح'||E'\n'||request_row.title
  when 'intake' then 'استلم فريق التواصل طلبك وبدأ العمل عليه'||E'\n'||request_row.title
  when 'request_info' then 'نحتاج بيانات إضافية لإكمال طلبك'||case when length(trim(event_row.note))>0 then E'\n'||event_row.note else '' end
  when 'supply_info' then 'اكتملت البيانات المطلوبة ويواصل الفريق العمل'||E'\n'||request_row.title
  when 'assign' then case when service_visible
   then 'تم توجيه طلبك إلى قسم '||service_name||E'\n'||request_row.title
   else 'تم توجيه طلبك إلى فريق التنفيذ'||E'\n'||request_row.title end
  when 'accept' then case when changes then 'تم استلام التعديلات وجار تنفيذها' else 'تم استلام المهمة وجار تنفيذها' end
  when 'force_start' then 'تم استلام المهمة وجار تنفيذها'
  when 'release_delivery' then 'طلبك بانتظار مراجعتك ويمكنك اعتماد التسليم أو طلب تعديل'||E'\n'||request_row.title
  when 'attach' then 'أضيف مرفق جديد إلى طلبك'||E'\n'||request_row.title
  when 'request_attachments' then 'نحتاج مرفقات إضافية لإكمال طلبك'||case when length(trim(event_row.note))>0 then E'\n'||event_row.note else '' end
  when 'decline_intake' then 'تعذر اعتماد الطلب'||case when length(trim(event_row.note))>0 then E'\nسبب القرار '||event_row.note else '' end
  else provision_private.work_event_action_label(event_row.kind)||E'\n'||request_row.title
 end;
 return left(message,12000);
end;
$$;
revoke all on function provision_private.work_client_event_message(bigint) from public,anon,authenticated;

-- The event id and audience are the only deduplication identity
create or replace function provision_private.work_ensure_event_notifications(p_event_id bigint)
returns integer language plpgsql security definer set search_path='' as $$
declare event_row public.work_events; request_row public.work_requests;
 event_message text; client_message text; linked_key text; changed integer:=0; total_changed integer:=0;
begin
 select * into event_row from public.work_events where id=p_event_id;
 if event_row.id is null then return 0; end if;
 select * into request_row from public.work_requests where id=event_row.request_id;
 if request_row.id is null or request_row.status='draft' then return 0; end if;
 event_message=provision_private.work_event_message(event_row.id);

 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select account.id,request_row.id,event_message,
  case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
  'control:event:'||event_row.id::text||':admin'
 from auth.users account
 where account.raw_app_meta_data->>'role' in('admin','super_admin')
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
 on conflict(recipient,event_key) where event_key is not null do nothing;
 get diagnostics changed=row_count; total_changed=total_changed+changed;

 if provision_private.work_event_coordinator_notice_required(event_row.id) then
  select link.event_key into linked_key
  from provision_private.work_event_notification_links link
  where link.event_id=event_row.id and link.recipient=request_row.coordinator_id and link.audience='coordinator';
  if linked_key is null then
   linked_key='event:event:'||event_row.id::text||':coordinator';
   insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
   select account.id,request_row.id,event_message,
    case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,linked_key
   from auth.users account where account.id=request_row.coordinator_id
    and coalesce(account.raw_app_meta_data->>'role','') not in('admin','super_admin')
    and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
    and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
   on conflict(recipient,event_key) where event_key is not null do nothing;
   get diagnostics changed=row_count; total_changed=total_changed+changed;
   insert into provision_private.work_event_notification_links(event_id,recipient,audience,event_key)
   select event_row.id,notification.recipient,'coordinator',notification.event_key
   from public.work_notifications notification
   where notification.recipient=request_row.coordinator_id and notification.event_key=linked_key
   on conflict(event_id,recipient,audience) do nothing;
  end if;
 end if;

 if provision_private.work_event_client_notice_required(event_row.id) then
  client_message=provision_private.work_client_event_message(event_row.id);
  insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
  select account.id,request_row.id,client_message,
   case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
   'journey:event:'||event_row.id::text||':client'
  from auth.users account where account.id=request_row.client_id
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
  on conflict(recipient,event_key) where event_key is not null do nothing;
  get diagnostics changed=row_count; total_changed=total_changed+changed;
 end if;
 return total_changed;
end;
$$;
revoke all on function provision_private.work_ensure_event_notifications(bigint) from public,anon,authenticated;

create or replace function provision_private.work_event_broadcast()
returns trigger language plpgsql security definer set search_path='' as $$
declare request_row public.work_requests; prefix text; coordinator_key text;
begin
 select * into request_row from public.work_requests where id=new.request_id;
 if request_row.id is null or request_row.status='draft' then return null; end if;
 prefix=txid_current()::text||':'||request_row.id::text||':';

 -- A direct operational notice can satisfy the coordinator audience without being erased
 if provision_private.work_event_coordinator_notice_required(new.id) then
  select notification.event_key into coordinator_key
  from public.work_notifications notification
  join auth.users account on account.id=notification.recipient
  where notification.recipient=request_row.coordinator_id and notification.request_id=request_row.id
   and account.raw_app_meta_data->>'role' not in('admin','super_admin')
   and (
    notification.event_key like prefix||'%'
    or new.kind='accept' and new.part_id is not null and notification.event_key=(
     select 'control:due:'||review.id::text||':proposed'
     from provision_private.work_due_reviews review
     where review.request_id=new.request_id and review.part_id=new.part_id and review.status='pending'
     order by review.proposed_at desc limit 1
    )
   )
  order by notification.created_at desc,notification.id desc limit 1;
  if coordinator_key is not null then
   insert into provision_private.work_event_notification_links(event_id,recipient,audience,event_key)
   values(new.id,request_row.coordinator_id,'coordinator',coordinator_key)
   on conflict(event_id,recipient,audience) do nothing;
   if new.kind<>'assign' then
    update provision_private.work_notification_requirements requirement set audience='coordinator'
    where requirement.recipient=request_row.coordinator_id and requirement.event_key=coordinator_key;
   end if;
  end if;
 end if;

 -- Managers receive exactly one complete control envelope for the event
 delete from provision_private.work_notification_requirements requirement
 where exists(
  select 1 from public.work_notifications notification join auth.users account on account.id=notification.recipient
  where notification.recipient=requirement.recipient and notification.event_key=requirement.event_key
   and notification.request_id=request_row.id and account.raw_app_meta_data->>'role' in('admin','super_admin')
   and notification.provider_id is null and (
    notification.event_key like prefix||'%'
    or new.kind='accept' and new.part_id is not null and notification.event_key=(
     select 'control:due:'||review.id::text||':proposed'
     from provision_private.work_due_reviews review
     where review.request_id=new.request_id and review.part_id=new.part_id and review.status='pending'
     order by review.proposed_at desc limit 1
    )
   )
 );
 delete from public.work_notifications notification using auth.users account
 where account.id=notification.recipient and account.raw_app_meta_data->>'role' in('admin','super_admin')
  and notification.request_id=request_row.id and notification.provider_id is null and (
   notification.event_key like prefix||'%'
   or new.kind='accept' and new.part_id is not null and notification.event_key=(
    select 'control:due:'||review.id::text||':proposed'
    from provision_private.work_due_reviews review
    where review.request_id=new.request_id and review.part_id=new.part_id and review.status='pending'
    order by review.proposed_at desc limit 1
   )
  );

 -- Client fragments generated before the event are promoted into one journey envelope
 if new.kind in('intake','request_info','assign','accept','force_start','release_delivery') then
  delete from provision_private.work_notification_requirements requirement
  where exists(select 1 from public.work_notifications notification
   where notification.recipient=requirement.recipient and notification.event_key=requirement.event_key
    and notification.recipient=request_row.client_id and notification.request_id=request_row.id
    and notification.event_key like prefix||'%' and notification.provider_id is null);
  delete from public.work_notifications notification
  where notification.recipient=request_row.client_id and notification.request_id=request_row.id
   and notification.event_key like prefix||'%' and notification.provider_id is null;
 end if;

 perform provision_private.work_ensure_event_notifications(new.id);

 if exists(
  select 1 from auth.users account
  where account.raw_app_meta_data->>'role' in('admin','super_admin')
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications notification
    where notification.recipient=account.id and notification.event_key='control:event:'||new.id::text||':admin')
 ) then raise exception 'notification_contract_admin'; end if;

 if provision_private.work_event_client_notice_required(new.id) and exists(
  select 1 from auth.users account where account.id=request_row.client_id
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications notification
    where notification.recipient=account.id and notification.event_key='journey:event:'||new.id::text||':client')
 ) then raise exception 'notification_contract_client'; end if;

 if provision_private.work_event_coordinator_notice_required(new.id) and exists(
  select 1 from auth.users account where account.id=request_row.coordinator_id
   and coalesce(account.raw_app_meta_data->>'role','') not in('admin','super_admin')
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(
    select 1 from provision_private.work_event_notification_links link
    join public.work_notifications notification on notification.recipient=link.recipient and notification.event_key=link.event_key
    where link.event_id=new.id and link.recipient=account.id and link.audience='coordinator'
   )
 ) then raise exception 'notification_contract_coordinator'; end if;
 return null;
end;
$$;
revoke all on function provision_private.work_event_broadcast() from public,anon,authenticated;

drop trigger if exists work_event_broadcast on public.work_events;
create trigger work_event_broadcast after insert on public.work_events
for each row execute function provision_private.work_event_broadcast();

-- A missing request recipient means every active communication coordinator
create or replace function provision_private.work_notify(who uuid,r uuid,msg text)
returns void language plpgsql security definer set search_path='' as $$
declare marker text; is_test boolean;
begin
 if r is not null and exists(select 1 from public.work_requests where id=r and status='draft') then return; end if;
 if length(trim(coalesce(msg,'')))=0 then return; end if;
 is_test=case when r is null then exists(select 1 from auth.users where id=coalesce(who,auth.uid()) and raw_app_meta_data->>'portal_qa'='true')
  else coalesce((select test from public.work_requests where id=r),false) end;
 marker=txid_current()::text||':'||coalesce(r::text,'account')||':'||md5(msg);
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select account.id,r,left(trim(msg),12000),case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,marker
 from auth.users account
 where (
   (r is not null and who is not null and account.id=who and account.raw_app_meta_data->>'role' not in('admin','super_admin'))
   or (who is null and r is not null and (
    exists(select 1 from public.work_staff staff where staff.user_id=account.id and staff.coordinator)
   ))
   or (r is null and (account.id=who or account.raw_app_meta_data->>'role' in('admin','super_admin')))
  )
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not is_test or account.raw_app_meta_data->>'portal_qa'='true')
 on conflict(recipient,event_key) where event_key is not null do nothing;
 if r is not null and who is not null and exists(
  select 1 from public.work_requests request_row
  join public.work_staff staff on staff.user_id=who and staff.coordinator
  where request_row.id=r and request_row.status='new' and request_row.coordinator_id is null
 ) then
  update provision_private.work_notification_requirements requirement set audience='coordinator_pool'
  where requirement.recipient=who and requirement.event_key=marker;
 end if;
 if who is null and r is not null then
  update provision_private.work_notification_requirements requirement set audience='coordinator_pool'
  where requirement.event_key=marker and exists(
   select 1 from public.work_staff staff where staff.user_id=requirement.recipient and staff.coordinator
  );
 end if;
 if who is not null and exists(
 select 1 from auth.users account where account.id=who
   and (r is null or account.raw_app_meta_data->>'role' not in('admin','super_admin'))
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not is_test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications notification
    where notification.recipient=account.id and notification.event_key=marker)
 ) then raise exception 'notification_contract_operational'; end if;
 if who is null and r is not null and exists(
  select 1 from auth.users account
  join public.work_staff staff on staff.user_id=account.id and staff.coordinator
  where not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not is_test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications notification
    where notification.recipient=account.id and notification.event_key=marker)
 ) then raise exception 'notification_contract_coordinators'; end if;
end;
$$;
revoke all on function provision_private.work_notify(uuid,uuid,text) from public,anon,authenticated;

-- Explicit operational recipients are part of the same transaction as their notification row
create or replace function provision_private.work_notify_once(who uuid,r uuid,msg text,stable_key text,mandatory boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare marker text; is_test boolean; outgoing text;
begin
 if r is not null and exists(select 1 from public.work_requests where id=r and status='draft') then return; end if;
 if length(trim(coalesce(msg,'')))=0 or length(trim(coalesce(stable_key,'')))=0 then raise exception 'invalid_notification'; end if;
 is_test=case when r is null then exists(select 1 from auth.users where id=coalesce(who,auth.uid()) and raw_app_meta_data->>'portal_qa'='true')
  else coalesce((select test from public.work_requests where id=r),false) end;
 marker=left(case when mandatory then 'control:' else 'event:' end||trim(stable_key),500);
 outgoing=case when r is not null and who is null then provision_private.work_request_control_message(
  r,case when stable_key like 'intake:%:overdue' then 'تجاوز مهلة إجراء مسؤول التواصل' else 'تحديث رقابي إلزامي' end,
  auth.uid(),null,msg) else left(trim(msg),12000) end;
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select account.id,r,left(outgoing,12000),case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,marker
 from auth.users account
 where ((r is not null and who is null and account.raw_app_meta_data->>'role' in('admin','super_admin'))
   or (r is not null and who is not null and account.id=who and account.raw_app_meta_data->>'role' not in('admin','super_admin'))
   or (r is null and (account.id=who or account.raw_app_meta_data->>'role' in('admin','super_admin'))))
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not is_test or account.raw_app_meta_data->>'portal_qa'='true')
 on conflict(recipient,event_key) where event_key is not null do nothing;
 if who is not null and exists(
 select 1 from auth.users account where account.id=who
   and (r is null or account.raw_app_meta_data->>'role' not in('admin','super_admin'))
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not is_test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications notification
    where notification.recipient=account.id and notification.event_key=marker)
 ) then raise exception 'notification_contract_operational'; end if;
 if who is null and exists(
  select 1 from auth.users account
  where account.raw_app_meta_data->>'role' in('admin','super_admin')
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not is_test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications notification
    where notification.recipient=account.id and notification.event_key=marker)
 ) then raise exception 'notification_contract_managers'; end if;
end;
$$;
revoke all on function provision_private.work_notify_once(uuid,uuid,text,text,boolean) from public,anon,authenticated;

-- Mandatory control notifications cannot be disabled by personal channel preferences
create or replace function provision_private.work_notification_preference_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.whatsapp in('pending','failed','unknown','sending')
  and coalesce(new.event_key,'') not like 'control:%'
  and coalesce((select not preference.whatsapp_enabled
   from public.work_notification_preferences preference where preference.user_id=new.recipient),false) then
  new.whatsapp='suppressed';
  new.last_error='user_channel_disabled';
 end if;
 return new;
end;
$$;
revoke all on function provision_private.work_notification_preference_guard() from public,anon,authenticated;

create or replace function public.work_notification_settings(p_whatsapp_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or p_whatsapp_enabled is null then raise exception 'forbidden' using errcode='42501'; end if;
 insert into public.work_notification_preferences(user_id,whatsapp_enabled,updated_at)
 values(auth.uid(),p_whatsapp_enabled,now())
 on conflict(user_id) do update set whatsapp_enabled=excluded.whatsapp_enabled,updated_at=now();
 if not p_whatsapp_enabled then
  update public.work_notifications set whatsapp='suppressed',last_error='user_channel_disabled'
  where recipient=auth.uid() and whatsapp in('pending','failed','unknown')
   and coalesce(event_key,'') not like 'control:%';
 end if;
 return jsonb_build_object('whatsapp_enabled',p_whatsapp_enabled);
end;
$$;
revoke all on function public.work_notification_settings(boolean) from public,anon;
grant execute on function public.work_notification_settings(boolean) to authenticated;

-- Canonical audiences are revalidated at read and delivery time after every role change
create or replace function provision_private.work_notification_audience_eligible(
 p_recipient uuid,
 p_event_key text,
 p_request_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1
  from provision_private.work_notification_requirements requirement
  join auth.users account on account.id=requirement.recipient
  where requirement.recipient=p_recipient and requirement.event_key=p_event_key
   and requirement.request_id is not distinct from p_request_id
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and case requirement.audience
    when 'manager' then account.raw_app_meta_data->>'role' in('admin','super_admin')
    when 'client'
     then account.raw_app_meta_data->>'role'='client' and exists(
      select 1 from public.work_requests request_row
      where request_row.id=p_request_id and request_row.client_id=account.id
     )
    when 'coordinator' then account.raw_app_meta_data->>'role'='employee' and exists(
     select 1 from public.work_requests request_row
     join public.work_staff staff on staff.user_id=account.id and staff.coordinator
     where request_row.id=p_request_id and request_row.coordinator_id=account.id
    )
    when 'coordinator_pool' then account.raw_app_meta_data->>'role'='employee' and exists(
     select 1 from public.work_staff staff
     join public.work_requests request_row on request_row.id=p_request_id
     where staff.user_id=account.id and staff.coordinator
      and request_row.status='new' and request_row.coordinator_id is null
    )
    when 'employee' then account.raw_app_meta_data->>'role'='employee'
    when 'account' then account.raw_app_meta_data->>'role' in('client','employee','admin','super_admin')
    else false
   end
 )
 or p_event_key is null and exists(
  select 1 from auth.users account
  where account.id=p_recipient
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and case account.raw_app_meta_data->>'role'
    when 'super_admin' then true
    when 'admin' then true
    when 'client' then exists(select 1 from public.work_requests request_row
     where request_row.id=p_request_id and request_row.client_id=account.id)
    when 'employee' then p_request_id is null
     or exists(select 1 from public.work_requests request_row
      join public.work_staff staff on staff.user_id=account.id and staff.coordinator
      where request_row.id=p_request_id and request_row.coordinator_id=account.id)
     or exists(select 1 from public.work_parts part
      where part.request_id=p_request_id and part.assignee_id=account.id)
     or exists(select 1 from public.work_events event_row
      join provision_private.work_assignment_history history on history.event_id=event_row.id
      where event_row.request_id=p_request_id and account.id in(history.previous_assignee,history.next_assignee))
    else false
   end
 )
$$;
revoke all on function provision_private.work_notification_audience_eligible(uuid,text,uuid) from public,anon,authenticated;

create or replace function provision_private.work_notification_readable(p_notification uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(
  select 1
  from public.work_notifications notification
  left join public.work_events event_row
   on notification.event_key='event:event:'||event_row.id::text||':coordinator'
  where notification.id=p_notification and notification.recipient=auth.uid()
   and provision_private.work_notification_audience_eligible(
    notification.recipient,notification.event_key,notification.request_id
   )
   and not(
    provision_private.work_role()='employee'
    and event_row.kind in('due_approved','due_auto_approved')
   )
 )
$$;
revoke all on function provision_private.work_notification_readable(uuid) from public,anon,authenticated;
grant execute on function provision_private.work_notification_readable(uuid) to authenticated;

drop policy if exists work_notifications_read on public.work_notifications;
create policy work_notifications_read on public.work_notifications for select to authenticated
using(provision_private.work_notification_readable(id));

drop policy if exists work_notification_signals_read on public.work_notification_signals;
create policy work_notification_signals_read on public.work_notification_signals for select to authenticated
using(
 recipient=auth.uid() and exists(
  select 1 from public.work_notifications notification
  where notification.id=public.work_notification_signals.notification_id
   and provision_private.work_notification_readable(notification.id)
 )
);

create or replace function public.work_notifications_page(p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_page integer:=least(greatest(coalesce(p_page,0),0),10000);
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'items',(select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc),'[]'::jsonb) from(
   select notification.id,notification.request_id,notification.message,notification.created_at,
    notification.read_at,notification.whatsapp,notification.last_error,
    notification.whatsapp_delivered_at,notification.whatsapp_read_at,notification.provider_status_at
   from public.work_notifications notification
   where notification.recipient=auth.uid()
    and provision_private.work_notification_readable(notification.id)
   order by notification.created_at desc limit 40 offset safe_page*40
  )item),
  'unread_count',(select count(*) from public.work_notifications notification
   where notification.recipient=auth.uid() and notification.read_at is null
    and provision_private.work_notification_readable(notification.id))
 );
end;
$$;
revoke all on function public.work_notifications_page(integer) from public,anon;
grant execute on function public.work_notifications_page(integer) to authenticated;

create or replace function public.work_notification_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update public.work_notifications notification set whatsapp='suppressed',last_error='recipient_in_app_only'
 from auth.users account
 where account.id=notification.recipient and account.raw_app_meta_data->>'role'='super_admin'
  and notification.request_id is not null and notification.whatsapp in('pending','failed')
  and coalesce(notification.event_key,'') not like 'control:%';
 update public.work_notifications notification set whatsapp='suppressed',last_error='recipient_unavailable'
 from auth.users account
 where account.id=notification.recipient and notification.whatsapp in('pending','failed')
  and (coalesce(account.is_anonymous,false) or (account.banned_until is not null and account.banned_until>=now())
   or coalesce(account.raw_app_meta_data->>'role','') not in('client','employee','admin','super_admin'));
 update public.work_notifications notification set whatsapp='suppressed',last_error='audience_no_longer_eligible'
 where notification.whatsapp in('pending','failed')
  and not provision_private.work_notification_audience_eligible(
   notification.recipient,notification.event_key,notification.request_id
  );
 update public.work_notifications set
  whatsapp='failed',attempts=greatest(attempts,5),next_attempt=now(),
  last_error='legacy_delivery_outcome_unrecoverable',provider_checked_at=now()
 where whatsapp='sending' and next_attempt<now()-interval '2 minutes' and dispatch_token is null;
 update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted',attempts=greatest(attempts,5)
 where whatsapp='sending' and next_attempt<now()-interval '2 minutes' and dispatch_token is not null;
 with candidates as(
  select notification.id,coalesce(nullif(profile.phone,''),account.phone) as dispatch_phone
  from public.work_notifications notification
  join auth.users account on account.id=notification.recipient
  left join public.account_profiles profile on profile.user_id=notification.recipient
  where notification.whatsapp in('pending','failed') and notification.attempts<5 and notification.next_attempt<=now()
   and (notification.request_id is null or account.raw_app_meta_data->>'role' is distinct from 'super_admin'
    or coalesce(notification.event_key,'') like 'control:%')
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and account.raw_app_meta_data->>'role' in('client','employee','admin','super_admin')
   and provision_private.work_notification_audience_eligible(
    notification.recipient,notification.event_key,notification.request_id
   )
  order by (coalesce(notification.event_key,'') like 'control:%') desc,notification.created_at
  for update of notification skip locked limit 15
 ),claimed as(
  update public.work_notifications notification set
   whatsapp='sending',attempts=attempts+1,next_attempt=now(),provider_id=null,
   dispatch_started_at=now(),dispatch_token=gen_random_uuid(),dispatch_phone=candidate.dispatch_phone,
   recovery_lease_until=null,recovery_token=null,
   provider_status_at=null,provider_checked_at=null,last_error=null,
   whatsapp_delivered_at=null,whatsapp_read_at=null
  from candidates candidate where notification.id=candidate.id returning notification.*
 )
  select coalesce(jsonb_agg(jsonb_build_object('id',claimed.id,'recipient',claimed.recipient,'message',claimed.message,
   'request_id',claimed.request_id,'attempts',claimed.attempts,'claimed_at',claimed.dispatch_started_at,
   'dispatch_token',claimed.dispatch_token,'phone',claimed.dispatch_phone)),'[]') into result
  from claimed
  where claimed.whatsapp='sending';
 return result;
end;
$$;
revoke all on function public.work_notification_claim() from public,anon,authenticated;
grant execute on function public.work_notification_claim() to service_role;

-- A provider timeout is reconciled against its outgoing journal before retrying
-- This closes the crash window without blindly sending a duplicate message
create or replace function public.work_notification_uncertain_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; item record; recipient_label text;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 for item in
  update public.work_notifications notification set
   whatsapp='failed',attempts=greatest(attempts,5),next_attempt=now(),
   last_error='delivery_outcome_unrecoverable',provider_checked_at=now(),
   recovery_lease_until=null,recovery_token=null
  where notification.whatsapp='unknown' and notification.provider_id is null
   and (
    notification.dispatch_token is null
    or coalesce(notification.dispatch_started_at,notification.next_attempt,notification.created_at)<now()-interval '23 hours'
   )
   and (notification.recovery_lease_until is null or notification.recovery_lease_until<=now())
  returning notification.id,notification.request_id,notification.recipient,notification.event_key
 loop
  if coalesce(item.event_key,'') not like 'control:delivery:unrecoverable:%' then
   select coalesce(nullif(profile.display_name,''),account.email,item.recipient::text)
   into recipient_label
   from auth.users account left join public.account_profiles profile on profile.user_id=account.id
   where account.id=item.recipient;
   perform provision_private.work_notify_once(
    null,item.request_id,'تعذر تأكيد تسليم إشعار واتساب ويحتاج مراجعة مركز الإشعارات'||
     E'\nالمستلم '||coalesce(recipient_label,item.recipient::text),
    'delivery:unrecoverable:'||item.id::text,true
   );
  end if;
 end loop;
 with candidates as(
   select notification.id
   from public.work_notifications notification
   where notification.whatsapp='unknown' and notification.provider_id is null
    and coalesce(notification.dispatch_started_at,notification.next_attempt,notification.created_at)<=now()-interval '3 minutes'
    and notification.dispatch_started_at>=now()-interval '23 hours'
    and notification.dispatch_token is not null
    and (notification.recovery_lease_until is null or notification.recovery_lease_until<=now())
  order by coalesce(notification.dispatch_started_at,notification.created_at)
  for update skip locked limit 50
 ),claimed as(
   update public.work_notifications notification set
    recovery_lease_until=now()+interval '2 minutes',recovery_token=gen_random_uuid()
  from candidates candidate where notification.id=candidate.id
  returning notification.*
 )
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',claimed.id,'message',claimed.message,
   'dispatch_token',claimed.dispatch_token,'recovery_token',claimed.recovery_token,
   'dispatch_started_at',coalesce(claimed.dispatch_started_at,claimed.created_at),
   'phone',claimed.dispatch_phone
  ) order by coalesce(claimed.dispatch_started_at,claimed.created_at)),'[]'::jsonb)
  into result
  from claimed;
 return result;
end;
$$;
revoke all on function public.work_notification_uncertain_claim() from public,anon,authenticated;
grant execute on function public.work_notification_uncertain_claim() to service_role;

create or replace function public.work_notification_uncertain_finish(
 p_matches jsonb,
 p_retries jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; notification_id uuid; dispatch_identity uuid; recovery_identity uuid;
 provider text; normalized text; happened timestamptz;
 matched_count integer:=0; retry_count integer:=0; changed integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(coalesce(p_matches,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_matches,'[]'::jsonb))>50
  or jsonb_typeof(coalesce(p_retries,'[]'::jsonb))<>'array'
  or jsonb_array_length(coalesce(p_retries,'[]'::jsonb))>50 then raise exception 'invalid_recovery_batch'; end if;
 for item in select value from jsonb_array_elements(coalesce(p_matches,'[]'::jsonb)) loop
  notification_id=(item->>'id')::uuid;
  dispatch_identity=(item->>'dispatch_token')::uuid;
  recovery_identity=(item->>'recovery_token')::uuid;
  provider=trim(coalesce(item->>'provider_id',''));
  normalized=provision_private.work_provider_status(item->>'status');
  happened=coalesce((item->>'occurred_at')::timestamptz,now());
  if normalized is null or length(provider) not between 1 and 200
   or happened<now()-interval '30 days' or happened>now()+interval '1 day' then raise exception 'invalid_recovery_match'; end if;
  update public.work_notifications notification set
   provider_id=provider,whatsapp='sent',last_error='provider_recovered_from_journal',
   provider_checked_at=now(),recovery_lease_until=null,recovery_token=null
  where notification.id=notification_id and notification.whatsapp='unknown' and notification.provider_id is null
   and notification.dispatch_token=dispatch_identity and notification.recovery_token=recovery_identity
   and notification.recovery_lease_until>now()
   and not exists(select 1 from public.work_notifications existing where existing.provider_id=provider)
  returning 1 into changed;
  if changed=1 then
   perform public.work_notification_delivery_update(provider,normalized,'uncertain_send_reconciled',happened);
   if normalized='failed' then
    update public.work_notifications set attempts=least(attempts,4),next_attempt=now()
    where id=notification_id and whatsapp='failed';
   end if;
   matched_count=matched_count+1;
  end if;
  changed=null; dispatch_identity=null; recovery_identity=null;
 end loop;
 for item in select value from jsonb_array_elements(coalesce(p_retries,'[]'::jsonb)) loop
  notification_id=(item->>'id')::uuid;
  dispatch_identity=(item->>'dispatch_token')::uuid;
  recovery_identity=(item->>'recovery_token')::uuid;
  update public.work_notifications notification set
   whatsapp='failed',attempts=least(attempts,4),next_attempt=now(),
   last_error='provider_journal_not_found',recovery_lease_until=null,recovery_token=null
  where notification.id=notification_id and notification.whatsapp='unknown'
   and notification.provider_id is null and notification.dispatch_token=dispatch_identity
   and notification.recovery_token=recovery_identity and notification.recovery_lease_until>now();
  get diagnostics changed=row_count;
  retry_count=retry_count+changed;
 end loop;
 return jsonb_build_object('matched',matched_count,'retried',retry_count);
end;
$$;
revoke all on function public.work_notification_uncertain_finish(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.work_notification_uncertain_finish(jsonb,jsonb) to service_role;

-- New request management is handled by the canonical event envelope
-- A forced start remains private unless the event visibility policy explicitly publishes it
do $work_action_notification_sources$
declare body text; needle text;
begin
 body=replace(pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 needle=$old$for u in select id from auth.users where raw_app_meta_data->>'role' in ('admin','super_admin') or id in(select user_id from public.work_staff where coordinator) loop$old$;
 if strpos(body,needle)=0 then raise exception 'work_action_create_recipients_shape'; end if;
 body=replace(body,needle,$new$for u in select user_id as id from public.work_staff where coordinator loop$new$);
 needle=$old$perform provision_private.work_notify(r.client_id,r.id,'تم استلام المهمة وجار تنفيذها');$old$;
 if strpos(body,needle)=0 then raise exception 'work_action_force_start_client_shape'; end if;
 body=replace(body,needle,'');
 execute body;
end;
$work_action_notification_sources$;

-- Administrative release accepts every pending internal link before the wake-up pass runs
do $release_dependency_fix$
declare body text; needle text; replacement text;
begin
 body=replace(pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 needle=$old$update public.work_parts set status='internal_done' where id=a.id;$old$;
 if strpos(body,needle)=0 then raise exception 'release_dependencies_contract_shape'; end if;
 replacement=needle||$new$
   update public.work_dependencies link set status='accepted'
   where link.upstream_id=a.id and link.gate='internal_delivery' and link.status='pending';$new$;
 body=replace(body,needle,replacement);
 execute body;
end;
$release_dependency_fix$;

-- Blocked downstream tasks get an availability update while the common wake up pass handles released tasks
do $release_dependency_notice_dedupe$
declare body text; needle text; replacement text;
begin
 body=replace(pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 needle=$old$where link.upstream_id=a.id and link.gate='internal_delivery' and link.status in ('pending','accepted') loop$old$;
 replacement=$new$where link.upstream_id=a.id and link.gate='internal_delivery' and link.status in ('pending','accepted')
     and provision_private.work_dependency_blocked(downstream.id) loop$new$;
 if strpos(body,needle)=0 then raise exception 'release_dependencies_notice_loop'; end if;
 body=replace(body,needle,replacement);
 execute body;
end;
$release_dependency_notice_dedupe$;

-- Attachment requests and intake declines use the canonical client event message
-- Removing the later direct copy makes the event recoverable without double delivery
do $work_control_client_notice_dedupe$
declare body text; marker text; before_marker text; call_token text:='perform provision_private.work_notify_once(';
 key_position integer; reverse_offset integer; call_start integer; call_tail integer; call_length integer;
begin
 body=replace(pg_get_functiondef('public.work_control_action(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 foreach marker in array array[
  $marker$'request:'||request_row.id::text||':attachments:'$marker$,
  $marker$'request:'||request_row.id::text||':declined'$marker$
 ] loop
  key_position=strpos(body,marker);
  if key_position=0 then raise exception 'work_control_client_notice_key'; end if;
  before_marker=left(body,key_position-1);
  reverse_offset=strpos(reverse(before_marker),reverse(call_token));
  if reverse_offset=0 then raise exception 'work_control_client_notice_call'; end if;
  call_start=length(before_marker)-reverse_offset-length(call_token)+2;
  call_tail=strpos(substring(body from key_position),');');
  if call_tail=0 then raise exception 'work_control_client_notice_end'; end if;
  call_length=key_position+call_tail-call_start+1;
  body=overlay(body placing '' from call_start for call_length);
 end loop;
 execute body;
end;
$work_control_client_notice_dedupe$;

create or replace function provision_private.work_due_auto_notice()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status='auto_approved' then
  insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
  values(new.request_id,new.part_id,null,'due_auto_approved','انتهت مهلة الثلاث ساعات واعتمد الموعد المقترح تلقائيا',false);
 end if;
 return null;
end;
$$;
revoke all on function provision_private.work_due_auto_notice() from public,anon,authenticated;

create or replace function provision_private.work_notification_integrity_tick()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; started_at timestamptz; checked integer:=0; restored integer:=0; reactivated integer:=0;
begin
 select contract.enforced_at into started_at
 from provision_private.work_notification_contract contract where contract.id;
 for item in
  select event_row.id from public.work_events event_row
  join public.work_requests request_row on request_row.id=event_row.request_id
  where event_row.created_at>=greatest(coalesce(started_at,now()),now()-interval '15 minutes')
   and request_row.status<>'draft'
  order by event_row.id
 loop
  perform provision_private.work_ensure_event_notifications(item.id);
  checked=checked+1;
 end loop;
 update public.work_notifications notification set
  whatsapp='pending',next_attempt=now(),last_error='audience_restored'
 from provision_private.work_notification_requirements requirement
 where notification.recipient=requirement.recipient and notification.event_key=requirement.event_key
  and requirement.created_at>=coalesce(started_at,now())
  and requirement.delivery_required and requirement.fulfilled_at is null
  and notification.whatsapp='suppressed'
  and notification.last_error in('recipient_unavailable','audience_no_longer_eligible')
  and provision_private.work_notification_audience_eligible(
   requirement.recipient,requirement.event_key,requirement.request_id
  );
 get diagnostics reactivated=row_count;
 insert into public.work_notifications(recipient,request_id,message,read_at,created_at,whatsapp,event_key,last_error)
 select requirement.recipient,requirement.request_id,requirement.message,
  case when requirement.fulfilled_at is not null then now() end,requirement.created_at,
  case when requirement.delivery_required and requirement.fulfilled_at is null then 'pending' else 'suppressed' end,
  requirement.event_key,
  case when requirement.fulfilled_at is not null then 'notification_history_restored' end
 from provision_private.work_notification_requirements requirement
 where requirement.created_at>=coalesce(started_at,now())
  and provision_private.work_notification_audience_eligible(
   requirement.recipient,requirement.event_key,requirement.request_id
  )
  and not exists(select 1 from public.work_notifications notification
   where notification.recipient=requirement.recipient and notification.event_key=requirement.event_key)
 on conflict(recipient,event_key) where event_key is not null do nothing;
 get diagnostics restored=row_count;
 return checked+restored+reactivated;
end;
$$;
revoke all on function provision_private.work_notification_integrity_tick() from public,anon,authenticated;

create or replace function provision_private.work_control_tick()
returns jsonb language plpgsql security definer set search_path='' as $$
declare approved_count integer; escalated_count integer:=0; reconciled_count integer:=0; item record;
begin
 update provision_private.work_due_reviews set status='auto_approved',reviewed_at=review_expires_at
 where status='pending' and review_expires_at<=now();
 get diagnostics approved_count=row_count;
 for item in
  update public.work_requests set intake_escalated_at=now()
  where status in('new','needs_info') and intake_action_at is null and intake_escalated_at is null and intake_due_at<=now()
  returning id,number,title
 loop
  escalated_count=escalated_count+1;
  insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
  values(item.id,null,null,'intake_overdue','لم يتخذ مسؤول التواصل إجراء خلال المهلة ويلزم تدخل الإدارة',false);
 end loop;
 reconciled_count=provision_private.work_notification_integrity_tick();
 return jsonb_build_object('auto_approved',approved_count,'intake_escalated',escalated_count,'events_checked',reconciled_count);
end;
$$;
revoke all on function provision_private.work_control_tick() from public,anon,authenticated;

-- Historical control envelopes are restored in app without replaying old WhatsApp traffic
insert into public.work_notifications(recipient,request_id,message,read_at,created_at,whatsapp,event_key,last_error)
select account.id,event_row.request_id,provision_private.work_event_message(event_row.id),now(),event_row.created_at,
 'suppressed','control:event:'||event_row.id::text||':admin','historical_contract_backfill'
from public.work_events event_row
join public.work_requests request_row on request_row.id=event_row.request_id
join provision_private.work_notification_contract contract on contract.id
cross join auth.users account
where event_row.created_at<contract.enforced_at and request_row.status<>'draft'
 and account.raw_app_meta_data->>'role' in('admin','super_admin')
 and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
 and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
on conflict(recipient,event_key) where event_key is not null do nothing;

create or replace function public.work_notification_contract_health()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare started_at timestamptz; events_count bigint; missing_admin bigint; missing_client bigint;
 missing_coordinator bigint; missing_operational bigint; failed_delivery bigint; channel_state text;
begin
 if not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501'; end if;
 select contract.enforced_at into started_at from provision_private.work_notification_contract contract where contract.id;
 select count(*) into events_count from public.work_events event_row where event_row.created_at>=started_at;
 select count(*) into missing_admin
 from public.work_events event_row join public.work_requests request_row on request_row.id=event_row.request_id
 cross join auth.users account
 where event_row.created_at>=started_at and request_row.status<>'draft'
  and account.raw_app_meta_data->>'role' in('admin','super_admin')
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
  and not exists(select 1 from public.work_notifications notification
   where notification.recipient=account.id and notification.event_key='control:event:'||event_row.id::text||':admin');
 select count(*) into missing_client
 from public.work_events event_row join public.work_requests request_row on request_row.id=event_row.request_id
 join auth.users account on account.id=request_row.client_id
 where event_row.created_at>=started_at and provision_private.work_event_client_notice_required(event_row.id)
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
  and not exists(select 1 from public.work_notifications notification
   where notification.recipient=account.id and notification.event_key='journey:event:'||event_row.id::text||':client');
 select count(*) into missing_coordinator
 from public.work_events event_row join public.work_requests request_row on request_row.id=event_row.request_id
 join auth.users account on account.id=request_row.coordinator_id
 where event_row.created_at>=started_at and provision_private.work_event_coordinator_notice_required(event_row.id)
  and coalesce(account.raw_app_meta_data->>'role','') not in('admin','super_admin')
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
  and not exists(
   select 1 from provision_private.work_event_notification_links link
   join public.work_notifications notification on notification.recipient=link.recipient and notification.event_key=link.event_key
   where link.event_id=event_row.id and link.recipient=account.id and link.audience='coordinator'
  );
 select count(*) into missing_operational
 from provision_private.work_notification_requirements requirement
 where requirement.created_at>=started_at
  and requirement.delivery_required and requirement.fulfilled_at is null
  and provision_private.work_notification_audience_eligible(
   requirement.recipient,requirement.event_key,requirement.request_id
  )
  and (
   not exists(select 1 from public.work_notifications notification
    where notification.recipient=requirement.recipient and notification.event_key=requirement.event_key)
   or exists(select 1 from public.work_notifications notification
    where notification.recipient=requirement.recipient and notification.event_key=requirement.event_key
     and notification.whatsapp='suppressed'
     and notification.last_error in('recipient_unavailable','audience_no_longer_eligible'))
  );
 select count(*) into failed_delivery from public.work_notifications notification
 where notification.created_at>=started_at and notification.whatsapp in('failed','unknown')
  and provision_private.work_notification_audience_eligible(
   notification.recipient,notification.event_key,notification.request_id
  );
 select channel.state into channel_state from provision_private.work_notification_channel channel where channel.id;
 return jsonb_build_object(
  'healthy',missing_admin=0 and missing_client=0 and missing_coordinator=0 and missing_operational=0
   and failed_delivery=0 and coalesce(channel_state,'unknown')='authorized',
  'recipient_contract_healthy',missing_admin=0 and missing_client=0 and missing_coordinator=0 and missing_operational=0,
  'enforced_at',started_at,'events',events_count,'missing_admin',missing_admin,
  'missing_client',missing_client,'missing_coordinator',missing_coordinator,'missing_operational',missing_operational,
  'failed_delivery',failed_delivery,
  'whatsapp_channel',coalesce(channel_state,'unknown')
 );
end;
$$;
revoke all on function public.work_notification_contract_health() from public,anon;
grant execute on function public.work_notification_contract_health() to authenticated;

comment on function provision_private.work_ensure_event_notifications(bigint) is
'Canonical idempotent recipient contract for every request and task event';
comment on function public.work_notification_contract_health() is
'Manager only aggregate recipient and delivery health for the enforced workflow notification contract';

commit;
