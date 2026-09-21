import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl=new URL("../supabase/migrations/20260909120000_operations_command_center.sql",import.meta.url);

test("operations migration exposes bounded service and performance contracts",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  assert.match(sql,/create or replace function public\.work_service_catalog\(p_include_inactive boolean default false\)/);
  assert.match(sql,/default_target_minutes between 30 and 525600/);
  assert.match(sql,/default_effort_points between 0\.5 and 100/);
  assert.match(sql,/create policy work_services_read[\s\S]*using\(provision_private\.account_ready\(\) and active\)/);
  assert.match(sql,/add column if not exists requested_service_id uuid references public\.work_services\(id\)/);
  assert.match(sql,/create or replace function provision_private\.work_requested_service\(\)/);
  assert.match(sql,/create or replace function public\.work_employee_performance\(p_days integer default 30\)/);
  assert.match(sql,/s\.speed_score\*\.65\+s\.volume_score\*\.35/);
  assert.match(sql,/s\.completed_count<5 or s\.completed_points<10/);
  const performance=sql.slice(sql.indexOf("create or replace function public.work_employee_performance"),sql.indexOf("-- Channel preferences"));
  assert.doesNotMatch(performance,/work_coordinator\(\)/);
  assert.match(performance,/\) order by name\),'\[\]'::jsonb\)/);
  assert.match(sql,/h\.previous_assignee is distinct from h\.next_assignee/);
  assert.doesNotMatch(sql,/scored asles/);
});

test("workflow reads cross the explicit database shield",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  for(const name of ["work_workspace","work_request_snapshot","work_request_detail","work_file_receipt","work_notifications_page"])
    assert.match(sql,new RegExp(`create or replace function public\\.${name}\\(`));
  assert.match(sql,/revoke select on public\.work_requests,public\.work_parts,public\.work_dependencies/);
  assert.match(sql,/revoke select on public\.work_notifications from authenticated/);
  assert.match(sql,/grant select\(notification_id,recipient,request_id,created_at\) on public\.work_notification_signals/);
  assert.match(sql,/request_id uuid references public\.work_requests\(id\) on delete cascade/);
  assert.match(sql,/alter publication supabase_realtime drop table public\.work_notifications/);
  assert.match(sql,/alter publication supabase_realtime add table public\.work_notification_signals/);
  assert.doesNotMatch(sql,/where service_id=service_id/);
});

test("notification preferences preserve in app delivery and gate WhatsApp",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  assert.match(sql,/create table if not exists public\.work_notification_preferences/);
  assert.match(sql,/update public\.work_notifications set whatsapp='suppressed'/);
  assert.match(sql,/create or replace function public\.work_mark_notifications_read\(\)/);
  assert.match(sql,/recipient=auth\.uid\(\) and read_at is null/);
});
