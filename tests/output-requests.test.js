import test from 'node:test';
import assert from 'node:assert/strict';
import {outputDepartmentChoices,validateOutputSelection} from '../src/workflow/output-requests.js';
const services=[{id:'design',name:'التصميم'},{id:'photo',name:'التصوير'},{id:'content',name:'المحتوى'},{id:'old',active:false}];
const part={id:'task-one',service_id:'design'};
const rows=[{service_id:'photo',reason:'الصور الأصلية للمنتجات'}];
test('admin refusal removes only the refused department from the affected source task',()=>{
 const requests=[{part_id:'task-one',target_service_id:'photo',status:'rejected'},{part_id:'different-task',target_service_id:'content',status:'rejected'}];
 assert.deepEqual(outputDepartmentChoices(services,part,requests).map(row=>row.id),['content']);
 assert.deepEqual(outputDepartmentChoices(services,{...part,id:'another-task'},requests).map(row=>row.id),['photo','content']);
});
test('open output requests are not offered twice and ready requests do not block later work',()=>{
 assert.deepEqual(outputDepartmentChoices(services,part,[{part_id:part.id,target_service_id:'photo',status:'pending'}]).map(row=>row.id),['content']);
 assert.equal(outputDepartmentChoices(services,part,[{part_id:part.id,target_service_id:'photo',status:'ready'}]).length,2);
});
test('department-only requests accept instructions without a recipient and reject invalid selections',()=>{
 const choices=outputDepartmentChoices(services,part);
 assert.equal(validateOutputSelection(rows,choices),'');
 assert.ok(validateOutputSelection(rows,[]));
 assert.ok(validateOutputSelection([{...rows[0],reason:'  '}],choices));
 assert.ok(validateOutputSelection([...rows,...rows],choices));
 assert.ok(validateOutputSelection([],choices));
});
