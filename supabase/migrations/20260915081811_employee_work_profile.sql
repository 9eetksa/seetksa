-- Employee identity and routing changes share the existing Auth edit transaction
alter table public.work_staff add column employment_type text
 check (employment_type in ('regular','freelancer'));

create function public.work_employee_profile(p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(provision_private.is_owner(),false) then raise exception 'forbidden' using errcode='42501'; end if;
 select jsonb_build_object(
  'name',coalesce(u.raw_user_meta_data->>'display_name',''),
  'email',coalesce(u.email,''),'phone',coalesce(u.phone,''),'job_title',coalesce(u.raw_app_meta_data->>'job_title',''),
  'coordinator',coalesce(s.coordinator,false),'capacity',coalesce(s.capacity,5),'employment_type',s.employment_type,
  'services',coalesce((select jsonb_agg(m.service_id order by m.service_id) from public.work_memberships m where m.user_id=u.id),'[]'::jsonb),
  'lead_services',coalesce((select jsonb_agg(m.service_id order by m.service_id) from public.work_memberships m where m.user_id=u.id and m.member_role='lead'),'[]'::jsonb),
  'departments',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'active',d.active) order by d.name)
   from public.work_services d where d.active or exists(select 1 from public.work_memberships m where m.user_id=u.id and m.service_id=d.id)),'[]'::jsonb)
 ) into result from auth.users u left join public.work_staff s on s.user_id=u.id
 where u.id=p_user and u.raw_app_meta_data->>'role'='employee' and not coalesce(u.is_anonymous,false)
 and provision_private.account_available(u.id);
 if result is null then raise exception 'invalid_staff'; end if;
 return result;
end;
$$;
revoke all on function public.work_employee_profile(uuid) from public,anon,authenticated;
grant execute on function public.work_employee_profile(uuid) to authenticated;

create function provision_private.apply_employee_work_profile(target uuid,actor_id uuid,p jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
 selected uuid[]; expected uuid[]; current_services uuid[];
 current_capacity integer; current_coordinator boolean; current_employment_type text;
begin
 if jsonb_typeof(p) is distinct from 'object'
  or jsonb_typeof(p->'services') is distinct from 'array'
  or jsonb_typeof(p->'expected_services') is distinct from 'array'
  or jsonb_typeof(p->'coordinator') is distinct from 'boolean'
  or jsonb_typeof(p->'expected_coordinator') is distinct from 'boolean'
  or jsonb_typeof(p->'capacity') is distinct from 'number'
  or jsonb_typeof(p->'expected_capacity') is distinct from 'number'
  or p->>'employment_type' is null or p->>'employment_type' not in ('regular','freelancer')
  or not (p ? 'expected_employment_type')
  or (p->>'capacity')::numeric not between 1 and 100
  or (p->>'capacity')::numeric <> trunc((p->>'capacity')::numeric)
 then raise exception 'invalid_work_profile'; end if;
 if not exists(select 1 from auth.users where id=target and raw_app_meta_data->>'role'='employee'
  and not coalesce(is_anonymous,false) and provision_private.account_available(id))
 then raise exception 'invalid_staff'; end if;
 perform 1 from auth.users where id=target for update;
 select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}'::uuid[]) into selected from jsonb_array_elements_text(p->'services');
 select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}'::uuid[]) into expected from jsonb_array_elements_text(p->'expected_services');
 perform 1 from public.work_services where id=any(selected||expected) order by id for update;
 perform 1 from public.work_staff where user_id=target for update;
 select coalesce(s.capacity,5),coalesce(s.coordinator,false),s.employment_type
 into current_capacity,current_coordinator,current_employment_type
 from auth.users u left join public.work_staff s on s.user_id=u.id where u.id=target;
 select coalesce(array_agg(service_id order by service_id),'{}'::uuid[]) into current_services
 from public.work_memberships where user_id=target;
 if current_services is distinct from expected
  or current_capacity is distinct from (p->>'expected_capacity')::numeric
  or current_coordinator is distinct from (p->>'expected_coordinator')::boolean
  or current_employment_type is distinct from p->>'expected_employment_type'
 then raise exception 'employee_work_profile_conflict'; end if;
 if exists(select 1 from unnest(selected) chosen(service_id) where not exists(
  select 1 from public.work_services s where s.id=chosen.service_id and (s.active or s.id=any(current_services))))
 then raise exception 'invalid_departments'; end if;
 if exists(select 1 from public.work_memberships where user_id=target and member_role='lead' and not(service_id=any(selected)))
 then raise exception 'department_lead_membership_required'; end if;
 insert into public.work_staff(user_id,capacity,coordinator,employment_type)
 values(target,(p->>'capacity')::integer,(p->>'coordinator')::boolean,p->>'employment_type')
 on conflict(user_id) do update set capacity=excluded.capacity,coordinator=excluded.coordinator,employment_type=excluded.employment_type;
 delete from public.work_memberships where user_id=target and not(service_id=any(selected));
 insert into public.work_memberships(user_id,service_id,member_role)
 select target,id,'member' from unnest(selected) id on conflict(user_id,service_id) do nothing;
 update public.work_services set version=version+1
 where (id=any(selected) and not(id=any(current_services))) or (id=any(current_services) and not(id=any(selected)));
 insert into provision_private.audit(actor,effective_user,action,details)
 values(actor_id,actor_id,'work_staff_profile',jsonb_build_object('user_id',target,'before_services',current_services,
  'services',selected,'coordinator',p->'coordinator','employment_type',p->'employment_type','capacity',p->'capacity'));
