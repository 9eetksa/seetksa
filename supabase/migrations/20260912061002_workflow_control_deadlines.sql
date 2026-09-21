-- Workflow control plane for department due dates and communication intake SLAs
-- All deadlines are evaluated in Asia Riyadh while stored as timestamptz

begin;

alter table public.work_requests
 add column if not exists submitted_at timestamptz,
 add column if not exists intake_due_at timestamptz,
 add column if not exists intake_action_at timestamptz,
 add column if not exists intake_action_kind text,
 add column if not exists intake_action_by uuid references auth.users(id),
 add column if not exists intake_escalated_at timestamptz;

alter table public.work_requests drop constraint if exists work_requests_intake_action_kind_check;
alter table public.work_requests add constraint work_requests_intake_action_kind_check
 check(intake_action_kind is null or intake_action_kind in('intake','assign','request_info','request_attachments','decline_intake'));

alter table public.work_requests drop constraint if exists work_requests_intake_action_state;
alter table public.work_requests add constraint work_requests_intake_action_state
 check((intake_action_at is null and intake_action_kind is null and intake_action_by is null)
  or (intake_action_at is not null and intake_action_kind is not null and intake_action_by is not null));

alter table public.work_requests drop constraint if exists work_requests_status_check;
alter table public.work_requests add constraint work_requests_status_check
 check(status in('draft','new','needs_info','active','completed','declined'));

create index if not exists work_requests_intake_due_pending
on public.work_requests(intake_due_at,id)
where intake_action_at is null and intake_escalated_at is null and status in('new','needs_info');

create table if not exists provision_private.work_due_reviews(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null,
 part_id uuid not null,
 proposed_by uuid not null references auth.users(id),
 proposed_due_at timestamptz not null,
 proposed_at timestamptz not null default now(),
 review_expires_at timestamptz not null,
 status text not null default 'pending' check(status in('pending','approved','auto_approved','rejected','cancelled')),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 replacement_due_at timestamptz,
 reason text,
 constraint work_due_reviews_part_request_fkey foreign key(part_id,request_id)
  references public.work_parts(id,request_id) on delete cascade,
 constraint work_due_reviews_window check(review_expires_at>proposed_at),
 constraint work_due_reviews_decision check(
  (status='pending' and reviewed_at is null and reviewed_by is null and replacement_due_at is null and reason is null)
  or (status='approved' and reviewed_at is not null and reviewed_by is not null and replacement_due_at is null and reason is null)
  or (status='auto_approved' and reviewed_at is not null and reviewed_by is null and replacement_due_at is null and reason is null)
  or (status='rejected' and reviewed_at is not null and reviewed_by is not null and replacement_due_at is not null and length(trim(reason)) between 3 and 2000)
  or (status='cancelled' and reviewed_at is not null and replacement_due_at is null)
 )
);

create unique index if not exists work_due_reviews_one_pending
on provision_private.work_due_reviews(part_id)
where status='pending';

create index if not exists work_due_reviews_expiry
on provision_private.work_due_reviews(review_expires_at,part_id)
where status='pending';

create index if not exists work_due_reviews_request
on provision_private.work_due_reviews(request_id,proposed_at desc);

alter table provision_private.work_due_reviews enable row level security;
revoke all on table provision_private.work_due_reviews from public,anon,authenticated;
grant all on table provision_private.work_due_reviews to service_role;

create or replace function provision_private.work_intake_deadline(submitted timestamptz)
returns timestamptz language sql stable set search_path='' as $$
 with local_time as(select submitted at time zone 'Asia/Riyadh' as value)
 select case
  when value::time>=time '12:00' and value::time<time '20:00'
   then (value::date+time '20:00') at time zone 'Asia/Riyadh'
  when value::time>=time '20:00'
   then submitted+interval '16 hours'
  else (value::date+time '20:00') at time zone 'Asia/Riyadh'
 end from local_time
$$;
revoke all on function provision_private.work_intake_deadline(timestamptz) from public,anon,authenticated;

