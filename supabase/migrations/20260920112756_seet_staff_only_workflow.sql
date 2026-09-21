begin;

-- Seet retains customer UUID references for existing reports and history
-- Customer records have no portal and cannot acquire a session
create function provision_private.seet_staff() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid()
  and raw_app_meta_data->>'role' in ('employee','admin','super_admin')
  and coalesce(is_anonymous,false)=false);
$$;
revoke all on function provision_private.seet_staff() from public,anon;
grant execute on function provision_private.seet_staff() to authenticated;

create function provision_private.seet_review_access(p_request uuid,p_part uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and provision_private.seet_staff() and exists(
  select 1 from public.work_requests r where r.id=p_request and (
   (r.coordinator_id=auth.uid() and provision_private.work_coordinator())
   or (provision_private.work_manager() and (
    (p_part is null and provision_private.work_manage(r.service_id))
    or exists(select 1 from public.work_parts part where part.request_id=r.id
     and (p_part is null or part.id=p_part) and provision_private.work_manage(part.service_id))
   ))));
$$;
revoke all on function provision_private.seet_review_access(uuid,uuid) from public,anon;
grant execute on function provision_private.seet_review_access(uuid,uuid) to authenticated;

-- Preserve existing lifecycle and impersonation validation
do $$
declare body text; patched text;
begin
 body=pg_get_functiondef('provision_private.account_ready()'::regprocedure);
 patched=regexp_replace(body,'\mbegin\M',E'begin\n if not provision_private.seet_staff() then return false; end if;','i');
 if patched=body then raise exception 'seet_account_guard_missing'; end if;
 execute patched;
 body=pg_get_functiondef('provision_private.account_session_admission()'::regprocedure);
 patched=regexp_replace(body,'\mbegin\M',E'begin\n if exists(select 1 from auth.users where id=new.user_id and raw_app_meta_data->>''role''=''client'') then raise exception ''staff_only'' using errcode=''42501''; end if;','i');
 if patched=body then raise exception 'seet_session_guard_missing'; end if;
 execute patched;
end $$;

-- Restrictive policies also protect old tokens and direct table / Storage access
do $$
declare target record;
begin
 for target in select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and (n.nspname='public' or (n.nspname='storage' and c.relname='objects')) loop
  -- Supabase owns storage.objects and already enables RLS on managed Storage.
  if not target.relrowsecurity then
   execute format('alter table %I.%I enable row level security',target.nspname,target.relname);
  end if;
  execute format('create policy seet_staff_only on %I.%I as restrictive for all to authenticated using (provision_private.seet_staff()) with check (provision_private.seet_staff())',target.nspname,target.relname);
 end loop;
end $$;

create function provision_private.seet_request_intake() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not (provision_private.work_coordinator() or provision_private.work_manager()) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if new.status='draft' then raise exception 'staff_only' using errcode='42501'; end if;
 if provision_private.work_coordinator() then new.coordinator_id=auth.uid(); end if;
 return new;
end $$;
revoke all on function provision_private.seet_request_intake() from public,anon,authenticated;
create trigger seet_request_intake before insert on public.work_requests
 for each row execute function provision_private.seet_request_intake();

-- Retain the original transaction, version checks, batch locking and revision history
do $$
declare body text; needle text; patched text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$if r.client_id<>auth.uid() then raise exception 'forbidden'; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'seet_review_guard_missing'; end if;
 body=replace(body,needle,$new$if not provision_private.seet_review_access(r.id,(select part_id from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id)) then raise exception 'forbidden' using errcode='42501'; end if;$new$);
 execute body;

 body=pg_get_functiondef('public.work_department_inquiries(uuid)'::regprocedure);
 needle='i.answered_at is null and r.client_id=auth.uid()';
 if strpos(body,needle)=0 then raise exception 'seet_inquiry_view_missing'; end if;
 execute replace(body,needle,'i.answered_at is null and provision_private.seet_review_access(r.id,i.part_id)');

 body=pg_get_functiondef('public.work_department_inquiry_action(text,jsonb)'::regprocedure);
 needle=$old$r.client_id is distinct from auth.uid() or provision_private.work_role()<>'client'$old$;
 if strpos(body,needle)=0 then raise exception 'seet_inquiry_reply_missing'; end if;
 execute replace(body,needle,'not provision_private.seet_review_access(r.id,i.part_id)');
end $$;

create or replace function public.work_client_resource_action(action text,p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare drive_url text=nullif(trim(p->>'drive_url'),''); resource jsonb;
begin
 if not provision_private.account_ready() or not (provision_private.work_coordinator() or provision_private.work_manager()) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if action not in ('create','reply_department') or action is null then raise exception 'invalid_action'; end if;
 if octet_length(p::text)>50000 then raise exception 'invalid_input'; end if;
 if not provision_private.work_drive_url_valid(drive_url) then raise exception 'invalid_drive_url'; end if;
 if action='reply_department' then return public.work_department_inquiry_action(action,p); end if;
 if p ? 'specifications' and jsonb_typeof(p->'specifications')<>'object' then raise exception 'invalid_input'; end if;
 resource=case when drive_url is null then '{}'::jsonb else jsonb_build_object('رابط Google Drive',drive_url) end;
 p=jsonb_set(p,'{specifications}',(coalesce(p->'specifications','{}'::jsonb)-'رابط Google Drive')||resource);
 return public.work_action(action,p);
end $$;
revoke all on function public.work_client_resource_action(text,jsonb) from public,anon;
grant execute on function public.work_client_resource_action(text,jsonb) to authenticated;

create function provision_private.seet_internal_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from auth.users where id=new.recipient and raw_app_meta_data->>'role'='client') then
  if tg_op='UPDATE' then new.whatsapp='suppressed'; return new; end if;
  return null;
 end if;
 return new;
end $$;
create or replace function provision_private.work_event_client_notice_required(p_event_id bigint)
returns boolean language sql stable security definer set search_path='' as $$select false$$;
revoke all on function provision_private.work_event_client_notice_required(bigint) from public,anon,authenticated;
revoke all on function provision_private.seet_internal_notification() from public,anon,authenticated;
create trigger seet_internal_notification before insert or update on public.work_notifications
 for each row execute function provision_private.seet_internal_notification();

do $$
declare body text; patched text;
begin
 body=pg_get_functiondef('provision_private.work_notify(uuid,uuid,text)'::regprocedure);
 patched=regexp_replace(body,'\mbegin\M',E'begin\n if exists(select 1 from auth.users where id=who and raw_app_meta_data->>''role''=''client'') then return; end if;','i');
 if patched=body then raise exception 'seet_notification_guard_missing'; end if;
 execute patched;
end $$;

-- Existing pending customer notices must not be picked up by either worker
update public.work_notifications set whatsapp='suppressed',last_error='seet_no_client_portal'
 where recipient in (select id from auth.users where raw_app_meta_data->>'role'='client')
 and whatsapp in ('pending','failed','sending','unknown');

-- Customer access is denied at RPC boundaries even for previously issued JWTs
do $$
declare fn record; body text; patched text;
begin
 for fn in select p.oid,p.prosrc,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  join pg_language l on l.oid=p.prolang
  where n.nspname='public' and p.prosecdef and l.lanname='plpgsql' loop
  body=pg_get_functiondef(fn.oid);
  patched=regexp_replace(fn.prosrc,'\mbegin\M',E'begin\n if exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>''role''=''client'') then raise exception ''staff_only'' using errcode=''42501''; end if;','i');
  if patched=fn.prosrc then raise exception 'seet_rpc_guard_missing_%',fn.proname; end if;
  execute replace(body,fn.prosrc,patched);
 end loop;
end $$;

-- Never permit impersonation of a customer record
do $$
declare body text; patched text;
begin
 body=pg_get_functiondef('public.platform_impersonation_open(uuid,uuid,uuid)'::regprocedure);
 patched=regexp_replace(body,'\mbegin\M',E'begin\n if exists(select 1 from auth.users where id=p_target and raw_app_meta_data->>''role''=''client'') then raise exception ''staff_only'' using errcode=''42501''; end if;','i');
 if patched=body then raise exception 'seet_impersonation_guard_missing'; end if;
 execute patched;
end $$;

-- Change authored event copy only Never rewrite user-entered history or notes
do $$
declare fn record; body text; patched text;
begin
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('public','provision_private') and p.prokind='f' loop
  body=pg_get_functiondef(fn.oid);
  patched=replace(replace(replace(replace(replace(replace(replace(replace(body,
   'برو فيجن','صيت'),'مسؤول التواصل','المشرف المسؤول'),'فريق التواصل','فريق الإشراف'),
   'اعتمد العميل','اعتمد المشرف'),'العميل طلب تعديلات','المشرف طلب تعديلات'),
   'مراجعة العميل','مراجعة المشرف'),'اعتماد العميل','اعتماد المشرف'),'رد العميل','رد المشرف');
  if patched<>body then execute patched; end if;
 end loop;
end $$;

notify pgrst,'reload schema';
commit;
