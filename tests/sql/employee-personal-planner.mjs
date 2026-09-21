// Isolated actual SQL functions with bounded Auth and notification transport fixtures
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../.tools/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import {outboundNotificationMessage} from '../../supabase/functions/_shared/notification-message.js';
const fixture=readFileSync('tests/sql/task-dashboard-deadlines.mjs','utf8');
const start=fixture.indexOf('const previousFixture=readFileSync'),end=fixture.indexOf('const board=async');assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const db=await new AsyncFunction('PGlite','readFileSync','assert',fixture.slice(start,end)+'return db;')(PGlite,readFileSync,assert);
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async n=>query("select set_config('test.uid',$1,false)",[n?id(n):'']);
const contract=readFileSync('supabase/migrations/20260912140000_workflow_notification_contract.sql','utf8');
const at=contract.indexOf('create or replace function provision_private.work_event_message(');
await db.exec(contract.slice(at,contract.indexOf('$$;',at)+3));
await db.exec(`create function provision_private.work_request_control_message(uuid,text,uuid,uuid,text) returns text language sql as $$select E'تحديث رقابي على الطلب\nالإجراء '||$2||E'\nعنوان الطلب طلب تجريبي'$$;`);
if(process.argv[2]){
 const raw=readFileSync(process.argv[2]);const snapshot=JSON.parse(raw.toString(raw[0]===255&&raw[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,''));
 for(const row of snapshot.rows){assert.equal(row.name,'work_event_message');assert(row.definition.startsWith('CREATE OR REPLACE FUNCTION '));await db.exec(row.definition);}
}
await db.exec(readFileSync('supabase/migrations/20260918224708_employee_deadline_confirmation.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20260919220654_employee_personal_planner_due_changes.sql','utf8'));
const version=async()=>(await query('select version from work_requests where id=$1',[id(10)]))[0].version;
const task=async pid=>(await query('select * from work_parts where id=$1',[id(pid)]))[0];
const planner=async(bucket='all',search='',page=0,priority='all',sort='due')=>(await query('select work_personal_planner($1,$2,$3,$4,$5) value',[bucket,search,page,priority,sort]))[0].value;
const queue=async(request=null,page=0)=>(await query('select work_task_due_changes($1,$2) value',[request,page]))[0].value;
const reschedule=async p=>(await query('select work_reschedule_task_due($1::jsonb) value',[JSON.stringify(p)]))[0].value;
const review=async p=>(await query('select work_review_task_due_change($1::jsonb) value',[JSON.stringify(p)]))[0].value;
let key=500;
const edit=async(due='2027-01-05T20:59:59.999Z',extra={})=>({request_id:id(10),part_id:id(30),version:await version(),expected_due_at:(await task(30)).due_at,due_at:due,submission_key:id(key++),...extra});
const decide=async(proposal,decision='approve',extra={})=>({request_id:id(10),id:proposal,version:await version(),decision,reason:'قرار الإدارة المعتمد',submission_key:id(key++),...extra});
await as(1);await assert.rejects(()=>planner(),/forbidden/);await as(null);await assert.rejects(()=>planner(),/forbidden/);
await as(2);
await db.exec(`insert into account_profiles values('${id(1)}','العميل الأول'),('${id(4)}','العميل الثاني');
insert into work_memberships(user_id,service_id) values('${id(2)}','${id(21)}');
update work_parts set accepted_at=now(),status='working',due_at='2027-01-10T20:59:59.999Z' where id='${id(30)}';
insert into auth.users(id,raw_app_meta_data) values('${id(8)}','{"role":"admin"}');insert into work_grants values('${id(8)}','${id(21)}',true);
insert into work_parts(id,request_id,service_id,assignee_id,scope,route_position,output_parent_id,status,accepted_at,due_at) values
('${id(40)}','${id(10)}','${id(21)}','${id(2)}','مهمة ثانية لنفس الموظف',3,'${id(30)}','offered',null,null),
('${id(41)}','${id(10)}','${id(21)}','${id(2)}','مهمة متأخرة',4,'${id(30)}','working',now()-interval '3 days',now()-interval '1 day'),
('${id(42)}','${id(10)}','${id(21)}','${id(2)}','مهمة مراجعة العميل',5,'${id(30)}','review',now()-interval '3 days',now()-interval '1 day'),
('${id(43)}','${id(10)}','${id(21)}','${id(2)}','بيانات ناقصة',6,'${id(30)}','needs_info',now(),'2027-01-10T20:59:59.999Z'),
('${id(44)}','${id(10)}','${id(21)}','${id(2)}','مهمة مكتملة',7,'${id(30)}','internal_done',now(),'2027-01-10T20:59:59.999Z');
insert into work_deliveries(request_id,part_id,uploaded_by,object_path,filename,status,released_at) values('${id(10)}','${id(42)}','${id(2)}','client-review','المخرجات','pending',now());`);
let board=await planner();assert.equal(board.counts.all,7);assert.equal(board.counts.new,2);assert.equal(board.counts.accepted,1);assert.equal(board.counts.overdue,1);assert.equal(board.counts.review,1);assert.equal(board.counts.waiting,1);assert.equal(board.counts.completed,1);
assert(!board.items.some(p=>p.part_id===id(31)),'other employee task excluded even within same department and request');
assert.equal(new Set(board.items.map(p=>p.part_id)).size,7);
assert(board.items.find(p=>p.part_id===id(30)).can_reschedule);assert(!board.items.find(p=>p.part_id===id(42)).can_reschedule);
await assert.rejects(()=>queue(),/forbidden/);await assert.rejects(()=>planner('unknown'),/invalid_input/);
const first=await edit();
for(const who of [1,3,5,6]){await as(who);await assert.rejects(()=>reschedule(first),/forbidden/);}
await as(2);await assert.rejects(()=>reschedule({...first,version:0}),/version_conflict/);
await assert.rejects(()=>reschedule({...first,expected_due_at:'2027-01-09T20:59:59.999Z'}),/due_conflict/);
await assert.rejects(()=>reschedule({...first,due_at:'2027-01-05T20:59:59Z'}),/invalid_due/);
await assert.rejects(()=>reschedule({...first,due_at:'2027-01-05T00:00:00Z'}),/invalid_due/);
await assert.rejects(()=>reschedule({...first,due_at:'2020-01-05T20:59:59.999Z'}),/invalid_due/);
const changed=await reschedule(first);assert.equal(changed.outcome,'updated');assert.deepEqual(await reschedule(first),changed);
assert.equal(new Date((await task(30)).due_at).toISOString(),first.due_at);
await assert.rejects(()=>reschedule({...first,due_at:'2027-01-04T20:59:59.999Z'}),/submission_conflict/);
assert.equal((await query("select count(*)::int n from work_events where kind='employee_due_advanced'"))[0].n,1);
await as(1);let detail=(await query('select work_request_detail($1) value',[id(10)]))[0].value;assert.equal(new Date(detail.parts.find(p=>p.id===id(30)).due_at).toISOString(),first.due_at);
await as(2);const postpone=await edit('2027-01-12T20:59:59.999Z',{reason:'نحتاج وقتا إضافيا لإنجاز المهمة'});
await assert.rejects(()=>reschedule({...postpone,reason:''}),/invalid_reason/);
await query('delete from test_notices');const proposed=await reschedule(postpone);assert.equal(proposed.outcome,'pending');assert.deepEqual(await reschedule(postpone),proposed);
assert.equal(new Date((await task(30)).due_at).toISOString(),first.due_at,'proposal never changes actual commitment');
assert.equal((await query("select count(*)::int n from provision_private.work_due_reviews where status='pending'"))[0].n,0,'extensions are outside automatic deadline approval queue');
assert.equal((await query('select count(*)::int n from test_notices where recipient=$1',[id(1)]))[0].n,0,'no pending proposal notice to client');
const managementNotice=(await query("select provision_private.work_event_message(id) message from work_events where kind='employee_due_requested' order by id desc limit 1"))[0].message;
assert.match(outboundNotificationMessage({message:managementNotice,recipient_role:'admin'}),/طلب موظف قسم قسم المصدر تأجيل موعد التسليم إلى ١٢ يناير ٢٠٢٧/);
board=await planner();assert.equal(board.items.find(p=>p.part_id===id(30)).pending_due_change.id,proposed.proposal_id);assert.equal(board.items.find(p=>p.part_id===id(30)).can_reschedule,false);
await assert.rejects(async()=>reschedule(await edit('2027-01-13T20:59:59.999Z',{reason:'طلب آخر'})),/due_change_pending/);
assert.equal((await queue(id(10))).total,1);await as(3);assert.equal((await queue(id(10))).total,0);await as(5);assert.equal((await queue(id(10))).total,0);
await as(2);await assert.rejects(async()=>review(await decide(proposed.proposal_id)),/forbidden/);await as(1);await assert.rejects(()=>queue(id(10)),/forbidden/);
await as(8);assert.equal((await queue()).total,0);await assert.rejects(async()=>review(await decide(proposed.proposal_id)),/forbidden/);
await as(6);assert.equal((await queue()).total,1);const approval=await decide(proposed.proposal_id);const approved=await review(approval);assert.equal(approved.outcome,'approved');assert.deepEqual(await review(approval),approved);
await assert.rejects(()=>review({...approval,decision:'reject'}),/submission_conflict/);
assert.equal(new Date((await task(30)).due_at).toISOString(),postpone.due_at);assert.equal((await queue()).total,0);
assert.equal((await query('select count(*)::int n from test_notices where recipient=$1',[id(1)]))[0].n,1,'client learns only actual confirmed deadline');
await as(2);board=await planner();assert(board.items.find(p=>p.part_id===id(30)).due_locked_by_admin);assert(board.items.find(p=>p.part_id===id(30)).can_reschedule);
await assert.rejects(async()=>reschedule(await edit('2027-01-10T20:59:59.999Z')),/admin_due_locked/);
const later=await reschedule(await edit('2027-01-15T20:59:59.999Z',{reason:'طلب تمديد الموعد المعتمد'}));await as(6);
const rejected=await review(await decide(later.proposal_id,'reject'));assert.equal(rejected.outcome,'rejected');assert.equal(new Date((await task(30)).due_at).toISOString(),postpone.due_at);
assert.equal((await queue()).total,0);
await as(2);const stale=await reschedule(await edit('2027-01-17T20:59:59.999Z',{reason:'طلب موعد جديد'}));
await as(6);await query('select work_override_task_due($1::jsonb)',[JSON.stringify({request_id:id(10),part_id:id(30),version:await version(),due_at:'2027-01-16T20:59:59.999Z',submission_key:id(key++)})]);
assert((await queue()).items[0].stale);await assert.rejects(async()=>review(await decide(stale.proposal_id)),/due_conflict/);await review(await decide(stale.proposal_id,'reject'));
await as(2);
for(const pid of [40,42,44])await assert.rejects(async()=>reschedule(await edit('2027-01-20T20:59:59.999Z',{part_id:id(pid),expected_due_at:(await task(pid)).due_at})),/invalid_state|due_conflict/);
await query('update work_parts set output_due_required=true where id=$1',[id(30)]);await assert.rejects(async()=>reschedule(await edit()),/invalid_state/);await query('update work_parts set output_due_required=false where id=$1',[id(30)]);
// Real server pages contain every matching assignment beyond the initial request page
await db.exec(`insert into work_parts(id,request_id,service_id,assignee_id,scope,route_position,output_parent_id,priority)
 select ('00000000-0000-0000-0000-'||lpad((1000+n)::text,12,'0'))::uuid,'${id(10)}','${id(21)}','${id(2)}','مهمة تخطيط مستقلة',100+n,'${id(30)}','urgent' from generate_series(1,55)n;`);
const page1=await planner('new','العميل الأول',0,'urgent','latest'),page2=await planner('new','العميل الأول',1,'urgent','latest');assert.equal(page1.total,55);assert.equal(page1.items.length,40);assert.equal(page2.items.length,15);assert(page1.has_next);assert(!page2.has_next);assert.equal(new Set([...page1.items,...page2.items].map(p=>p.part_id)).size,55);
assert.equal(page1.counts.all,62);assert.equal((await planner('all','غير موجود')).counts.all,62);assert.equal((await planner('all','غير موجود')).total,0);
await db.exec(`insert into work_requests(id,client_id,service_id,title,brief,status)
 select ('00000000-0000-0000-0000-'||lpad((2000+n)::text,12,'0'))::uuid,'${id(1)}','${id(20)}','طلبات كثيرة للتخطيط','تفاصيل طلب تجريبي مستقل','active' from generate_series(1,56)n;
insert into work_parts(id,request_id,service_id,assignee_id,scope,route_position)
 select ('00000000-0000-0000-0000-'||lpad((3000+n)::text,12,'0'))::uuid,('00000000-0000-0000-0000-'||lpad((2000+n)::text,12,'0'))::uuid,'${id(20)}','${id(2)}','مهمة مستقلة',1 from generate_series(1,56)n;`);
const many1=await planner('all','طلبات كثيرة',0),many2=await planner('all','طلبات كثيرة',1);assert.equal(many1.total,56);assert.equal(new Set([...many1.items,...many2.items].map(p=>p.request_id)).size,56,'planner includes authorized requests beyond a first fifty-request board window');
// Administrative dates stay locked until a real new acceptance creates a new employee commitment
await query("update work_parts set status='offered',accepted_at=null,due_at=null where id=$1",[id(30)]);
await query('select work_action($1,$2::jsonb)',['accept',JSON.stringify({request_id:id(10),part_id:id(30),version:await version(),due_at:'2027-01-20T20:59:59.999Z'})]);
assert.equal((await planner('all','طلب تجريبي')).items.find(p=>p.part_id===id(30)).due_locked_by_admin,false);
await reschedule(await edit('2027-01-19T20:59:59.999Z'));
const reassigned=await reschedule(await edit('2027-01-22T20:59:59.999Z',{reason:'تأجيل قبل إعادة التكليف'}));await as(6);
await query('update work_parts set assignee_id=$2 where id=$1',[id(30),id(3)]);
await assert.rejects(async()=>review(await decide(reassigned.proposal_id)),/due_conflict/);
await review(await decide(reassigned.proposal_id,'reject'));
assert.equal((await query("select count(*)::int n from test_notices where recipient=$1 and message like 'رفضت الإدارة طلب تأجيل موعد تسليم مهمتك%'",[id(2)]))[0].n,1,'former owner receives refusal without the replacement owner deadline');
const notice=(await query("select * from test_notices where recipient=$1 and message like 'وافقت الإدارة%' limit 1",[id(2)]))[0];
assert.match(outboundNotificationMessage({...notice,recipient_role:'employee',request_title:'طلب تجريبي'}),/وافقت الإدارة على تأجيل موعد تسليم مهمتك إلى ١٢ يناير ٢٠٢٧/);
assert.match(outboundNotificationMessage({...notice,recipient_role:'employee'}),/توضيح الإدارة قرار الإدارة المعتمد/);
assert.equal(outboundNotificationMessage({...notice,recipient_role:'client'}),'طلبكم قيد المتابعة لدى الفريق');
for(const kind of ['employee_due_requested','employee_due_rejected','employee_due_approved']){
 assert.equal((await query("select bool_or(provision_private.work_event_client_notice_required(id)) allowed from work_events where kind=$1",[kind]))[0].allowed,false,'internal deadline decisions do not enter client event queue');
}
assert.equal((await query("select has_function_privilege('anon','public.work_personal_planner(text,text,integer,text,text)','execute') allowed"))[0].allowed,false);
for(const name of ['work_task_due_changes','work_task_due_change_receipts'])assert.equal((await query(`select has_table_privilege('authenticated','provision_private.${name}','select') allowed`))[0].allowed,false);
console.log('PASS own task planner scopes counts pages immediate earlier deadline queued postponement administrator review actual dates privacy admin lock stale snapshots idempotency and deadline history');
await db.close();
