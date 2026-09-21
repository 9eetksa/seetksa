begin;
create schema if not exists provision_private;
revoke all on schema provision_private from public, anon, authenticated;
create function provision_private.is_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='super_admin' and (banned_until is null or banned_until<now()));
$$;
grant usage on schema provision_private to authenticated;
grant execute on function provision_private.is_owner() to authenticated;
revoke all on function provision_private.is_owner() from public, anon;

create table public.platform_settings (
 id boolean primary key default true check(id),
 config jsonb not null default '{}' check(jsonb_typeof(config)='object' and octet_length(config::text)<250000),
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
insert into public.platform_settings(id) values(true);
alter table public.platform_settings enable row level security;
grant select on public.platform_settings to anon, authenticated;
revoke insert,update,delete on public.platform_settings from anon,authenticated;
create policy settings_read on public.platform_settings for select to anon,authenticated using(true);

create table provision_private.audit (
 id bigint generated always as identity primary key,
 actor uuid not null references auth.users(id),
 effective_user uuid not null references auth.users(id),
 action text not null,
 details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index audit_created_at on provision_private.audit(created_at desc);
create table provision_private.impersonation (
 id uuid primary key default gen_random_uuid(),
 actor uuid not null references auth.users(id),
 target uuid not null references auth.users(id),
 expires_at timestamptz not null default now()+interval '30 minutes',
 ended_at timestamptz,
 check(actor<>target)
);
alter table provision_private.audit enable row level security;
alter table provision_private.impersonation enable row level security;
create table public.account_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(length(display_name)<=120),
 phone text not null default '' check(length(phone)<=30),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.account_profiles enable row level security;
grant select on public.account_profiles to authenticated;
revoke insert,update,delete on public.account_profiles from anon,authenticated;
create policy profile_read on public.account_profiles for select to authenticated using(user_id=auth.uid() or provision_private.is_owner());

create function public.platform_save(p_config jsonb,p_version integer) returns integer language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>240000 then raise exception 'invalid_config'; end if;
 update public.platform_settings set config=p_config,version=version+1,updated_at=now() where id and version=p_version returning version into v;
 if v is null then raise exception 'version_conflict'; end if;
 insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'platform_save',jsonb_build_object('version',v));
 return v;
end; $$;

create function public.platform_users(p_search text default '',p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(u)),'[]') into result from (
 select id,email,phone,raw_app_meta_data->>'role' as role,created_at,last_sign_in_at from auth.users
 where email ilike '%'||left(p_search,100)||'%' order by created_at desc limit 50 offset greatest(p_page,0)*50) u;
 return result;
end; $$;

create function public.platform_role(p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.is_owner() or p_user=auth.uid() then raise exception 'forbidden' using errcode='42501'; end if;
 if p_role not in ('client','employee','admin','super_admin') then raise exception 'invalid_role'; end if;
 perform pg_advisory_xact_lock(728641);
 if exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'role'='super_admin') and p_role<>'super_admin' and (select count(*) from auth.users where raw_app_meta_data->>'role'='super_admin')<=1 then raise exception 'last_owner'; end if;
 update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('role',p_role) where id=p_user;
 if not found then raise exception 'missing_user'; end if;
 insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'role_change',jsonb_build_object('user',p_user,'role',p_role));
end; $$;

