// Independent browser oracle: no scheduler, generated source or handler imports.
// Provenance: comparison-02/initial-request.json's reviewed task and context;
// the original 12 hand-calculated RECOVERY_CASES; seven hand-derived boundaries.
// Cases count browser journeys, not assertions. Invalid/stale cases first prove
// baseExpected, then mutate one field. A blur journey includes preceding input;
// it does not establish independent change-handler coverage.
// Empty amounts and lexical spellings 01/+1/1e0 are deliberately not scored as
// invalid. No exact impact wording, error prefix, row ordering or tight horizon
// equality is required by this catalog. Task ranges must share a scale <=90.
import { RECOVERY_CASES, PROJECT_TASKS } from './nebius-recovery-cases.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const copy = value => JSON.parse(JSON.stringify(value));
export const RECOVERY_BROWSER_PROFILE = freeze({
  version: 'project-recovery-browser.v1',
  model: 'nvidia/nemotron-3-super-120b-a12b',
  inputs: [
    { id: 'plan-json', format: 'json' }, { id: 'delay-task', format: 'text' },
    { id: 'delay-days', format: 'text' }, { id: 'recover-task', format: 'text' },
    { id: 'recover-days', format: 'text' },
  ],
  outputs: [
    { id: 'baseline-finish', format: 'text' }, { id: 'delayed-finish', format: 'text' },
    { id: 'recovered-finish', format: 'text' }, { id: 'recovered-days', format: 'text' },
    { id: 'impact', format: 'text' }, { id: 'error', format: 'text' },
    { id: 'schedule', format: 'timeline' },
  ],
  loaders: ['Baseline', 'Delay delivery +2 days', 'Recover one day'],
});

const labels = tasks => Object.fromEntries(tasks.map(task => [task.id, task.title.trim()]));
function values(input) {
  return { 'plan-json': JSON.stringify({ tasks: input.tasks }),
    'delay-task': input.delayTask ?? '', 'delay-days': String(input.delayDays ?? 0),
    'recover-task': input.recoverTask ?? '', 'recover-days': String(input.recoverDays ?? 0) };
}
function expectation(input, finishes, daysRecovered, baseline, recovered, affected = []) {
  return { finishes: copy(finishes), daysRecovered, baseline: copy(baseline),
    recovered: copy(recovered), labels: labels(input.tasks), affected: copy(affected) };
}
const prewritten = RECOVERY_CASES.map((entry, index) => ({
  id: `valid-prewritten-${String(index + 1).padStart(2, '0')}`, category: 'valid',
  values: values(entry.input),
  expected: expectation(entry.input, entry.finishes, entry.daysRecovered,
    entry.baseline, entry.recovered, entry.affected),
}));
const task = (overrides = {}) => ({ id: 'a', title: 'Task A', duration: 2, dependsOn: [], ...overrides });
function singleCase(id, input, finishes, recoveredDays, baseline, recovered, affected = []) {
  return { id, category: 'valid', values: values(input),
    expected: expectation(input, finishes, recoveredDays, baseline, recovered, affected) };
}
const longId = 'A' + 'x'.repeat(79);
const eightParallel = Array.from({ length: 8 }, (_, index) => task({ id: `t${index}`, title: `Task ${index}`, duration: 30 }));
const eightChain = Array.from({ length: 8 }, (_, index) => task({ id: `t${index}`, title: `Task ${index}`, duration: 1, dependsOn: index ? [`t${index - 1}`] : [] }));
const boundaries = [
  singleCase('valid-minimum-task-duration', { tasks: [task({ duration: 1 })], delayTask: 'a', recoverTask: 'a' },
    [1, 1, 1], 0, [['a', 0, 1]], [['a', 0, 1]]),
  singleCase('valid-eight-parallel-max-durations', { tasks: eightParallel }, [30, 30, 30], 0,
    eightParallel.map(item => [item.id, 0, 30]), eightParallel.map(item => [item.id, 0, 30])),
  singleCase('valid-max-adjustments-same-task', { tasks: [task({ duration: 30 })], delayTask: 'a', delayDays: 30, recoverTask: 'a', recoverDays: 30 },
    [30, 60, 30], 30, [['a', 0, 30]], [['a', 0, 30]]),
  singleCase('valid-empty-targets-zero-amounts', { tasks: [task({ duration: 1 })], delayTask: '', delayDays: 0, recoverTask: '', recoverDays: 0 },
    [1, 1, 1], 0, [['a', 0, 1]], [['a', 0, 1]]),
  singleCase('valid-max-id-and-trimmed-title', { tasks: [task({ id: longId, title: '  ' + 'T'.repeat(100) + '  ', duration: 30 })] },
    [30, 30, 30], 0, [[longId, 0, 30]], [[longId, 0, 30]]),
  singleCase('valid-recovery-to-duration-one', { tasks: [task({ duration: 30 })], recoverTask: 'a', recoverDays: 29 },
    [30, 30, 1], 29, [['a', 0, 30]], [['a', 0, 1]], ['a']),
  singleCase('valid-eight-task-chain', { tasks: eightChain }, [8, 8, 8], 0,
    eightChain.map((item, index) => [item.id, index, index + 1]),
    eightChain.map((item, index) => [item.id, index, index + 1])),
];

