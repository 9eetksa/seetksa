begin;
create table provision_private.work_task_due_changes(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.work_requests on delete cascade,
 part_id uuid not null,requested_by uuid not null references auth.users,
 original_due_at timestamptz not null,proposed_due_at timestamptz not null,reason text not null check(length(trim(reason)) between 3 and 2000),
 status text not null default 'pending' check(status in('pending','approved','rejected')),
 reviewed_by uuid references auth.users,reviewed_at timestamptz,review_reason text,
 created_at timestamptz not null default now(),foreign key(part_id,request_id) references public.work_parts(id,request_id),
 check(proposed_due_at>original_due_at),
 check((status='pending' and reviewed_by is null and reviewed_at is null and review_reason is null)
  or(status<>'pending' and reviewed_by is not null and reviewed_at is not null and length(trim(review_reason)) between 3 and 2000))
);
create unique index work_task_due_changes_pending on provision_private.work_task_due_changes(part_id) where status='pending';
create index work_task_due_changes_queue on provision_private.work_task_due_changes(created_at,id) where status='pending';
create table provision_private.work_task_due_change_receipts(
 submission_key uuid primary key,actor uuid not null references auth.users,request_id uuid not null references public.work_requests on delete cascade,
 action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table provision_private.work_task_due_changes enable row level security;
alter table provision_private.work_task_due_change_receipts enable row level security;
revoke all on provision_private.work_task_due_changes,provision_private.work_task_due_change_receipts from public,anon,authenticated;

create function provision_private.work_task_due_admin_locked(p_part uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select review.status in('approved','rejected') and review.reviewed_by is not null
  from public.work_parts part join lateral(select * from provision_private.work_due_reviews
   where part_id=part.id and status in('approved','auto_approved','rejected') order by proposed_at desc,id desc limit 1) review on true
  where part.id=p_part and part.accepted_at is not null and part.due_at=coalesce(review.replacement_due_at,review.proposed_due_at)),false)
$$;
create function provision_private.work_task_due_editable(p_part uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_parts part join public.work_requests request on request.id=part.request_id
  where part.id=p_part and request.status not in('draft','completed','declined') and not part.output_cancelled and not part.output_due_required
   and part.status in('working','waiting','needs_info','escalated') and part.accepted_at is not null and part.due_at is not null
   and provision_private.work_current_client_review(part.id) is null)
$$;
revoke all on function provision_private.work_task_due_admin_locked(uuid),provision_private.work_task_due_editable(uuid) from public,anon,authenticated;

create function public.work_personal_planner(p_bucket text default 'all',p_search text default '',p_page integer default 0,p_priority text default 'all',p_sort text default 'due')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; safe_page integer=least(greatest(coalesce(p_page,0),0),100000); search_text text=left(trim(coalesce(p_search,'')),100);
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin') then raise exception 'forbidden' using errcode='42501'; end if;
 if p_bucket is null or p_bucket not in('all','new','accepted','overdue','waiting','review','completed') or p_priority is null or p_priority not in('all','normal','urgent') or p_sort is null or p_sort not in('latest','oldest','due','priority') then raise exception 'invalid_input'; end if;
 with tasks as materialized(
  select part.*,request.version as request_version,request.title,request.number,request.created_at as request_created_at,request.requested_due_at,
   coalesce(nullif(trim(client.display_name),''),'عميل برو فيجن') as client_name,service.name as department,
   provision_private.work_employee_task_overdue(part.id) as overdue,
   provision_private.work_current_client_review(part.id) is not null as client_review_pending,
   provision_private.work_task_due_admin_locked(part.id) as admin_locked,
   case when part.status in('approved','internal_done','forwarded') then 'completed'
    when part.status='offered' then 'new' when provision_private.work_employee_task_overdue(part.id) then 'overdue'
    when part.status='review' then 'review'
    when part.status in('waiting','needs_info','escalated','revision') or part.output_due_required then 'waiting' else 'accepted' end as bucket,
   (select jsonb_build_object('id',change.id,'proposed_due_at',change.proposed_due_at,'reason',change.reason,'status',change.status,
     'stale',change.original_due_at is distinct from part.due_at or change.requested_by<>part.assignee_id)
    from provision_private.work_task_due_changes change where change.part_id=part.id and change.status='pending' and change.requested_by=auth.uid()) as pending_due_change
  from public.work_parts part join public.work_requests request on request.id=part.request_id
  join public.work_services service on service.id=part.service_id left join public.account_profiles client on client.user_id=request.client_id
  where part.assignee_id=auth.uid() and not part.output_cancelled and request.status not in('draft','declined')
   and provision_private.work_read(request.id) and provision_private.work_part_read(part.id)
 ), counted as(select jsonb_build_object('all',count(*),'new',count(*) filter(where bucket='new'),'accepted',count(*) filter(where bucket='accepted'),
  'overdue',count(*) filter(where bucket='overdue'),'waiting',count(*) filter(where bucket='waiting'),'review',count(*) filter(where bucket='review'),'completed',count(*) filter(where bucket='completed')) value from tasks),
 filtered as materialized(select * from tasks where(p_bucket='all' or bucket=p_bucket) and(p_priority='all' or priority=p_priority)
  and(search_text='' or title ilike '%'||search_text||'%' or client_name ilike '%'||search_text||'%' or department ilike '%'||search_text||'%' or number::text=search_text)),
 paged as(select * from filtered order by case when p_sort='oldest' then created_at end asc,
  case when p_sort='due' then due_at end asc nulls last,case when p_sort='priority' then case when priority='urgent' then 0 else 1 end end asc,
  case when p_sort<>'oldest' then created_at end desc,id limit 40 offset safe_page*40), total as(select count(*) value from filtered)
 select jsonb_build_object('counts',counted.value,'items',coalesce((select jsonb_agg(jsonb_build_object(
  'id','task:'||p.id::text,'part_id',p.id,'request_id',p.request_id,'request_version',p.request_version,'request_title',p.title,'request_number',p.number,
  'client_name',p.client_name,'department',p.department,'scope',p.scope,'priority',p.priority,'status',p.status,'bucket',p.bucket,
  'due_at',p.due_at,'accepted_at',p.accepted_at,'output_due_required',p.output_due_required,'client_review_pending',p.client_review_pending,
  'employee_overdue',p.overdue,'can_reschedule',provision_private.work_task_due_editable(p.id) and not exists(select 1 from provision_private.work_task_due_changes change where change.part_id=p.id and change.status='pending'),
  'due_locked_by_admin',p.admin_locked,'pending_due_change',p.pending_due_change,'created_at',p.created_at,'request_created_at',p.request_created_at,
  'requested_due_at',p.requested_due_at)) from paged p),'[]'::jsonb),'total',total.value,'page',safe_page,'pages',ceil(total.value/40.0)::integer,'has_next',(safe_page+1)*40<total.value)
 into result from counted cross join total;
 return result;
