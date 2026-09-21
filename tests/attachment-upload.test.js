import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate as nextTurn} from 'node:timers/promises';

// Exercise the production uploader with its browser/network boundaries replaced
// No credentials or Storage objects are needed for these failure-path checks
const source=await readFile(new URL('../src/workflow/data.js',import.meta.url),'utf8');
const uploader=source.slice(source.indexOf('export async function uploadFile('),source.indexOf('// Read the existing schema'))
 .replace('export async function','async function').replaceAll('import.meta.env','env');
const attachmentSource=await readFile(new URL('../src/workflow/attachment-files.js',import.meta.url),'utf8');
const groupSource=attachmentSource.slice(attachmentSource.indexOf('export function groupDeliveryFiles'),attachmentSource.indexOf('export async function saveOriginal'))
 .replace('export function','function');
const groupDeliveryFiles=new Function(`${groupSource};return groupDeliveryFiles;`)();
const endpoint='https://fixture.storage.supabase.co/storage/v1/upload/resumable';
const file=new File([Uint8Array.from([0,255,16,32])],'تصميم أصلي % 1.mp4',{type:'video/mp4',lastModified:42});

function setup({previous=[],requestUrl,lookupError=false,sessionUser='fixture-user',acting=null}={}){
 const uploads=[],storage=new Map(),headers=[],signedPaths=[];
 let currentActing=acting;
 class Upload{
  constructor(original,options){this.file=original;this.options=options;uploads.push(this);}
  findPreviousUploads(){return lookupError?Promise.reject(new Error('device storage unavailable')):Promise.resolve(previous);}
  resumeFromPreviousUpload(value){this.previous=value;}
  start(){this.started=true;Promise.resolve().then(async()=>{
   await this.options.onBeforeRequest({getURL:()=>requestUrl||this.previous?.uploadUrl||this.options.endpoint,setHeader:(...value)=>headers.push(value)});
   this.options.onProgress(file.size,file.size);
   this.options.onSuccess();
  }).catch(this.options.onError);}
  abort(){this.aborted=true;return Promise.resolve();}
 }
 const supabase={auth:{getSession:async()=>({data:{session:{user:{id:sessionUser},access_token:'fixture-token'}}})},storage:{from:bucket=>({createSignedUrl:async()=>({signedUrl:`https://fixture.invalid/${bucket}`}),createSignedUploadUrl:async(path,options)=>{signedPaths.push({bucket,path,options});return {data:{token:'path-only-signature'}};}})}};
 const localStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
 const uploadFile=new Function('supabase','tus','localStorage','env','getImpersonation','hasImpersonation','refreshImpersonation','result',`${uploader};return uploadFile;`)(supabase,{Upload},localStorage,{VITE_SUPABASE_URL:'https://fixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-publishable'},()=>currentActing,()=>Boolean(currentActing),async()=>currentActing,async query=>{const value=await query;if(value.error)throw value.error;return value.data;});
 return {uploadFile,uploads,storage,headers,signedPaths,setActing:value=>{currentActing=value;}};
}

test('passes the original File unchanged with resumable chunks and one authorization header',async()=>{
 const fixture=setup(),progress=[];
 const result=await fixture.uploadFile('request','brief',file,{onProgress:value=>progress.push(value)});
 assert.equal(fixture.uploads[0].file,file);
 assert.equal(fixture.uploads[0].options.chunkSize,6*1024*1024);
 assert.equal(fixture.uploads[0].options.metadata.contentType,'video/mp4');
 assert.equal(fixture.uploads[0].options.headers.authorization,undefined);
 assert.deepEqual(fixture.headers,[['authorization','Bearer fixture-token']]);
 assert.equal(result.filename,file.name);
 assert.deepEqual(progress,[100]);
});

test('keeps the resumed object path when TUS must create a new expired upload session',async()=>{
 const previous={metadata:{bucketName:'work-files',objectName:'request/brief/original.mp4'},uploadUrl:`${endpoint}/expired`};
 const fixture=setup({previous:[previous]});
 const result=await fixture.uploadFile('request','brief',file);
 assert.equal(fixture.uploads[0].previous,previous);
 assert.equal(fixture.uploads[0].options.metadata.objectName,previous.metadata.objectName);
 assert.equal(result.object_path,previous.metadata.objectName);
});

