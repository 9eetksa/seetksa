begin;

-- All privileged database paths fail closed for anonymous pending or banned accounts
create or replace function provision_private.account_ready()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from auth.users
  where id=auth.uid()
   and not coalesce(is_anonymous,false)
   and raw_app_meta_data->>'role' in('client','employee','admin','super_admin')
   and coalesce(raw_app_meta_data->>'must_change_password','false')<>'true'
   and (banned_until is null or banned_until<now())
 )
$$;
revoke all on function provision_private.account_ready() from public,anon;
grant execute on function provision_private.account_ready() to authenticated;

-- Professional service metadata stays separate from public marketing copy
alter table public.work_services
 add column if not exists slug text,
 add column if not exists category text not null default 'خدمات إبداعية',
 add column if not exists description text not null default '',
 add column if not exists icon text not null default 'sparkles',
 add column if not exists default_target_minutes integer not null default 4320,
 add column if not exists default_effort_points numeric(6,2) not null default 5,
 add column if not exists sort_order integer not null default 100;

update public.work_services set
 slug=case name
  when 'التصميم' then 'design'
  when 'كتابة المحتوى' then 'content-writing'
  when 'التصوير' then 'photography'
  when 'المونتاج' then 'post-production'
  when 'المطبوعات' then 'print-production'
  when 'التسويق الرقمي' then 'digital-marketing'
  when 'التطوير التقني' then 'digital-products'
  else 'service-'||replace(id::text,'-','') end,
 category=case name
  when 'التطوير التقني' then 'المنتجات الرقمية'
  when 'التسويق الرقمي' then 'النمو والتسويق'
  when 'كتابة المحتوى' then 'المحتوى'
  when 'التصوير' then 'الإنتاج المرئي'
  when 'المونتاج' then 'الإنتاج المرئي'
  when 'المطبوعات' then 'الإنتاج الطباعي'
  else 'الهوية والتصميم' end,
 description=case name
  when 'التصميم' then 'تصميم الهوية والمواد البصرية للحملات والمنصات'
  when 'كتابة المحتوى' then 'صياغة المحتوى الإبداعي والتجاري ومحتوى العلامة'
  when 'التصوير' then 'تصوير المنتجات والمواقع والفرق والمحتوى التجاري'
  when 'المونتاج' then 'تحرير الفيديو والموشن وتجهيز النسخ للنشر'
  when 'المطبوعات' then 'تصميم وتجهيز المطبوعات والتغليف للإنتاج'
  when 'التسويق الرقمي' then 'تخطيط الحملات وإدارة قنوات النمو وقياس النتائج'
  when 'التطوير التقني' then 'بناء المواقع والمنصات والتجارب الرقمية'
  else description end,
 icon=case name
  when 'التصميم' then 'palette'
  when 'كتابة المحتوى' then 'pen-tool'
  when 'التصوير' then 'camera'
  when 'المونتاج' then 'film'
  when 'المطبوعات' then 'printer'
  when 'التسويق الرقمي' then 'megaphone'
  when 'التطوير التقني' then 'code'
  else icon end,
 default_target_minutes=case name
  when 'التصوير' then 2880
  when 'المطبوعات' then 2880
  when 'التصميم' then 4320
  when 'كتابة المحتوى' then 2880
  when 'المونتاج' then 4320
  when 'التسويق الرقمي' then 10080
  when 'التطوير التقني' then 14400
  else default_target_minutes end,
 default_effort_points=case name
  when 'التصوير' then 5
  when 'المطبوعات' then 3
  when 'التصميم' then 5
  when 'كتابة المحتوى' then 3
  when 'المونتاج' then 8
  when 'التسويق الرقمي' then 8
  when 'التطوير التقني' then 13
  else default_effort_points end,
 sort_order=case name
  when 'التصميم' then 10
  when 'كتابة المحتوى' then 20
  when 'التصوير' then 30
  when 'المونتاج' then 40
  when 'المطبوعات' then 50
  when 'التسويق الرقمي' then 60
  when 'التطوير التقني' then 70
  else sort_order end
where slug is null;

