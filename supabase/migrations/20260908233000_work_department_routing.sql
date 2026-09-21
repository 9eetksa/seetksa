begin;

-- All chosen departments are assigned in the same transaction as intake
-- No unassigned plan can accidentally disappear from completion checks
alter table public.work_parts add column route_position integer not null default 0;
with ordered as (
 select id,row_number() over(partition by request_id order by created_at,id)::integer as position
 from public.work_parts
)
update public.work_parts p set route_position=o.position from ordered o where p.id=o.id;
alter table public.work_parts alter column route_position drop default;
alter table public.work_parts add constraint work_parts_route_position_positive check(route_position>0);
create unique index work_parts_request_position on public.work_parts(request_id,route_position);

create function provision_private.work_route_batch(operation text,p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.work_requests; item jsonb; assignments jsonb=p->'assignments';
 sid uuid; target uuid; result jsonb; ids jsonb='[]'; current_version integer; total integer;
begin
 if not provision_private.account_ready() or operation not in ('intake','assign') then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if octet_length(p::text)>50000 or jsonb_typeof(assignments) is distinct from 'array' or p ? 'delivery_id' then
  raise exception 'invalid_input';
 end if;
 total=jsonb_array_length(assignments);
 if total=0 or (p ? 'route_mode' and (
  p->>'route_mode' not in ('single','multi') or p->>'route_mode' is null
  or (p->>'route_mode'='single' and total<>1) or (p->>'route_mode'='multi' and total<2)
 )) then raise exception 'invalid_departments'; end if;
 if exists(select 1 from jsonb_array_elements(assignments) x where jsonb_typeof(x) is distinct from 'object') then
  raise exception 'invalid_input';
 end if;
 if total<>(select count(distinct (x->>'service_id')::uuid) from jsonb_array_elements(assignments) x) then
  raise exception 'duplicate_department';
 end if;
 -- Follow the single-action lock order before taking any assignment staff locks
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 if r.id is null or not provision_private.work_read(r.id) then raise exception 'forbidden' using errcode='42501'; end if;
 if (p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
 if (operation='intake' and r.status not in ('new','needs_info')) or (operation='assign' and r.status<>'active') then
  raise exception 'invalid_state';
 end if;
 for item in select value from jsonb_array_elements(assignments) loop
  sid=(item->>'service_id')::uuid;
  if not exists(select 1 from public.work_services where id=sid and active) then raise exception 'invalid_service'; end if;
  if not(provision_private.work_coordinator() or provision_private.work_manage(sid)) then
   raise exception 'forbidden' using errcode='42501';
  end if;
  if length(trim(coalesce(item->>'scope',''))) not between 3 and 6000
   or coalesce(item->>'priority',r.priority) not in ('normal','urgent') then raise exception 'invalid_input'; end if;
 end loop;
 -- Shared employees are locked in a stable order across concurrent requests
 perform 1 from public.work_staff where user_id in (
  select (x->>'assignee_id')::uuid from jsonb_array_elements(assignments) x
 ) order by user_id for update;
 for item in select value from jsonb_array_elements(assignments) loop
  target=(item->>'assignee_id')::uuid;
  sid=(item->>'service_id')::uuid;
  if not exists(select 1 from public.work_staff s join auth.users u on u.id=s.user_id
    join public.work_memberships m on m.user_id=s.user_id
    where s.user_id=target and m.service_id=sid
     and u.raw_app_meta_data->>'role' in ('employee','admin','super_admin')
     and (u.banned_until is null or u.banned_until<now())
     and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true') then
   raise exception 'invalid_assignment';
  end if;
 end loop;
 if operation='intake' then
  perform public.work_action('intake',jsonb_build_object('request_id',r.id,'version',r.version,
   'service_id',assignments->0->>'service_id'));
 end if;
 for item in select value from jsonb_array_elements(assignments) loop
  select version into current_version from public.work_requests where id=r.id;
  result=public.work_action('assign',jsonb_build_object('request_id',r.id,'version',current_version,
   'service_id',item->>'service_id','assignee_id',item->>'assignee_id',
   'scope',item->>'scope','priority',coalesce(item->>'priority',r.priority)));
  ids=ids||jsonb_build_array(result->'part_id');
 end loop;
 return jsonb_build_object('request_id',r.id,'part_ids',ids);
end;
$$;
revoke all on function provision_private.work_route_batch(text,jsonb) from public,anon,authenticated;

do $migration$
declare body text; needle text; replacement text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$if action='read_notification' then$old$;
 replacement=$new$if action in ('intake','assign') and p ? 'assignments' then
  return provision_private.work_route_batch(action,p);
 end if;
 if action='read_notification' then$new$;
 if strpos(body,needle)=0 then raise exception 'department_routing_action_guard'; end if;
 body=replace(body,needle,replacement);
 needle=$old$insert into public.work_parts(request_id,service_id,assignee_id,scope,priority) values(r.id,sid,target,trim(p->>'scope'),coalesce(p->>'priority',r.priority)) returning * into a;$old$;
 replacement=$new$insert into public.work_parts(request_id,service_id,assignee_id,scope,priority,route_position)
   values(r.id,sid,target,trim(p->>'scope'),coalesce(p->>'priority',r.priority),
    (select coalesce(max(route_position),0)+1 from public.work_parts where request_id=r.id)) returning * into a;$new$;
 if strpos(body,needle)=0 then raise exception 'department_routing_assignment_shape'; end if;
 body=replace(body,needle,replacement);
 needle=$old$sid=(p->>'service_id')::uuid; target=(p->>'assignee_id')::uuid;$old$;
 replacement=needle||$new$
   if not exists(select 1 from public.work_services where id=sid and active) then raise exception 'invalid_service'; end if;$new$;
 if strpos(body,needle)=0 then raise exception 'department_routing_service_guard'; end if;
 body=replace(body,needle,replacement);
 execute body;
end;
$migration$;

create or replace function public.work_routes(p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501'; end if;
 return(select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'service_id',p.service_id,'service',s.name,'route_position',p.route_position,
  'status',p.status,'scope',case when provision_private.work_manager() or provision_private.work_coordinator()
    or p.assignee_id=auth.uid() then p.scope else null end
 ) order by p.route_position,p.created_at,p.id),'[]')
 from public.work_parts p join public.work_services s on s.id=p.service_id where p.request_id=p_request);
end;
$$;
revoke all on function public.work_routes(uuid) from public,anon;
grant execute on function public.work_routes(uuid) to authenticated;

commit;
