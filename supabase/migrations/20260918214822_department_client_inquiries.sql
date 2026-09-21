begin;

-- Answers belong to one assignment and are shared as request resources only
create table provision_private.work_department_inquiries (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid not null references public.work_parts on delete cascade,
 service_id uuid not null references public.work_services,
 requested_by uuid not null references auth.users,
 kind text not null check(kind in ('data','files')),
 message text not null check(length(trim(message)) between 3 and 4000),
 resume_status text not null check(resume_status in ('offered','working')),
 created_at timestamptz not null default now(),
 request_event_id bigint unique references public.work_events,
 response text check(length(response)<=4000), answered_at timestamptz,
 response_key uuid, response_files jsonb,
 check((answered_at is null)=(response_key is null))
);
create unique index work_department_inquiries_pending on provision_private.work_department_inquiries(part_id) where answered_at is null;
create index work_department_inquiries_request on provision_private.work_department_inquiries(request_id,created_at);
alter table provision_private.work_department_inquiries enable row level security;
revoke all on provision_private.work_department_inquiries from public,anon,authenticated;
alter table public.work_attachments add column inquiry_id uuid references provision_private.work_department_inquiries;
create index work_attachments_inquiry on public.work_attachments(inquiry_id) where inquiry_id is not null;

create function provision_private.work_inquiry_read(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(
  select 1 from provision_private.work_department_inquiries inquiry
  join public.work_parts part on part.id=inquiry.part_id and part.request_id=inquiry.request_id
  join public.work_services service on service.id=inquiry.service_id
  where inquiry.id=p_id and provision_private.work_read(inquiry.request_id)
  and (provision_private.work_role()<>'client' or (service.active and service.client_visible and part.service_id=inquiry.service_id))
 )
$$;
revoke all on function provision_private.work_inquiry_read(uuid) from public,anon,authenticated;
grant execute on function provision_private.work_inquiry_read(uuid) to authenticated;

create function public.work_department_inquiries(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id',i.id,'part_id',i.part_id,'department',service.name,'kind',i.kind,'message',i.message,
  'created_at',i.created_at,'response',i.response,'answered_at',i.answered_at,
  'can_reply',i.answered_at is null and r.client_id=auth.uid() and r.status not in ('completed','declined','draft') and part.status='needs_info' and part.service_id=i.service_id,
  'files',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'filename',f.filename,'object_path',f.object_path,'created_at',f.created_at) order by f.created_at,f.id)
   from public.work_attachments f where f.inquiry_id=i.id and f.request_id=i.request_id),'[]'::jsonb)
 ) order by i.created_at,i.id)
 from provision_private.work_department_inquiries i
 join public.work_services service on service.id=i.service_id
 join public.work_requests r on r.id=i.request_id
 join public.work_parts part on part.id=i.part_id and part.request_id=i.request_id
 where i.request_id=p_request and provision_private.work_inquiry_read(i.id)),'[]'::jsonb);
end
$$;
revoke all on function public.work_department_inquiries(uuid) from public,anon;
grant execute on function public.work_department_inquiries(uuid) to authenticated;

