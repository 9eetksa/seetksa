-- Execute after the candidate migration inside BEGIN and always ROLLBACK
-- All generated accounts and requests are QA only and cannot dispatch WhatsApp
do $$
declare config jsonb='{}'; label text; uid uuid; sid uuid=gen_random_uuid(); other_sid uuid=gen_random_uuid();
 rid uuid=gen_random_uuid(); other_rid uuid=gen_random_uuid(); part uuid=gen_random_uuid(); other_part uuid=gen_random_uuid(); source_part uuid=gen_random_uuid(); session_id uuid;
begin
 foreach label in array array['client','head','member','suspended','outsider','coordinator','admin','owner'] loop
  uid=gen_random_uuid();session_id=gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data) values(uid,uid||'@example.invalid',jsonb_build_object(
   'role',case label when 'client' then 'client' when 'admin' then 'admin' when 'owner' then 'super_admin' else 'employee' end,'portal_qa',true));
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session_id,uid,now(),now());
  config=config||jsonb_build_object(label,uid,label||'_claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',session_id));
 end loop;
 insert into public.work_services(id,name) values(sid,'QA head '||sid),(other_sid,'QA other '||other_sid);
 insert into public.work_staff(user_id,coordinator) select (config->>x)::uuid,x='coordinator' from unnest(array['head','member','suspended','outsider','coordinator'])x;
 insert into public.work_memberships(user_id,service_id,member_role) values
 ((config->>'head')::uuid,sid,'lead'),((config->>'member')::uuid,sid,'member'),((config->>'suspended')::uuid,sid,'member'),((config->>'outsider')::uuid,other_sid,'member');
 insert into provision_private.account_lifecycle(user_id,state,reason,changed_by)
 values((config->>'suspended')::uuid,'suspended','QA suspended team member',(config->>'owner')::uuid);
 insert into public.work_requests(id,client_id,service_id,title,brief,status,test,coordinator_id) values
 (rid,(config->>'client')::uuid,sid,'QA department inbox','QA isolated routing task scope','active',true,(config->>'coordinator')::uuid),
 (other_rid,(config->>'client')::uuid,other_sid,'QA other department','QA isolated unrelated department','active',true,(config->>'coordinator')::uuid);
 insert into public.work_parts(id,request_id,service_id,assignee_id,scope,status,route_position) values
 (part,rid,sid,(config->>'head')::uuid,'QA original scope stays unchanged','offered',1),
 (other_part,other_rid,other_sid,(config->>'outsider')::uuid,'QA outside department','offered',1),
 (source_part,rid,other_sid,(config->>'outsider')::uuid,'QA linked design source','review',2);
 insert into public.work_attachments(request_id,uploaded_by,object_path,filename) values(rid,(config->>'client')::uuid,rid||'/client/original.pdf','original.pdf');
 insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,note)
 values(rid,source_part,(config->>'outsider')::uuid,rid||'/'||source_part||'/source.png','source.png','QA source outputs');
 config=config||jsonb_build_object('sid',sid,'other_sid',other_sid,'rid',rid,'other_rid',other_rid,'part',part,'other_part',other_part);
 perform set_config('qa.department',config::text,true);
end $$;

set local role authenticated;
do $$
declare c jsonb=current_setting('qa.department')::jsonb; snapshot jsonb; board jsonb; rid uuid=(c->>'rid')::uuid;
 part uuid=(c->>'part')::uuid; version integer; blocked boolean; target uuid=(c->>'member')::uuid;
