-- Add department supervision without granting coordinator or administrative authority
-- Rollback: remove delegate from work_action and restore the prior read projections
-- No existing tasks are reassigned and no notification transport settings are changed

create or replace function provision_private.work_lead(p_service uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and provision_private.work_role()='employee' and exists(
  select 1 from public.work_memberships membership
  join public.work_services service on service.id=membership.service_id and service.active
  where membership.user_id=auth.uid() and membership.member_role='lead'
   and (p_service is null or membership.service_id=p_service)
 )
$$;
revoke all on function provision_private.work_lead(uuid) from public,anon,authenticated;

-- Read access is scoped to requests with work in a department supervised by this account
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('provision_private.work_read(uuid)'::regprocedure);
 needle='p.request_id=r and p.assignee_id=auth.uid()';
 if strpos(body,needle)=0 then raise exception 'department_lead_request_read_guard'; end if;
 execute replace(body,needle,'p.request_id=r and (p.assignee_id=auth.uid() or provision_private.work_lead(p.service_id))');

 body=pg_get_functiondef('provision_private.work_part_read(uuid)'::regprocedure);
 needle='or part.assignee_id=auth.uid()';
 if strpos(body,needle)=0 then raise exception 'department_lead_part_read_guard'; end if;
 execute replace(body,needle,needle||' or provision_private.work_lead(part.service_id)');

 body=pg_get_functiondef('provision_private.work_file_read(text)'::regprocedure);
 needle='participant.request_id=d.request_id and participant.assignee_id=auth.uid()';
 if strpos(body,needle)=0 then raise exception 'department_lead_source_files_guard'; end if;
 execute replace(body,needle,'participant.request_id=d.request_id and (participant.assignee_id=auth.uid() or provision_private.work_lead(participant.service_id))');

 body=pg_get_functiondef('public.work_request_detail(uuid,boolean)'::regprocedure);
 needle='or part.assignee_id=auth.uid()';
 if strpos(body,needle)=0 then raise exception 'department_lead_detail_parts_guard'; end if;
 body=replace(body,needle,needle||' or provision_private.work_lead(part.service_id)');
 body=replace(body,'mine.assignee_id=auth.uid())','(mine.assignee_id=auth.uid() or provision_private.work_lead(mine.service_id)))');
 execute body;

 body=pg_get_functiondef('public.work_routes(uuid)'::regprocedure);
 needle='or part.assignee_id=auth.uid() then part.scope';
 if strpos(body,needle)=0 then raise exception 'department_lead_routes_guard'; end if;
 execute replace(body,needle,'or part.assignee_id=auth.uid() or provision_private.work_lead(part.service_id) then part.scope');

 body=pg_get_functiondef('public.work_board(text,text,integer)'::regprocedure);
 needle='(p_view=''mine'' and exists';
 if strpos(body,needle)=0 then raise exception 'department_lead_board_guard'; end if;
 body=replace(body,needle,'(p_view=''department'' and exists(select 1 from public.work_parts supervised where supervised.request_id=r.id and provision_private.work_lead(supervised.service_id))) or '||needle);
 execute body;

 body=pg_get_functiondef('public.work_workspace(integer,text,text)'::regprocedure);
 needle='if provision_private.work_manager() or provision_private.work_coordinator() then staff=public.work_directory(); end if;';
 if strpos(body,needle)=0 then raise exception 'department_lead_workspace_staff_guard'; end if;
 body=replace(body,needle,'if provision_private.work_manager() or provision_private.work_coordinator() or provision_private.work_lead(null) then staff=public.work_directory(); end if;');
 needle='''staff'',staff,';
 if strpos(body,needle)=0 then raise exception 'department_lead_workspace_shape_guard'; end if;
 body=replace(body,needle,needle||E'\n  ''lead_services'',(select coalesce(jsonb_agg(m.service_id),''[]''::jsonb) from public.work_memberships m where m.user_id=auth.uid() and m.member_role=''lead'' and provision_private.work_lead(m.service_id)),');
 execute body;
end;
$migration$;

-- Heads see the active members of their departments and no unrelated staff identities
create or replace function public.work_directory()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not(provision_private.work_manager() or provision_private.work_coordinator() or provision_private.work_lead(null)) then
  raise exception 'forbidden' using errcode='42501';
 end if;
 return (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (
  select u.id,coalesce(nullif(p.display_name,''),u.email) as name,u.raw_app_meta_data->>'role' as role,
   coalesce(s.capacity,5) as capacity,coalesce(s.coordinator,false) as coordinator,
   (select coalesce(jsonb_agg(m.service_id),'[]') from public.work_memberships m where m.user_id=u.id
    and (provision_private.work_manager() or provision_private.work_coordinator() or provision_private.work_lead(m.service_id))) as services,
   (select coalesce(jsonb_agg(m.service_id),'[]') from public.work_memberships m where m.user_id=u.id and m.member_role='lead'
    and (provision_private.work_manager() or provision_private.work_coordinator() or provision_private.work_lead(m.service_id))) as lead_services,
   (select count(*) from public.work_parts a where a.assignee_id=u.id and a.status not in ('approved','forwarded','internal_done')) as open_count
  from auth.users u left join public.account_profiles p on p.user_id=u.id left join public.work_staff s on s.user_id=u.id
  where u.raw_app_meta_data->>'role' in ('employee','admin','super_admin')
   and provision_private.account_available(u.id)
   and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true'
   and (provision_private.work_manager() or provision_private.work_coordinator() or exists(
    select 1 from public.work_memberships m where m.user_id=u.id and provision_private.work_lead(m.service_id)
   )) order by name
 ) t);
end;
$$;
revoke all on function public.work_directory() from public,anon;
grant execute on function public.work_directory() to authenticated;

-- Distribution reuses the existing task and preserves attachments dependencies and scope
-- It is only available before acceptance so work and deadline reviews cannot be reset
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$elsif action='route_revision' then$old$;
 if strpos(body,needle)=0 then raise exception 'department_delegate_action_guard'; end if;
 body=replace(body,needle,$new$elsif action='delegate' then
   if a.id is null or not provision_private.work_lead(a.service_id) then raise exception 'forbidden' using errcode='42501'; end if;
   if r.status<>'active' or a.status<>'offered' or a.accepted_at is not null then raise exception 'invalid_state'; end if;
   perform 1 from public.work_memberships where user_id=auth.uid() and service_id=a.service_id and member_role='lead' for share;
   if not found then raise exception 'forbidden' using errcode='42501'; end if;
   target=(p->>'assignee_id')::uuid;
   if target is null or target=a.assignee_id then raise exception 'invalid_assignment'; end if;
   -- Lock both staff rows in one stable order before validating current membership
   perform 1 from public.work_staff where user_id in(a.assignee_id,target) order by user_id for update;
   perform 1 from public.work_memberships m join auth.users employee on employee.id=m.user_id
   where m.user_id=target and m.service_id=a.service_id
    and employee.raw_app_meta_data->>'role'='employee'
    and provision_private.account_available(employee.id)
    and coalesce(employee.raw_app_meta_data->>'must_change_password','false')<>'true'
   for share of m,employee;
   if not found then raise exception 'invalid_assignment'; end if;
   update public.work_parts set assignee_id=target where id=a.id;
   note='وزع مسؤول القسم المهمة على أحد أعضاء الفريق';
   perform provision_private.work_notify(target,r.id,'وزع مسؤول القسم عليك مهمة جديدة يرجى الاستلام وتحديد موعد التسليم'||E'\n'||a.scope);
   if a.assignee_id<>auth.uid() then
    perform provision_private.work_notify(a.assignee_id,r.id,'نقل مسؤول القسم المهمة إلى عضو آخر من الفريق'||E'\n'||r.title);
   end if;
   if (select count(*) from public.work_parts where assignee_id=target and status not in('approved','forwarded','internal_done'))>(select capacity from public.work_staff where user_id=target) then
    perform provision_private.work_alert(r.id,a.id,'overload','ضغط عمل مرتفع على الموظف المكلف بهذه المهمة يرجى اتخاذ إجراء');
   end if;
  elsif action='route_revision' then$new$);
 execute body;

 body=pg_get_functiondef('provision_private.work_event_action_label(text)'::regprocedure);
 needle=$old$when 'assign' then$old$;
 if strpos(body,needle)=0 then raise exception 'department_delegate_event_label_guard'; end if;
 execute replace(body,needle,$new$when 'delegate' then 'توزيع مسؤول القسم للمهمة على الفريق'
  when 'assign' then$new$);

 body=pg_get_functiondef('provision_private.work_event_client_notice_required(bigint)'::regprocedure);
 needle='''assign'',''accept''';
 if strpos(body,needle)=0 then raise exception 'department_delegate_client_contract_guard'; end if;
 execute replace(body,needle,'''assign'',''delegate'',''accept''');

 body=pg_get_functiondef('provision_private.work_client_event_message(bigint)'::regprocedure);
 needle=$old$when 'assign' then$old$;
 if strpos(body,needle)=0 then raise exception 'department_delegate_client_message_guard'; end if;
 execute replace(body,needle,$new$when 'delegate' then 'حدد مسؤول القسم عضو الفريق المكلف بطلبك وسنبلغك عند بدء التنفيذ'||E'\n'||request_row.title
  when 'assign' then$new$);
end;
$migration$;

-- New head notices use the current durable outbox and retry pipeline
-- Existing client coordinator manager and assignee notices keep their recipients and keys
create table provision_private.work_department_notification_links(
 event_id bigint not null references public.work_events(id) on delete cascade,
 recipient uuid not null references auth.users(id) on delete cascade,
 event_key text not null,
 primary key(event_id,recipient),
 unique(recipient,event_key)
);
alter table provision_private.work_department_notification_links enable row level security;
revoke all on table provision_private.work_department_notification_links from public,anon,authenticated;
grant all on table provision_private.work_department_notification_links to service_role;

create or replace function provision_private.work_department_event_notices(p_event_id bigint)
returns integer language plpgsql security definer set search_path='' as $$
declare event_row public.work_events; request_row public.work_requests; changed integer;
begin
 select * into event_row from public.work_events where id=p_event_id;
 select * into request_row from public.work_requests where id=event_row.request_id;
 if request_row.id is null or request_row.status='draft' then return 0; end if;
 -- Associate a just-created operational notice with this event before deduplicating
 -- The association survives retries and cannot satisfy two different events
 insert into provision_private.work_department_notification_links(event_id,recipient,event_key)
 select event_row.id,lead.id,existing.event_key
 from (
  select distinct employee.id from public.work_parts part
  join public.work_services service on service.id=part.service_id and service.active
  join public.work_memberships membership on membership.service_id=part.service_id and membership.member_role='lead'
  join auth.users employee on employee.id=membership.user_id
  where part.request_id=request_row.id and (event_row.part_id is null or event_row.part_id=part.id)
   and employee.raw_app_meta_data->>'role'='employee' and employee.id<>event_row.actor
   and provision_private.account_available(employee.id)
   and (not request_row.test or employee.raw_app_meta_data->>'portal_qa'='true')
 ) lead
 join lateral (
  select notification.event_key from public.work_notifications notification
  where notification.recipient=lead.id and notification.request_id=request_row.id
   and event_row.kind in('assign','delegate','route_revision','supply_info','resolve','handoff','force_start','due_rejected','dependency','dependency_reply')
   and notification.event_key like txid_current()::text||':'||request_row.id::text||':%'
   and not exists(select 1 from provision_private.work_department_notification_links previous
    where previous.recipient=lead.id and previous.event_key=notification.event_key)
  order by notification.created_at desc,notification.id desc limit 1
 ) existing on true
 on conflict(event_id,recipient) do nothing;

 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select distinct employee.id,request_row.id,
  'متابعة قسمك'||E'\n'||provision_private.work_event_action_label(event_row.kind)||E'\n'||request_row.title,
  case when employee.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
  'department:event:'||event_row.id::text||':lead'
 from public.work_parts part
 join public.work_services service on service.id=part.service_id and service.active
 join public.work_memberships membership on membership.service_id=part.service_id and membership.member_role='lead'
 join auth.users employee on employee.id=membership.user_id
 where part.request_id=request_row.id and (event_row.part_id is null or event_row.part_id=part.id)
  and employee.raw_app_meta_data->>'role'='employee' and employee.id<>event_row.actor
  and provision_private.account_available(employee.id)
  and coalesce(employee.raw_app_meta_data->>'must_change_password','false')<>'true'
  and (not request_row.test or employee.raw_app_meta_data->>'portal_qa'='true')
  and not exists(select 1 from provision_private.work_department_notification_links existing
   where existing.event_id=event_row.id and existing.recipient=employee.id)
  and not exists(select 1 from provision_private.work_event_notification_links existing
   where existing.event_id=event_row.id and existing.recipient=employee.id)
 on conflict(recipient,event_key) where event_key is not null do nothing;
 get diagnostics changed=row_count;
 return changed;
end;
$$;
revoke all on function provision_private.work_department_event_notices(bigint) from public,anon,authenticated;

do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('provision_private.work_ensure_event_notifications(bigint)'::regprocedure);
 needle='return total_changed;';
 if strpos(body,needle)=0 then raise exception 'department_lead_notification_guard'; end if;
 execute replace(body,needle,'total_changed=total_changed+provision_private.work_department_event_notices(p_event_id);'||E'\n '||needle);

 -- A coordinator fragment may satisfy one event only even in batched operations
 body=pg_get_functiondef('provision_private.work_event_broadcast()'::regprocedure);
 needle='order by notification.created_at desc,notification.id desc limit 1;';
 if strpos(body,needle)=0 then raise exception 'department_delegate_coordinator_link_guard'; end if;
 execute replace(body,needle,$new$and not exists(select 1 from provision_private.work_event_notification_links prior_link
   where prior_link.recipient=notification.recipient and prior_link.event_key=notification.event_key)
  order by notification.created_at desc,notification.id desc limit 1;$new$);

 -- Revalidate only the new lead envelope against current membership before sending
 body=pg_get_functiondef('provision_private.work_notification_audience_eligible(uuid,text,uuid)'::regprocedure);
 needle=$old$when 'employee' then account.raw_app_meta_data->>'role'='employee'$old$;
 if strpos(body,needle)=0 then raise exception 'department_lead_notification_eligibility_guard'; end if;
 execute replace(body,needle,needle||$new$ and (
     requirement.event_key not like 'department:event:%:lead' or provision_private.account_available(account.id) and exists(
      select 1 from public.work_events event_row
      join public.work_parts part on part.request_id=event_row.request_id and (event_row.part_id is null or part.id=event_row.part_id)
      join public.work_memberships membership on membership.service_id=part.service_id and membership.user_id=account.id and membership.member_role='lead'
      join public.work_services service on service.id=part.service_id and service.active
      where 'department:event:'||event_row.id::text||':lead'=requirement.event_key and part.request_id=p_request_id
     )
    )$new$);
end;
$migration$;

notify pgrst,'reload schema';
