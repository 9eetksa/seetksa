import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20260912140000_workflow_notification_contract.sql',import.meta.url),'utf8');

test('the workflow notification contract covers every request and task event',()=>{
 for(const kind of [
  'create','submit_request','intake','request_info','supply_info','assign','accept',
  'missing','reject','routing','dependency','dependency_reply','deliver','scope','resolve',
  'release_dependencies','force_start','force_dependency_waived','release_delivery','review',
  'attach','handoff','due_approved','due_rejected','due_auto_approved','request_attachments',
  'decline_intake','intake_overdue'
 ])assert.ok(migration.includes(`when '${kind}'`),`missing notification label for ${kind}`);
 assert.match(migration,/create or replace function provision_private\.work_ensure_event_notifications\(p_event_id bigint\)/);
 assert.match(migration,/raw_app_meta_data->>'role' in\('admin','super_admin'\)/);
 assert.match(migration,/'control:event:'\|\|event_row\.id::text\|\|':admin'/);
 assert.match(migration,/'journey:event:'\|\|event_row\.id::text\|\|':client'/);
 assert.match(migration,/'event:event:'\|\|event_row\.id::text\|\|':coordinator'/);
 assert.match(migration,/raise exception 'notification_contract_admin'/);
 assert.match(migration,/raise exception 'notification_contract_client'/);
 assert.match(migration,/raise exception 'notification_contract_coordinator'/);
});

test('client visibility fails closed while public journey messages remain explicit',()=>{
 assert.match(migration,/new\.kind not in\('create','submit_request','intake','request_info','supply_info','assign','accept','release_delivery','review','attach','request_attachments','decline_intake'\)/);
 assert.match(migration,/when 'assign' then case when service_visible/);
 assert.match(migration,/تم توجيه طلبك إلى فريق التنفيذ/);
 const required=migration.match(/create or replace function provision_private\.work_event_client_notice_required[\s\S]*?\$\$;/)?.[0]??'';
 assert.match(required,/event_row\.client_visible/);
 assert.match(required,/event_row\.kind in\('create','submit_request','intake','request_info','assign','accept','release_delivery','request_attachments','decline_intake'\)/);
 assert.match(required,/service\.active and service\.client_visible/);
 assert.doesNotMatch(required,/'force_start'/);
 assert.match(migration,/if new\.kind in\('intake','request_info','assign','accept','force_start','release_delivery'\) then/);
 assert.match(migration,/\$work_control_client_notice_dedupe\$/);
});

