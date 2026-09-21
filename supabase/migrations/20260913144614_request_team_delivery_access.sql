-- Registered deliveries are readable by current assignees of the same request
-- This does not release deliveries to clients or satisfy workflow dependencies
create or replace function provision_private.work_file_read(path text)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and (
  exists(select 1 from public.work_attachments a where a.object_path=path and provision_private.work_read(a.request_id))
  or exists(select 1 from public.work_deliveries d where d.object_path=path and (
   (provision_private.work_role()='client' and d.released_at is not null and exists(
    select 1 from public.work_requests r where r.id=d.request_id and r.client_id=auth.uid()
   ))
   or (provision_private.work_role()<>'client' and (
    provision_private.work_part_read(d.part_id)
    or exists(
     select 1 from public.work_parts participant
     where participant.request_id=d.request_id and participant.assignee_id=auth.uid()
    )
    or (d.status='approved' and exists(
     select 1 from public.work_dependencies dep join public.work_parts p on p.id=dep.part_id
     where dep.upstream_id=d.part_id and dep.status='accepted' and p.assignee_id=auth.uid()
    ))
    or (d.internal_shared_at is not null and d.released_at is null and exists(
     select 1 from public.work_dependencies dep
     join public.work_parts source on source.id=dep.upstream_id
     join public.work_parts p on p.id=dep.part_id
     where dep.upstream_id=d.part_id and dep.request_id=d.request_id
     and dep.gate='internal_delivery' and dep.status='accepted'
     and source.status='internal_done' and p.assignee_id=auth.uid()
    ))
    or (d.status='pending' and d.released_at is null and exists(
     select 1 from public.work_parts source
     join public.work_parts downstream on downstream.id=source.forwarded_to and downstream.request_id=source.request_id
     where source.id=d.part_id and source.request_id=d.request_id and source.status='forwarded'
     and downstream.assignee_id=auth.uid()
    ))
   ))
  ))
 )
$$;