end $$;
revoke all on function public.work_personal_planner(text,text,integer,text,text) from public,anon;
grant execute on function public.work_personal_planner(text,text,integer,text,text) to authenticated;

create function public.work_task_due_changes(p_request uuid default null,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; safe_page integer=least(greatest(coalesce(p_page,0),0),100000);
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin')
  or(p_request is null and not provision_private.work_manager()) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_request is not null and not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501'; end if;
 with entries as materialized(
  select change.*,request.version as request_version,request.title,request.number,service.name as department,
   coalesce(nullif(trim(client.display_name),''),'عميل برو فيجن') as client_name,
   coalesce(nullif(trim(employee.display_name),''),'موظف القسم') as employee,
   part.due_at as effective_due_at,part.assignee_id<>change.requested_by or part.due_at is distinct from change.original_due_at or not provision_private.work_task_due_editable(part.id) as stale,
   change.status='pending' and provision_private.work_manager() and provision_private.work_manage(part.service_id) as can_review
  from provision_private.work_task_due_changes change join public.work_parts part on part.id=change.part_id
  join public.work_requests request on request.id=change.request_id join public.work_services service on service.id=part.service_id
  left join public.account_profiles client on client.user_id=request.client_id left join public.account_profiles employee on employee.user_id=change.requested_by
  where(p_request is null and change.status='pending' or change.request_id=p_request)
   and provision_private.work_read(request.id) and provision_private.work_part_read(part.id)
   and(provision_private.work_manager() and provision_private.work_manage(part.service_id) or p_request is not null and part.assignee_id=auth.uid() and change.requested_by=auth.uid())
 ), paged as(select * from entries order by created_at desc,id limit 40 offset safe_page*40),total as(select count(*) value from entries)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'request_id',p.request_id,'part_id',p.part_id,'request_version',p.request_version,
  'request_title',p.title,'request_number',p.number,'client_name',p.client_name,'department',p.department,'employee',p.employee,
  'original_due_at',p.original_due_at,'proposed_due_at',p.proposed_due_at,'effective_due_at',p.effective_due_at,'reason',p.reason,'status',p.status,
  'review_reason',p.review_reason,'created_at',p.created_at,'stale',p.stale,'can_review',p.can_review)) from paged p),'[]'::jsonb),
  'total',total.value,'count',total.value,'page',safe_page,'pages',ceil(total.value/40.0)::integer,'has_next',(safe_page+1)*40<total.value) into result from total;
 return result;
end $$;
revoke all on function public.work_task_due_changes(uuid,integer) from public,anon;
grant execute on function public.work_task_due_changes(uuid,integer) to authenticated;

