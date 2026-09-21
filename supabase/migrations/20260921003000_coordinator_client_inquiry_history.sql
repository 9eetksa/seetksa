begin;

-- Project only client-visible intake questions and their next intake reply
-- Department replies and private employee history must never enter this feed
create function provision_private.work_coordinator_inquiries(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not provision_private.work_read(p_request) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'id','coordinator:'||question.id::text,'source','coordinator',
   'department','مسؤول التواصل','kind',case when question.kind='request_attachments' then 'files' else 'data' end,
   'message',question.note,'created_at',question.created_at,
   'response',reply.note,'answered_at',reply.created_at,
   'recorded_by_coordinator',reply.actor is distinct from request_row.client_id,
   'closed',reply.id is null and (boundary.id is not null or request_row.status in ('completed','declined')),
   'can_reply',false,
   -- Existing uploads remain in the request attachment list and under its RLS
   -- The old flow has no reply/file foreign key so include only client uploads
   -- strictly after this question and no later than its reply
   'files',coalesce((select jsonb_agg(jsonb_build_object(
    'id',file.id,'filename',file.filename,'object_path',file.object_path,'created_at',file.created_at
   ) order by file.created_at,file.id)
   from public.work_attachments file
   where file.request_id=p_request and file.inquiry_id is null
    and file.uploaded_by=request_row.client_id
    and file.created_at>question.created_at and file.created_at<=reply.created_at
   ),'[]'::jsonb)
  ) order by question.id desc)
  from public.work_events question
  join public.work_requests request_row on request_row.id=question.request_id
  left join lateral (
   select following.id from public.work_events following
   where following.request_id=question.request_id and following.id>question.id
    and following.part_id is null and following.client_visible
    and following.kind in ('request_info','request_attachments','intake','decline_intake')
   order by following.id limit 1
  ) boundary on true
  left join lateral (
   select answer.id,answer.note,answer.created_at,answer.actor from public.work_events answer
   where answer.request_id=question.request_id and answer.id>question.id
    and (boundary.id is null or answer.id<boundary.id)
    and answer.kind='supply_info' and answer.part_id is null and answer.client_visible
   order by answer.id limit 1
  ) reply on true
  where question.request_id=p_request and question.part_id is null and question.client_visible
   and question.kind in ('request_info','request_attachments')
 ),'[]'::jsonb);
end
$$;
revoke all on function provision_private.work_coordinator_inquiries(uuid) from public,anon,authenticated;

-- Reuse the authorized detail endpoint including impersonation and client reads
do $migration$
declare body text; marker text=$old$'inquiries',public.work_department_inquiries(p_request)$old$;
begin
 body=pg_get_functiondef('public.work_request_detail(uuid,boolean)'::regprocedure);
 if position(marker in body)=0 then raise exception 'request_detail_inquiries_shape_changed';end if;
 execute replace(body,marker,marker||'||provision_private.work_coordinator_inquiries(p_request)');
end;
$migration$;
notify pgrst,'reload schema';
commit;
