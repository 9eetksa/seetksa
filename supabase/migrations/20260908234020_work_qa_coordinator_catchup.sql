begin;

-- Disposable QA coordinators must catch up only on QA requests
-- Production coordinators continue to receive production intake only
do $migration$
declare body text;
begin
 body=pg_get_functiondef('provision_private.work_coordinator_intake_catchup(uuid)'::regprocedure);
 if position('and (not r.test or u.raw_app_meta_data->>''portal_qa''=''true'')' in body)=0 then
  raise exception 'coordinator_catchup_patch_mismatch';
 end if;
 body=replace(body,
  'and (not r.test or u.raw_app_meta_data->>''portal_qa''=''true'')',
  'and r.test=coalesce(u.raw_app_meta_data->>''portal_qa''=''true'',false)');
 execute body;
end;
$migration$;

commit;
