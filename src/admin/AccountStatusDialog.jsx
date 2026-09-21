import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { accountRequest } from '../auth/supabase';
import { platformError } from './platform';
import './account-dialog.css';
import './account-access.css';
import DatePicker from '../shared/DatePicker';
import {dateLabel,endOfRiyadhDay,riyadhDate} from '../shared/date-only';
import {useSessionState,useSessionStore} from '../shared/session-state';

const statusLabels = { active: 'الحساب نشط', suspended: 'الحساب موقوف دائما', temporary: 'الحساب موقوف مؤقتا', deleted: 'الحساب محذوف' };
const operationLabels = { suspend: 'إيقاف دائم للحساب', 'suspend-until': 'إيقاف مؤقت للمراجعة', reactivate: 'إعادة تفعيل الحساب', delete: 'حذف الحساب' };
const successLabels = { suspend: 'تم إيقاف دائم للحساب', 'suspend-until': 'تم إيقاف الحساب مؤقتا', reactivate: 'تمت إعادة تفعيل الحساب', delete: 'تم حذف الحساب' };

export function accountAccessLabel(status) {
  return statusLabels[status || 'active'] || 'حالة الحساب غير معروفة';
}

export default function AccountStatusDialog({ account, onClose:dismiss, onSaved }) {
  const dialog = useRef(null);
  const errorRef = useRef(null);
  const locked = useRef(false);
  const cleanupPending = account.access_status === 'deleted' && account.identity_cleanup_pending;
  const store=useSessionStore(),prefix=`account-status:${account.id}:`;
  const onClose=()=>{store?.clearPrefix(prefix);dismiss();};
  const [operation, setOperation] = useSessionState(`${prefix}operation`,cleanupPending ? 'delete' : account.access_status && account.access_status !== 'active' ? 'reactivate' : 'suspend-until',{validate:value=>Object.hasOwn(operationLabels,value)&&(!cleanupPending||value==='delete')});
  const [reason, setReason] = useSessionState(`${prefix}reason`,'');
  const [until, setUntil] = useSessionState(`${prefix}until`,'');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmationValue = account.email || account.display_name || '';
  const deleted = account.access_status === 'deleted' && !cleanupPending;

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current.showModal();
    return () => previousFocus?.focus?.();
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event) {
    event.preventDefault();
    if (locked.current || (deleted && !account.identity_cleanup_pending)) return;
    setError('');
    if (reason.trim().length < 3) {
      setError('اكتب سبب الإجراء من ثلاثة إلى ألف حرف');
      return;
    }
    const end = until ? new Date(endOfRiyadhDay(until)) : null;
    if (operation === 'suspend-until' && (!end || !Number.isFinite(end.getTime()) || end.getTime() < Date.now() + 60000 || end.getTime() > Date.now() + 366 * 86400000)) {
      setError('اختر تاريخا خلال السنة القادمة وتأكد أن نهاية اليوم لم تقترب');
      return;
    }
    if (operation === 'delete' && (!confirmationValue || confirmation.trim() !== confirmationValue)) {
      setError('اكتب بيانات تأكيد الحساب كما تظهر قبل اعتماد الحذف');
      return;
    }
    locked.current = true;
    setBusy(true);
    let saved = null;
    try {
      saved = await accountRequest({
        action: 'account-lifecycle',
        userId: account.id,
        operation,
        reason: reason.trim(),
        until: operation === 'suspend-until' ? end.toISOString() : null,
        confirmation: operation === 'delete' ? confirmation.trim() : undefined,
      });
    } catch (failure) {
      setError(failure.userFacing ? failure.message : platformError(failure));
    } finally {
      locked.current = false;
      setBusy(false);
    }
    if (saved) {
      onClose();
      onSaved(saved.identity_cleanup_pending ? 'تم منع الحساب نهائيا ويتبقى إكمال حذف بيانات الدخول' : successLabels[operation]);
    }
  }

  return <dialog ref={dialog} className="a-account-dialog a-access-dialog" dir="rtl" aria-labelledby="account-access-title" aria-describedby="account-access-intro" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header>
      <div><span className="a-eyebrow">صلاحية السوبر أدمن</span><h2 id="account-access-title">إدارة حالة الحساب</h2></div>
      <button type="button" aria-label="إغلاق إدارة حالة الحساب" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true"/></button>
    </header>
    <div className="a-access-account"><ShieldCheck size={22} aria-hidden="true"/><div><strong>{account.display_name || 'حساب المنصة'}</strong><bdi>{account.email}</bdi></div><span className={`a-access-state is-${account.access_status || 'active'}`}>{accountAccessLabel(account.access_status)}</span></div>
    <p id="account-access-intro">تحكم في دخول الحساب إلى المنصة مع توثيق سبب كل إجراء في سجل الإدارة</p>
    {cleanupPending && <p className="a-access-detail">دخول الحساب معطل نهائيا أعد تأكيد الحذف لإكمال حذف بيانات الدخول</p>}
    {account.suspension_reason && <p className="a-access-detail">سبب الإجراء الحالي {account.suspension_reason}</p>}
    {account.access_status === 'temporary' && account.suspended_until && <p className="a-access-detail">نهاية الإيقاف <time dateTime={account.suspended_until}>{dateLabel(account.suspended_until)}</time></p>}
    {error && <p ref={errorRef} tabIndex={-1} className="a-access-error" role="alert">{error}</p>}
    <form onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy || (deleted && !account.identity_cleanup_pending)}>
        <label htmlFor="account-access-operation">الإجراء المطلوب</label>
        <select id="account-access-operation" value={operation} disabled={cleanupPending} onChange={event=>{setOperation(event.target.value);setError('');setConfirmation('');}}>
          {!cleanupPending && !deleted && <option value="suspend-until">إيقاف مؤقت للمراجعة</option>}
          {!cleanupPending && !deleted && <option value="suspend">إيقاف دائم للحساب</option>}
          {!cleanupPending && account.access_status && account.access_status !== 'active' && <option value="reactivate">إعادة تفعيل الحساب</option>}
          <option value="delete">حذف الحساب</option>
        </select>
        <p className="a-access-help">{operation === 'reactivate' ? 'يسمح لصاحب الحساب بالدخول والعمل مجددا' : operation === 'delete' ? 'يلغى دخول الحساب نهائيا مع الاحتفاظ بسجل الطلبات والإجراءات المرتبطة به' : operation === 'suspend' ? 'يمنع دخول الحساب وتنفيذ أي إجراء حتى تعيد تفعيله' : 'يمنع دخول الحساب خلال المراجعة ويعاد تفعيله تلقائيا في الموعد المحدد'}</p>
        {operation === 'suspend-until' && <DatePicker id="account-access-until" label="تاريخ انتهاء الإيقاف" required disabled={busy} value={until} onChange={setUntil} min={riyadhDate(Date.now()+60000)} max={riyadhDate(Date.now()+365*86400000)} hint="يستمر الإيقاف حتى نهاية اليوم المختار بتوقيت الرياض"/>}
        <label htmlFor="account-access-reason">سبب الإجراء<textarea id="account-access-reason" required minLength={3} maxLength={1000} rows={3} value={reason} onChange={event=>setReason(event.target.value)} placeholder="وضح سبب الإيقاف أو المراجعة أو إعادة التفعيل أو الحذف"/></label>
        {operation === 'delete' && <div className="a-access-delete-confirmation">
          <p><TriangleAlert size={20} aria-hidden="true"/>الحذف نهائي ولا يمكن إعادة تفعيل هذا الحساب</p>
          <label htmlFor="account-access-confirmation">لتأكيد الحذف اكتب <bdi>{confirmationValue}</bdi><input id="account-access-confirmation" autoComplete="off" dir="auto" required value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>
        </div>}
        <footer><button type="button" onClick={onClose}>إلغاء</button><button type="submit" className={operation === 'delete' ? 'a-access-delete' : 'a-primary'} disabled={operation === 'delete' && confirmation.trim() !== confirmationValue}>{busy?'جار اعتماد الإجراء':operationLabels[operation]}</button></footer>
      </fieldset>
    </form>
  </dialog>;
}
