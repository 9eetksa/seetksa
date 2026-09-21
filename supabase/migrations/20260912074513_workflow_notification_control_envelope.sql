begin;

-- Provider acceptance is not delivery  Keep the lifecycle explicit and auditable
alter table public.work_notifications
 drop constraint if exists work_notifications_whatsapp_check;
alter table public.work_notifications
 add constraint work_notifications_whatsapp_check
 check(whatsapp in('pending','sending','sent','delivered','read','failed','unknown','suppressed'));

alter table public.work_notifications
 add column if not exists whatsapp_delivered_at timestamptz,
 add column if not exists whatsapp_read_at timestamptz,
 add column if not exists provider_status_at timestamptz;

create unique index if not exists work_notifications_provider_id_unique
on public.work_notifications(provider_id)
where provider_id is not null;

create table if not exists provision_private.work_provider_receipts(
 provider_id text primary key check(length(provider_id) between 1 and 200),
 status text not null check(status in('sent','delivered','read','failed')),
 description text check(description is null or length(description)<=2000),
 occurred_at timestamptz not null,
 received_at timestamptz not null default now()
);
alter table provision_private.work_provider_receipts enable row level security;
revoke all on provision_private.work_provider_receipts from public,anon,authenticated;
grant all on provision_private.work_provider_receipts to service_role;

create table if not exists provision_private.work_notification_channel(
 id boolean primary key default true check(id),
 state text not null check(state in('authorized','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended')),
 description text check(description is null or length(description)<=2000),
 occurred_at timestamptz not null,
 updated_at timestamptz not null default now()
);
alter table provision_private.work_notification_channel enable row level security;
revoke all on provision_private.work_notification_channel from public,anon,authenticated;
grant all on provision_private.work_notification_channel to service_role;

create or replace function provision_private.work_provider_status(value text)
returns text language sql immutable set search_path='' as $$
 select case lower(trim(coalesce(value,'')))
  when 'sent' then 'sent'
  when 'delivered' then 'delivered'
  when 'read' then 'read'
  when 'failed' then 'failed'
  when 'noaccount' then 'failed'
  when 'notingroup' then 'failed'
  else null
 end
$$;
revoke all on function provision_private.work_provider_status(text) from public,anon,authenticated;

create or replace function provision_private.work_apply_provider_receipt(provider text)
returns boolean language plpgsql security definer set search_path='' as $$
declare receipt provision_private.work_provider_receipts; changed integer;
begin
 select * into receipt from provision_private.work_provider_receipts where provider_id=provider;
 if receipt.provider_id is null then return false; end if;
 update public.work_notifications notification set
  whatsapp=case
   when notification.whatsapp='read' then 'read'
   when notification.whatsapp='delivered' and receipt.status in('sent','failed') then 'delivered'
   else receipt.status
  end,
  last_error=case
   when notification.whatsapp='read' or notification.whatsapp='delivered' and receipt.status in('sent','failed') then notification.last_error
   when receipt.status in('delivered','read') then null
   when receipt.status='sent' then 'provider_accepted_waiting_delivery'
   else left(coalesce(nullif(receipt.description,''),'provider_failed'),2000)
  end,
  provider_status_at=greatest(coalesce(notification.provider_status_at,'-infinity'::timestamptz),receipt.occurred_at),
  whatsapp_delivered_at=case when receipt.status in('delivered','read') then coalesce(notification.whatsapp_delivered_at,receipt.occurred_at) else notification.whatsapp_delivered_at end,
  whatsapp_read_at=case when receipt.status='read' then coalesce(notification.whatsapp_read_at,receipt.occurred_at) else notification.whatsapp_read_at end
 where notification.provider_id=receipt.provider_id;
 get diagnostics changed=row_count;
 return changed>0;
end;
$$;
revoke all on function provision_private.work_apply_provider_receipt(text) from public,anon,authenticated;

