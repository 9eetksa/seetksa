import React, { useEffect, useId, useState } from "react";
import { AlertTriangle, ArrowDownToLine, CheckCheck, Clock3, FileDown, RefreshCw, Search, Users } from "lucide-react";
import { rpc } from "./platform";
import { TEAM_PERIODS, riyadhToday, teamPeriodRange } from "./team-overview-periods";
import { createTeamReport, handlesCustomerCommunication } from "./team-report-data";
import { employmentTypeLabel } from "../workflow/staff-identity";
import "./team-overview.css";
import DatePicker from '../shared/DatePicker';
import { useSessionState } from '../shared/session-state';

const number = new Intl.NumberFormat("ar-SA");
const date = new Intl.DateTimeFormat("ar-SA", { calendar: "gregory", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Riyadh" });
const displayDate = value => date.format(new Date(`${value}T12:00:00+03:00`));
const loadTeam = range => rpc("work_team_overview", { p_start: range.start, p_end: range.end });

function EmployeeRating({ person }) {
  const penalty=Number(person.routing_penalty_points)||0;
  return <span>{person.pending_setup?<span className="to-rating-empty">بانتظار تفعيل الحساب</span>:person.insufficient_data||person.performance_score==null?<span className="to-rating-empty">بيانات غير كافية</span>:<span className="to-rating"><strong>{number.format(person.performance_score)}</strong><span>من 100</span></span>}{penalty>0&&<small className="to-rating-penalty">خصم أخطاء الإحالة {number.format(penalty)} نقطة</small>}</span>;
}

function EmployeeDepartments({ person }) {
  const communication = handlesCustomerCommunication(person);
  const responsible = person.responsible_departments || [];
  const other = (person.departments || []).filter(item => !responsible.some(lead => lead.id === item.id));
  if (!communication && !responsible.length && !other.length) return <span className="to-muted">لم يحدد قسم بعد</span>;
  return <div className="to-departments">
    {communication && <span className="is-responsible">الإشراف على الطلبات</span>}
    {responsible.map(item => <span key={item.id} className="is-responsible">{item.name}<small>مسؤول القسم</small></span>)}
    {other.map(item => <span key={item.id}>{item.name}</span>)}
  </div>;
}

export default function TeamOverview({ loadReport = loadTeam }) {
  const titleId = useId();
  const errorId = useId();
  const [period, setPeriod] = useSessionState('team-overview.period',"month",{validate:value=>TEAM_PERIODS.some(item=>item.id===value)});
  const [custom, setCustom] = useSessionState('team-overview.custom',() => teamPeriodRange("month"),{validate:value=>value&&typeof value.start==='string'&&typeof value.end==='string'});
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useSessionState('team-overview.search',"",{validate:value=>typeof value==='string'});
  const [exporting, setExporting] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState(false);
  const [result, setResult] = useState({ key: "", data: null, error: "" });
  const range = teamPeriodRange(period, { start: custom.start, end: custom.end });
  const key = `${range.start}:${range.end}:${reload}`;
  const invalid = Boolean(range.error);
  const loading = !invalid && result.key !== key;
  const data = !invalid && !loading ? result.data : null;
  const error = !invalid && !loading ? result.error : "";

  useEffect(() => {
    if (invalid) return;
    let active = true;
    loadReport({ start: range.start, end: range.end }).then(
      data => { if (active) setResult({ key, data, error: "" }); },
      () => { if (active) setResult({ key, data: null, error: "تعذر تحميل بيانات الفريق حاول مرة أخرى" }); },
    );
    return () => { active = false; };
  }, [range.start, range.end, invalid, key, loadReport]);

  const people = data?.people || [];
  const term = search.trim().toLocaleLowerCase("ar");
  const filtered = people.filter(person => [person.name, person.job_title, employmentTypeLabel(person.employment_type), handlesCustomerCommunication(person) ? "الإشراف على الطلبات" : "", ...(person.departments || []).map(item => item.name), ...(person.responsible_departments || []).map(item => item.name)]
    .some(value => String(value || "").toLocaleLowerCase("ar").includes(term)));
  const summary = data?.summary || {};
  async function exportReport(format) {
    if (exporting || !data || !filtered.length) return;
    const report = createTeamReport(filtered, range, search, data.generated_at || new Date());
    setExporting(format);
    setExportError(false);
    setExportStatus("جار تجهيز التقرير");
    try {
      const { downloadTeamReport } = await import("./team-report-download");
      await downloadTeamReport(format, report, range);
      setExportStatus("تم تجهيز التقرير وتنزيله");
    } catch {
      setExportError(true);
      setExportStatus("تعذر تصدير التقرير حاول مرة أخرى");
    } finally { setExporting(""); }
  }

  return <section className="to-team" aria-labelledby={titleId} aria-busy={loading}>
    <header className="to-heading">
      <div><span className="a-eyebrow">الفريق والإنجاز</span><h2 id={titleId}>كل موظف وأثره</h2><p>الأقسام وحركة المهام والتقييم خلال الفترة التي تختارها</p></div>
      <button type="button" className="to-refresh" disabled={loading || invalid} onClick={() => setReload(value => value + 1)}><RefreshCw size={17} aria-hidden="true"/>تحديث</button>
    </header>

    <div className="to-periods" role="group" aria-label="فترة إحصاءات الفريق">
      {TEAM_PERIODS.map(item => <button type="button" key={item.id} aria-pressed={period === item.id} onClick={() => setPeriod(item.id)}>{item.label}</button>)}
    </div>
    {period === "custom" && <div className="to-custom">
      <DatePicker label="من تاريخ" value={custom.start} max={riyadhToday()} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={start => setCustom(value => ({ ...value, start }))}/>
      <DatePicker label="إلى تاريخ" value={custom.end} min={custom.start || undefined} max={riyadhToday()} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={end => setCustom(value => ({ ...value, end }))}/>
    </div>}
    {invalid ? <p className="to-error" id={errorId} role="alert">{range.error}</p> : <p className="to-range">{displayDate(range.start)} إلى {displayDate(range.end)}<span>بتوقيت الرياض</span></p>}

    {loading && <div className="to-state" role="status"><RefreshCw size={23} className="to-spin" aria-hidden="true"/><strong>جار تحميل إحصاءات الفريق</strong></div>}
    {error && <div className="to-state to-error" role="alert"><AlertTriangle size={23} aria-hidden="true"/><strong>{error}</strong><button type="button" onClick={() => setReload(value => value + 1)}>إعادة المحاولة</button></div>}

    {data && <>
      <dl className="to-summary">
        {[
          [Users, "الموظفون", summary.people ?? people.length],
          [ArrowDownToLine, "مهام مستلمة", summary.received],
          [CheckCheck, "مهام مسلمة", summary.delivered],
          [Clock3, "مهام متأخرة", summary.late],
        ].map(([Icon, label, value]) => <div key={label}><dt><Icon size={18} aria-hidden="true"/>{label}</dt><dd>{number.format(value ?? 0)}</dd></div>)}
      </dl>
      <div className="to-list-toolbar">
        <label className="to-search"><Search size={17} aria-hidden="true"/><span className="to-sr-only">ابحث عن موظف أو قسم</span><input type="search" value={search} placeholder="ابحث عن موظف أو قسم" onChange={event => setSearch(event.target.value)}/></label>
        <span role="status">{number.format(filtered.length)} من {number.format(people.length)} موظف</span>
      </div>
      <div className="to-export-bar">
        <span>تصدير الموظفين الظاهرين حسب الفترة والبحث</span>
        <div>
          <button type="button" disabled={Boolean(exporting) || !filtered.length} onClick={() => exportReport("xlsx")}><FileDown size={17} aria-hidden="true"/>{exporting === "xlsx" ? "جار تجهيز Excel" : "تصدير Excel"}</button>
          <button type="button" disabled={Boolean(exporting) || !filtered.length} onClick={() => exportReport("pdf")}><FileDown size={17} aria-hidden="true"/>{exporting === "pdf" ? "جار تجهيز PDF" : "تصدير PDF"}</button>
        </div>
      </div>
      {exportStatus && <p className={exportError ? "to-error" : "to-range"} role={exportError ? "alert" : "status"}>{exportStatus}</p>}
      {filtered.length ? <div className="to-table-wrap"><table className="to-table">
        <caption className="to-sr-only">إحصاءات كل موظف خلال الفترة المحددة</caption>
        <thead><tr><th scope="col">الموظف</th><th scope="col">القسم والمسؤولية</th><th scope="col">تقييم الفترة</th><th scope="col">استلم</th><th scope="col">سلم</th><th scope="col">متأخرة</th></tr></thead>
        <tbody>{filtered.map(person => <tr key={person.id}>
          <th scope="row" className="to-person"><strong>{person.name || "موظف"}</strong>{person.job_title && <small>{person.job_title}</small>}<small>نوع الموظف {employmentTypeLabel(person.employment_type)}</small></th>
          <td data-label="القسم والمسؤولية"><EmployeeDepartments person={person}/></td>
          <td data-label="تقييم الفترة"><EmployeeRating person={person}/></td>
          <td data-label="استلم" className="to-count">{number.format(person.received_count || 0)}</td>
          <td data-label="سلم" className="to-count">{number.format(person.delivered_count || 0)}</td>
          <td data-label="متأخرة" className={`to-count${person.late_count > 0 ? " is-late" : ""}`}><strong>{number.format(person.late_count || 0)}</strong>{person.late_count > 0 && <small>{number.format(person.late_open_count || 0)} لم تسلم بعد<br/>{number.format(person.late_delivered_count || 0)} سلمت متأخرة{person.late_ended_count > 0 && <><br/>{number.format(person.late_ended_count)} أغلقت أو نقلت بعد التأخر</>}</small>}</td>
        </tr>)}</tbody>
      </table></div> : <div className="to-state"><Users size={25} aria-hidden="true"/><strong>{people.length ? "لا يوجد موظف يطابق البحث" : "لا يوجد موظفون للعرض"}</strong>{people.length > 0 && <button type="button" onClick={() => setSearch("")}>عرض كل الموظفين</button>}</div>}
      <details className="to-explanation"><summary>كيف تقرأ هذه الأرقام</summary><div>
        <p>استلم عند قبول الموظف للمهمة خلال الفترة وسلم عند أول تسليم له دون تكرار عدد الملفات</p>
        <p>متأخرة تعني مهاما تجاوزت موعد الموظف المعتمد الذي يقع خلال الفترة وتشمل ما لم يسلم بعد وما سلم متأخرا وما أغلق أو نقل بعد التأخر</p>
        <p>تقييم الفترة هو مؤشر الأداء الحالي من 100 ويعتمد على سرعة الإنجاز وحجم العمل المكتمل ويتطلب خمس مهام مكتملة وعشر نقاط جهد على الأقل</p>
        <p>المهام المسلمة بانتظار الاعتماد تظهر في عدد التسليمات ويكتمل أثرها في التقييم بعد اكتمالها</p>
      </div></details>
    </>}
  </section>;
}
