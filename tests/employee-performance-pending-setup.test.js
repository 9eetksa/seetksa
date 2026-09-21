import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl=new URL("../supabase/migrations/20260910130000_employee_performance_pending_setup.sql",import.meta.url);

test("employee performance includes pending setup accounts without weakening access",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  assert.match(sql,/create or replace function public\.work_employee_performance\(p_days integer default 30\)/);
  assert.match(sql,/returns jsonb language plpgsql stable security definer set search_path=''/);
  assert.match(sql,/role_name not in\('employee','admin','super_admin'\) or not provision_private\.account_ready\(\)/);
  assert.match(sql,/employee\.raw_app_meta_data->>'role'='employee'/);
  assert.match(sql,/role_name in\('admin','super_admin'\) or employee\.id=auth\.uid\(\)/);
  assert.match(sql,/not coalesce\(employee\.is_anonymous,false\)/);
  assert.match(sql,/employee\.banned_until is null or employee\.banned_until<now\(\)/);
  assert.match(sql,/coalesce\(employee\.raw_app_meta_data->>'must_change_password','false'\)='true' as pending_setup/);
  assert.match(sql,/'pending_setup',pending_setup/);
  assert.doesNotMatch(sql,/must_change_password','false'\)<>'true'/);
  assert.match(sql,/join people person on person\.id=part\.assignee_id/);
  assert.match(sql,/group by person\.id,person\.name,person\.job_title,person\.pending_setup/);
  assert.match(sql,/revoke all on function public\.work_employee_performance\(integer\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.work_employee_performance\(integer\) to authenticated/);
});
