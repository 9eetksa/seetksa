import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20260912074513_workflow_notification_control_envelope.sql',import.meta.url),'utf8');
const privacyMigration=readFileSync(new URL('../supabase/migrations/20260912114500_employee_due_notification_privacy.sql',import.meta.url),'utf8');

test('every workflow event creates one mandatory detailed administration envelope',()=>{
 const messageFunction=migration.slice(
  migration.indexOf('create or replace function provision_private.work_request_control_message'),
  migration.indexOf('create or replace function provision_private.work_event_message')
 );
 assert.match(migration,/create or replace function provision_private\.work_event_broadcast\(\)/);
 assert.match(migration,/'control:event:'\|\|new\.id::text\|\|':admin'/);
 assert.match(migration,/raw_app_meta_data->>'role' in\('admin','super_admin'\)/);
 assert.doesNotMatch(migration,/new\.kind in\('dependency','due_approved'.*return null/s);
 for(const field of [
  'العميل ','مسؤول العميل ','البريد الإلكتروني ','رقم التواصل ',
  'محتوى الطلب','تفاصيل الطلب','الأقسام المكلفة','مسميات مرفقات العميل','مسميات ملفات التسليم'
 ])assert.ok(migration.includes(field),`missing control field ${field}`);
 assert.doesNotMatch(messageFunction,/attachment\.object_path|delivery\.object_path/);
});

test('request messages are scoped while admin control messages bypass preferences',()=>{
 assert.match(migration,/r is not null and who is not null and account\.id=who/);
 assert.match(migration,/r is not null and who is null and account\.raw_app_meta_data->>'role' in\('admin','super_admin'\)/);
 assert.match(migration,/case when mandatory then 'control:' else 'event:' end/);
});

test('provider receipts are idempotent and preserve delivered states',()=>{
 assert.match(migration,/work_provider_receipts\(/);
 assert.match(migration,/on conflict\(provider_id\) do update/);
 assert.match(migration,/create or replace function provision_private\.work_reconcile_provider_receipts\(\)/);
 assert.match(migration,/perform provision_private\.work_reconcile_provider_receipts\(\)/);
 assert.match(migration,/when notification\.whatsapp='read' then 'read'/);
 assert.match(migration,/notification\.whatsapp='delivered' and receipt\.status in\('sent','failed'\) then 'delivered'/);
 assert.match(migration,/grant execute on function public\.work_notification_delivery_update\(text,text,text,timestamptz\) to service_role/);
 assert.match(migration,/check\(whatsapp in\('pending','sending','sent','delivered','read','failed','unknown','suppressed'\)\)/);
 assert.match(migration,/whatsapp='sending',attempts=attempts\+1,next_attempt=now\(\),provider_id=null,provider_status_at=null,last_error=null/);
});

test('client journey keeps internal work private and hides private departments',()=>{
 for(const kind of ['deliver','handoff','dependency','routing','scope','due_approved','due_rejected']){
  assert.ok(migration.includes(`'${kind}'`),`missing internal event ${kind}`);
 }
 assert.match(migration,/new\.client_visible=false/);
 assert.match(migration,/role_name<>'client' or service\.active and service\.client_visible/);
 assert.match(migration,/'journey:event:'\|\|new\.id::text\|\|':client'/);
 assert.match(migration,/create policy work_dependencies_read[\s\S]*provision_private\.work_role\(\)<>'client'/);
 assert.match(migration,/'service_id',case when role_name<>'client'/);
 assert.match(migration,/visible_service\.active and visible_service\.client_visible/);
});

test('attachment completion dependency notices and due reviews keep one valid operational path',()=>{
 assert.match(migration,/issue\.kind in\('request_info','request_attachments','missing'\)/);
 assert.match(migration,/new\.kind<>'dependency'/);
 assert.match(migration,/raw_app_meta_data->>'role',''\) not in\('admin','super_admin'\)/);
 assert.match(migration,/work_action_accept_notice_shape/);
 assert.match(migration,/duplicate_accept_notice|work_notify\(r\.coordinator_id/);
 assert.match(migration,/service\.active and service\.client_visible/);
 assert.match(migration,/Remove hidden department names from older client inbox rows/);
 assert.match(migration,/control:due:'\|\|review\.id::text\|\|':proposed/);
 assert.match(migration,/when review\.status='rejected' and part\.assignee_id=auth\.uid\(\) then 'rejected' end/);
 assert.match(migration,/'due_review_expires_at',case when provision_private\.work_manager\(\)\s+then review\.review_expires_at end/);
});

test('client delivery review remains usable without exposing hidden department topology',()=>{
 assert.match(migration,/then coalesce\(item\.specifications,'\{\}'::jsonb\)-'الخدمة المطلوبة'-'معرف الخدمة'/);
 assert.match(migration,/'part_id',case when role_name<>'client' or exists\(/);
 assert.match(migration,/'reviewable',role_name='client' and delivery\.status='pending' and delivery\.released_at is not null/);
 assert.match(migration,/'forwarded_to',null/);
 assert.match(migration,/not\(role_name='employee'\s+and event\.kind in\('due_approved','due_auto_approved'\)\)/);
});

test('administrative due approvals never reach an employee coordinator',()=>{
 assert.match(privacyMigration,/new\.kind not in\(''dependency'',''due_approved'',''due_auto_approved''\)/);
 assert.match(privacyMigration,/create or replace function provision_private\.work_notification_readable/);
 assert.match(privacyMigration,/provision_private\.work_role\(\)='employee'[\s\S]*event\.kind in\('due_approved','due_auto_approved'\)/);
 assert.match(privacyMigration,/notification\.whatsapp in\('pending','failed','unknown','sending'\)/);
});

test('recent mandatory control alerts are recovered for admins as well as super admins',()=>{
 const catchup=readFileSync(new URL('../supabase/migrations/20260912133500_admin_control_notification_catchup.sql',import.meta.url),'utf8');
 assert.match(catchup,/raw_app_meta_data->>'role' in\('admin','super_admin'\)/);
 assert.match(catchup,/event\.kind in\('routing','reject','scope'\)/);
 assert.match(catchup,/event\.created_at>=now\(\)-interval '48 hours'/);
 assert.match(catchup,/request\.status<>'draft'/);
 assert.match(catchup,/not coalesce\(account\.is_anonymous,false\)/);
 assert.match(catchup,/account\.banned_until is null or account\.banned_until<now\(\)/);
 assert.match(catchup,/not request\.test or account\.raw_app_meta_data->>'portal_qa'='true'/);
 assert.match(catchup,/provision_private\.work_event_message\(event\.id\)/);
 assert.match(catchup,/'control:event:'\|\|event\.id::text\|\|':admin'/);
 assert.match(catchup,/on conflict\(recipient,event_key\).*do nothing/s);
 assert.doesNotMatch(catchup,/raw_app_meta_data->>'role'='super_admin'/);
});
