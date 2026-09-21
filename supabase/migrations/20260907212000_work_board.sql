begin;
create function public.work_board(p_view text default 'mine',p_search text default '',p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; requests jsonb; parts jsonb; alerts jsonb; counts jsonb;
begin
 if not provision_private.account_ready() or provision_private.work_role() not in ('employee','admin','super_admin') then raise exception 'forbidden'; end if;
 select array_agg(x.id),coalesce(jsonb_agg(to_jsonb(x)),'[]') into ids,requests from (
 select r.id,r.number,r.title,r.client_id,r.service_id,r.status,r.coordinator_id,r.version,r.created_at from public.work_requests r
 where provision_private.work_read(r.id) and (r.title ilike '%'||left(p_search,100)||'%' or r.number::text=trim(p_search)) and (
 (p_view='all' and (provision_private.work_manager() or provision_private.work_coordinator())) or
 (p_view='intake' and (provision_private.work_manager() or provision_private.work_coordinator()) and (r.status in ('new','needs_info') or exists(select 1 from public.work_parts p where p.request_id=r.id and p.status='needs_info'))) or
 (p_view='mine' and exists(select 1 from public.work_parts p where p.request_id=r.id and p.assignee_id=auth.uid())) or
 (p_view='deliveries' and exists(select 1 from public.work_parts p where p.request_id=r.id and p.status in ('review','revision','approved') and (p.assignee_id=auth.uid() or provision_private.work_manager()))) or
 (p_view='alerts' and provision_private.work_manager() and exists(select 1 from public.work_escalations e where e.request_id=r.id and e.status='open')))
 order by r.created_at desc limit 40 offset least(greatest(p_page,0),100000)*40)x;
 select coalesce(jsonb_agg(to_jsonb(p)),'[]') into parts from public.work_parts p where request_id=any(ids) and provision_private.work_part_read(p.id);
 select coalesce(jsonb_agg(to_jsonb(e)),'[]') into alerts from public.work_escalations e where request_id=any(ids) and status='open' and (provision_private.work_manager() or opened_by=auth.uid());
 select jsonb_build_object('open',count(*) filter(where status<>'approved'),'offered',count(*) filter(where status='offered'),'overdue',count(*) filter(where status<>'approved' and due_at<now()),'approved',count(*) filter(where status='approved')) into counts from public.work_parts where assignee_id=auth.uid();
 return jsonb_build_object('requests',requests,'parts',parts,'escalations',alerts,'counts',counts);
end; $$;
revoke all on function public.work_board(text,text,integer) from public,anon;
grant execute on function public.work_board(text,text,integer) to authenticated;

-- Display the currently enabled upload limit honestly until billing allows larger files
create function public.work_upload_limit() returns bigint language sql stable security definer set search_path='' as $$ select least(file_size_limit,52428800::bigint) from storage.buckets where id='work-files' and provision_private.account_ready() $$;
revoke all on function public.work_upload_limit() from public,anon;
grant execute on function public.work_upload_limit() to authenticated;

insert into public.work_staff(user_id,capacity,coordinator) select id,5,false from auth.users where raw_app_meta_data->>'role'='super_admin' and coalesce(raw_app_meta_data->>'portal_qa','false')<>'true' on conflict do nothing;
insert into public.work_memberships(user_id,service_id) select w.user_id,s.id from public.work_staff w join auth.users u on u.id=w.user_id cross join public.work_services s where u.raw_app_meta_data->>'role'='super_admin' and s.name='التطوير التقني' on conflict do nothing;
commit;