create function public.platform_impersonate(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s provision_private.impersonation; u auth.users;
begin
 if not provision_private.is_owner() or p_user=auth.uid() then raise exception 'forbidden' using errcode='42501'; end if;
 select * into u from auth.users where id=p_user and raw_app_meta_data->>'role' in ('client','employee','admin') and (banned_until is null or banned_until<now());
 if not found then raise exception 'invalid_target'; end if;
 insert into provision_private.impersonation(actor,target) values(auth.uid(),p_user) returning * into s;
 insert into provision_private.audit(actor,effective_user,action) values(auth.uid(),p_user,'impersonation_start');
 return jsonb_build_object('id',s.id,'expires_at',s.expires_at,'user',jsonb_build_object('id',u.id,'email',u.email,'phone',u.phone,'role',u.raw_app_meta_data->>'role'));
end; $$;

create function public.platform_end_impersonation(p_session uuid) returns void language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
 update provision_private.impersonation set ended_at=now() where id=p_session and actor=auth.uid() and ended_at is null returning target into target_id;
 if target_id is not null then insert into provision_private.audit(actor,effective_user,action) values(auth.uid(),target_id,'impersonation_end'); end if;
end; $$;

create function provision_private.effective_user(p_session uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
 if p_session is null then
  if not provision_private.is_owner() and exists(select 1 from public.platform_settings where config->>'maintenance'='true') then raise exception 'maintenance' using errcode='42501'; end if;
  return auth.uid();
 end if;
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 select target into result from provision_private.impersonation where id=p_session and actor=auth.uid() and ended_at is null and expires_at>now();
 if result is null then raise exception 'session_expired' using errcode='42501'; end if;
 return result;
end; $$;
revoke all on function provision_private.effective_user(uuid) from public,anon,authenticated;

create function public.platform_profile(p_session uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_id uuid; result jsonb;
begin
 target_id=provision_private.effective_user(p_session);
 select jsonb_build_object('user_id',u.id,'email',u.email,'role',u.raw_app_meta_data->>'role','display_name',coalesce(p.display_name,''),'phone',coalesce(p.phone,u.phone,''),'updated_by',p.updated_by) into result from auth.users u left join public.account_profiles p on p.user_id=u.id where u.id=target_id;
 return result;
end; $$;

create function public.platform_update_profile(p_name text,p_phone text,p_session uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
 target_id=provision_private.effective_user(p_session);
 if length(p_name)>120 or length(p_phone)>30 then raise exception 'invalid_profile'; end if;
 insert into public.account_profiles(user_id,display_name,phone,updated_by) values(target_id,p_name,p_phone,target_id)
 on conflict(user_id) do update set display_name=excluded.display_name,phone=excluded.phone,updated_by=target_id,updated_at=now();
 insert into provision_private.audit(actor,effective_user,action) values(auth.uid(),target_id,'profile_update');
end; $$;

create function public.platform_audit(p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into result from (select a.id,a.action,a.details,a.created_at,u.email as actor,t.email as effective_user from provision_private.audit a join auth.users u on u.id=a.actor join auth.users t on t.id=a.effective_user order by a.id desc limit 50 offset greatest(p_page,0)*50) a;
 return result;
end; $$;

revoke all on function public.platform_save(jsonb,integer),public.platform_users(text,integer),public.platform_role(uuid,text),public.platform_impersonate(uuid),public.platform_end_impersonation(uuid),public.platform_profile(uuid),public.platform_update_profile(text,text,uuid),public.platform_audit(integer) from public,anon;
grant execute on function public.platform_save(jsonb,integer),public.platform_users(text,integer),public.platform_role(uuid,text),public.platform_impersonate(uuid),public.platform_end_impersonation(uuid),public.platform_profile(uuid),public.platform_update_profile(text,text,uuid),public.platform_audit(integer) to authenticated;

create policy designs_owner_insert on storage.objects for insert to authenticated with check(bucket_id='platform-designs' and provision_private.is_owner() and (storage.foldername(name))[1]=auth.uid()::text);
create policy designs_owner_select on storage.objects for select to authenticated using(bucket_id='platform-designs' and provision_private.is_owner());
create policy designs_owner_update on storage.objects for update to authenticated using(bucket_id='platform-designs' and provision_private.is_owner()) with check(bucket_id='platform-designs' and provision_private.is_owner());
create policy designs_owner_delete on storage.objects for delete to authenticated using(bucket_id='platform-designs' and provision_private.is_owner());
commit;
