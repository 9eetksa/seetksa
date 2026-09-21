begin;

-- Only the current batch of a task awaiting client review owns the client review clock
-- Historical pending files must not revive a completed or returned revision
create function provision_private.work_current_client_review(p_part uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select max(delivery.released_at)
 from public.work_parts part join public.work_requests request on request.id=part.request_id
 join lateral (
  select newest.batch_id from public.work_deliveries newest
  where newest.part_id=part.id and newest.request_id=part.request_id
  order by newest.created_at desc,newest.id desc limit 1
 ) latest on true
 join public.work_deliveries delivery on delivery.part_id=part.id and delivery.request_id=part.request_id and delivery.batch_id=latest.batch_id
 where part.id=p_part and part.status='review' and not part.output_cancelled
  and request.status not in('draft','completed','declined')
  and delivery.status='pending' and delivery.released_at is not null and delivery.internal_shared_at is null
$$;
revoke all on function provision_private.work_current_client_review(uuid) from public,anon,authenticated;

create function provision_private.work_employee_task_overdue(p_part uuid,p_as_of timestamptz default now()) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.work_parts part join public.work_requests request on request.id=part.request_id
  where part.id=p_part and request.status not in('draft','completed','declined')
   and part.status in('working','waiting','needs_info','escalated','review')
   and part.accepted_at is not null and part.due_at is not null and part.due_at<p_as_of
   and not part.output_due_required and not part.output_cancelled
   and provision_private.work_current_client_review(part.id) is null)
$$;
revoke all on function provision_private.work_employee_task_overdue(uuid,timestamptz) from public,anon,authenticated;

