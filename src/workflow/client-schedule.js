import {riyadhDate} from '../shared/date-only.js';

const confirmedStatuses=new Set(['approved','auto_approved','rejected']);
const reviewTime=review=>Date.parse(review.proposed_at||review.created_at||review.reviewed_at||'')||0;

// Only consume the existing client-safe detail response and its visible departments
export function clientSchedule(detail){
 const request=detail.request||{},routes=detail.routes||[];
 const reviews=detail.due_reviews||detail.control?.due_reviews||[];
 const sent=(detail.events||[]).filter(event=>event.kind==='submit_request'||event.kind==='create')
  .sort((left,right)=>(Date.parse(left.created_at)||0)-(Date.parse(right.created_at)||0));
 const submittedAt=request.status==='draft'?null:request.submitted_at||sent.find(event=>event.kind==='submit_request')?.created_at||sent.find(event=>event.kind==='create')?.created_at||null;
 const departments=(detail.parts||[]).map(part=>{
  const route=routes.find(item=>item.id===part.id);
  if(!route||route.client_visible===false)return null;
  const review=reviews.filter(item=>item.part_id===part.id).sort((left,right)=>reviewTime(right)-reviewTime(left))[0];
  const accepted=Boolean(part.accepted_at)&&part.status!=='offered';
  const confirmed=accepted&&confirmedStatuses.has(review?.status||part.due_review_status);
  const effective=part.due_at||review?.effective_due_at||review?.replacement_due_at||review?.proposed_due_at;
  return {id:part.id,name:(route.service||'القسم المكلف').trim(),position:part.route_position??route.route_position??0,
   dueAt:confirmed&&effective&&riyadhDate(effective)?effective:null,
   state:accepted?'pending':'unaccepted',status:part.status,
   statusLabel:part.status==='needs_info'?'يحتاج بيانات إضافية':part.status==='offered'?'بانتظار استلام المهمة':part.status==='working'?'استلم المهمة وجار العمل':part.status==='waiting'?'المهمة بانتظار المخرجات':part.status==='escalated'?'المهمة قيد المتابعة':part.status==='revision'?'التعديل قيد المتابعة':['review','forwarded','internal_done','approved'].includes(part.status)?'تم تسليم المهمة':'المهمة قيد المتابعة'};
 }).filter(Boolean).sort((left,right)=>left.position-right.position);
 return {submittedAt,departments};
}
