begin;

create table provision_private.work_notification_watchdog (
 id boolean primary key default true check(id),
 installed_at timestamptz not null default now(),
 dispatched_at timestamptz,
 worker_at timestamptz,
 state text not null default 'unavailable',
 probe_token uuid,
 probe_lease_until timestamptz,
 checked_at timestamptz,
 queue_ids text[] not null default '{}',
 queue_head_since timestamptz,
 probe_error text,
 alert_reason text
);
insert into provision_private.work_notification_watchdog(id) values(true);
alter table provision_private.work_notification_watchdog enable row level security;
revoke all on provision_private.work_notification_watchdog from public,anon,authenticated;

create function public.work_notification_probe_claim(p_state text) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid;
begin
 if p_state not in('authorized','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended','unavailable') then p_state='unavailable';end if;
 update provision_private.work_notification_watchdog set worker_at=now(),state=p_state where id;
 update provision_private.work_notification_watchdog set probe_token=gen_random_uuid(),probe_lease_until=now()+interval '30 seconds'
 where id and (probe_lease_until is null or probe_lease_until<=now())
  and (checked_at is null or checked_at<=now()-interval '55 seconds') returning probe_token into token;
 return token;
end
$$;
revoke all on function public.work_notification_probe_claim(text) from public,anon,authenticated;
grant execute on function public.work_notification_probe_claim(text) to service_role;

create function public.work_notification_probe_finish(p_token uuid,p_queue_ids text[],p_error text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_queue_ids is null or cardinality(p_queue_ids)>500
  or exists(select 1 from unnest(p_queue_ids) value where value is null or length(value) not between 1 and 200)
  or (p_error is not null and p_error<>'provider_queue_unavailable') then raise exception 'invalid_input';end if;
 update provision_private.work_notification_watchdog set
  queue_head_since=case when p_error is not null then queue_head_since when cardinality(p_queue_ids)=0 then null
   when queue_ids[1] is not distinct from p_queue_ids[1] then coalesce(queue_head_since,now()) else now() end,
  queue_ids=case when p_error is null then p_queue_ids else queue_ids end,
  checked_at=now(),probe_error=p_error,probe_lease_until=null
 where id and probe_token=p_token;
end
$$;
revoke all on function public.work_notification_probe_finish(uuid,text[],text) from public,anon,authenticated;
grant execute on function public.work_notification_probe_finish(uuid,text[],text) to service_role;

create function provision_private.work_notification_health_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare w provision_private.work_notification_watchdog; queued bigint; uncertain bigint; failed bigint; waiting bigint; stuck bigint; issue text;
begin
 select * into w from provision_private.work_notification_watchdog where id;
 select count(*) filter(where whatsapp in('pending','failed') and attempts<5),
  count(*) filter(where whatsapp='unknown'),
  count(*) filter(where whatsapp='failed' and attempts>=5),
  count(*) filter(where whatsapp='sent' and coalesce(provider_status_at,dispatch_started_at,created_at)<now()-interval '15 minutes'),
  count(*) filter(where (whatsapp in('pending','failed') and attempts<5 and next_attempt<now()-interval '5 minutes')
   or (whatsapp='sending' and next_attempt<now()-interval '2 minutes'))
 into queued,uncertain,failed,waiting,stuck from public.work_notifications
 where whatsapp in('pending','failed','unknown','sending','sent');
 issue=case
  when w.worker_at is null or w.worker_at<now()-interval '4 minutes' then 'worker_stale'
  when w.state<>'authorized' then 'provider_unavailable'
  when w.checked_at is null or w.checked_at<now()-interval '4 minutes' or w.probe_error is not null then 'probe_failed'
  when w.queue_head_since<now()-interval '5 minutes' and cardinality(w.queue_ids)>0 then 'provider_queue_stalled'
  when stuck>0 then 'dispatch_stalled'
  when uncertain>0 then 'uncertain'
  when failed>0 then 'failed'
  when waiting>0 then 'awaiting_delivery'
  else null end;
 return jsonb_build_object('issue',issue,'state',w.state,'checked_at',w.checked_at,'worker_at',w.worker_at,
  'provider_queue',cardinality(w.queue_ids),'queued',queued,'uncertain',uncertain,'failed',failed,'awaiting_delivery',waiting,'stalled',stuck);
end
$$;
revoke all on function provision_private.work_notification_health_snapshot() from public,anon,authenticated;

create function public.work_notification_monitor() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501';end if;
 return provision_private.work_notification_health_snapshot();
end
$$;
revoke all on function public.work_notification_monitor() from public,anon;
grant execute on function public.work_notification_monitor() to authenticated;

create function provision_private.work_notification_watchdog_alert() returns void
language plpgsql security definer set search_path='' as $$
declare issue text; previous text; incident uuid=gen_random_uuid();
begin
 issue=provision_private.work_notification_health_snapshot()->>'issue';
 select alert_reason into previous from provision_private.work_notification_watchdog where id for update;
 if issue is not distinct from previous then return;end if;
 update provision_private.work_notification_watchdog set alert_reason=issue where id;
 if issue is null then return;end if;
 -- In-app alert only A broken WhatsApp channel cannot deliver its own alarm
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key,last_error)
 select account.id,null,'تحتاج متابعة واتساب إلى مراجعة افتح مركز الإشعارات لمعرفة الحالة','suppressed',
  'system:whatsapp:watchdog:'||incident::text,'monitor_in_app_only'
 from auth.users account where account.raw_app_meta_data->>'role' in('admin','super_admin')
  and not coalesce(account.is_anonymous,false) and provision_private.account_available(account.id);