create function public.work_task_dashboard(
 p_bucket text default 'all',p_search text default '',p_page integer default 0,
 p_priority text default 'all',p_sort text default 'latest'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare team_scope boolean; result jsonb; safe_page integer=least(greatest(coalesce(p_page,0),0),100000);
 review_hours integer=48; search_text text=left(trim(coalesce(p_search,'')),100);
begin
 if not provision_private.account_ready() or provision_private.work_role() not in('employee','admin','super_admin') then raise exception 'forbidden' using errcode='42501'; end if;
 team_scope=provision_private.work_manager() or provision_private.work_coordinator();
 if p_bucket is null or p_bucket not in('all','active','intake','overdue','personal_overdue','client_review','client_review_pending','client_review_overdue','alerts','due_reviews','completed')
  or p_priority is null or p_priority not in('all','normal','urgent') or p_sort is null or p_sort not in('latest','oldest','due','priority') then raise exception 'invalid_input'; end if;
 if not team_scope and p_bucket<>'personal_overdue' then raise exception 'forbidden' using errcode='42501'; end if;

 with request_rows as materialized (
  select r.id,r.status,r.created_at,r.priority,
   jsonb_build_object('id',r.id::text,'request_id',r.id,'request_title',r.title,'request_number',r.number,
    'client_name',coalesce(nullif(trim(client.display_name),''),'عميل برو فيجن'),
    'created_at',r.created_at,'request_created_at',r.created_at,'priority',r.priority,'status',r.status,'requested_due_at',r.requested_due_at,
    'attachment_count',(select count(*) from public.work_attachments attachment where attachment.request_id=r.id and attachment.inquiry_id is null),
    'request_version',r.version) as document
  from public.work_requests r left join public.account_profiles client on client.user_id=r.client_id
  where r.status<>'draft' and provision_private.work_read(r.id)
 ), task_rows as materialized (
  select part.id,part.request_id,part.assignee_id,part.service_id,part.created_at,part.priority,part.status,part.due_at,
   provision_private.work_current_client_review(part.id) as released_at,
   provision_private.work_employee_task_overdue(part.id) as overdue,
   request.document||jsonb_build_object('id','task:'||part.id::text,'part_id',part.id,'task_created_at',part.created_at,
    'priority',part.priority,'status',part.status,'due_at',part.due_at,'accepted_at',part.accepted_at,
    'department',service.name,'employee',coalesce(nullif(trim(employee.display_name),''),'موظف القسم')) as document
  from public.work_parts part join request_rows request on request.id=part.request_id
  join public.work_services service on service.id=part.service_id
  left join public.account_profiles employee on employee.user_id=part.assignee_id
  where not part.output_cancelled and provision_private.work_part_read(part.id) and (team_scope or part.assignee_id=auth.uid())
 ), review_rows as materialized (
  select task.*,latest.batch_id,task.released_at+make_interval(hours=>review_hours) as review_due_at
  from task_rows task join lateral(select delivery.batch_id from public.work_deliveries delivery
   where delivery.part_id=task.id and delivery.request_id=task.request_id order by delivery.created_at desc,delivery.id desc limit 1)latest on true
  where task.released_at is not null
 ), entries as materialized (
  select category.bucket,request.id::text as item_id,request.created_at,null::timestamptz as due_at,request.priority,request.document
  from request_rows request cross join lateral unnest(array['all',case when request.status='active' then 'active' end,
   case when request.status in('new','needs_info') then 'intake' end,case when request.status='completed' then 'completed' end])category(bucket)
  where team_scope and category.bucket is not null
  union all
  select category.bucket,'task:'||task.id::text,task.created_at,task.due_at,task.priority,
   task.document||jsonb_build_object('employee_overdue',true,'client_review_pending',false)
  from task_rows task cross join lateral unnest(array[case when team_scope then 'overdue' end,
   case when task.assignee_id=auth.uid() then 'personal_overdue' end])category(bucket)
  where task.overdue and category.bucket is not null
  union all
  select category.bucket,'review:'||review.id::text||':'||review.batch_id::text,review.released_at,review.review_due_at,review.priority,
   review.document||jsonb_build_object('id','review:'||review.id::text||':'||review.batch_id::text,'batch_id',review.batch_id,
    'released_at',review.released_at,'review_due_at',review.review_due_at,'review_overdue',review.review_due_at<now(),
    'client_review_pending',true,'employee_overdue',false)
  from review_rows review cross join lateral unnest(array['client_review',case when review.review_due_at<now()
   then 'client_review_overdue' else 'client_review_pending' end])category(bucket)
  where team_scope
  union all
  select 'alerts','alert:'||alert.id::text,alert.created_at,null::timestamptz,coalesce(task.priority,request.priority),
   coalesce(task.document,request.document)||jsonb_build_object('id','alert:'||alert.id::text,'escalation_id',alert.id,
    'part_id',alert.part_id,'event_created_at',alert.created_at,'status',alert.status)
  from public.work_escalations alert join request_rows request on request.id=alert.request_id
  left join task_rows task on task.id=alert.part_id
  where team_scope and alert.status='open' and (provision_private.work_manager() or alert.opened_by=auth.uid())
   and (alert.part_id is null or provision_private.work_part_read(alert.part_id))
  union all
  select 'due_reviews','due:'||review.id::text,review.proposed_at,review.review_expires_at,task.priority,
   task.document||jsonb_build_object('id','due:'||review.id::text,'due_review_id',review.id,'event_created_at',review.proposed_at,
    'due_at',review.proposed_due_at,'review_due_at',review.review_expires_at,'status',review.status)
  from provision_private.work_due_reviews review join task_rows task on task.id=review.part_id and task.request_id=review.request_id
  where team_scope and provision_private.work_manager() and provision_private.work_manage(task.service_id) and review.status='pending'
 ), counts as (
  select jsonb_build_object('all',count(*) filter(where bucket='all'),'active',count(*) filter(where bucket='active'),
   'intake',count(*) filter(where bucket='intake'),'overdue',count(*) filter(where bucket='overdue'),
   'personal_overdue',count(*) filter(where bucket='personal_overdue'),
   'client_review',count(*) filter(where bucket='client_review'),
   'client_review_pending',count(*) filter(where bucket='client_review_pending'),
   'client_review_overdue',count(*) filter(where bucket='client_review_overdue'),
   'alerts',count(*) filter(where bucket='alerts'),'due_reviews',count(*) filter(where bucket='due_reviews'),
   'completed',count(*) filter(where bucket='completed')) as value from entries
 ), filtered as materialized (
  select * from entries where bucket=p_bucket and (p_priority='all' or priority=p_priority)
   and (search_text='' or document->>'request_title' ilike '%'||search_text||'%'
    or document->>'client_name' ilike '%'||search_text||'%' or document->>'request_number'=search_text
    or document->>'department' ilike '%'||search_text||'%' or document->>'employee' ilike '%'||search_text||'%')
 ), paged as (
  select * from filtered order by
   case when p_sort='oldest' then created_at end asc,
   case when p_sort='due' then due_at end asc nulls last,
   case when p_sort='priority' then case when priority='urgent' then 0 else 1 end end asc,
   case when p_sort<>'oldest' then created_at end desc,item_id
  limit 40 offset safe_page*40
 ), total as (select count(*) as value from filtered)
 select jsonb_build_object('counts',counts.value,'items',coalesce((select jsonb_agg(paged.document) from paged),'[]'::jsonb),
  'total',total.value,'page',safe_page,'pages',ceil(total.value/40.0)::integer,'has_next',(safe_page+1)*40<total.value,
  'review_hours',review_hours)
 into result from counts cross join total;
 return result;
end $$;
revoke all on function public.work_task_dashboard(text,text,integer,text,text) from public,anon;
grant execute on function public.work_task_dashboard(text,text,integer,text,text) to authenticated;

do $patch$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_board(text,text,integer)'::regprocedure);
 needle=$old$'overdue',count(*) filter(where status not in ('approved','forwarded','internal_done') and due_at<now())+(coordination_counts->>'overdue')::integer$old$;
 if strpos(body,needle)=0 then raise exception 'task_dashboard_personal_overdue_shape'; end if;
 body=replace(body,needle,$new$'overdue',count(*) filter(where provision_private.work_employee_task_overdue(id) and provision_private.work_read(request_id))$new$);
 needle=$old$where p.status not in ('approved','forwarded','internal_done') and p.due_at<now() and provision_private.work_part_read(p.id)$old$;
 if strpos(body,needle)=0 then raise exception 'task_dashboard_team_overdue_shape'; end if;
 body=replace(body,needle,$new$where provision_private.work_employee_task_overdue(p.id) and provision_private.work_part_read(p.id)$new$);
 needle=$old$select coalesce(jsonb_agg(to_jsonb(p)),'[]') into parts$old$;
 if strpos(body,needle)=0 then raise exception 'task_dashboard_part_projection_shape'; end if;
 body=replace(body,needle,$new$select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('employee_overdue',provision_private.work_employee_task_overdue(p.id),'client_review_pending',provision_private.work_current_client_review(p.id) is not null)),'[]') into parts$new$);
 needle=$old$(select count(distinct d.request_id) from public.work_deliveries d join scoped_requests r on r.id=d.request_id
    where d.status='pending' and d.released_at is not null and provision_private.work_part_read(d.part_id))$old$;
 if strpos(replace(body,E'\r\n',E'\n'),needle)=0 then raise exception 'task_dashboard_team_client_reviews_shape'; end if;
 body=replace(replace(body,E'\r\n',E'\n'),needle,$new$(select count(*) from public.work_parts p join scoped_requests r on r.id=p.request_id
    where provision_private.work_current_client_review(p.id) is not null and provision_private.work_part_read(p.id))$new$);
 execute body;
 body=pg_get_functiondef('public.work_request_detail(uuid,boolean)'::regprocedure);
 needle=$old$'output_parent_id',part.output_parent_id,$old$;
 if strpos(body,needle)=0 then raise exception 'task_dashboard_detail_projection_shape'; end if;
 execute replace(body,needle,$new$'employee_overdue',provision_private.work_employee_task_overdue(part.id),'client_review_pending',provision_private.work_current_client_review(part.id) is not null,'output_parent_id',part.output_parent_id,$new$);

 -- Closed reporting periods retain their historical evidence and earned credit
 -- Only the open-period outstanding-lateness component uses the current commitment
 body=replace(pg_get_functiondef('public.work_team_overview(date,date)'::regprocedure),E'\r\n',E'\n');
 needle=$old$and not(request_status in('completed','declined') and request_updated_at<end_at and request_updated_at<=now()) as late_open$old$;
 if strpos(body,needle)=0 then raise exception 'task_dashboard_overview_live_lateness_shape'; end if;
 body=replace(body,needle,$new$and not(request_status in('completed','declined') and request_updated_at<end_at and request_updated_at<=now()) and end_at<=now() as late_open$new$);
 needle=$old$and not(request_status in('completed','declined') and request_updated_at<=proposed_due_at)
 ), late_task_totals as ($old$;
 if strpos(body,needle)=0 then raise exception 'task_dashboard_overview_current_commitment_shape'; end if;
 body=replace(body,needle,$new$and not(request_status in('completed','declined') and request_updated_at<=proposed_due_at)
  union all
  select part.assignee_id,part.id,false,true,false from parts part
  join people person on person.id=part.assignee_id and not person.pending_setup
  where end_at>now() and part.due_at>=start_at and part.due_at<end_at
   and provision_private.work_employee_task_overdue(part.id,as_of)
 ), late_task_totals as ($new$);
 needle=$old$'late','approved_employee_deadline_in_period',$old$;
 if strpos(body,needle)=0 then raise exception 'task_dashboard_overview_policy_shape'; end if;
 execute replace(body,needle,needle||$new$'late_open',case when end_at>now() then 'current_accepted_deadline_in_period' else 'historical_confirmed_deadline' end,$new$);
end $patch$;
notify pgrst,'reload schema';
commit;
