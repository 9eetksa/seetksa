import React from "react";
import { useSessionState } from '../shared/session-state';
import {
  ArrowUpRight,
  Users,
  Layers3,
  Image,
  EyeOff,
  ShieldCheck,
  Activity,
  Palette,
  ListTodo,
  ArrowLeft,
  BellRing,
  Gauge,
} from "lucide-react";
import { useCmsTree } from "./platform";
import TeamOverview from "./TeamOverview";

const overviewScopes = [
  ["all", "الكل"],
  ["operations", "التشغيل"],
  ["team", "الفريق"],
  ["content", "المحتوى"],
];

const scopeCopy = {
  all: {
    eyebrow: "ابدأ من هنا",
    title: "خطوتك التالية",
    description: "انتقل مباشرة إلى المساحة التي تحتاج قرارك الآن",
  },
  operations: {
    eyebrow: "نبض التشغيل",
    title: "حافظ على تدفق الطلبات",
    description: "راجع الطلبات والتكليفات والنشاط الإداري من نقطة واحدة",
  },
  team: {
    eyebrow: "إدارة الفريق",
    title: "تابع إنجاز فريقك",
    description: "تعرف على مسؤوليات الموظفين وحركة المهام خلال الفترة التي تختارها",
  },
  content: {
    eyebrow: "واجهة الأعمال",
    title: "جهز المحتوى للنشر",
    description: "نظم الأعمال ومساحات التحرير وتفاصيل العرض",
  },
};

