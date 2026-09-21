import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDriveUrl,validDriveUrl,requestDriveUrl,driveSpecificationKey} from '../src/workflow/drive-resources.js';

test('Drive links accept shared files folders and Google documents while remaining optional',()=>{
 for(const url of ['https://drive.google.com/file/d/file-id/view?usp=sharing','https://drive.google.com/drive/u/0/folders/folder-id','https://docs.google.com/document/d/doc-id/edit']){
  assert.equal(normalizeDriveUrl(` ${url} `),url);
  assert.equal(requestDriveUrl({specifications:{[driveSpecificationKey]:url}}),url);
 }
 assert.equal(normalizeDriveUrl('  '),'');
 assert.equal(requestDriveUrl({}),'');
});

test('unsafe schemes lookalike hosts credentials malformed and oversized links never become resource links',()=>{
 for(const url of ['javascript:alert(1)','http://drive.google.com/file/d/id','https://drive.google.com.evil.test/file','https://drive.google.com@evil.test/file','https://drive.google.com:443/file','https://drive.google.com/','https://drive.google.com/fi\nle','https://drive.google.com/a\\b','https://drive.google.com/<script>','https://drive.google.com/'+ 'a'.repeat(2048)]){
  assert.equal(validDriveUrl(url),false,url);
  assert.throws(()=>normalizeDriveUrl(url),/invalid_drive_url/);
  assert.equal(requestDriveUrl({specifications:{[driveSpecificationKey]:url}}),'');
 }
 assert.equal(validDriveUrl({url:'https://drive.google.com/file'}),false);
});