insert into public.work_services(name,slug,category,description,icon,default_target_minutes,default_effort_points,sort_order)
values
 ('الاستراتيجية والعلامة التجارية','brand-strategy','الاستراتيجية','بحث السوق وتحديد موقع العلامة وبناء خارطة حضور واضحة','sparkles',7200,8,5),
 ('إدارة منصات التواصل','social-media','المحتوى','تخطيط المحتوى وإدارة النشر والتفاعل ورفع التقارير','message-square',10080,8,25),
 ('الحملات الإعلانية','campaigns','النمو والتسويق','تخطيط الحملات وإنتاج موادها وتحسين الأداء','megaphone',10080,13,65),
 ('المتاجر الإلكترونية','ecommerce','المنتجات الرقمية','تصميم وبناء تجربة متجر مترابطة مع رحلة العميل','shopping-bag',20160,21,75),
 ('التحليل وقياس الأداء','analytics','النمو والتسويق','لوحات قياس وتقارير تنفيذية تحول البيانات إلى قرارات','chart',7200,8,80)
on conflict(name) do update set
 slug=excluded.slug,
 category=excluded.category,
 description=excluded.description,
 icon=excluded.icon,
 default_target_minutes=excluded.default_target_minutes,
 default_effort_points=excluded.default_effort_points,
 sort_order=excluded.sort_order;

update public.work_services
set slug='service-'||replace(id::text,'-','')
where slug is null or slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$';

alter table public.work_services alter column slug set default ('service-'||replace(gen_random_uuid()::text,'-',''));
alter table public.work_services alter column slug set not null;

do $constraints$
begin
 if not exists(select 1 from pg_constraint where conname='work_services_slug_format' and conrelid='public.work_services'::regclass) then
  alter table public.work_services add constraint work_services_slug_format check(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug)<=90);
 end if;
 if not exists(select 1 from pg_constraint where conname='work_services_category_length' and conrelid='public.work_services'::regclass) then
  alter table public.work_services add constraint work_services_category_length check(char_length(category) between 2 and 80);
 end if;
 if not exists(select 1 from pg_constraint where conname='work_services_description_length' and conrelid='public.work_services'::regclass) then
  alter table public.work_services add constraint work_services_description_length check(char_length(description)<=600);
 end if;
 if not exists(select 1 from pg_constraint where conname='work_services_icon_format' and conrelid='public.work_services'::regclass) then
  alter table public.work_services add constraint work_services_icon_format check(icon ~ '^[a-z0-9-]{2,40}$');
 end if;
 if not exists(select 1 from pg_constraint where conname='work_services_target_range' and conrelid='public.work_services'::regclass) then
  alter table public.work_services add constraint work_services_target_range check(default_target_minutes between 30 and 525600);
 end if;
 if not exists(select 1 from pg_constraint where conname='work_services_effort_range' and conrelid='public.work_services'::regclass) then
  alter table public.work_services add constraint work_services_effort_range check(default_effort_points between 0.5 and 100);
 end if;
end;
$constraints$;

create unique index if not exists work_services_slug on public.work_services(slug);
create index if not exists work_services_catalog_order on public.work_services(active,sort_order,name);
drop policy if exists work_services_read on public.work_services;
create policy work_services_read on public.work_services for select to authenticated
using(provision_private.account_ready() and active);

create or replace function public.work_service_catalog(p_include_inactive boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_include_inactive and not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501'; end if;
 return(select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'slug',s.slug,'category',s.category,'description',s.description,
  'icon',s.icon,'active',s.active,'default_target_minutes',s.default_target_minutes,
  'default_effort_points',s.default_effort_points,'sort_order',s.sort_order
 ) order by s.sort_order,s.name),'[]'::jsonb)
 from public.work_services s where s.active or p_include_inactive);
end;
$$;
revoke all on function public.work_service_catalog(boolean) from public,anon;
grant execute on function public.work_service_catalog(boolean) to authenticated;

