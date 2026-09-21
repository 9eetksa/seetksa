import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/workflow/ClientWorkspace.jsx',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('async function supply(e)'),source.indexOf(' if(!data)return <section className="c-detail">'));
function setup({failUpload=false,failAttach=false}={}){
 const events=[],progress=[],errors=[],locked={current:false};
 const responseFiles=[{name:'one.png'},{name:'two.png'}];
 const call=async(action,args)=>{events.push({action,args});if(failAttach&&action==='attach')throw Error('registration_failed');};
 const repository={request:async()=>({version:8}),forgetUpload:key=>events.push({forgot:key})};
 const uploadFile=async(id,part,file,{onProgress})=>{events.push({upload:file.name});onProgress(40);if(failUpload)throw Error('upload_failed');onProgress(100);return {object_path:`${id}/${part}/${file.name}`,filename:file.name,cache_key:file.name};};
 const supply=new Function('locked','setBusy','setError','setNotice','setResponseProgress','data','responseFiles','uploadFile','id','call','repository','reason','setReason','setResponseFiles','refresh','onChange','workError',`${handler};return supply;`)(locked,value=>events.push({busy:value}),value=>errors.push(value),()=>{},value=>progress.push(value),{request:{version:7}},responseFiles,uploadFile,'request',call,repository,'client note',()=>{},()=>{},async()=>{},async()=>{},e=>e.message);
 return {supply,events,progress,errors,locked};
}
test('response uploads each original before registration and sends with the new version',async()=>{
 const f=setup();await f.supply({preventDefault(){}});
 assert.deepEqual(f.events.filter(e=>e.upload).map(e=>e.upload),['one.png','two.png']);
 assert.deepEqual(f.events.filter(e=>e.action).map(e=>[e.action,e.args.version]),[['attach',7],['supply_info',8]]);
 assert.equal(f.events.filter(e=>e.forgot).length,2);
 assert.ok(f.progress.some(e=>e?.percent===40&&e.filename==='two.png'));
 assert.equal(f.locked.current,false);
});
for(const failure of ['failUpload','failAttach'])test(`response remains unsent and retry data is retained after ${failure}`,async()=>{
 const f=setup({[failure]:true});await f.supply({preventDefault(){}});
 assert.equal(f.events.some(e=>e.action==='supply_info'),false);
 assert.equal(f.events.some(e=>e.forgot),false);
 assert.ok(f.errors.at(-1).endsWith('_failed'));
 assert.equal(f.progress.at(-1),null);
 assert.deepEqual(f.events.at(-1),{busy:false});
});