create or replace function public.work_notification_delivery_update(
 p_provider_id text,
 p_status text,
 p_description text default null,
 p_occurred_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare normalized text; happened timestamptz; applied boolean;
begin
 normalized=provision_private.work_provider_status(p_status);
 if normalized is null or length(trim(coalesce(p_provider_id,''))) not between 1 and 200
  or length(coalesce(p_description,''))>2000 then raise exception 'invalid_provider_receipt'; end if;
 happened=coalesce(p_occurred_at,now());
 if happened<now()-interval '30 days' or happened>now()+interval '1 day' then
  return jsonb_build_object('processed',false,'ignored','timestamp_out_of_range');
 end if;
 insert into provision_private.work_provider_receipts(provider_id,status,description,occurred_at,received_at)
 values(trim(p_provider_id),normalized,nullif(left(trim(coalesce(p_description,'')),2000),''),happened,now())
 on conflict(provider_id) do update set
  status=case
   when provision_private.work_provider_receipts.status='read' then 'read'
   when provision_private.work_provider_receipts.status='delivered' and excluded.status in('sent','failed') then 'delivered'
   when excluded.status='read' then 'read'
   when excluded.status='delivered' then 'delivered'
   when excluded.occurred_at>=provision_private.work_provider_receipts.occurred_at then excluded.status
   else provision_private.work_provider_receipts.status
  end,
  description=case
   when excluded.occurred_at>=provision_private.work_provider_receipts.occurred_at then excluded.description
   else provision_private.work_provider_receipts.description
  end,
  occurred_at=greatest(provision_private.work_provider_receipts.occurred_at,excluded.occurred_at),
  received_at=now();
 applied=provision_private.work_apply_provider_receipt(trim(p_provider_id));
 return jsonb_build_object('processed',true,'matched',applied,'status',normalized);
end;
$$;
revoke all on function public.work_notification_delivery_update(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.work_notification_delivery_update(text,text,text,timestamptz) to service_role;

create or replace function provision_private.work_reconcile_provider_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.provider_id is not null and (tg_op='INSERT' or new.provider_id is distinct from old.provider_id) then
  perform provision_private.work_apply_provider_receipt(new.provider_id);
 end if;
 return null;
end;
$$;
revoke all on function provision_private.work_reconcile_provider_receipt() from public,anon,authenticated;
drop trigger if exists work_reconcile_provider_receipt on public.work_notifications;
create trigger work_reconcile_provider_receipt
after insert or update of provider_id on public.work_notifications
for each row execute function provision_private.work_reconcile_provider_receipt();

create or replace function provision_private.work_reconcile_provider_receipts()
returns integer language plpgsql security definer set search_path='' as $$
declare item record; changed integer:=0;
begin
 for item in
  select receipt.provider_id from provision_private.work_provider_receipts receipt
  join public.work_notifications notification on notification.provider_id=receipt.provider_id
  where notification.provider_status_at is null or notification.provider_status_at<receipt.occurred_at
   or receipt.status='read' and notification.whatsapp<>'read'
   or receipt.status='delivered' and notification.whatsapp not in('delivered','read')
   or receipt.status='failed' and notification.whatsapp not in('failed','delivered','read')
 loop
  if provision_private.work_apply_provider_receipt(item.provider_id) then changed=changed+1; end if;
 end loop;
 delete from provision_private.work_provider_receipts receipt
 where receipt.received_at<now()-interval '30 days'
  and not exists(select 1 from public.work_notifications notification where notification.provider_id=receipt.provider_id);
 return changed;
end;
$$;
revoke all on function provision_private.work_reconcile_provider_receipts() from public,anon,authenticated;

create or replace function provision_private.work_dispatch()
returns void language plpgsql security definer set search_path='' as $$
declare cfg provision_private.work_dispatch_config;
begin
 perform provision_private.work_reconcile_provider_receipts();
 select * into cfg from provision_private.work_dispatch_config where id;
 if cfg.url is not null and exists(select 1 from public.work_notifications
  where whatsapp in('pending','failed') and next_attempt<=now() and attempts<5) then
  perform net.http_post(url:=cfg.url,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cfg.token),
   body:='{}'::jsonb,timeout_milliseconds:=60000);
 end if;
end;
$$;
revoke all on function provision_private.work_dispatch() from public,anon,authenticated;

-- A retry owns a fresh provider attempt  Detach the previous provider receipt before sending again
create or replace function public.work_notification_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update public.work_notifications notification set whatsapp='suppressed',last_error='recipient_in_app_only'
 from auth.users account
 where account.id=notification.recipient and account.raw_app_meta_data->>'role'='super_admin'
  and notification.request_id is not null and notification.whatsapp in('pending','failed','unknown','sending')
  and coalesce(notification.event_key,'') not like 'control:%';
 update public.work_notifications notification set whatsapp='suppressed',last_error='recipient_unavailable'
 from auth.users account
 where account.id=notification.recipient and notification.whatsapp in('pending','failed','unknown','sending')
  and (coalesce(account.is_anonymous,false) or (account.banned_until is not null and account.banned_until>=now())
   or coalesce(account.raw_app_meta_data->>'role','') not in('client','employee','admin','super_admin'));
 update public.work_notifications set whatsapp='unknown',last_error='worker_interrupted',attempts=greatest(attempts,5)
 where whatsapp='sending' and next_attempt<now()-interval '2 minutes';
 with candidates as(
  select notification.id
  from public.work_notifications notification
  join auth.users account on account.id=notification.recipient
  where notification.whatsapp in('pending','failed') and notification.attempts<5 and notification.next_attempt<=now()
   and (notification.request_id is null or account.raw_app_meta_data->>'role' is distinct from 'super_admin'
    or coalesce(notification.event_key,'') like 'control:%')
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and account.raw_app_meta_data->>'role' in('client','employee','admin','super_admin')
  order by (coalesce(notification.event_key,'') like 'control:%') desc,notification.created_at
  for update of notification skip locked limit 15
 ),claimed as(
  update public.work_notifications notification set
   whatsapp='sending',attempts=attempts+1,next_attempt=now(),provider_id=null,provider_status_at=null,last_error=null,
   whatsapp_delivered_at=null,whatsapp_read_at=null
  from candidates candidate where notification.id=candidate.id returning notification.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',claimed.id,'recipient',claimed.recipient,'message',claimed.message,
  'request_id',claimed.request_id,'attempts',claimed.attempts,'claimed_at',claimed.next_attempt,
  'phone',coalesce(nullif(profile.phone,''),account.phone))),'[]') into result
 from claimed
 join auth.users account on account.id=claimed.recipient
 left join public.account_profiles profile on profile.user_id=claimed.recipient
 where claimed.whatsapp='sending';
 return result;
end;
$$;
revoke all on function public.work_notification_claim() from public,anon,authenticated;
grant execute on function public.work_notification_claim() to service_role;

