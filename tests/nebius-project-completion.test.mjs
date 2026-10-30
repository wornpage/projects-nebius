import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createProjectPlanState } from '../svelte-frontend/src/lib/nebius-project-state.mjs';
import { unblockPacksBlockedBy } from '../svelte-frontend/src/lib/workflow-rules.mjs';

const lib = new URL('../svelte-frontend/src/lib/', import.meta.url);
const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const ts = require('typescript');
const dependencies = Object.fromEntries(await Promise.all([
  'nebius-contract.mjs', 'nebius-execution-contract.mjs',
  'canonical-text.mjs', 'browser-state-envelope.mjs', 'workflow-rules.mjs', 'pending-next-action.mjs',
  'batch-actions.mjs', 'nebius-project-state.mjs', 'nebius-replan-contract.mjs', 'nebius-replan-state.mjs'
].map(async name => [name, await import(new URL(name, lib))])));
const projectId = 'execution-project', rootId = `${projectId}:root`, successorId = `${projectId}:successor`, finalId = `${projectId}:final`;
const seed = (rootTitle = 'Confirm scope') => createProjectPlanState({ packs: [{ id: 'unrelated', title: 'Unrelated work', status: 'active', next: 'Open', blocker: 'none', memory: ['Keep unrelated work'], custom: { retained: true } }],
  customMetadata: { retained: true }, manualOrder: ['unrelated'], filter: 'all' }, {
  brief: 'Complete the project in dependency order.', approvalId: projectId, source: 'manual', createdAt: '2026-09-28T01:00:00.000Z',
  plan: { title: 'Execution project', summary: 'Three steps.', missingInformation: [], tasks: [
    { id: 'root', title: rootTitle, purpose: 'Collect requirements.', nextStep: 'Ask for requirements.', doneWhen: 'Requirements documented.', dependsOn: null },
    { id: 'successor', title: 'Prepare draft', purpose: 'Use confirmed requirements.', nextStep: 'Draft the work.', doneWhen: 'Draft reviewed.', dependsOn: 'root' },
    { id: 'final', title: 'Approve handoff', purpose: 'Review the draft.', nextStep: 'Review the draft.', doneWhen: 'Handoff approved.', dependsOn: 'successor' }
  ] }
}).state;
const json = value => JSON.parse(JSON.stringify(value));
const envelope = (state, revision = 'revision-1') => JSON.stringify({ schemaVersion: 1, revision, state });
function writable(value) {
  const subscribers = new Set();
  return { subscribe(fn) { subscribers.add(fn); fn(value); return () => subscribers.delete(fn); }, set(next) { value = next; for (const fn of subscribers) fn(value); }, update(fn) { this.set(fn(value)); } };
}
function get(store) { let value; store.subscribe(next => { value = next; })(); return value; }
// Execute the actual TS owner and display helper with deterministic browser
// facilities; never copy its persistence, receipt or completion implementation.
function browserClient(serialized = envelope(seed()), { failWrite = false, nebius = true } = {}) {
  let saved = serialized, writes = 0, tail = Promise.resolve(), pauseNext = null;
  const context = vm.createContext({ __NEBIUS_EDITION__: nebius, structuredClone, crypto: webcrypto, Date, Error, TypeError, SyntaxError, console,
    localStorage: { getItem() { return saved; }, setItem(key, value) { if (failWrite) throw new Error('Full'); saved = value; writes++; }, removeItem() { saved = null; } },
    navigator: { locks: { request(name, options, operation) {
      assert.equal(name, 'projects-webmcp-challenge-state-v1-write'); assert.equal(options.mode, 'exclusive');
      const pause = pauseNext; pauseNext = null; const result = tail.then(async () => { if (pause) await pause; return operation(); }); tail = result.catch(() => {}); return result;
    } } }, fetch: async () => ({ ok: true, json: async () => [] }) });
  function compile(name, extras = {}) {
    const code = ts.transpileModule(readFileSync(new URL(name, lib), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {}, resolve = id => {
      if (id === '$app/environment') return { browser: true }; if (id === 'svelte/store') return { writable, get }; if (id in extras) return extras[id];
      const key = id.replace(/^\$lib\//u, '').replace(/^\.\//u, ''); if (key in dependencies) return dependencies[key]; throw new Error(`Unexpected dependency ${id}`);
    };
    new vm.Script(`(function(exports, require) { ${code}\n })`, { filename: name }).runInContext(context)(exports, resolve); return exports;
  }
  const workflow = compile('demo-workflow.ts'), execution = compile('nebius-execution-client.ts');
  const client = compile('demo-client.ts', { '$lib/demo-workflow': workflow, './nebius-execution-client': execution });
  const undo = compile('undo.ts', { '$lib/demo-workflow': workflow, '$lib/demo-client': client });
  return { client, workflow, undo, get saved() { return saved; }, get writes() { return writes; }, pauseWrite(promise) { pauseNext = promise; }, overwrite(value) { saved = value; } };
}
const finish = async (browser, entrypoint, id) => {
  if (entrypoint === 'action') return browser.client.runPackAction(id, 'done');
  if (entrypoint === 'batch') return (await browser.client.runPackBatchAction([id], 'done')).receipt;
  const pack = get(browser.client.demoState).packs.find(p => p.id === id);
  return (await browser.client.savePackPath(id, { status: 'done' }, browser.client.packPathSignature(pack))).receipt;
};
for (const entrypoint of ['action', 'batch', 'path']) {
  test(`${entrypoint} follows root -> successor -> final, returns exact IDs and preserves metadata through reload`, async () => {
    const state = seed(); state.packs[1].memory = ['Retain root note']; state.packs[2].owner = 'Existing owner'; state.packs[2].custom = { retained: true };
    const browser = browserClient(envelope(state)); await browser.client.refreshDemoState();
    for (const [id, expected] of [[rootId, [successorId]], [successorId, [finalId]], [finalId, []]]) {
      const receipt = await finish(browser, entrypoint, id); assert.deepEqual(json(receipt.unblockedWorkIds), expected);
      const current = get(browser.client.demoState); const done = current.packs.find(p => p.id === id); assert.equal(done.status, 'done');
      assert.deepEqual(json(browser.workflow.receiptReadyPacks(receipt, current.packs, projectId)).map(p => p.id), expected);
      if (expected.length) { const ready = current.packs.find(p => p.id === expected[0]); assert.equal(ready.status, 'active'); assert.equal(ready.blockedBy, ''); assert.equal(ready.blocker, 'none'); assert.match(ready.activity.at(-1), /was marked done/u); }
      assert.deepEqual(json(current.projects), state.projects); assert.deepEqual(json(current.packs[0]), state.packs[0]); assert.deepEqual(json(current.customMetadata), state.customMetadata);
    }
    const current = get(browser.client.demoState); assert.equal(current.packs.filter(p => p.projectId === projectId && p.status === 'done').length, 3);
    assert.deepEqual(json(current.packs[1].memory), ['Retain root note']); assert.equal(current.packs[2].owner, 'Existing owner'); assert.deepEqual(json(current.packs[2].custom), { retained: true });
    assert.equal(browser.writes, 3); const fresh = browserClient(browser.saved); assert.deepEqual(json(await fresh.client.refreshDemoState()), json(current)); assert.equal(fresh.writes, 0);
    const activities = current.packs.flatMap(p => p.activity || []).join('\n'); assert(!activities.includes('finished with proof')); assert(!activities.includes('Proof saved:'));
    const before = browser.saved;
    if (entrypoint === 'batch') { await assert.rejects(finish(browser, entrypoint, finalId), /None of the selected/u); assert.equal(browser.saved, before); }
    else { const repeated = await finish(browser, entrypoint, finalId); assert.deepEqual(json(repeated.unblockedWorkIds), []); assert.deepEqual(json(get(browser.client.demoState).packs), json(current.packs)); }
  });
}
test('batch raw receipts preserve all helper IDs while live ready view removes members also completed by that batch', async () => {
  const browser = browserClient(); await browser.client.refreshDemoState();
  const result = await browser.client.runPackBatchAction([rootId, successorId], 'done');
  assert.deepEqual(json(result.receipt.unblockedWorkIds), [successorId, finalId]);
  assert.deepEqual(json(browser.workflow.receiptReadyPacks(result.receipt, get(browser.client.demoState).packs, projectId)).map(p => p.id), [finalId]);
});
test('archived targets have their dependency released without a false newly-unblocked ID', async () => {
  const state = seed(); state.packs[2].archived = true; const browser = browserClient(envelope(state)); await browser.client.refreshDemoState();
  const receipt = await finish(browser, 'action', rootId); assert.deepEqual(json(receipt.unblockedWorkIds), []);
  assert.deepEqual(json(browser.workflow.receiptReadyPacks(receipt, get(browser.client.demoState).packs, projectId)), []);
});
for (const entrypoint of ['action', 'batch', 'path']) {
  test(`${entrypoint} releases the creation-owned slug dependency despite a different display title`, async () => {
    const state = seed('post-workshop-outline'); assert.equal(state.packs[2].blocker, 'Waiting for post-workshop-outline');
    const browser = browserClient(envelope(state)); await browser.client.refreshDemoState();
    assert.equal(browser.workflow.workTitle(state.packs[1]), 'Post workshop outline');
    const receipt = await finish(browser, entrypoint, rootId), successor = get(browser.client.demoState).packs.find(p => p.id === successorId);
    assert.deepEqual(json(receipt.unblockedWorkIds), [successorId]); assert.equal(successor.blockedBy, ''); assert.equal(successor.blocker, 'none'); assert.equal(successor.status, 'active');
    assert.match(successor.activity.at(-1), /Unblocked: Post workshop outline was marked done/u);
  });
  test(`${entrypoint} releases the actual creation-capped Unicode title without guessing or splitting a surrogate`, async () => {
    const rootTitle = `${'x'.repeat(187)}🚀${'y'.repeat(11)}`, state = seed(rootTitle);
    const expectedBlocker = `Waiting for ${rootTitle}`.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, '');
    assert.equal(state.packs[2].blocker, expectedBlocker); assert.equal(expectedBlocker.length, 199); assert(!/[\uD800-\uDBFF]$/u.test(expectedBlocker));
    const browser = browserClient(envelope(state)); await browser.client.refreshDemoState();
    const receipt = await finish(browser, entrypoint, rootId), successor = get(browser.client.demoState).packs.find(p => p.id === successorId);
    assert.deepEqual(json(receipt.unblockedWorkIds), [successorId]); assert.equal(successor.blockedBy, ''); assert.equal(successor.blocker, 'none'); assert.equal(successor.status, 'active');
  });
  test(`${entrypoint} releases only the predecessor and retains independent blocker, status and metadata`, async () => {
    const state = seed(); const successor = state.packs.find(p => p.id === successorId);
    Object.assign(successor, { blocker: 'Venue and meeting link still need confirmation.', status: 'blocked', memory: ['Keep the venue concern'], custom: { preserved: true } });
    const browser = browserClient(envelope(state)); await browser.client.refreshDemoState();
    const receipt = await finish(browser, entrypoint, rootId), current = get(browser.client.demoState), retained = current.packs.find(p => p.id === successorId);
    assert.deepEqual(json(receipt.unblockedWorkIds), []); assert(!receipt.summary.includes('Unblocked 1')); assert.equal(retained.blockedBy, '');
    assert.equal(retained.blocker, successor.blocker); assert.equal(retained.status, 'blocked'); assert.deepEqual(json(retained.memory), successor.memory); assert.deepEqual(json(retained.custom), successor.custom);
    assert.match(retained.activity.at(-1), /Dependency released.*Existing blocker retained/u); assert(!retained.activity.at(-1).includes('Unblocked:'));
    assert.deepEqual(json(browser.workflow.receiptReadyPacks(receipt, current.packs, projectId)), []);
    const fresh = browserClient(browser.saved); assert.deepEqual(json(await fresh.client.refreshDemoState()), json(current)); assert.equal(fresh.writes, 0);
  });
  test(`${entrypoint} preserves ambiguous dependency text after predecessor rename instead of guessing`, async () => {
    const state = seed(), originalBlocker = state.packs[2].blocker; state.packs[1].title = 'Confirm revised scope';
    const browser = browserClient(envelope(state)); await browser.client.refreshDemoState(); const receipt = await finish(browser, entrypoint, rootId);
    const successor = get(browser.client.demoState).packs.find(p => p.id === successorId);
    assert.equal(successor.blockedBy, ''); assert.equal(successor.blocker, originalBlocker); assert.equal(successor.status, 'blocked'); assert.deepEqual(json(receipt.unblockedWorkIds), []);
  });
  for (const terminal of ['done', 'archived']) {
    test(`${entrypoint} does not reactivate ${terminal} dependents or claim them newly unblocked`, async () => {
      const state = seed(), successor = state.packs[2];
      if (terminal === 'done') successor.status = 'done'; else successor.archived = true;
      const prior = structuredClone(successor), browser = browserClient(envelope(state)); await browser.client.refreshDemoState();
      const receipt = await finish(browser, entrypoint, rootId), current = get(browser.client.demoState), target = current.packs.find(p => p.id === successorId);
      assert.equal(target.blockedBy, ''); assert.equal(target.status, prior.status); assert.equal(target.archived, prior.archived); assert.equal(target.blocker, prior.blocker);
      assert.deepEqual(json(receipt.unblockedWorkIds), []); assert.deepEqual(json(browser.workflow.receiptReadyPacks(receipt, current.packs, projectId)), []);
    });
  }
  test(`${entrypoint} recognizes normalized no-blocker and default dependency-only text`, async () => {
    for (const blocker of ['None', ' NONE ', '', ' Waiting   for Confirm  scope ']) {
      const state = seed(); state.packs[2].blocker = blocker; const browser = browserClient(envelope(state)); await browser.client.refreshDemoState();
      const receipt = await finish(browser, entrypoint, rootId), successor = get(browser.client.demoState).packs.find(p => p.id === successorId);
      assert.deepEqual(json(receipt.unblockedWorkIds), [successorId]); assert.equal(successor.blocker, 'none'); assert.equal(successor.status, 'active'); assert.equal(successor.blockedBy, '');
    }
  });
}
test('compound or differently named blockers remain independent; no metadata is invented', () => {
  for (const blocker of ['Waiting for Confirm scope; venue unavailable', 'Waiting for another task', 'waiting for Confirm scope', 'Unrelated blocker']) {
    const packs = seed().packs, root = packs[1], successor = packs[2]; successor.blocker = blocker; successor.status = 'draft';
    const fields = Object.keys(successor).sort(), result = unblockPacksBlockedBy(packs, root, { onActivity() {}, workTitle: p => p.title });
    assert.deepEqual(result, []); assert.equal(successor.blocker, blocker); assert.equal(successor.status, 'draft'); assert.equal(successor.blockedBy, ''); assert.deepEqual(Object.keys(successor).sort(), fields);
  }
});
test('dependency-only work without an action releases the link but is not counted ready', () => {
  const packs = seed().packs, root = packs[1], successor = packs[2]; successor.next = '';
  const activity = [], result = unblockPacksBlockedBy(packs, root, { onActivity: (pack, text) => activity.push(text), workTitle: p => p.title });
  assert.deepEqual(result, []); assert.equal(successor.blocker, 'none'); assert.equal(successor.status, 'draft'); assert.equal(successor.blockedBy, ''); assert.match(activity[0], /^Dependency released:/u);
});
test('default dependency blocker recognition uses the persisted cap and does not split a surrogate pair', () => {
  const state = seed(), root = state.packs[1], successor = state.packs[2]; root.title = `${'x'.repeat(187)}🚀${'y'.repeat(11)}`;
  successor.blocker = `Waiting for ${root.title}`.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, '');
  const result = unblockPacksBlockedBy(state.packs, root, { onActivity() {}, workTitle: p => p.title });
  assert.deepEqual(result.map(p => p.id), [successorId]); assert.equal(successor.blocker, 'none'); assert.equal(successor.status, 'active');
});
test('live ready links exclude unknown, duplicate, done, blocked, archived, predecessor, missing action and other project IDs', () => {
  const browser = browserClient(), good = { id: 'ready:α', title: 'Current title', status: 'active', next: 'Open', blocker: 'none', projectId };
  const packs = [good, { ...good, id: 'done', status: 'done' }, { ...good, id: 'blocked', blocker: 'Waiting' }, { ...good, id: 'status-blocked', status: 'blocked' },
    { ...good, id: 'archived', archived: true }, { ...good, id: 'dependency', blockedBy: 'root' }, { ...good, id: 'no-action', next: '' }, { ...good, id: 'other-project', projectId: 'other' }];
  const receipt = { unblockedWorkIds: [...packs.map(p => p.id), good.id, 'deleted', 123] }, before = structuredClone({ receipt, packs });
  assert.deepEqual(json(browser.workflow.receiptReadyPacks(receipt, packs, projectId)), [good]); assert.deepEqual({ receipt, packs }, before);
  assert.deepEqual(json(browser.workflow.receiptReadyPacks(receipt, packs.map(p => p.id === good.id ? { ...p, title: 'Renamed' } : p), projectId))[0].title, 'Renamed');
  assert.deepEqual(json(browser.workflow.receiptReadyPacks(receipt, packs.filter(p => p.id !== good.id), projectId)), []);
  assert.deepEqual(json(browser.workflow.receiptReadyPacks({ unblockedWorkIds: {} }, packs, projectId)), []);
  assert.deepEqual(json(browser.workflow.receiptReadyPacks(null, packs, projectId)), []);
});
test('helper activity says marked done with exact returned references and no invented proof', () => {
  const packs = seed().packs, root = packs.find(p => p.id === rootId), activities = [];
  const unblocked = unblockPacksBlockedBy(packs, root, { onActivity: (pack, text) => activities.push({ id: pack.id, text }), workTitle: p => p.title });
  assert.deepEqual(unblocked.map(p => p.id), [successorId]); assert.equal(unblocked[0], packs.find(p => p.id === successorId));
  assert.deepEqual(activities, [{ id: successorId, text: 'Unblocked: Confirm scope was marked done.' }]);
});
test('Nebius supplied completion evidence stays distinct from work state; baseline proof activity remains unchanged', async () => {
  for (const supplied of [false, true]) {
    const state = seed(); if (supplied) state.packs[1].completionEvidence = 'Caller recorded the requirements.';
    const browser = browserClient(envelope(state)); await browser.client.refreshDemoState(); await finish(browser, 'action', rootId);
    const root = get(browser.client.demoState).packs.find(p => p.id === rootId);
    assert.match(root.activity.at(-1), supplied ? /Marked done with supplied completion evidence/u : /Marked done without supplied completion evidence/u);
    assert.equal(root.completionEvidence, supplied ? state.packs[1].completionEvidence : undefined);
  }
  const baseline = browserClient(undefined, { nebius: false }); await baseline.client.refreshDemoState(); await finish(baseline, 'action', rootId);
  const current = get(baseline.client.demoState); assert.match(current.packs[1].activity.at(-1), /Proof saved: Requirements documented/u); assert.match(current.packs[2].activity.at(-1), /was marked done/u);
});
for (const entrypoint of ['action', 'batch', 'path']) {
  test(`${entrypoint} storage failure never installs completed state, IDs or dependency changes`, async () => {
    const initial = envelope(seed()), browser = browserClient(initial, { failWrite: true }); const prior = await browser.client.refreshDemoState();
    await assert.rejects(finish(browser, entrypoint, rootId), /not saved/u); assert.equal(browser.saved, initial); assert.equal(browser.writes, 0); assert.deepEqual(json(get(browser.client.demoState)), json(prior));
  });
  test(`${entrypoint} stale revision refuses the entire completion and keeps the winning workspace`, async () => {
    const browser = browserClient(); await browser.client.refreshDemoState(); const winner = seed(); winner.packs[0].memory = ['Winning other-tab edit']; const winning = envelope(winner, 'winning'); browser.overwrite(winning);
    await assert.rejects(finish(browser, entrypoint, rootId), /another tab/u); assert.equal(browser.saved, winning); assert.equal(browser.writes, 0); assert.deepEqual(json(get(browser.client.demoState)), winner);
  });
}
test('stale path fingerprint refuses completion before receipt/dependency changes', async () => {
  const browser = browserClient(); await browser.client.refreshDemoState(); const before = browser.saved;
  await assert.rejects(browser.client.savePackPath(rootId, { status: 'done' }, 'outdated path'), /changed while you were editing/u); assert.equal(browser.saved, before); assert.equal(browser.writes, 0);
});
for (const entrypoint of ['action', 'batch']) {
  test(`${entrypoint} existing receipt undo restores dependency state and removes stale ready claims`, async () => {
    const browser = browserClient(); const prior = await browser.client.refreshDemoState();
    const snapshot = entrypoint === 'batch' ? browser.undo.buildBatchUndoSnapshot(prior.packs, [rootId], 'done') : browser.undo.buildActionUndoSnapshot(prior.packs, rootId, 'done');
    browser.undo.commitActionUndo(snapshot); const receipt = await finish(browser, entrypoint, rootId);
    assert.deepEqual(json(browser.workflow.receiptReadyPacks(receipt, get(browser.client.demoState).packs, projectId)).map(p => p.id), [successorId]);
    await browser.undo.undoReceipt(); const current = get(browser.client.demoState);
    assert.equal(current.packs.find(p => p.id === rootId).status, 'active'); assert.equal(current.packs.find(p => p.id === successorId).status, 'blocked');
    assert.equal(current.packs.find(p => p.id === successorId).blockedBy, rootId);
    assert.deepEqual(json(browser.workflow.receiptReadyPacks(current.actionReceipt, current.packs, projectId)), []); assert.equal(get(browser.undo.receiptUndo), null);
  });
}
test('Work ready links stay Nebius-only, scoped, encoded and gated by receipt visibility', () => {
  const source = readFileSync(new URL('../svelte-frontend/src/routes/work/+page.svelte', import.meta.url), 'utf8');
  assert.match(source, /readyNextPacks = \$derived\(__NEBIUS_EDITION__ \? receiptReadyPacks\(receipt, packs, selectedProjectId\)/u);
  const start = /\{#if __NEBIUS_EDITION__\}\r?\n\s*<NebiusProjectWorkspace/u.exec(source)?.index ?? -1;
  const end = source.indexOf('<WorkQuickAdd', start), block = source.slice(start, end);
  assert(start >= 0 && end > start);
  assert(block.includes('data-ready-next')); assert(block.includes('aria-labelledby="ready-next-heading"')); assert(block.includes('{#if receiptVisible && additionalReadyPacks.length}'));
  assert.match(source, /additionalReadyPacks = \$derived\(nebiusContinuePack\s*\? readyNextPacks\.filter\(\(pack\) => pack\.id !== nebiusContinuePack\?\.id\)\s*: readyNextPacks\)/u);
  assert.match(source, /\.demo-ready-next a, \.demo-ready-next a:visited \{[^}]*color: var\(--worn-text\)/u, 'visited links do not fall back to browser purple');
  assert.match(source, /\.demo-ready-next a:focus-visible \{[^}]*outline: 2px solid var\(--worn-focus\)/u);
  assert(block.includes('encodeURIComponent(pack.id)')); assert(block.includes('{workTitle(pack)}'));
  assert(source.includes('ondone={() => (dismissedReceiptSummary = receipt?.summary || \'\')}'));
  assert.equal(source.indexOf('data-ready-next'), start + block.indexOf('data-ready-next'));
});
