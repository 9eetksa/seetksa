begin;
-- Hide internal Auth routing identifiers from account contact/edit projections.
do $$
declare body text;
begin
 body=pg_get_functiondef('provision_private.account_directory_rows(uuid)'::regprocedure);
 if position('coalesce(l.original_email, u.email) AS email' in body)=0
  and position('coalesce(l.original_email,u.email) as email' in body)=0 then raise exception 'directory_email_projection_changed'; end if;
 body=replace(body,'coalesce(l.original_email,u.email) as email','case when u.raw_app_meta_data->>''phone_only''=''true'' then '''' else coalesce(l.original_email,u.email) end as email');
 body=replace(body,'coalesce(l.original_email, u.email) AS email','case when u.raw_app_meta_data->>''phone_only''=''true'' then '''' else coalesce(l.original_email,u.email) end as email');
 execute body;
 body=pg_get_functiondef('public.work_employee_profile(uuid)'::regprocedure);
 if position('''email'',coalesce(u.email,'''')' in body)=0 then raise exception 'employee_email_projection_changed'; end if;
 body=replace(body,'''email'',coalesce(u.email,'''')','''email'',case when u.raw_app_meta_data->>''phone_only''=''true'' then '''' else coalesce(u.email,'''') end');
 execute body;
end $$;
notify pgrst,'reload schema';
commit;
