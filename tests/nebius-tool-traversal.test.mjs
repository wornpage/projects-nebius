import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FIXTURE_INPUT, authoredCheckerFiles, materializeAuthoredChecker } from './fixtures/nebius-release-checker.mjs';
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

test('authored checks import and exercise both actual materialized functions', () => {
  let imports = 0, assertions = 0;
  const validate = loadAuthoredModule();
  const handleMessage = workerBridge();
  const countedAssert = new Proxy(assert, { get(target, key) {
    if (typeof target[key] !== 'function') return target[key];
    return (...args) => { assertions += 1; return target[key](...args); };
  } });
  const context = createContext({ require: name => {
    if (name === 'node:assert/strict') return countedAssert;
    assert.equal(name, './app.js'); imports += 1; return { validate, handleMessage };
  } });
  runInContext(files.find(file => file.path === 'checks.cjs').content, context, { timeout: 1000 });
  assert.equal(imports, 1);
  assert.equal(assertions, 15);
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

test('retained preview rejects ambiguous or untrusted input before browser execution', async t => {
  // Synthetic record for rejection tests only, not evidence of a provider run.
  const { consent, ...snapshot } = FIXTURE_INPUT;
  const sourceDigest = await runFilesDigest(files);
  const fixtureRecord = {
    id: '00000000-0000-4000-8000-000000000001', ...snapshot,
    status: 'ready', attempt: 1, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
    events: [], files, checks: [{ attempt: 1, operationId: '00000000-0000-4000-8000-000000000002', checkpointId: null,
      exitCode: 0, stdout: 'Synthetic authored test record, not a provider receipt.', stderr: '', sourceDigest }],
    usage: { modelCalls: 1, inputTokens: 0, outputTokens: 0, totalsComplete: true }, error: null, failure: null,
  };
  const bindings = { input: 'packet', output: 'result', check: 'check-packet', incomplete: 'load-incomplete', corrected: 'load-corrected' };
  const script = fileURLToPath(new URL('../scripts/nebius-tool-preview-smoke.mjs', import.meta.url));
  for (const [name, mutation, expected] of [
    ['partial options', (record, ids, paths) => ({ args: ['--run-record', paths.record] }), /Use --run-record PATH and --bindings PATH together/u],
    ['unknown option', (record, ids, paths) => ({ args: ['--run-record', paths.record, '--unknown', paths.bindings] }), /Unknown or duplicate/u],
    ['duplicate option', (record, ids, paths) => ({ args: ['--run-record', paths.record, '--run-record', paths.bindings] }), /Unknown or duplicate/u],
    ['source digest mismatch', record => { record.files[1].content += '\n// Authored data mutation'; }, /do not match the source that was checked/u],
    ['non-ready record', record => { record.status = 'failed'; }, /Only a retained ready RunRecord/u],
    ['response envelope instead of raw record', record => ({ record: { run: record } }), /saved execution record is invalid/u],
    ['extra binding key', (record, ids) => { ids.extra = 'unused'; }, /Expected values to be strictly deep-equal/u],
    ['selector instead of ID', (record, ids) => { ids.input = '#packet'; }, /HTML IDs, not selectors or code/u],
    ['duplicate control ID', (record, ids) => { ids.output = ids.input; }, /distinct ID/u],
    ['oversized bindings', () => ({ bindingsText: ' '.repeat(4097) }), /exceeds its size limit/u],
    ['oversized record', () => ({ recordText: ' '.repeat(1048577) }), /exceeds its size limit/u],
    ['malformed JSON without echoing its contents', () => ({ recordText: 'SECRET_FROM_MISPLACED_FILE' }), /Qualification inputs must be valid JSON/u],
  ]) {
    await t.test(name, child => {
      const parent = resolve(tmpdir());
      const directory = mkdtempSync(join(parent, 'nebius-preview-arguments-'));
      child.after(() => {
        const target = resolve(directory);
        assert.equal(dirname(target), parent);
        assert.ok(basename(target).startsWith('nebius-preview-arguments-'));
        rmSync(target, { recursive: true });
      });
      const paths = { record: join(directory, 'record.json'), bindings: join(directory, 'bindings.json') };
      const record = structuredClone(fixtureRecord), ids = { ...bindings };
      const changes = mutation(record, ids, paths) || {};
      writeFileSync(paths.record, changes.recordText ?? JSON.stringify(changes.record ?? record));
      writeFileSync(paths.bindings, changes.bindingsText ?? JSON.stringify(ids));
      const evidence = join(directory, 'evidence');
      const result = spawnSync(process.execPath, [script, ...(changes.args ?? ['--run-record', paths.record, '--bindings', paths.bindings])], {
        encoding: 'utf8', timeout: 6000, maxBuffer: 8192, windowsHide: true,
        env: { ...process.env, CHROME_EXECUTABLE_PATH: '', NEBIUS_PREVIEW_EVIDENCE_DIR: evidence },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /SECRET_FROM_MISPLACED_FILE/u);
      const report = JSON.parse(readFileSync(join(evidence, 'report.json'), 'utf8'));
      assert.match(report.error.message, expected);
      assert.equal(report.browser, null);
      assert.equal(report.liveModelCalls, 0);
      assert.equal(report.liveSandboxRuns, 0);
      assert.equal(report.packetSummary.observed, 0);
      assert.equal(report.passed, false);
    });
  }
});
