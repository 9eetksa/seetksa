begin;

-- A receipt can authorize only one completed employee update even if an Auth
-- metadata write later replays an older snapshot of that receipt
create unique index audit_employee_edit_request
on provision_private.audit((details->>'request_id'))
where action = 'employee_updated';

-- Auth Admin updates contact fields and metadata in separate statements inside
-- one transaction so authorization is recorded before metadata changes and the
-- final employee record is checked only when that transaction commits
create function provision_private.authorize_employee_profile_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
 receipt jsonb;
 actor_id uuid;
 request_id uuid;
begin
 receipt = new.raw_app_meta_data->'employee_profile_edit';
 if receipt is not distinct from old.raw_app_meta_data->'employee_profile_edit' then
  return new;
 end if;

 if old.raw_app_meta_data->>'role' is distinct from 'employee'
    or new.raw_app_meta_data->>'role' is distinct from 'employee'
    or jsonb_typeof(receipt) is distinct from 'object'
    or coalesce(receipt->>'actor_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(receipt->>'request_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or receipt->>'request_id' is not distinct from old.raw_app_meta_data->'employee_profile_edit'->>'request_id' then
  raise exception 'employee_profile_owner_only' using errcode = '42501';
 end if;

 actor_id = (receipt->>'actor_id')::uuid;
 request_id = (receipt->>'request_id')::uuid;
 if exists (
  select 1 from provision_private.audit a
  where a.action = 'employee_updated' and a.details->>'request_id' = request_id::text
 ) then
  raise exception 'employee_profile_owner_only' using errcode = '42501';
 end if;
 -- Keep the current owner's role stable through the employee update commit
 perform 1 from auth.users u
  where u.id = actor_id
    and u.raw_app_meta_data->>'role' = 'super_admin'
    and coalesce(u.raw_app_meta_data->>'must_change_password','false') <> 'true'
    and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until < now())
  for share;
 if not found then
  raise exception 'employee_profile_owner_only' using errcode = '42501';
 end if;

 perform set_config('provision.employee_profile_edit',jsonb_build_object(
  'actor_id',actor_id,'request_id',request_id,'user_id',new.id
 )::text,true);
 return new;
end;
$$;

revoke all on function provision_private.authorize_employee_profile_edit()
from public,anon,authenticated;

create trigger employee_profile_edit_authorization
before update of raw_app_meta_data on auth.users
for each row
execute function provision_private.authorize_employee_profile_edit();

create function provision_private.commit_employee_profile_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
 edit_context jsonb;
 final_user auth.users%rowtype;
 receipt jsonb;
 actor_id uuid;
 profile_name text;
 profile_phone text;
 job_title text;