create or replace function public.work_service_save(p jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare target_service_id uuid; service_slug text; enabled boolean;
begin
 if not provision_private.is_owner() or p is null or octet_length(p::text)>5000 then raise exception 'forbidden' using errcode='42501'; end if;
 if nullif(p->>'id','') is not null and coalesce(p->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_service'; end if;
 if p ? 'active' and coalesce(p->>'active','') not in('true','false') then raise exception 'invalid_service'; end if;
 target_service_id=nullif(p->>'id','')::uuid;
 service_slug=lower(btrim(coalesce(p->>'slug','')));
 enabled=coalesce((p->>'active')::boolean,true);
 if char_length(btrim(coalesce(p->>'name',''))) not between 2 and 100
  or service_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(service_slug)>90
  or char_length(btrim(coalesce(p->>'category',''))) not between 2 and 80
  or char_length(coalesce(p->>'description',''))>600
  or coalesce(p->>'icon','') !~ '^[a-z0-9-]{2,40}$'
  or coalesce(p->>'default_target_minutes','') !~ '^[0-9]{2,6}$'
  or coalesce(p->>'default_effort_points','') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
  or coalesce(p->>'sort_order','') !~ '^[0-9]{1,5}$' then raise exception 'invalid_service'; end if;
 if coalesce((p->>'default_target_minutes')::integer,0) not between 30 and 525600
  or coalesce((p->>'default_effort_points')::numeric,0) not between 0.5 and 100
  or coalesce((p->>'sort_order')::integer,-1) not between 0 and 10000 then raise exception 'invalid_service'; end if;
 if not enabled and target_service_id is not null and exists(
  select 1 from public.work_parts part
  where part.service_id=target_service_id and part.status not in('approved','forwarded','internal_done')
 ) then
  raise exception 'service_has_open_work';
 end if;
 if target_service_id is null then
  insert into public.work_services(name,slug,category,description,icon,active,default_target_minutes,default_effort_points,sort_order)
  values(btrim(p->>'name'),service_slug,btrim(p->>'category'),btrim(coalesce(p->>'description','')),p->>'icon',enabled,(p->>'default_target_minutes')::integer,(p->>'default_effort_points')::numeric,(p->>'sort_order')::integer)
  returning id into target_service_id;
 else
  update public.work_services s set name=btrim(p->>'name'),slug=service_slug,category=btrim(p->>'category'),description=btrim(coalesce(p->>'description','')),
   icon=p->>'icon',active=enabled,default_target_minutes=(p->>'default_target_minutes')::integer,
   default_effort_points=(p->>'default_effort_points')::numeric,sort_order=(p->>'sort_order')::integer
  where s.id=target_service_id;
  if not found then raise exception 'invalid_service'; end if;
 end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),'work_service_save',jsonb_build_object('id',target_service_id,'name',btrim(p->>'name'),'active',enabled));
 return target_service_id;
end;
$$;
revoke all on function public.work_service_save(jsonb) from public,anon;
grant execute on function public.work_service_save(jsonb) to authenticated;

-- Keep the service requested by the client as a validated relational reference for intake
alter table public.work_requests
 add column if not exists requested_service_id uuid references public.work_services(id) on delete set null;
create index if not exists work_requests_requested_service
on public.work_requests(requested_service_id,created_at desc);

