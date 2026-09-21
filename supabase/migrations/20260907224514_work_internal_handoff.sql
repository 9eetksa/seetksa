begin;

alter table public.work_parts add column forwarded_to uuid;
alter table public.work_parts add column forwarded_at timestamptz;
alter table public.work_parts add column forwarded_by uuid references auth.users on delete set null;
alter table public.work_parts add constraint work_parts_forwarded_target
 foreign key(forwarded_to,request_id) references public.work_parts(id,request_id);
alter table public.work_parts add constraint work_parts_forwarded_not_self
 check(forwarded_to is null or forwarded_to<>id);
alter table public.work_parts drop constraint work_parts_status_check;
alter table public.work_parts add constraint work_parts_status_check
 check(status in ('offered','working','needs_info','escalated','waiting','review','revision','approved','forwarded'));
-- Existing actions cannot reopen a forwarded source while its handoff is retained
alter table public.work_parts add constraint work_parts_forwarded_state check(
 (status='forwarded' and forwarded_to is not null and forwarded_at is not null)
 or (status<>'forwarded' and forwarded_to is null and forwarded_at is null and forwarded_by is null)
);
create unique index work_parts_forwarded_to on public.work_parts(forwarded_to) where forwarded_to is not null;

-- Direct handoff access is separate from explicit dependencies that require
-- client approval and does not make intermediate department files client-visible
create or replace function provision_private.work_file_read(path text)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and (
  exists(select 1 from public.work_attachments a where a.object_path=path and provision_private.work_read(a.request_id))
  or exists(
   select 1 from public.work_deliveries d where d.object_path=path and (
    (provision_private.work_role()='client' and d.released_at is not null and exists(
     select 1 from public.work_requests r where r.id=d.request_id and r.client_id=auth.uid()
    ))
    or (provision_private.work_role()<>'client' and (
     provision_private.work_part_read(d.part_id)
     or (d.status='approved' and exists(
      select 1 from public.work_dependencies dep join public.work_parts p on p.id=dep.part_id
      where dep.upstream_id=d.part_id and dep.status='accepted' and p.assignee_id=auth.uid()
     ))
     or (d.status='pending' and d.released_at is null and exists(
      select 1 from public.work_parts source
      join public.work_parts downstream on downstream.id=source.forwarded_to and downstream.request_id=source.request_id
      where source.id=d.part_id and source.request_id=d.request_id and source.status='forwarded'
      and downstream.assignee_id=auth.uid()
     ))
    ))
   )
  )
 )
$$;

