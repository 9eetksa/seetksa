begin;

alter table public.account_profiles
 add column if not exists contact_name text not null default '',
 add column if not exists logo_path text;

do $constraints$
begin
 if not exists(select 1 from pg_constraint where conname='account_profiles_contact_name_length') then
  alter table public.account_profiles add constraint account_profiles_contact_name_length check(length(contact_name)<=120);
 end if;
 if not exists(select 1 from pg_constraint where conname='account_profiles_logo_path_shape') then
  alter table public.account_profiles add constraint account_profiles_logo_path_shape check(
   logo_path is null or length(logo_path)<=200 and logo_path ~ '^[0-9a-f-]{36}/logo$'
  );
 end if;
end;
$constraints$;

create unique index if not exists account_profiles_logo_path_unique
on public.account_profiles(logo_path) where logo_path is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('client-logos','client-logos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set
 public=false,
 file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists client_logo_read on storage.objects;
drop policy if exists client_logo_insert on storage.objects;
drop policy if exists client_logo_update on storage.objects;
drop policy if exists client_logo_delete on storage.objects;

create or replace function provision_private.client_logo_read(p_name text)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and (
  p_name=auth.uid()::text||'/logo'
  or provision_private.work_manager()
  or provision_private.work_coordinator()
  or exists(
   select 1 from public.work_requests request
   where request.client_id::text=(storage.foldername(p_name))[1]
    and provision_private.work_read(request.id)
  )
 )
$$;
revoke all on function provision_private.client_logo_read(text) from public,anon;
grant execute on function provision_private.client_logo_read(text) to authenticated;

create policy client_logo_read on storage.objects for select to authenticated using(
 bucket_id='client-logos'
 and provision_private.client_logo_read(name)
);
create policy client_logo_insert on storage.objects for insert to authenticated with check(
 bucket_id='client-logos'
 and provision_private.account_ready()
 and provision_private.work_role()='client'
 and name=auth.uid()::text||'/logo'
 and owner_id=auth.uid()::text
);
create policy client_logo_update on storage.objects for update to authenticated using(
 bucket_id='client-logos'
 and provision_private.account_ready()
 and provision_private.work_role()='client'
 and name=auth.uid()::text||'/logo'
 and owner_id=auth.uid()::text
) with check(
 bucket_id='client-logos'
 and name=auth.uid()::text||'/logo'
 and owner_id=auth.uid()::text
);
create policy client_logo_delete on storage.objects for delete to authenticated using(
 bucket_id='client-logos'
 and provision_private.account_ready()
 and provision_private.work_role()='client'
 and name=auth.uid()::text||'/logo'
 and owner_id=auth.uid()::text
);

create or replace function public.client_profile_update(p_display_name text,p_contact_name text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile jsonb;
begin
 if not provision_private.account_ready() or provision_private.work_role()<>'client' then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if p_display_name is null or length(trim(p_display_name)) not between 1 and 120
  or length(trim(coalesce(p_contact_name,'')))>120 then raise exception 'invalid_profile'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from provision_private.audit where actor=auth.uid() and action in('client_profile_update','client_logo_update') and created_at>now()-interval '1 minute')>=6 then
  raise exception 'work_rate_limit';
 end if;
 insert into public.account_profiles(user_id,display_name,phone,contact_name,updated_by,updated_at)
 select u.id,trim(p_display_name),coalesce('+'||nullif(ltrim(u.phone,'+'),''),''),trim(coalesce(p_contact_name,'')),u.id,now()
 from auth.users u where u.id=auth.uid()
 on conflict(user_id) do update set
  display_name=excluded.display_name,
  contact_name=excluded.contact_name,
  updated_by=excluded.updated_by,
  updated_at=now();
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),'client_profile_update',jsonb_build_object('contact_name_set',length(trim(coalesce(p_contact_name,'')))>0));
 select jsonb_build_object('display_name',p.display_name,'contact_name',p.contact_name,'logo_path',p.logo_path) into profile
 from public.account_profiles p where p.user_id=auth.uid();
 return profile;
