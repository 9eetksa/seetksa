begin;
-- Drafts can be resumed after their original date has passed without losing uploads.
create function public.seet_mission_update_draft(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.seet_missions; entry jsonb;
begin
 if not provision_private.account_ready() or not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501'; end if;
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'invalid_input'; end if;
 select * into m from public.seet_missions where id=(p->>'id')::uuid for update;
 if not found or not provision_private.seet_mission_read(m.id) then raise exception 'forbidden'; end if;
 if m.status<>'draft' then raise exception 'invalid_state'; end if;
 if (p->>'version')::integer is distinct from m.version then raise exception 'version_conflict'; end if;
 if length(btrim(coalesce(p->>'title',''))) not between 3 and 200
  or length(btrim(coalesce(p->>'description',''))) not between 10 and 12000
  or nullif(p->>'execution_at','') is null or (p->>'execution_at')::timestamptz<now()
  or jsonb_typeof(p->'departments') is distinct from 'array'
  or jsonb_array_length(p->'departments') not between 1 and 30 then raise exception 'invalid_input'; end if;
 if nullif(btrim(p->>'drive_url'),'') is not null and not (p->>'drive_url' ~ '^https://(drive|docs)\.google\.com/[^[:space:]]+$') then raise exception 'invalid_drive_url'; end if;
 if nullif(btrim(p->>'map_url'),'') is not null and not (p->>'map_url' ~ '^https://(maps\.app\.goo\.gl/|goo\.gl/maps/|(www\.)?google\.com/maps[/?]|maps\.google\.com/)[^[:space:]]+$') then raise exception 'invalid_map_url'; end if;
 update public.seet_missions set title=btrim(p->>'title'),description=btrim(p->>'description'),
  drive_url=nullif(btrim(p->>'drive_url'),''),map_url=nullif(btrim(p->>'map_url'),''),execution_at=(p->>'execution_at')::timestamptz,
  version=version+1 where id=m.id returning * into m;
 delete from public.seet_mission_departments where mission_id=m.id;
 for entry in select value from jsonb_array_elements(p->'departments') loop
  if not exists(select 1 from public.work_services where id=(entry->>'service_id')::uuid and active)
   or length(btrim(coalesce(entry->>'requirements',''))) not between 3 and 6000
   or nullif(entry->>'execution_at','') is null or nullif(entry->>'due_at','') is null
   or (entry->>'execution_at')::timestamptz<m.execution_at or (entry->>'due_at')::timestamptz<(entry->>'execution_at')::timestamptz then raise exception 'invalid_departments'; end if;
  insert into public.seet_mission_departments(mission_id,service_id,requirements,execution_at,due_at)
  values(m.id,(entry->>'service_id')::uuid,btrim(entry->>'requirements'),(entry->>'execution_at')::timestamptz,(entry->>'due_at')::timestamptz);
 end loop;
 insert into public.seet_mission_events(mission_id,actor,kind) values(m.id,auth.uid(),'update_draft');
 insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'seet_mission_update_draft',jsonb_build_object('mission_id',m.id,'version',m.version));
 return jsonb_build_object('id',m.id,'version',m.version);
end $$;
revoke all on function public.seet_mission_update_draft(jsonb) from public,anon;
grant execute on function public.seet_mission_update_draft(jsonb) to authenticated;
-- Test fixtures must not appear as candidates in the real team's role/distribution UI.
create or replace function public.seet_mission_context() returns jsonb
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
  where provision_private.seet_mission_person(u.id) and (coalesce(u.raw_app_meta_data->>'portal_qa','false')<>'true'
   or exists(select 1 from auth.users actor where actor.id=auth.uid() and actor.raw_app_meta_data->>'portal_qa'='true'))
 )x) else '[]'::jsonb end);
end $$;
-- Surface the work needing a decision directly on each mission in the inbox.
do $$ declare original text; patched text; begin
 original=pg_get_functiondef('public.seet_mission_board(text,text,integer)'::regprocedure);
 patched=replace(original,'select page.*,provision_private.seet_mission_departments_json(page.id) as departments,',
  'select page.*,
   (select count(*) from public.seet_mission_joins where mission_id=page.id and status=''pending'' and (reviewer or user_id=auth.uid())) as pending_joins,
   (select count(*) from public.seet_mission_assignments where mission_id=page.id and status=''unable_pending'' and (reviewer or user_id=auth.uid())) as unable_pending,
   provision_private.seet_mission_departments_json(page.id) as departments,');
 if patched=original then raise exception 'mission_board_contract_changed'; end if;
 execute patched;
end $$;
notify pgrst,'reload schema';
commit;
