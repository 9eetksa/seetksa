begin;
-- Account types keep the existing authorization roles; assignment rights stay in work_staff.
create function provision_private.seet_initialize_account_type() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.raw_app_meta_data->>'role'='employee'
  and new.raw_app_meta_data->>'account_type' in ('employee','collaborator','supervisor') then
  insert into public.work_staff(user_id,employment_type,operations_manager)
  values(new.id,case when new.raw_app_meta_data->>'account_type'='collaborator' then 'freelancer' else 'regular' end,
   new.raw_app_meta_data->>'account_type'='supervisor')
  on conflict(user_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function provision_private.seet_initialize_account_type() from public,anon,authenticated;
create trigger seet_initialize_account_type after insert on auth.users
for each row execute function provision_private.seet_initialize_account_type();

do $$
declare body text;
begin
 body=pg_get_functiondef('provision_private.account_directory_rows(uuid)'::regprocedure);
 if position('u.raw_app_meta_data->>''job_title'' as job_title' in body)=0 then raise exception 'directory_projection_changed'; end if;
 body=replace(body,'u.raw_app_meta_data->>''job_title'' as job_title',
  'case when coalesce(l.original_role,u.raw_app_meta_data->>''role'')=''employee'' then
    case when exists(select 1 from public.work_staff s where s.user_id=u.id and s.operations_manager) then ''supervisor''
     when exists(select 1 from public.work_staff s where s.user_id=u.id and s.employment_type=''freelancer'') then ''collaborator'' else ''employee'' end
   else coalesce(l.original_role,u.raw_app_meta_data->>''role'') end as account_type,
   coalesce((u.raw_app_meta_data->>''phone_only'')=''true'',false) as phone_only,
   u.raw_app_meta_data->>''job_title'' as job_title');
 execute body;
 body=pg_get_functiondef('public.platform_account_directory(text,text,text,text,text,integer)'::regprocedure);
 if position('coalesce(u->>''role'',''unset'')=p_role' in body)=0 then raise exception 'directory_filters_changed'; end if;
 body=replace(body,'''all'',''client'',''employee'',''admin'',''super_admin'',''unset''','''all'',''client'',''employee'',''admin'',''super_admin'',''unset'',''collaborator'',''supervisor''');
 body=replace(body,'coalesce(u->>''role'',''unset'')=p_role','coalesce(u->>''account_type'',u->>''role'',''unset'')=p_role');
 execute body;
end $$;
notify pgrst,'reload schema';
commit;
