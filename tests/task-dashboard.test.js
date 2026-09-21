import test from 'node:test';
import assert from 'node:assert/strict';
import {employeeTaskOverdue,dashboardBucket} from '../src/workflow/task-dashboard.js';
const end=Date.parse('2026-09-20T20:59:59.999Z');
const part={accepted_at:'2026-09-19T09:00:00Z',status:'working',due_at:new Date(end).toISOString()};
test('employee deadline counts only after the end of the selected Riyadh day',()=>{
 assert.equal(employeeTaskOverdue(part,end-1),false);
 assert.equal(employeeTaskOverdue(part,end),false);
 assert.equal(employeeTaskOverdue(part,end+1),true);
 assert.equal(employeeTaskOverdue({...part,due_at:null,requested_due_at:'2020-01-01'},end),false);
});
test('client review and unaccepted revisions do not count against the employee',()=>{
 for(const patch of [{client_review_pending:true},{status:'review'},{status:'revision'},{status:'offered'},{accepted_at:null},{output_due_required:true},{status:'approved'}])assert.equal(employeeTaskOverdue({...part,...patch},end+1),false);
 assert.equal(employeeTaskOverdue({...part,status:'review',employee_overdue:true},end+1),true);
 assert.equal(employeeTaskOverdue({...part,due_at:'2026-09-21T20:59:59.999Z'},end+1),false);
});
test('personal overdue never selects the team overdue endpoint for employees or coordinators',()=>{
 assert.equal(dashboardBucket('overdue',false,false),'personal_overdue');
 assert.equal(dashboardBucket('overdue',false,true),'personal_overdue');
 assert.equal(dashboardBucket('overdue',true,false),'overdue');
 assert.equal(dashboardBucket('client_review',false,false),null);
 assert.equal(dashboardBucket('client_review',false,true),'client_review');
 assert.equal(dashboardBucket('open',false,true),null);
});
