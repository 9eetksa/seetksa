// Actual action functions in isolated PostgreSQL Auth and transport are bounded fixtures
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '../../.tools/sql-check/node_modules/@electric-sql/pglite/dist/index.js';
const source=readFileSync('tests/sql/department-output-tasks.mjs','utf8');
const start=source.indexOf('const db=new PGlite();'),end=source.indexOf('const query=async');assert(start>=0&&end>start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const db=await new AsyncFunction('PGlite','readFileSync','assert',source.slice(start,end)+'return db;')(PGlite,readFileSync,assert);
if(process.argv[2]){
 const batches=readFileSync('supabase/migrations/20260908234000_work_delivery_batches.sql','utf8');
 const position=batches.indexOf('create function provision_private.work_upload_receipt(');assert(position>=0);
 await db.exec(batches.slice(position,batches.indexOf('$$;',position)+3));
 const raw=readFileSync(process.argv[2]);const snapshot=JSON.parse(raw.toString(raw[0]===255&&raw[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,''));
 assert.equal(snapshot.rows.length,1);assert(snapshot.rows[0].definition.startsWith('CREATE OR REPLACE FUNCTION public.work_action('));await db.exec(snapshot.rows[0].definition);
}
await db.exec(readFileSync('supabase/migrations/20260919224609_employee_planner_action_audit.sql','utf8'));
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
const as=async n=>query("select set_config('test.uid',$1,false)",[n?id(n):'']);
const version=async(rid=10)=>(await query('select version from work_requests where id=$1',[id(rid)]))[0].version;
const rows=async(rid=10)=>(await query('select work_planner_moves($1) value',[id(rid)]))[0].value.items;
const invoke=async(action,p)=>(await query('select work_planner_action($1,$2::jsonb) value',[action,JSON.stringify(p)]))[0].value;
const privateNote='ملاحظة كانبان داخلية خاصة لا تعرض للعميل';let nextKey=600;
const payload=async(extra={},rid=10)=>({request_id:id(rid),part_id:id(30),version:await version(rid),submission_key:id(nextKey++),planner_note:privateNote,planner_move:true,...extra});
await as(2);const accept=await payload({due_at:'2027-01-10T20:59:59.999Z'});
for(const who of [null,1,3,5,6]){await as(who);await assert.rejects(()=>invoke('accept',accept),/forbidden/);}
await as(2);await assert.rejects(()=>invoke('accept',{...accept,planner_note:'  '}),/planner_note_required/);
await assert.rejects(()=>invoke('accept',{...accept,planner_note:'س'.repeat(2001)}),/planner_note_required/);
await assert.rejects(()=>invoke('accept',{...accept,version:0}),/version_conflict/);
await assert.rejects(()=>invoke('accept',{...accept,due_at:'2020-01-01'}),/invalid_due/);
await assert.rejects(()=>invoke('resolve',accept),/invalid_action/);
assert.equal((await rows()).length,0);assert.equal(await version(),1);
await db.exec('begin');await query('select work_action($1,$2::jsonb)',['accept',JSON.stringify(accept)]);
const baseline=(await query('select (select count(*)::int from work_events) events,(select count(*)::int from test_notices) notices'))[0];await db.exec('rollback');
const accepted=await invoke('accept',accept);assert.deepEqual(await invoke('accept',accept),accepted);assert.equal(accepted.version,2);
assert.deepEqual((await query('select (select count(*)::int from work_events) events,(select count(*)::int from test_notices) notices'))[0],baseline,'private audit adds no duplicate event or notification');
await assert.rejects(()=>invoke('accept',{...accept,planner_note:'ملاحظة مختلفة'}),/submission_conflict/);
let moves=await rows();assert.equal(moves.length,1);assert.equal(moves[0].note,privateNote);assert.equal(moves[0].status_before,'offered');assert.equal(moves[0].status_after,'working');
assert.equal((await query('select note from work_events where id=$1',[moves[0].event_id]))[0].note,'');
await assert.rejects(async()=>invoke('request_outputs',await payload({outputs:[{service_id:id(21),assignee_id:id(3),reason:'مخرجات إضافية'}]})),/invalid_state/);
await as(1);await assert.rejects(()=>rows(),/forbidden/);
const detail=(await query('select work_request_detail($1) value',[id(10)]))[0].value;assert(!JSON.stringify(detail).includes(privateNote));
await as(3);assert.equal((await rows()).length,0);await as(5);assert.equal((await rows()).length,1);await as(6);assert.equal((await rows()).length,1);
await db.exec(`insert into auth.users(id,raw_app_meta_data) values('${id(8)}','{"role":"admin"}');insert into work_grants values('${id(8)}','${id(21)}',true);`);
await as(8);assert.equal((await rows()).length,0);
// Original file ownership and original delivery receipt semantics remain in the delegated action
await as(2);const path=`${id(10)}/${id(30)}/original.png`;
await query('insert into storage.objects values($1,$2,$3)',['work-files',path,id(2)]);
const delivery=await payload({object_path:path,filename:'الأصل.png',note:'ملاحظة التسليم العامة'});
if(process.argv[2]){
 const second=`${id(10)}/${id(30)}/original-second.png`;await query('insert into storage.objects values($1,$2,$3)',['work-files',second,id(2)]);
 delivery.files=[{object_path:path,filename:'الأصل.png'},{object_path:second,filename:'الأصل الثاني.png'}];
 await assert.rejects(()=>invoke('deliver',{...delivery,files:[]}),/invalid_file/);
}
await assert.rejects(()=>invoke('deliver',{...delivery,files:[{object_path:'foreign/path',filename:'ملف'}],object_path:'foreign/path'}),/invalid_file/);
const delivered=await invoke('deliver',delivery);assert.deepEqual(await invoke('deliver',delivery),delivered);
assert.equal((await query('select count(*)::int n from work_deliveries where part_id=$1',[id(30)]))[0].n,process.argv[2]?2:1);
assert.equal((await rows()).length,2);assert.equal((await rows())[0].status_after,'review');
assert(!(await query('select note from work_deliveries')).some(row=>row.note.includes(privateNote)));
if(process.argv[2]){
 const legacy=(await query('select work_action($1,$2::jsonb) value',['deliver',JSON.stringify(delivery)]))[0].value;
 assert.equal(legacy.batch_id,delivered.batch_id,'existing upload receipt still recovers original batch');
 await assert.rejects(async()=>invoke('deliver',{...delivery,version:await version(),submission_key:id(nextKey++)}),/planner_action_already_applied/);
 assert.equal((await rows()).length,2,'legacy replay cannot fabricate another planner movement');
}
// Missing data uses the same direct-to-client inquiry but keeps planner commentary private
await as(3);const missing=await payload({part_id:id(31),reason:'يرجى إرسال الأبعاد المطلوبة',inquiry_kind:'data'});
const inquiry=await invoke('missing',missing);assert.deepEqual(await invoke('missing',missing),inquiry);
assert.equal((await rows())[0].status_after,'needs_info');await as(1);
const clientDetail=(await query('select work_request_detail($1) value',[id(10)]))[0].value;
assert(JSON.stringify(clientDetail).includes('يرجى إرسال الأبعاد المطلوبة'));assert(!JSON.stringify(clientDetail).includes(privateNote));
await as(2);await db.exec(`update work_services set client_visible=false where id='${id(22)}';
insert into work_parts(id,request_id,service_id,assignee_id,scope,route_position) values('${id(40)}','${id(10)}','${id(22)}','${id(2)}','مهمة قسم داخلي',3);`);
const internalMissing=await payload({part_id:id(40),reason:'يحتاج القسم الداخلي توضيحا'});
await invoke('missing',internalMissing);assert.equal((await rows())[0].action,'missing');
assert.equal((await query('select status from work_parts where id=$1',[id(40)]))[0].status,'needs_info');
assert.equal((await query('select count(*)::int n from provision_private.work_department_inquiries where part_id=$1',[id(40)]))[0].n,0,'hidden department retains existing internal missing-data path');
// An offered task may be accepted while requesting output tasks without inventing a deadline
await as(2);const outputs=await payload({part_id:id(32),outputs:[{service_id:id(21),assignee_id:id(3),reason:'المخرجات المطلوبة'}]},11);
const requested=await invoke('request_outputs',outputs);assert.deepEqual(await invoke('request_outputs',outputs),requested);assert.equal((await rows(11))[0].status_after,'waiting');
const child=(await query('select upstream_id from provision_private.work_output_requests where part_id=$1',[id(32)]))[0].upstream_id;
await as(3);const childAccept=await payload({part_id:child,due_at:'2027-01-11T20:59:59.999Z'},11);await invoke('accept',childAccept);
const childPath=`${id(11)}/${child}/upstream.png`;await query('insert into storage.objects values($1,$2,$3)',['work-files',childPath,id(3)]);
const childDelivery=await payload({part_id:child,files:[{object_path:childPath,filename:'مخرجات أصلية.png'}]},11);
await assert.rejects(()=>invoke('deliver',childDelivery),/output_delivery_required/);
const childDone=await invoke('deliver_outputs',childDelivery);assert.deepEqual(await invoke('deliver_outputs',childDelivery),childDone);
assert.equal((await rows(11))[0].status_after,'internal_done');assert.equal((await query('select count(*)::int n from work_deliveries where part_id=$1',[child]))[0].n,1);
assert(!(await query('select message from test_notices')).some(row=>row.message.includes(privateNote)));
await as(4);await assert.rejects(()=>rows(11),/forbidden/);
assert.equal((await query("select has_function_privilege('anon','public.work_planner_action(text,jsonb)','execute') allowed"))[0].allowed,false);
for(const table of ['work_planner_moves','work_planner_action_receipts']){
 assert.equal((await query(`select has_table_privilege('authenticated','provision_private.${table}','select') allowed`))[0].allowed,false);
 assert.equal((await query(`select relrowsecurity enabled from pg_class where oid='provision_private.${table}'::regclass`))[0].enabled,true);
}
console.log('PASS planner mandatory private notes owner authorization rollback accept missing deliver output acceptance files idempotency original receipt recovery audit visibility and no extra notifications'+(process.argv[2]?' with current production work_action':''));
await db.close();
