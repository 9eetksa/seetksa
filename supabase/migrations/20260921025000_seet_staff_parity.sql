begin;

-- Supervisors record information received outside the platform in Seet.
-- Keep that resumption action distinct from an internal clarification.
do $migration$
declare body text; marker text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 marker=$old$if action='add_internal_info' or (action='supply_info' and provision_private.work_role()<>'client') then$old$;
 if strpos(body,marker)=0 then raise exception 'seet_clarification_guard_changed';end if;
 execute replace(body,marker,$new$if action='add_internal_info' then$new$);
end
$migration$;

-- This endpoint remains staff-only; Seet has no client reply portal.
-- The inherited client helper is deliberately unreachable from the public API.
do $migration$
declare body text;
begin
 body=pg_get_functiondef('public.work_client_resource_action(text,jsonb)'::regprocedure);
 execute replace(body,$old$if action='reply_coordinator' then return provision_private.work_reply_coordinator(p);end if;$old$,'');
end
$migration$;
notify pgrst,'reload schema';
commit;
