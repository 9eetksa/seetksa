begin;
alter table provision_private.audit drop constraint audit_actor_fkey, drop constraint audit_effective_user_fkey;
alter table provision_private.audit alter column actor drop not null, alter column effective_user drop not null;
alter table provision_private.audit add constraint audit_actor_fkey foreign key(actor) references auth.users(id) on delete set null;
alter table provision_private.audit add constraint audit_effective_user_fkey foreign key(effective_user) references auth.users(id) on delete set null;
alter table provision_private.audit add column actor_email text, add column effective_email text;
update provision_private.audit a set actor_email=u.email from auth.users u where u.id=a.actor;
update provision_private.audit a set effective_email=u.email from auth.users u where u.id=a.effective_user;
create function provision_private.audit_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select email into new.actor_email from auth.users where id=new.actor;
 select email into new.effective_email from auth.users where id=new.effective_user;
 return new;
end; $$;
revoke all on function provision_private.audit_identity() from public,anon,authenticated;
create trigger audit_identity before insert on provision_private.audit for each row execute function provision_private.audit_identity();
alter table provision_private.impersonation drop constraint impersonation_actor_fkey, drop constraint impersonation_target_fkey;
alter table provision_private.impersonation add constraint impersonation_actor_fkey foreign key(actor) references auth.users(id) on delete cascade;
alter table provision_private.impersonation add constraint impersonation_target_fkey foreign key(target) references auth.users(id) on delete cascade;
alter table public.account_profiles drop constraint account_profiles_updated_by_fkey;
alter table public.account_profiles add constraint account_profiles_updated_by_fkey foreign key(updated_by) references auth.users(id) on delete set null;
create or replace function public.platform_audit(p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not provision_private.is_owner() then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into result from (select id,action,details,created_at,actor_email as actor,effective_email as effective_user from provision_private.audit order by id desc limit 50 offset greatest(p_page,0)*50) a;
 return result;
end; $$;
create or replace function provision_private.effective_user(p_session uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
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
commit;
