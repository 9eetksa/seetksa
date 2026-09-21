begin;
create table public.account_invitations (
 id uuid primary key,
 actor uuid references auth.users(id) on delete set null,
 user_id uuid unique references auth.users(id) on delete cascade,
 fingerprint text not null,
 email text not null,
 phone text not null,
 password_cipher text,
 expires_at timestamptz not null default now()+interval '24 hours',
 email_status text not null default 'pending' check(email_status in ('pending','sent','failed','unknown')),
 whatsapp_status text not null default 'pending' check(whatsapp_status in ('pending','sent','failed','unknown')),
 email_id text,
 whatsapp_id text,
 generation integer not null default 1,
 locked_until timestamptz,
 completed_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.account_invitations enable row level security;
revoke all on public.account_invitations from public,anon,authenticated;
grant select,insert,update,delete on public.account_invitations to service_role;
create index account_invitation_created on public.account_invitations(created_at);

create function provision_private.account_ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and coalesce(raw_app_meta_data->>'must_change_password','false')<>'true' and (banned_until is null or banned_until<now()));
$$;
revoke all on function provision_private.account_ready() from public,anon;
grant execute on function provision_private.account_ready() to authenticated;
create or replace function provision_private.is_owner() returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='super_admin');
$$;
create function provision_private.allowed(p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.is_owner() or (provision_private.account_ready() and exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='admin' and raw_app_meta_data->'permissions' ? p_permission));
$$;
revoke all on function provision_private.allowed(text) from public,anon;
grant execute on function provision_private.allowed(text) to authenticated;

create or replace function public.platform_save(p_config jsonb,p_version integer) returns integer language plpgsql security definer set search_path='' as $$
declare v integer; old_config jsonb;
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>240000 then raise exception 'invalid_config'; end if;
 select config into old_config from public.platform_settings where id for update;
 if not provision_private.is_owner() then
  if not (provision_private.allowed('content.edit') or provision_private.allowed('appearance.edit') or provision_private.allowed('maintenance.manage')) then raise exception 'forbidden' using errcode='42501'; end if;
  if (p_config->'elements') is distinct from (old_config->'elements') and not provision_private.allowed('content.edit') then raise exception 'forbidden' using errcode='42501'; end if;
  if (p_config->'theme') is distinct from (old_config->'theme') and not provision_private.allowed('appearance.edit') then raise exception 'forbidden' using errcode='42501'; end if;
  if (p_config - 'elements' - 'theme') is distinct from (old_config - 'elements' - 'theme') and not provision_private.allowed('maintenance.manage') then raise exception 'forbidden' using errcode='42501'; end if;
 end if;
 update public.platform_settings set config=p_config,version=version+1,updated_at=now() where id and version=p_version returning version into v;
 if v is null then raise exception 'version_conflict'; end if;
 insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'platform_save',jsonb_build_object('version',v));
 return v;
end; $$;

create or replace function public.platform_users(p_search text default '',p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not provision_private.allowed('users.read') then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(u)),'[]') into result from (
 select u.id,u.email,u.phone,u.raw_app_meta_data->>'role' as role,coalesce(p.display_name,u.raw_user_meta_data->>'display_name','') as display_name,u.raw_app_meta_data->>'job_title' as job_title,coalesce(u.raw_app_meta_data->'permissions','[]') as permissions,u.raw_app_meta_data->>'must_change_password'='true' as must_change_password,u.created_at,u.last_sign_in_at,i.id as invitation_id,i.email_status,i.whatsapp_status,i.expires_at
 from auth.users u left join public.account_profiles p on p.user_id=u.id left join public.account_invitations i on i.user_id=u.id
 where u.email ilike '%'||left(p_search,100)||'%' or p.display_name ilike '%'||left(p_search,100)||'%' or u.phone like '%'||left(p_search,30)||'%'
 order by u.created_at desc limit 50 offset greatest(p_page,0)*50) u;
 return result;
end; $$;

create or replace function public.platform_audit(p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not provision_private.allowed('audit.read') then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into result from (select id,action,details,created_at,actor_email as actor,effective_email as effective_user from provision_private.audit order by id desc limit 50 offset greatest(p_page,0)*50) a;
 return result;
end; $$;

create function public.platform_permissions(p_user uuid,p_permissions jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.is_owner() or p_user=auth.uid() then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_permissions)<>'array' or exists(select 1 from jsonb_array_elements_text(p_permissions) p where p not in ('users.read','content.edit','appearance.edit','maintenance.manage','audit.read')) then raise exception 'invalid_permissions'; end if;
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('permissions',p_permissions) where id=p_user and raw_app_meta_data->>'role'='admin';
 if not found then raise exception 'invalid_admin'; end if;
 insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'permissions_change',jsonb_build_object('user',p_user,'permissions',p_permissions));
end; $$;
revoke all on function public.platform_permissions(uuid,jsonb) from public,anon;
grant execute on function public.platform_permissions(uuid,jsonb) to authenticated;

