// Isolated PostgreSQL No live request changes or notification delivery
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../.tools/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const fixture=readFileSync('tests/sql/routing-decision-feedback.mjs','utf8');
const start=fixture.indexOf('const source='),end=fixture.indexOf('const version=');
assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const db=await new AsyncFunction('PGlite','readFileSync','assert',fixture.slice(start,end)+'return db;')(PGlite,readFileSync,assert);
await db.exec(readFileSync('supabase/migrations/20260920100037_lock_confirmed_task_routing.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/20260920100438_preserve_confirmed_routing_after_other_decisions.sql','utf8'));
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async n=>query("select set_config('test.uid',$1,false)",[n?id(n):'']);
const version=async()=>(await query('select version from work_requests where id=$1',[id(10)]))[0].version;
const action=async(name,extra={})=>query('select work_action($1,$2::jsonb) value',[name,JSON.stringify({request_id:id(10),part_id:id(30),version:await version(),reason:'قرار الإدارة للمهمة',...extra})]);
const locked=async n=>(await query('select provision_private.work_task_routing_locked($1) value',[id(n)]))[0].value;
const currentIssue=async()=>(await query("select id from work_escalations where part_id=$1 and kind='routing' and status='open' order by created_at desc limit 1",[id(30)]))[0].id;
await as(2);assert.equal(await locked(30),false);await action('routing');
let issue=await currentIssue();
await as(6);await action('resolve',{escalation_id:issue,decision:'keep'});
assert.equal(await locked(30),true);assert.equal(await locked(32),false);
const before=await version();
await as(2);await assert.rejects(()=>action('routing'),/task_routing_locked/);assert.equal(await version(),before);
// Legacy keep remains recognizable even when it predates the detailed routing ledger
await query('delete from provision_private.work_routing_decisions where escalation_id=$1',[issue]);
assert.equal(await locked(30),true);
await action('accept',{due_at:'2030-01-01T20:59:59Z'});
await as(6);
await query("insert into work_escalations(id,request_id,part_id,kind,reason,opened_by) values($1,$2,$3,'overload','متابعة ضغط العمل',$4)",[id(852),id(10),id(30),id(6)]);
await action('resolve',{escalation_id:id(852),decision:'keep'});
assert.equal(await locked(30),true,'an unrelated administrative decision cannot undo confirmed routing');
await as(2);
await assert.rejects(()=>action('routing'),/task_routing_locked/);
await assert.rejects(()=>action('reject'),/task_rejection_locked/);
await action('routing',{request_id:id(11),part_id:id(32),version:1});
// Administration can still move the assignment to a different department
const administrativeMove=async(employee,service,key)=>{
 await as(6);
 await query("insert into work_escalations(id,request_id,part_id,kind,reason,opened_by) values($1,$2,$3,'overload','قرار توزيع المهمة',$4)",[id(key),id(10),id(30),id(6)]);
 await action('resolve',{escalation_id:id(key),decision:'reassign',assignee_id:id(employee),service_id:id(service)});
};
await administrativeMove(3,21,850);assert.equal(await locked(30),false);
await as(3);await action('routing');issue=await currentIssue();
await query('insert into work_memberships(user_id,service_id) values($1,$2)',[id(7),id(21)]);
await as(6);await action('resolve',{escalation_id:issue,decision:'reassign',assignee_id:id(7),service_id:id(21)});
assert.equal(await locked(30),true,'same department stays confirmed for the new employee');
await as(7);await assert.rejects(()=>action('routing'),/task_routing_locked/);
assert.equal((await query('select penalty_points from provision_private.work_routing_decisions where escalation_id=$1',[issue]))[0].penalty_points,0);
// A later different-department assignment must not inherit the old employee flag
await query('insert into work_memberships(user_id,service_id) values($1,$2)',[id(2),id(22)]);
await administrativeMove(2,22,851);assert.equal(await locked(30),false);
await as(2);await action('routing');
await as(1);await assert.rejects(()=>action('routing'),/forbidden/);
const definition=(await query("select pg_get_functiondef('public.work_request_detail(uuid,boolean)'::regprocedure) body"))[0].body;
assert.match(definition,/'can_report_routing',not provision_private.work_task_routing_locked\(part.id\)/);
assert.equal((await query("select has_function_privilege('authenticated','provision_private.work_task_routing_locked(uuid)','execute') allowed"))[0].allowed,false);
console.log('PASS confirmed same employee and same department routing lock legacy keep server rejection unchanged other tasks new departments no penalty client authorization and private staff projection');
await db.close();
