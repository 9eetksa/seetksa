const HEADER_ROW = 7;
const COLUMN_WIDTHS = [30, 28, 62, 22, 16, 16, 16];
const COLORS = {
  green: 'FF174B3E',
  ink: 'FF203D35',
  muted: 'FF577068',
  line: 'FFD9E5DF',
  alternate: 'FFF1F6F3',
  white: 'FFFFFFFF',
};
const FONT_NAME = 'IBM Plex Sans Arabic';

function wrappedHeight(values, widths = COLUMN_WIDTHS) {
  const lines = values.map((value, index) => String(value).split('\n').reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / (widths[index] * 0.7))),
    0,
  ));
  // Excel caps row heights at 409 points
  return Math.min(409, Math.max(34, Math.max(...lines) * 19 + 12));
}

function writeHeading(sheet, rowNumber, text, size, color, bold = false) {
  sheet.mergeCells(rowNumber, 1, rowNumber, 7);
  const cell = sheet.getCell(rowNumber, 1);
  cell.value = text;
  cell.font = { name: FONT_NAME, size, color: { argb: color }, bold };
  cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  sheet.getRow(rowNumber).height = Math.max(size + 15, wrappedHeight([text], [170]));
}

function styleTable(sheet, report) {
  sheet.addTable({
    name: 'TeamReport',
    ref: `A${HEADER_ROW}`,
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: report.headers.map(name => ({ name, filterButton: true })),
    // Plain strings stay shared-string cells including text beginning with = or +
    rows: report.rows.map(row => [...row]),
  });

  const header = sheet.getRow(HEADER_ROW);
  header.height = 36;
  header.eachCell(cell => {
    cell.font = { name: FONT_NAME, size: 12, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  });

  report.rows.forEach((values, index) => {
    const row = sheet.getRow(HEADER_ROW + index + 1);
    row.height = wrappedHeight(values);
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: FONT_NAME, size: 11, color: { argb: COLORS.ink } };
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: index % 2 ? COLORS.alternate : COLORS.white },
      };
      cell.border = { bottom: { style: 'hair', color: { argb: COLORS.line } } };
      cell.alignment = {
        horizontal: columnNumber < 4 ? 'right' : 'center',
        vertical: 'middle', wrapText: true, readingOrder: 'rtl',
      };
      if (columnNumber === 4 && typeof cell.value === 'number') cell.numFmt = '0.0';
      if (columnNumber > 4) cell.numFmt = '0';
    });
  });
}

/** Build a native XLSX file from the visible report snapshot */
export async function createTeamWorkbook(report) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Seet';
  workbook.title = report.title;
  const sheet = workbook.addWorksheet('تقرير الفريق', {
    properties: { defaultRowHeight: 30 },
    views: [{
      state: 'frozen', xSplit: 1, ySplit: HEADER_ROW, topLeftCell: `B${HEADER_ROW + 1}`,
      rightToLeft: true, showGridLines: false,
    }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 },
    },
  });
  sheet.columns = COLUMN_WIDTHS.map(width => ({ width }));
  writeHeading(sheet, 1, report.title, 22, COLORS.green, true);
  writeHeading(sheet, 2, report.periodLabel, 12, COLORS.ink);
  writeHeading(sheet, 3, report.filterLabel, 11, COLORS.muted);
  writeHeading(sheet, 4, report.generatedLabel, 11, COLORS.muted);
  sheet.mergeCells('A5:C5');
  sheet.getCell('A5').value = 'عدد الموظفين في التقرير';
  sheet.getCell('D5').value = report.totals.people;
  sheet.getRow(5).font = { name: FONT_NAME, size: 12, bold: true, color: { argb: COLORS.green } };
  sheet.getRow(5).alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' };
  sheet.getCell('D5').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('D5').numFmt = '0';
  sheet.getRow(6).height = 12;

  styleTable(sheet, report);

  const totalsRow = HEADER_ROW + report.rows.length + 2;
  sheet.mergeCells(totalsRow, 1, totalsRow, 4);
  sheet.getCell(totalsRow, 1).value = 'إجمالي المهام في التقرير';
  [report.totals.received, report.totals.delivered, report.totals.late].forEach((value, index) => {
    sheet.getCell(totalsRow, index + 5).value = value;
    sheet.getCell(totalsRow, index + 5).numFmt = '0';
  });
  const summary = sheet.getRow(totalsRow);
  summary.height = 34;
  summary.eachCell(cell => {
    cell.font = { name: FONT_NAME, size: 12, bold: true, color: { argb: COLORS.green } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.alternate } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  });
  sheet.pageSetup.printArea = `A1:G${totalsRow}`;
  return workbook.xlsx.writeBuffer();
}
