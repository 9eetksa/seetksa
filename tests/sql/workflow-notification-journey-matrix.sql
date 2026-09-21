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
update auth.users set raw_app_meta_data=raw_app_meta_data||'{"portal_qa":true}'::jsonb where id in ((current_setting('qa.client_claims')::jsonb->>'sub')::uuid,(current_setting('qa.designer_claims')::jsonb->>'sub')::uuid,(current_setting('qa.outsider_claims')::jsonb->>'sub')::uuid);
