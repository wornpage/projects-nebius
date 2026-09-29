import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { authoredCheckerFiles, materializeAuthoredChecker } from './fixtures/nebius-release-checker.mjs';
import { PACKET_CASES, INCOMPLETE, CORRECTED, THREE_GAPS, READY, assertPacketResult } from './fixtures/nebius-release-packet-cases.mjs';
import { runFilesDigest, validateRunFiles } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const files = await materializeAuthoredChecker();
const script = files.find(file => file.path === 'app.js').content;

// Execute only the committed authored fixture. This is not a security sandbox
// for arbitrary model code and does not call Token Factory Sandboxes.
function loadAuthoredModule(source = script) {
  const context = createContext({ module: { exports: {} } });
  runInContext(source, context, { timeout: 1000 });
  return text => {
    context.inputText = text;
    return runInContext('module.exports.validate(inputText)', context, { timeout: 1000 });
  };
}

function workerBridge() {
  const replies = [];
  const context = createContext({ self: { postMessage: reply => replies.push(JSON.parse(JSON.stringify(reply))) } });
  runInContext(script, context, { timeout: 1000 });
  return data => {
    context.inputMessage = data;
    runInContext('self.onmessage({data: inputMessage})', context, { timeout: 1000 });
    assert.equal(replies.length, 1);
    return replies.shift().patches;
  };
}

test('authored checker traverses the actual native parser, validators and materializer', async () => {
  assert.deepEqual(validateRunFiles(files), files);
  assert.equal(script.match(/self\.onmessage/g)?.length, 1);
  assert.equal(script.match(/module\.exports/g)?.length, 1);
  for (const file of authoredCheckerFiles()) {
    const result = files.find(item => item.path === file.path).content;
    if (file.path === 'app.js') assert.ok(result.startsWith(file.content + '\n;\n'));
    else assert.equal(result, file.content);
  }
  assert.equal(await runFilesDigest(files), await runFilesDigest(await materializeAuthoredChecker()));
});

for (const scenario of PACKET_CASES) {
  test(`authored checker independent case: ${scenario.name}`, () => {
    assertPacketResult(assert, loadAuthoredModule()(scenario.input), scenario);
  });
}

test('authored checks import and exercise the actual materialized validation function', () => {
  let imports = 0, assertions = 0;
  const validate = loadAuthoredModule();
  const countedAssert = new Proxy(assert, { get(target, key) {
    if (typeof target[key] !== 'function') return target[key];
    return (...args) => { assertions += 1; return target[key](...args); };
  } });
  const context = createContext({ require: name => {
    if (name === 'node:assert/strict') return countedAssert;
    assert.equal(name, './app.js'); imports += 1; return { validate };
  } });
  runInContext(files.find(file => file.path === 'checks.cjs').content, context, { timeout: 1000 });
  assert.equal(imports, 1);
  assert.equal(assertions, 4);
});

test('actual appended worker bridge handles init, both example loaders and changed input', () => {
  const send = workerBridge();
  assert.doesNotMatch(send({ type: 'init', values: { packet: '' } })[0].text, /Ready for human review/u);
  for (const [id, input, expected] of [
    ['load-incomplete', INCOMPLETE, THREE_GAPS], ['load-corrected', CORRECTED, READY],
  ]) {
    const patches = send({ type: 'event', event: 'click', id, values: { packet: '' } });
    assert.deepEqual(JSON.parse(patches.find(patch => patch.id === 'packet').value), JSON.parse(input));
    assert.equal(patches.find(patch => patch.id === 'result').text, expected);
  }
  const changed = send({ type: 'event', event: 'input', id: 'packet', values: { packet: '{' } });
  assert.doesNotMatch(changed.find(patch => patch.id === 'result').text, /Ready for human review|0 gaps/u);
  const invalid = send({ type: 'event', event: 'click', id: 'check-packet', values: { packet: '{' } });
  assert.match(invalid.find(patch => patch.id === 'result').text, /^Input error:/u);
});

test('all independent cases survive actual worker message dispatch, not only direct function calls', () => {
  const send = workerBridge();
  for (const scenario of PACKET_CASES) {
    const patches = send({ type: 'event', event: 'click', id: 'check-packet', values: { packet: scenario.input } });
    assertPacketResult(assert, patches.find(patch => patch.id === 'result').text, scenario);
  }
});

test('independent oracle detects a tool that falsely reports every input ready', () => {
  const wrong = loadAuthoredModule('function validate() { return "0 gaps: Ready for human review"; }\nmodule.exports = { validate };');
  assert.throws(() => assertPacketResult(assert, wrong(INCOMPLETE), PACKET_CASES[0]));
  assert.throws(() => assertPacketResult(assert, wrong('null'), PACKET_CASES.find(item => item.name === 'null')));
});

test('known-good fixture does not require weaker page or worker validation', async () => {
  const badPage = authoredCheckerFiles();
  badPage[0].content += '\n<script>throw new Error("must be rejected")</script>';
  await assert.rejects(materializeAuthoredChecker(badPage), error => error.stage === 'tool_page' && error.code === 'page_script_forbidden');
  const badLogic = authoredCheckerFiles();
  badLogic[1].content += '\n// fetch';
  await assert.rejects(materializeAuthoredChecker(badLogic), error => error.stage === 'tool_worker');
});

test('a named-file repair preserves the page and checks and appends exactly one bridge', async () => {
  const replacements = authoredCheckerFiles().filter(file => file.path === 'app.js');
  replacements[0].content += '\n// Authored repair fixture, not a model repair.';
  const repaired = await materializeAuthoredChecker(replacements, { files, check: { exitCode: 1, stderr: 'Authored diagnostic fixture.' } });
  assert.deepEqual(repaired[0], files[0]);
  assert.deepEqual(repaired[2], files[2]);
  assert.equal(repaired[1].content.match(/self\.onmessage/g)?.length, 1);
  for (const scenario of PACKET_CASES) assertPacketResult(assert, loadAuthoredModule(repaired[1].content)(scenario.input), scenario);
});
