import assert from 'node:assert/strict';
import test from 'node:test';
import { projectProgress } from '../svelte-frontend/src/lib/nebius-project-progress.mjs';

test('empty project is not complete', () => {
  assert.deepEqual(projectProgress([]), { total: 0, done: 0, remaining: 0, archived: 0, archivedUnfinished: 0, allDone: false });
});
test('mixed actual states include active, blocked and draft as open remaining', () => {
  assert.deepEqual(projectProgress([{ status: 'done' }, { status: 'active' }, { status: 'blocked' }, { status: 'draft' }]),
    { total: 4, done: 1, remaining: 3, archived: 0, archivedUnfinished: 0, allDone: false });
});
test('archived done remains in both done numerator and total denominator', () => {
  assert.deepEqual(projectProgress([{ status: 'done', archived: true }, { status: 'done' }]),
    { total: 2, done: 2, remaining: 0, archived: 1, archivedUnfinished: 0, allDone: true });
});
test('archived unfinished is not open remaining or completion', () => {
  assert.deepEqual(projectProgress([{ status: 'active', archived: true }, { status: 'done' }]),
    { total: 2, done: 1, remaining: 0, archived: 1, archivedUnfinished: 1, allDone: false });
  assert.equal(projectProgress([{ status: 'blocked', archived: true }]).allDone, false);
});
test('stable total reconciles done, open remaining and archived unfinished without mutating tasks', () => {
  const packs = Object.freeze([
    Object.freeze({ id: 'done', status: 'done', archived: true, completionEvidence: '' }),
    Object.freeze({ id: 'open', status: 'active', nextStep: 'Next', progress: 100 }),
    Object.freeze({ id: 'archived', status: 'draft', archived: true })
  ]);
  const before = structuredClone(packs);
  const actual = projectProgress(packs);
  assert.equal(actual.total, actual.done + actual.remaining + actual.archivedUnfinished);
  assert.equal(actual.done, 1, 'progress percentage never substitutes for Done status');
  assert.equal(actual.allDone, false);
  assert.deepEqual(packs, before);
});
