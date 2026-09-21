begin;
create or replace function public.work_notification_claim() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted' where whatsapp='sending' and next_attempt<now()-interval '2 minutes';
 with candidates as (
 select id from public.work_notifications where whatsapp in ('pending','failed') and attempts<5 and next_attempt<=now() order by created_at for update skip locked limit 15
 ), claimed as (
 update public.work_notifications n set whatsapp='sending',attempts=attempts+1,next_attempt=now() from candidates c where n.id=c.id returning n.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'recipient',c.recipient,'message',c.message,'request_id',c.request_id,'attempts',c.attempts,'phone',coalesce(nullif(p.phone,''),u.phone))),'[]') into result from claimed c join auth.users u on u.id=c.recipient left join public.account_profiles p on p.user_id=c.recipient;
 return result;
end; $$;
revoke all on function public.work_notification_claim() from public,anon,authenticated;
grant execute on function public.work_notification_claim() to service_role;
commit;