update public.work_requests request set requested_service_id=service.id
from public.work_services service
where request.requested_service_id is null
 and service.id=case
  when nullif(btrim(coalesce(request.specifications->>'معرف الخدمة','')),'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then nullif(btrim(coalesce(request.specifications->>'معرف الخدمة','')),'')::uuid
  else null
 end;
update public.work_requests
set requested_service_id=service_id
where requested_service_id is null and service_id is not null;

create or replace function provision_private.work_requested_service()
returns trigger language plpgsql security definer set search_path='' as $$
declare requested_key text:=nullif(btrim(coalesce(new.specifications->>'معرف الخدمة','')),''); requested_id uuid;
begin
 if requested_key is not null then
  if requested_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid_service'; end if;
  select service.id into requested_id from public.work_services service
  where service.active and service.id=requested_key::uuid;
  if requested_id is null then raise exception 'invalid_service'; end if;
  new.requested_service_id=requested_id;
 elsif tg_op='INSERT' then
  new.requested_service_id=coalesce(new.requested_service_id,new.service_id);
 elsif new.specifications is distinct from old.specifications then
  new.requested_service_id=coalesce(new.requested_service_id,new.service_id);
 end if;
 return new;
end;
$$;
revoke all on function provision_private.work_requested_service() from public,anon,authenticated;
drop trigger if exists work_requested_service on public.work_requests;
create trigger work_requested_service before insert or update of specifications on public.work_requests
for each row execute function provision_private.work_requested_service();

-- Immutable workload snapshots and accountable time make performance scoring auditable
alter table public.work_parts
 add column if not exists assigned_at timestamptz,
 add column if not exists target_minutes integer,
 add column if not exists effort_points numeric(6,2),
 add column if not exists completed_at timestamptz,
 add column if not exists performance_eligible boolean not null default true,
 add column if not exists accountable_seconds bigint not null default 0,
 add column if not exists state_started_at timestamptz,
 add column if not exists metrics_quality text not null default 'measured';

create index if not exists work_deliveries_part_created on public.work_deliveries(part_id,created_at desc);

with latest_delivery as (
 select part.id as part_id,max(delivery.created_at) as delivered_at
 from public.work_parts part
 left join public.work_deliveries delivery on delivery.part_id=part.id
 group by part.id
)
update public.work_parts p set
 assigned_at=coalesce(p.assigned_at,p.created_at),
 target_minutes=coalesce(p.target_minutes,s.default_target_minutes),
 effort_points=coalesce(p.effort_points,s.default_effort_points),
 completed_at=case when p.status in('approved','forwarded','internal_done') then coalesce(p.completed_at,latest.delivered_at,p.created_at) else null end,
 accountable_seconds=case when p.accountable_seconds=0 and p.status in('approved','forwarded','internal_done') then greatest(0,extract(epoch from (coalesce(latest.delivered_at,p.created_at)-p.created_at))::bigint) else p.accountable_seconds end,
 state_started_at=coalesce(p.state_started_at,now()),
 metrics_quality='estimated'
from public.work_services s,latest_delivery latest
where s.id=p.service_id and latest.part_id=p.id;

update public.work_parts p set performance_eligible=false
where exists(
 select 1 from provision_private.work_assignment_history h
 where h.previous_assignee is not null
  and h.previous_assignee is distinct from h.next_assignee
  and (select e.part_id from public.work_events e where e.id=h.event_id)=p.id
);

alter table public.work_parts alter column assigned_at set not null;
alter table public.work_parts alter column target_minutes set not null;
alter table public.work_parts alter column effort_points set not null;
alter table public.work_parts alter column state_started_at set not null;

do $constraints$
begin
 if not exists(select 1 from pg_constraint where conname='work_parts_target_range' and conrelid='public.work_parts'::regclass) then
  alter table public.work_parts add constraint work_parts_target_range check(target_minutes between 30 and 525600);
 end if;
 if not exists(select 1 from pg_constraint where conname='work_parts_effort_range' and conrelid='public.work_parts'::regclass) then
  alter table public.work_parts add constraint work_parts_effort_range check(effort_points between 0.5 and 100);
 end if;
 if not exists(select 1 from pg_constraint where conname='work_parts_accountable_positive' and conrelid='public.work_parts'::regclass) then
  alter table public.work_parts add constraint work_parts_accountable_positive check(accountable_seconds>=0);
 end if;
 if not exists(select 1 from pg_constraint where conname='work_parts_metrics_quality' and conrelid='public.work_parts'::regclass) then
  alter table public.work_parts add constraint work_parts_metrics_quality check(metrics_quality in('estimated','measured'));
 end if;
end;
$constraints$;

create or replace function provision_private.work_part_metrics_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare service public.work_services; elapsed bigint;
begin
 select * into service from public.work_services where id=new.service_id;
 if service.id is null then raise exception 'invalid_service'; end if;
 if tg_op='INSERT' then
  new.assigned_at=coalesce(new.assigned_at,now());
  new.target_minutes=service.default_target_minutes;
  new.effort_points=service.default_effort_points;
  new.accountable_seconds=0;
  new.state_started_at=now();
  new.completed_at=null;
  new.performance_eligible=true;
  new.metrics_quality='measured';
  return new;
 end if;
 new.target_minutes=old.target_minutes;
 new.effort_points=old.effort_points;
 new.assigned_at=old.assigned_at;
 new.accountable_seconds=old.accountable_seconds;
 new.state_started_at=old.state_started_at;
 new.completed_at=old.completed_at;
 new.performance_eligible=old.performance_eligible;
 new.metrics_quality=old.metrics_quality;
 if new.assignee_id is distinct from old.assignee_id or new.service_id is distinct from old.service_id then
  new.assigned_at=now();
  new.target_minutes=service.default_target_minutes;
  new.effort_points=service.default_effort_points;
  new.accountable_seconds=0;
  new.state_started_at=now();
  new.completed_at=null;
  new.performance_eligible=false;
  new.metrics_quality='measured';
 elsif new.status is distinct from old.status then
  if old.status in('offered','working','revision') then
   elapsed=greatest(0,extract(epoch from (now()-old.state_started_at))::bigint);
   new.accountable_seconds=old.accountable_seconds+elapsed;
  end if;
  new.state_started_at=now();
  if new.status in('approved','forwarded','internal_done') then new.completed_at=now();
  elsif old.status in('approved','forwarded','internal_done') then new.completed_at=null;
  end if;
 end if;
 return new;
end;
$$;
revoke all on function provision_private.work_part_metrics_guard() from public,anon,authenticated;
drop trigger if exists work_part_metrics_guard on public.work_parts;
create trigger work_part_metrics_guard before insert or update on public.work_parts
for each row execute function provision_private.work_part_metrics_guard();

create index if not exists work_parts_assignee_assigned on public.work_parts(assignee_id,assigned_at desc) include(status,service_id,completed_at,performance_eligible);
create index if not exists work_deliveries_request_created on public.work_deliveries(request_id,created_at desc);
create index if not exists work_dependencies_part_status on public.work_dependencies(part_id,status);
create index if not exists work_dependencies_upstream_status on public.work_dependencies(upstream_id,status);
create index if not exists work_escalations_request_status on public.work_escalations(request_id,status);
create index if not exists work_escalations_open_part on public.work_escalations(part_id) where status='open';
create index if not exists work_events_part_kind_created on public.work_events(part_id,kind,created_at desc) where part_id is not null;

create or replace function public.work_employee_performance(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period_days integer:=least(greatest(coalesce(p_days,30),7),365); role_name text:=provision_private.work_role(); result jsonb;
begin
 if role_name not in('employee','admin','super_admin') or not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 with people as (
  select u.id,coalesce(nullif(ap.display_name,''),u.email) as name,coalesce(ws.capacity,5) as capacity
  from auth.users u
  left join public.account_profiles ap on ap.user_id=u.id
  left join public.work_staff ws on ws.user_id=u.id
  where u.raw_app_meta_data->>'role' in('employee','admin','super_admin')
   and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<now())
   and (
    u.id=auth.uid()
    or role_name='super_admin'
    or role_name='admin' and exists(
     select 1 from public.work_memberships wm join public.work_grants wg on wg.service_id=wm.service_id
     where wm.user_id=u.id and wg.user_id=auth.uid() and wg.can_manage
    )
   )
 ), assignments as (
  select p.id,p.assignee_id,p.status,p.assigned_at,p.completed_at,p.target_minutes,p.effort_points,p.accountable_seconds,p.metrics_quality,p.performance_eligible,
   case when p.status in('offered','working','revision') then p.accountable_seconds+greatest(0,extract(epoch from (now()-p.state_started_at))::bigint) else p.accountable_seconds end as current_seconds
  from public.work_parts p join public.work_requests r on r.id=p.request_id
  where p.assigned_at>=now()-make_interval(days=>period_days) and not r.test
   and (p.assignee_id=auth.uid() or role_name='super_admin' or role_name='admin' and provision_private.work_manage(p.service_id))
 ), aggregates as (
  select pe.id,pe.name,pe.capacity,
   count(a.id)::integer as assigned_count,
   count(a.id) filter(where a.completed_at is not null and a.performance_eligible)::integer as completed_count,
   count(a.id) filter(where a.completed_at is null)::integer as open_count,
   count(a.id) filter(where a.metrics_quality='estimated' and a.completed_at is not null and a.performance_eligible)::integer as estimated_count,
   coalesce(sum(a.effort_points) filter(where a.performance_eligible),0)::numeric as assigned_points,
   coalesce(sum(a.effort_points) filter(where a.completed_at is not null and a.performance_eligible),0)::numeric as completed_points,
   coalesce(round((sum(a.effort_points*least(1::numeric,a.target_minutes::numeric/greatest(1::numeric,a.current_seconds::numeric/60)))
    filter(where a.completed_at is not null and a.performance_eligible)
    /nullif(sum(a.effort_points) filter(where a.completed_at is not null and a.performance_eligible),0)*100)::numeric,0),0)::integer as speed_score,
   coalesce(round((avg(a.current_seconds/3600.0) filter(where a.completed_at is not null and a.performance_eligible))::numeric,1),0)::numeric as average_active_hours
  from people pe left join assignments a on a.assignee_id=pe.id group by pe.id,pe.name,pe.capacity
 ), scored as (
  select a.*,
   coalesce(least(100,round(100*a.completed_points/nullif(least(a.assigned_points,greatest(10::numeric,a.capacity*5::numeric*(period_days/30.0))),0),0))::integer,0) as volume_score
  from aggregates a
 ), rows as (
  select s.*,
   (s.completed_count<5 or s.completed_points<10) as insufficient_data,
   case when s.completed_count<5 or s.completed_points<10 then null
    else round(s.speed_score*.65+s.volume_score*.35)::integer end as performance_score
  from scored s
 )
 select jsonb_build_object(
  'period_days',period_days,
  'generated_at',now(),
  'summary',jsonb_build_object(
   'people',count(*),
   'completed',coalesce(sum(completed_count),0),
   'active',coalesce(sum(open_count),0),
   'average_score',round(avg(performance_score) filter(where not insufficient_data),0)
  ),
  'people',coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'name',name,'assigned_count',assigned_count,'completed_count',completed_count,'open_count',open_count,
   'assigned_points',assigned_points,'completed_points',completed_points,'speed_score',speed_score,'volume_score',volume_score,
   'performance_score',performance_score,'average_active_hours',average_active_hours,'insufficient_data',insufficient_data,
   'estimated_count',estimated_count
  ) order by name),'[]'::jsonb)
 ) into result from rows;
 return result;
