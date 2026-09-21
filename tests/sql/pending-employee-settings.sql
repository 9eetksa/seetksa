-- Run as a privileged database operator These synthetic fixtures always roll back
begin;
do $$
declare owner_id uuid=gen_random_uuid(); pending_id uuid=gen_random_uuid(); ready_id uuid=gen_random_uuid();
 admin_id uuid=gen_random_uuid(); suspended_id uuid=gen_random_uuid(); session_id uuid;
 account_id uuid; directory jsonb; row_data jsonb; expected_services jsonb;
begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 (owner_id,owner_id||'@example.invalid','{"role":"super_admin","portal_qa":true}','{}'),
 (pending_id,pending_id||'@example.invalid','{"role":"employee","must_change_password":true,"portal_qa":true}','{"display_name":"Pending settings QA"}'),
 (ready_id,ready_id||'@example.invalid','{"role":"employee","portal_qa":true}','{}'),
 (admin_id,admin_id||'@example.invalid','{"role":"admin","permissions":["departments.manage"],"portal_qa":true}','{}'),
 (suspended_id,suspended_id||'@example.invalid','{"role":"employee","portal_qa":true}','{}');
 insert into provision_private.account_lifecycle(user_id,state,reason,changed_by)
 values(suspended_id,'suspended','QA directory exclusion',owner_id);
 foreach account_id in array array[owner_id,pending_id,ready_id,admin_id] loop
  session_id=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session_id,account_id,now(),now());
  perform set_config('qa.staff_claims_'||replace(account_id::text,'-',''),
   jsonb_build_object('sub',account_id,'role','authenticated','session_id',session_id)::text,true);
 end loop;
 perform set_config('request.jwt.claims',current_setting('qa.staff_claims_'||replace(owner_id::text,'-','')),true);
 directory=public.work_settings_staff();
 for row_data in select value from jsonb_array_elements(directory) loop
  select coalesce(jsonb_agg(service_id order by service_id),'[]'::jsonb) into expected_services
  from public.work_memberships where user_id=(row_data->>'id')::uuid;
  if row_data->'services' is distinct from expected_services then
   raise exception 'QA settings directory lost department memberships';
  end if;
 end loop;
 if not directory @> jsonb_build_array(jsonb_build_object('id',pending_id,'pending_setup',true,'capacity',5))
  or not directory @> jsonb_build_array(jsonb_build_object('id',ready_id,'pending_setup',false))
  or directory @> jsonb_build_array(jsonb_build_object('id',suspended_id)) then
  raise exception 'QA settings must include pending and ready staff and exclude suspended accounts';
 end if;
 if public.work_directory() @> jsonb_build_array(jsonb_build_object('id',pending_id)) then
  raise exception 'QA pending staff leaked into operational assignment directory';
 end if;
 perform public.work_setup('staff',jsonb_build_object('user_id',pending_id,'capacity',7,'coordinator',true));
 directory=public.work_settings_staff();
 if not directory @> jsonb_build_array(jsonb_build_object('id',pending_id,'capacity',7,'coordinator',true,'pending_setup',true)) then
  raise exception 'QA pending account settings did not persist';
 end if;
 if not exists(select 1 from provision_private.audit where actor=owner_id and action='work_staff' and details->>'user_id'=pending_id::text) then
  raise exception 'QA staff settings audit missing';
 end if;
 if public.work_directory() @> jsonb_build_array(jsonb_build_object('id',pending_id)) then
  raise exception 'QA saving staff settings bypassed onboarding';
 end if;
 foreach account_id in array array[pending_id,ready_id,admin_id] loop
  perform set_config('request.jwt.claims',current_setting('qa.staff_claims_'||replace(account_id::text,'-','')),true);
  if account_id=pending_id and provision_private.account_ready() then
   raise exception 'QA pending user gained workspace access';
  end if;
  begin
   perform public.work_settings_staff();
   raise exception 'QA non-owner accessed settings directory';
  exception when insufficient_privilege then null;
  end;
 end loop;
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform public.work_settings_staff();
  raise exception 'QA missing session accessed settings directory';
 exception when insufficient_privilege then null;
 end;
 if has_function_privilege('anon','public.work_settings_staff()','EXECUTE')
  or not has_function_privilege('authenticated','public.work_settings_staff()','EXECUTE') then
  raise exception 'QA unexpected endpoint privileges';
 end if;
end $$;
select 'pending employee settings and authorization checks passed' as result;
rollback;
