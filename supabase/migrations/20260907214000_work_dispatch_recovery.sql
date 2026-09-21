begin;
create or replace function provision_private.work_dispatch() returns void language plpgsql security definer set search_path='' as $$
declare cfg provision_private.work_dispatch_config;
begin
 select * into cfg from provision_private.work_dispatch_config where id;
 if cfg.url is not null and exists(select 1 from public.work_notifications where (whatsapp in ('pending','failed') and next_attempt<=now() and attempts<5) or (whatsapp='sending' and next_attempt<now()-interval '2 minutes')) then
  perform net.http_post(url:=cfg.url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cfg.token),body:='{}'::jsonb,timeout_milliseconds:=60000);
 end if;
end; $$;
revoke all on function provision_private.work_dispatch() from public,anon,authenticated;
commit;