end;
$$;

create or replace function public.client_logo_commit(p_path text default null)
returns text language plpgsql security definer set search_path='' as $$
declare expected text:=auth.uid()::text||'/logo';
begin
 if not provision_private.account_ready() or provision_private.work_role()<>'client' then
  raise exception 'forbidden' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if p_path is not null then
  if p_path<>expected or not exists(
   select 1 from storage.objects object
   where object.bucket_id='client-logos' and object.name=expected and object.owner_id=auth.uid()::text
    and coalesce(nullif(object.metadata->>'size','')::bigint,0) between 1 and 5242880
    and object.metadata->>'mimetype' in('image/jpeg','image/png','image/webp')
  ) then raise exception 'invalid_logo'; end if;
 end if;
 insert into public.account_profiles(user_id,display_name,phone,logo_path,updated_by,updated_at)
 select u.id,left(coalesce(nullif(u.raw_user_meta_data->>'display_name',''),u.email),120),coalesce('+'||nullif(ltrim(u.phone,'+'),''),''),p_path,u.id,now()
 from auth.users u where u.id=auth.uid()
 on conflict(user_id) do update set logo_path=excluded.logo_path,updated_by=excluded.updated_by,updated_at=now();
 insert into provision_private.audit(actor,effective_user,action,details)
 values(auth.uid(),auth.uid(),'client_logo_update',jsonb_build_object('logo_set',p_path is not null));
 return p_path;
end;
$$;

revoke all on function public.client_profile_update(text,text),public.client_logo_commit(text) from public,anon;
grant execute on function public.client_profile_update(text,text),public.client_logo_commit(text) to authenticated;

