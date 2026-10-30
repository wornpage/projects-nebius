import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { filterPacks } from '../svelte-frontend/src/lib/demo-workflow.ts';
const FUZZ_SEED = 0x5eedc0de;
const FUZZ_CASE_LIMIT = 256;
const FUZZ_TIME_LIMIT_MS = 2_000;
function seededRandom(seed = FUZZ_SEED) { let state = seed >>> 0; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; }; }
function assertWithinFuzzLimit(startedAt, caseIndex) { assert.ok(performance.now() - startedAt <= FUZZ_TIME_LIMIT_MS, `seed exceeded time at case ${caseIndex}`); }

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
