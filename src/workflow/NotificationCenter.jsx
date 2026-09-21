import React, { useEffect, useId, useMemo, useState } from 'react';
import { useSessionState } from '../shared/session-state';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Circle,
  MessageCircleMore,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import { call, repository, workError } from './data';
import NotificationCopy from './NotificationCopy';
import NotificationHealth from './NotificationHealth';
import {notificationSummary} from './notification-summary';
import './notification-center.css';
import {notificationDestination} from '../missions/mission-navigation';

const pageSize = 40;
const numberFormatter = new Intl.NumberFormat('ar-SA');

const whatsappLabels = {
  pending: 'واتساب قيد الإرسال',
  sending: 'يجري الإرسال عبر واتساب',
  sent: 'قبله مزود واتساب وبانتظار تأكيد الوصول',
  delivered: 'وصل عبر واتساب',
  read: 'تمت قراءة رسالة واتساب',
  read_by_recipient: 'تمت قراءة رسالة واتساب',
  failed: 'تعذر الإرسال عبر واتساب',
  suppressed: 'واتساب متوقف حسب تفضيلك',
  unknown: 'حالة واتساب غير معروفة',
};

function normalizePage(value) {
  if (Array.isArray(value)) {
    return {
      items: value,
      unread_count: value.filter(item => !item.read_at).length,
    };
  }
  return {
    items: Array.isArray(value?.items) ? value.items : [],
    unread_count: Number.isFinite(Number(value?.unread_count)) ? Number(value.unread_count) : 0,
  };
}

function settingsValue(value) {
  if (typeof value === 'boolean') return value;
  return value?.whatsapp_enabled !== false;
}

function NotificationItem({ item, onOpen, disabled }) {
  const unread = !item.read_at;
  const summary = notificationSummary(item);
  const content = (
    <>
      <span className="op-notification-marker" aria-hidden="true">
        {unread ? <BellRing size={19} /> : <Bell size={19} />}
      </span>
      <span className="op-notification-copy">
        <NotificationCopy item={item}/>
      </span>
      {unread && <span className="op-unread-label">جديد</span>}
    </>
  );

  return (
    <li className={unread ? 'is-unread' : ''}>
      {notificationDestination(item) && typeof onOpen === 'function' ? (
        <button type="button" className="op-notification-item" onClick={() => onOpen(item)} disabled={disabled} aria-label={`فتح ${summary.title} ${summary.status} ${summary.clientName}${unread ? ' جديد' : ''}`}>
          {content}
        </button>
      ) : (
        <article className="op-notification-item">{content}</article>
      )}
    </li>
  );
}

