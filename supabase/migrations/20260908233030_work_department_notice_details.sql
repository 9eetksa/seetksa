begin;
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 -- Distinct departments remain distinct admin notices even when scopes match
 needle=$old$'أحيلت إليك مهمة جديدة يرجى الاستلام وتحديد موعد التسليم' || E'\n' || a.scope$old$;
 if strpos(body,needle)=0 then raise exception 'department_assignment_notice_shape'; end if;
 body=replace(body,needle,$new$'أحيلت مهمة جديدة إلى قسم ' || (select name from public.work_services where id=sid) || E'\nيرجى الاستلام وتحديد موعد التسليم\n' || a.scope$new$);
 needle=$old$'إلغاء اشتراط الاعتماد '||dep.id::text||E'\n'||why$old$;
 if strpos(body,needle)=0 then raise exception 'department_force_audit_shape'; end if;
 body=replace(body,needle,$new$'إلغاء انتظار مخرجات قسم '||(select s.name from public.work_parts source join public.work_services s on s.id=source.service_id where source.id=dep.upstream_id)||E'\n'||why$new$);
 execute body;
end;
$migration$;
commit;
