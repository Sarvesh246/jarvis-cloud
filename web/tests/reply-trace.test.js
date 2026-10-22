import test from 'node:test';
import assert from 'node:assert/strict';
import {replyTrace} from '../src/lib/reply-trace.js';

test('ordinary replies always receive a usable trace even with diagnostics disabled',()=>{
  const trace=replyTrace('synthetic-run');
  trace.mark('first_answer');trace.count('retries');
  assert.equal(trace.finish('complete').outcome,'complete');
});

test('opt-in diagnostics are content-free and bounded to fifty local records',()=>{
  const original={location:Object.getOwnPropertyDescriptor(globalThis,'location'),sessionStorage:Object.getOwnPropertyDescriptor(globalThis,'sessionStorage'),window:Object.getOwnPropertyDescriptor(globalThis,'window')};
  const info=console.info;
  try {
    Object.defineProperty(globalThis,'location',{configurable:true,value:{search:'?diagnostics=1'}});
    Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:()=>null}});
    Object.defineProperty(globalThis,'window',{configurable:true,value:{}});
    console.info=()=>{};
    for(let i=0;i<60;i++) replyTrace('run-'+i).finish('complete');
    assert.equal(window.__vaeloTraces.length,50);
    assert.equal(window.__vaeloTraces[0].run,'run-10');
    assert.doesNotMatch(JSON.stringify(window.__vaeloTraces),/messages|prompt|credential|cookie|answer_text/);
  } finally {
    console.info=info;
    for(const [key,descriptor] of Object.entries(original)) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
