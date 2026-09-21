begin;
-- A recipient role can change while a claim is being processed
-- Return only rows that remain sending after the notification policy trigger
do $$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_notification_claim()'::regprocedure);
 needle='from claimed c join auth.users u on u.id=c.recipient left join public.account_profiles p on p.user_id=c.recipient;';
 if strpos(body,needle)=0 then raise exception 'notification_claim_filter_shape'; end if;
 body=replace(body,needle,'from claimed c join auth.users u on u.id=c.recipient left join public.account_profiles p on p.user_id=c.recipient where c.whatsapp=''sending'';');
 execute body;
end;
$$;
commit;
