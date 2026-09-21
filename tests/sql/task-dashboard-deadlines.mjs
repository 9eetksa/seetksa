// Isolated PostgreSQL coverage Reuses the prior bounded fixture and actual migrations
// No live database notification transport or full Supabase migration stack is exercised
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../.tools/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const previousFixture=readFileSync('tests/sql/department-output-tasks.mjs','utf8');
const start=previousFixture.indexOf('const db=new PGlite();'),end=previousFixture.indexOf('const query=async');
assert(start>=0&&end>start,'bounded fixture markers');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const db=await new AsyncFunction('PGlite','readFileSync','assert',previousFixture.slice(start,end)+'return db;')(PGlite,readFileSync,assert);
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const query=async(q,args=[])=> (await db.query(q,args)).rows;
const as=async n=>query("select set_config('test.uid',$1,false)",[n?id(n):'']);
const extract=(source,name)=>{const position=source.indexOf(`create or replace function ${name}(`);assert(position>=0);return source.slice(position,source.indexOf('$$;',position)+3);};
await db.exec(`alter table public.work_requests add column intake_due_at timestamptz;
alter table public.work_requests add column intake_action_at timestamptz;
create table test_coordination(task_key text,request_id uuid,kind text,status text,assignee_id uuid,completed_by uuid);
create function provision_private.work_coordinator_tasks() returns setof public.test_coordination language sql as $$select * from public.test_coordination$$;`);
await db.exec(extract(readFileSync('supabase/migrations/20260913192159_coordinator_task_board.sql','utf8'),'public.work_board'));
const overviewBefore=(await query("select pg_get_functiondef('public.work_team_overview(date,date)'::regprocedure) source"))[0].source;
const performanceBefore=(await query("select pg_get_functiondef('public.work_employee_performance(integer)'::regprocedure) source"))[0].source;
await db.exec(readFileSync('supabase/migrations/20260918223508_task_dashboard_deadline_buckets.sql','utf8'));
const board=async()=> (await query("select work_board('mine','',0) value"))[0].value;
const dashboard=async(bucket='all',search='',page=0,priority='all',sort='latest')=>(await query('select work_task_dashboard($1,$2,$3,$4,$5) value',[bucket,search,page,priority,sort]))[0].value;
const overdue=async(part,at)=>(await query('select provision_private.work_employee_task_overdue($1,$2::timestamptz) value',[id(part),at]))[0].value;
await as(2);
await db.exec(`insert into account_profiles values('${id(1)}','عميل الاختبارات'),('${id(4)}','عميل آخر');
update work_requests set requested_due_at=now()-interval '10 days' where id='${id(10)}';
update work_requests set requested_due_at=now()+interval '10 days' where id='${id(11)}';
update work_parts set status='working',accepted_at=now()-interval '1 day',due_at=now()+interval '1 day' where id='${id(30)}';
update work_parts set status='review',accepted_at=now()-interval '4 days',due_at=now()-interval '3 days' where id='${id(31)}';
update work_parts set status='working',accepted_at=now()-interval '2 days',due_at=now()-interval '1 day' where id='${id(32)}';
insert into work_memberships(user_id,service_id) values('${id(2)}','${id(21)}');
insert into work_parts(id,request_id,service_id,assignee_id,scope,route_position,output_parent_id,status,accepted_at,due_at,output_due_required) values
('${id(40)}','${id(10)}','${id(21)}','${id(2)}','تسليم داخلي متأخر',3,'${id(30)}','review',now()-interval '3 days',now()-interval '2 days',false),
('${id(41)}','${id(10)}','${id(21)}','${id(2)}','تعديل ينتظر التوجيه',4,'${id(30)}','revision',now()-interval '3 days',now()-interval '2 days',false),
('${id(42)}','${id(10)}','${id(21)}','${id(2)}','تعديل ينتظر الاستلام',5,'${id(30)}','offered',null,now()-interval '2 days',false),
('${id(43)}','${id(10)}','${id(21)}','${id(2)}','تعديل بموعد جديد',6,'${id(30)}','working',now()-interval '1 hour',now()+interval '1 day',false),
('${id(44)}','${id(10)}','${id(21)}','${id(2)}','مراجعة العميل',7,'${id(30)}','review',now()-interval '2 days',now()-interval '1 day',false),
('${id(45)}','${id(10)}','${id(21)}','${id(2)}','مراجعة قديمة انتهت',8,'${id(30)}','review',now()-interval '2 days',now()-interval '1 day',false),
('${id(46)}','${id(10)}','${id(21)}','${id(2)}','بدون استلام',9,'${id(30)}','working',null,now()-interval '1 day',false),
('${id(47)}','${id(10)}','${id(21)}','${id(2)}','موعد ينتظر المخرجات',10,'${id(30)}','waiting',now()-interval '1 day',now()-interval '1 hour',true);
insert into work_requests(id,client_id,coordinator_id,service_id,title,brief,status,intake_due_at) values
('${id(12)}','${id(1)}','${id(5)}','${id(20)}','طلب استلام متأخر','وصف تجريبي لاستلام مسؤول التواصل','new',now()-interval '1 day'),
('${id(13)}','${id(4)}','${id(5)}','${id(20)}','طلب مكتمل','وصف تجريبي لطلب مكتمل','completed',null);
insert into test_coordination values('intake:test','${id(12)}','intake','open','${id(5)}',null);
insert into work_deliveries(id,request_id,part_id,uploaded_by,object_path,filename,status,created_at,released_at,batch_id) values
('${id(70)}','${id(10)}','${id(31)}','${id(3)}','old-review-a','الأول','pending',now()-interval '4 days',now()-interval '50 hours','${id(200)}'),
('${id(71)}','${id(10)}','${id(31)}','${id(3)}','old-review-b','الثاني','pending',now()-interval '4 days',now()-interval '50 hours','${id(200)}'),
('${id(72)}','${id(10)}','${id(40)}','${id(2)}','internal','داخلي','pending',now()-interval '1 day',null,'${id(201)}'),
('${id(73)}','${id(10)}','${id(41)}','${id(2)}','revision','تعديل','changes',now()-interval '1 day',now()-interval '1 day','${id(202)}'),
('${id(74)}','${id(10)}','${id(44)}','${id(2)}','client-a','تسليم أول','pending',now()-interval '2 hours',now()-interval '1 hour','${id(203)}'),
('${id(75)}','${id(10)}','${id(44)}','${id(2)}','client-b','تسليم ثان','pending',now()-interval '2 hours',now()-interval '1 hour','${id(203)}'),
('${id(76)}','${id(10)}','${id(45)}','${id(2)}','stale-client','تسليم تاريخي','pending',now()-interval '4 days',now()-interval '3 days','${id(204)}'),
('${id(77)}','${id(10)}','${id(45)}','${id(2)}','new-internal','تسليم أحدث','pending',now()-interval '1 hour',null,'${id(205)}');`);
const now=(await query('select now()::text value'))[0].value;
assert.equal(await overdue(30,now),false,'client preferred date never determines employee lateness');
assert.equal(await overdue(32,now),true,'own committed date wins over future client preference');
assert.equal(await overdue(40,now),true,'internal review remains employee work until released');
for(const pid of [31,41,42,43,44,46,47])assert.equal(await overdue(pid,now),false,`not overdue ${pid}`);
assert.equal(await overdue(45,now),true,'stale client pending batch cannot suppress current work');
let personal=await dashboard('personal_overdue');assert.equal(personal.total,3);assert.equal(personal.counts.personal_overdue,3);assert.equal(personal.counts.all,0);
assert.deepEqual(personal.items.map(item=>item.part_id).sort(),[32,40,45].map(id).sort());
let employeeBoard=await board();assert.equal(employeeBoard.counts.overdue,3);assert.equal(employeeBoard.parts.find(part=>part.id===id(44)).client_review_pending,true);assert.equal(employeeBoard.parts.find(part=>part.id===id(40)).employee_overdue,true);
await assert.rejects(()=>dashboard('all'),/forbidden/);
await assert.rejects(()=>dashboard('client_review'),/forbidden/);
await as(1);await assert.rejects(()=>dashboard('personal_overdue'),/forbidden/);
await as(0);await assert.rejects(()=>dashboard('all'),/forbidden/);
await as(5);let team=await dashboard();assert.equal(team.counts.all,4);assert.equal(team.counts.active,2);assert.equal(team.counts.intake,1);assert.equal(team.counts.completed,1);
assert.equal(team.counts.overdue,3);assert.equal(team.counts.client_review,2);assert.equal(team.counts.client_review_pending,1);assert.equal(team.counts.client_review_overdue,1);assert.equal(team.review_hours,48);
const coordinatorBoard=await board();assert.equal(coordinatorBoard.coordinator_counts.overdue,1);assert.equal(coordinatorBoard.counts.overdue,0,'intake SLA is not an employee commitment');
assert.equal(coordinatorBoard.team_counts.overdue_parts,3);assert.equal(coordinatorBoard.team_counts.pending_client_reviews,2);
assert.equal((await dashboard('client_review')).total,2,'several files of one batch remain one review');
assert.equal((await dashboard('client_review_pending')).items[0].part_id,id(44));assert.equal((await dashboard('client_review_overdue')).items[0].part_id,id(31));
await db.exec('begin');
await query("update work_deliveries set created_at=now()-interval '49 hours',released_at=now()-interval '48 hours' where part_id=$1",[id(44)]);
assert.equal((await dashboard('client_review_overdue')).total,1,'exact review deadline is not overdue');
await query("update work_deliveries set released_at=now()-interval '48 hours 0.001 seconds' where part_id=$1",[id(44)]);
assert.equal((await dashboard('client_review_overdue')).total,2,'clock starts at client release');
await db.exec('rollback');
// A returned revision is not late until accepted again with its own replacement deadline
await as(2);await query("update work_parts set status='working',accepted_at=now(),due_at=now()+interval '1 day' where id=$1",[id(42)]);
assert.equal(await overdue(42,now),false);
await query("update work_parts set due_at='2026-09-19T20:59:59.999Z' where id=$1",[id(42)]);
assert.equal(await overdue(42,'2026-09-19T20:59:59.998Z'),false);assert.equal(await overdue(42,'2026-09-19T20:59:59.999Z'),false);
assert.equal(await overdue(42,'2026-09-19T21:00:00Z'),true,'Riyadh next-day boundary');
await query("update work_parts set due_at=now()+interval '1 day' where id=$1",[id(42)]);
await query("update work_requests set status='completed' where id=$1",[id(11)]);assert.equal(await overdue(32,now),false);await query("update work_requests set status='active' where id=$1",[id(11)]);
// Preserve existing deadline-review action visibility and show alerts as their own units
await db.exec(`delete from provision_private.work_due_reviews;
insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,review_expires_at) values
('${id(10)}','${id(30)}','${id(2)}',now()+interval '1 day',now()+interval '3 hours'),
('${id(10)}','${id(40)}','${id(2)}',now()+interval '2 days',now()+interval '3 hours');
insert into work_escalations(request_id,part_id,kind,reason,opened_by) values('${id(10)}','${id(40)}','routing','إحالة تحتاج مراجعة','${id(2)}');
insert into auth.users(id,raw_app_meta_data) values('${id(8)}','{"role":"admin"}');insert into work_grants values('${id(8)}','${id(20)}',true);`);
await as(5);assert.equal((await dashboard('due_reviews')).total,0);assert.equal((await dashboard('alerts')).total,0);
await query("insert into work_escalations(request_id,part_id,kind,reason,opened_by) values($1,$2,'routing','تنبيه مسؤول التواصل',$3)",[id(10),id(40),id(5)]);
assert.equal((await dashboard('alerts')).total,1,'coordinator sees only personally opened alerts');
await as(8);assert.equal((await dashboard('due_reviews')).total,1);
await as(6);assert.equal((await dashboard('due_reviews')).total,2);
// Filtering must precede server paging and card counts must ignore saved row filters
await db.exec(`insert into work_requests(client_id,coordinator_id,service_id,title,brief,status,priority,created_at)
 select '${id(1)}','${id(5)}','${id(20)}','متابعة '||n,'وصف تجريبي لاختبار التصفح','active',case when n%2=0 then 'urgent' else 'normal' end,now()-n*interval '1 minute'
 from generate_series(1,45)n;`);
