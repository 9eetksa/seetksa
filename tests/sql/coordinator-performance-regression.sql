-- Run after coordinator task/performance migrations
-- Synthetic accounts and notification rows always roll back
begin;

do $fixture$
declare c jsonb='{}'; label text; uid uuid; session_id uuid; sid uuid=gen_random_uuid(); rid uuid=gen_random_uuid(); queue_id uuid=gen_random_uuid();
begin
 foreach label in array array['client','coordinator_a','coordinator_b','worker','pending','admin'] loop
  uid=gen_random_uuid(); session_id=gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(uid,uid||'@example.invalid',jsonb_build_object(
   'role',case label when 'client' then 'client' when 'admin' then 'admin' else 'employee' end,
   'portal_qa',true,'must_change_password',label='pending'),jsonb_build_object('display_name','QA coordinator metrics '||label));
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session_id,uid,now(),now());
  c=c||jsonb_build_object(label,uid,label||'_claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',session_id));
 end loop;
 insert into public.work_services(id,name,default_target_minutes,default_effort_points)
 values(sid,'QA coordinator metrics '||sid,60,3);
 insert into public.work_staff(user_id,capacity,coordinator)
 select (c->>entry.name)::uuid,100,entry.name in('coordinator_a','coordinator_b','pending')
 from unnest(array['coordinator_a','coordinator_b','worker','pending']) entry(name);
 insert into public.work_memberships(user_id,service_id) values((c->>'worker')::uuid,sid);
 insert into public.work_requests(id,client_id,service_id,title,brief,status,test)
 values(rid,(c->>'client')::uuid,sid,'QA coordinator complete journey','QA rollback coordinator work journey','new',true),
 (queue_id,(c->>'client')::uuid,sid,'QA coordinator pending intake','QA rollback unclaimed intake remains a queue','new',true);
 c=c||jsonb_build_object('sid',sid,'rid',rid,'queue_id',queue_id);
 perform set_config('qa.coordinator_metrics',c::text,true);
end $fixture$;

-- Exercise actual intake transitions with two coordinators
set local role authenticated;
do $intake$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; rid uuid=(c->>'rid')::uuid; v integer; detail jsonb; result jsonb; board jsonb;
begin
 perform set_config('request.jwt.claims',(c->'worker_claims')::text,true);
 board=public.work_board('mine','QA coordinator',0);
 if jsonb_array_length(board->'requests')<>0 or jsonb_array_length(board->'coordinator_tasks')<>0 then
  raise exception 'QA ordinary employee saw coordinator shared intake';
 end if;
 perform set_config('request.jwt.claims',(c->'coordinator_a_claims')::text,true);
 board=public.work_board('mine','QA coordinator',0);
 if not exists(select 1 from jsonb_array_elements(board->'requests') item where item->>'id'=rid::text)
  or not exists(select 1 from jsonb_array_elements(board->'coordinator_tasks') item where item->>'request_id'=rid::text and item->>'kind'='intake' and item->>'status'='open') then
  raise exception 'QA coordinator My Tasks missing unclaimed intake';
 end if;
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 perform public.work_action('intake',jsonb_build_object('request_id',rid,'version',v,'service_id',c->>'sid'));
 perform set_config('request.jwt.claims',(c->'coordinator_b_claims')::text,true);
 board=public.work_board('mine','QA coordinator complete journey',0);
 if jsonb_array_length(board->'requests')<>0 or jsonb_array_length(board->'coordinator_tasks')<>0 then
  raise exception 'QA claimed intake remained in another coordinator My Tasks';
 end if;
 perform set_config('request.jwt.claims',(c->'coordinator_a_claims')::text,true);
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 perform public.work_action('request_info',jsonb_build_object('request_id',rid,'version',v,'reason','QA additional brief information'));
 perform set_config('request.jwt.claims',(c->'coordinator_b_claims')::text,true);
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 perform public.work_action('intake',jsonb_build_object('request_id',rid,'version',v,'service_id',c->>'sid'));
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 result=public.work_action('assign',jsonb_build_object('request_id',rid,'version',v,'service_id',c->>'sid',
  'assignee_id',c->>'worker','scope','QA department output reviewed by coordinator'));
 perform set_config('qa.coordinator_metrics',(c||jsonb_build_object('part',result->>'part_id'))::text,true);
