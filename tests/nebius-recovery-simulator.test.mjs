import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { validate, handleMessage, recoveryFromValues } from '../examples/recovery-simulator-logic.mjs';
import { RECOVERY_INPUT_FORMATS, RECOVERY_BRIEF, RECOVERY_EXAMPLE_INPUT, recoveryExampleFiles } from '../examples/nebius-recovery-simulator.mjs';
import { PROJECT_TASKS, RECOVERY_CASES } from './fixtures/nebius-recovery-cases.mjs';
import { decodeSourceLines } from '../worker/nebius-run-provider.mjs';
import { historicalRecoveryFiles as materializeRecoveryExample } from './fixtures/nebius-historical-recovery.mjs';
import { runPageContract } from '../worker/nebius-run-preview.mjs';
import { CHECK_RUNNER } from '../worker/nebius-sandbox.mjs';

// Historical authored reference only; these checks do not qualify the bundled v12 simulator.
const clone = value => structuredClone(value);
const rows = schedule => schedule.rows.map(row => [row.id, row.start, row.end]);
const patch = (patches, id) => patches.find(item => item.id === id);
const values = (changes = {}) => ({ 'plan-json': JSON.stringify({ tasks: PROJECT_TASKS }), 'delay-task': 'delivery',
  'delay-days': '0', 'recover-task': 'assemble', 'recover-days': '0', ...changes });
const event = (id, current, type = 'input') => ({ type: 'event', event: type, id, values: current });

for (const example of RECOVERY_CASES) {
  test('hand calculation: ' + example.name, () => {
    const input = clone(example.input), before = clone(input), result = validate(input);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual([result.baseline.finish, result.delayed.finish, result.recovered.finish], example.finishes);
    assert.deepEqual(rows(result.baseline), example.baseline);
    assert.deepEqual(rows(result.delayed), example.delayed);
    assert.deepEqual(rows(result.recovered), example.recovered);
    assert.equal(result.daysRecovered, example.daysRecovered);
    assert.deepEqual(result.affected, example.affected);
    assert.deepEqual(input, before, 'calculation must not modify source data');
  });
}

