import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { changeDatePart, clampDate, dateLabel, daysInMonth, isDateOnly, riyadhDate } from './date-only';
import './date-picker.css';

const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const number = new Intl.NumberFormat('ar-SA', { useGrouping: false });
const range = (start, end) => Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
const ROW = 48;

function DateWheel({ label, options, value, onChange }) {
  const id = useId();
  const viewport = useRef(null);
  const timer = useRef(null);
  const gesture = useRef(null);
  const latest = useRef({ options, onChange });
  latest.current = { options, onChange };
  const index = Math.max(0, options.findIndex(option => option.value === value));
  const optionsKey = options.map(option => option.value).join(':');
  useLayoutEffect(() => {
    clearTimeout(timer.current);
    viewport.current.scrollTop = index * ROW;
  }, [index, optionsKey]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function settle() {
    const current = latest.current;
    const next = Math.max(0, Math.min(current.options.length - 1, Math.round(viewport.current.scrollTop / ROW)));
    viewport.current.scrollTop = next * ROW;
    current.onChange(current.options[next].value);
  }
  function step(offset) {
    onChange(options[Math.max(0, Math.min(options.length - 1, index + offset))].value);
  }
  return <div className="pv-date-wheel">
    <span className="pv-date-wheel-label" id={`${id}-label`}>{label}</span>
    <button type="button" className="pv-date-step" aria-label={`${label} السابق`} disabled={index === 0} onClick={() => step(-1)}><ChevronUp size={16} aria-hidden="true"/></button>
    <div className="pv-date-wheel-window">
      <div ref={viewport} className="pv-date-wheel-scroll" role="listbox" tabIndex={0} aria-labelledby={`${id}-label`} aria-activedescendant={`${id}-${value}`}
        onScroll={() => { clearTimeout(timer.current); if (!gesture.current) timer.current = setTimeout(settle, 130); }}
        onKeyDown={event => {
          const offsets = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5, Home: -options.length, End: options.length };
          if (event.key in offsets) { event.preventDefault(); step(offsets[event.key]); }
        }}
        onPointerDown={event => {
          if (event.pointerType !== 'mouse' || event.button !== 0) return;
          clearTimeout(timer.current);
          gesture.current = { y: event.clientY, top: viewport.current.scrollTop, moved: false };
        }}
        onPointerMove={event => {
          const start = gesture.current;
          if (!start) return;
          if (Math.abs(event.clientY - start.y) > 4) {
            start.moved = true;
            viewport.current.setPointerCapture(event.pointerId);
            viewport.current.style.scrollSnapType = 'none';
            viewport.current.scrollTop = start.top + start.y - event.clientY;
          }
        }}
        onPointerUp={event => {
          const moved = gesture.current?.moved;
          gesture.current = null;
          viewport.current.style.scrollSnapType = '';
          if (viewport.current.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId);
          if (moved) { event.preventDefault(); settle(); }
        }}
        onPointerCancel={() => { gesture.current = null; viewport.current.style.scrollSnapType = ''; settle(); }}
        onPointerLeave={() => { if (!gesture.current?.moved) gesture.current = null; }}>
        {options.map(option => <div key={option.value} id={`${id}-${option.value}`} data-value={option.value} role="option" aria-selected={option.value === value} className="pv-date-option" onClick={() => onChange(option.value)}>{option.label}</div>)}
      </div>
    </div>
    <button type="button" className="pv-date-step" aria-label={`${label} التالي`} disabled={index === options.length - 1} onClick={() => step(1)}><ChevronDown size={16} aria-hidden="true"/></button>
  </div>;
}

