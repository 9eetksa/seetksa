import {createImpersonationService} from '../server/impersonation-service.mjs';

export const config={maxDuration:60};
export function impersonationHandler(env,{serviceFactory=createImpersonationService}={}){
 let service;
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'الطلب غير مدعوم'});}
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(String(req.headers['content-type']||'')))return res.status(415).json({error:'تنسيق الطلب غير صالح'});
  try{
   const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body??null);
   if(Buffer.byteLength(raw)>2*1024*1024)return res.status(413).json({error:'الطلب أكبر من المسموح'});
   const body=JSON.parse(raw);
   if(!body||Array.isArray(body)||typeof body!=='object')return res.status(400).json({error:'بيانات الطلب غير صالحة'});
   const authorization=String(req.headers.authorization||'');
   if(!/^Bearer\s+\S+$/i.test(authorization))return res.status(401).json({error:'سجل الدخول للمتابعة'});
   service||=serviceFactory(env);
   const result=await service(body,authorization.replace(/^Bearer\s+/i,''));
   return res.status(200).json(result);
  }catch(error){
   if(error instanceof SyntaxError)return res.status(400).json({error:'بيانات الطلب غير صالحة'});
   return res.status(error.status||502).json({error:error.status?error.message:'تعذر إكمال العملية حاول مجددا'});
  }
 };
}
export default impersonationHandler(process.env);
