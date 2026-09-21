-- Keep authored message line breaks as real newlines rather than literal escape text
do $$
declare body text;
begin
 body=pg_get_functiondef('provision_private.work_client_event_message(bigint)'::regprocedure);
 body=replace(body,'E'||chr(39)||chr(92)||chr(92)||'n'||chr(39),'E'||chr(39)||chr(92)||'n'||chr(39));
 execute body;
end $$;
