-- Existing administrators receive these capabilities once as requested
-- Later owner revocation remains authoritative and new accounts keep their selected grants
with upgraded as (
 update auth.users account
 set raw_app_meta_data=coalesce(account.raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('permissions',(
  select jsonb_agg(permission order by permission)
  from (
   select distinct permission
   from jsonb_array_elements_text(
    case when jsonb_typeof(account.raw_app_meta_data->'permissions')='array'
     then account.raw_app_meta_data->'permissions' else '[]'::jsonb end
    ||'["services.manage","departments.manage"]'::jsonb
   ) permission
  ) selected
 ))
 where account.raw_app_meta_data->>'role'='admin'
 returning account.id,account.raw_app_meta_data->'permissions' as permissions
)
insert into provision_private.audit(actor,effective_user,action,details)
select null,id,'admin_catalog_permissions_enabled',jsonb_build_object('permissions',permissions)
from upgraded;

create or replace function public.platform_permissions(p_user uuid,p_permissions jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare permissions jsonb;
begin
 if not provision_private.is_owner() or p_user=auth.uid()
 then raise exception 'forbidden' using errcode='42501'; end if;
 if p_permissions is null or jsonb_typeof(p_permissions) is distinct from 'array'
  or jsonb_array_length(p_permissions)>20
 then raise exception 'invalid_permissions'; end if;
 if exists(select 1 from jsonb_array_elements(p_permissions) item where jsonb_typeof(item)<>'string')
  or exists(
   select 1 from jsonb_array_elements_text(p_permissions) permission
   where permission not in('users.read','services.manage','departments.manage','content.edit','appearance.edit','maintenance.manage','audit.read')
  ) then raise exception 'invalid_permissions'; end if;
 select coalesce(jsonb_agg(permission order by permission),'[]'::jsonb) into permissions
 from(select distinct permission from jsonb_array_elements_text(p_permissions) permission) selected;
 update auth.users
 set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('permissions',permissions)
 where id=p_user and raw_app_meta_data->>'role'='admin';
 if not found then raise exception 'invalid_admin'; end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),'permissions_change',jsonb_build_object('user',p_user,'permissions',permissions));
