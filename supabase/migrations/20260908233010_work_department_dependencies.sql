begin;

-- Existing dependencies retain their explicit client approval requirement
alter table public.work_dependencies add column gate text not null default 'client_approval'
 check(gate in ('client_approval','internal_delivery'));
alter table public.work_deliveries add column internal_shared_at timestamptz;
alter table public.work_deliveries add column internal_shared_by uuid references auth.users on delete set null;
alter table public.work_deliveries add constraint work_delivery_release_channels
 check(internal_shared_at is null or (released_at is null and status='pending'));
alter table public.work_parts drop constraint work_parts_status_check;
alter table public.work_parts add constraint work_parts_status_check
 check(status in ('offered','working','needs_info','escalated','waiting','review','revision','approved','forwarded','internal_done'));
create index work_dependencies_internal_upstream on public.work_dependencies(upstream_id)
 where gate='internal_delivery' and status in ('pending','accepted');

create function provision_private.work_dependency_blocked(part uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.work_dependencies dep join public.work_parts source on source.id=dep.upstream_id
  where dep.part_id=part and dep.status<>'waived' and (
   dep.status<>'accepted'
   or (dep.gate='client_approval' and source.status<>'approved')
   or (dep.gate='internal_delivery' and source.status<>'approved' and not exists(
    select 1 from public.work_deliveries d where d.part_id=source.id
    and d.request_id=dep.request_id and d.internal_shared_at is not null
    and d.released_at is null and source.status='internal_done'
   ))
  )
 )
$$;
revoke all on function provision_private.work_dependency_blocked(uuid) from public,anon,authenticated;

-- Called only from the request-locked action below including atomic acceptance
create function provision_private.work_add_dependency(rid uuid,part uuid,upstream uuid,why text,required_gate text)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.work_parts; b public.work_parts; dependency uuid;
begin
 select * into a from public.work_parts where id=part and request_id=rid;
 select * into b from public.work_parts where id=upstream and request_id=rid;
 if not provision_private.account_ready() or a.id is null or a.assignee_id<>auth.uid() then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if a.status not in ('offered','working','waiting','revision') or length(trim(coalesce(why,''))) not between 3 and 4000 then
  raise exception 'invalid_state';
 end if;
 if required_gate is null or required_gate not in ('client_approval','internal_delivery') then raise exception 'invalid_dependency'; end if;
 if b.id is null or b.id=a.id or b.status='forwarded'
    or (b.status='internal_done' and required_gate<>'internal_delivery') then raise exception 'invalid_dependency'; end if;
 if exists(with recursive chain(id) as (
  select b.id union select d.upstream_id from public.work_dependencies d join chain c on d.part_id=c.id where d.status<>'waived'
 ) select 1 from chain where id=a.id) then raise exception 'dependency_cycle'; end if;
 insert into public.work_dependencies(request_id,part_id,upstream_id,reason,gate)
 values(rid,a.id,b.id,trim(why),required_gate) returning id into dependency;
 update public.work_parts set status='waiting' where id=a.id;
 perform provision_private.work_notify(b.assignee_id,rid,'قسم آخر يحتاج مخرجاتك قبل بدء العمل' || E'\n' || trim(why));
 return dependency;
end;
$$;
revoke all on function provision_private.work_add_dependency(uuid,uuid,uuid,text,text) from public,anon,authenticated;