end $intake$;
reset role;

do $intake_assertions$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; row record; delivery_id uuid=gen_random_uuid(); batch_id uuid=gen_random_uuid(); rid uuid=(c->>'rid')::uuid;
begin
 if (select count(*) from provision_private.work_coordinator_tasks(rid) where kind='intake')<>1 then
  raise exception 'QA repeated intake or assignment duplicated intake credit';
 end if;
 select * into strict row from provision_private.work_coordinator_tasks(rid) where kind='intake';
 if row.completed_by is distinct from (c->>'coordinator_a')::uuid or row.completed_at is null then
  raise exception 'QA intake credit did not retain first actual actor';
 end if;
 if exists(select 1 from provision_private.work_coordinator_tasks((c->>'queue_id')::uuid)
  where completed_by is not null or completed_at is not null or assignee_id is not null) then
  raise exception 'QA unclaimed intake credited an employee';
 end if;
 update public.work_parts set status='review' where id=(c->>'part')::uuid;
 insert into public.work_deliveries(id,request_id,part_id,uploaded_by,object_path,filename,note,batch_id)
 values(delivery_id,rid,(c->>'part')::uuid,(c->>'worker')::uuid,rid||'/'||(c->>'part')||'/first.png','first.png','QA two file batch',batch_id),
 (gen_random_uuid(),rid,(c->>'part')::uuid,(c->>'worker')::uuid,rid||'/'||(c->>'part')||'/second.png','second.png','QA two file batch',batch_id);
 perform set_config('qa.coordinator_metrics',(c||jsonb_build_object('delivery',delivery_id,'batch',batch_id))::text,true);
 if (select count(*) from provision_private.work_coordinator_tasks(rid) where kind='delivery_review')<>1 then
  raise exception 'QA each file incorrectly became a review task';
 end if;
 select * into strict row from provision_private.work_coordinator_tasks(rid) where kind='delivery_review';
 if row.assignee_id is distinct from (c->>'coordinator_b')::uuid or row.completed_at is not null then
  raise exception 'QA delivery review absent from current coordinator pending workload';
 end if;
end $intake_assertions$;

set local role authenticated;
do $first_review$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; rid uuid=(c->>'rid')::uuid; v integer; detail jsonb; rejected boolean=false;
begin
 perform set_config('request.jwt.claims',(c->'worker_claims')::text,true);
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 begin
  perform public.work_action('release_delivery',jsonb_build_object('request_id',rid,'version',v,'delivery_id',c->>'delivery'));
 exception when others then if sqlerrm='forbidden' then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'QA worker gained coordinator review authority'; end if;
 perform set_config('request.jwt.claims',(c->'coordinator_b_claims')::text,true);
 perform public.work_action('release_delivery',jsonb_build_object('request_id',rid,'version',v,'delivery_id',c->>'delivery'));
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 rejected=false;
 begin
  perform public.work_action('release_delivery',jsonb_build_object('request_id',rid,'version',v,'delivery_id',c->>'delivery'));
 exception when others then if sqlerrm='invalid_state' then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'QA completed delivery review allowed repeat release'; end if;
 perform set_config('request.jwt.claims',(c->'client_claims')::text,true);
 perform public.work_action('review',jsonb_build_object('request_id',rid,'version',v,'delivery_id',c->>'delivery',
  'decision','changes','reason','QA client revision preserved through metrics'));
end $first_review$;
reset role;

