import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRunFiles } from '../worker/nebius-run-provider.mjs';

const model = 'nvidia/synthetic-code-model';
const fixture = () => [
  {path:'index.html',lines:['<!doctype html>','<output id="result"></output>']},
  {path:'app.js',lines:[
    'function validate(value) { return value; }',
    'function handleMessage() { return []; }',
    "if (typeof self !== 'undefined') self.onmessage = ({data}) => self.postMessage({patches:handleMessage(data)});",
    "if (typeof module !== 'undefined') module.exports = {validate};",
  ]},
  {path:'checks.cjs',lines:[
    "const assert = require('node:assert/strict');",
    "const {validate} = require('./app.js');",
    "assert.equal(validate('ok'), 'ok');",
  ]},
];

function mockedProvider(files, inspect = () => {}) {
  return async (url, options) => {
    assert.equal(url, 'https://api.tokenfactory.nebius.com/v1/chat/completions');
    inspect(JSON.parse(options.body));
    return Response.json({model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{
      finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({files})},
    }]});
  };
}
const generate = (files, inspect, repair = null) => generateRunFiles({apiKey:'synthetic-key',model},{},repair,{fetcher:mockedProvider(files,inspect)});

test('source line arrays become canonical content with real line boundaries', async () => {
  const files = fixture();
  const result = await generate(files, request => {
    const schema = request.response_format.json_schema;
    assert.equal(schema.strict, true);
    assert.deepEqual(schema.schema.properties.files.items.required, ['path','lines']);
    assert.equal(request.max_tokens, 8000);
  });
  assert.deepEqual(result.files, files.map(file=>({path:file.path,content:file.lines.join('\n')})));
  assert.deepEqual(result.usage,{inputTokens:10,outputTokens:20});
});

for (const [name, mutate] of [
  ['legacy content envelope', files => { files[2]={path:'checks.cjs',content:files[2].lines.join('\n')}; }],
  ['one packed line', files => { files[2].lines=[files[2].lines.join(' ')]; }],
  ['embedded newline', files => { files[2].lines[0]+='\n'; }],
  ['oversized line', files => { files[2].lines[0]='x'.repeat(1025); }],
  ['oversized Unicode line', files => { files[0].lines[1]=String.fromCodePoint(0x1f680).repeat(1025); }],
  ['too many lines', files => { files[2].lines=Array(1025).fill(''); }],
  ['line comments swallowing checks', files => { files[2].lines[1]+=' // assert.ok(true);'; }],
  ['block comments', files => { files[2].lines[2]='/* assertion omitted */'; }],
  ['console output', files => { files[2].lines.push("console.log('passed');"); }],
  ['file byte limit', files => { files[1].lines.push(...Array(40).fill('x'.repeat(1000))); }],
]) {
  test(`source generation rejects ${name}`, async () => {
    const files=fixture(); mutate(files);
    await assert.rejects(generate(files), error => error.code==='invalid_model_output'
      && ['tool_files','tool_checks'].includes(error.stage) && error.usage.outputTokens===20);
  });
}

test('Unicode line limit counts code points like JSON Schema', async () => {
  const files=fixture();
  files[0].lines[1]=String.fromCodePoint(0x1f680).repeat(1024);
  const result=await generate(files);
  assert.equal(result.files[0].content,files[0].lines.join('\n'));
});

test('repair preserves the maximum line count and canonical content exactly', async () => {
  const files=fixture();
  files[0].lines=[...files[0].lines,...Array(1022).fill('')];
  const generated=await generate(files);
  await generate(files, request => {
    const state=JSON.parse(request.messages[1].content);
    assert.deepEqual(state.previousFiles, files);
    assert.equal(state.observedCheck.exitCode,1);
  }, {files:generated.files,check:{exitCode:1,stderr:'A controlled check failed.'}});
});
