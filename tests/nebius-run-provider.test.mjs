import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { generateRunFiles, decodeSourceLines } from '../worker/nebius-run-provider.mjs';
import { validateRunChecksSyntax } from '../worker/nebius-run-checks.mjs';
import { validateGeneratedSource } from '../worker/nebius-run-admission.mjs';
import { RUN_MODEL_TIMEOUT_MS, validateRunRecord } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { streamEnvelope, streamEnvelopeBytes } from './helpers/nebius-stream-fixture.mjs';

const model = 'nvidia/synthetic-code-model';
const fixture = () => [
  {path:'index.html',lines:['<!doctype html>','<output id="result"></output>']},
  {path:'app.js',lines:[
    'function validate(value) { return value; }',
    "function handleMessage(message) { return [{id:'result',text:validate(message.values.input)}]; }",
  ]},
  {path:'checks.cjs',lines:[
    "assert.equal(validate('ok'), 'ok');",
    "assert.equal(handleMessage({type:'event',event:'input',id:'input',values:{input:'ok'}})[0].text, 'ok');",
  ]},
];

function fileBlocks(files) {
  return JSON.stringify(Object.fromEntries(files.map(file => [file.path, file.lines.join('\n')])));
}

function mockedProvider(files, inspect = () => {}) {
  return async (url, options) => {
    assert.equal(url, 'https://api.tokenfactory.nebius.com/v1/chat/completions');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.accept, 'text/event-stream');
    const request = JSON.parse(options.body);
    assert.equal(request.stream, true); assert.deepEqual(request.stream_options, { include_usage: true });
    inspect(request);
    return streamEnvelope({model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{
      finish_reason:'stop',message:{role:'assistant',content:typeof files==='string'?files:fileBlocks(files)},
    }]});
  };
}
const generate = (files, inspect, repair = null) => generateRunFiles({apiKey:'synthetic-key',model},{},repair,{fetcher:mockedProvider(files,inspect)});

for(const mode of ['initial','source-rejection repair','Sandbox repair'])test(`${mode} receives one generic consistency contract without changing reviewed input or wire settings`,async()=>{
  // Authored transport data only. These assertions verify request construction,
  // not model compliance, retained-source execution or a generated tool result.
  const input={pack:{title:'Authored inventory review',purpose:'Keep catalog values and visible labels distinct.',
    doneWhen:'Show the task-required availability limitation in the tool, including "quoted text".'},context:[]};
  const original=structuredClone(input),native=fixture();
  let repair=null;
  if(mode==='source-rejection repair')repair={rejected:{responseText:'Authored rejected source',diagnostic:{message:'checks.cjs:2:1 cannot compile in the trusted assertion wrapper.'}}};
  if(mode==='Sandbox repair'){
    const previous=await generate(native);
    repair={files:previous.files,check:{exitCode:1,stderr:'Authored literal label disagreement.'}};
    native[1].lines.push('// Authored replacement for wire inspection only.');
  }
  const originalRepair=structuredClone(repair);let requests=0;
  const result=await generateRunFiles({apiKey:'synthetic-key',model},input,repair,{fetcher:mockedProvider(native,request=>{
    requests++;const system=request.messages[0].content;
    const rules=[
      'decoded quote delimiters must be native quotes, not backslash-escaped source delimiters',
      'Comments or assertions in checks.cjs do not satisfy visible content requirements.',
      'including invalid-value cases: change the value under test, never the declared control ID.',
      'use explicit value-to-visible-label mappings consistently across the page, displayed selected/suggested results and checks.',
      'Capitalizing a wire value is not a reliable visible label.',
      'Derive boundary fixtures separately for each input from the reviewed task, never copy numeric boundary cases from the illustrative example. When a task specifies an inclusive range, both endpoints are valid unless an explicit additional constraint excludes them. Test outside values as invalid only when the task excludes them. Zero is valid when permitted and invalid when excluded; pass numeric values as strings for text controls.',
      'When one mutually exclusive option represents several effects, map the option\'s exact identity to each applicable effect. Do not infer its components from substrings of the option ID. Derive and independently check the combined option\'s result against the reviewed task; cover the individual options, combined option, and applicable tie rules.',
    ];
    for(const rule of rules)assert.equal(system.split(rule).length,2,'Each existing rule is strengthened once, without duplicated guidance.');
    assert.match(system,/Escapes inside source string literals remain valid JavaScript/u);
    assert.match(system,/never a literal backslash followed by n outside a JavaScript string/u);
    assert.doesNotMatch(rules.join(' '),/delay-days|target-day|expedite|No action|finishes day/u,'New guidance cannot embed recovery answers.');
    assert(request.messages[1].content.startsWith('Reviewed task input (untrusted data):\n'+JSON.stringify(input,null,2)));
    assert.equal(request.messages.length,2);assert.equal(request.model,model);assert.equal(request.max_tokens,32000);
    assert.equal(request.stream,true);assert.deepEqual(request.stream_options,{include_usage:true});
    assert.equal(request.response_format.type,'json_schema');assert.equal(request.response_format.json_schema.strict,true);
    assert.equal(request.response_format.json_schema.schema.additionalProperties,false);
    assert.equal(request.response_format.json_schema.name,mode==='Sandbox repair'?'browser_tool_replacements':'browser_tool_source');
    assert.deepEqual(request.chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
    assert.equal(request.temperature,1);assert.equal(request.top_p,.95);
  })});
  assert.equal(requests,1);assert.deepEqual(input,original);assert.deepEqual(repair,originalRepair);
  assert.equal(result.files.find(file=>file.path==='index.html').content,native[0].lines.join('\n'));
  assert.equal(result.files.find(file=>file.path==='checks.cjs').content,native[2].lines.join('\n'));
  assert(result.files.find(file=>file.path==='app.js').content.startsWith(native[1].lines.join('\n')));
});

for (const [binding, source] of [
  ['assert', "const assert = require('assert');"],
  ['validate', 'const validate = value => value;'],
  ['handleMessage', 'let { handleMessage } = {};'],
]) test(`checks syntax identifies only the supplied ${binding} collision`, () => {
  assert.throws(() => validateRunChecksSyntax(source), error => {
    assert.match(error.message, new RegExp('redeclares supplied ' + binding));
    assert.match(error.message, /^checks\.cjs:1:\d+ /u);
    assert(error.message.length <= 180);
    return true;
  });
});

test('unrelated or independently duplicated syntax errors remain generic and private', () => {
  for (const source of [
    'const PRIVATE_ASSERTION_DETAIL = ;',
    'let assert = 1; let assert = 2;',
    "const assert = require('assert'); const PRIVATE_UNFINISHED_DETAIL = ;",
  ]) assert.throws(() => validateRunChecksSyntax(source), error => {
    assert.match(error.message, /cannot compile in the trusted assertion wrapper/u);
    assert.doesNotMatch(error.message, /PRIVATE_ASSERTION_DETAIL|PRIVATE_UNFINISHED_DETAIL|redeclares supplied/u);
    return true;
  });
});

test('supplied-binding diagnostic never echoes an imported private module name', () => {
  assert.throws(() => validateRunChecksSyntax("const assert = require('PRIVATE_MODULE_NAME');"), error => {
    assert.match(error.message, /redeclares supplied assert/u);
    assert.doesNotMatch(error.message, /PRIVATE_MODULE_NAME/u);
    return true;
  });
});

test('checks reject the retained invalid comparison operator without repairing source', async () => {
  const files = fixture();
  files[2].lines.push('assert.ok(1 := 1);');
  const result = await generate(files);
  assert.equal(result.files[2].content, files[2].lines.join('\n'));
  await assert.rejects(validateGeneratedSource(result.files), error => error.code === 'invalid_model_output' && error.stage === 'tool_checks');
  assert.equal(files[2].lines.at(-1), 'assert.ok(1 := 1);');
  assert.doesNotThrow(() => validateRunChecksSyntax('assert.ok(1 === 1);'));
});

test('nested shadowing and textual mentions do not become runner-binding diagnostics', () => {
  assert.doesNotThrow(() => validateRunChecksSyntax([
    "// const assert = require('assert');",
    "const message = \"const validate = require('assert')\";",
    'function nested(assert, validate, handleMessage) { return assert && validate && handleMessage; }',
  ].join('\n')));
});

test('legacy fenced file blocks are rejected without fallback', async () => {
  const input = '```html index.html\n<!doctype html>\n```';
  await assert.rejects(generate(input), error => error.code === 'invalid_model_output' && error.stage === 'tool_files');
});

function authoredEnvelopeBytes(byteLength, { unit = 'x', files = fixture() } = {}) {
  const raw = { model, usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{
    finish_reason: 'stop', message: { role: 'assistant', content: fileBlocks(files), reasoning_content: 'AUTHORED_REASONING_NOT_RETAINED:' },
  }] };
  const encoder = new TextEncoder();
  // This is the decoded content+reasoning payload budget; SSE framing has its
  // own explicit limit. Do not count metadata as authored source.
  const remaining = byteLength - encoder.encode(raw.choices[0].message.content).byteLength
    - encoder.encode(raw.choices[0].message.reasoning_content).byteLength;
  assert(remaining >= 0);
  const unitBytes = encoder.encode(unit).byteLength;
  raw.choices[0].message.reasoning_content += unit.repeat(Math.floor(remaining / unitBytes)) + 'x'.repeat(remaining % unitBytes);
  assert.equal(encoder.encode(raw.choices[0].message.content).byteLength
    + encoder.encode(raw.choices[0].message.reasoning_content).byteLength, byteLength);
  return streamEnvelopeBytes(raw);
}

function authoredResponseStream(bytes, chunkBytes = 8191) {
  let offset = 0, cancelled = 0, completed = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (offset === bytes.byteLength) { completed = true; controller.close(); return; }
      const end = Math.min(offset + chunkBytes, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
    cancel() { cancelled += 1; },
  }, { highWaterMark: 0 });
  return { response: new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    observed: () => ({ bytesRead: offset, cancelled, completed, locked: stream.locked }) };
}

