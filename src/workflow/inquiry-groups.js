export const isCoordinatorInquiry=item=>item.source==='coordinator';
export function inquiryGroups(inquiries=[]){
 const department=inquiries.filter(item=>!isCoordinatorInquiry(item)&&item.source!=='internal');
 return [
  {key:'internal',label:'توضيحات المشرف المسؤول',rows:inquiries.filter(item=>item.source==='internal')},
  {key:'coordinator',label:'طلبات المشرف المسؤول',rows:inquiries.filter(isCoordinatorInquiry)},
  {key:'files',label:'مرفقات طلبتها الأقسام',rows:department.filter(item=>item.kind==='files')},
  {key:'data',label:'بيانات طلبتها الأقسام',rows:department.filter(item=>item.kind==='data')},
 ].filter(group=>group.rows.length).map(group=>({...group,
  answered:group.rows.filter(item=>item.answered_at).length,
  pending:group.rows.filter(item=>item.source!=='internal'&&!item.answered_at&&!item.closed).length,
 }));
}
export function selectedInquiries(inquiries=[],selection){
 if(selection.id)return inquiries.filter(item=>item.id===selection.id);
 return inquiryGroups(inquiries).find(group=>group.key===selection.kind)?.rows||[];
}
