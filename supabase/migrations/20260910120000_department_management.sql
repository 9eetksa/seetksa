begin;

-- A service is the canonical department record used by routing and delivery
alter table public.work_services
 add column if not exists client_visible boolean not null default true,
 add column if not exists version integer not null default 1,
 add column if not exists updated_at timestamptz not null default now();

do $constraints$
begin
 if not exists(
  select 1 from pg_constraint
  where conname='work_services_version_positive'
   and conrelid='public.work_services'::regclass
 ) then
  alter table public.work_services
   add constraint work_services_version_positive check(version>0);
 end if;
end;
$constraints$;

create or replace function provision_private.work_service_version_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.version=old.version+1;
 new.updated_at=now();
 return new;
end;
$$;
revoke all on function provision_private.work_service_version_guard() from public,anon,authenticated;
drop trigger if exists work_service_version_guard on public.work_services;
create trigger work_service_version_guard
before update on public.work_services
for each row execute function provision_private.work_service_version_guard();

create table public.work_department_responsibilities(
 id uuid primary key default gen_random_uuid(),
 service_id uuid not null references public.work_services(id) on delete cascade,
 item text not null check(char_length(btrim(item)) between 2 and 500),
 sort_order integer not null check(sort_order between 0 and 1000),
 created_at timestamptz not null default now(),
 unique(service_id,sort_order)
);
create unique index work_department_responsibilities_item
on public.work_department_responsibilities(service_id,lower(btrim(item)));
create index work_department_responsibilities_order
on public.work_department_responsibilities(service_id,sort_order,id);

create table public.work_department_tasks(
 id uuid primary key default gen_random_uuid(),
 service_id uuid not null references public.work_services(id) on delete cascade,
 item text not null check(char_length(btrim(item)) between 2 and 300),
 sort_order integer not null check(sort_order between 0 and 1000),
 created_at timestamptz not null default now(),
 unique(service_id,sort_order)
);
create unique index work_department_tasks_item
on public.work_department_tasks(service_id,lower(btrim(item)));
create index work_department_tasks_order
on public.work_department_tasks(service_id,sort_order,id);

alter table public.work_department_responsibilities enable row level security;
alter table public.work_department_tasks enable row level security;
revoke all on public.work_department_responsibilities from public,anon,authenticated;
revoke all on public.work_department_tasks from public,anon,authenticated;
grant all on public.work_department_responsibilities to service_role;
grant all on public.work_department_tasks to service_role;

alter table public.work_memberships
 add column if not exists member_role text not null default 'member';
do $constraints$
begin
 if not exists(
  select 1 from pg_constraint
  where conname='work_memberships_member_role_check'
   and conrelid='public.work_memberships'::regclass
 ) then
  alter table public.work_memberships
   add constraint work_memberships_member_role_check
   check(member_role in('member','lead'));
 end if;
end;
$constraints$;
create unique index work_memberships_one_lead_per_department
on public.work_memberships(service_id) where member_role='lead';
create index work_memberships_department_role
on public.work_memberships(service_id,member_role,user_id);

-- Client rows remain limited to active departments explicitly published to them
drop policy if exists work_services_read on public.work_services;
create policy work_services_read on public.work_services for select to authenticated
using(
 provision_private.account_ready()
 and active
 and (provision_private.work_role()<>'client' or client_visible)
);

-- Keep the shielded catalog consistent with the direct RLS contract
create or replace function public.work_service_catalog(p_include_inactive boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role_name text:=provision_private.work_role();
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_include_inactive and not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501'; end if;
 return(select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'slug',s.slug,'category',s.category,'description',s.description,
  'icon',s.icon,'active',s.active,'client_visible',s.client_visible,
  'default_target_minutes',s.default_target_minutes,'default_effort_points',s.default_effort_points,
  'sort_order',s.sort_order,'version',s.version,'updated_at',s.updated_at
 ) order by s.sort_order,s.name),'[]'::jsonb)
 from public.work_services s
 where (s.active or p_include_inactive)
  and (role_name<>'client' or (s.active and s.client_visible)));
end;
$$;
revoke all on function public.work_service_catalog(boolean) from public,anon;
grant execute on function public.work_service_catalog(boolean) to authenticated;

-- Department writes must pass through the complete atomic department contract
revoke all on function public.work_service_save(jsonb) from public,anon,authenticated;