const task = overrides => ({ id: 'a', title: 'Task A', duration: 2, dependsOn: [], ...overrides });
test('title length applies after trimming without allowing controls or markup', () => {
  assert.equal(validate({tasks:[task({title:'  '+'T'.repeat(100)+'  '})]}).ok,true);
  for(const title of ['  '+'T'.repeat(101)+'  ','\tTitle ',' Title\n',' <b>Title</b> ',' Title\u202e ']) {
    assert.equal(validate({tasks:[task({title})]}).ok,false);
  }
});
const invalidCases = [
  ['null input', null], ['array input', []], ['missing tasks', {}], ['extra root field', { tasks: [task()], extra: 1 }],
  ['empty plan', { tasks: [] }], ['tasks not an array', { tasks: {} }],
  ['nine tasks', { tasks: Array.from({ length: 9 }, (_, index) => task({ id: 'a' + index })) }],
  ['null task', { tasks: [null] }], ['missing field', { tasks: [{ id: 'a', duration: 1, dependsOn: [] }] }],
  ['extra task field', { tasks: [task({ note: 'extra' })] }], ['duplicate ID', { tasks: [task(), task()] }],
  ['dangling dependency', { tasks: [task({ dependsOn: ['missing'] })] }],
  ['repeated dependency', { tasks: [task(), task({ id: 'b', dependsOn: ['a', 'a'] })] }],
  ['dependency not an array', { tasks: [task({ dependsOn: 'a' })] }],
  ['eight dependency IDs', { tasks: [task({ dependsOn: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })] }],
  ['self cycle', { tasks: [task({ dependsOn: ['a'] })] }],
  ['two-task cycle', { tasks: [task({ dependsOn: ['b'] }), task({ id: 'b', dependsOn: ['a'] })] }],
  ['cycle in separate branch', { tasks: [task(), task({ id: 'b', dependsOn: ['c'] }), task({ id: 'c', dependsOn: ['b'] })] }],
  ['missing selected delay task', { tasks: [task()], delayDays: 1 }],
  ['unknown delay task at zero', { tasks: [task()], delayTask: 'unknown', delayDays: 0 }],
  ['unknown recovery task', { tasks: [task()], recoverTask: 'unknown', recoverDays: 1 }],
  ['null delay task', { tasks: [task()], delayTask: null }], ['numeric recovery task', { tasks: [task()], recoverTask: 1 }],
  ['recovery below minimum', { tasks: [task()], recoverTask: 'a', recoverDays: 2 }],
  ['excess baseline horizon', { tasks: ['a', 'b', 'c', 'd'].map((id, index, all) => task({ id, duration: 30, dependsOn: index ? [all[index - 1]] : [] })) }],
  ['excess delayed horizon', { tasks: ['a', 'b', 'c'].map((id, index, all) => task({ id, duration: 30, dependsOn: index ? [all[index - 1]] : [] })), delayTask: 'a', delayDays: 1 }],
];
for (const duration of [0, -1, 31, 1.5, NaN, Infinity, -Infinity, '2', null, true, 2n]) {
  invalidCases.push(['invalid duration ' + String(duration), { tasks: [task({ duration })] }]);
}
for (const id of ['', 'with space', '1first', '<img>', 'constructor', 'prototype', '__proto__', 'a'.repeat(81), 'é', 'a\u0000']) {
  invalidCases.push(['unsafe identifier ' + JSON.stringify(id), { tasks: [task({ id })] }]);
}
for (const title of ['', ' ', '<script>bad</script>', 'A\u0000B', 'A\u202eB', 'x'.repeat(101), null]) {
  invalidCases.push(['unsafe title ' + JSON.stringify(title), { tasks: [task({ title })] }]);
}
for (const field of ['delayDays', 'recoverDays']) {
  for (const amount of [-1, 31, .5, NaN, Infinity, '1', null, false, undefined, 10000000000000]) {
    invalidCases.push(['invalid ' + field + ' ' + String(amount), { tasks: [task()], delayTask: 'a', recoverTask: 'a', [field]: amount }]);
  }
}
for (const [name, input] of invalidCases) {
  test('rejects ' + name, () => {
    const result = validate(input);
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result).sort(), ['error', 'ok']);
    assert.ok(result.error.length > 0 && result.error.length < 400);
  });
}

test('strict own-data shape rejects symbols, accessors and inherited task data', () => {
  const extraSymbol = task(); extraSymbol[Symbol('hidden')] = 1;
  let reads = 0;
  const accessor = task(); Object.defineProperty(accessor, 'duration', { enumerable: true, get() { reads += 1; return 2; } });
  const inherited = Object.create(task());
  const hidden = task(); Object.defineProperty(hidden, 'duration', { value: 2, enumerable: false });
  for (const value of [extraSymbol, accessor, inherited, hidden]) assert.equal(validate({ tasks: [value] }).ok, false);
  assert.equal(reads, 0);
});

test('sparse, extended and accessor arrays cannot produce a nonfinite schedule', () => {
  let reads = 0;
  const accessor = ['a'];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { reads += 1; return 'a'; } });
  const extended = []; extended.extra = 'a';
  const symbolic = []; symbolic[Symbol('extra')] = 'a';
  const badIndex = []; Object.defineProperty(badIndex, '01', { enumerable: true, value: 'a' });
  for (const dependsOn of [Array(1), accessor, extended, symbolic, badIndex]) {
    assert.equal(validate({ tasks: [task({ dependsOn })] }).ok, false);
  }
  const tasks = [task()]; tasks.extra = task({ id: 'b' });
  assert.equal(validate({ tasks }).ok, false);
  assert.equal(validate({ tasks: Array(1) }).ok, false);
  assert.equal(reads, 0);
});

