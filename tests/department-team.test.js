import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentToDraft,departmentBaseline,departmentDraftFingerprint,changeDepartmentMember,changeDepartmentLead,prepareDepartmentPayload} from '../src/workflow/department-team.js';
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
test('multiple leads use independent checkboxes and remain members',()=>{
 let draft=departmentToDraft({id:a,version:2,members:[{user_id:a,member_role:'lead'}]});
 draft=changeDepartmentLead(draft,b,true);
 assert.deepEqual(draft.lead_user_ids,[a,b]);assert.deepEqual(draft.member_ids,[a,b]);
 assert.deepEqual(departmentToDraft({members:[{user_id:a,member_role:'lead'},{user_id:b,member_role:'lead'}]}).lead_user_ids,[a,b]);
 draft=changeDepartmentLead(draft,a,false);
 assert.deepEqual(draft.member_ids,[a,b]);assert.deepEqual(draft.lead_user_ids,[b]);
 draft=changeDepartmentMember(draft,b,false);
 assert.deepEqual(draft.member_ids,[a]);assert.deepEqual(draft.lead_user_ids,[]);
});
test('legacy unsaved leader survives restoration without changing its expected version',()=>{
 const original={id:a,name:'التصميم',slug:'design',version:3,member_ids:[a,b],lead_user_id:a,responsibilities:['']};
 const baseline=departmentBaseline(JSON.stringify(original));
 assert.equal(baseline,departmentDraftFingerprint(departmentToDraft(original)));
 const dirty=departmentToDraft({...original,lead_user_id:b});
 assert.notEqual(departmentDraftFingerprint(dirty),baseline);assert.equal(dirty.version,3);
});
test('team save ignores hidden settings and validates available members and at least one lead',()=>{
 const draft=departmentToDraft({id:a,name:'التصميم',version:2,member_ids:[a,b],lead_user_ids:[a,b]});
 const staff=[{id:a},{id:b}],result=prepareDepartmentPayload(draft,staff);
 assert.equal(result.valid,true);
 assert.deepEqual(result.payload,{id:a,version:2,member_ids:[a,b],lead_user_ids:[a,b]});
 assert.equal(prepareDepartmentPayload({...draft,lead_user_ids:[]},staff).valid,false);
 assert.equal(prepareDepartmentPayload(draft,[{id:a}]).valid,false);
 const fresh=prepareDepartmentPayload({...draft,id:null,name:'التصميم الجديد',version:null,slug:'department-'+a},staff);
 assert.equal(fresh.valid,true);assert.equal(fresh.payload.name,'التصميم الجديد');
});