do $review_assertions$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; row record; rid uuid=(c->>'rid')::uuid;
begin
 select * into strict row from provision_private.work_coordinator_tasks(rid) where kind='delivery_review';
 if row.completed_by is distinct from (c->>'coordinator_b')::uuid or row.completed_at is null then
  raise exception 'QA release credit does not match actual reviewer';
 end if;
 if (select count(*) from provision_private.work_coordinator_tasks(rid) where kind='revision_review')<>1 then
  raise exception 'QA multifile client revision counted more than once';
 end if;
 select * into strict row from provision_private.work_coordinator_tasks(rid) where kind='revision_review';
 if row.assignee_id is distinct from (c->>'coordinator_b')::uuid or row.completed_at is not null then
  raise exception 'QA client revision routing not pending for coordinator';
 end if;
end $review_assertions$;

set local role authenticated;
do $route_revision$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; rid uuid=(c->>'rid')::uuid; v integer; detail jsonb; rejected boolean=false; board jsonb;
begin
 perform set_config('request.jwt.claims',(c->'coordinator_b_claims')::text,true);
 board=public.work_board('mine','QA coordinator complete journey',0);
 if not exists(select 1 from jsonb_array_elements(board->'coordinator_tasks') item where item->>'kind'='revision_review' and item->>'status'='open') then
  raise exception 'QA pending revision routing missing from responsible coordinator My Tasks';
 end if;
 perform set_config('request.jwt.claims',(c->'worker_claims')::text,true);
 board=public.work_board('mine','QA coordinator complete journey',0);
 if jsonb_array_length(board->'requests')<>1 or jsonb_array_length(board->'coordinator_tasks')<>0 then
  raise exception 'QA department task visibility changed or coordinator tasks leaked to worker';
 end if;
 perform set_config('request.jwt.claims',(c->'coordinator_a_claims')::text,true);
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 perform public.work_action('route_revision',jsonb_build_object('request_id',rid,'version',v,'part_id',c->>'part'));
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 if not exists(select 1 from jsonb_array_elements(detail->'parts') item where item->>'id'=c->>'part' and item->>'status'='offered') then
  raise exception 'QA metrics changed ordinary revision reopening';
 end if;
 begin
  perform public.work_action('route_revision',jsonb_build_object('request_id',rid,'version',v,'part_id',c->>'part'));
 exception when others then if sqlerrm='invalid_state' then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'QA revision routing repeated for same revision'; end if;
 perform set_config('request.jwt.claims',(c->'worker_claims')::text,true);
 perform public.work_action('accept',jsonb_build_object('request_id',rid,'version',v,'part_id',c->>'part','due_at',now()+interval '2 days'));
end $route_revision$;
reset role;

do $second_batch$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; row record; delivery_id uuid=gen_random_uuid(); rid uuid=(c->>'rid')::uuid;
begin
 select * into strict row from provision_private.work_coordinator_tasks(rid) where kind='revision_review';
 if row.completed_by is distinct from (c->>'coordinator_a')::uuid or row.completed_at is null then
  raise exception 'QA revision credit was given to request owner instead of routing actor';
 end if;
 if row.delivery_id is not null then raise exception 'QA revision task guessed a delivery without an event batch reference'; end if;
 update public.work_parts set status='review' where id=(c->>'part')::uuid;
 insert into public.work_deliveries(id,request_id,part_id,uploaded_by,object_path,filename,note,batch_id)
 values(delivery_id,rid,(c->>'part')::uuid,(c->>'worker')::uuid,rid||'/'||(c->>'part')||'/revised.png','revised.png','QA second real review cycle',gen_random_uuid());
 perform set_config('qa.coordinator_metrics',(c||jsonb_build_object('delivery2',delivery_id))::text,true);
end $second_batch$;

