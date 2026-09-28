import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	emptyWebMcpHandoffSession,
	recordWebMcpDraftDecisionState,
	recordWebMcpHandoffStepState,
	webMcpHandoffTrailView
} from '../svelte-frontend/src/lib/webmcp-handoff-session.mjs';
import {
	approvePendingDraft,
	discardPendingDraft,
	pendingDraftFingerprint,
	revisePendingDraftChoice,
	upsertPendingDraft
} from '../svelte-frontend/src/lib/pending-next-action.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const reducerSource = readSource('svelte-frontend/src/lib/webmcp-handoff-session.mjs');
const storeSource = readSource('svelte-frontend/src/lib/webmcp-handoff-store.ts');
const railSource = readSource('svelte-frontend/src/lib/WebMcpHandoffRail.svelte');
const stripSource = readSource('svelte-frontend/src/lib/WebMcpActivityStrip.svelte');
const layoutSource = readSource('svelte-frontend/src/routes/+layout.svelte');
const workSource = readSource('svelte-frontend/src/routes/work/+page.svelte');
const reviewSource = readSource('svelte-frontend/src/routes/review/+page.svelte');
const nextSource = readSource('svelte-frontend/src/routes/next/+page.svelte');
const guideSource = readSource('svelte-frontend/src/routes/webmcp-challenge/+page.svelte');

const steps = {
	work: {
		id: 'work-scope',
		title: 'Work narrowed',
		summary: '4 matching of 8',
		status: 'complete',
		outcome: 'scope-verified'
	},
	review: {
		id: 'review-scope',
		title: 'Review verified',
		summary: '2 shown of 5',
		status: 'complete',
		outcome: 'scope-verified'
	},
	next: {
		id: 'next-proposal',
		title: 'Next prepared',
		summary: 'Unsaved · Confirm storage bin delivery',
		status: 'complete',
		outcome: 'proposal-prepared'
	},
	decision: {
		id: 'human-decision',
		title: 'Human decision',
		summary: 'Pending approval',
		status: 'pending',
		outcome: 'proposal-pending'
	}
};

test('handoff session keeps one canonical clone-safe step per successful page action', () => {
	let session = emptyWebMcpHandoffSession();
	assert.deepEqual(session, { steps: [] });
	session = recordWebMcpHandoffStepState(session, steps.review);
	session = recordWebMcpHandoffStepState(session, steps.work);
	session = recordWebMcpHandoffStepState(session, steps.next);
	assert.deepEqual(session.steps.map(({ id }) => id), ['work-scope', 'review-scope', 'next-proposal']);
	assert.deepEqual(Object.keys(session.steps[0]), ['id', 'title', 'summary', 'status', 'outcome']);
	assert.deepEqual(Object.keys(session), ['steps']);

	const replaced = recordWebMcpHandoffStepState(session, {
		...steps.work,
		summary: '3 matching of 8'
	});
	assert.equal(replaced.steps.length, 3);
	assert.equal(replaced.steps[0].summary, '3 matching of 8');
	replaced.steps[0].summary = 'mutated';
	assert.equal(session.steps[0].summary, '4 matching of 8');
});

test('handoff trail is branch-aware and never completes a pending human decision', () => {
	let session = emptyWebMcpHandoffSession();
	session = recordWebMcpHandoffStepState(session, steps.work);
	session = recordWebMcpHandoffStepState(session, steps.next);
	session = recordWebMcpHandoffStepState(session, steps.decision);
	assert.deepEqual(webMcpHandoffTrailView(session), {
		steps: [steps.work, steps.next, steps.decision],
		completedCount: 2,
		pendingCount: 1,
		currentStep: steps.decision,
		outcomeSummary: 'Proposal pending'
	});

	session = recordWebMcpHandoffStepState(session, {
		id: 'draft-batch',
		title: 'Draft work staged',
		summary: '3 Drafts · 8 → 11',
		status: 'complete',
		outcome: 'drafts-created',
		count: 3
	});
	assert.deepEqual(session.steps.map(({ id }) => id), ['work-scope', 'next-proposal', 'draft-batch', 'human-decision']);
	assert.equal(webMcpHandoffTrailView(session).outcomeSummary, '3 Drafts created · none started · Proposal pending');

	session = recordWebMcpHandoffStepState(session, {
		...steps.decision,
		summary: 'Approved and saved by person',
		status: 'complete',
		outcome: 'proposal-approved'
	});
	assert.equal(webMcpHandoffTrailView(session).outcomeSummary, '3 Drafts created · none started · Proposal approved');
	assert.equal(webMcpHandoffTrailView(session).pendingCount, 0);
	session = recordWebMcpHandoffStepState(session, {
		...steps.decision,
		summary: 'Discarded by person',
		status: 'complete',
		outcome: 'proposal-discarded'
	});
	assert.equal(webMcpHandoffTrailView(session).outcomeSummary, '3 Drafts created · none started · Proposal discarded');
});

