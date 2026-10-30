import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const lib = new URL('../svelte-frontend/src/lib/', import.meta.url);
const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const ts = require('typescript');
const dependencies = Object.fromEntries(await Promise.all([
	'nebius-contract.mjs', 'nebius-execution-contract.mjs', 'canonical-text.mjs',
	'browser-state-envelope.mjs', 'workflow-rules.mjs', 'pending-next-action.mjs',
	'batch-actions.mjs', 'nebius-project-state.mjs', 'nebius-replan-state.mjs', 'nebius-replan-contract.mjs'
].map(async (name) => [name, await import(new URL(name, lib))])));

function writable(value) {
	const subscribers = new Set();
	return {
		subscribe(fn) { subscribers.add(fn); fn(value); return () => subscribers.delete(fn); },
		set(next) { value = next; for (const fn of subscribers) fn(value); },
		update(fn) { this.set(fn(value)); }
	};
}
function get(store) { let value; store.subscribe((next) => { value = next; })(); return value; }
const json = (value) => JSON.parse(JSON.stringify(value));
const envelope = (state, revision = 'revision-1') => JSON.stringify({ schemaVersion: 1, revision, state });
const pack = (id, extra = {}) => ({ id, title: id, status: 'active', next: 'Open', blocker: 'None', ...extra });
const pending = (workId, evidence = [], extra = {}) => ({
	workId, choice: 'Review', mode: 'preset', evidenceNote: 'Retained evidence',
	evidence, originFingerprint: 'historical-fingerprint', source: 'human', ...extra
});
const fact = (workId) => ({ workId, field: 'workflow', expectedValue: 'active' });

