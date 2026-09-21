begin;
do $$
declare
 owner_id uuid=gen_random_uuid(); employee_id uuid=gen_random_uuid(); coordinator_id uuid=gen_random_uuid();
 sid uuid; sess uuid; uid uuid; before_version integer; result jsonb;
begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 (owner_id,owner_id||'@example.invalid','{"role":"super_admin","portal_qa":true}','{}'),
 (employee_id,employee_id||'@example.invalid','{"role":"employee","portal_qa":true}','{}'),
 (coordinator_id,coordinator_id||'@example.invalid','{"role":"employee","portal_qa":true}','{}');
 foreach uid in array array[owner_id,employee_id,coordinator_id] loop
  sess=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at) values(sess,uid,now(),now());
  perform set_config('qa.claims_'||replace(uid::text,'-',''),jsonb_build_object('sub',uid,'role','authenticated','session_id',sess)::text,true);
 end loop;
 select id,version into sid,before_version from public.work_services where active order by id limit 1;
 perform set_config('request.jwt.claims',current_setting('qa.claims_'||replace(owner_id::text,'-','')),true);
 perform public.work_setup('staff',jsonb_build_object('user_id',coordinator_id,'capacity',5,'coordinator',true));
 perform public.work_staff_settings_save(jsonb_build_object('user_id',employee_id,'capacity',7,'coordinator',false,'services',jsonb_build_array(sid),'expected_services','[]'::jsonb));
 if not exists(select 1 from public.work_memberships where user_id=employee_id and service_id=sid)
  or not exists(select 1 from public.work_services where id=sid and version>before_version)
 then raise exception 'membership or department version not saved'; end if;
 if not public.work_settings_staff() @> jsonb_build_array(jsonb_build_object('id',employee_id,'services',jsonb_build_array(sid),'capacity',7))
 then raise exception 'settings directory missing saved departments'; end if;
 begin
  perform public.work_staff_settings_save(jsonb_build_object('user_id',employee_id,'capacity',7,'coordinator',false,'services','[]'::jsonb,'expected_services','[]'::jsonb));
  raise exception 'stale change accepted';
 exception when others then if sqlerrm<>'department_version_conflict' then raise; end if; end;
 -- Existing department leadership must survive workload and membership saves
 update public.work_memberships set member_role='lead' where user_id=employee_id and service_id=sid
  and not exists(select 1 from public.work_memberships where service_id=sid and member_role='lead');
 if exists(select 1 from public.work_memberships where user_id=employee_id and member_role='lead') then
  perform public.work_staff_settings_save(jsonb_build_object('user_id',employee_id,'capacity',8,'coordinator',false,'services',jsonb_build_array(sid),'expected_services',jsonb_build_array(sid)));
  if not exists(select 1 from public.work_memberships where user_id=employee_id and member_role='lead') then raise exception 'lead lost'; end if;
  begin
   perform public.work_staff_settings_save(jsonb_build_object('user_id',employee_id,'capacity',8,'coordinator',false,'services','[]'::jsonb,'expected_services',jsonb_build_array(sid)));
   raise exception 'lead removed';
  exception when others then if sqlerrm<>'department_lead_membership_required' then raise; end if; end;
 end if;
 perform set_config('request.jwt.claims',current_setting('qa.claims_'||replace(coordinator_id::text,'-','')),true);
 if not public.work_directory() @> jsonb_build_array(jsonb_build_object('id',employee_id,'services',jsonb_build_array(sid)))
 then raise exception 'coordinator cannot see department employee'; end if;
 perform set_config('request.jwt.claims',current_setting('qa.claims_'||replace(employee_id::text,'-','')),true);
 begin
  perform public.work_staff_settings_save(jsonb_build_object('user_id',employee_id,'capacity',8,'coordinator',true,'services',jsonb_build_array(sid),'expected_services',jsonb_build_array(sid)));
  raise exception 'employee elevated own access';
 exception when insufficient_privilege then null; end;
 perform set_config('qa.employee_id',employee_id::text,true);
 perform set_config('qa.service_id',sid::text,true);
end $$;
set local role authenticated;
do $$
begin
 if not exists(select 1 from public.work_memberships where user_id=auth.uid() and service_id=current_setting('qa.service_id')::uuid)
 then raise exception 'employee cannot read own membership through RLS'; end if;
end $$;
reset role;
select 'PASS saving departments coordinator visibility employee RLS stale writes leadership preservation and authorization' as result;
rollback;
