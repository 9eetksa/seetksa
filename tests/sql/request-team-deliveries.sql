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
set local role authenticated;
do $$
declare detail jsonb; path text=current_setting('qa.path'); rid uuid=current_setting('qa.rid')::uuid;
begin
 perform set_config('request.jwt.claims',current_setting('qa.editor_claims'),true);
 if not provision_private.work_file_read(path) then raise exception 'QA peer delivery denied'; end if;
 detail=public.work_request_detail(rid,false);
 if jsonb_array_length(detail->'deliveries')<>1 or detail->'deliveries'->0->>'note'<>'QA source delivery note' then raise exception 'QA content missing from detail'; end if;
 if provision_private.work_file_read(rid||'/brief/unregistered.png') then raise exception 'QA unregistered file exposed'; end if;
 perform set_config('request.jwt.claims',current_setting('qa.client_claims'),true);
 if provision_private.work_file_read(path) or jsonb_array_length(public.work_request_detail(rid,false)->'deliveries')<>0 then raise exception 'QA unreleased client delivery exposed'; end if;
 perform set_config('request.jwt.claims',current_setting('qa.outsider_claims'),true);
 if provision_private.work_file_read(path) then raise exception 'QA unrelated employee exposed'; end if;
end $$;
reset role;
update auth.users set banned_until=now()+interval '1 hour' where id=current_setting('qa.editor')::uuid;
do $$ begin
 perform set_config('request.jwt.claims',current_setting('qa.editor_claims'),true);
 if provision_private.work_file_read(current_setting('qa.path')) then raise exception 'QA suspended employee exposed'; end if;
end $$;
select 'PASS same request delivery content RLS client isolation outsider isolation and suspension' result;
