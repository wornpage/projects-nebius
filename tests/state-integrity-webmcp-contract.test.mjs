import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	normalizeBoundedText,
	normalizeWorkTitle,
	WORK_TITLE_MAX_LENGTH
} from '../svelte-frontend/src/lib/canonical-text.mjs';
import {
	DEMO_STATE_SCHEMA_VERSION,
	nextStateEnvelope,
	readStateEnvelope,
	withExclusiveStateStorageLock
} from '../svelte-frontend/src/lib/browser-state-envelope.mjs';
import { normalizeText } from '../svelte-frontend/src/lib/workflow-rules.mjs';
import {
	createWorkDraftsTool,
	workDraftInput
} from '../svelte-frontend/src/routes/work/work-webmcp.mjs';

const assertState = (value) => {
	assert.ok(value && typeof value === 'object' && Array.isArray(value.packs));
};
const migrateLegacyState = (state) => structuredClone(state);

function revisions(...values) {
	let index = 0;
	return () => values[index++];
}

function deferred() {
	let resolve;
	const promise = new Promise((settle) => { resolve = settle; });
	return { promise, resolve };
}

function deterministicLockManager() {
	let tail = Promise.resolve();
	return {
		request(name, options, operation) {
			assert.equal(name, 'demo-state-write');
			assert.deepEqual(options, { mode: 'exclusive' });
			const result = tail.then(operation);
			tail = result.then(() => undefined, () => undefined);
			return result;
		}
	};
}

function draftReceipt(input) {
	return {
		created: input.drafts.map((draft, index) => ({ id: `unicode-${index}`, title: draft.title, status: 'draft' })),
		workspaceBefore: input.expectedWorkspaceCount,
		workspaceAfter: input.expectedWorkspaceCount + input.drafts.length,
		workspaceChanged: true,
		requiresHumanStart: true,
		focus: { id: 'work-webmcp-activity', focused: true, focusVisible: true, inViewport: true, pulsed: true }
	};
}

test('canonical title validation stores the same NFC Unicode value that WebMCP validates', async () => {
	const combining = 'Cafe\u0301';
	const canonical = 'Caf\u00e9';
	assert.equal(normalizeWorkTitle(combining), canonical);
	assert.equal(workDraftInput({ expectedWorkspaceCount: 0, drafts: [{ title: combining }] }).drafts[0].title, canonical);
	assert.equal(normalizeWorkTitle('Ship 🚀'), 'Ship 🚀');
	assert.equal(normalizeWorkTitle('Review 🇺🇸 launch'), 'Review 🇺🇸 launch');

	const exactBoundary = `${'a'.repeat(199)}🚀`;
	assert.equal([...exactBoundary].length, WORK_TITLE_MAX_LENGTH);
	assert.equal(normalizeWorkTitle(exactBoundary), exactBoundary);
	assert.equal(normalizeText(exactBoundary, WORK_TITLE_MAX_LENGTH), exactBoundary);
	assert.equal(normalizeBoundedText(`${'a'.repeat(200)}🚀`, WORK_TITLE_MAX_LENGTH), null);

	let commits = 0;
	const tool = createWorkDraftsTool(async (input) => {
		commits += 1;
		return draftReceipt(input);
	});
	const receipt = await tool.execute({ expectedWorkspaceCount: 0, drafts: [{ title: exactBoundary }] });
	assert.equal(receipt.created[0].title, exactBoundary);
	await assert.rejects(
		tool.execute({ expectedWorkspaceCount: 1, drafts: [{ title: `${'a'.repeat(200)}🚀` }] }),
		TypeError
	);
	assert.equal(commits, 1, 'the overlong title is rejected before the persistence callback');
});

test('NFC-equivalent WebMCP titles collide before any draft transaction', async () => {
	let commits = 0;
	const tool = createWorkDraftsTool(async (input) => {
		commits += 1;
		return draftReceipt(input);
	});
	await assert.rejects(tool.execute({
		expectedWorkspaceCount: 0,
		drafts: [{ title: 'Cafe\u0301' }, { title: 'Caf\u00e9' }]
	}), /titles must be unique/u);
	assert.equal(commits, 0);
});

