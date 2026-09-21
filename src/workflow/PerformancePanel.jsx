import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSessionState } from '../shared/session-state';
import {
  Activity,
  AlertTriangle,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Gauge,
  Search,
  SlidersHorizontal,
  Star,
  RefreshCw,
  ShieldCheck,
  Users,
  ArrowUpLeft,
  X,
} from 'lucide-react';
import { repository, workError } from './data';
import { employmentTypeLabel, handlesCustomerCommunication } from './staff-identity';
import './performance-panel.css';
import MonthlyAwards from './MonthlyAwards';

const periods = [
  { days: 30, label: 'آخر 30 يوما' },
  { days: 90, label: 'آخر 90 يوما' },
];

const numberFormatter = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 1 });

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function score(value) {
  return Math.min(100, Math.max(0, numeric(value)));
}

function displayNumber(value, fallback = 'غير متاح') {
  if (value === null || value === undefined || value === '') return fallback;
  return numberFormatter.format(numeric(value));
}

function ScoreBar({ label, value, state = 'ready', subject }) {
  const current = score(value);
  const unavailable = state !== 'ready';
  const pendingSetup = state === 'pending_setup';
  const stateLabel = pendingSetup ? 'بانتظار تفعيل الحساب' : 'قيد الاكتمال';
  const accessibleLabel = pendingSetup
    ? `${label} ${subject || ''} بانتظار تفعيل الحساب`.trim()
    : subject ? `${label} ${subject}` : label;
  return (
    <div className={`op-score-bar${unavailable ? ' is-muted' : ''}`}>
      <div>
        <span>{label}</span>
        <strong>{unavailable ? stateLabel : `${displayNumber(current)} من 100`}</strong>
      </div>
      <progress
        max="100"
        value={unavailable ? 0 : current}
        aria-label={accessibleLabel}
        aria-valuetext={pendingSetup ? 'بانتظار تفعيل الحساب' : unavailable ? 'البيانات غير كافية' : `${displayNumber(current)} من 100`}
      />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="op-performance-summary-card">
      <Icon size={20} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function departmentIdentity(department) {
  if (department && typeof department === 'object') {
    return cleanText(department.id || department.service_id || department.department_id || department.name);
  }
  return cleanText(String(department ?? ''));
}

function personDepartments(person) {
  const memberships = Array.isArray(person.departments) ? person.departments : [];
  const responsibilities = Array.isArray(person.responsible_departments) ? person.responsible_departments : [];
  const responsibleKeys = new Set(
    responsibilities.flatMap(department => {
      if (!department || typeof department !== 'object') return [departmentIdentity(department)].filter(Boolean);
      return [
        departmentIdentity(department),
        cleanText(department.id),
        cleanText(department.name),
      ].filter(Boolean);
    }),
  );
  const combined = [
    ...(handlesCustomerCommunication(person) && ![...memberships, ...responsibilities].some(item => item?.name === 'الإشراف على الطلبات')
      ? [{ id: 'customer-communication', name: 'الإشراف على الطلبات' }] : []),
    ...memberships,
    ...responsibilities.filter(department => department && typeof department === 'object'),
  ];
  const seen = new Set();

  return combined.reduce((departments, department) => {
    if (!department || typeof department !== 'object') return departments;
    const name = cleanText(department.name);
    if (!name) return departments;
    const id = departmentIdentity(department) || name;
    const identity = cleanText(department.id) || name;
    if (seen.has(identity)) return departments;
    seen.add(identity);
    departments.push({
      id,
      name,
      responsible: cleanText(department.member_role).toLowerCase() === 'lead'
        || responsibleKeys.has(id)
        || responsibleKeys.has(cleanText(department.id))
        || responsibleKeys.has(name),
    });
    return departments;
  }, []);
}

function performanceState(person) {
  if (person.pending_setup) return 'pending_setup';
  if (person.insufficient_data) return 'insufficient';
  return 'ready';
}

function MeasurementReadiness({person}) {
  return <div className="op-measurement-readiness">
    <div><span>اكتمال بيانات القياس</span><strong>نحتاج خمس مهام منجزة وعشر نقاط جهد</strong></div>
    <div className="op-readiness-grid">
      <div><span>المهام المنجزة<strong>{displayNumber(person.completed_count, '0')} من ٥</strong></span><progress max="5" value={Math.min(5,numeric(person.completed_count))} aria-label="المهام المطلوبة لاكتمال القياس"/></div>
      <div><span>نقاط الجهد<strong>{displayNumber(person.completed_points, '0')} من ١٠</strong></span><progress max="10" value={Math.min(10,numeric(person.completed_points))} aria-label="نقاط الجهد المطلوبة لاكتمال القياس"/></div>
    </div>
  </div>;
}

function PersonRow({person,onOpen}) {
  const state=performanceState(person),ready=state==='ready';
  const name=cleanText(person.name)||'عضو الفريق';
  const departments=personDepartments(person);
  const lead=departments.find(item=>item.responsible);
  return <article className={`op-roster-row is-${state}`} aria-label={`ملخص أداء ${name}`}>
    <div className="op-roster-identity"><span className="op-roster-avatar" aria-hidden="true"><Users size={23}/></span><div><h3>{name}</h3><p>{cleanText(person.job_title)||'المسمى الوظيفي غير محدد'}</p><p>نوع الموظف {employmentTypeLabel(person.employment_type)}</p><div className="op-roster-departments">{lead&&<span className="op-roster-lead"><ShieldCheck size={13} aria-hidden="true"/>مسؤول {lead.name}</span>}<span>{departments.length?departments.slice(0,2).map(item=>item.name).join(' و'):'لا توجد أقسام مرتبطة'}{departments.length>2&&` و${displayNumber(departments.length-2)} أقسام أخرى`}</span></div></div></div>
    <div className={`op-roster-score${ready?'':' is-unavailable'}`} aria-label={ready?`نتيجة الأداء ${displayNumber(person.performance_score)} من 100`:state==='pending_setup'?'بانتظار تفعيل الحساب':'بيانات الأداء غير كافية'}>
      {ready?<><strong>{displayNumber(person.performance_score)}</strong><span>من ١٠٠</span></>:<><Clock3 size={17} aria-hidden="true"/><strong>{state==='pending_setup'?'بانتظار التفعيل':'قيد اكتمال القياس'}</strong></>}
    </div>
    <div className="op-roster-metric" role="group" aria-label="المهام المنجزة"><span>المنجزة</span><strong>{displayNumber(person.completed_count,'0')}</strong><small>مهمة</small></div>
    <div className="op-roster-metric is-points" role="group" aria-label="نقاط الجهد المنجزة"><span>نقاط الجهد</span><strong>{displayNumber(person.completed_points,'0')}</strong><small>نقطة منجزة</small></div>
    <div className="op-roster-metric" role="group" aria-label="المهام المفتوحة"><span>المفتوحة</span><strong>{displayNumber(person.open_count,'0')}</strong><small>مهمة</small></div>
    <button type="button" className="op-roster-open" onClick={onOpen} aria-label={`عرض أداء ${name}`}><span>التفاصيل</span><ArrowUpLeft size={19} aria-hidden="true"/></button>
  </article>;
}

function PersonDialog({person,days,onClose}) {
  const dialog=useRef(null),titleId=useId();
  useEffect(() => {
    const previous = document.activeElement;
    const modal = dialog.current;
    modal.showModal();
    return () => {
      modal.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={dialog} className="op-performance op-performance-dialog" aria-labelledby={titleId} dir="rtl" onCancel={event=>{event.preventDefault();onClose();}}>
    <header className="op-dialog-heading"><div><span className="op-panel-eyebrow">تفاصيل الأداء</span><h2 id={titleId}>{cleanText(person.name)||'عضو الفريق'}</h2><p>{periods.find(period=>period.days===days)?.label}</p></div><button type="button" onClick={onClose} aria-label="إغلاق تفاصيل الأداء"><X size={20} aria-hidden="true"/></button></header>
    <PersonCard person={person}/>
    <p className="op-dialog-footnote"><ShieldCheck size={16} aria-hidden="true"/>عرض خاص حسب صلاحياتك وتحتسب النتائج من بيانات العمل المسجلة</p>
  </dialog>;
}

function CoordinationBreakdown({ coordination }) {
  const titleId = useId();
  if (!coordination || !['assigned_count', 'completed_count', 'open_count'].some(key => numeric(coordination[key]) > 0)) return null;

  const activities = [
    ['intake_completed', 'استلام الطلبات ومراجعتها'],
    ['delivery_review_completed', 'مراجعة التسليمات'],
    ['revision_review_completed', 'مراجعة طلبات التعديل'],
  ];

  return (
    <section className="op-coordination-breakdown" aria-labelledby={titleId}>
      <div className="op-coordination-heading">
        <h4 id={titleId}>مهام المشرف المسؤول</h4>
        <p>تدخل أعمال الاستلام والمراجعة في إجمالي المهام ونقاط الجهد المعروضة</p>
      </div>
      <dl className="op-coordination-totals">
        <div><dt>منجزة</dt><dd>{displayNumber(coordination.completed_count, '0')}</dd></div>
        <div><dt>مفتوحة</dt><dd>{displayNumber(coordination.open_count, '0')}</dd></div>
        <div><dt>نقاط جهد منجزة</dt><dd>{displayNumber(coordination.completed_points, '0')}</dd></div>
      </dl>
      <div className="op-coordination-activities">
        <span>تفصيل الأعمال المنجزة</span>
        <dl>{activities.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{displayNumber(coordination[key], '0')}</dd></div>)}</dl>
      </div>
    </section>
  );
}

function PersonCard({ person }) {
  const insufficient = Boolean(person.insufficient_data);
  const pendingSetup = Boolean(person.pending_setup);
  const performanceState = pendingSetup ? 'pending_setup' : insufficient ? 'insufficient' : 'ready';
  const scoreUnavailable = performanceState !== 'ready';
  const scoreLabel = pendingSetup
    ? 'بانتظار تفعيل الحساب'
    : insufficient ? 'قيد الاكتمال' : `${displayNumber(person.performance_score)} من 100`;
  const scoreAccessibleLabel = pendingSetup
    ? 'بانتظار تفعيل الحساب'
    : insufficient ? 'بيانات الأداء غير كافية' : `نتيجة الأداء ${displayNumber(person.performance_score)} من 100`;
  const personName = cleanText(person.name) || 'عضو الفريق';
  const jobTitle = cleanText(person.job_title) || 'المسمى الوظيفي غير محدد';
  const departments = personDepartments(person);
  return (
    <article className={`op-person-card${scoreUnavailable?' is-unavailable':''}`}>
      <header>
        <div className="op-person-identity">
          <span className="op-person-kicker">ملف الإنجاز</span>
          <h3>{personName}</h3>
          {pendingSetup && (
            <span className="op-person-setup-status">
              <Clock3 size={15} aria-hidden="true" />
              بانتظار تفعيل الحساب
            </span>
          )}
          <p className={`op-person-job-title${cleanText(person.job_title) ? '' : ' is-missing'}`}>
            <BriefcaseBusiness size={16} aria-hidden="true" />
            <span>{jobTitle}</span>
          </p>
          <p className="op-person-job-title">نوع الموظف {employmentTypeLabel(person.employment_type)}</p>
          <div className="op-person-departments">
            <span className="op-person-departments-label">الأقسام</span>
            {departments.length > 0 ? (
              <ul aria-label={`الأقسام المرتبطة بالموظف ${personName}`}>
                {departments.map(department => (
                  <li key={department.id} className={department.responsible ? 'is-responsible' : undefined}>
                    <Building2 size={15} aria-hidden="true" />
                    <span className="op-person-department-name">{department.name}</span>
                    {department.responsible && (
                      <span className="op-person-department-status">
                        <Star size={13} aria-hidden="true" />
                        مسؤول
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="op-person-departments-empty">
                <Building2 size={15} aria-hidden="true" />
                لا توجد أقسام مرتبطة
              </span>
            )}
          </div>
        </div>
        <div className={`op-person-score op-score-display${scoreUnavailable ? ' is-pending' : ''}${pendingSetup ? ' is-setup' : ''}`} aria-label={scoreAccessibleLabel}>
          <span>نتيجة الأداء</span>
          <strong>{scoreUnavailable?scoreLabel:displayNumber(person.performance_score)}</strong>
          {!scoreUnavailable&&<small>من ١٠٠</small>}
          {numeric(person.routing_penalty_points)>0&&<small>خصم أخطاء الإحالة {displayNumber(person.routing_penalty_points)} نقطة</small>}
        </div>
      </header>

      {performanceState === 'insufficient' && <MeasurementReadiness person={person}/>}
      {pendingSetup&&<p className="op-setup-description">تظهر بيانات الأداء بعد تفعيل الحساب وبدء العمل على المهام المسندة</p>}

      {!scoreUnavailable&&<div className="op-person-bars">
        <ScoreBar label="سرعة الإنجاز" value={person.speed_score} state={performanceState} subject={personName} />
        <ScoreBar label="حجم الإنجاز" value={person.volume_score} state={performanceState} subject={personName} />
      </div>}

      <div className="op-effort-ledger"><div><span>نقاط الجهد المنجزة</span><strong>{displayNumber(person.completed_points,'0')}<small>نقطة</small></strong></div><div><span>نقاط الجهد المسندة</span><strong>{displayNumber(person.assigned_points,'0')}<small>نقطة</small></strong></div><p>نقاط الجهد تعبر عن حجم العمل وتختلف عن نتيجة الأداء من ١٠٠</p></div>

      <dl className="op-person-facts">
        <div>
          <dt>المهام المسندة</dt>
          <dd>{displayNumber(person.assigned_count, '0')}</dd>
        </div>
        <div>
          <dt>المهام المنجزة</dt>
          <dd>{displayNumber(person.completed_count, '0')}</dd>
        </div>
        <div>
          <dt>المهام المفتوحة</dt>
          <dd>{displayNumber(person.open_count, '0')}</dd>
        </div>
        <div>
          <dt>متوسط ساعات العمل</dt>
          <dd>{displayNumber(person.average_active_hours)}</dd>
        </div>
      </dl>

      <CoordinationBreakdown coordination={person.coordination} />

      {!pendingSetup && numeric(person.estimated_count) > 0 && (
        <p className="op-estimated-note">
          <Clock3 size={16} aria-hidden="true" />
          توجد {displayNumber(person.estimated_count)} مهام بوقت تقديري حتى يكتمل القياس الدقيق
        </p>
      )}
    </article>
  );
}

export default function PerformancePanel({ compact = false, viewer = 'team' }) {
  const titleId = useId();
  const selfView = viewer === 'self';
  const stateKey = `performance.${viewer}`;
  const [days, setDays] = useSessionState(`${stateKey}.days`,30,{validate:value=>periods.some(period=>period.days===value)});
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useSessionState(`${stateKey}.search`,'',{validate:value=>typeof value==='string'});
  const [department, setDepartment] = useSessionState(`${stateKey}.department`,'all',{validate:value=>typeof value==='string'});
  const [readiness, setReadiness] = useSessionState(`${stateKey}.readiness`,'all',{validate:value=>['all','ready','insufficient','pending_setup'].includes(value)});
  const [sortBy, setSortBy] = useSessionState(`${stateKey}.sort`,'name',{validate:value=>['name','score','speed','completed','points','open'].includes(value)});
  const [selectedId,setSelectedId]=useSessionState(`${stateKey}.selected`,null,{validate:value=>value===null||typeof value==='string'});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    repository.performance(days)
      .then(data => {
        if (active) setPayload(data || {});
      })
      .catch(reason => {
        if (active) setError(workError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days, reloadKey]);

  const people = useMemo(() => {
    const rows = Array.isArray(payload?.people) ? payload.people : [];
    const term = search.trim().toLocaleLowerCase('ar');
    const filtered = rows.filter(person => {
      const departments = personDepartments(person);
      const matchesSearch = !term || [person.name, person.job_title, employmentTypeLabel(person.employment_type), ...departments.map(item => item.name)]
        .some(value => cleanText(value).toLocaleLowerCase('ar').includes(term));
      const matchesDepartment = department === 'all' || departments.some(item => item.id === department || item.name === department);
      const matchesReadiness = readiness === 'all' || performanceState(person) === readiness;
      return matchesSearch && matchesDepartment && matchesReadiness;
    });
    return [...filtered].sort((left, right) => {
      if (sortBy === 'score') return numeric(right.performance_score, -1) - numeric(left.performance_score, -1) || String(left.name || '').localeCompare(String(right.name || ''), 'ar');
      if (sortBy === 'speed') return numeric(right.speed_score) - numeric(left.speed_score) || String(left.name || '').localeCompare(String(right.name || ''), 'ar');
      if (sortBy === 'completed') return numeric(right.completed_count) - numeric(left.completed_count) || String(left.name || '').localeCompare(String(right.name || ''), 'ar');
      if (sortBy === 'points') return numeric(right.completed_points) - numeric(left.completed_points) || String(left.name || '').localeCompare(String(right.name || ''), 'ar');
      if (sortBy === 'open') return numeric(right.open_count) - numeric(left.open_count) || String(left.name || '').localeCompare(String(right.name || ''), 'ar');
      return String(left.name || '').localeCompare(String(right.name || ''), 'ar');
    });
  }, [department, payload, readiness, search, sortBy]);

  const departments = useMemo(() => {
    const rows = Array.isArray(payload?.people) ? payload.people : [];
    const unique = new Map();
    rows.flatMap(personDepartments).forEach(item => unique.set(item.id || item.name, item));
    return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, 'ar'));
  }, [payload]);

  const sourcePeople = Array.isArray(payload?.people) ? payload.people : [];
  const selectedPerson=sourcePeople.find(person=>(person.id||person.name)===selectedId);
  const summary = payload?.summary || {};
  const filteredScores = people.map(person => person.performance_score).filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const average = !selfView && (search || department !== 'all' || readiness !== 'all')
    ? filteredScores.length ? Math.round(filteredScores.reduce((total, value) => total + numeric(value), 0) / filteredScores.length) : null
    : summary.average_score;
  const activeFilters = Boolean(search || department !== 'all' || readiness !== 'all' || sortBy !== 'name');

  function clearFilters() {
    setSearch('');
    setDepartment('all');
    setReadiness('all');
    setSortBy('name');
  }

  return (
    <section className={`op-performance${compact ? ' is-compact' : ''}${selfView ? ' is-self' : ''}`} dir="rtl" aria-labelledby={titleId} aria-busy={loading}>
      <header className="op-panel-header">
        <div>
          <span className="op-panel-eyebrow">{selfView ? 'أداؤك الخاص' : 'قياس الأداء'}</span>
          <h2 id={titleId}>{selfView ? 'مؤشرات إنجازي' : 'الفريق وراء الإنجاز'}</h2>
          <p>{selfView ? 'راجع سرعة الإنجاز وحجم العمل خلال الفترة المختارة بقياس خاص بك' : 'نظرة واضحة على أداء كل موظف وحجم إنجازه وما يعمل عليه الآن'}</p>
        </div>
        <div className="op-private-label">
          <ShieldCheck size={18} aria-hidden="true" />
          {selfView ? 'عرض خاص بك' : 'عرض خاص حسب الصلاحية'}
        </div>
      </header>

      <div className="op-performance-controls">
        {!selfView&&<MonthlyAwards/>}
        <div className="op-period-picker" role="group" aria-label="فترة قياس الأداء">
          {periods.map(period => (
            <button
              key={period.days}
              type="button"
              aria-pressed={days === period.days}
              onClick={() => setDays(period.days)}
              disabled={loading && days === period.days}
            >
              {period.label}
            </button>
          ))}
        </div>
        <button className="op-icon-action" type="button" onClick={() => setReloadKey(value => value + 1)} disabled={loading} aria-label="إعادة تحميل مؤشرات الأداء">
          <RefreshCw size={18} aria-hidden="true" />
          <span>تحديث</span>
        </button>
      </div>

      {!loading && !error && people.length > 0 && !selfView && (
          <div className="op-performance-summary" aria-label="ملخص الأداء">
            <SummaryCard icon={Gauge} label="متوسط الأداء" value={average === null || average === undefined ? 'لم يكتمل القياس' : `${displayNumber(average)} من 100`} hint="الموظفون المكتمل قياسهم فقط"/>
            <SummaryCard icon={CheckCircle2} label="المهام المنجزة" value={displayNumber(activeFilters ? people.reduce((total, person) => total + numeric(person.completed_count), 0) : summary.completed, '0')} />
            <SummaryCard icon={Activity} label="المهام المفتوحة" value={displayNumber(activeFilters ? people.reduce((total, person) => total + numeric(person.open_count), 0) : summary.active, '0')} />
            <SummaryCard icon={Users} label="أعضاء الفريق" value={displayNumber(activeFilters ? people.length : summary.people ?? people.length, '0')} hint="بحسب نطاق صلاحيتك" />
          </div>
      )}

      {!selfView && !loading && !error && sourcePeople.length > 0 && (
        <section className="op-performance-filters" aria-label="البحث وتصفية أداء الفريق">
          <div className="op-filter-heading">
            <span><SlidersHorizontal size={17} aria-hidden="true" />تصفية الفريق</span>
            <span role="status">{displayNumber(people.length, '0')} من {displayNumber(sourcePeople.length, '0')} موظف</span>
          </div>
          <div className="op-filter-grid">
            <label className="op-filter-search">
              <span><Search size={16} aria-hidden="true" />البحث</span>
              <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="اسم الموظف أو المسمى الوظيفي" />
            </label>
            <label>
              <span>القسم</span>
              <select value={department} onChange={event => setDepartment(event.target.value)}>
                <option value="all">كل الأقسام</option>
                {departments.map(item => <option key={item.id || item.name} value={item.id || item.name}>{item.name}</option>)}
              </select>
            </label>
            <label>
              <span>جاهزية القياس</span>
              <select value={readiness} onChange={event => setReadiness(event.target.value)}>
                <option value="all">كل الحالات</option>
                <option value="ready">قياس مكتمل</option>
                <option value="insufficient">يحتاج مزيدا من المهام</option>
                <option value="pending_setup">بانتظار تفعيل الحساب</option>
              </select>
            </label>
            <label>
              <span>الترتيب</span>
              <select value={sortBy} onChange={event => setSortBy(event.target.value)}>
                <option value="name">الاسم</option>
                <option value="score">النتيجة الأعلى</option>
                <option value="speed">سرعة الإنجاز</option>
                <option value="completed">المهام المنجزة</option>
                <option value="points">نقاط الجهد المنجزة</option>
                <option value="open">المهام المفتوحة</option>
              </select>
            </label>
          </div>
          {activeFilters && <button type="button" className="op-clear-filters" onClick={clearFilters}>مسح التصفية</button>}
        </section>
      )}

      {loading && (
        <div className="op-panel-state" role="status" aria-live="polite">
          <Activity className="op-spin" size={24} aria-hidden="true" />
          <strong>يجري حساب المؤشرات</strong>
          <span>نعرض وقت العمل الفعلي والمهام المؤهلة فقط</span>
        </div>
      )}

      {!loading && error && (
        <div className="op-panel-state is-error" role="alert">
          <AlertTriangle size={24} aria-hidden="true" />
          <strong>تعذر تحميل مؤشرات الأداء</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setReloadKey(value => value + 1)}>إعادة المحاولة</button>
        </div>
      )}

      {!loading && !error && people.length === 0 && (
        <div className="op-panel-state" role="status">
          <ClipboardList size={26} aria-hidden="true" />
          <strong>{sourcePeople.length > 0 ? 'لا توجد نتائج مطابقة' : 'لا توجد بيانات أداء بعد'}</strong>
          <span>{sourcePeople.length > 0 ? 'غيّر البحث أو التصفية لعرض أعضاء الفريق' : 'ستظهر المؤشرات بعد إسناد المهام وبدء إنجازها'}</span>
          {sourcePeople.length > 0 && <button type="button" onClick={clearFilters}>عرض كل الموظفين</button>}
        </div>
      )}

      {!loading && !error && people.length > 0 && (
        <>
          {selfView?<div className="op-people-grid">{people.map(person=><PersonCard key={person.id||person.name} person={person}/>)}</div>:<section className="op-roster" aria-label="مؤشرات الموظفين">
            <header className="op-roster-heading"><div><h3>أداء الموظفين</h3><p>نتيجة الأداء من ١٠٠ ونقاط الجهد توضح حجم العمل المنجز</p></div><span>{displayNumber(people.length)} موظف</span></header>
            <div className="op-roster-columns" aria-hidden="true"><span>الموظف والأقسام</span><span>نتيجة الأداء</span><span>المهام المنجزة</span><span>نقاط الجهد</span><span>المهام المفتوحة</span><span/></div>
            <div className="op-roster-list">{people.map(person=><PersonRow key={person.id||person.name} person={person} onOpen={()=>setSelectedId(person.id||person.name)}/>)}</div>
            <footer className="op-roster-footer"><ShieldCheck size={15} aria-hidden="true"/>يظهر الأداء بحسب صلاحيتك دون ترتيب علني لأعضاء الفريق</footer>
          </section>}
        </>
      )}
      {selectedPerson&&!selfView&&!loading&&!error&&<PersonDialog key={selectedId} person={selectedPerson} days={days} onClose={()=>setSelectedId(null)}/>}
    </section>
  );
}