create or replace function public.platform_profile(p_session uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_id uuid; profile jsonb;
begin
 if not provision_private.account_ready() then raise exception 'password_change_required' using errcode='42501'; end if;
 target_id=provision_private.effective_user(p_session);
 select jsonb_build_object(
  'user_id',u.id,
  'email',u.email,
  'role',u.raw_app_meta_data->>'role',
  'display_name',coalesce(p.display_name,''),
  'contact_name',coalesce(p.contact_name,''),
  'logo_path',p.logo_path,
  'phone',coalesce(nullif(p.phone,''),'+'||nullif(ltrim(u.phone,'+'),''),''),
  'job_title',u.raw_app_meta_data->>'job_title',
  'updated_by',p.updated_by
 ) into profile
 from auth.users u left join public.account_profiles p on p.user_id=u.id where u.id=target_id;
 return profile;
end;
$$;
revoke all on function public.platform_profile(uuid) from public,anon;
grant execute on function public.platform_profile(uuid) to authenticated;

create or replace function public.work_request_clients(p_requests uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare can_contact boolean:=provision_private.work_manager() or provision_private.work_coordinator();
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if coalesce(cardinality(p_requests),0)>50 then raise exception 'invalid_input'; end if;
 return(
  select coalesce(jsonb_object_agg(request.id::text,jsonb_strip_nulls(jsonb_build_object(
   'id',client.id,
   'name',coalesce(nullif(profile.display_name,''),'عميل برو فيجن'),
   'contact_name',nullif(profile.contact_name,''),
   'logo_path',profile.logo_path,
   'email',case when can_contact or client.id=auth.uid() then client.email end,
   'phone',case when can_contact or client.id=auth.uid() then coalesce(nullif(profile.phone,''),'+'||nullif(ltrim(client.phone,'+'),'')) end
  ))),'{}'::jsonb)
  from public.work_requests request
  join auth.users client on client.id=request.client_id
  left join public.account_profiles profile on profile.user_id=client.id
  where request.id=any(coalesce(p_requests,array[]::uuid[])) and provision_private.work_read(request.id)
 );
end;
$$;
revoke all on function public.work_request_clients(uuid[]) from public,anon;
grant execute on function public.work_request_clients(uuid[]) to authenticated;

create or replace function public.work_clients(p_search text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not(provision_private.work_manager() or provision_private.work_coordinator()) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 return(
  select coalesce(jsonb_agg(to_jsonb(client)),'[]'::jsonb) from(
   select u.id,
    coalesce(nullif(profile.display_name,''),'عميل برو فيجن') as name,
    nullif(profile.contact_name,'') as contact_name,
    u.email,
    coalesce(nullif(profile.phone,''),'+'||nullif(ltrim(u.phone,'+'),'')) as phone,
    profile.logo_path
   from auth.users u left join public.account_profiles profile on profile.user_id=u.id
   where u.raw_app_meta_data->>'role'='client' and (
    u.email ilike '%'||left(coalesce(p_search,''),100)||'%'
    or profile.display_name ilike '%'||left(coalesce(p_search,''),100)||'%'
    or profile.contact_name ilike '%'||left(coalesce(p_search,''),100)||'%'
   )
   order by u.created_at desc limit 50
  ) client
 );
end;
$$;
revoke all on function public.work_clients(text) from public,anon;
grant execute on function public.work_clients(text) to authenticated;

create or replace function public.work_workspace(p_page integer default 0,p_view text default 'mine',p_search text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare board jsonb; services jsonb; self_row jsonb; grants jsonb; staff jsonb:='[]'::jsonb; clients jsonb:='{}'::jsonb; request_ids uuid[]:=array[]::uuid[];
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin') then raise exception 'forbidden' using errcode='42501'; end if;
 board=public.work_board(p_view,left(coalesce(p_search,''),100),least(greatest(coalesce(p_page,0),0),100000));
 select coalesce(array_agg((item->>'id')::uuid),array[]::uuid[]) into request_ids from jsonb_array_elements(coalesce(board->'requests','[]'::jsonb)) as entries(item);
 clients=public.work_request_clients(request_ids);
 services=public.work_service_catalog(provision_private.work_manager());
 select to_jsonb(item) into self_row from(select capacity,coordinator from public.work_staff where user_id=auth.uid()) item;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',grant_row.user_id,'service_id',grant_row.service_id,'can_manage',grant_row.can_manage)),'[]'::jsonb) into grants
 from public.work_grants grant_row where grant_row.user_id=auth.uid() or provision_private.is_owner();
 if provision_private.work_manager() or provision_private.work_coordinator() then staff=public.work_directory(); end if;
 return board||jsonb_build_object(
  'clients',clients,
  'services',services,
  'self',self_row,
  'grants',grants,
  'staff',staff,
  'coordinator',coalesce((self_row->>'coordinator')::boolean,false)
 );
end;
$$;
revoke all on function public.work_workspace(integer,text,text) from public,anon;
grant execute on function public.work_workspace(integer,text,text) to authenticated;

create or replace function public.work_request_snapshot(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.work_requests; client jsonb;
begin
 select * into item from public.work_requests where id=p_request;
 if item.id is null or not provision_private.work_read(item.id) then raise exception 'forbidden' using errcode='42501'; end if;
 client=public.work_request_clients(array[item.id])->(item.id::text);
 return jsonb_build_object(
  'id',item.id,'number',item.number,'title',item.title,'brief',item.brief,'client_id',item.client_id,'coordinator_id',item.coordinator_id,
  'client',client,'service_id',item.service_id,'requested_service_id',item.requested_service_id,
  'specifications',item.specifications,'status',item.status,'priority',item.priority,'requested_due_at',item.requested_due_at,
  'received_at',item.received_at,'version',item.version,'created_at',item.created_at,'updated_at',item.updated_at
 );
end;
$$;
revoke all on function public.work_request_snapshot(uuid) from public,anon;
grant execute on function public.work_request_snapshot(uuid) to authenticated;

commit;
