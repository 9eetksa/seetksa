const partsFormatter = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Riyadh', calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
const labelFormatter = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', calendar: 'gregory', day: 'numeric', month: 'long', year: 'numeric' });

export function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function riyadhDate(value = new Date()) {
  if (isDateOnly(value)) return value;
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function endOfRiyadhDay(value) {
  if (!isDateOnly(value)) throw new RangeError('invalid_calendar_date');
  return new Date(`${value}T23:59:59.999+03:00`).toISOString();
}

export function dateLabel(value) {
  const day = riyadhDate(value);
  return day ? labelFormatter.format(new Date(`${day}T12:00:00+03:00`)) : 'لم يحدد بعد';
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function clampDate(value, min, max) {
  return min && value < min ? min : max && value > max ? max : value;
}

export function changeDatePart(value, part, next, min, max) {
  const fields = value.split('-').map(Number);
  fields[part] = Number(next);
  fields[2] = Math.min(fields[2], daysInMonth(fields[0], fields[1]));
  return clampDate(fields.map((field, index) => String(field).padStart(index === 0 ? 4 : 2, '0')).join('-'), min, max);
}
