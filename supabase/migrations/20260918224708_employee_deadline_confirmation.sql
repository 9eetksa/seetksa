begin;

-- Employee acceptance and post-output commitments become effective immediately
-- Retain the review history schema for prior decisions and optional administrative replacements
create or replace function provision_private.work_capture_due_review()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.accepted_at is null or (old.output_due_required and not new.output_due_required and old.due_at is distinct from new.due_at))
  and new.accepted_at is not null and new.due_at is not null and new.assignee_id=auth.uid() then
  update provision_private.work_due_reviews set status='cancelled',reviewed_at=now() where part_id=new.id and status='pending';
  insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,status,reviewed_at)
  values(new.request_id,new.id,new.assignee_id,new.due_at,now(),now()+interval '1 microsecond','auto_approved',now());
 elsif old.accepted_at is not null and (new.accepted_at is null or new.due_at is distinct from old.due_at) then
  update provision_private.work_due_reviews set status='cancelled',reviewed_at=now() where part_id=new.id and status='pending';
 end if;
 return null;
end $$;
revoke all on function provision_private.work_capture_due_review() from public,anon,authenticated;

create or replace function provision_private.work_due_auto_notice()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='pending' and new.status='auto_approved' then
  insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
  values(new.request_id,new.part_id,null,'due_auto_approved','اعتمد موعد تسليم الموظف',false);
 end if;
 return null;
end $$;
revoke all on function provision_private.work_due_auto_notice() from public,anon,authenticated;

create function provision_private.work_arabic_due_date(p_due timestamptz) returns text
language sql stable set search_path='' as $$
 select translate(to_char(p_due at time zone 'Asia/Riyadh','FMDD'),'0123456789','٠١٢٣٤٥٦٧٨٩')||' '||
  (array['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'])[extract(month from p_due at time zone 'Asia/Riyadh')::integer]||' '||
  translate(to_char(p_due at time zone 'Asia/Riyadh','YYYY'),'0123456789','٠١٢٣٤٥٦٧٨٩')
$$;
revoke all on function provision_private.work_arabic_due_date(timestamptz) from public,anon,authenticated;

create table provision_private.work_due_override_receipts(
 submission_key uuid primary key,actor uuid not null references auth.users,
 request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid not null references public.work_parts on delete cascade,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table provision_private.work_due_override_receipts enable row level security;
revoke all on provision_private.work_due_override_receipts from public,anon,authenticated;

create function public.work_override_task_due(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.work_requests; a public.work_parts; receipt provision_private.work_due_override_receipts;
 key uuid=(p->>'submission_key')::uuid; due timestamptz=(p->>'due_at')::timestamptz;
 audit_id bigint; result jsonb; message text;
begin
 if not provision_private.account_ready() or not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501'; end if;
 if key is null or octet_length(p::text)>20000 then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 if r.id is null or not provision_private.work_read(r.id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into a from public.work_parts where id=(p->>'part_id')::uuid and request_id=r.id for update;
 if a.id is null or not provision_private.work_manage(a.service_id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into receipt from provision_private.work_due_override_receipts where submission_key=key;
 if receipt.submission_key is not null then
  if receipt.actor<>auth.uid() or receipt.request_id<>r.id or receipt.part_id<>a.id or receipt.payload is distinct from (p-'version') then raise exception 'submission_conflict'; end if;
  return receipt.result;
 end if;
 if (p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
 if r.status in('draft','completed','declined') or a.status not in('working','waiting','needs_info','escalated','review')
  or a.accepted_at is null or a.due_at is null or a.output_due_required or a.output_cancelled
  or provision_private.work_current_client_review(a.id) is not null then raise exception 'invalid_state'; end if;
 if due is null or not isfinite(due) or due<=now() or due>now()+interval '2 years' or due=a.due_at then raise exception 'invalid_due'; end if;
 if (select count(*) from public.work_events where actor=auth.uid() and created_at>now()-interval '1 minute')>=120 then raise exception 'work_rate_limit'; end if;
 update public.work_parts set due_at=due where id=a.id;
 -- Preserve the previous employee date and the replacement as an explicit administrative decision
 insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,
  status,reviewed_by,reviewed_at,replacement_due_at,reason)
 values(r.id,a.id,a.assignee_id,a.due_at,now(),now()+interval '1 microsecond','rejected',auth.uid(),now(),due,'تعديل موعد التسليم بقرار الإدارة');
 message='عدلت الإدارة موعد تسليم مهمتك إلى '||provision_private.work_arabic_due_date(due);
 insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
 values(r.id,a.id,auth.uid(),'admin_due_changed',message,false) returning id into audit_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after)
 values(audit_id,a.assignee_id,a.assignee_id,a.status,a.status);
 perform provision_private.work_notify_once(a.assignee_id,r.id,message,'due-override:'||key::text,true);
 update public.work_requests set version=version+1,updated_at=now() where id=r.id returning version into r.version;
 result=jsonb_build_object('request_id',r.id,'part_id',a.id,'due_at',due,'version',r.version);
 insert into provision_private.work_due_override_receipts(submission_key,actor,request_id,part_id,payload,result)
 values(key,auth.uid(),r.id,a.id,p-'version',result);
 return result;
end $$;
revoke all on function public.work_override_task_due(jsonb) from public,anon;
grant execute on function public.work_override_task_due(jsonb) to authenticated;

do $labels$
declare body text; needle text;
begin
 body=pg_get_functiondef('provision_private.work_event_action_label(text)'::regprocedure);
 needle=$old$when 'due_auto_approved' then 'اعتماد موعد القسم تلقائيا بعد انتهاء مهلة الإدارة'$old$;
 if strpos(body,needle)=0 then raise exception 'employee_deadline_auto_label_shape'; end if;
 body=replace(body,needle,$new$when 'due_auto_approved' then 'اعتماد موعد تسليم الموظف'$new$);
 needle=$old$else 'تحديث داخلي على الطلب'$old$;
 if strpos(body,needle)=0 then raise exception 'employee_deadline_override_label_shape'; end if;
 execute replace(body,needle,$new$when 'admin_due_changed' then 'تعديل موعد تسليم المهمة'
  else 'تحديث داخلي على الطلب'$new$);
end $labels$;

-- Retire only unresolved queues and never rewrite a historical confirmed or rejected decision
do $current_pending$
begin
 perform 1 from public.work_requests request where exists(select 1 from provision_private.work_due_reviews review
  where review.request_id=request.id and review.status='pending') order by request.id for update;
 update provision_private.work_due_reviews review set status='auto_approved',reviewed_at=now()
 from public.work_parts part join public.work_requests request on request.id=part.request_id
 where review.part_id=part.id and review.request_id=part.request_id and review.status='pending'
  and request.status not in('draft','completed','declined') and part.accepted_at is not null
  and part.status in('working','waiting','needs_info','escalated','review') and not part.output_cancelled and not part.output_due_required
  and part.assignee_id=review.proposed_by and part.due_at=review.proposed_due_at;
 update provision_private.work_due_reviews set status='cancelled',reviewed_at=now() where status='pending';
end $current_pending$;
notify pgrst,'reload schema';
commit;