-- Only the owner can decide which administrators may manage departments
create or replace function public.platform_permissions(p_user uuid,p_permissions jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.is_owner() or p_user=auth.uid() then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_permissions)<>'array'
  or exists(
   select 1 from jsonb_array_elements_text(p_permissions) permission
   where permission not in('users.read','content.edit','appearance.edit','maintenance.manage','audit.read','departments.manage')
  ) then raise exception 'invalid_permissions'; end if;
 update auth.users
 set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('permissions',p_permissions)
 where id=p_user and raw_app_meta_data->>'role'='admin';
 if not found then raise exception 'invalid_admin'; end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),'permissions_change',jsonb_build_object('user',p_user,'permissions',p_permissions));
end;
$$;
revoke all on function public.platform_permissions(uuid,jsonb) from public,anon;
grant execute on function public.platform_permissions(uuid,jsonb) to authenticated;

-- Staff capacity and coordination updates never mutate department membership
create or replace function public.work_setup(action text,p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; s uuid;
begin
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 if action='staff' then
  u=(p->>'user_id')::uuid;
  if not exists(select 1 from auth.users where id=u and raw_app_meta_data->>'role' in('employee','admin','super_admin')) then raise exception 'invalid_staff'; end if;
  insert into public.work_staff(user_id,capacity,coordinator)
  values(u,(p->>'capacity')::int,coalesce((p->>'coordinator')::boolean,false))
  on conflict(user_id) do update set capacity=excluded.capacity,coordinator=excluded.coordinator;
 elsif action='grant' then
  u=(p->>'user_id')::uuid;
  s=(p->>'service_id')::uuid;
  if not exists(select 1 from auth.users where id=u and raw_app_meta_data->>'role'='admin') then raise exception 'invalid_admin'; end if;
  insert into public.work_grants(user_id,service_id,can_manage)
  values(u,s,(p->>'can_manage')::boolean)
  on conflict(user_id,service_id) do update set can_manage=excluded.can_manage;
 else
  raise exception 'invalid_action';
 end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),'work_'||action,p);
 return jsonb_build_object('id',s);
end;
$$;
revoke all on function public.work_setup(text,jsonb) from public,anon;
grant execute on function public.work_setup(text,jsonb) to authenticated;