create or replace function public.work_notification_channel_update(
 p_state text,
 p_description text default null,
 p_occurred_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare happened timestamptz:=coalesce(p_occurred_at,now());
begin
 if p_state is null or p_state not in('authorized','notAuthorized','blocked','sleepMode','starting','yellowCard','suspended')
  or length(coalesce(p_description,''))>2000 then raise exception 'invalid_channel_state'; end if;
 if happened<now()-interval '30 days' or happened>now()+interval '1 day' then
  return jsonb_build_object('processed',false,'ignored','timestamp_out_of_range');
 end if;
 insert into provision_private.work_notification_channel(id,state,description,occurred_at,updated_at)
 values(true,p_state,nullif(left(trim(coalesce(p_description,'')),2000),''),happened,now())
 on conflict(id) do update set state=excluded.state,description=excluded.description,
  occurred_at=excluded.occurred_at,updated_at=now()
 where excluded.occurred_at>=provision_private.work_notification_channel.occurred_at;
 return jsonb_build_object('processed',true,'state',p_state);
end;
$$;
revoke all on function public.work_notification_channel_update(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.work_notification_channel_update(text,text,timestamptz) to service_role;

create or replace function public.work_notification_channel_health()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare channel provision_private.work_notification_channel;
begin
 if not provision_private.work_manager() then raise exception 'forbidden' using errcode='42501'; end if;
 select * into channel from provision_private.work_notification_channel where id;
 return case when channel.id is null then jsonb_build_object('state','unknown') else
  jsonb_build_object('state',channel.state,'description',channel.description,'occurred_at',channel.occurred_at,'updated_at',channel.updated_at) end;
end;
$$;
revoke all on function public.work_notification_channel_health() from public,anon;
grant execute on function public.work_notification_channel_health() to authenticated;

create or replace function provision_private.work_event_action_label(kind text)
returns text language sql immutable set search_path='' as $$
 select case kind
  when 'create' then 'إنشاء طلب'
  when 'submit_request' then 'إرسال طلب جديد'
  when 'intake' then 'استلام مسؤول التواصل للطلب'
  when 'request_info' then 'طلب بيانات إضافية'
  when 'supply_info' then 'استكمال بيانات الطلب'
  when 'assign' then 'إحالة الطلب إلى قسم'
  when 'accept' then 'استلام القسم للمهمة وتحديد الموعد'
  when 'missing' then 'إبلاغ القسم عن بيانات ناقصة'
  when 'reject' then 'إبلاغ القسم عن تعذر التنفيذ'
  when 'routing' then 'إبلاغ القسم عن خطأ في الإحالة'
  when 'dependency' then 'طلب مخرجات قسم سابق'
  when 'dependency_reply' then 'الرد على طلب مخرجات قسم'
  when 'deliver' then 'رفع تسليم داخلي من القسم'
  when 'scope' then 'إبلاغ القسم عن عمل خارج النطاق'
  when 'resolve' then 'اتخاذ قرار إداري على تصعيد'
  when 'release_dependencies' then 'إتاحة مخرجات لقسم مرتبط'
  when 'force_start' then 'إلزام قسم ببدء التنفيذ'
  when 'force_dependency_waived' then 'إلغاء انتظار مخرجات بقرار إداري'
  when 'release_delivery' then 'إرسال التسليم إلى العميل'
  when 'review' then 'مراجعة العميل للتسليم'
  when 'attach' then 'إضافة مرفق إلى الطلب'
  when 'handoff' then 'إحالة تسليم إلى القسم التالي'
  when 'due_approved' then 'اعتماد موعد تسليم القسم'
  when 'due_rejected' then 'رفض موعد القسم وتحديد موعد بديل'
  when 'request_attachments' then 'طلب مرفقات من العميل'
  when 'decline_intake' then 'رفض الطلب قبل التوزيع'
  else 'تحديث على الطلب من نوع '||coalesce(kind,'غير معروف')
 end
$$;
revoke all on function provision_private.work_event_action_label(text) from public,anon,authenticated;

create or replace function provision_private.work_request_control_message(
 p_request_id uuid,
 p_action_label text,
 p_actor_id uuid default null,
 p_related_part uuid default null,
 p_action_note text default null
) returns text language plpgsql stable security definer set search_path='' as $$
declare request_row public.work_requests; client_name text; client_contact text; client_email text; client_phone text;
 actor_name text; actor_role text; requested_service text; department_name text; departments text; specifications text;
 attachment_names text; delivery_names text; due_review text; result text;
begin
 select * into request_row from public.work_requests where id=p_request_id;
 if request_row.id is null then return 'تحديث رقابي على طلب غير متاح'; end if;
 select coalesce(nullif(profile.display_name,''),nullif(account.raw_user_meta_data->>'display_name',''),account.email,'عميل المنصة'),
  nullif(profile.contact_name,''),account.email,coalesce(nullif(profile.phone,''),nullif(account.phone,''))
 into client_name,client_contact,client_email,client_phone
 from auth.users account left join public.account_profiles profile on profile.user_id=account.id
 where account.id=request_row.client_id;
 select coalesce(nullif(profile.display_name,''),nullif(account.raw_user_meta_data->>'display_name',''),account.email,'نظام المنصة'),
  case account.raw_app_meta_data->>'role' when 'super_admin' then 'سوبر أدمن' when 'admin' then 'أدمن'
   when 'employee' then 'موظف' when 'client' then 'عميل' else 'نظام المنصة' end
 into actor_name,actor_role from auth.users account
 left join public.account_profiles profile on profile.user_id=account.id where account.id=p_actor_id;
 actor_name=coalesce(actor_name,'نظام المنصة');
 actor_role=coalesce(actor_role,'نظام المنصة');
 select service.name into requested_service from public.work_services service
 where service.id=coalesce(request_row.requested_service_id,request_row.service_id);
 select service.name into department_name from public.work_parts part
 join public.work_services service on service.id=part.service_id where part.id=p_related_part and part.request_id=p_request_id;
 select string_agg(spec.key||' '||left(trim(both '"' from spec.value::text),500),E'\n' order by spec.key)
 into specifications from jsonb_each(case when jsonb_typeof(request_row.specifications)='object'
  then request_row.specifications else '{}'::jsonb end) spec
 where spec.value is distinct from 'null'::jsonb;
 select string_agg(left(item.line,1800),E'\n\n' order by item.route_position,item.created_at,item.id) into departments from(
  select part.id,part.route_position,part.created_at,
   'القسم '||service.name||E'\nالمسؤول '||coalesce(nullif(profile.display_name,''),account.email,'غير محدد')||
   E'\nالحالة '||case part.status when 'offered' then 'بانتظار الاستلام' when 'working' then 'قيد التنفيذ'
    when 'needs_info' then 'بانتظار بيانات' when 'escalated' then 'تحتاج قرار الإدارة' when 'waiting' then 'بانتظار مخرجات قسم'
    when 'review' then 'بانتظار المراجعة' when 'revision' then 'قيد التعديل' when 'approved' then 'معتمدة'
    when 'internal_done' then 'مكتملة داخليا' when 'forwarded' then 'أحيلت للقسم التالي' else part.status end||
   case when part.due_at is not null then E'\nموعد التسليم '||to_char(part.due_at at time zone 'Asia/Riyadh','YYYY/MM/DD HH24:MI') else '' end||
   E'\nالمهمة '||part.scope as line
  from public.work_parts part join public.work_services service on service.id=part.service_id
  left join auth.users account on account.id=part.assignee_id
  left join public.account_profiles profile on profile.user_id=account.id
  where part.request_id=p_request_id
 )item;
 select string_agg(distinct left(attachment.filename,300),E'\n' order by left(attachment.filename,300))
 into attachment_names from public.work_attachments attachment where attachment.request_id=p_request_id;
 select string_agg(distinct left(delivery.filename,300),E'\n' order by left(delivery.filename,300))
 into delivery_names from public.work_deliveries delivery where delivery.request_id=p_request_id;
 if p_related_part is not null then
  select 'حالة مراجعة الموعد '||case review.status when 'pending' then 'بانتظار قرار الإدارة' when 'approved' then 'معتمد'
   when 'auto_approved' then 'معتمد تلقائيا' when 'rejected' then 'مرفوض مع موعد بديل' else 'ملغي' end||
   E'\nالموعد المقترح '||to_char(review.proposed_due_at at time zone 'Asia/Riyadh','YYYY/MM/DD HH24:MI')||
   case when review.review_expires_at>now() and review.status='pending' then E'\nالوقت المتبقي بالدقائق '||greatest(0,ceil(extract(epoch from(review.review_expires_at-now()))/60))::bigint::text else '' end||
   case when review.replacement_due_at is not null then E'\nالموعد البديل '||to_char(review.replacement_due_at at time zone 'Asia/Riyadh','YYYY/MM/DD HH24:MI') else '' end
  into due_review from provision_private.work_due_reviews review
  where review.part_id=p_related_part order by review.proposed_at desc limit 1;
 end if;
 result=concat_ws(E'\n',
  'تحديث رقابي على الطلب',
  'الإجراء '||coalesce(nullif(trim(p_action_label),''),'تحديث على الطلب'),
  'الطلب '||request_row.number::text,
  'عنوان الطلب '||request_row.title,
  'العميل '||coalesce(client_name,'عميل المنصة'),
  case when client_contact is not null then 'مسؤول العميل '||client_contact end,
  'البريد الإلكتروني '||coalesce(client_email,'غير متوفر'),
  'رقم التواصل '||coalesce(client_phone,'غير متوفر'),
  case when requested_service is not null then 'الخدمة المطلوبة '||requested_service end,
  'منفذ الإجراء '||actor_name,
  'صفة المنفذ '||actor_role,
  case when department_name is not null then 'القسم المرتبط بالإجراء '||department_name end,
  case when nullif(trim(coalesce(p_action_note,'')),'') is not null then E'تفاصيل الإجراء\n'||left(trim(p_action_note),1200) end,
  case when nullif(trim(coalesce(due_review,'')),'') is not null then due_review end,
  case when nullif(trim(coalesce(departments,'')),'') is not null then E'الأقسام المكلفة\n'||left(departments,3000) else 'الأقسام المكلفة لم يحدد قسم حتى الآن' end,
  case when nullif(trim(coalesce(attachment_names,'')),'') is not null then E'مسميات مرفقات العميل\n'||left(attachment_names,800) else 'مسميات مرفقات العميل لا توجد مرفقات' end,
  case when nullif(trim(coalesce(delivery_names,'')),'') is not null then E'مسميات ملفات التسليم\n'||left(delivery_names,800) else 'مسميات ملفات التسليم لا توجد ملفات تسليم' end,
  E'محتوى الطلب\n'||left(request_row.brief,2500),
  case when nullif(trim(coalesce(specifications,'')),'') is not null then E'تفاصيل الطلب\n'||left(specifications,1200) end
 );
 return left(result,12000);
end;
$$;
revoke all on function provision_private.work_request_control_message(uuid,text,uuid,uuid,text) from public,anon,authenticated;

create or replace function provision_private.work_event_message(event_id bigint)
returns text language sql stable security definer set search_path='' as $$
 select provision_private.work_request_control_message(
  event.request_id,
  provision_private.work_event_action_label(event.kind),
  event.actor,
  event.part_id,
  event.note
 ) from public.work_events event where event.id=event_id
$$;
revoke all on function provision_private.work_event_message(bigint) from public,anon,authenticated;

-- Request messages keep their intended recipient  Administration receives one complete event envelope instead of copied fragments
create or replace function provision_private.work_notify(who uuid,r uuid,msg text)
returns void language plpgsql security definer set search_path='' as $$
declare marker text; is_test boolean;
begin
 if r is not null and exists(select 1 from public.work_requests where id=r and status='draft') then return; end if;
 if length(trim(coalesce(msg,'')))=0 then return; end if;
 is_test=case when r is null then exists(select 1 from auth.users where id=coalesce(who,auth.uid()) and raw_app_meta_data->>'portal_qa'='true')
  else coalesce((select test from public.work_requests where id=r),false) end;
 marker=txid_current()::text||':'||coalesce(r::text,'account')||':'||md5(msg);
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select account.id,r,left(trim(msg),12000),case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,marker
 from auth.users account
 where ((r is not null and who is not null and account.id=who)
   or (r is null and (account.id=who or account.raw_app_meta_data->>'role' in('admin','super_admin'))))
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not is_test or account.raw_app_meta_data->>'portal_qa'='true')
 on conflict(recipient,event_key) where event_key is not null do nothing;
end;
$$;
revoke all on function provision_private.work_notify(uuid,uuid,text) from public,anon,authenticated;

create or replace function provision_private.work_notify_once(who uuid,r uuid,msg text,stable_key text,mandatory boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare marker text; is_test boolean; outgoing text;
begin
 if r is not null and exists(select 1 from public.work_requests where id=r and status='draft') then return; end if;
 if length(trim(coalesce(msg,'')))=0 or length(trim(coalesce(stable_key,'')))=0 then raise exception 'invalid_notification'; end if;
 is_test=case when r is null then exists(select 1 from auth.users where id=coalesce(who,auth.uid()) and raw_app_meta_data->>'portal_qa'='true')
  else coalesce((select test from public.work_requests where id=r),false) end;
 marker=left(case when mandatory then 'control:' else 'event:' end||trim(stable_key),500);
 outgoing=case when r is not null and who is null then provision_private.work_request_control_message(
  r,case when stable_key like 'intake:%:overdue' then 'تجاوز مهلة إجراء مسؤول التواصل' else 'تحديث رقابي إلزامي' end,
  auth.uid(),null,msg) else left(trim(msg),12000) end;
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select account.id,r,left(outgoing,12000),case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,marker
 from auth.users account
 where ((r is not null and who is null and account.raw_app_meta_data->>'role' in('admin','super_admin'))
   or (r is not null and who is not null and account.id=who)
   or (r is null and (account.id=who or account.raw_app_meta_data->>'role' in('admin','super_admin'))))
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not is_test or account.raw_app_meta_data->>'portal_qa'='true')
 on conflict(recipient,event_key) where event_key is not null do nothing;
end;
$$;
revoke all on function provision_private.work_notify_once(uuid,uuid,text,text,boolean) from public,anon,authenticated;

-- Dependency recipients get one operational notice  Managers receive the complete event envelope below
create or replace function provision_private.work_dependency_notice(dependency_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare link public.work_dependencies; source public.work_parts; target public.work_parts;
 request_row public.work_requests; source_name text; target_name text; notice text; recipient_id uuid;
begin
 select * into link from public.work_dependencies where id=dependency_id;
 if link.id is null then return; end if;
 select * into source from public.work_parts where id=link.upstream_id;
 select * into target from public.work_parts where id=link.part_id;
 select * into request_row from public.work_requests where id=link.request_id;
 select name into source_name from public.work_services where id=source.service_id;
 select name into target_name from public.work_services where id=target.service_id;
 notice='طلب مخرجات بين الأقسام'||E'\nطلب '||request_row.number::text||E'\nالقسم الطالب '||
  coalesce(target_name,'القسم المكلف')||E'\nالقسم المطلوب '||coalesce(source_name,'القسم السابق')||
  E'\nالمخرجات المطلوبة '||link.reason;
 for recipient_id in
  select distinct recipients.user_id
  from(
   select source.assignee_id as user_id
   union all select request_row.coordinator_id
   union all select membership.user_id from public.work_memberships membership
    where membership.service_id=source.service_id and membership.member_role='lead'
  )recipients
  join auth.users account on account.id=recipients.user_id
  where recipients.user_id is not null
   and coalesce(account.raw_app_meta_data->>'role','') not in('admin','super_admin')
 loop
  perform provision_private.work_notify_once(recipient_id,link.request_id,notice,
   'dependency:'||link.id::text||':created',true);
 end loop;
end;
$$;
revoke all on function provision_private.work_dependency_notice(uuid) from public,anon,authenticated;

create or replace function provision_private.work_event_visibility_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='supply_info' and not exists(
  select 1 from public.work_events issue
  where issue.request_id=new.request_id and issue.kind in('request_info','request_attachments','missing')
   and issue.id>coalesce((select max(resolved.id) from public.work_events resolved
    where resolved.request_id=new.request_id and resolved.kind='supply_info'),0)
 ) then
  raise exception 'invalid_state';
 end if;
 if new.kind in('deliver','handoff','dependency','dependency_reply','missing','reject','routing','scope','resolve',
  'release_dependencies','force_start','force_dependency_waived','due_approved','due_rejected','due_auto_approved') then
  new.client_visible=false;
 end if;
 if new.kind='assign' and new.part_id is not null and not exists(
  select 1 from public.work_parts part join public.work_services service on service.id=part.service_id
  where part.id=new.part_id and part.request_id=new.request_id and service.active and service.client_visible
 ) then new.client_visible=false; end if;
 return new;
end;
$$;
revoke all on function provision_private.work_event_visibility_guard() from public,anon,authenticated;
drop trigger if exists work_event_visibility_guard on public.work_events;
create trigger work_event_visibility_guard before insert on public.work_events
for each row execute function provision_private.work_event_visibility_guard();

create or replace function provision_private.work_part_active_department_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.work_parts existing
  where existing.request_id=new.request_id and existing.service_id=new.service_id
   and existing.status not in('approved','forwarded','internal_done')) then
  raise exception 'duplicate_department_assignment';
 end if;
 return new;
end;
$$;
revoke all on function provision_private.work_part_active_department_guard() from public,anon,authenticated;
drop trigger if exists work_part_active_department_guard on public.work_parts;
create trigger work_part_active_department_guard before insert on public.work_parts
for each row execute function provision_private.work_part_active_department_guard();

-- New requests may only have a requested service until intake  Use it for every management authorization check
do $work_action_requested_service$
declare body text; replacement text; segment text;
 start_position integer; end_position integer; statement_position integer; statement_end integer;
begin
 body=pg_get_functiondef('public.work_action(text,jsonb)'::regprocedure);
 if strpos(body,'provision_private.work_manage(r.service_id)')=0 then raise exception 'work_action_service_authorization_shape'; end if;
 body=replace(body,'provision_private.work_manage(r.service_id)',
  'provision_private.work_manage(coalesce(r.service_id,r.requested_service_id))');
 start_position=strpos(body,$anchor$if action='accept' then$anchor$);
 end_position=strpos(body,$anchor$elsif action='missing' then$anchor$);
 if start_position=0 or end_position<=start_position then raise exception 'work_action_accept_branch_shape'; end if;
 segment=substring(body from start_position for end_position-start_position);
 statement_position=strpos(segment,'perform provision_private.work_notify(r.coordinator_id,r.id,');
 if statement_position=0 then raise exception 'work_action_accept_notice_shape'; end if;
 statement_position=start_position+statement_position-1;
 statement_end=statement_position+strpos(substring(body from statement_position),';')-1;
 if statement_end<statement_position then raise exception 'work_action_accept_notice_end'; end if;
 body=overlay(body placing '' from statement_position for statement_end-statement_position+1);

 start_position=strpos(body,$anchor$elsif action='assign' then$anchor$);
 end_position=strpos(body,$anchor$elsif action in ('accept','missing','reject','scope','routing','dependency','deliver') then$anchor$);
 if start_position=0 or end_position<=start_position then raise exception 'work_action_assignment_branch_shape'; end if;
 segment=substring(body from start_position for end_position-start_position);
 statement_position=strpos(segment,'perform provision_private.work_notify(r.client_id,r.id,');
 if statement_position=0 then raise exception 'work_action_client_assignment_notice_shape'; end if;
 statement_position=start_position+statement_position-1;
 statement_end=statement_position+strpos(substring(body from statement_position),';')-1;
 if statement_end<statement_position then raise exception 'work_action_client_assignment_notice_end'; end if;
 replacement=$new$if exists(select 1 from public.work_services service
    where service.id=sid and service.active and service.client_visible) then
    perform provision_private.work_notify(r.client_id,r.id,
     'وجه مسؤول التواصل طلبك إلى قسم ' || (select name from public.work_services where id=sid) || E'\n' || r.title);
   end if;$new$;
 body=overlay(body placing replacement from statement_position for statement_end-statement_position+1);
 execute body;
end;
$work_action_requested_service$;

update public.work_events set client_visible=false
where kind in('deliver','handoff','dependency','dependency_reply','missing','reject','routing','scope','resolve',
 'release_dependencies','force_start','force_dependency_waived','due_approved','due_rejected','due_auto_approved')
 and client_visible;

update public.work_events event set client_visible=false
where event.kind='assign' and event.client_visible and event.part_id is not null and not exists(
 select 1 from public.work_parts part join public.work_services service on service.id=part.service_id
 where part.id=event.part_id and part.request_id=event.request_id and service.active and service.client_visible
);

-- Remove hidden department names from older client inbox rows without deleting their journey update
update public.work_notifications notification set
 message='تم توجيه طلبك وبدأت مرحلة التنفيذ'||E'\n'||request.title
from public.work_requests request
where notification.request_id=request.id and notification.recipient=request.client_id
 and notification.message like 'وجه مسؤول التواصل طلبك إلى قسم %'
 and exists(
  select 1 from public.work_parts part join public.work_services service on service.id=part.service_id
  where part.request_id=request.id and not(service.active and service.client_visible)
   and strpos(notification.message,service.name)>0
 );

create or replace function provision_private.work_event_broadcast()
returns trigger language plpgsql security definer set search_path='' as $$
declare request_row public.work_requests; event_message text; prefix text; client_message text;
begin
 select * into request_row from public.work_requests where id=new.request_id;
 if request_row.id is null or request_row.status='draft' then return null; end if;
 event_message=provision_private.work_event_message(new.id);
 prefix=txid_current()::text||':'||request_row.id::text||':';
 with candidate as(
  select distinct on(notification.recipient) notification.id
  from public.work_notifications notification join auth.users account on account.id=notification.recipient
 where notification.request_id=request_row.id and (
   notification.event_key like prefix||'%'
   or new.kind='accept' and new.part_id is not null and notification.event_key=(
    select 'control:due:'||review.id::text||':proposed'
    from provision_private.work_due_reviews review
    where review.request_id=new.request_id and review.part_id=new.part_id and review.status='pending'
    order by review.proposed_at desc limit 1
   )
  )
   and account.raw_app_meta_data->>'role' in('admin','super_admin')
  order by notification.recipient,notification.created_at,notification.id
 )
 update public.work_notifications notification set
  message=event_message,event_key='control:event:'||new.id::text||':admin',
  whatsapp=case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
  last_error=case when account.raw_app_meta_data->>'portal_qa'='true' then notification.last_error else null end,
  next_attempt=case when account.raw_app_meta_data->>'portal_qa'='true' then notification.next_attempt else now() end
 from candidate,auth.users account
 where candidate.id=notification.id and account.id=notification.recipient
  and not exists(select 1 from public.work_notifications existing where existing.id<>notification.id
   and existing.recipient=notification.recipient and existing.event_key='control:event:'||new.id::text||':admin');
 insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
 select account.id,request_row.id,event_message,
  case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
  'control:event:'||new.id::text||':admin'
 from auth.users account
 where account.raw_app_meta_data->>'role' in('admin','super_admin')
  and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
  and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
  and not exists(select 1 from public.work_notifications notification
   where notification.recipient=account.id and notification.event_key='control:event:'||new.id::text||':admin')
 on conflict(recipient,event_key) where event_key is not null do nothing;

 if request_row.coordinator_id is not null and new.kind<>'dependency' then
  insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
  select account.id,request_row.id,event_message,
   case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
   'event:event:'||new.id::text||':coordinator'
  from auth.users account where account.id=request_row.coordinator_id
   and coalesce(account.raw_app_meta_data->>'role','') not in('admin','super_admin')
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications notification
    where notification.recipient=account.id and notification.request_id=request_row.id and (
     notification.event_key like prefix||'%'
     or new.kind='accept' and new.part_id is not null and notification.event_key=(
      select 'control:due:'||review.id::text||':proposed'
      from provision_private.work_due_reviews review
      where review.request_id=new.request_id and review.part_id=new.part_id and review.status='pending'
      order by review.proposed_at desc limit 1
     )
    ))
  on conflict(recipient,event_key) where event_key is not null do nothing;
 end if;

 if new.client_visible and new.kind not in('request_attachments','decline_intake')
  and (new.part_id is null or exists(
   select 1 from public.work_parts part join public.work_services service on service.id=part.service_id
   where part.id=new.part_id and service.active and service.client_visible
  ))
  and (new.actor is distinct from request_row.client_id or new.kind in('create','submit_request')) then
  client_message=provision_private.work_event_action_label(new.kind)||E'\n'||request_row.title;
  insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
  select account.id,request_row.id,left(client_message,12000),
   case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
   'journey:event:'||new.id::text||':client'
  from auth.users account where account.id=request_row.client_id
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
   and not exists(select 1 from public.work_notifications notification
    where notification.recipient=account.id and notification.request_id=request_row.id and notification.event_key like prefix||'%')
  on conflict(recipient,event_key) where event_key is not null do nothing;
 end if;
 return null;
