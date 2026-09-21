import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationSummary} from '../supabase/functions/_shared/notification-summary.js';
import {outboundNotificationMessage} from '../supabase/functions/_shared/notification-message.js';

test('planner proposals and administrative decisions retain their distinct Arabic date and remain internal',()=>{
 const lines=[
  'طلب موظف قسم التصوير تأجيل موعد التسليم إلى ٢٥ سبتمبر ٢٠٢٦',
  'وافقت الإدارة على تأجيل موعد تسليم مهمتك إلى ٢٥ سبتمبر ٢٠٢٦',
  'رفضت الإدارة تأجيل موعد تسليم مهمتك ويظل الموعد ٢٣ سبتمبر ٢٠٢٦',
  'رفضت الإدارة طلب تأجيل موعد تسليم مهمتك',
  'قدم الموظف موعد تسليم قسم التصوير إلى ٢١ سبتمبر ٢٠٢٦',
 ];
 for(const line of lines){
  const item={message:line,recipient_role:'employee',request_title:'طلب تجريبي',client_name:'عميل تجريبي'};
  assert.equal(notificationSummary(item).status,line);
  assert.match(outboundNotificationMessage(item),new RegExp('^'+line));
  assert.equal(outboundNotificationMessage({...item,recipient_role:'client'}),'طلبكم قيد المتابعة لدى الفريق');
 }
});
test('confirmed client dates never reuse proposed or internal explanations',()=>{
 for(const message of ['تم تقديم موعد تسليم قسم التصوير إلى ٢١ سبتمبر ٢٠٢٦','تحدث موعد تسليم قسم التصوير إلى ٢٥ سبتمبر ٢٠٢٦']){
  assert.equal(outboundNotificationMessage({message:message+'\nسبب داخلي لا ينشر',recipient_role:'client'}),message);
 }
 const action='وافقت الإدارة على تأجيل موعد تسليم مهمتك إلى ٢٥ سبتمبر ٢٠٢٦';
 const formatted=outboundNotificationMessage({recipient_role:'employee',message:action+'\nتوضيح الإدارة نحتاج مراجعة أخيرة https://private.test TOKEN_ABC',request_title:'طلب تجريبي'});
 assert.match(formatted,/توضيح الإدارة نحتاج مراجعة أخيرة/);assert.doesNotMatch(formatted,/[A-Za-z@/:]/);
});
test('known management envelopes preserve the authored deadline action only',()=>{
 const action='طلب موظف قسم التصوير تأجيل موعد التسليم إلى ٢٥ سبتمبر ٢٠٢٦';
 const item={recipient_role:'admin',message:`تحديث رقابي على الطلب\nالإجراء ${action}\nعنوان الطلب طلب تجريبي\nالعميل عميل تجريبي\nتفاصيل الإجراء\nملاحظة داخلية خاصة`};
 assert.match(outboundNotificationMessage(item),new RegExp('^'+action));assert.doesNotMatch(outboundNotificationMessage(item),/ملاحظة داخلية/);
});
