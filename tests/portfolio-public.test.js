import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioService, safeProjectUrl } from '../server/portfolio-service.mjs';
import { portfolioHandler } from '../api/portfolio.js';
import { portfolioSlots } from '../src/home/usePublicPortfolio.js';

const id='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const path=`${id}/${other}/${other}.png`;
const token='valid.session.token';
const env={VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server'};
const row={id,name:'Work',description:'Description',status:'active',version:1,project_url:'https://example.com/work',portfolio_media:[{source:'storage',object_path:path,is_cover:true}]};
function setup({rows=[row],visible=row,access={data:{user_id:other,role:'admin'}},deleted=[{id}],cleanupError=false}={}) {
 const calls=[];
 const factory=(url,key,options)=>({
  rpc:async(name,args)=>{calls.push({rpc:name,args,key,token:options.global?.headers?.Authorization});return access;},
  from(table){
   const call={table,key,filters:[]};calls.push(call);
   const query={
    select(fields){call.fields=fields;return query;},
    delete(){call.delete=true;return query;},
    eq(field,value){call.filters.push([field,value]);return query;},
    order(){return query;},limit(){return query;},
    maybeSingle(){return Promise.resolve({data:visible});},
    then(resolve,reject){return Promise.resolve({data:call.delete?deleted:rows}).then(resolve,reject);},
   };return query;
  },
  storage:{from(bucket){return {
   createSignedUrls:async(paths,seconds)=>{calls.push({sign:paths,bucket,seconds});return {data:paths.map(path=>({path,signedUrl:'https://example.com/signed-cover'}))};},
   remove:async(paths)=>{calls.push({remove:paths,bucket});return {error:cleanupError?{message:'offline'}:null};},
  };}},
 });
 return {service:createPortfolioService(env,{createSupabaseClient:factory}),factory,calls};
}
test('public gallery exposes only active display fields and signs only valid cover images',async()=>{
 const archived={...row,id:other,status:'archived'};
 const original={source:'storage',object_path:`${id}/${other}/${id}.jpg`,is_cover:false};
 const {service,calls}=setup({rows:[{...row,created_by:other,portfolio_media:[...row.portfolio_media,original]},archived]});
 const result=await service.list();
 assert.equal(result.length,1);
 assert.deepEqual(Object.keys(result[0]),['id','name','description','url','image']);
 assert.deepEqual(calls.find(c=>c.sign).sign,[path]);
 assert.deepEqual(calls[0].filters,[['status','active']]);
 assert.equal(calls.find(c=>c.sign).seconds,120);
});
test('empty library stays empty and invalid paths and unsafe links are never exposed',async()=>{
 assert.deepEqual(await setup({rows:[]}).service.list(),[]);
 for(const cover of [{source:'packaged',object_path:'/private/secret.png',is_cover:true},{source:'storage',object_path:`${other}/${other}/${other}.png`,is_cover:true}]) {
  const {service,calls}=setup({rows:[{...row,project_url:'javascript:alert(1)',portfolio_media:[cover]}]});
  const [work]=await service.list();assert.equal(work.image,null);assert.equal(work.url,null);assert.ok(!calls.some(c=>c.sign));
 }
 assert.equal(safeProjectUrl('https://user:password@example.com'),null);
});
test('delete requires a current admitted manager session and validates input before touching data',async()=>{
 for(const access of [{error:{code:'42501'}},{data:{user_id:other,role:'employee'}},{data:{user_id:other,role:'client'}}]) {
  const {service,calls}=setup({access});
  await assert.rejects(service.remove({id,version:1},token),e=>e.status===403);
  assert.ok(!calls.some(c=>c.delete||c.remove));
 }
 const {service,calls}=setup();
 await assert.rejects(service.remove({id,version:1},''),e=>e.status===401);
 await assert.rejects(service.remove({id,version:0},token),e=>e.status===400);
 assert.equal(calls.length,0);
});
test('delete enforces RLS visibility and atomic version matching before storage cleanup',async()=>{
 const {service,calls}=setup();
 assert.deepEqual(await service.remove({id,version:1},token),{success:true,cleanupPending:false});
 assert.equal(calls[0].rpc,'platform_access_check');
 assert.equal(calls[0].args.p_allow_onboarding,false);
 assert.equal(calls[1].key,'public');
 assert.deepEqual(calls.find(c=>c.delete).filters,[['id',id],['version',1]]);
 assert.deepEqual(calls.find(c=>c.remove).remove,[path]);
 for(const options of [{visible:{...row,version:2}},{deleted:[]}]) {
  const conflict=setup(options);
  await assert.rejects(conflict.service.remove({id,version:1},token),e=>e.status===409);
  assert.ok(!conflict.calls.some(c=>c.remove));
 }
});
test('repeated deletion is safe and never removes packaged files or another work files',async()=>{
 const missing=setup({visible:null});
 assert.equal((await missing.service.remove({id,version:1},token)).alreadyDeleted,true);
 assert.ok(!missing.calls.some(c=>c.delete||c.remove));
 const mixed=setup({visible:{...row,portfolio_media:[...row.portfolio_media,{source:'packaged',object_path:'/portfolio/sukkar.jpg'},{source:'storage',object_path:`${other}/${other}/${other}.png`}]},cleanupError:true});
 assert.equal((await mixed.service.remove({id,version:1},token)).cleanupPending,true);
 assert.deepEqual(mixed.calls.find(c=>c.remove).remove,[path]);
});
test('four slots remain with no fallback works and carousel remains valid after deleting its last page',()=>{
 assert.deepEqual(portfolioSlots([]),[null,null,null,null]);
 assert.deepEqual(portfolioSlots([row],99),[row,null,null,null]);
 const works=Array.from({length:6},(_,id)=>({id}));
 assert.deepEqual(portfolioSlots(works,5).map(w=>w.id),[5,0,1,2]);
});
test('public endpoint disables caching and rejects unauthenticated deletion and invalid body',async()=>{
 const {factory}=setup({rows:[]});const handler=portfolioHandler(env,{createSupabaseClient:factory});
 async function request(method,body,headers={}) {
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method,body,headers},res);return res;
 }
 const get=await request('GET');assert.equal(get.code,200);assert.equal(get.headers['Cache-Control'],'no-store');assert.deepEqual(get.body,{data:[]});
 assert.equal((await request('DELETE',{id,version:1},{'content-type':'application/json'})).code,401);
 assert.equal((await request('DELETE','{',{'content-type':'application/json'})).code,400);
 assert.equal((await request('POST')).code,405);
});
