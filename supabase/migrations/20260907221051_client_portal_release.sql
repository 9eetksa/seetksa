begin;
alter table public.work_requests alter column service_id drop not null;
alter table public.work_requests drop constraint work_requests_status_check;
alter table public.work_requests add constraint work_requests_status_check check(status in ('draft','new','needs_info','active','completed'));
alter table public.work_requests add column priority text not null default 'normal' check(priority in ('normal','urgent'));
alter table public.work_requests add column requested_due_at timestamptz;
alter table public.work_requests add column received_at timestamptz;
alter table public.work_parts add column priority text not null default 'normal' check(priority in ('normal','urgent'));
alter table public.work_deliveries add column received_at timestamptz;
alter table public.work_deliveries add column released_at timestamptz;
alter table public.work_deliveries add column released_by uuid references auth.users on delete set null;
-- Existing deliveries already went to the client under the previous workflow
update public.work_deliveries set released_at=created_at;
alter table public.work_notifications alter column request_id drop not null;
alter table public.work_notifications add column event_key text;
create unique index work_notification_event on public.work_notifications(recipient,event_key) where event_key is not null;

-- Unsubmitted attachments remain private to the client
create or replace function provision_private.work_read(r uuid) returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(select 1 from public.work_requests w where w.id=r and
 (w.client_id=auth.uid() or (w.status<>'draft' and (provision_private.work_manager() or provision_private.work_coordinator() or exists(select 1 from public.work_parts p where p.request_id=r and p.assignee_id=auth.uid())))))
$$;

-- New department deliveries reach the client only after coordinator release
create or replace function provision_private.work_file_read(path text) returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and (
 exists(select 1 from public.work_attachments a where a.object_path=path and provision_private.work_read(a.request_id)) or
 exists(select 1 from public.work_deliveries d where d.object_path=path and
 ((provision_private.work_role()='client' and d.released_at is not null and exists(select 1 from public.work_requests r where r.id=d.request_id and r.client_id=auth.uid())) or
 (provision_private.work_role()<>'client' and (provision_private.work_part_read(d.part_id) or (d.status='approved' and exists(select 1 from public.work_dependencies dep join public.work_parts p on p.id=dep.part_id where dep.upstream_id=d.part_id and dep.status='accepted' and p.assignee_id=auth.uid())))))))
$$;
create or replace function provision_private.work_notify(who uuid,r uuid,msg text) returns void language plpgsql security definer set search_path='' as $$
declare marker text; is_test boolean;
begin
 if exists(select 1 from public.work_requests where id=r and status='draft') then return; end if;
 is_test=case when r is null then exists(select 1 from auth.users where id=coalesce(who,auth.uid()) and raw_app_meta_data->>'portal_qa'='true') else coalesce((select test from public.work_requests where id=r),false) end;
 marker=txid_current()::text||':'||coalesce(r::text,'account')||':'||md5(msg);
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select u.id,r,msg,case when u.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,marker
 from auth.users u where (u.id=who or u.raw_app_meta_data->>'role' in ('admin','super_admin'))
 and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<now())
 and (not is_test or u.raw_app_meta_data->>'portal_qa'='true')
 on conflict(recipient,event_key) where event_key is not null do nothing;
end; $$;
revoke all on function provision_private.work_notify(uuid,uuid,text) from public,anon,authenticated;

-- Ensure even events without a direct message reach administration and intake
create function provision_private.work_event_broadcast() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.work_requests; label text; prefix text;
begin
 select * into r from public.work_requests where id=new.request_id;
 if r.status='draft' then return null; end if;
 label=case new.kind when 'create' then 'طلب جديد' when 'submit_request' then 'طلب جديد' when 'intake' then 'استلام مسؤول التواصل'
 when 'assign' then 'إحالة مهمة' when 'accept' then 'استلام الموظف للمهمة' when 'deliver' then 'تسليم جديد'
 when 'review' then 'مراجعة العميل للتسليم' when 'attach' then 'مرفق جديد' when 'request_info' then 'طلب بيانات إضافية'
 when 'supply_info' then 'استكمال بيانات الطلب' when 'resolve' then 'قرار الإدارة' else 'تحديث على الطلب' end;
 prefix=txid_current()::text||':'||r.id::text||':';
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select u.id,r.id,label||E'\n'||r.title,case when u.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,prefix||'event'
 from auth.users u where (u.raw_app_meta_data->>'role' in ('admin','super_admin') or exists(select 1 from public.work_staff s where s.user_id=u.id and s.coordinator))
 and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<now())
 and (not r.test or u.raw_app_meta_data->>'portal_qa'='true')
 and not exists(select 1 from public.work_notifications n where n.recipient=u.id and n.event_key like prefix||'%')
 on conflict(recipient,event_key) where event_key is not null do nothing;
 return null;
end; $$;
revoke all on function provision_private.work_event_broadcast() from public,anon,authenticated;
create trigger work_event_broadcast after insert on public.work_events for each row execute function provision_private.work_event_broadcast();