const baseInput = { tasks: [task()], delayTask: 'a', delayDays: 0, recoverTask: 'a', recoverDays: 0 };
const baseValues = values(baseInput);
const baseExpected = expectation(baseInput, [2, 2, 2], 0, [['a', 0, 2]], [['a', 0, 2]]);
function invalid(id, field, value, baselineValues = baseValues, baselineExpected = baseExpected) {
  return { id: `invalid-${id.toLowerCase()}`, category: 'invalid', baseValues: copy(baselineValues),
    baseExpected: copy(baselineExpected), field, value };
}
const invalidPlan = (id, plan) => invalid(id, 'plan-json', JSON.stringify(plan));
const invalidCases = [invalid('json-syntax', 'plan-json', '{')];
for (const [id, root] of [
  ['root-null', null], ['root-array', []], ['root-boolean', true], ['root-number', 1],
  ['root-string', 'text'], ['root-missing-tasks', {}], ['root-extra-field', { tasks: [task()], extra: true }],
]) invalidCases.push(invalidPlan(id, root));
for (const [id, tasks] of [
  ['tasks-null', null], ['tasks-object', {}], ['tasks-string', 'tasks'], ['tasks-empty', []],
  ['tasks-nine', Array.from({ length: 9 }, (_, index) => task({ id: `t${index}` }))],
]) invalidCases.push(invalidPlan(id, { tasks }));
invalidCases.push(invalidPlan('task-null', { tasks: [null] }), invalidPlan('task-array', { tasks: [[]] }));
for (const field of ['id', 'title', 'duration', 'dependsOn']) {
  const incomplete = task(); delete incomplete[field];
  invalidCases.push(invalidPlan(`task-missing-${field}`, { tasks: [incomplete] }));
}
invalidCases.push(invalidPlan('task-extra-field', { tasks: [task({ extra: true })] }));
for (const [id, duration] of [
  ['zero', 0], ['negative', -1], ['above-max', 31], ['fraction', 1.5],
  ['string', '2'], ['null', null], ['boolean', true],
]) invalidCases.push(invalidPlan(`duration-${id}`, { tasks: [task({ duration })] }));
invalidCases.push(invalid('duration-overflow', 'plan-json', JSON.stringify({ tasks: [task()] }).replace('"duration":2', '"duration":1e309')));
for (const [name, id] of [
  ['empty', ''], ['space', 'with space'], ['leading-digit', '1first'], ['markup', '<b>'],
  ['constructor', 'constructor'], ['prototype', 'prototype'], ['proto', '__proto__'],
  ['above-max', 'a'.repeat(81)], ['non-ascii', 'é'], ['control', 'a\u0000'],
  ['null', null], ['number', 1],
]) invalidCases.push(invalidPlan(`id-${name}`, { tasks: [task({ id })] }));
for (const [id, title] of [
  ['empty', ''], ['blank', ' '], ['markup', '<b>Task</b>'], ['control', 'A\u0000B'],
  ['bidi', 'A\u202eB'], ['above-max', 'x'.repeat(101)], ['null', null],
]) invalidCases.push(invalidPlan(`title-${id}`, { tasks: [task({ title })] }));
for (const [id, dependsOn] of [
  ['null', null], ['string', 'a'], ['object', {}], ['unknown', ['missing']],
  ['self', ['a']], ['entry-null', [null]], ['entry-number', [1]], ['entry-object', [{}]],
]) invalidCases.push(invalidPlan(`dependency-${id}`, { tasks: [task({ dependsOn })] }));
invalidCases.push(
  invalidPlan('dependency-duplicate', { tasks: [task(), task({ id: 'b', dependsOn: ['a', 'a'] })] }),
  invalidPlan('dependency-two-task-cycle', { tasks: [task({ dependsOn: ['b'] }), task({ id: 'b', dependsOn: ['a'] })] }),
  invalidPlan('dependency-disconnected-cycle', { tasks: [task(), task({ id: 'b', dependsOn: ['c'] }), task({ id: 'c', dependsOn: ['b'] })] }),
  invalidPlan('duplicate-task-id', { tasks: [task(), task({ title: 'Different title' })] }),
);
for (const field of ['delay-days', 'recover-days']) {
  for (const [name, amount] of [['negative', '-1'], ['above-max', '31'], ['fraction', '.5'], ['not-numeric', 'x']]) {
    invalidCases.push(invalid(`${field}-${name}`, field, amount));
  }
}
const delayInput = { ...baseInput, delayDays: 1 };
const delayExpected = expectation(delayInput, [2, 3, 3], 0, [['a', 0, 2]], [['a', 0, 3]], ['a']);
const recoveryInput = { ...baseInput, recoverDays: 1 };
const recoveryExpected = expectation(recoveryInput, [2, 2, 1], 1, [['a', 0, 2]], [['a', 0, 1]], ['a']);
for (const target of ['', 'missing']) {
  const name = target ? 'unknown' : 'empty';
  invalidCases.push(invalid(`delay-target-${name}`, 'delay-task', target, values(delayInput), delayExpected),
    invalid(`recovery-target-${name}`, 'recover-task', target, values(recoveryInput), recoveryExpected));
}
invalidCases.push(invalid('recovery-below-duration-one', 'recover-days', '2'));
const horizon = RECOVERY_CASES.find(entry => entry.name === '90-day horizon is inclusive');
const horizonValues = values({ ...horizon.input, delayTask: 'a' });
const horizonExpected = expectation(horizon.input, horizon.finishes, horizon.daysRecovered,
  horizon.baseline, horizon.recovered, horizon.affected);
