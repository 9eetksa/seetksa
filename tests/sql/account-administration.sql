begin;
-- Append to the uncommitted migration The caller always rolls this transaction back
set local statement_timeout='30s';
do $$
declare owner_id uuid=gen_random_uuid(); admin_id uuid=gen_random_uuid(); target_id uuid=gen_random_uuid();
 owner_session uuid=gen_random_uuid(); admin_session uuid=gen_random_uuid(); target_session uuid=gen_random_uuid();
 target_email text='lifecycle-qa-'||gen_random_uuid()::text||'@example.invalid'; result jsonb; rejected boolean;
begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at)
 values(owner_id,'lifecycle-owner-'||owner_id::text||'@example.invalid','{"role":"super_admin"}','{}',now()),
  (admin_id,'lifecycle-admin-'||admin_id::text||'@example.invalid','{"role":"admin"}','{}',now()),
  (target_id,target_email,'{"role":"client"}','{"display_name":"Lifecycle QA"}',now());
 insert into auth.sessions(id,user_id,created_at,updated_at) values(owner_session,owner_id,now(),now()),(admin_session,admin_id,now(),now()),(target_session,target_id,now(),now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_session)::text,true);
 if not provision_private.account_ready() or not provision_private.is_owner() then raise exception 'qa_owner_not_ready'; end if;
 if has_function_privilege('authenticated','public.platform_account_lifecycle(uuid,uuid,uuid,text,text,timestamptz,text)','execute')
  or has_function_privilege('anon','public.platform_account_lifecycle(uuid,uuid,uuid,text,text,timestamptz,text)','execute')
  or has_table_privilege('authenticated','provision_private.account_lifecycle','update') then raise exception 'qa_exposed_mutation'; end if;
 rejected=false;
 begin perform public.platform_account_lifecycle(admin_id,admin_session,target_id,'suspend','QA reason'); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_admin_allowed'; end if;
 rejected=false;
 begin perform public.platform_account_lifecycle(owner_id,admin_session,target_id,'suspend','QA reason'); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_forged_session_allowed'; end if;
 rejected=false;
 begin perform public.platform_account_lifecycle(owner_id,owner_session,owner_id,'suspend','QA reason'); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_self_allowed'; end if;
 rejected=false;
 begin perform public.platform_account_lifecycle(owner_id,owner_session,target_id,'suspend-until','QA reason',now()-interval '1 hour'); exception when invalid_parameter_value then rejected=true; end;
 if not rejected then raise exception 'qa_expired_date_allowed'; end if;
 result=public.platform_account_lifecycle(owner_id,owner_session,target_id,'suspend-until','QA reason',now()+interval '1 hour');
 if result->>'access_status'<>'temporary' or provision_private.account_available(target_id) or exists(select 1 from auth.sessions where user_id=target_id) then raise exception 'qa_suspension_not_enforced'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',target_id,'role','authenticated','session_id',target_session)::text,true);
 if provision_private.account_ready() then raise exception 'qa_stale_access_token_allowed'; end if;
 rejected=false;
 begin insert into auth.sessions(id,user_id) values(gen_random_uuid(),target_id); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_new_suspended_session_allowed'; end if;
 perform public.platform_account_lifecycle(owner_id,owner_session,target_id,'reactivate','QA reviewed');
 if not provision_private.account_available(target_id) or provision_private.account_ready() then raise exception 'qa_revoked_token_restored'; end if;
 insert into auth.sessions(id,user_id) values(target_session,target_id);
 if not provision_private.account_ready() then raise exception 'qa_new_session_not_allowed'; end if;
 rejected=false;
 begin perform public.platform_account_lifecycle(owner_id,owner_session,target_id,'delete','QA delete',null,'wrong@example.invalid'); exception when others then if sqlerrm='confirmation_mismatch' then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'qa_delete_confirmation_ignored'; end if;
 perform public.platform_account_lifecycle(owner_id,owner_session,target_id,'delete','QA delete',null,target_email);
 if provision_private.account_available(target_id) then raise exception 'qa_deleted_available'; end if;
 rejected=false;
 begin perform public.platform_account_lifecycle(owner_id,owner_session,target_id,'reactivate','QA invalid restore'); exception when others then if sqlerrm='account_deleted' then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'qa_deleted_restored'; end if;
 -- Mirror documented Auth soft-deletion update order without deleting any real identity
 update auth.users set email='deleted-'||target_id::text,phone='deleted',deleted_at=now() where id=target_id;
 update auth.users set raw_user_meta_data='{}' where id=target_id;
 update auth.users set raw_app_meta_data='{}' where id=target_id;
 set constraints all immediate;
 result=public.platform_account_deletion_finish(owner_id,owner_session,target_id);
 if result->>'identity_deleted'<>'true' then raise exception 'qa_delete_finish_failed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_session)::text,true);
 select value into result from jsonb_array_elements(public.platform_users(target_email,0)) where value->>'id'=target_id::text;
 if result->>'access_status'<>'deleted' or result->>'email'<>target_email or result->>'role'<>'client' then raise exception 'qa_directory_deleted_identity_lost'; end if;
 -- Expired temporary controls resolve at read time without a cron dependency
 perform public.platform_account_lifecycle(owner_id,owner_session,admin_id,'suspend-until','QA expiration',now()+interval '1 hour');
 update provision_private.account_lifecycle set suspended_until=now()-interval '1 minute' where user_id=admin_id;
 update auth.users set banned_until=now()-interval '1 minute' where id=admin_id;
 if not provision_private.account_available(admin_id) or provision_private.session_active(admin_id,admin_session) then raise exception 'qa_temporary_expiry_not_effective'; end if;
