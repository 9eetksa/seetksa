import {createHmac,randomInt,randomUUID} from 'node:crypto';
import {normalizePhone} from '../src/auth/account-rules.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function clientAccountService(admin,env,transport=fetch){
 const checked=async query=>{const {data,error}=await query;if(error)throw fail(502,'تعذر حفظ بيانات الحساب حاول مجددا');return data;};
 function sessionId(token){
  // The caller already verified this JWT with Auth getUser
  try{const value=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).session_id;if(uuid.test(value))return value;}catch{}
  throw fail(401,'سجل الدخول مجددا للمتابعة');
 }
 function ready(user,role){
  if(user.app_metadata?.role!==role||user.app_metadata?.must_change_password||user.is_anonymous||Date.parse(user.banned_until||'')>Date.now())throw fail(403,'لا تملك صلاحية هذا الإجراء');
 }
 function otpHash(id,user,phone,code){
  if(!/^[a-f0-9]{64}$/i.test(env.ONBOARDING_ENCRYPTION_KEY||''))throw fail(503,'التحقق من الجوال غير متاح حاليا');
  return createHmac('sha256',Buffer.from(env.ONBOARDING_ENCRYPTION_KEY,'hex')).update(`client-phone-v1|${id}|${user}|${phone}|${code}`).digest('hex');
 }
 return async(input,user,token)=>{
  const session=sessionId(token);
  if(input.action==='update-client-email'){
   ready(user,'super_admin');
   const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
   if(!uuid.test(input.userId||'')||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail(400,'أدخل بريدا إلكترونيا صحيحا');
   const target=await checked(admin.auth.admin.getUserById(input.userId));
   if(target.user?.app_metadata?.role!=='client'||target.user.is_anonymous)throw fail(403,'يمكن تعديل بريد حسابات العملاء فقط');
   if(target.user.email===email)return {success:true};
   const {error}=await admin.auth.admin.updateUserById(target.user.id,{email,email_confirm:true,app_metadata:{client_contact_edit:{kind:'email',actor_id:user.id,session_id:session,request_id:randomUUID()}}});
   if(error)throw fail(400,'تعذر اعتماد البريد الجديد تأكد أنه غير مرتبط بحساب آخر');
   return {success:true};
  }
  ready(user,'client');
  const phone=typeof input.phone==='string'?normalizePhone(input.phone):null;
  if(!phone)throw fail(400,'أدخل رقم جوال صحيحا مع مفتاح الدولة');
  if(input.action==='client-phone-start'){
   if(phone===`+${String(user.phone||'').replace(/^\+/,'')}`)throw fail(400,'هذا هو رقم الجوال المعتمد حاليا');
   if(!/^https:\/\/[a-z0-9.-]+\.greenapi\.com$/.test(env.GREEN_API_URL||'')||!env.GREEN_API_INSTANCE_ID||!env.GREEN_API_TOKEN)throw fail(503,'إرسال رمز واتساب غير متاح حاليا');
   const id=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0');
   const status=await checked(admin.rpc('client_phone_start',{p_user:user.id,p_session:session,p_id:id,p_phone:phone,p_hash:otpHash(id,user.id,phone,code)}));
   if(status==='rate_limit')throw fail(429,'انتظر دقيقة قبل طلب رمز جديد الحد الأقصى خمسة رموز خلال ساعة');
   if(status!=='ready')throw fail(400,'لا يمكن اعتماد هذا الرقم تأكد من الرقم وحاول مجددا');
   let accepted=false;
   try{
    const response=await transport(`${env.GREEN_API_URL}/waInstance${env.GREEN_API_INSTANCE_ID}/sendMessage/${env.GREEN_API_TOKEN}`,{
     method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(12000),
     body:JSON.stringify({chatId:`${phone.slice(1)}@c.us`,message:`صيت\nرمز التحقق لتغيير رقم جوالك ${code}\nصالح لمدة خمس دقائق\nلا تشارك الرمز مع أي شخص`})
    });
    const body=await response.json().catch(()=>({}));accepted=response.ok&&!!body.idMessage;
   }catch{/* An uncertain provider response may still deliver the code */}
   return {challengeId:id,phone,expiresAt:new Date(Date.now()+300000).toISOString(),retryAfter:60,delivery:accepted?'accepted':'unknown'};
  }
  if(input.action==='client-phone-verify'){
   const code=String(input.code||'').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632));
   if(!uuid.test(input.challengeId||'')||!/^\d{6}$/.test(code))throw fail(400,'أدخل رمز التحقق المكون من ستة أرقام');
   const proof=await checked(admin.rpc('client_phone_verify',{p_user:user.id,p_session:session,p_id:input.challengeId,p_hash:otpHash(input.challengeId,user.id,phone,code)}));
   if(proof.status==='complete')return {success:true};
   if(proof.status!=='verified')throw fail(400,proof.status==='expired'?'انتهت صلاحية الرمز أو المحاولات اطلب رمزا جديدا':'رمز التحقق غير صحيح راجعه وأعد المحاولة');
   const {error}=await admin.auth.admin.updateUserById(user.id,{phone:proof.phone,phone_confirm:true,app_metadata:{client_contact_edit:{kind:'phone',actor_id:user.id,session_id:session,request_id:randomUUID(),proof_id:input.challengeId}}});
   if(error)throw fail(409,'تعذر اعتماد الجوال قد يكون مرتبطا بحساب آخر أعد المحاولة');
   return {success:true};
  }
  throw fail(400,'طلب غير معروف');
 };
}
