begin;
create index work_events_actor_time on public.work_events(actor,created_at desc);
alter table provision_private.work_assignment_history enable row level security;
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
  if not exists(select 1 from public.work_services where id=sid and active) then raise exception 'invalid_service'; end if;
  if provision_private.work_manager() and not provision_private.work_manage(sid) then raise exception 'forbidden'; end if;
  insert into public.work_requests(id,client_id,title,brief,service_id,specifications,test) values(coalesce((p->>'submission_key')::uuid,gen_random_uuid()),target,trim(p->>'title'),trim(p->>'brief'),sid,coalesce(p->'specifications','{}'),exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'portal_qa'='true')) on conflict(id) do nothing returning * into r;
  if r.id is null then
   select * into r from public.work_requests where id=(p->>'submission_key')::uuid;
   if r.client_id is distinct from target or r.title is distinct from trim(p->>'title') or r.brief is distinct from trim(p->>'brief') or r.service_id is distinct from sid or r.specifications is distinct from coalesce(p->'specifications','{}'::jsonb) then raise exception 'submission_conflict'; end if;
   return jsonb_build_object('request_id',r.id);
  end if;
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
  if action='intake' then
   if not(provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) or r.status not in ('new','needs_info') then raise exception 'forbidden'; end if;
   update public.work_requests set status='active',coordinator_id=auth.uid() where id=r.id;
   perform provision_private.work_notify(r.client_id,r.id,'تم استلام المهمة من قبل فريق التواصل' || E'\n' || r.title); external=true;
  elsif action='request_info' then
   if not(provision_private.work_coordinator() or provision_private.work_manage(r.service_id)) or length(why)<3 then raise exception 'forbidden'; end if;
   update public.work_requests set status='needs_info' where id=r.id;
   perform provision_private.work_notify(r.client_id,r.id,'نحتاج بيانات إضافية لطلبك' || E'\n' || why); note=why; external=true;
  elsif action='supply_info' then
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
   insert into public.work_parts(request_id,service_id,assignee_id,scope) values(r.id,sid,target,trim(p->>'scope')) returning * into a;
   perform provision_private.work_notify(target,r.id,'أحيلت إليك مهمة جديدة يرجى الاستلام وتحديد موعد التسليم' || E'\n' || a.scope);
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
    perform provision_private.work_notify(r.client_id,r.id,'تم الانتهاء من تنفيذ جزء من طلبك يرجى مراجعة التسليم واعتماده أو توضيح التعديلات'); external=true;
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
    update public.work_parts set assignee_id=target,service_id=sid,status='offered',accepted_at=null,due_at=null where id=a.id;
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
  elsif action='review' then
   if r.client_id<>auth.uid() then raise exception 'forbidden'; end if;
   select * into d from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id for update;
   select * into a from public.work_parts where id=d.part_id;
   if d.id is null or d.status<>'pending' or a.status<>'review' then raise exception 'invalid_state'; end if;
   if p->>'decision'='approve' then
    update public.work_deliveries set status='approved' where id=d.id;
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
 insert into public.work_events(request_id,part_id,actor,kind,note,client_visible) values(r.id,a.id,auth.uid(),event_name,note,external) returning id into audit_id;
 if a.id is not null then insert into provision_private.work_assignment_history(event_id,previous_assignee,next_assignee,status_before,status_after) select audit_id,case when action='assign' then null else a.assignee_id end,x.assignee_id,case when action='assign' then null else a.status end,x.status from public.work_parts x where x.id=a.id; end if;
 return jsonb_build_object('request_id',r.id,'part_id',a.id,'delivery_id',result_id);
end; $$;



commit;
