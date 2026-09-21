begin;

-- Account deletion is irreversible Auth soft deletion so request history and
-- owned Storage objects keep their foreign keys and are never cascade deleted
create table provision_private.account_lifecycle (
 user_id uuid primary key references auth.users(id),
 state text not null check(state in ('active','suspended','temporary','deleted')),
 reason text not null check(length(reason) between 3 and 1000),
 suspended_until timestamptz,
 changed_by uuid not null references auth.users(id),
 changed_at timestamptz not null default now(),
 deleted_at timestamptz,
 original_email text,
 original_role text,
 deletion_session uuid,
 cleanup_authorized_until timestamptz,
 identity_deleted_at timestamptz,
 check((state='temporary' and suspended_until is not null) or (state<>'temporary' and suspended_until is null)),
 check((state='deleted' and deleted_at is not null) or (state<>'deleted' and deleted_at is null))
);
alter table provision_private.account_lifecycle enable row level security;
revoke all on provision_private.account_lifecycle from public,anon,authenticated,service_role;

-- These helpers consult current database state rather than user-editable claims
create function provision_private.account_available(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=p_user
  and not coalesce(u.is_anonymous,false) and u.deleted_at is null
  and u.raw_app_meta_data->>'role' in ('client','employee','admin','super_admin')
  and (u.banned_until is null or u.banned_until<=now())
  and not exists(select 1 from provision_private.account_lifecycle l where l.user_id=u.id
   and (l.state in ('suspended','deleted') or (l.state='temporary' and l.suspended_until>now())))
 );
