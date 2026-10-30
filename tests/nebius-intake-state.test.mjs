import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const lib = new URL('../svelte-frontend/src/lib/', import.meta.url);
const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const ts = require('typescript');
const dependencies = Object.fromEntries(await Promise.all([
	'nebius-contract.mjs', 'nebius-execution-contract.mjs', 'canonical-text.mjs',
	'browser-state-envelope.mjs', 'workflow-rules.mjs', 'pending-next-action.mjs',
	'batch-actions.mjs', 'nebius-project-state.mjs', 'nebius-replan-contract.mjs',
	'nebius-replan-state.mjs', 'nebius-plan-contract.mjs'
].map(async (name) => [name, await import(new URL(name, lib))])));

const json = (value) => JSON.parse(JSON.stringify(value));
const project = (id = 'project-one') => ({
	id,
	title: 'Saved project',
	summary: 'A current saved project.',
	brief: 'Keep this project together.',
	createdAt: '2026-10-23T04:00:00.000Z',
	source: 'manual'
});
const seed = () => ({
	packs: [{ id: 'existing', title: 'Existing work', status: 'active', blocker: 'none', next: 'Open', memory: ['Keep me'] }],
	projects: [project()],
	selectedProjectId: 'project-one',
	selectedId: 'existing',
	customWorkspace: { retained: true }
});
const envelope = (state = seed(), revision = 'revision-1') => JSON.stringify({ schemaVersion: 1, revision, state });

function writable(value) {
	const subscribers = new Set();
	return {
		subscribe(callback) { subscribers.add(callback); callback(value); return () => subscribers.delete(callback); },
		set(next) { value = next; for (const callback of subscribers) callback(value); },
		update(callback) { this.set(callback(value)); }
	};
}

function get(store) {
	let value;
	store.subscribe((next) => { value = next; })();
	return value;
}