end;
$$;
revoke all on function provision_private.work_event_broadcast() from public,anon,authenticated;

create or replace function provision_private.work_due_auto_notice()
returns trigger language plpgsql security definer set search_path='' as $$
declare request_row public.work_requests; message text;
begin
 if old.status='pending' and new.status='auto_approved' then
  select * into request_row from public.work_requests where id=new.request_id;
  message=provision_private.work_request_control_message(new.request_id,'اعتماد موعد القسم تلقائيا بعد انتهاء مهلة الإدارة',
   new.proposed_by,new.part_id,'انتهت مهلة القرار وتم اعتماد الموعد المقترح تلقائيا');
  insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
  select account.id,new.request_id,message,
   case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
   'control:due:'||new.id::text||':auto_approved'
  from auth.users account where account.raw_app_meta_data->>'role' in('admin','super_admin')
   and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
   and (not request_row.test or account.raw_app_meta_data->>'portal_qa'='true')
  on conflict(recipient,event_key) where event_key is not null do nothing;
 end if;
 return null;
end;
$$;
revoke all on function provision_private.work_due_auto_notice() from public,anon,authenticated;
drop trigger if exists work_due_auto_notice on provision_private.work_due_reviews;
create trigger work_due_auto_notice after update of status on provision_private.work_due_reviews
for each row execute function provision_private.work_due_auto_notice();

