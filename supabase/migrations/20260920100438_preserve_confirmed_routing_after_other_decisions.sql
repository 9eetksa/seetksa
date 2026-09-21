begin;
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('provision_private.work_task_routing_locked(uuid)'::regprocedure);
 needle=$old$and event.kind in('assign','intake','handoff','delegate','resolve','route_revision','output_request')$old$;
 if strpos(body,needle)=0 then raise exception 'confirmed_routing_placement_shape'; end if;
 execute replace(body,needle,$new$and (event.kind in('assign','intake','handoff','delegate','route_revision','output_request')
       or event.kind='resolve' and exists(
        select 1 from provision_private.work_assignment_history placement where placement.event_id=event.id
         and (placement.previous_assignee is distinct from placement.next_assignee
          or placement.status_before='escalated' and placement.status_after='offered')
       ))$new$);
end
$migration$;
commit;