create function public.client_board(p_filter text default 'all',p_search text default '',p_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare items jsonb; counts jsonb;
begin
 if provision_private.work_role() is distinct from 'client' then raise exception 'forbidden'; end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into items from (
 select r.id,r.number,r.title,r.status,r.priority,r.requested_due_at,r.received_at,r.created_at,r.version,
 exists(select 1 from public.work_deliveries d join public.work_parts a on a.id=d.part_id where d.request_id=r.id and d.status='pending' and d.released_at is not null and a.status='review') as ready
 from public.work_requests r where r.client_id=auth.uid()
 and (r.title ilike '%'||left(p_search,100)||'%' or r.number::text=trim(p_search))
 and (p_filter='all' or (p_filter='intake' and r.status='new') or (p_filter='working' and r.status in ('active','needs_info'))
 or (p_filter='completed' and r.status='completed') or (p_filter='urgent' and r.priority='urgent' and r.status<>'completed')
 or (p_filter='ready' and exists(select 1 from public.work_deliveries d join public.work_parts a on a.id=d.part_id where d.request_id=r.id and d.status='pending' and d.released_at is not null and a.status='review')))
 order by case when r.status='needs_info' then 0 when r.status='draft' then 1 else 2 end,r.created_at desc
 limit 20 offset least(greatest(coalesce(p_page,0),0),100000)*20) x;
 select jsonb_build_object('all',count(*),'intake',count(*) filter(where status='new'),'working',count(*) filter(where status in ('active','needs_info')),
 'completed',count(*) filter(where status='completed'),'ready',count(*) filter(where exists(select 1 from public.work_deliveries d join public.work_parts a on a.id=d.part_id where d.request_id=r.id and d.status='pending' and d.released_at is not null and a.status='review')))
 into counts from public.work_requests r where client_id=auth.uid();
 return jsonb_build_object('items',items,'counts',counts);
end; $$;
revoke all on function public.client_board(text,text,integer) from public,anon;
grant execute on function public.client_board(text,text,integer) to authenticated;

-- Include urgency and the client deadline in the existing compact team board
do $$ declare body text; begin
 body=pg_get_functiondef('public.work_board(text,text,integer)'::regprocedure);
 body=replace(body,'r.version,r.created_at','r.version,r.created_at,r.priority,r.requested_due_at');
 body=replace(body,'p.assignee_id=auth.uid() or provision_private.work_manager()','p.assignee_id=auth.uid() or provision_private.work_manager() or provision_private.work_coordinator()');
 execute body;
end $$;

-- Staff cannot upload into an unsubmitted client draft
do $$ declare body text; begin
 body=pg_get_functiondef('provision_private.work_upload(text)'::regprocedure);
 body=replace(body,$old$r.status<>'completed' and (r.client_id$old$, $new$r.status<>'completed' and (r.status<>'draft' or r.client_id=auth.uid()) and (r.client_id$new$);
 execute body;
end $$;


create or replace function public.work_action(action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare audit_id bigint; r public.work_requests; a public.work_parts; b public.work_parts; d public.work_deliveries; dep public.work_dependencies; e public.work_escalations;
 rid uuid; aid uuid; target uuid; sid uuid; why text=trim(coalesce(p->>'reason','')); result_id uuid; due timestamptz; u record; event_name text=action; note text=''; external boolean=false;
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 if octet_length(p::text)>50000 then raise exception 'invalid_input'; end if;
 if action='read_notification' then
  update public.work_notifications set read_at=now() where id=(p->>'id')::uuid and recipient=auth.uid(); return '{}';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.work_events where actor=auth.uid() and created_at>now()-interval '1 minute')>=120 then raise exception 'work_rate_limit'; end if;
 if action='create' then
  target=auth.uid();
  if provision_private.work_manager() or provision_private.work_coordinator() then target=(p->>'client_id')::uuid; end if;
  if not exists(select 1 from auth.users where id=target and raw_app_meta_data->>'role'='client') then raise exception 'invalid_client'; end if;
  sid=(p->>'service_id')::uuid;
  if provision_private.work_role()<>'client' and not exists(select 1 from public.work_services where id=sid and active) then raise exception 'invalid_service'; end if;
  if provision_private.work_manager() and not provision_private.work_manage(sid) then raise exception 'forbidden'; end if;
  if provision_private.work_role()='client' then
   sid=null;
   if (select count(*) from public.work_requests where client_id=auth.uid() and created_at>now()-interval '1 minute')>=5 then raise exception 'work_rate_limit'; end if;
   if (p->>'requested_due_at')::timestamptz is null or (p->>'requested_due_at')::timestamptz<=now() then raise exception 'invalid_due'; end if;
  end if;
  insert into public.work_requests(id,client_id,title,brief,service_id,specifications,test,priority,requested_due_at,status) values(coalesce((p->>'submission_key')::uuid,gen_random_uuid()),target,trim(p->>'title'),trim(p->>'brief'),sid,coalesce(p->'specifications','{}'),exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'portal_qa'='true'),coalesce(p->>'priority','normal'),(p->>'requested_due_at')::timestamptz,case when provision_private.work_role()='client' then 'draft' else 'new' end) on conflict(id) do nothing returning * into r;
  if r.id is null then
   select * into r from public.work_requests where id=(p->>'submission_key')::uuid;
   if r.client_id is distinct from target or r.title is distinct from trim(p->>'title') or r.brief is distinct from trim(p->>'brief') or r.service_id is distinct from sid or r.specifications is distinct from coalesce(p->'specifications','{}'::jsonb) or r.priority is distinct from coalesce(p->>'priority','normal') or r.requested_due_at is distinct from (p->>'requested_due_at')::timestamptz then raise exception 'submission_conflict'; end if;
   return jsonb_build_object('request_id',r.id);
  end if;
  if r.status='draft' then return jsonb_build_object('request_id',r.id); end if;
  for u in select id from auth.users where raw_app_meta_data->>'role' in ('admin','super_admin') or id in(select user_id from public.work_staff where coordinator) loop
   perform provision_private.work_notify(u.id,r.id,'طلب جديد يحتاج مراجعة فريق التواصل' || E'\n' || r.title);
  end loop;
  external=true;
 else
  rid=(p->>'request_id')::uuid;
  select * into r from public.work_requests where id=rid for update;
  if r.id is null or not provision_private.work_read(r.id) then raise exception 'forbidden' using errcode='42501'; end if;
  if (p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;
  if r.status='completed' then raise exception 'invalid_state'; end if;
  if p ? 'part_id' then select * into a from public.work_parts where id=(p->>'part_id')::uuid and request_id=r.id for update;
   if a.id is null then raise exception 'invalid_part'; end if;
  end if;
  if r.status='draft' and action not in ('submit_request','attach') then raise exception 'invalid_state'; end if;
  if action='submit_request' then
   if r.client_id<>auth.uid() or provision_private.work_role()<>'client' or r.status<>'draft' then raise exception 'forbidden'; end if;
   due=(p->>'requested_due_at')::timestamptz;
   if due is null or due<=now() then raise exception 'invalid_due'; end if;
   update public.work_requests set status='new',brief=trim(p->>'brief'),title=left(trim(p->>'brief'),100),priority=p->>'priority',requested_due_at=due where id=r.id returning * into r;
   for u in select user_id as id from public.work_staff where coordinator loop
    perform provision_private.work_notify(u.id,r.id,'طلب جديد لدى مسؤول التواصل' || E'\n' || r.title);
   end loop;
   perform provision_private.work_notify(null,r.id,'طلب جديد لدى مسؤول التواصل' || E'\n' || r.title);
   external=true;
  elsif action='intake' then
   sid=coalesce((p->>'service_id')::uuid,r.service_id);
   if not(provision_private.work_coordinator() or provision_private.work_manage(sid)) or r.status not in ('new','needs_info') then raise exception 'forbidden'; end if;
   if not exists(select 1 from public.work_services where id=sid and active) then raise exception 'invalid_service'; end if;
   update public.work_requests set status='active',service_id=sid,coordinator_id=auth.uid() where id=r.id;
   perform provision_private.work_notify(r.client_id,r.id,'تم استلام المهمة من قبل فريق التواصل' || E'\n' || r.title); external=true;
  elsif action='request_info' then
   if not(provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) or length(why)<3 then raise exception 'forbidden'; end if;
   update public.work_requests set status='needs_info' where id=r.id;
   perform provision_private.work_notify(r.client_id,r.id,'نحتاج بيانات إضافية لطلبك' || E'\n' || why); note=why; external=true;
  elsif action='supply_info' then
   if r.client_id=auth.uid() and r.status<>'needs_info' and not exists(select 1 from public.work_parts where request_id=r.id and status='needs_info') then raise exception 'invalid_state'; end if;
   if not(r.client_id=auth.uid() or provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) or length(why)<3 then raise exception 'forbidden'; end if;
   update public.work_requests set brief=brief||E'\n'||why,status=case when coordinator_id is null then 'new' else 'active' end where id=r.id;
   for b in update public.work_parts set status='offered' where request_id=r.id and status='needs_info' returning * loop
    perform provision_private.work_notify(b.assignee_id,r.id,'اكتملت البيانات المطلوبة يرجى استلام المهمة');
   end loop;
   perform provision_private.work_notify(r.coordinator_id,r.id,'تم استكمال بيانات الطلب'); note=why; external=true;
  elsif action='assign' then
   sid=(p->>'service_id')::uuid; target=(p->>'assignee_id')::uuid;
   if r.status<>'active' or not(provision_private.work_coordinator() or provision_private.work_manage(sid)) then raise exception 'forbidden'; end if;
   perform 1 from public.work_staff where user_id=target for update;
   if not found or not exists(select 1 from auth.users where id=target and raw_app_meta_data->>'role' in ('employee','admin','super_admin') and (banned_until is null or banned_until<now()) and coalesce(raw_app_meta_data->>'must_change_password','false')<>'true') or not exists(select 1 from public.work_memberships where user_id=target and service_id=sid) then raise exception 'invalid_assignment'; end if;
   insert into public.work_parts(request_id,service_id,assignee_id,scope,priority) values(r.id,sid,target,trim(p->>'scope'),coalesce(p->>'priority',r.priority)) returning * into a;
   perform provision_private.work_notify(target,r.id,'أحيلت إليك مهمة جديدة يرجى الاستلام وتحديد موعد التسليم' || E'\n' || a.scope || E'\nحالة المهمة ' || case when a.priority='urgent' then 'مستعجل' else 'عادي' end);
   if (select count(*) from public.work_parts where assignee_id=target and status<>'approved')>(select capacity from public.work_staff where user_id=target) then
    perform provision_private.work_alert(r.id,a.id,'overload','ضغط عمل مرتفع على الموظف المكلف بهذه المهمة يرجى اتخاذ إجراء');
   end if;
   external=true;
  elsif action in ('accept','missing','reject','scope','routing','dependency','deliver') then
   if a.id is null or a.assignee_id<>auth.uid() then raise exception 'forbidden' using errcode='42501'; end if;
   if action='accept' then
    if a.status<>'offered' then raise exception 'invalid_state'; end if;
    due=(p->>'due_at')::timestamptz;
    if due is null or due<=now() then raise exception 'invalid_due'; end if;
    update public.work_parts set status=case when exists(select 1 from public.work_dependencies x join public.work_parts y on y.id=x.upstream_id where x.part_id=a.id and x.status<>'waived' and (x.status<>'accepted' or y.status<>'approved')) then 'waiting' else 'working' end,due_at=due,accepted_at=now() where id=a.id;
    perform provision_private.work_notify(r.coordinator_id,r.id,'تم استلام المهمة وتحديد موعد التسليم');
    perform provision_private.work_notify(r.client_id,r.id,case when exists(select 1 from public.work_deliveries where part_id=a.id and status='changes') then 'تم استلام التعديلات وجار تنفيذها' else 'تم استلام المهمة وجار تنفيذها' end); external=true;
   elsif action='missing' then
    if a.status not in ('offered','working') or length(why)<3 then raise exception 'invalid_state'; end if;
    update public.work_parts set status='needs_info' where id=a.id;
    perform provision_private.work_notify(r.coordinator_id,r.id,'المهمة تحتاج استكمال بيانات' || E'\n' || why); note=why;
   elsif action in ('reject','scope','routing') then
    if length(why)<3 or (action='scope' and a.status<>'revision') or (action in ('reject','routing') and a.status not in ('offered','working','waiting')) then raise exception 'invalid_state'; end if;
    update public.work_parts set status='escalated' where id=a.id;
    perform provision_private.work_alert(r.id,a.id,case when action='reject' then 'rejection' else action end,why); note=why;
   elsif action='dependency' then
    if a.status not in ('working','waiting') or length(why)<3 then raise exception 'invalid_state'; end if;
    select * into b from public.work_parts where id=(p->>'upstream_id')::uuid and request_id=r.id;
    if b.id is null or b.id=a.id then raise exception 'invalid_dependency'; end if;
    if exists(with recursive chain(id) as (select b.id union select x.upstream_id from public.work_dependencies x join chain c on x.part_id=c.id where x.status<>'waived') select 1 from chain where id=a.id) then raise exception 'dependency_cycle'; end if;
    insert into public.work_dependencies(request_id,part_id,upstream_id,reason) values(r.id,a.id,b.id,why);
    update public.work_parts set status='waiting' where id=a.id;
    perform provision_private.work_notify(b.assignee_id,r.id,'قسم آخر يحتاج مخرجاتك قبل بدء العمل' || E'\n' || why); note=why;
   elsif action='deliver' then
    if a.status not in ('working','revision') or exists(select 1 from public.work_dependencies x join public.work_parts y on y.id=x.upstream_id where x.part_id=a.id and x.status<>'waived' and (x.status<>'accepted' or y.status<>'approved')) then raise exception 'dependency_pending'; end if;
    if not exists(select 1 from storage.objects where bucket_id='work-files' and name=p->>'object_path' and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]=a.id::text) then raise exception 'invalid_file'; end if;
    insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,note) values(r.id,a.id,auth.uid(),p->>'object_path',p->>'filename',left(coalesce(p->>'note',''),4000)) returning id into result_id;
    update public.work_parts set status='review' where id=a.id;
    perform provision_private.work_notify(r.coordinator_id,r.id,'سلم القسم المطلوب حدد الإحالة لقسم آخر أو إرسال التسليم للعميل' || E'\n' || r.title); external=true;
   end if;
  elsif action='dependency_reply' then
   select * into dep from public.work_dependencies where id=(p->>'dependency_id')::uuid and request_id=r.id for update;
   select * into b from public.work_parts where id=dep.upstream_id;
   if dep.id is null or dep.status<>'pending' or b.assignee_id<>auth.uid() then raise exception 'forbidden'; end if;
   if p->>'decision'='accept' then
    update public.work_dependencies set status='accepted' where id=dep.id;
   elsif p->>'decision'='reject' and length(why)>=3 then
    update public.work_dependencies set status='rejected' where id=dep.id;
    perform provision_private.work_alert(r.id,dep.part_id,'dependency',why,dep.id);
   else raise exception 'invalid_decision'; end if;
   select * into a from public.work_parts where id=dep.part_id;
   perform provision_private.work_notify(a.assignee_id,r.id,'ورد رد على طلب الاعتماد بين الأقسام'); note=why;
  elsif action='resolve' then
   select * into e from public.work_escalations where id=(p->>'escalation_id')::uuid and request_id=r.id for update;
   select * into a from public.work_parts where id=e.part_id;
   if e.id is null or e.status<>'open' or not provision_private.work_manage(coalesce(a.service_id,r.service_id)) or length(why)<3 then raise exception 'forbidden'; end if;
   if e.kind in ('scope','rejection','routing') and a.status<>'escalated' then raise exception 'invalid_state'; end if;
   if e.kind='dependency' and p->>'decision' not in ('enforce_dependency','waive_dependency') then raise exception 'invalid_decision'; end if;
   if p->>'decision'='reassign' then
    if a.status in ('approved','review') then raise exception 'invalid_state'; end if;
    target=(p->>'assignee_id')::uuid;
    sid=coalesce((p->>'service_id')::uuid,a.service_id);
    if not provision_private.work_manage(sid) then raise exception 'forbidden'; end if;
    perform 1 from public.work_staff where user_id=target for update;
    if not found or target=a.assignee_id or not exists(select 1 from auth.users where id=target and raw_app_meta_data->>'role' in ('employee','admin','super_admin') and (banned_until is null or banned_until<now()) and coalesce(raw_app_meta_data->>'must_change_password','false')<>'true') or not exists(select 1 from public.work_memberships where user_id=target and service_id=sid) then raise exception 'invalid_assignment'; end if;
    update public.work_escalations set status='resolved',resolution=why,resolved_by=auth.uid(),resolved_at=now() where part_id=a.id and status='open' and kind<>'dependency';
    update public.work_parts set assignee_id=target,service_id=sid,priority=coalesce(p->>'priority',a.priority),status='offered',accepted_at=null,due_at=null where id=a.id;
    perform provision_private.work_notify(a.assignee_id,r.id,'تم نقل المهمة إلى موظف آخر بقرار الإدارة');
    perform provision_private.work_notify(target,r.id,'أحيلت إليك مهمة بقرار الإدارة يرجى الاستلام وتحديد الموعد');
    if (select count(*) from public.work_parts where assignee_id=target and status<>'approved')>(select capacity from public.work_staff where user_id=target) then
     perform provision_private.work_alert(r.id,a.id,'overload','ضغط عمل مرتفع بعد إعادة توزيع المهمة');
    end if;
   elsif e.kind='dependency' and p->>'decision' in ('enforce_dependency','waive_dependency') then
    update public.work_dependencies set status=case when p->>'decision'='enforce_dependency' then 'accepted' else 'waived' end where id=e.dependency_id returning * into dep;
    select * into b from public.work_parts where id=dep.upstream_id;
    perform provision_private.work_notify(b.assignee_id,r.id,'اتخذت الإدارة قرارا بشأن اعتماد القسم على مخرجاتك' || E'\n' || why);
   elsif p->>'decision'='keep' and e.kind<>'dependency' then
    if e.kind<>'overload' then
     due=coalesce((p->>'due_at')::timestamptz,a.due_at);
     if due is null or due<=now() then raise exception 'invalid_due'; end if;
     update public.work_parts set status=case when e.kind='scope' then 'revision' else 'working' end,accepted_at=coalesce(accepted_at,now()),due_at=due where id=a.id;
    end if;
   else raise exception 'invalid_decision'; end if;
   update public.work_escalations set status='resolved',resolution=why,resolved_by=auth.uid(),resolved_at=now() where id=e.id;
   perform provision_private.work_notify(a.assignee_id,r.id,'صدر قرار الإدارة بشأن المهمة' || E'\n' || why); note=why;
  elsif action='release_delivery' then
   select * into d from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id for update;
   select * into a from public.work_parts where id=d.part_id;
   if d.id is null or not(provision_private.work_coordinator() or provision_private.work_manage(a.service_id)) then raise exception 'forbidden'; end if;
   if d.status<>'pending' or a.status<>'review' or d.released_at is not null then raise exception 'invalid_state'; end if;
   update public.work_deliveries set released_at=now(),released_by=auth.uid() where id=d.id;
   perform provision_private.work_notify(r.client_id,r.id,'طلبك في انتظار مراجعتك يمكنك اعتماد التسليم أو طلب تعديل' || E'\n' || r.title);
   external=true;
  elsif action='review' then
   if r.client_id<>auth.uid() then raise exception 'forbidden'; end if;
   select * into d from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id for update;
   select * into a from public.work_parts where id=d.part_id;
   if d.id is null or d.status<>'pending' or a.status<>'review' or d.released_at is null then raise exception 'invalid_state'; end if;
   if p->>'decision'='approve' then
    update public.work_deliveries set status='approved',received_at=now() where id=d.id;
    update public.work_parts set status='approved' where id=a.id;
    perform provision_private.work_notify(a.assignee_id,r.id,'اعتمد العميل تسليمك');
   elsif p->>'decision'='changes' and length(why)>=3 then
    update public.work_deliveries set status='changes',feedback=why,annotation=coalesce(p->'annotation','{}') where id=d.id;
    update public.work_parts set status='revision' where id=a.id;
    perform provision_private.work_notify(a.assignee_id,r.id,'العميل طلب تعديلات على التسليم وهي قيد التنفيذ لديك' || E'\n' || why);
    perform provision_private.work_notify(r.client_id,r.id,'تم استلام التعديلات وجار تنفيذها');
   else raise exception 'invalid_decision'; end if;
   note=why; external=true;
  elsif action='attach' then
   if r.client_id<>auth.uid() and not(provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) then raise exception 'forbidden'; end if;
   if not exists(select 1 from storage.objects where bucket_id='work-files' and name=p->>'object_path' and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]='brief') then raise exception 'invalid_file'; end if;
   insert into public.work_attachments(request_id,uploaded_by,object_path,filename) values(r.id,auth.uid(),p->>'object_path',p->>'filename'); external=true;
  else raise exception 'invalid_action'; end if;
 end if;
 update public.work_parts x set status='waiting' where x.request_id=r.id and x.status='working' and exists(select 1 from public.work_dependencies y join public.work_parts z on z.id=y.upstream_id where y.part_id=x.id and y.status<>'waived' and (y.status<>'accepted' or z.status<>'approved'));
 -- Dependency release is gated by client approval of every required upstream output
 for b in update public.work_parts x set status='working' where x.request_id=r.id and x.status='waiting' and not exists(
 select 1 from public.work_dependencies y join public.work_parts z on z.id=y.upstream_id where y.part_id=x.id and y.status<>'waived' and (y.status<>'accepted' or z.status<>'approved')) returning x.* loop
  perform provision_private.work_notify(b.assignee_id,r.id,'اعتمدت المخرجات المطلوبة ويمكنك بدء تنفيذ الجزء الخاص بك');
 end loop;
 update public.work_requests set version=version+1,updated_at=now(),status=case when exists(select 1 from public.work_parts where request_id=r.id) and not exists(select 1 from public.work_parts where request_id=r.id and status<>'approved') and not exists(select 1 from public.work_escalations where request_id=r.id and status='open') then 'completed' else status end where id=r.id;
 update public.work_requests set received_at=coalesce(received_at,now()) where id=r.id and status='completed';
 insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),event_name,note,external) returning id into audit_id;
 if a.id is not null then insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after) select audit_id,case when action='assign' then null else a.assignee_id end,x.assignee_id,case when action='assign' then null else a.status end,x.status from public.work_parts x where x.id=a.id; end if;
 return jsonb_build_object('request_id',r.id,'part_id',a.id,'delivery_id',result_id);
