import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNavigation, filterCommandNavigation } from '../svelte-frontend/src/lib/nebius-command-navigation.mjs';

const projects = [{ id: 'alpha', title: 'Alpha' }, { id: 'beta', title: 'Beta' }];
const packs = [
  { id: 'a', projectId: 'alpha', title: 'Repeated title', status: 'active' },
  { id: 'b', projectId: 'beta', title: 'Repeated title', status: 'done', archived: true },
  { id: 'c', projectId: 'alpha', title: 'New task', status: 'blocked' },
  { id: 'u', title: 'Ungrouped', status: 'draft' }
];
const ids = (model) => model.tasks.map((task) => task.id);

test('Work projects retain complete input order and mark only a scoped current task', () => {
  const model = projectNavigation({ packs, projects, selectedProjectId: 'alpha', currentTaskId: 'b', pathname: '/work' });
  assert.deepEqual(model.project, projects[0]);
  assert.equal(model.scopeKey, 'project:alpha');
  assert.deepEqual(ids(model), ['a', 'c']);
  assert.equal(model.tasks.some((task) => task.current), false);
  assert.deepEqual(model.allWork, { label: 'All work', href: '/work?scope=all' });
  assert.deepEqual(ids(projectNavigation({ packs, projects, pathname: '/work' })), ['a', 'b', 'c', 'u']);
  assert.equal(projectNavigation({ packs, projects }).scopeKey, 'all');
});

test('exact Task identity overrides stale project and title collisions', () => {
  const model = projectNavigation({ packs, projects, selectedProjectId: 'alpha', currentTaskId: 'b', pathname: '/next' });
  assert.equal(model.scopeKey, 'project:beta');
  assert.deepEqual(ids(model), ['b']);
  assert.deepEqual(model.tasks[0], { id: 'b', title: 'Repeated title', href: '/next?pack=b&view=brief', current: true, status: 'done', archived: true });
});

test('ungrouped Task gets only ungrouped siblings', () => {
  const model = projectNavigation({ packs, projects, selectedProjectId: 'alpha', currentTaskId: 'u', pathname: '/next' });
  assert.equal(model.project, null);
  assert.equal(model.scopeKey, 'ungrouped');
  assert.equal(model.scopeLabel, 'Ungrouped tasks');
  assert.deepEqual(ids(model), ['u']);
});

test('missing Task identity never falls back to stale project or all work', () => {
  for (const currentTaskId of [undefined, null, '', 'missing']) {
    const model = projectNavigation({ packs, projects, selectedProjectId: 'alpha', currentTaskId, pathname: '/next' });
    assert.equal(model.project, null);
    assert.equal(model.scopeLabel, 'Task unavailable');
    assert.deepEqual(model.tasks, []);
  }
  assert.equal(projectNavigation({ packs, projects, selectedProjectId: 'gone' }).scopeKey, 'missing-project:gone');
  const orphan = projectNavigation({ packs: [{ id: 'orphan', projectId: 'gone' }], projects, currentTaskId: 'orphan', pathname: '/next' });
  assert.deepEqual(orphan.tasks, []);
});

test('caller order ignores foreign and duplicate IDs and appends newly arrived tasks', () => {
  const model = projectNavigation({ packs, projects, selectedProjectId: 'alpha', orderedIds: ['c', 'b', 'c', 'gone'] });
  assert.deepEqual(ids(model), ['c', 'a']);
  assert.deepEqual(ids(projectNavigation({ packs: [...packs, { id: 'new', projectId: 'alpha' }], projects, selectedProjectId: 'alpha', orderedIds: ['c', 'a'] })), ['c', 'a', 'new']);
});

test('arbitrary imported IDs are encoded and nonblank titles remain literal', () => {
  const id = 'a&b /?#<script>';
  const model = projectNavigation({ packs: [{ id, title: ' <img src=x onerror=alert(1)>_raw ' }, { id: 'blank', title: ' \n ' }, { id: 'missing' }] });
  assert.equal(model.tasks[0].href, `/next?pack=${encodeURIComponent(id)}&view=brief`);
  assert.equal(new URL(model.tasks[0].href, 'https://local.invalid').searchParams.get('pack'), id);
  assert.equal(model.tasks[0].title, ' <img src=x onerror=alert(1)>_raw ');
  assert.equal(model.tasks[1].title, 'Untitled');
  assert.equal(model.tasks[2].title, 'Untitled');
});

test('search uses case-insensitive literal substring, keeps order and total denominator', () => {
  const model = projectNavigation({ packs: [...packs, { id: 'syntax', title: '[.*] <b>literal</b>' }], projects });
  const matches = filterCommandNavigation(model, ' REPEATED ');
  assert.deepEqual(ids(matches), ['a', 'b']);
  assert.equal(matches.matched, 2);
  assert.equal(matches.total, 5);
  assert.deepEqual(ids(filterCommandNavigation(model, '[.*]')), ['syntax']);
  assert.equal(filterCommandNavigation(model, 'absent').matched, 0);
  assert.equal(filterCommandNavigation(model, 'absent').total, 5);
  assert.equal(filterCommandNavigation(model, ' ').matched, 5);
});

test('projection and filtering do not mutate caller state or arrays', () => {
  const options = { packs: structuredClone(packs), projects: structuredClone(projects), orderedIds: ['c', 'a'], selectedProjectId: 'alpha', currentTaskId: 'c', pathname: '/work' };
  const before = structuredClone(options);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  freeze(options);
  const model = projectNavigation(options);
  freeze(model);
  assert.deepEqual(ids(filterCommandNavigation(model, 'new')), ['c']);
  assert.deepEqual(options, before);
});