set local role authenticated;
do $release_and_approve$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; rid uuid=(c->>'rid')::uuid; v integer; detail jsonb;
begin
 perform set_config('request.jwt.claims',(c->'coordinator_a_claims')::text,true);
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 perform public.work_action('release_delivery',jsonb_build_object('request_id',rid,'version',v,'delivery_id',c->>'delivery2'));
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 perform set_config('request.jwt.claims',(c->'client_claims')::text,true);
  perform public.work_action('review',jsonb_build_object('request_id',rid,'version',v,'delivery_id',c->>'delivery2',
   'decision','changes','reason','QA second distinct revision in same transaction'));
  perform set_config('request.jwt.claims',(c->'coordinator_b_claims')::text,true);
  detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
  perform public.work_action('route_revision',jsonb_build_object('request_id',rid,'version',v,'part_id',c->>'part'));
  perform set_config('request.jwt.claims',(c->'worker_claims')::text,true);
  detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
  perform public.work_action('accept',jsonb_build_object('request_id',rid,'version',v,'part_id',c->>'part','due_at',now()+interval '2 days'));
end $release_and_approve$;
reset role;

do $third_batch$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; delivery_id uuid=gen_random_uuid(); rid uuid=(c->>'rid')::uuid;
begin
 if (select count(*) from provision_private.work_coordinator_tasks(rid) where kind='revision_review' and completed_at is not null)<>2
  or (select count(distinct completed_by) from provision_private.work_coordinator_tasks(rid) where kind='revision_review')<>2 then
  raise exception 'QA repeated revisions with identical timestamps mapped to one route actor';
 end if;
 update public.work_parts set status='review' where id=(c->>'part')::uuid;
 insert into public.work_deliveries(id,request_id,part_id,uploaded_by,object_path,filename,note,batch_id)
 values(delivery_id,rid,(c->>'part')::uuid,(c->>'worker')::uuid,rid||'/'||(c->>'part')||'/final.png','final.png','QA third real review cycle',gen_random_uuid());
 perform set_config('qa.coordinator_metrics',(c||jsonb_build_object('delivery3',delivery_id))::text,true);
end $third_batch$;

set local role authenticated;
do $final_release$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; rid uuid=(c->>'rid')::uuid; v integer; detail jsonb;
begin
 perform set_config('request.jwt.claims',(c->'coordinator_a_claims')::text,true);
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 perform public.work_action('release_delivery',jsonb_build_object('request_id',rid,'version',v,'delivery_id',c->>'delivery3'));
 detail=public.work_request_detail(rid,false);v=(detail->'request'->>'version')::integer;
 perform set_config('request.jwt.claims',(c->'client_claims')::text,true);
 perform public.work_action('review',jsonb_build_object('request_id',rid,'version',v,'delivery_id',c->>'delivery3','decision','approve'));
end $final_release$;
reset role;

