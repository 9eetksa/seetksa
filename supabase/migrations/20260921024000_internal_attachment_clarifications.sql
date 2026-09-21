begin;
alter table public.work_attachments add column clarification_event_id bigint references public.work_events(id) on delete set null;
create index work_attachments_clarification_idx on public.work_attachments(clarification_event_id) where clarification_event_id is not null;
alter table provision_private.work_attachment_drive_receipts add column event_id bigint references public.work_events(id) on delete set null;
alter table provision_private.work_attachment_drive_receipts add column note text not null default '';

-- Keep original upload validation and receipts and bind resources to the exact event
do $migration$
declare body text; marker text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 marker=$old$   external=true;
  else raise exception 'invalid_action'; end if;$old$;
 if strpos(body,marker)=0 then raise exception 'attach_branch_changed';end if;
 body=replace(body,marker,$new$   external=provision_private.work_role()='client';
   if not external then
    if length(why)>4000 then raise exception 'invalid_input';end if;
    event_name='internal_clarification';note=coalesce(nullif(why,''),'مرفقات أضافها مسؤول التواصل للأقسام');
   end if;
  else raise exception 'invalid_action'; end if;$new$);
 marker='returning id into audit_id;';
 if strpos(body,marker)=0 then raise exception 'attach_event_changed';end if;
 body=replace(body,marker,marker||$new$
 if action='attach' and provision_private.work_role()<>'client' then
  update public.work_attachments set clarification_event_id=audit_id
  where request_id=r.id and uploaded_by=auth.uid() and id in(select value::uuid from jsonb_array_elements_text(uploaded_ids));
 end if;
$new$);
 marker=$old$'attachment_ids',case when action='attach' then uploaded_ids else '[]'::jsonb end$old$;
 if strpos(body,marker)=0 then raise exception 'attach_result_changed';end if;
 body=replace(body,marker,marker||$new$,'event_id',audit_id$new$);
 execute body;

 body=pg_get_functiondef('provision_private.work_attach_drive(jsonb)'::regprocedure);
 body=replace(body,'outcome jsonb; links jsonb;','outcome jsonb; links jsonb; audit_id bigint; attachment_note text=trim(coalesce(p->>''reason'',''''));');
 body=replace(body,'if key is null or','if length(attachment_note)>4000 then raise exception ''invalid_input'';end if;'||chr(10)||' if key is null or');
 body=replace(body,'or receipt.drive_url is distinct from link','or receipt.note is distinct from attachment_note or receipt.drive_url is distinct from link');
 body=replace(body,$old$'version',r.version,'files',files$old$,$new$'version',r.version,'files',files,'reason',attachment_note$new$);
 marker=$old$values(r.id,auth.uid(),'attach','',true);$old$;
 if strpos(body,marker)=0 then raise exception 'drive_event_changed';end if;
 body=replace(body,marker,$new$values(r.id,auth.uid(),'internal_clarification',coalesce(nullif(attachment_note,''),'مرفقات أضافها مسؤول التواصل للأقسام'),false) returning id into audit_id;$new$);
 marker='links=case when';
 body=replace(body,marker,$new$audit_id=coalesce(audit_id,(outcome->>'event_id')::bigint);
 outcome=outcome||jsonb_build_object('event_id',audit_id);
 $new$||marker);
 body=replace(body,'author_id,drive_url,files,result)','author_id,drive_url,files,result,event_id,note)');
 body=replace(body,'auth.uid(),link,files,outcome);','auth.uid(),link,files,outcome,audit_id,attachment_note);');
 execute body;

 -- Suppress historical staff attachment notices at creation and final audience checks
 body=pg_get_functiondef('provision_private.work_notification_audience_eligible(uuid,text,uuid)'::regprocedure);
 marker=$old$internal_event.kind='internal_clarification'$old$;
 if strpos(body,marker)=0 then raise exception 'audience_changed';end if;
 execute replace(body,marker,$new$(internal_event.kind='internal_clarification' or internal_event.kind='attach' and internal_event.actor is distinct from (select r.client_id from public.work_requests r where r.id=internal_event.request_id))$new$);
end
$migration$;

-- Historical file/event association is only made for an exact author and transaction timestamp
update public.work_attachments a set clarification_event_id=(
 select min(e.id) from public.work_events e where e.request_id=a.request_id and e.actor=a.uploaded_by and e.kind='attach' and e.created_at=a.created_at
) from public.work_requests r where r.id=a.request_id and a.uploaded_by is distinct from r.client_id and a.inquiry_id is null;
update provision_private.work_attachment_drive_receipts receipt set event_id=(
 select min(a.clarification_event_id) from public.work_attachments a where a.request_id=receipt.request_id and a.uploaded_by=receipt.author_id
 and exists(select 1 from jsonb_array_elements(receipt.files) f where f->>'object_path'=a.object_path)
);

create or replace function provision_private.work_internal_clarification_projection(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501';end if;
 if provision_private.work_role()='client' then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(item order by created_at desc nulls last,id desc) from (
  select e.id::text id,e.created_at,jsonb_build_object(
   'id','clarification:'||e.id::text,'source','internal','kind','data','message',coalesce(nullif(e.note,''),'مرفقات أضافها مسؤول التواصل للأقسام'),
   'created_at',e.created_at,'can_reply',false,
   'drive_url',(select d.drive_url from provision_private.work_attachment_drive_receipts d where d.event_id=e.id limit 1),
   'files',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.work_attachments a where a.request_id=p_request and a.clarification_event_id=e.id),'[]'::jsonb)
  ) item from public.work_events e join public.work_requests r on r.id=e.request_id
  where e.request_id=p_request and (e.kind='internal_clarification' or e.kind='attach' and e.actor is distinct from r.client_id
   and exists(select 1 from public.work_attachments a where a.clarification_event_id=e.id))
  union all
  select 'drive:'||d.id::text,null::timestamptz,jsonb_build_object('id','clarification-drive:'||d.id::text,'source','internal','kind','data',
   'message',coalesce(nullif(d.note,''),'رابط أضافه مسؤول التواصل للأقسام'),'can_reply',false,'drive_url',d.drive_url,'files','[]'::jsonb)
  from provision_private.work_attachment_drive_receipts d where d.request_id=p_request and d.event_id is null
  union all
  select 'file:'||a.id::text,a.created_at,jsonb_build_object('id','clarification-file:'||a.id::text,'source','internal','kind','data',
   'message','مرفق أضافه مسؤول التواصل للأقسام','created_at',a.created_at,'can_reply',false,'files',jsonb_build_array(to_jsonb(a)))
  from public.work_attachments a join public.work_requests r on r.id=a.request_id
  where a.request_id=p_request and a.uploaded_by is distinct from r.client_id and a.inquiry_id is null and a.clarification_event_id is null
 ) resources),'[]'::jsonb);
end
$$;

-- Do not resend or delete delivery evidence for notices already accepted by the provider
update public.work_notifications n set whatsapp='suppressed'
from public.work_events e join public.work_requests r on r.id=e.request_id
where n.request_id=r.id and n.recipient=r.client_id and e.kind='attach' and e.actor is distinct from r.client_id
 and e.id=substring(n.event_key from '^(?:control|event|journey|department):event:([0-9]{1,18}):')::bigint
 and n.whatsapp in('pending','failed') and n.provider_id is null;
notify pgrst,'reload schema';
commit;
