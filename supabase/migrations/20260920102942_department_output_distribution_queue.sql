begin;
alter table public.work_parts add column output_distribution_pending boolean not null default false;

create function provision_private.work_output_distribution_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and new.output_parent_id is not null then
  new.output_distribution_pending=exists(select 1 from public.work_memberships m join auth.users u on u.id=m.user_id
   join public.work_staff staff on staff.user_id=m.user_id
   where m.service_id=new.service_id and m.user_id<>new.assignee_id and u.raw_app_meta_data->>'role'='employee'
    and provision_private.account_available(u.id) and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true');
 elsif tg_op='UPDATE' and (new.assignee_id is distinct from old.assignee_id or new.service_id is distinct from old.service_id) then
  new.output_distribution_pending=false;
 end if;
 -- The lead inbox is not performed work Credit the first actual assignee
 if tg_op='UPDATE' and old.output_distribution_pending and not new.output_distribution_pending
  and old.accepted_at is null and new.status='offered' and not new.output_cancelled then
  new.performance_eligible=true;
 end if;
 return new;
end $$;
revoke all on function provision_private.work_output_distribution_guard() from public,anon,authenticated;
create trigger z_work_output_distribution_guard before insert or update on public.work_parts
 for each row execute function provision_private.work_output_distribution_guard();

do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$if action='accept' then$old$;
 if strpos(body,needle)=0 then raise exception 'output_distribution_accept_shape'; end if;
 body=replace(body,needle,$new$if action='accept' then
    if a.output_distribution_pending then raise exception 'output_distribution_required'; end if;$new$);
 needle=$old$if target is null or target=a.assignee_id then raise exception 'invalid_assignment'; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'output_distribution_target_shape'; end if;
 body=replace(body,needle,$new$if target is null or (target=a.assignee_id and not a.output_distribution_pending) then raise exception 'invalid_assignment'; end if;$new$);
 needle=$old$update public.work_parts set assignee_id=target where id=a.id;$old$;
 if strpos(body,needle)=0 then raise exception 'output_distribution_delegate_shape'; end if;
 body=replace(body,needle,$new$update public.work_parts set assignee_id=target,output_distribution_pending=false where id=a.id;$new$);
 execute body;
 body=pg_get_functiondef('public.work_output_action(text,jsonb)'::regprocedure);
 needle=$old$if action='request_outputs' then$old$;
 if strpos(body,needle)=0 then raise exception 'output_distribution_request_shape'; end if;
 execute replace(body,needle,$new$if action='request_outputs' then
   if a.output_distribution_pending then raise exception 'output_distribution_required'; end if;$new$);
 body=pg_get_functiondef('public.work_request_detail(uuid,boolean)'::regprocedure);
 needle=$old$'can_report_routing',not provision_private.work_task_routing_locked(part.id),$old$;
 if strpos(body,needle)=0 then raise exception 'output_distribution_projection_shape'; end if;
 execute replace(body,needle,$new$'output_distribution_pending',part.output_distribution_pending,
   'can_report_routing',not provision_private.work_task_routing_locked(part.id),$new$);
end $migration$;
notify pgrst,'reload schema';
commit;
