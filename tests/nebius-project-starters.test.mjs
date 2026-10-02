import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PROJECT_STARTERS, getProjectStarter } from '../svelte-frontend/src/lib/nebius-project-starters.mjs';
import { validatePlanInput, validateProjectPlan } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';

test('human-written starters have useful validated plans and explicit open questions', () => {
  assert.deepEqual(PROJECT_STARTERS.map(starter => starter.id), ['release-packet-checker', 'website-release', 'workshop', 'customer-handoff']);
  assert.deepEqual(PROJECT_STARTERS.map(starter => starter.label), ['Release-packet checker', 'Website release', 'Workshop', 'Customer handoff']);
  for (const starter of PROJECT_STARTERS) {
    assert.deepEqual(Object.keys(starter).sort(), ['brief', 'id', 'label', 'plan']);
    assert.equal(validatePlanInput({ brief: starter.brief }).brief, starter.brief);
    assert.deepEqual(validateProjectPlan(starter.plan), starter.plan);
    const taskCount = starter.id === 'release-packet-checker' ? 2 : 3;
    assert.equal(starter.plan.tasks.length, taskCount);
    assert.equal(new Set(starter.plan.tasks.map(task => task.id)).size, taskCount);
    assert.equal(starter.plan.tasks[0].dependsOn, null);
    assert.equal(starter.plan.tasks[1].dependsOn, starter.plan.tasks[0].id);
    if (taskCount === 3) assert.equal(starter.plan.tasks[2].dependsOn, starter.plan.tasks[1].id);
    assert.ok(starter.plan.missingInformation.length > 0);
    assert.ok(starter.plan.missingInformation.every(fact => fact.endsWith('?')));
    for (const task of starter.plan.tasks) {
      assert.ok(task.nextStep.trim());
      assert.ok(task.doneWhen.trim());
      for (const field of ['owner', 'due', 'completionEvidence', 'progress', 'status', 'source']) assert.equal(field in task, false);
    }
  }
});

test('exported examples are frozen at every nested level', () => {
  function assertFrozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertFrozen(child);
  }
  assertFrozen(PROJECT_STARTERS);
  assert.throws(() => PROJECT_STARTERS.push({}));
  assert.throws(() => { PROJECT_STARTERS[0].label = 'Changed label'; });
  assert.throws(() => { PROJECT_STARTERS[0].plan.tasks[0].nextStep = 'Changed step'; });
  assert.throws(() => PROJECT_STARTERS[0].plan.missingInformation.push('New question?'));
});

test('selection returns a fresh validated editable copy without leaking edits into another draft', () => {
  for (const original of PROJECT_STARTERS) {
    const selected = getProjectStarter(original.id);
    const other = getProjectStarter(original.id);
    assert.deepEqual(selected, original);
    assert.notEqual(selected, original);
    assert.notEqual(selected.plan, original.plan);
    assert.notEqual(selected.plan.tasks, original.plan.tasks);
    assert.notEqual(selected.plan.tasks[0], original.plan.tasks[0]);
    assert.notEqual(selected.plan.missingInformation, original.plan.missingInformation);
    assert.notEqual(selected.plan, other.plan);
    selected.brief = 'A revised brief.';
    selected.plan.tasks[0].title = 'A revised task';
    selected.plan.tasks[1].dependsOn = null;
    selected.plan.missingInformation.push('A new question?');
    assert.deepEqual(getProjectStarter(original.id), original);
    assert.deepEqual(other, original);
    assert.equal(Object.isFrozen(selected), false);
    assert.equal(Object.isFrozen(selected.plan.tasks[0]), false);
  }
});

test('unknown starter ids refuse selection rather than substituting an example', () => {
  for (const id of ['', 'unknown', 'Website release', 'website-release ', '__proto__', null, undefined, 0]) {
    assert.throws(() => getProjectStarter(id), /Unknown project starter/u);
  }
});

test('checker criteria require input errors, result invalidation and actual handler assertions', () => {
  const task = getProjectStarter('release-packet-checker').plan.tasks[0];
  assert.match(task.purpose, /Health values: missing, failing or passing/u);
  assert.match(task.purpose, /Review values: pending, rejected or approved/u);
  assert.match(task.purpose, /Use "1 gap: <reason>" for one gap and "<N> gaps: <reasons>" otherwise/u);
  assert.match(task.purpose, /Health, Review, Rollback order, joined by "; "/u);
  assert.match(task.purpose, /Invalid JSON or fields start exactly "Input error: " followed by a useful reason, never readiness/u);
  assert.match(task.doneWhen, /Invalid enums show an input error, never a gap count/u);
  assert.match(task.doneWhen, /Editing or loading another input clears or replaces the old result/u);
  assert.match(task.doneWhen, /actual validate and handleMessage functions/u);
  assert.ok(task.doneWhen.length <= 1000);
  assert.ok(task.purpose.length <= 1000);
  assert.deepEqual(task.executionInputs, [{ id: 'input-json', format: 'json' }]);
});

test('starter data has only pure validation dependencies and no state or provider access', () => {
  const source = readFileSync(new URL('../svelte-frontend/src/lib/nebius-project-starters.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map(match => match[1]);
  assert.deepEqual(imports, ['./nebius-plan-contract.mjs']);
  assert.doesNotMatch(source, /\b(?:fetch|localStorage|sessionStorage|navigator|window|approveProjectPlan|demoState)\b/u);
  assert.doesNotMatch(source, /(?:https?:\/\/|\/api\/nebius|NEBIUS_MODEL)/u);
});
