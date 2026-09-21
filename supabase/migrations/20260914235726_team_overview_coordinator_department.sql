begin;

-- Calendar reporting is separate from the existing rolling performance API
-- No workflow state, notification transport, membership or scoring guard is changed
create or replace function public.work_team_overview(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 start_at timestamptz; end_at timestamptz; as_of timestamptz;
 period_days integer; result jsonb;
begin
 if provision_private.work_role() is distinct from 'super_admin'
  or not provision_private.account_ready() then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_end<p_start or p_end>(now() at time zone 'Asia/Riyadh')::date or p_end-p_start>3660 then
  raise exception 'invalid_period' using errcode='22023';
 end if;
 start_at=p_start::timestamp at time zone 'Asia/Riyadh';
 end_at=(p_end+1)::timestamp at time zone 'Asia/Riyadh';
 as_of=least(end_at,now());
 period_days=p_end-p_start+1;

 with people as materialized (
  select employee.id,
   coalesce(nullif(btrim(profile.display_name),''),nullif(btrim(employee.raw_user_meta_data->>'display_name'),''),'موظف') as name,
   coalesce(nullif(btrim(employee.raw_app_meta_data->>'job_title'),''),'') as job_title,
   coalesce(employee.raw_app_meta_data->>'must_change_password','false')='true' as pending_setup,
   coalesce(staff.coordinator,false) as coordinator,
   coalesce(staff.capacity,5) as capacity,
   coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name,'member_role',membership.member_role)
    order by service.sort_order,service.name)
    from public.work_memberships membership join public.work_services service on service.id=membership.service_id
    where membership.user_id=employee.id),'[]'::jsonb) as departments,
   coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name)
    order by service.sort_order,service.name)
    from public.work_memberships membership join public.work_services service on service.id=membership.service_id
    where membership.user_id=employee.id and membership.member_role='lead'),'[]'::jsonb) as responsible_departments
  from auth.users employee
  left join public.account_profiles profile on profile.user_id=employee.id
  left join public.work_staff staff on staff.user_id=employee.id
  where employee.raw_app_meta_data->>'role'='employee' and not coalesce(employee.is_anonymous,false)
   and (employee.banned_until is null or employee.banned_until<now())
 ), parts as materialized (
  select part.*,request.status as request_status,request.updated_at as request_updated_at
  from public.work_parts part join public.work_requests request on request.id=part.request_id
  where not request.test
 ), acceptance_events as materialized (
  select event.id,event.part_id,event.actor as employee_id,event.created_at
  from public.work_events event join parts part on part.id=event.part_id and part.request_id=event.request_id
  join people person on person.id=event.actor and not person.pending_setup
  where event.kind='accept'
 ), received as (
  select employee_id,count(distinct part_id)::integer as received_count
  from acceptance_events where created_at>=start_at and created_at<end_at and created_at<=as_of
  group by employee_id
 ), acceptance_phases as (
  select acceptance.*,coalesce((
   select max(event.id) from public.work_events event
   join provision_private.work_assignment_history history on history.event_id=event.id
   where event.part_id=acceptance.part_id and event.id<acceptance.id
    and history.next_assignee=acceptance.employee_id
    and history.previous_assignee is distinct from history.next_assignee
  ),0) as assignment_phase
  from acceptance_events acceptance
 ), first_acceptances as materialized (
  -- Revisions in one assignment share a task but a return after another owner starts a new duty
  select distinct on(part_id,employee_id,assignment_phase) * from acceptance_phases
  order by part_id,employee_id,assignment_phase,created_at,id
 ), first_deliveries as materialized (
  -- A file batch and later revisions are one submitted task for each actual author
  -- Current assignee and administrative release/approval times cannot move this credit
  select delivery.part_id,delivery.uploaded_by as employee_id,min(delivery.created_at) as delivered_at
  from public.work_deliveries delivery join parts part on part.id=delivery.part_id and part.request_id=delivery.request_id
  join people person on person.id=delivery.uploaded_by and not person.pending_setup
  group by delivery.part_id,delivery.uploaded_by
 ), delivered as (
  select employee_id,count(*)::integer as delivered_count
  from first_deliveries where delivered_at>=start_at and delivered_at<end_at and delivered_at<=as_of
  group by employee_id
 ), commitments as materialized (
  select acceptance.*,review.proposed_due_at,ending.id as ending_event_id,ending.created_at as ended_at,
   delivery.delivered_at,
   part.request_status,part.request_updated_at
  from first_acceptances acceptance join parts part on part.id=acceptance.part_id
  -- The capture trigger records the same transaction timestamp as the accept event
  -- Ambiguous or missing history is unmeasured rather than inferred from mutable due_at
  left join lateral (
   select candidate.proposed_due_at from provision_private.work_due_reviews candidate
   where candidate.part_id=acceptance.part_id and candidate.proposed_by=acceptance.employee_id
    and candidate.proposed_at=acceptance.created_at and candidate.status in('approved','auto_approved')
    and (select count(*) from provision_private.work_due_reviews sibling
     where sibling.part_id=candidate.part_id and sibling.proposed_by=candidate.proposed_by
      and sibling.proposed_at=candidate.proposed_at)=1
  ) review on true
  left join lateral (
   select event.id,event.created_at from public.work_events event
   join provision_private.work_assignment_history history on history.event_id=event.id
   where event.part_id=acceptance.part_id and event.id>acceptance.id
    and history.previous_assignee=acceptance.employee_id
    and history.next_assignee is distinct from history.previous_assignee
   order by event.id limit 1
  ) ending on true
  left join lateral (
   select min(candidate.created_at) as delivered_at from public.work_deliveries candidate
   where candidate.part_id=acceptance.part_id and candidate.uploaded_by=acceptance.employee_id
    and candidate.created_at>=acceptance.created_at
    and (candidate.created_at>acceptance.created_at or exists(
     select 1 from public.work_events sent where sent.part_id=acceptance.part_id
      and sent.actor=acceptance.employee_id and sent.kind='deliver'
      and sent.created_at=candidate.created_at and sent.id>acceptance.id
    ))
    and (ending.id is null or candidate.created_at<ending.created_at or (
     candidate.created_at=ending.created_at and exists(
      select 1 from public.work_events sent where sent.part_id=acceptance.part_id
       and sent.actor=acceptance.employee_id and sent.kind='deliver'
       and sent.created_at=candidate.created_at and sent.id>acceptance.id and sent.id<ending.id
     )
    ))
  ) delivery on true
  -- Without a recorded assignment start or a reconcilable owner we cannot locate the duty historically
  where acceptance.assignment_phase>0
   and (ending.id is not null or part.assignee_id=acceptance.employee_id)
 ), late_tasks as (
  select employee_id,part_id,
   delivered_at is not null and delivered_at>proposed_due_at
    and delivered_at<end_at and delivered_at<=now() as late_delivered,
   (delivered_at is null or delivered_at>=end_at or delivered_at>now())
    and (ended_at is null or ended_at>=end_at or ended_at>now())
    and not(request_status in('completed','declined') and request_updated_at<end_at and request_updated_at<=now()) as late_open,
   (delivered_at is null or delivered_at>=end_at or delivered_at>now())
    and ((ended_at>proposed_due_at and ended_at<end_at and ended_at<=now())
     or (request_status in('completed','declined') and request_updated_at>proposed_due_at
      and request_updated_at<end_at and request_updated_at<=now())) as late_ended
  from commitments
  where proposed_due_at>=start_at and proposed_due_at<end_at and proposed_due_at<as_of
   and (ended_at is null or ended_at>proposed_due_at)
   and not(request_status in('completed','declined') and request_updated_at<=proposed_due_at)
 ), late_task_totals as (
  -- Multiple ownership phases still represent one task per employee in the table
  -- Classify each task once with outstanding then delivered then ended precedence
  select employee_id,part_id,bool_or(late_open) as late_open,
   bool_or(late_delivered) and not bool_or(late_open) as late_delivered,
   bool_or(late_ended) and not bool_or(late_open) and not bool_or(late_delivered) as late_ended
  from late_tasks group by employee_id,part_id
 ), late as (
  select employee_id,
   count(*) filter(where late_open or late_delivered or late_ended)::integer as late_count,
   count(*) filter(where late_open)::integer as late_open_count,
   count(*) filter(where late_delivered)::integer as late_delivered_count,
   count(*) filter(where late_ended)::integer as late_ended_count
  from late_task_totals group by employee_id
 ), rating_work as (
  -- Retain existing metric snapshots and reassignment exclusions
  -- Include carry-in work completed in this period rather than filtering it out by assignment date
  select part.assignee_id as employee_id,part.completed_at,part.effort_points,part.target_minutes,
   part.accountable_seconds::numeric as actual_seconds,part.performance_eligible,part.metrics_quality='estimated' as estimated
  from parts part join people person on person.id=part.assignee_id and not person.pending_setup
  where (part.assigned_at>=start_at and part.assigned_at<end_at and part.assigned_at<=as_of)
   or (part.completed_at>=start_at and part.completed_at<end_at and part.completed_at<=as_of)
  union all
  select task.assignee_id,task.completed_at,task.effort_points,task.target_minutes,
   task.actual_minutes*60,true,true
  from provision_private.work_coordinator_tasks() task
  join public.work_requests request on request.id=task.request_id and not request.test
  join people person on person.id=task.assignee_id and not person.pending_setup
  where task.status<>'cancelled' and (
   (task.opened_at>=start_at and task.opened_at<end_at and task.opened_at<=as_of)
   or (task.completed_at>=start_at and task.completed_at<end_at and task.completed_at<=as_of)
  )
 ), rating_samples as (
  select *,performance_eligible and completed_at>=start_at and completed_at<end_at and completed_at<=as_of as completed_in_period
  from rating_work
 ), ratings as (
  select person.id,
   count(sample.employee_id) filter(where sample.completed_in_period)::integer as scored_completed_count,
   coalesce(sum(sample.effort_points) filter(where sample.performance_eligible),0) as assigned_points,
   coalesce(sum(sample.effort_points) filter(where sample.completed_in_period),0) as completed_points,
   count(sample.employee_id) filter(where sample.completed_in_period and sample.estimated)::integer as estimated_count,
   coalesce(round(sum(sample.effort_points*least(1::numeric,sample.target_minutes/greatest(1::numeric,sample.actual_seconds/60)))
    filter(where sample.completed_in_period)/nullif(sum(sample.effort_points) filter(where sample.completed_in_period),0)*100),0)::integer as speed_score
  from people person left join rating_samples sample on sample.employee_id=person.id
  group by person.id
 ), volumes as (
  select ratings.*,person.pending_setup,
   least(100,coalesce(round(100*ratings.completed_points/nullif(least(ratings.assigned_points,
    greatest(10::numeric,person.capacity*5::numeric*(period_days/30.0))),0)),0))::integer as volume_score
  from ratings join people person on person.id=ratings.id
 ), scores as (
  select *,pending_setup or scored_completed_count<5 or completed_points<10 as insufficient_data,
   case when pending_setup or scored_completed_count<5 or completed_points<10 then null
    else round(speed_score*.65+volume_score*.35)::integer end as performance_score
  from volumes
 ), rows as (
  select person.*,coalesce(received.received_count,0) as received_count,
   coalesce(delivered.delivered_count,0) as delivered_count,coalesce(late.late_count,0) as late_count,
   coalesce(late.late_open_count,0) as late_open_count,coalesce(late.late_delivered_count,0) as late_delivered_count,
   coalesce(late.late_ended_count,0) as late_ended_count,
   score.performance_score,score.insufficient_data,score.estimated_count,score.scored_completed_count,
   score.completed_points,score.speed_score,score.volume_score
  from people person join scores score on score.id=person.id
  left join received on received.employee_id=person.id
  left join delivered on delivered.employee_id=person.id
  left join late on late.employee_id=person.id
 )
 select jsonb_build_object(
  'period',jsonb_build_object('start_date',p_start,'end_date',p_end,'start_at',start_at,'end_at',end_at,
   'timezone','Asia/Riyadh','days',period_days),
  'generated_at',now(),
  'metric_policy',jsonb_build_object('received','employee_acceptance','delivered','first_employee_submission',
   'late','approved_employee_deadline_in_period','rating','existing_weighted_performance'),
  'summary',jsonb_build_object('people',count(*),'received',coalesce(sum(received_count),0),
   'delivered',coalesce(sum(delivered_count),0),'late',coalesce(sum(late_count),0),
   'average_score',round(avg(performance_score) filter(where not insufficient_data),0)),
  'people',coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'name',name,'job_title',job_title,'pending_setup',pending_setup,'coordinator',coordinator,
   'departments',departments,'responsible_departments',responsible_departments,
   'received_count',received_count,'delivered_count',delivered_count,'late_count',late_count,
   'late_open_count',late_open_count,'late_delivered_count',late_delivered_count,
   'late_ended_count',late_ended_count,
   'performance_score',performance_score,'insufficient_data',insufficient_data,'estimated_count',estimated_count,
   'scored_completed_count',scored_completed_count,'completed_points',completed_points,
   'speed_score',speed_score,'volume_score',volume_score
  ) order by name,id),'[]'::jsonb)
 ) into result from rows;
 return result;
end;
$$;
revoke all on function public.work_team_overview(date,date) from public,anon,authenticated;
grant execute on function public.work_team_overview(date,date) to authenticated;
comment on function public.work_team_overview(date,date) is
 'Super admin calendar overview with Riyadh day boundaries author credited first submissions approved employee deadlines and existing performance eligibility';

notify pgrst,'reload schema';
commit;
