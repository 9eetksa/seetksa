begin;

-- Output requests are dedicated assignments rather than links to another team's unrelated work
alter table public.work_parts add column output_parent_id uuid;
alter table public.work_parts add constraint work_parts_output_parent foreign key(output_parent_id,request_id) references public.work_parts(id,request_id);
alter table public.work_parts add constraint work_parts_output_parent_not_self check(output_parent_id is null or output_parent_id<>id);
alter table public.work_parts add column output_due_required boolean not null default false;
alter table public.work_parts add column output_cancelled boolean not null default false;
alter table public.work_parts drop constraint work_parts_forwarded_state;
alter table public.work_parts add constraint work_parts_forwarded_state check(
 (status='forwarded' and ((forwarded_to is not null and forwarded_at is not null and not output_cancelled)
  or (output_cancelled and output_parent_id is not null and forwarded_to is null and forwarded_at is null and forwarded_by is null)))
 or (status<>'forwarded' and not output_cancelled and forwarded_to is null and forwarded_at is null and forwarded_by is null)
);
create index work_parts_output_parent on public.work_parts(output_parent_id) where output_parent_id is not null;
create table provision_private.work_output_requests (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid not null,
 upstream_id uuid not null unique,
 dependency_id uuid not null unique references public.work_dependencies,
 source_service_id uuid not null references public.work_services,
 source_employee_id uuid not null references auth.users,
 target_service_id uuid not null references public.work_services,
 target_employee_id uuid not null references auth.users,
 reason text not null check(length(trim(reason)) between 3 and 4000),
 status text not null default 'pending' check(status in('pending','ready','rejected')),
 rejection_reason text, rejected_by uuid references auth.users, resolved_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(part_id,request_id) references public.work_parts(id,request_id),
 foreign key(upstream_id,request_id) references public.work_parts(id,request_id),
 check(part_id<>upstream_id),
 check((status='pending')=(resolved_at is null)),
 check(status<>'rejected' or (rejected_by is not null and length(trim(rejection_reason)) between 3 and 4000))
);
create unique index work_output_requests_department_gate on provision_private.work_output_requests(part_id,target_service_id) where status in('pending','rejected');
create index work_output_requests_request on provision_private.work_output_requests(request_id,created_at);
create table provision_private.work_output_receipts (
 submission_key uuid primary key, actor uuid not null references auth.users,
 request_id uuid not null references public.work_requests on delete cascade,
 action text not null, payload jsonb not null, result jsonb not null, created_at timestamptz not null default now()
);
alter table provision_private.work_output_requests enable row level security;
alter table provision_private.work_output_receipts enable row level security;
revoke all on provision_private.work_output_requests,provision_private.work_output_receipts from public,anon,authenticated;

-- Also used by direct table policies and client projections not just the interface
create function provision_private.work_output_client_visible(p_part uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.work_parts p where p.id=p_part and p.output_parent_id is not null
  and (p.accepted_at is null or exists(select 1 from provision_private.work_output_requests o where o.upstream_id=p.id and o.status='rejected')))
$$;
create function provision_private.work_output_cancelled(p_part uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from provision_private.work_output_requests where upstream_id=p_part and status='rejected')
$$;
revoke all on function provision_private.work_output_client_visible(uuid),provision_private.work_output_cancelled(uuid) from public,anon,authenticated;