const first=await dashboard('active','متابعة',0),second=await dashboard('active','متابعة',1);
assert.equal(first.total,45);assert.equal(first.items.length,40);assert.equal(first.pages,2);assert.equal(first.has_next,true);assert.equal(second.items.length,5);assert.equal(second.has_next,false);
assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,45);
const urgent=await dashboard('active','متابعة',0,'urgent');assert.equal(urgent.total,22);assert.equal(urgent.counts.all,49);assert.equal(urgent.counts.active,47);
const empty=await dashboard('active','لا توجد نتيجة');assert.equal(empty.total,0);assert.equal(empty.items.length,0);assert.equal(empty.counts.active,47);
assert.equal((await dashboard('active','متابعة',0,'all','oldest')).items[0].request_title,'متابعة 45');
await assert.rejects(()=>dashboard('unknown'),/invalid_input/);
assert.equal((await query("select has_function_privilege('anon','public.work_task_dashboard(text,text,integer,text,text)','execute') ok"))[0].ok,false);
assert.equal((await query("select has_function_privilege('authenticated','provision_private.work_employee_task_overdue(uuid,timestamptz)','execute') ok"))[0].ok,false);
// Current overview lateness follows the new commitment while closed reports and scores retain their history
assert.equal((await query("select pg_get_functiondef('public.work_employee_performance(integer)'::regprocedure) source"))[0].source,performanceBefore);
await db.exec(`alter table auth.users add column raw_user_meta_data jsonb default '{}';
alter table work_services add column sort_order integer default 0;
alter table test_coordination add column opened_at timestamptz default now();
alter table test_coordination add column completed_at timestamptz;
alter table test_coordination add column effort_points numeric default 1;
alter table test_coordination add column target_minutes integer default 180;
alter table test_coordination add column actual_minutes numeric default 0;
begin;
with event as(insert into work_events(request_id,part_id,actor,kind,note,created_at)
 values('${id(10)}','${id(40)}','${id(5)}','assign','إسناد تاريخي',now()-interval '4 days') returning id)
 insert into provision_private.work_assignment_history select id,null,'${id(2)}',null,'offered' from event;
with event as(insert into work_events(request_id,part_id,actor,kind,note,created_at)
 values('${id(10)}','${id(40)}','${id(2)}','accept','استلام تاريخي',now()-interval '3 days') returning id)
 insert into provision_private.work_assignment_history select id,'${id(2)}','${id(2)}','offered','working' from event;
insert into provision_private.work_due_reviews(request_id,part_id,proposed_by,proposed_due_at,proposed_at,review_expires_at,status,reviewed_by,reviewed_at)
 values('${id(10)}','${id(40)}','${id(2)}',now()-interval '2 days',now()-interval '3 days',now()-interval '3 days'+interval '3 hours','approved','${id(6)}',now()-interval '3 days');
commit;`);
const overview=async today=>(await query("select work_team_overview((now() at time zone 'Asia/Riyadh')::date-7,(now() at time zone 'Asia/Riyadh')::date-$1::integer) value",[today?0:1]))[0].value;
const currentOverview=await overview(true),historicalOverview=await overview(false);
assert.equal(currentOverview.people.find(person=>person.id===id(2)).late_open_count,3);
assert.equal(currentOverview.people.find(person=>person.id===id(3)).late_open_count,0);
const overviewAfter=(await query("select pg_get_functiondef('public.work_team_overview(date,date)'::regprocedure) source"))[0].source;
await db.exec(overviewBefore);
const historicalBefore=await overview(false),currentBefore=await overview(true);
assert.deepEqual(historicalOverview.people,historicalBefore.people);assert.deepEqual(historicalOverview.summary,historicalBefore.summary);
for(const person of currentOverview.people){const before=currentBefore.people.find(item=>item.id===person.id);for(const key of ['received_count','delivered_count','performance_score','scored_completed_count','completed_points','speed_score','volume_score'])assert.equal(person[key],before[key],key);}
await db.exec(overviewAfter);
console.log('PASS task dashboard committed deadlines client-review exclusion revision reset Riyadh boundary batch dedup authorized categories independent counts and filtered pagination');
await db.close();