-- Clients still require release_delivery and ownership of the request
-- An accepted internal link grants only its coordinator-cleared source output
create or replace function provision_private.work_file_read(path text)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and (
  exists(select 1 from public.work_attachments a where a.object_path=path and provision_private.work_read(a.request_id))
  or exists(select 1 from public.work_deliveries d where d.object_path=path and (
   (provision_private.work_role()='client' and d.released_at is not null and exists(
    select 1 from public.work_requests r where r.id=d.request_id and r.client_id=auth.uid()
   ))
   or (provision_private.work_role()<>'client' and (
    provision_private.work_part_read(d.part_id)
    or (d.status='approved' and exists(
     select 1 from public.work_dependencies dep join public.work_parts p on p.id=dep.part_id
     where dep.upstream_id=d.part_id and dep.status='accepted' and p.assignee_id=auth.uid()
    ))
    or (d.internal_shared_at is not null and d.released_at is null and exists(
     select 1 from public.work_dependencies dep
     join public.work_parts source on source.id=dep.upstream_id
     join public.work_parts p on p.id=dep.part_id
     where dep.upstream_id=d.part_id and dep.request_id=d.request_id
     and dep.gate='internal_delivery' and dep.status='accepted'
     and source.status='internal_done' and p.assignee_id=auth.uid()
    ))
    or (d.status='pending' and d.released_at is null and exists(
     select 1 from public.work_parts source
     join public.work_parts downstream on downstream.id=source.forwarded_to and downstream.request_id=source.request_id
     where source.id=d.part_id and source.request_id=d.request_id and source.status='forwarded'
     and downstream.assignee_id=auth.uid()
    ))
   ))
  ))
 )
$$;

