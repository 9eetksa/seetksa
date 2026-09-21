begin;
-- Private projection exposes only authored directory fields and never Auth secrets
create function provision_private.account_directory_rows(p_user uuid default null)
returns setof jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(row) from (
  select u.id,coalesce(l.original_email,u.email) as email,
   case when l.state='deleted' then coalesce(p.phone,'') else u.phone end as phone,
   coalesce(l.original_role,u.raw_app_meta_data->>'role') as role,
   coalesce(p.display_name,u.raw_user_meta_data->>'display_name','') as display_name,
   u.raw_app_meta_data->>'job_title' as job_title,coalesce(u.raw_app_meta_data->'permissions','[]') as permissions,
   u.raw_app_meta_data->>'must_change_password'='true' as must_change_password,
   u.created_at,u.last_sign_in_at,i.id as invitation_id,i.email_status,i.whatsapp_status,i.expires_at,
   case when l.state='deleted' or u.deleted_at is not null then 'deleted'
    when l.state='suspended' then 'suspended'
    when l.state='temporary' and l.suspended_until>now() then 'temporary'
    when u.banned_until>now() then 'suspended' else 'active' end as access_status,
   case when l.state='temporary' and l.suspended_until>now() then l.suspended_until end as suspended_until,
   case when provision_private.is_owner() then l.reason end as suspension_reason,
   l.state='deleted' and u.deleted_at is null as identity_cleanup_pending
  from auth.users u left join public.account_profiles p on p.user_id=u.id
   left join public.account_invitations i on i.user_id=u.id
   left join provision_private.account_lifecycle l on l.user_id=u.id
  where (provision_private.is_owner() or (coalesce(l.original_role,u.raw_app_meta_data->>'role') is distinct from 'super_admin' and l.state is distinct from 'deleted' and u.deleted_at is null))

   and (p_user is null or u.id=p_user)
) row;
$$;
revoke all on function provision_private.account_directory_rows(uuid) from public,anon,authenticated;

create function public.platform_account_directory(p_search text default '',p_role text default 'all',p_status text default 'all',p_login text default 'all',p_sort text default 'newest',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not provision_private.allowed('users.read') then raise exception 'forbidden' using errcode='42501'; end if;
 if p_role not in ('all','client','employee','admin','super_admin','unset') or p_status not in ('all','active','temporary','suspended','deleted')
  or p_login not in ('all','signed_in','never','pending') or p_sort not in ('newest','oldest','name','last_login')
  or p_page is null or p_page<0 or p_page>100000 then raise exception 'invalid_filters' using errcode='22023'; end if;
 with base as materialized (select value as u from provision_private.account_directory_rows() value),
 filtered as materialized (select u from base where
  (p_role='all' or coalesce(u->>'role','unset')=p_role)
  and (p_status='all' or u->>'access_status'=p_status)
  and (p_login='all' or (p_login='signed_in' and u->>'last_sign_in_at' is not null)
   or (p_login='never' and u->>'last_sign_in_at' is null) or (p_login='pending' and u->>'must_change_password'='true'))
  and (position(lower(left(trim(coalesce(p_search,'')),100)) in lower(concat_ws(' ',u->>'display_name',u->>'email',u->>'phone',u->>'job_title')))>0)),
 ordered as (select u from filtered order by
  case when p_sort='name' then u->>'display_name' end asc,
  case when p_sort='oldest' then u->>'created_at' end asc,
  case when p_sort='last_login' then u->>'last_sign_in_at' end desc nulls last,
  u->>'created_at' desc,u->>'id' limit 20 offset p_page*20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(u) from ordered),'[]'),
  'total',(select count(*) from filtered),'page_size',20,
  'counts',(select jsonb_build_object('all',count(*),'active',count(*) filter(where u->>'access_status'='active'),
   'temporary',count(*) filter(where u->>'access_status'='temporary'),'suspended',count(*) filter(where u->>'access_status'='suspended'),
   'deleted',count(*) filter(where u->>'access_status'='deleted')) from base)) into result;
 return result;
end $$;
revoke all on function public.platform_account_directory(text,text,text,text,text,integer) from public,anon;
grant execute on function public.platform_account_directory(text,text,text,text,text,integer) to authenticated;

create function public.platform_account_brief(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account jsonb; result jsonb;
begin
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 select value into account from provision_private.account_directory_rows(p_user) value;
 if account is null then raise exception 'account_not_found'; end if;
 with related as materialized (
  select r.id,r.number,r.title,r.status,r.created_at,r.updated_at from public.work_requests r
  where r.client_id=p_user or r.coordinator_id=p_user or exists(select 1 from public.work_parts p where p.request_id=r.id and (p.assignee_id=p_user or p.forwarded_to=p_user))
 ), activity as (
  select e.id::text as id,e.kind,e.created_at,r.title as subject,e.note from public.work_events e
  join public.work_requests r on r.id=e.request_id where e.actor=p_user
  union all
  select 'audit-'||a.id::text,a.action,a.created_at,null,a.details->>'reason' from provision_private.audit a
  where a.actor=p_user or a.effective_user=p_user
 )
 select jsonb_build_object('account',account,
  'contact_name',(select contact_name from public.account_profiles where user_id=p_user),
  'departments',coalesce((select jsonb_agg(jsonb_build_object('name',s.name,'role',m.member_role) order by s.name)
   from public.work_memberships m join public.work_services s on s.id=m.service_id where m.user_id=p_user),'[]'),
  'coordinator',coalesce((select coordinator from public.work_staff where user_id=p_user),false),
  'stats',jsonb_build_object('requests',(select count(*) from related),'completed',(select count(*) from related where status='completed'),
   'tasks',(select count(*) from public.work_parts where assignee_id=p_user),
   'deliveries',(select count(*) from public.work_deliveries where uploaded_by=p_user),
   'files',(select count(*) from public.work_attachments where uploaded_by=p_user),
   'events',(select count(*) from public.work_events where actor=p_user)),
  'requests',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from related order by updated_at desc,id limit 10) r),'[]'),
  'activity',coalesce((select jsonb_agg(to_jsonb(a)) from (select * from activity order by created_at desc,id limit 20) a),'[]')) into result;
 return result;
end $$;
revoke all on function public.platform_account_brief(uuid) from public,anon;
grant execute on function public.platform_account_brief(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
