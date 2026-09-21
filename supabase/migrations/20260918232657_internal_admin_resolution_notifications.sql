-- Administrative escalation decisions stay internal and explain the employee's next action
-- Preserve action authorization locking state transitions version checks and historical records
begin;
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 needle=$old$perform provision_private.work_notify(a.assignee_id,r.id,'تم نقل المهمة إلى موظف آخر بقرار الإدارة');$old$;
 if strpos(body,needle)=0 then raise exception 'admin_resolve_previous_employee_shape'; end if;
 body=replace(body,needle,$new$perform provision_private.work_notify(a.assignee_id,r.id,'نقلت الإدارة مهمتك إلى موظف آخر'||E'\n'||'توضيح الإدارة '||why);$new$);
 needle=$old$perform provision_private.work_notify(target,r.id,'أحيلت إليك مهمة بقرار الإدارة يرجى الاستلام وتحديد الموعد');$old$;
 if strpos(body,needle)=0 then raise exception 'admin_resolve_new_employee_shape'; end if;
 body=replace(body,needle,$new$perform provision_private.work_notify(target,r.id,'كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد'||E'\n'||'توضيح الإدارة '||why);$new$);
 needle=$old$perform provision_private.work_notify(b.assignee_id,r.id,'اتخذت الإدارة قرارا بشأن اعتماد القسم على مخرجاتك' || E'\n' || why);$old$;
 if strpos(body,needle)=0 then raise exception 'admin_resolve_upstream_employee_shape'; end if;
 body=replace(body,needle,$new$perform provision_private.work_notify(b.assignee_id,r.id,case when p->>'decision'='enforce_dependency'
     then 'قررت الإدارة إلزامك بتوفير المخرجات المطلوبة للقسم'
     else 'قررت الإدارة متابعة مهمة القسم الآخر دون انتظار مخرجاتك' end||E'\n'||'توضيح الإدارة '||why);$new$);
 needle=$old$perform provision_private.work_notify(a.assignee_id,r.id,'صدر قرار الإدارة بشأن المهمة' || E'\n' || why); note=why;$old$;
 if strpos(body,needle)=0 then raise exception 'admin_resolve_source_employee_shape'; end if;
 body=replace(body,needle,$new$if p->>'decision'<>'reassign' then
    perform provision_private.work_notify(a.assignee_id,r.id,case p->>'decision'
     when 'keep' then 'قررت الإدارة استمرارك في تنفيذ المهمة'
     when 'enforce_dependency' then 'قررت الإدارة إلزام القسم بتوفير المخرجات'
     when 'waive_dependency' then 'قررت الإدارة متابعة المهمة دون انتظار مخرجات القسم'
    end||E'\n'||'توضيح الإدارة '||why);
   end if; note=why;$new$);
 execute body;

 body=pg_get_functiondef('provision_private.work_event_client_notice_required(bigint)'::regprocedure);
 needle=$old$'deliver','scope','resolve',$old$;
 if strpos(body,needle)=0 then raise exception 'admin_resolve_client_notice_shape'; end if;
 execute replace(body,needle,$new$'deliver','scope',$new$);

 -- This common predicate also prevents dispatch and in-app reads of already queued client notices
 body=pg_get_functiondef('provision_private.work_notification_audience_eligible(uuid,text,uuid)'::regprocedure);
 needle=$old$internal_event.kind='routing'$old$;
 if strpos(body,needle)=0 then raise exception 'admin_resolve_queued_client_shape'; end if;
 execute replace(body,needle,$new$internal_event.kind in('routing','resolve')$new$);

 -- Direct employee notices have no coordinator-event join and must not disappear through SQL NULL
 body=pg_get_functiondef('provision_private.work_notification_readable(uuid)'::regprocedure);
 needle=$old$and event_row.kind in('due_approved','due_auto_approved')$old$;
 if strpos(body,needle)=0 then raise exception 'admin_resolve_employee_readable_shape'; end if;
 execute replace(body,needle,$new$and coalesce(event_row.kind in('due_approved','due_auto_approved'),false)$new$);
end $migration$;
notify pgrst,'reload schema';
commit;
