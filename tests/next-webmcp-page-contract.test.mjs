import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	CURRENT_NEXT_EDITOR_TOOL_NAME,
	NEXT_EDITOR_PREVIEW_ID,
	NEXT_PREPARATION_RECEIPT_ID,
	NEXT_PREPARATION_SUMMARY,
	PREPARE_NEXT_ACTION_TOOL_NAME,
	createNextDraftRevisionState,
	createCurrentNextEditorTool,
	createPrepareNextActionTool,
	evidenceMatchesReferences,
	nextDraftTerminalAvailable,
	nextEditorPageView,
	reviseNextDraft,
	runSettledNextDraftAction,
	verifiedNextEvidenceNote,
	verifyNextPreparationEvidence,
	shouldHydratePendingDraft
} from '../svelte-frontend/src/routes/next/next-webmcp.mjs';
import { approvePendingDraft, cloneMutatePersist, discardPendingDraft, hydrateSerializedState, pendingDraftFingerprint, pendingDraftNavigation, resetPersistedState, restorePendingDraft, revisePendingDraftChoice, upsertPendingDraft } from '../svelte-frontend/src/lib/pending-next-action.mjs';
import {
	emptyWebMcpHandoffSession,
	recordWebMcpDraftDecisionState,
	recordWebMcpHandoffStepState,
	webMcpHandoffTrailView
} from '../svelte-frontend/src/lib/webmcp-handoff-session.mjs';
import {
	DECISION_WORKSPACE_CONTEXT,
	DECISION_WORKSPACE_CONTEXT_REASON,
	decisionWorkspaceContextDecider,
	decisionWorkspaceContextPackId,
	decisionWorkspaceNextHref
} from '../svelte-frontend/src/lib/decision-workspace-navigation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/+page.svelte'), 'utf8');
const demoClientSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-client.ts'), 'utf8');
const demoWorkflowSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-workflow.ts'), 'utf8');
const layoutSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/+layout.svelte'), 'utf8');
const pendingStateSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/pending-next-action.mjs'), 'utf8');
const handoffSessionSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/webmcp-handoff-session.mjs'), 'utf8');