end; $$;


-- OTP secrets are server-only and each proof is bound to one account and session
create table provision_private.client_phone_limits(
 user_id uuid primary key references auth.users on delete cascade,
 window_at timestamptz not null default now(), sends integer not null default 0,
 last_sent_at timestamptz not null default '-infinity'
);
create table provision_private.client_phone_proofs(
 id uuid primary key, user_id uuid not null references auth.users on delete cascade,
 session_id uuid not null, phone text not null check(phone ~ '^\+[1-9][0-9]{7,14}$'),
 code_hash text not null, attempts integer not null default 0,
 expires_at timestamptz not null default now()+interval '5 minutes',
 verified_at timestamptz, consumed_at timestamptz, created_at timestamptz not null default now()
);
create index client_phone_proofs_user on provision_private.client_phone_proofs(user_id,created_at desc);
alter table provision_private.client_phone_limits enable row level security;
alter table provision_private.client_phone_proofs enable row level security;
revoke all on provision_private.client_phone_limits,provision_private.client_phone_proofs from public,anon,authenticated;
create function public.client_phone_start(p_user uuid,p_session uuid,p_id uuid,p_phone text,p_hash text) returns text language plpgsql security definer set search_path='' as $$
declare limits provision_private.client_phone_limits;
begin
 if not exists(select 1 from auth.users u join auth.sessions s on s.user_id=u.id where u.id=p_user and s.id=p_session
 and u.raw_app_meta_data->>'role'='client' and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true'
 and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<now())) then return 'forbidden'; end if;
 insert into provision_private.client_phone_limits(user_id) values(p_user) on conflict do nothing;
 select * into limits from provision_private.client_phone_limits where user_id=p_user for update;
 if limits.last_sent_at>now()-interval '60 seconds' or (limits.window_at>now()-interval '1 hour' and limits.sends>=5) then return 'rate_limit'; end if;
 if exists(select 1 from auth.users where id<>p_user and phone=ltrim(p_phone,'+')) then return 'unavailable'; end if;
 update provision_private.client_phone_limits set last_sent_at=now(),window_at=case when window_at<now()-interval '1 hour' then now() else window_at end,
 sends=case when window_at<now()-interval '1 hour' then 1 else sends+1 end where user_id=p_user;
 -- Invalidate previous codes including codes from another session
 update provision_private.client_phone_proofs set expires_at=now() where user_id=p_user and consumed_at is null;
 insert into provision_private.client_phone_proofs(id,user_id,session_id,phone,code_hash) values(p_id,p_user,p_session,p_phone,p_hash);
 delete from provision_private.client_phone_proofs where user_id=p_user and created_at<now()-interval '1 day';
 return 'ready';