test('minimum and maximum task/duration/adjustment bounds are inclusive', () => {
  const tasks = Array.from({ length: 8 }, (_, index) => task({ id: 't' + index, duration: 30 }));
  const result = validate({ tasks, delayTask: 't0', delayDays: 30, recoverTask: 't0', recoverDays: 30 });
  assert.equal(result.ok, true);
  assert.deepEqual([result.baseline.finish, result.delayed.finish, result.recovered.finish, result.daysRecovered], [30, 60, 30, 30]);
  const minimum = validate({ tasks: [task({ duration: 1 })], delayTask: '', delayDays: 0, recoverTask: '', recoverDays: 0 });
  assert.equal(minimum.recovered.finish, 1);
  assert.equal(validate({ tasks: [task({ duration: 1 })], recoverTask: 'a', recoverDays: 1 }).ok, false);
});

test('titles remain plain data, and labels preserve readable punctuation', () => {
  const result = validate({ tasks: [task({ title: '  Research & review "A"  ' })] });
  assert.equal(result.baseline.rows[0].label, 'Research & review "A"');
});

test('noncritical delay explanation names the branch slack and affected range', () => {
  const result = validate({ tasks: clone(PROJECT_TASKS), delayTask: 'prepare', delayDays: 1 });
  assert.match(result.explanation, /parallel work.*finish does not move/u);
  assert.match(result.explanation, /Prepare workspace: 1–3 → 1–4 → 1–4/u);
});

test('init, every example button and timeline match independent expected ranges', () => {
  const initial = handleMessage({ type: 'init', values: values() });
  assert.equal(patch(initial, 'recovered-finish').text, '7 days');
  for (const [id, delayed, recovered, days] of [['baseline', 7, 7, 0], ['delay-delivery', 9, 9, 0], ['recover-day', 9, 8, 1]]) {
    const patches = handleMessage(event(id, values({ 'plan-json': '{' }), 'click'));
    assert.equal(patch(patches, 'baseline-finish').text, '7 days');
    assert.equal(patch(patches, 'delayed-finish').text, delayed + ' days');
    assert.equal(patch(patches, 'recovered-finish').text, recovered + ' days');
    assert.equal(patch(patches, 'recovered-days').text, days === 1 ? '1 day' : days + ' days');
    assert.deepEqual(JSON.parse(patch(patches, 'plan-json').value), { tasks: PROJECT_TASKS });
    assert.equal(patch(patches, 'error').text, '');
  }
  const timeline = patch(handleMessage(event('recover-day', values(), 'click')), 'schedule');
  assert.ok(timeline.text.length > 0);
  assert.deepEqual(timeline.timeline, { unit: 'days', horizon: 9, rows: [
    { id: 'brief', label: 'Confirm brief', start: 0, end: 1, baselineStart: 0, baselineEnd: 1 },
    { id: 'delivery', label: 'Delivery', start: 1, end: 6, baselineStart: 1, baselineEnd: 4 },
    { id: 'prepare', label: 'Prepare workspace', start: 1, end: 3, baselineStart: 1, baselineEnd: 3 },
    { id: 'assemble', label: 'Assembly', start: 6, end: 7, baselineStart: 4, baselineEnd: 6 },
    { id: 'review', label: 'Review', start: 7, end: 8, baselineStart: 6, baselineEnd: 7 },
  ] });
});

