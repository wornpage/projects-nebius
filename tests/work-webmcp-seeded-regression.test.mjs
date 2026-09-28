import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { filterPacks } from '../svelte-frontend/src/lib/demo-workflow.ts';
import {
	createWorkDraftsTool
} from '../svelte-frontend/src/routes/work/work-webmcp.mjs';

const FUZZ_SEED = 0x5eedc0de;
const FUZZ_CASE_LIMIT = 256;
const FUZZ_TIME_LIMIT_MS = 2_000;

function seededRandom(seed = FUZZ_SEED) {
	let state = seed >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

function assertWithinFuzzLimit(startedAt, caseIndex) {
	assert.ok(
		performance.now() - startedAt <= FUZZ_TIME_LIMIT_MS,
		`seed 0x${FUZZ_SEED.toString(16)} exceeded ${FUZZ_TIME_LIMIT_MS}ms at case ${caseIndex}`
	);
}

function draftReceipt(input) {
	return {
		created: input.drafts.map((draft, index) => ({ id: `seeded-draft-${index + 1}`, title: draft.title, status: 'draft' })),
		workspaceBefore: input.expectedWorkspaceCount,
		workspaceAfter: input.expectedWorkspaceCount + input.drafts.length,
		workspaceChanged: true,
		requiresHumanStart: true,
		focus: { id: 'work-webmcp-activity', focused: true, focusVisible: true, inViewport: true, pulsed: true }
	};
}

test('seeded Work search never projects hidden memory, sources, or purpose', () => {
	const random = seededRandom();
	const startedAt = performance.now();
	const hiddenFields = ['memory', 'sources', 'purpose'];

	for (let caseIndex = 0; caseIndex < FUZZ_CASE_LIMIT; caseIndex += 1) {
		const sentinel = `hidden-${FUZZ_SEED.toString(16)}-${caseIndex}`;
		const hiddenField = hiddenFields[Math.floor(random() * hiddenFields.length)];
		const pack = {
			id: `pack-${caseIndex}`,
			title: `Visible work ${caseIndex}`,
			type: 'Task',
			status: 'active',
			next: 'Open',
			owner: 'Visible owner',
			due: '2026-09-12',
			blocker: 'none',
			area: 'Visible area',
			memory: [],
			sources: [],
			purpose: ''
		};
		if (hiddenField === 'memory') pack.memory = [`[2026-09-01 12:00] ${sentinel}`];
		if (hiddenField === 'sources') pack.sources = [`https://example.test/${sentinel}`];
		if (hiddenField === 'purpose') pack.purpose = sentinel;

		assert.deepEqual(filterPacks([pack], 'all', sentinel), [], `seeded case ${caseIndex} exposed ${hiddenField}`);
		assertWithinFuzzLimit(startedAt, caseIndex);
	}
});

test('seeded JSON-reachable draft mutations fail before the transaction', async () => {
	const random = seededRandom();
	const startedAt = performance.now();
	let commits = 0;
	const tool = createWorkDraftsTool(async (input) => {
		commits += 1;
		return draftReceipt(input);
	});
	const draftSchema = tool.inputSchema.properties.drafts.items.properties;
	for (const field of ['owner', 'area', 'type', 'due', 'energy', 'recurrence', 'proofTarget']) {
		assert.equal(draftSchema[field].type, 'string');
	}

	const mutations = [
		(input) => { input.extra = true; },
		(input) => { input.expectedWorkspaceCount = -1; },
		(input) => { input.expectedWorkspaceCount = 1.5; },
		(input) => { input.drafts = null; },
		(input) => { input.drafts = []; },
		(input) => { input.drafts[0].title = null; },
		(input) => { input.drafts[0].title = ' '; },
		(input) => { input.drafts[0].title = 'V'.repeat(201); },
		(input) => { input.drafts[0].owner = null; },
		(input) => { input.drafts[0].owner = 'A'.repeat(121); },
		(input) => { input.drafts[0].area = { hidden: true }; },
		(input) => { input.drafts[0].type = 'bad\u0000type'; },
		(input) => { input.drafts[0].due = '2026-02-30'; },
		(input) => { input.drafts[0].energy = 'urgent'; },
		(input) => { input.drafts[0].secret = 'hidden'; }
	];

	for (let caseIndex = 0; caseIndex < FUZZ_CASE_LIMIT; caseIndex += 1) {
		const malformedJson = `${' '.repeat(Math.floor(random() * 4))}{"drafts":[${caseIndex},`;
		assert.throws(() => JSON.parse(malformedJson), SyntaxError, `seeded case ${caseIndex} parsed malformed JSON`);
		const candidate = { expectedWorkspaceCount: 8, drafts: [{ title: `Seeded draft ${caseIndex}` }] };
		mutations[Math.floor(random() * mutations.length)](candidate);
		const jsonReachable = JSON.parse(JSON.stringify(candidate));
		await assert.rejects(
			tool.execute(jsonReachable),
			(error) => error instanceof TypeError,
			`seeded case ${caseIndex} reached the draft transaction`
		);
		assertWithinFuzzLimit(startedAt, caseIndex);
	}
	assert.equal(commits, 0);
});

test('draft cancellation is truthful on both sides of the atomic commit boundary', async () => {
	const input = { expectedWorkspaceCount: 8, drafts: [{ title: 'Committed draft' }] };
	const preCommitAbort = new AbortController();
	preCommitAbort.abort();
	let workspaceCount = 8;
	const neverCommitted = createWorkDraftsTool(async (createInput) => {
		workspaceCount += createInput.drafts.length;
		return draftReceipt(createInput);
	});
	await assert.rejects(neverCommitted.execute(input, { signal: preCommitAbort.signal }), { name: 'AbortError' });
	assert.equal(workspaceCount, 8);

	const lateAbort = new AbortController();
	const committed = createWorkDraftsTool(async (createInput) => {
		workspaceCount += createInput.drafts.length;
		lateAbort.abort();
		return draftReceipt(createInput);
	});
	const receipt = await committed.execute(input, { signal: lateAbort.signal });
	assert.equal(workspaceCount, 9);
	assert.equal(lateAbort.signal.aborted, true);
	assert.deepEqual(receipt.created, [{ id: 'seeded-draft-1', title: 'Committed draft', status: 'draft' }]);
});
