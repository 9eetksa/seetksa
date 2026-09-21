-- Department output requests go to its current eligible lead
-- Keep authorization version checks receipts notifications and assignment history intact
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_output_action(text,jsonb)'::regprocedure);
 needle=$old$   -- Serialize with staff and membership edits before trusting recipient identity
   perform 1 from public.work_staff staff where staff.user_id in(select (value->>'assignee_id')::uuid from jsonb_array_elements(outputs)) order by staff.user_id for share;
   perform 1 from public.work_memberships membership where membership.user_id in(select (value->>'assignee_id')::uuid from jsonb_array_elements(outputs)) order by membership.user_id,membership.service_id for share;
   perform 1 from auth.users account where account.id in(select (value->>'assignee_id')::uuid from jsonb_array_elements(outputs)) order by account.id for share;$old$;
 if strpos(body,needle)=0 then raise exception 'output_lead_lock_shape'; end if;
 body=replace(body,needle,$new$   -- Lock selected departments and their current lead identities in stable order
   perform 1 from public.work_services service where service.id in(select (value->>'service_id')::uuid from jsonb_array_elements(outputs)) order by service.id for share;
   perform 1 from public.work_staff staff where staff.user_id in(select m.user_id from public.work_memberships m where m.member_role='lead' and m.service_id in(select (value->>'service_id')::uuid from jsonb_array_elements(outputs))) order by staff.user_id for share;
   perform 1 from public.work_memberships m where m.member_role='lead' and m.service_id in(select (value->>'service_id')::uuid from jsonb_array_elements(outputs)) order by m.user_id,m.service_id for share;
   perform 1 from auth.users account where account.id in(select m.user_id from public.work_memberships m where m.member_role='lead' and m.service_id in(select (value->>'service_id')::uuid from jsonb_array_elements(outputs))) order by account.id for share;$new$);
 needle=$old$sid=(item->>'service_id')::uuid; employee=(item->>'assignee_id')::uuid; why=trim(coalesce(item->>'reason',''));$old$;
 if strpos(body,needle)=0 then raise exception 'output_lead_identity_shape'; end if;
 body=replace(body,needle,$new$sid=(item->>'service_id')::uuid; employee=null; why=trim(coalesce(item->>'reason',''));$new$);
 needle=$old$    if not exists(select 1 from public.work_memberships m join public.work_services s on s.id=m.service_id and s.active
     join public.work_staff staff on staff.user_id=m.user_id join auth.users u on u.id=m.user_id
     where m.service_id=sid and m.user_id=employee and u.raw_app_meta_data->>'role'='employee' and provision_private.account_available(u.id)
      and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true') then raise exception 'invalid_employee'; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'output_lead_recipient_shape'; end if;
 body=replace(body,needle,$new$    -- Never trust an employee ID from an older form or a modified client
    select u.id into employee from public.work_memberships m join public.work_services s on s.id=m.service_id and s.active
     join public.work_staff staff on staff.user_id=m.user_id join auth.users u on u.id=m.user_id
     where m.service_id=sid and m.member_role='lead' and u.raw_app_meta_data->>'role'='employee' and provision_private.account_available(u.id)
      and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true'
     order by u.id limit 1 for share of m,s,staff,u;
    if employee is null then raise exception 'output_department_lead_unavailable'; end if;$new$);
 execute body;
end
$migration$;