test('single-day metrics, adjustments and explanation use natural singular units', () => {
  const current = values({ 'plan-json': JSON.stringify({ tasks: [task({ duration: 1 })] }),
    'delay-task': 'a', 'delay-days': '1', 'recover-task': 'a', 'recover-days': '1' });
  const patches = handleMessage({ type: 'init', values: current });
  assert.equal(patch(patches, 'baseline-finish').text, '1 day');
  assert.equal(patch(patches, 'delayed-finish').text, '2 days');
  assert.equal(patch(patches, 'recovered-finish').text, '1 day');
  assert.equal(patch(patches, 'recovered-days').text, '1 day');
  assert.match(patch(patches, 'impact').text, /gains 1 day\. Recovery: Task A loses 1 day of duration\./u);
  assert.match(patch(patches, 'impact').text, /baseline 1 day, delayed 2 days, recovered 1 day/u);
  assert.match(patch(patches, 'schedule').text, /Finish: 1 day → 1 day\./u);
  for (const output of patches.filter(item => Object.hasOwn(item, 'text'))) {
    assert.doesNotMatch(output.text, /\b1 days\b|day\(s\)/u);
  }
});

test('every input and change calculates the current snapshot without stale state', () => {
  const edits = [
    ['plan-json', { 'plan-json': JSON.stringify({ tasks: [task({ id: 'a', duration: 4 })] }), 'delay-task': 'a', 'recover-task': 'a' }, 4],
    ['delay-task', { 'delay-task': 'prepare', 'delay-days': '2' }, 8],
    ['delay-days', { 'delay-days': '2' }, 9],
    ['recover-task', { 'recover-task': 'delivery', 'recover-days': '1' }, 6],
    ['recover-days', { 'recover-days': '1' }, 6],
  ];
  for (const [id, changes, expected] of edits) {
    for (const type of ['input', 'change']) {
      handleMessage(event('recover-day', values(), 'click'));
      const patches = handleMessage(event(id, values(changes), type));
      assert.equal(patch(patches, 'recovered-finish').text, expected + ' days');
      assert.equal(patch(patches, 'error').text, '');
      assert.ok(patch(patches, 'schedule').timeline.rows.length > 0);
    }
  }
});

test('all invalid edits remove every metric, explanation and timeline', () => {
  const invalid = [
    ['plan-json', '{'], ['plan-json', 'null'], ['plan-json', '{"tasks":[],"extra":0}'], ['plan-json', 'x'.repeat(4001)],
    ['delay-task', 'missing'], ['recover-task', 'missing'], ['delay-days', '1.5'], ['delay-days', '1e1'],
    ['delay-days', 'Infinity'], ['delay-days', '-1'], ['delay-days', '31'], ['delay-days', ''], ['delay-days', '01'],
    ['recover-days', '2'], ['recover-days', 'NaN'], ['recover-days', '+1'],
  ];
  for (const [id, text] of invalid) {
    for (const type of ['input', 'change']) {
      handleMessage(event('recover-day', values(), 'click'));
      const patches = handleMessage(event(id, values({ [id]: text }), type));
      assert.ok(patch(patches, 'error').text.length > 0);
      for (const output of ['baseline-finish', 'delayed-finish', 'recovered-finish', 'recovered-days', 'schedule', 'impact']) {
        assert.deepEqual(patch(patches, output), { id: output, text: '' });
      }
      const restored = handleMessage(event(id, values(), type));
      assert.equal(patch(restored, 'recovered-finish').text, '7 days');
      assert.equal(patch(restored, 'error').text, '');
    }
  }
});

test('malformed request snapshots fail clearly and never expose previous results', () => {
  for (const input of [undefined, {}, { ...values(), extra: '' }, { ...values(), 'delay-days': 2 }]) {
    assert.equal(recoveryFromValues(input).ok, false);
    assert.equal(patch(handleMessage({ type: 'init', values: input }), 'schedule').text, '');
  }
  assert.equal(patch(handleMessage({ type: 'event', id: 'unknown', event: 'click', values: values() }), 'schedule').text, '');
});

