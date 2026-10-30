import test from 'node:test';
import assert from 'node:assert/strict';
import {generateRunFiles} from '../worker/nebius-run-provider.mjs';
import {WORKER_BRIDGE} from '../worker/nebius-run-materialization.mjs';
import {streamEnvelope} from './helpers/nebius-stream-fixture.mjs';

const model = 'nvidia/authored-framing-model';
const files = [
 {path:'index.html',source:'<!doctype html>\n<output id="result"></output>'},
 {path:'app.js',source:'function validate(value) { return value; }\nfunction handleMessage() { return []; }'},
 {path:'checks.cjs',source:"assert.equal(validate('ok'), 'ok');\nassert.deepEqual(handleMessage(), []);"},
];
const header=path=>'```'+(path==='index.html'?'html':'javascript')+' '+path;
const framed=(split=[])=>files.map(f=>(split.includes(f.path)?header(f.path).replace(' '+f.path,'\n'+f.path):header(f.path))+'\n'+f.source+'\n```').join('\n\n');
const transport=content=>async()=>streamEnvelope({model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});
const generate=content=>generateRunFiles({apiKey:'authored-only',model},{},null,{fetcher:transport(content)});
for(let mask=0;mask<8;mask++)test(`legacy fenced response ${mask} is rejected without fallback`,async()=>{
 const text=framed(files.filter((_,i)=>mask&(1<<i)).map(f=>f.path));
 await assert.rejects(generate(text),error=>{
  assert.equal(error.code,'invalid_model_output'); assert.equal(error.stage,'tool_files'); assert.equal(error.uncertain,false);
  assert.equal(error.response.responseText,text); assert.deepEqual(error.usage,{inputTokens:10,outputTokens:20});
  assert(error.message.length<240); return true;
 });
});
test('valid JSON source remains unchanged except for the server bridge',async()=>{
 const text=JSON.stringify(Object.fromEntries(files.map(f=>[f.path,f.source])));
 assert.deepEqual((await generate(text)).files,files.map(f=>({path:f.path,content:f.source+(f.path==='app.js'?WORKER_BRIDGE:'')})));
});
test('legacy CRLF framing is rejected and exact response is retained',async()=>{
 const text=('\n\n'+framed(files.map(f=>f.path))).replaceAll('\n','\r\n');
 await assert.rejects(generate(text),error=>{assert.equal(error.stage,'tool_files');assert.equal(error.response.responseText,text);return true;});
});
test('unrecognized source keys and their content never enter the diagnostic',async()=>{
 const secret='PRIVATE_UNKNOWN_PATH_94.js',text=JSON.stringify({[secret]:'PRIVATE_CONTENT',...Object.fromEntries(files.map(f=>[f.path,f.source]))});
 await assert.rejects(generate(text),error=>{assert.equal(error.stage,'tool_files');assert(!error.message.includes(secret));assert(!error.message.includes('PRIVATE_CONTENT'));return true;});
});
test('large invalid prefixes are rejected within bounded diagnostics',async()=>{
 const text='\n'.repeat(4097)+framed(['index.html']);
 await assert.rejects(generate(text),error=>{assert.equal(error.stage,'tool_files');assert(error.message.length<240);return true;});
});
