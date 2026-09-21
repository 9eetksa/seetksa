import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTeamReport, handlesCustomerCommunication } from '../src/admin/team-report-data.js';
import { createTeamPdf } from '../src/admin/team-report-pdf.js';

const range = { start: '2026-09-01', end: '2026-09-15' };
const employee = { name: 'مسؤول التواصل للفحص', job_title: 'مسؤول التواصل', coordinator: true, employment_type: 'regular', departments: [], performance_score: 0, received_count: 12, delivered_count: 10, late_count: 2 };

test('report snapshot preserves zero ratings and coordinator display with filtered totals', () => {
  const people = [employee, { name: '=SUM(A1:A2)', pending_setup: true, received_count: 3, delivered_count: 1 }, { name: 'موظف جديد', insufficient_data: true }];
  const report = createTeamReport(people, range, 'مسؤول', '2026-09-14T21:15:00Z');
  assert.deepEqual(report.rows[0], [`${employee.name}\nنوع الموظف موظف منتظم`, employee.job_title, 'التواصل مع العملاء', 0, 12, 10, 2]);
  assert.equal(report.rows[1][0], '=SUM(A1:A2)\nنوع الموظف غير محدد');
  assert.equal(report.rows[1][3], 'بانتظار تفعيل الحساب');
  assert.equal(report.rows[2][3], 'بيانات غير كافية');
  assert.deepEqual(report.totals, { people: 3, received: 15, delivered: 11, late: 2 });
  assert.match(report.filterLabel, /مسؤول/);
  assert.match(report.generatedLabel, /2026-09-15/);
  assert.equal(employee.departments.length, 0);
});

test('explicit coordinator flags override titles and reports retain unknown employment types', () => {
  assert.equal(handlesCustomerCommunication({ ...employee, coordinator: false }), false);
  assert.equal(handlesCustomerCommunication({ job_title: ' مسؤول التواصل ' }), true);
  assert.equal(handlesCustomerCommunication({ job_title: 'مصمم', coordinator: true }), true);
  const report = createTeamReport([
    { ...employee, coordinator: false, employment_type: 'freelancer' },
    { ...employee, employment_type: null },
    { ...employee, employment_type: 'unknown' },
  ], range);
  assert.equal(report.rows[0][2], 'لم يحدد قسم بعد');
  assert.match(report.rows[0][0], /نوع الموظف فريلانسر/);
  assert.match(report.rows[1][0], /نوع الموظف غير محدد/);
  assert.match(report.rows[2][0], /نوع الموظف غير محدد/);
});

test('report keeps lead responsibilities without duplicate departments', () => {
  const report = createTeamReport([{ ...employee, coordinator: true, departments: [{ id: 'd1', name: 'التصميم' }], responsible_departments: [{ id: 'd1', name: 'التصميم' }] }], range);
  assert.equal(report.rows[0][2], 'التواصل مع العملاء\nالتصميم مسؤول القسم');
});

test('PDF exports actual multipage text tables with embedded Arabic fonts and repeated headers', async () => {
  const fonts = await Promise.all(['Regular', 'SemiBold'].map(async weight => (await readFile(new URL(`../public/fonts/pdf/IBMPlexSansArabic-${weight}.ttf`, import.meta.url))).toString('base64')));
  const report = createTeamReport(Array.from({ length: 65 }, (_, index) => ({ ...employee, name: `موظف الفحص ${index + 1}` })), range, '', '2026-09-15T00:15:00Z');
  const bytes = await createTeamPdf(report, fonts);
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  try {
    assert.ok(pdf.numPages > 1);
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items.map(item => item.str).join(' ').normalize('NFKC');
      assert.match(text, /الموظف/);
      assert.match(text, /التواصل مع العملاء/);
      assert.match(text, /نوع الموظف موظف منتظم/);
      if (page === 1) {
        assert.ok(text.includes(range.start));
        assert.ok(text.includes(range.end));
        assert.ok(!text.includes('01-09-2026'));
      }
      assert.ok(!text.includes('�'));
    }
  } finally { await pdf.destroy(); }
});
