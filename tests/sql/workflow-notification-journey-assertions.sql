-- Execute after the isolated fixture in workflow-notification-journey-matrix.sql
-- All accounts are QA accounts and the encompassing transaction must roll back
do $$
declare rid uuid=current_setting('qa.rid')::uuid; part uuid=current_setting('qa.part')::uuid;
 client_id uuid=(current_setting('qa.client_claims')::jsonb->>'sub')::uuid;
 designer uuid=(current_setting('qa.designer_claims')::jsonb->>'sub')::uuid;
 coordinator uuid=current_setting('qa.editor')::uuid;
 admin_id uuid=gen_random_uuid(); eid bigint; action_name text; outgoing text; expected integer; recovered bigint;
begin
 insert into auth.users(id,email,raw_app_meta_data) values(admin_id,admin_id||'@example.invalid','{"role":"admin","portal_qa":true}');
 update auth.users set raw_app_meta_data=raw_app_meta_data||'{"portal_qa":true}'::jsonb where id=coordinator;
 update public.work_requests set coordinator_id=coordinator where id=rid;
 update public.work_services set client_visible=false where id=(select service_id from public.work_parts where id=part);
 foreach action_name in array array[
 'create','submit_request','intake','request_info','supply_info','assign','accept',
 'missing','reject','routing','dependency','dependency_reply','deliver','scope','resolve',
 'release_dependencies','force_start','force_dependency_waived','release_delivery','review',
 'attach','handoff','due_approved','due_rejected','due_auto_approved','request_attachments',
 'decline_intake','intake_overdue','route_revision'] loop
  insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
  values(rid,part,designer,action_name,'QA_PRIVATE_INTERNAL_NOTE',false) returning id into eid;
  if (select count(*) from public.work_notifications where recipient=client_id and event_key='journey:event:'||eid||':client')<>(case when action_name in('routing','resolve') then 0 else 1 end) then raise exception 'QA client event audience %',action_name; end if;
  if (select count(*) from public.work_notifications where event_key='control:event:'||eid||':admin')<>2 then raise exception 'QA missing admin audience %',action_name; end if;
  expected=case when action_name in('dependency','handoff','force_dependency_waived','due_approved','due_auto_approved') then 0 else 1 end;
  if (select count(*) from public.work_notifications where recipient=coordinator and event_key='event:event:'||eid||':coordinator')<>expected then raise exception 'QA coordinator matrix %',action_name; end if;
  select message into outgoing from public.work_notifications where recipient=client_id and event_key='journey:event:'||eid||':client';
  if strpos(outgoing,chr(92)||'n')>0 then raise exception 'QA literal newline escape %',action_name; end if;
  if action_name not in('request_info','request_attachments','decline_intake') and outgoing like '%QA_PRIVATE_INTERNAL_NOTE%' then raise exception 'QA private note leaked %',action_name; end if;
  if action_name='deliver' and outgoing not like '%مسؤول التواصل للمراجعة%' then raise exception 'QA delivery misrepresented as client release'; end if;
  perform provision_private.work_ensure_event_notifications(eid);
  perform provision_private.work_ensure_event_notifications(eid);
  if (select count(*) from public.work_notifications where recipient=client_id and event_key='journey:event:'||eid||':client')<>(case when action_name in('routing','resolve') then 0 else 1 end) then raise exception 'QA duplicate event %',action_name; end if;
 end loop;
 delete from public.work_notifications where recipient=client_id and event_key='journey:event:'||eid||':client';
 perform provision_private.work_ensure_event_notifications(eid);
 if not exists(select 1 from public.work_notifications where recipient=client_id and event_key='journey:event:'||eid||':client') then raise exception 'QA event recovery failed'; end if;
 update public.work_deliveries set status='changes',feedback='QA requested change' where request_id=rid;
 insert into public.work_events(request_id,part_id,actor,kind,note) values(rid,part,designer,'deliver','QA_PRIVATE_INTERNAL_NOTE') returning id into eid;
 if provision_private.work_client_event_message(eid) not like '%التسليم بعد التعديل%' then raise exception 'QA revision delivery copy'; end if;
 insert into public.work_events(request_id,part_id,actor,kind,note) values(rid,part,designer,'accept','') returning id into eid;
 if provision_private.work_client_event_message(eid)<>'تم استلام التعديلات وجار تنفيذها' then raise exception 'QA revision acceptance copy'; end if;
 insert into public.work_events(request_id,part_id,actor,kind,note) values(rid,part,client_id,'review','') returning id into eid;
 if provision_private.work_client_event_message(eid) not like 'تم تسجيل اعتمادك%' then raise exception 'QA final approval copy'; end if;
end $$;
select 'PASS 29 event audience matrix hidden departments privacy idempotency recovery revision acceptance delivery and approval' result;
