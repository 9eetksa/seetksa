import test from 'node:test';
import assert from 'node:assert/strict';
import {requestHistoryContext} from '../src/workflow/request-history.js';

const data={events:[{id:20,part_id:'design'},{id:21,part_id:'video'}],parts:[{id:'design',service_id:'s1',scope:'تصميم الحملة'},{id:'video',service_id:'s2',scope:'مونتاج الفيديو'}],routes:[{id:'design',service:'التصميم'},{id:'video',service:'الإنتاج'}]};
test('matches audit events to their exact department and task rather than the request default',()=>{
 assert.deepEqual(requestHistoryContext({id:'21'},data),{department:'الإنتاج',scope:'مونتاج الفيديو',hasPart:true});
 assert.equal(requestHistoryContext({id:20},data).scope,'تصميم الحملة');
});
test('does not infer missing historical links or read another department scope from routes',()=>{
 assert.deepEqual(requestHistoryContext({id:99},data),{department:'',scope:'',hasPart:false});
 assert.deepEqual(requestHistoryContext({id:21},{...data,parts:[],routes:[{id:'video',service:'الإنتاج',scope:'محتوى غير مخول'}]}),{department:'الإنتاج',scope:'',hasPart:true});
});
test('direct part links resolve service names and absent task descriptions stay empty',()=>{
 assert.deepEqual(requestHistoryContext({part_id:'p'},{parts:[{id:'p',service_id:'s'}],services:[{id:'s',name:'التصميم'}]}),{department:'التصميم',scope:'',hasPart:true});
});
