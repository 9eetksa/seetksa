begin;

create function provision_private.work_task_routing_locked(p_part uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.work_parts task where task.id=p_part and (
   exists(select 1 from provision_private.work_routing_decisions decision
    where decision.part_id=task.id and decision.resolved_at is not null
     and decision.source_service_id=task.service_id and decision.target_service_id=task.service_id)
   or task.rejection_blocked_for=task.assignee_id and exists(
    -- Earlier keep decisions predate the routing ledger Use the exact latest placement event
    select 1 from (
     select event.id from public.work_events event where event.part_id=task.id and event.request_id=task.request_id
      and event.kind in('assign','intake','handoff','delegate','resolve','route_revision','output_request')
     order by event.id desc limit 1
    ) latest join provision_private.work_assignment_history history on history.event_id=latest.id
    where history.previous_assignee=task.assignee_id and history.next_assignee=task.assignee_id
     and history.status_before='escalated' and history.status_after='offered'
   )
  )
 )
$$;
revoke all on function provision_private.work_task_routing_locked(uuid) from public,anon,authenticated;

do $migration$
declare body text; needle text; detail record;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$elsif action in ('reject','scope','routing') then$old$;
 if strpos(body,needle)=0 then raise exception 'confirmed_routing_action_shape'; end if;
 execute replace(body,needle,needle||$new$
    if action='routing' and provision_private.work_task_routing_locked(a.id) then raise exception 'task_routing_locked'; end if;$new$);
 for detail in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='work_request_detail' loop
  body=pg_get_functiondef(detail.oid);
  needle=$old$'assignee_id',part.assignee_id,$old$;
  if strpos(body,needle)=0 then raise exception 'confirmed_routing_projection_shape'; end if;
  execute replace(body,needle,needle||$new$
   'can_report_routing',not provision_private.work_task_routing_locked(part.id),$new$);
 end loop;
end
$migration$;
notify pgrst,'reload schema';
commit;