create function public.work_reschedule_task_due(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.work_requests;a public.work_parts;receipt provision_private.work_task_due_change_receipts;
 key uuid=(p->>'submission_key')::uuid;due timestamptz=(p->>'due_at')::timestamptz;expected timestamptz=(p->>'expected_due_at')::timestamptz;
 why text=trim(coalesce(p->>'reason',''));proposal uuid;result jsonb;audit_id bigint;section text;message text;outcome text;
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin') then raise exception 'forbidden' using errcode='42501'; end if;
 if key is null or octet_length(p::text)>20000 then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 select * into a from public.work_parts where id=(p->>'part_id')::uuid and request_id=r.id for update;
 if a.id is null or a.assignee_id<>auth.uid() or not provision_private.work_read(r.id) or not provision_private.work_part_read(a.id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into receipt from provision_private.work_task_due_change_receipts where submission_key=key;
 if receipt.submission_key is not null then
  if receipt.actor<>auth.uid() or receipt.request_id<>r.id or receipt.action<>'reschedule' or receipt.payload is distinct from(p-'version') then raise exception 'submission_conflict'; end if;
  return receipt.result;
 end if;
 if(p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
 if expected is null or expected is distinct from a.due_at then raise exception 'due_conflict'; end if;
 if not provision_private.work_task_due_editable(a.id) then raise exception 'invalid_state'; end if;
 if due is null or not isfinite(due) or due<=now() or due>now()+interval '2 years' or due=a.due_at
  or due<>((date_trunc('day',due at time zone 'Asia/Riyadh')+interval '1 day'-interval '1 millisecond') at time zone 'Asia/Riyadh') then raise exception 'invalid_due'; end if;
 if exists(select 1 from provision_private.work_task_due_changes where part_id=a.id and status='pending') then raise exception 'due_change_pending'; end if;
 if(select count(*) from public.work_events where actor=auth.uid() and created_at>now()-interval '1 minute')>=120 then raise exception 'work_rate_limit'; end if;
 select name into section from public.work_services where id=a.service_id;
 if due<a.due_at then
  if provision_private.work_task_due_admin_locked(a.id) then raise exception 'admin_due_locked'; end if;
  update public.work_parts set due_at=due where id=a.id;
  insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,status,reviewed_at)
  values(r.id,a.id,auth.uid(),due,now(),now()+interval '1 microsecond','auto_approved',now());
  message='قدم الموظف موعد تسليم قسم '||section||' إلى '||provision_private.work_arabic_due_date(due);outcome='updated';
  insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),'employee_due_advanced',message,false) returning id into audit_id;
  if exists(select 1 from public.work_services where id=a.service_id and active and client_visible) and provision_private.work_output_client_visible(a.id) then
   perform provision_private.work_notify_once(r.client_id,r.id,'تم تقديم موعد تسليم قسم '||section||' إلى '||provision_private.work_arabic_due_date(due),'task-due:'||key::text||':client',false);
  end if;
 else
  if length(why) not between 3 and 2000 then raise exception 'invalid_reason'; end if;
  insert into provision_private.work_task_due_changes(request_id,part_id,requested_by,original_due_at,proposed_due_at,reason)
  values(r.id,a.id,auth.uid(),a.due_at,due,why) returning id into proposal;
  message='طلب موظف قسم '||section||' تأجيل موعد التسليم إلى '||provision_private.work_arabic_due_date(due);outcome='pending';
  insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),'employee_due_requested',message,false) returning id into audit_id;
 end if;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after) values(audit_id,a.assignee_id,a.assignee_id,a.status,a.status);
 update public.work_requests set version=version+1,updated_at=now() where id=r.id returning version into r.version;
 result=jsonb_build_object('request_id',r.id,'part_id',a.id,'version',r.version,'outcome',outcome,'due_at',case when outcome='updated' then due else a.due_at end,'proposal_id',proposal);
 insert into provision_private.work_task_due_change_receipts values(key,auth.uid(),r.id,'reschedule',p-'version',result,now());
 return result;
end $$;
revoke all on function public.work_reschedule_task_due(jsonb) from public,anon;
grant execute on function public.work_reschedule_task_due(jsonb) to authenticated;