create function provision_private.work_output_can_reject(p_output uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and provision_private.work_manager() and exists(
  select 1 from provision_private.work_output_requests root where root.id=p_output and root.status='pending'
  and not exists(with recursive tree as (
   select o.* from provision_private.work_output_requests o where o.id=p_output
   union all select child.* from provision_private.work_output_requests child join tree parent on child.part_id=parent.upstream_id where child.status='pending'
  ) select 1 from tree where not provision_private.work_manage(source_service_id) or not provision_private.work_manage(target_service_id))
 )
$$;
revoke all on function provision_private.work_output_can_reject(uuid) from public,anon,authenticated;

create function provision_private.work_output_projection(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or provision_private.work_role()='client' or not provision_private.work_read(p_request) then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',o.id,'part_id',o.part_id,'upstream_id',o.upstream_id,'dependency_id',o.dependency_id,
  'source_service_id',o.source_service_id,'target_service_id',o.target_service_id,
  'source_employee_id',o.source_employee_id,'target_employee_id',o.target_employee_id,
  'source_department',s.name,'target_department',t.name,
  'source_employee',coalesce(nullif(trim(sp.display_name),''),'موظف القسم'),
  'target_employee',coalesce(nullif(trim(tp.display_name),''),'موظف القسم'),
  'current_target_employee_id',target.assignee_id,'current_target_employee',coalesce(nullif(trim(current_profile.display_name),''),'موظف القسم'),
  'reason',o.reason,'status',o.status,'rejection_reason',o.rejection_reason,'created_at',o.created_at,
  'target_status',target.status,'target_due_at',target.due_at,
  'can_reject',provision_private.work_output_can_reject(o.id)
 ) order by o.created_at,o.id)
 from provision_private.work_output_requests o
 join public.work_parts source on source.id=o.part_id join public.work_parts target on target.id=o.upstream_id
 join public.work_services s on s.id=o.source_service_id join public.work_services t on t.id=o.target_service_id
 left join public.account_profiles sp on sp.user_id=o.source_employee_id left join public.account_profiles tp on tp.user_id=o.target_employee_id
 left join public.account_profiles current_profile on current_profile.user_id=target.assignee_id
 where o.request_id=p_request and (provision_private.work_manager() or provision_private.work_coordinator()
  or source.assignee_id=auth.uid() or target.assignee_id=auth.uid()
  or provision_private.work_lead(source.service_id) or provision_private.work_lead(target.service_id))),'[]'::jsonb);
end $$;
revoke all on function provision_private.work_output_projection(uuid) from public,anon,authenticated;

create function provision_private.work_output_file_read(p_part uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.work_parts where id=p_part and output_parent_id is not null)
 or (provision_private.account_ready() and provision_private.work_role()<>'client' and exists(
  select 1 from provision_private.work_output_requests o join public.work_parts target on target.id=o.upstream_id
  join public.work_parts source on source.id=o.part_id
  where o.upstream_id=p_part and (provision_private.work_manager() or provision_private.work_coordinator()
   or o.status<>'rejected' and (target.assignee_id=auth.uid() or provision_private.work_lead(target.service_id)
    or o.status='ready' and (source.assignee_id=auth.uid() or provision_private.work_lead(source.service_id))))
 ))
$$;
revoke all on function provision_private.work_output_file_read(uuid) from public,anon,authenticated;

create function provision_private.work_output_event_client_read(p_event bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(select 1 from public.work_events e
  where e.id=p_event and provision_private.work_read(e.request_id)
   and (e.part_id is null or provision_private.work_output_client_visible(e.part_id)))
$$;
revoke all on function provision_private.work_output_event_client_read(bigint) from public,anon;
grant execute on function provision_private.work_output_event_client_read(bigint) to authenticated;
create policy work_output_events_client_read on public.work_events as restrictive for select to authenticated
using(provision_private.work_role()<>'client' or provision_private.work_output_event_client_read(id));

create function provision_private.work_output_assignees(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or provision_private.work_role()='client' or not provision_private.work_read(p_request) then return '[]'::jsonb; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',u.id,'name',coalesce(nullif(trim(profile.display_name),''),'موظف القسم'),
  'services',(select coalesce(jsonb_agg(m.service_id),'[]'::jsonb) from public.work_memberships m join public.work_services s on s.id=m.service_id and s.active where m.user_id=u.id),
  'lead_services',(select coalesce(jsonb_agg(m.service_id),'[]'::jsonb) from public.work_memberships m join public.work_services s on s.id=m.service_id and s.active where m.user_id=u.id and m.member_role='lead')))
 from auth.users u join public.work_staff staff on staff.user_id=u.id left join public.account_profiles profile on profile.user_id=u.id
 where u.raw_app_meta_data->>'role'='employee' and provision_private.account_available(u.id)
 and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true'
 and exists(select 1 from public.work_memberships m join public.work_services s on s.id=m.service_id and s.active where m.user_id=u.id)),'[]'::jsonb);
end $$;
revoke all on function provision_private.work_output_assignees(uuid) from public,anon,authenticated;

