import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceObject } from '../worker/nebius-run-json.mjs';
import { generateRunFiles } from '../worker/nebius-run-provider.mjs';
import { WORKER_BRIDGE } from '../worker/nebius-run-materialization.mjs';
import { validateGeneratedSource } from '../worker/nebius-run-admission.mjs';
import { RUN_EVIDENCE_LIMITS, runJsonBytes } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { streamEnvelope } from './helpers/nebius-stream-fixture.mjs';

const names = ['index.html', 'app.js', 'checks.cjs'];
const parse = (text, requireAll = true) => parseSourceObject(text, { maxBytes: 200000, allowed: names, requireAll });
const base = {'index.html':'<!doctype html>\n<output id="result"></output>', 'app.js':"function validate(value) { return value; }\nfunction handleMessage(message) { return [{id:'result',text:validate(message.values.input)}]; }", 'checks.cjs':"assert.equal(validate('ok'), 'ok');\nassert.equal(handleMessage({type:'event',event:'input',id:'input',values:{input:'ok'}})[0].text, 'ok');"};
const model = 'nvidia/synthetic-code-model';
const call = (content, inspect = () => {}, repair = null) => generateRunFiles({apiKey:'fake', model}, {}, repair, {fetcher: async (_url, init) => {
  inspect(JSON.parse(init.body));
  return streamEnvelope({model, usage:{prompt_tokens:10,completion_tokens:20}, choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});
}});

test('valid source JSON preserves source and requests constrained schema', async () => {
  const out = await call(JSON.stringify(base), request => {
    assert.equal(request.response_format.type, 'json_schema');
    assert.deepEqual(request.response_format.json_schema.schema.required, names);
    assert.equal(request.response_format.json_schema.schema.additionalProperties, false);
    assert.equal(request.max_tokens, 32000);
    assert.equal(request.stream, true);
  });
  assert.equal(out.files[0].content, base['index.html']);
  assert.ok(out.files[1].content.startsWith(base['app.js']));
  assert.equal(out.files[2].content, base['checks.cjs']);
});

test('repair requests a partial schema and preserves omitted files', async () => {
  const prior = await call(JSON.stringify(base));
  const replacement = base['checks.cjs'] + '\n// replacement';
  const out = await call(JSON.stringify({'checks.cjs':replacement}), req => {
    assert.equal(req.response_format.json_schema.name, 'browser_tool_replacements');
    assert.equal(req.response_format.json_schema.schema.minProperties, 1);
  }, {files:prior.files, check:{exitCode:1,stderr:'fixture'}});
  assert.equal(out.files[0].content, prior.files[0].content);
  assert.equal(out.files[1].content, prior.files[1].content);
  assert.equal(out.files[2].content, replacement);
});

for (const [name, input] of [
  ['duplicate', '{"index.html":"a","index.html":"b","app.js":"c","checks.cjs":"d"}'],
  ['escaped duplicate', '{"index.html":"a","index\\u002ehtml":"b","app.js":"c","checks.cjs":"d"}'],
  ['unknown', '{"index.html":"a","app.js":"b","checks.cjs":"c","extra":"d"}'],
  ['missing', '{"index.html":"a","app.js":"b"}'],
  ['nested', '{"index.html":{},"app.js":"b","checks.cjs":"c"}'],
  ['truncated', '{"index.html":"a","app.js":"b","checks.cjs":"c"'],
  ['trailing content', JSON.stringify(base) + ' other'],
  ['trailing comma', '{"index.html":"a",}'],
  ['bad surrogate', '{"index.html":"\\ud800","app.js":"b","checks.cjs":"c"}'],
  ['control char', '{"index.html":"x\ny","app.js":"b","checks.cjs":"c"}'],
]) test(`reject ${name}`, async () => {
  assert.throws(() => parse(input), TypeError);
  await assert.rejects(call(input), error => error.code === 'invalid_model_output' && error.stage === 'tool_files');
});

test('unicode, escape sequences, and non-protocol-looking source text round trip', () => {
  const values = {...base, 'index.html':base['index.html'] + '\n<!-- 😀 \\"x\\" -->'};
  assert.equal(parse(JSON.stringify(values))[0].lines.join('\n'), values['index.html']);
});
test('reject oversize response and empty repair object', () => {
  assert.throws(() => parseSourceObject(JSON.stringify(base), {maxBytes:3,allowed:names,requireAll:true}), TypeError);
  assert.throws(() => parse('{}', false), TypeError);
});
test('existing bridge and file-size protections still reject unsafe source', async () => {
  await assert.rejects(call(JSON.stringify({...base, 'app.js':base['app.js'] + '\nself.postMessage(1);'})), /reserved runtime bridge/u);
  await assert.rejects(call(JSON.stringify({...base, 'index.html':Array(340).fill('x'.repeat(100)).join('\n')})), /size limit/u);
});
test('unsupported schema fails without fallback', async () => {
  let calls = 0;
  await assert.rejects(generateRunFiles({apiKey:'fake',model}, {}, null, {fetcher: async () => {
    calls++; return new Response('unsupported', {status:400});
  }}), error => error.code === 'generation_failed' && !error.uncertain);
  assert.equal(calls, 1);
});
test('escaped response stops before source validation when it cannot be retained', async () => {
  const make = count => JSON.stringify({...base, 'index.html': base['index.html'] + '\n' + Array(count).fill('<!-- ' + '"'.repeat(80) + ' -->').join('\n')});
  let count = 1;
  while (runJsonBytes(make(count)) <= RUN_EVIDENCE_LIMITS.responseBytes) count++;
  const below = make(count - 1), above = make(count);
  assert.ok(new TextEncoder().encode(above).byteLength < RUN_EVIDENCE_LIMITS.responseBytes);
  assert.ok(runJsonBytes(below) <= RUN_EVIDENCE_LIMITS.responseBytes);
  assert.ok(runJsonBytes(above) > RUN_EVIDENCE_LIMITS.responseBytes);
  const admitted = await call(below);
  assert.equal(admitted.response.retention, 'retained');
  await assert.rejects(call(above), error => error.code === 'invalid_model_output' && error.stage === 'response'
    && error.response.retention === 'size_limit' && /retained-evidence limit/u.test(error.message));
});

test('synthetic complete source passes admission after JSON serialization; no code executes', async () => {
  const out = await call(JSON.stringify(base));
  assert.equal(out.files.length, 3);
  assert.equal(out.files[0].content, base['index.html']);
  assert.ok(out.files[1].content.endsWith(WORKER_BRIDGE));
  assert.equal(out.files[2].content, base['checks.cjs']);
  await validateGeneratedSource(out.files);
});
