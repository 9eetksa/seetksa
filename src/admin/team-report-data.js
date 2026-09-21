import { riyadhToday } from './team-overview-periods.js';
import { employmentTypeLabel, handlesCustomerCommunication } from '../workflow/staff-identity.js';

export { handlesCustomerCommunication } from '../workflow/staff-identity.js';

export function teamDepartmentText(person) {
  const leads = person.responsible_departments || [];
  return [
    ...(handlesCustomerCommunication(person) ? ['الإشراف على الطلبات'] : []),
    ...leads.map(item => `${item.name} مسؤول القسم`),
    ...(person.departments || []).filter(item => !leads.some(lead => lead.id === item.id)).map(item => item.name),
  ].join('\n') || 'لم يحدد قسم بعد';
}

export function createTeamReport(people, range, search = '', generatedAt = new Date()) {
  const generated = new Date(generatedAt);
  const time = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const count = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const rows = people.map(person => [
    `${person.name || 'موظف'}\nنوع الموظف ${employmentTypeLabel(person.employment_type)}`, person.job_title || '', teamDepartmentText(person),
    person.pending_setup ? 'بانتظار تفعيل الحساب' : person.insufficient_data || person.performance_score == null ? 'بيانات غير كافية' : count(person.performance_score),
    count(person.received_count), count(person.delivered_count), count(person.late_count),
  ]);
  return {
    title: 'تقرير الفريق',
    periodLabel: `${range.start} إلى ${range.end} بتوقيت الرياض`,
    periodStart: range.start,
    periodEnd: range.end,
    generatedDate: Number.isFinite(generated.getTime()) ? riyadhToday(generated) : '',
    generatedTime: Number.isFinite(generated.getTime()) ? time.format(generated) : '',
    filterLabel: search.trim() ? `نتائج البحث ${search.trim()}` : 'جميع الموظفين',
    generatedLabel: Number.isFinite(generated.getTime()) ? `وقت البيانات ${riyadhToday(generated)} ${time.format(generated)} بتوقيت الرياض` : '',
    headers: ['الموظف', 'المسمى الوظيفي', 'القسم والمسؤولية', 'التقييم من 100', 'استلم', 'سلم', 'متأخرة'],
    rows,
    totals: rows.reduce((totals, row) => ({ people: totals.people + 1, received: totals.received + row[4], delivered: totals.delivered + row[5], late: totals.late + row[6] }), { people: 0, received: 0, delivered: 0, late: 0 }),
  };
}
