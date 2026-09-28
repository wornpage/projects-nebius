import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createProjectPlanState, assertProjectState, PROJECT_STATE_LIMITS } from '../svelte-frontend/src/lib/nebius-project-state.mjs';

const lib = new URL('../svelte-frontend/src/lib/', import.meta.url);
const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const ts = require('typescript');
const dependencies = Object.fromEntries(await Promise.all([
	'nebius-contract.mjs', 'nebius-execution-contract.mjs',
	'canonical-text.mjs', 'browser-state-envelope.mjs', 'workflow-rules.mjs',
	'pending-next-action.mjs', 'batch-actions.mjs', 'nebius-project-state.mjs', 'nebius-replan-state.mjs', 'nebius-replan-contract.mjs'
].map(async (name) => [name, await import(new URL(name, lib))])));
const createdAt = '2026-09-28T01:00:00.000Z';
const brief = 'Create a small plan\nKeep its dependencies.';
const makePlan = () => ({ title: 'Approval project', summary: 'Two tasks\nOne predecessor.', missingInformation: [], tasks: [
	{ id: 'research', title: 'Research', purpose: 'Collect\nthe facts.', nextStep: 'Read the brief', doneWhen: 'Facts\tare documented.', dependsOn: null },
	{ id: 'write', title: 'Write report', purpose: 'Summarize the facts', nextStep: 'Draft report', doneWhen: 'Report reviewed', dependsOn: 'research' }
] });
const seed = () => ({ packs: [{ id: 'sample', title: 'Sample task', status: 'active', next: 'Open', blocker: 'None', memory: ['Keep me'] }] });
const approve = (state = seed(), overrides = {}) => createProjectPlanState(state, { brief, plan: makePlan(), approvalId: 'approval-1', source: 'manual', createdAt, ...overrides });

function writable(value) {
	const subscribers = new Set();
	return { subscribe(fn) { subscribers.add(fn); fn(value); return () => subscribers.delete(fn); },
		set(next) { value = next; for (const fn of subscribers) fn(value); },
		update(fn) { this.set(fn(value)); } };
}
function get(store) { let value; store.subscribe((next) => { value = next; })(); return value; }

