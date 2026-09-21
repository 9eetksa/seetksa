begin;

-- Administrators can allocate work while a new employee completes onboarding
-- This never changes the employee password flag or their account_ready action gate
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$and coalesce(raw_app_meta_data->>'must_change_password','false')<>'true'$old$;
 if strpos(body,needle)=0 then raise exception 'onboarding_assignment_guard'; end if;
 body=replace(body,needle,$new$and not coalesce(is_anonymous,false)$new$);
 execute body;

 body=pg_get_functiondef('provision_private.work_route_batch(text,jsonb)'::regprocedure);
 needle=$old$and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true'$old$;
 if strpos(body,needle)=0 then raise exception 'onboarding_batch_assignment_guard'; end if;
 body=replace(body,needle,$new$and not coalesce(u.is_anonymous,false)$new$);
 execute body;
end;
$migration$;

commit;
