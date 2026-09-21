begin;

-- The existing (service_id,member_role,user_id) index supports multiple leads
-- Memberships remain unique per employee and department with unchanged RLS
drop index public.work_memberships_one_lead_per_department;

create function public.work_department_team_save(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 target_id uuid;
 members uuid[];
 leads uuid[];
 saved_version integer;
 current_version integer;
 creating boolean;
begin
 if not provision_private.account_ready()
  or not coalesce(provision_private.allowed('departments.manage'),false)
 then raise exception 'forbidden' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>32768
  or p-array['id','version','name','slug','member_ids','lead_user_ids']<>'{}'::jsonb
  or jsonb_typeof(p->'member_ids') is distinct from 'array'
  or jsonb_typeof(p->'lead_user_ids') is distinct from 'array'
 then raise exception 'invalid_department'; end if;
 if jsonb_array_length(p->'member_ids') not between 1 and 200
  or jsonb_array_length(p->'lead_user_ids') not between 1 and 200
  or exists(select 1 from jsonb_array_elements((p->'member_ids')||(p->'lead_user_ids')) item
   where jsonb_typeof(item)<>'string')
 then raise exception 'invalid_department'; end if;
 if exists(select 1 from jsonb_array_elements_text((p->'member_ids')||(p->'lead_user_ids')) item
  where item !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 then raise exception 'invalid_department_member'; end if;
 select array_agg(distinct item::uuid order by item::uuid) into members from jsonb_array_elements_text(p->'member_ids') item;
 select array_agg(distinct item::uuid order by item::uuid) into leads from jsonb_array_elements_text(p->'lead_user_ids') item;
 if cardinality(members)<>jsonb_array_length(p->'member_ids')
  or cardinality(leads)<>jsonb_array_length(p->'lead_user_ids')
 then raise exception 'duplicate_department_item'; end if;
 if not leads<@members then raise exception 'lead_must_be_member'; end if;
 if (p ? 'id') and jsonb_typeof(p->'id') not in ('string','null') then raise exception 'invalid_department'; end if;
 creating=not(p ? 'id') or p->'id'='null'::jsonb;
 if creating then
  if jsonb_typeof(p->'name') is distinct from 'string'
   or char_length(btrim(p->>'name')) not between 2 and 100
   or jsonb_typeof(p->'slug') is distinct from 'string'
   or p->>'slug' !~ '^department-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or ((p ? 'version') and p->'version'<>'null'::jsonb)
  then raise exception 'invalid_department'; end if;
  insert into public.work_services(name,slug,category,description,icon,active,client_visible,default_target_minutes,default_effort_points,sort_order)
  values(btrim(p->>'name'),p->>'slug','أقسام برو فيجن','','building-2',true,true,4320,5,100)
  returning id,version into target_id,saved_version;
 else
  if p->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or p ? 'name' or p ? 'slug'
   or jsonb_typeof(p->'version') is distinct from 'number'
   or p->>'version' !~ '^[1-9][0-9]{0,9}$'
  then raise exception 'invalid_department'; end if;
  target_id=(p->>'id')::uuid;
  select version into current_version from public.work_services where id=target_id for update;
  if current_version is null then raise exception 'invalid_department'; end if;
  if current_version::numeric<>(p->>'version')::numeric then raise exception 'department_version_conflict'; end if;
 end if;

 -- Serialize department edits with account membership edits and output routing
 -- Recheck eligibility after acquiring the department lock
 if cardinality(members)<>(select count(*) from auth.users employee
  where employee.id=any(members) and employee.raw_app_meta_data->>'role'='employee'
   and coalesce(employee.raw_app_meta_data->>'must_change_password','false')<>'true'
   and not coalesce(employee.is_anonymous,false) and provision_private.account_available(employee.id))
 then raise exception 'invalid_department_member'; end if;
 insert into public.work_staff(user_id) select unnest(members) on conflict(user_id) do nothing;
 delete from public.work_memberships membership using auth.users employee
 where membership.service_id=target_id and membership.user_id=employee.id
  and coalesce(employee.raw_app_meta_data->>'role','') not in ('admin','super_admin')
  and not membership.user_id=any(members);
 insert into public.work_memberships(user_id,service_id,member_role)
 select member_id,target_id,case when member_id=any(leads) then 'lead' else 'member' end from unnest(members) member_id
 on conflict(user_id,service_id) do update set member_role=excluded.member_role;
 if not creating then
  -- The version guard increments the snapshot without changing department settings
  update public.work_services set updated_at=now() where id=target_id returning version into saved_version;
 end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),case when creating then 'work_department_create' else 'work_department_team_update' end,
  jsonb_build_object('id',target_id,'version',saved_version,'member_ids',to_jsonb(members),'lead_user_ids',to_jsonb(leads)));
 return jsonb_build_object('id',target_id,'version',saved_version);
exception when unique_violation then raise exception 'department_conflict' using errcode='23505';
end;
$$;
revoke all on function public.work_department_team_save(jsonb) from public,anon,authenticated;
grant execute on function public.work_department_team_save(jsonb) to authenticated;

-- Old clients must not silently replace several leads with their scalar selection
do $migration$
declare body text; marker text;
begin
 body=pg_get_functiondef('public.work_department_save(jsonb)'::regprocedure);
 marker='if current_version<>expected_version then raise exception ''department_version_conflict''; end if;';
 if position(marker in body)=0 then raise exception 'department_save_shape_changed'; end if;
 body=replace(body,marker,marker||E'\n  if (select count(*) from public.work_memberships where service_id=target_id and member_role=''lead'')>1 then raise exception ''department_team_editor_required''; end if;');
 execute body;

 -- Catalog activation continues to require an eligible lead but no removed form fields
 body=pg_get_functiondef('public.work_catalog_service_save(jsonb)'::regprocedure);
 marker=E'not exists(select 1 from public.work_department_responsibilities where service_id=target_id)\n   or not exists(select 1 from public.work_department_tasks where service_id=target_id)\n   or not exists(';
 if position(marker in body)=0 then raise exception 'department_catalog_shape_changed'; end if;
 execute replace(body,marker,'not exists(');
end;
$migration$;

notify pgrst,'reload schema';
commit;
