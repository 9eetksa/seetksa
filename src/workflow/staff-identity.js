export function employmentTypeLabel(value) {
  if (value === 'regular') return 'موظف منتظم';
  if (value === 'freelancer') return 'فريلانسر';
  return 'غير محدد';
}

// Legacy display fallback only — this helper never grants action permissions
export const handlesCustomerCommunication = person => typeof person.coordinator === 'boolean'
  ? person.coordinator
  : person.job_title?.trim() === 'المشرف المسؤول';
