import assert from 'node:assert/strict';
import test from 'node:test';
import { approvePendingDraft, discardPendingDraft, pendingDraftCountFor, pendingDraftFingerprint, pendingDraftHasDuplicateEvidence, pendingDraftReferencesAvailable, revisePendingDraftChoice, upsertPendingDraft } from '../svelte-frontend/src/lib/pending-next-action.mjs';

test('legacy agent drafts retain evidence and stale protection through human revision', () => {
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

	const discardState = preparedState();
	const discardRevision = revisePendingDraftChoice(
		discardState,
		{ workId: 'next-current', choice: 'Open', mode: 'preset' },
		projectPack
	);
	const discarded = structuredClone(discardRevision);
	discardPendingDraft(discardState, 'next-current');
	assert.deepEqual(discardState.pendingNextActionDrafts, []);

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
});

test('a removed no-blocker reference stays unavailable even when its old fingerprint still matches', () => {
	const project = pack => ({ title: pack.title, workflow: pack.status, blocker: pack.blocker || null, next: pack.next || '' });
	const state = { packs: [{ id: 'target', title: 'Target', status: 'active', blocker: '', next: 'Review' }, { id: 'fact', title: 'Evidence', status: 'active', blocker: '', next: 'Review' }], pendingNextActionDrafts: [] };
	const draft = { workId: 'target', choice: 'Focus', mode: 'preset', evidenceNote: 'Earlier evidence', evidence: [{ workId: 'fact', field: 'blocker', expectedValue: null }], originFingerprint: '', source: 'webmcp' };
	draft.originFingerprint = pendingDraftFingerprint(state, draft, project);
	upsertPendingDraft(state, draft);
	assert.equal(pendingDraftReferencesAvailable(state, draft), true);
	state.packs = state.packs.filter(pack => pack.id !== 'fact');
	assert.equal(pendingDraftFingerprint(state, draft, project), draft.originFingerprint, 'legacy fingerprint encodes both values as null');
	assert.equal(pendingDraftReferencesAvailable(state, draft), false);
	const before = structuredClone(state);
	assert.throws(() => approvePendingDraft(state, 'target', { projectPack: project, nextPath: (pack, choice) => ({ ...pack, next: choice }) }), /refers to missing work/u);
	assert.deepEqual(state, before);
});

test('a retained draft cannot be approved when its target or a referenced work item is missing', () => {
	const project = pack => ({ title: pack.title, workflow: pack.status, blocker: pack.blocker || null, next: pack.next || '' });
	for (const missing of ['target', 'evidence']) {
		const state = { packs: [{ id: 'target', title: 'Target', status: 'active', blocker: '', next: 'Review' }], pendingNextActionDrafts: [] };
		const draft = { workId: missing === 'target' ? 'missing' : 'target', choice: 'Focus', mode: 'preset', evidenceNote: 'Historical evidence',
			evidence: missing === 'evidence' ? [{ workId: 'missing', field: 'blocker', expectedValue: null }] : [], originFingerprint: '', source: 'webmcp' };
		// Even a matching fingerprint of a missing reference must never approve it.
		draft.originFingerprint = pendingDraftFingerprint(state, draft, project);
		upsertPendingDraft(state, draft);
		const before = structuredClone(state);
		assert.throws(() => approvePendingDraft(state, draft.workId, { projectPack: project, nextPath: (pack, choice) => ({ ...pack, next: choice }) }), /refers to missing work/u);
		assert.deepEqual(state, before);
		discardPendingDraft(state, draft.workId);
		assert.deepEqual(state.pendingNextActionDrafts, []);
		assert.deepEqual(state.packs, before.packs);
	}
});

test('duplicate saved drafts cannot be approved even when their fingerprints match', () => {
	const project = pack => ({ title: pack.title, workflow: pack.status, blocker: pack.blocker || null, next: pack.next || '' });
	const state = { packs: [{ id: 'target', title: 'Target', status: 'active', blocker: '', next: 'Review' }], pendingNextActionDrafts: [] };
	const draft = { workId: 'target', choice: 'Focus', mode: 'preset', evidenceNote: 'First', evidence: [], originFingerprint: '', source: 'webmcp' };
	draft.originFingerprint = pendingDraftFingerprint(state, draft, project);
	state.pendingNextActionDrafts.push(draft, { ...structuredClone(draft), choice: 'Start', evidenceNote: 'Second' });
	const before = structuredClone(state);
	assert.equal(pendingDraftCountFor(state, 'target'), 2);
	assert.throws(() => approvePendingDraft(state, 'target', { projectPack: project, nextPath: (pack, choice) => ({ ...pack, next: choice }) }), /Multiple drafts/u);
	assert.deepEqual(state, before);
	discardPendingDraft(state, 'target');
	assert.deepEqual(state.pendingNextActionDrafts, []);
	assert.deepEqual(state.packs, before.packs);
});

test('repeated evidence pairs remain preserved and cannot be approved with a matching fingerprint', () => {
	const project = pack => ({ title: pack.title, workflow: pack.status, blocker: pack.blocker || null, next: pack.next || '' });
	const state = { packs: [{ id: 'target', title: 'Target', status: 'active', blocker: '', next: 'Review' }, { id: 'fact', title: 'Evidence', status: 'active', blocker: '', next: 'Review' }], pendingNextActionDrafts: [] };
	const draft = { workId: 'target', choice: 'Focus', mode: 'preset', evidenceNote: 'Recorded evidence', evidence: [{ workId: 'fact', field: 'blocker', expectedValue: null }, { workId: 'fact', field: 'blocker', expectedValue: 'Waiting' }], originFingerprint: '', source: 'webmcp' };
	draft.originFingerprint = pendingDraftFingerprint(state, draft, project);
	state.pendingNextActionDrafts.push(draft);
	const before = structuredClone(state);
	assert.equal(pendingDraftHasDuplicateEvidence(draft), true);
	assert.equal(pendingDraftHasDuplicateEvidence({ ...draft, evidence: [draft.evidence[0], { workId: 'fact', field: 'workflow', expectedValue: 'active' }] }), false);
	assert.throws(() => approvePendingDraft(state, 'target', { projectPack: project, nextPath: (pack, choice) => ({ ...pack, next: choice }) }), /repeats an evidence reference/u);
	assert.deepEqual(state, before);
});
