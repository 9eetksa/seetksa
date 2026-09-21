-- Execute after admin_catalog_permissions in one transaction and always roll back
-- The fixtures are isolated QA accounts and never dispatch messages
create function pg_temp.qa_expect_error(statement text,expected text) returns void
language plpgsql as $$
begin
 begin
  execute statement;
 exception when others then
  if sqlerrm=expected then return; end if;
  raise exception 'QA expected % but got %',expected,sqlerrm;
 end;
 raise exception 'QA operation unexpectedly succeeded expecting %',expected;
end $$;

do $$
declare owner_id uuid=gen_random_uuid(); admin_id uuid=gen_random_uuid(); employee_id uuid=gen_random_uuid();
 unavailable_id uuid=gen_random_uuid(); client_id uuid=gen_random_uuid(); outsider_id uuid=gen_random_uuid(); account_id uuid; session_id uuid;
begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 (owner_id,owner_id||'@example.invalid','{"role":"super_admin","portal_qa":true}','{}'),
 (admin_id,admin_id||'@example.invalid','{"role":"admin","permissions":[],"portal_qa":true}','{}'),
 (employee_id,employee_id||'@example.invalid','{"role":"employee","job_title":"QA editor","portal_qa":true}','{"display_name":"QA employee"}'),
 (unavailable_id,unavailable_id||'@example.invalid','{"role":"employee","portal_qa":true}','{}'),
 (client_id,client_id||'@example.invalid','{"role":"client","portal_qa":true}','{}'),
 (outsider_id,outsider_id||'@example.invalid','{"role":"admin","permissions":[],"portal_qa":true}',
  '{"role":"super_admin","permissions":["services.manage","departments.manage"]}');
 insert into public.account_profiles(user_id,display_name,phone)
 values(employee_id,'QA complete employee name','+966500000001');
 insert into provision_private.account_lifecycle(user_id,state,reason,changed_by)
 values(unavailable_id,'suspended','QA lifecycle isolation',owner_id);
 foreach account_id in array array[owner_id,admin_id,employee_id,client_id,outsider_id] loop
  session_id=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session_id,account_id,now(),now());
  perform set_config('qa.catalog_claims_'||case account_id when owner_id then 'owner' when admin_id then 'admin'
   when employee_id then 'employee' when client_id then 'client' else 'outsider' end,
   jsonb_build_object('sub',account_id,'role','authenticated','session_id',session_id,
    'app_metadata',jsonb_build_object('role','super_admin','permissions',jsonb_build_array('services.manage','departments.manage')))::text,true);
 end loop;
 perform set_config('qa.catalog_admin',admin_id::text,true);
 perform set_config('qa.catalog_employee',employee_id::text,true);
 perform set_config('qa.catalog_unavailable',unavailable_id::text,true);
 perform set_config('qa.catalog_client',client_id::text,true);
 perform set_config('qa.catalog_service_payload',jsonb_build_object(
  'name','QA catalog service','slug','qa-catalog-'||replace(gen_random_uuid()::text,'-',''),
  'category','QA services','description','QA metadata description','icon','sparkles','active',false,
  'client_visible',true,'default_target_minutes',4320,'default_effort_points',5.5,'sort_order',100
 )::text,true);
 if has_function_privilege('anon','public.work_catalog_service_save(jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.work_service_save(jsonb)','EXECUTE')
  or has_table_privilege('authenticated','public.work_services','UPDATE')
  or has_table_privilege('authenticated','public.work_services','INSERT')
 then raise exception 'QA mutation surface exposed'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_outsider'),true);
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb)','forbidden');
select pg_temp.qa_expect_error('select public.work_department_directory()','forbidden');
select pg_temp.qa_expect_error('select public.work_service_catalog(true)','forbidden');
select pg_temp.qa_expect_error('select public.platform_permissions(current_setting(''qa.catalog_admin'')::uuid,''["services.manage"]''::jsonb)','forbidden');

