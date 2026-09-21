begin;

-- A legacy delivery remains a complete single-file submission
alter table public.work_deliveries add column batch_id uuid;
update public.work_deliveries set batch_id=id;
alter table public.work_deliveries alter column batch_id set default gen_random_uuid();
alter table public.work_deliveries alter column batch_id set not null;
create index work_deliveries_batch on public.work_deliveries(batch_id);

-- Workflow callers already hold the parent request lock before locking a batch
create function provision_private.work_lock_delivery_batch(seed uuid,rid uuid)
returns public.work_deliveries language plpgsql security definer set search_path='' as $$
declare chosen public.work_deliveries;
begin
 select * into chosen from public.work_deliveries where id=seed and request_id=rid;
 if chosen.id is null then raise exception 'invalid_delivery'; end if;
 perform 1 from public.work_deliveries where batch_id=chosen.batch_id order by id for update;
 if exists(select 1 from public.work_deliveries sibling where sibling.batch_id=chosen.batch_id and (
  sibling.request_id is distinct from chosen.request_id or sibling.part_id is distinct from chosen.part_id
  or sibling.uploaded_by is distinct from chosen.uploaded_by or sibling.status is distinct from chosen.status
  or sibling.released_at is distinct from chosen.released_at or sibling.released_by is distinct from chosen.released_by
  or sibling.internal_shared_at is distinct from chosen.internal_shared_at or sibling.internal_shared_by is distinct from chosen.internal_shared_by
  or sibling.received_at is distinct from chosen.received_at
 )) then raise exception 'invalid_delivery_batch'; end if;
 return chosen;
end;
$$;
revoke all on function provision_private.work_lock_delivery_batch(uuid,uuid) from public,anon,authenticated;