-- Patch only handoff behavior in the immediately preceding release so its
-- client submission and verification changes are preserved
do $migration$
declare body text; needle text; replacement text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle='declare audit_id bigint;';
 if strpos(body,needle)=0 then raise exception 'handoff_migration_action_declaration'; end if;
 body=replace(body,needle,'declare handoff_part public.work_parts; handoff_delivery public.work_deliveries; handoff_audit bigint; audit_id bigint;');

 needle=$old$if r.status<>'active' or not(provision_private.work_coordinator() or provision_private.work_manage(sid)) then raise exception 'forbidden'; end if;$old$;
 replacement=needle||$new$
   if p ? 'delivery_id' then
    select * into handoff_delivery from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id for update;
    select * into handoff_part from public.work_parts where id=handoff_delivery.part_id and request_id=r.id for update;
    if handoff_delivery.id is null or handoff_part.id is null
       or not(provision_private.work_coordinator() or provision_private.work_manage(handoff_part.service_id)) then
     raise exception 'forbidden' using errcode='42501';
    end if;
    if handoff_part.status<>'review' or handoff_part.forwarded_to is not null
       or handoff_delivery.status<>'pending' or handoff_delivery.released_at is not null then
     raise exception 'invalid_state';
    end if;
    if not exists(select 1 from public.work_services where id=sid and active) then raise exception 'invalid_service'; end if;
    if exists(select 1 from public.work_dependencies where upstream_id=handoff_part.id and status<>'waived') then
     raise exception 'handoff_requires_client_approval';
    end if;
    if exists(select 1 from public.work_escalations where part_id=handoff_part.id and status='open') then
     raise exception 'handoff_open_escalation';
    end if;
   end if;$new$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_assignment_guard'; end if;
 body=replace(body,needle,replacement);

 needle=$old$insert into public.work_parts(request_id,service_id,assignee_id,scope,priority) values(r.id,sid,target,trim(p->>'scope'),coalesce(p->>'priority',r.priority)) returning * into a;$old$;
 replacement=needle||$new$
   if handoff_part.id is not null then
    update public.work_parts set status='forwarded',forwarded_to=a.id,forwarded_at=now(),forwarded_by=auth.uid()
    where id=handoff_part.id;
    insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
    values(r.id,handoff_part.id,auth.uid(),'handoff','أحيلت المخرجات إلى القسم التالي',true) returning id into handoff_audit;
    insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
    values(handoff_audit,handoff_part.assignee_id,handoff_part.assignee_id,handoff_part.status,'forwarded');
    perform provision_private.work_notify(handoff_part.assignee_id,r.id,'استلم فريق التواصل تسليمك وأحاله إلى القسم التالي');
   end if;$new$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_assignment_insert'; end if;
 body=replace(body,needle,replacement);

 -- A new dependency on a forwarded source would otherwise wait forever for an
 -- intermediate client approval that the handoff deliberately does not request
 needle=$old$if b.id is null or b.id=a.id then raise exception 'invalid_dependency'; end if;$old$;
 replacement=$new$if b.id is null or b.id=a.id or b.status='forwarded' then raise exception 'invalid_dependency'; end if;$new$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_dependency_guard'; end if;
 body=replace(body,needle,replacement);

 needle=$old$if a.status in ('approved','review') then raise exception 'invalid_state'; end if;$old$;
 replacement=$new$if a.status in ('approved','review','forwarded') then raise exception 'invalid_state'; end if;$new$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_reassignment_guard'; end if;
 body=replace(body,needle,replacement);

 needle=$old$select * into a from public.work_parts where id=e.part_id;$old$;
 replacement=needle||$new$
   if a.status='forwarded' then raise exception 'invalid_state'; end if;$new$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_resolution_guard'; end if;
 body=replace(body,needle,replacement);

 needle=$old$assignee_id=target and status<>'approved'$old$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_workload'; end if;
 body=replace(body,needle,$new$assignee_id=target and status not in ('approved','forwarded')$new$);

 needle=$old$exists(select 1 from public.work_parts where request_id=r.id) and not exists(select 1 from public.work_parts where request_id=r.id and status<>'approved')$old$;
 replacement=$new$exists(select 1 from public.work_parts where request_id=r.id and status='approved') and not exists(select 1 from public.work_parts where request_id=r.id and status not in ('approved','forwarded'))$new$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_completion'; end if;
 body=replace(body,needle,replacement);
 execute body;
end;
$migration$;

-- Forwarded work is finished for its source assignee but is not client approval
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_directory()'::regprocedure);
 needle=$old$a.assignee_id=u.id and a.status<>'approved'$old$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_directory'; end if;
 body=replace(body,needle,$new$a.assignee_id=u.id and a.status not in ('approved','forwarded')$new$);
 execute body;

 body=pg_get_functiondef('public.work_board(text,text,integer)'::regprocedure);
 needle=$old$status<>'approved'$old$;
 if strpos(body,needle)=0 then raise exception 'handoff_migration_board_counts'; end if;
 body=replace(body,needle,$new$status not in ('approved','forwarded')$new$);
 body=replace(body,$old$p.status in ('review','revision','approved')$old$,$new$p.status in ('review','revision','approved','forwarded')$new$);
 execute body;
end;
$migration$;

commit;