begin
 perform set_config('request.jwt.claims',(c->'head_claims')::text,true);
 board=public.work_workspace(0,'department','QA department');
 if jsonb_array_length(board->'requests')<>1 or not board->'lead_services' ? (c->>'sid') then raise exception 'QA head inbox missing'; end if;
 if jsonb_array_length(board->'staff')<>2 then raise exception 'QA directory leaked unrelated staff'; end if;
 snapshot=public.work_request_detail(rid,false);version=(snapshot->'request'->>'version')::integer;
 blocked=false;
 begin perform public.work_request_detail((c->>'other_rid')::uuid,false);
 exception when insufficient_privilege then blocked=true; end;
 if not blocked then raise exception 'QA head saw unrelated department request'; end if;
 blocked=false;
 begin perform public.work_action('delegate',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'assignee_id',c->>'outsider'));
 exception when others then if sqlerrm='invalid_assignment' then blocked=true; else raise; end if; end;
 if not blocked then raise exception 'QA delegate accepted outsider'; end if;
 blocked=false;
 begin perform public.work_action('delegate',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'assignee_id',c->>'suspended'));
 exception when others then if sqlerrm='invalid_assignment' then blocked=true; else raise; end if; end;
 if not blocked then raise exception 'QA delegate accepted suspended member'; end if;
 blocked=false;
 begin perform public.work_action('assign',jsonb_build_object('request_id',rid,'version',version,'service_id',c->>'sid','assignee_id',target,'scope','QA forbidden route'));
 exception when others then if sqlerrm='forbidden' then blocked=true; else raise; end if; end;
 if not blocked then raise exception 'QA head gained coordinator authority'; end if;
 perform public.work_action('delegate',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'assignee_id',target));
 snapshot=public.work_request_detail(rid,false);
 if snapshot->'parts'->0->>'assignee_id'<>target::text or snapshot->'parts'->0->>'status'<>'offered'
  or snapshot->'parts'->0->>'scope'<>'QA original scope stays unchanged' or jsonb_array_length(snapshot->'files')<>1
  or jsonb_array_length(snapshot->'deliveries')<>1 then raise exception 'QA delegate lost data or source files'; end if;
 blocked=false;
 begin perform public.work_action('delegate',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'assignee_id',c->>'head'));
 exception when others then if sqlerrm='version_conflict' then blocked=true; else raise; end if; end;
 if not blocked then raise exception 'QA stale delegate bypassed version'; end if;
 version=(snapshot->'request'->>'version')::integer;
 perform set_config('request.jwt.claims',(c->'member_claims')::text,true);
 blocked=false;
 begin perform public.work_action('delegate',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'assignee_id',c->>'head'));
 exception when insufficient_privilege then blocked=true; end;
 if not blocked then raise exception 'QA ordinary member gained distribution'; end if;
 perform public.work_action('accept',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'due_at',now()+interval '2 days'));
 perform set_config('request.jwt.claims',(c->'head_claims')::text,true);
 snapshot=public.work_request_detail(rid,false);version=(snapshot->'request'->>'version')::integer;
 if snapshot->'parts'->0->>'status'<>'working' then raise exception 'QA head lost live task access'; end if;
 blocked=false;
 begin perform public.work_action('delegate',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'assignee_id',c->>'head'));
 exception when others then if sqlerrm='invalid_state' then blocked=true; else raise; end if; end;
 if not blocked then raise exception 'QA accepted task reset by delegation'; end if;
end $$;
reset role;

-- A client revision retains the same department and can be distributed after coordinator routing
do $$
declare c jsonb=current_setting('qa.department')::jsonb; delivery_id uuid=gen_random_uuid();
begin
 update public.work_parts set status='review' where id=(c->>'part')::uuid;
 insert into public.work_deliveries(id,request_id,part_id,uploaded_by,object_path,filename,note,batch_id,released_at)
 values(delivery_id,(c->>'rid')::uuid,(c->>'part')::uuid,(c->>'member')::uuid,
  (c->>'rid')||'/'||(c->>'part')||'/revision.png','revision.png','QA prior delivery',gen_random_uuid(),now());
 perform set_config('qa.department_revision',delivery_id::text,true);
end $$;
set local role authenticated;
do $$
declare c jsonb=current_setting('qa.department')::jsonb; snapshot jsonb; rid uuid=(c->>'rid')::uuid; version integer;
begin
 perform set_config('request.jwt.claims',(c->'client_claims')::text,true);
 snapshot=public.work_request_detail(rid,false);version=(snapshot->'request'->>'version')::integer;
 perform public.work_action('review',jsonb_build_object('request_id',rid,'version',version,'delivery_id',current_setting('qa.department_revision'),'decision','changes','reason','QA retain client requested revision'));
 perform set_config('request.jwt.claims',(c->'coordinator_claims')::text,true);
 snapshot=public.work_request_detail(rid,false);version=(snapshot->'request'->>'version')::integer;
 perform public.work_action('route_revision',jsonb_build_object('request_id',rid,'version',version,'part_id',c->>'part'));
 perform set_config('request.jwt.claims',(c->'head_claims')::text,true);
 snapshot=public.work_request_detail(rid,false);version=(snapshot->'request'->>'version')::integer;
 perform public.work_action('delegate',jsonb_build_object('request_id',rid,'version',version,'part_id',c->>'part','assignee_id',c->>'head'));
 snapshot=public.work_request_detail(rid,false);
 if snapshot->'parts'->0->>'status'<>'offered' or not exists(
  select 1 from jsonb_array_elements(snapshot->'deliveries') delivery where delivery->>'feedback'='QA retain client requested revision'
 ) then raise exception 'QA routed revision could not be distributed or lost feedback'; end if;