// Exercise the real browser state owner with deterministic local storage, not a
// copy of the import logic. No network or provider calls are made.
function browserClient(serialized) {
	let saved = serialized;
	let writes = 0;
	const context = vm.createContext({
		structuredClone, crypto: webcrypto, Date, Error, TypeError, SyntaxError, console,
		AbortController, DOMException, Headers, TextDecoder, Uint8Array, setTimeout, clearTimeout,
		__NEBIUS_EDITION__: true,
		localStorage: {
			getItem() { return saved; },
			setItem(key, value) { saved = value; writes += 1; },
			removeItem() { saved = null; }
		},
		navigator: { locks: { request(name, options, operation) { return operation(); } } },
		fetch: async () => { throw new Error('No network is allowed in this test.'); }
	});
	function compile(name, extras = {}) {
		const source = readFileSync(new URL(name, lib), 'utf8');
		const code = ts.transpileModule(source, { compilerOptions: {
			target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS
		} }).outputText;
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
	const execution = compile('nebius-execution-client.ts');
	const client = compile('demo-client.ts', { '$lib/demo-workflow': workflow, './nebius-execution-client': execution });
	return {
		client, get saved() { return saved; }, get writes() { return writes; },
		overwrite(value) { saved = value; }
	};
}

const unresolved = () => ({
	packs: [pack('active'), pack('finished', { status: 'done' }), pack('archived', { archived: true })],
	pendingNextActionDrafts: [
		pending('missing-target'),
		pending('active', [fact('missing-evidence')]),
		pending('finished'),
		pending('archived')
	]
});

for (const mode of ['replace', 'merge']) {
	test(`${mode} backup keeps missing and terminal pending drafts inspectable, blocked and discardable`, async () => {
		const original = unresolved();
		const source = browserClient(envelope(original));
		await source.client.refreshDemoState();
		assert.deepEqual(json(source.client.pendingNextActionDrafts(get(source.client.demoState))), original.pendingNextActionDrafts);
		const exported = source.client.exportWorkspaceState();
		const destination = browserClient(envelope({ packs: [pack('unrelated')] }));
		await destination.client.refreshDemoState();
		assert.equal(destination.client.previewWorkspaceImport(exported).pendingApprovals, 4);
		await destination.client.importWorkspaceState(exported, mode);
		const imported = json(destination.client.pendingNextActionDrafts(get(destination.client.demoState)));
		assert.deepEqual(imported, original.pendingNextActionDrafts);
		const reloaded = browserClient(destination.saved);
		await reloaded.client.refreshDemoState();
		assert.deepEqual(json(reloaded.client.pendingNextActionDrafts(get(reloaded.client.demoState))), original.pendingNextActionDrafts);
		for (const item of original.pendingNextActionDrafts) {
			await assert.rejects(reloaded.client.setPackNextAction(item.workId), /not found|missing work|completed or archived/iu);
		}
		for (const item of original.pendingNextActionDrafts) await reloaded.client.discardPendingNextActionDraft(item.workId);
		assert.equal(reloaded.client.pendingNextActionDrafts(get(reloaded.client.demoState)).length, 0);
	});
}

test('merge preserves a fully linked incoming draft and its approval behavior', async () => {
	const source = browserClient(envelope({ packs: [pack('source-task')] }));
	await source.client.refreshDemoState();
	await source.client.revisePendingNextActionDraftChoice('source-task', 'Review', 'preset');
	const destination = browserClient(envelope({ packs: [pack('destination-task')] }));
	await destination.client.refreshDemoState();
	await destination.client.importWorkspaceState(source.client.exportWorkspaceState(), 'merge');
	assert.equal(destination.client.pendingNextActionDrafts(get(destination.client.demoState)).length, 1);
	const result = await destination.client.setPackNextAction('source-task');
	assert.equal(result.saved, true);
	assert.equal(destination.client.pendingNextActionDrafts(get(destination.client.demoState)).length, 0);
});

test('a historical agent-source draft survives backup without executing an agent', async () => {
	const historical = pending('source-task', [], { source: 'webmcp' });
	const source = browserClient(envelope({ packs: [pack('source-task')], pendingNextActionDrafts: [historical] }));
	await source.client.refreshDemoState();
	const destination = browserClient(envelope({ packs: [pack('other-task')] }));
	await destination.client.refreshDemoState();
	await destination.client.importWorkspaceState(source.client.exportWorkspaceState(), 'merge');
	const restored = json(destination.client.pendingNextActionDrafts(get(destination.client.demoState)));
	assert.deepEqual(restored, [historical]);
	await destination.client.discardPendingNextActionDraft('source-task');
	assert.equal(destination.client.pendingNextActionDrafts(get(destination.client.demoState)).length, 0);
});

const collisions = [
	{
		name: 'incoming missing target would attach to existing work',
		current: { packs: [pack('clash')] },
		imported: { packs: [], pendingNextActionDrafts: [pending('clash')] }
	},
	{
		name: 'incoming missing evidence would attach to existing work',
		current: { packs: [pack('clash')] },
		imported: { packs: [pack('incoming')], pendingNextActionDrafts: [pending('incoming', [fact('clash')])] }
	},
	{
		name: 'incoming linked target collides with an unrelated existing item',
		current: { packs: [pack('clash', { title: 'Local task' })] },
		imported: { packs: [pack('clash', { title: 'Imported task' })], pendingNextActionDrafts: [pending('clash')] }
	},
	{
		name: 'incoming linked evidence collides with an unrelated existing item',
		current: { packs: [pack('clash', { title: 'Local task' })] },
		imported: { packs: [pack('incoming'), pack('clash', { title: 'Imported task' })], pendingNextActionDrafts: [pending('incoming', [fact('clash')])] }
	},
	{
		name: 'existing missing target would attach to incoming work',
		current: { packs: [], pendingNextActionDrafts: [pending('clash')] },
		imported: { packs: [pack('clash')] }
	},
	{
		name: 'existing missing evidence would attach to incoming work',
		current: { packs: [pack('local')], pendingNextActionDrafts: [pending('local', [fact('clash')])] },
		imported: { packs: [pack('clash')] }
	},
	{
		name: 'two different pending drafts share a target',
		current: { packs: [pack('local')], pendingNextActionDrafts: [pending('local')] },
		imported: { packs: [], pendingNextActionDrafts: [pending('local', [], { choice: 'Open', evidenceNote: 'Different draft' })] }
	}
];
for (const entry of collisions) {
	test(`merge refuses ${entry.name} without writing or losing either backup`, async () => {
		const browser = browserClient(envelope(entry.current));
		await browser.client.refreshDemoState();
		const before = browser.saved;
		const imported = envelope(entry.imported);
		browser.client.previewWorkspaceImport(imported);
		await assert.rejects(browser.client.importWorkspaceState(imported, 'merge'), /Cannot merge.*No workspace data was changed/u);
		assert.equal(browser.saved, before);
		assert.equal(browser.writes, 0);
		assert.deepEqual(JSON.parse(imported).state, entry.imported);
	});
}

test('merge preserves duplicate incoming pending drafts and rejects approval even with a matching fingerprint', async () => {
	const browser = browserClient(envelope({ packs: [pack('local')] }));
	await browser.client.refreshDemoState();
	const incoming = { packs: [pack('incoming')] };
	const fingerprint = browser.client.pendingDraftFingerprint(incoming, pending('incoming'));
	const duplicates = [pending('incoming', [], { originFingerprint: fingerprint }), pending('incoming', [], { choice: 'Open', originFingerprint: fingerprint })];
	await browser.client.importWorkspaceState(envelope({ ...incoming, pendingNextActionDrafts: duplicates }), 'merge');
	assert.deepEqual(json(browser.client.pendingNextActionDrafts(get(browser.client.demoState))), duplicates);
	const before = browser.saved;
	await assert.rejects(browser.client.setPackNextAction('incoming'), /multiple|duplicate/iu);
	assert.equal(browser.saved, before);
});

test('import rejects malformed blank evidence references without changing saved state', async () => {
	const browser = browserClient(envelope({ packs: [pack('local')] }));
	await browser.client.refreshDemoState();
	const malformed = envelope({ packs: [pack('incoming')], pendingNextActionDrafts: [pending('incoming', [fact('  ')])] });
	const before = browser.saved;
	assert.throws(() => browser.client.previewWorkspaceImport(malformed), /pending approvals are invalid/iu);
	await assert.rejects(browser.client.importWorkspaceState(malformed, 'replace'), /pending approvals are invalid/iu);
	assert.equal(browser.saved, before);
	assert.equal(browser.writes, 0);
});

for (const mode of ['replace', 'merge']) test(`${mode} retains stale-write protection when another tab changes the workspace after preview`, async () => {
	const browser = browserClient(envelope({ packs: [pack('original')] }));
	await browser.client.refreshDemoState();
	const imported = envelope({ packs: [pack('incoming')], pendingNextActionDrafts: [pending('missing')] });
	browser.client.previewWorkspaceImport(imported);
	const winner = envelope({ packs: [pack('newer')] }, 'revision-2');
	browser.overwrite(winner);
	await assert.rejects(browser.client.importWorkspaceState(imported, mode), /another tab/iu);
	assert.equal(browser.saved, winner);
	assert.equal(browser.writes, 0);
	assert.equal(get(browser.client.demoState).packs[0].id, 'newer');
});