end; $$;
create function public.client_phone_verify(p_user uuid,p_session uuid,p_id uuid,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare proof provision_private.client_phone_proofs;
begin
 select * into proof from provision_private.client_phone_proofs where id=p_id and user_id=p_user and session_id=p_session for update;
 if proof.id is null or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user) then return jsonb_build_object('status','invalid'); end if;
 if proof.consumed_at is not null then return jsonb_build_object('status','complete'); end if;
 if proof.expires_at<=now() or proof.attempts>=5 then return jsonb_build_object('status','expired'); end if;
 if proof.code_hash<>p_hash then
  update provision_private.client_phone_proofs set attempts=attempts+1 where id=p_id;
  return jsonb_build_object('status','invalid');
 end if;
 update provision_private.client_phone_proofs set verified_at=coalesce(verified_at,now()) where id=p_id;
 return jsonb_build_object('status','verified','phone',proof.phone);
end; $$;
revoke all on function public.client_phone_start(uuid,uuid,uuid,text,text),public.client_phone_verify(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.client_phone_start(uuid,uuid,uuid,text,text),public.client_phone_verify(uuid,uuid,uuid,text) to service_role;

create unique index audit_client_contact_request on provision_private.audit((details->>'request_id')) where action in ('client_phone_updated','client_email_updated');
create index audit_client_profile_actor on provision_private.audit(actor,created_at desc) where action='profile_update';
create function provision_private.authorize_client_contact_edit() returns trigger language plpgsql security definer set search_path='' as $$
declare receipt jsonb; actor_id uuid; request_id uuid; proof provision_private.client_phone_proofs;
begin
 receipt=new.raw_app_meta_data->'client_contact_edit';
 if receipt is not distinct from old.raw_app_meta_data->'client_contact_edit' then return new; end if;
 if old.raw_app_meta_data->>'role' is distinct from 'client' or new.raw_app_meta_data->>'role' is distinct from 'client' then raise exception 'client_contact_forbidden'; end if;
 actor_id=(receipt->>'actor_id')::uuid; request_id=(receipt->>'request_id')::uuid;
 if actor_id is null or request_id is null or exists(select 1 from provision_private.audit where action in ('client_phone_updated','client_email_updated') and details->>'request_id'=request_id::text) then raise exception 'client_contact_forbidden'; end if;
 perform 1 from auth.users u where u.id=actor_id and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<now())
 and coalesce(u.raw_app_meta_data->>'must_change_password','false')<>'true'
 and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id=(receipt->>'session_id')::uuid)
 and ((receipt->>'kind'='email' and u.raw_app_meta_data->>'role'='super_admin') or (receipt->>'kind'='phone' and u.id=new.id and u.raw_app_meta_data->>'role'='client')) for share;
 if not found then raise exception 'client_contact_forbidden'; end if;
 if receipt->>'kind'='phone' then
  select * into proof from provision_private.client_phone_proofs where id=(receipt->>'proof_id')::uuid and user_id=new.id and session_id=(receipt->>'session_id')::uuid for update;
  if proof.id is null or proof.verified_at is null or proof.consumed_at is not null or proof.expires_at<=now() or proof.phone is distinct from ('+'||ltrim(new.phone,'+')) then raise exception 'client_phone_unverified'; end if;
 end if;
 perform set_config('provision.client_contact_edit',jsonb_build_object('user_id',new.id,'receipt',receipt)::text,true);
 return new;
