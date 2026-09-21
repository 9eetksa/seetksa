let fontPromise;

async function readFont(name) {
  const response = await fetch(`/fonts/pdf/IBMPlexSansArabic-${name}.ttf`);
  if (!response.ok) throw new Error('Unable to load report font');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function loadFonts() {
  if (!fontPromise) fontPromise = Promise.all([readFont('Regular'), readFont('SemiBold')]).catch(error => { fontPromise = null; throw error; });
  return fontPromise;
}

export async function createTeamPdf(report, fonts) {
  const [{ jsPDF }, { autoTable }, [regular, semibold]] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), fonts || loadFonts(),
  ]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS('Team-Regular.ttf', regular);
  doc.addFont('Team-Regular.ttf', 'Team', 'normal');
  doc.addFileToVFS('Team-SemiBold.ttf', semibold);
  doc.addFont('Team-SemiBold.ttf', 'Team', 'bold');
  doc.setProperties({ title: report.title, subject: report.periodLabel, creator: 'Seet' });
  const right = doc.internal.pageSize.getWidth() - 12;
  const write = (text, y, size = 10, style = 'normal') => {
    doc.setFont('Team', style).setFontSize(size).setTextColor(8, 39, 29).setR2L(false);
    doc.text(text, right, y, { align: 'right', isInputVisual: false, isOutputVisual: true, isInputRtl: true, isOutputRtl: false });
  };
  // Draw dates as isolated LTR runs so Arabic bidi cannot reorder their components
  const writeRuns = (runs, y, size = 10) => {
    let x = right;
    doc.setFont('Team', 'normal').setFontSize(size).setR2L(false);
    for (const [text, rtl] of runs) {
      doc.text(text, x, y, { align: 'right', isInputVisual: false, isOutputVisual: true, isInputRtl: rtl, isOutputRtl: false });
      x -= doc.getTextWidth(doc.processArabic(text)) + 3;
    }
  };
  write(report.title, 16, 18, 'bold');
  writeRuns([['من', true], [report.periodStart, false], ['إلى', true], [report.periodEnd, false], ['بتوقيت الرياض', true]], 24);
  const filterLines = doc.splitTextToSize(report.filterLabel, right - 12);
  write(filterLines, 31, 9);
  const startY = 36 + (filterLines.length - 1) * 4;
  autoTable(doc, {
    head: [[...report.headers].reverse()],
    body: report.rows.map(row => [...row].reverse()),
    foot: [[report.totals.late, report.totals.delivered, report.totals.received, { content: `إجمالي المهام لعدد ${report.totals.people} موظف`, colSpan: 4 }]],
    startY, margin: { top: 15, right: 12, bottom: 18, left: 12 },
    theme: 'grid', showHead: 'everyPage', showFoot: 'lastPage', rowPageBreak: 'avoid',
    styles: { font: 'Team', fontSize: 9, halign: 'right', valign: 'middle', cellPadding: 3, lineColor: [206, 218, 211], lineWidth: 0.15, overflow: 'linebreak', textColor: [8, 39, 29] },
    headStyles: { fillColor: [8, 55, 40], textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [223, 237, 228], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 248, 246] },
    columnStyles: { 0: { cellWidth: 22, halign: 'center' }, 1: { cellWidth: 22, halign: 'center' }, 2: { cellWidth: 22, halign: 'center' }, 3: { cellWidth: 34, halign: 'center' }, 4: { cellWidth: 82 }, 5: { cellWidth: 43 }, 6: { cellWidth: 48 } },
    didParseCell: ({ cell }) => { cell.text = cell.text.map(text => doc.processArabic(text)); },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    if (report.generatedDate) writeRuns([['وقت البيانات', true], [report.generatedDate, false], [report.generatedTime, false], ['بتوقيت الرياض', true]], 200, 8);
    doc.setR2L(false).setFontSize(8);
    doc.text(`${page} / ${pages}`, 12, 200);
  }
  return doc.output('arraybuffer');
}
