begin;

alter table public.work_notifications
 add column if not exists provider_checked_at timestamptz;

update public.work_notifications
set provider_checked_at=coalesce(provider_status_at,created_at,now())
where provider_id is not null and provider_checked_at is null;

create index if not exists work_notifications_sent_provider_check_idx
on public.work_notifications(provider_checked_at,created_at)
where whatsapp='sent' and provider_id is not null;

alter table provision_private.work_notification_channel
 add column if not exists journal_lease_until timestamptz,
 add column if not exists journal_checked_at timestamptz;

create or replace function provision_private.work_apply_provider_receipt(provider text)
returns boolean language plpgsql security definer set search_path='' as $$
declare receipt provision_private.work_provider_receipts; changed integer;
begin
 select * into receipt from provision_private.work_provider_receipts where provider_id=provider;
 if receipt.provider_id is null then return false; end if;
 update public.work_notifications notification set
  whatsapp=case
   when notification.whatsapp='read' then 'read'
   when notification.whatsapp='delivered' and receipt.status in('sent','failed') then 'delivered'
   else receipt.status
  end,
  last_error=case
   when notification.whatsapp='read' or notification.whatsapp='delivered' and receipt.status in('sent','failed') then notification.last_error
   when receipt.status in('delivered','read') then null
   when receipt.status='sent' then 'provider_accepted_waiting_delivery'
   else left(coalesce(nullif(receipt.description,''),'provider_failed'),2000)
  end,
  provider_status_at=greatest(coalesce(notification.provider_status_at,'-infinity'::timestamptz),receipt.occurred_at),
  provider_checked_at=now(),
  whatsapp_delivered_at=case when receipt.status in('delivered','read') then coalesce(notification.whatsapp_delivered_at,receipt.occurred_at) else notification.whatsapp_delivered_at end,
  whatsapp_read_at=case when receipt.status='read' then coalesce(notification.whatsapp_read_at,receipt.occurred_at) else notification.whatsapp_read_at end
 where notification.provider_id=receipt.provider_id;
 get diagnostics changed=row_count;
 return changed>0;
end;
$$;
revoke all on function provision_private.work_apply_provider_receipt(text) from public,anon,authenticated;

create or replace function public.work_notification_journal_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare locked boolean; result jsonb;
begin
 update provision_private.work_notification_channel channel
 set journal_lease_until=now()+interval '2 minutes'
 where channel.id and (channel.journal_lease_until is null or channel.journal_lease_until<=now())
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
 update provision_private.work_notification_channel
 set journal_lease_until=null,journal_checked_at=now() where id;
 return jsonb_build_object('processed',true,'checked',changed);
end;
$$;
revoke all on function public.work_notification_journal_finish(text[]) from public,anon,authenticated;
grant execute on function public.work_notification_journal_finish(text[]) to service_role;

do $patch_claim$
declare body text; anchor text:='provider_id=null,provider_status_at=null,last_error=null,';
begin
 body=pg_get_functiondef('public.work_notification_claim()'::regprocedure);
 if position(anchor in body)=0 then raise exception 'work_notification_claim_provider_anchor_missing'; end if;
 body=replace(body,anchor,'provider_id=null,provider_status_at=null,provider_checked_at=null,last_error=null,');
 execute body;
end;
$patch_claim$;

create or replace function provision_private.work_dispatch()
returns void language plpgsql security definer set search_path='' as $$
declare cfg provision_private.work_dispatch_config;
begin
 perform provision_private.work_reconcile_provider_receipts();
 select * into cfg from provision_private.work_dispatch_config where id;
 if cfg.url is not null and (
  exists(select 1 from public.work_notifications
   where whatsapp in('pending','failed') and next_attempt<=now() and attempts<5)
  or exists(select 1 from public.work_notifications
   where whatsapp='sent' and provider_id is not null and created_at>=now()-interval '24 hours'
    and coalesce(provider_checked_at,created_at)<=now()-interval '45 minutes')
 ) then
  perform net.http_post(url:=cfg.url,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cfg.token),
   body:='{}'::jsonb,timeout_milliseconds:=60000);
 end if;
end;
$$;
revoke all on function provision_private.work_dispatch() from public,anon,authenticated;

comment on function public.work_notification_journal_claim() is
'Claims one bounded Green API journal reconciliation lease and returns recent accepted provider ids';
comment on function public.work_notification_journal_finish(text[]) is
'Completes a successful provider journal reconciliation without exposing message content or recipients';

commit;
