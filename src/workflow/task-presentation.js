import {employeeTaskOverdue} from './task-dashboard.js';
import {openRequestInterventions} from './request-interventions.js';

// Display only Keep actions and eligibility in their existing workflow
export function personalTaskPresentation(part,{requestId,escalations=[],outputRequests=[],now=Date.now()}={}){
 const overdue=employeeTaskOverdue(part,now);
 const result=(tone,label=null)=>({tone,label,overdue});
 if(part.status==='escalated'){
  const open=openRequestInterventions(escalations,requestId).filter(row=>row.part_id===part.id);
  if(open.some(row=>row.kind==='routing'))return result('routing','خطأ في الإحالة بانتظار قرار الإدارة');
  if(open.some(row=>row.kind==='rejection'))return result('unable','تعذر التنفيذ بانتظار قرار الإدارة');
  if(open.some(row=>row.kind==='scope'))return result('revision','تعديلات خارج النطاق بانتظار قرار الإدارة');
  return result(overdue?'overdue':'waiting');
 }
 if(outputRequests.some(row=>row.upstream_id===part.id&&row.status==='rejected'))return result('unable');
 if(overdue)return result('overdue');
 if(part.output_due_required&&part.status==='working')return result('waiting');
 if(part.status==='working')return part.accepted_at&&part.due_at?result('accepted','مقبولة وموعدها محدد'):result('waiting');
 const tones={offered:'new',waiting:'waiting',needs_info:'info',revision:'revision',review:'review',approved:'completed',forwarded:'completed',internal_done:'completed'};
 return result(tones[part.status]||'neutral');
}
