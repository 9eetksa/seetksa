begin;
create table public.work_services (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 2 and 100), active boolean not null default true
);
insert into public.work_services(name) values ('التصميم'),('كتابة المحتوى'),('التصوير'),('المونتاج'),('المطبوعات'),('التسويق الرقمي'),('التطوير التقني');
create table public.work_staff (
 user_id uuid primary key references auth.users on delete cascade, capacity integer not null default 5 check(capacity between 1 and 100), coordinator boolean not null default false
);
create table public.work_memberships (
 user_id uuid references public.work_staff on delete cascade, service_id uuid references public.work_services on delete cascade, primary key(user_id,service_id)
);
create table public.work_grants (
 user_id uuid references auth.users on delete cascade, service_id uuid references public.work_services on delete cascade, can_manage boolean not null default false, primary key(user_id,service_id)
);
create table public.work_requests (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 client_id uuid not null references auth.users, title text not null check(length(title) between 3 and 200), brief text not null check(length(brief) between 10 and 12000),
 service_id uuid not null references public.work_services, specifications jsonb not null default '{}',
 status text not null default 'new' check(status in ('new','needs_info','active','completed')),
 coordinator_id uuid references auth.users, version integer not null default 1, test boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.work_parts (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.work_requests on delete cascade,
 service_id uuid not null references public.work_services, assignee_id uuid not null references auth.users,
 scope text not null check(length(scope) between 3 and 6000),
 status text not null default 'offered' check(status in ('offered','working','needs_info','escalated','waiting','review','revision','approved')),
 due_at timestamptz, accepted_at timestamptz, created_at timestamptz not null default now(), unique(id,request_id)
);
create index work_parts_assignee on public.work_parts(assignee_id,status);
create index work_parts_request on public.work_parts(request_id);
create index work_requests_client on public.work_requests(client_id,created_at desc);
create table public.work_dependencies (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid not null, upstream_id uuid not null, reason text not null check(length(reason) between 3 and 4000),
 status text not null default 'pending' check(status in ('pending','accepted','rejected','waived')),
 check(part_id<>upstream_id), unique(part_id,upstream_id),
 foreign key(part_id,request_id) references public.work_parts(id,request_id) on delete cascade,
 foreign key(upstream_id,request_id) references public.work_parts(id,request_id) on delete cascade
);
create table public.work_deliveries (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid not null, uploaded_by uuid not null references auth.users, object_path text not null unique,
 filename text not null check(length(filename) between 1 and 200), note text not null default '',
 status text not null default 'pending' check(status in ('pending','approved','changes')),
 feedback text, annotation jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(part_id,request_id) references public.work_parts(id,request_id) on delete cascade
);
create table public.work_attachments (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.work_requests on delete cascade,
 uploaded_by uuid not null references auth.users, object_path text not null unique, filename text not null, created_at timestamptz not null default now()
);
create table public.work_escalations (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.work_requests on delete cascade, part_id uuid references public.work_parts on delete cascade,
 kind text not null check(kind in ('overload','rejection','scope','dependency','routing')), reason text not null,
 dependency_id uuid references public.work_dependencies on delete cascade, opened_by uuid not null references auth.users,
 status text not null default 'open' check(status in ('open','resolved')), resolution text, resolved_by uuid references auth.users,
 created_at timestamptz not null default now(), resolved_at timestamptz
);
create table public.work_events (
 id bigint generated always as identity primary key, request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid references public.work_parts on delete cascade, actor uuid not null references auth.users,
 kind text not null, note text not null default '', client_visible boolean not null default false, created_at timestamptz not null default now()
);
create table public.work_notifications (
 id uuid primary key default gen_random_uuid(), recipient uuid not null references auth.users on delete cascade,
 request_id uuid not null references public.work_requests on delete cascade, message text not null,
 read_at timestamptz, created_at timestamptz not null default now(), whatsapp text not null default 'pending'
 check(whatsapp in ('pending','sending','sent','failed','unknown','suppressed')), attempts integer not null default 0,
 next_attempt timestamptz not null default now(), provider_id text, last_error text
);
create index work_notifications_recipient on public.work_notifications(recipient,created_at desc);
create index work_notifications_queue on public.work_notifications(next_attempt) where whatsapp in ('pending','failed');
create index work_events_request on public.work_events(request_id,id);

create function provision_private.work_role() returns text language sql stable security definer set search_path='' as $$
 select raw_app_meta_data->>'role' from auth.users where id=auth.uid() and provision_private.account_ready()
$$;
create function provision_private.work_manager() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(provision_private.work_role() in ('admin','super_admin'),false)
$$;
create function provision_private.work_coordinator() returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(select 1 from public.work_staff where user_id=auth.uid() and coordinator)
$$;
create function provision_private.work_manage(s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.is_owner() or (provision_private.work_role()='admin' and exists(select 1 from public.work_grants where user_id=auth.uid() and service_id=s and can_manage))
$$;
create function provision_private.work_read(r uuid) returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(select 1 from public.work_requests w where w.id=r and
 (provision_private.work_manager() or provision_private.work_coordinator() or w.client_id=auth.uid() or exists(select 1 from public.work_parts p where p.request_id=r and p.assignee_id=auth.uid())))
$$;
create function provision_private.work_part_read(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(select 1 from public.work_parts a join public.work_requests r on r.id=a.request_id where a.id=p and
 (provision_private.work_manager() or provision_private.work_coordinator() or a.assignee_id=auth.uid() or r.client_id=auth.uid()))
$$;
create function provision_private.work_file_read(path text) returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and (
 exists(select 1 from public.work_attachments a where a.object_path=path and provision_private.work_read(a.request_id)) or
 exists(select 1 from public.work_deliveries d where d.object_path=path and
 (provision_private.work_part_read(d.part_id) or (d.status='approved' and exists(select 1 from public.work_dependencies dep join public.work_parts p on p.id=dep.part_id where dep.upstream_id=d.part_id and dep.status='accepted' and p.assignee_id=auth.uid())))))
$$;
-- Notifications and the WhatsApp outbox are committed with the workflow transaction
create function provision_private.work_notify(who uuid,r uuid,msg text) returns void language plpgsql security definer set search_path='' as $$
begin
 if who is null then return; end if;
 if exists(select 1 from public.work_requests where id=r and test) and not exists(select 1 from auth.users where id=who and raw_app_meta_data->>'portal_qa'='true') then return; end if;
 insert into public.work_notifications(recipient,request_id,message,whatsapp)
 select who,r,msg,case when raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end from auth.users where id=who;
end; $$;
create function provision_private.work_alert(r uuid,p uuid,k text,why text,dep uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare u record;
begin
 insert into public.work_escalations(request_id,part_id,kind,reason,dependency_id,opened_by) values(r,p,k,why,dep,auth.uid());
 for u in select id from auth.users where raw_app_meta_data->>'role' in ('admin','super_admin') loop
 perform provision_private.work_notify(u.id,r,'حالة تحتاج تدخل الإدارة' || E'\n' || why);
 end loop;
end; $$;

do $$ declare t text; begin
 foreach t in array array['work_services','work_staff','work_memberships','work_grants','work_requests','work_parts','work_dependencies','work_deliveries','work_attachments','work_escalations','work_events','work_notifications'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create policy work_services_read on public.work_services for select to authenticated using(provision_private.account_ready());
create policy work_staff_read on public.work_staff for select to authenticated using(provision_private.account_ready() and (user_id=auth.uid() or provision_private.work_manager() or provision_private.work_coordinator()));
create policy work_memberships_read on public.work_memberships for select to authenticated using(provision_private.account_ready() and (user_id=auth.uid() or provision_private.work_manager() or provision_private.work_coordinator()));
create policy work_grants_read on public.work_grants for select to authenticated using(provision_private.account_ready() and (user_id=auth.uid() or provision_private.is_owner()));
create policy work_requests_read on public.work_requests for select to authenticated using(provision_private.work_read(id));
create policy work_parts_read on public.work_parts for select to authenticated using(provision_private.work_part_read(id));
create policy work_dependencies_read on public.work_dependencies for select to authenticated using(provision_private.work_part_read(part_id) or provision_private.work_part_read(upstream_id));
create policy work_deliveries_read on public.work_deliveries for select to authenticated using(provision_private.work_file_read(object_path));
create policy work_attachments_read on public.work_attachments for select to authenticated using(provision_private.work_read(request_id));
create policy work_escalations_read on public.work_escalations for select to authenticated using(provision_private.work_manager() or (provision_private.account_ready() and opened_by=auth.uid()));
create policy work_events_read on public.work_events for select to authenticated using(provision_private.work_read(request_id) and
 (provision_private.work_manager() or provision_private.work_coordinator() or actor=auth.uid() or (client_visible and exists(select 1 from public.work_requests r where r.id=request_id and r.client_id=auth.uid())) or (part_id is not null and exists(select 1 from public.work_parts p where p.id=part_id and p.assignee_id=auth.uid()))));
create policy work_notifications_read on public.work_notifications for select to authenticated using(provision_private.account_ready() and recipient=auth.uid());

create function public.work_setup(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; s uuid;
begin
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 if action='service' then
  insert into public.work_services(name) values(trim(p->>'name')) returning id into s;
 elsif action='staff' then
  u=(p->>'user_id')::uuid;
  if not exists(select 1 from auth.users where id=u and raw_app_meta_data->>'role' in ('employee','admin','super_admin')) then raise exception 'invalid_staff'; end if;
  insert into public.work_staff(user_id,capacity,coordinator) values(u,(p->>'capacity')::int,coalesce((p->>'coordinator')::boolean,false))
  on conflict(user_id) do update set capacity=excluded.capacity,coordinator=excluded.coordinator;
  delete from public.work_memberships where user_id=u;
  insert into public.work_memberships(user_id,service_id) select u,value::uuid from jsonb_array_elements_text(p->'services') on conflict do nothing;
 elsif action='grant' then
  u=(p->>'user_id')::uuid; s=(p->>'service_id')::uuid;
  if not exists(select 1 from auth.users where id=u and raw_app_meta_data->>'role'='admin') then raise exception 'invalid_admin'; end if;
  insert into public.work_grants(user_id,service_id,can_manage) values(u,s,(p->>'can_manage')::boolean)
  on conflict(user_id,service_id) do update set can_manage=excluded.can_manage;
 else raise exception 'invalid_action'; end if;
 insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'work_'||action,p);
 return jsonb_build_object('id',s);
end; $$;

create function public.work_directory() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not(provision_private.work_manager() or provision_private.work_coordinator()) then raise exception 'forbidden' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (
 select u.id,coalesce(nullif(p.display_name,''),u.email) as name,u.raw_app_meta_data->>'role' as role,
 coalesce(s.capacity,5) as capacity,coalesce(s.coordinator,false) as coordinator,
 (select coalesce(jsonb_agg(m.service_id),'[]') from public.work_memberships m where m.user_id=u.id) as services,
 (select count(*) from public.work_parts a where a.assignee_id=u.id and a.status<>'approved') as open_count
 from auth.users u left join public.account_profiles p on p.user_id=u.id left join public.work_staff s on s.user_id=u.id
 where u.raw_app_meta_data->>'role' in ('employee','admin','super_admin') and (u.banned_until is null or u.banned_until<now())
 order by name) t);
end; $$;

create function public.work_action(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.work_requests; a public.work_parts; b public.work_parts; d public.work_deliveries; dep public.work_dependencies; e public.work_escalations;
 rid uuid; aid uuid; target uuid; sid uuid; why text=trim(coalesce(p->>'reason','')); result_id uuid; due timestamptz; u record; event_name text=action; note text=''; external boolean=false;
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if octet_length(p::text)>50000 then raise exception 'invalid_input'; end if;
 if action='read_notification' then
  update public.work_notifications set read_at=now() where id=(p->>'id')::uuid and recipient=auth.uid(); return '{}';
 end if;
 if action='create' then
  target=auth.uid();
  if provision_private.work_manager() or provision_private.work_coordinator() then target=(p->>'client_id')::uuid; end if;
  if not exists(select 1 from auth.users where id=target and raw_app_meta_data->>'role'='client') then raise exception 'invalid_client'; end if;
  sid=(p->>'service_id')::uuid;
  if not exists(select 1 from public.work_services where id=sid and active) then raise exception 'invalid_service'; end if;
  if provision_private.work_manager() and not provision_private.work_manage(sid) then raise exception 'forbidden'; end if;
  insert into public.work_requests(client_id,title,brief,service_id,specifications,test) values(target,trim(p->>'title'),trim(p->>'brief'),sid,coalesce(p->'specifications','{}'),exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'portal_qa'='true')) returning * into r;
  for u in select id from auth.users where raw_app_meta_data->>'role' in ('admin','super_admin') or id in(select user_id from public.work_staff where coordinator) loop
   perform provision_private.work_notify(u.id,r.id,'طلب جديد يحتاج مراجعة فريق التواصل' || E'\n' || r.title);
  end loop;
  external=true;
 else
  rid=(p->>'request_id')::uuid;
  select * into r from public.work_requests where id=rid for update;
  if r.id is null or not provision_private.work_read(r.id) then raise exception 'forbidden' using errcode='42501'; end if;
  if (p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
  if r.status='completed' then raise exception 'invalid_state'; end if;
  if p ? 'part_id' then select * into a from public.work_parts where id=(p->>'part_id')::uuid and request_id=r.id for update;
   if a.id is null then raise exception 'invalid_part'; end if;
  end if;
  if action='intake' then
   if not(provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) or r.status not in ('new','needs_info') then raise exception 'forbidden'; end if;
   update public.work_requests set status='active',coordinator_id=auth.uid() where id=r.id;
   perform provision_private.work_notify(r.client_id,r.id,'تم استلام المهمة من قبل فريق التواصل' || E'\n' || r.title); external=true;
  elsif action='request_info' then
   if not(provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) or length(why)<3 then raise exception 'forbidden'; end if;
   update public.work_requests set status='needs_info' where id=r.id;
   perform provision_private.work_notify(r.client_id,r.id,'نحتاج بيانات إضافية لطلبك' || E'\n' || why); note=why; external=true;
  elsif action='supply_info' then
   if not(r.client_id=auth.uid() or provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) or length(why)<3 then raise exception 'forbidden'; end if;
   update public.work_requests set brief=brief||E'\n'||why,status=case when coordinator_id is null then 'new' else 'active' end where id=r.id;
   for b in update public.work_parts set status='offered' where request_id=r.id and status='needs_info' returning * loop
    perform provision_private.work_notify(b.assignee_id,r.id,'اكتملت البيانات المطلوبة يرجى استلام المهمة');
   end loop;
   perform provision_private.work_notify(r.coordinator_id,r.id,'تم استكمال بيانات الطلب'); note=why; external=true;
  elsif action='assign' then
   sid=(p->>'service_id')::uuid; target=(p->>'assignee_id')::uuid;
   if r.status<>'active' or not(provision_private.work_coordinator() or provision_private.work_manage(sid)) then raise exception 'forbidden'; end if;
   perform 1 from public.work_staff where user_id=target for update;
   if not found or not exists(select 1 from public.work_memberships where user_id=target and service_id=sid) then raise exception 'invalid_assignment'; end if;
   insert into public.work_parts(request_id,service_id,assignee_id,scope) values(r.id,sid,target,trim(p->>'scope')) returning * into a;
   perform provision_private.work_notify(target,r.id,'أحيلت إليك مهمة جديدة يرجى الاستلام وتحديد موعد التسليم' || E'\n' || a.scope);
   if (select count(*) from public.work_parts where assignee_id=target and status<>'approved')>(select capacity from public.work_staff where user_id=target) then
    perform provision_private.work_alert(r.id,a.id,'overload','ضغط عمل مرتفع على الموظف المكلف بهذه المهمة يرجى اتخاذ إجراء');
   end if;
   external=true;
  elsif action in ('accept','missing','reject','scope','routing','dependency','deliver') then
   if a.id is null or a.assignee_id<>auth.uid() then raise exception 'forbidden' using errcode='42501'; end if;
   if action='accept' then
    if a.status<>'offered' then raise exception 'invalid_state'; end if;
    due=(p->>'due_at')::timestamptz;
    if due is null or due<=now() then raise exception 'invalid_due'; end if;
    update public.work_parts set status=case when exists(select 1 from public.work_dependencies x join public.work_parts y on y.id=x.upstream_id where x.part_id=a.id and x.status<>'waived' and (x.status<>'accepted' or y.status<>'approved')) then 'waiting' else 'working' end,due_at=due,accepted_at=now() where id=a.id;
    perform provision_private.work_notify(r.coordinator_id,r.id,'تم استلام المهمة وتحديد موعد التسليم');
    perform provision_private.work_notify(r.client_id,r.id,'تم استلام المهمة أو التعديلات وجار تنفيذها'); external=true;
   elsif action='missing' then
    if a.status not in ('offered','working') or length(why)<3 then raise exception 'invalid_state'; end if;
    update public.work_parts set status='needs_info' where id=a.id;
    perform provision_private.work_notify(r.coordinator_id,r.id,'المهمة تحتاج استكمال بيانات' || E'\n' || why); note=why;
   elsif action in ('reject','scope','routing') then
    if length(why)<3 or (action='scope' and a.status<>'revision') or (action in ('reject','routing') and a.status not in ('offered','working','waiting')) then raise exception 'invalid_state'; end if;
    update public.work_parts set status='escalated' where id=a.id;
    perform provision_private.work_alert(r.id,a.id,case when action='reject' then 'rejection' else action end,why); note=why;
   elsif action='dependency' then
    if a.status not in ('working','waiting') or length(why)<3 then raise exception 'invalid_state'; end if;
    select * into b from public.work_parts where id=(p->>'upstream_id')::uuid and request_id=r.id;
    if b.id is null or b.id=a.id then raise exception 'invalid_dependency'; end if;
    if exists(with recursive chain(id) as (select b.id union select x.upstream_id from public.work_dependencies x join chain c on x.part_id=c.id where x.status<>'waived') select 1 from chain where id=a.id) then raise exception 'dependency_cycle'; end if;
    insert into public.work_dependencies(request_id,part_id,upstream_id,reason) values(r.id,a.id,b.id,why);
    update public.work_parts set status='waiting' where id=a.id;
    perform provision_private.work_notify(b.assignee_id,r.id,'قسم آخر يحتاج مخرجاتك قبل بدء العمل' || E'\n' || why); note=why;
   elsif action='deliver' then
    if a.status not in ('working','revision') or exists(select 1 from public.work_dependencies x join public.work_parts y on y.id=x.upstream_id where x.part_id=a.id and x.status<>'waived' and (x.status<>'accepted' or y.status<>'approved')) then raise exception 'dependency_pending'; end if;
    if not exists(select 1 from storage.objects where bucket_id='work-files' and name=p->>'object_path' and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]=a.id::text) then raise exception 'invalid_file'; end if;
    insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,note) values(r.id,a.id,auth.uid(),p->>'object_path',p->>'filename',left(coalesce(p->>'note',''),4000)) returning id into result_id;
    update public.work_parts set status='review' where id=a.id;
    perform provision_private.work_notify(r.client_id,r.id,'تم الانتهاء من تنفيذ جزء من طلبك يرجى مراجعة التسليم واعتماده أو توضيح التعديلات'); external=true;
   end if;
  elsif action='dependency_reply' then
   select * into dep from public.work_dependencies where id=(p->>'dependency_id')::uuid and request_id=r.id for update;
   select * into b from public.work_parts where id=dep.upstream_id;
   if dep.id is null or dep.status<>'pending' or b.assignee_id<>auth.uid() then raise exception 'forbidden'; end if;
   if p->>'decision'='accept' then
    update public.work_dependencies set status='accepted' where id=dep.id;
   elsif p->>'decision'='reject' and length(why)>=3 then
    update public.work_dependencies set status='rejected' where id=dep.id;
    perform provision_private.work_alert(r.id,dep.part_id,'dependency',why,dep.id);
   else raise exception 'invalid_decision'; end if;
   select * into a from public.work_parts where id=dep.part_id;
   perform provision_private.work_notify(a.assignee_id,r.id,'ورد رد على طلب الاعتماد بين الأقسام'); note=why;
  elsif action='resolve' then
   select * into e from public.work_escalations where id=(p->>'escalation_id')::uuid and request_id=r.id for update;
   select * into a from public.work_parts where id=e.part_id;
   if e.id is null or e.status<>'open' or not provision_private.work_manage(coalesce(a.service_id,r.service_id)) or length(why)<3 then raise exception 'forbidden'; end if;
   if p->>'decision'='reassign' then
    target=(p->>'assignee_id')::uuid;
    perform 1 from public.work_staff where user_id=target for update;
    if not found or target=a.assignee_id or not exists(select 1 from public.work_memberships where user_id=target and service_id=a.service_id) then raise exception 'invalid_assignment'; end if;
    update public.work_parts set assignee_id=target,status='offered',accepted_at=null,due_at=null where id=a.id;
    perform provision_private.work_notify(a.assignee_id,r.id,'تم نقل المهمة إلى موظف آخر بقرار الإدارة');
    perform provision_private.work_notify(target,r.id,'أحيلت إليك مهمة بقرار الإدارة يرجى الاستلام وتحديد الموعد');
    if (select count(*) from public.work_parts where assignee_id=target and status<>'approved')>(select capacity from public.work_staff where user_id=target) then
     perform provision_private.work_alert(r.id,a.id,'overload','ضغط عمل مرتفع بعد إعادة توزيع المهمة');
    end if;
   elsif e.kind='dependency' and p->>'decision' in ('enforce_dependency','waive_dependency') then
    update public.work_dependencies set status=case when p->>'decision'='enforce_dependency' then 'accepted' else 'waived' end where id=e.dependency_id returning * into dep;
    select * into b from public.work_parts where id=dep.upstream_id;
    perform provision_private.work_notify(b.assignee_id,r.id,'اتخذت الإدارة قرارا بشأن اعتماد القسم على مخرجاتك' || E'\n' || why);
   elsif p->>'decision'='keep' then
    if e.kind<>'overload' then
     due=coalesce((p->>'due_at')::timestamptz,a.due_at);
     if due is null or due<=now() then raise exception 'invalid_due'; end if;
     update public.work_parts set status=case when e.kind='scope' then 'revision' else 'working' end,accepted_at=coalesce(accepted_at,now()),due_at=due where id=a.id;
    end if;
   else raise exception 'invalid_decision'; end if;
   update public.work_escalations set status='resolved',resolution=why,resolved_by=auth.uid(),resolved_at=now() where id=e.id;
   perform provision_private.work_notify(a.assignee_id,r.id,'صدر قرار الإدارة بشأن المهمة' || E'\n' || why); note=why;
  elsif action='review' then
   if r.client_id<>auth.uid() then raise exception 'forbidden'; end if;
   select * into d from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id for update;
   select * into a from public.work_parts where id=d.part_id;
   if d.id is null or d.status<>'pending' or a.status<>'review' then raise exception 'invalid_state'; end if;
   if p->>'decision'='approve' then
    update public.work_deliveries set status='approved' where id=d.id;
    update public.work_parts set status='approved' where id=a.id;
    perform provision_private.work_notify(a.assignee_id,r.id,'اعتمد العميل تسليمك');
   elsif p->>'decision'='changes' and length(why)>=3 then
    update public.work_deliveries set status='changes',feedback=why,annotation=coalesce(p->'annotation','{}') where id=d.id;
    update public.work_parts set status='revision' where id=a.id;
    perform provision_private.work_notify(a.assignee_id,r.id,'العميل طلب تعديلات على التسليم وهي قيد التنفيذ لديك' || E'\n' || why);
    perform provision_private.work_notify(r.client_id,r.id,'تم استلام التعديلات وجار تنفيذها');
   else raise exception 'invalid_decision'; end if;
   note=why; external=true;
  elsif action='attach' then
   if r.client_id<>auth.uid() and not(provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) then raise exception 'forbidden'; end if;
   if not exists(select 1 from storage.objects where bucket_id='work-files' and name=p->>'object_path' and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]='brief') then raise exception 'invalid_file'; end if;
   insert into public.work_attachments(request_id,uploaded_by,object_path,filename) values(r.id,auth.uid(),p->>'object_path',p->>'filename'); external=true;
  else raise exception 'invalid_action'; end if;
 end if;
 -- Dependency release is gated by client approval of every required upstream output
 for b in update public.work_parts x set status='working' where x.request_id=r.id and x.status='waiting' and not exists(
 select 1 from public.work_dependencies y join public.work_parts z on z.id=y.upstream_id where y.part_id=x.id and y.status<>'waived' and (y.status<>'accepted' or z.status<>'approved')) returning x.* loop
  perform provision_private.work_notify(b.assignee_id,r.id,'اعتمدت المخرجات المطلوبة ويمكنك بدء تنفيذ الجزء الخاص بك');
 end loop;
 update public.work_requests set version=version+1,updated_at=now(),status=case when exists(select 1 from public.work_parts where request_id=r.id) and not exists(select 1 from public.work_parts where request_id=r.id and status<>'approved') and not exists(select 1 from public.work_escalations where request_id=r.id and status='open') then 'completed' else status end where id=r.id;
 insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),event_name,note,external);
 return jsonb_build_object('request_id',r.id,'part_id',a.id,'delivery_id',result_id);