for (const [name, byteLength, unit] of [
  ['above the former 128 KiB limit', 128 * 1024 + 1, 'x'],
  ['exactly 512 KiB with split UTF-8 code points', 512 * 1024, '🚀'],
]) test(`provider envelope ${name} keeps only final source and usage`, async () => {
  const encoded = authoredEnvelopeBytes(byteLength, { unit });
  const transport = authoredResponseStream(encoded);
  let requests = 0;
  const result = await generateRunFiles({ apiKey: 'synthetic-key', model }, {}, null, {
    fetcher: async (_url, options) => { requests += 1; assert.equal(JSON.parse(options.body).max_tokens, 32000); return transport.response; },
  });
  assert.equal(requests, 1);
  assert.equal(result.files[0].content, fixture()[0].lines.join('\n'));
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 20 });
  assert.deepEqual(result.response, { responseText: fileBlocks(fixture()), retention: 'retained' });
  assert.doesNotMatch(JSON.stringify(result), /AUTHORED_REASONING_NOT_RETAINED|reasoning_content/u);
  assert.deepEqual(transport.observed(), { bytesRead: encoded.byteLength, cancelled: 1, completed: false, locked: false });
});

for (const [name, byteLength, chunkBytes, expectUnreadTail] of [
  ['one UTF-8 byte beyond 512 KiB', 512 * 1024 + 1, 8191, false],
  ['a large delivered chunk without consuming an unneeded tail', 2 * 1024 * 1024, 512 * 1024 + 1, true],
]) test(`provider envelope rejects ${name} and cancels the reader`, async () => {
  const encoded = authoredEnvelopeBytes(byteLength, { unit: '🚀' });
  const transport = authoredResponseStream(encoded, chunkBytes);
  let requests = 0;
  await assert.rejects(generateRunFiles({ apiKey: 'synthetic-key', model }, {}, null, {
    fetcher: async () => { requests += 1; return transport.response; },
  }), error => {
    assert.equal(error.code, 'generation_uncertain');
    assert.equal(error.stage, 'response');
    assert.equal(error.uncertain, true);
    assert.match(error.message, /byte bound/u);
    assert.equal(error.usage, null);
    assert.equal(error.response, null);
    assert.doesNotMatch(JSON.stringify(error), /AUTHORED_REASONING_NOT_RETAINED|function validate/u);
    return true;
  });
  assert.equal(requests, 1);
  const observed = transport.observed();
  assert(observed.bytesRead > 512 * 1024);
  assert.equal(observed.cancelled, 1);
  assert.equal(observed.completed, false);
  assert.equal(observed.locked, false);
  if (expectUnreadTail) assert(observed.bytesRead < encoded.byteLength);
});

test('provider envelope rejects malformed UTF-8 below the byte limit and releases the reader', async () => {
  const bytes = authoredEnvelopeBytes(160 * 1024);
  bytes[42] = 0xff;
  const transport = authoredResponseStream(bytes);
  await assert.rejects(generateRunFiles({ apiKey: 'synthetic-key', model }, {}, null, {
    fetcher: async () => transport.response,
  }), error => error.code === 'generation_uncertain' && error.uncertain === true && error.stage === 'response'
    && error.usage === null && error.response === null);
  assert.equal(transport.observed().cancelled, 1);
  assert.equal(transport.observed().locked, false);
});

test('a larger provider envelope still rejects a generated file above 32 KiB', async () => {
  const files = fixture();
  files[1].lines.push(...Array(33).fill('// ' + 'x'.repeat(997)));
  const transport = authoredResponseStream(authoredEnvelopeBytes(256 * 1024, { files }));
  await assert.rejects(generateRunFiles({ apiKey: 'synthetic-key', model }, {}, null, {
    fetcher: async () => transport.response,
  }), error => {
    assert.equal(error.stage, 'tool_files');
    assert.match(error.message, /A generated file exceeds its size limit/u);
    assert.deepEqual(error.usage, { inputTokens: 10, outputTokens: 20 });
    assert.equal(error.response.retention, 'retained');
    assert.equal(error.response.responseText, fileBlocks(files));
    assert.doesNotMatch(JSON.stringify(error.response), /AUTHORED_REASONING_NOT_RETAINED/u);
    return true;
  });
});

test('generation waits up to the shared four-minute response cap without raising output tokens', async t => {
  const original = globalThis.setTimeout, delays = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => { delays.push(delay); return original(callback, delay, ...args); });
  await generate(fixture(), request => assert.equal(request.max_tokens, 32000));
  assert.equal(RUN_MODEL_TIMEOUT_MS, 240000);
  assert.equal(delays[0], RUN_MODEL_TIMEOUT_MS);
});

test('a response timeout remains uncertain with unknown usage and no provider retry', async () => {
  let attempts = 0;
  await assert.rejects(generateRunFiles({apiKey:'synthetic-key',model},{},null,{timeoutMs:2,
    fetcher:async (_url, {signal}) => { attempts += 1; return new Promise((_resolve,reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), {once:true})); }
  }), error => error.code === 'generation_timeout' && error.uncertain === true && error.usage === null);
  assert.equal(attempts, 1);
});

test('native file blocks become materialized files with one server runtime bridge', async () => {
  const files = fixture();
  const result = await generate(files, request => {
    assert.equal(request.response_format.type,'json_schema');
    assert.match(request.messages[0].content,/Return one JSON object/u);
    assert.equal(request.max_tokens, 32000);
    assert.deepEqual(request.chat_template_kwargs, {enable_thinking:true,low_effort:true,force_nonempty_content:true});
    assert.match(request.messages[0].content, /The server adds the runtime bridge and exports/u);
    assert.match(request.messages[0].content, /runner supplies fixed assert, validate and handleMessage bindings to the ACTUAL app/u);
    assert.match(request.messages[0].content, /No DOM, browser emulation, shell, packages, network, secrets/u);
    assert.match(request.messages[0].content, /const expectedTotals =/u);
    assert.match(request.messages[0].content, /Distinguish malformed input from allowed incomplete states/u);
    assert.match(request.messages[0].content, /Every textual input\/textarea\/select declares data-input-format/u);
    assert.match(request.messages[0].content, /JSON document requires json even in a textarea/u);
    assert.match(request.messages[0].content, /The preview owns result announcements/u);
    assert.match(request.messages[0].content, /Never return an old result for new input/u);
    assert.match(request.messages[0].content, /an invalid enum must produce an input error/u);
    assert.match(request.messages[0].content, /Preserve task-required wording, facts and distinctions/u);
    assert.doesNotMatch(request.messages[0].content, /Input error:|1 gap:|demo-42/u);
  });
  for (const file of result.files) {
    const logic=files.find(source=>source.path===file.path).lines.join('\n');
    if (file.path==='app.js') {
      assert.ok(file.content.startsWith(logic+'\n;\n'));
      assert.equal(file.content.match(/self\.onmessage/g)?.length,1);
      assert.equal(file.content.match(/module\.exports/g)?.length,1);
    } else assert.equal(file.content,logic);
  }
  assert.deepEqual(result.usage,{inputTokens:10,outputTokens:20});
});

test('each generation mode receives its structured response schema and operation profile', async () => {
  const previous = await generate(fixture());
  for (const [mode, repair, schema, profile] of [
    ['initial generation', null, 'browser_tool_source', {enable_thinking:true,low_effort:true,force_nonempty_content:true}],
    ['Sandbox repair', {files:previous.files,check:{exitCode:1,stderr:'Authored failure.'}}, 'browser_tool_replacements', {enable_thinking:true,low_effort:true,force_nonempty_content:true}],
    ['source-rejection repair', {rejected:{responseText:'malformed',diagnostic:{message:'Invalid.'}}}, 'browser_tool_source', {enable_thinking:true,low_effort:true,force_nonempty_content:true}],
  ]) await generate(fixture(), request => {
    assert.match(request.messages[0].content, new RegExp('Current operation: '+mode));
    assert.ok(request.messages[0].content.includes('message.values["delay-days"]'));
    assert.ok(request.messages[0].content.includes('fixture key {"delay-days":"2"}'));
    assert.ok(request.messages[0].content.includes('never rename it to delayDays'));
    assert.ok(request.messages[0].content.includes('assert.equal(actual, expected)'));
    assert.ok(request.messages[0].content.includes('The operator := is not JavaScript.'));
    assert.match(request.messages[0].content, /Assert exact numeric results, option identities, statuses, required facts and patch IDs\/key shapes separately from incidental prose/u);
    assert.match(request.messages[0].content, /Match output wording exactly only when the reviewed task explicitly requires it/u);
    assert.match(request.messages[0].content, /bounded anchored parser or task-defined label mapping/u);
    assert.match(request.messages[0].content, /reject wrong values, negation, ambiguous multiple values and unknown labels/u);
    assert.match(request.messages[0].content, /Broad substring matches or nonempty text alone do not establish correct results/u);
    assert.match(request.messages[0].content, /Keep empty clearing and Reset\/control values exact/u);
    assert.match(request.messages[0].content, /Invalid input requires cleared results and a nonblank error/u);
    assert.match(request.messages[0].content, /Check option selection and tie rules, and require every caveat without accepting its negation/u);
    assert.equal(request.response_format.json_schema.name,schema);
    assert.equal(request.model,model);
    assert.deepEqual(Object.keys(request).sort(), ['chat_template_kwargs','max_tokens','messages','model','response_format','stream','stream_options','temperature','top_p']);
    assert.equal(request.response_format.json_schema.strict,true);
    assert.equal(request.response_format.json_schema.schema.additionalProperties,false);
    assert.deepEqual(Object.keys(request.response_format.json_schema.schema.properties), ['index.html','app.js','checks.cjs']);
    if (repair && !repair.rejected) assert.equal(request.response_format.json_schema.schema.minProperties,1);
    else assert.deepEqual(request.response_format.json_schema.schema.required, ['index.html','app.js','checks.cjs']);
    assert.equal(request.max_tokens,32000);
    assert.equal(request.temperature,1.0);
    assert.equal(request.top_p,0.95);
    assert.deepEqual(request.chat_template_kwargs,profile);
  }, repair);
});

