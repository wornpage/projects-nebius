import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRunFiles } from '../worker/nebius-run-provider.mjs';
import { WORKER_BRIDGE } from '../worker/nebius-run-materialization.mjs';
import { streamEnvelope } from './helpers/nebius-stream-fixture.mjs';

const model = 'nvidia/authored-framing-model';
const files = [
  { path: 'index.html', lines: ['<!doctype html>', '<output id="result"></output>'] },
  { path: 'app.js', lines: ['function validate(value) { return value; }',
    "function handleMessage(message) { return [{id:'result',text:validate(message.values.input)}]; }", '// trailing spaces  ', ''] },
  { path: 'checks.cjs', lines: ["assert.equal(validate('ok'), 'ok');",
    "assert.equal(handleMessage({type:'event',event:'input',id:'input',values:{input:'ok'}})[0].text, 'ok');"] },
];
const canonical = () => files.map(file => '```' + (file.path === 'index.html' ? 'html' : 'javascript')
  + ' ' + file.path + '\n' + file.lines.join('\n') + '\n```').join('\n');
const observed = () => canonical().replace('```javascript app.js', '```\napp.js')
  .replace('```javascript checks.cjs', '```\nchecks.cjs');
const generate = content => generateRunFiles({ apiKey: 'synthetic-only', model }, {}, null, {
  fetcher: async () => streamEnvelope({ model, usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{
    finish_reason: 'stop', message: { role: 'assistant', content },
  }] }),
});

for (const [name, ending] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`legacy standalone-name sequence is rejected without fallback (${name})`, async () => {
    const content = observed().replaceAll('\n', ending);
    await assert.rejects(generate(content), error => {
      assert.equal(error.code, 'invalid_model_output');
      assert.equal(error.stage, 'tool_files');
      assert.equal(error.response.responseText, content);
      return true;
    });
  });
}

for (const [name, mutate] of [
  ['bare HTML mixed with standalone filenames', text => text.replace('```html index.html', '```html')],
  ['canonical app mixed with a standalone check', text => text.replace('```\napp.js\n', '```javascript app.js\n')],
  ['standalone app mixed with a canonical check', text => text.replace('```\nchecks.cjs\n', '```javascript checks.cjs\n')],
  ['partial source after standalone app', text => text.slice(0, text.indexOf('```\nchecks.cjs\n'))],
  ['a filename before the initial file', text => text.slice(text.indexOf('```\napp.js\n'))],
  ['unknown app filename', text => text.replace('```\napp.js\n', '```\nprivate.js\n')],
  ['traversing app filename', text => text.replace('```\napp.js\n', '```\n../app.js\n')],
  ['filename with trailing text', text => text.replace('```\napp.js\n', '```\napp.js extra\n')],
  ['filename with leading whitespace', text => text.replace('```\napp.js\n', '```\n app.js\n')],
  ['padded standalone opening', text => text.replace('```\napp.js\n', '``` \napp.js\n')],
  ['duplicate separator', text => text.replace('```\n```\napp.js\n', '```\n```\n```\napp.js\n')],
  ['repeated app file', text => text.replace('```\nchecks.cjs\n', '```\napp.js\n')],
  ['reversed standalone filenames', text => text.replace('```\napp.js\n', '```\nchecks.cjs\n').replace('```\nchecks.cjs\nassert', '```\napp.js\nassert')],
  ['nested named fence', text => text.replace('function validate(value)', '```javascript checks.cjs\nfunction validate(value)')],
  ['missing final fence', text => text.slice(0, -3)],
  ['extra final fence', text => text + '\n```'],
  ['outside prose', text => text + '\nnot a file'],
]) {
  test(`standalone filename sequence rejects ${name}`, async () => {
    await assert.rejects(generate(mutate(observed())), error => error.code === 'invalid_model_output' && error.stage === 'tool_files');
  });
}

test('a valid JSON envelope still rejects reserved worker APIs', async () => {
  const content = JSON.stringify(Object.fromEntries(files.map(file => [file.path, file.lines.join('\n').replace('function validate(value) { return value; }', 'function validate(value) { return globalThis.privateValue; }')])));
  await assert.rejects(generate(content), error => error.code === 'invalid_model_output' && error.stage === 'tool_worker');
});
