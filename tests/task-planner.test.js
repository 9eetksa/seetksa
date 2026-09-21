import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleChange,scheduleGroups,collectPlannerTasks,plannerMoveAction} from '../src/workflow/task-planner.js';
const now=Date.parse('2026-09-20T09:00:00Z'),task={due_at:'2026-09-25T20:59:59.999Z'};

test('earlier deadlines commit at Riyadh end of day while later dates request approval',()=>{
 assert.deepEqual(scheduleChange(task,'2026-09-22',now),{due:'2026-09-22T20:59:59.999Z',later:false});
 assert.deepEqual(scheduleChange(task,'2026-09-26',now),{due:'2026-09-26T20:59:59.999Z',later:true});
 assert.ok(scheduleChange(task,'2026-09-25',now).error);
 assert.ok(scheduleChange(task,'2026-09-19',now).error);
 assert.ok(scheduleChange(task,'2026-02-30',now).error);
 assert.ok(scheduleChange(task,'2028-09-20',now).error);
 assert.equal(scheduleChange(task,'2028-09-19',now).later,true);
 assert.equal(scheduleChange(task,'2026-09-20',now).later,false);
});
test('admin deadlines may be postponed for review but cannot be advanced by the employee',()=>{
 const locked={...task,due_locked_by_admin:true};
 assert.ok(scheduleChange(locked,'2026-09-22',now).error);
 assert.equal(scheduleChange(locked,'2026-09-26',now).later,true);
 const overdue={due_at:'2026-09-19T20:59:59.999Z'};
 assert.equal(scheduleChange(overdue,'2026-09-20',now).later,true);
});
test('agenda groups by effective Riyadh day and preserves distinct tasks sharing one request',()=>{
 const rows=[{part_id:'a',request_id:'request',due_at:'2026-09-20T20:59:59.999Z'},
  {part_id:'b',request_id:'request',due_at:'2026-09-20T21:00:00Z'},
  {part_id:'c',due_at:null,requested_due_at:'2026-09-18T00:00:00Z'},
  {part_id:'d',due_at:'2026-09-20T13:00:00Z'}];
 const groups=scheduleGroups(rows);
 assert.deepEqual(groups.map(([day,tasks])=>[day,tasks.map(row=>row.part_id)]),[['2026-09-20',['a','d']],['2026-09-21',['b']],['undated',['c']]]);
 assert.equal(rows.length,4);
});

test('view data includes every authorized page and rejects incomplete changing snapshots',async()=>{
 const items=Array.from({length:83},(_,i)=>({part_id:String(i),request_id:'same-request'})),seen=[];
 const result=await collectPlannerTasks(async page=>{seen.push(page);return {items:items.slice(page*40,(page+1)*40),total:83,has_next:page<2,counts:{all:83}};});
 assert.deepEqual(seen,[0,1,2]);assert.equal(result.items.length,83);assert.equal(result.counts.all,83);
 await assert.rejects(()=>collectPlannerTasks(async()=>({items:items.slice(0,40),total:83,has_next:true})),/planner_snapshot_changed/);
 await assert.rejects(()=>collectPlannerTasks(async()=>({items:[],total:2,has_next:false})),/planner_snapshot_changed/);
 let reads=0;assert.equal(await collectPlannerTasks(async()=>{reads++;return {items:[],total:0,has_next:false};},()=>false),null);assert.equal(reads,1);
});

test('kanban transfers select existing authorized actions rather than directly changing status',()=>{
 assert.equal(plannerMoveAction({status:'offered'},'active'),'accept');
 assert.equal(plannerMoveAction({status:'working'},'review'),'deliver');
 assert.equal(plannerMoveAction({status:'working',output_parent_id:'source'},'completed'),'deliver_outputs');
 assert.equal(plannerMoveAction({status:'working',output_parent_id:'source'},'review'),null);
 assert.equal(plannerMoveAction({status:'working'},'waiting'),'missing');
 for(const task of [{status:'review'},{status:'approved'},{status:'working',client_review_pending:true},{status:'working',output_due_required:true}])assert.equal(plannerMoveAction(task,'review'),null);
 assert.equal(plannerMoveAction({status:'working'},'completed'),null);
 assert.equal(plannerMoveAction({status:'working'},'overdue'),null);
 assert.equal(plannerMoveAction({status:'waiting',accepted_at:'2026-09-20'},'active'),null);
});
