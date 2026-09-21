begin;

-- Filter before pagination and search results reach non-owner administrators
create or replace function public.platform_users(p_search text default '',p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not provision_private.allowed('users.read') then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(u)),'[]') into result from (
 select u.id,u.email,u.phone,u.raw_app_meta_data->>'role' as role,coalesce(p.display_name,u.raw_user_meta_data->>'display_name','') as display_name,u.raw_app_meta_data->>'job_title' as job_title,coalesce(u.raw_app_meta_data->'permissions','[]') as permissions,u.raw_app_meta_data->>'must_change_password'='true' as must_change_password,u.created_at,u.last_sign_in_at,i.id as invitation_id,i.email_status,i.whatsapp_status,i.expires_at
 from auth.users u left join public.account_profiles p on p.user_id=u.id left join public.account_invitations i on i.user_id=u.id
 where (provision_private.is_owner() or u.raw_app_meta_data->>'role' is distinct from 'super_admin')
 and (u.email ilike '%'||left(p_search,100)||'%' or p.display_name ilike '%'||left(p_search,100)||'%' or u.phone like '%'||left(p_search,30)||'%')
 order by u.created_at desc limit 50 offset greatest(p_page,0)*50) u;
 return result;
end; $$;

-- Apply the same boundary to direct profile reads through the Data API
create function provision_private.directory_account_visible(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.is_owner() or exists (
  select 1 from auth.users u
  where u.id=p_user and u.raw_app_meta_data->>'role' is distinct from 'super_admin'
 );
$$;
revoke all on function provision_private.directory_account_visible(uuid) from public,anon;
grant execute on function provision_private.directory_account_visible(uuid) to authenticated;

drop policy profile_read on public.account_profiles;
create policy profile_read on public.account_profiles for select to authenticated
using (
 provision_private.account_ready() and (
  user_id=auth.uid() or (
   provision_private.allowed('users.read') and
   provision_private.directory_account_visible(user_id)
  )
 )
);

commit;
