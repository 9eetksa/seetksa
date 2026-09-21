// Isolated PostgreSQL Only fixture notifications are recorded No live writes
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../.tools/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const source=readFileSync('tests/sql/admin-resolution-notifications.mjs','utf8');
const start=source.indexOf('const fixture='),end=source.indexOf('const why=');
assert(start>=0&&end>start);
// That fixture optionally accepts its own unrelated historical snapshot
const setup=source.slice(start,end).replace('if(process.argv[2]){','if(false){');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const db=await new AsyncFunction('PGlite','readFileSync','assert',setup+'return db;')(PGlite,readFileSync,assert);
if(process.argv[2]){
 const live=JSON.parse(readFileSync(process.argv[2],'utf8'));
 await db.exec(live.find(row=>row.name==='work_action').definition);
 // Compile the actual staff projection without requiring unrelated read fixtures
 await db.exec('set check_function_bodies=false');
 await db.exec(live.find(row=>row.name==='work_request_detail').definition);
 await db.exec('set check_function_bodies=true');
}
await db.exec(readFileSync('supabase/migrations/20260920092951_return_kept_task_to_employee.sql','utf8'));
await db.exec(`create or replace function provision_private.work_alert(uuid,uuid,text,text,uuid default null) returns void language sql as $$
 insert into public.work_escalations(request_id,part_id,kind,reason,dependency_id,opened_by) values($1,$2,$3,$4,$5,auth.uid())$$;`);
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async n=>query("select set_config('test.uid',$1,false)",[n?id(n):'']);
const part=async(n=30)=>(await query('select * from work_parts where id=$1',[id(n)]))[0];
const version=async()=>(await query('select version from work_requests where id=$1',[id(10)]))[0].version;
const action=async(name,extra={})=>query('select work_action($1,$2::jsonb) value',[name,JSON.stringify({request_id:id(10),part_id:id(30),version:await version(),reason:'المهمة ضمن اختصاص الموظف',...extra})]);
const escalate=async(n,kind='rejection')=>{
 await query("update work_parts set status='escalated' where id=$1",[id(30)]);
 await query('insert into work_escalations(id,request_id,part_id,kind,reason,opened_by) values($1,$2,$3,$4,$5,$6)',[id(n),id(10),id(30),kind,'سبب التعذر',id(2)]);
};
await as(6);
await query("update work_parts set accepted_at=now(),due_at=now()-interval '1 day' where id=$1",[id(30)]);
await escalate(800);
const decision={escalation_id:id(800),decision:'keep'};
const other=await part(31),before=await version();
for(const actor of [0,1,2,5,8]){await as(actor);await assert.rejects(()=>action('resolve',decision),/forbidden/);}
await as(6);await assert.rejects(()=>action('resolve',{...decision,version:0}),/version_conflict/);
await action('resolve',decision);
let task=await part();
assert.equal(task.assignee_id,id(2));assert.equal(task.status,'offered');assert.equal(task.accepted_at,null);assert.equal(task.due_at,null);assert.equal(task.rejection_blocked_for,id(2));
assert.deepEqual(await part(31),other);assert.equal(await version(),before+1);
const notices=await query('select * from test_notices');
assert.equal(notices.length,1);assert.equal(notices[0].recipient,id(2));assert.match(notices[0].message,/استلامها وتحديد موعد التسليم/);
assert.equal((await query('select status from work_escalations where id=$1',[id(800)]))[0].status,'resolved');
await assert.rejects(()=>action('resolve',decision),/forbidden|invalid_state/);
assert.equal((await query('select count(*)::int n from test_notices'))[0].n,1);
await as(2);await assert.rejects(()=>action('reject'),/task_rejection_locked/);
assert.equal((await part()).status,'offered');
await action('accept',{due_at:'2030-01-01T20:59:59Z'});
assert.equal((await part()).status,'working');assert((await part()).accepted_at);
await assert.rejects(()=>action('reject'),/task_rejection_locked/);
// Another personal assignment retains its original rejection permission
await action('reject',{request_id:id(11),part_id:id(32),version:1});
assert.equal((await part(32)).status,'escalated');
// The independent routing action and reassignment remain available
await action('routing');
const routing=(await query("select id from work_escalations where part_id=$1 and kind='routing' and status='open'",[id(30)]))[0].id;
await as(6);await action('resolve',{escalation_id:routing,decision:'reassign',assignee_id:id(7),service_id:id(20)});
await as(7);await action('reject');assert.equal((await part()).status,'escalated');
// Even an older client cannot force an administrative due date on return
const next=(await query("select id from work_escalations where part_id=$1 and kind='rejection' and status='open'",[id(30)]))[0].id;
await as(6);await action('resolve',{escalation_id:next,decision:'keep',due_at:'2020-01-01'});
assert.equal((await part()).due_at,null);assert.equal((await part()).rejection_blocked_for,id(7));
// Existing dependencies remain and employee acceptance still respects their gate
await query("insert into work_dependencies(request_id,part_id,upstream_id,reason,status,gate) values($1,$2,$3,'المخرجات المطلوبة','accepted','internal_delivery')",[id(10),id(30),id(31)]);
await as(7);await action('accept',{due_at:'2030-01-02T20:59:59Z'});assert.equal((await part()).status,'waiting');
await assert.rejects(()=>action('reject'),/task_rejection_locked/);
// Keeping an overload assignment is unrelated and preserves its active commitment
const waiting=await part();
await as(6);
await query("insert into work_escalations(id,request_id,part_id,kind,reason,opened_by) values($1,$2,$3,'overload','ضغط العمل',$4)",[id(801),id(10),id(30),id(7)]);
await action('resolve',{escalation_id:id(801),decision:'keep'});
assert.deepEqual(await part(),waiting);
const definitions=await query("select pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='work_request_detail'");
for(const {body} of definitions)assert.match(body,/'can_reject',part.rejection_blocked_for is distinct from part.assignee_id/);
assert.equal((await query("select count(*)::int n from work_events where kind='resolve' and client_visible"))[0].n,0);
assert.equal((await query("select count(*)::int n from pg_policies where tablename='work_parts' and cmd in('INSERT','UPDATE','DELETE')"))[0].n,0);
console.log('PASS keep without admin date same employee offered state rejection blocked server side acceptance dependencies reassignment isolation permissions stale versions repeat decision and private projection'+(process.argv[2]?' with current live function definitions':''));
await db.close();
