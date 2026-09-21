-- Keep the request title independent from the brief throughout the task workflow
-- Existing rows and authorization checks stay unchanged
do $migration$
declare
 body text;
 needle text=$old$title=left(trim(p->>'brief'),100)$old$;
 replacement text=$new$title=case when p ? 'title' then trim(p->>'title') else r.title end$new$;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then
  raise exception 'client_request_title_migration_guard';
 end if;
 -- The existing NOT NULL and 3 to 200 character constraint validates the title
 -- Missing title in legacy callers preserves the existing request title
 execute replace(body,needle,replacement);
end;
$migration$;