end; $$;

-- Only a minimal list of involved departments is shared for dependency selection
create function public.work_routes(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.work_read(p_request) then raise exception 'forbidden'; end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'service',s.name,'scope',p.scope,
 'status',case when provision_private.work_role()='client' or provision_private.work_manager() or provision_private.work_coordinator() or p.assignee_id=auth.uid() then p.status else null end)),'[]') from public.work_parts p join public.work_services s on s.id=p.service_id where p.request_id=p_request);
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('work-files','work-files',false,104857600,array['image/jpeg','image/png','image/webp','application/pdf','video/mp4','video/quicktime','audio/mpeg','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
create function provision_private.work_upload(path text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare rid uuid; segment text;
begin
 rid=((storage.foldername(path))[1])::uuid; segment=(storage.foldername(path))[2];
 if not provision_private.account_ready() then return false; end if;
 if segment='brief' then return exists(select 1 from public.work_requests r where r.id=rid and r.status<>'completed' and (r.client_id=auth.uid() or provision_private.work_coordinator() or provision_private.work_manage(r.service_id))); end if;
 return exists(select 1 from public.work_parts p where p.id=segment::uuid and p.request_id=rid and p.assignee_id=auth.uid() and p.status in ('working','revision'));
exception when invalid_text_representation then return false;
end; $$;
create policy work_file_upload on storage.objects for insert to authenticated with check(bucket_id='work-files' and provision_private.work_upload(name));
create policy work_file_download on storage.objects for select to authenticated using(bucket_id='work-files' and (provision_private.work_file_read(name) or (owner_id=auth.uid()::text and provision_private.work_upload(name))));
-- Immutable submitted files and versions prevent changing what the client approved
create policy work_file_remove_draft on storage.objects for delete to authenticated using(bucket_id='work-files' and owner_id=auth.uid()::text and provision_private.work_upload(name) and not exists(select 1 from public.work_deliveries where object_path=name) and not exists(select 1 from public.work_attachments where object_path=name));

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','provision_private') and p.proname like 'work_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.signature::text not like '%work_notify(%' and f.signature::text not like '%work_alert(%' then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
-- Do not broadcast internal task rows to colleagues
alter publication supabase_realtime add table public.work_notifications;
commit;