test('human edits preserve durable WebMCP lineage through approve and discard without attributing human drafts', () => {
	const projectPack = (pack) => ({
		title: pack.title,
		workflow: pack.status,
		blocker: pack.blocker || null,
		next: pack.next || ''
	});
	const preparedState = () => {
		const state = {
			packs: [{ id: 'next-current', title: 'Prepare inventory', status: 'active', blocker: 'Waiting', next: 'Review' }],
			pendingNextActionDrafts: []
		};
		const draft = {
			workId: 'next-current',
			choice: 'Focus',
			mode: 'preset',
			evidenceNote: 'Prepare inventory · Blocker: Waiting',
			evidence: [{ workId: 'next-current', field: 'blocker', expectedValue: 'Waiting' }],
			originFingerprint: '',
			source: 'webmcp'
		};
		draft.originFingerprint = pendingDraftFingerprint(state, draft, projectPack);
		upsertPendingDraft(state, draft);
		return state;
	};
	const pendingSession = () => recordWebMcpHandoffStepState(
		recordWebMcpHandoffStepState(emptyWebMcpHandoffSession(), steps.next),
		steps.decision
	);
	const approveState = preparedState();
	const approveOriginal = structuredClone(approveState.pendingNextActionDrafts[0]);
	const approveRevision = revisePendingDraftChoice(
		approveState,
		{ workId: 'next-current', choice: 'Start', mode: 'preset' },
		projectPack
	);
	assert.equal(approveRevision.source, 'webmcp');
	assert.deepEqual(approveRevision.evidence, approveOriginal.evidence);
	assert.equal(approveRevision.originFingerprint, approveOriginal.originFingerprint);
	const approved = approvePendingDraft(approveState, 'next-current', {
		projectPack,
		nextPath: (pack, choice) => ({ ...pack, next: choice })
	});
	assert.equal(approved.pack.next, 'Start');
	assert.equal(webMcpHandoffTrailView(recordWebMcpDraftDecisionState(pendingSession(), approved.draft, 'proposal-approved')).outcomeSummary, 'Proposal approved');

	const discardState = preparedState();
	const discardRevision = revisePendingDraftChoice(
		discardState,
		{ workId: 'next-current', choice: 'Open', mode: 'preset' },
		projectPack
	);
	const discarded = structuredClone(discardRevision);
	discardPendingDraft(discardState, 'next-current');
	assert.deepEqual(discardState.pendingNextActionDrafts, []);
	assert.equal(webMcpHandoffTrailView(recordWebMcpDraftDecisionState(pendingSession(), discarded, 'proposal-discarded')).outcomeSummary, 'Proposal discarded');

	const staleState = preparedState();
	const staleFingerprint = staleState.pendingNextActionDrafts[0].originFingerprint;
	staleState.packs[0].blocker = 'Changed after preparation';
	const staleRevision = revisePendingDraftChoice(
		staleState,
		{ workId: 'next-current', choice: 'Start', mode: 'preset' },
		projectPack
	);
	assert.equal(staleRevision.originFingerprint, staleFingerprint);
	assert.throws(() => approvePendingDraft(staleState, 'next-current', {
		projectPack,
		nextPath: (pack, choice) => ({ ...pack, next: choice })
	}), /Draft is stale/u);

	const humanState = {
		packs: [{ id: 'next-current', title: 'Prepare inventory', status: 'active', blocker: '', next: 'Review' }],
		pendingNextActionDrafts: []
	};
	const humanRevision = revisePendingDraftChoice(
		humanState,
		{ workId: 'next-current', choice: 'Start', mode: 'preset' },
		projectPack
	);
	assert.equal(humanRevision.source, 'human');
	assert.deepEqual(humanRevision.evidence, []);
	const humanApproved = approvePendingDraft(humanState, 'next-current', {
		projectPack,
		nextPath: (pack, choice) => ({ ...pack, next: choice })
	});
	assert.deepEqual(recordWebMcpDraftDecisionState(emptyWebMcpHandoffSession(), humanApproved.draft, 'proposal-approved'), emptyWebMcpHandoffSession());
	const humanDiscardState = {
		packs: [{ id: 'next-current', title: 'Prepare inventory', status: 'active', blocker: '', next: 'Review' }],
		pendingNextActionDrafts: []
	};
	const humanDiscarded = revisePendingDraftChoice(
		humanDiscardState,
		{ workId: 'next-current', choice: 'Open', mode: 'preset' },
		projectPack
	);
	discardPendingDraft(humanDiscardState, 'next-current');
	assert.deepEqual(recordWebMcpDraftDecisionState(emptyWebMcpHandoffSession(), humanDiscarded, 'proposal-discarded'), emptyWebMcpHandoffSession());
	assert.throws(() => recordWebMcpDraftDecisionState(emptyWebMcpHandoffSession(), { source: 'agent' }, 'proposal-approved'), /source is not recognized/u);
	assert.throws(() => recordWebMcpDraftDecisionState(emptyWebMcpHandoffSession(), humanDiscarded, 'proposal-skipped'), /outcome is not recognized/u);
});

