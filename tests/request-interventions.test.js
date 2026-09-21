import test from 'node:test';
import assert from 'node:assert/strict';
import {openRequestInterventions} from '../src/workflow/request-interventions.js';

test('request detail interventions remain actionable when the scoped RPC omits request_id',()=>{
 const intervention={id:'alert',part_id:'task',kind:'routing',status:'open',reason:'القسم غير مناسب'};
 assert.deepEqual(openRequestInterventions([intervention],'request'),[intervention]);
});

test('resolved interventions and explicit rows belonging to another request are excluded',()=>{
 const rows=[{id:'own',request_id:'request',status:'open'},{id:'other',request_id:'different',status:'open'},{id:'resolved',status:'resolved'},{id:'incomplete'}];
 assert.deepEqual(openRequestInterventions(rows,'request').map(row=>row.id),['own']);
 assert.deepEqual(openRequestInterventions(undefined,'request'),[]);
});
