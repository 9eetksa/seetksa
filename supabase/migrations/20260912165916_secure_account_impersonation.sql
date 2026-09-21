begin;

-- Target Auth credentials never leave the server and cannot be read through PostgREST
create table provision_private.account_impersonation (
 id uuid primary key default gen_random_uuid(),
 actor uuid not null references auth.users(id),
 actor_session uuid not null,
 target uuid not null references auth.users(id),
 target_session uuid unique,
 target_metadata jsonb not null,
 token_cipher text check(length(token_cipher)<16000),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '15 minutes',
 ended_at timestamptz,
 check(actor<>target),
 check(expires_at<=created_at+interval '15 minutes')
);
create index account_impersonation_actor_live on provision_private.account_impersonation(actor,actor_session) where ended_at is null;
alter table provision_private.account_impersonation enable row level security;
revoke all on provision_private.account_impersonation from public,anon,authenticated;
grant all on provision_private.account_impersonation to service_role;

-- Retire the old profile-only mode instead of leaving a second entry point
update provision_private.impersonation set ended_at=now() where ended_at is null;
revoke all on function public.platform_impersonate(uuid) from public,anon,authenticated;

create function provision_private.impersonation_actor_ready(p_actor uuid,p_session uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_available(p_actor)
 and provision_private.session_active(p_actor,p_session)
 and exists(select 1 from auth.users u where u.id=p_actor and u.raw_app_meta_data->>'role'='super_admin'
  and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true')
$$;
revoke all on function provision_private.impersonation_actor_ready(uuid,uuid) from public,anon,authenticated;

create function public.platform_impersonation_open(p_actor uuid,p_actor_session uuid,p_target uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_user auth.users; opened provision_private.account_impersonation;
begin
 if not provision_private.impersonation_actor_ready(p_actor,p_actor_session) or p_actor=p_target then
  raise exception 'forbidden' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor::text,71844));
 select * into target_user from auth.users where id=p_target;
 if target_user.id is null or not provision_private.account_available(p_target)
  or target_user.raw_app_meta_data->>'role' not in('client','employee','admin')
  or coalesce(target_user.raw_app_meta_data->>'must_change_password','false')='true'
  or target_user.email_confirmed_at is null or coalesce(target_user.email,'')='' then
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
 return jsonb_build_object('id',opened.id,'expires_at',opened.expires_at,'target',p_target,'email',target_user.email);
end $$;

create function public.platform_impersonation_seal(p_id uuid,p_actor uuid,p_actor_session uuid,p_target_session uuid,p_cipher text)
returns void language plpgsql security definer set search_path='' as $$
declare current_session provision_private.account_impersonation;
begin
 if not provision_private.impersonation_actor_ready(p_actor,p_actor_session) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into current_session from provision_private.account_impersonation where id=p_id and actor=p_actor and actor_session=p_actor_session for update;
 if current_session.id is null or current_session.ended_at is not null or current_session.expires_at<=now()
  or current_session.target_session is not null or not provision_private.account_available(current_session.target)
  or not provision_private.session_active(current_session.target,p_target_session)
  or p_cipher is null or length(p_cipher) not between 40 and 15999
  or not exists(select 1 from auth.users u where u.id=current_session.target and u.raw_app_meta_data=current_session.target_metadata) then
  raise exception 'session_expired' using errcode='42501';
 end if;
 update provision_private.account_impersonation set target_session=p_target_session,token_cipher=p_cipher where id=p_id;
end $$;

create function public.platform_impersonation_access(p_id uuid,p_actor uuid,p_actor_session uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_session provision_private.account_impersonation; target_user auth.users;
begin
 if not provision_private.impersonation_actor_ready(p_actor,p_actor_session) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into current_session from provision_private.account_impersonation where id=p_id and actor=p_actor and actor_session=p_actor_session;
 if current_session.id is null or current_session.ended_at is not null or current_session.expires_at<=now()
  or current_session.token_cipher is null or not provision_private.account_available(current_session.target)
  or not provision_private.session_active(current_session.target,current_session.target_session) then
  raise exception 'session_expired' using errcode='42501';
 end if;
 select * into target_user from auth.users where id=current_session.target;
 if target_user.raw_app_meta_data is distinct from current_session.target_metadata
  or target_user.raw_app_meta_data->>'role' not in('client','employee','admin')
  or coalesce(target_user.raw_app_meta_data->>'must_change_password','false')='true' then
  raise exception 'session_expired' using errcode='42501';
 end if;
 return jsonb_build_object('id',current_session.id,'expires_at',current_session.expires_at,
  'target',current_session.target,'target_session',current_session.target_session,'token_cipher',current_session.token_cipher,
  'user',jsonb_build_object('id',target_user.id,'email',target_user.email,'phone',target_user.phone,
   'app_metadata',target_user.raw_app_meta_data,'user_metadata',target_user.raw_user_meta_data,'is_anonymous',false));
end $$;

create function public.platform_impersonation_close(p_id uuid,p_actor uuid,p_actor_session uuid)
returns text language plpgsql security definer set search_path='' as $$
declare closed_session provision_private.account_impersonation;
begin
 select * into closed_session from provision_private.account_impersonation
 where id=p_id and actor=p_actor and actor_session=p_actor_session for update;
 if closed_session.id is null then raise exception 'forbidden' using errcode='42501'; end if;
 if closed_session.ended_at is not null then return null; end if;
 update provision_private.account_impersonation set ended_at=now(),token_cipher=null where id=p_id;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(p_actor,closed_session.target,'impersonation_end',jsonb_build_object('session',p_id));
 return closed_session.token_cipher;
end $$;

create function public.platform_impersonation_log(p_id uuid,p_actor uuid,p_actor_session uuid,p_resource text,p_operation text)
returns void language plpgsql security definer set search_path='' as $$
declare current_session jsonb;
begin
 current_session=public.platform_impersonation_access(p_id,p_actor,p_actor_session);
 if length(p_resource)>200 or length(p_operation)>100 then raise exception 'invalid_input'; end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(p_actor,(current_session->>'target')::uuid,'impersonation_action',jsonb_build_object('session',p_id,'resource',p_resource,'operation',p_operation,'phase','requested'));
end $$;

revoke all on function public.platform_impersonation_open(uuid,uuid,uuid),public.platform_impersonation_seal(uuid,uuid,uuid,uuid,text),
 public.platform_impersonation_access(uuid,uuid,uuid),public.platform_impersonation_close(uuid,uuid,uuid),
 public.platform_impersonation_log(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.platform_impersonation_open(uuid,uuid,uuid),public.platform_impersonation_seal(uuid,uuid,uuid,uuid,text),
 public.platform_impersonation_access(uuid,uuid,uuid),public.platform_impersonation_close(uuid,uuid,uuid),
 public.platform_impersonation_log(uuid,uuid,uuid,text,text) to service_role;

-- Even in-flight delegated SQL/Storage operations lose access after expiry or revocation
do $$
begin
 execute replace(pg_get_functiondef('provision_private.account_ready()'::regprocedure),
  'FUNCTION provision_private.account_ready()', 'FUNCTION provision_private.account_ready_without_impersonation()');
end $$;
revoke all on function provision_private.account_ready_without_impersonation() from public,anon,authenticated;
create or replace function provision_private.account_ready()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare delegated provision_private.account_impersonation; session_value uuid;
begin
 if not provision_private.account_ready_without_impersonation() then return false; end if;
 begin session_value=nullif(auth.jwt()->>'session_id','')::uuid; exception when others then return false; end;
 select * into delegated from provision_private.account_impersonation where target_session=session_value;
 if not found then return true; end if;
 return delegated.target=auth.uid() and delegated.ended_at is null and delegated.expires_at>now()
  and provision_private.impersonation_actor_ready(delegated.actor,delegated.actor_session)
  and exists(select 1 from auth.users u where u.id=delegated.target and u.raw_app_meta_data=delegated.target_metadata);
end $$;
revoke all on function provision_private.account_ready() from public,anon,authenticated;
-- Existing RLS policies invoke this guard directly as the authenticated role
grant execute on function provision_private.account_ready() to authenticated;

create function provision_private.impersonation_event_audit()
returns trigger language plpgsql security definer set search_path='' as $$
declare delegated provision_private.account_impersonation;
begin
 select * into delegated from provision_private.account_impersonation
 where target_session=nullif(auth.jwt()->>'session_id','')::uuid;
 if found then
  if not provision_private.account_ready() then raise exception 'session_expired' using errcode='42501'; end if;
  insert into provision_private.audit(actor,effective_user,action,details)
  values(delegated.actor,delegated.target,'impersonation_work_event',jsonb_build_object('session',delegated.id,'event',new.id,'request',new.request_id,'kind',new.kind));
 end if;
 return new;
end $$;
revoke all on function provision_private.impersonation_event_audit() from public,anon,authenticated;
create trigger impersonation_event_audit after insert on public.work_events for each row execute function provision_private.impersonation_event_audit();

-- A fresh server decision for open browser sessions and server-side account APIs
create function public.platform_access_check(p_allow_onboarding boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid; account auth.users;
begin
 begin sid=nullif(auth.jwt()->>'session_id','')::uuid; exception when others then raise exception 'session_expired' using errcode='42501'; end;
 if not provision_private.account_available(auth.uid()) or not provision_private.session_active(auth.uid(),sid) then
  raise exception 'account_unavailable' using errcode='42501';
 end if;
 if (not coalesce(p_allow_onboarding,false)
  or exists(select 1 from provision_private.account_impersonation where target_session=sid))
  and not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 select * into account from auth.users where id=auth.uid();
 return jsonb_build_object('user_id',account.id,'role',account.raw_app_meta_data->>'role');
end $$;
revoke all on function public.platform_access_check(boolean) from public,anon;
grant execute on function public.platform_access_check(boolean) to authenticated;

notify pgrst,'reload schema';
commit;