-- Clients only see departments explicitly published to them through RPC and direct RLS reads
create or replace function provision_private.work_part_read(p uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select provision_private.account_ready() and exists(
  select 1 from public.work_parts part
  join public.work_requests request on request.id=part.request_id
  join public.work_services service on service.id=part.service_id
  where part.id=p and (
   provision_private.work_manager() or provision_private.work_coordinator() or part.assignee_id=auth.uid()
   or request.client_id=auth.uid() and service.active and service.client_visible
  )
 )
$$;
revoke all on function provision_private.work_part_read(uuid) from public,anon,authenticated;
grant execute on function provision_private.work_part_read(uuid) to authenticated;

drop policy if exists work_parts_read on public.work_parts;
create policy work_parts_read on public.work_parts for select to authenticated
using(provision_private.work_part_read(id));

-- Dependencies are internal coordination records and are never exposed through direct client table reads
drop policy if exists work_dependencies_read on public.work_dependencies;
create policy work_dependencies_read on public.work_dependencies for select to authenticated using(
 provision_private.work_role()<>'client'
 and (provision_private.work_part_read(part_id) or provision_private.work_part_read(upstream_id))
);

drop policy if exists work_events_read on public.work_events;
create policy work_events_read on public.work_events for select to authenticated using(
 provision_private.work_read(request_id)
 and not(provision_private.work_role()='employee'
  and kind in('due_approved','due_auto_approved'))
 and (
  provision_private.work_manager() or provision_private.work_coordinator() or actor=auth.uid()
  or client_visible and exists(select 1 from public.work_requests request where request.id=request_id
   and request.client_id=auth.uid()) and (part_id is null or exists(
    select 1 from public.work_parts part join public.work_services service on service.id=part.service_id
    where part.id=part_id and service.active and service.client_visible
   ))
  or part_id is not null and exists(select 1 from public.work_parts part where part.id=part_id and part.assignee_id=auth.uid())
 )
);

create or replace function public.work_routes(p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text;
begin
 if not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501'; end if;
 role_name=provision_private.work_role();
 return(select coalesce(jsonb_agg(jsonb_build_object(
  'id',part.id,'service_id',part.service_id,'service',service.name,'route_position',part.route_position,
  'status',part.status,'client_visible',service.client_visible,
  'scope',case when provision_private.work_manager() or provision_private.work_coordinator()
    or part.assignee_id=auth.uid() then part.scope else null end
 ) order by part.route_position,part.created_at,part.id),'[]')
 from public.work_parts part join public.work_services service on service.id=part.service_id
 where part.request_id=p_request and (role_name<>'client' or service.active and service.client_visible));
end;
$$;
revoke all on function public.work_routes(uuid) from public,anon;
grant execute on function public.work_routes(uuid) to authenticated;

create or replace function public.work_request_snapshot(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.work_requests; client jsonb; role_name text:=provision_private.work_role();
begin
 select * into item from public.work_requests where id=p_request;
 if item.id is null or not provision_private.work_read(item.id) then raise exception 'forbidden' using errcode='42501'; end if;
 client=public.work_request_clients(array[item.id])->(item.id::text);
 return jsonb_build_object(
  'id',item.id,'number',item.number,'title',item.title,'brief',item.brief,'client_id',item.client_id,
  'coordinator_id',case when role_name='client' then null else item.coordinator_id end,
  'client',client,
  'service_id',case when role_name<>'client' or item.service_id is null or exists(
   select 1 from public.work_services service where service.id=item.service_id and service.active and service.client_visible
  ) then item.service_id end,
  'requested_service_id',case when role_name<>'client' or item.requested_service_id is null or exists(
   select 1 from public.work_services service where service.id=item.requested_service_id and service.active and service.client_visible
  ) then item.requested_service_id end,
  'specifications',case
   when role_name='client' and coalesce(item.requested_service_id,item.service_id) is not null and not exists(
    select 1 from public.work_services service
    where service.id=coalesce(item.requested_service_id,item.service_id)
     and service.active and service.client_visible
   ) then coalesce(item.specifications,'{}'::jsonb)-'الخدمة المطلوبة'-'معرف الخدمة'
   else item.specifications
  end,'status',item.status,'priority',item.priority,
  'requested_due_at',item.requested_due_at,'received_at',item.received_at,'version',item.version,
  'created_at',item.created_at,'updated_at',item.updated_at
 );
end;
$$;
revoke all on function public.work_request_snapshot(uuid) from public,anon;
grant execute on function public.work_request_snapshot(uuid) to authenticated;

create or replace function public.work_request_detail(p_request uuid,p_management boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text:=provision_private.work_role(); request_row jsonb; events jsonb; files jsonb; deliveries jsonb;
 dependencies jsonb:='[]'::jsonb; routes jsonb; parts jsonb; audit jsonb:='[]'::jsonb; escalations jsonb:='[]'::jsonb;
 due_reviews jsonb:='[]'::jsonb;
begin
 if not provision_private.work_read(p_request) then raise exception 'forbidden' using errcode='42501'; end if;
 request_row=public.work_request_snapshot(p_request);
 select coalesce(jsonb_agg(jsonb_build_object('id',event.id,
  'part_id',case when role_name='client' then null else event.part_id end,'kind',event.kind,
  'note',event.note,'created_at',event.created_at) order by event.id desc),'[]'::jsonb) into events
 from public.work_events event where event.request_id=p_request
  and not(role_name='employee'
   and event.kind in('due_approved','due_auto_approved'))
  and (provision_private.work_manager() or provision_private.work_coordinator() or event.actor=auth.uid()
   or role_name='client' and event.client_visible and (event.part_id is null or exists(
    select 1 from public.work_parts visible_part join public.work_services visible_service
     on visible_service.id=visible_part.service_id
    where visible_part.id=event.part_id and visible_part.request_id=p_request
     and visible_service.active and visible_service.client_visible
   ))
   or event.part_id is not null and exists(select 1 from public.work_parts mine
    where mine.id=event.part_id and mine.assignee_id=auth.uid()));
 select coalesce(jsonb_agg(jsonb_build_object('id',attachment.id,'object_path',attachment.object_path,
  'filename',attachment.filename,'created_at',attachment.created_at) order by attachment.created_at),'[]'::jsonb) into files
 from public.work_attachments attachment where attachment.request_id=p_request;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',delivery.id,'request_id',delivery.request_id,
  'part_id',case when role_name<>'client' or exists(
   select 1 from public.work_parts source_part join public.work_services source_service
    on source_service.id=source_part.service_id
   where source_part.id=delivery.part_id and source_part.request_id=p_request
    and source_service.active and source_service.client_visible
  ) then delivery.part_id end,
  'reviewable',role_name='client' and delivery.status='pending' and delivery.released_at is not null,
  'object_path',delivery.object_path,
  'filename',delivery.filename,'note',delivery.note,'status',delivery.status,'feedback',delivery.feedback,
  'annotation',delivery.annotation,'created_at',delivery.created_at,'received_at',delivery.received_at,
  'released_at',delivery.released_at,'internal_shared_at',delivery.internal_shared_at,'batch_id',delivery.batch_id
 ) order by delivery.created_at desc),'[]'::jsonb) into deliveries
 from public.work_deliveries delivery where delivery.request_id=p_request and (
  (role_name='client' and delivery.released_at is not null)
  or (role_name<>'client' and provision_private.work_file_read(delivery.object_path))
 );
 if role_name<>'client' then
  select coalesce(jsonb_agg(jsonb_build_object('id',dependency.id,'part_id',dependency.part_id,
   'upstream_id',dependency.upstream_id,'reason',dependency.reason,'status',dependency.status,'gate',dependency.gate)),'[]'::jsonb)
  into dependencies from public.work_dependencies dependency where dependency.request_id=p_request
   and (provision_private.work_part_read(dependency.part_id) or provision_private.work_part_read(dependency.upstream_id));
  select coalesce(jsonb_agg(jsonb_build_object('id',escalation.id,'part_id',escalation.part_id,'kind',escalation.kind,
   'reason',escalation.reason,'dependency_id',escalation.dependency_id,'status',escalation.status,
   'resolution',escalation.resolution,'created_at',escalation.created_at,'resolved_at',escalation.resolved_at)
   order by escalation.created_at desc),'[]'::jsonb) into escalations
  from public.work_escalations escalation where escalation.request_id=p_request and (
   provision_private.work_manager() or provision_private.work_coordinator()
   or escalation.part_id is not null and exists(select 1 from public.work_parts mine
    where mine.id=escalation.part_id and mine.assignee_id=auth.uid())
  );
 end if;
 routes=public.work_routes(p_request);
 if role_name='client' then
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',part.id,'service_id',part.service_id,'status',part.status,
   'due_at',case when review.status='pending' then null else part.due_at end,
   'due_review_status',coalesce(review.status,case when part.due_at is not null then 'approved' end),
   'accepted_at',part.accepted_at,'created_at',part.created_at,'forwarded_to',null,
   'forwarded_at',part.forwarded_at,'route_position',part.route_position
  ) order by part.route_position),'[]'::jsonb) into parts
  from public.work_parts part join public.work_services service on service.id=part.service_id
  left join lateral(select due.status from provision_private.work_due_reviews due where due.part_id=part.id
   order by due.proposed_at desc limit 1)review on true
  where part.request_id=p_request and service.active and service.client_visible;
  select coalesce(jsonb_agg(jsonb_build_object(
   'part_id',review.part_id,'status',review.status,
   'proposed_at',case when review.status<>'pending' then review.proposed_at end,
   'reviewed_at',case when review.status<>'pending' then review.reviewed_at end,
   'proposed_due_at',case when review.status<>'pending' then review.proposed_due_at end,
   'replacement_due_at',case when review.status='rejected' then review.replacement_due_at end,
   'effective_due_at',case when review.status='rejected' then review.replacement_due_at
    when review.status in('approved','auto_approved') then review.proposed_due_at end
  ) order by review.proposed_at desc),'[]'::jsonb) into due_reviews
  from provision_private.work_due_reviews review
  join public.work_parts part on part.id=review.part_id
  join public.work_services service on service.id=part.service_id
  where review.request_id=p_request and service.active and service.client_visible;
 else
  select coalesce(jsonb_agg(jsonb_build_object(
   'id',part.id,'request_id',part.request_id,'service_id',part.service_id,'assignee_id',part.assignee_id,
   'scope',part.scope,'status',part.status,'priority',part.priority,'due_at',part.due_at,
   'due_review_status',case when provision_private.work_manager() then review.status
    when review.status='rejected' and part.assignee_id=auth.uid() then 'rejected' end,
   'due_review_expires_at',case when provision_private.work_manager()
    then review.review_expires_at end,
   'accepted_at',part.accepted_at,'created_at',part.created_at,'forwarded_to',part.forwarded_to,
   'forwarded_at',part.forwarded_at,'route_position',part.route_position,'target_minutes',part.target_minutes,
   'effort_points',part.effort_points,'completed_at',part.completed_at,'performance_eligible',part.performance_eligible
  ) order by part.route_position),'[]'::jsonb) into parts
  from public.work_parts part
  left join lateral(select due.status,due.review_expires_at from provision_private.work_due_reviews due
   where due.part_id=part.id order by due.proposed_at desc limit 1)review on true
  where part.request_id=p_request
   and (provision_private.work_manager() or provision_private.work_coordinator() or part.assignee_id=auth.uid());
 end if;
 if p_management and provision_private.work_manager() then audit=public.work_audit(p_request); end if;
 return jsonb_build_object('request',request_row,'events',events,'files',files,'deliveries',deliveries,
  'dependencies',dependencies,'routes',routes,'parts',parts,'audit',audit,'escalations',escalations,
  'due_reviews',due_reviews);
