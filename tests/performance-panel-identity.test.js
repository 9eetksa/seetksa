import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelUrl = new URL('../src/workflow/PerformancePanel.jsx', import.meta.url);
const stylesUrl = new URL('../src/workflow/performance-panel.css', import.meta.url);

test('team performance cards expose job titles and department responsibility', async () => {
  const panel = await readFile(panelUrl, 'utf8');

  assert.match(panel, /person\.job_title/);
  assert.match(panel, /المسمى الوظيفي غير محدد/);
  assert.match(panel, /person\.departments/);
  assert.match(panel, /person\.responsible_departments/);
  assert.match(panel, /department\.member_role\)\.toLowerCase\(\) === 'lead'/);
  assert.match(panel, /الأقسام المرتبطة بالموظف/);
  assert.match(panel, /لا توجد أقسام مرتبطة/);
  assert.match(panel, />\s*مسؤول\s*</);
  assert.match(panel, /person\.pending_setup/);
  assert.match(panel, /بانتظار تفعيل الحساب/);
});

test('team performance cards remain bounded on narrow screens', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.op-person-card[\s\S]*?min-width:\s*0/);
  assert.match(styles, /\.op-person-department-name[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(max-width:\s*420px\)/);
  assert.doesNotMatch(styles, /100vw/);
  assert.match(styles, /\.op-person-setup-status\s*\{/);
});

test('pending account setup overrides incomplete and calculated performance states', async () => {
  const panel = await readFile(panelUrl, 'utf8');

  assert.match(panel, /const performanceState = pendingSetup \? 'pending_setup' : insufficient \? 'insufficient' : 'ready'/);
  assert.match(panel, /performanceState === 'insufficient'/);
  assert.match(panel, /state=\{performanceState\}/);
  assert.match(panel, /value=\{unavailable \? 0 : current\}/);
  assert.match(panel, /aria-valuetext=\{pendingSetup \? 'بانتظار تفعيل الحساب'/);
  assert.match(panel, /!pendingSetup && numeric\(person\.estimated_count\) > 0/);
});

test('selected performance period has a persistent structural indicator', async () => {
  const styles = await readFile(stylesUrl, 'utf8');

  assert.match(styles, /\.op-period-picker button\s*\{[\s\S]*?border-width:\s*2px/);
  assert.match(styles, /\.op-period-picker button\[aria-pressed='true'\]\s*\{[\s\S]*?border-color:\s*#d6fc79/);
  assert.match(styles, /\.op-period-picker button\[aria-pressed='true'\]::before\s*\{[\s\S]*?opacity:\s*1/);
});
