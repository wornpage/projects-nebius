import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECOVERY_BROWSER_CASES, RECOVERY_BROWSER_PROFILE } from './fixtures/nebius-recovery-browser-cases.mjs';

const inputIds = ['plan-json', 'delay-task', 'delay-days', 'recover-task', 'recover-days'];
const outputIds = ['baseline-finish', 'delayed-finish', 'recovered-finish', 'recovered-days', 'impact', 'error', 'schedule'];
const counts = Object.fromEntries(['valid', 'invalid', 'example', 'stale', 'keyboard'].map(category => [category,
  RECOVERY_BROWSER_CASES.filter(entry => entry.category === category).length]));
function assertValues(values) {
  assert.deepEqual(Object.keys(values), inputIds);
  assert.ok(Object.values(values).every(value => typeof value === 'string'));
}
function assertExpected(expected, values) {
  assert.deepEqual(Object.keys(expected).sort(), ['affected', 'baseline', 'daysRecovered', 'finishes', 'labels', 'recovered']);
  assert.equal(expected.finishes.length, 3);
  assert.ok(expected.finishes.every(value => Number.isInteger(value) && value >= 1 && value <= 90));
  assert.equal(expected.daysRecovered, expected.finishes[1] - expected.finishes[2]);
  const ids = Object.keys(expected.labels).sort();
  assert.ok(ids.length >= 1 && ids.length <= 8);
  for (const [field, finishIndex] of [['baseline', 0], ['recovered', 2]]) {
    const rows = expected[field];
    assert.deepEqual(rows.map(row => row[0]).sort(), ids);
    assert.ok(rows.every(row => row.length === 3 && Number.isInteger(row[1]) && Number.isInteger(row[2])
      && row[1] >= 0 && row[2] > row[1] && row[2] <= 90));
    assert.equal(Math.max(...rows.map(row => row[2])), expected.finishes[finishIndex]);
  }
  assert.equal(new Set(expected.affected).size, expected.affected.length);
  assert.ok(expected.affected.every(id => ids.includes(id)));
  assert.ok(Object.values(expected.labels).every(title => typeof title === 'string' && title.trim() === title && title.length >= 1 && title.length <= 100));
  if (values) {
    const plan = JSON.parse(values['plan-json']);
    assert.deepEqual(expected.labels, Object.fromEntries(plan.tasks.map(task => [task.id, task.title.trim()])));
  }
}
function assertFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertFrozen(child);
}

test('profile binds the approved model, ordered controls, minimum outputs and loader names', () => {
  assert.equal(RECOVERY_BROWSER_PROFILE.version, 'project-recovery-browser.v1');
  assert.equal(RECOVERY_BROWSER_PROFILE.model, 'nvidia/nemotron-3-super-120b-a12b');
  assert.deepEqual(RECOVERY_BROWSER_PROFILE.inputs.map(input => input.id), inputIds);
  assert.deepEqual(RECOVERY_BROWSER_PROFILE.inputs.map(input => input.format), ['json', 'text', 'text', 'text', 'text']);
  assert.deepEqual(RECOVERY_BROWSER_PROFILE.outputs.map(output => output.id), outputIds);
  assert.deepEqual(RECOVERY_BROWSER_PROFILE.outputs.map(output => output.format), ['text', 'text', 'text', 'text', 'text', 'text', 'timeline']);
  assert.deepEqual(RECOVERY_BROWSER_PROFILE.loaders, ['Baseline', 'Delay delivery +2 days', 'Recover one day']);
});

test('case ids and computed denominators are unique and explicit', () => {
  assert.equal(new Set(RECOVERY_BROWSER_CASES.map(entry => entry.id)).size, RECOVERY_BROWSER_CASES.length);
  assert.ok(RECOVERY_BROWSER_CASES.every(entry => /^[a-z0-9-]+$/.test(entry.id)));
  assert.deepEqual(counts, { valid: 19, invalid: 74, example: 3, stale: 10, keyboard: 4 });
  assert.equal(RECOVERY_BROWSER_CASES.length, Object.values(counts).reduce((sum, count) => sum + count, 0));
});

test('every case is JSON-representable deeply frozen plain data', () => {
  for (const value of [RECOVERY_BROWSER_PROFILE, RECOVERY_BROWSER_CASES]) {
    assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
    assertFrozen(value);
  }
  assert.throws(() => RECOVERY_BROWSER_CASES.push({}));
  assert.throws(() => { RECOVERY_BROWSER_CASES[0].expected.finishes[0] = 999; });
});

test('hand-authored expected ranges are internally consistent without scheduling input', () => {
  for (const entry of RECOVERY_BROWSER_CASES) {
    if (entry.category === 'valid') { assertValues(entry.values); assertExpected(entry.expected, entry.values); }
    if (entry.baseValues) { assertValues(entry.baseValues); assertExpected(entry.baseExpected, entry.baseValues); }
    if (entry.category === 'example') assertExpected(entry.expected);
  }
});

test('invalid and stale cases mutate exactly one named field after a complete base', () => {
  for (const entry of RECOVERY_BROWSER_CASES.filter(entry => ['invalid', 'stale'].includes(entry.category))) {
    assert.ok(inputIds.includes(entry.field));
    assert.equal(typeof entry.value, 'string');
    assert.notEqual(entry.value, entry.baseValues[entry.field]);
    const mutated = { ...entry.baseValues, [entry.field]: entry.value };
    assert.deepEqual(Object.keys(mutated).filter(key => mutated[key] !== entry.baseValues[key]), [entry.field]);
  }
  assert.ok(RECOVERY_BROWSER_CASES.some(entry => entry.id === 'invalid-duplicate-task-id'));
  const invalidScalars = RECOVERY_BROWSER_CASES.filter(entry => entry.category === 'invalid' && ['delay-days', 'recover-days'].includes(entry.field));
  assert.ok(invalidScalars.every(entry => !['', '01', '+1', '1e0'].includes(entry.value)));
});

test('stale phases and keyboard journeys have finite declared coverage', () => {
  for (const field of inputIds) {
    assert.deepEqual(RECOVERY_BROWSER_CASES.filter(entry => entry.category === 'stale' && entry.field === field).map(entry => entry.phase), ['input', 'blur']);
  }
  assert.deepEqual(RECOVERY_BROWSER_CASES.filter(entry => entry.category === 'keyboard').map(entry => entry.journey), ['traversal', 'enter', 'space', 'exit']);
});

test('oracle module imports only the existing hand-calculated data fixture', () => {
  const source = readFileSync(new URL('./fixtures/nebius-recovery-browser-cases.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.deepEqual(imports, ['./nebius-recovery-cases.mjs']);
  assert.doesNotMatch(source, /\b(?:fetch|eval|Function|require|localStorage|process)\s*\(/);
});