create or replace function public.platform_profile(p_session uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_id uuid; result jsonb;
begin
 if not provision_private.account_ready() then raise exception 'password_change_required' using errcode='42501'; end if;
 target_id=provision_private.effective_user(p_session);
 select jsonb_build_object('user_id',u.id,'email',u.email,'role',u.raw_app_meta_data->>'role','display_name',coalesce(p.display_name,''),'phone',coalesce(p.phone,u.phone,''),'job_title',u.raw_app_meta_data->>'job_title','updated_by',p.updated_by) into result from auth.users u left join public.account_profiles p on p.user_id=u.id where u.id=target_id;
 return result;
end; $$;
create or replace function provision_private.effective_user(p_session uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not provision_private.account_ready() then raise exception 'password_change_required' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role' in ('client','employee','admin','super_admin') and (banned_until is null or banned_until<now())) then raise exception 'unauthorized' using errcode='42501'; end if;
 if p_session is null then
  if not provision_private.is_owner() and exists(select 1 from public.platform_settings where config->>'maintenance'='true') then raise exception 'maintenance' using errcode='42501'; end if;
  return auth.uid();
 end if;
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 select s.target into result from provision_private.impersonation s join auth.users u on u.id=s.target where s.id=p_session and s.actor=auth.uid() and s.ended_at is null and s.expires_at>now() and u.raw_app_meta_data->>'role' in ('client','employee','admin') and (u.banned_until is null or u.banned_until<now());
 if result is null then raise exception 'session_expired' using errcode='42501'; end if;
 return result;
end; $$;
drop policy profile_read on public.account_profiles;
create policy profile_read on public.account_profiles for select to authenticated using(provision_private.account_ready() and (user_id=auth.uid() or provision_private.allowed('users.read')));

drop policy designs_owner_insert on storage.objects;
drop policy designs_owner_select on storage.objects;
drop policy designs_owner_update on storage.objects;
drop policy designs_owner_delete on storage.objects;
create policy designs_editor_insert on storage.objects for insert to authenticated with check(bucket_id='platform-designs' and provision_private.allowed('content.edit') and (storage.foldername(name))[1]=auth.uid()::text);
create policy designs_editor_select on storage.objects for select to authenticated using(bucket_id='platform-designs' and provision_private.allowed('content.edit'));
create policy designs_editor_update on storage.objects for update to authenticated using(bucket_id='platform-designs' and provision_private.allowed('content.edit')) with check(bucket_id='platform-designs' and provision_private.allowed('content.edit'));
create policy designs_editor_delete on storage.objects for delete to authenticated using(bucket_id='platform-designs' and provision_private.allowed('content.edit'));

-- Service-only functions are called after verifying the request bearer identity
create function public.platform_invite_lock(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.account_invitations;
begin
 update public.account_invitations set locked_until=now()+interval '90 seconds' where id=p_id and (locked_until is null or locked_until<now()) returning * into r;
 if r.id is null then raise exception 'invitation_busy'; end if;
 return to_jsonb(r);
end; $$;
create function public.platform_server_audit(p_actor uuid,p_target uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_action not in ('account_created','invitation_resent','first_password_changed') then raise exception 'invalid_action'; end if;
 insert into provision_private.audit(actor,effective_user,action) values(p_actor,p_target,p_action);
end; $$;
revoke all on function public.platform_invite_lock(uuid),public.platform_server_audit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.platform_invite_lock(uuid),public.platform_server_audit(uuid,uuid,text) to service_role;
create function public.platform_find_invite_user(p_id uuid) returns uuid language sql stable security definer set search_path='' as $$
 select id from auth.users where raw_app_meta_data->>'onboarding_request'=p_id::text limit 1;
$$;
revoke all on function public.platform_find_invite_user(uuid) from public,anon,authenticated;
grant execute on function public.platform_find_invite_user(uuid) to service_role;
create table public.platform_auth_limits(key text primary key, attempts integer not null, expires_at timestamptz not null);
alter table public.platform_auth_limits enable row level security;
revoke all on public.platform_auth_limits from public,anon,authenticated;
grant all on public.platform_auth_limits to service_role;
create function public.platform_login_limit(p_key text,p_max integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 delete from public.platform_auth_limits where expires_at<now()-interval '1 hour';
 insert into public.platform_auth_limits(key,attempts,expires_at) values(p_key,1,now()+interval '5 minutes') on conflict(key) do update set attempts=case when public.platform_auth_limits.expires_at<now() then 1 else public.platform_auth_limits.attempts+1 end,expires_at=case when public.platform_auth_limits.expires_at<now() then now()+interval '5 minutes' else public.platform_auth_limits.expires_at end returning attempts into n;
 return n<=p_max;
end; $$;
create function public.platform_phone_email(p_phone text) returns text language sql stable security definer set search_path='' as $$
 select email from auth.users where phone=ltrim(p_phone,'+') limit 1;
$$;
revoke all on function public.platform_login_limit(text,integer),public.platform_phone_email(text) from public,anon,authenticated;
grant execute on function public.platform_login_limit(text,integer),public.platform_phone_email(text) to service_role;
commit;
