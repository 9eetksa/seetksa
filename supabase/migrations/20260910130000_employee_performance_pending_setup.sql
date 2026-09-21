begin;

-- Administrators need pending employee accounts in the team roster while callers remain guarded
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
  select part.id,part.assignee_id,part.status,part.assigned_at,part.completed_at,part.target_minutes,
   part.effort_points,part.accountable_seconds,part.metrics_quality,part.performance_eligible,
   case when part.status in('offered','working','revision')
    then part.accountable_seconds+greatest(0,extract(epoch from (now()-part.state_started_at))::bigint)
    else part.accountable_seconds end as current_seconds
  from public.work_parts part
  join public.work_requests request on request.id=part.request_id
  join people person on person.id=part.assignee_id
  where part.assigned_at>=now()-make_interval(days=>period_days) and not request.test
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
   coalesce(round((avg(assignment.current_seconds/3600.0) filter(where assignment.completed_at is not null and assignment.performance_eligible))::numeric,1),0)::numeric as average_active_hours
  from people person left join assignments assignment on assignment.assignee_id=person.id
  group by person.id,person.name,person.job_title,person.pending_setup,person.capacity,person.departments,person.responsible_departments
 ), scored as (
  select aggregate.*,
   coalesce(least(100,round(100*aggregate.completed_points/nullif(least(aggregate.assigned_points,greatest(10::numeric,aggregate.capacity*5::numeric*(period_days/30.0))),0),0))::integer,0) as volume_score
  from aggregates aggregate
 ), rows as (
  select scored.*,
   (scored.completed_count<5 or scored.completed_points<10) as insufficient_data,
   case when scored.completed_count<5 or scored.completed_points<10 then null
    else round(scored.speed_score*.65+scored.volume_score*.35)::integer end as performance_score
  from scored
 )
 select jsonb_build_object(
  'period_days',period_days,'generated_at',now(),
  'summary',jsonb_build_object(
   'people',count(*),'completed',coalesce(sum(completed_count),0),'active',coalesce(sum(open_count),0),
   'average_score',round(avg(performance_score) filter(where not insufficient_data),0)
  ),
  'people',coalesce(jsonb_agg(jsonb_build_object(
   'id',id,'name',name,'role','employee','job_title',job_title,'pending_setup',pending_setup,
   'departments',departments,'responsible_departments',responsible_departments,
   'assigned_count',assigned_count,'completed_count',completed_count,'open_count',open_count,
   'assigned_points',assigned_points,'completed_points',completed_points,'speed_score',speed_score,
   'volume_score',volume_score,'performance_score',performance_score,
   'average_active_hours',average_active_hours,'insufficient_data',insufficient_data,
   'estimated_count',estimated_count
  ) order by name),'[]'::jsonb)
 ) into result from rows;
 return result;
end;
$$;
revoke all on function public.work_employee_performance(integer) from public,anon,authenticated;
grant execute on function public.work_employee_performance(integer) to authenticated;

notify pgrst,'reload schema';
commit;
