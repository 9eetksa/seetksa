begin;
-- Expose the existing relationship only within the planner's already authorized personal task rows
do $migration$
declare body text; needle text;
begin
 body=pg_get_functiondef('public.work_personal_planner(text,text,integer,text,text)'::regprocedure);
 needle=$old$'output_due_required',p.output_due_required,$old$;
 if strpos(body,needle)=0 or strpos(body,$old$'output_parent_id',p.output_parent_id$old$)>0 then
  raise exception 'planner_output_identity_shape';
 end if;
 execute replace(body,needle,$new$'output_parent_id',p.output_parent_id,'output_due_required',p.output_due_required,$new$);
end $migration$;
notify pgrst,'reload schema';
commit;