end;
$$;
revoke all on function provision_private.apply_employee_work_profile(uuid,uuid,jsonb) from public,anon,authenticated;

-- Patch only the verified receipt commit point preserving owner and lifecycle guards
do $migration$
declare body text; marker text = 'profile_name = trim(';
begin
 body=pg_get_functiondef('provision_private.commit_employee_profile_edit()'::regprocedure);
 if position(marker in body)=0 then raise exception 'employee_commit_shape_changed'; end if;
 body=replace(body,marker,E'if receipt ? ''work_profile'' then\n  perform provision_private.apply_employee_work_profile(final_user.id,actor_id,receipt->''work_profile'');\n end if;\n '||marker);
 execute body;
end;
$migration$;

-- Add identity metadata without changing score calculations or employee read scope
do $migration$
declare body text;
begin
 body=pg_get_functiondef('public.work_employee_performance(integer)'::regprocedure);
 if position('coalesce(staff_row.capacity,5) as capacity,' in body)=0
  or position('person.capacity,person.departments,person.responsible_departments' in body)=0
  or position('''job_title'',job_title,' in body)=0 then raise exception 'performance_shape_changed'; end if;
 body=replace(body,'coalesce(staff_row.capacity,5) as capacity,','coalesce(staff_row.capacity,5) as capacity, staff_row.employment_type, coalesce(staff_row.coordinator,false) as coordinator,');
 body=replace(body,'person.capacity,person.departments,person.responsible_departments','person.capacity,person.departments,person.responsible_departments,person.employment_type,person.coordinator');
 body=replace(body,'''job_title'',job_title,','''job_title'',job_title,''employment_type'',employment_type,''coordinator'',coordinator,');
 execute body;
 body=pg_get_functiondef('public.work_team_overview(date,date)'::regprocedure);
 if position('provision_private.work_role() is distinct from ''super_admin''' in body)=0
  or position('coalesce(staff.capacity,5) as capacity,' in body)=0
  or position('''job_title'',job_title,' in body)=0 then raise exception 'team_overview_shape_changed'; end if;
 body=replace(body,'provision_private.work_role() is distinct from ''super_admin''','coalesce(provision_private.work_role(),'''') not in (''admin'',''super_admin'')');
 body=replace(body,'coalesce(staff.capacity,5) as capacity,','coalesce(staff.capacity,5) as capacity, staff.employment_type,');
 body=replace(body,'''job_title'',job_title,','''job_title'',job_title,''employment_type'',employment_type,');
 execute body;
end;
$migration$;
notify pgrst,'reload schema';