test('terminal work cannot enter or complete the Next approval path', () => {
	assert.match(demoWorkflowSource, /export function canSetNextAction\(pack: DemoPack\): boolean \{\s*return pack\.status !== 'done' && !pack\.archived;\s*\}/u);
	assert.match(routeSource, /let packs = \$derived\([\s\S]*?\.filter\(canSetNextAction\)/u);
	assert.match(demoClientSource, /function requireNextActionTarget\(state: DemoState, workId: string\): DemoPack \{[\s\S]*?if \(!canSetNextAction\(pack\)\)[\s\S]*?Completed or archived work cannot have a next-action draft\./u);
	assert.equal(demoClientSource.match(/requireNextActionTarget\(state, (?:draft\.)?workId\);/gu)?.length, 3);
	assert.match(demoClientSource, /Object\.assign\(pack, packActionEffect\(pack, action\)\);\s*if \(action === 'done'\) discardPendingDraft\(draft, pack\.id\);/u);
	assert.match(demoClientSource, /if \(statusBefore !== 'done' && pack\.status === 'done'\) \{[\s\S]*?discardPendingDraft\(draft, pack\.id\);/u);
});
const handoffStoreSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/webmcp-handoff-store.ts'), 'utf8');
const reviewerTests = fs.readFileSync(path.join(repoRoot, 'docs/submission/webmcp/reviewer-tests.md'), 'utf8');
const helperSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/next-webmcp.mjs'), 'utf8');
const registrationSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/webmcp.mjs'), 'utf8');
const activityStripSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/WebMcpActivityStrip.svelte'), 'utf8');
const decisionNavigationSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/decision-workspace-navigation.mjs'), 'utf8');
const candidatePickerSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/NextCandidatePicker.svelte'), 'utf8');
const workContextSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/NextWorkContext.svelte'), 'utf8');
const workflowSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-workflow.ts'), 'utf8');
const workRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/+page.svelte'), 'utf8');
const reviewRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/+page.svelte'), 'utf8');

const presetChoices = ['Review', 'Open', 'Focus', 'Set Blocker: None', 'Start', 'Finish with proof'];
const currentEvidenceReference = Object.freeze({
	workId: 'next-current',
	field: 'blocker',
	expectedValue: 'Waiting for labels'
});
const currentVerifiedEvidence = Object.freeze({
	work: { id: 'next-current', title: 'Prepare the garage inventory' },
	field: 'blocker',
	label: 'Blocker',
	value: 'Waiting for labels'
});

function preparationReceipt(choice, evidence = [currentVerifiedEvidence]) {
	return {
		summary: NEXT_PREPARATION_SUMMARY,
		work: { id: 'next-current', title: 'Prepare the garage inventory' },
		evidenceNote: verifiedNextEvidenceNote(evidence),
		evidence,
		preparedAction: choice,
		workspaceChanged: false,
		requiresHumanSave: true
	};
}

function verifiedFromReferences(references) {
	return references.map((reference) => ({
		work: { id: reference.workId, title: reference.workId === 'next-current' ? 'Prepare the garage inventory' : 'Related work' },
		field: reference.field,
		label: reference.field === 'workflow' ? 'Workflow' : 'Blocker',
		value: reference.expectedValue
	}));
}

function editor(overrides = {}) {
	return nextEditorPageView({
		work: { id: 'next-current', title: 'Prepare the garage inventory' },
		decisionContext: null,
		presetChoices,
		editor: { mode: 'preset', choice: 'Open' },
		preview: { blocker: null, nextAction: 'Open' },
		preparationReceipt: null,
		canSave: true,
		busy: false,
		staleReason: null,
		privateState: 'not exposed',
		...overrides
	});
}

test('Next projects only its exact current editor, choices, and visible preview', () => {
	const view = editor({ preview: { blocker: 'Waiting for labels', nextAction: 'Unblock' } });
	assert.deepEqual(view, {
		work: { id: 'next-current', title: 'Prepare the garage inventory' },
		decisionContext: null,
		presetChoices,
		editor: { mode: 'preset', choice: 'Open' },
		preview: { blocker: 'Waiting for labels', nextAction: 'Unblock' },
		preparationReceipt: null,
		canSave: true,
		busy: false,
		staleReason: null
	});
	assert.doesNotMatch(JSON.stringify(view), /not exposed/u);
	assert.notEqual(view.presetChoices, presetChoices);
	const prepared = editor({
		editor: { mode: 'custom', choice: 'Clear the garage floor' },
		preview: { blocker: 'Waiting on storage bins', nextAction: 'Clear the garage floor' },
		preparationReceipt: preparationReceipt('Clear the garage floor')
	});
	assert.equal(prepared.preview.nextAction, 'Clear the garage floor');
	assert.equal(prepared.preparationReceipt.workspaceChanged, false);
	assert.equal(prepared.preparationReceipt.requiresHumanSave, true);
	const decisionContext = {
		mode: DECISION_WORKSPACE_CONTEXT,
		reason: DECISION_WORKSPACE_CONTEXT_REASON,
		decider: 'Household',
		privatePurpose: 'not exposed'
	};
	const recommended = editor({ decisionContext });
	assert.deepEqual(recommended.decisionContext, {
		mode: 'decision-workspace',
		reason: DECISION_WORKSPACE_CONTEXT_REASON,
		decider: 'Household'
	});
	assert.doesNotMatch(JSON.stringify(recommended), /privatePurpose/u);
	assert.notEqual(recommended.decisionContext, decisionContext);
	const exactCanonicalId = ` ${'x'.repeat(201)} `;
	assert.deepEqual(editor({ work: { id: exactCanonicalId, title: 'Exact identity' } })?.work, {
		id: exactCanonicalId,
		title: 'Exact identity'
	});

	for (const malformed of [
		null,
		{},
		{ ...view, work: { id: '', title: view.work.title } },
		{ ...view, presetChoices: [...presetChoices, presetChoices[0]] },
		{ ...view, editor: { mode: 'archive', choice: 'Open' } },
		{ ...view, preview: { blocker: null, nextAction: '' } },
		{ ...view, preparationReceipt: { summary: NEXT_PREPARATION_SUMMARY } },
		{ ...prepared, preparationReceipt: { ...prepared.preparationReceipt, preparedAction: 'Open' } },
		{ ...prepared, preparationReceipt: { ...prepared.preparationReceipt, workspaceChanged: true } },
		{ ...prepared, preparationReceipt: { ...prepared.preparationReceipt, requiresHumanSave: false } },
		{ ...prepared, preparationReceipt: { ...prepared.preparationReceipt, evidenceNote: 'Unverified prose.' } },
		{ ...prepared, preparationReceipt: { ...prepared.preparationReceipt, evidence: [] } },
		{ ...prepared, preparationReceipt: { ...prepared.preparationReceipt, evidence: [{ ...currentVerifiedEvidence, label: 'Status' }] } },
		{ ...view, decisionContext: {} },
		{ ...view, decisionContext: { ...recommended.decisionContext, mode: 'query-string' } },
		{ ...view, decisionContext: { ...recommended.decisionContext, reason: 'Unverified reason.' } },
		{ ...view, decisionContext: { ...recommended.decisionContext, decider: '' } },
		{ ...view, canSave: 'yes' },
		{ ...view, staleReason: 'stale', canSave: true },
		{ ...view, busy: 'no' }
	]) {
		assert.equal(nextEditorPageView(malformed), null);
	}
});

test('the current-editor descriptor is closed, read-only, untrusted-content aware, and live', async () => {
	let current = editor({
		decisionContext: {
			mode: DECISION_WORKSPACE_CONTEXT,
			reason: DECISION_WORKSPACE_CONTEXT_REASON,
			decider: 'Household'
		},
		editor: { mode: 'custom', choice: 'Clear the garage floor' },
		preview: { blocker: 'Waiting on storage bins', nextAction: 'Clear the garage floor' },
		preparationReceipt: preparationReceipt('Clear the garage floor')
	});
	let reads = 0;
	const tool = createCurrentNextEditorTool(() => {
		reads += 1;
		return current;
	});
	assert.equal(tool.name, CURRENT_NEXT_EDITOR_TOOL_NAME);
	assert.equal(tool.name, 'get_current_next_editor');
	assert.equal(tool.title, 'Get current Next editor');
	assert.match(tool.description, /exact current work item, visible Decision Workspace context when present, choices, unsaved editor, and preview/u);
	assert.match(tool.description, /does not change or save/u);
	assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
	assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: false, untrustedContentHint: true });

	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(() => tool.execute({ unexpected: true }, { signal: aborted.signal }), { name: 'AbortError' });
	assert.equal(reads, 0);
	await assert.rejects(() => tool.execute(), /Next current editor requires an empty object/u);
	for (const malformed of [null, [], { unexpected: true }]) {
		await assert.rejects(() => tool.execute(malformed), /Next current editor requires an empty object/u);
	}
	assert.equal(reads, 0);

	const canonical = structuredClone(current);
	const first = await tool.execute({}, { signal: new AbortController().signal });
	assert.equal(reads, 1);
	assert.deepEqual(first, current);
	assert.notEqual(first, current);
	assert.notEqual(first.work, current.work);
	assert.notEqual(first.decisionContext, current.decisionContext);
	assert.notEqual(first.presetChoices, current.presetChoices);
	assert.notEqual(first.editor, current.editor);
	assert.notEqual(first.preview, current.preview);
	assert.notEqual(first.preparationReceipt, current.preparationReceipt);
	assert.notEqual(first.preparationReceipt.work, current.preparationReceipt.work);
	first.work.title = 'Mutated work title';
	first.decisionContext.decider = 'Mutated decision owner';
	first.presetChoices.push('Result-only choice');
	first.editor.choice = 'Mutated editor choice';
	first.preview.nextAction = 'Mutated preview';
	first.preparationReceipt.evidenceNote = 'Mutated result-only note.';
	first.preparationReceipt.evidence[0].value = 'Mutated result-only evidence.';
	first.preparationReceipt.work.title = 'Mutated receipt work title';
	assert.deepEqual(current, canonical);

	current = null;
	assert.equal(await tool.execute({}), null);
	assert.equal(reads, 2);
	assert.throws(() => createCurrentNextEditorTool(null), /current editor getter/u);
});

test('Decision Workspace navigation requests only bounded current context for an exact encoded work id', () => {
	assert.equal(
		decisionWorkspaceNextHref('bike rack / choice'),
		'/next?pack=bike%20rack%20%2F%20choice&context=decision-workspace'
	);
	assert.equal(
		decisionWorkspaceContextPackId(new URLSearchParams('pack=bike%20rack%20%2F%20choice&context=decision-workspace')),
		'bike rack / choice'
	);
	for (const params of [
		new URLSearchParams('pack=bike-rack'),
		new URLSearchParams('pack=bike-rack&context=work'),
		new URLSearchParams('pack=bike-rack&from=decision-workspace'),
		new URLSearchParams('context=decision-workspace'),
		new URLSearchParams('pack=bike-rack&pack=other&context=decision-workspace'),
		new URLSearchParams('pack=bike-rack&context=decision-workspace&context=decision-workspace')
	]) {
		assert.equal(decisionWorkspaceContextPackId(params), '');
	}
	const longCanonicalId = 'x'.repeat(201);
	assert.equal(
		decisionWorkspaceContextPackId(new URLSearchParams(`pack=${longCanonicalId}&context=decision-workspace`)),
		longCanonicalId
	);
	assert.throws(() => decisionWorkspaceNextHref(''), /exact work item id/u);
	assert.throws(() => decisionWorkspaceNextHref('   '), /exact work item id/u);
	assert.equal(decisionWorkspaceContextDecider(' Household '), 'Household');
	assert.equal(decisionWorkspaceContextDecider('x'.repeat(201)), null);
	assert.equal(decisionWorkspaceContextDecider('Household\nowner'), null);
	assert.match(DECISION_WORKSPACE_CONTEXT_REASON, /remains an explicit open decision/u);
	assert.doesNotMatch(DECISION_WORKSPACE_CONTEXT_REASON, /surfaced|arrived|you left|came from/u);
	assert.match(routeSource, /pack\.id !== requestedPackId \|\| pack\.id !== decisionWorkspaceContextId \|\| !isOpenDecision\(pack\)/u);
	assert.doesNotMatch(decisionNavigationSource, /reason=|decider=|title=|purpose=|memory=|sourceCount=|localStorage|sessionStorage/u);
});

test('the prepare descriptor validates a stale-safe reversible page operation and receipt', async () => {
	const calls = [];
	const focusProof = { focused: true, focusVisible: true, inViewport: true, pulsed: true };
	const tool = createPrepareNextActionTool(async (input) => {
		calls.push(input);
		const evidence = verifiedFromReferences(input.evidence);
		return {
			changed: true,
			focus: { id: NEXT_PREPARATION_RECEIPT_ID, ...focusProof },
			next: editor({
				editor: { mode: 'custom', choice: input.choice },
				preview: { blocker: null, nextAction: input.choice },
				preparationReceipt: preparationReceipt(input.choice, evidence)
			})
		};
	});
	assert.equal(tool.name, PREPARE_NEXT_ACTION_TOOL_NAME);
	assert.equal(tool.name, 'prepare_next_action');
	assert.equal(tool.title, 'Prepare next-action preview');
	assert.match(tool.description, /durable browser-local pending next-action draft/u);
	assert.match(tool.description, /rejects stale or mismatched facts/u);
	assert.match(tool.description, /generates the visible evidence note from the verified values/u);
	assert.match(tool.description, /never saves or writes workspace data/u);
	assert.deepEqual(tool.inputSchema, {
		type: 'object',
		properties: {
			choice: { type: 'string', minLength: 1, maxLength: 200, description: 'Preset label or custom next action to preview.' },
			expectedMode: { type: 'string', enum: ['preset', 'custom'], description: 'Editor mode returned by the latest current-editor read.' },
			expectedChoice: { type: 'string', maxLength: 200, description: 'Editor choice returned by the latest current-editor read.' },
			evidence: {
				type: 'array',
				minItems: 1,
				maxItems: 3,
				description: 'Exact facts previously read from Work or Review. At least one fact must reference the current work item.',
				items: {
					type: 'object',
					properties: {
						workId: { type: 'string', minLength: 1, description: 'Exact work item id returned by Work or Review.' },
						field: { type: 'string', enum: ['workflow', 'blocker'], description: 'Exact projected field being cited.' },
					expectedValue: {
						anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }],
						description: 'Exact field value returned by Work or Review; null is the canonical absent blocker.'
					}
					},
					required: ['workId', 'field', 'expectedValue'],
					additionalProperties: false
				}
			}
		},
		required: ['choice', 'expectedMode', 'expectedChoice', 'evidence'],
		additionalProperties: false
	});
	assert.deepEqual(tool.annotations, {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
		untrustedContentHint: true
	});

	const result = await tool.execute({
		choice: '  Call the supplier  ',
		expectedMode: 'preset',
		expectedChoice: ' Open ',
		evidence: [currentEvidenceReference]
	}, { signal: new AbortController().signal });
	assert.deepEqual(calls, [{
		choice: 'Call the supplier',
		expectedMode: 'preset',
		expectedChoice: 'Open',
		evidence: [currentEvidenceReference]
	}]);
	assert.equal(result.changed, true);
	assert.deepEqual(result.focus, { id: 'next-preparation-receipt', ...focusProof });
	assert.equal(result.next.editor.mode, 'custom');
	assert.equal(result.next.editor.choice, 'Call the supplier');
	assert.equal(result.next.preparationReceipt.evidenceNote, 'Prepare the garage inventory — Blocker: Waiting for labels.');
	assert.deepEqual(result.next.preparationReceipt.evidence, [currentVerifiedEvidence]);
	const exactId = ` ${'x'.repeat(201)} `;
	const exactWork = { id: exactId, title: 'Exact identity' };
	const exactEvidence = { work: exactWork, field: 'workflow', label: 'Workflow', value: 'Active' };
	const exactIdTool = createPrepareNextActionTool(async (input) => ({
		changed: true,
		focus: { id: NEXT_PREPARATION_RECEIPT_ID, ...focusProof },
		next: editor({
			work: exactWork,
			editor: { mode: 'preset', choice: input.choice },
			preview: { blocker: null, nextAction: input.choice },
			preparationReceipt: {
				summary: NEXT_PREPARATION_SUMMARY,
				work: exactWork,
				evidenceNote: verifiedNextEvidenceNote([exactEvidence]),
				evidence: [exactEvidence],
				preparedAction: input.choice,
				workspaceChanged: false,
				requiresHumanSave: true
			}
		})
	}));
	const exactIdResult = await exactIdTool.execute({
		choice: 'Start',
		expectedMode: 'preset',
		expectedChoice: 'Open',
		evidence: [{ workId: exactId, field: 'workflow', expectedValue: 'Active' }]
	});
	assert.equal(exactIdResult.next.work.id, exactId);
	assert.equal(exactIdResult.next.preparationReceipt.work.id, exactId);
	assert.equal(exactIdResult.next.preparationReceipt.evidence[0].work.id, exactId);
	for (const field of Object.keys(focusProof)) {
		const unverified = createPrepareNextActionTool(async () => ({
			...structuredClone(result),
			focus: { ...result.focus, [field]: false }
		}));
		await assert.rejects(
			() => unverified.execute({
				choice: 'Call the supplier',
				expectedMode: 'custom',
				expectedChoice: 'Call the supplier',
				evidence: [currentEvidenceReference]
			}),
			/verifiable page receipt/u
		);
	}

	const validInput = (overrides = {}) => ({
		choice: 'Start',
		expectedMode: 'preset',
		expectedChoice: 'Open',
		evidence: [currentEvidenceReference],
		...overrides
	});
	for (const [input, message] of [
		[{}, /requires choice, expectedMode, expectedChoice, and evidence/u],
		[validInput({ choice: '' }), /choice cannot be empty/u],
		[validInput({ expectedMode: 'other' }), /expectedMode must be preset or custom/u],
		[{ ...validInput(), packId: 'other' }, /accepts only choice, expectedMode, expectedChoice, and evidence/u],
		[validInput({ choice: 42 }), /choice must be a string/u],
		[validInput({ choice: 'x'.repeat(201) }), /choice must be 200 characters or fewer/u],
		[validInput({ choice: 'Line\nbreak' }), /choice cannot contain control characters/u],
		[validInput({ evidence: [] }), /evidence must contain one to 3 unique exact work facts/u],
		[validInput({ evidence: Array.from({ length: 4 }, (_, index) => ({ workId: `work-${index}`, field: 'workflow', expectedValue: 'Ready' })) }), /evidence must contain one to 3 unique exact work facts/u],
		[validInput({ evidence: [currentEvidenceReference, currentEvidenceReference] }), /evidence must contain one to 3 unique exact work facts/u],
		[validInput({ evidence: [{ ...currentEvidenceReference, field: 'owner' }] }), /evidence must contain one to 3 unique exact work facts/u],
		[validInput({ evidence: [{ ...currentEvidenceReference, field: 'workflow', expectedValue: null }] }), /evidence must contain one to 3 unique exact work facts/u],
		[validInput({ evidence: [{ ...currentEvidenceReference, expectedValue: 'Line\nbreak' }] }), /evidence must contain one to 3 unique exact work facts/u],
		[validInput({ evidence: [{ ...currentEvidenceReference, extra: 'not allowed' }] }), /evidence must contain one to 3 unique exact work facts/u]
	]) {
		await assert.rejects(() => tool.execute(input), message);
	}
	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(
		() => tool.execute(validInput(), { signal: aborted.signal }),
		{ name: 'AbortError' }
	);
	assert.throws(() => createPrepareNextActionTool(null), /next-action preparer/u);

	const mismatched = createPrepareNextActionTool(async () => ({
		changed: true,
		focus: { id: NEXT_PREPARATION_RECEIPT_ID, ...focusProof },
		next: editor({ editor: { mode: 'preset', choice: 'Open' } })
	}));
	await assert.rejects(
		() => mismatched.execute(validInput()),
		/did not preserve the prepared choice/u
	);
	assert.throws(
		() => createPrepareNextActionTool(async () => result, { capture: null, restore: () => {} }),
		/preparation transactions require capture and restore functions/u
	);
});

