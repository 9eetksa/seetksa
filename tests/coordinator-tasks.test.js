import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorTasksFor, coordinatorTaskSummary} from '../src/workflow/coordinator-tasks.js';

test('personal coordination work includes own history and available queue without other owners', () => {
  const tasks = [
    {task_key:'own', request_id:'request', assignee_id:'me', status:'open'},
    {task_key:'history', request_id:'request', assignee_id:'other', completed_by:'me', status:'completed'},
    {task_key:'pool', request_id:'request', assignee_id:null, status:'open'},
    {task_key:'other', request_id:'request', assignee_id:'other', status:'open'},
    {task_key:'different', request_id:'different', assignee_id:'me', status:'open'},
  ];
  assert.deepEqual(coordinatorTasksFor({coordinator:true, coordinator_tasks:tasks}, 'request', 'me').map(task=>task.task_key), ['own','history','pool']);
  assert.deepEqual(coordinatorTasksFor({coordinator:false, coordinator_tasks:tasks}, 'request', 'me').map(task=>task.task_key), ['own','history']);
  assert.deepEqual(coordinatorTasksFor({}, 'request', 'me'), []);
});

test('customer waiting does not make a coordinator task overdue', () => {
  const now = Date.parse('2026-09-13T12:00:00Z');
  const intake = {kind:'intake', status:'waiting', due_at:'2026-09-10T00:00:00Z', target_minutes:180, actual_minutes:20};
  const waiting = coordinatorTaskSummary([intake], now);
  assert.equal(waiting.open, true);
  assert.equal(waiting.offered, false);
  assert.equal(waiting.overdue, false);
  assert.equal(waiting.due, Infinity);
  const resumed = coordinatorTaskSummary([{...intake, status:'open', due_at:'2026-09-13T14:40:00Z'}], now);
  assert.equal(resumed.offered, true);
  assert.equal(resumed.due, now + 160 * 60000);
  assert.equal(resumed.overdue, false);
});

test('completed intake does not hide a new review or revision action', () => {
  const intake = {kind:'intake', status:'completed'};
  const review = {kind:'delivery_review', status:'open', target_minutes:180, actual_minutes:200};
  const next = coordinatorTaskSummary([intake, review]);
  assert.equal(next.completed.length, 1);
  assert.equal(next.review, true);
  assert.equal(next.open, true);
  assert.equal(next.overdue, false);
  assert.equal(next.due, Infinity);
  assert.equal(next.nextLabel, 'مراجعة مخرجات القسم');
  const revision = coordinatorTaskSummary([intake, {...review, kind:'revision_review'}]);
  assert.equal(revision.revision, true);
  assert.equal(revision.nextLabel, 'مراجعة تعديل العميل وإحالته');
  assert.equal(coordinatorTaskSummary([intake]).open, false);
});
