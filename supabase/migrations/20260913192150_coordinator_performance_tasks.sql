begin;

-- Coordination is operational work separate from producing a department output
-- One accepted intake and one decision per delivery batch or client revision earn one point
-- Review timing uses the existing three hour decision window as a scoring target only
-- Intake timing uses the request deadline and deducts recorded client input waiting
-- No workflow state or notification function is changed by this read model
-- Rollback: restore the previous work_employee_performance definition and drop this helper
create or replace function provision_private.work_coordinator_tasks(p_request uuid default null)
returns table(
 task_key text,kind text,request_id uuid,part_id uuid,delivery_id uuid,
 assignee_id uuid,completed_by uuid,opened_at timestamptz,completed_at timestamptz,
 status text,target_minutes integer,effort_points numeric,actual_minutes numeric,estimated boolean
)
language sql stable set search_path='' as $$
 with requests as materialized (
  select r.* from public.work_requests r where r.status<>'draft' and (p_request is null or r.id=p_request)
 ), intake as (
  select 'intake:'||r.id::text as task_key,'intake'::text as kind,r.id as request_id,null::uuid as part_id,null::uuid as delivery_id,
   coalesce(decision.actor,r.coordinator_id,r.intake_action_by) as assignee_id,decision.actor as completed_by,
   coalesce(r.submitted_at,r.created_at) as opened_at,decision.created_at as completed_at,
   case when decision.id is not null then 'completed' when r.status='declined' then 'cancelled'
    when r.status='needs_info' then 'waiting' when r.status in('new','active') then 'open' else 'cancelled' end as status,
   greatest(1,ceil(extract(epoch from(coalesce(r.intake_due_at,provision_private.work_intake_deadline(coalesce(r.submitted_at,r.created_at)))-coalesce(r.submitted_at,r.created_at)))/60))::integer as target_minutes,
   1::numeric as effort_points,
   greatest(0,extract(epoch from(coalesce(decision.created_at,now())-coalesce(r.submitted_at,r.created_at)))/60-coalesce(paused.minutes,0))::numeric as actual_minutes,
   true as estimated
  from requests r
  left join lateral (
   select e.id,e.actor,e.created_at from public.work_events e
   where e.request_id=r.id and e.kind in('intake','assign','decline_intake') and e.actor is not null
   order by e.id limit 1
  ) decision on true
  left join lateral (
   select sum(greatest(0,extract(epoch from(least(signal.next_at,coalesce(decision.created_at,now()))-greatest(signal.created_at,coalesce(r.submitted_at,r.created_at)))))/60) as minutes
   from (
    select e.kind,e.created_at,lead(e.created_at,1,coalesce(decision.created_at,now())) over(order by e.id) as next_at
    from public.work_events e where e.request_id=r.id and e.part_id is null
     and e.kind in('request_info','request_attachments','supply_info') and (decision.id is null or e.id<decision.id)
   ) signal where signal.kind in('request_info','request_attachments')
  ) paused on true
 ), batches as materialized (
  select distinct on(d.batch_id) d.*
  from public.work_deliveries d join requests r on r.id=d.request_id
  order by d.batch_id,d.created_at,d.id
 ), delivery_reviews as (
  select 'delivery_review:'||d.batch_id::text,'delivery_review'::text,d.request_id,d.part_id,d.id,
   coalesce(decision.actor,r.coordinator_id),decision.actor,d.created_at,decision.decided_at,
   case when decision.decided_at is not null then 'completed'
    when r.status='active' and part.status='review' and d.status='pending' then 'open'
    else 'cancelled' end,
   180,1::numeric,greatest(0,extract(epoch from(coalesce(decision.decided_at,now())-d.created_at))/60)::numeric,true
  from batches d join requests r on r.id=d.request_id
  join public.work_parts part on part.id=d.part_id and part.request_id=d.request_id
  left join lateral (
   select candidate.decided_at,candidate.actor from (
    values(d.released_at,d.released_by),(d.internal_shared_at,d.internal_shared_by),
     (case when part.status='forwarded' and part.forwarded_at>=d.created_at then part.forwarded_at end,part.forwarded_by)
   ) candidate(decided_at,actor)
   where candidate.decided_at is not null and candidate.actor is not null
   order by candidate.decided_at limit 1
  ) decision on true
 ), revision_events as (
  -- The assignment audit identifies the client's decision even after later revisions
  -- Event IDs preserve ordering when a transaction gives several actions the same timestamp
  select e.*,lead(e.id) over(partition by e.part_id order by e.id) as next_review_id,
   history.status_after
  from public.work_events e join requests r on r.id=e.request_id
  join provision_private.work_assignment_history history on history.event_id=e.id
  where e.kind='review'
 ), revision_reviews as (
  -- Review events retain an exact part but no immutable delivery foreign key
  -- Navigate the part rather than guessing a batch when event timestamps are equal
  select 'revision_review:'||e.id::text,'revision_review'::text,e.request_id,e.part_id,null::uuid,
   coalesce(decision.actor,r.coordinator_id),decision.actor,e.created_at,decision.created_at,
   case when decision.id is not null then 'completed'
    when r.status='active' and part.status='revision' and e.next_review_id is null then 'open'
    else 'cancelled' end,
   180,1::numeric,greatest(0,extract(epoch from(coalesce(decision.created_at,now())-e.created_at))/60)::numeric,true
  from revision_events e join requests r on r.id=e.request_id
  join public.work_parts part on part.id=e.part_id and part.request_id=e.request_id
  left join lateral (
   select route.id,route.actor,route.created_at from public.work_events route
   where route.request_id=e.request_id and route.part_id=e.part_id and route.kind='route_revision'
    and route.id>e.id and (e.next_review_id is null or route.id<e.next_review_id) and route.actor is not null
   order by route.id limit 1
  ) decision on true
  where e.status_after='revision'
 ), tasks as (
  select * from intake union all select * from delivery_reviews union all select * from revision_reviews
 )
 select task.task_key,task.kind,task.request_id,task.part_id,task.delivery_id,
  -- Historical credit belongs to the actor even after their responsibilities change
  -- Open work returns to the shared coordinator queue when its owner cannot act
  case when task.status not in('open','waiting') or task.completed_at is not null or owner.id is not null
   then task.assignee_id else null end,
  task.completed_by,task.opened_at,task.completed_at,task.status,task.target_minutes,
  task.effort_points,task.actual_minutes,task.estimated
 from tasks task left join auth.users owner on owner.id=task.assignee_id
  and provision_private.account_available(owner.id)
  and coalesce(owner.raw_app_meta_data->>'must_change_password','false')<>'true'
  and (owner.raw_app_meta_data->>'role' in('admin','super_admin')
   or (owner.raw_app_meta_data->>'role'='employee'
    and exists(select 1 from public.work_staff staff where staff.user_id=owner.id and staff.coordinator)))
