-- Routing mistakes are internal notifications for administration and communication
-- Preserve every other event audience and the existing action authorization
begin;
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('provision_private.work_event_client_notice_required(bigint)'::regprocedure);
 needle=$old$'missing','reject','routing','dependency'$old$;
 if strpos(body,needle)=0 then raise exception 'routing_client_notice_anchor_missing'; end if;
 execute replace(body,needle,$new$'missing','reject','dependency'$new$);

 -- The shared eligibility check protects in-app reads and queued dispatches
 -- Historical records remain intact and unreadable routing notices are not sent
 body=pg_get_functiondef('provision_private.work_notification_audience_eligible(uuid,text,uuid)'::regprocedure);
 needle=$old$then account.raw_app_meta_data->>'role'='client' and exists($old$;
 if strpos(body,needle)=0 then raise exception 'routing_client_audience_anchor_missing'; end if;
 body=replace(body,needle,$new$then account.raw_app_meta_data->>'role'='client'
     and not exists(
      select 1 from public.work_events internal_event
      where internal_event.request_id=p_request_id and internal_event.kind='routing'
       and p_event_key='journey:event:'||internal_event.id::text||':client'
     ) and exists($new$);
 execute body;
end $migration$;
commit;