$$;
create function provision_private.session_active(p_user uuid,p_session uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_session is not null and exists(select 1 from auth.sessions s
  where s.id=p_session and s.user_id=p_user and (s.not_after is null or s.not_after>now()));
$$;
revoke all on function provision_private.account_available(uuid),provision_private.session_active(uuid,uuid) from public,anon,authenticated;

create or replace function provision_private.account_ready() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare sid text;
begin
 sid=auth.jwt()->>'session_id';
 if coalesce(sid,'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 return provision_private.account_available(auth.uid())
  and provision_private.session_active(auth.uid(),sid::uuid)
  and exists(select 1 from auth.users u where u.id=auth.uid()
   and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true');
end;
$$;

-- Shared locking serializes administrative lifecycle actions so another owner
-- cannot disappear between authorization and the last-owner decision
create function public.platform_account_lifecycle(
 p_actor uuid,p_session uuid,p_user uuid,p_operation text,p_reason text,
 p_until timestamptz default null,p_confirmation text default ''
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target auth.users; old_state provision_private.account_lifecycle; next_state text; expiry timestamptz; identity_done boolean;
begin
 if coalesce(p_operation,'') not in ('suspend','suspend-until','reactivate','delete')
  or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then
  raise exception 'invalid_lifecycle_input' using errcode='22023';
 end if;
 if (p_operation='suspend-until' and (p_until is null or p_until<now()+interval '1 minute' or p_until>now()+interval '366 days'))
  or (p_operation<>'suspend-until' and p_until is not null) then
  raise exception 'invalid_suspension_expiry' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(728641);
 perform 1 from auth.users u where u.id=p_actor and provision_private.account_available(u.id)
  and u.raw_app_meta_data->>'role'='super_admin'
  and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true'
  and provision_private.session_active(u.id,p_session) for share;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_actor for share;
 if not found then raise exception 'session_expired' using errcode='42501'; end if;
 if p_actor=p_user then raise exception 'self_action' using errcode='42501'; end if;
 select * into target from auth.users where id=p_user for update;
 if not found then raise exception 'account_not_found'; end if;
 select * into old_state from provision_private.account_lifecycle where user_id=p_user for update;
 if (old_state.state='deleted' or target.deleted_at is not null) and p_operation<>'delete' then
  raise exception 'account_deleted';
 end if;
 if target.raw_app_meta_data->>'role'='super_admin' and p_operation<>'reactivate'
  and not exists(select 1 from auth.users u where u.id<>p_user
   and u.raw_app_meta_data->>'role'='super_admin' and provision_private.account_available(u.id)
   and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true') then
  raise exception 'last_owner' using errcode='42501';
 end if;
 if p_operation='delete' and (nullif(trim(p_confirmation),'') is null
  or lower(trim(p_confirmation)) is distinct from lower(coalesce(old_state.original_email,target.email))) then
  raise exception 'confirmation_mismatch';
 end if;
 if old_state.state is distinct from 'deleted' and target.deleted_at is null
  and (coalesce(target.is_anonymous,false) or coalesce(target.raw_app_meta_data->>'role','') not in ('client','employee','admin','super_admin')) then
  raise exception 'account_not_found';
 end if;
 next_state=case p_operation when 'suspend' then 'suspended' when 'suspend-until' then 'temporary' when 'reactivate' then 'active' else 'deleted' end;
 expiry=case when next_state='temporary' then p_until when next_state in ('suspended','deleted') then '9999-12-31 00:00:00+00'::timestamptz else null end;
 insert into provision_private.account_lifecycle(user_id,state,reason,suspended_until,changed_by,changed_at,
  deleted_at,original_email,original_role,deletion_session,cleanup_authorized_until,identity_deleted_at)
 values(p_user,next_state,trim(p_reason),case when next_state='temporary' then expiry end,p_actor,now(),
  case when next_state='deleted' then now() end,
  case when next_state='deleted' then coalesce(old_state.original_email,target.email) end,
  case when next_state='deleted' then coalesce(old_state.original_role,target.raw_app_meta_data->>'role') end,
  case when next_state='deleted' then p_session end,
  case when next_state='deleted' then now()+interval '5 minutes' end,target.deleted_at)
 on conflict(user_id) do update set state=excluded.state,reason=excluded.reason,suspended_until=excluded.suspended_until,
  changed_by=excluded.changed_by,changed_at=excluded.changed_at,deleted_at=coalesce(provision_private.account_lifecycle.deleted_at,excluded.deleted_at),
  original_email=coalesce(provision_private.account_lifecycle.original_email,excluded.original_email),
  original_role=coalesce(provision_private.account_lifecycle.original_role,excluded.original_role),
  deletion_session=excluded.deletion_session,cleanup_authorized_until=excluded.cleanup_authorized_until,
  identity_deleted_at=coalesce(provision_private.account_lifecycle.identity_deleted_at,excluded.identity_deleted_at);
 update auth.users set banned_until=expiry,updated_at=now() where id=p_user;
 -- Deleting sessions revokes refresh tokens through the Auth foreign key
 -- account_ready rejects all previously issued access JWTs immediately as well
 if next_state<>'active' then
  delete from auth.sessions where user_id=p_user;
  update provision_private.impersonation legacy set ended_at=now() where legacy.ended_at is null and (legacy.actor=p_user or legacy.target=p_user);
 end if;
 if next_state='deleted' then
  insert into public.account_profiles(user_id,display_name,phone,updated_by)
  values(p_user,left(coalesce(target.raw_user_meta_data->>'display_name',target.email,''),120),coalesce(target.phone,''),p_actor)
  on conflict(user_id) do nothing;
  update public.account_invitations set password_cipher=null,locked_until=null,completed_at=coalesce(completed_at,now()) where user_id=p_user;
 end if;
 insert into provision_private.audit(actor,effective_user,action,details)
 values(p_actor,p_user,'account_'||replace(p_operation,'-','_'),jsonb_build_object(
  'user',p_user,'reason',trim(p_reason),'previous_state',coalesce(old_state.state,'active'),
  'state',next_state,'until',case when next_state='temporary' then expiry end,
  'session_id',p_session,'preserved_request_history',true));
 identity_done=target.deleted_at is not null;
 return jsonb_build_object('user_id',p_user,'access_status',next_state,
  'suspended_until',case when next_state='temporary' then expiry end,
  'suspension_reason',trim(p_reason),'identity_deleted',identity_done,
  'identity_cleanup_pending',next_state='deleted' and not identity_done);
end;
$$;
revoke all on function public.platform_account_lifecycle(uuid,uuid,uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.platform_account_lifecycle(uuid,uuid,uuid,text,text,timestamptz,text) to service_role;

-- Supabase Auth soft deletion clears contact fields and metadata in several
-- updates in one transaction Existing profile guards accept only that authorized
-- cleanup when the account already carries its permanent tombstone
create function provision_private.account_soft_delete_authorized(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from provision_private.account_lifecycle l join auth.users actor on actor.id=l.changed_by
  where l.user_id=p_user and l.state='deleted' and l.cleanup_authorized_until>now()
  and provision_private.account_available(actor.id) and actor.raw_app_meta_data->>'role'='super_admin'
  and coalesce(actor.raw_app_meta_data->>'must_change_password','false')<>'true'
  and provision_private.session_active(actor.id,l.deletion_session));
$$;
revoke all on function provision_private.account_soft_delete_authorized(uuid) from public,anon,authenticated;

do $$
declare name text; definition text; marker text; patched text;
begin
 foreach name in array array['authorize_employee_profile_edit','commit_employee_profile_edit','authorize_client_contact_edit','commit_client_contact_edit'] loop
  definition=pg_get_functiondef(('provision_private.'||name||'()')::regprocedure);
  marker=case when name like 'authorize_%' then 'return new' else 'return null' end;
  patched=regexp_replace(definition,'\mbegin\M',
   'begin'||E'\n if new.deleted_at is not null and provision_private.account_soft_delete_authorized(new.id) then '||marker||'; end if;', 'i');
  if patched=definition then raise exception 'profile_guard_patch_missing_%',name; end if;
  execute patched;
 end loop;
end;
$$;

create function public.platform_account_deletion_finish(p_actor uuid,p_session uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare deletion timestamptz;
begin
 if not provision_private.account_available(p_actor) or not provision_private.session_active(p_actor,p_session)
  or not exists(select 1 from auth.users where id=p_actor and raw_app_meta_data->>'role'='super_admin'
   and coalesce(raw_app_meta_data->>'must_change_password','false')<>'true') then
  raise exception 'forbidden' using errcode='42501';
 end if;
 select deleted_at into deletion from auth.users where id=p_user;
 if deletion is null then raise exception 'identity_cleanup_pending'; end if;
 update provision_private.account_lifecycle set identity_deleted_at=deletion,cleanup_authorized_until=null
  where user_id=p_user and state='deleted';
 if not found then raise exception 'account_not_found'; end if;
 return jsonb_build_object('user_id',p_user,'access_status','deleted','identity_deleted',true,'identity_cleanup_pending',false);
end;
$$;
revoke all on function public.platform_account_deletion_finish(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_account_deletion_finish(uuid,uuid,uuid) to service_role;

-- No new session can race a suspension transaction and survive its revocation
-- Pending onboarding can still sign in to perform the required password change
create function provision_private.account_session_admission() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from auth.users where id=new.user_id for share;
 if not provision_private.account_available(new.user_id) then
  raise exception 'account_unavailable' using errcode='42501';
 end if;
 return new;
end;
$$;
revoke all on function provision_private.account_session_admission() from public,anon,authenticated;
create trigger account_session_admission before insert on auth.sessions
 for each row execute function provision_private.account_session_admission();

create or replace function public.platform_users(p_search text default '',p_page integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not provision_private.allowed('users.read') then raise exception 'forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(row)),'[]') into result from (
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
   and (coalesce(l.original_email,u.email) ilike '%'||left(coalesce(p_search,''),100)||'%'
    or p.display_name ilike '%'||left(coalesce(p_search,''),100)||'%' or u.phone like '%'||left(coalesce(p_search,''),30)||'%')
  order by u.created_at desc limit 50 offset least(greatest(coalesce(p_page,0),0),100000)*50
 ) row;
 return result;
end;
$$;

commit;
