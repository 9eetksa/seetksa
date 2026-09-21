import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminUrl = new URL("../src/admin/Admin.jsx", import.meta.url);
const dataUrl = new URL("../src/workflow/data.js", import.meta.url);
const settingsUrl = new URL("../src/workflow/WorkSettings.jsx", import.meta.url);

test("admin dashboard exposes permission gated department management", async () => {
  const admin = await readFile(adminUrl, "utf8");
  assert.match(admin, /lazy\(\(\)=>import\('\.\.\/workflow\/DepartmentManager'\)\)/);
  assert.match(admin, /\["departments",\s*Building2,\s*"إدارة الأقسام"\]/);
  assert.match(admin, /departments:\s*['"]departments\.manage['"]/);
  assert.match(admin, /can\('departments\.manage'\)&&<DepartmentManager/);
  assert.match(admin, /tab === 'departments'[\s\S]*<DepartmentManager/);
  assert.match(admin, /departmentDirty[\s\S]*تعديلات غير محفوظة/);
  assert.match(admin, /a-sidebar-logout[\s\S]*canLeaveDepartments/);
});

test("department management crosses the repository RPC shield", async () => {
  const data = await readFile(dataUrl, "utf8");
  assert.match(data, /departmentDirectory:\(\)=>result\(supabase\.rpc\('work_department_directory'\)\)/);
  assert.match(data, /saveDepartment:department=>result\(supabase\.rpc\('work_department_save',\{p:department\}\)\)/);
  assert.match(data, /saveDepartmentTeam:department=>result\(supabase\.rpc\('work_department_team_save',\{p:department\}\)\)/);
  assert.match(data, /saveService:service=>result\(supabase\.rpc\('work_catalog_service_save',\{p:service\}\)\)/);
});

test("legacy team settings directs department creation to the dedicated workspace", async () => {
  const settings = await readFile(settingsUrl, "utf8");
  assert.match(settings, /onDepartments/);
  assert.match(settings, /إدارة الأقسام/);
  assert.doesNotMatch(settings, /repository\.setup\('service'/);
});