test('handoff session rejects extra authority, duplicate ids, malformed order, and open input', () => {
	assert.throws(
		() => recordWebMcpHandoffStepState({ steps: [], agentSaved: 1 }, steps.work),
		/session contains an unsupported field/u
	);
	assert.throws(
		() => recordWebMcpHandoffStepState({ steps: [steps.work, steps.work] }, steps.next),
		/step ids must be unique/u
	);
	assert.throws(
		() => recordWebMcpHandoffStepState({ steps: [steps.review, steps.work] }, steps.next),
		/canonical order/u
	);
	assert.throws(
		() => recordWebMcpHandoffStepState(emptyWebMcpHandoffSession(), { ...steps.work, extra: true }),
		/unsupported field/u
	);
	assert.throws(
		() => recordWebMcpHandoffStepState(emptyWebMcpHandoffSession(), { ...steps.work, summary: 'x'.repeat(401) }),
		/1 to 400 characters/u
	);
	assert.throws(
		() => recordWebMcpHandoffStepState(emptyWebMcpHandoffSession(), { ...steps.decision, status: 'complete' }),
		/status and outcome do not match/u
	);
});

test('one shared rail records only successful scoped receipts and reset clears the run', () => {
	assert.match(reducerSource, /'work-scope'[\s\S]*?'review-scope'[\s\S]*?'next-proposal'[\s\S]*?'draft-batch'[\s\S]*?'human-decision'/u);
	assert.doesNotMatch(`${reducerSource}\n${storeSource}`, /localStorage|sessionStorage|fetch\(|apiFetch|goto\(|runPackAction|saveBrowserState/u);
	assert.equal((layoutSource.match(/<WebMcpHandoffRail \/>/gu) ?? []).length, 1);
	assert.match(railSource, /Verified action trail[\s\S]*?Observe → Narrow → Prepare → Decide[\s\S]*?\(human-owned\)[\s\S]*?trail\.completedCount[\s\S]*?trail\.pendingCount[\s\S]*?Ready for one bounded run[\s\S]*?currentStep\?\.summary/u);
	assert.match(railSource, /class:has-steps=\{hasSteps\}[\s\S]*?\{#if hasSteps\}[\s\S]*?class="webmcp-handoff-steps"[\s\S]*?Recorded outcomes[\s\S]*?trail\.outcomeSummary/u);
	assert.match(railSource, /class="webmcp-handoff-progress" role="status" aria-live="polite" aria-atomic="true">\{progressAnnouncement\}/u);
	assert.doesNotMatch(railSource.match(/<section[\s\S]*?>/u)?.[0] ?? '', /aria-live/u);
	assert.doesNotMatch(railSource, /webmcp-handoff-toggle|webmcp-handoff-details|aria-expanded|aria-controls|matchMedia|\$effect|onMount/u);
	assert.match(railSource, /\{#each steps as step[\s\S]*?class:is-complete=\{step\.status === 'complete'\}[\s\S]*?class:is-pending=\{step\.status === 'pending'\}[\s\S]*?STEP_LABELS\[step\.id\][\s\S]*?Your decision[\s\S]*?step\.summary/u);
	assert.match(railSource, /Recorded outcomes[\s\S]*?trail\.outcomeSummary[\s\S]*?Human-only Start and final Save/u);
	assert.doesNotMatch(railSource, /of 5|0 saved · 0 started|Workspace unchanged|Agent authority|STAGES/u);
	assert.doesNotMatch(railSource, /step\?\.evidence|step\.evidence|min-height: 108px|One agent run · visible across pages/u);
	assert.match(stripSource, /Step 1 · Narrow Work[\s\S]*?Step 2 · Verify Review[\s\S]*?Step 3 · Prepare Next[\s\S]*?Step 4 · Stage Drafts/u);
	assert.match(stripSource, /Page view only · Workspace unchanged[\s\S]*?Unsaved proposal · Human approval required[\s\S]*?Draft only · Human Start required/u);
	assert.match(stripSource, /font-size: 18px;[\s\S]*?font-size: 14px;/u);
	assert.match(reducerSource, /STEP_FIELDS = new Set\(\['id', 'title', 'summary', 'status', 'outcome', 'count'\]\)/u);
	assert.match(reducerSource, /SESSION_FIELDS = new Set\(\['steps'\]\)/u);
	assert.doesNotMatch(`${reducerSource}\n${storeSource}`, /agentSaved|agentStarted/u);
	assert.doesNotMatch(reducerSource, /candidate\.(?:evidence|authority)|(?:evidence|authority): normalizedText/u);
	assert.doesNotMatch(storeSource, /(?:evidence|authority): string;/u);
	assert.match(workSource, /id: 'work-scope'[\s\S]*?status: 'complete'[\s\S]*?outcome: 'scope-verified'/u);
	assert.match(workSource, /id: 'draft-batch'[\s\S]*?status: 'complete'[\s\S]*?outcome: 'drafts-created'[\s\S]*?count: outcome\.created\.length/u);
	assert.match(reviewSource, /id: 'review-scope'[\s\S]*?status: 'complete'[\s\S]*?outcome: 'scope-verified'/u);
	assert.match(nextSource, /id: 'next-proposal'[\s\S]*?status: 'complete'[\s\S]*?outcome: 'proposal-prepared'[\s\S]*?id: 'human-decision'[\s\S]*?status: 'pending'[\s\S]*?outcome: 'proposal-pending'/u);
	assert.match(reducerSource, /export function recordWebMcpDraftDecisionState[\s\S]*?draft\.source === 'human'\) return current;[\s\S]*?recordWebMcpHandoffStepState\(current,[\s\S]*?outcome === 'proposal-approved'/u);
	assert.match(storeSource, /export function recordWebMcpDraftDecision[\s\S]*?recordWebMcpDraftDecisionState\(session, draft, outcome\)/u);
	assert.match(nextSource, /recordWebMcpDraftDecision\(consumedDraft, 'proposal-discarded'\)[\s\S]*?recordWebMcpDraftDecision\(consumedDraft, 'proposal-approved'\)/u);
	assert.match(guideSource, /await resetDemoSampleState\(\);[\s\S]*?resetWebMcpHandoffSession\(\);[\s\S]*?Live sample reset/u);
});