end;
$$;
revoke all on function public.platform_permissions(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.platform_permissions(uuid,jsonb) to authenticated;

-- Inactive catalog rows are management data and use current server permissions
create or replace function public.work_service_catalog(p_include_inactive boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare role_name text:=provision_private.work_role();
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_include_inactive and not (
  provision_private.allowed('services.manage') or provision_private.allowed('departments.manage')
 ) then raise exception 'forbidden' using errcode='42501'; end if;
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
revoke all on function public.work_service_catalog(boolean) from public,anon,authenticated;
grant execute on function public.work_service_catalog(boolean) to authenticated;

-- Preserve the operational workspace for administrators whose catalog grant is revoked
do $workspace$
declare definition text;
begin
 select pg_get_functiondef('public.work_workspace(integer,text,text)'::regprocedure) into definition;
 if position('services=public.work_service_catalog(provision_private.work_manager());' in definition)=0
 then raise exception 'work_workspace_catalog_contract_changed'; end if;
 definition=replace(definition,
  'services=public.work_service_catalog(provision_private.work_manager());',
  'services=public.work_service_catalog(provision_private.allowed(''services.manage'') or provision_private.allowed(''departments.manage''));');
 execute definition;
end;
$workspace$;

-- Catalog editing cannot change team membership or department responsibilities
-- A new catalog entry stays inactive until the department editor configures the team
create function public.work_catalog_service_save(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_id uuid; existing public.work_services; saved public.work_services;
 service_slug text; enabled boolean; creating boolean;
begin
 if not coalesce(provision_private.allowed('services.manage'),false)
 then raise exception 'forbidden' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>12000
  or p-array['id','version','name','slug','category','description','icon','active','client_visible',
   'default_target_minutes','default_effort_points','sort_order']<>'{}'::jsonb
 then raise exception 'invalid_service'; end if;
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
 then raise exception 'invalid_service'; end if;
 if (p ? 'id') and jsonb_typeof(p->'id') not in('string','null') then raise exception 'invalid_service'; end if;
 if nullif(p->>'id','') is not null
  and (p->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then raise exception 'invalid_service'; end if;
 target_id=nullif(p->>'id','')::uuid;
 creating=target_id is null;
 service_slug=lower(btrim(p->>'slug'));
 enabled=(p->>'active')::boolean;
 if char_length(btrim(p->>'name')) not between 2 and 100
  or service_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or char_length(service_slug)>90
  or char_length(btrim(p->>'category')) not between 2 and 80
  or char_length(btrim(p->>'description'))>600
  or (p->>'icon') !~ '^[a-z0-9-]{2,40}$'
  or (p->>'default_target_minutes') !~ '^[0-9]{2,6}$'
  or (p->>'default_effort_points') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
  or (p->>'sort_order') !~ '^[0-9]{1,5}$'
 then raise exception 'invalid_service'; end if;
 if (p->>'default_target_minutes')::integer not between 30 and 525600
  or (p->>'default_effort_points')::numeric not between 0.5 and 100
  or (p->>'sort_order')::integer not between 0 and 10000
 then raise exception 'invalid_service'; end if;
 if creating then
  if enabled then raise exception 'service_department_setup_required'; end if;
  insert into public.work_services(name,slug,category,description,icon,active,client_visible,
   default_target_minutes,default_effort_points,sort_order)
  values(btrim(p->>'name'),service_slug,btrim(p->>'category'),btrim(p->>'description'),p->>'icon',false,
   (p->>'client_visible')::boolean,(p->>'default_target_minutes')::integer,
   (p->>'default_effort_points')::numeric,(p->>'sort_order')::integer)
  returning * into saved;
 else
  if jsonb_typeof(p->'version') is distinct from 'number' or (p->>'version') !~ '^[1-9][0-9]{0,9}$'
   or (p->>'version')::numeric>2147483646 then raise exception 'invalid_service'; end if;
  select * into existing from public.work_services where id=target_id for update;
  if not found then raise exception 'invalid_service'; end if;
  if existing.version<>(p->>'version')::integer then raise exception 'department_version_conflict'; end if;
  if enabled and not existing.active and (
   not exists(select 1 from public.work_department_responsibilities where service_id=target_id)
   or not exists(select 1 from public.work_department_tasks where service_id=target_id)
   or not exists(
    select 1 from public.work_memberships membership join auth.users employee on employee.id=membership.user_id
    where membership.service_id=target_id and membership.member_role='lead'
     and employee.raw_app_meta_data->>'role'='employee'
     and coalesce(employee.raw_app_meta_data->>'must_change_password','false')<>'true'
     and provision_private.account_available(employee.id)
   )
  ) then raise exception 'service_department_setup_required'; end if;
  if not enabled and exists(
   select 1 from public.work_requests request
   where (request.service_id=target_id or request.requested_service_id=target_id) and request.status<>'completed'
   union all
   select 1 from public.work_parts part where part.service_id=target_id
    and part.status not in('approved','forwarded','internal_done')
  ) then raise exception 'department_has_open_work'; end if;
  update public.work_services
  set name=btrim(p->>'name'),slug=service_slug,category=btrim(p->>'category'),description=btrim(p->>'description'),
   icon=p->>'icon',active=enabled,client_visible=(p->>'client_visible')::boolean,
   default_target_minutes=(p->>'default_target_minutes')::integer,
   default_effort_points=(p->>'default_effort_points')::numeric,sort_order=(p->>'sort_order')::integer
  where id=target_id and version=existing.version returning * into saved;
  if saved.id is null then raise exception 'department_version_conflict'; end if;
 end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),case when creating then 'work_catalog_service_create' else 'work_catalog_service_update' end,
  jsonb_build_object('id',saved.id,'version',saved.version,'name',saved.name,'active',saved.active));
 return jsonb_build_object('id',saved.id,'version',saved.version,'active',saved.active,
  'requires_department_setup',not saved.active and not exists(
   select 1 from public.work_memberships membership where membership.service_id=saved.id and membership.member_role='lead'
  ));
exception when unique_violation then raise exception 'department_conflict' using errcode='23505';
end;
$$;
revoke all on function public.work_catalog_service_save(jsonb) from public,anon,authenticated;
grant execute on function public.work_catalog_service_save(jsonb) to authenticated;

-- Keep the incomplete legacy mutation inaccessible
revoke all on function public.work_service_save(jsonb) from public,anon,authenticated;
-- Contact details stay in the permission-protected department editor
-- Direct department saves use the same lifecycle eligibility as the editor
do $department_members$
declare definition text;
begin
 select pg_get_functiondef('public.work_department_save(jsonb)'::regprocedure) into definition;
 if position('(employee.banned_until is null or employee.banned_until<now())' in definition)=0
 then raise exception 'work_department_member_contract_changed'; end if;
 definition=replace(definition,'(employee.banned_until is null or employee.banned_until<now())',
  'provision_private.account_available(employee.id)');
 execute definition;
end;
$department_members$;

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
    and provision_private.account_available(employee.id)
   where membership.service_id=service.id
  )
 ) order by service.sort_order,service.name),'[]'::jsonb) into departments
 from public.work_services service;

 select coalesce(jsonb_agg(jsonb_build_object(
  'id',employee.id,
  'email',coalesce(employee.email,''),
  'phone',coalesce(nullif(btrim(profile.phone),''),employee.phone,''),
  'created_at',employee.created_at,'last_sign_in_at',employee.last_sign_in_at,
  'open_tasks',(select count(*) from public.work_parts part where part.assignee_id=employee.id and part.status not in('approved','forwarded','internal_done')), 
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
  and provision_private.account_available(employee.id);
 return jsonb_build_object('departments',departments,'staff',staff);
end;
$$;
revoke all on function public.work_department_directory() from public,anon,authenticated;
grant execute on function public.work_department_directory() to authenticated;

notify pgrst,'reload schema';