end;
$$;


-- Executed after both new migrations inside a rollback-only QA transaction
set local statement_timeout='30s';
do $$
declare owner_id uuid=gen_random_uuid(); owner_two uuid=gen_random_uuid(); client_id uuid=gen_random_uuid();
 employee_id uuid=gen_random_uuid(); admin_id uuid=gen_random_uuid(); pending_id uuid=gen_random_uuid();
 owner_session uuid=gen_random_uuid(); owner_other_session uuid=gen_random_uuid(); owner_two_session uuid=gen_random_uuid();
 client_session uuid=gen_random_uuid(); employee_session uuid=gen_random_uuid(); admin_session uuid=gen_random_uuid();
 open_id uuid; open_employee uuid; open_admin uuid; result jsonb; rejected boolean; sample record;
 qa_request_id uuid=gen_random_uuid(); event_id bigint; service_id uuid; directory jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at)
 values(owner_id,'impersonation-owner-'||owner_id::text||'@example.invalid',now(),'{"role":"super_admin"}','{}',now()),
  (owner_two,'impersonation-owner2-'||owner_two::text||'@example.invalid',now(),'{"role":"super_admin"}','{}',now()),
  (client_id,'impersonation-client-'||client_id::text||'@example.invalid',now(),'{"role":"client"}','{}',now()),
  (employee_id,'impersonation-employee-'||employee_id::text||'@example.invalid',now(),'{"role":"employee"}','{}',now()),
  (admin_id,'impersonation-admin-'||admin_id::text||'@example.invalid',now(),'{"role":"admin"}','{}',now()),
  (pending_id,'impersonation-pending-'||pending_id::text||'@example.invalid',now(),'{"role":"employee","must_change_password":true}','{}',now());
 insert into auth.sessions(id,user_id,created_at,updated_at) values
  (owner_session,owner_id,now(),now()),(owner_other_session,owner_id,now(),now()),(owner_two_session,owner_two,now(),now()),
  (client_session,client_id,now(),now()),(employee_session,employee_id,now(),now()),(admin_session,admin_id,now(),now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_session)::text,true);
 if not provision_private.account_ready() or not has_function_privilege('authenticated','provision_private.account_ready()','execute') then raise exception 'qa_rls_guard_unavailable'; end if;
 if has_function_privilege('authenticated','public.platform_impersonation_open(uuid,uuid,uuid)','execute')
  or has_function_privilege('anon','public.platform_impersonation_access(uuid,uuid,uuid)','execute')
  or has_function_privilege('authenticated','public.platform_impersonate(uuid)','execute')
  or has_table_privilege('authenticated','provision_private.account_impersonation','select') then raise exception 'qa_impersonation_exposed'; end if;
 result=public.platform_access_check();
 if result->>'user_id'<>owner_id::text or result->>'role'<>'super_admin' then raise exception 'qa_access_check_wrong_user'; end if;
 directory=public.platform_account_directory(client_id::text,'client','active','all','newest',0);
 if (directory->>'total')::integer<>1 or directory->'items'->0->>'id'<>client_id::text then raise exception 'qa_directory_filter_failed'; end if;
 if exists(select 1 from jsonb_object_keys(directory->'items'->0) key where key in ('encrypted_password','password_cipher','token_cipher','raw_app_meta_data','confirmation_token','recovery_token')) then raise exception 'qa_directory_secret_exposed'; end if;
 for sample in select admin_id as actor,admin_session as sid,client_id as target
  union all select employee_id,employee_session,client_id
  union all select client_id,client_session,admin_id
  union all select owner_id,owner_session,owner_id
  union all select owner_id,owner_session,owner_two
  union all select owner_id,owner_session,pending_id
  union all select owner_id,client_session,client_id loop
  rejected=false;
  begin perform public.platform_impersonation_open(sample.actor,sample.sid,sample.target); exception when insufficient_privilege then rejected=true; end;
  if not rejected then raise exception 'qa_unauthorized_impersonation_open'; end if;
 end loop;
 result=public.platform_impersonation_open(owner_id,owner_session,client_id); open_id=(result->>'id')::uuid;
 perform public.platform_impersonation_seal(open_id,owner_id,owner_session,client_session,repeat('x',80));
 result=public.platform_impersonation_access(open_id,owner_id,owner_session);
 if result->>'target'<>client_id::text or result->'user'->>'id'<>client_id::text or result->'user'->'app_metadata'->>'role'<>'client' then raise exception 'qa_wrong_effective_identity'; end if;
 rejected=false;
 begin perform public.platform_impersonation_access(open_id,owner_id,owner_other_session); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_impersonation_cross_session'; end if;
 rejected=false;
 begin perform public.platform_impersonation_access(open_id,owner_two,owner_two_session); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_impersonation_cross_owner'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',client_id,'role','authenticated','session_id',client_session)::text,true);
 if not provision_private.account_ready() then raise exception 'qa_delegated_client_not_ready'; end if;
 select id into service_id from public.work_services order by id limit 1;
 insert into public.work_requests(id,client_id,service_id,title,brief,status,test)
 values(qa_request_id,client_id,service_id,'Impersonation audit QA','Generated rollback only verification request','draft',true);
 insert into public.work_events(request_id,actor,kind,note,client_visible)
 values(qa_request_id,client_id,'create','Generated rollback only verification event',false) returning id into event_id;
 if not exists(select 1 from provision_private.audit where action='impersonation_work_event'
  and actor=owner_id and effective_user=client_id and details->>'event'=event_id::text
  and details->>'request'=qa_request_id::text and details->>'session'=open_id::text) then
  raise exception 'qa_work_event_actor_link_missing';
 end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_session)::text,true);
 result=public.platform_account_brief(client_id);
 if result->'account'->>'id'<>client_id::text or (result->'stats'->>'requests')::integer<>1
  or (result->'stats'->>'events')::integer<>1 then raise exception 'qa_account_brief_failed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',client_id,'role','authenticated','session_id',client_session)::text,true);
 rejected=false;
 begin perform public.platform_account_brief(client_id); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_client_account_brief_allowed'; end if;
 update auth.users set raw_app_meta_data=raw_app_meta_data||'{"permissions":["changed"]}'::jsonb where id=client_id;
 if provision_private.account_ready() then raise exception 'qa_changed_permissions_allowed'; end if;
 rejected=false;
 begin perform public.platform_impersonation_access(open_id,owner_id,owner_session); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_changed_target_access_allowed'; end if;
 perform public.platform_impersonation_close(open_id,owner_id,owner_session);
 if provision_private.account_ready() then raise exception 'qa_closed_delegate_allowed'; end if;
 rejected=false;
 begin perform public.platform_access_check(true); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_onboarding_bypasses_ended_delegate'; end if;
 rejected=false;
 begin insert into public.work_events(request_id,actor,kind,note,client_visible)
  values(qa_request_id,client_id,'attach','This ended delegation must roll back',false);
 exception when insufficient_privilege then rejected=true; end;
 if not rejected or (select count(*) from public.work_events where request_id=qa_request_id)>1 then
  raise exception 'qa_closed_delegate_event_persisted';
 end if;
 result=public.platform_impersonation_open(owner_id,owner_session,employee_id); open_employee=(result->>'id')::uuid;
 perform public.platform_impersonation_seal(open_employee,owner_id,owner_session,employee_session,repeat('y',80));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',employee_id,'role','authenticated','session_id',employee_session)::text,true);
 if not provision_private.account_ready() then raise exception 'qa_employee_not_ready'; end if;
 update provision_private.account_impersonation set expires_at=now()-interval '1 second' where id=open_employee;
 if provision_private.account_ready() then raise exception 'qa_expired_delegate_allowed'; end if;
 rejected=false;
 begin perform public.platform_impersonation_access(open_employee,owner_id,owner_session); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_expired_delegate_access_allowed'; end if;
 result=public.platform_impersonation_open(owner_id,owner_session,admin_id); open_admin=(result->>'id')::uuid;
 perform public.platform_impersonation_seal(open_admin,owner_id,owner_session,admin_session,repeat('z',80));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','session_id',admin_session)::text,true);
 if not provision_private.account_ready() then raise exception 'qa_admin_not_ready'; end if;
 perform public.platform_account_lifecycle(owner_two,owner_two_session,owner_id,'suspend','QA owner suspension');
 if provision_private.account_ready() then raise exception 'qa_suspended_owner_delegate_allowed'; end if;
 rejected=false;
 begin perform public.platform_impersonation_access(open_admin,owner_id,owner_session); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_suspended_owner_access_allowed'; end if;
 perform public.platform_account_lifecycle(owner_two,owner_two_session,client_id,'suspend','QA target suspension');
 rejected=false;
 begin perform public.platform_impersonation_open(owner_two,owner_two_session,client_id); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_suspended_target_open_allowed'; end if;
 perform public.platform_account_lifecycle(owner_two,owner_two_session,client_id,'delete','QA target deletion',null,'impersonation-client-'||client_id::text||'@example.invalid');
 rejected=false;
 begin perform public.platform_impersonation_open(owner_two,owner_two_session,client_id); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'qa_deleted_target_open_allowed'; end if;
 if (select count(*) from provision_private.audit where actor=owner_id and action='impersonation_start')<>3 then raise exception 'qa_missing_impersonation_audit'; end if;
