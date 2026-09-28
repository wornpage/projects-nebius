import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	REVIEW_CURRENT_TOOL_NAME,
	REVIEW_SCOPE_TOOL_NAME,
	createCurrentReviewTool,
	createSetReviewScopeTool,
	normalizeReviewSearch,
	reviewItemPageView,
	reviewPageView,
	reviewScopePresentationReceipt,
	settleReviewScopeFocus
} from '../svelte-frontend/src/routes/review/review-webmcp.mjs';
import { decisionWorkspaceReviewFocusRequest } from '../svelte-frontend/src/lib/decision-workspace-navigation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/+page.svelte'), 'utf8');
const nextRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/+page.svelte'), 'utf8');
const nextCandidatePickerSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/NextCandidatePicker.svelte'), 'utf8');
const workRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/+page.svelte'), 'utf8');

test('Review keeps cold hydration in a loading state before declaring an empty queue', () => {
	assert.match(routeSource, /loading=\{\(\$demoState === null && !\$demoStateError\) \|\| \(\$demoStateLoading && packs\.length === 0\)\}/u);
	assert.match(routeSource, /\{:else if reviewTotal === 0 && \$demoState !== null && !\$demoStateLoading && !\$demoStateError\}/u);
});

test('Review announces its canonical mutation receipt without adding another toast path', () => {
	assert.match(routeSource, /<WornReceipt[\s\S]*?summary=\{receipt\.summary\}[\s\S]*?announce=\{true\}/u);
	const actionHandler = routeSource.match(/async function doAction\(pack: DemoPack, action: string\)[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.equal(actionHandler.match(/displayToast\(/gu)?.length ?? 0, 1);
	assert.match(actionHandler, /catch \(e\)[\s\S]*?displayToast\([\s\S]*?'error'\)/u);
});
const workflowSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-workflow.ts'), 'utf8');
const reviewQueueSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/review-queue.ts'), 'utf8');
const reviewFilterControlsSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/ReviewFilterControls.svelte'), 'utf8');
const helperSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/review-webmcp.mjs'), 'utf8');
const registrationSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/webmcp.mjs'), 'utf8');
const activityStripSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/WebMcpActivityStrip.svelte'), 'utf8');
const demoCss = fs.readFileSync(path.join(repoRoot, 'assets/demo.css'), 'utf8');
const seedPacks = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/demo-packs.json'), 'utf8'));

function queueView() {
	return reviewPageView({
		scope: { query: 'garage', filter: 'blocked' },
		availableFilters: ['all', 'blocked', 'missing-next'],
		counts: {
			totalReview: 12,
			searchMatches: 5,
			filtered: 3,
			shown: 2,
			remaining: 1,
			blocked: 3,
			missingNext: 1,
			missingOwner: 0
		},
		upNext: {
			id: 'garage / one',
			title: 'Garage one',
			workflow: 'Blocked',
			owner: 'Avery',
			due: 'Due today',
			blocker: 'Waiting for access',
			attentionReasons: ['Blocked: Waiting for access.', 'Due date is overdue.'],
			memory: ['not exposed'],
			purpose: 'not exposed'
		},
		items: [{
			id: 'garage-two',
			title: 'Garage two',
			workflow: 'Needs action',
			owner: 'Unassigned',
			due: null,
			blocker: null,
			attentionReasons: ['No owner is assigned.'],
			next: 'not exposed'
		}]
	});
}

test('one Review selector excludes terminal work and includes explicit Review actions', () => {
	assert.match(
		workflowSource,
		/export function canSetNextAction\(pack: DemoPack\): boolean \{\s*return pack\.status !== 'done' && !pack\.archived;\s*\}[\s\S]*?export function isReview\(pack: DemoPack\): boolean \{\s*if \(!canSetNextAction\(pack\)\) return false;[\s\S]*?action === 'review-work';\s*\}/u
	);
	assert.deepEqual(
		seedPacks.filter((pack) => pack.status === 'done' && !pack.next).map((pack) => pack.id),
		['garage-reset-clear-floor', 'garden-study-tag-field-notes']
	);
	assert.deepEqual(
		seedPacks.filter((pack) => pack.status === 'active' && pack.next === 'Review').map((pack) => pack.id),
		['garage-reset-choose-bike-rack', 'garden-study-choose-followup-sample']
	);
	assert.match(reviewQueueSource, /export function preferredReviewPack[\s\S]*?packs\.find\(isReview\)/u);
	assert.match(workflowSource, /filter === 'review'\s*\? isReview\(pack\)/u);
	assert.match(reviewQueueSource, /const reviewTotal = packs\.filter\(isReview\)\.length;[\s\S]*?filterPacks\(packs, 'review', query\)/u);
	assert.match(reviewQueueSource, /export function buildStandupText[\s\S]*?const review = packs\.filter\(isReview\);/u);
	assert.match(routeSource, /from '\.\/review-queue';[\s\S]*?summarizeReviewQueue\(packs, query, reviewSubFilter\)[\s\S]*?preferredReviewPack\(list\)/u);
	assert.doesNotMatch(workflowSource, /ReviewSubFilter|ReviewQueueSummary|preferredReviewPack|summarizeReviewQueue|buildStandupText/u);
	assert.match(nextCandidatePickerSource, /let candidates = \$derived\(packs\.filter\(isReview\)\.filter\(\(candidate\) => candidate\.id !== currentPackId\)\);/u);
	assert.match(workRouteSource, /if \(isReview\(pack\)\) next\.review \+= 1;/u);
	assert.doesNotMatch(`${routeSource}\n${nextRouteSource}\n${nextCandidatePickerSource}\n${workRouteSource}`, /(?:review|candidate)[^\n]*status\s*!==?\s*'done'/u);
});

test('Review no-match guidance describes this route, not Work', () => {
	assert.match(routeSource, /description="Try clearing filters or updating the search term on this route\."/u);
	assert.doesNotMatch(routeSource, /on the Work route\./u);
});

test('Review projects only its explicit rendered queue and denominators', () => {
	assert.deepEqual(reviewItemPageView({
		id: 'garage / one',
		title: 'Garage one',
		workflow: 'Blocked',
		owner: 'Avery',
		due: 'Due today',
		blocker: 'Waiting for access',
		attentionReasons: ['Blocked: Waiting for access.'],
		memory: ['not exposed']
	}), {
		id: 'garage / one',
		title: 'Garage one',
		href: '/next?pack=garage%20%2F%20one',
		workflow: 'Blocked',
		owner: 'Avery',
		due: 'Due today',
		blocker: 'Waiting for access',
		attentionReasons: ['Blocked: Waiting for access.']
	});

	const view = queueView();
	assert.deepEqual(view, {
		scope: { query: 'garage', filter: 'blocked' },
		availableFilters: ['all', 'blocked', 'missing-next'],
		counts: {
			totalReview: 12,
			searchMatches: 5,
			filtered: 3,
			shown: 2,
			remaining: 1,
			blocked: 3,
			missingNext: 1,
			missingOwner: 0
		},
		upNext: {
			id: 'garage / one',
			title: 'Garage one',
			href: '/next?pack=garage%20%2F%20one',
			workflow: 'Blocked',
			owner: 'Avery',
			due: 'Due today',
			blocker: 'Waiting for access',
			attentionReasons: ['Blocked: Waiting for access.', 'Due date is overdue.']
		},
		items: [{
			id: 'garage-two',
			title: 'Garage two',
			href: '/next?pack=garage-two',
			workflow: 'Needs action',
			owner: 'Unassigned',
			due: null,
			blocker: null,
			attentionReasons: ['No owner is assigned.']
		}]
	});
	assert.doesNotMatch(JSON.stringify(view), /not exposed/u);

	for (const malformed of [
		null,
		{},
		{ ...view, availableFilters: ['all'] },
		{ ...view, counts: { ...view.counts, shown: 3 } },
		{ ...view, counts: { ...view.counts, remaining: 2 } },
		{ ...view, counts: { ...view.counts, searchMatches: 2 } },
		{ ...view, items: [view.upNext] },
		{ ...view, upNext: { ...view.upNext, attentionReasons: [] } },
		{ ...view, upNext: { ...view.upNext, attentionReasons: ['Same reason.', 'Same reason.'] } },
		{ ...view, upNext: { ...view.upNext, attentionReasons: ['x'.repeat(241)] } },
		{ ...view, scope: { query: '', filter: 'unknown' } }
	]) {
		assert.equal(reviewPageView(malformed), null);
	}
});

test('Review header names filtered, search-match, and total-review denominators', () => {
	const titleSource = routeSource.match(/let reviewTitle = \$derived\([\s\S]*?\n\t\);/u)?.[0] ?? '';
	assert.match(titleSource, /reviewSubFilter === 'all'/u);
	assert.match(titleSource, /`\$\{reviewTotal\} to review · \$\{blockedCount\} blocked`/u);
	assert.match(titleSource, /`\$\{visible\.length\} search matches · \$\{reviewTotal\} total review`/u);
	assert.match(
		titleSource,
		/`\$\{filteredVisible\.length\} scoped · \$\{visible\.length\} search matches · \$\{reviewTotal\} total review`/u
	);
	assert.doesNotMatch(titleSource, /`\$\{filteredVisible\.length\} of \$\{reviewTotal\} scoped · \$\{blockedCount\} blocked`/u);
});

test('the current-review descriptor is closed, read-only, live, and clone-safe', async () => {
	let current = queueView();
	let reads = 0;
	const tool = createCurrentReviewTool(() => {
		reads += 1;
		return current;
	});
	assert.equal(tool.name, REVIEW_CURRENT_TOOL_NAME);
	assert.equal(tool.name, 'get_current_review_queue');
	assert.equal(tool.title, 'Get current review queue');
	assert.match(tool.description, /bounded work queue currently rendered on Review/u);
	assert.match(tool.description, /total, filtered, shown, and remaining counts/u);
	assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
	assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: false, untrustedContentHint: true });

	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(() => tool.execute({ unexpected: true }, { signal: aborted.signal }), { name: 'AbortError' });
	assert.equal(reads, 0);
	await assert.rejects(() => tool.execute(), /empty object/u);
	for (const malformed of [null, [], { unexpected: true }]) {
		await assert.rejects(() => tool.execute(malformed), /empty object/u);
	}
	assert.equal(reads, 0);

	const canonical = structuredClone(current);
	const result = await tool.execute({}, { signal: new AbortController().signal });
	assert.equal(reads, 1);
	assert.deepEqual(result, current);
	assert.notEqual(result, current);
	assert.notEqual(result.scope, current.scope);
	assert.notEqual(result.availableFilters, current.availableFilters);
	assert.notEqual(result.counts, current.counts);
	assert.notEqual(result.upNext, current.upNext);
	assert.notEqual(result.upNext.attentionReasons, current.upNext.attentionReasons);
	assert.notEqual(result.items, current.items);
	for (let index = 0; index < result.items.length; index += 1) {
		assert.notEqual(result.items[index], current.items[index]);
		assert.notEqual(result.items[index].attentionReasons, current.items[index].attentionReasons);
	}
	result.scope.query = 'mutated result';
	result.availableFilters.push('owner-gap');
	result.counts.totalReview = 999;
	result.upNext.title = 'Mutated up next';
	result.upNext.attentionReasons.push('Result-only reason.');
	result.items[0].title = 'Mutated queue item';
	result.items[0].attentionReasons.push('Another result-only reason.');
	result.items.push(result.items[0]);
	assert.deepEqual(current, canonical);

	current = null;
	assert.equal(await tool.execute({}, { signal: new AbortController().signal }), null);
	assert.equal(reads, 2);
	assert.throws(() => createCurrentReviewTool(null), /queue getter/u);
});

test('the Review scope descriptor declares and verifies one reversible page-state interaction', async () => {
	const calls = [];
	const view = queueView();
	const focusProof = { focused: true, focusVisible: true, inViewport: true, pulsed: true };
	const tool = createSetReviewScopeTool(async (scope) => {
		calls.push(scope);
		return {
			changed: true,
			focus: { target: 'item', itemId: view.upNext.id, ...focusProof },
			review: view
		};
	});
	assert.equal(tool.name, REVIEW_SCOPE_TOOL_NAME);
	assert.equal(tool.name, 'set_review_scope');
	assert.equal(tool.title, 'Set review scope');
	assert.match(tool.description, /changes only the current page scope/u);
	assert.match(tool.description, /does not modify workspace data/u);
	assert.deepEqual(tool.inputSchema, {
		type: 'object',
		properties: {
			query: { type: 'string', maxLength: 120, description: 'Search text. Use an empty string to clear the search.' },
			filter: {
				type: 'string',
				enum: ['all', 'blocked', 'missing-next', 'owner-gap'],
				description: 'Review queue subfilter.'
			}
		},
		required: ['query', 'filter'],
		additionalProperties: false
	});
	assert.deepEqual(tool.annotations, {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
		untrustedContentHint: true
	});

	const result = await tool.execute({ query: ' garage ', filter: 'blocked' }, { signal: new AbortController().signal });
	assert.deepEqual(calls, [{ query: 'garage', filter: 'blocked' }]);
	assert.deepEqual(result, {
		changed: true,
		focus: { target: 'item', itemId: 'garage / one', ...focusProof },
		review: view
	});
	assert.notEqual(result.review, view);
	for (const field of Object.keys(focusProof)) {
		const unverified = createSetReviewScopeTool(async () => ({
			...structuredClone(result),
			focus: { ...result.focus, [field]: false }
		}));
		await assert.rejects(
			() => unverified.execute({ query: 'garage', filter: 'blocked' }),
			/verifiable page receipt/u
		);
	}
	await assert.rejects(() => tool.execute({ query: '', filter: 'unknown' }), /filter must be/u);
	await assert.rejects(() => tool.execute({ query: '', filter: 'all', extra: true }), /accepts only query and filter/u);
	await assert.rejects(() => tool.execute({ query: 42, filter: 'all' }), /120 characters or fewer/u);
	await assert.rejects(() => tool.execute({ query: 'line\nbreak', filter: 'all' }), /control characters/u);
	await assert.rejects(() => tool.execute({ query: 'x'.repeat(121), filter: 'all' }), /120 characters or fewer/u);
	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(() => tool.execute({ query: '', filter: 'all' }, { signal: aborted.signal }), { name: 'AbortError' });
	assert.throws(() => createSetReviewScopeTool(null), /scope setter/u);
});

test('Review presentation receipts freeze normalized filters, counts, and visible evidence', () => {
	assert.equal(normalizeReviewSearch('  Garage reset  '), 'Garage reset');
	assert.equal(normalizeReviewSearch('line\nbreak'), null);
	assert.equal(normalizeReviewSearch('x'.repeat(120)), 'x'.repeat(120));
	assert.equal(normalizeReviewSearch('x'.repeat(121)), null);
	const review = queueView();
	const receipt = reviewScopePresentationReceipt({
		changed: true,
		focus: { target: 'item', itemId: review.upNext.id, focused: true, focusVisible: true, inViewport: true, pulsed: true },
		review
	});
	assert.equal(receipt.summary, 'Review scope updated: “garage” · Blocked.');
	assert.deepEqual(receipt.cells, [
		{ label: 'Visible Review scope', value: '“garage” · Blocked' },
		{ label: 'Current queue', value: '2 shown · 3 filtered · 5 search matches · 12 total review' },
		{ label: 'Search-match evidence', value: '3 blocked · 1 missing next · 0 missing owner' },
		{ label: 'Status', value: 'Visible queue updated · Not saved' }
	]);
	assert.equal(receipt.scopeKey, JSON.stringify({ scope: review.scope, counts: review.counts }));
});

test('Review human and WebMCP search share one explicit query-length boundary', () => {
	assert.match(helperSource, /export const REVIEW_SEARCH_MAX_LENGTH = 120;/u);
	assert.match(
		helperSource,
		/query: \{ type: 'string', maxLength: REVIEW_SEARCH_MAX_LENGTH,[\s\S]*?query\.length <= REVIEW_SEARCH_MAX_LENGTH \? query : null;/u
	);
	assert.match(reviewFilterControlsSource, /import \{ REVIEW_SEARCH_MAX_LENGTH \} from '\.\/review-webmcp\.mjs';/u);
	assert.match(
		reviewFilterControlsSource,
		/function setHumanReviewQuery\(event: Event\) \{[\s\S]*?const input = event\.currentTarget as HTMLInputElement;[\s\S]*?const nextQuery = input\.value\.slice\(0, REVIEW_SEARCH_MAX_LENGTH\);[\s\S]*?input\.value = nextQuery;[\s\S]*?query = nextQuery;[\s\S]*?\}/u
	);
	assert.match(
		reviewFilterControlsSource,
		/id="review-filter-query"[\s\S]*?maxlength=\{REVIEW_SEARCH_MAX_LENGTH\}[\s\S]*?bind:value=\{query\}[\s\S]*?oninput=\{setHumanReviewQuery\}/u
	);
	assert.match(routeSource, /import ReviewFilterControls from '\.\/ReviewFilterControls\.svelte';[\s\S]*?<ReviewFilterControls options=\{reviewFilterOptions\} bind:query bind:active=\{reviewSubFilter\} \/>/u);
	assert.doesNotMatch(routeSource, /setHumanReviewQuery|class="review-filter-controls"|\.review-filter-controls|id="review-filter-query"|REVIEW_SEARCH_MAX_LENGTH|WornSegmentedControl|WornToolbar/u);
	assert.equal((routeSource.match(/document\.getElementById\('review-filter-query'\)/gu) ?? []).length, 2);
	assert.match(reviewFilterControlsSource, /options: Array<\{ id: ReviewSubFilter; label: string \}>;[\s\S]*?query: string;[\s\S]*?active: ReviewSubFilter;[\s\S]*?query = \$bindable\(\)[\s\S]*?active = \$bindable\(\)/u);
	assert.match(reviewFilterControlsSource, /\.review-filter-controls\{display:grid;gap:8px;grid-template-columns:minmax\(0,1fr\) minmax\(200px,\.7fr\);min-width:0;width:100%\}/u);
	assert.match(reviewFilterControlsSource, /@media\(max-width:500px\)\{\.review-filter-controls\{grid-template-columns:minmax\(0,1fr\)\}\}/u);
	assert.doesNotMatch(reviewFilterControlsSource, /fetch\(|localStorage|sessionStorage|saveBrowserState|runPackAction|setSelectedWork/u);
});

test('Work-to-Review retained scroll settles before strict visible-focus proof', async () => {
	let inViewport = false;
	const calls = [];
	const nextFrame = async () => {
		calls.push('frame');
		inViewport = true;
	};
	const receipt = await settleReviewScopeFocus((requireVisibleFocus) => {
		calls.push(requireVisibleFocus ? 'strict' : 'position');
		const proof = {
			focused: true,
			focusVisible: true,
			inViewport,
			pulsed: true
		};
		if (requireVisibleFocus && !proof.inViewport) {
			throw new Error(`Visible focus verification failed: ${JSON.stringify(proof)}`);
		}
		return proof;
	}, nextFrame);

	assert.deepEqual(calls, ['position', 'frame', 'frame', 'strict']);
	assert.deepEqual(receipt, {
		focused: true,
		focusVisible: true,
		inViewport: true,
		pulsed: true
	});

	await assert.rejects(
		() => settleReviewScopeFocus((requireVisibleFocus) => {
			const proof = { focused: true, focusVisible: true, inViewport: false, pulsed: true };
			if (requireVisibleFocus) {
				throw new Error(`Visible focus verification failed: ${JSON.stringify(proof)}`);
			}
			return proof;
		}, async () => {}),
		/Visible focus verification failed: .*"inViewport":false/u
	);
});

test('Review accepts only one exact Decision Workspace focus request and leaves absent targets unfocused', () => {
	const exactId = '  review / exact id  ';
	const longExactId = ` ${'r'.repeat(201)} / exact `;
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams()), { present: false, workId: '' });
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams(`focus=${encodeURIComponent(exactId)}`)), { present: true, workId: exactId });
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams(`focus=${encodeURIComponent(longExactId)}`)), { present: true, workId: longExactId });
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams('focus=one&focus=two')), { present: true, workId: '' });
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams('focus=')), { present: true, workId: '' });

	const focusOwner = routeSource.match(/async function focusReviewScopeDestination[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(focusOwner, /requestedItemId = ''[\s\S]*?currentReviewView\?\.upNext[\s\S]*?item\?\.id === requestedItemId/u);
	assert.match(focusOwner, /requestedItemId && \(!requestedItem \|\| !requestedCard \|\| requestedCard\.dataset\.packId !== requestedItemId\)\) return null;/u);
	assert.match(focusOwner, /requestedItemId && itemId !== requestedItemId\) return null;/u);
	assert.match(focusOwner, /focusAndPulse\(focusTarget, \{/u);
	assert.doesNotMatch(focusOwner, /setSelectedWork|query\s*=|reviewSubFilter\s*=/u);

	const refreshOwner = routeSource.match(/async function refreshReview[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(refreshOwner, /reviewFocusRequest\.present\) return;[\s\S]*?setSelectedWork/u);
	assert.match(routeSource, /let reviewFocusRequest = \$derived\([\s\S]*?decisionWorkspaceReviewFocusRequest\(\$page\.url\.searchParams\)[\s\S]*?const target = reviewFocusRequest\.workId;[\s\S]*?const signal = getAbortSignal\(\);[\s\S]*?signal\.aborted[\s\S]*?await focusReviewScopeDestination\(true, target, signal\);[\s\S]*?signal\.aborted[\s\S]*?focus\?\.target === 'item' && focus\.itemId === target/u);
	assert.doesNotMatch(routeSource, /\$page\.url\.searchParams\.get\('focus'\)/u);
});

test('every visible Review to Next activation uses one canonical focused handoff', () => {
	assert.match(routeSource, /async function handoffToNext\(packId: string \| undefined, event\?: MouseEvent\)[\s\S]*?event\?\.preventDefault\(\);[\s\S]*?await goto\(`\/next\?pack=\$\{encodeURIComponent\(packId\)\}`\);[\s\S]*?await tick\(\);[\s\S]*?document\.querySelector<HTMLElement>\('\[data-next-preview\]'\)[\s\S]*?if \(!preview\) throw new Error\('Next preview did not render\.'\);[\s\S]*?focusAndPulse\(preview, \{ behavior: 'auto', block: 'center', requireVisibleFocus: true \}\);/u);
	assert.equal(routeSource.match(/await goto\(`\/next\?pack=/gu)?.length, 1);
	assert.equal(routeSource.match(/^\s*(?:await\s+)?goto\(/gmu)?.length, 1);

	// Review always hands both card types to Next. It never promotes the shared
	// Review-blocker command, which would only return to this same route.
	assert.match(routeSource, /data-review-priority-navigation variant="primary" href=\{`\/next\?pack=\$\{encodeURIComponent\(firstReview\.id \|\| ''\)\}`\} onclick=\{\(event\) => handoffToNext\(firstReview\.id, event\)\}>\{__NEBIUS_EDITION__ \? 'Open next step' : 'Set next action'\}<\/WornButton>/u);
	assert.match(routeSource, /data-review-card-navigation variant="primary" href=\{`\/next\?pack=\$\{encodeURIComponent\(pack\.id \|\| ''\)\}`\} onclick=\{\(event\) => handoffToNext\(pack\.id, event\)\}>\{__NEBIUS_EDITION__ \? 'Open next step' : 'Set next action'\}<\/WornButton>/u);
	assert.doesNotMatch(routeSource, /data-review-(?:priority|card)-mutation|data-review-next-action|Review blocker|primaryCommandNavigation|PACK_ACTIONS/u);
	assert.match(workflowSource, /export function primaryCommand\(pack: DemoPack\): PrimaryCommand \{[\s\S]*?\{ label: 'Review blocker', action: 'review', targetPackId: pack\.id \}/u);
	assert.match(workflowSource, /export function primaryCommandNavigation\(pack: DemoPack\): string \{[\s\S]*?const id = encodeURIComponent\(pack\.id \|\| ''\);[\s\S]*?if \(action === 'review'\) return `\/review\?focus=\$\{id\}`;/u);

	// The explicit primary button is the only Review-to-Next activation path.
	assert.doesNotMatch(routeSource, /async function handleCardKeys\(/u);
	assert.doesNotMatch(routeSource, /aria-keyshortcuts="ArrowUp ArrowDown Enter Space"|tabindex=\{0\}/u);
	assert.doesNotMatch(routeSource, /<a class="demo-card-title"[\s\S]*?href=\{`\/next\?pack=/u);
	assert.match(routeSource, /review-priority-title[\s\S]*?<div class="demo-card-title review-static-title">\{workTitle\(firstReview\)\}<\/div>/u);
	assert.match(routeSource, /<div class="demo-card-title review-static-title">\{workTitle\(pack\)\}<\/div>/u);
});

test('Review cards do not advertise an unowned drag interaction', () => {
	assert.doesNotMatch(routeSource, /<WornFoldedSurface[^>]*\bdraggable=/u);
	assert.doesNotMatch(routeSource, /\bon(?:dragstart|dragover|dragend|drop)=/u);
});

test('Review owns one canonical rendered projection and scope setter', () => {
	assert.match(routeSource, /import \{ registerPageTools \} from '\$lib\/webmcp\.mjs';/u);
	assert.match(routeSource, /import \{[\s\S]*?createCurrentReviewTool,[\s\S]*?createSetReviewScopeTool,[\s\S]*?reviewItemPageView,[\s\S]*?reviewPageView[\s\S]*?\} from '\.\/review-webmcp\.mjs';/u);
	assert.match(routeSource, /let currentReviewView = \$derived\.by\(\(\) => reviewPageView\(\{[\s\S]*?totalReview: reviewTotal,[\s\S]*?searchMatches: visible\.length,[\s\S]*?filtered: filteredVisible\.length,[\s\S]*?shown: renderedReviewCount,[\s\S]*?remaining: hiddenReviewCount/u);
	assert.match(routeSource, /upNext: reviewItemForPageTool\(firstReview\),\s*items: renderedList\.map\(reviewItemForPageTool\)/u);
	assert.match(routeSource, /function attentionReasons\(pack: DemoPack\): string\[\][\s\S]*?Blocked:[\s\S]*?No next action is set[\s\S]*?Decision needed from/u);
	assert.doesNotMatch(routeSource, /This item is in the review queue/u);
	assert.match(routeSource, /function reviewItemForPageTool\([\s\S]*?reviewItemPageView\(\{[\s\S]*?title: workTitle\(pack\)[\s\S]*?\.\.\.evidenceFacts\(pack\)[\s\S]*?owner: ownerLabel\(pack\.owner\)[\s\S]*?attentionReasons: attentionReasons\(pack\)/u);
	assert.match(routeSource, /class="review-reasons"[\s\S]*?Why this surfaced[\s\S]*?attentionReasons\(firstReview\)/u);
	assert.match(routeSource, /async function applyReviewScope\([\s\S]*?query = nextQuery;\s*reviewSubFilter = nextFilter;\s*await tick\(\);[\s\S]*?await focusReviewScopeDestination\(requireVisibleFocus\)/u);
	assert.match(routeSource, /const requestedQueue = summarizeReviewQueue\(packs, nextQuery, 'all'\);[\s\S]*?nextFilter === reviewSubFilter[\s\S]*?const \{ changed, focus \} = await applyReviewScope\(nextQuery, nextFilter, 'results', true\);[\s\S]*?if \(!focus\)[\s\S]*?return \{ changed, focus, review: currentReviewView \};/u);
	assert.match(routeSource, /async function focusReviewScopeDestination\(requireVisibleFocus: boolean, requestedItemId = '', signal\?: AbortSignal\)[\s\S]*?currentReviewView\?\.upNext[\s\S]*?\.review-priority\[data-pack-id\] \.demo-card-title[\s\S]*?signal\?\.aborted[\s\S]*?focusAndPulse\(focusTarget, \{[\s\S]*?requireVisibleFocus: verify[\s\S]*?await settleReviewScopeFocus\(runFocus\)[\s\S]*?if \(!focusReceipt\) return null[\s\S]*?target: 'item'[\s\S]*?target: 'search'[\s\S]*?target: 'queue'/u);
	assert.match(routeSource, /async function recordReviewWebMcpResult[\s\S]*?if \(toolName !== REVIEW_SCOPE_TOOL_NAME\) return;[\s\S]*?webMcpScopeReceipt = \{ \.\.\.reviewScopePresentationReceipt\(result\), toolName \}/u);
	assert.match(helperSource, /function reviewScopePresentationReceipt[\s\S]*?Visible Review scope[\s\S]*?Current queue[\s\S]*?Search-match evidence[\s\S]*?Status[\s\S]*?Not saved/u);
	assert.match(routeSource, /webMcpScopeReceipt = \{ \.\.\.reviewScopePresentationReceipt\(result\), toolName \};[\s\S]*?await tick\(\);[\s\S]*?await focusReviewScopeDestination\(true\)[\s\S]*?finalFocus\.target !== outcome\.focus\.target[\s\S]*?throw new Error\('Review receipt focus did not match the rendered scope destination\.'\)[\s\S]*?id: 'review-scope'/u);
	assert.match(routeSource, /let reviewReceiptScopeKey = \$derived\([\s\S]*?currentReviewView\.scope[\s\S]*?currentReviewView\.counts/u);
	assert.match(routeSource, /\$effect\(\(\) => \{[\s\S]*?webMcpScopeReceipt\.scopeKey !== reviewReceiptScopeKey[\s\S]*?webMcpScopeReceipt = null/u);
	assert.match(helperSource, /scopeKey: JSON\.stringify\(\{ scope: review\.scope, counts: review\.counts \}\)/u);
	assert.match(routeSource, /import WebMcpActivityStrip from '\$lib\/WebMcpActivityStrip\.svelte';/u);
	assert.match(routeSource, /\{#if webMcpScopeReceipt\}[\s\S]*?<WebMcpActivityStrip[\s\S]*?id="review-webmcp-activity"[\s\S]*?route="review"[\s\S]*?outcome=\{webMcpScopeReceipt\.summary\}[\s\S]*?toolName=\{webMcpScopeReceipt\.toolName\}[\s\S]*?cells=\{webMcpScopeReceipt\.cells\}[\s\S]*?\/>[\s\S]*?\{#if firstReview\}/u);
	assert.doesNotMatch(routeSource, /ondone=\{\(\) => \(webMcpScopeReceipt = null\)\}/u);
	assert.doesNotMatch(routeSource, /review-presenter-result|webmcp-tool-label/u);
	assert.match(activityStripSource, /route: 'work' \| 'review' \| 'next';[\s\S]*?Latest \$\{routeLabel\} agent activity/u);
	assert.match(routeSource, /\.review-priority-shell,\s*\.review-priority\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?width:\s*100%;\s*\}/u);
	assert.doesNotMatch(demoCss, /\.demo-card-facts\s*\{[^}]*grid-template-columns:\s*repeat\(3,/u);
	assert.match(routeSource, /registerPageTools\(document, \[\s*createCurrentReviewTool\(\(\) => currentReviewView\),\s*createSetReviewScopeTool\(setReviewScopeFromWebMcp\)\s*\], \{\s*onInvocationError: clearFailedReviewWebMcpReceipt,\s*onResult: recordReviewWebMcpResult\s*\}\)/u);
	assert.match(routeSource, /stopReviewWebMcp\?\.\(\);\s*stopReviewWebMcp = null;/u);
	assert.match(routeSource, /stopReviewWebMcp = null;\s*webMcpScopeReceipt = null;/u);
	assert.match(reviewFilterControlsSource, /id="review-filter-query"[\s\S]*?maxlength=\{REVIEW_SEARCH_MAX_LENGTH\}/u);
	assert.doesNotMatch(routeSource, /document\.modelContext|registerTool\(/u);
	assert.doesNotMatch(`${routeSource}\n${helperSource}\n${registrationSource}`, /\/api\/mcp-proxy|jsonrpc|tools\/call|unregisterTool/u);
	assert.doesNotMatch(helperSource, /\.\.\.(?:pack|item|review)|runPackAction|togglePackPinned|setSelectedWork/u);
});

test('Review copies the exact non-empty scoped queue', () => {
	assert.match(routeSource, /let reviewSummaryText = \$derived\(buildReviewSummaryText\(filteredVisible\)\);/u);
	assert.match(routeSource, /\{#if filteredVisible\.length > 0\}[\s\S]*?id="copy-review-summary"[\s\S]*?onclick=\{copyReviewSummary\}[\s\S]*?\{\/if\}/u);
	assert.doesNotMatch(routeSource, /visible\.length > 0 && !query\.trim\(\) && reviewSubFilter === 'all'/u);
});
