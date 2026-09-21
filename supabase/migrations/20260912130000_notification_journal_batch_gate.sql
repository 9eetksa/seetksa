begin;

create or replace function public.work_notification_journal_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare locked boolean; result jsonb;
begin
 update provision_private.work_notification_channel channel
 set journal_lease_until=now()+interval '2 minutes',journal_checked_at=now()
 where channel.id
  and (channel.journal_lease_until is null or channel.journal_lease_until<=now())
  and (channel.journal_checked_at is null or channel.journal_checked_at<=now()-interval '45 minutes')
  and exists(
   select 1 from public.work_notifications notification
   where notification.whatsapp='sent' and notification.provider_id is not null
    and notification.created_at>=now()-interval '24 hours'
    and coalesce(notification.provider_checked_at,notification.created_at)<=now()-interval '45 minutes'
  )
 returning true into locked;
 if not coalesce(locked,false) then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(candidate.provider_id),'[]'::jsonb) into result from(
  select notification.provider_id
  from public.work_notifications notification
  where notification.whatsapp='sent' and notification.provider_id is not null
   and notification.created_at>=now()-interval '24 hours'
   and coalesce(notification.provider_checked_at,notification.created_at)<=now()-interval '45 minutes'
  order by notification.provider_checked_at nulls first,notification.created_at
  limit 500
 )candidate;
 if result='[]'::jsonb then
  update provision_private.work_notification_channel set journal_lease_until=null where id;
 end if;
 return result;
end;
$$;
revoke all on function public.work_notification_journal_claim() from public,anon,authenticated;
grant execute on function public.work_notification_journal_claim() to service_role;

create or replace function public.work_notification_delivery_batch(p_receipts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt jsonb; processed integer:=0;
begin
 if p_receipts is null or jsonb_typeof(p_receipts)<>'array' or jsonb_array_length(p_receipts)>500 then
  raise exception 'invalid_provider_receipts';
 end if;
 for receipt in select value from jsonb_array_elements(p_receipts)
 loop
  if jsonb_typeof(receipt)<>'object' then raise exception 'invalid_provider_receipt'; end if;
  perform public.work_notification_delivery_update(
   receipt->>'provider_id',
   receipt->>'status',
   receipt->>'description',
   nullif(receipt->>'occurred_at','')::timestamptz
  );
  processed:=processed+1;
 end loop;
 return jsonb_build_object('processed',processed);
end;
$$;
revoke all on function public.work_notification_delivery_batch(jsonb) from public,anon,authenticated;
grant execute on function public.work_notification_delivery_batch(jsonb) to service_role;

create or replace function public.work_notification_journal_finish(p_provider_ids text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare changed integer:=0;
begin
 if p_provider_ids is null or cardinality(p_provider_ids)>500 or exists(
  select 1 from unnest(p_provider_ids) as candidate(provider)
  where length(trim(coalesce(candidate.provider,''))) not between 1 and 200
 ) then raise exception 'invalid_provider_ids'; end if;
 update public.work_notifications notification set provider_checked_at=now()
 where notification.whatsapp='sent' and notification.provider_id=any(p_provider_ids);
 get diagnostics changed=row_count;
 update provision_private.work_notification_channel set journal_lease_until=null where id;
 return jsonb_build_object('processed',true,'checked',changed);
end;
$$;
revoke all on function public.work_notification_journal_finish(text[]) from public,anon,authenticated;
grant execute on function public.work_notification_journal_finish(text[]) to service_role;

create or replace function provision_private.work_dispatch()
returns void language plpgsql security definer set search_path='' as $$
declare cfg provision_private.work_dispatch_config;
begin
 perform provision_private.work_reconcile_provider_receipts();
 select * into cfg from provision_private.work_dispatch_config where id;
 if cfg.url is not null and (
  exists(select 1 from public.work_notifications
   where whatsapp in('pending','failed') and next_attempt<=now() and attempts<5)
  or (
   exists(select 1 from provision_private.work_notification_channel channel
    where channel.id
     and (channel.journal_lease_until is null or channel.journal_lease_until<=now())
     and (channel.journal_checked_at is null or channel.journal_checked_at<=now()-interval '45 minutes'))
   and exists(select 1 from public.work_notifications notification
    where notification.whatsapp='sent' and notification.provider_id is not null
     and notification.created_at>=now()-interval '24 hours'
     and coalesce(notification.provider_checked_at,notification.created_at)<=now()-interval '45 minutes')
  )
 ) then
  perform net.http_post(url:=cfg.url,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cfg.token),
   body:='{}'::jsonb,timeout_milliseconds:=60000);
 end if;
end;
$$;
revoke all on function provision_private.work_dispatch() from public,anon,authenticated;

comment on function public.work_notification_delivery_batch(jsonb) is
'Applies one bounded service role delivery journal batch without exposing message content or recipients';

commit;