test('Next verifies exact live workspace facts and generates the evidence note itself', () => {
	const workspace = [
		{
			id: 'next-current',
			title: 'Garage reset: sort shelves',
			workflow: 'Blocked',
			blocker: 'Waiting on storage bins'
		},
		{
			id: 'garage-reset-clear-floor',
			title: 'Garage reset: clear the floor',
			workflow: 'Done',
			blocker: null
		}
	];
	const references = [
		{ workId: 'next-current', field: 'blocker', expectedValue: 'Waiting on storage bins' },
		{ workId: 'garage-reset-clear-floor', field: 'workflow', expectedValue: 'Done' },
		{ workId: 'garage-reset-clear-floor', field: 'blocker', expectedValue: null }
	];
	const verified = verifyNextPreparationEvidence(references, workspace, 'next-current');
	assert.deepEqual(verified, [
		{
			work: { id: 'next-current', title: 'Garage reset: sort shelves' },
			field: 'blocker',
			label: 'Blocker',
			value: 'Waiting on storage bins'
		},
		{
			work: { id: 'garage-reset-clear-floor', title: 'Garage reset: clear the floor' },
			field: 'workflow',
			label: 'Workflow',
			value: 'Done'
		},
		{
			work: { id: 'garage-reset-clear-floor', title: 'Garage reset: clear the floor' },
			field: 'blocker',
			label: 'Blocker',
			value: null
		}
	]);
	assert.equal(evidenceMatchesReferences(verified, references), true);
	assert.equal(evidenceMatchesReferences(verified, references.slice(0, 1)), false);
	assert.equal(evidenceMatchesReferences(verified, [references[1], references[0]]), false);
	assert.equal(evidenceMatchesReferences(verified, [{ ...references[0], field: 'workflow' }, references[1]]), false);
	assert.equal(evidenceMatchesReferences(verified, [{ ...references[0], expectedValue: 'Storage bins arrived' }, references[1]]), false);
	assert.equal(
		verifiedNextEvidenceNote(verified),
		'Garage reset: sort shelves — Blocker: Waiting on storage bins. Garage reset: clear the floor — Workflow: Done. Garage reset: clear the floor — Blocker: None.'
	);
	const exactId = ` ${'x'.repeat(201)} `;
	assert.deepEqual(
		verifyNextPreparationEvidence(
			[{ workId: exactId, field: 'workflow', expectedValue: 'Active' }],
			[{ id: exactId, title: 'Exact identity', workflow: 'Active', blocker: null }],
			exactId
		),
		[{ work: { id: exactId, title: 'Exact identity' }, field: 'workflow', label: 'Workflow', value: 'Active' }]
	);
	assert.throws(
		() => verifyNextPreparationEvidence([references[1]], workspace, 'next-current'),
		/evidence must include the current work item/u
	);
	assert.throws(
		() => verifyNextPreparationEvidence([{ ...references[0], expectedValue: 'Storage bins arrived' }], workspace, 'next-current'),
		/rejected stale blocker evidence for next-current/u
	);
	assert.throws(
		() => verifyNextPreparationEvidence([{ ...references[0], workId: 'missing-work' }], workspace, 'missing-work'),
		/could not verify work item missing-work/u
	);
	assert.throws(
		() => verifyNextPreparationEvidence(references, [...workspace, workspace[0]], 'next-current'),
		/duplicate workspace evidence/u
	);
	assert.throws(
		() => verifiedNextEvidenceNote([{ ...verified[0], value: 'Unverified', label: 'Status' }]),
		/requires one to three exact facts/u
	);
	assert.match(workflowSource, /export function evidenceFacts\(pack: DemoPack\): \{ workflow: string; blocker: string \| null \}/u);
	for (const source of [workRouteSource, reviewRouteSource, routeSource]) {
		assert.match(source, /\.\.\.evidenceFacts\([^)]+\)/u);
	}
	assert.doesNotMatch(routeSource, /density === 'grid' \? packStatusLabel\(pack\.status\) : workflowLabel\(pack\)/u);
	assert.doesNotMatch(helperSource, /trimmedPageText\(candidate\.expectedValue/u);
	assert.match(demoClientSource, /typeof fact\.expectedValue === 'string'[\s\S]*?fact\.expectedValue\.length <= 200[\s\S]*?fact\.field === 'blocker' && fact\.expectedValue === null/u);
});

test('a failed repeated preparation preserves the immediately preceding valid draft', async () => {
	const focus = {
		id: NEXT_PREPARATION_RECEIPT_ID,
		focused: true,
		focusVisible: true,
		inViewport: true,
		pulsed: true
	};
	let pageState = editor();
	let failureStage = '';
	let restores = 0;
	const preparedView = (choice, references) => editor({
		editor: { mode: 'custom', choice },
		preview: { blocker: null, nextAction: choice },
		preparationReceipt: preparationReceipt(choice, verifiedFromReferences(references))
	});
	const tool = createPrepareNextActionTool(async (input, invocation) => {
		if (failureStage === 'before-mutation') throw new Error('failed before mutation');
		invocation.markMutated();
		pageState = preparedView(input.choice, input.evidence);
		if (failureStage === 'after-mutation') throw new Error('failed after mutation');
		return {
			changed: true,
			focus: failureStage === 'receipt-validation' ? { ...focus, focused: false } : focus,
			next: pageState
		};
	}, {
		capture: () => structuredClone(pageState),
		restore: (snapshot) => {
			restores += 1;
			pageState = structuredClone(snapshot);
		}
	});
	const prepare = (choice, evidence = [currentEvidenceReference]) => tool.execute({
		choice,
		expectedMode: pageState.editor.mode,
		expectedChoice: pageState.editor.choice,
		evidence
	});

	await prepare('Draft A');
	const validDraftA = structuredClone(pageState);

	failureStage = 'before-mutation';
	await assert.rejects(() => prepare('Draft B'), /failed before mutation/u);
	assert.deepEqual(pageState, validDraftA);
	assert.equal(restores, 0, 'a failure before mutation must not rewrite the valid draft');

	failureStage = 'after-mutation';
	await assert.rejects(() => prepare('Draft B'), /failed after mutation/u);
	assert.deepEqual(pageState, validDraftA);
	assert.equal(restores, 1, 'a provisional mutation must restore its own pre-invocation snapshot');

	failureStage = 'receipt-validation';
	await assert.rejects(
		() => prepare('Draft C'),
		/did not return a verifiable page receipt/u
	);
	assert.deepEqual(pageState, validDraftA);
	assert.equal(restores, 2, 'post-mutation receipt validation must restore the same snapshot');
});

