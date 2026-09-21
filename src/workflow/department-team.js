const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ids=values=>[...new Set((values||[]).map(value=>String(value).trim()).filter(Boolean))];

export function departmentToDraft(department={}){
 const members=department.members||[];
 const leads=ids(Array.isArray(department.lead_user_ids)?department.lead_user_ids:
  Object.hasOwn(department,'lead_user_id')?[department.lead_user_id||'']:members.filter(member=>member.member_role==='lead').map(member=>member.user_id));
 return {id:department.id||null,name:department.name||'',slug:department.slug||'',version:department.version??null,
  member_ids:ids([...(department.member_ids||members.map(member=>member.user_id)),...leads]),lead_user_ids:leads};
}
export function createDepartmentDraft(){return departmentToDraft({slug:'department-'+crypto.randomUUID()});}
export function departmentDraftFingerprint(value){
 const draft=departmentToDraft(value);
 return JSON.stringify({...draft,member_ids:[...draft.member_ids].sort(),lead_user_ids:[...draft.lead_user_ids].sort()});
}
// Old session drafts used one lead and included settings that this form no longer edits
export function departmentBaseline(value){
 try{return departmentDraftFingerprint(JSON.parse(value));}catch{return value||'';}
}
export function changeDepartmentMember(draft,id,checked){
 return {...draft,member_ids:checked?ids([...draft.member_ids,id]):draft.member_ids.filter(value=>value!==id),
  lead_user_ids:checked?draft.lead_user_ids:draft.lead_user_ids.filter(value=>value!==id)};
}
export function changeDepartmentLead(draft,id,checked){
 return {...draft,member_ids:checked?ids([...draft.member_ids,id]):draft.member_ids,
  lead_user_ids:checked?ids([...draft.lead_user_ids,id]):draft.lead_user_ids.filter(value=>value!==id)};
}
export function prepareDepartmentPayload(draft,staff){
 const errors={},members=draft.member_ids,leads=draft.lead_user_ids;
 const eligible=new Set(staff.map(person=>String(person.id??person.user_id)));
 if(!draft.id&&(draft.name.trim().length<2||draft.name.trim().length>100))errors.name='أدخل اسم القسم من حرفين إلى 100 حرف';
 if(!members.length||members.length>200||members.some(id=>!UUID.test(id)||!eligible.has(id)))errors.members='اختر أعضاء القسم من الموظفين المتاحين';
 if(!leads.length||leads.some(id=>!members.includes(id)))errors.lead_user_ids='اختر مسؤولا واحدا على الأقل من أعضاء القسم';
 return {valid:!Object.keys(errors).length,errors,payload:{id:draft.id,version:draft.version,
  ...(!draft.id?{name:draft.name.trim(),slug:draft.slug}:{}),member_ids:members,lead_user_ids:leads}};
}