do $metrics_and_security$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; rid uuid=(c->>'rid')::uuid; result jsonb; person jsonb; rejected boolean=false; expected_points numeric;
begin
 if (select count(*) from provision_private.work_coordinator_tasks(rid))<>6 then
  raise exception 'QA expected one intake three review batches and two revision routings';
 end if;
 if exists(select 1 from provision_private.work_coordinator_tasks(rid) where completed_at is null) then
  raise exception 'QA coordinator task remained pending after completed workflow';
 end if;
 if (select count(*) from public.work_parts where request_id=rid)<>1 then raise exception 'QA coordinator tasks duplicated department records'; end if;
 if exists(select 1 from public.work_notifications where request_id in(rid,(c->>'queue_id')::uuid) and whatsapp<>'suppressed') then
  raise exception 'QA notifications escaped suppression';
 end if;
 perform set_config('request.jwt.claims',(c->'admin_claims')::text,true);
 result=public.work_employee_performance(30);
 if exists(select 1 from jsonb_array_elements(result->'people') p where p->>'id' in(c->>'coordinator_a',c->>'coordinator_b',c->>'worker') and (p->>'assigned_count')::int<>0) then
  raise exception 'QA test request counted in performance';
 end if;
 -- Only synthetic rows in this uncommitted transaction are measured
 update public.work_requests set test=false where id in(rid,(c->>'queue_id')::uuid);
 result=public.work_employee_performance(30);
 select value into strict person from jsonb_array_elements(result->'people') where value->>'id'=c->>'coordinator_a';
 select sum(effort_points) into expected_points from provision_private.work_coordinator_tasks(rid) where completed_by=(c->>'coordinator_a')::uuid;
 if (person->>'completed_count')::int<>4 or (person->>'assigned_count')::int<>4 or (person->>'open_count')::int<>0 or (person->>'completed_points')::numeric<>expected_points then
  raise exception 'QA coordinator A metrics wrong %',person;
 end if;
 select value into strict person from jsonb_array_elements(result->'people') where value->>'id'=c->>'coordinator_b';
 if (person->>'completed_count')::int<>2 or (person->>'assigned_count')::int<>2 or (person->>'open_count')::int<>0 then
  raise exception 'QA coordinator B received duplicate intake or other actor credit %',person;
 end if;
 select value into strict person from jsonb_array_elements(result->'people') where value->>'id'=c->>'worker';
 if (person->>'completed_count')::int<>1 or (person->>'assigned_count')::int<>1 or (person->>'completed_points')::numeric<>3 then
  raise exception 'QA department employee metrics changed %',person;
 end if;
 select value into strict person from jsonb_array_elements(result->'people') where value->>'id'=c->>'pending';
 if not (person->>'pending_setup')::boolean or (person->>'assigned_count')::int<>0 or person->>'performance_score' is not null then
  raise exception 'QA pending account acquired measured performance';
 end if;
 if has_function_privilege('authenticated','provision_private.work_coordinator_tasks(uuid)','execute')
  or has_function_privilege('anon','provision_private.work_coordinator_tasks(uuid)','execute') then
  raise exception 'QA privileged coordinator source exposed directly';
 end if;
end $metrics_and_security$;

set local role authenticated;
do $rpc_scope$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; result jsonb; rejected boolean=false;
begin
 perform set_config('request.jwt.claims',(c->'coordinator_a_claims')::text,true);
 result=public.work_board('mine','QA coordinator complete journey',0);
 if jsonb_array_length(result->'requests')<>1 or jsonb_array_length(result->'coordinator_tasks')<>4
  or exists(select 1 from jsonb_array_elements(result->'coordinator_tasks') item where item->>'completed_by'<>c->>'coordinator_a') then
  raise exception 'QA coordinator A completed tasks attributed to request owner';
 end if;
 perform set_config('request.jwt.claims',(c->'coordinator_b_claims')::text,true);
 result=public.work_board('mine','QA coordinator complete journey',0);
 if jsonb_array_length(result->'coordinator_tasks')<>2
  or exists(select 1 from jsonb_array_elements(result->'coordinator_tasks') item where item->>'completed_by'<>c->>'coordinator_b') then
  raise exception 'QA coordinator B has another actor completed tasks';
 end if;
 perform set_config('request.jwt.claims',(c->'worker_claims')::text,true);
 result=public.work_employee_performance(30);
 if jsonb_array_length(result->'people')<>1 or result->'people'->0->>'id'<>c->>'worker' then
  raise exception 'QA ordinary employee saw colleague performance';
 end if;
 perform set_config('request.jwt.claims',(c->'client_claims')::text,true);
 begin perform public.work_employee_performance(30); exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'QA client gained staff metrics'; end if;
end $rpc_scope$;
reset role;

do $coordinator_revocation$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; result jsonb;
begin
 update public.work_staff set coordinator=false where user_id=(c->>'coordinator_a')::uuid;
 perform set_config('request.jwt.claims',(c->'coordinator_a_claims')::text,true);
 result=public.work_board('mine','QA coordinator complete journey',0);
 if jsonb_array_length(result->'requests')<>0 or jsonb_array_length(result->'coordinator_tasks')<>0 then
  raise exception 'QA revoked coordinator retained private request access';
 end if;
 result=public.work_employee_performance(30);
 if jsonb_array_length(result->'people')<>1 or (result->'people'->0->>'completed_count')::int<>4 then
  raise exception 'QA removing coordinator role lost historical earned performance';
 end if;
 update public.work_staff set coordinator=true where user_id=(c->>'coordinator_a')::uuid;