end
$$;
revoke all on function provision_private.work_notification_watchdog_alert() from public,anon,authenticated;

-- Keep the existing minute scheduler alive even when the only remaining rows
-- are sending or uncertain or waiting for provider delivery confirmation
create or replace function provision_private.work_dispatch() returns void
language plpgsql security definer set search_path='' as $$
declare cfg provision_private.work_dispatch_config; claimed boolean;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('work_notification_watchdog_dispatch',0)) then return;end if;
 perform provision_private.work_reconcile_provider_receipts();
 select * into cfg from provision_private.work_dispatch_config where id;
 if cfg.url is null then return;end if;
 update provision_private.work_notification_watchdog set dispatched_at=now()
 where id and (dispatched_at is null or dispatched_at<=now()-interval '45 seconds') returning true into claimed;
 if not coalesce(claimed,false) then return;end if;
 -- Suppress initial installation noise until the first worker opportunity
 if exists(select 1 from provision_private.work_notification_watchdog where id and (worker_at is not null or installed_at<now()-interval '4 minutes')) then
  perform provision_private.work_notification_watchdog_alert();
 end if;
 perform net.http_post(url:=cfg.url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cfg.token),
  body:='{}'::jsonb,timeout_milliseconds:=60000);
end
$$;
revoke all on function provision_private.work_dispatch() from public,anon,authenticated;

do $migration$
declare body text;
begin
 body=pg_get_functiondef('public.work_notification_journal_claim()'::regprocedure);
 if strpos(body,'45 minutes')=0 then raise exception 'journal_interval_guard';end if;
 execute replace(body,'45 minutes','5 minutes');
end
$migration$;

-- Unknown outcomes and provider accepted messages must never be blindly resent
create or replace function public.work_retry_notification(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.account_ready() or not provision_private.is_owner() then raise exception 'forbidden';end if;
 perform 1 from public.work_notifications where id=p_id and whatsapp='failed' and provider_id is null
  and last_error not in('legacy_delivery_outcome_unrecoverable','worker_interrupted','delivery_unconfirmed') for update;
 if not found then raise exception 'notification_retry_unsafe';end if;
 update public.work_notifications set whatsapp='pending',attempts=0,next_attempt=now() where id=p_id;
 insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'work_notification_retry',jsonb_build_object('id',p_id));
 perform provision_private.work_dispatch();
end
$$;
notify pgrst,'reload schema';
commit;
