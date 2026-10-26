import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../src/lib/sheet-focus.js', import.meta.url), 'utf8').replace('export function', 'function');
function fixture() {
 const listeners = new Map();
 const document = { body: {}, activeElement: null, native: null,
  querySelector() { return this.native; },
  addEventListener(type, fn) { if(!listeners.has(type)) listeners.set(type,new Set()); listeners.get(type).add(fn); },
  removeEventListener(type, fn) { listeners.get(type).delete(fn); },
 };
 function emit(type,event) { for (const fn of [...(listeners.get(type)||[])]) { fn(event); if(event.stopped) break; } }
 function element(label, options={}) {
  const el = { label, tabIndex:0, isConnected:true, ...options,
   matches() { return !!this.disabled; }, closest() {return this.inert||this.hidden;},
   getClientRects() { return this.display === 'none' ? [] : [{}]; },
   focus() { document.activeElement=this; emit('focusin',{target:this}); },
  }; return el;
 }
 function panel(label, children=[]) {
  return Object.assign(element(label,{tabIndex:-1}), { children,
   contains(el) { return el === this || this.children.includes(el); },
   querySelectorAll() { return this.children; },
  });
 }
 const contain = runInNewContext(`${source}\ncontainSheetFocus`,{document,getComputedStyle:el=>({visibility:el.visibility||'visible'})});
 function key(key, options={}) {
  const event={key,defaultPrevented:false, ...options, preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
  emit('keydown',event); return event;
 }
 const trigger=element('trigger'); trigger.focus();
 return {document,listeners,element,panel,contain,key,trigger};
}

test('sheet wraps forward/backward at live tab boundaries and skips unavailable actions',()=>{
 const f=fixture(), first=f.element('first'), last=f.element('last');
 const panel=f.panel('sheet',[first,f.element('disabled',{disabled:true}),f.element('hidden',{hidden:true}),f.element('display',{display:'none'}),f.element('inert',{inert:true}),f.element('negative',{tabIndex:-1}),f.element('invisible',{visibility:'hidden'}),last]);
 const clean=f.contain(panel,()=>{});
 assert.equal(f.document.activeElement,panel);
 assert.equal(f.key('Tab').defaultPrevented,true); assert.equal(f.document.activeElement,first);
 assert.equal(f.key('Tab').defaultPrevented,false,'browser owns ordinary interior movement');
 first.focus(); f.key('Tab',{shiftKey:true}); assert.equal(f.document.activeElement,last);
 f.key('Tab'); assert.equal(f.document.activeElement,first);
 panel.children=[last]; f.key('Tab'); assert.equal(f.document.activeElement,last);
 f.key('Tab'); assert.equal(f.document.activeElement,last);
 clean(); assert.equal(f.document.activeElement,f.trigger);
 assert.equal([...f.listeners.values()].reduce((sum,set)=>sum+set.size,0),0);
});

test('empty sheets retain focus and redirect programmatic background focus',()=>{
 const f=fixture(), panel=f.panel('empty'); const clean=f.contain(panel,()=>{});
 assert.equal(f.key('Tab').defaultPrevented,true); assert.equal(f.document.activeElement,panel);
 f.key('Tab',{shiftKey:true}); assert.equal(f.document.activeElement,panel);
 f.trigger.focus(); assert.equal(f.document.activeElement,panel);
 clean(); f.trigger.focus(); assert.equal(f.document.activeElement,f.trigger);
});

test('only the top sheet handles Escape and restores its parent action',()=>{
 const f=fixture(), action=f.element('open nested'), parent=f.panel('parent',[action]); let closed=0;
 const parentClean=f.contain(parent,()=>{closed+=10;}); action.focus();
 const child=f.panel('child'), childClean=f.contain(child,()=>{closed++;});
 assert.equal(f.key('Escape').defaultPrevented,true); assert.equal(closed,1);
 childClean(); assert.equal(f.document.activeElement,action);
 f.key('Escape'); assert.equal(closed,11);
 parentClean(); assert.equal(f.document.activeElement,f.trigger);
});

test('removing a lower sheet cannot steal focus from a newer sheet',()=>{
 const f=fixture(), parent=f.panel('parent'), child=f.panel('child');
 const parentClean=f.contain(parent,()=>{}), childClean=f.contain(child,()=>{});
 parentClean(); assert.equal(f.document.activeElement,child);
 childClean();
});

test('native modal dialogs and consumed or composing keys keep their own handling',()=>{
 const f=fixture(), panel=f.panel('sheet'); let closed=0; const clean=f.contain(panel,()=>closed++);
 f.key('Escape',{defaultPrevented:true}); f.key('Escape',{isComposing:true}); assert.equal(closed,0);
 f.document.native=f.element('native dialog'); f.document.native.focus();
 assert.equal(f.document.activeElement,f.document.native);
 assert.equal(f.key('Escape').defaultPrevented,false); assert.equal(closed,0);
 panel.children.push(f.document.native);
 assert.equal(f.key('Escape').defaultPrevented,false,'a native dialog inside the sheet also owns Escape');
 assert.equal(closed,0);
 clean(); assert.equal(f.document.activeElement,f.document.native,'do not steal deliberate focus');
});

test('positive tabindex order and detached return targets are respected',()=>{
 const f=fixture(), normal=f.element('normal'), second=f.element('second',{tabIndex:2}), first=f.element('first',{tabIndex:1});
 const panel=f.panel('sheet',[normal,second,first]); const clean=f.contain(panel,()=>{});
 f.key('Tab'); assert.equal(f.document.activeElement,first);
 first.focus(); f.key('Tab',{shiftKey:true}); assert.equal(f.document.activeElement,normal);
 f.trigger.isConnected=false; clean(); assert.equal(f.document.activeElement,normal);
});

// Exercise Sheet's real effects to cover animation-frame cancellation and unmount.
const component = readFileSync(new URL('../src/components/Sheet.jsx', import.meta.url), 'utf8');
function lifecycle() {
 let cursor=0, pending=[], open=false, frameId=0, timerId=0, activations=0, releases=0;
 const slots=[], frames=new Map(), timers=new Map(), fakePanel={};
 const body=component.slice(component.indexOf('export function Sheet'),component.indexOf('  const grip =')).replace('export function','function');
 const renderSheet=runInNewContext(`${body}\nreturn {mounted,shown};}\nSheet`,{
  SLIDE:340, document:{activeElement:null},
  useState(initial){const i=cursor++; if(!(i in slots)) slots[i]=initial; return [slots[i],v=>{slots[i]=v;}];},
  useRef(initial){const i=cursor++; return slots[i]??={current:initial===null?fakePanel:initial};},
  useEffect(effect,deps){const i=cursor++, old=slots[i]; if(!old||deps.some((d,j)=>d!==old.deps[j])) pending.push(()=>{old?.cleanup?.(); slots[i]={deps,cleanup:effect()};});},
  useLayoutEffect(effect,deps){const i=cursor++, old=slots[i]; if(!old||deps.some((d,j)=>d!==old.deps[j])) {old?.cleanup?.(); slots[i]={deps,cleanup:effect()};}},
  requestAnimationFrame(fn){frames.set(++frameId,fn); return frameId;}, cancelAnimationFrame(id){frames.delete(id);},
  setTimeout(fn){timers.set(++timerId,fn); return timerId;}, clearTimeout(id){timers.delete(id);},
  containSheetFocus(){activations++; return ()=>{releases++;};},
 });
 function render(value=open,beforeEffects=()=>{}){open=value; cursor=0; const result=renderSheet({open,onClose(){},children:'content'}); beforeEffects(); const work=pending;pending=[];work.forEach(fn=>fn());return result;}
 return {render,frames,timers, frame(){const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());},unmount(){slots.forEach(slot=>slot?.cleanup?.());},get activations(){return activations;},get releases(){return releases;}};
}

test('a mounted open sheet contains focus before passive effects run',()=>{
 const f=lifecycle();
 f.render(true,()=>assert.equal(f.activations,1));
 f.unmount(); assert.equal(f.releases,1);
});

test('closing between animation frames cancels the delayed rise and releases focus once',()=>{
 const f=lifecycle(); f.render(); f.render(true); f.render(); f.frame();
 assert.equal(f.frames.size,1); assert.equal(f.activations,1);
 f.render(false); f.render(); assert.equal(f.releases,1); assert.equal(f.frames.size,0);
 f.frame(); assert.equal(f.render().shown,false);
 f.unmount(); assert.equal(f.releases,1); assert.equal(f.timers.size,0);
});

test('rapid reopening retains only the live animation and unmount releases its focus owner',()=>{
 const f=lifecycle(); f.render(); f.render(true); f.render(); f.frame();
 f.render(false); f.render(true); f.render(); f.frame(); f.frame();
 assert.equal(f.render().shown,true); assert.equal(f.activations,2); assert.equal(f.releases,1);
 f.unmount(); assert.equal(f.releases,2); assert.equal(f.frames.size,0); assert.equal(f.timers.size,0);
});
