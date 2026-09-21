-- Save employee routing membership and workload settings atomically
create or replace function public.work_staff_settings_save(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 target uuid;
 selected uuid[];
 expected uuid[];
 current_services uuid[];
begin
 if not coalesce(provision_private.is_owner(),false) then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p) is distinct from 'object'
  or jsonb_typeof(p->'services') is distinct from 'array'
  or jsonb_typeof(p->'expected_services') is distinct from 'array'
 then raise exception 'invalid_departments'; end if;
 target=(p->>'user_id')::uuid;
 if not exists(select 1 from auth.users where id=target and raw_app_meta_data->>'role'='employee'
  and not coalesce(is_anonymous,false) and provision_private.account_available(id))
 then raise exception 'invalid_staff'; end if;
 select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}'::uuid[]) into selected from jsonb_array_elements_text(p->'services');
 select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}'::uuid[]) into expected from jsonb_array_elements_text(p->'expected_services');
 -- Serialize against department edits before reading the membership snapshot
 perform 1 from public.work_services
 where id=any(selected||expected) order by id for update;
 select coalesce(array_agg(service_id order by service_id),'{}'::uuid[]) into current_services
 from public.work_memberships where user_id=target;
 if current_services is distinct from expected then raise exception 'department_version_conflict'; end if;
 if exists(select 1 from unnest(selected) id where not exists(
  select 1 from public.work_services s where s.id=id and (s.active or s.id=any(current_services))
 )) then raise exception 'invalid_departments'; end if;
 if exists(select 1 from public.work_memberships where user_id=target and member_role='lead' and not(service_id=any(selected)))
 then raise exception 'department_lead_membership_required'; end if;
 perform public.work_setup('staff',p-array['services','expected_services']);
 delete from public.work_memberships where user_id=target and not(service_id=any(selected));
 insert into public.work_memberships(user_id,service_id,member_role)
 select target,id,'member' from unnest(selected) id on conflict(user_id,service_id) do nothing;
 -- Invalidate stale department editor snapshots when their team changes
 update public.work_services set version=version+1
 where (id=any(selected) and not(id=any(current_services)))
    or (id=any(current_services) and not(id=any(selected)));
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),'work_staff_departments',jsonb_build_object('user_id',target,'before',current_services,'services',selected));
 return jsonb_build_object('user_id',target,'services',selected);
end;
$$;
revoke all on function public.work_staff_settings_save(jsonb) from public,anon,authenticated;
grant execute on function public.work_staff_settings_save(jsonb) to authenticated;
notify pgrst,'reload schema';
