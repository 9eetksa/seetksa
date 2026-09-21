import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { notifyPortfolioChanged, subscribePortfolioChanged } from '../src/data/portfolio-updates.js';

test('changes notify the current page and other tabs and unsubscribe cleanly',()=>{
 const previous=globalThis.window;
 const target=new EventTarget(),writes=[];
 globalThis.window=Object.assign(target,{localStorage:{setItem:(...args)=>writes.push(args)}});
 try {
  let count=0;const unsubscribe=subscribePortfolioChanged(()=>count++);
  notifyPortfolioChanged();assert.equal(count,1);assert.equal(writes[0][0],'seet-portfolio-updated');
  const event=Object.assign(new Event('storage'),{key:writes[0][0]});target.dispatchEvent(event);assert.equal(count,2);
  target.dispatchEvent(Object.assign(new Event('storage'),{key:'unrelated'}));assert.equal(count,2);
  unsubscribe();target.dispatchEvent(event);assert.equal(count,2);
  target.localStorage.setItem=()=>{throw Error('Storage disabled');};assert.doesNotThrow(notifyPortfolioChanged);
 } finally {globalThis.window=previous;}
});

test('portfolio invalidation discards stale reads without clearing unrelated catalog entries',async()=>{
 const source=await readFile(new URL('../src/data/catalog-gateway.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export function invalidateCatalog'),source.indexOf('const responseLimit')).replace('export function','function');
 const cache=new Map([['u:portfolio',{old:true}],['u:services',{unchanged:true}]]);
 const inFlight=new Map([['u:portfolio',Promise.resolve([])],['u:services',Promise.resolve([])]]);
 const next=new Function('cache','inFlight',`let generation=4;${body};invalidateCatalog('portfolio');return generation;`)(cache,inFlight);
 assert.equal(next,5);assert.equal(cache.has('u:portfolio'),false);assert.equal(inFlight.has('u:portfolio'),false);
 assert.equal(cache.has('u:services'),true);assert.equal(inFlight.has('u:services'),true);
});
