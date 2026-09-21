-- Run with the new RPC installed inside the SAME outer transaction
-- This file rolls back all fixtures and restores the two trigger states
-- Do not strip the final rollback when running against a linked project
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';

-- Even suppressed fixture notices could wake a pre-existing real outbox
-- Block that statement trigger for the entire rollback-only fixture transaction
alter table public.work_notifications disable trigger work_outbox_dispatch;
alter table public.work_parts disable trigger work_part_metrics_guard;

do $fixtures$
declare
 c jsonb='{}'; label text; uid uuid; sid uuid; service_id uuid=gen_random_uuid();
 day date=(now() at time zone 'Asia/Riyadh')::date-10;
begin
 foreach label in array array['owner','admin','worker','old_worker','new_worker','returner','zero','pending','rater'] loop
  uid=gen_random_uuid(); sid=gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(uid,uid||'@example.invalid',jsonb_build_object(
   'role',case label when 'owner' then 'super_admin' when 'admin' then 'admin' else 'employee' end,
   'portal_qa',true,'must_change_password',label='pending'),
   jsonb_build_object('display_name','QA overview '||label));
  insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,uid,now(),now());
  if label not in('owner','admin') then
   insert into public.work_staff(user_id,capacity,coordinator) values(uid,5,false);
  end if;
  c=c||jsonb_build_object(label,uid,label||'_claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid));
 end loop;
 insert into public.work_services(id,name,default_target_minutes,default_effort_points)
 values(service_id,'QA overview '||service_id,60,2);
 insert into public.work_memberships(user_id,service_id,member_role)
 values((c->>'worker')::uuid,service_id,'lead'),((c->>'zero')::uuid,service_id,'member');
 c=c||jsonb_build_object('service',service_id,'day',day,
  'start',day::timestamp at time zone 'Asia/Riyadh');
 perform set_config('qa.team_overview',c::text,true);
end $fixtures$;

create function pg_temp.overview_part(
 employee uuid,accepted timestamptz,due timestamptz,delivered timestamptz,
 review_status text default 'auto_approved',scored boolean default false
) returns uuid language plpgsql as $$
declare c jsonb=current_setting('qa.team_overview')::jsonb; pid uuid=gen_random_uuid(); rid uuid=gen_random_uuid(); event_id bigint;
 assigned timestamptz=coalesce(accepted,(c->>'start')::timestamptz)-interval '1 hour'; batch uuid=gen_random_uuid();
begin
 -- A request may have only one active part in a department
 -- Keep the business guard enabled by giving every task its own QA request
 insert into public.work_requests(id,client_id,coordinator_id,service_id,title,brief,status,test,created_at,updated_at,submitted_at)
 values(rid,(c->>'owner')::uuid,(c->>'owner')::uuid,(c->>'service')::uuid,
  'QA overview rollback','QA calendar reporting fixture','active',false,
  (c->>'start')::timestamptz-interval '5 days',
  (c->>'start')::timestamptz-interval '5 days',
  (c->>'start')::timestamptz-interval '5 days');
 insert into public.work_parts(id,request_id,service_id,assignee_id,scope,status,due_at,accepted_at,created_at,route_position,
  assigned_at,target_minutes,effort_points,completed_at,performance_eligible,accountable_seconds,state_started_at,metrics_quality)
 values(pid,rid,(c->>'service')::uuid,employee,'QA overview part',
  case when scored then 'internal_done' when delivered is not null then 'review' when accepted is null then 'offered' else 'working' end,
  due,accepted,assigned,1,
  assigned,60,2,case when scored then delivered+interval '1 hour' end,true,3600,assigned,'measured');
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'owner')::uuid,'assign','QA fixture',assigned) returning id into event_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(event_id,null,employee,null,'offered');
 if accepted is not null then
  insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
  values(rid,pid,employee,'accept','QA fixture',accepted);
 end if;
 if accepted is not null and due is not null and review_status is not null then
  insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,
   review_expires_at,status,reviewed_at,reviewed_by,replacement_due_at,reason)
  values(rid,pid,employee,due,accepted,accepted+interval '3 hours',review_status,
   accepted+interval '3 hours',case when review_status='rejected' then (c->>'owner')::uuid end,
   case when review_status='rejected' then due+interval '2 hours' end,
   case when review_status='rejected' then 'QA replacement deadline' end);
 end if;
 if delivered is not null then
  insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,batch_id,created_at)
  values(rid,pid,employee,pid||'/a.txt','a.txt',batch,delivered),
   (rid,pid,employee,pid||'/b.txt','b.txt',batch,delivered);
  insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
  values(rid,pid,employee,'deliver','QA fixture',delivered);
 end if;
 return pid;