end;
$$;

do $$
declare owner_id uuid=gen_random_uuid(); sid uuid=gen_random_uuid(); employee_id uuid=gen_random_uuid(); employee_sid uuid=gen_random_uuid();
 marker text='directory-qa-'||gen_random_uuid()::text; sample uuid; result jsonb; rejected boolean;
begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at) values
 (owner_id,marker||'-owner@example.invalid','{"role":"super_admin"}','{}',now()),
 (employee_id,marker||'-employee@example.invalid','{"role":"employee"}','{}',now());
 insert into auth.sessions(id,user_id) values(sid,owner_id),(employee_sid,employee_id);
 for i in 1..23 loop
  sample=gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at) values(sample,marker||'-'||i||'@example.invalid','{"role":"client"}',jsonb_build_object('display_name','Directory QA '||i),now()+i*interval '1 second');
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',sid)::text,true);
 result=public.platform_account_directory(marker,'client','active','never','oldest',0);
 if (result->>'total')::int<>23 or jsonb_array_length(result->'items')<>20 then raise exception 'qa_directory_filter_count'; end if;
 result=public.platform_account_directory(marker,'client','active','never','oldest',1);
 if jsonb_array_length(result->'items')<>3 then raise exception 'qa_directory_second_page'; end if;
 result=public.platform_account_brief(employee_id);
 if result->'account'->>'id'<>employee_id::text or (result->'stats'->>'requests')::int<>0 then raise exception 'qa_brief_wrong_identity'; end if;
 if result::text like '%encrypted_password%' or result::text like '%token_cipher%' then raise exception 'qa_brief_credentials_exposed'; end if;
 if has_function_privilege('anon','public.platform_account_brief(uuid)','execute') or has_function_privilege('authenticated','provision_private.account_directory_rows(uuid)','execute') then raise exception 'qa_directory_private_exposed'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',employee_id,'role','authenticated','session_id',employee_sid)::text,true);
 rejected=false;begin perform public.platform_account_directory(); exception when insufficient_privilege then rejected=true;end;
 if not rejected then raise exception 'qa_employee_directory_allowed';end if;
 rejected=false;begin perform public.platform_account_brief(owner_id); exception when insufficient_privilege then rejected=true;end;
 if not rejected then raise exception 'qa_employee_brief_allowed';end if;
end $$;

rollback;
