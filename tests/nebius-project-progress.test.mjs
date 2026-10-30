import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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

test('visible project summary retains full-scope progress while Details contains its breakdown', () => {
  const source = readFileSync(new URL('../svelte-frontend/src/routes/work/NebiusProjectWorkspace.svelte', import.meta.url), 'utf8');
  assert.match(source, /let scoped = \$derived\(\(\$demoState\?\.packs \?\? \[\]\)\.filter\(pack => !selectedProjectId \|\| pack\.projectId === selectedProjectId\)\);/u);
  assert.match(source, /let progress = \$derived\(projectProgress\(scoped\)\);/u);
  const details = source.match(/<details class="project-details" data-project-details>[\s\S]*?<\/details>/u)?.[0] ?? '';
  assert.ok(details, 'Native details starts collapsed without an open binding');
  const summary = details.match(/<summary>[\s\S]*?<\/summary>/u)?.[0] ?? '';
  const completion = source.slice(source.indexOf('<div data-project-completion>'), source.indexOf('<details class="project-details"'));
  assert.match(completion, /progress\.done\}\/\{progress\.total\} tasks marked done · includes archived/u);
  assert.match(completion, /<WornProgress value=\{progress\.done\} max=\{progress\.total\}/u);
  assert.match(summary, /\{scoped\.length\} workspace \{scoped\.length === 1 \? 'task' : 'tasks'\} · includes archived/u);
  assert.match(summary, /<summary>Details/u);
  for (const marker of ['data-project-progress', 'data-project-all-done', 'data-project-overview', 'class="scope-note"', 'aria-label="Project next work"']) assert.ok(details.includes(marker), marker);
  assert.match(details, /including archived, before list filters/u);
  assert.match(source, /<WornButton data-new-project/u);
  assert.match(source, /data-new-project variant=\{scoped\.length === 0 \? 'primary' : undefined\}/u);
  const goal = source.indexOf('data-project-goal');
  assert(goal >= 0 && goal < source.indexOf('<details class="project-details"'), 'Project goal remains available before the collapsed details');
});
