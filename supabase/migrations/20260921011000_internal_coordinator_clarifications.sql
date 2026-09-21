begin;

create table provision_private.work_internal_clarifications(
 id uuid primary key,
 request_id uuid not null references public.work_requests(id) on delete cascade,
 author_id uuid not null references auth.users(id),
 event_id bigint not null unique references public.work_events(id) on delete cascade
);
alter table provision_private.work_internal_clarifications enable row level security;
revoke all on provision_private.work_internal_clarifications from public,anon,authenticated;

create function provision_private.work_add_internal_clarification(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.work_requests; receipt provision_private.work_internal_clarifications;
 key uuid=(p->>'submission_key')::uuid; clarification_note text=trim(coalesce(p->>'reason','')); event_id bigint;
begin
 if not provision_private.account_ready() or provision_private.work_role()='client' then raise exception 'forbidden' using errcode='42501';end if;
 if key is null or length(clarification_note) not between 3 and 4000 or octet_length(p::text)>50000 then raise exception 'invalid_input';end if;
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 if r.id is null or not provision_private.work_read(r.id)
  or not(provision_private.work_coordinator() or provision_private.work_manage(coalesce(r.service_id,r.requested_service_id))) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 if r.status='draft' then raise exception 'invalid_state';end if;
 perform pg_advisory_xact_lock(hashtextextended(key::text,0));
 select * into receipt from provision_private.work_internal_clarifications where id=key;
 if found then
  if receipt.request_id<>r.id or receipt.author_id<>auth.uid() or not exists(
   select 1 from public.work_events e where e.id=receipt.event_id and e.note=clarification_note
  ) then raise exception 'submission_conflict';end if;
  return jsonb_build_object('request_id',r.id,'clarification_id',key,'event_id',receipt.event_id);
 end if;
 if (p->>'version')::integer is distinct from r.version then raise exception 'version_conflict';end if;
 -- A clarification never answers a client inquiry or resumes or reopens a task
 update public.work_requests set version=version+1 where id=r.id;
 insert into public.work_events(request_id,actor,kind,note,client_visible)
 values(r.id,auth.uid(),'internal_clarification',clarification_note,false) returning id into event_id;
 insert into provision_private.work_internal_clarifications values(key,r.id,auth.uid(),event_id);
 return jsonb_build_object('request_id',r.id,'clarification_id',key,'event_id',event_id);
end
$$;
revoke all on function provision_private.work_add_internal_clarification(jsonb) from public,anon,authenticated;

create function provision_private.work_internal_clarification_projection(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501';end if;
 if provision_private.work_role()='client' then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
  'id','clarification:'||e.id::text,'source','internal','kind','data',
  'message',e.note,'created_at',e.created_at,'can_reply',false,'files','[]'::jsonb
 ) order by e.id desc) from public.work_events e where e.request_id=p_request and e.kind='internal_clarification' and not e.client_visible),'[]'::jsonb);
end
$$;
revoke all on function provision_private.work_internal_clarification_projection(uuid) from public,anon,authenticated;

do $migration$
declare body text; marker text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 marker=' if action=''create'' then';
 if position(marker in body)=0 then raise exception 'work_action_shape_changed';end if;
 -- Old staff forms are also protected without changing real client replies
 execute replace(body,marker,$new$
 if action='add_internal_info' or (action='supply_info' and provision_private.work_role()<>'client') then
  return provision_private.work_add_internal_clarification(p);
 end if;
$new$||marker);

 body=pg_get_functiondef('public.work_request_detail(uuid,boolean)'::regprocedure);
 marker='||provision_private.work_coordinator_inquiries(p_request)';
 if position(marker in body)=0 then raise exception 'detail_shape_changed';end if;
 execute replace(body,marker,marker||'||provision_private.work_internal_clarification_projection(p_request)');

 body=pg_get_functiondef('provision_private.work_event_action_label(text)'::regprocedure);
 marker='select case kind';
 if position(marker in body)=0 then raise exception 'event_label_shape_changed';end if;
 execute replace(body,marker,marker||E'\n when ''internal_clarification'' then ''أضاف مسؤول التواصل توضيحا داخليا للطلب''');

 body=pg_get_functiondef('provision_private.work_ensure_event_notifications(bigint)'::regprocedure);
 marker=' return total_changed;';
 if position(marker in body)=0 then raise exception 'event_notices_shape_changed';end if;
 -- Existing broadcast owns admin coordinator and department lead notices
 -- Add one notice for assigned employees not already in those audiences
 execute replace(body,marker,$new$
 if event_row.kind='internal_clarification' then
  insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
  select distinct account.id,request_row.id,event_message,
   case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
   'event:event:'||event_row.id::text||':clarification'
  from public.work_parts part join auth.users account on account.id=part.assignee_id
  where part.request_id=request_row.id and not provision_private.work_output_cancelled(part.id)
   and account.raw_app_meta_data->>'role'='employee' and account.id<>event_row.actor
   and provision_private.account_available(account.id)
   and coalesce(account.raw_app_meta_data->>'must_change_password','false')<>'true'
   and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications existing where existing.recipient=account.id
    and existing.request_id=request_row.id and existing.event_key in (
     'control:event:'||event_row.id::text||':admin','event:event:'||event_row.id::text||':coordinator',
     'department:event:'||event_row.id::text||':lead'))
  on conflict(recipient,event_key) where event_key is not null do nothing;
  get diagnostics changed=row_count;
  total_changed=total_changed+changed;
 end if;
$new$||marker);

 -- Defense in depth for any mistakenly queued client copy including retries
 body=pg_get_functiondef('provision_private.work_notification_audience_eligible(uuid,text,uuid)'::regprocedure);
 marker=' select not exists(';
 if position(marker in body)=0 then raise exception 'audience_shape_changed';end if;
 body=overlay(body placing $new$ select not exists(
  select 1 from public.work_events internal_event join auth.users recipient on recipient.id=p_recipient
  where internal_event.request_id=p_request_id and internal_event.kind='internal_clarification'
   and recipient.raw_app_meta_data->>'role'='client'
   and internal_event.id=substring(p_event_key from '^(?:control|event|journey|department):event:([0-9]{1,18}):')::bigint
 ) and not exists($new$ from position(marker in body) for length(marker));
 execute body;
end;
$migration$;
notify pgrst,'reload schema';
commit;
