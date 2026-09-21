begin;

-- Use the same operational tasks for My Tasks and employee performance
-- Rollback: restore the previous work_board definition before removing the helper
-- Existing department routes permissions and notification functions are unchanged
create or replace function public.work_board(p_view text default 'mine',p_search text default '',p_page integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 ids uuid[]; requests jsonb; parts jsonb; alerts jsonb; counts jsonb; team_counts jsonb;
 coordination jsonb; coordination_counts jsonb;
begin
 if not provision_private.account_ready() or provision_private.work_role() not in ('employee','admin','super_admin') then
  raise exception 'forbidden' using errcode='42501';
 end if;

 -- Private helper data never crosses this boundary without identity and request checks
 select coalesce(jsonb_agg(to_jsonb(task)||jsonb_build_object('due_at',case
  when task.kind='intake' and task.status='open' and request.status in('new','needs_info') and request.intake_action_at is null
  then request.intake_due_at end)),'[]'::jsonb) into coordination
 from provision_private.work_coordinator_tasks() task
 join public.work_requests request on request.id=task.request_id
 where task.status<>'cancelled' and provision_private.work_read(task.request_id)
  and (task.assignee_id=auth.uid() or task.completed_by=auth.uid()
   or (provision_private.work_coordinator() and task.assignee_id is null and task.status in('open','waiting')));

 select jsonb_build_object(
  'open',count(*) filter(where task->>'status' in('open','waiting')),
  'offered',count(*) filter(where task->>'status'='open' and task->>'kind'='intake'),
  'overdue',count(*) filter(where task->>'status'='open' and (task->>'due_at')::timestamptz<now()),
  'completed',count(*) filter(where task->>'status'='completed')
 ) into coordination_counts from jsonb_array_elements(coordination) task;

 select array_agg(x.id),coalesce(jsonb_agg(to_jsonb(x)),'[]') into ids,requests from (
  select r.id,r.number,r.title,r.client_id,r.service_id,r.status,r.coordinator_id,r.version,r.created_at,r.priority,r.requested_due_at
  from public.work_requests r
  where provision_private.work_read(r.id)
   and (r.title ilike '%'||left(p_search,100)||'%' or r.number::text=trim(p_search)) and (
    (p_view='all' and (provision_private.work_manager() or provision_private.work_coordinator())) or
    (p_view='intake' and (provision_private.work_manager() or provision_private.work_coordinator())
     and (r.status in ('new','needs_info') or exists(select 1 from public.work_parts p where p.request_id=r.id and p.status='needs_info'))) or
    (p_view='department' and exists(select 1 from public.work_parts supervised where supervised.request_id=r.id and provision_private.work_lead(supervised.service_id))) or
    (p_view='mine' and (exists(select 1 from public.work_parts p where p.request_id=r.id and p.assignee_id=auth.uid())
     or exists(select 1 from jsonb_array_elements(coordination) task where task->>'request_id'=r.id::text))) or
    (p_view='deliveries' and exists(select 1 from public.work_parts p where p.request_id=r.id and p.status in ('review','revision','approved','forwarded','internal_done')
     and (p.assignee_id=auth.uid() or provision_private.work_manager() or provision_private.work_coordinator()))) or
    (p_view='alerts' and provision_private.work_manager() and exists(select 1 from public.work_escalations e where e.request_id=r.id and e.status='open'))
   )
  order by r.created_at desc limit 40 offset least(greatest(p_page,0),100000)*40
 ) x;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into parts from public.work_parts p where request_id=any(ids) and provision_private.work_part_read(p.id);
 select coalesce(jsonb_agg(to_jsonb(e)),'[]') into alerts from public.work_escalations e where request_id=any(ids) and status='open' and (provision_private.work_manager() or opened_by=auth.uid());
 select jsonb_build_object(
  'open',count(*) filter(where status not in ('approved','forwarded','internal_done'))+(coordination_counts->>'open')::integer,
  'offered',count(*) filter(where status='offered')+(coordination_counts->>'offered')::integer,
  'overdue',count(*) filter(where status not in ('approved','forwarded','internal_done') and due_at<now())+(coordination_counts->>'overdue')::integer,
  'approved',count(*) filter(where status='approved'),
  'completed',count(*) filter(where status='approved')+(coordination_counts->>'completed')::integer
 ) into counts from public.work_parts where assignee_id=auth.uid();

 if provision_private.work_manager() or provision_private.work_coordinator() then
  with scoped_requests as materialized (
   select r.id,r.status from public.work_requests r where r.status<>'draft' and provision_private.work_read(r.id)
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
 return jsonb_build_object('requests',requests,'parts',parts,'escalations',alerts,'counts',counts,
  'coordinator_counts',coordination_counts,
  'coordinator_tasks',(select coalesce(jsonb_agg(task),'[]'::jsonb) from jsonb_array_elements(coordination) task where (task->>'request_id')::uuid=any(ids)))
  ||case when team_counts is not null then jsonb_build_object('team_counts',team_counts) else '{}'::jsonb end;
end;
$$;
revoke all on function public.work_board(text,text,integer) from public,anon;
grant execute on function public.work_board(text,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
