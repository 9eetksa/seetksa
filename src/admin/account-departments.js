import {supabase} from '../auth/supabase';

export const isStaffAccount=user=>['employee','admin','super_admin'].includes(user.role);

export async function loadAccountDepartments(accounts){
 const staff=accounts.filter(isStaffAccount);
 if(!staff.length)return {};
 // One bounded read for this directory page using the caller's existing RLS access
 const {data,error}=await supabase.from('work_staff')
  .select('user_id,coordinator,departments:work_memberships(member_role,department:work_services(id,name))')
  .in('user_id',staff.map(user=>user.id));
 if(error)throw error;
 const byId=new Map((data||[]).map(person=>[person.user_id,person]));
 return Object.fromEntries(staff.map(user=>{
  const person=byId.get(user.id);
  const departments=(person?.departments||[]).map(membership=>{
   if(!membership.department?.name)throw new Error('department_unavailable');
   return {...membership.department,responsible:membership.member_role==='lead'};
  }).sort((a,b)=>Number(b.responsible)-Number(a.responsible)||a.name.localeCompare(b.name,'ar'));
  // Exact legacy job title is a display fallback only and grants no authority
  const coordinator=person?.coordinator===true||user.job_title?.trim()==='المشرف المسؤول';
  if(coordinator&&!departments.some(department=>department.name.trim()==='الإشراف على الطلبات'))
   departments.push({id:'customer-communication',name:'الإشراف على الطلبات',responsible:false});
  return [user.id,departments];
 }));
}
