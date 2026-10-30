import assert from 'node:assert/strict';
import test from 'node:test';
import { captureRehearsal, previewRehearsal, REHEARSAL_EXAMPLE } from '../svelte-frontend/src/lib/nebius-project-rehearsal.mjs';
import { projectProgress } from '../svelte-frontend/src/lib/nebius-project-progress.mjs';

const project = { id: 'release', title: 'Release review', summary: 'Visible project goal' };
const task = (id, extra = {}) => ({ id, projectId: project.id, title: `Task ${id}`, status: 'active', ...extra });
function capture(tasks, inputProject = project) {
  const result = captureRehearsal(inputProject, tasks);
  assert.equal(result.ok, true, result.error);
  return result.snapshot;
}
function preview(snapshot, targetId, title = 'Add CSV export') {
  const result = previewRehearsal(snapshot, { title, targetId });
  assert.equal(result.ok, true, result.error);
  return result.preview;
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('authored offline example has the exact release-review states without execution records', () => {
  const snapshot = capture(REHEARSAL_EXAMPLE.tasks, REHEARSAL_EXAMPLE.project);
  assert.deepEqual(snapshot.tasks.map(({ title, status, blockedBy, hasSavedRun }) => ({ title, status, blockedBy, hasSavedRun })), [
    { title: 'Define packet', status: 'done', blockedBy: null, hasSavedRun: false },
    { title: 'Build checker', status: 'done', blockedBy: null, hasSavedRun: false },
    { title: 'Prepare handoff', status: 'active', blockedBy: null, hasSavedRun: false }
  ]);
  assert.equal(snapshot.progress.done, 2);
  assert.equal(preview(snapshot, 'authored-prepare-handoff').progress.total, 4);
  assert.doesNotMatch(JSON.stringify(REHEARSAL_EXAMPLE), /executionRun|provider/u);
});

test('capture preserves caller order, visible text, saved ids and archived denominators', () => {
  const tasks = [task('z', { status: 'done', archived: true }), task('a', { status: 'draft', archived: true }),
    task('b', { status: 'blocked', blockedBy: 'z', blocker: '  Waiting on owner\nKeep this detail.  ' })];
  const snapshot = capture(tasks);
  assert.deepEqual(snapshot.tasks.map(item => item.id), ['z', 'a', 'b']);
  assert.equal(snapshot.tasks[2].blocker, tasks[2].blocker);
  assert.deepEqual(snapshot.project, { id: project.id, title: project.title, goal: project.summary });
  assert.deepEqual(snapshot.progress, { total: 3, done: 1, remaining: 1, archived: 2, archivedUnfinished: 1, allDone: false });
});

test('capture refuses invalid projects, empty projects, missing fields and unsupported states', () => {
  for (const inputProject of [null, [], {}, { ...project, id: '' }, { ...project, title: ' ' }, { ...project, summary: null }]) {
    assert.equal(captureRehearsal(inputProject, [task('a')]).ok, false);
  }
  for (const tasks of [null, [], [null], [task('')], [task('a', { title: ' ' })], [task('a', { status: 'ready' })],
    [task('a', { archived: 'false' })], [task('a', { blocker: {} })], [task('a', { blockedBy: 2 })],
    [task('a', { projectId: 'other' })], [task('a', { projectId: undefined })], [task('a'), task('a')]]) {
    const result = captureRehearsal(project, tasks);
    assert.equal(result.ok, false, JSON.stringify(tasks));
    assert.equal(typeof result.error, 'string');
  }
  assert.equal(capture([task('a')], { ...project, summary: '' }).project.goal, '');
});

test('capture rejects missing predecessors, self references and indirect cycles by id', () => {
  for (const tasks of [[task('a', { blockedBy: 'missing' })], [task('a', { blockedBy: 'a' })],
    [task('a', { blockedBy: 'b' }), task('b', { blockedBy: 'c' }), task('c', { blockedBy: 'a' })]]) {
    assert.equal(captureRehearsal(project, tasks).ok, false);
  }
  const snapshot = capture([task('a', { title: 'Same' }), task('b', { title: 'Same', blockedBy: 'a' })]);
  assert.equal(snapshot.tasks[1].blockedBy, 'a');
});

test('capture and preview isolate all private fields, even cyclic run data with traversal traps', () => {
  const forbidden = ['SECRET_TOKEN_961', 'PRIVATE_SOURCE_962', 'PRIVATE_PURPOSE_963', 'HIDDEN_EVIDENCE_964', 'PRIVATE_RUN_KEY_965'];
  const run = { token: forbidden[0], source: forbidden[1], key: forbidden[4] };
  run.self = run;
  Object.defineProperty(run, 'trap', { enumerable: true, get() { throw new Error('Run must never be traversed'); } });
  const tasks = [task('a', { executionRun: run, purpose: forbidden[2], completionEvidence: forbidden[3],
    sources: [forbidden[1]], executionInputs: { token: forbidden[0] }, retiredExecutionRuns: [run] })];
  const snapshot = capture(tasks, { ...project, credential: forbidden[0], source: forbidden[1] });
  const result = preview(snapshot, 'a');
  assert.equal(snapshot.tasks[0].hasSavedRun, true);
  assert.equal(result.tasks[1].hasSavedRun, true);
  assert.equal(result.tasks[0].hasSavedRun, false);
  for (const value of forbidden) {
    assert.equal(JSON.stringify(snapshot).includes(value), false, value);
    assert.equal(JSON.stringify(result).includes(value), false, value);
  }
  assert.deepEqual(Object.keys(snapshot.tasks[0]).sort(), ['id', 'title', 'status', 'archived', 'blockedBy', 'blocker', 'hasSavedRun', 'change'].sort());
  assert.equal(capture([task('b', { executionRun: null })]).tasks[0].hasSavedRun, false);
});

test('signature is deterministic and changes only with relevant visible context and order', () => {
  const tasks = [task('a'), task('b')];
  const original = capture(tasks);
  assert.equal(capture(structuredClone(tasks)).signature, original.signature);
  assert.equal(capture(tasks.map(item => ({ ...item, purpose: 'private changed', progress: 88, source: 'hidden' }))).signature, original.signature);
  const withRun = capture([task('a', { executionRun: { key: 'first' } }), task('b')]);
  assert.equal(capture([task('a', { executionRun: { key: 'second', token: 'new' } }), task('b')]).signature, withRun.signature);
  assert.notEqual(withRun.signature, original.signature, 'attachment presence is visible context');
  for (const field of [{ title: 'new title' }, { status: 'blocked' }, { archived: true }, { blockedBy: 'b' }, { blocker: 'New blocker' }]) {
    assert.notEqual(capture([task('a', field), task('b')]).signature, original.signature);
  }
  assert.notEqual(capture([...tasks].reverse()).signature, original.signature);
  assert.notEqual(capture(tasks, { ...project, summary: 'Changed goal' }).signature, original.signature);
});

test('preview splices requirement before explicit target and rewires only its predecessor', () => {
  const tasks = [task('third', { status: 'done' }), task('first', { blockedBy: 'third', status: 'blocked', blocker: 'Waiting for owner' }),
    task('last', { blockedBy: 'first', status: 'draft' })];
  const snapshot = capture(tasks);
  const result = preview(snapshot, 'first');
  assert.deepEqual(result.tasks.map(item => item.id), ['third', result.addedId, 'first', 'last']);
  assert.deepEqual(result.tasks[1], { id: result.addedId, title: 'Add CSV export', status: 'draft', archived: false,
    blockedBy: 'third', blocker: '', hasSavedRun: false, change: 'added' });
  assert.deepEqual(result.tasks[2], { ...snapshot.tasks[1], status: 'blocked', blockedBy: result.addedId, change: 'changed' });
  assert.equal(result.tasks[2].blocker, 'Waiting for owner');
  assert.deepEqual(result.tasks[0], snapshot.tasks[0]);
  assert.deepEqual(result.tasks[3], snapshot.tasks[2]);
  assert.equal(result.sourceSignature, snapshot.signature);
  assert.equal(result.changedId, 'first');
});

test('unblocked targets wait for the new draft and the new draft has no predecessor', () => {
  const result = preview(capture([task('a')]), 'a');
  assert.equal(result.tasks[0].blockedBy, null);
  assert.equal(result.tasks[1].blockedBy, result.addedId);
  assert.equal(result.tasks[1].status, 'blocked');
  assert.equal(result.tasks[1].blocker, '');
});

test('preview adds exactly one to total and remaining while keeping archived and done counts', () => {
  const snapshot = capture([task('done', { status: 'done', archived: true }), task('old', { status: 'draft', archived: true }), task('open')]);
  const result = preview(snapshot, 'open');
  assert.deepEqual(result.progress, { ...snapshot.progress, total: snapshot.progress.total + 1, remaining: snapshot.progress.remaining + 1 });
  assert.deepEqual(result.progress, projectProgress(result.tasks));
  assert.equal(result.progress.total, result.progress.done + result.progress.remaining + result.progress.archivedUnfinished);
});

test('capture and preview work with frozen inputs and return independent plain copies', () => {
  const inputProject = freeze({ ...project }), tasks = freeze([task('a'), task('b', { blockedBy: 'a' })]);
  const snapshot = freeze(capture(tasks, inputProject));
  const before = JSON.stringify(snapshot);
  const result = preview(snapshot, 'b');
  assert.equal(JSON.stringify(snapshot), before);
  assert.notEqual(snapshot.project, inputProject);
  assert.notEqual(snapshot.tasks[0], tasks[0]);
  for (const item of result.tasks.filter(item => item.id !== result.addedId)) {
    assert.notEqual(item, snapshot.tasks.find(source => source.id === item.id));
  }
  result.tasks[0].title = 'Temporary edit';
  assert.equal(snapshot.tasks[0].title, 'Task a');
  assert.equal(Object.getPrototypeOf(result.tasks[0]), Object.prototype);
});

test('preview refuses blank or long requirements, implicit targets, completed and archived tasks', () => {
  const snapshot = capture([task('open'), task('done', { status: 'done' }), task('old', { archived: true })]);
  for (const input of [null, {}, { title: ' ', targetId: 'open' }, { title: 'x'.repeat(161), targetId: 'open' },
    { title: 'Export', targetId: '' }, { title: 'Export', targetId: 'Task open' }, { title: 'Export', targetId: 'missing' },
    { title: 'Export', targetId: 'done' }, { title: 'Export', targetId: 'old' }]) {
    assert.equal(previewRehearsal(snapshot, input).ok, false);
  }
  assert.equal(preview(snapshot, 'open', 'x'.repeat(160)).tasks[0].title.length, 160);
  assert.equal(preview(snapshot, 'open', '  Export  ').tasks[0].title, 'Export');
});

test('preview rejects malformed or changed snapshots rather than trusting forged progress or signature', () => {
  const snapshot = capture([task('a'), task('b')]);
  const changes = [value => { value.signature = 'forged'; }, value => { value.progress.total++; },
    value => { value.tasks[0].title = 'Edited after capture'; }, value => { value.tasks[0].status = 'ready'; },
    value => { value.tasks[0].change = 'added'; }, value => { value.tasks[0].hasSavedRun = 'true'; },
    value => { value.tasks[0].blockedBy = 'missing'; }, value => { value.tasks.push(value.tasks[0]); },
    value => { value.tasks = []; }, value => { value.project.goal = null; },
    value => { value.tasks[0].executionRun = { key: 'hidden' }; }];
  for (const mutate of changes) {
    const changed = structuredClone(snapshot);
    mutate(changed);
    assert.equal(previewRehearsal(changed, { title: 'Export', targetId: 'a' }).ok, false);
  }
  for (const invalid of [null, {}, { ...snapshot, tasks: null }]) assert.equal(previewRehearsal(invalid, { title: 'Export', targetId: 'a' }).ok, false);
});

test('temporary ids avoid every saved collision and repeated previews stay deterministic', () => {
  const snapshot = capture([task('rehearsal-requirement'), task('rehearsal-requirement-2'), task('target')]);
  const first = preview(snapshot, 'target'), second = preview(snapshot, 'target');
  assert.equal(first.addedId, 'rehearsal-requirement-3');
  assert.equal(new Set(first.tasks.map(item => item.id)).size, first.tasks.length);
  assert.deepEqual(first, second);
});
