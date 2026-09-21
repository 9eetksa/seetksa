-- Name-only metadata for in-app notifications Never return client phone numbers
-- Preserve the current recipient and notification audience authorization guards
create or replace function public.work_notifications_page(p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_page integer:=least(greatest(coalesce(p_page,0),0),10000);
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'items',(select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc),'[]'::jsonb) from(
   select notification.id,notification.request_id,notification.message,notification.created_at,
    notification.read_at,notification.whatsapp,notification.last_error,
    notification.whatsapp_delivered_at,notification.whatsapp_read_at,notification.provider_status_at,
    request.title as request_title,request.number as request_number,
    coalesce(nullif(trim(profile.display_name),''),nullif(trim(account.raw_user_meta_data->>'display_name'),''),'') as client_name
   from public.work_notifications notification
   left join public.work_requests request on request.id=notification.request_id
   left join public.account_profiles profile on profile.user_id=request.client_id
   left join auth.users account on account.id=request.client_id
   where notification.recipient=auth.uid()
    and provision_private.work_notification_readable(notification.id)
   order by notification.created_at desc limit 40 offset safe_page*40
  )item),
  'unread_count',(select count(*) from public.work_notifications notification
   where notification.recipient=auth.uid() and notification.read_at is null
    and provision_private.work_notification_readable(notification.id))
 );
end;
$$;
revoke all on function public.work_notifications_page(integer) from public,anon;
grant execute on function public.work_notifications_page(integer) to authenticated;
