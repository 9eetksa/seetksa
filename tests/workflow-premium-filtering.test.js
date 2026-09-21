import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('team performance provides local operational filters while self view stays focused', async () => {
  const panel = await source('src/workflow/PerformancePanel.jsx');

  assert.match(panel, /viewer = 'team'/);
  assert.match(panel, /const selfView = viewer === 'self'/);
  assert.match(panel, /!selfView && !loading && !error && sourcePeople\.length > 0/);
  assert.match(panel, /className="op-performance-filters"/);
  assert.match(panel, /اسم الموظف أو المسمى الوظيفي/);
  assert.match(panel, /جاهزية القياس/);
  assert.match(panel, /option value="score">النتيجة الأعلى/);
});

test('notifications clearly filter only the loaded page', async () => {
  const center = await source('src/workflow/NotificationCenter.jsx');

  assert.match(center, /const filteredItems = useMemo/);
  assert.match(center, /البحث والتصفية في الصفحة الحالية/);
  assert.match(center, /تطبق أدوات البحث والتصفية على الصفحة الحالية فقط/);
  assert.match(center, /filteredItems\.map/);
  assert.match(center, /channelFilter === 'attention'/);
});

test('service discovery supports search category and deterministic sorting', async () => {
  const catalog = await source('src/workflow/ServiceCatalog.jsx');

  assert.match(catalog, /const filteredServices=useMemo/);
  assert.match(catalog, /اسم الخدمة أو وصفها/);
  assert.match(catalog, /كل التصنيفات/);
  assert.match(catalog, /الأسرع تنفيذا/);
  assert.match(catalog, /left\.sort_order\?\?100/);
});

test('task cards open server filtered categories with priority and ordering controls', async () => {
  const work = await source('src/workflow/TeamWork.jsx');
  const rows = await source('src/workflow/TaskDashboardRows.jsx');
  assert.match(work, /repository\.taskDashboard\(\{bucket:bucket\|\|'all',search,page,priority:clientPriority,sort:dashboardSort\}\)/);
  assert.match(work, /setFocus\(metric\.focus\);setPage\(0\);setSearch\(''\)/);
  assert.match(rows, /onBucket\(id\)/);
  assert.match(rows, /onPriority\(e\.target\.value\)/);
  assert.match(rows, /onSort\(e\.target\.value\)/);
  assert.match(rows, /client_review_overdue/);
});

test('employee account exposes available work identity and accessible responsive styling', async () => {
  const [workspace, styles] = await Promise.all([
    source('src/admin/Workspace.jsx'),
    source('src/workflow/workflow.css'),
  ]);

  assert.match(workspace, /repository\.performance\(30\)/);
  assert.match(workspace, /<PerformancePanel viewer="self"/);
  assert.match(workspace, /className="w-account-departments"/);
  assert.match(workspace, /className="w-owner-title"/);
  assert.match(styles, /\.w-account-facts \{display:grid;grid-template-columns:repeat\(2/);
  assert.match(styles, /@media\(max-width:420px\)/);
  assert.match(styles, /color:var\(--s-action-text,#052e23\)/);
  assert.match(styles, /scrollbar-width:none/);
});
