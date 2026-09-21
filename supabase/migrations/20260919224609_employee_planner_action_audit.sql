begin;
-- Private notes accompany the original action event without creating another notification event
create table provision_private.work_planner_moves(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid not null,event_id bigint not null unique references public.work_events on delete cascade,
 actor uuid not null references auth.users,service_id uuid not null references public.work_services,
 action text not null check(action in('accept','request_outputs','missing','deliver','deliver_outputs')),
 note text not null check(length(trim(note)) between 3 and 2000),status_before text not null,status_after text not null,
 created_at timestamptz not null default now(),foreign key(part_id,request_id) references public.work_parts(id,request_id)
);
create index work_planner_moves_request on provision_private.work_planner_moves(request_id,created_at desc,id);
create table provision_private.work_planner_action_receipts(
 submission_key uuid primary key,actor uuid not null references auth.users,request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid not null references public.work_parts on delete cascade,action text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now()
);
alter table provision_private.work_planner_moves enable row level security;
alter table provision_private.work_planner_action_receipts enable row level security;
revoke all on provision_private.work_planner_moves,provision_private.work_planner_action_receipts from public,anon,authenticated;

create function public.work_planner_moves(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin')
  or not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
  'id',move.id,'event_id',move.event_id,'request_id',move.request_id,'part_id',move.part_id,
  'actor_id',move.actor,'actor',coalesce(nullif(trim(profile.display_name),''),'موظف القسم'),'department',service.name,
  'action',move.action,'note',move.note,'status_before',move.status_before,'status_after',move.status_after,'created_at',move.created_at
 ) order by move.created_at desc,move.id)
 from provision_private.work_planner_moves move join public.work_parts part on part.id=move.part_id
 join public.work_services service on service.id=move.service_id left join public.account_profiles profile on profile.user_id=move.actor
 where move.request_id=p_request and provision_private.work_part_read(part.id)
  and(part.assignee_id=auth.uid() or move.actor=auth.uid() or provision_private.work_coordinator() or provision_private.work_manager() and provision_private.work_manage(part.service_id))),'[]'::jsonb));
end $$;
revoke all on function public.work_planner_moves(uuid) from public,anon;
grant execute on function public.work_planner_moves(uuid) to authenticated;

create function public.work_planner_action(action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.work_requests;a public.work_parts;updated public.work_parts;receipt provision_private.work_planner_action_receipts;
 key uuid=(p->>'submission_key')::uuid;note text=trim(coalesce(p->>'planner_note',''));result jsonb;move_id uuid;
 previous_event bigint;action_event bigint;next_version integer;expected_kind text;action_payload jsonb;
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin') then raise exception 'forbidden' using errcode='42501'; end if;
 if action is null or action not in('accept','request_outputs','missing','deliver','deliver_outputs') then raise exception 'invalid_action'; end if;
 if key is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>1048576 then raise exception 'invalid_input'; end if;
 if length(note) not between 3 and 2000 then raise exception 'planner_note_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 select * into a from public.work_parts where id=(p->>'part_id')::uuid and request_id=r.id for update;
 if a.id is null or a.assignee_id<>auth.uid() or not provision_private.work_read(r.id) or not provision_private.work_part_read(a.id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into receipt from provision_private.work_planner_action_receipts where submission_key=key;
 if receipt.submission_key is not null then
  if receipt.actor<>auth.uid() or receipt.request_id<>r.id or receipt.part_id<>a.id or receipt.action<>action or receipt.payload is distinct from(p-'version') then raise exception 'submission_conflict'; end if;
  return receipt.result;
 end if;
 if(p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
 if r.status in('draft','completed','declined') or a.output_cancelled then raise exception 'invalid_state'; end if;
 if action in('accept','request_outputs') and(a.status not in('offered','waiting') or a.accepted_at is not null) then raise exception 'invalid_state'; end if;
 if(select count(*) from public.work_events where actor=auth.uid() and created_at>now()-interval '1 minute')>=120 then raise exception 'work_rate_limit'; end if;
 select coalesce(max(id),0) into previous_event from public.work_events where request_id=r.id;
 action_payload=p-'planner_note'-'planner_move';
 if action in('request_outputs','deliver_outputs') then result=public.work_output_action(action,action_payload);
 elsif action='missing' and p ? 'inquiry_kind' then result=public.work_department_inquiry_action(action,action_payload);
 else result=public.work_action(action,action_payload); end if;
 select * into updated from public.work_parts where id=a.id;
 select version into next_version from public.work_requests where id=r.id;
 expected_kind=case action when 'request_outputs' then 'accept' when 'deliver_outputs' then 'output_ready' else action end;
 select id into action_event from public.work_events where request_id=r.id and part_id=a.id and actor=auth.uid()
  and id>previous_event and kind=expected_kind order by id desc limit 1;
 -- Existing upload/output receipts must not be relabeled as a new kanban movement
 if next_version<=r.version or action_event is null then raise exception 'planner_action_already_applied'; end if;
 insert into provision_private.work_planner_moves(request_id,part_id,event_id,actor,service_id,action,note,status_before,status_after)
 values(r.id,a.id,action_event,auth.uid(),a.service_id,action,note,a.status,updated.status) returning id into move_id;
 result=coalesce(result,'{}'::jsonb)||jsonb_build_object('request_id',r.id,'part_id',a.id,'version',next_version,'planner_move_id',move_id);
 insert into provision_private.work_planner_action_receipts(submission_key,actor,request_id,part_id,action,payload,result)
 values(key,auth.uid(),r.id,a.id,action,p-'version',result);
 return result;
end $$;
revoke all on function public.work_planner_action(text,jsonb) from public,anon;
grant execute on function public.work_planner_action(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
