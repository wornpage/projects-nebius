import { NEXT_ACTION_MAX_LENGTH, NEXT_EDITOR_PREVIEW_ID, NEXT_PREPARATION_RECEIPT_ID, NEXT_PREPARATION_SUMMARY, createNextDraftRevisionState, nextDraftTerminalAvailable, reviseNextDraft, runSettledNextDraftAction, shouldHydratePendingDraft } from '../svelte-frontend/src/routes/next/next-draft.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('Nebius task-view links are bounded to one explicit task and never start a build', () => {
  const source = fs.readFileSync(path.resolve('svelte-frontend/src/routes/next/+page.svelte'), 'utf8');
  assert.match(source, /pack\.id !== requestedPackId/u);
  assert.match(source, /const requested = views\.length === 1 \? views\[0\] : '';[\s\S]*?const canonicalView = legacyTaskViewAliases\[requested\] \|\| requested;[\s\S]*?params\.getAll\('pack'\)\.length === 1 && taskViews\.some\(view => view\.id === canonicalView\) \? canonicalView : 'brief'/u);
  assert.match(source, /next: 'brief',[\s\S]*?build: 'tool',[\s\S]*?evidence: 'review'/u);
  assert.match(source, /taskView = requestedView/u);
  assert.match(source, /requestKey !== appliedTaskViewRequest/u);
  const request = source.match(/let appliedTaskViewRequest[\s\S]*?let dependencyTitle/u)?.[0] || source.slice(source.indexOf('let appliedTaskViewRequest'), source.indexOf('let pendingDraft'));
  assert.doesNotMatch(request, /startRun\(|reserveExecutionRunReference\(|runPackAction\(|fetch\(|localStorage|sessionStorage/u);
});
import { fileURLToPath } from 'node:url';


import { approvePendingDraft, cloneMutatePersist, discardPendingDraft, hydrateSerializedState, pendingDraftFingerprint, pendingDraftNavigation, resetPersistedState, revisePendingDraftChoice, upsertPendingDraft } from '../svelte-frontend/src/lib/pending-next-action.mjs';

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

test('terminal work cannot enter or complete the Next approval path', () => {
	assert.match(demoWorkflowSource, /export function canSetNextAction\(pack: DemoPack\): boolean \{\s*return pack\.status !== 'done' && !pack\.archived;\s*\}/u);
	assert.match(routeSource, /let packs = \$derived\([\s\S]*?\.filter\(canSetNextAction\)/u);
	assert.match(demoClientSource, /function requireNextActionTarget\(state: DemoState, workId: string\): DemoPack \{[\s\S]*?if \(!canSetNextAction\(pack\)\)[\s\S]*?Completed or archived work cannot have a next-action draft\./u);
	assert.equal(demoClientSource.match(/requireNextActionTarget\(state, (?:draft\.)?workId\);/gu)?.length, 3);
	assert.match(demoClientSource, /Object\.assign\(pack, packActionEffect\(pack, action\)\);\s*if \(action === 'done'\) discardPendingDraft\(draft, pack\.id\);/u);
	assert.match(demoClientSource, /if \(statusBefore !== 'done' && pack\.status === 'done'\) \{[\s\S]*?discardPendingDraft\(draft, pack\.id\);/u);
});
const helperSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/next-draft.mjs'), 'utf8');
const decisionNavigationSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/decision-workspace-navigation.mjs'), 'utf8');
const candidatePickerSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/NextCandidatePicker.svelte'), 'utf8');
const workContextSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/NextWorkContext.svelte'), 'utf8');
const workflowSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-workflow.ts'), 'utf8');
const workRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/+page.svelte'), 'utf8');


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
	assert.match(routeSource, /pendingDraft && pendingDraftStale[\s\S]*?Draft is stale/u);
	assert.match(helperSource, /export function createNextDraftRevisionState\(\)[\s\S]*?return \{ pending: false \};[\s\S]*?export async function reviseNextDraft/u);
	assert.match(helperSource, /if \(revision\.pending\) return \{ status: 'busy', draft: null \};[\s\S]*?revision\.pending = true;[\s\S]*?const draft = await persist\(\);[\s\S]*?settle\(draft\);[\s\S]*?rollback\(snapshot\);[\s\S]*?reject\(error\);[\s\S]*?revision\.pending = false;/u);
	assert.match(helperSource, /export function nextDraftTerminalAvailable[\s\S]*?!revision\.pending && !busy && !stale[\s\S]*?draft\.choice === choice && draft\.mode === mode/u);
	assert.match(helperSource, /export async function runSettledNextDraftAction[\s\S]*?nextDraftTerminalAvailable[\s\S]*?action\(consumedDraft\)[\s\S]*?finish\?\.\(\)/u);
	assert.match(routeSource, /let terminalDraftAvailable = \$derived\(nextDraftTerminalAvailable\(draftRevision,[\s\S]*?draft: pendingDraft/u);
	assert.equal(routeSource.match(/disabled=\{!terminalDraftAvailable\}/gu)?.length, 1, 'Only approval requires an approvable settled draft');
	assert.match(routeSource, /let saveNextHelp = \$derived\.by\(\(\) => \{[\s\S]*?if \(!effectiveChoice\) return 'Type a custom next action\.';[\s\S]*?if \(!pendingDraft\) return `Prepare "\$\{effectiveChoice\}" as a browser-local draft for \$\{workTitle\(pack\)\}\. The workspace stays unchanged\.`;[\s\S]*?if \(pendingDraftStale\) return 'This draft is stale\. Refresh the evidence before approval\.';[\s\S]*?if \(draftRevision\.pending\) return 'Wait for the visible draft change to finish saving\.';[\s\S]*?if \(!pendingDraftMatchesEditor\) return 'The visible choice differs from the pending draft\. Update the draft before approval\.';/u);
	assert.match(routeSource, /next-authority[\s\S]*?savedNextReceipt \? 'none · completed'[\s\S]*?savedNextReceipt \? 'updated'[\s\S]*?saved and approved by the person/u);
	assert.match(routeSource, /function savedEditorBaseline\(target: DemoPack \| null\): EditorSnapshot[\s\S]*?defaultChoiceFor\(target\)[\s\S]*?NEXT_ACTION_CHOICES/u);
	assert.match(routeSource, /async function setHumanNextEditorChoice[\s\S]*?await reviseNextDraft\(draftRevision,[\s\S]*?capture: captureHumanRevisionSnapshot,[\s\S]*?const state = await revisePendingNextActionDraftChoice\(workId, pendingChoice, mode\);[\s\S]*?settle: \(revisedDraft\)[\s\S]*?preparationReceipt = preparationFromPending\(revisedDraft\);[\s\S]*?rollback: restoreHumanRevisionSnapshot,[\s\S]*?Your previous draft is still pending\./u);
	assert.doesNotMatch(routeSource, /void revisePendingNextActionDraftChoice|void setHumanNextEditorChoice/u);
	assert.match(routeSource, /function captureHumanRevisionSnapshot[\s\S]*?preparationReceipt:[\s\S]*?preparationPreviousEditor:[\s\S]*?savedNextReceipt[\s\S]*?function restoreHumanRevisionSnapshot[\s\S]*?choice = snapshot\.choice;[\s\S]*?preparationReceipt = clonePreparationReceipt\(snapshot\.preparationReceipt\);[\s\S]*?savedNextReceipt = snapshot\.savedNextReceipt/u);
	assert.match(routeSource, /shouldHydratePendingDraft\(\{ preparationInFlight: draftRevision\.pending/u);
	assert.match(routeSource, /disabled=\{routeBusy\}[\s\S]*?pendingDraftStale \? 'Discard stale draft' : 'Discard draft'/u);
	assert.match(routeSource, /let visiblePackId = \$derived\(pack\?\.id \|\| ''\);[\s\S]*?pendingNextActionDraftFor\(\$demoState, visiblePackId\)/u);
	assert.doesNotMatch(routeSource, /preparationToolName/u);
	assert.equal(routeSource.match(/await setPackNextAction\(/gu)?.length, 1);
	assert.match(layoutSource, /pendingNextActionDrafts\(\$demoState\)[\s\S]*?pendingDraftNavigation[\s\S]*?pendingResumeHref[\s\S]*?Pending approvals/u);
	assert.match(routeSource, /shouldHydratePendingDraft\(\{ preparationInFlight: draftRevision\.pending/u);
	assert.match(routeSource, /Earlier agent draft[\s\S]*?Review its evidence before approving or discarding it\./u);
	assert.match(routeSource, /async function saveChoice\(\)[\s\S]*?runSettledNextDraftAction\(draftRevision,[\s\S]*?const result = await setPackNextAction\(workId\);/u);
	assert.doesNotMatch(routeSource, /localStorage|sessionStorage/u);

});

test('discarding a draft restores focus to the matching saved editor mode', () => {
	const discardHandler = routeSource.match(/async function discardPreparation\(\)[\s\S]*?(?=\n\tasync function editPack)/u)?.[0] ?? '';
	assert.match(discardHandler, /if \(!pack\?\.id \|\| !pendingDraft \|\| routeBusy\) return;/u);
	assert.match(discardHandler, /await discardPendingNextActionDraft\(workId\);/u);
	assert.match(discardHandler, /clearPreparation\(\);/u);
	assert.doesNotMatch(discardHandler, /nextDraftTerminalAvailable|pendingDraftStale|runSettledNextDraftAction/u);
	assert.match(
		discardHandler,
		/if \(previous\) \{\s*setNextEditorChoice\(previous\.choice, previous\.mode, false\);\s*editorChoiceStaged = false;\s*await scheduleEditorFocus\(previous\.mode === 'custom' \? 'custom' : 'choices'\);\s*\}/u
	);
	assert.doesNotMatch(discardHandler, /scheduleEditorFocus\('choices'\)/u);
});

test('human next-action editors have one explicit choice-length boundary', () => {
	assert.match(helperSource, /export const NEXT_ACTION_MAX_LENGTH = 200;/u);
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
	discardPendingDraft(selectedElsewhere, 'a'); assert.deepEqual(selectedElsewhere.pendingNextActionDrafts.map((item) => item.workId), ['b']);
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
	upsertPendingDraft(live, before.pendingNextActionDrafts[0]);
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
	cloneMutatePersist({ current: live, clone: structuredClone, mutate: (state) => upsertPendingDraft(state, priorA), persist, install });
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
});