end $coordinator_revocation$;

-- Historical queue time excludes waiting for client information
-- Internal release and handoff are completed reviews using the original action paths
do $extra_fixtures$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; waiting_id uuid=gen_random_uuid(); handoff_id uuid=gen_random_uuid();
 internal_id uuid=gen_random_uuid(); sid2 uuid=gen_random_uuid(); handoff_part uuid=gen_random_uuid(); source_part uuid=gen_random_uuid();
 downstream_part uuid=gen_random_uuid(); handoff_delivery uuid=gen_random_uuid(); internal_delivery uuid=gen_random_uuid(); row record;
begin
 insert into public.work_services(id,name) values(sid2,'QA coordinator downstream '||sid2);
 insert into public.work_memberships(user_id,service_id) values((c->>'worker')::uuid,sid2);
 insert into public.work_requests(id,client_id,service_id,title,brief,status,test,coordinator_id,created_at,submitted_at)
 values(waiting_id,(c->>'client')::uuid,(c->>'sid')::uuid,'QA waiting time','QA excludes client information waiting','active',true,(c->>'coordinator_a')::uuid,now()-interval '4 hours',now()-interval '4 hours'),
 (handoff_id,(c->>'client')::uuid,(c->>'sid')::uuid,'QA internal handoff','QA review forwarded to following department','active',true,(c->>'coordinator_a')::uuid,now(),now()),
 (internal_id,(c->>'client')::uuid,(c->>'sid')::uuid,'QA dependency release','QA review released to dependent department','active',true,(c->>'coordinator_a')::uuid,now(),now());
 insert into public.work_events(request_id,actor,kind,created_at) values
 (waiting_id,(c->>'coordinator_a')::uuid,'request_info',now()-interval '3 hours'),
 (waiting_id,(c->>'coordinator_a')::uuid,'request_attachments',now()-interval '2 hours'),
 (waiting_id,(c->>'client')::uuid,'supply_info',now()-interval '1 hour'),
 (waiting_id,(c->>'coordinator_a')::uuid,'intake',now()),
 (handoff_id,(c->>'coordinator_a')::uuid,'intake',now()),
 (internal_id,(c->>'coordinator_a')::uuid,'intake',now());
 select * into strict row from provision_private.work_coordinator_tasks(waiting_id) where kind='intake';
 if abs(row.actual_minutes-120)>0.01 then raise exception 'QA client waiting counted as coordinator work time %',row.actual_minutes; end if;
 insert into public.work_parts(id,request_id,service_id,assignee_id,scope,status,route_position,accepted_at) values
 (handoff_part,handoff_id,(c->>'sid')::uuid,(c->>'worker')::uuid,'QA source for handoff','review',1,now()),
 (source_part,internal_id,(c->>'sid')::uuid,(c->>'worker')::uuid,'QA source for dependency','review',1,now()),
 (downstream_part,internal_id,sid2,(c->>'worker')::uuid,'QA downstream dependency work','waiting',2,now());
 insert into public.work_dependencies(request_id,part_id,upstream_id,reason,gate,status)
 values(internal_id,downstream_part,source_part,'QA approved source dependency','internal_delivery','accepted');
 insert into public.work_deliveries(id,request_id,part_id,uploaded_by,object_path,filename,note,batch_id) values
 (handoff_delivery,handoff_id,handoff_part,(c->>'worker')::uuid,handoff_id||'/'||handoff_part||'/handoff.png','handoff.png','QA forwarding review',gen_random_uuid()),
 (internal_delivery,internal_id,source_part,(c->>'worker')::uuid,internal_id||'/'||source_part||'/internal.png','internal.png','QA internal review',gen_random_uuid());
 perform set_config('qa.coordinator_metrics',(c||jsonb_build_object('handoff_id',handoff_id,'internal_id',internal_id,
  'handoff_delivery',handoff_delivery,'internal_delivery',internal_delivery,'sid2',sid2))::text,true);