create or replace function provision_private.work_notify_once(who uuid,r uuid,msg text,stable_key text,mandatory boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare marker text; is_test boolean;
begin
 if r is not null and exists(select 1 from public.work_requests where id=r and status='draft') then return; end if;
 if length(trim(coalesce(msg,'')))=0 or length(trim(coalesce(stable_key,'')))=0 then raise exception 'invalid_notification'; end if;
 is_test=case when r is null then exists(select 1 from auth.users where id=coalesce(who,auth.uid()) and raw_app_meta_data->>'portal_qa'='true')
  else coalesce((select test from public.work_requests where id=r),false) end;
 marker=left(case when mandatory then 'control:' else 'event:' end||trim(stable_key),500);
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select u.id,r,left(trim(msg),12000),case when u.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,marker
 from auth.users u
 where ((who is not null and u.id=who) or u.raw_app_meta_data->>'role' in('admin','super_admin'))
  and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<now())
  and (not is_test or u.raw_app_meta_data->>'portal_qa'='true')
 on conflict(recipient,event_key) where event_key is not null do nothing;
end;
$$;
revoke all on function provision_private.work_notify_once(uuid,uuid,text,text,boolean) from public,anon,authenticated;

create or replace function provision_private.work_request_intake_clock()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='new' and new.intake_action_at is null
  and (new.intake_due_at is null or tg_op='UPDATE' and old.status='draft') then
  new.submitted_at=coalesce(new.submitted_at,now());
  new.intake_due_at=provision_private.work_intake_deadline(new.submitted_at);
  new.intake_escalated_at=null;
 end if;
 return new;
end;
$$;
revoke all on function provision_private.work_request_intake_clock() from public,anon,authenticated;
drop trigger if exists work_request_intake_clock on public.work_requests;
create trigger work_request_intake_clock before insert or update of status on public.work_requests
for each row execute function provision_private.work_request_intake_clock();

create or replace function provision_private.work_record_intake_action()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind in('intake','assign','request_info','request_attachments','decline_intake') then
  update public.work_requests set
   intake_action_at=coalesce(intake_action_at,new.created_at),
   intake_action_kind=case when intake_action_at is null then new.kind else intake_action_kind end,
   intake_action_by=case when intake_action_at is null then new.actor else intake_action_by end
  where id=new.request_id and intake_action_at is null;
 end if;
 return null;
end;
$$;
revoke all on function provision_private.work_record_intake_action() from public,anon,authenticated;
drop trigger if exists work_record_intake_action on public.work_events;
create trigger work_record_intake_action after insert on public.work_events
for each row execute function provision_private.work_record_intake_action();