test('automatic controls become auditable events and recent events self heal',()=>{
 assert.match(migration,/values\(new\.request_id,new\.part_id,null,'due_auto_approved'/);
 assert.match(migration,/values\(item\.id,null,null,'intake_overdue'/);
 assert.match(migration,/create or replace function provision_private\.work_notification_integrity_tick\(\)/);
 assert.match(migration,/reconciled_count=provision_private\.work_notification_integrity_tick\(\)/);
 assert.match(migration,/historical_contract_backfill/);
});

test('dependency release and unassigned communication routing cannot strand work',()=>{
 assert.match(migration,/update public\.work_dependencies link set status='accepted'/);
 assert.match(migration,/link\.upstream_id=a\.id and link\.gate='internal_delivery' and link\.status='pending'/);
 assert.match(migration,/staff\.coordinator/);
 assert.match(migration,/who is null and r is not null/);
});

test('special operational recipients stay atomic without duplicate coordinator envelopes',()=>{
 const coordinator=migration.match(/create or replace function provision_private\.work_event_coordinator_notice_required[\s\S]*?\$\$;/)?.[0]??'';
 assert.match(coordinator,/event_row\.kind not in\('dependency','handoff','force_dependency_waived','due_approved','due_auto_approved'\)/);
 assert.match(coordinator,/event_row\.kind='due_rejected' and part\.assignee_id=request_row\.coordinator_id/);
 assert.match(migration,/raise exception 'notification_contract_operational'/);
 assert.match(migration,/raise exception 'notification_contract_coordinators'/);
 assert.match(migration,/raise exception 'notification_contract_managers'/);
 assert.match(migration,/create or replace function provision_private\.work_notify_once/);
 assert.match(migration,/create table if not exists provision_private\.work_notification_requirements/);
 assert.match(migration,/create table if not exists provision_private\.work_event_notification_links/);
 assert.doesNotMatch(migration,/delete from public\.work_notifications notification\s+where notification\.recipient=request_row\.coordinator_id/);
 assert.match(migration,/\$release_dependency_notice_dedupe\$/);
});

test('notification access and delivery revalidate the current audience role',()=>{
 assert.match(migration,/create or replace function provision_private\.work_notification_audience_eligible/);
 assert.match(migration,/work_notification_audience_eligible\([\s\S]*notification\.recipient,notification\.event_key,notification\.request_id/);
 assert.match(migration,/last_error='audience_no_longer_eligible'/);
 assert.match(migration,/notification\.id=public\.work_notification_signals\.notification_id/);
 assert.match(migration,/requirement\.audience/);
 assert.match(migration,/missing_operational/);
 assert.match(migration,/'recipient_contract_healthy'/);
 assert.match(migration,/failed_delivery=0 and coalesce\(channel_state,'unknown'\)='authorized'/);
 assert.match(migration,/create or replace function public\.work_notifications_page/);
 assert.match(migration,/provision_private\.work_notification_readable\(notification\.id\)/);
 assert.match(migration,/coalesce\(new\.event_key,''\) not like 'control:%'/);
 assert.match(migration,/when new\.whatsapp in\('delivered','read'\)/);
 assert.match(migration,/when 'coordinator_pool'/);
 assert.match(migration,/request_row\.status='new' and request_row\.coordinator_id is null/);
 assert.match(migration,/escalation\.kind='overload'/);
 assert.match(migration,/last_error='audience_restored'/);
 assert.match(migration,/notification\.last_error in\('recipient_unavailable','audience_no_longer_eligible'\)/);
 assert.match(migration,/old\.recipient is distinct from new\.recipient/);
 assert.match(migration,/audience=provision_private\.work_notification_requirements\.audience/);
 assert.match(migration,/request_row\.status='new' and request_row\.coordinator_id is null/);
 const coordinatorEligibility=migration.match(/when 'coordinator' then[\s\S]*?when 'coordinator_pool'/)?.[0]??'';
 assert.match(coordinatorEligibility,/request_row\.coordinator_id=account\.id/);
 assert.doesNotMatch(coordinatorEligibility,/part\.assignee_id=account\.id/);
 assert.match(migration,/if new\.kind<>'assign' then[\s\S]*?set audience='coordinator'/);
 assert.match(migration,/new\.event_key like 'control:due:%:proposed'/);
 assert.match(migration,/new\.event_key like 'control:dependency:%:created'/);
 assert.ok((migration.match(/event_key like 'control:due:%:proposed'/g)||[]).length>=2);
 assert.ok((migration.match(/event_key like 'control:dependency:%:created'/g)||[]).length>=2);
 assert.match(migration,/coalesce\(event_key,''\) not like 'control:%'/);
});

test('uncertain delivery recovery is attempt scoped fenced and never age stranded',()=>{
 assert.match(migration,/dispatch_token uuid/);
 assert.match(migration,/dispatch_phone text/);
 assert.match(migration,/recovery_token uuid/);
 assert.match(migration,/dispatch_token=gen_random_uuid\(\)/);
 assert.match(migration,/recovery_token=gen_random_uuid\(\)/);
 assert.match(migration,/notification\.dispatch_token=dispatch_identity and notification\.recovery_token=recovery_identity/);
 assert.match(migration,/last_error='delivery_outcome_unrecoverable'/);
 assert.match(migration,/notification\.dispatch_started_at>=now\(\)-interval '23 hours'/);
 assert.match(migration,/legacy_delivery_outcome_unrecoverable/);
 assert.match(migration,/notification\.dispatch_token is null[\s\S]*?coalesce\(notification\.dispatch_started_at,notification\.next_attempt,notification\.created_at\)/);
 assert.match(migration,/not like 'control:delivery:unrecoverable:%'/);
 assert.match(migration,/recovery_lease_until is null or notification\.recovery_lease_until<=now\(\)/);
});