create function public.work_department_inquiry_action(action text,p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.work_requests; a public.work_parts; i provision_private.work_department_inquiries;
 key uuid=(p->>'submission_key')::uuid; why text=trim(coalesce(p->>'reason',''));
 requested_kind text=coalesce(p->>'inquiry_kind','data'); uploaded jsonb=coalesce(p->'files','[]'::jsonb); f jsonb; audit_id bigint;
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if octet_length(p::text)>50000 or key is null then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 if r.id is null or not provision_private.work_read(r.id) then raise exception 'forbidden' using errcode='42501'; end if;
 if action='missing' then
  select * into a from public.work_parts where id=(p->>'part_id')::uuid and request_id=r.id for update;
  if a.id is null or a.assignee_id is distinct from auth.uid() or provision_private.work_role()='client' then raise exception 'forbidden' using errcode='42501'; end if;
  select * into i from provision_private.work_department_inquiries where id=key;
  if i.id is not null then
   if i.request_id<>r.id or i.part_id<>a.id or i.requested_by<>auth.uid() or i.message<>why or i.kind<>requested_kind then raise exception 'submission_conflict'; end if;
   return jsonb_build_object('inquiry_id',i.id,'request_id',r.id);
  end if;
 else
  if action<>'reply_department' then raise exception 'invalid_action'; end if;
  select * into i from provision_private.work_department_inquiries where id=(p->>'inquiry_id')::uuid and request_id=r.id for update;
  if i.id is null or r.client_id is distinct from auth.uid() or provision_private.work_role()<>'client' or not provision_private.work_inquiry_read(i.id) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into a from public.work_parts where id=i.part_id and request_id=r.id for update;
  if i.answered_at is not null then
   if i.response_key is distinct from key or i.response is distinct from why or i.response_files is distinct from uploaded then raise exception 'submission_conflict'; end if;
   return jsonb_build_object('inquiry_id',i.id,'request_id',r.id);
  end if;
 end if;
 if (p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
 if r.status in ('completed','declined','draft') then raise exception 'invalid_state'; end if;
 if (select count(*) from public.work_events where actor=auth.uid() and created_at>now()-interval '1 minute')>=120 then raise exception 'work_rate_limit'; end if;
 if action='missing' then
  if a.status not in ('offered','working') then raise exception 'invalid_state'; end if;
  if length(why) not between 3 and 4000 or requested_kind not in ('data','files') then raise exception 'invalid_input'; end if;
  if not exists(select 1 from public.work_services where id=a.service_id and active and client_visible) then raise exception 'invalid_state'; end if;
  insert into provision_private.work_department_inquiries(id,request_id,part_id,service_id,requested_by,kind,message,resume_status)
  values(key,r.id,a.id,a.service_id,auth.uid(),requested_kind,why,a.status) returning * into i;
  update public.work_parts set status='needs_info' where id=a.id;
 else
  if a.status<>'needs_info' or a.service_id<>i.service_id then raise exception 'invalid_state'; end if;
  if jsonb_typeof(uploaded)<>'array' then raise exception 'invalid_file'; end if;
  if length(why)>4000 or (i.kind='data' and length(why)<3) or (i.kind='files' and jsonb_array_length(uploaded)=0) then raise exception 'invalid_input'; end if;
  if jsonb_array_length(uploaded)>100 then raise exception 'invalid_file'; end if;
  for f in select value from jsonb_array_elements(uploaded) loop
   if length(trim(coalesce(f->>'filename',''))) not between 1 and 500 or not exists(
    select 1 from storage.objects where bucket_id='work-files' and name=f->>'object_path'
    and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]='brief'
   ) or exists(select 1 from public.work_attachments where object_path=f->>'object_path') then raise exception 'invalid_file'; end if;
   insert into public.work_attachments(request_id,uploaded_by,object_path,filename,inquiry_id)
   values(r.id,auth.uid(),f->>'object_path',f->>'filename',i.id);
  end loop;
  update provision_private.work_department_inquiries set response=why,answered_at=now(),response_key=key,response_files=uploaded where id=i.id;
  update public.work_parts set status=case when provision_private.work_dependency_blocked(a.id) then 'waiting' else i.resume_status end where id=a.id;
  perform provision_private.work_notify(a.assignee_id,r.id,'تم استكمال البيانات المطلوبة من العميل');
 end if;
 update public.work_requests set version=version+1,updated_at=now() where id=r.id;
 -- Store correspondence only in its authorized projection rather than internal history
 insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
 values(r.id,a.id,auth.uid(),case when action='missing' then 'missing' else 'supply_info' end,'',false) returning id into audit_id;
 if action='missing' then update provision_private.work_department_inquiries set request_event_id=audit_id where id=i.id; end if;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 select audit_id,a.assignee_id,part.assignee_id,a.status,part.status from public.work_parts part where part.id=a.id;
 return jsonb_build_object('inquiry_id',i.id,'request_id',r.id);
end
$$;
revoke all on function public.work_department_inquiry_action(text,jsonb) from public,anon;
grant execute on function public.work_department_inquiry_action(text,jsonb) to authenticated;

-- Keep the established entry point and notification contract
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$if not provision_private.account_ready() then$old$;
 if strpos(body,needle)=0 then raise exception 'inquiry_action_guard'; end if;
 body=replace(body,needle,$new$if action='missing' and p ? 'inquiry_kind' then return public.work_department_inquiry_action(action,p); end if;
 if not provision_private.account_ready() then$new$);
 -- Legacy coordinator replies must never reset direct department inquiries
 needle=$old$where request_id=r.id and status='needs_info' returning$old$;
 if strpos(body,needle)=0 then raise exception 'inquiry_legacy_reply_guard'; end if;
 body=replace(body,needle,$new$where request_id=r.id and status='needs_info'
 and not exists(select 1 from provision_private.work_department_inquiries inquiry where inquiry.part_id=work_parts.id and inquiry.answered_at is null) returning$new$);
 execute body;
 body=pg_get_functiondef('public.work_request_detail(uuid,boolean)'::regprocedure);
 needle='from public.work_attachments attachment where attachment.request_id=p_request;';
 if strpos(body,needle)=0 then raise exception 'inquiry_files_projection_guard'; end if;
 body=replace(body,needle,'from public.work_attachments attachment where attachment.request_id=p_request and attachment.inquiry_id is null;');
 needle=$old$return jsonb_build_object('request',request_row,$old$;
 if strpos(body,needle)=0 then raise exception 'inquiry_detail_projection_guard'; end if;
 execute replace(body,needle,$new$return jsonb_build_object('inquiries',public.work_department_inquiries(p_request),'request',request_row,$new$);
 body=pg_get_functiondef('provision_private.work_file_read(text)'::regprocedure);
 needle='a.object_path=path and provision_private.work_read(a.request_id)';
 if strpos(body,needle)=0 then raise exception 'inquiry_file_read_guard'; end if;
 execute replace(body,needle,needle||' and (a.inquiry_id is null or provision_private.work_inquiry_read(a.inquiry_id))');
 body=pg_get_functiondef('provision_private.work_client_event_message(bigint)'::regprocedure);
 needle=$old$message=case event_row.kind$old$;
 if strpos(body,needle)=0 then raise exception 'inquiry_notification_guard'; end if;
 execute replace(body,needle,$new$if event_row.kind='missing' and service_visible and exists(select 1 from provision_private.work_department_inquiries where request_event_id=event_row.id or (request_event_id is null and part_id=event_row.part_id and requested_by=event_row.actor and created_at=event_row.created_at)) then
  return 'قسم '||service_name||case when exists(select 1 from provision_private.work_department_inquiries where (request_event_id=event_row.id or (request_event_id is null and part_id=event_row.part_id and requested_by=event_row.actor and created_at=event_row.created_at)) and kind='files') then ' يحتاج مرفقات إضافية' else ' يحتاج بيانات إضافية' end;
 end if;
 message=case event_row.kind$new$);
end
$migration$;
drop policy work_attachments_read on public.work_attachments;
create policy work_attachments_read on public.work_attachments for select to authenticated
using(provision_private.work_read(request_id) and (inquiry_id is null or provision_private.work_inquiry_read(inquiry_id)));
commit;