create or replace function provision_private.work_part_active_department_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.output_parent_id is null and exists(select 1 from public.work_parts existing
  where existing.request_id=new.request_id and existing.service_id=new.service_id and existing.output_parent_id is null
   and existing.status not in('approved','forwarded','internal_done')) then raise exception 'duplicate_department_assignment'; end if;
 if new.output_parent_id is not null and not exists(select 1 from public.work_parts source
  where source.id=new.output_parent_id and source.request_id=new.request_id and source.assignee_id=auth.uid()
  and source.service_id<>new.service_id and source.status in('offered','working','waiting')) then raise exception 'invalid_dependency'; end if;
 return new;
end $$;

-- Runs after the existing metrics guard so cancelled work never receives completion credit
create function provision_private.work_output_part_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if provision_private.work_output_cancelled(new.id) then
  if new.status<>'forwarded' then raise exception 'output_request_rejected'; end if;
  new.performance_eligible=false; new.completed_at=null; new.due_at=null; new.output_cancelled=true;
 end if;
 if new.output_due_required and new.status in('review','internal_done','approved') then raise exception 'output_due_required'; end if;
 return new;
end $$;
revoke all on function provision_private.work_output_part_guard() from public,anon,authenticated;
create trigger zz_work_output_part_guard before update on public.work_parts for each row execute function provision_private.work_output_part_guard();

