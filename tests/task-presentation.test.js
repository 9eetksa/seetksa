import test from 'node:test';
import assert from 'node:assert/strict';
import {personalTaskPresentation as present} from '../src/workflow/task-presentation.js';

const now=Date.parse('2026-09-20T12:00:00Z');
const part={id:'mine',status:'working',accepted_at:'2026-09-19T09:00:00Z',due_at:'2026-09-20T20:59:59.999Z'};

test('task colors follow commitment and real states without changing task data',()=>{
 const original={...part};
 assert.equal(present(part,{now}).tone,'accepted');
 for(const [patch,tone] of [
  [{accepted_at:null},'waiting'],[{due_at:null},'waiting'],[{output_due_required:true},'waiting'],
  [{status:'offered'},'new'],[{status:'waiting'},'waiting'],[{status:'needs_info'},'info'],
  [{status:'revision'},'revision'],[{status:'review'},'review'],[{status:'approved'},'completed'],
 ])assert.equal(present({...part,...patch},{now}).tone,tone);
 assert.deepEqual(part,original);
});

test('overdue color reuses employee deadline rules and excludes pending commitments and client reviews',()=>{
 const late={...part,due_at:'2026-09-19T20:59:59.999Z'};
 assert.equal(present(late,{now}).tone,'overdue');
 assert.equal(present({...late,status:'waiting'},{now}).overdue,true);
 for(const patch of [{output_due_required:true},{client_review_pending:true},{status:'revision'},{accepted_at:null},{due_at:null,requested_due_at:'2020-01-01'}]){
  assert.equal(present({...late,...patch},{now}).overdue,false);
 }
 assert.equal(present({...late,employee_overdue:false},{now}).overdue,false);
});

test('routing and inability colors use only the current task open intervention',()=>{
 const escalated={...part,status:'escalated'};
 const row={id:'alert',part_id:'mine',kind:'routing',status:'open'};
 const context={requestId:'request',now};
 assert.equal(present(escalated,{...context,escalations:[row]}).tone,'routing');
 assert.equal(present(escalated,{...context,escalations:[{...row,kind:'rejection'}]}).tone,'unable');
 for(const patch of [{part_id:'other'},{request_id:'other'},{status:'resolved'}]){
  assert.equal(present(escalated,{...context,escalations:[{...row,...patch}]}).tone,'waiting');
 }
 assert.equal(present(part,{...context,escalations:[row]}).tone,'accepted');
});
