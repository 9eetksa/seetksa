begin;

-- Bound to the retained employee so reassignment does not restrict another employee
alter table public.work_parts add column rejection_blocked_for uuid references auth.users(id) on delete set null;

do $migration$
declare body text; needle text; detail record;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$elsif action in ('reject','scope','routing') then$old$;
 if strpos(body,needle)=0 then raise exception 'keep_rejection_guard_shape'; end if;
 body=replace(body,needle,$new$elsif action in ('reject','scope','routing') then
    if action='reject' and a.rejection_blocked_for=a.assignee_id then raise exception 'task_rejection_locked'; end if;$new$);
 needle=$old$due=coalesce((p->>'due_at')::timestamptz,a.due_at);
     if due is null or due<=now() then raise exception 'invalid_due'; end if;
     update public.work_parts set status=case when e.kind='scope' then 'revision' else 'working' end,accepted_at=coalesce(accepted_at,now()),due_at=due where id=a.id;$old$;
 if strpos(body,needle)=0 then raise exception 'keep_return_shape'; end if;
 body=replace(body,needle,$new$update public.work_parts set status='offered',accepted_at=null,due_at=null,
      rejection_blocked_for=a.assignee_id where id=a.id;$new$);
 needle=$old$when 'keep' then 'قررت الإدارة استمرارك في تنفيذ المهمة'$old$;
 if strpos(body,needle)=0 then raise exception 'keep_notice_shape'; end if;
 body=replace(body,needle,$new$when 'keep' then case when e.kind='overload' then 'قررت الإدارة استمرارك في تنفيذ المهمة'
      else 'أعادت الإدارة المهمة إليك يرجى استلامها وتحديد موعد التسليم' end$new$);
 execute body;

 -- Staff projection only Client department projection remains unchanged
 for detail in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='work_request_detail' loop
  body=pg_get_functiondef(detail.oid);
  needle=$old$'assignee_id',part.assignee_id,$old$;
  if strpos(body,needle)=0 then raise exception 'keep_staff_projection_shape'; end if;
  execute replace(body,needle,$new$'assignee_id',part.assignee_id,
   'can_reject',part.rejection_blocked_for is distinct from part.assignee_id,$new$);
 end loop;
end
$migration$;

-- Existing RLS and RPC grants remain unchanged No historical task is rewritten
notify pgrst,'reload schema';
commit;