$$;
revoke all on function provision_private.work_coordinator_tasks(uuid) from public,anon,authenticated;
comment on function provision_private.work_coordinator_tasks(uuid) is
 'Private read model for intake delivery review and revision routing with one point per completed coordination task and estimated queue duration excluding client input waiting';

create or replace function public.work_employee_performance(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period_days integer:=least(greatest(coalesce(p_days,30),7),365); role_name text:=provision_private.work_role(); result jsonb;
begin
 if role_name not in('employee','admin','super_admin') or not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 with people as (
  select employee.id,
   coalesce(nullif(btrim(profile.display_name),''),nullif(btrim(employee.raw_user_meta_data->>'display_name'),''),'موظف') as name,
   coalesce(nullif(btrim(employee.raw_app_meta_data->>'job_title'),''),'') as job_title,
   coalesce(employee.raw_app_meta_data->>'must_change_password','false')='true' as pending_setup,
   coalesce(staff_row.capacity,5) as capacity,
   coalesce((
    select jsonb_agg(jsonb_build_object(
     'id',service.id,'name',service.name,'member_role',membership.member_role
    ) order by service.sort_order,service.name)
    from public.work_memberships membership
    join public.work_services service on service.id=membership.service_id
    where membership.user_id=employee.id
   ),'[]'::jsonb) as departments,
   coalesce((
    select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name) order by service.sort_order,service.name)
    from public.work_memberships membership
    join public.work_services service on service.id=membership.service_id
    where membership.user_id=employee.id and membership.member_role='lead'
   ),'[]'::jsonb) as responsible_departments
  from auth.users employee
  left join public.account_profiles profile on profile.user_id=employee.id
  left join public.work_staff staff_row on staff_row.user_id=employee.id
  where employee.raw_app_meta_data->>'role'='employee'
   and not coalesce(employee.is_anonymous,false)
   and (employee.banned_until is null or employee.banned_until<now())
   and (role_name in('admin','super_admin') or employee.id=auth.uid())
 ), assignments as (
  select part.id::text as id,part.assignee_id,part.status,part.assigned_at,part.completed_at,part.target_minutes,
   part.effort_points,part.accountable_seconds,part.metrics_quality,part.performance_eligible,
   case when part.status in('offered','working','revision')
    then part.accountable_seconds+greatest(0,extract(epoch from (now()-part.state_started_at))::bigint)
    else part.accountable_seconds end as current_seconds,'department'::text as work_kind
  from public.work_parts part
  join public.work_requests request on request.id=part.request_id
  join people person on person.id=part.assignee_id and not person.pending_setup
  where part.assigned_at>=now()-make_interval(days=>period_days) and not request.test
  union all
  select task.task_key,task.assignee_id,task.status,task.opened_at,task.completed_at,task.target_minutes,
   task.effort_points,round(task.actual_minutes*60)::bigint,'estimated'::text,true,
   round(task.actual_minutes*60)::bigint,task.kind
  from provision_private.work_coordinator_tasks() task
  join public.work_requests request on request.id=task.request_id and not request.test
  join people person on person.id=task.assignee_id and not person.pending_setup
  where task.opened_at>=now()-make_interval(days=>period_days) and task.status<>'cancelled'
 ), aggregates as (
  select person.id,person.name,person.job_title,person.pending_setup,person.capacity,person.departments,person.responsible_departments,
   count(assignment.id)::integer as assigned_count,
   count(assignment.id) filter(where assignment.completed_at is not null and assignment.performance_eligible)::integer as completed_count,
   count(assignment.id) filter(where assignment.completed_at is null)::integer as open_count,
   count(assignment.id) filter(where assignment.metrics_quality='estimated' and assignment.completed_at is not null and assignment.performance_eligible)::integer as estimated_count,
   coalesce(sum(assignment.effort_points) filter(where assignment.performance_eligible),0)::numeric as assigned_points,
   coalesce(sum(assignment.effort_points) filter(where assignment.completed_at is not null and assignment.performance_eligible),0)::numeric as completed_points,
   coalesce(round((sum(assignment.effort_points*least(1::numeric,assignment.target_minutes::numeric/greatest(1::numeric,assignment.current_seconds::numeric/60)))
    filter(where assignment.completed_at is not null and assignment.performance_eligible)
    /nullif(sum(assignment.effort_points) filter(where assignment.completed_at is not null and assignment.performance_eligible),0)*100)::numeric,0),0)::integer as speed_score,
   coalesce(round((avg(assignment.current_seconds/3600.0) filter(where assignment.completed_at is not null and assignment.performance_eligible))::numeric,1),0)::numeric as average_active_hours,
   count(assignment.id) filter(where assignment.work_kind<>'department')::integer as coordinator_assigned,
   count(assignment.id) filter(where assignment.work_kind<>'department' and assignment.completed_at is not null)::integer as coordinator_completed,
   count(assignment.id) filter(where assignment.work_kind<>'department' and assignment.completed_at is null)::integer as coordinator_open,
   coalesce(sum(assignment.effort_points) filter(where assignment.work_kind<>'department'),0)::numeric as coordinator_assigned_points,
   coalesce(sum(assignment.effort_points) filter(where assignment.work_kind<>'department' and assignment.completed_at is not null),0)::numeric as coordinator_completed_points,
   count(assignment.id) filter(where assignment.work_kind='intake' and assignment.completed_at is not null)::integer as intake_completed,
   count(assignment.id) filter(where assignment.work_kind='delivery_review' and assignment.completed_at is not null)::integer as delivery_review_completed,
   count(assignment.id) filter(where assignment.work_kind='revision_review' and assignment.completed_at is not null)::integer as revision_review_completed,
   coalesce(round((avg(assignment.current_seconds/3600.0) filter(where assignment.work_kind<>'department' and assignment.completed_at is not null))::numeric,1),0)::numeric as coordinator_average_hours,
   count(assignment.id) filter(where assignment.work_kind='department')::integer as department_assigned,
   count(assignment.id) filter(where assignment.work_kind='department' and assignment.completed_at is not null and assignment.performance_eligible)::integer as department_completed,
   count(assignment.id) filter(where assignment.work_kind='department' and assignment.completed_at is null)::integer as department_open,
   coalesce(sum(assignment.effort_points) filter(where assignment.work_kind='department' and assignment.performance_eligible),0)::numeric as department_assigned_points,
   coalesce(sum(assignment.effort_points) filter(where assignment.work_kind='department' and assignment.completed_at is not null and assignment.performance_eligible),0)::numeric as department_completed_points
  from people person left join assignments assignment on assignment.assignee_id=person.id
  group by person.id,person.name,person.job_title,person.pending_setup,person.capacity,person.departments,person.responsible_departments
 ), scored as (
  select aggregate.*,
   coalesce(least(100,round(100*aggregate.completed_points/nullif(least(aggregate.assigned_points,greatest(10::numeric,aggregate.capacity*5::numeric*(period_days/30.0))),0),0))::integer,0) as volume_score
  from aggregates aggregate
 ), rows as (
  select scored.*,
   (scored.pending_setup or scored.completed_count<5 or scored.completed_points<10) as insufficient_data,
   case when scored.pending_setup or scored.completed_count<5 or scored.completed_points<10 then null
    else round(scored.speed_score*.65+scored.volume_score*.35)::integer end as performance_score
  from scored
 )
 select jsonb_build_object(
  'period_days',period_days,'generated_at',now(),
  'coordination_policy',jsonb_build_object('effort_points',1,'review_target_minutes',180,
   'intake_target','request_deadline','timing','estimated_excludes_client_waiting'),
  'summary',jsonb_build_object(
   'people',count(*),'completed',coalesce(sum(completed_count),0),'active',coalesce(sum(open_count),0),
   'average_score',round(avg(performance_score) filter(where not pending_setup and not insufficient_data),0)
  ),
  'people',coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'name',name,'role','employee','job_title',job_title,'pending_setup',pending_setup,
   'departments',departments,'responsible_departments',responsible_departments,
   'assigned_count',assigned_count,'completed_count',completed_count,'open_count',open_count,
   'assigned_points',assigned_points,'completed_points',completed_points,'speed_score',speed_score,
   'volume_score',volume_score,'performance_score',performance_score,
   'average_active_hours',average_active_hours,'insufficient_data',insufficient_data,
   'estimated_count',estimated_count,
   'coordination',jsonb_build_object(
    'assigned_count',coordinator_assigned,'completed_count',coordinator_completed,'open_count',coordinator_open,
    'assigned_points',coordinator_assigned_points,'completed_points',coordinator_completed_points,
    'intake_completed',intake_completed,'delivery_review_completed',delivery_review_completed,'revision_review_completed',revision_review_completed,
    'average_active_hours',coordinator_average_hours,'estimated_count',coordinator_completed
   ),
   'department_work',jsonb_build_object(
    'assigned_count',department_assigned,'completed_count',department_completed,'open_count',department_open,
    'assigned_points',department_assigned_points,'completed_points',department_completed_points
   )
  ) order by name),'[]'::jsonb)
 ) into result from rows;
 return result;
end;
$$;
revoke all on function public.work_employee_performance(integer) from public,anon,authenticated;
grant execute on function public.work_employee_performance(integer) to authenticated;

notify pgrst,'reload schema';
commit;
