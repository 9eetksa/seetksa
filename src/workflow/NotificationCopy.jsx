import React from 'react';
import {notificationSummary} from './notification-summary';
import './notification-summary.css';

export default function NotificationCopy({item}) {
  const {title,status,tone,clientName,kind,explanation}=notificationSummary(item);
  return <span className="w-notification-summary">
    <strong dir="auto">{title}</strong>
    <span className={`w-notification-status is-${tone}`}><i aria-hidden="true"/>{status}</span>
    {kind==='admin_decision'&&explanation&&<small className="w-notification-explanation" dir="auto">توضيح الإدارة {explanation}</small>}
    {clientName&&<small className="w-notification-client" dir="auto">{clientName}</small>}
  </span>;
}