-- Department editing is exposed as one bounded atomic operation
create or replace function public.work_department_save(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 target_id uuid;
 lead_id uuid;
 expected_version integer;
 current_version integer;
 saved_version integer;
 department_slug text;
 enabled boolean;
 published boolean;
 creating boolean;
begin
 if not coalesce(provision_private.allowed('departments.manage'),false)
 then raise exception 'forbidden' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>262144
  or p-array[
   'id','version','name','slug','category','description','icon','active','client_visible',
   'default_target_minutes','default_effort_points','sort_order','responsibilities','tasks',
   'member_ids','lead_user_id'
  ]<>'{}'::jsonb then raise exception 'invalid_department'; end if;

 if jsonb_typeof(p->'name') is distinct from 'string'
  or jsonb_typeof(p->'slug') is distinct from 'string'
  or jsonb_typeof(p->'category') is distinct from 'string'
  or jsonb_typeof(p->'description') is distinct from 'string'
  or jsonb_typeof(p->'icon') is distinct from 'string'
  or jsonb_typeof(p->'active') is distinct from 'boolean'
  or jsonb_typeof(p->'client_visible') is distinct from 'boolean'
  or jsonb_typeof(p->'default_target_minutes') is distinct from 'number'
  or jsonb_typeof(p->'default_effort_points') is distinct from 'number'
  or jsonb_typeof(p->'sort_order') is distinct from 'number'
  or jsonb_typeof(p->'responsibilities') is distinct from 'array'
  or jsonb_typeof(p->'tasks') is distinct from 'array'
  or jsonb_typeof(p->'member_ids') is distinct from 'array'
 then raise exception 'invalid_department'; end if;

 if (p ? 'id') and jsonb_typeof(p->'id') not in('string','null') then raise exception 'invalid_department'; end if;
 if (p ? 'version') and jsonb_typeof(p->'version') not in('number','null') then raise exception 'invalid_department'; end if;
 if (p ? 'lead_user_id') and jsonb_typeof(p->'lead_user_id') not in('string','null') then raise exception 'invalid_department'; end if;
 if nullif(p->>'id','') is not null
  and (p->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then raise exception 'invalid_department'; end if;
 if nullif(p->>'lead_user_id','') is not null
  and (p->>'lead_user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then raise exception 'invalid_department'; end if;

 target_id=nullif(p->>'id','')::uuid;
 lead_id=nullif(p->>'lead_user_id','')::uuid;
 department_slug=lower(btrim(p->>'slug'));
 enabled=(p->>'active')::boolean;
 published=(p->>'client_visible')::boolean;
 creating=target_id is null;

 if char_length(btrim(p->>'name')) not between 2 and 100
  or department_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  or char_length(department_slug)>90
  or char_length(btrim(p->>'category')) not between 2 and 80
  or char_length(btrim(p->>'description'))>600
  or (p->>'icon') !~ '^[a-z0-9-]{2,40}$'
  or (p->>'default_target_minutes') !~ '^[0-9]{2,6}$'
  or (p->>'default_effort_points') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
  or (p->>'sort_order') !~ '^[0-9]{1,5}$'
  or (p->>'default_target_minutes')::integer not between 30 and 525600
  or (p->>'default_effort_points')::numeric not between 0.5 and 100
  or (p->>'sort_order')::integer not between 0 and 10000
 then raise exception 'invalid_department'; end if;

 if jsonb_array_length(p->'responsibilities') not between 1 and 50
  or jsonb_array_length(p->'tasks') not between 1 and 80
  or jsonb_array_length(p->'member_ids') not between 1 and 200
  or lead_id is null
  or exists(
   select 1 from jsonb_array_elements(p->'responsibilities') item
   where jsonb_typeof(item)<>'string'
  )
  or exists(
   select 1 from jsonb_array_elements(p->'tasks') item
   where jsonb_typeof(item)<>'string'
  )
  or exists(
   select 1 from jsonb_array_elements(p->'member_ids') member_id
   where jsonb_typeof(member_id)<>'string'
  )
 then raise exception 'invalid_department'; end if;

 if exists(
  select 1 from jsonb_array_elements_text(p->'responsibilities') item
  where char_length(btrim(item)) not between 2 and 500
 ) or exists(
  select 1 from jsonb_array_elements_text(p->'tasks') item
  where char_length(btrim(item)) not between 2 and 300
 ) or exists(
  select 1 from jsonb_array_elements_text(p->'member_ids') member_id
  where member_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 ) then raise exception 'invalid_department'; end if;

 if (select count(*) from jsonb_array_elements_text(p->'responsibilities'))<>(
  select count(distinct lower(btrim(item))) from jsonb_array_elements_text(p->'responsibilities') item
 ) or (select count(*) from jsonb_array_elements_text(p->'tasks'))<>(
  select count(distinct lower(btrim(item))) from jsonb_array_elements_text(p->'tasks') item
 ) or (select count(*) from jsonb_array_elements_text(p->'member_ids'))<>(
  select count(distinct lower(member_id)) from jsonb_array_elements_text(p->'member_ids') member_id
 ) then raise exception 'duplicate_department_item'; end if;

 if not exists(
  select 1 from jsonb_array_elements_text(p->'member_ids') member_id
  where member_id::uuid=lead_id
 ) then raise exception 'lead_must_be_member'; end if;
 if (select count(*) from jsonb_array_elements_text(p->'member_ids'))<>(
  select count(*)
  from auth.users employee
  where employee.id in(select member_id::uuid from jsonb_array_elements_text(p->'member_ids') member_id)
   and employee.raw_app_meta_data->>'role'='employee'
   and coalesce(employee.raw_app_meta_data->>'must_change_password','false')<>'true'
   and not coalesce(employee.is_anonymous,false)
   and (employee.banned_until is null or employee.banned_until<now())
 ) then raise exception 'invalid_department_member'; end if;

 if creating then
  insert into public.work_services(
   name,slug,category,description,icon,active,client_visible,
   default_target_minutes,default_effort_points,sort_order
  ) values(
   btrim(p->>'name'),department_slug,btrim(p->>'category'),btrim(p->>'description'),p->>'icon',enabled,published,
   (p->>'default_target_minutes')::integer,(p->>'default_effort_points')::numeric,(p->>'sort_order')::integer
  ) returning id,version into target_id,saved_version;
 else
  if jsonb_typeof(p->'version') is distinct from 'number'
   or (p->>'version') !~ '^[1-9][0-9]{0,9}$'
   or (p->>'version')::numeric>2147483646
  then raise exception 'invalid_department'; end if;
  expected_version=(p->>'version')::integer;
  select service.version into current_version
  from public.work_services service where service.id=target_id for update;
  if current_version is null then raise exception 'invalid_department'; end if;
  if current_version<>expected_version then raise exception 'department_version_conflict'; end if;
  if not enabled and exists(
   select 1 from public.work_requests request
   where (request.service_id=target_id or request.requested_service_id=target_id)
    and request.status<>'completed'
   union all
   select 1 from public.work_parts part
   where part.service_id=target_id
    and part.status not in('approved','forwarded','internal_done')
  ) then raise exception 'department_has_open_work'; end if;
  update public.work_services service
  set name=btrim(p->>'name'),slug=department_slug,category=btrim(p->>'category'),
   description=btrim(p->>'description'),icon=p->>'icon',active=enabled,client_visible=published,
   default_target_minutes=(p->>'default_target_minutes')::integer,
   default_effort_points=(p->>'default_effort_points')::numeric,
   sort_order=(p->>'sort_order')::integer
  where service.id=target_id and service.version=expected_version
  returning service.version into saved_version;
  if saved_version is null then raise exception 'department_version_conflict'; end if;
 end if;

 delete from public.work_department_responsibilities where service_id=target_id;
 insert into public.work_department_responsibilities(service_id,item,sort_order)
 select target_id,btrim(value),ordinality::integer-1
 from jsonb_array_elements_text(p->'responsibilities') with ordinality as entry(value,ordinality);
 delete from public.work_department_tasks where service_id=target_id;
 insert into public.work_department_tasks(service_id,item,sort_order)
 select target_id,btrim(value),ordinality::integer-1
 from jsonb_array_elements_text(p->'tasks') with ordinality as entry(value,ordinality);

 insert into public.work_staff(user_id)
 select member_id::uuid from jsonb_array_elements_text(p->'member_ids') member_id
 on conflict(user_id) do nothing;
 update public.work_memberships set member_role='member'
 where service_id=target_id and member_role='lead';
 delete from public.work_memberships membership
 using auth.users employee
 where membership.service_id=target_id
  and employee.id=membership.user_id
  and coalesce(employee.raw_app_meta_data->>'role','') not in('admin','super_admin')
  and not exists(
   select 1 from jsonb_array_elements_text(p->'member_ids') member_id
   where member_id::uuid=membership.user_id
  );
 insert into public.work_memberships(user_id,service_id,member_role)
 select member_id::uuid,target_id,case when member_id::uuid=lead_id then 'lead' else 'member' end
 from jsonb_array_elements_text(p->'member_ids') member_id
 on conflict(user_id,service_id) do update set member_role=excluded.member_role;

 insert into provision_private.audit(actor,effective_user,action,details)
 values(
  auth.uid(),auth.uid(),case when creating then 'work_department_create' else 'work_department_update' end,
  jsonb_build_object(
   'id',target_id,'version',saved_version,'name',btrim(p->>'name'),'active',enabled,
   'client_visible',published,'member_count',jsonb_array_length(p->'member_ids'),'lead_user_id',lead_id,
   'responsibility_count',jsonb_array_length(p->'responsibilities'),'task_count',jsonb_array_length(p->'tasks')
  )
 );
 return jsonb_build_object('id',target_id,'version',saved_version);
exception
 when unique_violation then raise exception 'department_conflict' using errcode='23505';
end;
$$;
revoke all on function public.work_department_save(jsonb) from public,anon,authenticated;
grant execute on function public.work_department_save(jsonb) to authenticated;

-- The editor gets only the explicit department and employee projection it needs
create or replace function public.work_department_directory()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare departments jsonb; staff jsonb;
begin
 if not coalesce(provision_private.allowed('departments.manage'),false)
 then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',service.id,'name',service.name,'slug',service.slug,'category',service.category,
  'description',service.description,'icon',service.icon,'active',service.active,
  'client_visible',service.client_visible,'default_target_minutes',service.default_target_minutes,
  'default_effort_points',service.default_effort_points,'sort_order',service.sort_order,
  'version',service.version,'updated_at',service.updated_at,
  'responsibilities',(
   select coalesce(jsonb_agg(jsonb_build_object('id',item.id,'text',item.item,'sort_order',item.sort_order) order by item.sort_order,item.id),'[]'::jsonb)
   from public.work_department_responsibilities item where item.service_id=service.id
  ),
  'tasks',(
   select coalesce(jsonb_agg(jsonb_build_object('id',item.id,'text',item.item,'sort_order',item.sort_order) order by item.sort_order,item.id),'[]'::jsonb)
   from public.work_department_tasks item where item.service_id=service.id
  ),
  'members',(
   select coalesce(jsonb_agg(jsonb_build_object('user_id',membership.user_id,'member_role',membership.member_role) order by membership.member_role desc,membership.user_id),'[]'::jsonb)
   from public.work_memberships membership
   join auth.users employee on employee.id=membership.user_id
    and employee.raw_app_meta_data->>'role'='employee'
    and coalesce(employee.raw_app_meta_data->>'must_change_password','false')<>'true'
    and not coalesce(employee.is_anonymous,false)
    and (employee.banned_until is null or employee.banned_until<now())
   where membership.service_id=service.id
  )
 ) order by service.sort_order,service.name),'[]'::jsonb) into departments
 from public.work_services service;

 select coalesce(jsonb_agg(jsonb_build_object(
  'id',employee.id,
  'name',coalesce(nullif(btrim(profile.display_name),''),nullif(btrim(employee.raw_user_meta_data->>'display_name'),''),'موظف'),
  'role','employee','job_title',coalesce(nullif(btrim(employee.raw_app_meta_data->>'job_title'),''),''),
  'capacity',coalesce(staff_row.capacity,5),'coordinator',coalesce(staff_row.coordinator,false),
  'departments',(
   select coalesce(jsonb_agg(jsonb_build_object(
    'id',service.id,'name',service.name,'member_role',membership.member_role
   ) order by service.sort_order,service.name),'[]'::jsonb)
   from public.work_memberships membership
   join public.work_services service on service.id=membership.service_id
   where membership.user_id=employee.id
  ),
  'responsible_departments',(
   select coalesce(jsonb_agg(jsonb_build_object('id',service.id,'name',service.name) order by service.sort_order,service.name),'[]'::jsonb)
   from public.work_memberships membership
   join public.work_services service on service.id=membership.service_id
   where membership.user_id=employee.id and membership.member_role='lead'
  )
 ) order by coalesce(nullif(btrim(profile.display_name),''),nullif(btrim(employee.raw_user_meta_data->>'display_name'),''),'موظف')),'[]'::jsonb) into staff
 from auth.users employee
 left join public.account_profiles profile on profile.user_id=employee.id
 left join public.work_staff staff_row on staff_row.user_id=employee.id
 where employee.raw_app_meta_data->>'role'='employee'
  and coalesce(employee.raw_app_meta_data->>'must_change_password','false')<>'true'
  and not coalesce(employee.is_anonymous,false)
  and (employee.banned_until is null or employee.banned_until<now());
 return jsonb_build_object('departments',departments,'staff',staff);
