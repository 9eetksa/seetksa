begin;

-- Internal team missions are separate from the preserved customer-request workflow.
alter table public.work_staff add column operations_manager boolean not null default false;
create table public.seet_missions (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 title text not null check(length(title) between 3 and 200),
 description text not null check(length(description) between 10 and 12000),
 drive_url text, map_url text, execution_at timestamptz not null,
 status text not null default 'draft' check(status in ('draft','published','completed')),
 created_by uuid not null references auth.users, submission_key uuid not null,
 submission_payload jsonb not null, version integer not null default 1, test boolean not null default false,
 created_at timestamptz not null default now(), published_at timestamptz, completed_at timestamptz,
 unique(created_by,submission_key)
);
create index seet_missions_published on public.seet_missions(status,created_at desc,id);
create table public.seet_mission_departments (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null references public.seet_missions on delete cascade,
 service_id uuid not null references public.work_services,
 requirements text not null check(length(requirements) between 3 and 6000),
 execution_at timestamptz not null, due_at timestamptz not null,
 capacity integer check(capacity between 1 and 100),
 check(due_at>=execution_at), unique(mission_id,service_id), unique(id,mission_id)
);
create index seet_mission_departments_service on public.seet_mission_departments(service_id);
create table public.seet_mission_assignments (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null references public.seet_missions on delete cascade,
 department_id uuid not null, user_id uuid not null references auth.users,
 status text not null default 'invited' check(status in ('invited','working','completed','unable_pending','unable')),
 note text not null default '' check(length(note)<=4000), version integer not null default 1,
 assigned_by uuid not null references auth.users, accepted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(mission_id,user_id), foreign key(department_id,mission_id) references public.seet_mission_departments(id,mission_id)
);
create index seet_mission_assignments_user on public.seet_mission_assignments(user_id,status,mission_id);
create index seet_mission_assignments_department on public.seet_mission_assignments(department_id,status);
create table public.seet_mission_joins (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null references public.seet_missions on delete cascade,
 department_id uuid not null, user_id uuid not null references auth.users,
 message text not null check(length(message) between 3 and 2000),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reason text not null default '' check(length(reason)<=4000), reviewed_by uuid references auth.users,
 version integer not null default 1, created_at timestamptz not null default now(), reviewed_at timestamptz,
 unique(mission_id,user_id), foreign key(department_id,mission_id) references public.seet_mission_departments(id,mission_id)
);
create index seet_mission_joins_inbox on public.seet_mission_joins(status,created_at);
create index seet_mission_joins_department on public.seet_mission_joins(department_id);
create index seet_mission_joins_user on public.seet_mission_joins(user_id);
create table public.seet_mission_attachments (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null references public.seet_missions on delete cascade,
 object_path text not null unique, filename text not null check(length(filename) between 1 and 240),
 uploaded_by uuid not null references auth.users, created_at timestamptz not null default now()
);
create index seet_mission_attachments_mission on public.seet_mission_attachments(mission_id);
create table public.seet_mission_events (
 id bigint generated always as identity primary key, mission_id uuid not null references public.seet_missions on delete cascade,
 actor uuid not null references auth.users, kind text not null,
 note text not null default '' check(length(note)<=4000), details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index seet_mission_events_mission on public.seet_mission_events(mission_id,id desc);

create function provision_private.seet_mission_person(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_available(p_user) and exists(select 1 from auth.users where id=p_user
  and raw_app_meta_data->>'role' in ('employee','admin','super_admin')
  and coalesce(raw_app_meta_data->>'must_change_password','false')<>'true');
$$;
create function provision_private.seet_mission_operations() returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(select 1 from public.work_staff
  where user_id=auth.uid() and operations_manager);
$$;
create function provision_private.seet_mission_reviewer() returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and (provision_private.work_manager() or provision_private.seet_mission_operations());
$$;
create function provision_private.seet_mission_read(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and provision_private.seet_staff() and exists(
  select 1 from public.seet_missions where id=p_id and (status<>'draft' or provision_private.work_manager())
  and (not test or exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'portal_qa'='true')));
$$;
revoke all on function provision_private.seet_mission_person(uuid) from public,anon,authenticated;
revoke all on function provision_private.seet_mission_operations(),provision_private.seet_mission_reviewer(),provision_private.seet_mission_read(uuid) from public,anon;
grant execute on function provision_private.seet_mission_operations(),provision_private.seet_mission_reviewer(),provision_private.seet_mission_read(uuid) to authenticated;

-- All writes are transactional RPCs. Direct INSERT/UPDATE/DELETE are denied.
do $$ declare t text; begin
 foreach t in array array['seet_missions','seet_mission_departments','seet_mission_assignments','seet_mission_joins','seet_mission_attachments','seet_mission_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy seet_staff_only on public.%I as restrictive for all to authenticated using (provision_private.account_ready() and provision_private.seet_staff()) with check (false)',t);
  if t='seet_missions' then
   execute format('create policy mission_read on public.%I for select to authenticated using (provision_private.seet_mission_read(id))',t);
  elsif t='seet_mission_joins' then
   execute format('create policy mission_read on public.%I for select to authenticated using (provision_private.seet_mission_read(mission_id) and (user_id=auth.uid() or provision_private.seet_mission_reviewer()))',t);
  else
   execute format('create policy mission_read on public.%I for select to authenticated using (provision_private.seet_mission_read(mission_id))',t);
  end if;
 end loop;
end $$;
grant usage,select on sequence public.seet_missions_number_seq,public.seet_mission_events_id_seq to service_role;
-- Never expose the original submission envelope through direct reads.
revoke select on public.seet_missions from authenticated;
grant select(id,number,title,description,drive_url,map_url,execution_at,status,created_by,version,created_at,published_at,completed_at) on public.seet_missions to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(
 'mission-files','mission-files',false,104857600,array[
 'image/jpeg','image/png','image/webp','image/gif','image/heic','video/mp4','video/webm','video/quicktime',
 'application/pdf','text/plain','application/zip','application/x-zip-compressed','application/msword',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint',
 'application/vnd.openxmlformats-officedocument.presentationml.presentation']);
create function provision_private.seet_mission_upload(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and provision_private.work_manager()
  and p_name ~ '^[0-9a-f-]{36}/brief/[0-9a-f-]{36}\.[a-z0-9]{1,8}$'
  and exists(select 1 from public.seet_missions where id::text=split_part(p_name,'/',1) and status='draft' and provision_private.seet_mission_read(id));
$$;
create function provision_private.seet_mission_file_read(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and (
  provision_private.seet_mission_upload(p_name) or exists(select 1 from public.seet_mission_attachments
   where object_path=p_name and provision_private.seet_mission_read(mission_id)));
$$;
create function provision_private.seet_mission_file_remove(p_name text,p_owner text) returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.seet_mission_upload(p_name) and p_owner=auth.uid()::text
  and not exists(select 1 from public.seet_mission_attachments where object_path=p_name);
$$;
revoke all on function provision_private.seet_mission_upload(text),provision_private.seet_mission_file_read(text),provision_private.seet_mission_file_remove(text,text) from public,anon;
grant execute on function provision_private.seet_mission_upload(text),provision_private.seet_mission_file_read(text),provision_private.seet_mission_file_remove(text,text) to authenticated;
create policy mission_upload on storage.objects for insert to authenticated with check(bucket_id='mission-files' and owner_id=auth.uid()::text and provision_private.seet_mission_upload(name));
create policy mission_download on storage.objects for select to authenticated using(bucket_id='mission-files' and provision_private.seet_mission_file_read(name));
create policy mission_remove_draft on storage.objects for delete to authenticated using(bucket_id='mission-files' and provision_private.seet_mission_file_remove(name,owner_id));
-- There is deliberately no UPDATE policy: originals cannot be overwritten.

alter table public.work_notifications add column mission_id uuid references public.seet_missions on delete cascade;
create index work_notifications_mission on public.work_notifications(mission_id) where mission_id is not null;
create function provision_private.seet_mission_notify(p_id uuid,p_event bigint,p_message text,p_audience text,p_user uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.work_notifications(recipient,mission_id,message,event_key,whatsapp)
 select distinct u.id,p_id,p_message,'mission:'||p_event::text||':'||u.id::text,'suppressed'
 from auth.users u left join public.work_staff s on s.user_id=u.id
 where provision_private.seet_mission_person(u.id)
 and (not exists(select 1 from public.seet_missions where id=p_id and test) or u.raw_app_meta_data->>'portal_qa'='true') and (
  u.id=p_user or
  p_audience in ('reviewers','published') and (u.raw_app_meta_data->>'role' in ('admin','super_admin') or coalesce(s.operations_manager,false)) or
  p_audience='published' and exists(select 1 from public.work_memberships member
   join public.seet_mission_departments department on department.service_id=member.service_id
   where member.user_id=u.id and department.mission_id=p_id)
  or p_audience='published' and exists(select 1 from public.seet_mission_assignments where mission_id=p_id and user_id=u.id));
end $$;
revoke all on function provision_private.seet_mission_notify(uuid,bigint,text,text,uuid) from public,anon,authenticated;

create function public.seet_mission_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not provision_private.seet_staff() then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object('user_id',auth.uid(),'admin',provision_private.work_manager(),
 'operations',provision_private.seet_mission_operations(),
 'department_ids',(select coalesce(jsonb_agg(service_id),'[]') from public.work_memberships where user_id=auth.uid()),
 'departments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.work_services where active),
 'people',case when provision_private.seet_mission_reviewer() then (select coalesce(jsonb_agg(x order by x.name),'[]') from (
  select u.id,coalesce(nullif(p.display_name,''),u.email) as name,u.raw_app_meta_data->>'role' as role,
   u.raw_app_meta_data->>'job_title' as job_title,u.email,coalesce(nullif(p.phone,''),u.phone) as phone,
   coalesce(s.operations_manager,false) as operations_manager,
   (select coalesce(jsonb_agg(service_id),'[]') from public.work_memberships where user_id=u.id) as departments
  from auth.users u left join public.account_profiles p on p.user_id=u.id left join public.work_staff s on s.user_id=u.id
  where provision_private.seet_mission_person(u.id)
 )x) else '[]'::jsonb end);
end $$;

create function provision_private.seet_mission_departments_json(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.name),'[]') from (
  select d.*,s.name,
   (select count(*) from public.seet_mission_assignments where department_id=d.id and status<>'unable') as assigned_count,
   (select count(*) from public.seet_mission_assignments where department_id=d.id and status='completed') as completed_count
  from public.seet_mission_departments d join public.work_services s on s.id=d.service_id where d.mission_id=p_id
 )x;
$$;
revoke all on function provision_private.seet_mission_departments_json(uuid) from public,anon,authenticated;

create function public.seet_mission_board(p_view text default 'available',p_search text default '',p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare output jsonb; reviewer boolean;
begin
 if not provision_private.account_ready() or not provision_private.seet_staff() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_view is null or p_view not in ('overview','available','mine','operations','drafts','completed') then raise exception 'invalid_input'; end if;
 reviewer=provision_private.seet_mission_reviewer();
 if p_view='operations' and not reviewer then raise exception 'forbidden'; end if;
 with filtered as (
  select m.id,m.number,m.title,m.description,m.status,m.execution_at,m.created_at,m.version
  from public.seet_missions m where provision_private.seet_mission_read(m.id)
  and (coalesce(p_search,'')='' or m.title ilike '%'||left(p_search,200)||'%' or m.description ilike '%'||left(p_search,200)||'%')
  and case p_view
   when 'mine' then exists(select 1 from public.seet_mission_assignments where mission_id=m.id and user_id=auth.uid())
   when 'drafts' then m.status='draft'
   when 'completed' then m.status='completed'
   when 'available' then m.status='published'
   when 'operations' then m.status='published'
   else m.status<>'completed' end
 ), page as (select * from filtered order by created_at desc,id desc limit 24 offset least(greatest(coalesce(p_page,0),0),10000)*24)
 select jsonb_build_object('items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]') from (
  select page.*,provision_private.seet_mission_departments_json(page.id) as departments,
  (select coalesce(jsonb_agg(a),'[]') from public.seet_mission_assignments a where a.mission_id=page.id and a.user_id=auth.uid()) as mine
  from page
 )x),'total',(select count(*) from filtered)) into output;
 return output||jsonb_build_object('stats',jsonb_build_object(
  'published',(select count(*) from public.seet_missions where status='published' and provision_private.seet_mission_read(id)),
  'mine',(select count(*) from public.seet_mission_assignments where user_id=auth.uid() and status not in ('completed','unable') and provision_private.seet_mission_read(mission_id)),
  'invited',(select count(*) from public.seet_mission_assignments where user_id=auth.uid() and status='invited' and provision_private.seet_mission_read(mission_id)),
  'pending_joins',(select count(*) from public.seet_mission_joins where status='pending' and (reviewer or user_id=auth.uid()) and provision_private.seet_mission_read(mission_id)),
  'unable_pending',(select count(*) from public.seet_mission_assignments where status='unable_pending' and (reviewer or user_id=auth.uid()) and provision_private.seet_mission_read(mission_id))
 ));
end $$;

create function public.seet_mission_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare reviewer boolean;
begin
 if not provision_private.seet_mission_read(p_id) then raise exception 'forbidden' using errcode='42501'; end if;
 reviewer=provision_private.seet_mission_reviewer();
 return jsonb_build_object(
 'mission',(select to_jsonb(m)-'submission_payload'-'submission_key' from public.seet_missions m where id=p_id),
 'departments',provision_private.seet_mission_departments_json(p_id),
 'assignments',(select coalesce(jsonb_agg(x order by x.created_at),'[]') from (
  select a.*,coalesce(nullif(p.display_name,''),u.email) as name from public.seet_mission_assignments a
  join auth.users u on u.id=a.user_id left join public.account_profiles p on p.user_id=u.id where a.mission_id=p_id
 )x),
 'joins',(select coalesce(jsonb_agg(x order by x.created_at),'[]') from (
  select j.*,coalesce(nullif(p.display_name,''),u.email) as name,
   case when reviewer or j.user_id=auth.uid() then u.email end as email,
   case when reviewer or j.user_id=auth.uid() then coalesce(nullif(p.phone,''),u.phone) end as phone,
   u.raw_app_meta_data->>'job_title' as job_title,
   (select coalesce(jsonb_agg(s.name),'[]') from public.work_memberships mem join public.work_services s on s.id=mem.service_id where mem.user_id=j.user_id) as department_names
  from public.seet_mission_joins j join auth.users u on u.id=j.user_id left join public.account_profiles p on p.user_id=u.id
  where j.mission_id=p_id and (reviewer or j.user_id=auth.uid())
 )x),
 'attachments',(select coalesce(jsonb_agg(a order by a.created_at),'[]') from public.seet_mission_attachments a where mission_id=p_id),
 'events',(select coalesce(jsonb_agg(x order by x.id desc),'[]') from (
  select e.*,coalesce(nullif(p.display_name,''),'عضو الفريق') as actor_name from public.seet_mission_events e
  left join public.account_profiles p on p.user_id=e.actor where mission_id=p_id order by e.id desc limit 100
 )x));
end $$;

create function public.seet_mission_action(p_action text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
<<mission_action>>
declare m public.seet_missions; d public.seet_mission_departments; a public.seet_mission_assignments; j public.seet_mission_joins;
 entry jsonb; target uuid; eid bigint; msg text; audience text:='reviewers'; notify_user uuid;
 admin boolean; ops boolean; quantity integer; occupied integer; next_status text; note text; rid uuid;
begin
 if not provision_private.account_ready() or not provision_private.seet_staff() then raise exception 'forbidden' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' or p_action is null then raise exception 'invalid_input'; end if;
 admin=provision_private.work_manager(); ops=provision_private.seet_mission_operations();
 if p_action='set_operations' then
  if not admin then raise exception 'forbidden'; end if;
  target=(p->>'user_id')::uuid;
  if not provision_private.seet_mission_person(target) or jsonb_typeof(p->'enabled') is distinct from 'boolean' then raise exception 'invalid_employee'; end if;
  insert into public.work_staff(user_id,operations_manager) values(target,(p->>'enabled')::boolean)
   on conflict(user_id) do update set operations_manager=excluded.operations_manager;
  insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),target,'seet_operations_access',jsonb_build_object('enabled',p->'enabled'));
  return jsonb_build_object('user_id',target,'enabled',p->'enabled');
 end if;
 if p_action='create' then
  if not admin then raise exception 'forbidden'; end if;
  if nullif(p->>'submission_key','') is null then raise exception 'invalid_input'; end if;
  -- Serializes retrying submissions before any children or notifications are created.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||(p->>'submission_key'),0));
  select * into m from public.seet_missions where created_by=auth.uid() and submission_key=(p->>'submission_key')::uuid;
  if found then
   if m.submission_payload<>p then raise exception 'submission_conflict'; end if;
   return jsonb_build_object('id',m.id,'version',m.version);
  end if;
  if length(btrim(coalesce(p->>'title',''))) not between 3 and 200
   or length(btrim(coalesce(p->>'description',''))) not between 10 and 12000
   or nullif(p->>'execution_at','') is null or (p->>'execution_at')::timestamptz<now()
   or jsonb_typeof(p->'departments') is distinct from 'array'
   or jsonb_array_length(p->'departments') not between 1 and 30 then raise exception 'invalid_input'; end if;
  if nullif(btrim(p->>'drive_url'),'') is not null and not (p->>'drive_url' ~ '^https://(drive|docs)\.google\.com/[^[:space:]]+$') then raise exception 'invalid_drive_url'; end if;
  if nullif(btrim(p->>'map_url'),'') is not null and not (p->>'map_url' ~ '^https://(maps\.app\.goo\.gl/|goo\.gl/maps/|(www\.)?google\.com/maps[/?]|maps\.google\.com/)[^[:space:]]+$') then raise exception 'invalid_map_url'; end if;
  insert into public.seet_missions(title,description,drive_url,map_url,execution_at,created_by,submission_key,submission_payload,test)
  values(btrim(p->>'title'),btrim(p->>'description'),nullif(btrim(p->>'drive_url'),''),nullif(btrim(p->>'map_url'),''),(p->>'execution_at')::timestamptz,auth.uid(),(p->>'submission_key')::uuid,p,
   exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'portal_qa'='true')) returning * into m;
  for entry in select value from jsonb_array_elements(p->'departments') loop
   if not exists(select 1 from public.work_services where id=(entry->>'service_id')::uuid and active)
    or length(btrim(coalesce(entry->>'requirements',''))) not between 3 and 6000
    or nullif(entry->>'execution_at','') is null or nullif(entry->>'due_at','') is null
    or (entry->>'execution_at')::timestamptz<m.execution_at or (entry->>'due_at')::timestamptz<(entry->>'execution_at')::timestamptz then raise exception 'invalid_departments'; end if;
   insert into public.seet_mission_departments(mission_id,service_id,requirements,execution_at,due_at)
   values(m.id,(entry->>'service_id')::uuid,btrim(entry->>'requirements'),(entry->>'execution_at')::timestamptz,(entry->>'due_at')::timestamptz);
  end loop;
  insert into public.seet_mission_events(mission_id,actor,kind) values(m.id,auth.uid(),'create');
  return jsonb_build_object('id',m.id,'version',m.version);
 end if;
 rid=(p->>'id')::uuid;
 select * into m from public.seet_missions where id=rid for update;
 if not found or not provision_private.seet_mission_read(rid) then raise exception 'forbidden'; end if;
 if p_action='publish' and admin and m.status='published' then return jsonb_build_object('id',m.id,'version',m.version); end if;
 if (p->>'version')::integer is distinct from m.version then raise exception 'version_conflict'; end if;
 note=btrim(coalesce(p->>'note',p->>'reason',''));
 if length(note)>4000 then raise exception 'invalid_reason'; end if;
 if p_action in ('attach','publish') then
  if not admin or m.status<>'draft' then raise exception 'forbidden'; end if;
 elsif m.status<>'published' then raise exception 'invalid_state'; end if;

 case p_action
 when 'attach' then
  if jsonb_typeof(p->'files') is distinct from 'array' or jsonb_array_length(p->'files') not between 1 and 20
   or (select count(*) from public.seet_mission_attachments where mission_id=rid)+jsonb_array_length(p->'files')>20 then raise exception 'invalid_file'; end if;
  for entry in select value from jsonb_array_elements(p->'files') loop
   if not provision_private.seet_mission_upload(entry->>'object_path') or split_part(entry->>'object_path','/',1)<>rid::text
    or length(coalesce(entry->>'filename','')) not between 1 and 240
    or not exists(select 1 from storage.objects where bucket_id='mission-files' and name=entry->>'object_path' and owner_id=auth.uid()::text)
   then raise exception 'invalid_file'; end if;
   insert into public.seet_mission_attachments(mission_id,object_path,filename,uploaded_by) values(rid,entry->>'object_path',entry->>'filename',auth.uid());
  end loop;
  msg='إضافة مرفقات المهمة'; audience='none';
 when 'publish' then
  if m.execution_at<now() then raise exception 'invalid_due'; end if;
  update public.seet_missions set status='published',published_at=now() where id=rid;
  msg='مهمة جديدة متاحة للفريق'; audience='published';
 when 'capacity' then
  if not ops then raise exception 'forbidden'; end if;
  quantity=(p->>'capacity')::integer;
  select * into d from public.seet_mission_departments where id=(p->>'department_id')::uuid and mission_id=rid;
  if not found or quantity is null or quantity not between 1 and 100 then raise exception 'invalid_input'; end if;
  select count(*) into occupied from public.seet_mission_assignments where department_id=d.id and status<>'unable';
  if quantity<occupied then raise exception 'capacity_below_assigned'; end if;
  update public.seet_mission_departments set capacity=quantity where id=d.id;
  msg='تحديث عدد مقاعد القسم';
 when 'invite' then
  if not ops then raise exception 'forbidden'; end if;
  select * into d from public.seet_mission_departments where id=(p->>'department_id')::uuid and mission_id=rid;
  if not found or d.capacity is null then raise exception 'capacity_required'; end if;
  if jsonb_typeof(p->'user_ids') is distinct from 'array' or jsonb_array_length(p->'user_ids') not between 1 and 100 then raise exception 'invalid_employee'; end if;
  select count(*) into occupied from public.seet_mission_assignments where department_id=d.id and status<>'unable';
  if occupied+jsonb_array_length(p->'user_ids')>d.capacity then raise exception 'capacity_full'; end if;
  for target in select value::uuid from jsonb_array_elements_text(p->'user_ids') loop
   if not provision_private.seet_mission_person(target) then raise exception 'invalid_employee'; end if;
   if m.test and not exists(select 1 from auth.users where id=target and raw_app_meta_data->>'portal_qa'='true') then raise exception 'invalid_employee'; end if;
   if exists(select 1 from public.seet_mission_assignments where mission_id=rid and user_id=target) then raise exception 'already_assigned'; end if;
   insert into public.seet_mission_assignments(mission_id,department_id,user_id,assigned_by) values(rid,d.id,target,auth.uid());
   update public.seet_mission_joins set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),version=version+1,
    department_id=d.id,reason='تم التكليف من الأوبريشن' where mission_id=rid and user_id=target and status='pending';
   insert into public.seet_mission_events(mission_id,actor,kind,note,details) values(rid,auth.uid(),'invite','تكليف عضو في القسم',jsonb_build_object('user_id',target,'department_id',d.id)) returning id into eid;
   perform provision_private.seet_mission_notify(rid,eid,'لديك تكليف جديد بانتظار الاستلام — '||m.title,'none',target);
  end loop;
  msg='توزيع المهمة على الفريق';
 when 'join' then
  if exists(select 1 from public.work_memberships mem join public.seet_mission_departments dep on dep.service_id=mem.service_id where mem.user_id=auth.uid() and dep.mission_id=rid)
   or exists(select 1 from public.seet_mission_assignments where mission_id=rid and user_id=auth.uid()) then raise exception 'join_not_eligible'; end if;
  select * into d from public.seet_mission_departments where id=(p->>'department_id')::uuid and mission_id=rid;
  if not found or length(btrim(coalesce(p->>'message',''))) not between 3 and 2000 then raise exception 'invalid_input'; end if;
  if exists(select 1 from public.seet_mission_joins where mission_id=rid and user_id=auth.uid()) then raise exception 'join_already_requested'; end if;
  insert into public.seet_mission_joins(mission_id,department_id,user_id,message) values(rid,d.id,auth.uid(),btrim(p->>'message'));
  msg='طلب انضمام جديد للمهمة'; note='';
 when 'review_join' then
  if not (admin or ops) then raise exception 'forbidden'; end if;
  select * into j from public.seet_mission_joins where id=(p->>'join_id')::uuid and mission_id=rid;
  if not found or j.status<>'pending' then raise exception 'invalid_state'; end if;
  if p->>'decision'='approve' then
   select * into d from public.seet_mission_departments where id=j.department_id;
   if not provision_private.seet_mission_person(j.user_id) then raise exception 'invalid_employee'; end if;
   if d.capacity is null then raise exception 'capacity_required'; end if;
   if (select count(*) from public.seet_mission_assignments where department_id=d.id and status<>'unable')>=d.capacity then raise exception 'capacity_full'; end if;
   if exists(select 1 from public.seet_mission_assignments where mission_id=rid and user_id=j.user_id) then raise exception 'already_assigned'; end if;
   insert into public.seet_mission_assignments(mission_id,department_id,user_id,assigned_by) values(rid,d.id,j.user_id,auth.uid());
   next_status='approved'; msg='تم قبول طلب الانضمام وبانتظار استلام المهمة';
  elsif p->>'decision'='reject' and length(note)>=3 then next_status='rejected'; msg='تم رفض طلب الانضمام';
  else raise exception 'invalid_reason'; end if;
  update public.seet_mission_joins set status=next_status,reason=note,reviewed_by=auth.uid(),reviewed_at=now(),version=version+1 where id=j.id;
  notify_user=j.user_id;
 when 'progress' then
  select * into a from public.seet_mission_assignments where id=(p->>'assignment_id')::uuid and mission_id=rid and user_id=auth.uid();
  if not found then raise exception 'forbidden'; end if;
  next_status=p->>'status';
  if next_status is null or not (
   next_status='working' and a.status in ('invited','working') or
   next_status in ('completed','unable_pending') and a.status='working'
  ) then raise exception 'invalid_state'; end if;
  if next_status='unable_pending' and length(note)<3 then raise exception 'invalid_reason'; end if;
  if next_status='working' and a.status='working' and length(note)<3 then raise exception 'invalid_reason'; end if;
  update public.seet_mission_assignments set status=next_status,note=mission_action.note,
   accepted_at=coalesce(accepted_at,now()),updated_at=now(),version=version+1 where id=a.id;
  msg=case when next_status='working' and a.status='invited' then 'تم استلام المهمة'
   when next_status='working' then 'تحديث تقدم التنفيذ' when next_status='completed' then 'تم إنجاز التكليف' else 'طلب اعتماد تعذر التنفيذ' end;
 when 'review_unable' then
  if not ops then raise exception 'forbidden'; end if;
  select * into a from public.seet_mission_assignments where id=(p->>'assignment_id')::uuid and mission_id=rid;
  if not found or a.status<>'unable_pending' then raise exception 'invalid_state'; end if;
  if p->>'decision' is null or p->>'decision' not in ('approve','reject') or length(note)<3 then raise exception 'invalid_reason'; end if;
  next_status=case when p->>'decision'='approve' then 'unable' else 'working' end;
  update public.seet_mission_assignments set status=next_status,note=mission_action.note,updated_at=now(),version=version+1 where id=a.id;
  msg=case when next_status='unable' then 'اعتماد تعذر التنفيذ' else 'إعادة التكليف لاستكمال التنفيذ' end; notify_user=a.user_id;
 when 'close' then
  if not (admin or ops) then raise exception 'forbidden'; end if;
  if exists(select 1 from public.seet_mission_departments dep where dep.mission_id=rid and
   (not exists(select 1 from public.seet_mission_assignments where department_id=dep.id and status='completed') or
    exists(select 1 from public.seet_mission_assignments where department_id=dep.id and status not in ('completed','unable'))))
   or exists(select 1 from public.seet_mission_joins where mission_id=rid and status='pending') then raise exception 'mission_not_complete'; end if;
  update public.seet_missions set status='completed',completed_at=now() where id=rid;
  msg='اكتملت المهمة'; audience='published';
 else raise exception 'invalid_input';
 end case;
 update public.seet_missions set version=version+1 where id=rid returning * into m;
 insert into public.seet_mission_events(mission_id,actor,kind,note,details) values(rid,auth.uid(),p_action,note,
  jsonb_strip_nulls(jsonb_build_object('department_id',d.id,'assignment_id',a.id,'join_id',j.id,'user_id',coalesce(a.user_id,j.user_id),
   'status',next_status,'decision',p->>'decision','capacity',quantity))) returning id into eid;
 perform provision_private.seet_mission_notify(rid,eid,msg||' — '||m.title,audience,notify_user);
 if p_action in ('publish','capacity','invite','review_join','review_unable','close') then
  insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'seet_mission_'||p_action,
   jsonb_build_object('mission_id',rid,'department_id',d.id,'assignment_id',a.id,'join_id',j.id,'version',m.version));
 end if;
 return jsonb_build_object('id',m.id,'version',m.version);
end $$;
revoke all on function public.seet_mission_context(),public.seet_mission_board(text,text,integer),public.seet_mission_detail(uuid),public.seet_mission_action(text,jsonb) from public,anon;
grant execute on function public.seet_mission_context(),public.seet_mission_board(text,text,integer),public.seet_mission_detail(uuid),public.seet_mission_action(text,jsonb) to authenticated;

-- Extend the existing recipient-protected notification feed and signal channel.
do $$ declare original text; patched text; begin
 original=pg_get_functiondef('public.work_notifications_page(integer)'::regprocedure);
 patched=replace(original,'notification.id,notification.request_id,notification.message',
  'notification.id,notification.request_id,notification.mission_id,notification.message');
 patched=replace(patched,'request.title as request_title',
  'coalesce(request.title,(select title from public.seet_missions where id=notification.mission_id)) as request_title');
 if patched=original or position('notification.mission_id,notification.message' in patched)=0 then raise exception 'mission_notification_contract_changed'; end if;
 execute patched;
end $$;
notify pgrst,'reload schema';
commit;