create function public.work_output_action(action text,p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.work_requests; a public.work_parts; child public.work_parts; o provision_private.work_output_requests;
 receipt provision_private.work_output_receipts; item jsonb; f jsonb; key uuid=(p->>'submission_key')::uuid;
 outputs jsonb=coalesce(p->'outputs','[]'::jsonb); files jsonb=coalesce(p->'files','[]'::jsonb);
 result jsonb; ids jsonb='[]'::jsonb; dep_id uuid; sid uuid; employee uuid; batch uuid;
 why text=trim(coalesce(p->>'reason','')); due timestamptz; service_name text; source_name text; cancelled uuid[]; audit_id bigint;
begin
 if not provision_private.account_ready() or provision_private.work_role()='client' then raise exception 'forbidden' using errcode='42501'; end if;
 if key is null or octet_length(p::text)>100000 or action not in('request_outputs','deliver_outputs','reject_outputs','commit_output_due') then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 if r.id is null or not provision_private.work_read(r.id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into receipt from provision_private.work_output_receipts where submission_key=key;
 if receipt.submission_key is not null then
  if receipt.actor<>auth.uid() or receipt.request_id<>r.id or receipt.action<>action or receipt.payload is distinct from (p-'version') then raise exception 'submission_conflict'; end if;
  return receipt.result;
 end if;
 if (p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
 if r.status in('completed','declined','draft') then raise exception 'invalid_state'; end if;
 if (select count(*) from public.work_events where actor=auth.uid() and created_at>now()-interval '1 minute')>=120 then raise exception 'work_rate_limit'; end if;
 if action='reject_outputs' then
  select * into o from provision_private.work_output_requests where id=(p->>'output_request_id')::uuid and request_id=r.id for update;
  if o.id is null or not provision_private.work_output_can_reject(o.id) then raise exception 'forbidden' using errcode='42501'; end if;
  if o.status<>'pending' or length(why) not between 3 and 4000 then raise exception 'invalid_state'; end if;
  select * into a from public.work_parts where id=o.part_id for update;
  with recursive tree(id) as (select o.upstream_id union select link.upstream_id from provision_private.work_output_requests link join tree on link.part_id=tree.id where link.status='pending')
  select array_agg(id) into cancelled from tree;
  update provision_private.work_output_requests set status='rejected',rejection_reason=why,rejected_by=auth.uid(),resolved_at=now() where upstream_id=any(cancelled) and status='pending';
  update public.work_dependencies set status='waived' where upstream_id=any(cancelled) and request_id=r.id;
  update public.work_parts set status='forwarded',due_at=null,output_due_required=false where id=any(cancelled);
  if not provision_private.work_dependency_blocked(a.id) then update public.work_parts set status='working' where id=a.id and status='waiting'; end if;
  select name into service_name from public.work_services where id=o.target_service_id;
  perform provision_private.work_notify_once(a.assignee_id,r.id,'رفضت الإدارة طلبك لمخرجات قسم '||service_name,'output:'||o.id::text||':rejected',true);
  insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),'output_rejected','رفض طلب مخرجات قسم '||service_name,false);
 else
  select * into a from public.work_parts where id=(p->>'part_id')::uuid and request_id=r.id for update;
  if a.id is null or a.assignee_id is distinct from auth.uid() or provision_private.work_output_cancelled(a.id) then raise exception 'forbidden' using errcode='42501'; end if;
  if action='request_outputs' then
   if a.status not in('offered','working','waiting') or jsonb_typeof(outputs)<>'array' or jsonb_array_length(outputs) not between 1 and 16 then raise exception 'invalid_state'; end if;
   if jsonb_array_length(outputs)<>(select count(distinct value->>'service_id') from jsonb_array_elements(outputs)) then raise exception 'invalid_dependency'; end if;
   -- Serialize with staff and membership edits before trusting recipient identity
   perform 1 from public.work_staff staff where staff.user_id in(select (value->>'assignee_id')::uuid from jsonb_array_elements(outputs)) order by staff.user_id for share;
   perform 1 from public.work_memberships membership where membership.user_id in(select (value->>'assignee_id')::uuid from jsonb_array_elements(outputs)) order by membership.user_id,membership.service_id for share;
   perform 1 from auth.users account where account.id in(select (value->>'assignee_id')::uuid from jsonb_array_elements(outputs)) order by account.id for share;
   select name into source_name from public.work_services where id=a.service_id;
   for item in select value from jsonb_array_elements(outputs) loop
    sid=(item->>'service_id')::uuid; employee=(item->>'assignee_id')::uuid; why=trim(coalesce(item->>'reason',''));
    if sid is null or sid=a.service_id or length(why) not between 3 and 4000 then raise exception 'invalid_dependency'; end if;
    if exists(select 1 from provision_private.work_output_requests where part_id=a.id and target_service_id=sid and status in('pending','rejected')) then raise exception 'output_department_unavailable'; end if;
    -- A nested request may not route back into its ancestor departments or an existing upstream cycle
    if exists(with recursive ancestors(id,parent_id,service_id) as (
     select a.id,a.output_parent_id,a.service_id union select parent.id,parent.output_parent_id,parent.service_id from public.work_parts parent join ancestors current on parent.id=current.parent_id
    ) select 1 from ancestors where service_id=sid) then raise exception 'dependency_cycle'; end if;
    if not exists(select 1 from public.work_memberships m join public.work_services s on s.id=m.service_id and s.active
     join public.work_staff staff on staff.user_id=m.user_id join auth.users u on u.id=m.user_id
     where m.service_id=sid and m.user_id=employee and u.raw_app_meta_data->>'role'='employee' and provision_private.account_available(u.id)
      and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true') then raise exception 'invalid_employee'; end if;
    insert into public.work_parts(request_id,service_id,assignee_id,scope,priority,output_parent_id,route_position)
    values(r.id,sid,employee,why,a.priority,a.id,(select coalesce(max(route_position),0)+1 from public.work_parts where request_id=r.id)) returning * into child;
    insert into public.work_dependencies(request_id,part_id,upstream_id,reason,gate,status)
    values(r.id,a.id,child.id,why,'internal_delivery','accepted') returning id into dep_id;
    insert into provision_private.work_output_requests(request_id,part_id,upstream_id,dependency_id,source_service_id,source_employee_id,target_service_id,target_employee_id,reason)
    values(r.id,a.id,child.id,dep_id,a.service_id,auth.uid(),sid,employee,why) returning * into o;
    ids=ids||jsonb_build_array(o.id);
    select name into service_name from public.work_services where id=sid;
    perform provision_private.work_notify_once(employee,r.id,'قسم '||source_name||' طلب مخرجات قسم '||service_name,'output:'||o.id::text||':requested',true);
    insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,child.id,auth.uid(),'output_request','طلب مخرجات قسم '||service_name,false) returning id into audit_id;
    insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after) values(audit_id,null,child.assignee_id,null,'offered');
   end loop;
   update public.work_parts set status='waiting',accepted_at=coalesce(accepted_at,now()),due_at=null,output_due_required=true where id=a.id;
   if a.accepted_at is null then
    insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),'accept','استلام المهمة بانتظار المخرجات المطلوبة',true) returning id into audit_id;
    insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after) values(audit_id,a.assignee_id,a.assignee_id,a.status,'waiting');
   end if;
  elsif action='deliver_outputs' then
   select * into o from provision_private.work_output_requests where upstream_id=a.id and request_id=r.id for update;
   if o.id is null or o.status<>'pending' or a.status<>'working' or a.accepted_at is null then raise exception 'invalid_state'; end if;
   if a.output_due_required then raise exception 'output_due_required'; end if;
   if provision_private.work_dependency_blocked(a.id) then raise exception 'dependency_pending'; end if;
   if jsonb_typeof(files)<>'array' or jsonb_array_length(files) not between 1 and 40 or jsonb_array_length(files)<>(select count(distinct value->>'object_path') from jsonb_array_elements(files)) then raise exception 'invalid_file'; end if;
   batch=gen_random_uuid();
   for f in select value from jsonb_array_elements(files) loop
    if coalesce(length(trim(f->>'filename')),0) not between 1 and 200 or not exists(select 1 from storage.objects
     where bucket_id='work-files' and name=f->>'object_path' and owner_id=auth.uid()::text
     and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]=a.id::text) then raise exception 'invalid_file'; end if;
    insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,note,batch_id,internal_shared_at,internal_shared_by)
    values(r.id,a.id,auth.uid(),f->>'object_path',f->>'filename',left(coalesce(f->>'note',p->>'note',''),4000),batch,now(),auth.uid());
   end loop;
   update provision_private.work_output_requests set status='ready',resolved_at=now() where id=o.id;
   update public.work_parts set status='internal_done' where id=a.id;
   update public.work_parts source set status='working' where source.id=o.part_id and source.status='waiting' and not provision_private.work_dependency_blocked(source.id);
   select name into service_name from public.work_services where id=o.target_service_id;
   select * into child from public.work_parts where id=o.part_id;
   perform provision_private.work_notify_once(child.assignee_id,r.id,'مخرجات قسم '||service_name||case when provision_private.work_dependency_blocked(child.id) then ' جاهزة وبانتظار بقية المخرجات' else ' جاهزة حدد موعد تسليم مهمتك' end,'output:'||o.id::text||':ready',true);
   insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),'output_ready','تسليم مخرجات قسم '||service_name,false) returning id into audit_id;
   insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after) values(audit_id,a.assignee_id,a.assignee_id,a.status,'internal_done');
  elsif action='commit_output_due' then
   due=(p->>'due_at')::timestamptz;
   if not a.output_due_required or a.status<>'working' or provision_private.work_dependency_blocked(a.id) then raise exception 'invalid_state'; end if;
   if due is null or due<=now() or due>now()+interval '2 years' then raise exception 'invalid_due'; end if;
   update public.work_parts set due_at=due,output_due_required=false where id=a.id;
   insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),'output_due','تحديد موعد التسليم بعد استلام المخرجات',false) returning id into audit_id;
   insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after) values(audit_id,a.assignee_id,a.assignee_id,a.status,a.status);
  end if;
 end if;
 update public.work_requests set version=version+1,updated_at=now() where id=r.id;
 result=jsonb_build_object('request_id',r.id,'part_id',a.id,'output_request_ids',ids,'batch_id',batch);
 insert into provision_private.work_output_receipts(submission_key,actor,request_id,action,payload,result) values(key,auth.uid(),r.id,action,p-'version',result);
 return result;
