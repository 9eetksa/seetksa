begin;

-- Delegated credentials remain on the server. Their session identifier refers
-- to our audited binding, never to a fabricated Supabase Auth session.
create or replace function provision_private.session_active(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_session is not null and (
  exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now()))
  or exists(
   select 1 from provision_private.account_impersonation d
   join auth.users actor on actor.id=d.actor
   join auth.users target on target.id=d.target
   join auth.sessions s on s.id=d.actor_session and s.user_id=d.actor
   where d.id=p_session and d.target_session=d.id and d.target=p_user
    and d.ended_at is null and d.expires_at>now() and d.token_cipher is not null
    and (s.not_after is null or s.not_after>now())
    and actor.raw_app_meta_data->>'role'='super_admin'
    and coalesce(actor.raw_app_meta_data->>'must_change_password','false')<>'true'
    and target.raw_app_meta_data->>'role' in ('employee','admin')
    and coalesce(target.raw_app_meta_data->>'must_change_password','false')<>'true'
    and target.raw_app_meta_data=d.target_metadata
    and provision_private.account_available(d.actor) and provision_private.account_available(d.target)
  )
 );
$$;

create or replace function public.platform_impersonation_open(p_actor uuid,p_actor_session uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_user auth.users; opened provision_private.account_impersonation; phone_only boolean;
begin
 if not provision_private.impersonation_actor_ready(p_actor,p_actor_session) or p_actor=p_target then
  raise exception 'forbidden' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,71844));
 select * into target_user from auth.users where id=p_target;
 if target_user.raw_app_meta_data->>'role'='client' then raise exception 'staff_only' using errcode='42501'; end if;
 if target_user.id is null or not provision_private.account_available(p_target)
  or coalesce(target_user.raw_app_meta_data->>'role','') not in ('employee','admin') then
  raise exception 'invalid_target' using errcode='42501';
 end if;
 if coalesce(target_user.raw_app_meta_data->>'must_change_password','false')='true' then
  raise exception 'target_onboarding' using errcode='42501';
 end if;
 phone_only=coalesce(target_user.email,'')='' or coalesce(target_user.raw_app_meta_data->>'phone_only','false')='true';
 if (phone_only and (coalesce(target_user.phone,'')='' or target_user.phone_confirmed_at is null))
  or (not phone_only and target_user.email_confirmed_at is null) then
  raise exception 'invalid_target' using errcode='42501';
 end if;
 if (select count(*) from provision_private.account_impersonation where actor=p_actor and created_at>now()-interval '5 minutes')>=20 then
  raise exception 'rate_limit' using errcode='54000';
 end if;
 update provision_private.account_impersonation set ended_at=now(),token_cipher=null
 where actor=p_actor and actor_session=p_actor_session and ended_at is null;
 insert into provision_private.account_impersonation(actor,actor_session,target,target_metadata)
 values(p_actor,p_actor_session,p_target,target_user.raw_app_meta_data) returning * into opened;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(p_actor,p_target,'impersonation_start',jsonb_build_object('session',opened.id,'expires_at',opened.expires_at));
 return jsonb_build_object('id',opened.id,'expires_at',opened.expires_at,'target',p_target,'email',target_user.email,
  'credential_method',case when phone_only then 'delegated_jwt' else 'magiclink' end,
  'user',jsonb_build_object('id',target_user.id,'email',target_user.email,'phone',target_user.phone,
   'app_metadata',target_user.raw_app_meta_data,'user_metadata',target_user.raw_user_meta_data,'is_anonymous',false));
end $$;

create or replace function public.platform_impersonation_seal(p_id uuid,p_actor uuid,p_actor_session uuid,p_target_session uuid,p_cipher text)
returns void language plpgsql security definer set search_path='' as $$
declare current_session provision_private.account_impersonation;
begin
 if not provision_private.impersonation_actor_ready(p_actor,p_actor_session) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into current_session from provision_private.account_impersonation where id=p_id and actor=p_actor and actor_session=p_actor_session for update;
 if current_session.id is null or current_session.ended_at is not null or current_session.expires_at<=now()
  or current_session.target_session is not null or not provision_private.account_available(current_session.target)
  or p_target_session is null
  or (p_target_session<>p_id and not provision_private.session_active(current_session.target,p_target_session))
  or p_cipher is null or length(p_cipher) not between 40 and 15999
  or not exists(select 1 from auth.users u where u.id=current_session.target and u.raw_app_meta_data=current_session.target_metadata
   and u.raw_app_meta_data->>'role' in ('employee','admin')
   and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true') then
  raise exception 'session_expired' using errcode='42501';
 end if;
 update provision_private.account_impersonation set target_session=p_target_session,token_cipher=p_cipher where id=p_id;
end $$;

revoke all on function provision_private.session_active(uuid,uuid) from public,anon,authenticated;
revoke all on function public.platform_impersonation_open(uuid,uuid,uuid),public.platform_impersonation_seal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.platform_impersonation_open(uuid,uuid,uuid),public.platform_impersonation_seal(uuid,uuid,uuid,uuid,text) to service_role;
commit;
