begin;

-- Immutable routing attribution is captured when the employee reports the issue
create table provision_private.work_routing_decisions(
 escalation_id uuid primary key references public.work_escalations(id),
 request_id uuid not null references public.work_requests(id),
 part_id uuid not null references public.work_parts(id),
 source_service_id uuid not null references public.work_services(id),
 routing_event_id bigint references public.work_events(id),
 coordinator_id uuid references auth.users(id),
 decision text check(decision in('keep','reassign')),
 target_service_id uuid references public.work_services(id),
 resolved_by uuid references auth.users(id),
 explanation text,
 resolved_at timestamptz,
 event_id bigint unique references public.work_events(id),
 penalty_points smallint not null default 0 check(penalty_points in(0,1)),
 check(penalty_points=0 or (decision='reassign' and coordinator_id is not null and source_service_id<>target_service_id and resolved_at is not null))
);
alter table provision_private.work_routing_decisions enable row level security;
revoke all on table provision_private.work_routing_decisions from public,anon,authenticated;
create index work_routing_penalty_period on provision_private.work_routing_decisions(coordinator_id,resolved_at) where penalty_points=1;

create function provision_private.work_capture_routing_decision(p_escalation uuid) returns void
language sql security definer set search_path='' as $$
 insert into provision_private.work_routing_decisions(escalation_id,request_id,part_id,source_service_id,routing_event_id,coordinator_id)
 select issue.id,issue.request_id,task.id,task.service_id,route.id,
  case when staff.coordinator and route.kind in('assign','intake','handoff','route_revision') then route.actor end
 from public.work_escalations issue join public.work_parts task on task.id=issue.part_id and task.request_id=issue.request_id
 left join lateral (
  select event.id,event.actor,event.kind from public.work_events event
  where event.request_id=issue.request_id and event.part_id=issue.part_id and event.created_at<=issue.created_at
   and event.kind in('assign','intake','handoff','delegate','resolve','route_revision','output_request')
  order by event.id desc limit 1
 ) route on true
 left join public.work_staff staff on staff.user_id=route.actor
 where issue.id=p_escalation and issue.kind='routing' and issue.status='open'
 on conflict(escalation_id) do nothing
$$;
revoke all on function provision_private.work_capture_routing_decision(uuid) from public,anon,authenticated;
create function provision_private.work_capture_routing_report() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform provision_private.work_capture_routing_decision(new.id);
 return null;
end $$;
revoke all on function provision_private.work_capture_routing_report() from public,anon,authenticated;
create trigger work_capture_routing_report after insert on public.work_escalations
for each row when(new.kind='routing') execute function provision_private.work_capture_routing_report();
-- Existing open reports can use exact assignment events No penalties for historical decisions
select provision_private.work_capture_routing_decision(id) from public.work_escalations where kind='routing' and status='open';

create function provision_private.work_routing_penalty_total(p_employee uuid,p_start timestamptz,p_end timestamptz)
returns integer language sql stable security definer set search_path='' as $$
 select coalesce(sum(penalty_points),0)::integer from provision_private.work_routing_decisions
 where coordinator_id=p_employee and penalty_points=1 and resolved_at>=p_start and resolved_at<p_end
$$;
revoke all on function provision_private.work_routing_penalty_total(uuid,timestamptz,timestamptz) from public,anon,authenticated;

create function provision_private.work_routing_decision_message(p_event bigint) returns text
language sql stable security definer set search_path='' as $$
 select case when decision.decision='keep' then 'أبقت الإدارة المهمة لدى قسم ' else 'وجهت الإدارة المهمة إلى قسم ' end
  ||regexp_replace(service.name,'^قسم[[:space:]]+','')||E'\nتوضيح الإدارة '||decision.explanation
 from provision_private.work_routing_decisions decision join public.work_services service on service.id=decision.target_service_id
 where decision.event_id=p_event
$$;
revoke all on function provision_private.work_routing_decision_message(bigint) from public,anon,authenticated;