end;
$$;
revoke all on function public.work_department_directory() from public,anon,authenticated;
grant execute on function public.work_department_directory() to authenticated;

-- Performance cards contain employee identity and department responsibility once per person
create or replace function public.work_employee_performance(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period_days integer:=least(greatest(coalesce(p_days,30),7),365); role_name text:=provision_private.work_role(); result jsonb;
begin
 if role_name not in('employee','admin','super_admin') or not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 with people as (
  select employee.id,
   coalesce(nullif(btrim(profile.display_name),''),nullif(btrim(employee.raw_user_meta_data->>'display_name'),''),'موظف') as name,
   coalesce(nullif(btrim(employee.raw_app_meta_data->>'job_title'),''),'') as job_title,
   coalesce(staff_row.capacity,5) as capacity,
   coalesce((
    select jsonb_agg(jsonb_build_object(
     'id',service.id,'name',service.name,'member_role',membership.member_role
    ) order by service.sort_order,service.name)
    from public.work_memberships membership
    join public.work_services service on service.id=membership.service_id
    where membership.user_id=employee.id
   ),'[]'::jsonb) as departments,
   coalesce((
    select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name) order by service.sort_order,service.name)
    from public.work_memberships membership
    join public.work_services service on service.id=membership.service_id
    where membership.user_id=employee.id and membership.member_role='lead'
   ),'[]'::jsonb) as responsible_departments
  from auth.users employee
  left join public.account_profiles profile on profile.user_id=employee.id
  left join public.work_staff staff_row on staff_row.user_id=employee.id
  where employee.raw_app_meta_data->>'role'='employee'
   and coalesce(employee.raw_app_meta_data->>'must_change_password','false')<>'true'
   and not coalesce(employee.is_anonymous,false)
   and (employee.banned_until is null or employee.banned_until<now())
   and (role_name in('admin','super_admin') or employee.id=auth.uid())
 ), assignments as (
  select part.id,part.assignee_id,part.status,part.assigned_at,part.completed_at,part.target_minutes,
   part.effort_points,part.accountable_seconds,part.metrics_quality,part.performance_eligible,
   case when part.status in('offered','working','revision')
    then part.accountable_seconds+greatest(0,extract(epoch from (now()-part.state_started_at))::bigint)
    else part.accountable_seconds end as current_seconds
  from public.work_parts part
  join public.work_requests request on request.id=part.request_id
  join people person on person.id=part.assignee_id
  where part.assigned_at>=now()-make_interval(days=>period_days) and not request.test
 ), aggregates as (
  select person.id,person.name,person.job_title,person.capacity,person.departments,person.responsible_departments,
   count(assignment.id)::integer as assigned_count,
   count(assignment.id) filter(where assignment.completed_at is not null and assignment.performance_eligible)::integer as completed_count,
   count(assignment.id) filter(where assignment.completed_at is null)::integer as open_count,
   count(assignment.id) filter(where assignment.metrics_quality='estimated' and assignment.completed_at is not null and assignment.performance_eligible)::integer as estimated_count,
   coalesce(sum(assignment.effort_points) filter(where assignment.performance_eligible),0)::numeric as assigned_points,
   coalesce(sum(assignment.effort_points) filter(where assignment.completed_at is not null and assignment.performance_eligible),0)::numeric as completed_points,
   coalesce(round((sum(assignment.effort_points*least(1::numeric,assignment.target_minutes::numeric/greatest(1::numeric,assignment.current_seconds::numeric/60)))
    filter(where assignment.completed_at is not null and assignment.performance_eligible)
    /nullif(sum(assignment.effort_points) filter(where assignment.completed_at is not null and assignment.performance_eligible),0)*100)::numeric,0),0)::integer as speed_score,
   coalesce(round((avg(assignment.current_seconds/3600.0) filter(where assignment.completed_at is not null and assignment.performance_eligible))::numeric,1),0)::numeric as average_active_hours
  from people person left join assignments assignment on assignment.assignee_id=person.id
  group by person.id,person.name,person.job_title,person.capacity,person.departments,person.responsible_departments
 ), scored as (
  select aggregate.*,
   coalesce(least(100,round(100*aggregate.completed_points/nullif(least(aggregate.assigned_points,greatest(10::numeric,aggregate.capacity*5::numeric*(period_days/30.0))),0),0))::integer,0) as volume_score
  from aggregates aggregate
 ), rows as (
  select scored.*,
   (scored.completed_count<5 or scored.completed_points<10) as insufficient_data,
   case when scored.completed_count<5 or scored.completed_points<10 then null
    else round(scored.speed_score*.65+scored.volume_score*.35)::integer end as performance_score
  from scored
 )
 select jsonb_build_object(
  'period_days',period_days,'generated_at',now(),
  'summary',jsonb_build_object(
   'people',count(*),'completed',coalesce(sum(completed_count),0),'active',coalesce(sum(open_count),0),
   'average_score',round(avg(performance_score) filter(where not insufficient_data),0)
  ),
  'people',coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'name',name,'role','employee','job_title',job_title,'departments',departments,
   'responsible_departments',responsible_departments,'assigned_count',assigned_count,
   'completed_count',completed_count,'open_count',open_count,'assigned_points',assigned_points,
   'completed_points',completed_points,'speed_score',speed_score,'volume_score',volume_score,
   'performance_score',performance_score,'average_active_hours',average_active_hours,
   'insufficient_data',insufficient_data,'estimated_count',estimated_count
  ) order by name),'[]'::jsonb)
 ) into result from rows;
 return result;
end;
$$;
revoke all on function public.work_employee_performance(integer) from public,anon;
grant execute on function public.work_employee_performance(integer) to authenticated;

notify pgrst,'reload schema';
commit;
