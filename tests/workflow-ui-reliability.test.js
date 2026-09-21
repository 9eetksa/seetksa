import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const data=read('../src/workflow/data.js');
const team=read('../src/workflow/TeamWork.jsx');
const client=read('../src/workflow/ClientWorkspace.jsx');
const timeline=read('../src/workflow/ClientRequestTimeline.jsx');
const notifications=read('../src/workflow/Notifications.jsx');
const notificationCenter=read('../src/workflow/NotificationCenter.jsx');
const notificationStyles=read('../src/workflow/notification-center.css');

test('request details recover current escalations and preserve the latest snapshot',()=>{
 assert.match(data,/work_board',\{p_view:'alerts',p_search:String\(request\.number\),p_page:0\}/);
 assert.match(data,/filter\(escalation=>escalation\.request_id===request\.id\)/);
 assert.match(team,/const currentRequest=\{\.\.\.r,\.\.\.asRecord\(extra\.request\)\}/);
 assert.match(team,/\(extra\.escalations\|\|\[\]\)/);
});

test('routing and service editing use their dedicated contracts',()=>{
 assert.match(team,/spec\.part\?\.service_id\|\|spec\.request\?\.requested_service_id\|\|spec\.request\?\.service_id/);
 assert.match(data,/saveService:service=>result\(supabase\.rpc\('work_catalog_service_save',\{p:service\}\)\)/);
});

test('client due dates use the shared accepted and confirmed schedule projection',()=>{
 const schedule=read('../src/workflow/client-schedule.js');
 assert.match(client,/clientSchedule/);
 assert.match(schedule,/confirmedStatuses=new Set\(\['approved','auto_approved','rejected'\]\)/);
 assert.match(schedule,/Boolean\(part\.accepted_at\)&&part\.status!=='offered'/);
 assert.match(schedule,/dueAt:confirmed&&effective&&riyadhDate\(effective\)\?effective:null/);
 assert.match(schedule,/route\.client_visible===false/);
 assert.doesNotMatch(client,/موعد الفريق المتوقع/);
});

test('notification surfaces preserve message lines and honest delivery states',()=>{
 assert.match(data,/async notifications\(id\)\{return this\.notificationPage\(0,id\);\}/);
 assert.match(notifications,/payload\?\.unread_count/);
 assert.match(notificationCenter,/sent: 'قبله مزود واتساب وبانتظار تأكيد الوصول'/);
 assert.match(notificationCenter,/read: 'تمت قراءة رسالة واتساب'/);
 assert.match(notificationStyles,/\.op-notification-copy > strong[\s\S]*white-space: pre-line/);
});

test('client history is always present and exposes only explicit client events',()=>{
 const copy=timeline.slice(timeline.indexOf('const clientEventCopy'),timeline.indexOf('const clientNoteKinds'));
 for(const kind of ['create','intake','request_info','request_attachments','supply_info','assign','accept','deliver','release_delivery','handoff','review','attach','decline_intake'])assert.match(copy,new RegExp(`\\b${kind}:`));
 for(const internal of ['dependency','routing','due_approved','due_auto_approved','due_rejected'])assert.doesNotMatch(copy,new RegExp(`\\b${internal}:`));
 assert.match(timeline,/clientHistory=events\.filter\(event=>clientEventCopy\[event\.kind\]\)/);
 assert.match(timeline,/delivery\.reviewable===true\|\|parts\.some/);
 assert.match(timeline,/className="c-journey-history"/);
 assert.match(timeline,/ينتظر القسم وصول المخرجات المطلوبة قبل متابعة التنفيذ/);
 assert.match(team,/!\['due_approved','due_auto_approved'\]\.includes\(event\.kind\)/);
});