create function public.work_review_task_due_change(p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.work_requests;a public.work_parts;change provision_private.work_task_due_changes;receipt provision_private.work_task_due_change_receipts;
 key uuid=(p->>'submission_key')::uuid;decision text=p->>'decision';why text=trim(coalesce(p->>'reason',''));result jsonb;message text;section text;audit_id bigint;
begin
 if not provision_private.account_ready() or not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501'; end if;
 if key is null or octet_length(p::text)>20000 or decision is null or decision not in('approve','reject') or length(why) not between 3 and 2000 then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into r from public.work_requests where id=(p->>'request_id')::uuid for update;
 select * into change from provision_private.work_task_due_changes where id=(p->>'id')::uuid and request_id=r.id for update;
 select * into a from public.work_parts where id=change.part_id and request_id=r.id for update;
 if a.id is null or not provision_private.work_read(r.id) or not provision_private.work_manage(a.service_id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into receipt from provision_private.work_task_due_change_receipts where submission_key=key;
 if receipt.submission_key is not null then
  if receipt.actor<>auth.uid() or receipt.request_id<>r.id or receipt.action<>'review' or receipt.payload is distinct from(p-'version') then raise exception 'submission_conflict'; end if;
  return receipt.result;
 end if;
 if(p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
 if change.status<>'pending' then raise exception 'invalid_state'; end if;
 if(select count(*) from public.work_events where actor=auth.uid() and created_at>now()-interval '1 minute')>=120 then raise exception 'work_rate_limit'; end if;
 if decision='approve' and(a.assignee_id<>change.requested_by or a.due_at is distinct from change.original_due_at or not provision_private.work_task_due_editable(a.id)) then raise exception 'due_conflict'; end if;
 if decision='approve' and change.proposed_due_at<=now() then raise exception 'invalid_due'; end if;
 update provision_private.work_task_due_changes set status=case when decision='approve' then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_reason=why where id=change.id;
 select name into section from public.work_services where id=a.service_id;
 if decision='approve' then
  update public.work_parts set due_at=change.proposed_due_at where id=a.id;
  insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,status,reviewed_by,reviewed_at)
  values(r.id,a.id,change.requested_by,change.proposed_due_at,now(),now()+interval '1 microsecond','approved',auth.uid(),now());
  message='وافقت الإدارة على تأجيل موعد تسليم مهمتك إلى '||provision_private.work_arabic_due_date(change.proposed_due_at);
  if exists(select 1 from public.work_services where id=a.service_id and active and client_visible) and provision_private.work_output_client_visible(a.id) then
   perform provision_private.work_notify_once(r.client_id,r.id,'تحدث موعد تسليم قسم '||section||' إلى '||provision_private.work_arabic_due_date(change.proposed_due_at),'task-due-review:'||key::text||':client',false);
  end if;
 else
  message=case when a.assignee_id=change.requested_by and a.due_at is not null then 'رفضت الإدارة تأجيل موعد تسليم مهمتك ويظل الموعد '||provision_private.work_arabic_due_date(a.due_at) else 'رفضت الإدارة طلب تأجيل موعد تسليم مهمتك' end;
 end if;
 perform provision_private.work_notify_once(change.requested_by,r.id,message||E'\nتوضيح الإدارة '||why,'task-due-review:'||key::text||':employee',true);
 insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),case when decision='approve' then 'employee_due_approved' else 'employee_due_rejected' end,message,false) returning id into audit_id;
 insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after) values(audit_id,a.assignee_id,a.assignee_id,a.status,a.status);
 update public.work_requests set version=version+1,updated_at=now() where id=r.id returning version into r.version;
 result=jsonb_build_object('request_id',r.id,'part_id',a.id,'version',r.version,'outcome',case when decision='approve' then 'approved' else 'rejected' end,'due_at',case when decision='approve' then change.proposed_due_at else a.due_at end);
 insert into provision_private.work_task_due_change_receipts values(key,auth.uid(),r.id,'review',p-'version',result,now());
 return result;
end $$;
revoke all on function public.work_review_task_due_change(jsonb) from public,anon;
grant execute on function public.work_review_task_due_change(jsonb) to authenticated;

-- Existing management/coordinator event delivery carries only server-authored deadline text
do $messages$
declare body text;needle text;
begin
 body=pg_get_functiondef('provision_private.work_event_message(bigint)'::regprocedure);
 needle='provision_private.work_event_action_label(event_row.kind),';
 if strpos(body,needle)=0 then raise exception 'planner_event_message_shape'; end if;
 execute replace(body,needle,$new$case when event_row.kind in('employee_due_advanced','employee_due_requested','employee_due_approved','employee_due_rejected') then split_part(event_row.note,E'\n',1) else provision_private.work_event_action_label(event_row.kind) end,$new$);
 body=pg_get_functiondef('provision_private.work_event_action_label(text)'::regprocedure);
 needle=$old$else 'تحديث داخلي على الطلب'$old$;
 if strpos(body,needle)=0 then raise exception 'planner_event_label_shape'; end if;
 execute replace(body,needle,$new$when 'employee_due_advanced' then 'تقديم موعد تسليم المهمة'
  when 'employee_due_requested' then 'طلب تأجيل موعد تسليم المهمة'
  when 'employee_due_approved' then 'موافقة الإدارة على تأجيل الموعد'
  when 'employee_due_rejected' then 'رفض الإدارة تأجيل الموعد'
  else 'تحديث داخلي على الطلب'$new$);
end $messages$;
notify pgrst,'reload schema';
commit;
