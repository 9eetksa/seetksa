begin;

-- A draft attachment remains a draft event after the request is submitted
-- Keep the history and the files but never turn it into a later notification
create function provision_private.work_event_is_draft_attachment(p_event_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.work_events event_row
  join public.work_requests request_row on request_row.id=event_row.request_id
  where event_row.id=p_event_id and event_row.kind='attach' and (
   request_row.status='draft'
   or event_row.created_at<request_row.submitted_at
   or exists(select 1 from public.work_events submitted
    where submitted.request_id=event_row.request_id and submitted.kind='submit_request'
     and submitted.id>event_row.id and submitted.created_at>=event_row.created_at)
  )
 )
$$;
revoke all on function provision_private.work_event_is_draft_attachment(bigint) from public,anon,authenticated;

do $migration$
declare body text; marker text; signature text;
begin
 body=pg_get_functiondef('provision_private.work_ensure_event_notifications(bigint)'::regprocedure);
 marker='if event_row.id is null then return 0; end if;';
 if position(marker in body)=0 then raise exception 'ensure_event_shape_changed';end if;
 execute replace(body,marker,marker||E'\n if provision_private.work_event_is_draft_attachment(p_event_id) then return 0; end if;');

 foreach signature in array array[
  'provision_private.work_event_coordinator_notice_required(bigint)',
  'provision_private.work_notification_integrity_tick()',
  'public.work_notification_contract_health()'
 ] loop
  body=pg_get_functiondef(signature::regprocedure);
  marker='request_row.status<>''draft''';
  if position(marker in body)=0 then raise exception 'draft_notice_shape_changed %',signature;end if;
  execute replace(body,marker,marker||' and not provision_private.work_event_is_draft_attachment(event_row.id)');
 end loop;

 -- One shared eligibility guard protects in-app reads claims manual retries
 -- and restoration of historical notification requirements without replaying sends
 body=pg_get_functiondef('provision_private.work_notification_audience_eligible(uuid,text,uuid)'::regprocedure);
 marker=' select not exists(select 1 from provision_private.work_output_requests o';
 if position(marker in body)=0 or position(E'\n$function$' in body)=0 then raise exception 'audience_shape_changed';end if;
 body=replace(body,marker,$guard$ select not exists(
  select 1 from public.work_events draft_event
  where draft_event.id=substring(p_event_key from '^(?:control|event|journey|department):event:([0-9]{1,18}):')::bigint
   and draft_event.request_id=p_request_id
   and provision_private.work_event_is_draft_attachment(draft_event.id)
 ) and (not exists(select 1 from provision_private.work_output_requests o$guard$);
 execute replace(body,E'\n$function$',E'\n )\n$function$');
end;
$migration$;

-- Do not alter delivery receipts or resend already delivered messages
-- Claim and read eligibility also excludes any historical draft attachment notices
notify pgrst,'reload schema';
commit;
