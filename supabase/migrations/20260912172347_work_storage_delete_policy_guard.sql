begin;

-- Storage evaluates relation privileges for every applicable policy even when
-- a different bucket policy authorizes the operation Keep private work-table
-- lookups behind the same actor checks instead of granting raw table access
create function provision_private.work_file_draft_removable(p_bucket text,p_name text,p_owner text)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if p_bucket is distinct from 'work-files' or p_name is null or auth.uid() is null
  or p_owner is distinct from auth.uid()::text
  or not coalesce(provision_private.account_ready(),false) then return false; end if;
 if not coalesce(provision_private.work_upload(p_name),false) then return false; end if;
 return not exists(select 1 from public.work_deliveries where object_path=p_name)
  and not exists(select 1 from public.work_attachments where object_path=p_name);
end $$;
revoke all on function provision_private.work_file_draft_removable(text,text,text) from public,anon,authenticated;
grant execute on function provision_private.work_file_draft_removable(text,text,text) to authenticated;

drop policy work_file_remove_draft on storage.objects;
create policy work_file_remove_draft on storage.objects for delete to authenticated using(
 case when bucket_id='work-files'
  then provision_private.work_file_draft_removable(bucket_id,name,owner_id)
  else false end
);

commit;