invalidCases.push(invalidPlan('baseline-above-horizon', { tasks: [
  task({ id: 'a', duration: 30 }), task({ id: 'b', duration: 30, dependsOn: ['a'] }),
  task({ id: 'c', duration: 30, dependsOn: ['b'] }), task({ id: 'd', duration: 1, dependsOn: ['c'] }),
] }), invalid('delayed-above-horizon-before-recovery', 'delay-days', '1', horizonValues, horizonExpected));

const examples = RECOVERY_BROWSER_PROFILE.loaders.map((loader, index) => ({
  id: `example-${index + 1}`, category: 'example', loader, expected: copy(prewritten[index].expected),
}));
const staleEdits = {
  'plan-json': JSON.stringify({ tasks: [task({ duration: 0 })] }),
  'delay-task': 'missing', 'delay-days': 'x', 'recover-task': 'missing', 'recover-days': 'x',
};
const stale = Object.entries(staleEdits).flatMap(([field, value]) => ['input', 'blur'].map(phase => ({
  id: `stale-${field}-${phase}`, category: 'stale', baseValues: copy(prewritten[2].values),
  baseExpected: copy(prewritten[2].expected), field, value, phase,
})));
const keyboard = ['traversal', 'enter', 'space', 'exit'].map(journey => ({
  id: `keyboard-${journey}`, category: 'keyboard', journey,
}));
export const RECOVERY_BROWSER_CASES = freeze([
  ...prewritten, ...boundaries, ...invalidCases, ...examples, ...stale, ...keyboard,
]);
