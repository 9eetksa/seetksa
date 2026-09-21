export const dashboardTitles={all:'طلبات العملاء',active:'طلبات قيد التنفيذ',intake:'طلبات بانتظار التوجيه',overdue:'المهام المتأخرة',personal_overdue:'مهامي المتأخرة',client_review:'متابعة مراجعة المشرف',client_review_pending:'بانتظار اعتماد المشرف',client_review_overdue:'تأخر العميل في المراجعة',alerts:'تدخلات الإدارة',due_reviews:'مواعيد تحتاج مراجعة',completed:'الطلبات المكتملة'};

// Server projections are authoritative The fallback never uses client requested dates
export function employeeTaskOverdue(part,now=Date.now()){
 if(typeof part.employee_overdue==='boolean')return part.employee_overdue;
 if(!part.accepted_at||part.output_due_required||part.output_cancelled||part.client_review_pending)return false;
 if(!['working','waiting','needs_info','escalated'].includes(part.status))return false;
 return Boolean(part.due_at)&&Number.isFinite(Date.parse(part.due_at))&&Date.parse(part.due_at)<now;
}

export function dashboardBucket(focus,manager,coordinator){
 if(focus==='overdue'&&!manager)return 'personal_overdue';
 if(manager)return Object.hasOwn(dashboardTitles,focus)?focus:'all';
 if(coordinator&&['all','active','intake','completed','client_review','client_review_pending','client_review_overdue'].includes(focus))return focus;
 return null;
}
