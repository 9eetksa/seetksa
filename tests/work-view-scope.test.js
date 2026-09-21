import test from 'node:test';
import assert from 'node:assert/strict';
import {requestsForView,partsForView,departmentProgress,teamFollowupRows} from '../src/workflow/work-view-scope.js';
import {collectTaskPages,completedTaskPage} from '../src/workflow/completed-task-pages.js';

const requests=['shared','department','unrelated','intake','review'].map(id=>({id}));
const parts=[
 {id:'other-stage',request_id:'shared',service_id:'writing',assignee_id:'writer',status:'internal_done',route_position:1},
 {id:'mine',request_id:'shared',service_id:'design',assignee_id:'me',status:'waiting',route_position:2},
 {id:'colleague',request_id:'department',service_id:'design',assignee_id:'colleague',status:'working'},
 {id:'outside',request_id:'unrelated',service_id:'video',assignee_id:'other',status:'working'},
];
const source={requests,parts,lead_services:['design'],coordinator:false,coordinator_tasks:[]};
const ids=rows=>rows.map(row=>row.id);

test('personal list excludes unrelated and colleague requests even if supplied by the server',()=>{
 assert.deepEqual(ids(requestsForView(source,'me','mine')),['shared']);
 assert.deepEqual(ids(requestsForView(source,'me','deliveries')),['shared']);
 assert.deepEqual(ids(requestsForView(source,'me','all')),['shared']);
 assert.deepEqual(ids(requestsForView({...source,parts:[]},'me','mine')),[]);
});
test('department list follows explicit supervision and never grants membership from a task',()=>{
 assert.deepEqual(ids(requestsForView(source,'me','department')),['shared','department']);
 assert.deepEqual(requestsForView({...source,lead_services:[]},'me','department'),[]);
 assert.deepEqual(ids(partsForView(source,'shared','mine','me')),['mine']);
 assert.deepEqual(ids(partsForView(source,'shared','department','me')),['mine']);
});
test('administration and coordinator queues retain their original access and completed credit',()=>{
 assert.equal(requestsForView(source,'admin','all',true),requests);
 const coordination={...source,coordinator:true,coordinator_tasks:[
  {request_id:'intake',assignee_id:null,status:'open'},
  {request_id:'review',assignee_id:'other',completed_by:'me',status:'completed'},
  {request_id:'unrelated',assignee_id:'other',status:'open'},
 ]};
 assert.equal(requestsForView(coordination,'me','all'),requests);
 assert.deepEqual(ids(requestsForView(coordination,'me','mine')),['shared','intake','review']);
});
test('shared request shows ordered department statuses without copying private details',()=>{
 const routes=[{...parts[0],scope:'private',assignee_name:'private',filename:'private'},parts[1]];
 const rows=departmentProgress(routes,[{...parts[1],status:'working'}],[{id:'design',name:'التصميم'},{id:'writing',name:'كتابة المحتوى'}],'me');
 assert.deepEqual(rows.map(row=>[row.name,row.status,row.own,row.department]),[['كتابة المحتوى','internal_done',false,false],['التصميم','working',true,true]]);
 assert.equal(rows.length,2);
 assert.ok(rows.every(row=>!('scope' in row)&&!('assignee_name' in row)&&!('filename' in row)));
 assert.equal(parts[1].status,'waiting');
});

test('coordinator follow-up keeps all active team requests and only department status metadata',()=>{
 const requests=[{id:'shared',status:'active'},{id:'department',status:'active'},{id:'intake',status:'new'},{id:'done',status:'completed'},{id:'no',status:'declined'}];
 const rows=teamFollowupRows({...source,coordinator:true,parts:parts.map(part=>({...part,scope:'private detail'})),services:[{id:'design',name:'التصميم'}]},requests);
 assert.deepEqual(ids(rows),['shared','department']);
 assert.deepEqual(rows[0].departmentStatuses.map(part=>part.status),['internal_done','waiting']);
 assert.equal(rows[1].departmentStatuses[0].name,'التصميم');
 assert.ok(rows.every(row=>row.departmentStatuses.every(part=>!('scope' in part)&&!('assignee_id' in part))));
 assert.deepEqual(teamFollowupRows(source,requests),[]);
});

test('team follow-up finds active requests after the first server page and paginates after filtering',async()=>{
 const first={coordinator:true,requests:Array.from({length:40},(_,id)=>({id,status:'completed'})),parts:[]};
 const later=Array.from({length:11},(_,id)=>({id:`active-${id}`,status:'active',priority:'normal'}));
 const combined=await collectTaskPages(first,async page=>{assert.equal(page,1);return {requests:later,parts:[]};});
 const rows=teamFollowupRows(combined,combined.requests);
 assert.equal(rows.length,11);
 assert.equal(completedTaskPage(rows,'all',0).rows.length,10);
 assert.equal(completedTaskPage(rows,'all',0).hasNext,true);
 assert.equal(completedTaskPage(rows,'all',1).rows[0].id,'active-10');
 assert.equal(completedTaskPage(rows,'all',1).hasNext,false);
});
