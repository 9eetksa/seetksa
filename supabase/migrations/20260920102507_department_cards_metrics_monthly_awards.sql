begin;

-- Department scores measure actual department work rather than employee averages
create function public.work_department_performance(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz; end_at timestamptz; result jsonb;
begin
 if not provision_private.account_ready() or not(provision_private.work_manager() or coalesce(provision_private.allowed('departments.manage'),false)) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start
  or p_end>(now() at time zone 'Asia/Riyadh')::date or p_end-p_start>3660 then raise exception 'invalid_period'; end if;
 start_at=p_start::timestamp at time zone 'Asia/Riyadh';
 end_at=(p_end+1)::timestamp at time zone 'Asia/Riyadh';
 with samples as (
  select part.*,part.completed_at>=start_at and part.completed_at<end_at and part.completed_at<=now() as finished
  from public.work_parts part join public.work_requests request on request.id=part.request_id
  where not request.test and part.performance_eligible and not part.output_cancelled
   and ((part.assigned_at>=start_at and part.assigned_at<end_at and part.assigned_at<=now())
     or (part.completed_at>=start_at and part.completed_at<end_at and part.completed_at<=now()))
 ), totals as (
  select service.id,service.name,
   count(sample.id)::int assigned_count,count(sample.id) filter(where sample.finished)::int completed_count,
   coalesce(sum(sample.effort_points),0) assigned_points,
   coalesce(sum(sample.effort_points) filter(where sample.finished),0) completed_points,
   count(sample.id) filter(where sample.finished and sample.metrics_quality='estimated')::int estimated_count,
   round(sum(sample.effort_points*least(1::numeric,sample.target_minutes::numeric/greatest(1::numeric,sample.accountable_seconds::numeric/60)))
    filter(where sample.finished)/nullif(sum(sample.effort_points) filter(where sample.finished),0)*100)::int speed_score
  from public.work_services service left join samples sample on sample.service_id=service.id group by service.id,service.name
 ), scores as (
  select *,least(100,round(completed_points/nullif(assigned_points,0)*100))::int productivity_score,
   completed_count<5 or completed_points<10 as insufficient_data from totals
 )
 select jsonb_build_object('period',jsonb_build_object('start_date',p_start,'end_date',p_end,'timezone','Asia/Riyadh'),
  'departments',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'assigned_count',assigned_count,
   'completed_count',completed_count,'completed_points',completed_points,'assigned_points',assigned_points,
   'speed_score',speed_score,'productivity_score',productivity_score,'estimated_count',estimated_count,
   'insufficient_data',insufficient_data,'performance_score',case when not insufficient_data then round(speed_score*.65+productivity_score*.35)::int end)
   order by name,id),'[]'::jsonb)) into result from scores;
 return result;
end $$;
revoke all on function public.work_department_performance(date,date) from public,anon,authenticated;
grant execute on function public.work_department_performance(date,date) to authenticated;

-- Reuse the established calendar employee score including routing penalties
create function public.work_employee_of_month(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare first_day date; last_day date; today date=(now() at time zone 'Asia/Riyadh')::date; report jsonb; winners jsonb;
begin
 if not provision_private.account_ready() or not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_month is not null and (not isfinite(p_month) or p_month>today) then raise exception 'invalid_period'; end if;
 first_day=date_trunc('month',coalesce(p_month,today))::date;
 last_day=least((first_day+interval '1 month'-interval '1 day')::date,today);
 report=public.work_team_overview(first_day,last_day);
 select coalesce(jsonb_agg(person||jsonb_build_object('rank',place) order by place),'[]'::jsonb) into winners
 from (select value as person,row_number() over(order by (value->>'performance_score')::numeric desc,
  (value->>'completed_points')::numeric desc,(value->>'speed_score')::numeric desc,value->>'id') as place
  from jsonb_array_elements(report->'people') where value->>'performance_score' is not null
   and not coalesce((value->>'pending_setup')::boolean,true) and not coalesce((value->>'insufficient_data')::boolean,true)
  order by place limit 3) ranked;
 return jsonb_build_object('period',report->'period','people',winners,'provisional',last_day=today);
end $$;
revoke all on function public.work_employee_of_month(date) from public,anon,authenticated;
grant execute on function public.work_employee_of_month(date) to authenticated;
notify pgrst,'reload schema';
commit;
