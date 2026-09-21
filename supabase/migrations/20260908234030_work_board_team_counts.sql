begin;

-- Team leaders need request-scoped totals independent of the current result page
-- Preserve personal task counts and the existing request visibility contract
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_board(text,text,integer)'::regprocedure);
 needle='alerts jsonb; counts jsonb;';
 if strpos(body,needle)=0 then raise exception 'team_counts_declaration_mismatch'; end if;
 body=replace(body,needle,needle||' team_counts jsonb;');
 needle=$old$return jsonb_build_object('requests',requests,'parts',parts,'escalations',alerts,'counts',counts);$old$;
 if strpos(body,needle)=0 then raise exception 'team_counts_return_mismatch'; end if;
 body=replace(body,needle,$new$if provision_private.work_manager() or provision_private.work_coordinator() then
  with scoped_requests as materialized (
   select r.id,r.status from public.work_requests r
   where r.status<>'draft' and provision_private.work_read(r.id)
  )
  select jsonb_build_object(
   'active_requests',(select count(*) from scoped_requests where status='active'),
   'intake_requests',(select count(*) from scoped_requests where status in ('new','needs_info')),
   'overdue_parts',(select count(*) from public.work_parts p join scoped_requests r on r.id=p.request_id
    where p.status not in ('approved','forwarded','internal_done') and p.due_at<now() and provision_private.work_part_read(p.id)),
   'pending_client_reviews',(select count(distinct d.request_id) from public.work_deliveries d join scoped_requests r on r.id=d.request_id
    where d.status='pending' and d.released_at is not null and provision_private.work_part_read(d.part_id))
  ) into team_counts;
 end if;
 return jsonb_build_object('requests',requests,'parts',parts,'escalations',alerts,'counts',counts)
  ||case when team_counts is not null then jsonb_build_object('team_counts',team_counts) else '{}'::jsonb end;$new$);
 execute body;
end;
$migration$;

commit;
