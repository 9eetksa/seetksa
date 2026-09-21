begin;

-- Identity changes must not require an already staffed department or rewrite its team.
create function public.work_department_identity(p_action text,p_id uuid,p_version integer,p_name text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.work_services; saved public.work_services;
begin
 if not provision_private.account_ready()
  or not coalesce(provision_private.allowed('departments.manage'),false)
 then raise exception 'forbidden' using errcode='42501'; end if;
 if p_action is null or p_action not in ('rename','delete') or p_id is null
  or p_version is null or p_version<1 then raise exception 'invalid_department'; end if;
 if p_action='rename' and (p_name is null or char_length(btrim(p_name)) not between 2 and 100)
 then raise exception 'invalid_department_name'; end if;
 select * into existing from public.work_services where id=p_id for update;
 if not found then
  if p_action='delete' then return jsonb_build_object('id',p_id,'deleted',true); end if;
  raise exception 'invalid_department';
 end if;
 if existing.version<>p_version then raise exception 'department_version_conflict'; end if;
 if p_action='rename' then
  update public.work_services set name=btrim(p_name) where id=p_id returning * into saved;
 else
  -- requested_service_id uses ON DELETE SET NULL; preserve that historical association too.
  -- The parent row lock serializes deletion against new foreign-key references.
  if exists(select 1 from public.work_requests where service_id=p_id or requested_service_id=p_id)
  then raise exception 'department_in_use'; end if;
  delete from public.work_services where id=p_id;
 end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),'work_department_'||p_action,
  jsonb_build_object('id',p_id,'previous_name',existing.name,'name',case when p_action='rename' then saved.name else existing.name end,'version',existing.version));
 return case when p_action='rename' then jsonb_build_object('id',saved.id,'name',saved.name,'version',saved.version)
  else jsonb_build_object('id',p_id,'deleted',true) end;
exception
 when unique_violation then raise exception 'department_conflict' using errcode='23505';
 when foreign_key_violation then raise exception 'department_in_use' using errcode='23503';
end;
$$;
revoke all on function public.work_department_identity(text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.work_department_identity(text,uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