test('ignores persisted upload URLs outside the Storage endpoint',async()=>{
 const previous={metadata:{bucketName:'work-files',objectName:'request/brief/original.mp4'},uploadUrl:'https://untrusted.invalid/upload'};
 const fixture=setup({previous:[previous]});
 await fixture.uploadFile('request','brief',file);
 assert.equal(fixture.uploads[0].previous,undefined);
});

test('does not forward authorization to an unexpected upload request destination',async()=>{
 const fixture=setup({requestUrl:'https://untrusted.invalid/upload'});
 await assert.rejects(fixture.uploadFile('request','brief',file),/invalid_upload_url/);
 assert.deepEqual(fixture.headers,[]);
});

test('can upload when optional browser resume storage is unavailable',async()=>{
 const fixture=setup({lookupError:true});
 const result=await fixture.uploadFile('request','brief',file);
 assert.ok(result.object_path.startsWith('request/brief/'));
});

test('a paused upload does not start after a pending resume lookup finishes',async()=>{
 let finishLookup;
 const lookup=new Promise(resolve=>{finishLookup=resolve;});
 const fixture=setup({previous:lookup}),controller=new AbortController();
 const result=fixture.uploadFile('request','brief',file,{signal:controller.signal});
 await nextTurn();
 controller.abort();
 await assert.rejects(result,/upload_paused/);
 finishLookup([]);
 await nextTurn();
 assert.equal(fixture.uploads[0].aborted,true);
 assert.equal(fixture.uploads[0].started,undefined);
});

test('completed original uploads are reused after interrupted registration',async()=>{
 const fixture=setup();
 const first=await fixture.uploadFile('request','brief',file);
 const second=await fixture.uploadFile('request','brief',file);
 assert.equal(first.object_path,second.object_path);
 assert.equal(fixture.uploads.length,1);
});

test('portfolio originals use their own bucket and resume identity',async()=>{
 const fixture=setup();
 const result=await fixture.uploadFile('work','owner',file,{bucket:'portfolio-assets'});
 assert.equal(fixture.uploads[0].options.metadata.bucketName,'portfolio-assets');
 assert.match(await fixture.uploads[0].options.fingerprint(),/^media-v1:portfolio-assets:/);
 assert.ok(result.object_path.startsWith('work/owner/'));
});

test('delegated originals use a target-scoped path signature without either account bearer',async()=>{
 const acting={id:'delegation',user:{id:'target-user'},expires_at:new Date(Date.now()+600000).toISOString()};
 const fixture=setup({acting});
 const uploaded=await fixture.uploadFile('request','part',file);
 assert.equal(fixture.uploads[0].options.endpoint,`${endpoint}/sign`);
 assert.deepEqual(fixture.headers,[['x-signature','path-only-signature']]);
 assert.deepEqual(fixture.signedPaths,[{bucket:'work-files',path:uploaded.object_path,options:{upsert:false}}]);
 assert.match(await fixture.uploads[0].options.fingerprint(),/target-user:delegation/);
});

test('delegated upload stops when the impersonation session ends before resume completes',async()=>{
 let release;
 const previous=new Promise(resolve=>{release=resolve;});
 const fixture=setup({previous,acting:{id:'delegation',user:{id:'target-user'},expires_at:new Date(Date.now()+600000).toISOString()}});
 const pending=fixture.uploadFile('request','part',file);
 await nextTurn();fixture.setActing(null);release([]);
 await assert.rejects(pending,/upload_session_expired/);
 assert.deepEqual(fixture.headers,[]);
 assert.equal(fixture.uploads[0].started,undefined);
});

test('delegated uploads reject the unsigned endpoint before transmitting the signature',async()=>{
 const fixture=setup({requestUrl:endpoint,acting:{id:'delegation',user:{id:'target'},expires_at:new Date(Date.now()+600000).toISOString()}});
 await assert.rejects(fixture.uploadFile('request','brief',file),/invalid_upload_url/);
 assert.deepEqual(fixture.headers,[]);
});

test('groups all files in a delivery batch while preserving legacy single-file deliveries',()=>{
 const files=[{id:'image',batch_id:'batch',filename:'صورة.png'},{id:'video',batch_id:'batch',filename:'فيديو.mp4'},{id:'legacy',batch_id:null,filename:'مستند.pdf'}];
 const groups=groupDeliveryFiles(files);
 assert.equal(groups.length,2);
 assert.deepEqual(groups[0].files,files.slice(0,2));
 assert.deepEqual(groups[1].files,[files[2]]);
 assert.equal(files[0].files,undefined);
});
