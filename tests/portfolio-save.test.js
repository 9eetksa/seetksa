import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/admin/portfolio-data.js',import.meta.url),'utf8');
const repositorySource=source.slice(source.indexOf('export const portfolioRepository'),source.indexOf('export async function portfolioPreview')).replace('export const','const');
const media={id:'image',source:'storage',object_path:'work/user/image.png',filename:'صورة أصلية.png',mime_type:'image/png',byte_size:128,is_cover:true};
const payload={id:'work',version:1,name:' عمل ',description:' وصف ',project_url:'',status:'active',media:[media]};
const committed={id:'work',version:2,name:'عمل',description:'وصف',project_url:null,status:'active',portfolio_media:[{...media,position:0}]};

function setup(current){
 const error=new Error('network response lost');
 const supabase={rpc:async()=>({error}),from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:current})})})})};
 const result=async promise=>{const value=await promise;if(value.error)throw value.error;return value.data;};
 const notifications=[];
 const repository=new Function('supabase','result','uploadFile','invalidateCatalog','notifyPortfolioChanged',`${repositorySource};return portfolioRepository;`)(supabase,result,()=>{},resource=>notifications.push(resource),()=>notifications.push('homepage'));
 return {repository,error,notifications};
}

test('recovers a committed save after its response is lost using normalized content and next version',async()=>{
 const {repository,notifications}=setup(committed);
 assert.equal(await repository.save(payload),'work');
 assert.deepEqual(notifications,['portfolio','homepage']);
});

test('does not report success when another version or a different original file was stored',async()=>{
 for(const current of [{...committed,version:3},{...committed,portfolio_media:[{...media,object_path:'work/user/other.png',position:0}]}]){
  const {repository,error}=setup(current);
  await assert.rejects(repository.save(payload),reason=>reason===error);
 }
});

test('retains the original error if the work was not committed',async()=>{
 const {repository,error}=setup(null);
 await assert.rejects(repository.save(payload),reason=>reason===error);
});