do $migration$
declare body text; needle text; replacement text; action_function regprocedure;
begin
 action_function=coalesce(to_regprocedure('provision_private.work_action_core(text,jsonb)'),to_regprocedure('public.work_action(text,jsonb)'));
 body=replace(pg_get_functiondef(action_function),E'\r\n',E'\n');
 needle='declare handoff_part public.work_parts;';
 if strpos(body,needle)=0 then raise exception 'department_dependencies_declaration'; end if;
 body=replace(body,needle,'declare dependency_input jsonb; created_dependency_id uuid; handoff_part public.work_parts;');

 needle=$old$elsif action='dependency' then
    if a.status not in ('working','waiting') or length(why)<3 then raise exception 'invalid_state'; end if;
    select * into b from public.work_parts where id=(p->>'upstream_id')::uuid and request_id=r.id;
    if b.id is null or b.id=a.id or b.status='forwarded' then raise exception 'invalid_dependency'; end if;
    if exists(with recursive chain(id) as (select b.id union select x.upstream_id from public.work_dependencies x join chain c on x.part_id=c.id where x.status<>'waived') select 1 from chain where id=a.id) then raise exception 'dependency_cycle'; end if;
    insert into public.work_dependencies(request_id,part_id,upstream_id,reason) values(r.id,a.id,b.id,why);
    update public.work_parts set status='waiting' where id=a.id;
    perform provision_private.work_notify(b.assignee_id,r.id,'قسم آخر يحتاج مخرجاتك قبل بدء العمل' || E'\n' || why); note=why;$old$;
 replacement=$new$elsif action='dependency' then
    created_dependency_id=provision_private.work_add_dependency(r.id,a.id,(p->>'upstream_id')::uuid,why,coalesce(p->>'gate','client_approval'));
    note=why;$new$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_action'; end if;
 body=replace(body,needle,replacement);

 needle=$old$if a.status<>'offered' then raise exception 'invalid_state'; end if;$old$;
 replacement=$new$if a.status not in ('offered','waiting') or (a.status='waiting' and a.accepted_at is not null) then raise exception 'invalid_state'; end if;
    if p ? 'dependencies' then
     if jsonb_typeof(p->'dependencies')<>'array' or jsonb_array_length(p->'dependencies')>32 then raise exception 'invalid_dependency'; end if;
     for dependency_input in select value from jsonb_array_elements(p->'dependencies') loop
      created_dependency_id=provision_private.work_add_dependency(r.id,a.id,(dependency_input->>'upstream_id')::uuid,
       dependency_input->>'reason',coalesce(dependency_input->>'gate','internal_delivery'));
      insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
      values(r.id,a.id,auth.uid(),'dependency',trim(dependency_input->>'reason'),false);
     end loop;
    end if;$new$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_accept'; end if;
 body=replace(body,needle,replacement);

 needle=$old$exists(select 1 from public.work_dependencies x join public.work_parts y on y.id=x.upstream_id where x.part_id=a.id and x.status<>'waived' and (x.status<>'accepted' or y.status<>'approved'))$old$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_part_gate'; end if;
 body=replace(body,needle,'provision_private.work_dependency_blocked(a.id)');
 needle=$old$exists(select 1 from public.work_dependencies y join public.work_parts z on z.id=y.upstream_id where y.part_id=x.id and y.status<>'waived' and (y.status<>'accepted' or z.status<>'approved'))$old$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_wait_gate'; end if;
 body=replace(body,needle,'provision_private.work_dependency_blocked(x.id)');
 needle=$old$exists(
 select 1 from public.work_dependencies y join public.work_parts z on z.id=y.upstream_id where y.part_id=x.id and y.status<>'waived' and (y.status<>'accepted' or z.status<>'approved'))$old$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_wake_gate'; end if;
 body=replace(body,needle,'provision_private.work_dependency_blocked(x.id)');
 needle=$old$for b in update public.work_parts x set status='working' where x.request_id=r.id and x.status='waiting'$old$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_wake_state'; end if;
 body=replace(body,needle,$new$for b in update public.work_parts x set status=case when x.accepted_at is null then 'offered' else 'working' end where x.request_id=r.id and x.status='waiting'$new$);
 body=replace(body,$old$'اعتمدت المخرجات المطلوبة ويمكنك بدء تنفيذ الجزء الخاص بك'$old$,$new$case when b.accepted_at is null then 'اكتملت المخرجات المطلوبة يمكنك استلام المهمة وتحديد موعد التسليم' else 'اكتملت المخرجات المطلوبة ويمكنك متابعة تنفيذ المهمة' end$new$);

 needle=$old$elsif action='release_delivery' then$old$;
 replacement=$new$elsif action='release_dependencies' then
   select * into d from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id for update;
   select * into a from public.work_parts where id=d.part_id;
   if d.id is null or not(provision_private.work_coordinator() or provision_private.work_manage(a.service_id)) then raise exception 'forbidden'; end if;
   if r.status<>'active' or d.status<>'pending' or a.status<>'review' or d.released_at is not null or d.internal_shared_at is not null then raise exception 'invalid_state'; end if;
   if not exists(select 1 from public.work_dependencies where upstream_id=a.id and gate='internal_delivery' and status in ('pending','accepted')) then raise exception 'invalid_dependency'; end if;
   if exists(select 1 from public.work_dependencies where upstream_id=a.id and gate='client_approval' and status<>'waived') then raise exception 'internal_requires_client_approval'; end if;
   if exists(select 1 from public.work_escalations where part_id=a.id and status='open' and kind<>'overload') then raise exception 'internal_open_escalation'; end if;
   update public.work_deliveries set internal_shared_at=now(),internal_shared_by=auth.uid() where id=d.id;
   update public.work_parts set status='internal_done' where id=a.id;
   for u in select distinct downstream.assignee_id as id from public.work_dependencies link
    join public.work_parts downstream on downstream.id=link.part_id
    where link.upstream_id=a.id and link.gate='internal_delivery' and link.status in ('pending','accepted') loop
    perform provision_private.work_notify(u.id,r.id,'اعتمد مسؤول التواصل مخرجات القسم المطلوبة للمهمة');
   end loop;
   perform provision_private.work_notify(a.assignee_id,r.id,'اعتمد مسؤول التواصل تسليمك للأقسام المرتبطة');
   note='اعتماد المخرجات الداخلية للأقسام المرتبطة';
  elsif action='force_start' then
   if a.id is null or not provision_private.work_manage(a.service_id) then raise exception 'forbidden' using errcode='42501'; end if;
   if r.status<>'active' or a.status not in ('offered','waiting') then raise exception 'invalid_state'; end if;
   if length(why) not between 3 and 4000 then raise exception 'invalid_reason'; end if;
   due=(p->>'due_at')::timestamptz;
   if due is null or due<=now() then raise exception 'invalid_due'; end if;
   if not exists(select 1 from auth.users where id=a.assignee_id and raw_app_meta_data->>'role' in ('employee','admin','super_admin')
    and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<now())
    and coalesce(raw_app_meta_data->>'must_change_password','false')<>'true') then raise exception 'invalid_assignment'; end if;
   if not exists(select 1 from public.work_staff staff join public.work_memberships membership on membership.user_id=staff.user_id
    join public.work_services service on service.id=membership.service_id
    where staff.user_id=a.assignee_id and membership.service_id=a.service_id and service.active) then raise exception 'invalid_assignment'; end if;
   for dep in update public.work_dependencies set status='waived' where part_id=a.id and status<>'waived' returning * loop
    insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
    values(r.id,a.id,auth.uid(),'force_dependency_waived','إلغاء اشتراط الاعتماد '||dep.id::text||E'\n'||why,false);
    update public.work_escalations set status='resolved',resolution=why,resolved_by=auth.uid(),resolved_at=now()
    where dependency_id=dep.id and status='open';
    select * into b from public.work_parts where id=dep.upstream_id;
    perform provision_private.work_notify(b.assignee_id,r.id,'قررت الإدارة بدء المهمة دون انتظار مخرجات القسم' || E'\n' || why);
   end loop;
   update public.work_parts set status='working',accepted_at=coalesce(accepted_at,now()),due_at=due where id=a.id;
   perform provision_private.work_notify(a.assignee_id,r.id,'ألزمت الإدارة باستلام المهمة وبدء تنفيذها' || E'\n' || why);
   perform provision_private.work_notify(r.coordinator_id,r.id,'قررت الإدارة استلام المهمة وبدء تنفيذها' || E'\n' || why);
   perform provision_private.work_notify(r.client_id,r.id,'تم استلام المهمة وجار تنفيذها');
   note=why;
  elsif action='release_delivery' then$new$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_new_actions'; end if;
 body=replace(body,needle,replacement);

 needle=$old$elsif e.kind='dependency' and p->>'decision' in ('enforce_dependency','waive_dependency') then$old$;
 replacement=needle||$new$
    if p->>'decision'='enforce_dependency' and not exists(
     select 1 from public.work_dependencies link join public.work_parts source on source.id=link.upstream_id
     where link.id=e.dependency_id and provision_private.work_manage(source.service_id)
    ) then raise exception 'forbidden' using errcode='42501'; end if;$new$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_enforce_scope'; end if;
 body=replace(body,needle,replacement);
 needle=$old$if a.status='forwarded' then raise exception 'invalid_state'; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_resolution_terminal'; end if;
 body=replace(body,needle,$new$if a.status in ('forwarded','internal_done') then raise exception 'invalid_state'; end if;$new$);
 needle=$old$if a.status in ('approved','review','forwarded') then raise exception 'invalid_state'; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_reassignment_terminal'; end if;
 body=replace(body,needle,$new$if a.status in ('approved','review','forwarded','internal_done') then raise exception 'invalid_state'; end if;$new$);

 needle=$old$status not in ('approved','forwarded')$old$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_terminal_counts'; end if;
 body=replace(body,needle,$new$status not in ('approved','forwarded','internal_done')$new$);
 needle=$old$not exists(select 1 from public.work_escalations where request_id=r.id and status='open') then 'completed'$old$;
 if strpos(body,needle)=0 then raise exception 'department_dependencies_optional_overload'; end if;
 body=replace(body,needle,$new$not exists(select 1 from public.work_escalations where request_id=r.id and status='open' and kind<>'overload') then 'completed'$new$);
 body=replace(body,'-- Dependency release is gated by client approval of every required upstream output',
  '-- Each dependency retains its selected approval gate and unaccepted tasks still require acceptance');
 execute body;
end;
$migration$;

do $migration$
declare body text; needle text; signature regprocedure;
begin
 foreach signature in array array['public.work_directory()'::regprocedure,'public.work_board(text,text,integer)'::regprocedure] loop
  body=pg_get_functiondef(signature);
  needle=$old$status not in ('approved','forwarded')$old$;
  if strpos(body,needle)=0 then raise exception 'department_dependencies_metrics_guard'; end if;
  body=replace(body,needle,$new$status not in ('approved','forwarded','internal_done')$new$);
  body=replace(body,$old$p.status in ('review','revision','approved','forwarded')$old$,$new$p.status in ('review','revision','approved','forwarded','internal_done')$new$);
  execute body;
 end loop;
end;
$migration$;

commit;