test('three raw files obey generation budgets and have no runtime/network identifiers', () => {
  const files = recoveryExampleFiles();
  assert.deepEqual(files.map(file => file.path), ['index.html', 'app.js', 'checks.cjs']);
  let total = 0;
  for (const file of files) {
    const bytes = Buffer.byteLength(file.content); total += bytes;
    assert.ok(bytes <= 32768 - (file.path === 'app.js' ? 700 : 0));
    const lines = file.content.split('\n');
    assert.ok(lines.length >= 2 && lines.length <= 1024);
    assert.ok(lines.every(line => [...line].length <= 1024));
  }
  assert.ok(total <= 65536 - 700);
  assert.doesNotMatch(files[1].content, /\b(?:self|globalThis|onmessage|addEventListener|postMessage|module|exports|import|document|window|fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|navigator)\b/u);
  assert.doesNotMatch(files[0].content, /<script\b|\burl\s*\(|\b(?:src|href)\s*=\s*["'](?!#|data:image\/)/iu);
  assert.doesNotMatch(files[2].content, /\b(?:require|import|async|Promise|setTimeout|setInterval)\b/u);
  assert.match(files[0].content, /Authored offline example · No AI call · No Sandbox run/u);
  assert.equal((files[0].content.match(/Authored offline example/gu) || []).length, 1);
  for (const id of ['baseline-finish', 'delayed-finish', 'recovered-finish', 'recovered-days']) {
    assert.match(files[0].content, new RegExp('<p id="' + id + '-label">[^<]+</p><output id="' + id + '" aria-labelledby="' + id + '-label">', 'u'));
  }
  assert.match(RECOVERY_BRIEF, /no resource, holiday or calendar model/u);
  assert.deepEqual(RECOVERY_EXAMPLE_INPUT, { tasks: PROJECT_TASKS });
});

test('raw browser source defines the same pure API and passes all independent calculations', () => {
  const code = recoveryExampleFiles().find(file => file.path === 'app.js').content;
  const context = {};
  runInNewContext(code + '\nthis.api = {validate, handleMessage};', context, { timeout: 1000 });
  for (const example of RECOVERY_CASES) {
    context.inputJson = JSON.stringify(example.input);
    const result = runInNewContext('validate(JSON.parse(inputJson))', context, { timeout: 1000 });
    assert.deepEqual(JSON.parse(JSON.stringify(rows(result.recovered))), example.recovered);
    assert.equal(result.recovered.finish, example.finishes[2]);
  }
});

test('actual synchronous check runner observes every declared control and timeline refresh', () => {
  const files = materializeRecoveryExample();
  const page = runPageContract(files, { requiredInputFormats: RECOVERY_INPUT_FORMATS });
  assert.deepEqual(page.elements.filter(element => element.textValue).map(element => ({ id: element.id, format: element.format })).sort((a, b) => a.id.localeCompare(b.id)),
    [...RECOVERY_INPUT_FORMATS].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(page.elements.find(element => element.id === 'schedule').outputFormat, 'timeline');
  const dir = mkdtempSync(join(tmpdir(), 'authored-recovery-checks-'));
  try {
    for (const file of files) writeFileSync(join(dir, file.path), file.content);
    writeFileSync(join(dir, 'control-contract.json'), JSON.stringify(page));
    const result = spawnSync(process.execPath, ['-e', CHECK_RUNNER], { cwd: dir, encoding: 'utf8', timeout: 12000, env: {} });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Control events observed: 14\/14/u);
    assert.match(result.stdout, /Post-output edits observed: 10\/10/u);
    assert.match(result.stdout, /declared JSON example loaders: 3\/3/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('authored recovery materialization cannot relax model response admission', () => {
  const raw = recoveryExampleFiles();
  assert.throws(() => decodeSourceLines(raw.map(file => ({path:file.path,lines:file.content.split('\n')}))), error =>
    error.code === 'invalid_model_output' && error.stage === 'tool_worker');
  const files = materializeRecoveryExample();
  assert.equal(materializeRecoveryExample.length, 0);
  assert.equal(files[0].content, raw[0].content);
  assert.equal(files[2].content, raw[2].content);
  assert(files[1].content.startsWith(raw[1].content + '\n;\n'));
  assert.equal(files[1].content.match(/self\.onmessage =/gu)?.length, 1);
});
