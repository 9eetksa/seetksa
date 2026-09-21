import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl=new URL("../supabase/migrations/20260910120000_department_management.sql",import.meta.url);

test("department management has normalized protected storage",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  assert.match(sql,/alter table public\.work_services[\s\S]*client_visible boolean not null default true[\s\S]*version integer not null default 1[\s\S]*updated_at timestamptz not null default now\(\)/);
  assert.match(sql,/create table public\.work_department_responsibilities\([\s\S]*service_id uuid not null references public\.work_services\(id\) on delete cascade/);
  assert.match(sql,/create table public\.work_department_tasks\([\s\S]*service_id uuid not null references public\.work_services\(id\) on delete cascade/);
  for(const table of ["work_department_responsibilities","work_department_tasks"]){
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql,new RegExp(`revoke all on public\\.${table} from public,anon,authenticated`));
    assert.doesNotMatch(sql,new RegExp(`create policy [^\\n]+ on public\\.${table}`));
  }
  assert.match(sql,/member_role text not null default 'member'/);
  assert.match(sql,/check\(member_role in\('member','lead'\)\)/);
  assert.match(sql,/create unique index work_memberships_one_lead_per_department[\s\S]*where member_role='lead'/);
});

test("department RPCs are shielded authorized bounded and atomic",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  for(const signature of ["work_department_directory\\(\\)","work_department_save\\(jsonb\\)"]){
    assert.match(sql,new RegExp(`revoke all on function public\\.${signature} from public,anon,authenticated`));
    assert.match(sql,new RegExp(`grant execute on function public\\.${signature} to authenticated`));
  }
  const save=sql.slice(sql.indexOf("create or replace function public.work_department_save"),sql.indexOf("-- The editor gets only"));
  assert.match(save,/security definer set search_path=''/);
  assert.match(save,/if not coalesce\(provision_private\.allowed\('departments\.manage'\),false\)[\s\S]*raise exception 'forbidden'/);
  assert.doesNotMatch(save,/work_role\(\)='super_admin'\s+or/);
  assert.match(save,/octet_length\(p::text\)>262144/);
  assert.match(save,/jsonb_array_length\(p->'responsibilities'\) not between 1 and 50/);
  assert.match(save,/jsonb_array_length\(p->'tasks'\) not between 1 and 80/);
  assert.match(save,/jsonb_array_length\(p->'member_ids'\) not between 1 and 200/);
  assert.match(save,/or lead_id is null/);
  assert.match(save,/duplicate_department_item/);
  assert.match(save,/lead_must_be_member/);
  assert.match(save,/raw_app_meta_data->>'role'='employee'/);
  assert.match(save,/where service\.id=target_id for update/);
  assert.match(save,/current_version<>expected_version then raise exception 'department_version_conflict'/);
  assert.match(save,/request\.status<>'completed'/);
  assert.match(save,/part\.status not in\('approved','forwarded','internal_done'\)/);
  assert.match(save,/insert into provision_private\.audit/);
  assert.match(save,/return jsonb_build_object\('id',target_id,'version',saved_version\)/);
  assert.doesNotMatch(save,/execute\s+format|\|\|\s*p->>/i);

  const directory=sql.slice(sql.indexOf("create or replace function public.work_department_directory"),sql.indexOf("-- Performance cards"));
  assert.match(directory,/returns jsonb language plpgsql stable security definer set search_path=''/);
  assert.match(directory,/if not coalesce\(provision_private\.allowed\('departments\.manage'\),false\)/);
  assert.match(directory,/'responsibilities',[\s\S]*'tasks',[\s\S]*'members'/);
  assert.match(directory,/'job_title'/);
  assert.match(directory,/'responsible_departments'/);
  assert.match(directory,/join auth\.users employee[\s\S]*must_change_password[\s\S]*banned_until/);
  assert.doesNotMatch(directory,/'email'|raw_app_meta_data'|raw_user_meta_data'/);
});

test("permissions visibility setup and performance contracts are upgraded",async()=>{
  const sql=await readFile(migrationUrl,"utf8");
  assert.match(sql,/permission not in\('users\.read','content\.edit','appearance\.edit','maintenance\.manage','audit\.read','departments\.manage'\)/);
  assert.match(sql,/revoke all on function public\.work_service_save\(jsonb\) from public,anon,authenticated/);
  assert.match(sql,/create policy work_services_read[\s\S]*provision_private\.work_role\(\)<>'client' or client_visible/);
  const catalog=sql.slice(sql.indexOf("create or replace function public.work_service_catalog"),sql.indexOf("-- Only the owner"));
  assert.match(catalog,/role_name<>'client' or \(s\.active and s\.client_visible\)/);

  const setup=sql.slice(sql.indexOf("create or replace function public.work_setup"),sql.indexOf("-- Department editing"));
  assert.doesNotMatch(setup,/(?:insert into|delete from|update public\.)work_memberships/);
  assert.match(setup,/insert into public\.work_staff/);

  const performance=sql.slice(sql.indexOf("create or replace function public.work_employee_performance"),sql.indexOf("notify pgrst"));
  assert.match(performance,/employee\.raw_app_meta_data->>'role'='employee'/);
  assert.match(performance,/must_change_password/);
  assert.match(performance,/role_name in\('admin','super_admin'\) or employee\.id=auth\.uid\(\)/);
  assert.match(performance,/'job_title',job_title/);
  assert.match(performance,/'departments',departments/);
  assert.match(performance,/'responsible_departments',responsible_departments/);
  assert.match(performance,/join people person on person\.id=part\.assignee_id/);
  assert.doesNotMatch(performance,/work_grants|work_manage\(part\.service_id\)/);
});
