import React,{useEffect,useState} from 'react';
import {Search,UsersRound,Phone,Mail,RefreshCw} from 'lucide-react';
import {repository,workError} from './data';
import {useSessionState} from '../shared/session-state';
import './coordinator-clients.css';

function PhoneLink({phone}){
  const value=typeof phone==='string'?phone.trim():'';
  const digits=value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[\s()-]/g,'');
  return value&&/^\+?\d{7,15}$/.test(digits)?<a className="cc-contact-link" href={`tel:${digits}`}><Phone size={14} aria-hidden="true"/><bdi dir="ltr">{value}</bdi></a>:<span className="cc-muted">غير مسجل</span>;
}

export default function CoordinatorClients(){
  const [search,setSearch]=useSessionState('coordinator.clients.search','',{validate:value=>typeof value==='string'});
  const [query,setQuery]=useSessionState('coordinator.clients.query','',{validate:value=>typeof value==='string'});
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0);
  useEffect(()=>{
    let live=true;setLoading(true);setError('');setItems([]);
    repository.clients(query).then(result=>{if(live)setItems(Array.isArray(result)?result:[]);})
      .catch(reason=>{if(live)setError(workError(reason));})
      .finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[query,reload]);
  return <section className="cc-directory" aria-labelledby="cc-title" dir="rtl">
    <header className="cc-heading"><div><span className="a-eyebrow">مرجع التواصل</span><h1 id="cc-title">العملاء</h1><p>بيانات العملاء وجهات التواصل في مكان واحد</p></div><span className="cc-heading-icon" aria-hidden="true"><UsersRound size={26}/></span></header>
    <div className="cc-surface">
      <form className="cc-toolbar" role="search" onSubmit={event=>{event.preventDefault();setQuery(search.trim());setReload(value=>value+1);}}>
        <label className="cc-search"><Search size={18} aria-hidden="true"/><input aria-label="البحث عن عميل أو مسؤول تواصل" placeholder="اسم العميل أو البريد أو المشرف المسؤول" type="search" maxLength={100} value={search} onChange={event=>setSearch(event.target.value)}/></label>
        <button type="submit">بحث</button>
        <button className="cc-refresh" type="button" aria-label="تحديث العملاء" disabled={loading} onClick={()=>setReload(value=>value+1)}><RefreshCw size={18} aria-hidden="true"/></button>
        {!loading&&!error&&<span className="cc-count"><b dir="ltr">{items.length}</b> عميل{query?' في نتائج البحث':''}</span>}
      </form>
      <div className="cc-content" aria-busy={loading}>
        {loading?<p className="cc-empty" role="status">جار تحميل العملاء</p>:error?<div className="cc-empty" role="alert"><p>{error}</p><button type="button" onClick={()=>setReload(value=>value+1)}>إعادة المحاولة</button></div>:!items.length?<div className="cc-empty"><UsersRound size={28} aria-hidden="true"/><p>{query?'لا توجد نتائج مطابقة':'لا يوجد عملاء مسجلون'}</p></div>:<table>
          <caption className="cc-sr-only">دليل العملاء وجهات التواصل</caption>
          <thead><tr><th scope="col">العميل</th><th scope="col">جوال العميل</th><th scope="col">البريد الإلكتروني</th><th scope="col">مسؤولو التواصل لدى العميل</th></tr></thead>
          <tbody>{items.map(client=>{
            const contacts=Array.isArray(client.contacts)&&client.contacts.length?client.contacts:client.contact_name?[{name:client.contact_name,phone:client.contact_phone}]:[];
            return <tr key={client.id}>
              <td data-label="العميل"><div className="cc-client"><span className="cc-avatar" aria-hidden="true">{Array.from(client.name||'ع')[0]}</span><strong>{client.name||'عميل صيت'}</strong></div></td>
              <td data-label="جوال العميل"><PhoneLink phone={client.phone}/></td>
              <td data-label="البريد الإلكتروني">{client.email?<a className="cc-contact-link" href={`mailto:${client.email}`}><Mail size={14} aria-hidden="true"/><bdi>{client.email}</bdi></a>:<span className="cc-muted">غير مسجل</span>}</td>
              <td data-label="مسؤولو التواصل لدى العميل">{contacts.length?<ul className="cc-contacts">{contacts.map((contact,index)=><li key={contact.id||index}><span>{contact.name}</span><PhoneLink phone={contact.phone}/></li>)}</ul>:<span className="cc-muted">لا يوجد مسؤول مسجل</span>}</td>
            </tr>;
          })}</tbody>
        </table>}
      </div>
      {!loading&&!error&&items.length===50&&<p className="cc-limit">تظهر أحدث 50 نتيجة استخدم البحث للوصول إلى العميل المطلوب</p>}
    </div>
  </section>;
}
