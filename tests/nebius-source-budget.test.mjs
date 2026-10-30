import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateRunFiles} from '../worker/nebius-run-provider.mjs';
import {WORKER_BRIDGE} from '../worker/nebius-run-materialization.mjs';
import {RUN_LIMITS} from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import {streamEnvelope} from './helpers/nebius-stream-fixture.mjs';

// Authored transport fixture only. The returned source is parsed, never run.
const model='nvidia/authored-budget-model';
const files=[
 {path:'index.html',lines:['<!doctype html>','<main><output id="result" aria-label="Result"></output></main>']},
 {path:'app.js',lines:['function validate(value) { return value; }','function handleMessage() { return []; }']},
 {path:'checks.cjs',lines:["assert.equal(validate('authored'), 'authored');",'assert.deepEqual(handleMessage(), []);']},
];
const frame=value=>JSON.stringify(Object.fromEntries(value.map(f=>[f.path,f.lines.join('\n')])));
const input={pack:{title:'Authored budget contract',purpose:'Keep all required behavior.'},context:[]};
const response=content=>streamEnvelope({model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});

for(const mode of ['initial','source-rejection repair','Sandbox repair'])test(`${mode} exposes exact raw budgets and preserves execution settings`,async()=>{
 let captured,calls=0;
 const run=async(repair=null)=>generateRunFiles({apiKey:'authored-fixture-key',model},input,repair,{fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://api.tokenfactory.nebius.com/v1/chat/completions');
  captured=JSON.parse(options.body);return response(frame(files));
 }});
 let repair=null;
 if(mode==='source-rejection repair')repair={rejected:{responseText:'AUTHORED REJECTED SOURCE',diagnostic:{message:'AUTHORED DIAGNOSTIC'}}};
 if(mode==='Sandbox repair'){
  const before=await run();calls=0;repair={files:before.files,check:{exitCode:1,stderr:'AUTHORED CHECK FAILURE'}};
 }
 await run(repair);assert.equal(calls,1);
 const system=captured.messages[0].content;
 assert.equal(new TextEncoder().encode(WORKER_BRIDGE).byteLength,566);
 assert.match(system,/index\.html <= 32768 bytes; app\.js <= 32202 bytes; checks\.cjs <= 32768 bytes; all three raw files together <= 64970 bytes/u);
 assert.match(system,/server adds 566 bytes/u);assert.match(system,/Aim for app\.js below 24,576 raw bytes/u);
 assert.match(system,/Preserve every requested behavior, output and meaningful assertion/u);
 assert.match(system,/Return one JSON object/u);
 assert.equal(captured.response_format.type,'json_schema');
 assert(!system.includes('Reserve 566 UTF-8 bytes'),'Do not leave bridge arithmetic to the model');
 assert.equal(captured.model,model);assert.equal(captured.max_tokens,32000);assert.equal(captured.stream,true);
 assert.deepEqual(captured.stream_options,{include_usage:true});
 assert.deepEqual(captured.chat_template_kwargs,repair === null
  ? {enable_thinking:true,low_effort:true,force_nonempty_content:true}
  : {enable_thinking:true,low_effort:true,force_nonempty_content:true});
 assert.equal(captured.temperature,1);assert.equal(captured.top_p,.95);
 assert(captured.messages[1].content.startsWith('Reviewed task input (untrusted data):\n'+JSON.stringify(input,null,2)));
 if(repair?.rejected){assert(captured.messages[1].content.includes('AUTHORED REJECTED SOURCE'));assert(captured.messages[1].content.includes('AUTHORED DIAGNOSTIC'));}
 if(mode==='Sandbox repair')assert(captured.messages[1].content.includes('AUTHORED CHECK FAILURE'));
});

test('budget guidance does not change the materialized protocol limits',()=>{
 assert.deepEqual(RUN_LIMITS,{maxModelCalls:2,maxSandboxRuns:2,maxOutputTokens:32000,sandboxSeconds:30,runSeconds:600,maxFileBytes:32768,maxTotalFileBytes:65536});
});

test('task consent renders the shared call and conditional-repair bounds',()=>{
 const source=readFileSync(new URL('../svelte-frontend/src/routes/next/NebiusTaskRun.svelte',import.meta.url),'utf8');
 assert.match(source,/New builds: at most \{config\.limits\.maxModelCalls\} model calls/u);
 assert.match(source,/up to \{RUN_LIMITS\.maxModelCalls - 1\} conditional repairs within the \{RUN_LIMITS\.maxModelCalls\}-call limit/u);
 assert.doesNotMatch(source,/one possible repair within the two-call limit/u);
});