end $extra_fixtures$;

set local role authenticated;
do $extra_actions$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; detail jsonb; v integer;
begin
 perform set_config('request.jwt.claims',(c->'coordinator_b_claims')::text,true);
 detail=public.work_request_detail((c->>'handoff_id')::uuid,false);v=(detail->'request'->>'version')::integer;
 perform public.work_action('assign',jsonb_build_object('request_id',c->>'handoff_id','version',v,'service_id',c->>'sid2',
  'assignee_id',c->>'worker','scope','QA downstream handoff retains review credit','delivery_id',c->>'handoff_delivery'));
 detail=public.work_request_detail((c->>'internal_id')::uuid,false);v=(detail->'request'->>'version')::integer;
 perform public.work_action('release_dependencies',jsonb_build_object('request_id',c->>'internal_id','version',v,'delivery_id',c->>'internal_delivery'));
end $extra_actions$;
reset role;

do $extra_assertions$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; rid uuid; row record;
begin
 foreach rid in array array[(c->>'handoff_id')::uuid,(c->>'internal_id')::uuid] loop
  if (select count(*) from provision_private.work_coordinator_tasks(rid))<>2 then
   raise exception 'QA internal review was omitted or target assignment duplicated coordinator work';
  end if;
  select * into strict row from provision_private.work_coordinator_tasks(rid) where kind='delivery_review';
  if row.completed_at is null or row.completed_by is distinct from (c->>'coordinator_b')::uuid then
   raise exception 'QA internal review credit not given to actual coordinator';
  end if;
  if exists(select 1 from public.work_notifications where request_id=rid and whatsapp<>'suppressed') then
   raise exception 'QA internal test notification escaped suppression';
  end if;
 end loop;
end $extra_assertions$;

-- Open coordination work must remain actionable when the former owner loses access
-- Completed work retains its original actor and is never handed to the new queue owner
do $orphaned_owner$
declare c jsonb=current_setting('qa.coordinator_metrics')::jsonb; rid uuid=gen_random_uuid(); pid uuid=gen_random_uuid(); waiting_id uuid=gen_random_uuid();
 scenario text; result jsonb; person jsonb; task record; original_meta jsonb; baseline_completed integer;
