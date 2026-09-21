begin;
create table provision_private.work_attachment_drive_receipts (
 id uuid primary key,
 request_id uuid not null references public.work_requests(id) on delete cascade,
 author_id uuid not null references auth.users(id),
 drive_url text not null check(provision_private.work_drive_url_valid(drive_url)),
 files jsonb not null check(jsonb_typeof(files)='array'),
 result jsonb not null
);
create index work_attachment_drive_receipts_request_idx on provision_private.work_attachment_drive_receipts(request_id);
alter table provision_private.work_attachment_drive_receipts enable row level security;
revoke all on provision_private.work_attachment_drive_receipts from public,anon,authenticated;

create function provision_private.work_attach_drive(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.work_requests; receipt provision_private.work_attachment_drive_receipts;
 key uuid=(p->>'submission_key')::uuid; link text=nullif(trim(p->>'drive_url'),'');
 files jsonb=coalesce(p->'files','[]'::jsonb); outcome jsonb; links jsonb;
begin
 if not provision_private.account_ready() or provision_private.work_role()='client' then raise exception 'forbidden' using errcode='42501';end if;
 if key is null or octet_length(p::text)>50000 or jsonb_typeof(files) is distinct from 'array' then raise exception 'invalid_input';end if;
 if link is null or not provision_private.work_drive_url_valid(link) then raise exception 'invalid_drive_url';end if;
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 if r.id is null or not provision_private.work_read(r.id)
  or not(provision_private.work_coordinator() or provision_private.work_manage(coalesce(r.service_id,r.requested_service_id))) then
  raise exception 'forbidden' using errcode='42501';end if;
 select * into receipt from provision_private.work_attachment_drive_receipts where id=key;
 if found then
  if receipt.request_id is distinct from r.id or receipt.author_id is distinct from auth.uid()
   or receipt.drive_url is distinct from link or receipt.files is distinct from files then raise exception 'submission_conflict';end if;
  return receipt.result;
 end if;
 if r.version is distinct from (p->>'version')::integer then raise exception 'version_conflict';end if;
 if r.status in('completed','declined') then raise exception 'invalid_state';end if;
 if jsonb_array_length(files)>0 then
  outcome=public.work_action('attach',jsonb_build_object('request_id',r.id,'version',r.version,'files',files));
 end if;
 if jsonb_array_length(files)=0 or (select version from public.work_requests where id=r.id)=r.version then
  update public.work_requests set version=version+1,updated_at=now() where id=r.id;
  insert into public.work_events(request_id,actor,kind,note,client_visible) values(r.id,auth.uid(),'attach','',true);
  outcome=coalesce(outcome,jsonb_build_object('request_id',r.id,'attachment_ids','[]'::jsonb));
 end if;
 links=case when jsonb_typeof(r.specifications->'additional_drive_urls')='array' then r.specifications->'additional_drive_urls' else '[]'::jsonb end;
 if not links @> jsonb_build_array(link) then links=links||jsonb_build_array(link);end if;
 update public.work_requests set specifications=jsonb_set(coalesce(specifications,'{}'::jsonb),'{additional_drive_urls}',links) where id=r.id;
 insert into provision_private.work_attachment_drive_receipts(id,request_id,author_id,drive_url,files,result)
 values(key,r.id,auth.uid(),link,files,outcome);
 return outcome;
end
$$;
revoke all on function provision_private.work_attach_drive(jsonb) from public,anon,authenticated;

do $migration$
declare body text; marker text=$old$if action='add_internal_info' or (action='supply_info' and provision_private.work_role()<>'client') then$old$;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 if strpos(body,marker)=0 then raise exception 'attachment_drive_action_guard';end if;
 execute replace(body,marker,$new$if action='attach' and p ? 'drive_url' then return provision_private.work_attach_drive(p);end if;
 $new$||marker);
end
$migration$;
notify pgrst,'reload schema';
commit;
