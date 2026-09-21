begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create table provision_private.work_dispatch_config(id boolean primary key default true check(id),url text not null,token text not null);
revoke all on provision_private.work_dispatch_config from public,anon,authenticated;
create function public.work_dispatch_configure(p_url text,p_token text) returns void language sql security definer set search_path='' as $$
 insert into provision_private.work_dispatch_config(id,url,token) values(true,p_url,p_token)
 on conflict(id) do update set url=excluded.url,token=excluded.token;
$$;
revoke all on function public.work_dispatch_configure(text,text) from public,anon,authenticated;
grant execute on function public.work_dispatch_configure(text,text) to service_role;
create function provision_private.work_dispatch() returns void language plpgsql security definer set search_path='' as $$
declare cfg provision_private.work_dispatch_config;
begin
 select * into cfg from provision_private.work_dispatch_config where id;
 if cfg.url is not null and exists(select 1 from public.work_notifications where whatsapp in ('pending','failed') and next_attempt<=now() and attempts<5) then
  perform net.http_post(url:=cfg.url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cfg.token),body:='{}'::jsonb,timeout_milliseconds:=60000);
 end if;
end; $$;
revoke all on function provision_private.work_dispatch() from public,anon,authenticated;
create function provision_private.work_notify_dispatch() returns trigger language plpgsql security definer set search_path='' as $$
begin perform provision_private.work_dispatch(); return null; end; $$;
revoke all on function provision_private.work_notify_dispatch() from public,anon,authenticated;
create trigger work_outbox_dispatch after insert on public.work_notifications for each statement execute function provision_private.work_notify_dispatch();
select cron.schedule('provision-work-notifications','* * * * *','select provision_private.work_dispatch()');

create function public.work_notification_claim() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted' where whatsapp='sending' and next_attempt<now()-interval '2 minutes';
 return (with candidates as (
 select id from public.work_notifications where whatsapp in ('pending','failed') and attempts<5 and next_attempt<=now() order by created_at for update skip locked limit 15
 ), claimed as (
 update public.work_notifications n set whatsapp='sending',attempts=attempts+1,next_attempt=now() from candidates c where n.id=c.id returning n.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'recipient',c.recipient,'message',c.message,'request_id',c.request_id,'attempts',c.attempts,'phone',coalesce(nullif(p.phone,''),u.phone))),'[]') from claimed c join auth.users u on u.id=c.recipient left join public.account_profiles p on p.user_id=c.recipient);
end; $$;
revoke all on function public.work_notification_claim() from public,anon,authenticated;
grant execute on function public.work_notification_claim() to service_role;

create function public.work_clients(p_search text default '') returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not(provision_private.work_manager() or provision_private.work_coordinator()) then raise exception 'forbidden'; end if;
 return(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select u.id,coalesce(nullif(p.display_name,''),u.email) as name from auth.users u left join public.account_profiles p on p.user_id=u.id where u.raw_app_meta_data->>'role'='client' and (u.email ilike '%'||left(p_search,100)||'%' or p.display_name ilike '%'||left(p_search,100)||'%') order by u.created_at desc limit 50)x);
end; $$;
revoke all on function public.work_clients(text) from public,anon;
grant execute on function public.work_clients(text) to authenticated;

create function public.work_delivery_health() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.work_manager() then raise exception 'forbidden'; end if;
 return(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select n.id,n.request_id,n.whatsapp,n.attempts,n.last_error,n.created_at,coalesce(nullif(p.display_name,''),u.email) as recipient_name from public.work_notifications n join auth.users u on u.id=n.recipient left join public.account_profiles p on p.user_id=n.recipient where n.whatsapp in ('failed','unknown') order by n.created_at desc limit 50)x);
end; $$;
revoke all on function public.work_delivery_health() from public,anon;
grant execute on function public.work_delivery_health() to authenticated;
create function public.work_retry_notification(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not provision_private.is_owner() then raise exception 'forbidden'; end if;
 update public.work_notifications set whatsapp='pending',attempts=0,next_attempt=now() where id=p_id and whatsapp in ('failed','unknown');
 insert into provision_private.audit(actor,effective_user,action,details) values(auth.uid(),auth.uid(),'work_notification_retry',jsonb_build_object('id',p_id));
 perform provision_private.work_dispatch();
end; $$;
revoke all on function public.work_retry_notification(uuid) from public,anon;
grant execute on function public.work_retry_notification(uuid) to authenticated;
commit;