test('legacy raw DemoState hydrates once into the strict v1 revision envelope without data loss', () => {
	const legacy = {
		packs: [{ id: 'legacy', title: 'Legacy 🚀', status: 'active', memory: ['kept'] }],
		selectedId: 'legacy',
		status: 'Existing browser state'
	};
	const migrated = readStateEnvelope(JSON.stringify(legacy), {
		assertState,
		migrateLegacyState,
		createRevision: revisions('revision-migrated')
	});
	assert.equal(migrated.migrated, true);
	assert.deepEqual(migrated.envelope, {
		schemaVersion: DEMO_STATE_SCHEMA_VERSION,
		revision: 'revision-migrated',
		state: legacy
	});

	const hydrated = readStateEnvelope(JSON.stringify(migrated.envelope), {
		assertState,
		migrateLegacyState,
		createRevision: revisions('unused')
	});
	assert.equal(hydrated.migrated, false);
	assert.deepEqual(hydrated.envelope, migrated.envelope);
	assert.throws(() => readStateEnvelope(JSON.stringify({ ...migrated.envelope, schemaVersion: 2 }), {
		assertState,
		migrateLegacyState,
		createRevision: revisions('unused')
	}), /unsupported schema version/u);
});

test('explicit revisions rotate on success and a stale tab cannot overwrite the winner', () => {
	const stateA = { packs: [{ id: 'a', title: 'A' }] };
	const stateB = { packs: [{ id: 'b', title: 'B' }] };
	const stateC = { packs: [{ id: 'c', title: 'C' }] };
	const options = { assertState, migrateLegacyState };

	const first = nextStateEnvelope({
		...options,
		serialized: null,
		expectedRevision: null,
		state: stateA,
		createRevision: revisions('revision-a')
	});
	const second = nextStateEnvelope({
		...options,
		serialized: JSON.stringify(first),
		expectedRevision: 'revision-a',
		state: stateB,
		createRevision: revisions('revision-b')
	});
	const winner = JSON.stringify(second);

	assert.throws(() => nextStateEnvelope({
		...options,
		serialized: winner,
		expectedRevision: 'revision-a',
		state: stateC,
		createRevision: revisions('revision-c')
	}), /revision conflict/u);
	assert.deepEqual(JSON.parse(winner), second, 'the conflict path performs no overwrite');

	const third = nextStateEnvelope({
		...options,
		serialized: winner,
		expectedRevision: 'revision-b',
		state: stateC,
		createRevision: revisions('revision-c')
	});
	assert.equal(third.revision, 'revision-c');
	assert.notEqual(third.revision, second.revision);
	assert.deepEqual(third.state, stateC);
});

test('persisted-state decoder rejects malformed records instead of deferring failures to rendering', () => {
	const source = readFileSync(new URL('../svelte-frontend/src/lib/demo-client.ts', import.meta.url), 'utf8');
	assert.match(source, /optionalTextLimits[\s\S]*?VALID_PACK_STATUSES\.has\(pack\.status\)[\s\S]*?parseDateOnly\(pack\.due\)[\s\S]*?pack\.reactions[\s\S]*?unresolved dependency/u);
	const layout = readFileSync(new URL('../svelte-frontend/src/routes/+layout.svelte', import.meta.url), 'utf8');
	assert.match(layout, /resetDemoSampleState[\s\S]*?Workspace data needs recovery[\s\S]*?Reset local workspace/u);
});

test('persisted recovery quarantines invalid records while keeping valid work visible', () => {
	const client = readFileSync(new URL('../svelte-frontend/src/lib/demo-client.ts', import.meta.url), 'utf8');
	assert.match(client, /function recoverPersistedState[\s\S]*?quarantined[\s\S]*?packs[\s\S]*?recoveryQuarantine/u);
	assert.match(client, /recoverState: recoverPersistedState[\s\S]*?result\.recovered/u);
	const layout = readFileSync(new URL('../svelte-frontend/src/routes/+layout.svelte', import.meta.url), 'utf8');
	assert.match(layout, /Quarantined workspace records[\s\S]*?Valid work remains available[\s\S]*?Reset local workspace/u);
});