export default function DatePicker({ label, name, value, defaultValue = '', onChange, min, max, required = false, disabled = false, hint, id: suppliedId, 'aria-invalid': invalid, 'aria-describedby': describedBy }) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  const [internal, setInternal] = useState(defaultValue);
  const selected = value === undefined ? internal : value;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const trigger = useRef(null);
  const panel = useRef(null);
  const backdropPress = useRef(false);
  const input = useRef(null);
  const today = riyadhDate();
  const lower = min || '1900-01-01';
  const upper = max || `${Math.max(Number(today.slice(0, 4)) + 20, Number(selected?.slice(0, 4)) || 0)}-12-31`;
  const possible = lower <= upper;
  const current = clampDate(isDateOnly(draft) ? draft : today, lower, upper);
  const [year, month, day] = current.split('-').map(Number);
  const badValue = Boolean(selected && (!isDateOnly(selected) || selected < lower || selected > upper));

  useLayoutEffect(() => { input.current.setCustomValidity(badValue ? 'اختر تاريخا ضمن الفترة المتاحة' : ''); }, [badValue]);
  useLayoutEffect(() => {
    if (!open || disabled || !possible) return;
    const dialog = panel.current;
    dialog.showModal();
    // The wheels first mount while the native dialog is hidden
    for (const wheel of dialog.querySelectorAll('[role="listbox"]')) {
      const rows = [...wheel.querySelectorAll('[role="option"]')];
      wheel.scrollTop = Math.max(0, rows.findIndex(row => row.getAttribute('aria-selected') === 'true')) * ROW;
    }
    dialog.querySelector('[role="listbox"]')?.focus({ preventScroll: true });
    return () => { if (dialog.open) dialog.close(); };
  }, [open, disabled, possible]);
  useEffect(() => { if (disabled || !possible) setOpen(false); }, [disabled, possible]);
  function show() { setDraft(clampDate(isDateOnly(selected) ? selected : today, lower, upper)); setOpen(true); }
  function close() { panel.current?.close(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  function outsidePanel(event) {
    if (event.target !== panel.current) return false;
    const bounds = panel.current.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  function containFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = [...panel.current.querySelectorAll('button:not(:disabled), [role="listbox"]')].filter(element => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function choose(next) { setDraft(previous => changeDatePart(previous || current, next.part, next.value, lower, upper)); }
  function commit(next) { setInternal(next); onChange?.(next); setError(false); close(); }
  function confirm() {
    // Read the visible rows too so a quick confirmation cannot save a pre-scroll value
    const [visibleDay, visibleMonth, visibleYear] = [...panel.current.querySelectorAll('[role="listbox"]')].map(wheel => {
      const rows = wheel.querySelectorAll('[role="option"]');
      return Number(rows[Math.max(0, Math.min(rows.length - 1, Math.round(wheel.scrollTop / ROW)))].dataset.value);
    });
    const next = [visibleYear, visibleMonth, Math.min(visibleDay, daysInMonth(visibleYear, visibleMonth))].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
    commit(clampDate(next, lower, upper));
  }
  const yearOptions = range(Number(lower.slice(0, 4)), Number(upper.slice(0, 4))).map(value => ({ value, label: number.format(value) }));
  const monthOptions = range(year === Number(lower.slice(0, 4)) ? Number(lower.slice(5, 7)) : 1, year === Number(upper.slice(0, 4)) ? Number(upper.slice(5, 7)) : 12).map(value => ({ value, label: months[value - 1] }));
  const prefix = current.slice(0, 7);
  const dayOptions = range(prefix === lower.slice(0, 7) ? Number(lower.slice(8)) : 1, prefix === upper.slice(0, 7) ? Number(upper.slice(8)) : daysInMonth(year, month)).map(value => ({ value, label: number.format(value) }));

  return <div className="pv-date" dir="rtl" onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <label className="pv-date-label" htmlFor={id}>{label}</label>
    <input ref={input} className="pv-date-validation" name={name} value={selected} onChange={() => {}} required={required} disabled={disabled} tabIndex={-1} aria-hidden="true" onInvalid={event => { event.preventDefault(); setError(true); trigger.current?.focus(); }}/>
    <button ref={trigger} id={id} type="button" className="pv-date-trigger" disabled={disabled || !possible} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`} aria-invalid={invalid || error || badValue || undefined} aria-describedby={[describedBy, hint ? `${id}-hint` : '', error || badValue ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} onClick={() => open ? close() : show()}>
      <span className={selected ? '' : 'pv-date-placeholder'}>{selected ? dateLabel(selected) : 'اختر التاريخ'}</span><ChevronDown size={18} aria-hidden="true"/>
    </button>
    {hint && <small className="pv-date-hint" id={`${id}-hint`}>{hint}</small>}
    {(error || badValue) && <span className="pv-date-error" role="alert" id={`${id}-error`}>{badValue ? 'اختر تاريخا ضمن الفترة المتاحة' : 'اختر التاريخ لإكمال المتابعة'}</span>}
    {open && !disabled && possible && <dialog ref={panel} className="pv-date-panel" id={`${id}-panel`} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-instructions`}
      onKeyDown={containFocus}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onPointerDown={event => { backdropPress.current = outsidePanel(event); }}
      onClick={event => { if (backdropPress.current && outsidePanel(event)) close(); backdropPress.current = false; }}>
      <div className="pv-date-heading"><div><strong id={`${id}-title`}>{label}</strong><span id={`${id}-instructions`}>اسحب لاختيار اليوم والشهر والسنة</span></div><button type="button" className="pv-date-close" aria-label="إلغاء اختيار التاريخ" onClick={close}><X size={18} aria-hidden="true"/></button></div>
      <div className="pv-date-wheels">
        <DateWheel label="اليوم" options={dayOptions} value={day} onChange={value => choose({ part: 2, value })}/>
        <DateWheel label="الشهر" options={monthOptions} value={month} onChange={value => choose({ part: 1, value })}/>
        <DateWheel label="السنة" options={yearOptions} value={year} onChange={value => choose({ part: 0, value })}/>
      </div>
      <div className="pv-date-preview" aria-live="polite" aria-atomic="true"><span>التاريخ المختار</span><strong>{dateLabel(current)}</strong></div>
      <div className="pv-date-actions"><button type="button" className="pv-date-confirm" onClick={confirm}><Check size={18} aria-hidden="true"/>تأكيد التاريخ</button><button type="button" className="pv-date-cancel" onClick={close}>إلغاء</button>{!required && selected && <button type="button" className="pv-date-clear" onClick={() => commit('')}>مسح</button>}</div>
    </dialog>}
  </div>;
}