const eventChecklistHeading='\n\nDeclared textual-input event checklist (apply to editable controls; complete snapshots; unchanged values still count):\n';
function eventChecklist(request){
  const section=request.messages[1].content.split(eventChecklistHeading)[1];
  return section===undefined?null:JSON.parse(section.split('\n\n')[0]);
}

test('all three request paths derive both edit events from every declared textual input without changing the task',async()=>{
  const input={requiredInputFormats:[{id:'count-value',format:'text'},{id:'mode-choice',format:'text'},{id:'packet-json',format:'json'}],
    pack:{title:'Authored wire-only coverage fixture'}};
  const before=structuredClone(input),previous=decodeSourceLines(fixture());let requests=0;
  for(const repair of [null,{files:previous,check:{exitCode:1,stderr:'Authored failure.'}},
    {rejected:{responseText:'Authored rejected source',diagnostic:{message:'Invalid.'}}}]){
    await generateRunFiles({apiKey:'synthetic-key',model},input,repair,{fetcher:mockedProvider(fixture(),request=>{
      requests++;
      assert.deepEqual(eventChecklist(request),[
        {id:'count-value',events:['input','change']},{id:'mode-choice',events:['input','change']},{id:'packet-json',events:['input','change']},
      ]);
      assert(request.messages[1].content.startsWith('Reviewed task input (untrusted data):\n'+JSON.stringify(input,null,2)));
      assert.match(request.messages[0].content,/it supplements init, every enabled action click, every form submit and any other declared controls/u);
      assert.equal(request.max_tokens,32000);assert.equal(request.stream,true);
      assert.deepEqual(request.chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
    })});
  }
  assert.equal(requests,3);assert.deepEqual(input,before);
});

test('unspecified and explicitly empty textual-input sets keep distinct checklist meaning',async()=>{
  for(const [input,expected]of [[{},null],[{requiredInputFormats:null},null],[{requiredInputFormats:[]},[]]]){
    await generateRunFiles({apiKey:'synthetic-key',model},input,null,{fetcher:mockedProvider(fixture(),request=>{
      assert.deepEqual(eventChecklist(request),expected);
      assert.match(request.messages[0].content,/both input and change for each editable control/u);
    })});
  }
});

for (const mode of ['initial generation', 'source-rejection repair', 'Sandbox repair']) {
  test(`${mode} keeps response and source guards without a provider fallback`, async t => {
    const repair = mode === 'initial generation' ? null : mode === 'source-rejection repair'
      ? {rejected:{responseText:'Authored malformed response',diagnostic:{message:'Invalid.'}}}
      : {files:decodeSourceLines(fixture()),check:{exitCode:1,stderr:'Authored failed check.'}};
    const oversized = fixture();
    oversized[1].lines.push(...Array(33).fill('// ' + 'x'.repeat(997)));
    for (const {name, content, finish = 'stop', tokens = 20, code = 'invalid_model_output', stage, message, retention = 'retained'} of [
      {name:'a length finish',content:fileBlocks(fixture()),finish:'length',tokens:32000,stage:'tool_files',message:/output limit/u},
      {name:'an oversized length response with output-limit diagnosis and omitted content',content:'x'.repeat(65536),finish:'length',tokens:32000,
        stage:'tool_files',message:/output limit/u,retention:'size_limit'},
      {name:'a JSON-escaped length response above the retention limit',content:'\u0001'.repeat(11000),finish:'length',tokens:32000,
        stage:'tool_files',message:/output limit/u,retention:'size_limit'},
      {name:'an oversized stop response at the unchanged retention gate',content:'x'.repeat(65536),
        stage:'response',message:/retained-evidence limit/u,retention:'size_limit'},
      {name:'reported usage above the requested ceiling',content:fileBlocks(fixture()),tokens:32001,
        code:'generation_failed',stage:'response',message:/output usage above the requested limit/u},
      {name:'reported usage above the requested ceiling despite length finish',content:fileBlocks(fixture()),finish:'length',tokens:32001,
        code:'generation_failed',stage:'response',message:/output usage above the requested limit/u},
      {name:'malformed source JSON',content:'Authored malformed JSON',stage:'tool_files',message:/Expected a JSON source object/u},
      {name:'a file above the bridge-inclusive limit',content:fileBlocks(oversized),stage:'tool_files',message:/A generated file exceeds its size limit/u},
    ]) await t.test(`rejects ${name}`, async () => {
      let requests = 0;
      await assert.rejects(generateRunFiles({apiKey:'synthetic-key',model},{},repair,{
        fetcher:async (url, options) => {
          requests += 1;
          assert.equal(url,'https://api.tokenfactory.nebius.com/v1/chat/completions');
          assert.equal(options.redirect,'manual');
          const request = JSON.parse(options.body);
          assert.equal(request.max_tokens,32000);
          assert.equal(request.stream,true);
          assert.deepEqual(request.stream_options,{include_usage:true});
          assert.deepEqual(request.chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
          return streamEnvelope({model,usage:{prompt_tokens:10,completion_tokens:tokens},choices:[{
            finish_reason:finish,message:{role:'assistant',content},
          }]});
        },
      }), error => {
        assert.equal(error.code,code);
        assert.equal(error.stage,stage);
        assert.equal(error.uncertain,false);
        assert.match(error.message,message);
        assert.deepEqual(error.usage,{inputTokens:10,outputTokens:tokens});
        assert.deepEqual(error.response,{responseText:retention === 'retained' ? content : null,retention});
        return true;
      });
      assert.equal(requests,1);
    });
  });
}

for (const mode of ['source-rejection repair', 'Sandbox repair']) {
  test(`${mode} keeps the request deadline uncertain without retrying`, async () => {
    const repair = mode === 'source-rejection repair'
      ? {rejected:{responseText:'Authored malformed response',diagnostic:{message:'Invalid.'}}}
      : {files:decodeSourceLines(fixture()),check:{exitCode:1,stderr:'Authored failed check.'}};
    let requests = 0;
    await assert.rejects(generateRunFiles({apiKey:'synthetic-key',model},{},repair,{timeoutMs:2,
      fetcher:async (_url, {body,signal}) => {
        requests += 1;
        assert.deepEqual(JSON.parse(body).chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
        return new Promise((_resolve,reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), {once:true}));
      },
    }), error => error.code === 'generation_timeout' && error.stage === 'generation'
      && error.uncertain === true && error.usage === null && error.response === null);
    assert.equal(requests,1);
  });
}

test('the authored contract example supplies complete source and uses injected checks bindings', async () => {
  let example;
  await generate(fixture(), request => {
    const marker = "no require/import or redeclaration belongs in checks.cjs.\n";
    const encoded = request.messages[0].content.split(marker)[1]?.split("\n\nCurrent operation:")[0];
    assert.ok(encoded);
    example = JSON.parse(encoded);
  });
  assert.deepEqual(Object.keys(example), ["index.html", "app.js", "checks.cjs"]);
  assert.doesNotThrow(() => decodeSourceLines(Object.entries(example).map(([path, text]) => ({path, lines:text.split("\n")}))));
  assert.doesNotThrow(() => validateRunChecksSyntax(example["checks.cjs"]));
  assert.match(example["checks.cjs"], /const starting =/u);
  assert.doesNotMatch(example["checks.cjs"], /function validate|function handleMessage|require\(/u);
});
for (const [name, mutate] of [
  ['one packed line', files => { files[2].lines=[files[2].lines.join(' ')]; }],
  ['bare carriage return', files => { files[2].lines[0]+='\rx'; }],
  ['Unicode line separator', files => { files[2].lines[0]+='\u2028'; }],
  ['oversized line', files => { files[2].lines[0]='x'.repeat(1025); }],
  ['oversized Unicode line', files => { files[0].lines[1]=String.fromCodePoint(0x1f680).repeat(1025); }],
  ['too many lines', files => { files[2].lines=Array(1025).fill(''); }],
  ['file byte limit', files => { files[1].lines.push(...Array(40).fill('x'.repeat(1000))); }],
]) {
  test(`source generation rejects ${name}`, async () => {
    const files=fixture(); mutate(files);
    await assert.rejects(generate(files), error => error.code==='invalid_model_output'
      && ['tool_files','tool_checks'].includes(error.stage) && error.usage.outputTokens===20);
  });
}

test('Unicode line limit counts code points', async () => {
  const files=fixture();
  files[0].lines[1]=String.fromCodePoint(0x1f680).repeat(1024);
  const result=await generate(files);
  assert.equal(result.files[0].content,files[0].lines.join('\n'));
});

test('ordinary comments and logging reach the trusted runtime assertion gate', async () => {
  const files=fixture();
  files[2].lines.splice(2,0,'// Check the supplied value','/* Synchronous assertion follows. */');
  files[2].lines.push("console.log('Untrusted success claim');");
  const result=await generate(files);
  assert.equal(result.files[2].content,files[2].lines.join('\n'));
});

test('checks use server-owned bindings without generated imports', async () => {
  const files=fixture();
  const result=await generate(files);
  assert.equal(result.files[2].content,files[2].lines.join('\n'));
  assert.doesNotMatch(result.files[2].content,/\brequire\b/u);
});

test('an exhausted reasoning-only response preserves usage without treating reasoning as files', async () => {
  await assert.rejects(generateRunFiles({ apiKey: 'synthetic-key', model }, {}, null, {
    fetcher: async (url, options) => {
      const request = JSON.parse(options.body);
      assert.deepEqual(request.chat_template_kwargs, { enable_thinking:true,low_effort:true,force_nonempty_content:true });
      assert.equal(request.max_tokens, 32000);
      return streamEnvelope({ model, usage: { prompt_tokens: 10, completion_tokens: 8000 }, choices: [{
        finish_reason: 'length', message: { role: 'assistant', content: null, reasoning_content: fileBlocks(fixture()) },
      }] });
    },
  }), error => {
    assert.equal(error.code, 'invalid_model_output');
    assert.equal(error.stage, 'tool_files');
    assert.match(error.message, /output limit/u);
    assert.deepEqual(error.usage, { inputTokens: 10, outputTokens: 8000 });
    assert.equal(error.response, null);
    assert.equal(error.uncertain, false);
    assert.doesNotMatch(JSON.stringify(error), /function validate|reasoning_content/u);
    return true;
  });
});

test('trusted oversized length diagnoses exhaustion while retaining only bounded metadata', async () => {
  const marker='AUTHORED_PRIVATE_EXHAUSTION_CONTENT';
  const content=marker+'x'.repeat(70000);
  let requests=0;
  await assert.rejects(generateRunFiles({apiKey:'synthetic-key',model},{},null,{
    fetcher:async()=>{
      requests++;
      return streamEnvelope({model,usage:{prompt_tokens:10,completion_tokens:32000,completion_tokens_details:{reasoning_tokens:32000}},
        choices:[{finish_reason:'length',message:{role:'assistant',content,reasoning_content:'AUTHORED_PRIVATE_REASONING'}}]});
    },
  }),error=>{
    assert.equal(error.code,'invalid_model_output');assert.equal(error.stage,'tool_files');assert.equal(error.uncertain,false);
    assert.equal(error.message,'Nebius reached the output limit before completing the tool files.');
    assert.deepEqual(error.response,{responseText:null,retention:'size_limit'});
    assert.deepEqual(error.usage,{inputTokens:10,outputTokens:32000});
    assert.deepEqual(error.responseDiagnostics,{finish:'length',model:'match',choices:'one',role:'assistant',content:'text',
      contentBytes:new TextEncoder().encode(content).byteLength,reasoning:'text',reasoningTokens:32000});
    assert.doesNotMatch(JSON.stringify(error),/AUTHORED_PRIVATE|x{30}/u);
    assert.doesNotMatch(JSON.stringify(error.responseDiagnostics),/AUTHORED_PRIVATE|x{30}/u);
    return true;
  });
  assert.equal(requests,1);
});

for(const [name,mutate] of [
  ['model mismatch',raw=>{raw.model='nvidia/other-model';}],
  ['wrong assistant role',raw=>{raw.choices[0].message.role='user';}],
  ['tool call',raw=>{raw.choices[0].message.tool_calls=[{}];}],
  ['invalid content type',raw=>{raw.choices[0].message.content={private:'AUTHORED_PRIVATE_CONTENT'};}],
  ['missing final usage',raw=>{delete raw.usage;}],
  ['contradictory usage totals',raw=>{raw.usage.total_tokens=32011;}],
  ['invalid reasoning token count',raw=>{raw.usage.completion_tokens_details={reasoning_tokens:32001};}],
])test(`an untrusted ${name} length response cannot claim known output exhaustion`,async()=>{
  const raw={model,usage:{prompt_tokens:10,completion_tokens:32000},choices:[{
    finish_reason:'length',message:{role:'assistant',content:'AUTHORED_PRIVATE_CONTENT'+'x'.repeat(70000)},
  }]};
  mutate(raw);let requests=0;
  await assert.rejects(generateRunFiles({apiKey:'synthetic-key',model},{},null,{
    fetcher:async()=>{requests++;return streamEnvelope(raw);},
  }),error=>{
    assert.equal(error.code,'generation_uncertain');assert.equal(error.stage,'response');assert.equal(error.uncertain,true);
    assert.equal(error.response,null);assert.equal(error.responseDiagnostics,null);assert.equal(error.usage,null);
    assert.doesNotMatch(error.message,/output limit|retained-evidence/u);
    assert.doesNotMatch(JSON.stringify(error),/AUTHORED_PRIVATE|x{30}/u);
    return true;
  });
  assert.equal(requests,1);
});

test('a length marker without confirmed stream completion remains uncertain',async()=>{
  const raw={model,usage:{prompt_tokens:10,completion_tokens:32000},choices:[{
    finish_reason:'length',message:{role:'assistant',content:'AUTHORED_PRIVATE_UNCONFIRMED'+'x'.repeat(70000)},
  }]};
  const bytes=streamEnvelopeBytes(raw),suffix=new TextEncoder().encode('data: [DONE]\n\n').byteLength;
  let requests=0;
  await assert.rejects(generateRunFiles({apiKey:'synthetic-key',model},{},null,{
    fetcher:async()=>{requests++;return new Response(bytes.subarray(0,bytes.length-suffix),{headers:{'content-type':'text/event-stream'}});},
  }),error=>{
    assert.equal(error.code,'generation_uncertain');assert.equal(error.uncertain,true);
    assert.equal(error.response,null);assert.equal(error.responseDiagnostics,null);
    assert.deepEqual(error.usage,{inputTokens:10,outputTokens:32000});
    assert.doesNotMatch(error.message,/output limit|retained-evidence/u);
    assert.doesNotMatch(JSON.stringify(error),/AUTHORED_PRIVATE|x{30}/u);
    return true;
  });
  assert.equal(requests,1);
});

test('repair preserves the maximum line count and canonical content exactly', async () => {
  const files=fixture();
  files[0].lines=[...files[0].lines,...Array(1022).fill('')];
  files[1].lines=[...files[1].lines,...Array(1022).fill('')];
  const generated=await generate(files);
  const repaired=await generate(files, request => {
    const prompt=request.messages[1].content;
    assert.ok(prompt.includes(fileBlocks(files)));
    assert.match(prompt, /"exitCode": 1/u);
    assert.equal(prompt.includes('self.onmessage'),false);
    assert.deepEqual(request.chat_template_kwargs, {enable_thinking:true,low_effort:true,force_nonempty_content:true});
    assert.equal(request.max_tokens,32000);
    assert.match(request.messages[0].content, /No DOM, browser emulation/u);
    assert.match(request.messages[0].content, /const expectedTotals =/u);
    assert.match(request.messages[0].content, /Distinguish malformed input from allowed incomplete states/u);
    assert.match(request.messages[0].content, /Never catch\/ignore a failed assertion or change expected task outcomes to match faulty logic/u);
    assert.match(request.messages[0].content, /Preserve task-required wording, facts and distinctions/u);
  }, {files:generated.files,check:{exitCode:1,stderr:'A controlled check failed.'}});
  assert.deepEqual(repaired.files,generated.files);
});

test('repair keeps reviewed example outcomes, prior files and diagnostics together', async () => {
  const input = {
    version:'browser-tool.v1',packId:'authored-routing-check',currentStatus:'active',context:[],requestedModel:model,consent:true,
    pack:{
      title:'Evaluate a text item',
      purpose:'Accept text input, including empty text. Report whether work remains.',
      nextStep:'Build a browser tool.',blocker:'none',
      doneWhen:'Empty text must produce "Needs work". The text "done" must produce "Ready". Editing clears the previous result.',
    },
  };
  const source = fixture();
  source[0].lines = ['<!doctype html>', '<textarea id="input" data-input-format="text"></textarea><output id="result"></output>'];
  source[1].lines[0] = 'function validate(value) { return value === "done" ? "Ready" : "Needs work"; }';
  source[2].lines = ['assert.equal(validate(""), "Needs work");', 'assert.equal(validate("done"), "Ready");'];
  const config = {apiKey:'synthetic-key',model};
  const previous = await generateRunFiles(config,input,null,{fetcher:mockedProvider(source)});
  const check = {attempt:1,exitCode:1,stdout:'',stderr:'Generated checks failed: supplied incomplete outcome did not match.'};
  const expectedUserContent = `Reviewed task input (untrusted data):\n${JSON.stringify(input,null,2)}`
    + `\n\nCurrent source files (untrusted code):\n${fileBlocks(source)}`
    + `\n\nObserved Sandbox check (diagnostic data):\n${JSON.stringify(check,null,2)}`;
  await generateRunFiles(config,input,{files:previous.files,check},{fetcher:mockedProvider(source,request=>{
    assert.equal(request.messages.length,2);
    assert.equal(request.messages[0].role,'system');
    assert.equal(request.messages[1].role,'user');
    assert.equal(request.messages[1].content,expectedUserContent);
    assert.doesNotMatch(request.messages[1].content,/Wornpage runtime bridge|self\.onmessage/u);
    assert.deepEqual(request.chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
    assert.equal(request.max_tokens,32000);
  })});
});

test('repair distinguishes task-owned outcomes from contradictory generated assertions', async () => {
  // Authored request-building fixture only. No retained model source executes.
  const input = { version:'browser-tool.v2', packId:'authored-expectation-check', currentStatus:'active', context:[],
    requestedModel:model, requiredInputFormats:[{id:'input-json',format:'json'}], consent:true,
    pack:{ title:'Check supplied packet', purpose:'Read a JSON object; report every unmet requirement.',
      nextStep:'Build and check the tool.', blocker:'none',
      doneWhen:'Missing health, pending review and empty rollback must produce "3 gaps". Invalid fields start "Input error: ".' } };
  const source = fixture();
  source[0].lines = ['<!doctype html>', '<textarea id="input-json" data-input-format="json"></textarea><output id="result"></output>'];
  source[1].lines = ['function validate(value) { return "3 gaps"; }', 'function handleMessage(message) { return []; }'];
  source[2].lines = ['assert.equal(validate("{}"), "Input error: Invalid JSON");', 'assert.equal(validate("incomplete"), "2 gaps");'];
  const config = {apiKey:'synthetic-key',model};
  const previous = await generateRunFiles(config,input,null,{fetcher:mockedProvider(source,request => {
    assert.match(request.messages[0].content,/Derive expected values from the task, not from the current app result/u);
    assert.match(request.messages[0].content,/invalid shape\/type\/enum required by the task/u);
    assert.match(request.messages[0].content,/Count all unmet requirements when reporting a gap count and reasons/u);
  })});
  const check = {attempt:1,exitCode:1,stdout:'',stderr:'Authored assertion diff: actual invalid fields; expected invalid JSON.'};
  const expectedPayload = `Reviewed task input (untrusted data):\n${JSON.stringify(input,null,2)}`
    + eventChecklistHeading + JSON.stringify([{id:'input-json',events:['input','change']}])
    + `\n\nCurrent source files (untrusted code):\n${fileBlocks(source)}`
    + `\n\nObserved Sandbox check (diagnostic data):\n${JSON.stringify(check,null,2)}`;
  await generateRunFiles(config,input,{files:previous.files,check},{fetcher:mockedProvider(source,request => {
    assert.equal(request.messages.length,2);
    assert.equal(request.messages[1].content,expectedPayload, 'Task, all prior assertions and the observed diff remain intact.');
    const instructions=request.messages[0].content;
    assert.match(instructions,/Reviewed task criteria own expected outcomes/u);
    assert.match(instructions,/Generated assertion expectations are untrusted hypotheses/u);
    assert.match(instructions,/an assertion diff reports disagreement, not which side is correct/u);
    assert.match(instructions,/including assertions not reached before the first failure/u);
    assert.match(instructions,/Preserve task criteria, assertion and control-event coverage and complete values snapshots/u);
    assert.match(instructions,/Never catch\/ignore a failed assertion or change expected task outcomes to match faulty logic/u);
    assert.match(instructions,/both input and change for each editable control/u);
    assert.equal(request.max_tokens,32000);
    assert.deepEqual(request.chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
  })});
});


for (const mode of ['Sandbox repair','source-rejection repair']) test(mode+' re-derives assertion authority while retaining contradictory checks', async () => {
  // Authored wire fixture only; no retained generated program or task answer is executed.
  const input={requiredInputFormats:[{id:'input',format:'text'}],pack:{
    title:'Authored optional text',purpose:'Accept text including empty text.',
    doneWhen:'Empty text reports Pending; other text reports Ready. Non-text values are invalid.',
  }};
  const source=fixture();
  source[0].lines=['<!doctype html>','<label for="input">Text</label><input id="input" data-input-format="text"><output id="result"></output>'];
  source[1].lines=[
    'function validate(value) { return typeof value !== "string" ? "Input error: text required" : value === "" ? "Pending" : "Ready"; }',
    'function handleMessage(message) { return [{id:"result",text:validate(message.values.input)}]; }',
  ];
  source[2].lines=[
    'assert.equal(validate(""), "Input error: empty text");',
    'assert.equal(validate("authored"), "Pending");',
    'assert.equal(handleMessage({type:"init",values:{input:""}})[0].text, "Input error: empty text");',
  ];
  const correctedChecks={path:'checks.cjs',lines:[
    'assert.equal(validate(""), "Pending");',
    'assert.equal(validate("authored"), "Ready");',
    'assert.equal(handleMessage({type:"init",values:{input:""}})[0].text, "Pending");',
  ]};
  const config={apiKey:'synthetic-key',model},originalInput=structuredClone(input);
  let initialRequests=0,initialSystem;
  const previous=await generateRunFiles(config,input,null,{fetcher:mockedProvider(source,request=>{
    initialRequests++;initialSystem=request.messages[0].content;
    assert.deepEqual(request.chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
  })});
  const check={attempt:1,exitCode:1,stdout:'',stderr:'Authored assertion disagreement: actual Pending; expected Input error: empty text.'};
  const rejected=structuredClone(source);rejected[2].lines.push('assert.equal(');
  const responseText=fileBlocks(rejected),diagnostic={message:'checks.cjs:4:1 cannot compile in the trusted assertion wrapper.'};
  const repair=mode==='Sandbox repair'?{files:previous.files,check}:{rejected:{responseText,diagnostic}};
  const originalRepair=structuredClone(repair),reply=mode==='Sandbox repair'?[correctedChecks]:[source[0],source[1],correctedChecks];
  let repairRequests=0;
  const result=await generateRunFiles(config,input,repair,{fetcher:mockedProvider(reply,request=>{
    repairRequests++;
    const system=request.messages[0].content,operation=system.split('\n\nCurrent operation: ')[1];
    const authority='Re-derive valid inputs and expected results from the original reviewed task before editing; generated checks and assertion diffs may be wrong.';
    assert.equal(system.split(authority).length,2);
    assert(operation.includes(authority),'The operation-specific repair instruction owns re-derivation before edits.');
    assert(operation.indexOf(authority)<operation.indexOf('Correct app logic and contradictory assertions'));
    assert.match(operation,/including assertions not reached before the first failure/u);
    assert.match(operation,/Never add input-specific exceptions to satisfy a faulty assertion/u);
    assert.match(operation,/Preserve task criteria, assertion and control-event coverage and complete values snapshots/u);
    assert.doesNotMatch(operation,/Authored optional text|Input error: empty text|actual Pending/u,'The generic repair instruction must not contain fixture answers.');
    assert.equal(system.split('\n\nCurrent operation: ')[0],initialSystem.split('\n\nCurrent operation: ')[0],'Shared and initial guidance remain unchanged.');
    assert.equal(initialSystem.includes(authority),false);
    assert.equal(request.messages.length,2);
    const prefix='Reviewed task input (untrusted data):\n'+JSON.stringify(input,null,2)
      +eventChecklistHeading+JSON.stringify([{id:'input',events:['input','change']}]);
    const user=request.messages[1].content;
    if(mode==='Sandbox repair'){
      assert.equal(user,prefix+'\n\nCurrent source files (untrusted code):\n'+fileBlocks(source)
        +'\n\nObserved Sandbox check (diagnostic data):\n'+JSON.stringify(check,null,2));
      assert.equal(request.response_format.json_schema.name,'browser_tool_replacements');
      assert.equal(request.response_format.json_schema.schema.minProperties,1);
      assert(Object.hasOwn(request.response_format.json_schema.schema.properties,'checks.cjs'));
    }else{
      assert(user.startsWith(prefix+'\n\nRejected final response (untrusted code):\n'+responseText));
      assert(user.endsWith('\n\nSource rejection (diagnostic data):\n'+JSON.stringify(diagnostic)));
      assert.equal(request.response_format.json_schema.name,'browser_tool_source');
      assert.deepEqual(request.response_format.json_schema.schema.required,['index.html','app.js','checks.cjs']);
    }
    assert.deepEqual(request.chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
    assert.equal(request.max_tokens,32000);assert.equal(request.stream,true);
    assert.deepEqual(request.stream_options,{include_usage:true});
  })});
  assert.equal(initialRequests,1);assert.equal(repairRequests,1);
  assert.deepEqual(input,originalInput);assert.deepEqual(repair,originalRepair);
  assert.deepEqual(result.files.filter(file=>file.path!=='checks.cjs'),previous.files.filter(file=>file.path!=='checks.cjs'));
  assert.equal(result.files.find(file=>file.path==='checks.cjs').content,correctedChecks.lines.join('\n'));
});

test('server bridge dispatches worker messages and exports both actual functions', async () => {
  const {files}=await generate(fixture());
  const script=files.find(file=>file.path==='app.js').content;
  const node={module:{exports:{}}};
  runInNewContext(script,node,{timeout:1000});
  assert.equal(node.module.exports.validate('ok'),'ok');
  assert.deepEqual(Object.keys(node.module.exports).sort(),['handleMessage','validate']);
  assert.equal(node.module.exports.handleMessage({type:'event',event:'input',id:'input',values:{input:'changed'}})[0].text,'changed');
  let reply;
  const worker={self:{postMessage:value=>{reply=value;}}};
  runInNewContext(script,worker,{timeout:1000});
  worker.self.onmessage({data:{type:'init',values:{input:'ok'}}});
  assert.deepEqual(JSON.parse(JSON.stringify(reply)),{patches:[{id:'result',text:'ok'}]});
});

test('server bridge rejects non-array message replies', async () => {
  const files=fixture();
  files[1].lines[1]='function handleMessage() { return {}; }';
  const generated=await generate(files);
  const worker={self:{postMessage:()=>assert.fail('An invalid reply must not be posted.')}};
  runInNewContext(generated.files[1].content,worker,{timeout:1000});
  assert.throws(()=>worker.self.onmessage({data:{type:'init',values:{}}}),/must return a patch array/u);
});

for (const missing of ['validate','handleMessage']) {
  test(`server bridge exposes missing ${missing} during isolated module loading`, async () => {
    const files=fixture();
    files[1].lines=files[1].lines.map(line=>line.startsWith('function '+missing+'(')?'// Missing required function':line);
    const generated=await generate(files);
    assert.throws(()=>runInNewContext(generated.files[1].content,{module:{exports:{}}},{timeout:1000}),/must define validate and handleMessage/u);
  });
}

test('a trailing line comment cannot hide the appended bridge', async () => {
  const files=fixture(); files[1].lines.push('// Last source line');
  const generated=await generate(files);
  const context={module:{exports:{}}};
  runInNewContext(generated.files[1].content,context,{timeout:1000});
  assert.equal(context.module.exports.validate('ok'),'ok');
});

test('app file size includes the server bridge', async () => {
  const files=fixture();
  while (files[1].lines.join('\n').length+1001<32768) files[1].lines.push(' '.repeat(1000));
  files[1].lines.push(' '.repeat(32768-files[1].lines.join('\n').length-1));
  assert.equal(files[1].lines.join('\n').length,32768);
  await assert.rejects(generate(files),error=>error.code==='invalid_model_output'&&error.stage==='tool_files');
});

for (const name of ['self','globalThis','onmessage','addEventListener','postMessage','module','exports']) {
  test(`generated logic cannot own the runtime bridge identifier ${name}`, async () => {
    const files=fixture(); files[1].lines.push('void '+name+';');
    await assert.rejects(generate(files),error=>error.code==='invalid_model_output'&&error.stage==='tool_worker'&&error.usage.outputTokens===20);
  });
}

for (const [name, source] of [
  ['self-dependency diagnostic', 'const diagnostic = "self-dependency";'],
  ['exact bridge words as data', 'const names = ["self", "globalThis", "onmessage", "addEventListener", "postMessage", "module", "exports"];'],
  ['line comment', '// self globalThis onmessage addEventListener postMessage module exports'],
  ['block comment', '/* self globalThis onmessage addEventListener postMessage module exports */'],
  ['regular expression', 'const pattern = /self|module|postMessage/u;'],
  ['static template', 'const diagnostic = `self-dependency; module.exports is unavailable`;'],
  ['safe template interpolation', 'const label = "dependency"; const diagnostic = `self-${label}`;'],
  ['escaped diagnostic string', 'const diagnostic = "\\u0073elf-dependency";'],
  ['ordinary indexed data', 'const values = [1]; const index = 0; const value = values[index];'],
  ['ordinary map data', 'const task = {id:"a"}; const tasks = {a:1}; const value = tasks[task.id];'],
  ['safe computed literal', 'const object = {safe:1}; const value = object["safe"];'],
  ['safe computed constant', 'const object = {safe:1}; const value = object["sa" + "fe"];'],
  ['numeric computed key', 'const values = [1]; const value = values[0];'],
  ['safe nested data path', 'const task = {ids:{first:"a"}}; const tasks = {a:1}; const value = tasks[task["ids"].first];'],
]) test(`bridge policy permits ${name} without rewriting source`, async () => {
  const files = fixture(); files[1].lines.push(source);
  const generated = await generate(files, request => {
    assert.match(request.messages[0].content, /Ordinary strings\/comments are allowed/u);
    assert.doesNotMatch(request.messages[0].content, /even in comments or strings/u);
  });
  assert(generated.files[1].content.startsWith(files[1].lines.join('\n') + '\n;\n'));
  assert.equal(generated.files[1].content.match(/self\.onmessage =/gu)?.length, 1);
});

for (const name of ['self','globalThis','onmessage','addEventListener','postMessage','module','exports']) {
  const escaped = '\\u' + name.charCodeAt(0).toString(16).padStart(4, '0') + name.slice(1);
  for (const [form, source] of [
    ['escaped identifier', `void ${escaped};`],
    ['binding', `const ${name} = {};`],
    ['dot member', `const object = {}; void object.${name};`],
    ['optional member', `const object = {}; void object?.["${name}"];`],
    ['computed string', `const object = {}; void object["${name}"];`],
    ['computed template', `const object = {}; void object[\`${name}\`];`],
    ['computed concatenation', `const object = {}; void object["${name.slice(0, 2)}" + "${name.slice(2)}"];`],
  ]) test(`bridge policy rejects ${name} through ${form}`, async () => {
    const files = fixture(); files[1].lines.push(source);
    await assert.rejects(generate(files), error => {
      assert.equal(error.code, 'invalid_model_output');
      assert.equal(error.stage, 'tool_worker');
      assert.deepEqual(error.usage, { inputTokens: 10, outputTokens: 20 });
      assert.equal(error.uncertain, false);
      assert.equal(error.response.responseText, fileBlocks(files));
      return true;
    });
  });
}

for (const [name, source] of [
  ['template expression', 'const diagnostic = `safe ${self}`;'],
  ['nested template expression', 'const diagnostic = `safe ${`nested ${globalThis}`}`;'],
  ['escaped computed key', 'const object = {}; void object["\\u0073elf"];'],
  ['interpolated computed key', 'const object = {}; const suffix = "Message"; void object[`post${suffix}`];'],
  ['partial computed concatenation', 'const object = {}; const suffix = "Message"; void object["post" + suffix];'],
  ['computed string method', 'const object = {}; void object["post".concat("Message")];'],
  ['computed sequence', 'const object = {}; void object[(0, "postMessage")];'],
  ['computed conditional', 'const object = {}; void object[true ? "postMessage" : "safe"];'],
  ['computed logical OR', 'let key; (function () {})[key || "constructor"]("return self")();'],
  ['computed logical AND', 'let key = true; (function () {})[key && "constructor"]("return self")();'],
  ['computed nullish selection', 'let key; (function () {})[key ?? "constructor"]("return self")();'],
  ['computed assignment', 'let key; (function () {})[key = "constructor"]("return self")();'],
  ['computed array coercion', '(function () {})[["constructor"]]("return self")();'],
  ['computed object coercion', '(function () {})[{toString() { return "constructor"; }}]("return self")();'],
  ['computed valueOf coercion', '(function () {})[{valueOf() { return "constructor"; }}]("return self")();'],
  ['computed boxed string', '(function () {})[new String("constructor")]("return self")();'],
  ['nested computed coercion', 'const keys = {}; (function () {})[keys[["constructor"]]]("return self")();'],
  ['direct eval', 'eval("self.onmessage = () => []");'],
  ['indirect eval', '(0, eval)("self.onmessage = () => []");'],
  ['aliased eval', 'const execute = eval; execute("self");'],
  ['Function call', 'Function("return self")();'],
  ['Function constructor', 'new Function("return self")();'],
  ['Function tag', 'Function`return self`();'],
  ['function constructor property', '(function () {}).constructor("return self")();'],
  ['computed constructor', '(function () {})["constructor"]("return self")();'],
  ['concatenated constructor', '(function () {})["con" + "structor"]("return self")();'],
  ['prototype property', 'void Object.prototype;'],
  ['legacy prototype property', 'const object = {}; void object.__proto__;'],
  ['Reflect constructor lookup', 'Reflect.get(function () {}, "constructor")("return self")();'],
  ['Object descriptor lookup', 'Object.getOwnPropertyDescriptor(function () {}, "constructor");'],
  ['Object prototype lookup', 'Object.getPrototypeOf(function () {});'],
  ['global this', 'void this;'],
  ['function this', 'function escape() { return this; }'],
  ['dynamic import', 'import("bridge");'],
  ['with scope', 'with ({}) { void 0; }'],
  ['wrapper arguments', 'function escape() { return arguments[0]; }'],
  ['require', 'require("bridge");'],
  ['unclosed comment', '/* PRIVATE_SOURCE_DO_NOT_ECHO'],
  ['unclosed string', 'const value = "PRIVATE_SOURCE_DO_NOT_ECHO;'],
  ['unclosed template', 'const value = `PRIVATE_SOURCE_DO_NOT_ECHO;'],
  ['static import', 'import bridge from "bridge";'],
  ['export declaration', 'export const bridge = 1;'],
  ['top-level return', 'return 1;'],
]) test(`bridge policy fails closed on ${name}`, async () => {
  const files = fixture(); files[1].lines.push(source);
  await assert.rejects(generate(files), error => {
    assert.equal(error.code, 'invalid_model_output');
    assert.equal(error.stage, 'tool_worker');
    assert.equal(error.uncertain, false);
    assert.doesNotMatch(error.message, /PRIVATE_SOURCE_DO_NOT_ECHO/u);
    assert.equal(error.response.responseText, fileBlocks(files));
    assert.deepEqual(error.usage, { inputTokens: 10, outputTokens: 20 });
    return true;
  });
});

test('materialized byte caps reject oversized invalid logic before syntax parsing', async () => {
  const files = fixture();
  files[1].lines = ['/*', ...Array.from({length:34}, () => 'a'.repeat(1000))];
  await assert.rejects(generate(files), error => error.code === 'invalid_model_output' && error.stage === 'tool_files');
});

test('diagnostic-only partial repair preserves exact source and a single server bridge', async () => {
  const original = await generate(fixture());
  const replacement = fixture()[1]; replacement.lines.push('const diagnostic = "self-dependency";');
  const repaired = await generate([replacement], undefined, {files:original.files, check:{exitCode:1, stderr:'Authored failure'}});
  assert(repaired.files[1].content.startsWith(replacement.lines.join('\n') + '\n;\n'));
  assert.equal(repaired.files[1].content.match(/self\.onmessage =/gu)?.length, 1);
  assert.equal(repaired.files[0].content, original.files[0].content);
  assert.equal(repaired.files[2].content, original.files[2].content);
});

test('generated logic still cannot reference forbidden browser APIs', async () => {
  const files=fixture(); files[1].lines.push('// fetch');
  await assert.rejects(generate(files),error=>error.code==='invalid_model_output'&&error.stage==='tool_worker');
});

test('repair refuses source without its exact bridge before requesting inference', async () => {
  const files=fixture(); const generated=await generate(files);
  generated.files[1].content+='\n';
  let called=false;
  await assert.rejects(generate(files,()=>{called=true;},{files:generated.files,check:{exitCode:1,stderr:'Controlled failure'}}),error=>error.code==='invalid_run_source');
  assert.equal(called,false);
});

for (const [name, tamper] of [
  ['missing bridge', source => source.slice(0, source.indexOf('\n;\n// Wornpage runtime bridge:'))],
  ['altered bridge', source => source.replace('self.postMessage({ patches });', 'self.postMessage({});')],
  ['open trailing comment', source => source + '\n/*'],
]) test(`repair rejects ${name} before requesting inference`, async () => {
  const saved = await generate(fixture());
  saved.files[1].content = tamper(saved.files[1].content);
  let called = false;
  await assert.rejects(generate(fixture(), () => { called = true; }, {files:saved.files, check:{exitCode:1, stderr:'Authored failure'}}), error => error.code === 'invalid_run_source' && error.stage === 'tool_worker');
  assert.equal(called, false);
});

test('repair cannot materialize duplicated server bridge code as model logic', async () => {
  const saved = await generate(fixture());
  const bridge = saved.files[1].content.slice(saved.files[1].content.indexOf('\n;\n// Wornpage runtime bridge:'));
  saved.files[1].content += bridge;
  await assert.rejects(generate([fixture()[0]], undefined, {files:saved.files, check:{exitCode:1, stderr:'Authored failure'}}), error => error.code === 'invalid_model_output' && error.stage === 'tool_worker');
});

test('malformed source object does not reveal private provider text', async () => {
  const marker = 'SYNTHETIC_PRIVATE_PROVIDER_TEXT';
  await assert.rejects(generate(marker + fileBlocks(fixture())), error => error.code === 'invalid_model_output'
    && error.stage === 'tool_files' && !error.message.includes(marker) && !JSON.stringify(error).includes(marker));
});

test('shared total-size rejection retains its safe diagnostic at the materialization gate',()=>{
  const files=fixture().map(file=>({...file,lines:[...file.lines,...Array(23).fill('x'.repeat(1024))]}));
  assert.throws(()=>decodeSourceLines(files),error=>{
    assert.match(error.message,/The generated tool exceeds its total size limit/u);
    assert.equal(error.stage,'tool_files');
    assert.equal(error.usage,null);
    return true;
  });
});

test('failed RunRecord preserves the parser reason and usage without inventing files or checks',async()=>{
  let failure;
  try { await generate('SYNTHETIC_REJECTED_SOURCE'); }
  catch (error) { failure=error; }
  assert.ok(failure);
  const record=validateRunRecord({
    id:'00000000-0000-4000-8000-000000000000',version:'browser-tool.v1',packId:'synthetic-task',
    pack:{title:'Build a tool',purpose:'Diagnose file format',nextStep:'Build the tool',blocker:'none',doneWhen:'Return the required files'},
    currentStatus:'active',context:[],requestedModel:model,status:'failed',attempt:0,
    createdAt:'2026-09-30T00:00:00.000Z',updatedAt:'2026-09-30T00:00:01.000Z',events:[],files:[],checks:[],
    usage:{modelCalls:1,...failure.usage,totalsComplete:true},error:failure.message,
    failure:{code:failure.code,stage:failure.stage},
  });
  assert.equal(record.error,failure.message);
  assert.match(record.error,/Expected a JSON source object/u);
  assert.deepEqual(record.failure,{code:'invalid_model_output',stage:'tool_files'});
  assert.deepEqual(record.usage,{modelCalls:1,inputTokens:10,outputTokens:20,totalsComplete:true});
  assert.deepEqual(record.files,[]);
  assert.deepEqual(record.checks,[]);
  assert.doesNotMatch(JSON.stringify(record),/SYNTHETIC_REJECTED_SOURCE/u);
  assert.throws(()=>validateRunRecord({...record,status:'ready'}),/The execution failure details are invalid/u);
  assert.throws(()=>validateRunRecord({...record,status:'ready',error:null,failure:null}),/A ready result needs observed successful checks/u);
});

test('native files preserve JavaScript escaping, indentation and trailing blank lines',async()=>{
  const files=fixture();
  files[1].lines.push('const quoted = "a\\nb\\\"c";','  // preserve indentation','');
  const generated=await generate(files);
  assert.ok(generated.files[1].content.startsWith(files[1].lines.join('\n')+'\n;\n'));
  const context={module:{exports:{}}};
  runInNewContext(generated.files[1].content,context,{timeout:1000});
  assert.equal(context.module.exports.validate('ok'),'ok');
});

test('CRLF file blocks normalize to LF without trimming source',async()=>{
  const files=fixture();files[0].lines.push('');
  const generated=await generate(fileBlocks(files).replace(/\n/g,'\r\n'));
  assert.equal(generated.files[0].content,files[0].lines.join('\n'));
});

test('repair replaces only named files and preserves other source exactly',async()=>{
  const original=await generate(fixture());
  const changed=fixture()[1];
  changed.lines[0]='function validate(value) { return value.trim(); }';
  const repaired=await generate([changed],request=>{
    assert.equal(request.response_format.type,'json_schema');
    assert.match(request.messages[0].content,/Return a JSON object of complete replacement source strings/u);
    assert.match(request.messages[0].content,/Omitted files remain byte-for-byte unchanged/u);
    assert.match(request.messages[0].content,/Omitted files remain byte-for-byte unchanged/u);
    assert.ok(request.messages[1].content.includes(fileBlocks(fixture())));
  },{files:original.files,check:{exitCode:1,stderr:'Controlled fixture error'}});
  assert.deepEqual(repaired.files[0],original.files[0]);
  assert.deepEqual(repaired.files[2],original.files[2]);
  assert.ok(repaired.files[1].content.startsWith(changed.lines.join('\n')+'\n;\n'));
  assert.equal(repaired.files[1].content.match(/self\.onmessage/g)?.length,1);
});

test('repair refuses an empty replacement without masking the failed check',async()=>{
  const original=await generate(fixture());
  await assert.rejects(generate('',undefined,{files:original.files,check:{exitCode:1,stderr:'Controlled failure'}}),error=>error.code==='invalid_model_output'&&error.stage==='tool_files');
});

test('changed repair files still pass ownership validation',async()=>{
  const original=await generate(fixture());
  const changed=fixture()[1];changed.lines.push('void self;');
  await assert.rejects(generate([changed],undefined,{files:original.files,check:{exitCode:1,stderr:'Controlled failure'}}),error=>error.code==='invalid_model_output'&&error.stage==='tool_worker');
});

test('missing checks does not mask an independent app syntax defect', async () => {
  const files = fixture().slice(0, 2);
  files[1].lines.push('const PRIVATE_IDENTIFIER_DO_NOT_ECHO = ;');
  const response = fileBlocks(files);
  await assert.rejects(generate(response), error => {
    assert.equal(error.stage, 'tool_files');
    assert.match(error.message, /Missing required source files: checks\.cjs\./u);
    assert.match(error.message, /app\.js:3:\d+ is not a valid standalone JavaScript/u);
    assert.doesNotMatch(error.message, /PRIVATE_IDENTIFIER_DO_NOT_ECHO/u);
    assert(error.message.length <= 500);
    assert.equal(error.response.responseText, response);
    assert.deepEqual(error.usage, { inputTokens: 10, outputTokens: 20 });
    return true;
  });
});

test('source repair receives the complete bounded diagnostic without a new retry path', async () => {
  const files = fixture().slice(0, 2);
  files[1].lines.push('const invalid = ;');
  let first;
  try { await generate(files); } catch (error) { first = error; }
  assert(first);
  const repair = { rejected: { responseText: first.response.responseText,
    diagnostic: { code: first.code, stage: first.stage, message: first.message } } };
  const result = await generate(fixture(), request => {
    assert.equal(request.max_tokens, 32000);
    assert.match(request.messages[0].content, /This is a conditional repair within the existing model-call limit/u);
    const diagnostic = JSON.parse(request.messages[1].content.split('Source rejection (diagnostic data):\n')[1]);
    assert.equal(diagnostic.message, first.message);
    assert.match(diagnostic.message, /Missing required source files: checks\.cjs\./u);
    assert.match(diagnostic.message, /app\.js:3:/u);
  }, repair);
  assert.equal(result.files.length, 3);
});

test('app and checks syntax locations are reported together before materialization', async () => {
  const files = fixture();
  files[1].lines.push('const APP_PRIVATE_NAME = ;');
  files[2].lines.push('const CHECKS_PRIVATE_NAME = ;');
  await assert.rejects(generate(files), error => {
    assert.equal(error.stage, 'tool_worker');
    assert.match(error.message, /app\.js:3:\d+/u);
    assert.match(error.message, /checks\.cjs:3:\d+ cannot compile/u);
    assert.doesNotMatch(error.message, /APP_PRIVATE_NAME|CHECKS_PRIVATE_NAME/u);
    assert(error.message.length <= 500);
    return true;
  });
});

test('missing page and bad scripts remain a rejected incomplete set', async () => {
  const files = fixture().slice(1);
  files[0].lines.push('const invalidApp = ;');
  files[1].lines.push('const invalidChecks = ;');
  await assert.rejects(generate(files), error => {
    assert.equal(error.stage, 'tool_files');
    assert.match(error.message, /Missing required source files: index\.html\./u);
    assert.match(error.message, /app\.js:3:/u);
    assert.match(error.message, /checks\.cjs:3:/u);
    assert(error.message.length <= 500);
    return true;
  });
});

test('incomplete sources retain the runtime bridge ownership rejection', async () => {
  const files = fixture().slice(0, 2);
  files[1].lines.push('self.postMessage({});');
  await assert.rejects(generate(files), error => error.stage === 'tool_files'
    && /Missing required source files/u.test(error.message)
    && /reserved runtime bridge/u.test(error.message));
});

test('incomplete oversized sources fail before script diagnostics', async () => {
  const files = fixture().slice(0, 2);
  files[1].lines = ['const invalid = ;', ...Array(34).fill('x'.repeat(1024))];
  await assert.rejects(generate(files), error => {
    assert.equal(error.stage, 'tool_files');
    assert.match(error.message, /A generated file exceeds its size limit/u);
    assert.doesNotMatch(error.message, /standalone JavaScript/u);
    return true;
  });
});

const rejectedContextHeading = '\n\nCompiler source excerpts (untrusted code; locations refer to rejected originals):\n';
function requestRejectedContext(request) {
  const section = request.messages[1].content.split(rejectedContextHeading)[1];
  return section ? JSON.parse(section.split('\n\nSource rejection (diagnostic data):\n')[0]) : null;
}
const sourceRejection = (responseText, message) => ({ rejected: { responseText,
  diagnostic: { code: 'invalid_model_output', stage: 'tool_worker', message } } });

test('source repair targets both retained compiler originals and audits the full task within the same request contract', async () => {
  const rejectedFiles = fixture();
  rejectedFiles[1].lines.push(...Array(135).fill('// retained source before the faulty original'),
    '  const options = [',
    "    { id: 'none', expedite: false, help: false },",
    "    { id: 'expedite': true, help: false },",
    '  ];',
    '  const opts = [',
    "    { id: 'expedite', expedite: true, help: false }",
    '  ];');
  rejectedFiles[2].lines = [
    '// Test validate',
    'assert.strictEqual(validate({}), Missing delay-days);',
    "assert.equal(validate('ok'), 'ok');",
  ];
  const responseText = fileBlocks(rejectedFiles);
  let first, requests = 0;
  try { await generate(rejectedFiles, () => { requests += 1; }); } catch (error) { first = error; }
  assert(first);
  assert.equal(first.message, 'app.js:140:21 is not a valid standalone JavaScript script. Complete expressions and closing delimiters.'
    + ' | checks.cjs:2:42 cannot compile in the trusted assertion wrapper. Complete expressions and closing delimiters.');
  assert.equal(first.response.responseText, responseText);
  assert.doesNotMatch(JSON.stringify(first), /Missing delay-days|id: 'expedite'/u);
  const repair = sourceRejection(first.response.responseText, first.message);
  const before = structuredClone(repair);
  const repaired = await generate(fixture(), request => {
    requests += 1;
    const system = request.messages[0].content;
    assert.equal(request.messages.length, 2);
    assert.match(system, /Return all three complete files exactly once as JSON object keys/u);
    assert.match(system, /No previous file is implicitly kept/u);
    assert.match(system, /Replace faulty statements or definitions; remove superseded or duplicate variants instead of appending alternatives/u);
    assert.match(system, /Never add input-specific exceptions to satisfy a faulty assertion/u);
    assert.match(system, /Re-derive valid inputs and expected results from the original reviewed task before editing/u);
    assert.match(system, /Preserve task criteria, assertion and control-event coverage and complete values snapshots/u);
    assert.match(system, /EVERY enabled action control.*submit for EVERY form/u);
    assert.match(system, /both input and change for each editable control after displaying an output/u);
    assert.match(system, /full current values snapshot/u);
    assert.match(system, /This is a conditional repair within the existing model-call limit/u);
    assert.doesNotMatch(system, /Omitted files remain byte-for-byte unchanged/u);
    assert.equal(request.max_tokens, 32000);
    assert.equal(request.temperature, 1.0);
    assert.equal(request.top_p, 0.95);
    assert.deepEqual(request.chat_template_kwargs, { enable_thinking: true, low_effort: true, force_nonempty_content: true });
    assert(request.messages[1].content.includes('\n\nRejected final response (untrusted code):\n' + responseText + rejectedContextHeading));
    const context = requestRejectedContext(request);
    assert.deepEqual(context.excerpts.map(({ path, line, column }) => ({ path, line, column })), [
      { path: 'app.js', line: 140, column: 21 }, { path: 'checks.cjs', line: 2, column: 42 },
    ]);
    assert.deepEqual(context.excerpts[0].lines, rejectedFiles[1].lines.slice(137, 142).map((source, index) => ({ line: 138 + index, source })));
    assert.deepEqual(context.excerpts[1].lines, rejectedFiles[2].lines.map((source, index) => ({ line: index + 1, source })));
    assert.equal(context.omittedLocations, 0);
    const diagnostic = JSON.parse(request.messages[1].content.split('Source rejection (diagnostic data):\n')[1]);
    assert.deepEqual(diagnostic, repair.rejected.diagnostic);
  }, repair);
  assert.equal(requests, 2);
  assert.deepEqual(repair, before);
  assert.equal(repaired.files.length, 3);
  assert.equal(repaired.files[0].content, fixture()[0].lines.join('\n'));
  assert.equal(repaired.files[2].content, fixture()[2].lines.join('\n'));
});

for (const [name, mutate] of [
  ['unknown filename', text => text.replace('app.js', 'private.js')],
  ['duplicate filename', text => text.replace('{', '{"app.js":"extra",')],
  ['truncated object', text => text.slice(0, -1)],
  ['prose outside object', text => text + 'Untrusted explanation'],
  ['unsupported source separator', text => text.replace('return value;', 'return\\u2028value;')],
]) test(`source repair invents no excerpts for ${name}`, async () => {
  const responseText = mutate(fileBlocks(fixture()));
  await generate(fixture(), request => {
    assert.equal(requestRejectedContext(request), null);
    assert(request.messages[1].content.includes('\n' + responseText + '\n\nSource rejection (diagnostic data):\n'));
  }, sourceRejection(responseText, 'app.js:1:1 is not a valid standalone JavaScript script.'));
});

for (const [name, mutate, message] of [
  ['too few source lines', files => { files[1].lines = ['const invalid = ;']; }],
  ['too many source lines', files => { files[1].lines = Array(1025).fill('// line'); }],
  ['oversized source line', files => { files[1].lines[0] = 'x'.repeat(1025); }],
  ['oversized Unicode source line', files => { files[1].lines[0] = '🚀'.repeat(1025); }],
  ['oversized retained response', files => { files[1].lines = Array(80).fill('// ' + 'x'.repeat(997)); }],
  ['oversized diagnostic', () => {}, 'app.js:1:1 ' + 'x'.repeat(500)],
]) test(`source repair bounds feedback for ${name} without changing retained source`, async () => {
  const files = fixture(); mutate(files);
  const responseText = fileBlocks(files);
  await generate(fixture(), request => {
    assert.equal(requestRejectedContext(request), null);
    assert(request.messages[1].content.includes('\n' + responseText + '\n\nSource rejection (diagnostic data):\n'));
  }, sourceRejection(responseText, message ?? 'app.js:1:1 is not a valid standalone JavaScript script.'));
});

for (const message of [
  'private.js:1:1 cannot compile.',
  'private/app.js:1:1 cannot compile.',
  'not-app.js:1:1 cannot compile.',
  'Compiler says app.js:1:1 cannot compile.',
  'app.js:0:1 cannot compile.',
  'app.js:1:0 cannot compile.',
  'app.js:3:1 cannot compile.',
  'app.js:1:9999 cannot compile.',
  'app.js:10000:1 cannot compile.',
  'app.js:1.5:1 cannot compile.',
  'app.js:-1:1 cannot compile.',
  'app.js:1:1suffix cannot compile.',
]) test(`source repair ignores an untrusted or out-of-range location: ${message}`, async () => {
  await generate(fixture(), request => assert.equal(requestRejectedContext(request), null), sourceRejection(fileBlocks(fixture()), message));
});

test('source repair excerpts preserve authored source text and deduplicate exact locations', async () => {
  const files = fixture();
  files[1].lines.push('  // source indentation and trailing spaces  ', '');
  files[2].lines.push('// "untrusted source" contains a \\ and ``` text');
  const responseText = fileBlocks(files).replaceAll('\n', '\r\n');
  await generate(fixture(), request => {
    const context = requestRejectedContext(request);
    assert.deepEqual(context.excerpts.map(({ path, line, column }) => ({ path, line, column })), [
      { path: 'checks.cjs', line: 3, column: 1 }, { path: 'app.js', line: 3, column: 1 },
    ]);
    assert.deepEqual(context.excerpts[0].lines.map(entry => entry.source), files[2].lines);
    assert.deepEqual(context.excerpts[1].lines.map(entry => entry.source), files[1].lines);
    assert.equal(context.omittedLocations, 0);
    assert(request.messages[1].content.includes(responseText));
  }, sourceRejection(responseText, 'checks.cjs:3:1 cannot compile. | app.js:3:1 cannot compile. | app.js:3:1 cannot compile.'));
});

test('source repair caps excerpt locations and aggregate lines with explicit omissions', async () => {
  const files = fixture();
  files[1].lines = Array.from({ length: 40 }, (_, index) => '// original line ' + (index + 1));
  const message = Array.from({ length: 8 }, (_, index) => 'app.js:' + (3 + index * 5) + ':1 cannot compile.').join(' | ');
  await generate(fixture(), request => {
    const context = requestRejectedContext(request);
    assert.equal(context.excerpts.length, 6);
    assert.equal(context.excerpts.flatMap(excerpt => excerpt.lines).length, 30);
    assert.equal(context.omittedLocations, 2);
    assert.deepEqual(context.excerpts.map(excerpt => excerpt.line), [3, 8, 13, 18, 23, 28]);
    assert(new TextEncoder().encode(JSON.stringify(context)).byteLength <= 16384);
  }, sourceRejection(fileBlocks(files), message));
});

test('source repair byte bound omits an oversized excerpt without fabricating or truncating source lines', async () => {
  const files = fixture();
  files[1].lines = Array(5).fill('// ' + '🚀'.repeat(1021));
  const responseText = fileBlocks(files);
  await generate(fixture(), request => {
    const context = requestRejectedContext(request);
    assert.deepEqual(context, { excerpts: [], omittedLocations: 1 });
    assert(new TextEncoder().encode(JSON.stringify(context)).byteLength <= 16384);
    assert(request.messages[1].content.includes(responseText));
  }, sourceRejection(responseText, 'app.js:3:1 cannot compile.'));
});

test('source-rejection repair still rejects incomplete replacements rather than reusing rejected files', async () => {
  const repair = sourceRejection(fileBlocks(fixture()), 'app.js:1:1 is not a valid standalone JavaScript script.');
  await assert.rejects(generate([fixture()[1]], undefined, repair), error => error.code === 'invalid_model_output'
    && error.stage === 'tool_files' && /Missing required source files: index\.html, checks\.cjs/u.test(error.message));
});