begin
 select raw_app_meta_data into original_meta from auth.users where id=(c->>'coordinator_a')::uuid;
 perform set_config('request.jwt.claims',(c->'admin_claims')::text,true);
 result=public.work_employee_performance(30);
 select (value->>'completed_count')::integer into baseline_completed from jsonb_array_elements(result->'people') where value->>'id'=c->>'coordinator_a';
 insert into public.work_requests(id,client_id,service_id,title,brief,status,test,coordinator_id)
 values(rid,(c->>'client')::uuid,(c->>'sid')::uuid,'QA orphan coordinator review','QA pending review remains actionable after owner access changes','active',true,(c->>'coordinator_a')::uuid),
 (waiting_id,(c->>'client')::uuid,(c->>'sid')::uuid,'QA orphan coordinator information','QA waiting intake returns to shared queue when owner unavailable','needs_info',true,(c->>'coordinator_a')::uuid);
 insert into public.work_events(request_id,actor,kind) values(rid,(c->>'coordinator_a')::uuid,'intake'),(waiting_id,(c->>'coordinator_a')::uuid,'request_info');
 insert into public.work_parts(id,request_id,service_id,assignee_id,scope,status,route_position)
 values(pid,rid,(c->>'sid')::uuid,(c->>'worker')::uuid,'QA orphan pending department delivery','review',1);
 insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,batch_id)
 values(rid,pid,(c->>'worker')::uuid,rid||'/'||pid||'/orphan.png','orphan.png',gen_random_uuid());
 update public.work_requests set test=false where id=rid;
 select * into strict task from provision_private.work_coordinator_tasks(rid) where kind='delivery_review';
 if task.assignee_id is distinct from (c->>'coordinator_a')::uuid then raise exception 'QA active coordinator unexpectedly lost owned review'; end if;

 foreach scenario in array array['revoked','pending_setup','suspended','banned'] loop
  update public.work_staff set coordinator=scenario<>'revoked' where user_id=(c->>'coordinator_a')::uuid;
  update auth.users set raw_app_meta_data=original_meta||jsonb_build_object('must_change_password',scenario='pending_setup'),
   banned_until=case when scenario='banned' then now()+interval '1 day' else null end
  where id=(c->>'coordinator_a')::uuid;
  if scenario='suspended' then
   insert into provision_private.account_lifecycle(user_id,state,reason,changed_by)
   values((c->>'coordinator_a')::uuid,'suspended','QA orphan owner suspension',(c->>'admin')::uuid);
  end if;
  select * into strict task from provision_private.work_coordinator_tasks(rid) where kind='delivery_review';
  if task.assignee_id is not null or task.status<>'open' or task.completed_at is not null then
   raise exception 'QA unavailable owner retained pending coordinator work %',scenario;
  end if;
  select * into strict task from provision_private.work_coordinator_tasks(waiting_id) where kind='intake';
  if task.assignee_id is not null or task.status<>'waiting' or task.completed_at is not null then
   raise exception 'QA unavailable owner retained waiting coordinator work %',scenario;
  end if;
  select * into strict task from provision_private.work_coordinator_tasks(rid) where kind='intake';
  if task.assignee_id is distinct from (c->>'coordinator_a')::uuid or task.completed_by is distinct from (c->>'coordinator_a')::uuid or task.completed_at is null then
   raise exception 'QA owner access change rewrote historical actor %',scenario;
  end if;
  perform set_config('request.jwt.claims',(c->'coordinator_b_claims')::text,true);
  result=public.work_board('mine','QA orphan coordinator review',0);
  if jsonb_array_length(result->'requests')<>1 or jsonb_array_length(result->'coordinator_tasks')<>1
   or result->'coordinator_tasks'->0->>'assignee_id' is not null
   or result->'coordinator_tasks'->0->>'kind'<>'delivery_review' then
   raise exception 'QA current coordinator cannot see orphan review in shared queue %',scenario;
  end if;
  if scenario='revoked' then
   perform set_config('request.jwt.claims',(c->'admin_claims')::text,true);
   result=public.work_employee_performance(30);
   select value into strict person from jsonb_array_elements(result->'people') where value->>'id'=c->>'coordinator_a';
   if (person->>'assigned_count')::int<>baseline_completed+1 or (person->>'completed_count')::int<>baseline_completed+1
    or (person->>'open_count')::int<>0 then raise exception 'QA orphan work charged to revoked coordinator %',person; end if;
  end if;
  if scenario='suspended' then delete from provision_private.account_lifecycle where user_id=(c->>'coordinator_a')::uuid; end if;
 end loop;
 update public.work_staff set coordinator=true where user_id=(c->>'coordinator_a')::uuid;
 update auth.users set raw_app_meta_data=original_meta,banned_until=null where id=(c->>'coordinator_a')::uuid;
 select * into strict task from provision_private.work_coordinator_tasks(rid) where kind='delivery_review';
 if task.assignee_id is distinct from (c->>'coordinator_a')::uuid then raise exception 'QA available owner did not regain pending task'; end if;
end $orphaned_owner$;

select 'PASS coordinator actors deduplication waiting time orphan owner recovery board permissions department metrics and notification isolation' result;
rollback;
