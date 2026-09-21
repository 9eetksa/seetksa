import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarDays,shiftMonth,plannerStage,workloadGroups,timelineSpan} from '../src/workflow/planner-views.js';

test('Gregorian month grid has42Sunday-first cells including leap day and adjacent months',()=>{
 const cells=calendarDays('2024-02');
 assert.equal(cells.length,42);assert.deepEqual(cells[0],{date:'2024-01-28',inMonth:false});
 assert.deepEqual(cells.at(-1),{date:'2024-03-09',inMonth:false});
 assert.equal(cells.filter(day=>day.inMonth).length,29);assert.equal(new Set(cells.map(day=>day.date)).size,42);
 assert.deepEqual(calendarDays('2026-03')[0],{date:'2026-03-01',inMonth:true});
 assert.throws(()=>calendarDays('2026-13'),RangeError);
});

test('month navigation crosses years without day overflow',()=>{
 assert.equal(shiftMonth('2026-12',1),'2027-01');assert.equal(shiftMonth('2026-01',-1),'2025-12');
 assert.equal(shiftMonth('2024-02',12),'2025-02');assert.throws(()=>shiftMonth('2026-01',0.5),RangeError);
});

test('lateness remains a signal while actual task state determines the kanban stage',()=>{
 assert.equal(plannerStage({status:'working',bucket:'overdue'}),'active');
 assert.equal(plannerStage({status:'needs_info',bucket:'overdue'}),'waiting');
 assert.equal(plannerStage({status:'review',bucket:'overdue'}),'review');
 assert.equal(plannerStage({status:'working',bucket:'accepted',output_due_required:true}),'waiting');
 assert.equal(plannerStage({status:'offered'}),'new');assert.equal(plannerStage({status:'internal_done'}),'completed');
 assert.equal(plannerStage({bucket:'accepted'}),'active');
});

test('department workload counts actual tasks without client preference deadlines or mutation',()=>{
 const tasks=[
  {department:'التصوير',status:'working',bucket:'overdue',due_at:'2026-09-01'},
  {department:'التصوير',status:'needs_info',bucket:'waiting',employee_overdue:false,requested_due_at:'2026-01-01'},
  {department:'التصوير',status:'approved',bucket:'completed',due_at:'2026-09-01'},
  {department:'التصميم',status:'offered',bucket:'new'},
 ];
 const before=JSON.stringify(tasks),groups=workloadGroups(tasks);
 assert.deepEqual(groups.find(group=>group.department==='التصوير'),{department:'التصوير',total:3,active:2,overdue:1,undated:1});
 assert.deepEqual(groups.find(group=>group.department==='التصميم'),{department:'التصميم',total:1,active:1,overdue:0,undated:1});
 assert.equal(JSON.stringify(tasks),before);
});

test('timeline clips real accepted work to inclusive days and preserves missing starts as deadline points',()=>{
 assert.deepEqual(timelineSpan({accepted_at:'2026-09-01',due_at:'2026-09-30'},'2026-09-10','2026-09-19'),{start:'2026-09-10',end:'2026-09-19',left:0,width:100});
 assert.deepEqual(timelineSpan({accepted_at:'2026-09-11T22:00:00Z',due_at:'2026-09-14T20:59:59.999Z'},'2026-09-10','2026-09-19'),{start:'2026-09-12',end:'2026-09-14',left:20,width:30});
 assert.deepEqual(timelineSpan({due_at:'2026-09-15'},'2026-09-10','2026-09-19'),{start:'2026-09-15',end:'2026-09-15',left:50,width:0});
 assert.equal(timelineSpan({accepted_at:'2026-09-01',requested_due_at:'2026-09-15'},'2026-09-10','2026-09-19'),null);
 assert.equal(timelineSpan({accepted_at:'2026-09-01',due_at:'2026-09-09'},'2026-09-10','2026-09-19'),null);
 assert.equal(timelineSpan({accepted_at:'2026-09-16',due_at:'2026-09-15'},'2026-09-10','2026-09-19'),null);
});
