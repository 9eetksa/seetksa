export const rolePaths = Object.freeze({
  employee: "/employee/dashboard",
  admin: "/admin/workspace",
  super_admin: "/admin/dashboard",
});

// Only server-managed Auth app_metadata is authoritative
// Never accept a role from a form, URL or user_metadata
export function trustedRole(user) {
  const role = user?.app_metadata?.role;
  return Object.hasOwn(rolePaths, role) && !user.is_anonymous ? role : null;
}

export function passwordIssue(password, confirmation) {
  if (password.length < 8) return "استخدم كلمة مرور من 8 خانات على الأقل";
  if (password.length > 128) return "استخدم كلمة مرور لا تتجاوز 128 خانة";
  if (
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[\p{P}\p{S}]/u.test(password)
  )
    return "أضف حرفا إنجليزيا كبيرا ورقما ورمزا مميزا مثل _ أو @";
  if (password !== confirmation) return "كلمتا المرور غير متطابقتين";
  return "";
}

export function authMessage(error) {
  if (error?.userFacing) return error.message;
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit")
    return "طلبات كثيرة خلال وقت قصير يرجى المحاولة بعد قليل";
  if (error?.code === "invalid_credentials")
    return "البريد الإلكتروني أو الجوال أو كلمة المرور غير صحيحة";
  if (error?.code === "email_not_confirmed")
    return "يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول";
  if (error?.code === "same_password")
    return "اختر كلمة مرور مختلفة عن كلمة المرور الحالية";
  if (error?.code === "weak_password")
    return "اختر كلمة مرور أقوى تحتوي على حروف وأرقام ورموز";
  return "تعذر إكمال الطلب تحقق من اتصالك وحاول مرة أخرى";
}