begin
 -- Auth creation adds the employee role after inserting the user so only an
 -- already assigned employee is subject to the edit-only authorization boundary
 if old.raw_app_meta_data->>'role' is distinct from 'employee' then
  return null;
 end if;

 edit_context = nullif(current_setting('provision.employee_profile_edit',true),'')::jsonb;
 select * into final_user from auth.users where id = new.id;
 if not found or final_user.raw_app_meta_data->>'role' is distinct from 'employee' then
  raise exception 'employee_profile_owner_only' using errcode = '42501';
 end if;
 receipt = final_user.raw_app_meta_data->'employee_profile_edit';
 if edit_context is null
    or edit_context->>'user_id' is distinct from new.id::text
    or receipt->>'actor_id' is distinct from edit_context->>'actor_id'
    or receipt->>'request_id' is distinct from edit_context->>'request_id' then
  raise exception 'employee_profile_owner_only' using errcode = '42501';
 end if;

 actor_id = (edit_context->>'actor_id')::uuid;
 if not exists (
  select 1 from auth.users u
  where u.id = actor_id
    and u.raw_app_meta_data->>'role' = 'super_admin'
    and coalesce(u.raw_app_meta_data->>'must_change_password','false') <> 'true'
    and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until < now())
 ) then
  raise exception 'employee_profile_owner_only' using errcode = '42501';
 end if;

 -- Password resets and sign-ins do not queue this trigger and cannot reuse a
 -- receipt from an earlier transaction because the local authorization is gone
 if current_setting('provision.employee_profile_edit_committed',true) = edit_context::text then
  return null;
 end if;

 profile_name = trim(coalesce(final_user.raw_user_meta_data->>'display_name',''));
 profile_phone = '+' || ltrim(coalesce(final_user.phone,''),'+');
 job_title = trim(coalesce(final_user.raw_app_meta_data->>'job_title',''));
 if length(profile_name) not between 1 and 120
    or length(job_title) not between 1 and 120
    or profile_phone !~ '^\+[1-9][0-9]{7,14}$' then
  raise exception 'invalid_employee_profile' using errcode = '22023';
 end if;

 insert into public.account_profiles(user_id,display_name,phone,updated_by,updated_at)
 values(final_user.id,profile_name,profile_phone,actor_id,now())
 on conflict(user_id) do update
 set display_name = excluded.display_name,
     phone = excluded.phone,
     updated_by = excluded.updated_by,
     updated_at = excluded.updated_at;

 insert into provision_private.audit(actor,effective_user,action,details)
 values(actor_id,final_user.id,'employee_updated',jsonb_build_object(
  'user',final_user.id,'request_id',edit_context->>'request_id',
  'changed_fields',to_jsonb(array_remove(array[
   case when old.raw_user_meta_data->>'display_name' is distinct from final_user.raw_user_meta_data->>'display_name' then 'name' end,
   case when old.email is distinct from final_user.email or old.email_change is distinct from final_user.email_change then 'email' end,
   case when old.phone is distinct from final_user.phone or old.phone_change is distinct from final_user.phone_change then 'phone' end,
   case when old.raw_app_meta_data->>'job_title' is distinct from final_user.raw_app_meta_data->>'job_title' then 'jobTitle' end
  ]::text[],null))
 ));
 perform set_config('provision.employee_profile_edit_committed',edit_context::text,true);
 return null;
end;
$$;

revoke all on function provision_private.commit_employee_profile_edit()
from public,anon,authenticated;

create constraint trigger employee_profile_edit_commit
after update on auth.users
deferrable initially deferred
for each row
when (
 old.email is distinct from new.email
 or old.phone is distinct from new.phone
 or (old.email_change is distinct from new.email_change and nullif(new.email_change,'') is not null)
 or (old.phone_change is distinct from new.phone_change and nullif(new.phone_change,'') is not null)
 or old.raw_user_meta_data->>'display_name' is distinct from new.raw_user_meta_data->>'display_name'
 or old.raw_app_meta_data->>'job_title' is distinct from new.raw_app_meta_data->>'job_title'
 or old.raw_app_meta_data->'employee_profile_edit' is distinct from new.raw_app_meta_data->'employee_profile_edit'
)
execute function provision_private.commit_employee_profile_edit();

-- Employees can only be edited through the authenticated owner account action
-- Keep the existing self-service path for other account types unchanged
create or replace function public.platform_update_profile(
 p_name text,p_phone text,p_session uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
 target_id uuid;
 target_role text;
begin
 target_id = provision_private.effective_user(p_session);
 select raw_app_meta_data->>'role' into target_role
 from auth.users where id = target_id for share;
 if target_role = 'employee' then
  raise exception 'employee_profile_owner_only' using errcode = '42501';
 end if;
 if length(p_name) > 120 or length(p_phone) > 30 then
  raise exception 'invalid_profile';
 end if;
 insert into public.account_profiles(user_id,display_name,phone,updated_by)
 values(target_id,p_name,p_phone,target_id)
 on conflict(user_id) do update
 set display_name = excluded.display_name,
     phone = excluded.phone,
     updated_by = target_id,
     updated_at = now();
 insert into provision_private.audit(actor,effective_user,action)
 values(auth.uid(),target_id,'profile_update');
end;
$$;

revoke all on function public.platform_update_profile(text,text,uuid) from public,anon;
grant execute on function public.platform_update_profile(text,text,uuid) to authenticated;

commit;