end;
$$;
revoke all on function public.work_employee_performance(integer) from public,anon;
grant execute on function public.work_employee_performance(integer) to authenticated;

-- Channel preferences affect outbound WhatsApp only and never hide in-app events
create table if not exists public.work_notification_preferences(
 user_id uuid primary key references auth.users(id) on delete cascade,
 whatsapp_enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
create index if not exists work_notifications_recipient_unread
on public.work_notifications(recipient) where read_at is null;
alter table public.work_notification_preferences enable row level security;
revoke all on public.work_notification_preferences from public,anon,authenticated;
grant select(user_id,whatsapp_enabled,updated_at) on public.work_notification_preferences to authenticated;
grant all on public.work_notification_preferences to service_role;
drop policy if exists work_notification_preferences_read on public.work_notification_preferences;
create policy work_notification_preferences_read on public.work_notification_preferences for select to authenticated
using(provision_private.account_ready() and user_id=auth.uid());

create or replace function public.work_notification_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object('whatsapp_enabled',coalesce((select whatsapp_enabled from public.work_notification_preferences where user_id=auth.uid()),true));
end;
$$;
create or replace function public.work_notification_settings(p_whatsapp_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or p_whatsapp_enabled is null then raise exception 'forbidden' using errcode='42501'; end if;
 insert into public.work_notification_preferences(user_id,whatsapp_enabled,updated_at)
 values(auth.uid(),p_whatsapp_enabled,now())
 on conflict(user_id) do update set whatsapp_enabled=excluded.whatsapp_enabled,updated_at=now();
 if not p_whatsapp_enabled then
  update public.work_notifications set whatsapp='suppressed',last_error='user_channel_disabled'
  where recipient=auth.uid() and whatsapp in('pending','failed','unknown');
 end if;
 return jsonb_build_object('whatsapp_enabled',p_whatsapp_enabled);
end;
$$;
create or replace function public.work_mark_notifications_read()
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 update public.work_notifications set read_at=now() where recipient=auth.uid() and read_at is null;
 get diagnostics changed=row_count;
 return changed;
end;
$$;
revoke all on function public.work_notification_settings() from public,anon;
revoke all on function public.work_notification_settings(boolean) from public,anon;
revoke all on function public.work_mark_notifications_read() from public,anon;
grant execute on function public.work_notification_settings() to authenticated;
grant execute on function public.work_notification_settings(boolean) to authenticated;
grant execute on function public.work_mark_notifications_read() to authenticated;

create or replace function provision_private.work_notification_preference_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.whatsapp in('pending','failed','unknown','sending')
  and coalesce((select not whatsapp_enabled from public.work_notification_preferences where user_id=new.recipient),false) then
  new.whatsapp='suppressed';
  new.last_error='user_channel_disabled';
 end if;
 return new;
end;
$$;
revoke all on function provision_private.work_notification_preference_guard() from public,anon,authenticated;
drop trigger if exists work_notification_preference_guard on public.work_notifications;
create trigger work_notification_preference_guard before insert or update of whatsapp,recipient on public.work_notifications
for each row execute function provision_private.work_notification_preference_guard();

create or replace function public.work_notifications_page(p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_page integer:=least(greatest(coalesce(p_page,0),0),10000);
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from(
   select id,request_id,message,created_at,read_at,whatsapp
   from public.work_notifications where recipient=auth.uid()
   order by created_at desc limit 40 offset safe_page*40
  )x),
  'unread_count',(select count(*) from public.work_notifications where recipient=auth.uid() and read_at is null)
 );
end;
$$;
revoke all on function public.work_notifications_page(integer) from public,anon;
grant execute on function public.work_notifications_page(integer) to authenticated;

-- Realtime consumers listen to this minimal signal surface then refresh through the guarded RPC
create table if not exists public.work_notification_signals(
 notification_id uuid primary key references public.work_notifications(id) on delete cascade,
 recipient uuid not null references auth.users(id) on delete cascade,
 request_id uuid references public.work_requests(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists work_notification_signals_recipient
on public.work_notification_signals(recipient,created_at desc);
alter table public.work_notification_signals enable row level security;
alter table public.work_notification_signals replica identity full;
revoke all on public.work_notification_signals from public,anon,authenticated;
grant select(notification_id,recipient,request_id,created_at) on public.work_notification_signals to authenticated;
grant all on public.work_notification_signals to service_role;
drop policy if exists work_notification_signals_read on public.work_notification_signals;
create policy work_notification_signals_read on public.work_notification_signals for select to authenticated
using(provision_private.account_ready() and recipient=auth.uid());

create or replace function provision_private.work_notification_signal()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.work_notification_signals(notification_id,recipient,request_id,created_at)
 values(new.id,new.recipient,new.request_id,now())
 on conflict(notification_id) do update
 set recipient=excluded.recipient,request_id=excluded.request_id,created_at=excluded.created_at;
 return new;
end;
$$;
revoke all on function provision_private.work_notification_signal() from public,anon,authenticated;
drop trigger if exists work_notification_signal on public.work_notifications;
create trigger work_notification_signal after insert or update of read_at,whatsapp,recipient,request_id on public.work_notifications
for each row execute function provision_private.work_notification_signal();

do $publication$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then
  if exists(
   select 1 from pg_publication publication
   join pg_publication_rel member on member.prpubid=publication.oid
   where publication.pubname='supabase_realtime' and member.prrelid='public.work_notifications'::regclass
  ) then
   alter publication supabase_realtime drop table public.work_notifications;
  end if;
  if not exists(
   select 1 from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public' and tablename='work_notification_signals'
  ) then
   alter publication supabase_realtime add table public.work_notification_signals;
  end if;
 end if;
end;
$publication$;

-- A single explicit read surface replaces broad browser access to workflow tables
create or replace function public.work_workspace(p_page integer default 0,p_view text default 'mine',p_search text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare board jsonb; services jsonb; self_row jsonb; grants jsonb; staff jsonb:='[]'::jsonb;
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin') then raise exception 'forbidden' using errcode='42501'; end if;
 board=public.work_board(p_view,left(coalesce(p_search,''),100),least(greatest(coalesce(p_page,0),0),100000));
 services=public.work_service_catalog(provision_private.work_manager());
 select to_jsonb(x) into self_row from(select capacity,coordinator from public.work_staff where user_id=auth.uid())x;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',g.user_id,'service_id',g.service_id,'can_manage',g.can_manage)),'[]'::jsonb) into grants
 from public.work_grants g where g.user_id=auth.uid() or provision_private.is_owner();
 if provision_private.work_manager() or provision_private.work_coordinator() then staff=public.work_directory(); end if;
 return board||jsonb_build_object('services',services,'self',self_row,'grants',grants,'staff',staff,'coordinator',coalesce((self_row->>'coordinator')::boolean,false));
end;
$$;
revoke all on function public.work_workspace(integer,text,text) from public,anon;
grant execute on function public.work_workspace(integer,text,text) to authenticated;

create or replace function public.work_request_snapshot(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.work_requests;
begin
 select * into item from public.work_requests where id=p_request;
 if item.id is null or not provision_private.work_read(item.id) then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'id',item.id,'number',item.number,'title',item.title,'brief',item.brief,'service_id',item.service_id,'requested_service_id',item.requested_service_id,
  'specifications',item.specifications,'status',item.status,'priority',item.priority,'requested_due_at',item.requested_due_at,
  'received_at',item.received_at,'version',item.version,'created_at',item.created_at,'updated_at',item.updated_at
 );
end;
$$;
revoke all on function public.work_request_snapshot(uuid) from public,anon;
grant execute on function public.work_request_snapshot(uuid) to authenticated;

create or replace function public.work_request_detail(p_request uuid,p_management boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text:=provision_private.work_role(); request_row jsonb; events jsonb; files jsonb; deliveries jsonb; dependencies jsonb:='[]'::jsonb; routes jsonb; parts jsonb; audit jsonb:='[]'::jsonb;
begin
 if not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501'; end if;
 request_row=public.work_request_snapshot(p_request);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'part_id',e.part_id,'kind',e.kind,'note',e.note,'created_at',e.created_at) order by e.id desc),'[]'::jsonb) into events
 from public.work_events e where e.request_id=p_request and (
  provision_private.work_manager() or provision_private.work_coordinator() or e.actor=auth.uid()
  or role_name='client' and e.client_visible
  or e.part_id is not null and exists(select 1 from public.work_parts mine where mine.id=e.part_id and mine.assignee_id=auth.uid())
 );
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'object_path',a.object_path,'filename',a.filename,'created_at',a.created_at) order by a.created_at),'[]'::jsonb) into files
 from public.work_attachments a where a.request_id=p_request;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',d.id,'request_id',d.request_id,'part_id',d.part_id,'object_path',d.object_path,'filename',d.filename,
  'note',d.note,'status',d.status,'feedback',d.feedback,'annotation',d.annotation,'created_at',d.created_at,
  'received_at',d.received_at,'released_at',d.released_at,'internal_shared_at',d.internal_shared_at,'batch_id',d.batch_id
 ) order by d.created_at desc),'[]'::jsonb) into deliveries
  from public.work_deliveries d where d.request_id=p_request and (
   (role_name='client' and d.released_at is not null) or (role_name<>'client' and provision_private.work_file_read(d.object_path))
 );
 if role_name<>'client' then
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'part_id',d.part_id,'upstream_id',d.upstream_id,'reason',d.reason,'status',d.status,'gate',d.gate)),'[]'::jsonb) into dependencies
  from public.work_dependencies d where d.request_id=p_request and (provision_private.work_part_read(d.part_id) or provision_private.work_part_read(d.upstream_id));
 end if;
 routes=public.work_routes(p_request);
 if role_name='client' then
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'service_id',p.service_id,'status',p.status,'due_at',p.due_at,'accepted_at',p.accepted_at,'created_at',p.created_at,'forwarded_to',p.forwarded_to,'forwarded_at',p.forwarded_at,'route_position',p.route_position) order by p.route_position),'[]'::jsonb) into parts
  from public.work_parts p where p.request_id=p_request;
 else
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'request_id',p.request_id,'service_id',p.service_id,'assignee_id',p.assignee_id,'scope',p.scope,'status',p.status,
   'priority',p.priority,'due_at',p.due_at,'accepted_at',p.accepted_at,'created_at',p.created_at,'forwarded_to',p.forwarded_to,
   'forwarded_at',p.forwarded_at,'route_position',p.route_position,'target_minutes',p.target_minutes,'effort_points',p.effort_points,
   'completed_at',p.completed_at,'performance_eligible',p.performance_eligible
  ) order by p.route_position),'[]'::jsonb) into parts
  from public.work_parts p where p.request_id=p_request and (provision_private.work_manager() or provision_private.work_coordinator() or p.assignee_id=auth.uid());
 end if;
 if p_management and provision_private.work_manager() then audit=public.work_audit(p_request); end if;
 return jsonb_build_object('request',request_row,'events',events,'files',files,'deliveries',deliveries,'dependencies',dependencies,'routes',routes,'parts',parts,'audit',audit);
end;
$$;
revoke all on function public.work_request_detail(uuid,boolean) from public,anon;
grant execute on function public.work_request_detail(uuid,boolean) to authenticated;

create or replace function public.work_file_receipt(p_action text,p_path text)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare item_id uuid; request_id uuid;
begin
 if p_action='deliver' then select d.id,d.request_id into item_id,request_id from public.work_deliveries d where d.object_path=p_path;
 elsif p_action='attach' then select a.id,a.request_id into item_id,request_id from public.work_attachments a where a.object_path=p_path;
 else raise exception 'invalid_action'; end if;
 if item_id is null then return null; end if;
 if not provision_private.work_read(request_id) then raise exception 'forbidden' using errcode='42501'; end if;
 return item_id;
end;
$$;
revoke all on function public.work_file_receipt(text,text) from public,anon;
grant execute on function public.work_file_receipt(text,text) to authenticated;

-- Browser reads use explicit RPC surfaces while Realtime receives only refresh signals
revoke select on public.work_requests,public.work_parts,public.work_dependencies,public.work_deliveries,public.work_attachments,public.work_escalations,public.work_events from authenticated;
revoke select on public.work_notifications from authenticated;

notify pgrst,'reload schema';
commit;