export default function NotificationCenter({ user, onOpen }) {
  const titleId = useId();
  const feedTitleId = useId();
  const settingsTitleId = useId();
  const [page, setPage] = useSessionState('notifications.page',0,{validate:value=>Number.isSafeInteger(value)&&value>=0});
  const [payload, setPayload] = useState({ items: [], unread_count: 0 });
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [settings, setSettings] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [settingsReloadKey, setSettingsReloadKey] = useState(0);
  const [search, setSearch] = useSessionState('notifications.search','',{validate:value=>typeof value==='string'});
  const [readFilter, setReadFilter] = useSessionState('notifications.read','all',{validate:value=>['all','read','unread'].includes(value)});
  const [linkFilter, setLinkFilter] = useSessionState('notifications.link','all',{validate:value=>['all','request','general'].includes(value)});
  const [channelFilter, setChannelFilter] = useSessionState('notifications.channel','all',{validate:value=>['all','whatsapp','attention'].includes(value)});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPageError('');
    repository.notificationPage(page)
      .then(value => {
        if (active) setPayload(normalizePage(value));
      })
      .catch(reason => {
        if (active) setPageError(workError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, reloadKey]);

  useEffect(() => {
    let active = true;
    setSettingsLoading(true);
    setSettingsError('');
    repository.notificationSettings()
      .then(value => {
        if (active) setSettings(settingsValue(value));
      })
      .catch(reason => {
        if (active) setSettingsError(workError(reason));
      })
      .finally(() => {
        if (active) setSettingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [settingsReloadKey]);

  useEffect(() => {
    if (!user?.id || typeof repository.subscribe !== 'function') return undefined;
    const unsubscribe = repository.subscribe(user.id, () => setReloadKey(value => value + 1));
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [user?.id]);

  const items = useMemo(() => payload.items || [], [payload.items]);
  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ar');
    return items.filter(item => {
      const unread = !item.read_at;
      const summary = notificationSummary(item);
      const matchesSearch = !term || `${summary.title} ${summary.status} ${summary.clientName} ${whatsappLabels[item.whatsapp] || ''}`.toLocaleLowerCase('ar').includes(term);
      const matchesRead = readFilter === 'all' || (readFilter === 'unread' && unread) || (readFilter === 'read' && !unread);
      const matchesLink = linkFilter === 'all' || (linkFilter === 'request' && Boolean(notificationDestination(item))) || (linkFilter === 'general' && !notificationDestination(item));
      const matchesChannel = channelFilter === 'all' || (channelFilter === 'whatsapp' && Boolean(item.whatsapp)) || (channelFilter === 'attention' && ['failed', 'unknown'].includes(item.whatsapp));
      return matchesSearch && matchesRead && matchesLink && matchesChannel;
    });
  }, [channelFilter, items, linkFilter, readFilter, search]);
  const unread = Math.max(0, Number(payload.unread_count) || 0);
  const hasNext = items.length === pageSize;
  const activeFilters = Boolean(search || readFilter !== 'all' || linkFilter !== 'all' || channelFilter !== 'all');

  function clearFilters() {
    setSearch('');
    setReadFilter('all');
    setLinkFilter('all');
    setChannelFilter('all');
  }

  async function markAllRead() {
    setActionBusy(true);
    setActionError('');
    setAnnouncement('');
    try {
      const changed = Number(await repository.markAllNotifications()) || 0;
      const readAt = new Date().toISOString();
      setPayload(current => ({
        ...current,
        unread_count: 0,
        items: current.items.map(item => item.read_at ? item : { ...item, read_at: readAt }),
      }));
      setAnnouncement(changed > 0 ? `تم تعليم ${changed} إشعارات كمقروءة` : 'كل الإشعارات مقروءة');
    } catch (reason) {
      setActionError(workError(reason));
    } finally {
      setActionBusy(false);
    }
  }

  async function updateWhatsapp(event) {
    const nextValue = event.target.checked;
    const previousValue = settings;
    setSettings(nextValue);
    setSettingsError('');
    setAnnouncement('');
    setActionBusy(true);
    try {
      const saved = await repository.saveNotificationSettings(nextValue);
      setSettings(saved === null || saved === undefined ? nextValue : settingsValue(saved));
      setAnnouncement(nextValue ? 'تم تفعيل إشعارات واتساب' : 'تم إيقاف إشعارات واتساب');
    } catch (reason) {
      setSettings(previousValue);
      setSettingsError(workError(reason));
    } finally {
      setActionBusy(false);
    }
  }

  async function openNotification(item) {
    if (!notificationDestination(item) || typeof onOpen !== 'function') return;
    setActionBusy(true);
    setActionError('');
    setAnnouncement('');
    try {
      if (!item.read_at) {
        await call('read_notification', { id: item.id });
        const readAt = new Date().toISOString();
        setPayload(current => ({
          ...current,
          unread_count: Math.max(0, Number(current.unread_count || 0) - 1),
          items: current.items.map(row => row.id === item.id ? { ...row, read_at: readAt } : row),
        }));
      }
      await onOpen(notificationDestination(item));
    } catch (reason) {
      setActionError(workError(reason));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <section className="op-notification-center" dir="rtl" aria-labelledby={titleId}>
      <header className="op-panel-header">
        <div>
          <span className="op-panel-eyebrow">مركز الإشعارات</span>
          <h2 id={titleId}>كل تحديث في مكان واحد</h2>
          <p>تابع تقدم المهام والاعتمادات والتسليمات واختر قناة التواصل المناسبة</p>
        </div>
        <div className="op-notification-count" aria-label={`${unread} إشعارات غير مقروءة`}>
          <BellRing size={19} aria-hidden="true" />
          <span>غير مقروء</span>
          <strong>{unread}</strong>
        </div>
      </header>

      {['admin','super_admin'].includes(user?.app_metadata?.role)&&<NotificationHealth/>}
      <div className="op-notification-layout">
        <section className="op-notification-feed" aria-labelledby={feedTitleId} aria-busy={loading || actionBusy}>
          <header>
            <div>
              <span className="op-panel-eyebrow">التحديثات</span>
              <h3 id={feedTitleId}>سجل الإشعارات</h3>
            </div>
            <div className="op-notification-actions">
              <button type="button" onClick={() => setReloadKey(value => value + 1)} disabled={loading || actionBusy} aria-label="تحديث سجل الإشعارات">
                <RefreshCw size={17} aria-hidden="true" />
                تحديث
              </button>
              <button type="button" onClick={markAllRead} disabled={unread === 0 || actionBusy}>
                <CheckCheck size={17} aria-hidden="true" />
                تعليم الكل كمقروء
              </button>
            </div>
          </header>

          {!loading && !pageError && items.length > 0 && (
            <section className="op-notification-filters" aria-label="البحث والتصفية في الصفحة الحالية">
              <div className="op-notification-filter-heading">
                <span><SlidersHorizontal size={17} aria-hidden="true" />تصفية الصفحة الحالية</span>
                <span role="status">{numberFormatter.format(filteredItems.length)} من {numberFormatter.format(items.length)} إشعار</span>
              </div>
              <div className="op-notification-filter-grid">
                <label className="op-notification-search">
                  <span><Search size={16} aria-hidden="true" />البحث في الإشعارات</span>
                  <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="نص الإشعار أو حالة واتساب" />
                </label>
                <label>
                  <span>حالة القراءة</span>
                  <select value={readFilter} onChange={event => setReadFilter(event.target.value)}>
                    <option value="all">الكل</option>
                    <option value="unread">غير المقروءة</option>
                    <option value="read">المقروءة</option>
                  </select>
                </label>
                <label>
                  <span>الارتباط</span>
                  <select value={linkFilter} onChange={event => setLinkFilter(event.target.value)}>
                    <option value="all">كل الإشعارات</option>
                    <option value="request">مرتبطة بطلب</option>
                    <option value="general">تحديثات عامة</option>
                  </select>
                </label>
                <label>
                  <span>قناة واتساب</span>
                  <select value={channelFilter} onChange={event => setChannelFilter(event.target.value)}>
                    <option value="all">كل الحالات</option>
                    <option value="whatsapp">لها تحديث واتساب</option>
                    <option value="attention">تحتاج متابعة</option>
                  </select>
                </label>
              </div>
              <div className="op-notification-filter-foot">
                <span>تطبق أدوات البحث والتصفية على الصفحة الحالية فقط</span>
                {activeFilters && <button type="button" onClick={clearFilters}>مسح التصفية</button>}
              </div>
            </section>
          )}

          <p className="op-sr-status" aria-live="polite">{announcement}</p>

          {actionError && (
            <div className="op-action-error" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError('')}>إغلاق</button>
            </div>
          )}

          {loading && (
            <div className="op-panel-state is-small" role="status" aria-live="polite">
              <Bell className="op-pulse" size={24} aria-hidden="true" />
              <strong>يجري تحميل الإشعارات</strong>
            </div>
          )}

          {!loading && pageError && (
            <div className="op-panel-state is-small is-error" role="alert">
              <AlertTriangle size={24} aria-hidden="true" />
              <strong>تعذر تحميل الإشعارات</strong>
              <span>{pageError}</span>
              <button type="button" onClick={() => setReloadKey(value => value + 1)}>إعادة المحاولة</button>
            </div>
          )}

          {!loading && !pageError && items.length === 0 && (
            <div className="op-panel-state is-small" role="status">
              <CheckCheck size={25} aria-hidden="true" />
              <strong>{page > 0 ? 'لا توجد إشعارات في هذه الصفحة' : 'لا توجد إشعارات حتى الآن'}</strong>
              <span>{page > 0 ? 'يمكنك العودة إلى الصفحة السابقة' : 'ستظهر تحديثات المهام هنا فور وصولها'}</span>
            </div>
          )}

          {!loading && !pageError && items.length > 0 && filteredItems.length === 0 && (
            <div className="op-panel-state is-small" role="status">
              <Search size={25} aria-hidden="true" />
              <strong>لا توجد إشعارات مطابقة في هذه الصفحة</strong>
              <span>غيّر البحث أو التصفية لعرض إشعارات أخرى</span>
              <button type="button" onClick={clearFilters}>عرض كل إشعارات الصفحة</button>
            </div>
          )}

          {!loading && !pageError && filteredItems.length > 0 && (
            <ol className="op-notification-list" aria-label="الإشعارات">
              {filteredItems.map(item => <NotificationItem key={item.id} item={item} onOpen={openNotification} disabled={actionBusy} />)}
            </ol>
          )}

          {!loading && !pageError && (page > 0 || hasNext) && (
            <nav className="op-pagination" aria-label="صفحات الإشعارات">
              <button type="button" onClick={() => setPage(value => Math.max(0, value - 1))} disabled={page === 0 || loading}>
                <ChevronRight size={18} aria-hidden="true" />
                السابق
              </button>
              <span aria-current="page">الصفحة {numberFormatter.format(page + 1)}</span>
              <button type="button" onClick={() => setPage(value => value + 1)} disabled={!hasNext || loading}>
                التالي
                <ChevronLeft size={18} aria-hidden="true" />
              </button>
            </nav>
          )}
        </section>

        <aside className="op-notification-settings" aria-labelledby={settingsTitleId}>
          <header>
            <Settings2 size={21} aria-hidden="true" />
            <div>
              <span className="op-panel-eyebrow">قنوات التواصل</span>
              <h3 id={settingsTitleId}>تفضيلات الإشعارات</h3>
            </div>
          </header>

          <div className="op-channel-row is-required">
            <span className="op-channel-icon"><Bell size={19} aria-hidden="true" /></span>
            <div>
              <strong>إشعارات المنصة</strong>
              <span>تبقى مفعلة لتحديثات العمل المهمة</span>
            </div>
            <span className="op-channel-enabled">
              <CheckCheck size={16} aria-hidden="true" />
              مفعلة
            </span>
          </div>

          {settingsLoading ? (
            <div className="op-settings-loading" role="status" aria-live="polite">
              <Circle className="op-pulse" size={17} aria-hidden="true" />
              يجري تحميل تفضيلات القنوات
            </div>
          ) : settingsError ? (
            <div className="op-settings-error" role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>{settingsError}</span>
              <button type="button" onClick={() => setSettingsReloadKey(value => value + 1)}>إعادة المحاولة</button>
            </div>
          ) : (
            <label className="op-channel-row is-toggle">
              <span className="op-channel-icon"><MessageCircleMore size={19} aria-hidden="true" /></span>
              <span>
                <strong>إشعارات واتساب</strong>
                <span>تصل إلى رقم الجوال الموثق في الحساب</span>
              </span>
              <span className="op-switch">
                <input type="checkbox" checked={Boolean(settings)} onChange={updateWhatsapp} disabled={actionBusy} />
                <span aria-hidden="true" />
              </span>
            </label>
          )}

          <p className="op-channel-help">تغيير واتساب لا يؤثر على الإشعارات المحفوظة داخل المنصة</p>
        </aside>
      </div>
    </section>
  );
}
