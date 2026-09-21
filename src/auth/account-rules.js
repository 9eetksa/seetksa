export const adminPermissions = Object.freeze({
  "users.read": "عرض الحسابات",
  "services.manage": "إضافة الخدمات وتعديلها",
  "departments.manage": "إدارة الأقسام",
  "content.edit": "تحرير المحتوى وتصاميم البطاقات",
  "appearance.edit": "تعديل ألوان المنصة",
  "maintenance.manage": "إدارة وضع الصيانة",
  "audit.read": "عرض سجل الإدارة",
});
export const accountTypeLabels = Object.freeze({collaborator:'متعاون',employee:'موظف',admin:'أدمن',supervisor:'مشرف',super_admin:'سوبر أدمن',client:'عميل'});
// Phone accounts use an internal Auth identifier; never render it as contact data.
export function publicAccountData(value) {
  if (typeof value === 'string') return /^[^\s@]+@accounts\.seet\.invalid$/i.test(value) ? '' : value;
  if (Array.isArray(value)) return value.map(publicAccountData);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,publicAccountData(item)]));
  return value;
}
export const accountContact = user => user?.app_metadata?.phone_only ? user.phone || '' : publicAccountData(user?.email || '') || user?.phone || '';
export function allowed(user, permission) {
  if (!user || user.is_anonymous || user.app_metadata?.must_change_password)
    return false;
  return (
    user.app_metadata?.role === "super_admin" ||
    (user.app_metadata?.role === "admin" &&
      Array.isArray(user.app_metadata.permissions) &&
      user.app_metadata.permissions.includes(permission))
  );
}
export function normalizePhone(value) {
  let phone = String(value || "")
    .replace(/[\s()-]/g, "")
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632));
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  if (/^05\d{8}$/.test(phone)) phone = "+966" + phone.slice(1);
  else if (/^5\d{8}$/.test(phone)) phone = "+966" + phone;
  else if (/^9665\d{8}$/.test(phone)) phone = "+" + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export function validateNewAccount(input) {
  const name = String(input.name || "").trim(),
    email = String(input.phone_only ? '' : input.email || "")
      .trim()
      .toLowerCase(),
    phone = normalizePhone(input.phone);
  if (!name || name.length > 120)
    return { error: "أدخل الاسم الكامل بحد أقصى 120 حرفا" };
  if ((!email && input.role === 'client') || (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)))
    return { error: "أدخل بريدا إلكترونيا صحيحا" };
  if (!phone) return { error: "أدخل رقم جوال صحيحا مع مفتاح الدولة" };
  if (!["client", "employee", "admin", "collaborator", "supervisor"].includes(input.role))
    return { error: "اختر نوع الحساب" };
  const jobTitle =
    ['employee','collaborator','supervisor','admin'].includes(input.role) ? String(input.jobTitle || "").trim() : "";
  if (input.role === "employee" && (!jobTitle || jobTitle.length > 120))
    return { error: "أدخل المسمى الوظيفي بحد أقصى 120 حرفا" };
  if (jobTitle.length > 120) return {error:'المسمى الوظيفي يجب ألا يتجاوز 120 حرفا'};
  const contactName =
    input.role === "client" ? String(input.contactName || "").trim() : "";
  if (contactName.length > 120)
    return { error: "اسم الشخص المسؤول يجب ألا يتجاوز 120 حرفا" };
  if (input.permissions !== undefined && !Array.isArray(input.permissions))
    return { error: "اختر الصلاحيات من القائمة" };
  const permissions =
    input.role === "admin" ? [...new Set(input.permissions || [])] : [];
  if (permissions.some((p) => !Object.hasOwn(adminPermissions, p)))
    return { error: "توجد صلاحية غير معتمدة" };
  return {
    value: {
      name,
      email,
      phone,
      role: input.role,
      phone_only: !email,
      jobTitle,
      contactName,
      permissions,
    },
  };
}
export function validateEmployeeUpdate(input) {
  if (
    typeof input?.name !== "string" ||
    !input.name.trim() ||
    input.name.trim().length > 120
  )
    return { error: "أدخل الاسم الكامل بحد أقصى 120 حرفا" };
  if (
    typeof input?.email !== "string" ||
    (input.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) ||
    input.email.trim().length > 254
  )
    return { error: "أدخل بريدا إلكترونيا صحيحا" };
  const phone =
    typeof input?.phone === "string" ? normalizePhone(input.phone) : null;
  if (!phone) return { error: "أدخل رقم جوال صحيحا مع مفتاح الدولة" };
  if (
    typeof input?.jobTitle !== "string" ||
    !input.jobTitle.trim() ||
    input.jobTitle.trim().length > 120
  )
    return { error: "أدخل المسمى الوظيفي بحد أقصى 120 حرفا" };
  const workProfile = input.workProfile;
  if (workProfile !== undefined) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!workProfile || typeof workProfile !== "object" ||
      !["services", "expected_services"].every((key) => Array.isArray(workProfile[key]) && workProfile[key].length <= 200 && workProfile[key].every((id) => typeof id === "string" && uuid.test(id))) ||
      typeof workProfile.coordinator !== "boolean" || typeof workProfile.expected_coordinator !== "boolean" ||
      !["capacity", "expected_capacity"].every((key) => Number.isInteger(workProfile[key]) && workProfile[key] >= 1 && workProfile[key] <= 100) ||
      !["regular", "freelancer"].includes(workProfile.employment_type) ||
      ![null, "regular", "freelancer"].includes(workProfile.expected_employment_type))
      return { error: "حدد نوع الارتباط الوظيفي وتحقق من إعدادات الأقسام" };
  }
  return {
    value: {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone,
      jobTitle: input.jobTitle.trim(),
      ...(workProfile === undefined ? {} : { workProfile: {
        services: [...new Set(workProfile.services)],
        expected_services: [...new Set(workProfile.expected_services)],
        coordinator: workProfile.coordinator,
        expected_coordinator: workProfile.expected_coordinator,
        capacity: workProfile.capacity,
        expected_capacity: workProfile.expected_capacity,
        employment_type: workProfile.employment_type,
        expected_employment_type: workProfile.expected_employment_type,
      } }),
    },
  };
}
