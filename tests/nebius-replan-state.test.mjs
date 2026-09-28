import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createProjectPlanState } from '../svelte-frontend/src/lib/nebius-project-state.mjs';
import { projectSnapshot, applyProjectReplanState } from '../svelte-frontend/src/lib/nebius-replan-state.mjs';

const lib = new URL('../svelte-frontend/src/lib/', import.meta.url);
const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const ts = require('typescript');
const dependencies = Object.fromEntries(await Promise.all([
	'canonical-text.mjs', 'browser-state-envelope.mjs', 'workflow-rules.mjs', 'pending-next-action.mjs',
	'batch-actions.mjs', 'nebius-project-state.mjs', 'nebius-replan-contract.mjs', 'nebius-replan-state.mjs'
].map(async (name) => [name, await import(new URL(name, lib))])));
const projectId = 'project-1';
const researchId = `${projectId}:research`;
const writeId = `${projectId}:write`;
const seed = () => createProjectPlanState({ packs: [{ id: 'unrelated', title: 'Unrelated', status: 'active', next: 'Open', blocker: 'None', memory: ['Keep unrelated work'] }],
	filter: 'all', customMetadata: { keep: true }, manualOrder: ['unrelated'] }, {
	brief: 'Write a report.', approvalId: projectId, source: 'manual', createdAt: '2026-09-28T01:00:00.000Z',
	plan: { title: 'Report', summary: 'Research then write.', missingInformation: [], tasks: [
		{ id: 'research', title: 'Research', purpose: 'Collect facts', nextStep: 'Read source', doneWhen: 'Facts documented', dependsOn: null },
		{ id: 'write', title: 'Write', purpose: 'Summarize facts', nextStep: 'Write report', doneWhen: 'Report reviewed', dependsOn: 'research' }
	] }
}).state;
const proposal = (snapshot, overrides = {}) => ({ summary: 'Revise research.', missingInformation: [], changes: [
	{ ...snapshot.tasks.find((task) => task.id === researchId), blocker: 'None', nextStep: 'Read the updated source', reason: 'New evidence arrived.', ...overrides }
].map(({ archived, ...change }) => change) });
const apply = (state, replan = proposal(projectSnapshot(state, projectId)), snapshot = projectSnapshot(state, projectId), source = 'manual') =>
	applyProjectReplanState(state, { snapshot, replan, source });
const envelope = (state, revision = 'revision-1') => JSON.stringify({ schemaVersion: 1, revision, state });
const json = (value) => JSON.parse(JSON.stringify(value));

function writable(value) {
	const subscribers = new Set();
	return { subscribe(fn) { subscribers.add(fn); fn(value); return () => subscribers.delete(fn); },
		set(next) { value = next; for (const fn of subscribers) fn(value); }, update(fn) { this.set(fn(value)); } };
}
function get(store) { let value; store.subscribe((next) => { value = next; })(); return value; }