end; $$;
create trigger client_contact_authorization before update of raw_app_meta_data on auth.users for each row execute function provision_private.authorize_client_contact_edit();

create function provision_private.commit_client_contact_edit() returns trigger language plpgsql security definer set search_path='' as $$
declare context jsonb; receipt jsonb; target auth.users%rowtype; actor_id uuid; event text;
begin
 if old.raw_app_meta_data->>'role' is distinct from 'client' then return null; end if;
 context=nullif(current_setting('provision.client_contact_edit',true),'')::jsonb;
 select * into target from auth.users where id=new.id;
 receipt=target.raw_app_meta_data->'client_contact_edit';
 if context is null or context->>'user_id' is distinct from new.id::text or context->'receipt' is distinct from receipt or target.raw_app_meta_data->>'role' is distinct from 'client' then raise exception 'client_contact_forbidden'; end if;
 if receipt->>'kind'='phone' and (old.email is distinct from target.email or (nullif(target.email_change,'') is not null and old.email_change is distinct from target.email_change)) then raise exception 'client_email_owner_only'; end if;
 if receipt->>'kind'='email' and (old.phone is distinct from target.phone or (nullif(target.phone_change,'') is not null and old.phone_change is distinct from target.phone_change)) then raise exception 'client_phone_unverified'; end if;
 if current_setting('provision.client_contact_committed',true)=context::text then return null; end if;
 actor_id=(receipt->>'actor_id')::uuid;
 if receipt->>'kind'='phone' then
  update provision_private.client_phone_proofs set consumed_at=now(),code_hash='' where id=(receipt->>'proof_id')::uuid and user_id=target.id and consumed_at is null and expires_at>now() and phone='+'||ltrim(target.phone,'+');
  if not found then raise exception 'client_phone_unverified'; end if;
  insert into public.account_profiles(user_id,display_name,phone,updated_by) values(target.id,coalesce(target.raw_user_meta_data->>'display_name',''),'+'||ltrim(target.phone,'+'),actor_id)
  on conflict(user_id) do update set phone=excluded.phone,updated_by=excluded.updated_by,updated_at=now();
  event='client_phone_updated';
 else event='client_email_updated'; end if;
 insert into provision_private.audit(actor,effective_user,action,details) values(actor_id,target.id,event,jsonb_build_object('request_id',receipt->>'request_id','user',target.id));
 perform provision_private.work_notify(target.id,null,(case when event='client_phone_updated' then 'تم اعتماد رقم جوال العميل بعد التحقق' else 'حدث السوبر أدمن البريد الإلكتروني للعميل' end)||E'\n'||coalesce((select display_name from public.account_profiles where user_id=target.id),target.email));
 perform set_config('provision.client_contact_committed',context::text,true);
 return null;
