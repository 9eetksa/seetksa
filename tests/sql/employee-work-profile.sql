begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $$
declare
 owner_id uuid=gen_random_uuid(); employee_id uuid=gen_random_uuid(); other_id uuid=gen_random_uuid(); admin_id uuid=gen_random_uuid();
 sid uuid=gen_random_uuid(); session_id uuid=gen_random_uuid(); p jsonb; result jsonb; original_name text;
begin
 insert into auth.users(id,email,phone,raw_app_meta_data,raw_user_meta_data) values
 (owner_id,owner_id||'@example.invalid',null,'{"role":"super_admin","portal_qa":true}','{}'),
 (admin_id,admin_id||'@example.invalid',null,'{"role":"admin","portal_qa":true}','{}'),
 (employee_id,employee_id||'@example.invalid','966500000991','{"role":"employee","job_title":"Designer","portal_qa":true}','{"display_name":"Profile QA"}'),
 (other_id,other_id||'@example.invalid',null,'{"role":"employee","portal_qa":true}','{}');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(session_id,owner_id,now(),now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',session_id)::text,true);
 insert into public.work_services(id,name) values(sid,'Profile QA department');
 insert into public.work_staff(user_id,coordinator,capacity) values(other_id,true,5);
 insert into public.work_memberships(user_id,service_id,member_role) values(other_id,sid,'lead');
 result=public.work_employee_profile(employee_id);
 if result->'services'<>'[]'::jsonb or result->'employment_type'<>'null'::jsonb then raise exception 'incorrect fresh snapshot'; end if;
 p=jsonb_build_object('services',jsonb_build_array(sid),'expected_services','[]'::jsonb,
  'coordinator',true,'expected_coordinator',false,'capacity',7,'expected_capacity',5,
  'employment_type','freelancer','expected_employment_type',null);
 -- Exercise the real deferred Auth receipt path and its owner guard
 update auth.users set raw_user_meta_data=jsonb_build_object('display_name','Saved Profile QA'),
  raw_app_meta_data=raw_app_meta_data||jsonb_build_object('employee_profile_edit',jsonb_build_object(
   'actor_id',owner_id,'request_id',gen_random_uuid(),'work_profile',p)) where id=employee_id;
 set constraints all immediate;
 set constraints all deferred;
 if not exists(select 1 from public.work_staff where user_id=employee_id and coordinator and capacity=7 and employment_type='freelancer')
  or not exists(select 1 from public.account_profiles where user_id=employee_id and display_name='Saved Profile QA')
  or (select count(*) from public.work_memberships where service_id=sid)<>2
  or not exists(select 1 from public.work_memberships where user_id=other_id and service_id=sid and member_role='lead')
 then raise exception 'atomic profile membership or peer preservation failed'; end if;
 -- An outdated work snapshot rolls the identity update back too
 begin
  update auth.users set raw_user_meta_data=jsonb_build_object('display_name','Must Roll Back'),
   raw_app_meta_data=raw_app_meta_data||jsonb_build_object('employee_profile_edit',jsonb_build_object(
    'actor_id',owner_id,'request_id',gen_random_uuid(),'work_profile',p)) where id=employee_id;
  set constraints all immediate;
  raise exception 'stale edit accepted';
 exception when others then if sqlerrm<>'employee_work_profile_conflict' then raise; end if; end;
 if (select raw_user_meta_data->>'display_name' from auth.users where id=employee_id)<>'Saved Profile QA'
 then raise exception 'partial identity write survived conflict'; end if;
 p=p||jsonb_build_object('services','[]'::jsonb,'expected_services',jsonb_build_array(sid),
  'expected_coordinator',true,'expected_capacity',7,'expected_employment_type','freelancer');
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('employee_profile_edit',jsonb_build_object(
   'actor_id',owner_id,'request_id',gen_random_uuid(),'work_profile',p)) where id=employee_id;
 set constraints all immediate;
 set constraints all deferred;
 if exists(select 1 from public.work_memberships where user_id=employee_id)
  or (select count(*) from public.work_staff where user_id in(employee_id,other_id) and coordinator)<>2
 then raise exception 'coordinator without department or multiple coordinators failed'; end if;
 if not (public.work_team_overview(current_date,current_date)->'people') @> jsonb_build_array(jsonb_build_object('id',employee_id,'coordinator',true,'employment_type','freelancer'))
  or not (public.work_employee_performance(30)->'people') @> jsonb_build_array(jsonb_build_object('id',employee_id,'coordinator',true,'employment_type','freelancer'))
 then raise exception 'report metadata missing'; end if;
 insert into auth.sessions(id,user_id,created_at,updated_at) values(gen_random_uuid(),admin_id,now(),now());
 select id into session_id from auth.sessions where user_id=admin_id;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','session_id',session_id)::text,true);
 perform public.work_team_overview(current_date,current_date);
 begin perform public.work_employee_profile(employee_id); raise exception 'admin edit allowed'; exception when insufficient_privilege then null; end;
 if has_function_privilege('authenticated','provision_private.apply_employee_work_profile(uuid,uuid,jsonb)','execute')
  or has_function_privilege('anon','public.work_employee_profile(uuid)','execute') then raise exception 'exposed work profile write'; end if;
end;
$$;
select 'PASS atomic employee profile conflict rollback multiple coordinators shared department preserved lead and report metadata' as result;
rollback;