select set_config('request.jwt.claims',current_setting('qa.catalog_claims_owner'),true);
select pg_temp.qa_expect_error('select public.platform_permissions(current_setting(''qa.catalog_admin'')::uuid,null)','invalid_permissions');
select pg_temp.qa_expect_error('select public.platform_permissions(current_setting(''qa.catalog_admin'')::uuid,''[null]''::jsonb)','invalid_permissions');
select pg_temp.qa_expect_error('select public.platform_permissions(current_setting(''qa.catalog_admin'')::uuid,''["users.delete"]''::jsonb)','invalid_permissions');
select public.platform_permissions(current_setting('qa.catalog_admin')::uuid,'["services.manage","users.read","services.manage"]'::jsonb);

select set_config('request.jwt.claims',current_setting('qa.catalog_claims_admin'),true);
select pg_temp.qa_expect_error('select public.work_department_directory()','forbidden');
select pg_temp.qa_expect_error('select public.work_department_save(''{}''::jsonb)','forbidden');
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb||''{"member_ids":[]}''::jsonb)','invalid_service');
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb||''{"active":true}''::jsonb)','service_department_setup_required');

do $$
declare saved jsonb; payload jsonb=current_setting('qa.catalog_service_payload')::jsonb; catalog jsonb;
begin
 saved=public.work_catalog_service_save(payload);
 if saved->>'active'<>'false' or saved->>'requires_department_setup'<>'true' then raise exception 'QA creation bypassed setup'; end if;
 payload=payload||jsonb_build_object('id',saved->>'id','version',(saved->>'version')::integer);
 perform set_config('qa.catalog_service',saved->>'id',true);
 perform set_config('qa.catalog_service_payload',payload::text,true);
 catalog=public.work_service_catalog(true);
 if not exists(select 1 from jsonb_array_elements(catalog) service where service->>'id'=saved->>'id' and service->>'version'=saved->>'version')
 then raise exception 'QA editable catalog missing versioned draft'; end if;
 saved=public.work_catalog_service_save(payload||'{"description":"QA catalog edit preserved team"}'::jsonb);
 if (saved->>'version')::integer<>(payload->>'version')::integer+1 then raise exception 'QA version did not advance'; end if;
 perform set_config('qa.catalog_latest_version',saved->>'version',true);
end $$;
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb)','department_version_conflict');
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb||jsonb_build_object(''version'',current_setting(''qa.catalog_latest_version'')::integer,''active'',true))','service_department_setup_required');

-- Revocation is immediate even though the test keeps the original forged JWT claims
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_owner'),true);
select public.platform_permissions(current_setting('qa.catalog_admin')::uuid,'["departments.manage","users.read"]'::jsonb);
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_admin'),true);
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb)','forbidden');
do $$
declare directory jsonb; person jsonb; payload jsonb; saved jsonb;
begin
 directory=public.work_department_directory();
 select item into person from jsonb_array_elements(directory->'staff') item where item->>'id'=current_setting('qa.catalog_employee');
 if person->>'name' is distinct from 'QA complete employee name' or person->>'phone' is distinct from '+966500000001'
  or person->>'email' is distinct from current_setting('qa.catalog_employee')||'@example.invalid'
  or not(person?'job_title' and person?'departments' and person?'capacity' and person?'open_tasks')
 then raise exception 'QA employee projection incomplete'; end if;
 if exists(select 1 from jsonb_array_elements(directory->'staff') item where item->>'id'=current_setting('qa.catalog_unavailable'))
 then raise exception 'QA suspended employee offered to department'; end if;
 payload=current_setting('qa.catalog_service_payload')::jsonb||jsonb_build_object(
  'version',current_setting('qa.catalog_latest_version')::integer,'active',true,
  'member_ids',jsonb_build_array(current_setting('qa.catalog_employee')),
  'lead_user_id',current_setting('qa.catalog_employee'),
  'responsibilities',jsonb_build_array('QA preserve responsibility'),
  'tasks',jsonb_build_array('QA preserve task')
 );
 perform set_config('qa.catalog_department_payload',payload::text,true);
 saved=public.work_department_save(payload);
 perform set_config('qa.catalog_latest_version',saved->>'version',true);
