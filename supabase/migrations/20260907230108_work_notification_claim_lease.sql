begin;

-- The exact claim timestamp distinguishes leases even when a manual retry
-- resets attempts so an old worker cannot settle a newer sending attempt
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_notification_claim()'::regprocedure);
 needle=$old$'attempts',c.attempts,$old$;
 if strpos(body,needle)=0 then raise exception 'notification_claim_lease_migration_shape'; end if;
 body=replace(body,needle,$new$'attempts',c.attempts,'claimed_at',c.next_attempt,$new$);
 execute body;
end;
$migration$;

commit;