end;
$$;

do $tasks$
declare c jsonb=current_setting('qa.team_overview')::jsonb; t timestamptz=(c->>'start')::timestamptz;
 worker uuid=(c->>'worker')::uuid; old_worker uuid=(c->>'old_worker')::uuid; new_worker uuid=(c->>'new_worker')::uuid;
 pid uuid; rid uuid; late_task uuid; event_id bigint; i integer; v integer; accepted_event timestamptz; captured_proposal timestamptz;
begin
 -- Start included and first submission after the employee's own deadline
 late_task=pg_temp.overview_part(worker,t,t+interval '10 hours',t+interval '11 hours');
 select request_id into rid from public.work_parts where id=late_task;
 -- Extra revision files on another day must not become another submitted task
 insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,batch_id,created_at)
 values(rid,late_task,worker,late_task||'/revision.txt','revision.txt',gen_random_uuid(),t+interval '25 hours');
 -- End excluded for acceptance and first submission
 perform pg_temp.overview_part(worker,t+interval '24 hours',null,null,null);
 perform pg_temp.overview_part(worker,t-interval '1 hour',t,t);
 perform pg_temp.overview_part(worker,t-interval '2 hours',t+interval '24 hours',t+interval '24 hours');
 -- Delivery after the reporting cutoff is still open and late at that cutoff
 perform pg_temp.overview_part(worker,t+interval '2 hours',t+interval '5 hours',t+interval '26 hours');
 -- An administrator's replacement and unknown historical deadline are not employee commitments
 pid=pg_temp.overview_part(worker,t+interval '3 hours',t+interval '4 hours',t+interval '7 hours','rejected');
 update public.work_parts set due_at=t+interval '6 hours' where id=pid;
 perform pg_temp.overview_part(worker,t+interval '4 hours',t+interval '7 hours',null,null);
 pid=pg_temp.overview_part(worker,t+interval '4 hours 30 minutes',t+interval '8 hours',null);
 delete from provision_private.work_assignment_history history using public.work_events event
 where history.event_id=event.id and event.part_id=pid and event.kind='assign';
 perform pg_temp.overview_part(worker,null,null,null,null);

 -- Both authors retain their first submission credit after reassignment
 pid=pg_temp.overview_part(old_worker,t-interval '1 day',t+interval '4 hours',t+interval '5 hours');
 select request_id into rid from public.work_parts where id=pid;
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'owner')::uuid,'resolve','QA reassignment',t+interval '6 hours') returning id into event_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(event_id,old_worker,new_worker,'review','offered');
 update public.work_parts set assignee_id=new_worker,accepted_at=t+interval '7 hours',assigned_at=t+interval '6 hours',
  due_at=t+interval '9 hours',performance_eligible=false where id=pid;
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,new_worker,'accept','QA new owner',t+interval '7 hours');
 insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,status,reviewed_at)
 values(rid,pid,new_worker,t+interval '9 hours',t+interval '7 hours',t+interval '10 hours','auto_approved',t+interval '10 hours');
 insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,batch_id,created_at)
 values(rid,pid,new_worker,pid||'/new-owner.txt','new-owner.txt',gen_random_uuid(),t+interval '8 hours');
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,new_worker,'deliver','QA new owner',t+interval '8 hours');

 -- No unfinished duty remains for a previous owner reassigned before their deadline
 pid=pg_temp.overview_part(old_worker,t-interval '2 days',t+interval '4 hours',null);
 select request_id into rid from public.work_parts where id=pid;
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'owner')::uuid,'resolve','QA early reassignment',t+interval '2 hours') returning id into event_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(event_id,old_worker,new_worker,'working','offered');
 update public.work_parts set assignee_id=new_worker,accepted_at=t+interval '3 hours',assigned_at=t+interval '2 hours',performance_eligible=false where id=pid;
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,new_worker,'accept','QA unknown new deadline',t+interval '3 hours');

 -- Reassignment after an unmet deadline preserves the former employee's missed commitment
 pid=pg_temp.overview_part(old_worker,t-interval '2 days',t+interval '4 hours',null);
 select request_id into rid from public.work_parts where id=pid;
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'owner')::uuid,'resolve','QA late reassignment',t+interval '6 hours') returning id into event_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(event_id,old_worker,new_worker,'working','offered');
 update public.work_parts set assignee_id=new_worker,accepted_at=null,assigned_at=t+interval '6 hours',
  status='offered',performance_eligible=false where id=pid;

 -- Pending accounts remain listed but never acquire reporting or rating credit
 perform pg_temp.overview_part((c->>'pending')::uuid,t+interval '1 hour',t+interval '2 hours',t+interval '3 hours','auto_approved',true);
 -- Carry-in work earns the existing 100/100 rating when completed during the period
 for i in 1..5 loop
  perform pg_temp.overview_part((c->>'rater')::uuid,t-interval '2 days',t+interval '12 hours',t+interval '9 hours','auto_approved',true);
 end loop;
 pid=pg_temp.overview_part((c->>'rater')::uuid,t-interval '2 days',null,t+interval '9 hours',null,true);
 update public.work_parts set performance_eligible=false where id=pid;

 -- Returning to the same employee after a different owner creates a fresh deadline phase
 pid=pg_temp.overview_part((c->>'returner')::uuid,t-interval '3 days',t-interval '2 days',t-interval '2 days');
 select request_id into rid from public.work_parts where id=pid;
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'owner')::uuid,'resolve','QA intermediate owner',t-interval '1 day') returning id into event_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(event_id,(c->>'returner')::uuid,new_worker,'review','offered');
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,new_worker,'accept','QA intermediate acceptance',t-interval '23 hours');
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'owner')::uuid,'resolve','QA return assignment',t+interval '1 hour') returning id into event_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(event_id,new_worker,(c->>'returner')::uuid,'working','offered');
 update public.work_parts set assignee_id=(c->>'returner')::uuid,assigned_at=t+interval '1 hour',
  accepted_at=t+interval '2 hours',due_at=t+interval '3 hours',status='working',performance_eligible=false where id=pid;
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'returner')::uuid,'accept','QA returned employee acceptance',t+interval '2 hours');
 insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,status,reviewed_at)
 values(rid,pid,(c->>'returner')::uuid,t+interval '3 hours',t+interval '2 hours',t+interval '5 hours','auto_approved',t+interval '5 hours');

 -- The same task's ended late phase and later open late phase must count only once
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'owner')::uuid,'resolve','QA ended late phase',t+interval '4 hours') returning id into event_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(event_id,(c->>'returner')::uuid,new_worker,'working','offered');
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'owner')::uuid,'resolve','QA another return assignment',t+interval '5 hours') returning id into event_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(event_id,new_worker,(c->>'returner')::uuid,'offered','offered');
 update public.work_parts set assigned_at=t+interval '5 hours',accepted_at=t+interval '6 hours',due_at=t+interval '7 hours' where id=pid;
 insert into public.work_events(request_id,part_id,actor,kind,note,created_at)
 values(rid,pid,(c->>'returner')::uuid,'accept','QA open late phase',t+interval '6 hours');
 insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,status,reviewed_at)
 values(rid,pid,(c->>'returner')::uuid,t+interval '7 hours',t+interval '6 hours',t+interval '9 hours','auto_approved',t+interval '9 hours');

 -- Exercise the real mutation and capture trigger instead of assuming their timestamp contract
 pid=pg_temp.overview_part(worker,null,null,null,null);
 select request_id into rid from public.work_parts where id=pid;
 select version into v from public.work_requests where id=rid;
 perform set_config('request.jwt.claims',(c->'worker_claims')::text,true);
 perform public.work_action('accept',jsonb_build_object('request_id',rid,'part_id',pid,'version',v,'due_at',now()+interval '1 day'));
 select created_at into accepted_event from public.work_events where part_id=pid and kind='accept' and actor=worker order by id desc limit 1;
 select proposed_at into captured_proposal from provision_private.work_due_reviews where part_id=pid and proposed_by=worker order by proposed_at desc limit 1;
 if accepted_event is null or captured_proposal is null or accepted_event is distinct from captured_proposal then
  raise exception 'QA real accept event and deadline capture timestamps differ';
 end if;
 perform set_config('request.jwt.claims','{}',true);
