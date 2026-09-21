begin;

-- Additive resources only No changes to task authorization or Storage policies
create function provision_private.work_drive_url_valid(p_url text) returns boolean
language sql immutable set search_path='' as $$
 select p_url is null or (
  length(p_url) between 1 and 2048
  and p_url ~* '^https://(drive[.]google[.]com|docs[.]google[.]com)/.+$'
  and p_url !~ '[[:space:][:cntrl:]\\<>"]'
 )
$$;
revoke all on function provision_private.work_drive_url_valid(text) from public,anon,authenticated;

alter table provision_private.work_department_inquiries add column response_drive_url text
 check(provision_private.work_drive_url_valid(response_drive_url));

-- Extend the existing locked and idempotent inquiry transaction in place
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_department_inquiry_action(text,jsonb)'::regprocedure);
 needle=$old$requested_kind text=coalesce(p->>'inquiry_kind','data');$old$;
 if strpos(body,needle)=0 then raise exception 'drive_inquiry_declaration_guard'; end if;
 body=replace(body,needle,$new$drive_url text=nullif(trim(p->>'drive_url'),'');
 requested_kind text=coalesce(p->>'inquiry_kind','data');$new$);
 needle=$old$perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));$old$;
 if strpos(body,needle)=0 then raise exception 'drive_inquiry_validation_guard'; end if;
 body=replace(body,needle,$new$if action='reply_department' and not provision_private.work_drive_url_valid(drive_url) then raise exception 'invalid_drive_url'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));$new$);
 needle=$old$i.response_files is distinct from uploaded$old$;
 if strpos(body,needle)=0 then raise exception 'drive_inquiry_receipt_guard'; end if;
 body=replace(body,needle,$new$i.response_files is distinct from uploaded or i.response_drive_url is distinct from drive_url$new$);
 needle=$old$(i.kind='files' and jsonb_array_length(uploaded)=0)$old$;
 if strpos(body,needle)=0 then raise exception 'drive_inquiry_files_guard'; end if;
 body=replace(body,needle,$new$(i.kind='files' and jsonb_array_length(uploaded)=0 and drive_url is null)$new$);
 needle=$old$response_files=uploaded where id=i.id$old$;
 if strpos(body,needle)=0 then raise exception 'drive_inquiry_save_guard'; end if;
 body=replace(body,needle,$new$response_files=uploaded,response_drive_url=drive_url where id=i.id$new$);
 execute body;

 body=pg_get_functiondef('public.work_department_inquiries(uuid)'::regprocedure);
 needle=$old$'response',i.response,$old$;
 if strpos(body,needle)=0 then raise exception 'drive_inquiry_projection_guard'; end if;
 execute replace(body,needle,$new$'response',i.response,'response_drive_url',i.response_drive_url,$new$);
end
$migration$;

-- An explicit endpoint prevents older servers silently discarding supplied links
create function public.work_client_resource_action(action text,p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare drive_url text=nullif(trim(p->>'drive_url'),''); result jsonb; resource jsonb;
begin
 if not provision_private.account_ready() or provision_private.work_role() is distinct from 'client' then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if action not in('create','submit_request','reply_department') or action is null then raise exception 'invalid_action'; end if;
 if octet_length(p::text)>50000 then raise exception 'invalid_input'; end if;
 if not provision_private.work_drive_url_valid(drive_url) then raise exception 'invalid_drive_url'; end if;
 if action='reply_department' then return public.work_department_inquiry_action(action,p); end if;
 resource=case when drive_url is null then '{}'::jsonb else jsonb_build_object('رابط Google Drive',drive_url) end;
 if action='create' then
  if p ? 'specifications' and jsonb_typeof(p->'specifications')<>'object' then raise exception 'invalid_input'; end if;
  p=jsonb_set(p,'{specifications}',(coalesce(p->'specifications','{}'::jsonb)-'رابط Google Drive')||resource);
  -- Original receipt compares the complete specifications including the link
  return public.work_action(action,p);
 end if;
 -- Original submit validates ownership and version and holds the request row lock
 result=public.work_action(action,p);
 update public.work_requests set specifications=(coalesce(specifications,'{}'::jsonb)-'رابط Google Drive')||resource
 where id=(result->>'request_id')::uuid and client_id=auth.uid();
 return result;
end
$$;
revoke all on function public.work_client_resource_action(text,jsonb) from public,anon;
grant execute on function public.work_client_resource_action(text,jsonb) to authenticated;

-- Roll forward to disable inputs if needed Retain saved links and existing reply history
notify pgrst,'reload schema';
commit;