export default function Overview({
  platform,
  users,
  audit,
  busy,
  onTab,
  preview = false,
  access = {
    users: true,
    audit: true,
    content: true,
    appearance: true,
    maintenance: true,
  },
}) {
  const cms = useCmsTree("control-overview");
  const [scope, setScope] = useSessionState('admin.overview.scope', 'all', { validate: value => overviewScopes.some(([id]) => id === value) });
  const teamReport = scope === "team";
  const { config, record } = platform;
  const elements = Object.values(config.elements || {});
  const pendingAccounts=users.filter(user=>user.invitation_id&&(user.email_status==='failed'||user.whatsapp_status==='failed'));
  const metrics = [
    { icon: ShieldCheck, label: "حالة المنصة", value: config.maintenance ? "صيانة" : "متاحة", hint: "التحكم في إتاحة المنصة", access: "maintenance", tab: "maintenance", scope: "operations" },
    { icon: Users, label: "الحسابات المعروضة", value: busy ? "—" : `${users.length}${users.length === 50 ? "+" : ""}`, hint: "من أحدث صفحة للحسابات", access: "users", tab: "users", scope: "team" },
    { icon: Layers3, label: "إصدار المحتوى", value: record.version, hint: "آخر إصدار منشور", access: "audit", tab: "audit", scope: "content" },
    { icon: Palette, label: "العناصر المخصصة", value: elements.length, hint: "عناصر لها إعدادات محفوظة", access: "appearance", tab: "appearance", scope: "content" },
    { icon: Image, label: "تصاميم البطاقات", value: elements.filter((e) => e.design || e.image || e.backdrop).length, hint: "عناصر تتضمن صورا أو تصميما", access: "appearance", tab: "appearance", scope: "content" },
    { icon: EyeOff, label: "العناصر المخفية", value: elements.filter((e) => e.hidden).length, hint: "تحت إدارتك قبل العرض", access: "appearance", tab: "appearance", scope: "content" },
  ];
  const labels = {
    platform_save: "نشر تحديث للمنصة",
    role_change: "تحديث صلاحية حساب",
    impersonation_start: "بدء الدخول بالنيابة",
    impersonation_end: "إنهاء الدخول بالنيابة",
    profile_update: "تحديث بيانات حساب",
    employee_updated: "تحديث بيانات موظف",
    client_email_updated: "تحديث بريد عميل",
    account_created: "إضافة حساب جديد",
    permissions_change: "تحديث صلاحيات الإدارة",
    work_staff: "تحديث توزيع موظف",
    work_grant: "تحديث صلاحية قسم",
    work_department_create: "إنشاء قسم",
    work_department_update: "تحديث قسم",
  };
  const scopeMatches = (area) => scope === "all" || scope === area;
  const shortcuts = [
    { scope: "operations", tab: "work", icon: ListTodo, label: "متابعة الطلبات", hint: "التكليفات والتسليمات وتدخلات الإدارة" },
    { scope: "team", tab: "performance", icon: Gauge, label: "أداء الفريق", hint: "سرعة الإنجاز وحجم العمل ومسؤوليات الأقسام" },
    ...(access.users ? [{ scope: "team", tab: "users", icon: Users, label: "إدارة الحسابات", hint: "بيانات الفريق ومستويات الوصول وحالة الدخول" }] : []),
    { scope: "content", tab: "portfolio", icon: Image, label: "إدارة أعمالنا", hint: "المشاريع وملفات الأعمال المعتمدة" },
  ].filter((item) => scopeMatches(item.scope));
  const visibleMetrics = metrics.filter((metric) => !teamReport && scopeMatches(metric.scope) && access[metric.access]);
  const activeScope = overviewScopes.find(([id]) => id === scope)?.[1] || "الكل";
  const intro = scopeCopy[scope] || scopeCopy.all;
  return cms(
    <div className="a-command-grid" data-scope={scope}>
      <section className="a-overview-filter" aria-labelledby="overview-scope-title">
        <div className="a-overview-filter-copy">
          <span className="a-eyebrow">نطاق العرض</span>
          <h2 id="overview-scope-title">ركز لوحة التحكم</h2>
          <p>اعرض الأدوات المرتبطة بالمساحة التي تعمل عليها</p>
        </div>
        <div className="a-overview-filter-options" role="group" aria-label="تصفية لوحة التحكم حسب النطاق">
          {overviewScopes.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={scope === id} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="a-overview-filter-status" role="status">النطاق الحالي {activeScope}</span>
      </section>
      {!teamReport && <section className="a-overview-entry" aria-label="الوصول السريع">
        <div><span className="a-eyebrow">{intro.eyebrow}</span><h2>{intro.title}</h2><p>{intro.description}</p></div>
        <div className="a-overview-shortcuts">
          {shortcuts.map(({ tab, icon: Icon, label, hint }, index) => (
            <button type="button" className={index === 0 ? "a-primary" : undefined} key={tab} onClick={() => onTab(tab)}>
              <Icon size={20} aria-hidden="true" />
              <span>{label}<small>{hint}</small></span>
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>}
      {teamReport && (preview ? <section className="a-command-panel"><h2>إحصاءات الفريق</h2><p>افتح لوحة التحكم لعرض بيانات الفريق</p></section> : <TeamOverview />)}
      {!teamReport && scope === "team" && !access.users && (
        <section className="a-command-panel">
          <h2>حسابك الإداري جاهز</h2>
          <p>تظهر أدوات إدارة الحسابات والمحتوى بعد منحك الصلاحيات من السوبر أدمن</p>
        </section>
      )}
      {visibleMetrics.length > 0 && (
        <div className="a-command-metrics" data-count={visibleMetrics.length}>
          {visibleMetrics.map(({ icon: Icon, label, value, hint, tab }) => (
            <button type="button" key={label} onClick={() => onTab(tab)}>
              <span className="a-metric-icon">
                <Icon size={23} aria-hidden="true" />
              </span>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{hint}</small>
            </button>
          ))}
        </div>
      )}
      {!teamReport && scopeMatches("team") && access.users && (
        <section className="a-command-panel a-command-accounts">
          <header>
            <h2>حسابات المنصة</h2>
            <button type="button" onClick={() => onTab("users")}>
              إدارة الحسابات <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </header>
          <p>أحدث الحسابات وحالة الوصول إلى المنصة</p>
          {!busy&&pendingAccounts.length>0&&<button type="button" className="a-account-attention" onClick={()=>onTab('users')}><BellRing size={18} aria-hidden="true"/><span>{pendingAccounts.length} حساب يحتاج مراجعة إرسال بيانات الدخول</span><ArrowLeft size={17} aria-hidden="true"/></button>}
          <div className="a-command-table">
            <table>
              <thead>
                <tr>
                  <th>الحساب</th>
                  <th>الصلاحية</th>
                  <th>آخر دخول</th>
                </tr>
              </thead>
              <tbody>
                {users.slice(0, 5).map((u) => (
                  <tr key={u.id}>
                    <td><strong className="a-account-name">{u.display_name||'حساب المنصة'}</strong><span className="a-account-email" dir="ltr">{u.email}</span></td>
                    <td>
                      <span className="a-role-pill">
                        {{
                          client: "عميل",
                          employee: "موظف",
                          admin: "أدمن",
                          super_admin: "سوبر أدمن",
                        }[u.role] || "غير محدد"}
                      </span>
                    </td>
                    <td>
                      {u.last_sign_in_at
                        ? new Date(u.last_sign_in_at).toLocaleDateString(
                            "ar-SA",
                          )
                        : "لم يسجل الدخول"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!users.length && (
            <p role="status">
              {busy ? "جار تحميل الحسابات" : "لا توجد حسابات للعرض"}
            </p>
          )}
          <div className="a-command-account-foot">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>تعديل البيانات والصلاحيات من صفحة الحسابات</span>
          </div>
        </section>
      )}
      {scopeMatches("content") && access.content && (
        <section className="a-command-panel a-command-flow">
          <header>
            <h2>إدارة محتوى المنصة</h2>
            <Activity size={18} aria-hidden="true" />
          </header>
          <ol>
            {[
              "اختر المساحة",
              "عدّل المحتوى",
              "راجع التصميم",
              "انشر التحديث",
            ].map((t, i) => (
              <li key={t}>
                <span>{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          <a href="/admin/editor">
            افتح المحرر المباشر <ArrowUpRight size={17} aria-hidden="true" />
          </a>
        </section>
      )}
      {scopeMatches("content") && access.content && (
        <section className="a-hero a-command-hero">
          <span className="a-eyebrow">واجهة أعمال صيت</span>
          <h2>
            أعمال تستحق
            <br />
            <em>أن تظهر</em>
          </h2>
          <p>جهز المشاريع وملفاتها من مكتبة أعمالنا</p>
          <button type="button" className="a-button a-primary" onClick={()=>onTab('portfolio')}>
            افتح أعمالنا <ArrowUpRight size={18} aria-hidden="true" />
          </button>
        </section>
      )}
      {scopeMatches("content") && access.content && (
        <section className="a-command-panel a-command-spaces">
          <header>
            <h2>مساحات التحرير</h2>
            <Palette size={18} aria-hidden="true" />
          </header>
          <div className="a-space-links">
            {[
              ["home", "الموقع الرئيسي"],
              ["client", "لوحة العميل"],
              ["employee", "لوحة الموظف"],
              ["admin", "لوحة الأدمن"],
              ["super_admin", "لوحة السوبر أدمن"],
            ].map(([id, label]) => (
              <a key={id} href={`/admin/editor?surface=${id}`}>
                {label}
                <ArrowUpRight size={18} aria-hidden="true" />
              </a>
            ))}
          </div>
        </section>
      )}
      {scopeMatches("operations") && access.audit && (
        <section className="a-command-panel a-command-activity">
          <header>
            <h2>النشاط الأخير</h2>
            <button type="button" onClick={() => onTab("audit")}>عرض الكل</button>
          </header>
          {audit.slice(0, 4).map((a) => (
            <article key={a.id}>
              <span className="a-activity-dot" />
              <div>
                <strong>{labels[a.action] || "تحديث إداري"}</strong>
                <small>{new Date(a.created_at).toLocaleString("ar-SA")}</small>
              </div>
            </article>
          ))}
          {!audit.length && (
            <p>{busy ? "جار تحميل النشاط" : "سيظهر نشاط الإدارة هنا"}</p>
          )}
        </section>
      )}
      <div className="a-command-signature">
        <ShieldCheck size={18} aria-hidden="true"/><span className="a-signature-copy">تظهر أدوات الإدارة بحسب صلاحيات حسابك</span>
      </div>
    </div>,
  );
}