test('Next owns one projection and one unsaved setter without server or navigation authority', () => {
	assert.match(routeSource, /import \{ registerPageTools \} from '\$lib\/webmcp\.mjs';/u);
	assert.match(routeSource, /import \{[\s\S]*?createCurrentNextEditorTool,[\s\S]*?createPrepareNextActionTool,[\s\S]*?nextEditorPageView[\s\S]*?\} from '\.\/next-webmcp\.mjs';/u);
	assert.match(routeSource, /let currentNextEditor = \$derived\.by\(\(\) => \{[\s\S]*?return nextEditorPageView\(\{[\s\S]*?work: \{ id: pack\.id,[\s\S]*?presetChoices: NEXT_ACTION_CHOICES,[\s\S]*?editor:[\s\S]*?preview:[\s\S]*?preparationReceipt: preparationReceipt && pendingDraft\?\.source === 'webmcp' && preparationReceipt\.preparedAction === effectiveChoice[\s\S]*?\? preparationReceipt[\s\S]*?: null,[\s\S]*?canSave:[\s\S]*?busy/u);
	assert.match(routeSource, /function setNextEditorChoice\(nextChoice: string, mode: NextEditorMode,[\s\S]*?choice = nextChoice;[\s\S]*?showingCustom = mode === 'custom';[\s\S]*?customValue = nextChoice/u);
	assert.match(routeSource, /async function prepareNextActionFromWebMcp[\s\S]*?if \(routeBusy\)[\s\S]*?currentNextEditor[\s\S]*?verifyNextPreparationEvidence\([\s\S]*?\.\.\.evidenceFacts\(candidate\)[\s\S]*?verifiedNextEvidenceNote[\s\S]*?expectedMode[\s\S]*?expectedChoice[\s\S]*?stale[\s\S]*?evidenceNote[\s\S]*?workspaceChanged: false[\s\S]*?requiresHumanSave: true[\s\S]*?const focusReceipt = focusAndPulse\([\s\S]*?requireVisibleFocus: true[\s\S]*?focus: \{ id: NEXT_PREPARATION_RECEIPT_ID, \.\.\.focusReceipt \}[\s\S]*?next: currentNextEditor/u);
	assert.match(routeSource, /evidenceMatchesReferences,[\s\S]*?from '\.\/next-webmcp\.mjs';[\s\S]*?const receiptAlreadyDesired[\s\S]*?evidenceMatchesReferences\(preparationReceipt\.evidence, input\.evidence\)/u);
	assert.match(helperSource, /export function evidenceMatchesReferences\(evidence, references\) \{[\s\S]*?fact\.work\.id === references\[index\]\.workId[\s\S]*?fact\.field === references\[index\]\.field[\s\S]*?fact\.value === references\[index\]\.expectedValue/u);
	assert.doesNotMatch(routeSource, /function evidenceMatchesReceipt/u);
	assert.match(routeSource, /stopNextWebMcp = registerPageTools\(document, \[[\s\S]*?createCurrentNextEditorTool\(\(\) => currentNextEditor\),[\s\S]*?createPrepareNextActionTool\(prepareNextActionFromWebMcp, \{[\s\S]*?capture: captureNextPreparationSnapshot,[\s\S]*?restore: restoreNextPreparationSnapshot[\s\S]*?\}\)[\s\S]*?\], \{[\s\S]*?onResult: \(\{ toolName, result \}\)[\s\S]*?toolName !== PREPARE_NEXT_ACTION_TOOL_NAME[\s\S]*?id: 'next-proposal'[\s\S]*?summary: `Unsaved · \$\{outcome\.next\.preparationReceipt\.preparedAction\}`[\s\S]*?\}\);/u);
	assert.match(routeSource, /return \(\) => \{\s*stopNextWebMcp\?\.\(\);\s*stopNextWebMcp = null;\s*clearPreparation\(\);\s*\};/u);
	assert.doesNotMatch(routeSource, /webMcpReadReceipt|recordNextWebMcpResult|clearFailedNextWebMcpReceipt/u);
	const handler = routeSource.match(/async function prepareNextActionFromWebMcp[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.doesNotMatch(handler, /setPackNextAction|setSelectedWork|saveChoice|goto\(|fetch\(|runPackAction|localStorage|sessionStorage/u);
	assert.match(handler, /stale Next editor state[\s\S]*?invocation\.markMutated\(\);[\s\S]*?setNextEditorChoice/u);
	assert.match(routeSource, /function captureNextPreparationSnapshot[\s\S]*?choice,[\s\S]*?customValue,[\s\S]*?showingCustom,[\s\S]*?preparationReceipt:[\s\S]*?preparationPreviousEditor:[\s\S]*?savedNextReceipt/u);
	assert.match(routeSource, /function restoreNextPreparationSnapshot[\s\S]*?choice = snapshot\.choice;[\s\S]*?customValue = snapshot\.customValue;[\s\S]*?showingCustom = snapshot\.showingCustom;[\s\S]*?preparationReceipt = [\s\S]*?preparationPreviousEditor = [\s\S]*?savedNextReceipt = snapshot\.savedNextReceipt/u);
	assert.match(routeSource, /id=\{NEXT_EDITOR_PREVIEW_ID\}[^>]*data-next-preview/u);
	assert.match(routeSource, /import WebMcpActivityStrip from '\$lib\/WebMcpActivityStrip\.svelte';/u);
	assert.match(routeSource, /import NextCandidatePicker from '\.\/NextCandidatePicker\.svelte';[\s\S]*?<NextCandidatePicker \{packs\} currentPackId=\{pack\.id \|\| ''\} onedit=\{editPack\} \/>/u);
	assert.doesNotMatch(routeSource, /NEXT_CANDIDATE_RENDER_LIMIT|candidateRenderLimit|renderedOtherCandidates|otherCandidates|showMoreCandidates|focusCandidate|next-other-list|next-load-more/u);
	assert.match(candidatePickerSource, /const NEXT_CANDIDATE_RENDER_LIMIT = 100;[\s\S]*?packs\.filter\(isReview\)\.filter\(\(candidate\) => candidate\.id !== currentPackId\)[\s\S]*?candidates\.slice\(0, renderLimit\)/u);
	assert.match(candidatePickerSource, /async function focusCandidate[\s\S]*?await setSelectedWork\(candidate\.id\);[\s\S]*?goto\(`\/work\?focus=\$\{encodeURIComponent\(candidate\.id\)\}`\)/u);
	assert.match(candidatePickerSource, /async function showMoreCandidates[\s\S]*?const previousCount = renderedCandidates\.length;[\s\S]*?renderLimit = nextLimit;[\s\S]*?settleProgressiveReveal\(\{[\s\S]*?settled: tick\(\),[\s\S]*?listRoot\?\.querySelectorAll<HTMLElement>\('\[data-pack-id\]'\)\[previousCount\][\s\S]*?\.demo-row-actions button/u);
	assert.match(candidatePickerSource, /Choose another item \(\$\{candidates\.length\}\)[\s\S]*?Set next action for \$\{workTitle\(candidate\)\}[\s\S]*?Focus \$\{workTitle\(candidate\)\} in Work[\s\S]*?candidates\.length > NEXT_CANDIDATE_RENDER_LIMIT[\s\S]*?data-action="show-more-next-candidates"/u);
	assert.match(candidatePickerSource, /@media\(max-width:500px\)[\s\S]*?\.demo-row-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);width:100%\}[\s\S]*?\.next-load-more\{align-items:stretch;flex-direction:column\}/u);
	assert.doesNotMatch(candidatePickerSource, /setPackNextAction|savePendingNextActionDraft|registerPageTools|createPack|fetch\(/u);
	assert.match(routeSource, /Verified evidence[\s\S]*?Status[\s\S]*?Draft — waiting for your approval[\s\S]*?Save[\s\S]*?Not saved/u);
	const preparationCellSource = routeSource.match(/let preparationCells[\s\S]*?\] : \[\]\);/u)?.[0] ?? '';
	assert.doesNotMatch(preparationCellSource, /Work item|Prepared action|Browser agent changed/u);
	assert.doesNotMatch(routeSource, /agentNote/u);
	assert.match(helperSource, /The returned values, not agent prose, are the[\s\S]*?only source for the visible evidence note/u);
	assert.match(helperSource, /Browser agent prepared an unsaved draft\. No workspace data was saved\./u);
	assert.match(routeSource, /Proposed next action<\/span><strong>\{effectiveChoice \|\| 'Not set'\}/u);
	assert.doesNotMatch(routeSource, /<WornPage[^>]*status=\{workTitle\(pack\)\}/u);
	assert.match(routeSource, /import NextWorkContext from '\.\/NextWorkContext\.svelte';[\s\S]*?<WornPage sectionLabel=\{__NEBIUS_EDITION__ \? 'Task' : 'Step 3 of 3 · Prepare'\}[^>]*>[\s\S]*?<NextWorkContext workTitle=\{workTitle\(pack\)\} decisionContext=\{decisionWorkspaceContext\} \/>/u);
	assert.match(workContextSource, /workTitle: string;[\s\S]*?decisionContext: \{[\s\S]*?mode: 'decision-workspace';[\s\S]*?reason: string;[\s\S]*?decider: string \| null;[\s\S]*?\} \| null;[\s\S]*?let \{ workTitle, decisionContext \}: Props = \$props\(\);/u);
	assert.match(workContextSource, /<dl class="next-work-context" data-next-current-work>[\s\S]*?<dt>Current work<\/dt>[\s\S]*?<dd>\{workTitle\}<\/dd>[\s\S]*?data-next-decision-context[\s\S]*?data-next-decision-mode=\{decisionContext\.mode\}[\s\S]*?data-next-decision-reason>\{decisionContext\.reason\}[\s\S]*?data-next-decision-decider[\s\S]*?>\{decisionContext\.decider\}<\/dd>/u);
	assert.match(workContextSource, /\.next-work-context\s*\{[\s\S]*?background: var\(--worn-bg-secondary\);[\s\S]*?border: 1px solid var\(--worn-accent\);[\s\S]*?box-sizing: border-box;[\s\S]*?max-inline-size: 100%;[\s\S]*?min-inline-size: 0;[\s\S]*?padding: 12px 14px;/u);
	assert.match(workContextSource, /\.next-work-context dd\s*\{[\s\S]*?overflow-wrap: anywhere;/u);
	assert.doesNotMatch(routeSource, /<dl class="next-work-context"|\.next-work-context/u);
	assert.doesNotMatch(workContextSource, /\$state|\$bindable|\bon[a-z][A-Za-z]*\??:|registerPageTools|modelContext|fetch\(|localStorage|sessionStorage|goto\(|<slot|\{@render/u);
	assert.match(routeSource, /\{#if preparationReceipt && pendingDraft\?\.source === 'webmcp'\}[\s\S]*?<WebMcpActivityStrip[\s\S]*?id=\{NEXT_PREPARATION_RECEIPT_ID\}[\s\S]*?route="next"[\s\S]*?outcome="Draft prepared — waiting for your approval\."[\s\S]*?toolName=\{PREPARE_NEXT_ACTION_TOOL_NAME\}[\s\S]*?cells=\{preparationCells\}/u);
	assert.doesNotMatch(routeSource, /data-webmcp-receipt="next"|webmcp-tool-label/u);
	assert.match(activityStripSource, /Unsaved proposal · Human approval required[\s\S]*?webmcp-activity-outcome[\s\S]*?webmcp-activity-evidence[\s\S]*?webmcp-activity-authority[\s\S]*?WebMCP · \{toolName\}/u);
	assert.match(routeSource, /\.next-authority\s*\{\s*margin-block-start:\s*12px;/u);
	assert.match(routeSource, /\.next-action-editor\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;/u);
	assert.match(routeSource, /\.next-action-editor > \.demo-field\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?width:\s*100%;/u);
	assert.match(routeSource, /<div class="demo-inline-form next-action-editor">[\s\S]*?<div class="next-save-actions">[\s\S]*?<\/div>[\s\S]*?<\/div>[\s\S]*?\{#if workItemIssues\(pack\)\.length > 0\}[\s\S]*?<div class="next-item-warnings" data-next-item-warnings>[\s\S]*?<WornAlert tone="warning">\{v\.message\}<\/WornAlert>/u);
	assert.match(routeSource, /\.next-item-warnings\s*\{[\s\S]*?margin-block-start: 16px;[\s\S]*?max-inline-size: 100%;[\s\S]*?min-inline-size: 0;/u);
	assert.match(routeSource, /\{#if !demoLoaded\}[\s\S]*?<WornPage sectionLabel=\{__NEBIUS_EDITION__ \? 'Task' : 'Step 3 of 3 · Prepare'\} title=\{__NEBIUS_EDITION__ \? 'Next step' : 'Next actions'\} loading=\{!\$demoStateError\}>[\s\S]*?\{:else if notFound\}/u);
	assert.doesNotMatch(routeSource, /loadingSelected|No sample work available[\s\S]*?\{#if !demoLoaded\}/u);
	assert.match(routeSource, /function stageHumanNextEditorChoice[\s\S]*?setNextEditorChoice\(nextChoice\.slice\(0, NEXT_ACTION_MAX_LENGTH\), mode, false\);[\s\S]*?editorChoiceStaged = true;/u);
	assert.match(routeSource, /pressed=\{\(editorChoiceStaged \|\| Boolean\(pendingDraft\)\) && !showingCustom && effectiveChoice === act\}/u);
	assert.match(routeSource, /\{#if !pendingDraft\}[\s\S]*?data-next-prepare-draft[\s\S]*?2 · Prepare draft[\s\S]*?\{:else\}[\s\S]*?Discard draft[\s\S]*?Approve and save/u);
	assert.match(routeSource, /@media \(max-width: 500px\)[\s\S]*?\.next-action-editor\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/u);
	assert.match(workContextSource, /@media \(max-width: 500px\)[\s\S]*?\.next-work-context\s*\{\s*padding: 12px;/u);
	assert.match(routeSource, /@media \(max-width: 500px\)[\s\S]*?\.next-save-help\s*\{\s*flex: 0 0 auto;/u);
	assert.match(registrationSource, /const registrationController = new AbortController\(\);/u);
	assert.doesNotMatch(helperSource, /modelContext|registerTool|fetch\(|jsonrpc|setPackNextAction|update_pack/u);
});

test('Next approval emits one canonical success notification from the page receipt', () => {
	const mutation = demoClientSource.match(/export async function setPackNextAction\(workId: string\)[\s\S]*?\n\}\n\nfunction cloneState/u)?.[0] ?? '';
	const presentation = routeSource.match(/async function saveChoice\(\)[\s\S]*?\n\t\}\n\n<\/script>/u)?.[0] ?? '';
	assert.ok(mutation);
	assert.ok(presentation);
	assert.doesNotMatch(mutation, /displayToast\(/u);
	assert.equal(presentation.match(/displayToast\(/gu)?.length, 1);
	assert.match(presentation, /const summary = result\?\.receipt\?\.summary[\s\S]*?displayToast\(summary, 'success'\);/u);
});

test('pending next-action approvals use one durable state owner and fail closed when stale', () => {
	assert.match(demoClientSource, /export type PendingNextActionDraft = \{[\s\S]*?workId: string;[\s\S]*?evidence: Array<[\s\S]*?originFingerprint: string;[\s\S]*?source: 'human' \| 'webmcp';/u);
	assert.match(demoClientSource, /export async function savePendingNextActionDraft[\s\S]*?saveBrowserState[\s\S]*?upsertPendingDraft\(state, draft\);/u);
	assert.match(demoClientSource, /export async function revisePendingNextActionDraftChoice[\s\S]*?saveBrowserState[\s\S]*?revisePendingDraftChoice\(state, \{ workId, choice, mode \}, pendingPackProjection\);/u);
	assert.match(demoClientSource, /export async function discardPendingNextActionDraft[\s\S]*?saveBrowserState[\s\S]*?discardPendingDraft\(state, workId\);/u);
	assert.match(demoClientSource, /export async function setPackNextAction\(workId: string\)[\s\S]*?const written = await saveBrowserState\([\s\S]*?approvePendingDraft\(state, workId,[\s\S]*?nextPath: nextChoiceForwardPath/u);
	assert.doesNotMatch(demoClientSource, /approvePendingNextActionDraft/u);
	assert.match(pendingStateSource, /export function pendingDraftFingerprint[\s\S]*?export function approvePendingDraft[\s\S]*?const draft = \(state\.pendingNextActionDrafts \|\| \[\]\)\.find\(\(candidate\) => candidate\.workId === workId\) \|\| null;[\s\S]*?if \(!draft\) throw new Error\('Pending approval draft was not found\.'\);[\s\S]*?pendingDraftFingerprint\(state, draft, projectPack\)[\s\S]*?Object\.assign\(pack, nextPath\(pack, draft\.choice\)\);[\s\S]*?discardPendingDraft\(state, workId\);/u);
	assert.doesNotMatch(pendingStateSource, /export function pendingDraftFor|pendingDraftFor\(/u);
	assert.match(pendingStateSource, /export function revisePendingDraftChoice[\s\S]*?const current = [\s\S]*?evidenceNote: current \? current\.evidenceNote[\s\S]*?evidence: current \? structuredClone\(current\.evidence\) : \[\][\s\S]*?originFingerprint: current \? current\.originFingerprint[\s\S]*?source: current \? current\.source : 'human'[\s\S]*?if \(!current\) draft\.originFingerprint = pendingDraftFingerprint/u);
	assert.match(demoClientSource, /export async function resetDemoSampleState[\s\S]*?withStateStorageLock\(\(\) => resetPersistedState\([\s\S]*?remove: \(\) => localStorage\.removeItem\(STORAGE_KEY\),[\s\S]*?loadSeed: loadSeedState,[\s\S]*?install: \(state\) => replaceDemoState\(state, null\)/u);
	assert.match(routeSource, /pendingNextActionDraftFor\(\$demoState, visiblePackId\)[\s\S]*?pendingDraftFingerprint\(\$demoState!, pendingDraft\)/u);
	assert.match(routeSource, /invocation\.markMutated\(\);[\s\S]*?await savePendingNextActionDraft\(pending\);[\s\S]*?if \(!currentNextEditor\)/u);
	assert.match(routeSource, /pendingDraft && pendingDraftStale[\s\S]*?Draft is stale/u);
	assert.match(helperSource, /export function createNextDraftRevisionState\(\)[\s\S]*?return \{ pending: false \};[\s\S]*?export async function reviseNextDraft/u);
	assert.match(helperSource, /if \(revision\.pending\) return \{ status: 'busy', draft: null \};[\s\S]*?revision\.pending = true;[\s\S]*?const draft = await persist\(\);[\s\S]*?settle\(draft\);[\s\S]*?rollback\(snapshot\);[\s\S]*?reject\(error\);[\s\S]*?revision\.pending = false;/u);
	assert.match(helperSource, /export function nextDraftTerminalAvailable[\s\S]*?!revision\.pending && !busy && !stale[\s\S]*?draft\.choice === choice && draft\.mode === mode/u);
	assert.match(helperSource, /export async function runSettledNextDraftAction[\s\S]*?nextDraftTerminalAvailable[\s\S]*?action\(consumedDraft\)[\s\S]*?finish\?\.\(\)/u);
	assert.match(routeSource, /let terminalDraftAvailable = \$derived\(nextDraftTerminalAvailable\(draftRevision,[\s\S]*?draft: pendingDraft/u);
	assert.match(routeSource, /canSave: terminalDraftAvailable,[\s\S]*?The visible draft change is still being saved\.[\s\S]*?busy: routeBusy/u);
	assert.equal(routeSource.match(/disabled=\{!terminalDraftAvailable\}/gu)?.length, 1, 'Only approval requires an approvable settled draft');
	assert.match(routeSource, /let saveNextHelp = \$derived\.by\(\(\) => \{[\s\S]*?if \(!effectiveChoice\) return 'Type a custom next action\.';[\s\S]*?if \(!pendingDraft\) return `Prepare "\$\{effectiveChoice\}" as a browser-local draft for \$\{workTitle\(pack\)\}\. The workspace stays unchanged\.`;[\s\S]*?if \(pendingDraftStale\) return 'This draft is stale\. Refresh the evidence before approval\.';[\s\S]*?if \(draftRevision\.pending\) return 'Wait for the visible draft change to finish saving\.';[\s\S]*?if \(!pendingDraftMatchesEditor\) return 'The visible choice differs from the pending draft\. Update the draft before approval\.';/u);
	assert.match(routeSource, /next-authority[\s\S]*?savedNextReceipt \? 'none · completed'[\s\S]*?savedNextReceipt \? 'updated'[\s\S]*?saved and approved by the person/u);
	assert.match(routeSource, /function savedEditorBaseline\(target: DemoPack \| null\): EditorSnapshot[\s\S]*?defaultChoiceFor\(target\)[\s\S]*?NEXT_ACTION_CHOICES/u);
	assert.match(routeSource, /async function setHumanNextEditorChoice[\s\S]*?await reviseNextDraft\(draftRevision,[\s\S]*?capture: captureHumanRevisionSnapshot,[\s\S]*?const state = await revisePendingNextActionDraftChoice\(workId, pendingChoice, mode\);[\s\S]*?settle: \(revisedDraft\)[\s\S]*?preparationReceipt = preparationFromPending\(revisedDraft\);[\s\S]*?rollback: restoreHumanRevisionSnapshot,[\s\S]*?Your previous draft is still pending\./u);
	assert.doesNotMatch(routeSource, /void revisePendingNextActionDraftChoice|void setHumanNextEditorChoice/u);
	assert.match(routeSource, /function captureHumanRevisionSnapshot[\s\S]*?preparationReceipt:[\s\S]*?preparationPreviousEditor:[\s\S]*?savedNextReceipt[\s\S]*?function restoreHumanRevisionSnapshot[\s\S]*?choice = snapshot\.choice;[\s\S]*?preparationReceipt = clonePreparationReceipt\(snapshot\.preparationReceipt\);[\s\S]*?savedNextReceipt = snapshot\.savedNextReceipt/u);
	assert.match(routeSource, /shouldHydratePendingDraft\(\{ preparationInFlight: preparationInFlight \|\| draftRevision\.pending/u);
	assert.match(routeSource, /async function discardPreparation\(\)[\s\S]*?!pendingDraft \|\| routeBusy[\s\S]*?const consumedDraft = structuredClone\(pendingDraft\);[\s\S]*?await discardPendingNextActionDraft\(workId\);[\s\S]*?recordWebMcpDraftDecision\(consumedDraft, 'proposal-discarded'\)/u);
	assert.match(routeSource, /disabled=\{routeBusy\}[\s\S]*?pendingDraftStale \? 'Discard stale draft' : 'Discard draft'/u);
	assert.match(routeSource, /let visiblePackId = \$derived\(pack\?\.id \|\| ''\);[\s\S]*?pendingNextActionDraftFor\(\$demoState, visiblePackId\)/u);
	assert.match(routeSource, /\{#if preparationReceipt && pendingDraft\?\.source === 'webmcp'\}[\s\S]*?<WebMcpActivityStrip[\s\S]*?\{:else if pendingDraft\?\.source === 'human' && !__NEBIUS_EDITION__\}[\s\S]*?Draft prepared by you\. The Next action remains unsaved until you approve Save\./u);
	assert.match(routeSource, /preparationReceipt: preparationReceipt && pendingDraft\?\.source === 'webmcp' && preparationReceipt\.preparedAction === effectiveChoice[\s\S]*?\? preparationReceipt[\s\S]*?: null/u);
	assert.match(routeSource, /await savePendingNextActionDraft\(pending\);[\s\S]*?await tick\(\);[\s\S]*?NEXT_PREPARATION_RECEIPT_ID/u);
	assert.doesNotMatch(routeSource, /preparationToolName/u);
	assert.match(routeSource, /let preparationInFlight = \$state\(false\);[\s\S]*?let draftRevision = \$state\(createNextDraftRevisionState\(\)\)/u);
	assert.match(routeSource, /invocation\.markMutated\(\);[\s\S]*?preparationInFlight = true;[\s\S]*?await savePendingNextActionDraft\(pending\);[\s\S]*?preparationInFlight = false;/u);
	assert.match(routeSource, /preparationInFlight: boolean;/u);
	assert.match(routeSource, /preparationInFlight[\s\S]*?preparationInFlight = snapshot\.preparationInFlight;/u);
	assert.equal(routeSource.match(/await setPackNextAction\(/gu)?.length, 1);
	assert.match(routeSource, /async function saveChoice\(\)[\s\S]*?runSettledNextDraftAction\(draftRevision,[\s\S]*?const result = await setPackNextAction\(workId\);[\s\S]*?recordWebMcpDraftDecision\(consumedDraft, 'proposal-approved'\)/u);
	assert.match(handoffStoreSource, /export function recordWebMcpDraftDecision[\s\S]*?recordWebMcpDraftDecisionState\(session, draft, outcome\)/u);
	assert.match(handoffSessionSource, /export function recordWebMcpDraftDecisionState[\s\S]*?draft\.source === 'human'\) return current;[\s\S]*?recordWebMcpHandoffStepState\(current/u);
	assert.match(layoutSource, /pendingNextActionDrafts\(\$demoState\)[\s\S]*?pendingDraftNavigation[\s\S]*?pendingResumeHref[\s\S]*?Pending \{pendingNavigation\.count\}/u);
	assert.doesNotMatch(routeSource, /localStorage|sessionStorage/u);
	assert.doesNotMatch(reviewerTests, /reload discarded the proposal|reload removed 1\/1 draft/u);
});

test('discarding a draft restores focus to the matching saved editor mode', () => {
	const discardHandler = routeSource.match(/async function discardPreparation\(\)[\s\S]*?(?=\n\tfunction editPack)/u)?.[0] ?? '';
	assert.match(discardHandler, /if \(!pack\?\.id \|\| !pendingDraft \|\| routeBusy\) return;[\s\S]*?const consumedDraft = structuredClone\(pendingDraft\);/u);
	assert.match(discardHandler, /await discardPendingNextActionDraft\(workId\);/u);
	assert.match(discardHandler, /clearPreparation\(\);/u);
	assert.match(discardHandler, /recordWebMcpDraftDecision\(consumedDraft, 'proposal-discarded'\)/u);
	assert.doesNotMatch(discardHandler, /nextDraftTerminalAvailable|pendingDraftStale|runSettledNextDraftAction/u);
	assert.match(
		discardHandler,
		/if \(previous\) \{\s*setNextEditorChoice\(previous\.choice, previous\.mode, false\);\s*editorChoiceStaged = false;\s*await scheduleEditorFocus\(previous\.mode === 'custom' \? 'custom' : 'choices'\);\s*\}/u
	);
	assert.doesNotMatch(discardHandler, /scheduleEditorFocus\('choices'\)/u);
});

test('human and WebMCP next-action editors share one explicit choice-length boundary', () => {
	assert.match(helperSource, /export const NEXT_ACTION_MAX_LENGTH = 200;/u);
	assert.match(helperSource, /choice: \{ type: 'string', minLength: 1, maxLength: NEXT_ACTION_MAX_LENGTH,/u);
	assert.match(helperSource, /expectedChoice: \{ type: 'string', maxLength: NEXT_ACTION_MAX_LENGTH,/u);
	assert.match(helperSource, /if \(choice\.length > NEXT_ACTION_MAX_LENGTH\) throw new TypeError/u);
	assert.match(helperSource, /if \(expectedChoice\.length > NEXT_ACTION_MAX_LENGTH\) throw new TypeError/u);
	assert.match(routeSource, /<WornInput[\s\S]*?id="custom-next-input"[\s\S]*?maxlength=\{NEXT_ACTION_MAX_LENGTH\}[\s\S]*?value=\{choice\}[\s\S]*?disabled=\{routeBusy\}/u);
	assert.match(routeSource, /async function setHumanNextEditorChoice\(nextChoice: string, mode: NextEditorMode\): Promise<boolean> \{[\s\S]*?const boundedChoice = nextChoice\.slice\(0, NEXT_ACTION_MAX_LENGTH\);[\s\S]*?const pendingChoice = boundedChoice\.trim\(\);[\s\S]*?await reviseNextDraft\(draftRevision,[\s\S]*?revisePendingNextActionDraftChoice\(workId, pendingChoice, mode\)/u);
});

test('pending draft state operation atomically approves, rejects stale drafts, and discards by exact work id', () => {
	assert.throws(() => pendingDraftFingerprint({}, { workId: 'missing', choice: 'Open', mode: 'preset', evidenceNote: '', evidence: [], originFingerprint: '', source: 'human' }, () => ({})), /find/u);
	const project = (pack) => ({ title: pack.title, workflow: pack.status, blocker: pack.blocker || null, next: pack.next || '' });
	const state = { packs: [{ id: 'a', title: 'A', status: 'active', blocker: '', next: 'Open' }, { id: 'b', title: 'B', status: 'blocked', blocker: 'Waiting', next: 'Review' }], pendingNextActionDrafts: [] };
	const draft = { workId: 'a', choice: 'Start', mode: 'preset', evidenceNote: 'A', evidence: [{ workId: 'a', field: 'blocker', expectedValue: null }], originFingerprint: '', source: 'human' };
	assert.throws(() => approvePendingDraft(state, 'missing', { projectPack: project, nextPath: () => ({}) }), /Pending approval draft was not found/u);
	draft.originFingerprint = pendingDraftFingerprint(state, draft, project);
	state.pendingNextActionDrafts.push(structuredClone(draft));
	const beforePrepare = structuredClone(state.packs);
	const approved = approvePendingDraft(state, 'a', { projectPack: project, nextPath: (pack, choice) => ({ ...pack, next: choice }) });
	assert.equal(approved.pack.next, 'Start');
	assert.deepEqual(state.pendingNextActionDrafts, []);
	assert.deepEqual(state.packs[1], beforePrepare[1]);
	state.pendingNextActionDrafts.push(structuredClone(draft));
	state.packs[0].blocker = 'Waiting';
	const beforeStale = structuredClone(state);
	assert.throws(() => approvePendingDraft(state, 'a', { projectPack: project, nextPath: () => ({}) }), /Draft is stale/u);
	assert.deepEqual(state, beforeStale);
	state.pendingNextActionDrafts.push({ ...draft, workId: 'b' });
	discardPendingDraft(state, 'a');
	assert.deepEqual(state.pendingNextActionDrafts.map((item) => item.workId), ['b']);
});

test('pending draft transaction persists atomically and preserves exact hydration state', () => {
	const store = new Map(); let live = { packs: [{ id: 'a', title: 'A', status: 'active', blocker: '', next: 'Open' }], pendingNextActionDrafts: [] }; let writes = 0;
	const persist = (value) => { writes += 1; store.set('state', JSON.stringify(value)); };
	const install = (value) => { live = value; return value; };
	const draft = { workId: 'a', choice: 'Start', mode: 'preset', evidenceNote: 'A', evidence: [], originFingerprint: 'human', source: 'human' };
	cloneMutatePersist({ current: live, clone: structuredClone, mutate: (state) => upsertPendingDraft(state, draft), persist, install });
	assert.equal(writes, 1); assert.deepEqual(live.packs, [{ id: 'a', title: 'A', status: 'active', blocker: '', next: 'Open' }]);
	const hydrated = JSON.parse(store.get('state')); assert.deepEqual(hydrated.pendingNextActionDrafts, [draft]);
	const navigation = pendingDraftNavigation({ pendingNextActionDrafts: [draft, { ...draft, workId: 'b' }] }); assert.deepEqual(navigation, { count: 2, resumeHref: '/next?pack=a' });
	const beforeFailure = structuredClone(live); const bytes = store.get('state');
	assert.throws(() => cloneMutatePersist({ current: live, clone: structuredClone, mutate: (state) => discardPendingDraft(state, 'a'), persist: () => { throw new Error('full'); }, install }), /full/u);
	assert.deepEqual(live, beforeFailure); assert.equal(store.get('state'), bytes);
	const selectedElsewhere = { packs: live.packs, pendingNextActionDrafts: [{ ...draft, workId: 'a' }, { ...draft, workId: 'b' }] };
	restorePendingDraft(selectedElsewhere, 'a', null); assert.deepEqual(selectedElsewhere.pendingNextActionDrafts.map((item) => item.workId), ['b']);
});

test('pending draft persistence preserves order, hydrates, and resets through production helpers', async () => {
	const a = { workId: 'a', choice: 'Start', mode: 'preset', evidenceNote: 'A', evidence: [], originFingerprint: 'a', source: 'human' };
	const b = { ...a, workId: 'b', choice: 'Review', originFingerprint: 'b' };
	let live = { packs: [{ id: 'a', next: 'Open' }, { id: 'b', next: 'Review' }], pendingNextActionDrafts: [structuredClone(a), structuredClone(b)] };
	const before = structuredClone(live); let bytes = JSON.stringify(live); let writes = 0; let removes = 0;
	const persist = (state) => { writes += 1; bytes = JSON.stringify(state); };
	const install = (state) => { live = state; return state; };
	cloneMutatePersist({ current: live, clone: structuredClone, mutate: (state) => upsertPendingDraft(state, { ...a, choice: 'Focus' }), persist, install });
	assert.deepEqual(live.pendingNextActionDrafts.map((draft) => draft.workId), ['a', 'b']);
	restorePendingDraft(live, 'a', before.pendingNextActionDrafts[0]);
	assert.deepEqual(live, before); assert.deepEqual(pendingDraftNavigation(live), { count: 2, resumeHref: '/next?pack=a' });
	const hydrated = hydrateSerializedState(bytes, (state) => assert.ok(Array.isArray(state.packs)));
	assert.deepEqual(hydrated.packs, before.packs);
	await resetPersistedState({ remove: () => { removes += 1; bytes = ''; }, loadSeed: async () => ({ packs: [{ id: 'seed' }], pendingNextActionDrafts: [] }), install });
	assert.equal(removes, 1); assert.deepEqual(live.pendingNextActionDrafts, []); assert.ok(writes === 1);
});

test('pending approval transaction compositions persist atomically and restore exact order', () => {
	const project = (pack) => ({ title: pack.title, workflow: pack.status, blocker: pack.blocker || null, next: pack.next || '' });
	const a = { workId: 'a', choice: 'Start', mode: 'preset', evidenceNote: 'A', evidence: [{ workId: 'a', field: 'workflow', expectedValue: 'active' }], originFingerprint: '', source: 'human' };
	const b = { ...a, workId: 'b', choice: 'Review', evidence: [{ workId: 'b', field: 'workflow', expectedValue: 'active' }], originFingerprint: '' };
	let original = { packs: [{ id: 'a', title: 'A', status: 'active', blocker: '', next: 'Open' }, { id: 'b', title: 'B', status: 'active', blocker: '', next: 'Open' }], selectedId: 'b', pendingNextActionDrafts: [a, b] };
	original.pendingNextActionDrafts[0].originFingerprint = pendingDraftFingerprint(original, a, project); original.pendingNextActionDrafts[1].originFingerprint = pendingDraftFingerprint(original, b, project);
	let live = structuredClone(original); let bytes = JSON.stringify(live); let writes = 0; const persist = (state) => { writes += 1; bytes = JSON.stringify(state); }; const install = (state) => { live = state; return state; };
	const approve = (state) => approvePendingDraft(state, 'a', { projectPack: project, nextPath: (pack, choice) => ({ ...pack, next: choice }) });
	cloneMutatePersist({ current: live, clone: structuredClone, mutate: approve, persist, install });
	assert.equal(writes, 1); assert.equal(hydrateSerializedState(bytes, () => {}).packs[0].next, 'Start'); assert.deepEqual(live.pendingNextActionDrafts.map((draft) => draft.workId), ['b']);
	const approved = structuredClone(live); const approvedBytes = bytes; writes = 0;
	assert.throws(() => cloneMutatePersist({ current: original, clone: structuredClone, mutate: approve, persist: () => { writes += 1; throw new Error('full'); }, install }), /full/u);
	assert.equal(writes, 1); assert.deepEqual(live, approved); assert.equal(bytes, approvedBytes);
	const stale = structuredClone(original); stale.packs[0].status = 'done'; writes = 0;
	assert.throws(() => cloneMutatePersist({ current: stale, clone: structuredClone, mutate: approve, persist, install }), /stale/u); assert.equal(writes, 0);
	const priorA = structuredClone(original.pendingNextActionDrafts[0]); live = structuredClone(original); bytes = JSON.stringify(original); writes = 0;
	cloneMutatePersist({ current: live, clone: structuredClone, mutate: (state) => upsertPendingDraft(state, { ...priorA, choice: 'Focus' }), persist, install });
	cloneMutatePersist({ current: live, clone: structuredClone, mutate: (state) => restorePendingDraft(state, 'a', priorA), persist, install });
	assert.equal(writes, 2); assert.deepEqual(live, original); assert.equal(bytes, JSON.stringify(original)); assert.equal(pendingDraftNavigation(live).resumeHref, '/next?pack=a');
});

test('production Next revision gate blocks unsettled terminal actions and rolls rejected persistence back exactly', async () => {
	const project = (pack) => ({ title: pack.title, workflow: pack.status, blocker: pack.blocker || null, next: pack.next || '' });
	const durable = {
		packs: [{ id: 'next-current', title: 'Prepare inventory', status: 'active', blocker: 'Waiting', next: 'Review' }],
		pendingNextActionDrafts: []
	};
	const originalDraft = {
		workId: 'next-current',
		choice: 'Focus',
		mode: 'preset',
		evidenceNote: 'Prepare inventory · Blocker: Waiting',
		evidence: [{ workId: 'next-current', field: 'blocker', expectedValue: 'Waiting' }],
		originFingerprint: '',
		source: 'webmcp'
	};
	originalDraft.originFingerprint = pendingDraftFingerprint(durable, originalDraft, project);
	upsertPendingDraft(durable, originalDraft);
	const durableBefore = structuredClone(durable);
	const bytesBefore = JSON.stringify(durable);
	let live = durable;
	let bytes = bytesBefore;
	let pageState = {
		choice: 'Focus',
		mode: 'preset',
		customValue: '',
		showingCustom: false,
		receipt: { preparedAction: 'Focus', evidenceNote: originalDraft.evidenceNote },
		previousEditor: { choice: 'Review', mode: 'preset' },
		savedReceipt: { summary: 'Prior visible receipt' }
	};
	const pageBefore = structuredClone(pageState);
	let errorText = '';
	let releasePersistence;
	const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
	const revision = createNextDraftRevisionState();
	const rejectedRevision = reviseNextDraft(revision, {
		capture: () => structuredClone(pageState),
		preview: () => {
			pageState = { ...pageState, choice: 'Start', receipt: { ...pageState.receipt, preparedAction: 'Start' }, savedReceipt: null };
		},
		persist: async () => {
			await persistenceGate;
			const written = cloneMutatePersist({
				current: live,
				clone: structuredClone,
				mutate: (state) => revisePendingDraftChoice(state, { workId: 'next-current', choice: 'Start', mode: 'preset' }, project),
				persist: () => { throw new Error('storage rejected'); },
				install: (state) => { live = state; return state; }
			});
			bytes = JSON.stringify(written);
			return written.pendingNextActionDrafts[0];
		},
		settle: (draft) => { pageState = { ...pageState, choice: draft.choice, mode: draft.mode }; },
		rollback: (snapshot) => { pageState = snapshot; },
		reject: () => { errorText = 'The draft change was not saved. Your previous draft is still pending.'; }
	});
	assert.equal(revision.pending, true);
	assert.equal(nextDraftTerminalAvailable(revision, { busy: false, stale: false, choice: pageState.choice, mode: pageState.mode, draft: live.pendingNextActionDrafts[0] }), false);
	let saveCalls = 0;
	let discardCalls = 0;
	const immediateSave = await runSettledNextDraftAction(revision, {
		busy: false,
		stale: false,
		choice: pageState.choice,
		mode: pageState.mode,
		draft: live.pendingNextActionDrafts[0],
		action: async () => { saveCalls += 1; }
	});
	const immediateDiscard = await runSettledNextDraftAction(revision, {
		busy: false,
		stale: false,
		choice: pageState.choice,
		mode: pageState.mode,
		draft: live.pendingNextActionDrafts[0],
		action: async () => { discardCalls += 1; }
	});
	assert.equal(immediateSave.executed, false);
	assert.equal(immediateDiscard.executed, false);
	assert.equal(saveCalls, 0);
	assert.equal(discardCalls, 0);
	releasePersistence();
	const rejected = await rejectedRevision;
	assert.equal(rejected.status, 'rejected');
	assert.equal(revision.pending, false);
	assert.deepEqual(pageState, pageBefore);
	assert.deepEqual(live, durableBefore);
	assert.equal(bytes, bytesBefore);
	assert.equal(errorText, 'The draft change was not saved. Your previous draft is still pending.');
	assert.equal(nextDraftTerminalAvailable(revision, { busy: false, stale: false, choice: pageState.choice, mode: pageState.mode, draft: live.pendingNextActionDrafts[0] }), true);
});

test('production Next route/state chain consumes settled edited drafts with truthful lineage', async () => {
	const project = (pack) => ({ title: pack.title, workflow: pack.status, blocker: pack.blocker || null, next: pack.next || '' });
	const makeWebState = () => {
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
		draft.originFingerprint = pendingDraftFingerprint(state, draft, project);
		upsertPendingDraft(state, draft);
		return state;
	};

	let approveState = makeWebState();
	const approveOriginal = structuredClone(approveState.pendingNextActionDrafts[0]);
	const approveRevision = createNextDraftRevisionState();
	let approveEditor = { choice: 'Focus', mode: 'preset' };
	const revisedApprove = await reviseNextDraft(approveRevision, {
		capture: () => structuredClone(approveEditor),
		preview: () => { approveEditor = { choice: 'Start', mode: 'preset' }; },
		persist: async () => {
			approveState = cloneMutatePersist({
				current: approveState,
				clone: structuredClone,
				mutate: (state) => revisePendingDraftChoice(state, { workId: 'next-current', choice: 'Start', mode: 'preset' }, project),
				persist: () => {},
				install: (state) => state
			});
			return approveState.pendingNextActionDrafts[0];
		},
		settle: (draft) => { approveEditor = { choice: draft.choice, mode: draft.mode }; },
		rollback: (snapshot) => { approveEditor = snapshot; },
		reject: assert.fail
	});
	assert.equal(revisedApprove.status, 'settled');
	assert.equal(revisedApprove.draft.source, 'webmcp');
	assert.deepEqual(revisedApprove.draft.evidence, approveOriginal.evidence);
	assert.equal(revisedApprove.draft.originFingerprint, approveOriginal.originFingerprint);
	let approved;
	const approveExecution = await runSettledNextDraftAction(approveRevision, {
		busy: false,
		stale: false,
		choice: approveEditor.choice,
		mode: approveEditor.mode,
		draft: approveState.pendingNextActionDrafts[0],
		action: async () => {
			approveState = cloneMutatePersist({
				current: approveState,
				clone: structuredClone,
				mutate: (state) => { approved = approvePendingDraft(state, 'next-current', { projectPack: project, nextPath: (pack, choice) => ({ ...pack, next: choice }) }); },
				persist: () => {},
				install: (state) => state
			});
			return approved;
		}
	});
	assert.equal(approveExecution.executed, true);
	assert.equal(approveState.packs[0].next, 'Start');
	assert.deepEqual(approveState.pendingNextActionDrafts, []);
	assert.equal(webMcpHandoffTrailView(recordWebMcpDraftDecisionState(emptyWebMcpHandoffSession(), approveExecution.draft, 'proposal-approved')).outcomeSummary, 'Proposal approved');

	let discardState = makeWebState();
	const discardOriginal = structuredClone(discardState.pendingNextActionDrafts[0]);
	const discardRevision = createNextDraftRevisionState();
	let discardEditor = { choice: 'Focus', mode: 'preset' };
	const revisedDiscard = await reviseNextDraft(discardRevision, {
		capture: () => structuredClone(discardEditor),
		preview: () => { discardEditor = { choice: 'Open', mode: 'preset' }; },
		persist: async () => {
			discardState = cloneMutatePersist({ current: discardState, clone: structuredClone, mutate: (state) => revisePendingDraftChoice(state, { workId: 'next-current', choice: 'Open', mode: 'preset' }, project), persist: () => {}, install: (state) => state });
			return discardState.pendingNextActionDrafts[0];
		},
		settle: (draft) => { discardEditor = { choice: draft.choice, mode: draft.mode }; },
		rollback: (snapshot) => { discardEditor = snapshot; },
		reject: assert.fail
	});
	assert.equal(revisedDiscard.status, 'settled');
	assert.equal(revisedDiscard.draft.source, 'webmcp');
	assert.deepEqual(revisedDiscard.draft.evidence, discardOriginal.evidence);
	assert.equal(revisedDiscard.draft.originFingerprint, discardOriginal.originFingerprint);
	const discardExecution = await runSettledNextDraftAction(discardRevision, {
		busy: false,
		stale: false,
		choice: discardEditor.choice,
		mode: discardEditor.mode,
		draft: discardState.pendingNextActionDrafts[0],
		action: async () => {
			discardState = cloneMutatePersist({ current: discardState, clone: structuredClone, mutate: (state) => discardPendingDraft(state, 'next-current'), persist: () => {}, install: (state) => state });
		}
	});
	assert.equal(discardExecution.executed, true);
	assert.deepEqual(discardState.pendingNextActionDrafts, []);
	assert.equal(webMcpHandoffTrailView(recordWebMcpDraftDecisionState(emptyWebMcpHandoffSession(), discardExecution.draft, 'proposal-discarded')).outcomeSummary, 'Proposal discarded');

	let humanState = { packs: [{ id: 'next-current', title: 'Prepare inventory', status: 'active', blocker: '', next: 'Review' }], pendingNextActionDrafts: [] };
	const humanRevision = createNextDraftRevisionState();
	let humanEditor = { choice: 'Review', mode: 'preset' };
	await reviseNextDraft(humanRevision, {
		capture: () => structuredClone(humanEditor),
		preview: () => { humanEditor = { choice: 'Start', mode: 'preset' }; },
		persist: async () => {
			humanState = cloneMutatePersist({ current: humanState, clone: structuredClone, mutate: (state) => revisePendingDraftChoice(state, { workId: 'next-current', choice: 'Start', mode: 'preset' }, project), persist: () => {}, install: (state) => state });
			return humanState.pendingNextActionDrafts[0];
		},
		settle: (draft) => { humanEditor = { choice: draft.choice, mode: draft.mode }; },
		rollback: (snapshot) => { humanEditor = snapshot; },
		reject: assert.fail
	});
	const humanExecution = await runSettledNextDraftAction(humanRevision, {
		busy: false,
		stale: false,
		choice: humanEditor.choice,
		mode: humanEditor.mode,
		draft: humanState.pendingNextActionDrafts[0],
		action: async () => { humanState = cloneMutatePersist({ current: humanState, clone: structuredClone, mutate: (state) => discardPendingDraft(state, 'next-current'), persist: () => {}, install: (state) => state }); }
	});
	assert.equal(humanExecution.draft.source, 'human');
	assert.deepEqual(recordWebMcpDraftDecisionState(emptyWebMcpHandoffSession(), humanExecution.draft, 'proposal-discarded'), emptyWebMcpHandoffSession());
});

test('WebMCP prepare transaction keeps a differing-choice human draft from rehydrating provisionally', async () => {
	const human = { workId: 'next-current', choice: 'Review', source: 'human' };
	const original = { choice: 'Review', source: 'human', presenter: 'human', inFlight: false, draft: human };
	let pageState = structuredClone(original); let fail = true; let restores = 0;
	const tool = createPrepareNextActionTool(async (input, invocation) => {
		invocation.markMutated(); pageState = { ...pageState, choice: input.choice, source: 'webmcp', presenter: 'webmcp', inFlight: true, draft: { ...human, choice: input.choice, source: 'webmcp' } };
		assert.equal(shouldHydratePendingDraft({ preparationInFlight: pageState.inFlight, pendingDraft: human, visibleWorkId: 'next-current', preparationReceipt: { preparedAction: input.choice } }), false);
		if (fail) throw new Error('persist failed');
		pageState.inFlight = false;
		return { changed: true, focus: { id: NEXT_PREPARATION_RECEIPT_ID, focused: true, focusVisible: true, inViewport: true, pulsed: true }, next: editor({ editor: { mode: 'preset', choice: input.choice }, preparationReceipt: preparationReceipt(input.choice) }) };
	}, { capture: () => structuredClone(pageState), restore: (snapshot) => { restores += 1; pageState = structuredClone(snapshot); } });
	const input = { choice: 'Focus', expectedMode: 'preset', expectedChoice: 'Review', evidence: [currentEvidenceReference] };
	await assert.rejects(() => tool.execute(input), /persist failed/u); assert.equal(restores, 1); assert.deepEqual(pageState, original);
	fail = false; const result = await tool.execute(input); assert.deepEqual(result.focus, { id: NEXT_PREPARATION_RECEIPT_ID, focused: true, focusVisible: true, inViewport: true, pulsed: true }); assert.equal(restores, 1); assert.equal(pageState.source, 'webmcp'); assert.equal(pageState.choice, 'Focus'); assert.equal(pageState.draft.source, 'webmcp'); assert.equal(pageState.presenter, 'webmcp'); assert.equal(pageState.inFlight, false);
});