-- A lost response can replay the same original paths without duplicating work
-- Only the original uploader can recover an exact existing submission
create function provision_private.work_upload_receipt(operation text,rid uuid,p jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare files jsonb; count_files integer; found_count integer; bid uuid; pid uuid; ids jsonb;
begin
 if not provision_private.account_ready() or operation not in ('deliver','attach') then return null; end if;
 files=case when p ? 'files' then p->'files' else jsonb_build_array(jsonb_build_object('object_path',p->>'object_path','filename',p->>'filename','note',p->>'note')) end;
 if jsonb_typeof(files) is distinct from 'array' then return null; end if;
 count_files=jsonb_array_length(files);
 if count_files=0 or count_files<>(select count(distinct value->>'object_path') from jsonb_array_elements(files)) then return null; end if;
 if operation='deliver' then
  pid=(p->>'part_id')::uuid;
  if not exists(select 1 from public.work_parts where id=pid and request_id=rid and assignee_id=auth.uid()) then return null; end if;
  select count(*),jsonb_agg(d.id order by f.ordinality) into found_count,ids
  from jsonb_array_elements(files) with ordinality f(value,ordinality)
  join public.work_deliveries d on d.object_path=f.value->>'object_path'
  where d.request_id=rid and d.part_id=pid and d.uploaded_by=auth.uid()
   and d.filename=f.value->>'filename' and d.note=left(coalesce(f.value->>'note',p->>'note',''),4000);
  if found_count<>count_files then return null; end if;
  select batch_id into bid from public.work_deliveries where id=(ids->>0)::uuid;
  if exists(select 1 from public.work_deliveries where id in (select value::text::uuid from jsonb_array_elements_text(ids)) and batch_id<>bid)
   or (select count(*) from public.work_deliveries where batch_id=bid)<>count_files then return null; end if;
  return jsonb_build_object('request_id',rid,'part_id',pid,'delivery_id',ids->0,'batch_id',bid,'delivery_ids',ids,'attachment_ids','[]'::jsonb);
 end if;
 select count(*),jsonb_agg(a.id order by f.ordinality) into found_count,ids
 from jsonb_array_elements(files) with ordinality f(value,ordinality)
 join public.work_attachments a on a.object_path=f.value->>'object_path'
 where a.request_id=rid and a.uploaded_by=auth.uid() and a.filename=f.value->>'filename';
 if found_count<>count_files then return null; end if;
 return jsonb_build_object('request_id',rid,'attachment_ids',ids,'delivery_ids','[]'::jsonb);
end;
$$;
revoke all on function provision_private.work_upload_receipt(text,uuid,jsonb) from public,anon,authenticated;

do $migration$
declare body text; needle text; replacement text;
begin
 body=replace(pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 needle='declare dependency_input jsonb;';
 if strpos(body,needle)=0 then raise exception 'delivery_batches_declaration'; end if;
 body=replace(body,needle,'declare upload_receipt jsonb; upload_input jsonb; upload_files jsonb; upload_batch uuid; uploaded_id uuid; uploaded_ids jsonb=''[]''; dependency_input jsonb;');

 needle=$old$if octet_length(p::text)>50000 then raise exception 'invalid_input'; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_payload_bound'; end if;
 body=replace(body,needle,$new$if octet_length(p::text)>(case when action in ('deliver','attach') and p ? 'files' then 1048576 else 50000 end) then raise exception 'invalid_input'; end if;$new$);
 needle=$old$if (p->>'version')::integer is distinct from r.version then raise exception 'version_conflict'; end if;$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_retry_guard'; end if;
 body=replace(body,needle,$new$if action in ('deliver','attach') then
   upload_receipt=provision_private.work_upload_receipt(action,r.id,p);
   if upload_receipt is not null then return upload_receipt; end if;
  end if;
  $new$||needle);

 needle=$old$if not exists(select 1 from storage.objects where bucket_id='work-files' and name=p->>'object_path' and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]=a.id::text) then raise exception 'invalid_file'; end if;
    insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,note) values(r.id,a.id,auth.uid(),p->>'object_path',p->>'filename',left(coalesce(p->>'note',''),4000)) returning id into result_id;$old$;
 replacement=$new$upload_files=case when p ? 'files' then p->'files' else jsonb_build_array(jsonb_build_object('object_path',p->>'object_path','filename',p->>'filename','note',p->>'note')) end;
    if jsonb_typeof(upload_files) is distinct from 'array' then raise exception 'invalid_file'; end if;
    if jsonb_array_length(upload_files)=0 or jsonb_array_length(upload_files)<>(select count(distinct value->>'object_path') from jsonb_array_elements(upload_files)) then raise exception 'invalid_file'; end if;
    for upload_input in select value from jsonb_array_elements(upload_files) loop
     if jsonb_typeof(upload_input) is distinct from 'object' or length(coalesce(upload_input->>'filename','')) not between 1 and 200
      or not exists(select 1 from storage.objects where bucket_id='work-files' and name=upload_input->>'object_path'
       and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]=a.id::text)
      or exists(select 1 from public.work_deliveries where object_path=upload_input->>'object_path') then raise exception 'invalid_file'; end if;
    end loop;
    upload_batch=gen_random_uuid();
    for upload_input in select value from jsonb_array_elements(upload_files) loop
     insert into public.work_deliveries(request_id,part_id,uploaded_by,object_path,filename,note,batch_id)
     values(r.id,a.id,auth.uid(),upload_input->>'object_path',upload_input->>'filename',left(coalesce(upload_input->>'note',p->>'note',''),4000),upload_batch)
     returning id into uploaded_id;
     result_id=coalesce(result_id,uploaded_id);
     uploaded_ids=uploaded_ids||jsonb_build_array(uploaded_id);
    end loop;$new$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_submit'; end if;
 body=replace(body,needle,replacement);

 needle=$old$if not exists(select 1 from storage.objects where bucket_id='work-files' and name=p->>'object_path' and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]='brief') then raise exception 'invalid_file'; end if;
   insert into public.work_attachments(request_id,uploaded_by,object_path,filename) values(r.id,auth.uid(),p->>'object_path',p->>'filename'); external=true;$old$;
 replacement=$new$upload_files=case when p ? 'files' then p->'files' else jsonb_build_array(jsonb_build_object('object_path',p->>'object_path','filename',p->>'filename')) end;
   if jsonb_typeof(upload_files) is distinct from 'array' then raise exception 'invalid_file'; end if;
   if jsonb_array_length(upload_files)=0 or jsonb_array_length(upload_files)<>(select count(distinct value->>'object_path') from jsonb_array_elements(upload_files)) then raise exception 'invalid_file'; end if;
   for upload_input in select value from jsonb_array_elements(upload_files) loop
    if jsonb_typeof(upload_input) is distinct from 'object' or length(coalesce(upload_input->>'filename','')) not between 1 and 200
     or not exists(select 1 from storage.objects where bucket_id='work-files' and name=upload_input->>'object_path'
      and owner_id=auth.uid()::text and (storage.foldername(name))[1]=r.id::text and (storage.foldername(name))[2]='brief')
     or exists(select 1 from public.work_attachments where object_path=upload_input->>'object_path') then raise exception 'invalid_file'; end if;
   end loop;
   for upload_input in select value from jsonb_array_elements(upload_files) loop
    insert into public.work_attachments(request_id,uploaded_by,object_path,filename)
    values(r.id,auth.uid(),upload_input->>'object_path',upload_input->>'filename') returning id into uploaded_id;
    uploaded_ids=uploaded_ids||jsonb_build_array(uploaded_id);
   end loop;
   external=true;$new$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_attachments'; end if;
 body=replace(body,needle,replacement);

 needle=$old$select * into d from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id for update;$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_lock'; end if;
 body=replace(body,needle,$new$d=provision_private.work_lock_delivery_batch((p->>'delivery_id')::uuid,r.id);$new$);
 needle=$old$select * into handoff_delivery from public.work_deliveries where id=(p->>'delivery_id')::uuid and request_id=r.id for update;$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_handoff_lock'; end if;
 body=replace(body,needle,$new$handoff_delivery=provision_private.work_lock_delivery_batch((p->>'delivery_id')::uuid,r.id);$new$);

 needle=$old$update public.work_deliveries set internal_shared_at=now(),internal_shared_by=auth.uid() where id=d.id;$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_internal_release'; end if;
 body=replace(body,needle,$new$update public.work_deliveries set internal_shared_at=now(),internal_shared_by=auth.uid() where batch_id=d.batch_id and request_id=r.id and part_id=a.id;$new$);
 needle=$old$update public.work_deliveries set released_at=now(),released_by=auth.uid() where id=d.id;$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_client_release'; end if;
 body=replace(body,needle,$new$update public.work_deliveries set released_at=now(),released_by=auth.uid() where batch_id=d.batch_id and request_id=r.id and part_id=a.id;$new$);
 needle=$old$update public.work_deliveries set status='approved',received_at=now() where id=d.id;$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_approve'; end if;
 body=replace(body,needle,$new$update public.work_deliveries set status='approved',received_at=now() where batch_id=d.batch_id and request_id=r.id and part_id=a.id;$new$);
 needle=$old$update public.work_deliveries set status='changes',feedback=why,annotation=coalesce(p->'annotation','{}') where id=d.id;$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_changes'; end if;
 body=replace(body,needle,$new$update public.work_deliveries set status='changes',feedback=why,annotation=coalesce(p->'annotation','{}') where batch_id=d.batch_id and request_id=r.id and part_id=a.id;$new$);

 needle=$old$return jsonb_build_object('request_id',r.id,'part_id',a.id,'delivery_id',result_id);$old$;
 if strpos(body,needle)=0 then raise exception 'delivery_batches_result'; end if;
 body=replace(body,needle,$new$return jsonb_build_object('request_id',r.id,'part_id',a.id,'delivery_id',result_id,'batch_id',upload_batch,'delivery_ids',case when action='deliver' then uploaded_ids else '[]'::jsonb end,'attachment_ids',case when action='attach' then uploaded_ids else '[]'::jsonb end);$new$);
 execute body;
end;
$migration$;

commit;
