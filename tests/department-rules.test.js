import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDepartmentDraft,
  departmentToDraft,
  prepareDepartmentPayload,
  validateDepartmentDraft,
} from '../src/workflow/department-rules.js';

const staff = [
  { id: '42b1a038-5ef6-4df1-a6f8-88998325aa40', name: 'أحمد' },
  { id: 'a6174b2e-e5f2-40eb-b8b1-c299d06020d4', name: 'سارة' },
];

function validDraft() {
  return {
    ...createDepartmentDraft(),
    name: 'قسم طباعة المنشورات',
    slug: 'print-production',
    description: 'يدير تجهيز الملفات والطباعة',
    target_hours: '36.5',
    default_effort_points: '7.5',
    sort_order: '30',
    responsibilities: ['مراجعة مواصفات الطباعة', 'ضمان جودة المخرجات'],
    tasks: ['تجهيز ملفات الطباعة'],
    member_ids: staff.map(person => person.id),
    lead_user_id: staff[0].id,
  };
}

test('builds the database payload with bounded numeric fields and explicit membership', () => {
  const result = prepareDepartmentPayload(validDraft(), staff);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
  assert.equal(result.payload.default_target_minutes, 2190);
  assert.equal(result.payload.default_effort_points, 7.5);
  assert.equal(result.payload.sort_order, 30);
  assert.equal(result.payload.version, null);
  assert.deepEqual(result.payload.member_ids, staff.map(person => person.id));
  assert.equal(result.payload.lead_user_id, staff[0].id);
  assert.equal('members' in result.payload, false);
  assert.equal('target_hours' in result.payload, false);
});

test('normalizes directory members into editable member ids and one lead', () => {
  const draft = departmentToDraft({
    id: 'department-1',
    name: 'الطباعة',
    default_target_minutes: 90,
    members: [
      { user_id: staff[0].id, member_role: 'lead' },
      { user_id: staff[1].id, member_role: 'member' },
      { user_id: staff[1].id, member_role: 'member' },
    ],
    responsibilities: [
      { id: 'responsibility-2', text: 'ضمان الجودة', sort_order: 20 },
      { id: 'responsibility-1', text: 'مراجعة الملفات', sort_order: 10 },
    ],
    tasks: [{ id: 'task-1', title: 'تجهيز الطباعة', sort_order: 10 }],
  });

  assert.deepEqual(draft.member_ids, staff.map(person => person.id));
  assert.equal(draft.lead_user_id, staff[0].id);
  assert.equal(draft.target_hours, 1.5);
  assert.deepEqual(draft.responsibilities, ['مراجعة الملفات', 'ضمان الجودة']);
  assert.deepEqual(draft.tasks, ['تجهيز الطباعة']);
});

test('keeps one editable row for directory departments with empty scope', () => {
  const draft = departmentToDraft({ responsibilities: [], tasks: [] });
  assert.deepEqual(draft.responsibilities, ['']);
  assert.deepEqual(draft.tasks, ['']);
});

test('normalizes stopped departments as hidden from clients', () => {
  const draft = departmentToDraft({ active: false, client_visible: true });
  assert.equal(draft.client_visible, false);
});

test('rejects duplicate scope entries and incomplete membership', () => {
  const draft = validDraft();
  draft.responsibilities = ['مراجعة الملف', ' مراجعة الملف '];
  draft.tasks = [];
  draft.member_ids = [];
  draft.lead_user_id = '';

  const errors = validateDepartmentDraft(draft, staff);
  assert.match(errors.responsibilities, /مختلفة/);
  assert.ok(errors.tasks);
  assert.ok(errors.members);
  assert.ok(errors.lead_user_id);
});

test('rejects values outside database limits and unknown staff ids', () => {
  const draft = validDraft();
  draft.name = 'ق';
  draft.slug = 'Print Department';
  draft.category = '';
  draft.description = 'و'.repeat(601);
  draft.target_hours = 0.25;
  draft.default_effort_points = 101;
  draft.sort_order = 3.5;
  draft.member_ids = ['unknown-user'];
  draft.lead_user_id = 'unknown-user';

  const errors = validateDepartmentDraft(draft, staff);
  for (const field of [
    'name',
    'slug',
    'category',
    'description',
    'target_hours',
    'default_effort_points',
    'sort_order',
    'members',
  ]) assert.ok(errors[field], `expected ${field} validation error`);
});

test('rejects effort precision beyond the database contract', () => {
  const draft = validDraft();
  draft.default_effort_points = '1.234';
  assert.ok(validateDepartmentDraft(draft, staff).default_effort_points);
});

test('deduplicates selected members and includes the selected lead in the payload', () => {
  const draft = validDraft();
  draft.member_ids = [staff[1].id, staff[1].id];
  draft.lead_user_id = staff[0].id;

  const result = prepareDepartmentPayload(draft, staff);
  assert.equal(result.valid, true);
  assert.deepEqual(result.payload.member_ids, [staff[1].id, staff[0].id]);
  assert.equal(result.payload.lead_user_id, staff[0].id);
});

test('rejects unavailable members when the active staff directory is empty', () => {
  const draft = validDraft();
  assert.ok(validateDepartmentDraft(draft, []).members);
});

test('accepts exact database limits and rejects one extra scope item', () => {
  const draft = validDraft();
  draft.name = 'ق'.repeat(100);
  draft.slug = 'a'.repeat(90);
  draft.category = 'م'.repeat(80);
  draft.description = 'و'.repeat(600);
  draft.target_hours = 8760;
  draft.default_effort_points = 100;
  draft.sort_order = 10000;
  draft.responsibilities = Array.from({ length: 50 }, (_, index) => `مسؤولية ${index + 1}`);
  draft.responsibilities[0] = 'ر'.repeat(500);
  draft.tasks = Array.from({ length: 80 }, (_, index) => `مهمة ${index + 1}`);
  draft.tasks[0] = 'م'.repeat(300);

  assert.deepEqual(validateDepartmentDraft(draft, staff), {});
  draft.responsibilities.push('مسؤولية إضافية');
  assert.ok(validateDepartmentDraft(draft, staff).responsibilities);
});

test('bounds department membership to the database contract', () => {
  const largeStaff = Array.from({ length: 200 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    name: `موظف ${index + 1}`,
  }));
  const draft = validDraft();
  draft.member_ids = largeStaff.map(person => person.id);
  draft.lead_user_id = largeStaff[0].id;

  assert.deepEqual(validateDepartmentDraft(draft, largeStaff), {});
  draft.member_ids.push('00000000-0000-4000-8000-0000000000ff');
  assert.ok(validateDepartmentDraft(draft, largeStaff).members);
});

test('maximum valid Arabic payload fits the bounded RPC envelope', () => {
  const largeStaff = Array.from({ length: 200 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    name: `موظف ${index + 1}`,
  }));
  const draft = validDraft();
  draft.responsibilities = Array.from({ length: 50 }, (_, index) => `${String(index).padStart(3, '0')}${'ر'.repeat(497)}`);
  draft.tasks = Array.from({ length: 80 }, (_, index) => `${String(index).padStart(3, '0')}${'م'.repeat(297)}`);
  draft.member_ids = largeStaff.map(person => person.id);
  draft.lead_user_id = largeStaff[0].id;
  const result = prepareDepartmentPayload(draft, largeStaff);
  const bytes = new TextEncoder().encode(JSON.stringify(result.payload)).byteLength;

  assert.equal(result.valid, true);
  assert.ok(bytes > 65536);
  assert.ok(bytes <= 262144);
});