// Run the real TS state owner with deterministic browser storage and lock facilities.
function browserClient(serialized = envelope(seed()), { failWrite = false, noLocks = false } = {}) {
	let saved = serialized;
	let writes = 0;
	let tail = Promise.resolve();
	let pauseNext = null;
	const context = vm.createContext({ structuredClone, crypto: webcrypto, Date, Error, TypeError, SyntaxError, console,
		localStorage: { getItem() { return saved; }, setItem(key, value) { if (failWrite) throw new Error('Full'); saved = value; writes += 1; }, removeItem() { saved = null; } },
		navigator: noLocks ? {} : { locks: { request(name, options, operation) {
			assert.equal(name, 'projects-webmcp-challenge-state-v1-write');
			assert.equal(options.mode, 'exclusive');
			const pause = pauseNext; pauseNext = null;
			const result = tail.then(async () => { if (pause) await pause; return operation(); });
			tail = result.catch(() => {}); return result;
		} } },
		fetch: async () => ({ ok: true, json: async () => [] })
	});
	function compile(name, extras = {}) {
		const code = ts.transpileModule(readFileSync(new URL(name, lib), 'utf8'), {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
		}).outputText;
		const exports = {};
		const resolve = (id) => {
			if (id === '$app/environment') return { browser: true };
			if (id === 'svelte/store') return { writable, get };
			if (id in extras) return extras[id];
			const key = id.replace(/^\$lib\//u, '').replace(/^\.\//u, '');
			if (key in dependencies) return dependencies[key];
			throw new Error(`Unexpected dependency ${id}`);
		};
		new vm.Script(`(function(exports, require) { ${code}\n })`, { filename: name }).runInContext(context)(exports, resolve);
		return exports;
	}
	const workflow = compile('demo-workflow.ts');
	const client = compile('demo-client.ts', { '$lib/demo-workflow': workflow });
	return { client, get saved() { return saved; }, get writes() { return writes; },
		pauseWrite(promise) { pauseNext = promise; }, overwrite(value) { saved = value; } };
}

test('snapshot copies all project tasks in stable id order including terminal context', () => {
	const state = seed();
	state.packs.find((pack) => pack.id === writeId).archived = true;
	state.packs.find((pack) => pack.id === writeId).status = 'done';
	state.packs.find((pack) => pack.id === writeId).blocker = 'none';
	delete state.packs.find((pack) => pack.id === writeId).blockedBy;
	state.packs.reverse();
	const snapshot = projectSnapshot(state, projectId);
	assert.deepEqual(snapshot.tasks.map((task) => task.id), [researchId, writeId]);
	assert.equal(snapshot.tasks[1].archived, true);
	assert.equal(snapshot.tasks[1].status, 'done');
	assert.equal(snapshot.tasks[0].blockedBy, null);
	assert.equal(snapshot.tasks[0].archived, false);
	assert.equal(snapshot.tasks[0].blocker, 'None');
	assert.deepEqual(Object.keys(snapshot.project).sort(), ['id', 'summary', 'title']);
	snapshot.project.title = 'Changed copy'; snapshot.tasks[0].title = 'Changed copy';
	assert.equal(state.projects[0].title, 'Report');
	assert.equal(state.packs.find((pack) => pack.id === researchId).title, 'Research');
	assert.throws(() => projectSnapshot(state, 'missing'), /not found/u);
});

test('snapshot refuses oversized stored context and project cardinality without truncation', () => {
	const state = seed();
	state.packs[1].nextStep = 'x'.repeat(201);
	assert.throws(() => projectSnapshot(state, projectId));
	const large = seed();
	for (let i = 0; i < 7; i += 1) large.packs.push({ ...large.packs[1], id: `${projectId}:extra-${i}` });
	assert.throws(() => projectSnapshot(large, projectId));
	const empty = seed(); empty.packs = [empty.packs[0]];
	assert.throws(() => projectSnapshot(empty, projectId));
	const collision = seed(); collision.packs.push({ ...collision.packs[0], id: writeId });
	assert.throws(() => projectSnapshot(collision, projectId), /unique/u);
	const badReference = seed(); badReference.packs[1].blockedBy = 0;
	assert.throws(() => projectSnapshot(badReference, projectId));
});

test('pure apply preserves unrelated fields, project metadata, history and unchanged tasks', () => {
	const state = seed();
	Object.assign(state.packs[1], { owner: 'Jared', activity: ['Created'], memory: ['Remember'], completionEvidence: 'Prior evidence', progress: 30, custom: { retained: true } });
	const before = structuredClone(state);
	const result = apply(state);
	assert.deepEqual(state, before);
	assert.notEqual(result.state, state);
	assert.deepEqual(result.changedIds, [researchId]);
	assert.deepEqual(result.state.projects, before.projects);
	assert.deepEqual(result.state.packs[0], before.packs[0]);
	assert.deepEqual(result.state.packs[2], before.packs[2]);
	assert.deepEqual(result.state.packs[1], { ...before.packs[1], blocker: 'None', nextStep: 'Read the updated source' });
	assert.deepEqual(result.state.customMetadata, before.customMetadata);
	assert.deepEqual(result.state.manualOrder, before.manualOrder);
	assert.equal('reason' in result.state.packs[1], false);
});

test('stale snapshots detect metadata, fields, membership, and terminal-context changes', () => {
	const state = seed();
	const snapshot = projectSnapshot(state, projectId);
	const replan = proposal(snapshot);
	for (const change of [
		(next) => { next.projects[0].title = 'Changed project'; },
		(next) => { next.projects[0].summary = 'Changed summary'; },
		(next) => { next.packs[1].nextStep = 'Other edit'; },
		(next) => { next.packs[2].archived = true; },
		(next) => { next.packs.push({ ...next.packs[1], id: `${projectId}:extra` }); },
		(next) => { next.packs[2].blockedBy = undefined; next.packs.pop(); }
	]) {
		const current = structuredClone(state); change(current);
		const before = structuredClone(current);
		assert.throws(() => apply(current, replan, snapshot), /changed since/u);
		assert.deepEqual(current, before);
	}
	const unrelated = structuredClone(state); unrelated.packs[0].memory = ['Latest unrelated work'];
	assert.deepEqual(apply(unrelated, replan, snapshot).state.packs[0].memory, ['Latest unrelated work']);
	const sentinelCase = structuredClone(state); sentinelCase.packs[1].blocker = 'NONE';
	assert.equal(apply(sentinelCase, replan, snapshot).state.packs[1].nextStep, 'Read the updated source');
	const result = apply(state, replan, snapshot);
	assert.throws(() => apply(result.state, replan, snapshot), /changed since/u);
});

test('pending targeted drafts reject atomically while unrelated approval state survives', () => {
	const state = seed();
	state.pendingNextActionDrafts = [{ workId: researchId, choice: 'Continue', mode: 'preset', evidenceNote: '', evidence: [], originFingerprint: 'captured', source: 'human' }];
	const before = structuredClone(state);
	assert.throws(() => apply(state), /pending next-action draft/u);
	assert.deepEqual(state, before);
	state.pendingNextActionDrafts[0].workId = 'unrelated';
	const result = apply(state);
	assert.deepEqual(result.state.pendingNextActionDrafts, state.pendingNextActionDrafts);
});

test('no-op, graph, terminal, source and canonical-title violations reject all changes', () => {
	const state = seed();
	const snapshot = projectSnapshot(state, projectId);
	const before = structuredClone(state);
	for (const overrides of [
		{ nextStep: snapshot.tasks[0].nextStep },
		{ blockedBy: writeId, blocker: 'Waiting for Write', status: 'blocked' },
		{ blockedBy: 'unrelated', blocker: 'Waiting', status: 'blocked' },
		{ blockedBy: researchId, blocker: 'Waiting', status: 'blocked' },
		{ status: 'active', blocker: 'Waiting' },
		{ status: 'blocked', blocker: 'None' },
		{ title: '  Research  ' }
	]) {
		assert.throws(() => apply(state, proposal(snapshot, overrides), snapshot));
		assert.deepEqual(state, before);
	}
	assert.throws(() => apply(state, proposal(snapshot), snapshot, 'provider'));
	const terminal = seed(); terminal.packs[1].status = 'done';
	assert.throws(() => apply(terminal));
	const archived = seed(); archived.packs[1].archived = true;
	assert.throws(() => apply(archived));
	const invalid = proposal(snapshot); invalid.changes.push({ ...invalid.changes[0], id: writeId, blockedBy: researchId, status: 'blocked', blocker: 'Waiting for Research', nextStep: snapshot.tasks[1].nextStep, title: 'Write', purpose: 'Summarize facts', doneWhen: 'Report reviewed' });
	assert.throws(() => apply(state, invalid, snapshot), /change|no.op/u);
	const { archived: unused, ...unchanged } = snapshot.tasks[1];
	assert.throws(() => apply(state, { summary: 'No change.', missingInformation: [], changes: [{ ...unchanged, reason: 'Unchanged' }] }, snapshot), /change|no.op/u);
	assert.deepEqual(state, before);
});

test('clearing a predecessor preserves every other task field and validates the resulting graph', () => {
	const state = seed();
	const snapshot = projectSnapshot(state, projectId);
	const { archived, ...task } = snapshot.tasks[1];
	const result = apply(state, { summary: 'Independent writing.', missingInformation: [], changes: [{ ...task, blockedBy: null, status: 'active', blocker: 'None', reason: 'Ready independently' }] }, snapshot);
	assert.equal('blockedBy' in result.state.packs[2], false);
	assert.equal(result.state.packs[2].next, state.packs[2].next);
	assert.equal(projectSnapshot(result.state, projectId).tasks[1].blockedBy, null);
});

test('manual and Nebius approvals persist one write and durable source/count receipts; reload is clean', async () => {
	for (const source of ['manual', 'nebius']) {
		const browser = browserClient();
		const loaded = await browser.client.refreshDemoState();
		const snapshot = projectSnapshot(loaded, projectId);
		assert.equal(browser.writes, 0);
		const receipt = await browser.client.approveProjectReplan(snapshot, proposal(snapshot), source);
		assert.equal(browser.writes, 1);
		assert.deepEqual(json(receipt.changedIds), [researchId]);
		assert.equal(receipt.state.actionReceipt.source, source);
		assert.equal(receipt.state.actionReceipt.changedCount, 1);
		assert.equal(receipt.state.actionReceipt.projectId, projectId);
		const activity = receipt.state.packs.find((pack) => pack.id === researchId).activity;
		assert.match(activity.at(-1), new RegExp(`Approved ${source === 'nebius' ? 'Nebius' : 'manual'} project update`));
		assert.match(activity.at(-1), /Summary: Revise research\. Reason: New evidence arrived\./u);
		const fresh = browserClient(browser.saved);
		assert.deepEqual(json(await fresh.client.refreshDemoState()), json(receipt.state));
		assert.equal(fresh.writes, 0);
		const saved = browser.saved;
		await assert.rejects(browser.client.approveProjectReplan(snapshot, proposal(snapshot), source), /changed since/u);
		assert.equal(browser.saved, saved);
		assert.equal(browser.writes, 1);
	}
});

test('approved explanation fits intact in bounded activity and survives export without changing other tasks', async () => {
	const state = seed();
	state.packs.find(pack => pack.id === researchId).activity = Array.from({ length: 100 }, (_, i) => `Prior entry ${i}`);
	const browser = browserClient(envelope(state));
	await browser.client.refreshDemoState();
	const snapshot = projectSnapshot(state, projectId);
	const reviewed = proposal(snapshot, { reason: 'R'.repeat(399) + 'Z' });
	reviewed.summary = 'S'.repeat(599) + 'Y';
	const result = await browser.client.approveProjectReplan(snapshot, reviewed, 'manual');
	const activity = result.state.packs.find(pack => pack.id === researchId).activity;
	assert.equal(activity.length, 100);
	assert.equal(activity[0], 'Prior entry 1');
	assert(activity.at(-1).includes(reviewed.summary));
	assert(activity.at(-1).endsWith(reviewed.changes[0].reason));
	assert(activity.at(-1).length <= 1200);
	assert.deepEqual(json(result.state.packs.filter(pack => pack.id !== researchId)), state.packs.filter(pack => pack.id !== researchId));
	const exported = JSON.parse(browser.client.exportWorkspaceState());
	assert.deepEqual(exported.state.packs.find(pack => pack.id === researchId).activity, json(activity));
	const fresh = browserClient(JSON.stringify(exported));
	const restored = await fresh.client.refreshDemoState();
	assert.deepEqual(json(restored.packs.find(pack => pack.id === researchId).activity), json(activity));
});

test('owner refuses pending drafts, invalid state writes and storage failure without installing changes', async () => {
	const pending = seed(); pending.pendingNextActionDrafts = [{ workId: researchId, choice: 'Continue', mode: 'preset', evidenceNote: '', evidence: [], originFingerprint: 'captured', source: 'human' }];
	for (const [initial, options, pattern] of [
		[envelope(pending), {}, /pending next-action draft/u],
		[envelope(seed()), { failWrite: true }, /not saved/u]
	]) {
		const browser = browserClient(initial, options);
		const loaded = await browser.client.refreshDemoState();
		const before = json(loaded);
		const snapshot = projectSnapshot(loaded, projectId);
		await assert.rejects(browser.client.approveProjectReplan(snapshot, proposal(snapshot), 'manual'), pattern);
		assert.deepEqual(json(get(browser.client.demoState)), before);
		assert.equal(browser.saved, initial);
		assert.equal(browser.writes, 0);
	}
	const browser = browserClient();
	const loaded = await browser.client.refreshDemoState();
	const snapshot = projectSnapshot(loaded, projectId);
	// Existing browser validation is still the persistence gate for unrelated state.
	loaded.packs[0].owner = 'x'.repeat(121);
	await assert.rejects(browser.client.approveProjectReplan(snapshot, proposal(snapshot), 'manual'));
	assert.equal(browser.writes, 0);
	const unsafe = browserClient(undefined, { noLocks: true });
	assert.equal(await unsafe.client.refreshDemoState(), null);
	await assert.rejects(unsafe.client.approveProjectReplan(snapshot, proposal(snapshot), 'manual'), /could not be saved/u);
	assert.equal(unsafe.writes, 0);
});

test('concurrent and other-tab stale revisions cannot overwrite the winning workspace', async () => {
	const browser = browserClient();
	const loaded = await browser.client.refreshDemoState();
	const snapshot = projectSnapshot(loaded, projectId);
	let release;
	browser.pauseWrite(new Promise((resolve) => { release = resolve; }));
	const first = browser.client.approveProjectReplan(snapshot, proposal(snapshot), 'manual');
	const second = browser.client.approveProjectReplan(snapshot, proposal(snapshot, { nextStep: 'Different source' }), 'nebius');
	release();
	const results = await Promise.allSettled([first, second]);
	assert.equal(results[0].status, 'fulfilled');
	assert.equal(results[1].status, 'rejected');
	assert.match(results[1].reason.message, /another tab/u);
	assert.equal(browser.writes, 1);
	assert.equal(JSON.parse(browser.saved).state.packs[1].nextStep, 'Read the updated source');
	const stale = browserClient();
	await stale.client.refreshDemoState();
	stale.overwrite(browser.saved);
	await assert.rejects(stale.client.approveProjectReplan(snapshot, proposal(snapshot), 'manual'), /another tab/u);
	assert.equal(stale.saved, browser.saved);
	assert.equal(stale.writes, 0);
	assert.deepEqual(json(get(stale.client.demoState)), JSON.parse(browser.saved).state);
});

test('owner copies reviewed values before refresh and lock waits', async () => {
	const browser = browserClient();
	const snapshot = projectSnapshot(seed(), projectId);
	const replan = proposal(snapshot);
	let release;
	browser.pauseWrite(new Promise((resolve) => { release = resolve; }));
	const pending = browser.client.approveProjectReplan(snapshot, replan, 'manual');
	snapshot.tasks[0].nextStep = 'Caller mutation';
	replan.changes[0].nextStep = 'Caller mutation';
	release();
	const result = await pending;
	assert.equal(result.state.packs[1].nextStep, 'Read the updated source');
	assert.equal(browser.writes, 1);
});