test('pending approvals center exposes every proposal with evidence status and recovery actions', () => {
	const center = readFileSync(new URL('../svelte-frontend/src/lib/PendingApprovalsCenter.svelte', import.meta.url), 'utf8');
	assert.match(center, /Pending approvals \(\$\{drafts\.length\}\)[\s\S]*?Every proposal remains unsaved until you approve it on Next/u);
	assert.match(center, /draftStatus\([\s\S]*?fresh[\s\S]*?stale[\s\S]*?orphaned/u);
	assert.match(center, /Review on Next[\s\S]*?Discard/u);
});

test('workspace portability previews before explicit merge or replace', () => {
	const client = readFileSync(new URL('../svelte-frontend/src/lib/demo-client.ts', import.meta.url), 'utf8');
	assert.match(client, /exportWorkspaceState[\s\S]*?previewWorkspaceImport[\s\S]*?importWorkspaceState[\s\S]*?mode: WorkspaceImportMode/u);
	assert.match(client, /delete copy\.status[\s\S]*?copy\.actionReceipt = null/u);
	assert.match(client, /collisionIds[\s\S]*?orphaned pending approval[\s\S]*?draft\.manualOrder = imported\.manualOrder/u);
	const guide = readFileSync(new URL('../svelte-frontend/src/routes/webmcp-challenge/+page.svelte', import.meta.url), 'utf8');
	assert.match(guide, /Prepare export[\s\S]*?Download export[\s\S]*?Import export[\s\S]*?Preview:[\s\S]*?Merge[\s\S]*?Replace/u);
});

test('exclusive migration interleaving cannot overwrite a queued normal write or deadlock', { timeout: 1_000 }, async () => {
	const locks = deterministicLockManager();
	const migrationStarted = deferred();
	const allowMigration = deferred();
	const events = [];
	let serialized = JSON.stringify({ packs: [{ id: 'legacy', title: 'Legacy' }] });

	const migration = withExclusiveStateStorageLock(locks, 'demo-state-write', async () => {
		events.push('migration-read');
		const result = readStateEnvelope(serialized, {
			assertState,
			migrateLegacyState,
			createRevision: revisions('revision-migrated')
		});
		migrationStarted.resolve();
		await allowMigration.promise;
		if (result.migrated) serialized = JSON.stringify(result.envelope);
		events.push('migration-write');
	});
	await migrationStarted.promise;

	const normalWrite = withExclusiveStateStorageLock(locks, 'demo-state-write', () => {
		events.push('normal-write');
		const next = nextStateEnvelope({
			serialized,
			expectedRevision: 'revision-migrated',
			state: { packs: [{ id: 'normal', title: 'Normal winner' }] },
			assertState,
			migrateLegacyState,
			createRevision: revisions('revision-normal')
		});
		serialized = JSON.stringify(next);
	});
	allowMigration.resolve();
	await Promise.all([migration, normalWrite]);

	assert.deepEqual(events, ['migration-read', 'migration-write', 'normal-write']);
	assert.equal(JSON.parse(serialized).revision, 'revision-normal');
	assert.equal(JSON.parse(serialized).state.packs[0].id, 'normal');

	const secondLocks = deterministicLockManager();
	const writerStarted = deferred();
	const allowWriter = deferred();
	const secondEvents = [];
	serialized = JSON.stringify({ packs: [{ id: 'legacy-again', title: 'Legacy again' }] });
	const writerFirst = withExclusiveStateStorageLock(secondLocks, 'demo-state-write', async () => {
		secondEvents.push('normal-write');
		serialized = JSON.stringify({
			schemaVersion: DEMO_STATE_SCHEMA_VERSION,
			revision: 'revision-winner',
			state: { packs: [{ id: 'winner', title: 'Winner' }] }
		});
		writerStarted.resolve();
		await allowWriter.promise;
	});
	await writerStarted.promise;
	const migrationAfterWriter = withExclusiveStateStorageLock(secondLocks, 'demo-state-write', () => {
		secondEvents.push('migration-reread');
		const result = readStateEnvelope(serialized, {
			assertState,
			migrateLegacyState,
			createRevision: revisions('must-not-be-used')
		});
		assert.equal(result.migrated, false);
		if (result.migrated) serialized = JSON.stringify(result.envelope);
	});
	allowWriter.resolve();
	await Promise.all([writerFirst, migrationAfterWriter]);
	assert.deepEqual(secondEvents, ['normal-write', 'migration-reread']);
	assert.equal(JSON.parse(serialized).revision, 'revision-winner');
	assert.equal(JSON.parse(serialized).state.packs[0].id, 'winner');
});

test('exclusive reset interleaving cannot revive removed state and both operations settle', { timeout: 1_000 }, async () => {
	const locks = deterministicLockManager();
	const resetRemoved = deferred();
	const allowReset = deferred();
	const events = [];
	let serialized = JSON.stringify({
		schemaVersion: DEMO_STATE_SCHEMA_VERSION,
		revision: 'revision-before-reset',
		state: { packs: [{ id: 'before-reset', title: 'Before reset' }] }
	});

	const reset = withExclusiveStateStorageLock(locks, 'demo-state-write', async () => {
		events.push('reset-remove');
		serialized = null;
		resetRemoved.resolve();
		await allowReset.promise;
		events.push('reset-install-seed');
		return { packs: [{ id: 'seed', title: 'Seed' }] };
	});
	await resetRemoved.promise;

	const staleWrite = withExclusiveStateStorageLock(locks, 'demo-state-write', () => {
		events.push('stale-write-check');
		const next = nextStateEnvelope({
			serialized,
			expectedRevision: 'revision-before-reset',
			state: { packs: [{ id: 'revived', title: 'Must not revive' }] },
			assertState,
			migrateLegacyState,
			createRevision: revisions('revision-revived')
		});
		serialized = JSON.stringify(next);
	});
	allowReset.resolve();

	const [resetResult, writeResult] = await Promise.allSettled([reset, staleWrite]);
	assert.equal(resetResult.status, 'fulfilled');
	assert.equal(writeResult.status, 'rejected');
	assert.match(writeResult.reason.message, /revision conflict/u);
	assert.deepEqual(events, ['reset-remove', 'reset-install-seed', 'stale-write-check']);
	assert.equal(serialized, null);

	const secondLocks = deterministicLockManager();
	const writerStarted = deferred();
	const allowWriter = deferred();
	const secondEvents = [];
	serialized = JSON.stringify({
		schemaVersion: DEMO_STATE_SCHEMA_VERSION,
		revision: 'revision-before-write',
		state: { packs: [{ id: 'before-write', title: 'Before write' }] }
	});
	const writerFirst = withExclusiveStateStorageLock(secondLocks, 'demo-state-write', async () => {
		secondEvents.push('normal-write');
		serialized = JSON.stringify(nextStateEnvelope({
			serialized,
			expectedRevision: 'revision-before-write',
			state: { packs: [{ id: 'newer', title: 'Newer' }] },
			assertState,
			migrateLegacyState,
			createRevision: revisions('revision-newer')
		}));
		writerStarted.resolve();
		await allowWriter.promise;
	});
	await writerStarted.promise;
	const resetAfterWriter = withExclusiveStateStorageLock(secondLocks, 'demo-state-write', () => {
		secondEvents.push('reset-remove');
		serialized = null;
	});
	allowWriter.resolve();
	await Promise.all([writerFirst, resetAfterWriter]);
	assert.deepEqual(secondEvents, ['normal-write', 'reset-remove']);
	assert.equal(serialized, null);
});
