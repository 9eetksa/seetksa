begin;

-- Bind new resources to one real coordinator question and its client reply
-- Private receipts also make retries atomic across attachment and reply actions
create table provision_private.work_coordinator_reply_resources (
 id uuid primary key,
 request_id uuid not null references public.work_requests(id) on delete cascade,
 question_id bigint not null unique references public.work_events(id) on delete cascade,
 response_id bigint not null unique references public.work_events(id) on delete cascade,
 response_text text not null,
 drive_url text check(provision_private.work_drive_url_valid(drive_url)),
 files jsonb not null check(jsonb_typeof(files)='array'),
 result jsonb not null
);
create index work_coordinator_reply_resources_request_idx on provision_private.work_coordinator_reply_resources(request_id);
alter table provision_private.work_coordinator_reply_resources enable row level security;
revoke all on provision_private.work_coordinator_reply_resources from public,anon,authenticated;

create function provision_private.work_reply_coordinator(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 r public.work_requests; question public.work_events;
 receipt provision_private.work_coordinator_reply_resources;
 submission uuid=(p->>'submission_key')::uuid;
 requested_question bigint=(p->>'question_id')::bigint;
 reply_text text=trim(coalesce(p->>'reason',''));
 link text=nullif(trim(p->>'drive_url'),'');
 uploaded jsonb=coalesce(p->'files','[]'::jsonb);
 reply_event bigint; result jsonb; next_version bigint;
begin
 if not provision_private.account_ready() or provision_private.work_role() is distinct from 'client' then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if octet_length(p::text)>50000 or submission is null or requested_question is null
  or length(reply_text)>4000 or (length(reply_text)>0 and length(reply_text)<3)
  or jsonb_typeof(uploaded) is distinct from 'array' then raise exception 'invalid_input';end if;
 if not provision_private.work_drive_url_valid(link) then raise exception 'invalid_drive_url';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 if r.id is null or r.client_id is distinct from auth.uid() then raise exception 'forbidden' using errcode='42501';end if;
 select * into receipt from provision_private.work_coordinator_reply_resources where id=submission;
 if found then
  if receipt.request_id is distinct from r.id or receipt.question_id is distinct from requested_question
   or receipt.response_text is distinct from reply_text or receipt.drive_url is distinct from link
   or receipt.files is distinct from uploaded then raise exception 'submission_conflict';end if;
  return receipt.result;
 end if;
 if r.version is distinct from (p->>'version')::bigint then raise exception 'version_conflict';end if;
 select * into question from public.work_events
 where request_id=r.id and part_id is null and client_visible
  and kind in ('request_info','request_attachments','supply_info','intake','decline_intake')
 order by id desc limit 1;
 if r.status<>'needs_info' or question.id is distinct from requested_question
  or question.kind not in ('request_info','request_attachments') then raise exception 'invalid_state';end if;
 if jsonb_array_length(uploaded)=0 and link is null
  and (question.kind='request_attachments' or length(reply_text)<3) then raise exception 'inquiry_resource_required';end if;

 next_version=r.version;
 if jsonb_array_length(uploaded)>0 then
  -- Existing validator enforces private Storage owner path and unused objects
  perform public.work_action('attach',jsonb_build_object('request_id',r.id,'version',next_version,'files',uploaded));
  select version into next_version from public.work_requests where id=r.id;
 end if;
 -- Preserve all existing task resumption rules and notifications
 result=public.work_action('supply_info',jsonb_build_object('request_id',r.id,'version',next_version,
  'reason',coalesce(nullif(reply_text,''),'أرفق العميل الموارد المطلوبة')));
 select id into reply_event from public.work_events where request_id=r.id and part_id is null
  and actor=auth.uid() and kind='supply_info' and client_visible and id>question.id order by id desc limit 1;
 if reply_event is null then raise exception 'invalid_state';end if;
 insert into provision_private.work_coordinator_reply_resources(id,request_id,question_id,response_id,response_text,drive_url,files,result)
 values(submission,r.id,question.id,reply_event,reply_text,link,uploaded,result);
 return result;
end
$$;
revoke all on function provision_private.work_reply_coordinator(jsonb) from public,anon,authenticated;

do $migration$
declare body text; marker text;
begin
 body=pg_get_functiondef('public.work_client_resource_action(text,jsonb)'::regprocedure);
 marker=$old$if action not in ('create','reply_department')$old$;
 if strpos(body,marker)=0 then raise exception 'coordinator_resource_action_guard';end if;
 body=replace(body,marker,$new$if action='reply_coordinator' then return provision_private.work_reply_coordinator(p);end if;
 if action not in ('create','reply_department')$new$);
 execute body;

 body=pg_get_functiondef('provision_private.work_coordinator_inquiries(uuid)'::regprocedure);
 marker=$old$'response',reply.note,'answered_at',reply.created_at,$old$;
 if strpos(body,marker)=0 then raise exception 'coordinator_resource_projection_guard';end if;
 body=replace(body,marker,$new$'response',coalesce(resources.response_text,reply.note),'answered_at',reply.created_at,
   'response_drive_url',resources.drive_url,$new$);
 marker=$old$and file.created_at>question.created_at and file.created_at<=reply.created_at$old$;
 if strpos(body,marker)=0 then raise exception 'coordinator_resource_files_guard';end if;
 body=replace(body,marker,$new$and case when resources.id is not null then exists (
     select 1 from jsonb_array_elements(resources.files) resource where resource->>'object_path'=file.object_path
    ) else file.created_at>question.created_at and file.created_at<=reply.created_at end$new$);
 marker=$old$) reply on true$old$;
 if strpos(body,marker)=0 then raise exception 'coordinator_resource_join_guard';end if;
 body=replace(body,marker,$new$) reply on true
  left join provision_private.work_coordinator_reply_resources resources
   on resources.request_id=question.request_id and resources.question_id=question.id and resources.response_id=reply.id$new$);
 execute body;
end
$migration$;
notify pgrst,'reload schema';
commit;