end; $$;
create constraint trigger client_contact_commit after update on auth.users deferrable initially deferred for each row
when(old.email is distinct from new.email or old.phone is distinct from new.phone
 or (old.email_change is distinct from new.email_change and nullif(new.email_change,'') is not null)
 or (old.phone_change is distinct from new.phone_change and nullif(new.phone_change,'') is not null)
 or old.raw_app_meta_data->'client_contact_edit' is distinct from new.raw_app_meta_data->'client_contact_edit')
execute function provision_private.commit_client_contact_edit();
revoke all on function provision_private.authorize_client_contact_edit(),provision_private.commit_client_contact_edit() from public,anon,authenticated;

-- The legacy profile RPC must not bypass phone verification
create or replace function public.platform_update_profile(p_name text,p_phone text,p_session uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare target_id uuid; target_role text; phone text;
begin
 target_id=provision_private.effective_user(p_session);
 select raw_app_meta_data->>'role','+'||ltrim(coalesce(u.phone,''),'+') into target_role,phone from auth.users u where id=target_id for share;
 if target_role='employee' then raise exception 'employee_profile_owner_only' using errcode='42501'; end if;
 if target_role='client' and (target_id<>auth.uid() or p_session is not null or p_phone is distinct from phone) then raise exception 'client_phone_unverified'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 120 or p_phone is null or length(p_phone)>30 then raise exception 'invalid_profile'; end if;
 if target_role='client' then
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if exists(select 1 from public.account_profiles where user_id=target_id and display_name=trim(p_name)) then return; end if;
  if (select count(*) from provision_private.audit where actor=auth.uid() and action='profile_update' and created_at>now()-interval '1 minute')>=3 then raise exception 'work_rate_limit'; end if;
 end if;
 insert into public.account_profiles(user_id,display_name,phone,updated_by) values(target_id,trim(p_name),p_phone,auth.uid())
 on conflict(user_id) do update set display_name=excluded.display_name,phone=excluded.phone,updated_by=excluded.updated_by,updated_at=now();
 insert into provision_private.audit(actor,effective_user,action) values(auth.uid(),target_id,'profile_update');
 if target_role='client' then perform provision_private.work_notify(null,null,'حدث العميل اسم حسابه'||E'\n'||trim(p_name)); end if;
end; $$;
revoke all on function public.platform_update_profile(text,text,uuid) from public,anon;
grant execute on function public.platform_update_profile(text,text,uuid) to authenticated;
commit;
