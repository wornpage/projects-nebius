import test from 'node:test';
import assert from 'node:assert/strict';
import {createFocusOwnership,createFocusOperationSlot} from '../svelte-frontend/src/lib/nebius-deferred-focus.mjs';

function setup() {
  const listeners = new Map();
  const body = {name:'body',isConnected:true}, html = {name:'html',isConnected:true};
  const document = {body,documentElement:html,activeElement:null,focused:true,
    hasFocus(){return this.focused;},
    addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
  const emit = (type,target,isTrusted=true) => listeners.get(type)?.({type,target,isTrusted});
  function element(name,options={}) {
    return {name,isConnected:true,disabled:false,hidden:false,inert:false,rects:1,...options,
      matches(selector){return selector===':disabled'&&this.disabled;},
      closest(){return this.hidden||this.inert?this:null;},
      getClientRects(){return Array(this.rects).fill({});},
      focus(){document.activeElement=this;emit('focusin',this);}};
  }
  const origin=element('trigger'),other=element('other'),target=element('target');document.activeElement=origin;
  const guard=createFocusOwnership(document);
  const move=element=>{document.activeElement=element;emit('focusin',element);};
  return {document,body,origin,other,target,guard,emit,move,element,listeners};
}

test('unchanged focus moves to the intended visible target',()=>{
  const x=setup(),token=x.guard.capture();assert.equal(x.guard.focus(token,x.target),true);assert.equal(x.document.activeElement,x.target);
});
test('body is a fallback only when the original control is unavailable',()=>{
  const x=setup(),token=x.guard.capture();x.document.activeElement=x.body;
  assert.equal(x.guard.focus(token,x.target),false,'connected enabled origin does not surrender focus');
  const y=setup(),removedToken=y.guard.capture();y.origin.isConnected=false;y.document.activeElement=y.body;
  assert.equal(y.guard.focus(removedToken,y.target),true,'removed origin may yield to target');
});
test('the connected Add task trigger may become disabled at the eighth-task limit',()=>{
  const x=setup(),token=x.guard.capture();x.origin.disabled=true;x.document.activeElement=x.body;
  assert.equal(x.guard.focus(token,x.target),true);
});
test('a temporarily disabled trigger can yield focus after it is enabled again',()=>{
  const x=setup(),token=x.guard.capture();x.origin.disabled=true;x.emit('focusout',x.origin);x.document.activeElement=x.body;x.origin.disabled=false;
  assert.equal(x.guard.focus(token,x.target),true);
});
test('a later blank-page action wins even after temporary disable',()=>{
  const x=setup(),token=x.guard.capture();x.origin.disabled=true;x.emit('focusout',x.origin);x.document.activeElement=x.body;x.origin.disabled=false;x.emit('pointerdown',x.body);
  assert.equal(x.guard.focus(token,x.target),false);
});
test('a later blank-page pointer action prevents body fallback even after removal',()=>{
  const x=setup(),token=x.guard.capture();x.origin.isConnected=false;x.document.activeElement=x.body;x.emit('pointerdown',x.body);
  assert.equal(x.guard.focus(token,x.target),false);assert.equal(x.document.activeElement,x.body);
});
test('focus moving A to B and back to A is still newer user intent',()=>{
  const x=setup(),token=x.guard.capture();x.move(x.other);x.move(x.origin);
  assert.equal(x.guard.focus(token,x.target),false);assert.equal(x.document.activeElement,x.origin);
});
test('an inactive document does not steal focus',()=>{
  const x=setup(),token=x.guard.capture();x.document.focused=false;
  assert.equal(x.guard.focus(token,x.target),false);assert.equal(x.document.activeElement,x.origin);
});
test('detached, hidden, inert, disabled and unrendered targets are refused',()=>{
  for(const options of [{isConnected:false},{hidden:true},{inert:true},{disabled:true},{rects:0}]){
    const x=setup(),token=x.guard.capture(),target=x.element('invalid',options);
    assert.equal(x.guard.focus(token,target),false,JSON.stringify(options));assert.equal(x.document.activeElement,x.origin);
  }
});
test('a delayed save failure announces an error but preserves a later focus choice',async()=>{
  const x=setup(),token=x.guard.capture();let reject;const save=new Promise((_,fail)=>{reject=fail;});let error='';
  const result=save.catch(()=>{error='Save failed';return x.guard.focus(token,x.target);});
  x.move(x.other);reject(Error('synthetic failure'));
  assert.equal(await result,false);assert.equal(error,'Save failed');assert.equal(x.document.activeElement,x.other);
});
test('a delayed save failure may focus its alert when the disabled trigger still owns the operation',async()=>{
  const x=setup(),token=x.guard.capture();let reject;const save=new Promise((_,fail)=>{reject=fail;});let error='';
  const result=save.catch(()=>{error='Save failed';return x.guard.focus(token,x.target);});
  x.origin.disabled=true;x.document.activeElement=x.body;reject(Error('synthetic failure'));
  assert.equal(await result,true);assert.equal(error,'Save failed');assert.equal(x.document.activeElement,x.target);
});
test('a canceled older generation cannot clear a newer generation token',async()=>{
  const slot=createFocusOperationSlot(),first={origin:null,revision:1},second={origin:null,revision:2};
  let finishOld;const old=new Promise(resolve=>{finishOld=resolve;});
  const oldOperation=slot.begin(first);const oldSettles=old.finally(()=>slot.end(oldOperation));
  const newOperation=slot.begin(second);finishOld();await oldSettles;
  assert.equal(slot.current(),second);slot.end(newOperation);assert.equal(slot.current(),null);
});
test('disposed ownership does not refocus and removes its listeners',()=>{
  const x=setup(),token=x.guard.capture();x.guard.dispose();x.guard.dispose();
  assert.equal(x.listeners.size,0);assert.equal(x.guard.focus(token,x.target),false);
});
