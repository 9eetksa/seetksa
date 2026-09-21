export const DEPARTMENT_LIMITS = Object.freeze({
  name: 100,
  slug: 90,
  category: 80,
  description: 600,
  responsibilityItem: 500,
  responsibilities: 50,
  taskItem: 300,
  tasks: 80,
  members: 200,
  targetHoursMin: 0.5,
  targetHoursMax: 8760,
  effortMin: 0.5,
  effortMax: 100,
  sortOrderMax: 10000,
});

const DEFAULT_TARGET_MINUTES = 4320;
const DEFAULT_EFFORT_POINTS = 5;
const DEFAULT_CATEGORY = 'أقسام صيت';
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EFFORT_PATTERN = /^[0-9]{1,3}(?:\.[0-9]{1,2})?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trimmed = value => String(value ?? '').trim();
const unique = values => [...new Set(values)];

function normalizedList(values) {
  if (!Array.isArray(values)) return [];
  return [...values]
    .sort((left, right) => (
      Number(left?.sort_order ?? 0) - Number(right?.sort_order ?? 0)
    ))
    .map(value => trimmed(
      value && typeof value === 'object'
        ? value.text ?? value.title
        : value,
    ))
    .filter(Boolean);
}

function duplicateListItem(values) {
  const seen = new Set();
  return values.some(value => {
    const key = value.toLocaleLowerCase('ar');
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function departmentMemberState(department) {
  const members = Array.isArray(department?.members) ? department.members : [];
  const ids = Array.isArray(department?.member_ids)
    ? department.member_ids
    : members.map(member => member?.user_id);
  const memberIds = unique(ids.map(trimmed).filter(Boolean));
  const lead = trimmed(
    department?.lead_user_id
      ?? members.find(member => member?.member_role === 'lead')?.user_id,
  );

  return {
    member_ids: lead && !memberIds.includes(lead) ? [...memberIds, lead] : memberIds,
    lead_user_id: lead,
  };
}

export function createDepartmentDraft() {
  return {
    id: null,
    name: '',
    slug: '',
    category: DEFAULT_CATEGORY,
    description: '',
    icon: 'building-2',
    active: true,
    client_visible: true,
    target_hours: DEFAULT_TARGET_MINUTES / 60,
    default_effort_points: DEFAULT_EFFORT_POINTS,
    sort_order: 100,
    version: null,
    responsibilities: [''],
    tasks: [''],
    member_ids: [],
    lead_user_id: '',
  };
}

export function departmentToDraft(department = {}) {
  const membership = departmentMemberState(department);
  const responsibilities = normalizedList(department.responsibilities);
  const tasks = normalizedList(department.tasks);
  const minutes = numberOr(department.default_target_minutes, DEFAULT_TARGET_MINUTES);

  return {
    id: department.id ?? null,
    name: String(department.name ?? ''),
    slug: String(department.slug ?? ''),
    category: String(department.category ?? DEFAULT_CATEGORY),
    description: String(department.description ?? ''),
    icon: String(department.icon ?? 'building-2'),
    active: department.active !== false,
    client_visible: department.active !== false && department.client_visible !== false,
    target_hours: minutes / 60,
    default_effort_points: numberOr(
      department.default_effort_points,
      DEFAULT_EFFORT_POINTS,
    ),
    sort_order: numberOr(department.sort_order, 100),
    version: department.version !== null
      && department.version !== undefined
      && department.version !== ''
      && Number.isInteger(Number(department.version))
      ? Number(department.version)
      : null,
    responsibilities: responsibilities.length ? responsibilities : [''],
    tasks: tasks.length ? tasks : [''],
    ...membership,
  };
}

function payloadFromDraft(draft = {}) {
  const memberIds = unique(
    (Array.isArray(draft.member_ids) ? draft.member_ids : [])
      .map(trimmed)
      .filter(Boolean),
  );
  const lead = trimmed(draft.lead_user_id);
  const targetHours = Number(draft.target_hours);
  const effort = Number(draft.default_effort_points);
  const sortOrder = Number(draft.sort_order);

  return {
    id: draft.id || null,
    name: trimmed(draft.name),
    slug: trimmed(draft.slug).toLowerCase(),
    category: trimmed(draft.category),
    description: trimmed(draft.description),
    icon: trimmed(draft.icon) || 'building-2',
    active: Boolean(draft.active),
    client_visible: Boolean(draft.client_visible),
    default_target_minutes: Number.isFinite(targetHours)
      ? Math.round(targetHours * 60)
      : Number.NaN,
    default_effort_points: effort,
    sort_order: sortOrder,
    version: draft.version !== null
      && draft.version !== undefined
      && draft.version !== ''
      && Number.isInteger(Number(draft.version))
      ? Number(draft.version)
      : null,
    responsibilities: normalizedList(draft.responsibilities),
    tasks: normalizedList(draft.tasks),
    member_ids: lead && !memberIds.includes(lead) ? [...memberIds, lead] : memberIds,
    lead_user_id: lead || null,
  };
}

export function validateDepartmentDraft(draft = {}, staff = []) {
  const payload = payloadFromDraft(draft);
  const errors = {};

  if (payload.name.length < 2 || payload.name.length > DEPARTMENT_LIMITS.name) {
    errors.name = 'اكتب اسم القسم بين حرفين ومائة حرف';
  }
  if (!SLUG_PATTERN.test(payload.slug) || payload.slug.length > DEPARTMENT_LIMITS.slug) {
    errors.slug = 'المعرف يقبل الحروف الإنجليزية الصغيرة والأرقام والشرطة فقط';
  }
  if (
    payload.category.length < 2
    || payload.category.length > DEPARTMENT_LIMITS.category
  ) {
    errors.category = 'اكتب مجموعة واضحة للقسم';
  }
  if (payload.description.length > DEPARTMENT_LIMITS.description) {
    errors.description = 'وصف القسم أطول من الحد المسموح';
  }

  const targetHours = payload.default_target_minutes / 60;
  if (
    !Number.isFinite(targetHours)
    || targetHours < DEPARTMENT_LIMITS.targetHoursMin
    || targetHours > DEPARTMENT_LIMITS.targetHoursMax
  ) {
    errors.target_hours = 'حدد وقتا مستهدفا بين نصف ساعة وسنة';
  }
  if (
    !Number.isFinite(payload.default_effort_points)
    || !EFFORT_PATTERN.test(String(payload.default_effort_points))
    || payload.default_effort_points < DEPARTMENT_LIMITS.effortMin
    || payload.default_effort_points > DEPARTMENT_LIMITS.effortMax
  ) {
    errors.default_effort_points = 'حدد وزن الجهد بين نصف نقطة ومائة نقطة وبدقة منزلتين';
  }
  if (
    !Number.isInteger(payload.sort_order)
    || payload.sort_order < 0
    || payload.sort_order > DEPARTMENT_LIMITS.sortOrderMax
  ) {
    errors.sort_order = 'ترتيب العرض يجب أن يكون رقما صحيحا';
  }

  for (const [field, values, itemLimit, countLimit, emptyMessage, duplicateMessage] of [
    [
      'responsibilities',
      payload.responsibilities,
      DEPARTMENT_LIMITS.responsibilityItem,
      DEPARTMENT_LIMITS.responsibilities,
      'أضف مسؤولية واحدة على الأقل',
      'كل مسؤولية يجب أن تكون مختلفة',
    ],
    [
      'tasks',
      payload.tasks,
      DEPARTMENT_LIMITS.taskItem,
      DEPARTMENT_LIMITS.tasks,
      'أضف مهمة أساسية واحدة على الأقل',
      'كل مهمة أساسية يجب أن تكون مختلفة',
    ],
  ]) {
    if (!values.length) errors[field] = emptyMessage;
    else if (values.length > countLimit) {
      errors[field] = 'تجاوزت العدد المسموح';
    } else if (values.some(value => value.length < 2 || value.length > itemLimit)) {
      errors[field] = 'اكتب كل بند ضمن الحد المسموح';
    } else if (duplicateListItem(values)) errors[field] = duplicateMessage;
  }

  if (!payload.member_ids.length) {
    errors.members = 'اختر عضوا واحدا على الأقل';
  } else if (
    payload.member_ids.length > DEPARTMENT_LIMITS.members
    || payload.member_ids.some(memberId => !UUID_PATTERN.test(memberId))
  ) {
    errors.members = 'راجع أعضاء القسم المختارين';
  }
  if (!payload.lead_user_id) {
    errors.lead_user_id = 'حدد مسؤولا واحدا للقسم';
  } else if (!UUID_PATTERN.test(payload.lead_user_id)) {
    errors.lead_user_id = 'راجع مسؤول القسم المختار';
  } else if (!payload.member_ids.includes(payload.lead_user_id)) {
    errors.lead_user_id = 'مسؤول القسم يجب أن يكون ضمن الأعضاء';
  }

  const knownIds = new Set(
    (Array.isArray(staff) ? staff : [])
      .map(person => trimmed(person?.id ?? person?.user_id))
      .filter(Boolean),
  );
  if (payload.member_ids.some(memberId => !knownIds.has(memberId))) {
    errors.members = 'يوجد عضو غير متاح راجع فريق القسم';
  }

  return errors;
}

export function prepareDepartmentPayload(draft = {}, staff = []) {
  const payload = payloadFromDraft(draft);
  const errors = validateDepartmentDraft(draft, staff);
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    payload,
  };
}

export function departmentDraftFingerprint(draft = {}) {
  const payload = payloadFromDraft(draft);
  return JSON.stringify(payload);
}