end $$;
reset role;

do $$
declare c jsonb=current_setting('qa.department')::jsonb; rid uuid=(c->>'rid')::uuid; qa_event_id bigint; before_count integer; after_count integer;
begin
 select min(id) into qa_event_id from public.work_events where request_id=rid and kind='delegate';
 if not exists(select 1 from provision_private.work_assignment_history where event_id=qa_event_id
  and previous_assignee=(c->>'head')::uuid and next_assignee=(c->>'member')::uuid) then raise exception 'QA assignment audit missing'; end if;
 if not exists(select 1 from public.work_notifications where request_id=rid and recipient=(c->>'member')::uuid and message like 'وزع مسؤول القسم%') then raise exception 'QA member distribution notice missing'; end if;
 if (select count(*) from public.work_notifications where request_id=rid and event_key='control:event:'||qa_event_id::text||':admin')<>2 then raise exception 'QA delegation control audience missing'; end if;
 if not exists(select 1 from public.work_notifications where request_id=rid and recipient=(c->>'coordinator')::uuid and event_key='event:event:'||qa_event_id::text||':coordinator') then raise exception 'QA delegation coordinator notice missing'; end if;
 if not exists(select 1 from public.work_notifications where request_id=rid and recipient=(c->>'client')::uuid and event_key='journey:event:'||qa_event_id::text||':client' and message like 'حدد مسؤول القسم%') then raise exception 'QA safe client acknowledgement missing'; end if;
 select id into strict qa_event_id from public.work_events where request_id=rid and kind='accept';
 if not exists(select 1 from public.work_notifications where request_id=rid and recipient=(c->>'head')::uuid and event_key='department:event:'||qa_event_id::text||':lead') then raise exception 'QA head progress notice missing'; end if;
 if not exists(select 1 from public.work_events event join public.work_notifications notification
  on notification.event_key='department:event:'||event.id::text||':lead'
  where event.request_id=rid and event.kind='route_revision' and notification.recipient=(c->>'head')::uuid) then raise exception 'QA head revision notice missing'; end if;
 select count(*) into before_count from public.work_notifications where request_id=rid;
 perform provision_private.work_ensure_event_notifications(qa_event_id);
 perform provision_private.work_ensure_event_notifications(qa_event_id);
 select count(*) into after_count from public.work_notifications where request_id=rid;
 if before_count<>after_count then raise exception 'QA replay duplicated notices'; end if;
 if exists(select 1 from public.work_notifications where request_id=rid and whatsapp<>'suppressed') then raise exception 'QA test notification not suppressed'; end if;
 if not provision_private.work_notification_audience_eligible((c->>'head')::uuid,'department:event:'||qa_event_id::text||':lead',rid) then raise exception 'QA active lead notice not eligible'; end if;
 insert into public.work_events(request_id,part_id,actor,kind,note,client_visible)
 values(rid,(c->>'part')::uuid,(c->>'coordinator')::uuid,'release_delivery','QA head is also assignee',false) returning id into qa_event_id;
 if not exists(select 1 from public.work_notifications where recipient=(c->>'head')::uuid and event_key='department:event:'||qa_event_id::text||':lead') then raise exception 'QA assignee head lost release update'; end if;
 update public.work_memberships set member_role='member' where service_id=(c->>'sid')::uuid and user_id=(c->>'head')::uuid;
 if provision_private.work_notification_audience_eligible((c->>'head')::uuid,'department:event:'||qa_event_id::text||':lead',rid) then raise exception 'QA removed lead notification access retained'; end if;
end $$;
select 'PASS scoped head inbox distribution authorization membership versioning task preservation notification audiences replay and revocation' as result;
