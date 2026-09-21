import test from 'node:test';
import assert from 'node:assert/strict';
import {collectTaskPages,completedTaskRows,completedTaskPage} from '../src/workflow/completed-task-pages.js';

test('eleven completed tasks on one request remain eleven rows across next and previous pages',()=>{
 const request={id:'request',priority:'normal'};
 const source={coordinator:true,parts:[],coordinator_tasks:Array.from({length:11},(_,i)=>({task_key:`review:${i}`,request_id:request.id,assignee_id:'self',completed_by:'self',status:'completed',kind:'delivery_review'}))};
 const rows=completedTaskRows(source,[request],'self',true);
 assert.equal(rows.length,11);
 assert.equal(new Set(rows.map(row=>row.rowKey)).size,11);
 const first=completedTaskPage(rows,'all',0),next=completedTaskPage(rows,'all',1);
 assert.equal(first.rows.length,10);assert.equal(first.hasNext,true);
 assert.equal(next.rows.length,1);assert.equal(next.page,1);assert.equal(next.hasNext,false);
 assert.deepEqual(completedTaskPage(rows,'all',next.page-1).rows,first.rows);
 assert.equal(completedTaskPage(rows,'urgent',1).page,0);
 assert.equal(completedTaskPage(rows,'urgent',1).total,0);
});

test('department completions stay personal and do not count multiple files or unfinished parts',()=>{
 const source={services:[{id:'design',name:'التصميم'}],parts:[{id:'own',request_id:'r',service_id:'design',assignee_id:'self',status:'approved'},{id:'other',request_id:'r',assignee_id:'other',status:'approved'},{id:'working',request_id:'r',assignee_id:'self',status:'working'}],coordinator_tasks:[{task_key:'other',request_id:'r',assignee_id:'other',completed_by:'other',status:'completed'}]};
 const rows=completedTaskRows(source,[{id:'r'}],'self',true);
 assert.equal(rows.length,1);assert.equal(rows[0].rowKey,'part:own');
});

test('reads every authorized request page before filtering and propagates fetch failures',async()=>{
 const first={requests:Array.from({length:40},(_,i)=>({id:`r${i}`})),parts:[],coordinator_tasks:[],counts:{completed:1}};
 const pages=[];
 const full=await collectTaskPages(first,async page=>{pages.push(page);return {requests:[{id:'old'}],parts:[],coordinator_tasks:[{task_key:'intake:old',request_id:'old',assignee_id:'self',status:'completed',kind:'intake'}]};});
 assert.deepEqual(pages,[1]);assert.equal(full.requests.length,41);
 assert.equal(completedTaskRows(full,full.requests,'self',true).length,1);
 await assert.rejects(collectTaskPages(first,async()=>{throw new Error('offline');}),/offline/);
 await assert.rejects(collectTaskPages(first,async()=>first),/تعذر/);
});
