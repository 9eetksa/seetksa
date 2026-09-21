-- Run after the migration inside a transaction and always roll back
do $$
declare c uuid=gen_random_uuid(); designer uuid=gen_random_uuid(); editor uuid=gen_random_uuid(); outsider uuid=gen_random_uuid();
 cs uuid=gen_random_uuid(); es uuid=gen_random_uuid(); os uuid=gen_random_uuid();
 rid uuid=gen_random_uuid(); other_rid uuid=gen_random_uuid(); dp uuid=gen_random_uuid(); ep uuid=gen_random_uuid(); sid uuid; second_sid uuid;
begin
 select id into strict sid from public.work_services limit 1;
 select id into strict second_sid from public.work_services where id<>sid limit 1;
 insert into auth.users(id,email,raw_app_meta_data) values
 (c,c||'@example.invalid','{"role":"client"}'),
 (designer,designer||'@example.invalid','{"role":"employee"}'),
 (editor,editor||'@example.invalid','{"role":"employee"}'),
 (outsider,outsider||'@example.invalid','{"role":"employee"}');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(cs,c,now(),now()),(es,editor,now(),now()),(os,outsider,now(),now());
 insert into public.work_requests(id,client_id,service_id,title,brief,status,test) values
 (rid,c,sid,'QA team files','QA isolated team file visibility','active',true),
 (other_rid,c,sid,'QA other request','QA isolated unrelated request','active',true);
 insert into public.work_parts(id,request_id,service_id,assignee_id,scope,status,route_position) values
 (dp,rid,sid,designer,'QA design','review',1),(ep,rid,second_sid,editor,'QA editing','working',2);
 insert into public.work_parts(request_id,service_id,assignee_id,scope,status,route_position) values(other_rid,sid,outsider,'QA unrelated work','working',1);
 insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,note)
 values(rid,dp,designer,rid||'/'||dp||'/design.png','design.png','QA source delivery note');
 perform set_config('qa.rid',rid::text,true);
 perform set_config('qa.path',rid||'/'||dp||'/design.png',true);
 perform set_config('qa.editor',editor::text,true);
 perform set_config('qa.editor_claims',jsonb_build_object('sub',editor,'role','authenticated','session_id',es)::text,true);
 perform set_config('qa.client_claims',jsonb_build_object('sub',c,'role','authenticated','session_id',cs)::text,true);
 perform set_config('qa.outsider_claims',jsonb_build_object('sub',outsider,'role','authenticated','session_id',os)::text,true);
end $$;
do $$
declare rid uuid=current_setting('qa.rid')::uuid; designer uuid; ps uuid=gen_random_uuid(); part uuid; delivery uuid; owner_id uuid;
begin
 select p.id,p.assignee_id into part,designer from public.work_parts p where p.request_id=rid and p.status='review';
 owner_id=(current_setting('qa.outsider_claims')::jsonb->>'sub')::uuid;
 update auth.users set raw_app_meta_data='{"role":"super_admin"}' where id=owner_id;
 insert into auth.sessions(id,user_id,created_at,updated_at) values(ps,designer,now(),now());
 update public.work_requests set coordinator_id=owner_id where id=rid;
 update public.work_deliveries set released_at=now(),batch_id=gen_random_uuid() where request_id=rid returning id into delivery;
 perform set_config('qa.part',part::text,true);perform set_config('qa.delivery',delivery::text,true);
 perform set_config('qa.designer_claims',jsonb_build_object('sub',designer,'role','authenticated','session_id',ps)::text,true);
end $$;
set local role authenticated;
do $$
declare rid uuid=current_setting('qa.rid')::uuid; part uuid=current_setting('qa.part')::uuid;
 version integer; rejected boolean=false; snapshot jsonb;
begin
 perform set_config('request.jwt.claims',current_setting('qa.client_claims'),true);
 snapshot=public.work_request_detail(rid,false);version=(snapshot->'request'->>'version')::integer;
 perform public.work_action('review',jsonb_build_object('request_id',rid,'version',version,'delivery_id',current_setting('qa.delivery'),'decision','changes','reason','QA client revision'));
 perform set_config('request.jwt.claims',current_setting('qa.designer_claims'),true);
 snapshot=public.work_request_detail(rid,false);version=(snapshot->'request'->>'version')::integer;
 if snapshot->'parts'->0->>'status'<>'revision' then raise exception 'QA review not queued for routing'; end if;
 begin perform public.work_action('deliver',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'files','[]'::jsonb));
 exception when others then if sqlerrm='revision_routing_required' then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'QA delivery bypassed routing'; end if;
 rejected=false;
 begin perform public.work_action('route_revision',jsonb_build_object('request_id',rid,'version',version,'part_id',part));
 exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'QA employee routed own revision'; end if;
 perform set_config('request.jwt.claims',current_setting('qa.outsider_claims'),true);
 perform public.work_action('route_revision',jsonb_build_object('request_id',rid,'version',version,'part_id',part));
 perform set_config('request.jwt.claims',current_setting('qa.designer_claims'),true);
 snapshot=public.work_request_detail(rid,false);version=(snapshot->'request'->>'version')::integer;
 if snapshot->'parts'->0->>'status'<>'offered' then raise exception 'QA revision not offered'; end if;
 perform public.work_action('accept',jsonb_build_object('request_id',rid,'version',version,'part_id',part,'due_at',now()+interval '2 days'));
 snapshot=public.work_request_detail(rid,false);
 if snapshot->'parts'->0->>'status'<>'working' then raise exception 'QA accepted revision not executable'; end if;
 if snapshot->'deliveries'->0->>'feedback'<>'QA client revision' then raise exception 'QA original feedback lost'; end if;
end $$;
reset role;
select 'PASS client review coordinator routing employee acceptance and bypass protection' result;