// Execute the actual TypeScript state owner with browser facilities replaced by
// deterministic storage and locks. No copied persistence/recovery implementation.
function browserClient(serialized = null, { failWrite = false, failSeed = false } = {}) {
	let saved = serialized;
	let writes = 0;
	let removes = 0;
	let tail = Promise.resolve();
	let pauseNext = null;
	const context = vm.createContext({ structuredClone, crypto: webcrypto, Date, Error, TypeError, SyntaxError, console,
		localStorage: { getItem() { return saved; }, setItem(key, value) { if (failWrite) throw new Error('Full'); saved = value; writes += 1; }, removeItem() { saved = null; removes += 1; } },
		navigator: { locks: { request(name, options, operation) {
			assert.equal(name, 'projects-webmcp-challenge-state-v1-write');
			assert.equal(options.mode, 'exclusive');
			const pause = pauseNext; pauseNext = null;
			const result = tail.then(async () => { if (pause) await pause; return operation(); });
			tail = result.catch(() => {});
			return result;
		} } },
		fetch: async () => { if (failSeed) throw new Error('Offline'); return { ok: true, json: async () => seed().packs }; }
	});
	function compile(name, extras = {}) {
		const source = readFileSync(new URL(name, lib), 'utf8');
		const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
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
	return { client, get saved() { return saved; }, get writes() { return writes; }, get removes() { return removes; },
		pauseWrite(promise) { pauseNext = promise; }, overwrite(value) { saved = value; } };
}
const envelope = (state, revision = 'revision-1') => JSON.stringify({ schemaVersion: 1, revision, state });
const json = (value) => JSON.parse(JSON.stringify(value));

test('approval clones the workspace and preserves truthful plan fields and scoped dependencies', () => {
	const prior = seed();
	const original = structuredClone(prior);
	const result = approve(prior);
	assert.deepEqual(prior, original);
	assert.notEqual(result.state, prior);
	assert.deepEqual(result.state.packs[0], original.packs[0]);
	assert.equal(result.project.id, 'approval-1');
	assert.equal(result.project.source, 'manual');
	assert.equal(result.project.brief, brief);
	assert.equal(result.tasks[0].status, 'active');
	assert.equal(result.tasks[1].status, 'blocked');
	assert.equal(result.tasks[1].blockedBy, 'approval-1:research');
	assert.equal(result.tasks[1].blocker, 'Waiting for Research');
	assert.equal(result.state.selectedProjectId, result.project.id);
	for (const task of result.tasks) for (const field of ['owner', 'due', 'completionEvidence', 'progress']) assert.equal(field in task, false);
	assertProjectState(result.state);
});

test('invalid or cyclic plans and missing provenance fail before mutation', () => {
	const prior = seed();
	const original = structuredClone(prior);
	const cyclic = makePlan(); cyclic.tasks[0].dependsOn = 'write';
	for (const overrides of [{ plan: cyclic }, { approvalId: '' }, { approvalId: 'bad:id' }, { createdAt: undefined }, { source: undefined }, { createdAt: '2026-02-30T01:00:00.000Z' }, { brief: '' }]) {
		assert.throws(() => approve(prior, overrides));
		assert.deepEqual(prior, original);
	}
});

test('duplicate approval ids and bounded capacity reject the entire insertion', () => {
	const prior = approve().state;
	assert.throws(() => approve(prior), /already been used/u);
	const full = { projects: [{ ...approve().project, id: 'capacity-project' }], packs: Array.from({ length: PROJECT_STATE_LIMITS.tasks - 1 }, (_, i) => ({ id: `task-${i}`, projectId: 'capacity-project' })) };
	const original = structuredClone(full);
	assert.throws(() => approve(full), /capacity/u);
	assert.deepEqual(full, original);
	const projectFull = { packs: [], projects: Array.from({ length: PROJECT_STATE_LIMITS.projects }, (_, i) => ({ ...approve().project, id: `project-${i}` })) };
	assert.throws(() => approve(projectFull), /capacity/u);
});

test('project task capacity counts membership only and permits exactly the project limit', () => {
	const state = { projects: [{ ...approve().project, id: 'capacity-project' }], packs: [
		...Array.from({ length: 1001 }, (_, i) => ({ id: `legacy-${i}`, title: `Legacy ${i}` })),
		...Array.from({ length: PROJECT_STATE_LIMITS.tasks - 2 }, (_, i) => ({ id: `member-${i}`, projectId: 'capacity-project' }))
	] };
	const approved = approve(state).state;
	assert.equal(approved.packs.filter((pack) => pack.projectId !== undefined).length, PROJECT_STATE_LIMITS.tasks);
	assert.equal(approved.packs.length, 1001 + PROJECT_STATE_LIMITS.tasks);
	assertProjectState(approved);
	assert.throws(() => approve(approved, { approvalId: 'over-capacity' }), /capacity/u);
	const excess = structuredClone(approved);
	excess.packs.push({ id: 'excess', projectId: 'capacity-project' });
	assert.throws(() => assertProjectState(excess), /capacity/u);
});

test('large ungrouped legacy workspace survives reload, save, approval and both import modes', async () => {
	const legacy = { packs: Array.from({ length: 1001 }, (_, i) => ({ id: `legacy-${i}`, title: `Legacy ${i}`, status: 'active', next: 'Open' })) };
	const original = structuredClone(legacy);
	assertProjectState(legacy);
	const pure = approve(legacy);
	assert.equal(pure.state.packs.length, 1003);
	assert.deepEqual(legacy, original);
	const browser = browserClient(JSON.stringify(legacy));
	const loaded = await browser.client.refreshDemoState();
	assert.equal(loaded.packs.length, 1001);
	assert.deepEqual(json(loaded.packs), legacy.packs);
	await browser.client.savePackBrowserFields('legacy-0', (pack) => { pack.memory = ['Saved legacy work']; });
	const single = makePlan(); single.tasks = [single.tasks[0]];
	const receipt = await browser.client.approveProjectPlan(brief, single, 'large-approval', 'manual');
	assert.equal(receipt.state.packs.length, 1002);
	assert.equal(receipt.state.status, 'Approved Approval project with 1 task.');
	assert.equal(receipt.tasks.length, 1);
	const fresh = browserClient(browser.saved);
	const reloaded = await fresh.client.refreshDemoState();
	assert.deepEqual(json(reloaded), json(receipt.state));
	assert.equal(fresh.writes, 0);
	const exported = browser.client.exportWorkspaceState();
	const destination = browserClient();
	await destination.client.refreshDemoState();
	assert.equal(destination.client.previewWorkspaceImport(exported).packs, 1002);
	await destination.client.importWorkspaceState(exported, 'replace');
	assert.equal(get(destination.client.demoState).packs.length, 1002);
	assert.equal(get(destination.client.demoState).projects.length, 1);
	assert.equal(get(destination.client.demoState).packs[0].memory[0], 'Saved legacy work');
	const merge = browserClient();
	await merge.client.refreshDemoState();
	await merge.client.importWorkspaceState(exported, 'merge');
	assert.equal(get(merge.client.demoState).packs.length, 1003);
	assert.equal(get(merge.client.demoState).projects.length, 1);
	assert.equal(get(merge.client.demoState).packs.filter((pack) => pack.projectId).length, 1);
});

test('manual and Nebius approvals use one serialized write; dependency graph survives a fresh reload', async () => {
	for (const source of ['manual', 'nebius']) {
		const browser = browserClient();
		await browser.client.refreshDemoState();
		assert.equal(browser.writes, 0, 'proposal and seed load have no save');
		const receipt = await browser.client.approveProjectPlan(brief, makePlan(), 'approval-1', source);
		assert.equal(browser.writes, 1);
		assert.equal(receipt.project.source, source);
		assert.equal(receipt.tasks.length, 2);
		const fresh = browserClient(browser.saved);
		const loaded = await fresh.client.refreshDemoState();
		assert.deepEqual(json(loaded), json(receipt.state));
		assert.equal(fresh.writes, 0, 'valid linked tasks do not trigger recovery writes');
		assert.equal(loaded.packs[2].blockedBy, 'approval-1:research');
		assert.equal(loaded.recoveryQuarantine, undefined);
		const saved = browser.saved;
		await assert.rejects(browser.client.approveProjectPlan(brief, makePlan(), 'approval-1', source), /already been used/u);
		assert.equal(browser.saved, saved);
		assert.equal(browser.writes, 1);
	}
});

test('storage failure leaves the store and persisted workspace untouched', async () => {
	const initial = envelope(seed());
	const browser = browserClient(initial, { failWrite: true });
	await browser.client.refreshDemoState();
	const before = json(get(browser.client.demoState));
	await assert.rejects(browser.client.approveProjectPlan(brief, makePlan(), 'approval-1', 'manual'), /not saved/u);
	assert.deepEqual(json(get(browser.client.demoState)), before);
	assert.equal(browser.saved, initial);
	assert.equal(browser.writes, 0);
});

test('stale or concurrent approvals cannot partially overwrite the winning workspace', async () => {
	const browser = browserClient(envelope(seed()));
	await browser.client.refreshDemoState();
	let release;
	browser.pauseWrite(new Promise((resolve) => { release = resolve; }));
	const first = browser.client.approveProjectPlan(brief, makePlan(), 'approval-first', 'manual');
	const second = browser.client.approveProjectPlan(brief, makePlan(), 'approval-second', 'manual');
	release();
	const results = await Promise.allSettled([first, second]);
	assert.equal(results[0].status, 'fulfilled');
	assert.equal(results[1].status, 'rejected');
	assert.match(results[1].reason.message, /another tab/u);
	const saved = JSON.parse(browser.saved).state;
	assert.equal(saved.projects.length, 1);
	assert.equal(saved.projects[0].id, 'approval-first');
	assert.equal(saved.packs.length, 3);
	assert.equal(browser.writes, 1);
	const stale = browserClient(envelope(seed()));
	await stale.client.refreshDemoState();
	stale.overwrite(browser.saved);
	await assert.rejects(stale.client.approveProjectPlan(brief, makePlan(), 'approval-stale', 'manual'), /another tab/u);
	assert.equal(stale.saved, browser.saved);
});

test('corrupt record quarantine retains valid linked tasks and repairs genuinely missing references', async () => {
	const state = approve().state;
	state.packs.push({ id: 'broken', title: 'Bad\u0000title' });
	state.packs.push({ id: 'orphan', title: 'Orphan', blockedBy: 'missing', status: 'blocked', blocker: 'Waiting' });
	state.packs.push({ ...state.packs[0] });
	state.packs.push({ id: 'bad-membership', title: 'Member', projectId: 'missing-project' });
	state.pendingNextActionDrafts = [null];
	const browser = browserClient(envelope(state));
	const recovered = await browser.client.refreshDemoState();
	assert.equal(recovered.packs.length, 4);
	assert.equal(recovered.packs.find((pack) => pack.id === 'approval-1:write').blockedBy, 'approval-1:research');
	assert.equal(recovered.packs.find((pack) => pack.id === 'orphan').blockedBy, '');
	assert.deepEqual(new Set(recovered.recoveryQuarantine.map((entry) => entry.id)), new Set(['broken', 'orphan', 'sample', 'bad-membership', 'pending-approval']));
	assert.equal(recovered.projects[0].id, 'approval-1');
	const fresh = browserClient(browser.saved);
	const again = await fresh.client.refreshDemoState();
	assert.deepEqual(json(again), json(recovered));
	assert.equal(fresh.writes, 0);
});

test('invalid project metadata and cycles retain explicit quarantine evidence', async () => {
	const state = approve().state;
	state.projects.push({ id: 'invalid', title: 'Missing metadata' });
	state.packs[1].blockedBy = state.packs[2].id;
	const browser = browserClient(envelope(state));
	const recovered = await browser.client.refreshDemoState();
	assert.ok(recovered.recoveryQuarantine.some((entry) => entry.id === 'invalid'));
	assert.ok(recovered.recoveryQuarantine.some((entry) => /cyclic/u.test(entry.reason)));
	assert.equal(recovered.projects.length, 1);
	assert.equal(recovered.packs.length, 3);
	assertProjectState(recovered);
});

test('export and replace retain project metadata and membership; legacy replace clears old projects', async () => {
	const source = browserClient(envelope(approve().state));
	await source.client.refreshDemoState();
	const exported = source.client.exportWorkspaceState();
	const destination = browserClient();
	await destination.client.refreshDemoState();
	assert.equal(destination.client.previewWorkspaceImport(exported).packs, 3);
	const receipt = await destination.client.importWorkspaceState(exported, 'replace');
	assert.equal(receipt.packs, 3);
	const state = get(destination.client.demoState);
	assert.deepEqual(json(state.projects), json(approve().state.projects));
	assert.equal(state.selectedProjectId, 'approval-1');
	assert.equal(state.packs[2].projectId, 'approval-1');
	assert.equal(state.packs[2].blockedBy, 'approval-1:research');
	await destination.client.importWorkspaceState(envelope(seed()), 'replace');
	assert.deepEqual(json(get(destination.client.demoState).projects), []);
	assert.equal(get(destination.client.demoState).selectedProjectId, null);
	assert.equal(get(destination.client.demoState).packs.length, 1);
});

test('merge retains both project graphs and refuses metadata or membership collisions atomically', async () => {
	const prior = approve().state;
	const imported = approve({ packs: [] }, { approvalId: 'approval-2', source: 'nebius' }).state;
	const browser = browserClient(envelope(prior));
	await browser.client.refreshDemoState();
	const receipt = await browser.client.importWorkspaceState(envelope(imported), 'merge');
	assert.equal(receipt.packs, 2);
	assert.equal(get(browser.client.demoState).projects.length, 2);
	assert.equal(get(browser.client.demoState).packs.length, 5);
	const saved = browser.saved;
	const conflicting = structuredClone(prior); conflicting.projects[0].title = 'Unrelated project';
	await assert.rejects(browser.client.importWorkspaceState(envelope(conflicting), 'merge'), /Conflicting metadata/u);
	assert.equal(browser.saved, saved);
	const membership = { packs: [{ id: 'sample', title: 'Other sample', projectId: 'approval-1' }], projects: prior.projects };
	await assert.rejects(browser.client.importWorkspaceState(envelope(membership), 'merge'), /Conflicting project membership/u);
	assert.equal(browser.saved, saved);
	const orphan = structuredClone(imported); orphan.packs[0].projectId = 'missing';
	assert.throws(() => browser.client.previewWorkspaceImport(envelope(orphan)), /missing project/u);
	assert.equal(browser.saved, saved);
});

test('selection validates explicit project ids; full reset clears projects and their task refs', async () => {
	const browser = browserClient(envelope(approve().state));
	await browser.client.refreshDemoState();
	await browser.client.selectProject(null);
	assert.equal(get(browser.client.demoState).selectedProjectId, null);
	await browser.client.selectProject('approval-1');
	const saved = browser.saved;
	await assert.rejects(browser.client.selectProject('missing'), /not found/u);
	assert.equal(browser.saved, saved);
	const reset = await browser.client.resetDemoSampleState();
	assert.equal(reset.projects, undefined);
	assert.equal(reset.selectedProjectId, undefined);
	assert.equal(reset.packs.length, 1);
	assert.equal(reset.packs[0].projectId, undefined);
	assert.equal(browser.saved, null);
	assert.equal(browser.removes, 1);
});
