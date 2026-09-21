import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/workflow/data.js',import.meta.url),'utf8');
const declaration=source.match(/export const call=([^\n]+);/)[1];
const plannerDeclaration=source.match(/const plannerActions=([^\n]+);/)[1];
const createCall=rpc=>Function('supabase','result','controlActions',`const plannerActions=${plannerDeclaration};return ${declaration}`)({rpc},response=>response,new Set(['request_attachments']));

test('direct department requests and replies require the new server endpoint',async()=>{
 const calls=[],call=createCall(async(name,args)=>{calls.push({name,args});return args.p;});
 const request={inquiry_kind:'files',part_id:'own-task',request_id:'own-request',version:3,submission_key:'stable-key'};
 await call('missing',request);await call('reply_department',{inquiry_id:'own-inquiry'});
 assert.deepEqual(calls.map(item=>item.name),['work_department_inquiry_action','work_department_inquiry_action']);
 assert.deepEqual(calls[0].args.p,request);
});
test('an unavailable inquiry migration cannot silently use the old coordinator path',async()=>{
 const calls=[],call=createCall(async name=>{calls.push(name);throw Object.assign(new Error('missing function'),{code:'PGRST202'});});
 await assert.rejects(()=>call('missing',{inquiry_kind:'data'}),{code:'PGRST202'});
 assert.equal(calls.length,1);
});
test('existing internal and coordinator requests keep their original endpoints',async()=>{
 const calls=[],call=createCall(async name=>calls.push(name));
 await call('missing',{});await call('request_attachments',{});await call('supply_info',{});
 assert.deepEqual(calls,['work_action','work_control_action','work_action']);
});

test('client links use the explicit resource endpoint including clearing a saved link and never fall back',async()=>{
 const calls=[],call=createCall(async(name,args)=>{calls.push({name,args});return args.p;});
 for(const action of ['create','submit_request','reply_department']){
  const payload={drive_url:'https://drive.google.com/drive/folders/shared',request_id:'request',inquiry_id:'inquiry',submission_key:'stable',version:3};
  await call(action,payload);
  assert.deepEqual(calls.at(-1),{name:'work_client_resource_action',args:{action,p:payload}});
 }
 await call('submit_request',{drive_url:''});
 assert.equal(calls.at(-1).name,'work_client_resource_action');
 const missing=createCall(async()=>{throw Object.assign(new Error('not installed'),{code:'PGRST202'});});
 await assert.rejects(()=>missing('reply_department',{drive_url:'https://drive.google.com/file/d/id'}),{code:'PGRST202'});
});

test('output task actions use the authorized transactional output endpoint',async()=>{
 const calls=[],call=createCall(async(name,args)=>calls.push({name,args}));
 for(const action of ['request_outputs','deliver_outputs','reject_outputs','commit_output_due'])await call(action,{version:3,submission_key:'stable-output-key'});
 assert.ok(calls.every(item=>item.name==='work_output_action'&&item.args.p.submission_key==='stable-output-key'));
 assert.equal(calls.length,4);
});

test('an administrative deadline override uses its authorized endpoint and stable payload',async()=>{
 const calls=[],call=createCall(async(name,args)=>calls.push({name,args}));
 const p={request_id:'request',part_id:'task',due_at:'2026-09-21T20:59:59.999Z',version:3,submission_key:'stable-key'};
 await call('override_task_due',p);
 assert.deepEqual(calls,[{name:'work_override_task_due',args:{p}}]);
});

test('planner date edits and administrative review use separate authorized RPCs with unchanged snapshots',async()=>{
 const calls=[],call=createCall(async(name,args)=>calls.push({name,args}));
 const p={request_id:'request',part_id:'own-task',expected_due_at:'2026-09-25T20:59:59.999Z',due_at:'2026-09-24T20:59:59.999Z',version:3,submission_key:'stable-key'};
 await call('reschedule_task_due',p);await call('review_task_due_change',p);
 assert.deepEqual(calls,[{name:'work_reschedule_task_due',args:{p}},{name:'work_review_task_due_change',args:{p}}]);
});

test('kanban transitions keep the original action and required private note in the atomic wrapper',async()=>{
 const calls=[],call=createCall(async(name,args)=>calls.push({name,args}));
 const payload={action:'accept',p:{request_id:'request',part_id:'task',version:2,planner_note:'ملاحظة داخلية',submission_key:'move-key'}};
 await call('planner_transition',payload);
 assert.deepEqual(calls,[{name:'work_planner_action',args:payload}]);
});
