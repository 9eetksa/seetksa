import test from 'node:test';
import assert from 'node:assert/strict';
import {loopPosition, mountPartnerReel} from '../src/home/partner-reel.js';

test('reel wraps both directions without changing the visible strip phase', () => {
  for (const position of [-840,-1,0,399,400,799,800,2407]) {
    const wrapped = loopPosition(position,400);
    assert.ok(wrapped >= 400 && wrapped < 800);
    assert.equal(Math.abs((wrapped-position)%400),0);
  }
  assert.equal(loopPosition(100,0),0);
});

test('reel auto motion, dragging, keyboard, pause preferences and cleanup', t => {
  const originals = new Map();
  const install = (key,value) => { originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key)); Object.defineProperty(globalThis,key,{value,configurable:true,writable:true}); };
  t.after(() => { for (const [key,descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; } });
  const frames = new Map(), motion = {matches:false};
  let counter=0, resize, observer, stripWidth=400, paused=false;
  install('matchMedia',() => motion);
  install('requestAnimationFrame',fn => {frames.set(++counter,fn);return counter;});
  install('cancelAnimationFrame',id => frames.delete(id));
  install('ResizeObserver',class { constructor(fn){resize=this;this.callback=fn;} observe(){} disconnect(){this.closed=true;} });
  install('IntersectionObserver',class { constructor(fn){observer=this;this.callback=fn;} observe(){} disconnect(){this.closed=true;} });
  const doc = new EventTarget(); doc.hidden=false; install('document',doc);
  const viewport = new EventTarget();
  viewport.scrollLeft=0;
  viewport.matches=()=>true;
  viewport.firstElementChild={getBoundingClientRect:()=>({width:stripWidth}),children:{length:66}};
  viewport.setPointerCapture=id => {viewport.captured=id;};
  const emit=(name,props={}) => viewport.dispatchEvent(Object.assign(new Event(name,{cancelable:true}),props));
  let time=performance.now()+10000;
  const step=() => {time+=16;const [id,fn]=frames.entries().next().value;frames.delete(id);fn(time);};
  const stop=mountPartnerReel(viewport,()=>paused);
  resize.callback(); assert.equal(viewport.scrollLeft,400);
  observer.callback([{isIntersecting:true}]);
  for(let i=0;i<100;i++)step();
  assert.ok(viewport.scrollLeft>440,'fractional animation advances even with integer scroll positions');
  paused=true; let before=viewport.scrollLeft; step(); assert.equal(viewport.scrollLeft,before);
  paused=false; motion.matches=true; step(); assert.equal(viewport.scrollLeft,before);
  emit('keydown',{key:'ArrowLeft'}); assert.equal(viewport.scrollLeft,loopPosition(before-400/66,400));
  emit('pointerdown',{button:0,pointerId:1,pointerType:'mouse',clientX:100});
  before=viewport.scrollLeft;
  emit('pointermove',{pointerId:1,clientX:140}); assert.equal(viewport.scrollLeft,loopPosition(before-40,400));
  assert.equal(viewport.captured,1);
  emit('pointerup');
  motion.matches=false; emit('focusin'); before=viewport.scrollLeft; step(); assert.equal(viewport.scrollLeft,before);
  emit('focusout'); emit('pointerenter',{pointerType:'mouse'}); step(); assert.equal(viewport.scrollLeft,before);
  emit('pointerleave');
  const phase=(viewport.scrollLeft-400)/400;
  stripWidth=600;resize.callback();assert.ok(Math.abs(viewport.scrollLeft-(600+phase*600))<.001);
  observer.callback([{isIntersecting:false}]); assert.equal(frames.size,0);
  observer.callback([{isIntersecting:true}]); assert.equal(frames.size,1);
  doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange')); assert.equal(frames.size,0);
  stop();assert.ok(resize.closed && observer.closed);
  before=viewport.scrollLeft;emit('keydown',{key:'ArrowRight'});assert.equal(viewport.scrollLeft,before);
});
