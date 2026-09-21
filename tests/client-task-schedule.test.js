import test from 'node:test';
import assert from 'node:assert/strict';
import {clientSchedule} from '../src/workflow/client-schedule.js';

const accepted='2026-09-19T08:00:00Z';
const due='2026-09-23T20:59:59Z';
const part=(id,status='working',overrides={})=>({id,status,accepted_at:accepted,due_at:due,due_review_status:'approved',...overrides});
const detail=parts=>({request:{status:'active'},parts,routes:parts.map(p=>({id:p.id,service:'التصوير',client_visible:true}))});

test('each assignment keeps its own date even when two assignments share a department',()=>{
 const result=clientSchedule(detail([part('first'),part('second','working',{due_at:'2026-09-25T20:59:59Z'})])).departments;
 assert.equal(result.length,2);
 assert.deepEqual(result.map(p=>p.dueAt),[due,'2026-09-25T20:59:59Z']);
 assert.deepEqual(result.map(p=>p.name),['التصوير','التصوير']);
});

test('a missing-data task does not change another task status or deadline',()=>{
 const result=clientSchedule(detail([part('missing','needs_info'),part('working')])).departments;
 assert.equal(result[0].statusLabel,'يحتاج بيانات إضافية');
 assert.equal(result[1].statusLabel,'استلم المهمة وجار العمل');
 assert.equal(result[1].dueAt,due);
});

test('client never sees an unaccepted or unconfirmed date and sees the replacement date once confirmed',()=>{
 const source=detail([part('offered','offered',{accepted_at:null}),part('pending','working',{due_review_status:'pending'}),part('rejected','working',{due_at:null})]);
 source.due_reviews=[{part_id:'rejected',status:'rejected',replacement_due_at:'2026-09-26T20:59:59Z'}];
 const result=clientSchedule(source).departments;
 assert.deepEqual(result.map(p=>p.dueAt),[null,null,'2026-09-26T20:59:59Z']);
 assert.equal(result[0].state,'unaccepted');
});

test('client output excludes internal task descriptions employees and hidden departments',()=>{
 const source=detail([part('visible','escalated',{scope:'private instructions',assignee_id:'private-person'}),part('hidden')]);
 source.routes[1].client_visible=false;
 const result=clientSchedule(source).departments;
 assert.equal(result.length,1);
 assert.equal(result[0].statusLabel,'المهمة قيد المتابعة');
 assert.doesNotMatch(JSON.stringify(result),/private|scope|assignee|routing/);
});

test('an employee date is visible immediately and an optional administrative replacement becomes authoritative',()=>{
 const source=detail([part('task','working',{due_review_status:'auto_approved'})]);
 assert.equal(clientSchedule(source).departments[0].dueAt,due);
 const replacement='2026-09-27T20:59:59.999Z';
 source.parts[0].due_at=replacement;
 source.due_reviews=[{part_id:'task',status:'rejected',proposed_due_at:due,replacement_due_at:replacement}];
 assert.equal(clientSchedule(source).departments[0].dueAt,replacement);
});
