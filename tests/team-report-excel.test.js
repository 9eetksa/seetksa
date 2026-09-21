import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createTeamWorkbook } from '../src/admin/team-report-excel.js';
import { createTeamReport } from '../src/admin/team-report-data.js';

const report = {
  title: 'تقرير أداء الفريق',
  periodLabel: 'الفترة من ١ إلى ١٥ سبتمبر ٢٠٢٦',
  filterLabel: 'البحث مسؤول التواصل',
  generatedLabel: 'أعد في ١٥ سبتمبر ٢٠٢٦ بتوقيت الرياض',
  headers: ['الموظف', 'المسمى الوظيفي', 'الأقسام والمسؤوليات', 'التقييم', 'المستلمة', 'المسلمة', 'المتأخرة'],
  rows: [
    ['أحمد محمد', 'مسؤول التواصل', 'التواصل مع العملاء', 87.5, 12, 9, 2],
    ['سارة علي', 'مصممة', 'التصميم', 0, 3, 0, 1],
    ['نورة سالم', 'محررة', 'المحتوى', 'بيانات غير كافية', 0, 0, 0],
  ],
  totals: { people: 3, received: 15, delivered: 9, late: 3 },
};

async function readReport(input = report) {
  const bytes = await createTeamWorkbook(input);
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString('hex'), '504b0304');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.worksheets.length, 1);
  return workbook.getWorksheet('تقرير الفريق');
}

test('native Arabic workbook roundtrip preserves report context and sortable numeric data', async () => {
  const before = structuredClone(report);
  const sheet = await readReport();
  assert.deepEqual(report, before);
  assert.equal(sheet.getCell('A1').value, report.title);
  assert.equal(sheet.getCell('A2').value, report.periodLabel);
  assert.equal(sheet.getCell('A3').value, report.filterLabel);
  assert.equal(sheet.getCell('A4').value, report.generatedLabel);
  assert.equal(sheet.getCell('D5').value, 3);
  assert.deepEqual(sheet.getRow(7).values.slice(1), report.headers);
  for (let index = 0; index < report.rows.length; index += 1) {
    assert.deepEqual(sheet.getRow(8 + index).values.slice(1), report.rows[index]);
  }
  assert.equal(sheet.getCell('D8').type, ExcelJS.ValueType.Number);
  assert.equal(sheet.getCell('D9').value, 0);
  assert.equal(sheet.getCell('D10').type, ExcelJS.ValueType.String);
  for (const coordinate of ['E8', 'F8', 'G8', 'E10', 'F10', 'G10']) {
    assert.equal(sheet.getCell(coordinate).type, ExcelJS.ValueType.Number);
  }
  assert.deepEqual(['E12', 'F12', 'G12'].map(address => sheet.getCell(address).value), [15, 9, 3]);

  const table = sheet.getTable('TeamReport').table;
  assert.equal(table.headerRow, true);
  assert.equal(table.style.showRowStripes, true);
  assert.equal(table.columns.length, 7);
  assert.ok(table.columns.every(column => column.filterButton));
  assert.equal(sheet.views[0].rightToLeft, true);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].xSplit, 1);
  assert.equal(sheet.views[0].ySplit, 7);
  assert.equal(sheet.pageSetup.orientation, 'landscape');
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  assert.equal(sheet.pageSetup.printTitlesRow, '7:7');
  assert.equal(sheet.getCell('A7').font.bold, true);
  assert.equal(sheet.getCell('A7').fill.fgColor.argb, 'FF174B3E');
});

test('formula-like employee names and report labels remain literal strings', async () => {
  const formula = '=HYPERLINK("https://example.com","اسم")';
  const rows = [
    [formula, '+SUM(1+2)', '@SUM(A1:A2)', 'بيانات غير كافية', 0, 0, 0],
    ['-SUM(A1:A2)', '\t=1+1', '=1+1', 0, 1, 0, 0],
  ];
  const sheet = await readReport({ ...report, title: formula, filterLabel: formula, rows });
  assert.equal(sheet.getCell('A1').value, formula);
  assert.equal(sheet.getCell('A3').value, formula);
  for (let index = 0; index < rows.length; index += 1) {
    for (let column = 0; column < 3; column += 1) {
      const cell = sheet.getCell(index + 8, column + 1);
      assert.equal(cell.value, rows[index][column]);
      assert.equal(cell.type, ExcelJS.ValueType.String);
      assert.equal(cell.formula, undefined);
      assert.equal(cell.hyperlink, undefined);
    }
  }
});

test('long Arabic department text is preserved with wrapping and adequate row space', async () => {
  const departments = Array.from({ length: 8 }, (_, index) =>
    `القسم ${index + 1} إعداد ومراجعة الأعمال وتنسيق المهام ومتابعة جميع تفاصيل التنفيذ قبل التسليم`,
  ).join('\n');
  const rows = [[report.rows[0][0], report.rows[0][1], departments, 0, 0, 0, 0]];
  const sheet = await readReport({ ...report, rows });
  assert.equal(sheet.getCell('C8').value, departments);
  assert.equal(sheet.getCell('C8').alignment.wrapText, true);
  assert.equal(sheet.getCell('C8').alignment.readingOrder, 'rtl');
  assert.ok(sheet.getColumn(3).width >= 60);
  assert.ok(sheet.getRow(8).height >= 300);
});

test('employee type and coordinator departments survive a native report workbook roundtrip', async () => {
  const snapshot = createTeamReport([
    { name: 'مصمم الفريق', employment_type: 'freelancer', coordinator: true, departments: [{ id: 'design', name: 'التصميم' }] },
    { name: 'موظف سابق', employment_type: null, coordinator: false, job_title: 'مسؤول التواصل' },
  ], { start: '2026-09-01', end: '2026-09-15' });
  const sheet = await readReport(snapshot);
  assert.equal(sheet.getCell('A8').value, 'مصمم الفريق\nنوع الموظف فريلانسر');
  assert.equal(sheet.getCell('C8').value, 'التواصل مع العملاء\nالتصميم');
  assert.equal(sheet.getCell('A9').value, 'موظف سابق\nنوع الموظف غير محدد');
  assert.equal(sheet.getCell('C9').value, 'لم يحدد قسم بعد');
  assert.equal(sheet.getCell('E8').type, ExcelJS.ValueType.Number);
});