end $tasks$;

set local role authenticated;
do $assertions$
declare c jsonb=current_setting('qa.team_overview')::jsonb; day date=(c->>'day')::date;
 data jsonb; person jsonb; next_day jsonb; forbidden boolean; label text; t timestamptz=(c->>'start')::timestamptz;
begin
 perform set_config('request.jwt.claims',(c->'owner_claims')::text,true);
 data=public.work_team_overview(day,day);
 if (data#>>'{period,start_at}')::timestamptz is distinct from t
  or (data#>>'{period,end_at}')::timestamptz is distinct from t+interval '1 day'
  or data#>>'{period,timezone}'<>'Asia/Riyadh' or (data#>>'{period,days}')::integer<>1 then
  raise exception 'QA incorrect Riyadh inclusive day bounds';
 end if;
 select value into person from jsonb_array_elements(data->'people') where value->>'id'=c->>'worker';
 if person is null or (person->>'received_count')::integer<>5 or (person->>'delivered_count')::integer<>3
  or (person->>'late_count')::integer<>2 or (person->>'late_open_count')::integer<>1
  or (person->>'late_delivered_count')::integer<>1 then
  raise exception 'QA acceptance submission or own-deadline counts incorrect %',person;
 end if;
 if jsonb_array_length(person->'departments')<>1 or jsonb_array_length(person->'responsible_departments')<>1 then
  raise exception 'QA department responsibilities missing';
 end if;
 next_day=public.work_team_overview(day+1,day+1);
 select value into person from jsonb_array_elements(next_day->'people') where value->>'id'=c->>'worker';
 if person is null or (person->>'received_count')::integer<>1 or (person->>'delivered_count')::integer<>2 then
  raise exception 'QA calendar end boundary or revision deduplication incorrect %',person;
 end if;
 select value into person from jsonb_array_elements(data->'people') where value->>'id'=c->>'old_worker';
 if person is null or (person->>'received_count')::integer<>0 or (person->>'delivered_count')::integer<>1
  or (person->>'late_count')::integer<>2 or (person->>'late_ended_count')::integer<>1
  or (person->>'late_delivered_count')::integer<>1 or (person->>'late_open_count')::integer<>0 then
  raise exception 'QA previous author lost credit or retained reassigned duty %',person;
 end if;
 select value into person from jsonb_array_elements(data->'people') where value->>'id'=c->>'new_worker';
 if person is null or (person->>'received_count')::integer<>2 or (person->>'delivered_count')::integer<>1 or (person->>'late_count')::integer<>0 then
  raise exception 'QA new employee inherited an old deadline or submission %',person;
 end if;
 select value into person from jsonb_array_elements(data->'people') where value->>'id'=c->>'returner';
 if person is null or (person->>'received_count')::integer<>1 or (person->>'delivered_count')::integer<>0
  or (person->>'late_count')::integer<>1 or (person->>'late_ended_count')::integer<>0
  or (person->>'late_open_count')::integer<>1 or (person->>'late_delivered_count')::integer<>0 then
  raise exception 'QA returned employee deadline was hidden by their previous assignment %',person;
 end if;
 foreach label in array array['zero','pending'] loop
  select value into person from jsonb_array_elements(data->'people') where value->>'id'=c->>label;
  if person is null or (person->>'received_count')::integer<>0 or (person->>'delivered_count')::integer<>0
   or (person->>'late_count')::integer<>0 or person->>'performance_score' is not null
   or not (person->>'insufficient_data')::boolean then
   raise exception 'QA zero or pending employee missing or credited % %',label,person;
  end if;
 end loop;
 select value into person from jsonb_array_elements(data->'people') where value->>'id'=c->>'rater';
 if person is null or (person->>'received_count')::integer<>0 or (person->>'delivered_count')::integer<>6
  or (person->>'scored_completed_count')::integer<>5 or (person->>'completed_points')::numeric<>10
  or (person->>'performance_score')::integer<>100 or (person->>'insufficient_data')::boolean then
  raise exception 'QA carry-in completion rating or reassignment scoring guard incorrect %',person;
 end if;
 if exists(select 1 from jsonb_array_elements(data->'people') item where
  (item->>'late_count')::integer is distinct from (item->>'late_open_count')::integer
   +(item->>'late_delivered_count')::integer+(item->>'late_ended_count')::integer) then
  raise exception 'QA late breakdown must be complete and mutually exclusive';
 end if;

 perform set_config('request.jwt.claims',(c->'admin_claims')::text,true);
 perform public.work_team_overview(day,day);
 foreach label in array array['worker'] loop
  perform set_config('request.jwt.claims',(c->(label||'_claims'))::text,true);
  forbidden=false;
  begin perform public.work_team_overview(day,day); exception when insufficient_privilege then forbidden=true; end;
  if not forbidden then raise exception 'QA non-owner can read team overview %',label; end if;
 end loop;
 perform set_config('request.jwt.claims',jsonb_set(c->'owner_claims','{session_id}',to_jsonb(gen_random_uuid()))::text,true);
 forbidden=false;
 begin perform public.work_team_overview(day,day); exception when insufficient_privilege then forbidden=true; end;
 if not forbidden then raise exception 'QA inactive owner session can read overview'; end if;
 perform set_config('request.jwt.claims',(c->'owner_claims')::text,true);
 forbidden=false;
 begin perform public.work_team_overview(day,day-1); exception when invalid_parameter_value then forbidden=true; end;
 if not forbidden then raise exception 'QA reversed period accepted'; end if;
 forbidden=false;
 begin perform public.work_team_overview(null,day); exception when invalid_parameter_value then forbidden=true; end;
 if not forbidden then raise exception 'QA null period accepted'; end if;
 forbidden=false;
 begin perform public.work_team_overview('-infinity'::date,day); exception when invalid_parameter_value then forbidden=true; end;
 if not forbidden then raise exception 'QA infinite period accepted'; end if;
 forbidden=false;
 begin perform public.work_team_overview((now() at time zone 'Asia/Riyadh')::date+1,(now() at time zone 'Asia/Riyadh')::date+1);
 exception when invalid_parameter_value then forbidden=true; end;
 if not forbidden then raise exception 'QA future period accepted'; end if;
 forbidden=false;
 begin perform public.work_team_overview(day-3661,day); exception when invalid_parameter_value then forbidden=true; end;
 if not forbidden then raise exception 'QA oversized period accepted'; end if;
 data=public.work_team_overview(day-3660,day);
 if (data#>>'{period,days}')::integer is distinct from 3661 then
  raise exception 'QA maximum supported period rejected or counted incorrectly';
 end if;
end $assertions$;
reset role;
do $privileges$
begin
 if has_function_privilege('anon','public.work_team_overview(date,date)','execute') then
  raise exception 'QA anonymous execute grant leaked';
 end if;
end $privileges$;
select 'team_overview_regression_passed' as result;
rollback;
