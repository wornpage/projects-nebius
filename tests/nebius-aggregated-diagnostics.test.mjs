import test from 'node:test';
import assert from 'node:assert/strict';
import {generateRunFiles,decodeSourceLines} from '../worker/nebius-run-provider.mjs';
import {validateGeneratedSource} from '../worker/nebius-run-admission.mjs';
import {AUTHORING_EXAMPLE} from '../worker/nebius-run-authoring-example.mjs';
import {streamEnvelope} from './helpers/nebius-stream-fixture.mjs';

// Authored invalid example: two independent errors, with no retained provider data.
const raw={
  ...AUTHORING_EXAMPLE,
  'index.html':'<!doctype html>\n<html><head><title>Example</title></head><body><label for="delay-days">Delay</label><input id="delay-days" data-input-format="text"><label for="target-day">Target</label><input id="target-day" data-input-format="text"><label for="choice">Choice</label><input id="choice" data-input-format="text"><div id="comparison"></div><output id="selection"></output><output id="next-action"></output><output id="error"></output></body></html>',
  'app.js':'// Authored failure\nfunction validate(values {',
};
const original=Buffer.from(JSON.stringify(raw),'utf8');const model='nvidia/offline-aggregated-diagnostics';
const input={requiredInputFormats:['delay-days','target-day','choice'].map(id=>({id,format:'text'})),requiredOutputs:['comparison','selection','next-action','error'].map(id=>({id,format:'text'}))};
const envelope=text=>streamEnvelope({model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]});
const asLines=source=>Object.entries(source).map(([path,content])=>({path,lines:content.split('\n')}));

test('authored invalid example reports both app syntax and declared div-output failures to the one repair prompt',async()=>{
 let failure;
 try { await generateRunFiles({apiKey:'synthetic',model},input,null,{fetcher:async()=>envelope(original.toString('utf8'))}); }
 catch(error){failure=error;}
 assert(failure);assert.equal(failure.code,'invalid_model_output');assert.equal(failure.stage,'tool_worker');
 assert.match(failure.message,/app\.js:\d+:\d+/u);
 assert.match(failure.message,/Required output comparison must use an output element/u);
 assert(failure.message.length<=500);
 let calls=0;
 await generateRunFiles({apiKey:'synthetic',model},input,{rejected:{responseText:original.toString('utf8'),diagnostic:{code:failure.code,stage:failure.stage,message:failure.message}}},{fetcher:async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);
  assert.match(body.messages[0].content,/<output id="\.\.\."> element, not a div/u);
  assert.match(body.messages[0].content,/checks must not require nonexistent input patches on init/u);
  assert.match(body.messages[0].content,/do not put it only in hidden content/u);
  assert(body.messages[1].content.includes(failure.message));
  assert.match(body.messages[1].content,/app\.js:\d+:\d+/u);
  assert.match(body.messages[1].content,/Required output comparison must use an output element/u);
  return envelope(JSON.stringify(AUTHORING_EXAMPLE));
 }});
 assert.equal(calls,1);
});

test('syntax-only failure remains a rejected worker without invented output errors',()=>{
 const files=asLines(AUTHORING_EXAMPLE);
 files.find(f=>f.path==='app.js').lines[0]='function validate(values {';
 assert.throws(()=>decodeSourceLines(files),error=>error.stage==='tool_worker'&&!/Required output/u.test(error.message));
});

test('bounded feedback retains app, checks and page categories when all three fail',()=>{
 const files=asLines(raw);
 files.find(f=>f.path==='checks.cjs').lines=['const assert = 1;','function incomplete( {'];
 assert.throws(()=>decodeSourceLines(files,input),error=>{
  assert.match(error.message,/app\.js:\d+:\d+/u);
  assert.match(error.message,/checks\.cjs:\d+:\d+/u);
  assert.match(error.message,/Required output comparison must use an output element/u);
  assert(error.message.length<=500);return true;
 });
});

test('valid authored files remain materializable and pass the unchanged static admission',async()=>{
 const files=decodeSourceLines(asLines(AUTHORING_EXAMPLE));
 await assert.doesNotReject(()=>validateGeneratedSource(files));
});

test('initial prompt distinguishes initialized HTML, init output patches, Reset and visible caveats',async()=>{
 let seen=false;
 await generateRunFiles({apiKey:'synthetic',model},{},null,{fetcher:async(_url,options)=>{
  seen=true;const system=JSON.parse(options.body).messages[0].content;
  assert.match(system,/<output id="\.\.\."> element, not a div/u);
  assert.match(system,/checks must not require nonexistent input patches on init/u);
  assert.match(system,/For requested Reset\/examples, values are PRE-click/u);
  assert.match(system,/do not put it only in hidden content/u);
  return envelope(JSON.stringify(AUTHORING_EXAMPLE));
 }});
 assert(seen);
});

test('malformed, incomplete and oversized input stays rejected before page-contract diagnostics',()=>{
 assert.throws(()=>decodeSourceLines([{path:'index.html',lines:['<div id="comparison"></div>','ok']} ,{path:'app.js',lines:['function bad( {','bad']}]),error=>/Missing required source files/u.test(error.message)&&!/Required output/u.test(error.message));
 const oversized=asLines(raw);oversized.find(f=>f.path==='index.html').lines[0]='x'.repeat(1025);
 assert.throws(()=>decodeSourceLines(oversized,input),error=>/source line 1 exceeds/u.test(error.message)&&!/Required output/u.test(error.message));
 assert.throws(()=>decodeSourceLines([{path:'index.html',lines:'not-an-array'}]),error=>/Source lines must follow/u.test(error.message));
});