end;
$$;
revoke all on function public.work_request_detail(uuid,boolean) from public,anon;
grant execute on function public.work_request_detail(uuid,boolean) to authenticated;

create or replace function public.work_notifications_page(p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_page integer:=least(greatest(coalesce(p_page,0),0),10000);
begin
 if not provision_private.account_ready() then raise exception 'forbidden' using errcode='42501'; end if;
 return jsonb_build_object(
  'items',(select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc),'[]'::jsonb) from(
   select id,request_id,message,created_at,read_at,whatsapp,last_error,
    whatsapp_delivered_at,whatsapp_read_at,provider_status_at
   from public.work_notifications where recipient=auth.uid()
   order by created_at desc limit 40 offset safe_page*40
  )item),
  'unread_count',(select count(*) from public.work_notifications where recipient=auth.uid() and read_at is null)
 );
end;
$$;
revoke all on function public.work_notifications_page(integer) from public,anon;
grant execute on function public.work_notifications_page(integer) to authenticated;

-- Recover only the recent escalation alerts that were previously suppressed for super admins
insert into public.work_notifications(recipient,request_id,message,whatsapp,event_key)
select account.id,event.request_id,provision_private.work_event_message(event.id),
 case when account.raw_app_meta_data->>'portal_qa'='true' then 'suppressed' else 'pending' end,
 'control:event:'||event.id::text||':admin'
from public.work_events event
join public.work_requests request on request.id=event.request_id
cross join auth.users account
where event.kind in('routing','reject','scope') and event.created_at>=now()-interval '48 hours'
 and account.raw_app_meta_data->>'role'='super_admin'
 and not coalesce(account.is_anonymous,false) and (account.banned_until is null or account.banned_until<now())
 and (not request.test or account.raw_app_meta_data->>'portal_qa'='true')
 and exists(select 1 from public.work_escalations escalation where escalation.request_id=event.request_id
  and escalation.status='open' and (event.part_id is null or escalation.part_id=event.part_id)
  and abs(extract(epoch from(escalation.created_at-event.created_at)))<=10)
on conflict(recipient,event_key) where event_key is not null do nothing;

update public.work_notifications
set last_error='provider_accepted_waiting_delivery'
where whatsapp='sent' and provider_id is not null and last_error is null;

comment on function provision_private.work_event_broadcast() is
'Creates one complete mandatory admin envelope for every workflow event and a scoped coordinator update';
comment on function public.work_notification_delivery_update(text,text,text,timestamptz) is
'Stores idempotent Green API delivery receipts and promotes accepted messages to delivered or read';

commit;
