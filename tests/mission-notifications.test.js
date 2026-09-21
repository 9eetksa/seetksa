import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationDestination,missionIdFromDestination} from '../src/missions/mission-navigation.js';
import {notificationSummary} from '../supabase/functions/_shared/notification-summary.js';

test('mission notifications route to team missions and retain their action and title',()=>{
 const id='00000000-0000-0000-0000-000000000123';
 const item={mission_id:id,request_id:null,request_title:'تصوير الحملة',message:'تم قبول طلب الانضمام وبانتظار استلام المهمة — تصوير الحملة'};
 assert.equal(notificationDestination(item),`mission:${id}`);
 assert.equal(missionIdFromDestination(notificationDestination(item)),id);
 const summary=notificationSummary(item);
 assert.equal(summary.title,'تصوير الحملة');
 assert.equal(summary.status,'تم قبول طلب الانضمام وبانتظار استلام المهمة');
 assert.equal(summary.kind,'mission');
 assert.equal(summary.clientName,'');
});

test('legacy requests and account notifications keep their destinations',()=>{
 assert.equal(notificationDestination({request_id:'legacy'}),'legacy');
 assert.equal(notificationDestination({request_id:null}),null);
 assert.equal(missionIdFromDestination('legacy'),null);
 assert.equal(missionIdFromDestination('mission:javascript:alert(1)'),null);
});
