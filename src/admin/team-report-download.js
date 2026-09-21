export async function downloadTeamReport(format, report, range) {
  let bytes;
  let type;
  if (format === 'xlsx') {
    const { createTeamWorkbook } = await import('./team-report-excel');
    bytes = await createTeamWorkbook(report);
    type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (format === 'pdf') {
    const { createTeamPdf } = await import('./team-report-pdf');
    bytes = await createTeamPdf(report);
    type = 'application/pdf';
  } else throw new Error('Unsupported report format');
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `team-report-${range.start}-${range.end}.${format}`;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
