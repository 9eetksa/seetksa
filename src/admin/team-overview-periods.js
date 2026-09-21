export const TEAM_PERIODS = [
  { id: 'today', label: 'اليوم' },
  { id: 'last7', label: 'آخر 7 أيام' },
  { id: 'month', label: 'الشهر الحالي' },
  { id: 'lastMonth', label: 'الشهر الماضي' },
  { id: 'year', label: 'من بداية العام' },
  { id: 'custom', label: 'فترة مخصصة' },
];

const riyadhDateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Riyadh',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PERIOD_DAY_DIFFERENCE = 3660;

export function riyadhToday(now = new Date()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(
    riyadhDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBefore(date, count) {
  // Calendar arithmetic uses UTC only after extracting the civil date in Riyadh
  return new Date(Date.parse(`${date}T00:00:00Z`) - count * DAY_MS).toISOString().slice(0, 10);
}

function invalidRange(error) {
  return { start: '', end: '', error };
}

export function teamPeriodRange(id = 'month', { now = new Date(), start = '', end = '' } = {}) {
  const today = riyadhToday(now);
  if (!today) return invalidRange('تعذر تحديد التاريخ الحالي');

  if (id === 'custom') {
    if (!start || !end) return invalidRange('حدد تاريخ البداية والنهاية');
    if (!isCalendarDate(start) || !isCalendarDate(end)) return invalidRange('أدخل تاريخ بداية ونهاية صحيحين');
    if (end < start) return invalidRange('لا يمكن أن يسبق تاريخ النهاية تاريخ البداية');
    if (end > today) return invalidRange('لا يمكن اختيار تاريخ في المستقبل');
    const dayDifference = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS;
    if (dayDifference > MAX_PERIOD_DAY_DIFFERENCE) return invalidRange('الفترة المخصصة لا يمكن أن تتجاوز 3661 يوما');
    return { start, end, error: '' };
  }

  const monthStart = `${today.slice(0, 7)}-01`;
  switch (id) {
    case 'today':
      return { start: today, end: today, error: '' };
    case 'last7':
      return { start: daysBefore(today, 6), end: today, error: '' };
    case 'month':
      return { start: monthStart, end: today, error: '' };
    case 'lastMonth': {
      const monthEnd = daysBefore(monthStart, 1);
      return { start: `${monthEnd.slice(0, 7)}-01`, end: monthEnd, error: '' };
    }
    case 'year':
      return { start: `${today.slice(0, 4)}-01-01`, end: today, error: '' };
    default:
      return invalidRange('اختر فترة صحيحة');
  }
}