do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$perform provision_private.work_notify(target,r.id,'كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد'||E'\n'||'توضيح الإدارة '||why);$old$;
 if strpos(body,needle)=0 then raise exception 'routing_recipient_notice_shape'; end if;
 body=replace(body,needle,$new$perform provision_private.work_notify(target,r.id,case when e.kind='routing'
     then 'وجهت الإدارة المهمة إلى قسم '||(select regexp_replace(name,'^قسم[[:space:]]+','') from public.work_services where id=sid)||' يرجى استلامها وتحديد موعد التسليم'
     else 'كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد' end||E'\n'||'توضيح الإدارة '||why);$new$);
 needle=$old$update public.work_escalations set status='resolved',resolution=why,resolved_by=auth.uid(),resolved_at=now() where id=e.id;$old$;
 if strpos(body,needle)=0 then raise exception 'routing_decision_snapshot_shape'; end if;
 body=replace(body,needle,$new$if e.kind='routing' then
    update provision_private.work_routing_decisions set decision=p->>'decision',
     target_service_id=case when p->>'decision'='reassign' then sid else a.service_id end,
     resolved_by=auth.uid(),explanation=why,resolved_at=now(),
     penalty_points=case when p->>'decision'='reassign' and sid<>source_service_id and coordinator_id is not null and not r.test then 1 else 0 end
    where escalation_id=e.id and resolved_at is null;
    if not found then raise exception 'routing_decision_context_missing'; end if;
    if r.coordinator_id is not null and r.coordinator_id is distinct from (case when p->>'decision'='reassign' then target else a.assignee_id end) then
     perform provision_private.work_notify(r.coordinator_id,r.id,
      (case when p->>'decision'='keep' then 'أبقت الإدارة المهمة لدى قسم ' else 'وجهت الإدارة المهمة إلى قسم ' end)
      ||(select regexp_replace(name,'^قسم[[:space:]]+','') from public.work_services where id=case when p->>'decision'='reassign' then sid else a.service_id end)
      ||E'\nتوضيح الإدارة '||why);
    end if;
   end if;
   update public.work_escalations set status='resolved',resolution=why,resolved_by=auth.uid(),resolved_at=now() where id=e.id;$new$);
 needle=$old$values(r.id,a.id,auth.uid(),event_name,note,external) returning id into audit_id;$old$;
 if strpos(body,needle)=0 then raise exception 'routing_event_link_shape'; end if;
 body=replace(body,needle,needle||$new$
 if action='resolve' and e.kind='routing' then
  update provision_private.work_routing_decisions set event_id=audit_id where escalation_id=e.id;
  -- Replace only this transaction's newly queued generic copies No replay of old notices
  update public.work_notifications set message=provision_private.work_routing_decision_message(audit_id)
  where request_id=r.id and event_key in('control:event:'||audit_id::text||':admin',
   'event:event:'||audit_id::text||':coordinator','department:event:'||audit_id::text||':lead')
   and provider_id is null;
 end if;$new$);
 execute body;

 body=pg_get_functiondef('provision_private.work_event_message(bigint)'::regprocedure);
 needle=$old$if event_row.id is null then return null; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'routing_event_message_shape'; end if;
 execute replace(body,needle,needle||$new$
 if event_row.kind='resolve' then
  base_message=provision_private.work_routing_decision_message(event_row.id);
  if base_message is not null then return base_message; end if;
 end if;$new$);

 body=pg_get_functiondef('public.work_employee_performance(integer)'::regprocedure);
 needle=$old$select aggregate.*,$old$;
 if strpos(body,needle)=0 then raise exception 'routing_performance_penalty_shape'; end if;
 body=replace(body,needle,needle||$new$
   provision_private.work_routing_penalty_total(aggregate.id,now()-make_interval(days=>period_days),now()) as routing_penalty_points,$new$);
 needle=$old$round(scored.speed_score*.65+scored.volume_score*.35)::integer end as performance_score$old$;
 if strpos(body,needle)=0 then raise exception 'routing_performance_score_shape'; end if;
 body=replace(body,needle,$new$greatest(0,round(scored.speed_score*.65+scored.volume_score*.35)::integer-scored.routing_penalty_points) end as performance_score$new$);
 body=replace(body,$old$'volume_score',volume_score,'performance_score',performance_score,$old$,
  $new$'volume_score',volume_score,'performance_score',performance_score,'routing_penalty_points',routing_penalty_points,$new$);
 execute body;

 body=pg_get_functiondef('public.work_team_overview(date,date)'::regprocedure);
 needle=$old$select ratings.*,person.pending_setup,$old$;
 if strpos(body,needle)=0 then raise exception 'routing_overview_penalty_shape'; end if;
 body=replace(body,needle,needle||$new$
   provision_private.work_routing_penalty_total(ratings.id,start_at,least(end_at,now())) as routing_penalty_points,$new$);
 needle=$old$round(speed_score*.65+volume_score*.35)::integer end as performance_score$old$;
 if strpos(body,needle)=0 then raise exception 'routing_overview_score_shape'; end if;
 body=replace(body,needle,$new$greatest(0,round(speed_score*.65+volume_score*.35)::integer-routing_penalty_points) end as performance_score$new$);
 body=replace(body,'score.performance_score,score.insufficient_data,','score.performance_score,score.routing_penalty_points,score.insufficient_data,');
 body=replace(body,$old$'performance_score',performance_score,'insufficient_data',insufficient_data,$old$,
  $new$'performance_score',performance_score,'routing_penalty_points',routing_penalty_points,'insufficient_data',insufficient_data,$new$);
 execute body;
end
$migration$;
notify pgrst,'reload schema';
commit;
