// Actual work_action branches and audience functions in isolated PostgreSQL
// Auth readiness and notification transport use bounded fixtures No live mutation or message
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../.tools/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
import {outboundNotificationMessage} from '../../supabase/functions/_shared/notification-message.js';
const fixture=readFileSync('tests/sql/department-output-tasks.mjs','utf8');
const start=fixture.indexOf('const db=new PGlite();'),end=fixture.indexOf('const query=async');
assert(start>=0&&end>start);
let setup=fixture.slice(start,end);
const outputAnchor="await db.exec(sql('20260918221141_department_output_tasks.sql'));";
assert(setup.includes(outputAnchor));
setup=setup.replace(outputAnchor,"await db.exec(sql('20260918213511_internal_routing_notifications.sql'));\n"+outputAnchor);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const db=await new AsyncFunction('PGlite','readFileSync','assert',setup+'return db;')(PGlite,readFileSync,assert);
const contract=readFileSync('supabase/migrations/20260912140000_workflow_notification_contract.sql','utf8');
const extract=name=>{const index=contract.indexOf(`create or replace function ${name}(`);assert(index>=0);return contract.slice(index,contract.indexOf('$$;',index)+3);};
await db.exec(`alter table auth.users add column phone text;
alter table account_profiles add column phone text;
alter table work_notifications add column event_key text;
alter table work_notifications add column provider_checked_at timestamptz;
alter table work_notifications add column dispatch_token uuid;
alter table work_notifications add column dispatch_started_at timestamptz;
alter table work_notifications add column dispatch_phone text;
alter table work_notifications add column recovery_lease_until timestamptz;
alter table work_notifications add column recovery_token uuid;
alter table work_notifications add column provider_status_at timestamptz;
alter table work_notifications add column whatsapp_delivered_at timestamptz;
alter table work_notifications add column whatsapp_read_at timestamptz;`);
await db.exec(extract('provision_private.work_notification_readable'));
await db.exec('revoke all on function provision_private.work_event_client_notice_required(bigint) from public,anon,authenticated');
if(process.argv[2]){
 const raw=readFileSync(process.argv[2]);
 const snapshot=JSON.parse(raw.toString(raw[0]===255&&raw[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,''));
 for(const row of snapshot.rows){assert(['work_action','work_event_client_notice_required','work_notification_audience_eligible','work_notification_readable'].includes(row.name));assert(row.definition.startsWith('CREATE OR REPLACE FUNCTION '));await db.exec(row.definition);}
}
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async n=>query("select set_config('test.uid',$1,false)",[n?id(n):'']);
const version=async()=>(await query('select version from work_requests where id=$1',[id(10)]))[0].version;
const notifyRequired=async event=>(await query('select provision_private.work_event_client_notice_required($1) value',[event]))[0].value;
const eligible=async(recipient,key)=>(await query('select provision_private.work_notification_audience_eligible($1,$2,$3) value',[id(recipient),key,id(10)]))[0].value;
const historical=(await query("insert into work_events(request_id,part_id,actor,kind,note) values($1,$2,$3,'resolve','قرار داخلي سابق') returning id",[id(10),id(30),id(6)]))[0].id;
const historicKey=`journey:event:${historical}:client`;
await query('insert into provision_private.work_notification_requirements values($1,$2,$3,$4)',[id(1),historicKey,id(10),'client']);
assert.equal(await notifyRequired(historical),true);assert.equal(await eligible(1,historicKey),true);
await db.exec(readFileSync('supabase/migrations/20260918232657_internal_admin_resolution_notifications.sql','utf8'));
assert.equal(await notifyRequired(historical),false);assert.equal(await eligible(1,historicKey),false,'queued historical decision cannot be read or sent to client');
await db.exec(`insert into work_memberships(user_id,service_id) values('${id(7)}','${id(20)}');
insert into auth.users(id,raw_app_meta_data) values('${id(8)}','{"role":"admin"}');
insert into work_grants values('${id(8)}','${id(21)}',true);`);
const why='المهمة ضمن اختصاص الموظف المكلف حسب مراجعة الإدارة';
let next=700;
const reset=async(kind='routing',dependency=null)=>{
 await as(6);
 await query("update work_escalations set status='resolved' where request_id=$1",[id(10)]);
 await query("update work_parts set assignee_id=$2,service_id=$3,status='escalated',accepted_at=now(),due_at=now()+interval '5 days' where id=$1",[id(30),id(2),id(20)]);
 await query('delete from test_notices');
 const escalation=id(next++);
 await query('insert into work_escalations(id,request_id,part_id,kind,reason,dependency_id,opened_by) values($1,$2,$3,$4,$5,$6,$7)',[escalation,id(10),id(30),kind,'سبب داخلي',dependency,id(2)]);
 return escalation;
};
const resolve=async(escalation,decision,extra={})=>query('select work_action($1,$2::jsonb) value',['resolve',JSON.stringify({request_id:id(10),part_id:id(30),version:await version(),escalation_id:escalation,decision,reason:why,...extra})]);
let escalation=await reset();
const before=await version();
for(const actor of [1,2,5,8]){await as(actor);await assert.rejects(()=>resolve(escalation,'reassign',{assignee_id:id(7),service_id:id(20)}),/forbidden/);}
await as(6);await assert.rejects(()=>resolve(escalation,'reassign',{version:0,assignee_id:id(7),service_id:id(20)}),/version_conflict/);
await assert.rejects(()=>resolve(id(999),'keep'),/forbidden/);
await assert.rejects(()=>resolve(escalation,'reassign',{assignee_id:id(1),service_id:id(20)}),/invalid_assignment/);
await assert.rejects(()=>resolve(escalation,'keep',{due_at:'2020-01-01'}),/invalid_due/);
assert.equal(await version(),before);assert.equal((await query('select count(*)::int n from test_notices'))[0].n,0);
await resolve(escalation,'reassign',{assignee_id:id(7),service_id:id(20)});
let notices=await query('select * from test_notices');assert.equal(notices.length,2,'reassignment sends exactly one specific notice to each employee');
assert.equal(notices.find(n=>n.recipient===id(2)).message,'نقلت الإدارة مهمتك إلى موظف آخر\nتوضيح الإدارة '+why);
assert.equal(notices.find(n=>n.recipient===id(7)).message,'كلفتك الإدارة بمهمة جديدة يرجى فتح المهمة واستلامها وتحديد الموعد\nتوضيح الإدارة '+why);
const formatted=outboundNotificationMessage({...notices.find(n=>n.recipient===id(7)),recipient_role:'employee',request_title:'طلب تجريبي',client_name:'عميل تجريبي'});
assert.match(formatted,/كلفتك الإدارة بمهمة جديدة/);assert.match(formatted,/فتح المهمة واستلامها وتحديد الموعد/);assert.match(formatted,/طلب تجريبي/);assert.match(formatted,/عميل تجريبي/);assert.match(formatted,new RegExp('توضيح الإدارة '+why));
let assigned=(await query('select * from work_parts where id=$1',[id(30)]))[0];assert.equal(assigned.assignee_id,id(7));assert.equal(assigned.status,'offered');assert.equal(assigned.accepted_at,null);assert.equal(assigned.due_at,null);
assert.equal(await version(),before+1);await assert.rejects(()=>resolve(escalation,'reassign',{assignee_id:id(7),service_id:id(20)}),/forbidden|invalid_state/);
assert.equal((await query('select count(*)::int n from test_notices'))[0].n,2);
const event=(await query("select id,client_visible,note from work_events where kind='resolve' order by id desc limit 1"))[0];
assert.equal(event.client_visible,false);assert.equal(event.note,why);assert.equal(await notifyRequired(event.id),false);
escalation=await reset('rejection');await resolve(escalation,'keep');
notices=await query('select * from test_notices');assert.equal(notices.length,1);assert.equal(notices[0].recipient,id(2));assert.equal(notices[0].message,'قررت الإدارة استمرارك في تنفيذ المهمة\nتوضيح الإدارة '+why);
assert.equal((await query('select status from work_parts where id=$1',[id(30)]))[0].status,'working');
const dependency=id(next++);
await query("insert into work_dependencies(id,request_id,part_id,upstream_id,reason,status,gate) values($1,$2,$3,$4,$5,'rejected','internal_delivery')",[dependency,id(10),id(30),id(31),'المخرجات المطلوبة']);
for(const decision of ['enforce_dependency','waive_dependency']){
 escalation=await reset('dependency',dependency);
 await query("update work_dependencies set status='rejected' where id=$1",[dependency]);
 await resolve(escalation,decision);
 notices=await query('select * from test_notices');
 const source=notices.find(n=>n.recipient===id(2)&&n.message.startsWith('قررت الإدارة'));
 const upstream=notices.find(n=>n.recipient===id(3)&&n.message.startsWith('قررت الإدارة'));
 assert.equal(source.message,(decision==='enforce_dependency'?'قررت الإدارة إلزام القسم بتوفير المخرجات':'قررت الإدارة متابعة المهمة دون انتظار مخرجات القسم')+'\nتوضيح الإدارة '+why);
 assert.equal(upstream.message,(decision==='enforce_dependency'?'قررت الإدارة إلزامك بتوفير المخرجات المطلوبة للقسم':'قررت الإدارة متابعة مهمة القسم الآخر دون انتظار مخرجاتك')+'\nتوضيح الإدارة '+why);
 assert(!notices.some(n=>n.recipient===id(1)||n.message.includes('صدر قرار الإدارة')));
 assert.equal((await query('select status from work_dependencies where id=$1',[dependency]))[0].status,decision==='enforce_dependency'?'accepted':'waived');
}
// Existing internal-routing suppression and ordinary client journey notices remain intact
for(const [kind,expected] of [['routing',false],['intake',true],['accept',true]]){
 const row=(await query('insert into work_events(request_id,part_id,actor,kind,note) values($1,$2,$3,$4,$5) returning id',[id(10),id(31),id(6),kind,'']))[0];
 const key=`journey:event:${row.id}:client`;
 await query('insert into provision_private.work_notification_requirements values($1,$2,$3,$4)',[id(1),key,id(10),'client']);
 assert.equal(await notifyRequired(row.id),expected);assert.equal(await eligible(1,key),expected);
}
await query('insert into provision_private.work_notification_requirements values($1,$2,$3,$4)',[id(2),'resolve:employee:test',id(10),'employee']);
assert.equal(await eligible(2,'resolve:employee:test'),true,'employee audience remains eligible');
// Execute the same readable and dispatch-claim functions used by production without provider transport
await db.exec(extract('public.work_notification_claim'));
const historicNotification=id(900),employeeNotification=id(901);
await query('insert into work_notifications(id,recipient,request_id,message,event_key) values($1,$2,$3,$4,$5)',[historicNotification,id(1),id(10),'قرار إدارة قديم',historicKey]);
await query('insert into work_notifications(id,recipient,request_id,message,event_key) values($1,$2,$3,$4,$5)',[employeeNotification,id(2),id(10),'قرار الإدارة للموظف','resolve:employee:test']);
await as(1);assert.equal((await query('select provision_private.work_notification_readable($1) value',[historicNotification]))[0].value,false);
await as(2);assert.equal((await query('select provision_private.work_notification_readable($1) value',[employeeNotification]))[0].value,true);
await as(3);assert.equal((await query('select provision_private.work_notification_readable($1) value',[employeeNotification]))[0].value,false);
await as(null);assert.equal((await query('select provision_private.work_notification_readable($1) value',[employeeNotification]))[0].value,false);
const dueEvent=(await query("insert into work_events(request_id,part_id,actor,kind,note) values($1,$2,$3,'due_auto_approved','') returning id",[id(10),id(30),id(6)]))[0].id;
const dueKey=`event:event:${dueEvent}:coordinator`;
await query('insert into provision_private.work_notification_requirements values($1,$2,$3,$4)',[id(2),dueKey,id(10),'employee']);
await query('insert into work_notifications(id,recipient,request_id,message,event_key,whatsapp) values($1,$2,$3,$4,$5,$6)',[id(902),id(2),id(10),'اعتماد موعد',dueKey,'sent']);
await as(2);assert.equal((await query('select provision_private.work_notification_readable($1) value',[id(902)]))[0].value,false,'employee hidden coordinator deadline notices remain hidden');
const claimed=(await query('select work_notification_claim() value'))[0].value;
assert.deepEqual(claimed.map(n=>n.id),[employeeNotification]);
assert.equal((await query('select whatsapp from work_notifications where id=$1',[historicNotification]))[0].whatsapp,'suppressed');
assert.equal((await query('select last_error from work_notifications where id=$1',[historicNotification]))[0].last_error,'audience_no_longer_eligible');
assert.equal((await query("select has_function_privilege('anon','provision_private.work_event_client_notice_required(bigint)','execute') allowed"))[0].allowed,false);
console.log('PASS administrative resolve branches recipients explanations formatter integration authorization rollback versions current and historical client suppression actual dispatch claim employee readable ownership and hidden due guards'+(process.argv[2]?' against production function definitions':''));
await db.close();