create or replace function provision_private.work_dependency_notice(dependency_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare link public.work_dependencies; source public.work_parts; target public.work_parts;
 request_row public.work_requests; source_name text; target_name text; notice text; leader record;
begin
 select * into link from public.work_dependencies where id=dependency_id;
 if link.id is null then return; end if;
 select * into source from public.work_parts where id=link.upstream_id;
 select * into target from public.work_parts where id=link.part_id;
 select * into request_row from public.work_requests where id=link.request_id;
 select name into source_name from public.work_services where id=source.service_id;
 select name into target_name from public.work_services where id=target.service_id;
 notice='طلب مخرجات بين الأقسام'||E'\nطلب '||request_row.number::text||E'\nالقسم الطالب '||coalesce(target_name,'القسم المكلف')||E'\nالقسم المطلوب '||coalesce(source_name,'القسم السابق')||E'\nالمخرجات المطلوبة '||link.reason;
 perform provision_private.work_notify_once(source.assignee_id,link.request_id,notice,'dependency:'||link.id::text||':created',true);
 if request_row.coordinator_id is not null then
  perform provision_private.work_notify_once(request_row.coordinator_id,link.request_id,notice,'dependency:'||link.id::text||':created',true);
 end if;
 for leader in select membership.user_id from public.work_memberships membership
  where membership.service_id=source.service_id and membership.member_role='lead'
 loop
  perform provision_private.work_notify_once(leader.user_id,link.request_id,notice,'dependency:'||link.id::text||':created',true);
 end loop;
end;
$$;
revoke all on function provision_private.work_dependency_notice(uuid) from public,anon,authenticated;

create or replace function provision_private.work_add_dependency(rid uuid,part uuid,upstream uuid,why text,required_gate text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.work_parts; b public.work_parts; dependency uuid;
begin
 select * into a from public.work_parts where id=part and request_id=rid;
 select * into b from public.work_parts where id=upstream and request_id=rid;
 if not provision_private.account_ready() or a.id is null or a.assignee_id<>auth.uid() then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if a.status not in('offered','working','waiting','revision') or length(trim(coalesce(why,''))) not between 3 and 4000 then
  raise exception 'invalid_state';
 end if;
 if required_gate is null or required_gate not in('client_approval','internal_delivery') then raise exception 'invalid_dependency'; end if;
 if b.id is null or b.id=a.id or b.status='forwarded'
  or (b.status='internal_done' and required_gate<>'internal_delivery') then raise exception 'invalid_dependency'; end if;
 if exists(with recursive chain(id) as(
  select b.id union select link.upstream_id from public.work_dependencies link join chain current on link.part_id=current.id where link.status<>'waived'
 ) select 1 from chain where id=a.id) then raise exception 'dependency_cycle'; end if;
 insert into public.work_dependencies(request_id,part_id,upstream_id,reason,gate)
 values(rid,a.id,b.id,trim(why),required_gate) returning id into dependency;
 update public.work_parts set status='waiting' where id=a.id;
 perform provision_private.work_dependency_notice(dependency);
 return dependency;
end;
$$;
revoke all on function provision_private.work_add_dependency(uuid,uuid,uuid,text,text) from public,anon,authenticated;

create or replace function provision_private.work_due_review_notice(review_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare review provision_private.work_due_reviews; request_row public.work_requests; part public.work_parts;
 service_name text; employee_name text; notice text;
begin
 select * into review from provision_private.work_due_reviews where id=review_id;
 if review.id is null or review.status<>'pending' then return; end if;
 select * into request_row from public.work_requests where id=review.request_id;
 select * into part from public.work_parts where id=review.part_id and request_id=review.request_id;
 select name into service_name from public.work_services where id=part.service_id;
 select coalesce(nullif(profile.display_name,''),account.email,'موظف الفريق') into employee_name
 from auth.users account left join public.account_profiles profile on profile.user_id=account.id where account.id=part.assignee_id;
 notice='موعد قسم ينتظر قرار الإدارة'||E'\nطلب '||request_row.number::text||E'\nالقسم '||coalesce(service_name,'القسم المكلف')||E'\nالموظف '||coalesce(employee_name,'موظف الفريق')||E'\nالموعد المقترح '||to_char(review.proposed_due_at at time zone 'Asia/Riyadh','YYYY/MM/DD HH24:MI')||E'\nمهلة القرار ثلاث ساعات';
 perform provision_private.work_notify_once(request_row.coordinator_id,review.request_id,notice,'due:'||review.id::text||':proposed',true);
end;
$$;
revoke all on function provision_private.work_due_review_notice(uuid) from public,anon,authenticated;

create or replace function provision_private.work_capture_due_review()
returns trigger language plpgsql security definer set search_path='' as $$
declare review_id uuid;
begin
 if old.accepted_at is null and new.accepted_at is not null and new.due_at is not null and new.assignee_id=auth.uid() then
  update provision_private.work_due_reviews set status='cancelled',reviewed_at=now()
  where part_id=new.id and status='pending';
  insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at)
  values(new.request_id,new.id,new.assignee_id,new.due_at,now(),now()+interval '3 hours') returning id into review_id;
  perform provision_private.work_due_review_notice(review_id);
 elsif old.accepted_at is not null and (new.accepted_at is null or new.due_at is distinct from old.due_at) then
  update provision_private.work_due_reviews set status='cancelled',reviewed_at=now()
  where part_id=new.id and status='pending';
 end if;
 return null;
end;
$$;
revoke all on function provision_private.work_capture_due_review() from public,anon,authenticated;
drop trigger if exists work_capture_due_review on public.work_parts;
create trigger work_capture_due_review after update of accepted_at,due_at,assignee_id on public.work_parts
for each row execute function provision_private.work_capture_due_review();

create or replace function public.work_control_center()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare due_reviews jsonb:='[]'::jsonb; intake_items jsonb:='[]'::jsonb;
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin') then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if provision_private.work_manager() then
  select coalesce(jsonb_agg(to_jsonb(item) order by item.review_expires_at),'[]'::jsonb) into due_reviews from(
   select review.id,review.request_id,review.part_id,review.proposed_due_at,review.proposed_at,review.review_expires_at,
    request.number as request_number,request.title as request_title,request.version as request_version,
    service.name as service_name,coalesce(nullif(profile.display_name,''),account.email,'موظف الفريق') as assignee_name
   from provision_private.work_due_reviews review
   join public.work_parts part on part.id=review.part_id and part.request_id=review.request_id
   join public.work_requests request on request.id=review.request_id
   join public.work_services service on service.id=part.service_id
   join auth.users account on account.id=part.assignee_id
   left join public.account_profiles profile on profile.user_id=account.id
   where review.status='pending' and provision_private.work_manage(part.service_id)
   order by review.review_expires_at limit 100
  )item;
 end if;
 if provision_private.work_manager() or provision_private.work_coordinator() then
  select coalesce(jsonb_agg(to_jsonb(item) order by item.intake_due_at),'[]'::jsonb) into intake_items from(
   select request.id as request_id,request.number as request_number,request.title as request_title,request.version as request_version,
    request.submitted_at,request.intake_due_at,request.intake_escalated_at,request.intake_due_at<=now() as overdue
   from public.work_requests request
   where request.status in('new','needs_info') and request.intake_action_at is null and request.intake_due_at is not null
    and provision_private.work_read(request.id)
    and (provision_private.work_coordinator() or provision_private.work_manager()
     and (coalesce(request.requested_service_id,request.service_id) is null or provision_private.work_manage(coalesce(request.requested_service_id,request.service_id))))
   order by request.intake_due_at limit 100
  )item;
 end if;
 return jsonb_build_object('due_reviews',due_reviews,'intake_controls',intake_items);
end;
$$;
revoke all on function public.work_control_center() from public,anon;
grant execute on function public.work_control_center() to authenticated;

create or replace function public.work_control_action(action text,p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_row public.work_requests; part public.work_parts; review provision_private.work_due_reviews; why text:=trim(coalesce(p->>'reason',''));
 replacement timestamptz; event_id bigint;
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if action is null or action not in('approve_due','reject_due','request_attachments','decline_intake') or octet_length(p::text)>50000 then raise exception 'invalid_action'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.work_events where actor=auth.uid() and created_at>now()-interval '1 minute')>=120 then raise exception 'work_rate_limit'; end if;
 select * into request_row from public.work_requests where id=(p->>'request_id')::uuid for update;
 if request_row.id is null or (p->>'version')::integer is distinct from request_row.version then raise exception 'version_conflict'; end if;

 if action in('approve_due','reject_due') then
  select * into review from provision_private.work_due_reviews where id=(p->>'due_review_id')::uuid and request_id=request_row.id for update;
  select * into part from public.work_parts where id=review.part_id and request_id=request_row.id for update;
  if review.id is null or part.id is null or not provision_private.work_manage(part.service_id) then raise exception 'forbidden' using errcode='42501'; end if;
  if review.status<>'pending' then raise exception 'invalid_state'; end if;
  if now()>=review.review_expires_at then
   update provision_private.work_due_reviews set status='auto_approved',reviewed_at=review_expires_at where id=review.id;
   return jsonb_build_object('request_id',request_row.id,'part_id',part.id,'due_review_id',review.id,'status','auto_approved');
  end if;
  if action='approve_due' then
   update provision_private.work_due_reviews set status='approved',reviewed_by=auth.uid(),reviewed_at=now() where id=review.id;
   insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
   values(request_row.id,part.id,auth.uid(),'due_approved','اعتماد موعد التسليم المقترح',false) returning id into event_id;
  else
   replacement=(p->>'due_at')::timestamptz;
   if length(why) not between 3 and 2000 then raise exception 'invalid_reason'; end if;
   if replacement is null or replacement<=now() or replacement=review.proposed_due_at then raise exception 'invalid_replacement_due'; end if;
   update provision_private.work_due_reviews set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),replacement_due_at=replacement,reason=why where id=review.id;
   update public.work_parts set due_at=replacement where id=part.id;
   insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
   values(request_row.id,part.id,auth.uid(),'due_rejected',why||E'\nموعد التسليم الجديد '||to_char(replacement at time zone 'Asia/Riyadh','YYYY/MM/DD HH24:MI'),false) returning id into event_id;
   perform provision_private.work_notify_once(part.assignee_id,request_row.id,
    'رفضت الإدارة موعد التسليم المقترح'||E'\nطلب '||request_row.number::text||E'\nموعد التسليم الجديد '||to_char(replacement at time zone 'Asia/Riyadh','YYYY/MM/DD HH24:MI')||E'\nسبب القرار '||why,
    'due:'||review.id::text||':rejected',true);
  end if;
  update public.work_requests set version=version+1,updated_at=now() where id=request_row.id;
  return jsonb_build_object('request_id',request_row.id,'part_id',part.id,'due_review_id',review.id,'status',action);
 end if;

 if not(provision_private.work_coordinator() or provision_private.work_manager()
  and (coalesce(request_row.requested_service_id,request_row.service_id) is null or provision_private.work_manage(coalesce(request_row.requested_service_id,request_row.service_id)))) then raise exception 'forbidden' using errcode='42501'; end if;
 if request_row.status not in('new','needs_info') then raise exception 'invalid_state'; end if;
 if length(why) not between 3 and 4000 then raise exception 'invalid_reason'; end if;
 if action='decline_intake' and not(provision_private.work_manager()
  and (coalesce(request_row.requested_service_id,request_row.service_id) is null or provision_private.work_manage(coalesce(request_row.requested_service_id,request_row.service_id)))) then raise exception 'forbidden' using errcode='42501'; end if;
 if action='request_attachments' then
  update public.work_requests set status='needs_info',version=version+1,updated_at=now() where id=request_row.id;
  insert into public.work_events(request_id,actor,kind,note,client_visible)
  values(request_row.id,auth.uid(),'request_attachments',why,true) returning id into event_id;
  perform provision_private.work_notify_once(request_row.client_id,request_row.id,
   'نحتاج مرفقات إضافية لطلبك'||E'\n'||why,'request:'||request_row.id::text||':attachments:'||request_row.version::text,false);
 else
  update public.work_requests set status='declined',version=version+1,updated_at=now() where id=request_row.id;
  insert into public.work_events(request_id,actor,kind,note,client_visible)
  values(request_row.id,auth.uid(),'decline_intake',why,true) returning id into event_id;
  perform provision_private.work_notify_once(request_row.client_id,request_row.id,
   'تعذر اعتماد الطلب'||E'\nسبب القرار '||why,'request:'||request_row.id::text||':declined',false);
 end if;
 return jsonb_build_object('request_id',request_row.id,'event_id',event_id);
end;
$$;
revoke all on function public.work_control_action(text,jsonb) from public,anon;
grant execute on function public.work_control_action(text,jsonb) to authenticated;

create or replace function provision_private.work_control_tick()
returns jsonb language plpgsql security definer set search_path='' as $$
declare approved_count integer; escalated_count integer:=0; item record;
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
  perform provision_private.work_notify_once(null,item.id,
   'تجاوز طلب مهلة إجراء مسؤول التواصل'||E'\nطلب '||item.number::text||E'\n'||item.title||E'\nيلزم تدخل الإدارة الآن',
   'intake:'||item.id::text||':overdue',true);
 end loop;
 return jsonb_build_object('auto_approved',approved_count,'intake_escalated',escalated_count);
end;
$$;
revoke all on function provision_private.work_control_tick() from public,anon,authenticated;

-- Critical operational messages remain mandatory for internal control users
create or replace function provision_private.work_request_whatsapp_policy()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.request_id is not null and new.whatsapp in('pending','failed','unknown','sending')
  and coalesce(new.event_key,'') not like 'control:%'
  and exists(select 1 from auth.users account where account.id=new.recipient and account.raw_app_meta_data->>'role'='super_admin') then
  new.whatsapp='suppressed';
  new.last_error='recipient_in_app_only';
 end if;
 return new;
end;
$$;

create or replace function provision_private.work_notification_preference_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.whatsapp in('pending','failed','unknown','sending') and coalesce(new.event_key,'') not like 'control:%'
  and coalesce((select not preference.whatsapp_enabled from public.work_notification_preferences preference where preference.user_id=new.recipient),false) then
  new.whatsapp='suppressed';
  new.last_error='user_channel_disabled';
 end if;
 return new;
end;
$$;

create or replace function public.work_notification_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update public.work_notifications notification set whatsapp='suppressed',last_error='recipient_in_app_only'
 from auth.users account where account.id=notification.recipient and account.raw_app_meta_data->>'role'='super_admin'
  and notification.request_id is not null and notification.whatsapp in('pending','failed','unknown','sending')
  and coalesce(notification.event_key,'') not like 'control:%';
 update public.work_notifications notification set whatsapp='suppressed',last_error='recipient_unavailable'
 from auth.users account where account.id=notification.recipient and notification.whatsapp in('pending','failed','unknown','sending')
  and (coalesce(account.is_anonymous,false) or (account.banned_until is not null and account.banned_until>=now())
   or coalesce(account.raw_app_meta_data->>'role','') not in('client','employee','admin','super_admin'));
 update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted'
 where whatsapp='sending' and next_attempt<now()-interval '2 minutes';
 with candidates as(
  select notification.id from public.work_notifications notification join auth.users account on account.id=notification.recipient
  where (notification.whatsapp in('pending','failed') or notification.whatsapp='unknown' and coalesce(notification.event_key,'') like 'control:%')
   and notification.attempts<5 and notification.next_attempt<=now()
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
 from claimed join auth.users account on account.id=claimed.recipient left join public.account_profiles profile on profile.user_id=claimed.recipient
 where claimed.whatsapp='sending';
 return result;
end;
$$;

-- Explicit dependency and control notifications replace generic duplicate broadcasts
create or replace function provision_private.work_event_broadcast()
returns trigger language plpgsql security definer set search_path='' as $$
declare request_row public.work_requests; label text; prefix text;
begin
 if new.kind in('dependency','due_approved','due_rejected','request_attachments','decline_intake') then return null; end if;
 select * into request_row from public.work_requests where id=new.request_id;
 if request_row.status='draft' then return null; end if;
 label=case new.kind when 'create' then 'طلب جديد' when 'submit_request' then 'طلب جديد' when 'intake' then 'استلام مسؤول التواصل'
  when 'assign' then 'إحالة مهمة' when 'accept' then 'استلام الموظف للمهمة' when 'deliver' then 'تسليم جديد'
  when 'review' then 'مراجعة العميل للتسليم' when 'attach' then 'مرفق جديد' when 'request_info' then 'طلب بيانات إضافية'
  when 'supply_info' then 'استكمال بيانات الطلب' when 'resolve' then 'قرار الإدارة' else 'تحديث على الطلب' end;
 prefix=txid_current()::text||':'||request_row.id::text||':';
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select account.id,request_row.id,label||E'\n'||request_row.title,case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,prefix||'event'
 from auth.users account where (account.raw_app_meta_data->>'role' in('admin','super_admin') or exists(select 1 from public.work_staff staff where staff.user_id=account.id and staff.coordinator))
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
  and not exists(select 1 from public.work_notifications notification where notification.recipient=account.id and notification.event_key like prefix||'%')
 on conflict(recipient,event_key) where event_key is not null do nothing;
 return null;
end;
$$;

-- Existing open records enter the same control plane without changing completed work
update public.work_requests set
 submitted_at=coalesce(submitted_at,created_at),
 intake_due_at=coalesce(intake_due_at,provision_private.work_intake_deadline(coalesce(submitted_at,created_at)))
where status='new' and intake_action_at is null;

update public.work_requests set
 submitted_at=coalesce(submitted_at,created_at),
 intake_action_at=coalesce(intake_action_at,updated_at),
 intake_action_kind=coalesce(intake_action_kind,'request_info'),
 intake_action_by=coalesce(intake_action_by,coordinator_id)
where status='needs_info' and coordinator_id is not null and intake_action_at is null;

insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,status,reviewed_at)
select part.request_id,part.id,part.assignee_id,part.due_at,part.accepted_at,part.accepted_at+interval '3 hours',
 case when part.accepted_at+interval '3 hours'<=now() then 'auto_approved' else 'pending' end,
 case when part.accepted_at+interval '3 hours'<=now() then part.accepted_at+interval '3 hours' else null end
from public.work_parts part
where part.accepted_at is not null and part.due_at is not null and part.status in('working','waiting','needs_info','escalated','review','revision')
 and not exists(select 1 from provision_private.work_due_reviews review where review.part_id=part.id);

do $due_backfill$
declare item record;
begin
 for item in select id from provision_private.work_due_reviews where status='pending' loop
  perform provision_private.work_due_review_notice(item.id);
 end loop;
end;
$due_backfill$;

do $backfill$
declare item record;
begin
 for item in select id from public.work_dependencies where status='pending' loop
  perform provision_private.work_dependency_notice(item.id);
 end loop;
end;
$backfill$;

do $cron$
declare existing_job bigint;
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  for existing_job in select jobid from cron.job where jobname='provision-work-control' loop
   perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule('provision-work-control','* * * * *','select provision_private.work_control_tick()');
 end if;
end;
$cron$;

-- Declined requests are terminal even if an old client attempts a stale mutation
do $guard$
declare body text; needle text:=$old$if r.status='completed' then raise exception 'invalid_state'; end if;$old$;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 if strpos(body,needle)=0 then raise exception 'work_action_terminal_guard_not_found'; end if;
 body=replace(body,needle,$new$if r.status in('completed','declined') then raise exception 'invalid_state'; end if;$new$);
 execute body;
end;
$guard$;

comment on table provision_private.work_due_reviews is 'Private audit history for three hour department due date reviews';
comment on function public.work_control_center() is 'Role scoped control queues for due date review and communication intake SLA';
comment on function public.work_control_action(text,jsonb) is 'Locked server side decisions for due dates attachments and intake rejection';

commit;
