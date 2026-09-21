import React, { useEffect, useRef, useState } from "react";
import {
  X,
  UserPlus,
  Pencil,
  Mail,
  MessageCircle,
  Check,
  LoaderCircle,
} from "lucide-react";
import { accountRequest } from "../auth/supabase";
import {
  adminPermissions,
  validateEmployeeUpdate,
  validateNewAccount,
} from "../auth/account-rules";
import { rpc, platformError } from "./platform";
import "./account-dialog.css";
import { useSessionState, useSessionStore } from '../shared/session-state';
export const deliveryLabel = (status) =>
  ({
    sent: "تم قبول الإرسال",
    failed: "تعذر الإرسال",
    unknown: "بانتظار التحقق",
    pending: "بانتظار الإرسال",
  })[status] || "غير متاح";
const loadEmployeeProfile = (id) => rpc("work_employee_profile", { p_user: id });
export default function AccountDialog({
  onClose: dismiss,
  onAdded,
  onSaved,
  admin = null,
  employee = null,
  loadProfile = loadEmployeeProfile,
  saveAccount = accountRequest,
}) {
  const dialog = useRef(null);
  const store=useSessionStore(),prefix=`account-form:${employee?.id||admin?.id||'new'}:`;
  const [requestId,setRequestId]=useSessionState(`${prefix}request-id`,()=>crypto.randomUUID());
  function onClose(){store?.clearPrefix(prefix);dismiss();}
  const empty = {
    name: "",
    email: "",
    phone: "",
    role: "employee",
    jobTitle: "",
    contactName: "",
    permissions: [],
  };
  const [form, setForm, formDraft] = useSessionState(`${prefix}fields`,
      admin
        ? { ...empty, permissions: admin.permissions || [], role: "admin" }
        : employee
          ? {
              ...empty,
              name: employee.display_name || "",
              email: employee.email || "",
              phone: employee.phone ? `+${employee.phone.replace(/^\+/, "")}` : "",
              jobTitle: employee.job_title || "",
            }
          : empty,
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [result, setResult] = useSessionState(`${prefix}result`,null);
  const [workProfile, setWorkProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(Boolean(employee));
  useEffect(() => {
    if (!employee) return;
    let active = true;
    setWorkProfile(null);
    setProfileLoading(true);
    loadProfile(employee.id).then((profile) => {
      if (!active) return;
      setWorkProfile(profile);
      formDraft.initialize({ ...form, name: profile.name, email: profile.email,
        phone: profile.phone ? `+${profile.phone.replace(/^\+/, "")}` : "", jobTitle: profile.job_title,
        workProfile: { services: profile.services, expected_services: profile.services,
          coordinator: profile.coordinator, expected_coordinator: profile.coordinator,
          capacity: profile.capacity, expected_capacity: profile.capacity,
          employment_type: profile.employment_type || "", expected_employment_type: profile.employment_type } });
    }).catch((error) => {
      if (active) setMessage("تعذر تحميل إعدادات الموظف أغلق النافذة وافتحها للمحاولة مجددا");
    }).finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [employee?.id, loadProfile]);
  const workField = (key, value) => setForm((current) => ({ ...current,
    workProfile: { ...current.workProfile, [key]: value } }));
  useEffect(() => {
    const old = document.activeElement;
    dialog.current.showModal();
    return () => old?.focus?.();
  }, []);
  const field = (key, value) => {
    setRequestId(crypto.randomUUID());
    setForm((f) => ({ ...f, [key]: value }));
  };
  async function submit(e) {
    e.preventDefault();
    if (busy || (employee && !workProfile)) return;
    setMessage("");
    const check = admin
      ? null
      : employee
        ? validateEmployeeUpdate(form)
        : validateNewAccount({ ...form, phone_only: true });
    if (check?.error) {
      setMessage(check.error);
      return;
    }
    let employeeUpdated = false;
    setBusy(true);
    try {
      if (employee) {
        await saveAccount({
          action: "update-employee",
          userId: employee.id,
          ...check.value,
        });
        employeeUpdated = true;
      } else if (admin) {
        await rpc("platform_permissions", {
          p_user: admin.id,
          p_permissions: form.permissions,
        });
        onAdded();
        onClose();
        return;
      } else {
        setRequestId(requestId);
        const { email, ...phoneAccount } = form;
        const response = await saveAccount({
          action: "create",
          requestId,
          ...phoneAccount,
          phone_only: true,
        });
        setResult({phoneOnly:true,phone:check?.value?.phone||form.phone,whatsapp_status:response.invitation?.whatsapp_status});
        formDraft.forget();
        onAdded();
      }
    } catch (e) {
      setMessage(e.userFacing ? e.message : platformError(e));
    } finally {
      setBusy(false);
    }
    if (employeeUpdated) {
      onClose();
      onSaved();
    }
  }
  return (
    <dialog
      ref={dialog}
      className="a-account-dialog"
      dir="rtl"
      aria-labelledby="account-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <span className="a-dialog-icon" aria-hidden="true">
          {employee ? <Pencil size={24} /> : <UserPlus size={24} />}
        </span>
        <div>
          <span className="a-eyebrow">مساحة تجمعنا</span>
          <h2 id="account-dialog-title">
            {employee
              ? "تعديل بيانات الموظف"
              : admin
                ? "صلاحيات الأدمن"
                : "إضافة حساب جديد"}
          </h2>
        </div>
        <button
          onClick={onClose}
          disabled={busy}
          aria-label={employee ? "إغلاق تعديل بيانات الموظف" : "إغلاق إضافة الحساب"}
        >
          <X size={20} />
        </button>
      </header>
      {message && (
        <p role="alert" className="a-notice">
          {message}
        </p>
      )}
      {result ? (
        <div className="a-invite-result">
          <Check size={32} />
          <h3>{result.recordOnly?'تم حفظ بيانات العميل':'تم إنشاء الحساب'}</h3>
          <p dir="ltr">{result.phoneOnly?result.phone||form.phone:result.email||form.email}</p>
          {result.recordOnly?<p>العميل مسجل كمرجع للطلبات دون حساب دخول أو رسائل دعوة</p>:<>
          <p>{result.phoneOnly?'رمز الدخول عبر واتساب من 6 أرقام وصالح لمدة 5 دقائق':'كلمة المرور المؤقتة من 8 خانات وصالحة لمدة 24 ساعة'}</p>
          {result.phoneOnly&&<p>يدخل المستخدم برقم الجوال والرمز ثم يعين كلمة مرور خاصة عند أول دخول ويمكنه بعدها الدخول بالرمز أو كلمة المرور</p>}
          {!result.phoneOnly&&<div>
            <Mail size={20} />
            البريد الإلكتروني{" "}
            <strong>{deliveryLabel(result.email_status)}</strong>
          </div>}
          <div>
            <MessageCircle size={20} />
            واتساب <strong>{deliveryLabel(result.whatsapp_status)}</strong>
          </div>
          <p>إذا تعذر الإرسال يمكنك إعادة المحاولة من قائمة الحسابات</p></>}
          <button className="a-primary" onClick={onClose}>
            العودة للحسابات
          </button>
          <button
            onClick={() => {
              setResult(null);
              setForm(empty);
              setRequestId(crypto.randomUUID());
            }}
          >
            إضافة حساب آخر
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          {profileLoading && <p role="status">جار تحميل أقسام الموظف وإعداداته</p>}
          <fieldset disabled={busy || (employee && !workProfile)}>
            {!admin && (
              <>
                {!employee && (
                  <div
                    className="a-account-kind"
                    role="group"
                    aria-label="نوع الحساب"
                  >
                    {[
                      ["collaborator", "متعاون", "يشارك الفريق في تنفيذ المهام"],
                      ["employee", "موظف", "عضو في الفريق والأقسام"],
                      ["admin", "أدمن", "يدير المنصة حسب الصلاحيات الممنوحة"],
                      ["supervisor", "مشرف", "يوزع التكليفات ويتابع تنفيذ المهام"],
                    ].map(([id, label, description]) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={form.role === id}
                        onClick={() => field("role", id)}
                      >
                        <strong>{label}</strong>
                        <span>{description}</span>
                      </button>
                    ))}
                  </div>
                )}
                <label>
                  الاسم الكامل
                  <input
                    required
                    autoComplete="name"
                    maxLength={120}
                    value={form.name}
                    onChange={(e) => field("name", e.target.value)}
                  />
                </label>
                <div className={`a-account-fields${employee&&workProfile?.email?'':' a-account-phone-only'}`}>
                  {employee&&Boolean(workProfile?.email)&&<label>
                    البريد الإلكتروني
                    <input
                      required
                      type="email"
                      autoComplete="email"
                      maxLength={254}
                      dir="ltr"
                      value={form.email}
                      onChange={(e) => field("email", e.target.value)}
                    />
                  </label>}
                  <label>
                    رقم الجوال
                    <input
                      required
                      type="tel"
                      autoComplete="tel"
                      placeholder="05xxxxxxxx"
                      dir="ltr"
                      value={form.phone}
                      onChange={(e) => field("phone", e.target.value)}
                    />
                  </label>
                </div>
                {employee&&workProfile&&!workProfile.email&&<p className="a-account-phone-hint">الدخول لهذا الحساب برقم الجوال دون بريد إلكتروني</p>}
                {(employee || !admin) && (
                  <label>
                    <span>المسمى الوظيفي {form.role!=='employee'&&<small>اختياري</small>}</span>
                    <input
                      required={form.role==='employee'}
                      maxLength={120}
                      value={form.jobTitle}
                      onChange={(e) => field("jobTitle", e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {employee && workProfile && (
              <>
                <div className="a-account-fields">
                  <label>نوع الارتباط الوظيفي
                    <select required value={form.workProfile.employment_type} onChange={(e) => workField("employment_type", e.target.value)}>
                      <option value="" disabled>اختر نوع الارتباط</option>
                      <option value="regular">موظف منتظم</option>
                      <option value="freelancer">فري لانسر</option>
                    </select>
                  </label>
                  <label>الطاقة الاستيعابية للمهام
                    <input type="number" min="1" max="100" step="1" required value={form.workProfile.capacity}
                      onChange={(e) => workField("capacity", e.target.value === "" ? "" : Number(e.target.value))} />
                  </label>
                </div>
                <fieldset className="a-permission-list">
                  <legend>الإشراف على الطلبات</legend>
                  <label><input type="checkbox" checked={form.workProfile.coordinator}
                    onChange={(e) => workField("coordinator", e.target.checked)} />
                    <span>المشرف المسؤول<small>يمكن أن يضم فريق الإشراف أكثر من موظف ولا يلزم اختيار قسم آخر</small></span>
                  </label>
                </fieldset>
                <fieldset className="a-permission-list">
                  <legend>أقسام الموظف</legend>
                  <p className="a-permission-help">يمكن اختيار أكثر من قسم ويمكن أن يضم القسم أكثر من موظف</p>
                  {workProfile.departments.map((department) => {
                    const lead = workProfile.lead_services.includes(department.id);
                    return <label key={department.id}><input type="checkbox" disabled={lead}
                      checked={form.workProfile.services.includes(department.id)}
                      onChange={(e) => workField("services", e.target.checked
                        ? [...form.workProfile.services, department.id]
                        : form.workProfile.services.filter((id) => id !== department.id))} />
                      <span>{department.name}{lead && <small>مسؤول القسم ويمكن تغيير المسؤول من إدارة الأقسام</small>}
                        {!department.active && <small>القسم غير نشط والعضوية الحالية محفوظة</small>}</span>
                    </label>;
                  })}
                  {!workProfile.departments.length && <p className="a-permission-help">لا توجد أقسام متاحة</p>}
                </fieldset>
              </>
            )}
            {!employee && form.role === "admin" && (
              <fieldset className="a-permission-list">
                <legend>الصلاحيات الممنوحة</legend>
                <p className="a-permission-help">حدد ما يمكن لهذا الأدمن إدارته ويمكنك إغلاق أي صلاحية لاحقا</p>
                {Object.entries(adminPermissions).map(([id, label]) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(id)}
                      onChange={(e) =>
                        field(
                          "permissions",
                          e.target.checked
                            ? [...form.permissions, id]
                            : form.permissions.filter((p) => p !== id),
                        )
                      }
                    />
                    <span>{label}{id==='services.manage'&&<small>إنشاء الخدمات وتعديل وصفها وأوقات التنفيذ</small>}{id==='departments.manage'&&<small>تحديد مسؤول القسم وأعضاء الفريق والمهام والمسؤوليات</small>}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {!admin && !employee && (
              <div className="a-invite-hint">
                <MessageCircle size={18} />
                <p>
                  نطلب إرسال رمز واتساب من 6 أرقام صالح لمدة 5 دقائق ويعين المستخدم كلمة مرور خاصة عند أول دخول ثم يمكنه الدخول بالرمز أو كلمة المرور
                </p>
              </div>
            )}
            <button className="a-primary" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle size={18} className="p-spinner" />
                  جار تنفيذ الطلب
                </>
              ) : employee ? (
                "حفظ بيانات الموظف"
              ) : admin ? (
                "حفظ الصلاحيات"
              ) : (
                "إنشاء الحساب وإرسال رمز واتساب"
              )}
            </button>
          </fieldset>
        </form>
      )}
    </dialog>
  );
}