end $$;

reset role;
do $$
declare sid uuid=current_setting('qa.catalog_service')::uuid;
begin
 if not exists(select 1 from public.work_services where id=sid and active)
  or not exists(select 1 from public.work_memberships where service_id=sid and member_role='lead')
  or not exists(select 1 from public.work_department_tasks where service_id=sid and item='QA preserve task')
  or not exists(select 1 from public.work_department_responsibilities where service_id=sid and item='QA preserve responsibility')
 then raise exception 'QA department contract incomplete'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_admin'),true);
select pg_temp.qa_expect_error('select public.work_department_save(current_setting(''qa.catalog_department_payload'')::jsonb||jsonb_build_object(''version'',current_setting(''qa.catalog_latest_version'')::integer,''member_ids'',jsonb_build_array(current_setting(''qa.catalog_unavailable'')),''lead_user_id'',current_setting(''qa.catalog_unavailable'')))','invalid_department_member');

select set_config('request.jwt.claims',current_setting('qa.catalog_claims_owner'),true);
select public.platform_permissions(current_setting('qa.catalog_admin')::uuid,'["services.manage","users.read"]'::jsonb);
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_admin'),true);
do $$
declare saved jsonb;
begin
 saved=public.work_catalog_service_save(current_setting('qa.catalog_service_payload')::jsonb||jsonb_build_object(
  'version',current_setting('qa.catalog_latest_version')::integer,'active',true,'description','QA metadata after configuration'));
 perform set_config('qa.catalog_latest_version',saved->>'version',true);
end $$;
reset role;

do $$
declare sid uuid=current_setting('qa.catalog_service')::uuid;
begin
 if (select count(*) from public.work_memberships where service_id=sid)<>1
  or not exists(select 1 from public.work_memberships where service_id=sid and member_role='lead' and user_id=current_setting('qa.catalog_employee')::uuid)
  or not exists(select 1 from public.work_department_tasks where service_id=sid and item='QA preserve task')
  or not exists(select 1 from public.work_department_responsibilities where service_id=sid and item='QA preserve responsibility')
 then raise exception 'QA catalog edit modified department team contract'; end if;
 insert into public.work_requests(client_id,service_id,requested_service_id,title,brief,status,test)
 values(current_setting('qa.catalog_client')::uuid,sid,sid,'QA open catalog work','QA cannot deactivate','active',true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_admin'),true);
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb||jsonb_build_object(''version'',current_setting(''qa.catalog_latest_version'')::integer,''active'',false))','department_has_open_work');
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_owner'),true);
select public.platform_permissions(current_setting('qa.catalog_admin')::uuid,'["users.read"]'::jsonb);
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_admin'),true);
select pg_temp.qa_expect_error('select public.work_service_catalog(true)','forbidden');
select pg_temp.qa_expect_error('select public.work_department_directory()','forbidden');
select pg_temp.qa_expect_error('select public.work_department_save(current_setting(''qa.catalog_department_payload'')::jsonb)','forbidden');
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb)','forbidden');
do $$ begin perform public.work_workspace(0,'mine',''); end $$;

select set_config('request.jwt.claims',current_setting('qa.catalog_claims_client'),true);
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb)','forbidden');
select pg_temp.qa_expect_error('select public.work_department_directory()','forbidden');
select set_config('request.jwt.claims',current_setting('qa.catalog_claims_employee'),true);
select pg_temp.qa_expect_error('select public.work_catalog_service_save(current_setting(''qa.catalog_service_payload'')::jsonb)','forbidden');
select pg_temp.qa_expect_error('select public.work_department_directory()','forbidden');
reset role;
select 'PASS owner grants immediate revocation forged claims separate permissions version locks department setup contact privacy lifecycle eligibility open work and preserved team data' result;