end $$;
revoke all on function public.work_output_action(text,jsonb) from public,anon;
grant execute on function public.work_output_action(text,jsonb) to authenticated;

-- Surgical guards keep all existing routing and review actions on their original entry points
do $patch$
declare body text; needle text;
begin
 body=pg_get_functiondef('provision_private.work_read(uuid)'::regprocedure);
 needle='p.request_id=r and';
 if strpos(body,needle)=0 then raise exception 'output_request_access_shape'; end if;
 execute replace(body,needle,'p.request_id=r and not provision_private.work_output_cancelled(p.id) and');

 body=pg_get_functiondef('provision_private.work_part_read(uuid)'::regprocedure);
 needle='where part.id=p and (';
 if strpos(body,needle)=0 then raise exception 'output_part_read_shape'; end if;
 -- The raw assignment table includes scope and assignee so clients use only the safe RPC projection for output tasks
 execute replace(body,needle,'where part.id=p and (provision_private.work_manager() or provision_private.work_coordinator() or not provision_private.work_output_cancelled(part.id)) and (provision_private.work_role()<>''client'' or part.output_parent_id is null) and (');

 body=pg_get_functiondef('public.work_routes(uuid)'::regprocedure);
 needle='where part.request_id=p_request and';
 if strpos(body,needle)=0 then raise exception 'output_routes_shape'; end if;
 execute replace(body,needle,'where part.request_id=p_request and (provision_private.work_manager() or provision_private.work_coordinator() or not provision_private.work_output_cancelled(part.id)) and (role_name<>''client'' or provision_private.work_output_client_visible(part.id)) and');

 body=pg_get_functiondef('public.work_request_detail(uuid,boolean)'::regprocedure);
 needle='where visible_part.id=event.part_id and';
 if strpos(body,needle)=0 then raise exception 'output_detail_event_shape'; end if;
 body=replace(body,needle,'where visible_part.id=event.part_id and provision_private.work_output_client_visible(visible_part.id) and');
 needle='where part.request_id=p_request';
 if strpos(body,needle)=0 then raise exception 'output_detail_parts_shape'; end if;
 body=replace(body,needle,needle||' and (provision_private.work_manager() or provision_private.work_coordinator() or not provision_private.work_output_cancelled(part.id)) and (role_name<>''client'' or provision_private.work_output_client_visible(part.id))');
 needle='where review.request_id=p_request and';
 if strpos(body,needle)=0 then raise exception 'output_detail_due_shape'; end if;
 body=replace(body,needle,'where review.request_id=p_request and not part.output_due_required and provision_private.work_output_client_visible(part.id) and');
 needle=$old$'due_review_status',coalesce(review.status,case when part.due_at is not null then 'approved' end)$old$;
 if strpos(body,needle)=0 then raise exception 'output_detail_client_date_shape'; end if;
 body=replace(body,needle,$new$'due_review_status',case when part.output_due_required then 'pending' else coalesce(review.status,case when part.due_at is not null then 'approved' end) end$new$);
 needle=$old$'scope',part.scope,'status',part.status,$old$;
 if strpos(body,needle)=0 then raise exception 'output_detail_staff_shape'; end if;
 body=replace(body,needle,$new$'output_parent_id',part.output_parent_id,'output_due_required',part.output_due_required,'scope',part.scope,'status',part.status,$new$);
 needle=$old$return jsonb_build_object('inquiries',$old$;
 if strpos(body,needle)=0 then raise exception 'output_detail_result_shape'; end if;
 execute replace(body,needle,$new$return jsonb_build_object('output_requests',provision_private.work_output_projection(p_request),'output_assignees',provision_private.work_output_assignees(p_request),'inquiries',$new$);

 body=pg_get_functiondef('provision_private.work_add_dependency(uuid,uuid,uuid,text,text)'::regprocedure);
 needle=$old$if required_gate is null$old$;
 if strpos(body,needle)=0 then raise exception 'output_legacy_dependency_shape'; end if;
 execute replace(body,needle,$new$if exists(select 1 from provision_private.work_output_requests where part_id=a.id and target_service_id=b.service_id and status='rejected') then raise exception 'output_department_unavailable'; end if;
 if provision_private.work_output_cancelled(a.id) or provision_private.work_output_cancelled(b.id) then raise exception 'invalid_dependency'; end if;
 if b.output_parent_id is not null and b.output_parent_id<>a.id then raise exception 'invalid_dependency'; end if;
 if required_gate is null$new$);

 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$elsif action='deliver' then$old$;
 if strpos(body,needle)=0 then raise exception 'output_legacy_delivery_shape'; end if;
 execute replace(body,needle,needle||$new$
    if a.output_due_required then raise exception 'output_due_required'; end if;
    if a.output_parent_id is not null then raise exception 'output_delivery_required'; end if;$new$);

 body=pg_get_functiondef('provision_private.work_capture_due_review()'::regprocedure);
 needle='old.accepted_at is null and new.accepted_at is not null';
 if strpos(body,needle)=0 then raise exception 'output_due_review_shape'; end if;
 execute replace(body,needle,'(old.accepted_at is null or (old.output_due_required and not new.output_due_required and old.due_at is distinct from new.due_at)) and new.accepted_at is not null');

 body=pg_get_functiondef('provision_private.work_event_client_notice_required(bigint)'::regprocedure);
 needle='where event_row.id=p_event_id and';
 if strpos(body,needle)=0 then raise exception 'output_client_notification_shape'; end if;
 execute replace(body,needle,'where event_row.id=p_event_id and (event_row.part_id is null or provision_private.work_output_client_visible(event_row.part_id)) and');

 body=pg_get_functiondef('provision_private.work_client_event_message(bigint)'::regprocedure);
 needle='message=case event_row.kind';
 if strpos(body,needle)=0 then raise exception 'output_accept_client_message_shape'; end if;
 execute replace(body,needle,$new$if event_row.kind='accept' and service_visible and exists(select 1 from public.work_parts where id=event_row.part_id and output_parent_id is not null) then
  return 'تم توجيه طلبك إلى قسم '||service_name||' واستلم القسم المهمة';
 end if;
 message=case event_row.kind$new$);

 body=pg_get_functiondef('provision_private.work_notification_audience_eligible(uuid,text,uuid)'::regprocedure);
 needle='select exists(';
 if strpos(body,needle)=0 then raise exception 'output_notification_audience_shape'; end if;
 body=overlay(body placing $new$select not exists(select 1 from provision_private.work_output_requests o
  where o.request_id=p_request_id and o.status='rejected' and p_event_key='control:output:'||o.id::text||':requested') and exists($new$ from strpos(body,needle) for length(needle));
 needle=$old$then account.raw_app_meta_data->>'role'='client'$old$;
 if strpos(body,needle)=0 then raise exception 'output_queued_client_shape'; end if;
 execute replace(body,needle,needle||$new$ and not exists(select 1 from public.work_events event_row
  where event_row.request_id=p_request_id and p_event_key='journey:event:'||event_row.id::text||':client'
   and event_row.part_id is not null and not provision_private.work_output_client_visible(event_row.part_id))$new$);

 body=pg_get_functiondef('provision_private.work_inquiry_read(uuid)'::regprocedure);
 needle='service.active and service.client_visible and part.service_id=inquiry.service_id';
 if strpos(body,needle)=0 then raise exception 'output_inquiry_visibility_shape'; end if;
 execute replace(body,needle,needle||' and provision_private.work_output_client_visible(part.id)');

 body=pg_get_functiondef('public.work_department_inquiry_action(text,jsonb)'::regprocedure);
 needle=$old$if a.status not in ('offered','working') then$old$;
 if strpos(body,needle)=0 then raise exception 'output_inquiry_accept_shape'; end if;
 execute replace(body,needle,$new$if a.output_parent_id is not null and a.accepted_at is null then raise exception 'output_accept_required'; end if;
  if a.status not in ('offered','working') then$new$);

 body=pg_get_functiondef('provision_private.work_file_read(text)'::regprocedure);
 needle='where d.object_path=path and (';
 if strpos(body,needle)=0 then raise exception 'output_storage_read_shape'; end if;
 execute replace(body,needle,'where d.object_path=path and provision_private.work_output_file_read(d.part_id) and (');

 body=pg_get_functiondef('provision_private.work_event_action_label(text)'::regprocedure);
 needle=$old$else 'تحديث داخلي على الطلب'$old$;
 if strpos(body,needle)=0 then raise exception 'output_notification_labels_shape'; end if;
 execute replace(body,needle,$new$when 'output_request' then 'طلب مخرجات قسم'
  when 'output_ready' then 'جاهزية مخرجات قسم'
  when 'output_rejected' then 'رفض الإدارة لطلب مخرجات قسم'
  when 'output_due' then 'تحديد موعد التسليم بعد استلام المخرجات'
  else 'تحديث داخلي على الطلب'$new$);

 -- Cancelled output assignments remain an administrative record not performance samples
 body=pg_get_functiondef('public.work_employee_performance(integer)'::regprocedure);
 needle='where part.assigned_at>=';
 if strpos(body,needle)=0 then raise exception 'output_employee_metrics_shape'; end if;
 execute replace(body,needle,'where not provision_private.work_output_cancelled(part.id) and part.assigned_at>=');
 body=pg_get_functiondef('public.work_team_overview(date,date)'::regprocedure);
 needle='from public.work_parts part join public.work_requests request on request.id=part.request_id';
 if strpos(body,needle)=0 then raise exception 'output_overview_metrics_shape'; end if;
 execute replace(body,needle,needle||' and not provision_private.work_output_cancelled(part.id)');
end $patch$;

commit;