// Compile and execute the actual TypeScript state owner. Persistence, locking,
// validation, signatures and rollback behavior are never copied into this test.
function browserClient(serialized = envelope(), { failWrite = false } = {}) {
	let saved = serialized;
	let writes = 0;
	let tail = Promise.resolve();
	const context = vm.createContext({
		__NEBIUS_EDITION__: true,
		structuredClone,
		crypto: webcrypto,
		Date,
		Error,
		TypeError,
		SyntaxError,
		URL,
		console,
		localStorage: {
			getItem() { return saved; },
			setItem(_key, value) {
				if (failWrite) throw new Error('Storage full');
				saved = value;
				writes += 1;
			},
			removeItem() { saved = null; }
		},
		navigator: {
			locks: {
				request(_name, options, operation) {
					assert.equal(options.mode, 'exclusive');
					const result = tail.then(operation);
					tail = result.catch(() => {});
					return result;
				}
			}
		},
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
		new vm.Script(`(function(exports, require) { ${code}\n })`, { filename: name })
			.runInContext(context)(exports, resolve);
		return exports;
	}
	const workflow = compile('demo-workflow.ts');
	const execution = { NebiusRunClientError: class extends Error {}, readRun: async () => null };
	const client = compile('demo-client.ts', { '$lib/demo-workflow': workflow, './nebius-execution-client': execution });
	return {
		client,
		get saved() { return saved; },
		get writes() { return writes; },
		overwrite(value) { saved = value; }
	};
}

test('createPack atomically saves bounded Unicode intake fields and returns the persisted signature', async () => {
	const browser = browserClient();
	await browser.client.refreshDemoState();
	const result = await browser.client.createPack({
		title: '  Cafe\u0301   launch 🚀 ',
		status: 'draft',
		notes: ' First note 😀 \r\n\r\n 第二行 ',
		sourceUrl: 'https://例え.test/資料?q=✓',
		projectId: 'project-one'
	});
	assert.equal(result.pack.title, 'Café launch 🚀');
	assert.equal(result.pack.status, 'draft');
	assert.deepEqual(json(result.pack.memory), ['First note 😀', '第二行']);
	assert.deepEqual(json(result.pack.sources), ['https://例え.test/資料?q=✓']);
	assert.equal(result.pack.projectId, 'project-one');
	assert.deepEqual(json(result.undoToken), {
		packId: result.pack.id,
		expectedSignature: JSON.stringify(result.pack),
		previousSelectedId: 'existing'
	});
	const persisted = JSON.parse(browser.saved).state;
	assert.deepEqual(persisted.packs.find((item) => item.id === result.pack.id), json(result.pack));
	assert.deepEqual(persisted.customWorkspace, { retained: true });
	assert.equal(browser.writes, 1);
});

test('legacy active creation stays available and unknown fields stay rejected', async () => {
	const browser = browserClient();
	await browser.client.refreshDemoState();
	const active = await browser.client.createPack({ title: 'Legacy quick add', status: 'active', next: 'Open' });
	assert.equal(active.pack.status, 'active');
	assert.equal(active.pack.next, 'Open');
	assert.equal('memory' in active.pack, false);
	assert.equal('sources' in active.pack, false);
	assert.equal('projectId' in active.pack, false);
	const before = browser.saved;
	await assert.rejects(browser.client.createPack({ title: 'No', hidden: true }), /does not support field "hidden"/u);
	assert.equal(browser.saved, before);
});

test('invalid and oversize title, notes, source and project input fail without truncation or writes', async () => {
	const browser = browserClient();
	await browser.client.refreshDemoState();
	const invalid = [
		[{ title: '🚀'.repeat(201) }, /title/u],
		[{ title: `bad\u0000title` }, /title/u],
		[{ title: `bad\ud800title` }, /title/u],
		[{ title: 'Notes', notes: Array.from({ length: 51 }, (_, index) => `line ${index}`).join('\n') }, /at most 50/u],
		[{ title: 'Notes', notes: 'x'.repeat(2001) }, /2000/u],
		[{ title: 'Notes', notes: 'valid\tinvalid' }, /invalid characters/u],
		[{ title: 'Notes', notes: `bad\ud800note` }, /invalid characters/u],
		[{ title: 'Source', sourceUrl: 'ftp://example.test/file' }, /HTTP or HTTPS/u],
		[{ title: 'Source', sourceUrl: 'https://user:secret@example.test/file' }, /credentials/u],
		[{ title: 'Source', sourceUrl: `https://example.test/line\nbreak` }, /valid HTTP or HTTPS/u],
		[{ title: 'Source', sourceUrl: `https://example.test/${'x'.repeat(2000)}` }, /2000/u],
		[{ title: 'Project', projectId: 'prøject' }, /project is invalid/u],
		[{ title: 'Project', projectId: 'missing-project' }, /not found/u],
		[{ title: 'Notes', notes: null }, /notes contain invalid/u]
	];
	for (const [payload, message] of invalid) {
		const before = browser.saved;
		const writes = browser.writes;
		await assert.rejects(browser.client.createPack(payload), message);
		assert.equal(browser.saved, before);
		assert.equal(browser.writes, writes);
	}
});

test('project membership and project task capacity are checked inside the one save', async () => {
	const full = {
		packs: Array.from({ length: dependencies['nebius-project-state.mjs'].PROJECT_STATE_LIMITS.tasks }, (_, index) => ({
			id: `member-${index}`,
			projectId: 'capacity-project',
			title: `Member ${index}`,
			status: 'draft',
			blocker: 'none',
			next: 'Set next action'
		})),
		projects: [project(), project('capacity-project')],
		selectedId: 'member-0'
	};
	const browser = browserClient(envelope(full));
	await browser.client.refreshDemoState();
	const before = browser.saved;
	await assert.rejects(browser.client.createPack({ title: 'Over capacity', projectId: 'project-one' }), /capacity/u);
	assert.equal(browser.saved, before);
	assert.equal(browser.writes, 0);
	const ungrouped = await browser.client.createPack({ title: 'Ungrouped stays allowed', projectId: null });
	assert.equal('projectId' in ungrouped.pack, false);
	assert.equal(browser.writes, 1);
});

test('project-scoped intake preserves the canonical eight-task replan boundary against direct and stale writes', async () => {
	const projectTask = (projectId, index) => ({
		id: `${projectId}:task-${index}`,
		projectId,
		title: `Task ${index}`,
		status: 'draft',
		blocker: 'none',
		next: 'Set next action'
	});
	const fullProject = {
		packs: Array.from({ length: dependencies['nebius-replan-contract.mjs'].REPLAN_LIMITS.tasks }, (_, index) => projectTask('project-one', index)),
		projects: [project(), project('project-two')],
		selectedId: 'project-one:task-0'
	};
	const browser = browserClient(envelope(fullProject));
	await browser.client.refreshDemoState();
	const before = browser.saved;
	await assert.rejects(
		browser.client.createPack({ title: 'Ninth task', projectId: 'project-one' }),
		/8 tasks.*another project or No project/u
	);
	assert.equal(browser.saved, before);
	assert.equal(browser.writes, 0);

	const alternate = await browser.client.createPack({ title: 'Other project task', projectId: 'project-two' });
	assert.equal(alternate.pack.projectId, 'project-two');
	const ungrouped = await browser.client.createPack({ title: 'No project task', projectId: null });
	assert.equal('projectId' in ungrouped.pack, false);

	const seven = { ...fullProject, packs: fullProject.packs.slice(0, -1) };
	const stale = browserClient(envelope(seven));
	await stale.client.refreshDemoState();
	stale.overwrite(envelope(fullProject, 'revision-2'));
	await assert.rejects(stale.client.createPack({ title: 'Stale ninth task', projectId: 'project-one' }), /another tab/u);
	assert.equal(JSON.parse(stale.saved).state.packs.filter((pack) => pack.projectId === 'project-one').length, 8);
	assert.equal(get(stale.client.demoState).packs.filter((pack) => pack.projectId === 'project-one').length, 8);
	assert.equal(stale.writes, 0);
});

test('storage failure and stale concurrent state never expose an undo token or overwrite newer work', async () => {
	const failed = browserClient(envelope(), { failWrite: true });
	await failed.client.refreshDemoState();
	await assert.rejects(failed.client.createPack({ title: 'Cannot persist' }), /storage is full or unavailable/u);
	assert.equal(failed.writes, 0);

	const stale = browserClient();
	await stale.client.refreshDemoState();
	const concurrent = seed();
	concurrent.packs.push({ id: 'concurrent', title: 'Concurrent work', status: 'draft', blocker: 'none', next: 'Set next action' });
	stale.overwrite(envelope(concurrent, 'revision-2'));
	await assert.rejects(stale.client.createPack({ title: 'Stale create' }), /another tab/u);
	assert.equal(JSON.parse(stale.saved).state.packs.at(-1).id, 'concurrent');
	assert.equal(get(stale.client.demoState).packs.at(-1).id, 'concurrent');
	assert.equal(stale.writes, 0);
});

test('undo removes only the exact unchanged created pack and restores its prior selection', async () => {
	const browser = browserClient();
	await browser.client.refreshDemoState();
	const created = await browser.client.createPack({ title: 'Temporary draft', notes: 'Temporary note' });
	const undone = await browser.client.undoCreatedPack(created.undoToken);
	assert.equal(undone.state.packs.some((pack) => pack.id === created.pack.id), false);
	assert.equal(undone.state.selectedId, 'existing');
	assert.deepEqual(json(undone.state.packs[0].memory), ['Keep me']);
	assert.deepEqual(json(undone.state.customWorkspace), { retained: true });
	const after = browser.saved;
	await assert.rejects(browser.client.undoCreatedPack(created.undoToken), /no longer available/u);
	assert.equal(browser.saved, after);
});

test('undo refuses signature changes, dependencies and pending edits without partial removal', async () => {
	for (const useCreated of [
		(state, id) => { state.packs.find((pack) => pack.id === id).memory.push('Edited after creation'); },
		(state, id) => { state.packs.push({ id: 'dependent', title: 'Dependent', status: 'blocked', blocker: 'Waiting', blockedBy: id, next: 'Open' }); },
		(state, id) => { state.pendingNextActionDrafts = [{ workId: id, choice: 'Open', mode: 'preset', evidenceNote: '', evidence: [], originFingerprint: 'changed', source: 'human' }]; },
		(state, id) => { state.pendingNextActionDrafts = [{ workId: 'existing', choice: 'Open', mode: 'preset', evidenceNote: '', evidence: [{ workId: id, field: 'workflow', expectedValue: 'draft' }], originFingerprint: 'changed', source: 'human' }]; }
	]) {
		const browser = browserClient();
		await browser.client.refreshDemoState();
		const created = await browser.client.createPack({ title: 'Guarded draft', notes: 'Initial note' });
		await browser.client.saveBrowserState((state) => useCreated(state, created.pack.id));
		const before = browser.saved;
		await assert.rejects(browser.client.undoCreatedPack(created.undoToken), /changed|dependency|new edits/u);
		assert.equal(browser.saved, before);
		assert.equal(get(browser.client.demoState).packs.some((pack) => pack.id === created.pack.id), true);
	}
});

test('undo preserves unrelated later work and a later selection', async () => {
	const browser = browserClient();
	await browser.client.refreshDemoState();
	const created = await browser.client.createPack({ title: 'Undo only me', projectId: 'project-one' });
	await browser.client.saveBrowserState((state) => {
		state.packs.push({ id: 'later', title: 'Later unrelated work', status: 'active', blocker: 'none', next: 'Open', custom: { retained: true } });
		state.selectedId = 'later';
		state.unrelatedAfterCreate = { retained: true };
	});
	const result = await browser.client.undoCreatedPack(created.undoToken);
	assert.equal(result.state.packs.some((pack) => pack.id === created.pack.id), false);
	assert.deepEqual(json(result.state.packs.find((pack) => pack.id === 'later').custom), { retained: true });
	assert.equal(result.state.selectedId, 'later');
	assert.deepEqual(json(result.state.unrelatedAfterCreate), { retained: true });
});
