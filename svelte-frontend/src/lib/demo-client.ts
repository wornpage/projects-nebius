// Browser-local state owner for the Projects workflow and its sample workspace.

import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import type { DemoExecutionRunReference, DemoPack, DemoProject, DemoReceipt, DemoState } from '$lib/demo-workflow';
import type { ProjectPlan } from './nebius-plan-contract.mjs';
import { REPLAN_LIMITS, validateProjectSnapshot, validateProjectReplan, type ProjectSnapshot, type ProjectReplan } from './nebius-replan-contract.mjs';
import { applyProjectReplanState } from './nebius-replan-state.mjs';
import { assertProjectRecord, assertProjectState, createProjectPlanState, mergedProjectRecords } from './nebius-project-state.mjs';
import { normalizeWorkTitle, WORK_TITLE_MAX_LENGTH } from '$lib/canonical-text.mjs';
import { nextStateEnvelope, readStateEnvelope, withExclusiveStateStorageLock } from '$lib/browser-state-envelope.mjs';
import {
	formatWorkTitle,
	nextChoiceForwardPath,
	rebaseSeedPacks,
	PACK_ACTIONS,
	PACK_ENERGIES,
	STATE_FILTERS,
	VALID_PACK_STATUSES,
	RETIRED_EXECUTION_RUN_LIMIT,
	parseDateOnly,
	evidenceFacts,
	canSetNextAction,
	workTitle
} from '$lib/demo-workflow';
import {
	DEMO_BLOCKER_NONE,
	formatActivityEntry,
	forwardPathStatusForBlocker,
	normalizeStoredBlocker,
	normalizeText,
	packActionEffect,
	unblockPacksBlockedBy,
	unblockedReceiptSentence
} from './workflow-rules.mjs';
import { approvePendingDraft, discardPendingDraft, pendingDraftCountFor, pendingDraftFingerprint as fingerprintPendingDraft, pendingDraftHasDuplicateEvidence, pendingDraftReferencesAvailable, resetPersistedState, revisePendingDraftChoice, upsertPendingDraft } from './pending-next-action.mjs';
import { planBatchAction, removePacksAndReferences, repairActiveSelection } from './batch-actions.mjs';
import { FIELD_LIMITS, projectTask } from './nebius-contract.mjs';
import { NebiusRunClientError, readRun } from './nebius-execution-client';
import {
	TERMINAL_RUN_STATUSES,
	RUN_VERSION,
	runFilesDigest,
	runSnapshotFromRecord,
	validRunId,
	validRunKey,
	validateRunInput,
	validateRunIntegrity,
	validateRunRecord,
	validateToolRequirements,
	type RunInput,
	type RunRecord
} from './nebius-execution-contract.mjs';

const STORAGE_KEY = 'projects-webmcp-challenge-state-v1';
const NEBIUS_EDITION = typeof __NEBIUS_EDITION__ !== 'undefined' && __NEBIUS_EDITION__;
const STORAGE_LOCK_NAME = `${STORAGE_KEY}-write`;
const SEED_URL = '/data/demo-packs.json';
const FORWARD_PATH_FIELDS = [
	'title',
	'status',
	'blocker',
	'blockedBy',
	'owner',
	'due',
	'next',
	'nextStep',
	'doneWhen',
	'completionEvidence',
	'purpose'
] as const;

export const DEMO_WORK_TITLE_MAX_LENGTH = WORK_TITLE_MAX_LENGTH;
const CREATE_PACK_FIELDS = new Set([
	'title',
	'status',
	'next',
	'nextStep',
	'blocker',
	'owner',
	'area',
	'type',
	'due',
	'energy',
	'recurrence',
	'purpose',
	'doneWhen',
	'notes',
	'sourceUrl',
	'projectId'
]);
type NormalizedCreatePackFields = {
	title: string;
	status: string;
	blocker: string;
	next: string;
	nextStep?: string;
	owner?: string;
	area?: string;
	type?: string;
	due?: string;
	energy?: string;
	recurrence?: string;
	purpose?: string;
	doneWhen?: string;
	memory?: string[];
	sources?: string[];
	projectId?: string;
};

export type CreatedPackUndoToken = {
	packId: string;
	expectedSignature: string;
	previousSelectedId: string | null;
};

export const demoState = writable<DemoState | null>(null);
export const demoStateLoading = writable(false);
export const demoStateError = writable('');
export const actionBusy = writable('');

export interface DemoToast {
	id: string;
	message: string;
	kind?: 'info' | 'error' | 'success';
}

export const toasts = writable<DemoToast[]>([]);

export type PendingNextActionDraft = {
	workId: string;
	choice: string;
	mode: 'preset' | 'custom';
	evidenceNote: string;
	evidence: Array<{ workId: string; field: 'workflow' | 'blocker'; expectedValue: string | null }>;
	originFingerprint: string;
	source: 'human' | 'webmcp';
};

export class ChallengeStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ChallengeStateError';
	}
}

let toastCounter = 0;
let stateRevision = 0;
let storageRevision: string | null = null;
let refreshFlight: Promise<DemoState | null> | null = null;

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function installDemoState(state: DemoState, revision: string | null): DemoState {
	storageRevision = revision;
	demoState.set(state);
	demoStateError.set('');
	return state;
}

function executionInputMatches(left: RunInput, right: RunInput): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function executionInputMatchesRecord(input: RunInput, record: RunRecord): boolean {
	const { consent: _consent, ...snapshot } = input;
	return JSON.stringify(snapshot) === JSON.stringify(runSnapshotFromRecord(record));
}

function assertExecutionRunReference(value: unknown, packId: string): asserts value is DemoExecutionRunReference {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChallengeStateError('Saved task execution reference is invalid.');
	const reference = value as DemoExecutionRunReference;
	if (Object.keys(reference).sort().join(',') !== 'id,input,key,record' || !validRunId(reference.id) || !validRunKey(reference.key)) {
		throw new ChallengeStateError('Saved task execution reference is invalid.');
	}
	let input: RunInput;
	try {
		input = validateRunInput(reference.input);
	} catch {
		throw new ChallengeStateError('Saved task execution input is invalid.');
	}
	if (input.packId !== packId) throw new ChallengeStateError('Saved task execution belongs to a different work item.');
	if (reference.record === null) return;
	let record: RunRecord;
	try {
		record = validateRunRecord(reference.record);
	} catch {
		throw new ChallengeStateError('Saved task execution record is invalid.');
	}
	if (record.id !== reference.id || record.packId !== packId || !executionInputMatchesRecord(input, record)) {
		throw new ChallengeStateError('Saved task execution record does not match its authorized input.');
	}
	// Install the validated current shape for saved v1 records and backups.
	reference.record = record;
}

function assertDemoState(value: unknown, recordOnly = false): asserts value is DemoState {
	if (!value || typeof value !== 'object' || !Array.isArray((value as DemoState).packs)) {
		throw new ChallengeStateError('Saved workspace data is not a valid work-item state.');
	}
	const ids = new Set<string>();
	for (const pack of (value as DemoState).packs) {
		if (!pack || typeof pack !== 'object' || typeof pack.id !== 'string' || !pack.id.trim()) {
			throw new ChallengeStateError('Saved workspace data contains a work item without an id.');
		}
		if (ids.has(pack.id)) {
			throw new ChallengeStateError(`Saved workspace data contains duplicate id "${pack.id}".`);
		}
		ids.add(pack.id);
		if (pack.title !== undefined) {
			const title = normalizeWorkTitle(pack.title);
			if (title === null || title !== pack.title) {
				throw new ChallengeStateError('Saved workspace data contains a non-canonical or overlong work title.');
			}
		}
		const optionalTextLimits: Record<string, number> = {
			type: 120, blocker: 200, blockedBy: 200, next: 200, nextStep: 2000, owner: 120, due: 40,
			doneWhen: NEBIUS_EDITION ? FIELD_LIMITS.doneWhen : 1000, completionEvidence: 2000, purpose: 1000, area: 120, energy: 40, recurrence: 40,
			decider: 120, milestone: 200, location: 200
		};
		for (const [field, maxLength] of Object.entries(optionalTextLimits)) {
			const raw = pack[field];
			const controls = field === 'purpose' || field === 'doneWhen' || field === 'completionEvidence' ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u : /\p{Cc}/u;
			if (raw !== undefined && (typeof raw !== 'string' || raw.length > maxLength || controls.test(raw))) {
				throw new ChallengeStateError(`Saved workspace data contains an invalid ${field} value.`);
			}
		}
		if (pack.status !== undefined && !VALID_PACK_STATUSES.has(pack.status)) {
			throw new ChallengeStateError(`Saved workspace data contains an invalid status for "${pack.id}".`);
		}
		for (const field of ['archived', 'pinned', 'decision'] as const) {
			if (pack[field] !== undefined && typeof pack[field] !== 'boolean') {
				throw new ChallengeStateError(`Saved workspace data contains an invalid ${field} flag.`);
			}
		}
		if (pack.progress !== undefined && (!Number.isFinite(pack.progress) || pack.progress < 0 || pack.progress > 100)) {
			throw new ChallengeStateError(`Saved workspace data contains invalid progress for "${pack.id}".`);
		}
		if (pack.due && !parseDateOnly(pack.due)) {
			throw new ChallengeStateError(`Saved workspace data contains an invalid due date for "${pack.id}".`);
		}
		for (const field of ['activity', 'memory', 'sources'] as const) {
			const entries = pack[field];
			if (entries !== undefined && (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string' || entry.length > 2000 || /\p{Cc}/u.test(entry)))) {
				throw new ChallengeStateError(`Saved workspace data contains invalid ${field} entries.`);
			}
		}
		if (pack.reactions !== undefined && (!pack.reactions || typeof pack.reactions !== 'object' || Array.isArray(pack.reactions) || Object.values(pack.reactions).some((count) => !Number.isSafeInteger(count) || count < 0))) {
			throw new ChallengeStateError(`Saved workspace data contains invalid reactions for "${pack.id}".`);
		}
		if (pack.projectId !== undefined && (typeof pack.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u.test(pack.projectId))) {
			throw new ChallengeStateError('Saved workspace data contains an invalid project id.');
		}
		if (pack.executionInputs !== undefined || pack.executionOutputs !== undefined) {
			try { validateToolRequirements(pack.executionInputs ?? null, pack.executionOutputs ?? null); }
			catch { throw new ChallengeStateError('Saved tool input or output requirements are invalid.'); }
		}
		if (pack.executionRun !== undefined) assertExecutionRunReference(pack.executionRun, pack.id);
		if (pack.retiredExecutionRuns !== undefined) {
			if (!Array.isArray(pack.retiredExecutionRuns) || pack.retiredExecutionRuns.length > RETIRED_EXECUTION_RUN_LIMIT) {
				throw new ChallengeStateError('Retired task execution history is invalid or exceeds its limit.');
			}
			const retiredIds = new Set<string>();
			for (const entry of pack.retiredExecutionRuns) {
				if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
					Object.keys(entry).sort().join(',') !== 'reason,reference,retiredAt' || entry.reason !== 'server_not_found' ||
					typeof entry.retiredAt !== 'string' || !Number.isFinite(Date.parse(entry.retiredAt)) ||
					new Date(entry.retiredAt).toISOString() !== entry.retiredAt) {
					throw new ChallengeStateError('Retired task execution history contains an invalid entry.');
				}
				assertExecutionRunReference(entry.reference, pack.id);
				if (entry.reference.record !== null ||
					retiredIds.has(entry.reference.id) || pack.executionRun?.id === entry.reference.id) {
					throw new ChallengeStateError('Retired task execution history contains an invalid saved reference.');
				}
				retiredIds.add(entry.reference.id);
			}
		}
	}
	// Recovery first validates record shape; references need the whole graph.
	if (recordOnly) return;
	assertProjectState(value);
	const pending = (value as DemoState).pendingNextActionDrafts;
	if (pending !== undefined && (!Array.isArray(pending) || pending.some((draft) => !isPendingNextActionDraft(draft)))) {
		throw new ChallengeStateError('Saved pending approvals are invalid. Clear this site\'s local data to restart.');
	}
	// Preserve well-formed historical drafts even if their target or evidence
	// disappeared. The approvals center can display and discard them; the
	// approval path separately requires a current, active target and evidence.
	const dependencyIds = new Set((value as DemoState).packs.map((pack) => pack.id));
	for (const pack of (value as DemoState).packs) {
		if (pack.blockedBy && !dependencyIds.has(pack.blockedBy)) {
			throw new ChallengeStateError(`Saved workspace data contains an unresolved dependency for "${pack.id}".`);
		}
	}
}

function recoverPersistedState(value: unknown): DemoState {
	if (!value || typeof value !== 'object' || !Array.isArray((value as DemoState).packs)) {
		throw new ChallengeStateError('Saved workspace data is not a recoverable work-item state.');
	}
	const source = value as DemoState;
	const quarantined: Array<{ id: string; reason: string }> = [];
	const packs: DemoPack[] = [];
	const projects: DemoProject[] = [];
	const projectIds = new Set<string>();
	if (source.projects !== undefined && !Array.isArray(source.projects)) throw new ChallengeStateError('Saved project list is not recoverable.');
	for (const [index, project] of (source.projects || []).entries()) {
		try {
			assertProjectRecord(project);
			if (projectIds.has(project.id)) throw new ChallengeStateError('Duplicate project id.');
			projectIds.add(project.id);
			projects.push(structuredClone(project));
		} catch (error) {
			quarantined.push({ id: typeof project?.id === 'string' ? project.id : `project-${index + 1}`, reason: errorMessage(error, 'Invalid project record.') });
		}
	}
	const recoveredIds = new Set<string>();
	for (const [index, pack] of source.packs.entries()) {
		try {
			assertDemoState({ packs: [pack] }, true);
			if (recoveredIds.has(pack.id)) throw new ChallengeStateError('Duplicate work item id.');
			if (pack.projectId && !projectIds.has(pack.projectId)) throw new ChallengeStateError('Work item references an invalid or missing project.');
			recoveredIds.add(pack.id);
			packs.push(structuredClone(pack));
		} catch (error) {
			quarantined.push({ id: typeof pack?.id === 'string' && pack.id.trim() ? pack.id : `record-${index + 1}`, reason: errorMessage(error, 'Invalid work-item record.') });
		}
	}
	const ids = new Set(packs.map((pack) => pack.id));
	const packMap = new Map(packs.map((pack) => [pack.id, pack]));
	for (const pack of packs) {
		let cyclic = false;
		if (pack.projectId) {
			const visited = new Set([pack.id]);
			let predecessor = pack.blockedBy;
			while (predecessor) {
				if (visited.has(predecessor)) { cyclic = true; break; }
				visited.add(predecessor);
				predecessor = packMap.get(predecessor)?.blockedBy;
			}
		}
		if (pack.blockedBy && (!ids.has(pack.blockedBy) || (pack.projectId && packMap.get(pack.blockedBy)?.projectId !== pack.projectId) || cyclic)) {
			quarantined.push({ id: pack.id, reason: 'Unresolved, conflicting or cyclic dependency was cleared.' });
			pack.blockedBy = '';
			pack.blocker = DEMO_BLOCKER_NONE;
			pack.status = forwardPathStatusForBlocker(pack.status, pack.blocker, pack.next || '');
		}
	}
	const pendingSource = Array.isArray(source.pendingNextActionDrafts) ? source.pendingNextActionDrafts : [];
	if (source.pendingNextActionDrafts !== undefined && !Array.isArray(source.pendingNextActionDrafts)) quarantined.push({ id: 'pending-approvals', reason: 'Invalid pending approval list was cleared.' });
	const pending = pendingSource.filter((draft) => {
		const id = typeof draft?.workId === 'string' ? draft.workId : 'pending-approval';
		const validDraft = isPendingNextActionDraft(draft);
		if (!validDraft) quarantined.push({ id, reason: 'Pending approval has an invalid record.' });
		return validDraft;
	});
	const selectionInvalid = source.selectedProjectId !== undefined && source.selectedProjectId !== null && !projectIds.has(source.selectedProjectId);
	if (selectionInvalid) quarantined.push({ id: 'selected-project', reason: 'Invalid selected project was cleared.' });
	if (!quarantined.length) return source;
	const recovered = { ...structuredClone(source), packs, pendingNextActionDrafts: pending, recoveryQuarantine: [...(Array.isArray(source.recoveryQuarantine) ? source.recoveryQuarantine as Array<{ id: string; reason: string }> : []), ...quarantined] };
	if (source.projects !== undefined) recovered.projects = projects;
	if (selectionInvalid) {
		recovered.selectedProjectId = null;
	}
	return recovered;
}

function migrateLegacyState(value: DemoState): DemoState {
	const state = structuredClone(value);
	for (const pack of state.packs) {
		if (pack.title === undefined) continue;
		const title = normalizeWorkTitle(pack.title);
		if (title === null) throw new ChallengeStateError('Saved workspace data contains an invalid work title.');
		pack.title = title;
	}
	return state;
}

function createStorageRevision(): string {
	if (!globalThis.crypto?.randomUUID) {
		throw new ChallengeStateError('This browser cannot create a collision-safe workspace revision.');
	}
	return globalThis.crypto.randomUUID();
}

function isPendingNextActionDraft(value: unknown): value is PendingNextActionDraft {
	if (!value || typeof value !== 'object') return false;
	const draft = value as PendingNextActionDraft;
	return typeof draft.workId === 'string' && Boolean(draft.workId.trim()) &&
		typeof draft.choice === 'string' && Boolean(draft.choice.trim()) &&
		(draft.mode === 'preset' || draft.mode === 'custom') &&
		typeof draft.evidenceNote === 'string' && Array.isArray(draft.evidence) &&
		typeof draft.originFingerprint === 'string' && Boolean(draft.originFingerprint) &&
		(draft.source === 'human' || draft.source === 'webmcp') &&
		draft.evidence.every((fact) => fact && typeof fact.workId === 'string' && Boolean(fact.workId.trim()) && (fact.field === 'workflow' || fact.field === 'blocker') &&
			((typeof fact.expectedValue === 'string' && Boolean(fact.expectedValue) && fact.expectedValue.length <= 200 && !/\p{Cc}/u.test(fact.expectedValue)) ||
				(fact.field === 'blocker' && fact.expectedValue === null)));
}

export function pendingNextActionDrafts(state: DemoState | null): PendingNextActionDraft[] {
	return state?.pendingNextActionDrafts && Array.isArray(state.pendingNextActionDrafts)
		? state.pendingNextActionDrafts.filter(isPendingNextActionDraft)
		: [];
}

export function pendingNextActionDraftFor(state: DemoState | null, workId: string): PendingNextActionDraft | null {
	return pendingNextActionDrafts(state).find((draft) => draft.workId === workId) ?? null;
}

function requireNextActionTarget(state: DemoState, workId: string): DemoPack {
	const pack = state.packs.find((candidate) => candidate.id === workId);
	if (!pack) throw new ChallengeStateError('Pending approval work item was not found.');
	if (!canSetNextAction(pack)) {
		throw new ChallengeStateError('Completed or archived work cannot have a next-action draft.');
	}
	return pack;
}

export async function savePendingNextActionDraft(draft: PendingNextActionDraft): Promise<DemoState | null> {
	if (!isPendingNextActionDraft(draft)) throw new ChallengeStateError('Pending approval draft is invalid.');
	return saveBrowserState((state) => {
		requireNextActionTarget(state, draft.workId);
		const current = pendingNextActionDraftFor(state, draft.workId);
		if (pendingDraftCountFor(state, draft.workId) > 1) throw new ChallengeStateError('Multiple drafts refer to this work. Inspect or discard them before preparing another.');
		if ((current && pendingDraftHasDuplicateEvidence(current)) || pendingDraftHasDuplicateEvidence(draft)) throw new ChallengeStateError('This draft repeats an evidence reference. Inspect or discard it before preparing another.');
		if ((current && !pendingDraftReferencesAvailable(state, current)) || !pendingDraftReferencesAvailable(state, draft)) {
			throw new ChallengeStateError('This draft references missing work. Inspect or discard it before preparing another.');
		}
		upsertPendingDraft(state, draft);
	});
}

export async function revisePendingNextActionDraftChoice(
	workId: string,
	choice: string,
	mode: 'preset' | 'custom'
): Promise<DemoState | null> {
	return saveBrowserState((state) => {
		requireNextActionTarget(state, workId);
		const current = pendingNextActionDraftFor(state, workId);
		if (pendingDraftCountFor(state, workId) > 1) throw new ChallengeStateError('Multiple drafts refer to this work. Inspect or discard them before preparing another.');
		if (current && pendingDraftHasDuplicateEvidence(current)) throw new ChallengeStateError('This draft repeats an evidence reference. Inspect or discard it before preparing another.');
		if (current && !pendingDraftReferencesAvailable(state, current)) {
			throw new ChallengeStateError('This draft references missing work. Inspect or discard it before preparing another.');
		}
		revisePendingDraftChoice(state, { workId, choice, mode }, pendingPackProjection);
	});
}

export async function discardPendingNextActionDraft(workId: string): Promise<DemoState | null> {
	return saveBrowserState((state) => {
		discardPendingDraft(state, workId);
	});
}

export function pendingDraftFingerprint(state: DemoState, draft: PendingNextActionDraft): string {
	return fingerprintPendingDraft(state, draft, pendingPackProjection);
}

function pendingPackProjection(pack: DemoPack) {
	return { title: workTitle(pack), ...evidenceFacts(pack), next: pack.next || '' };
}

export async function setPackNextAction(workId: string): Promise<{ saved: true; pack: DemoPack; receipt: DemoReceipt; state: DemoState }> {
	const written = await saveBrowserState((state) => {
		requireNextActionTarget(state, workId);
		let approved;
		try {
			approved = approvePendingDraft(state, workId, {
				projectPack: pendingPackProjection,
				nextPath: nextChoiceForwardPath
			});
		} catch (error) {
			throw new ChallengeStateError(error instanceof Error ? error.message : 'Pending approval could not be saved.');
		}
		const pack = approved.pack;
		const summary = `Next action set to "${pack.next || 'open'}".`;
		const receipt: DemoReceipt = { summary, pack };
		state.selectedId = pack.id;
		state.status = summary;
		state.actionReceipt = receipt;
	});
	if (!written?.actionReceipt?.pack) throw new ChallengeStateError('Pending next action was not saved.');
	return { saved: true, pack: written.actionReceipt.pack, receipt: written.actionReceipt, state: written };
}

function cloneState(state: DemoState): DemoState {
	try {
		const clone = JSON.parse(JSON.stringify(state)) as unknown;
		assertDemoState(clone);
		return clone;
	} catch (error) {
		if (error instanceof ChallengeStateError) throw error;
		throw new ChallengeStateError('Workspace data could not be copied for a local save.');
	}
}

type DemoStateSnapshot = { state: DemoState; revision: string };

function readStoredStateUnlocked(): DemoStateSnapshot | null {
	let serialized: string | null;
	try {
		serialized = localStorage.getItem(STORAGE_KEY);
	} catch {
		throw new ChallengeStateError('Browser storage is unavailable. Local changes cannot be loaded.');
	}
	let result: { envelope: { state: DemoState; revision: string }; migrated: boolean; recovered?: boolean } | null;
	try {
		result = readStateEnvelope(serialized, {
			assertState: assertDemoState,
			migrateLegacyState,
			createRevision: createStorageRevision,
			recoverState: recoverPersistedState
		}) as { envelope: { state: DemoState; revision: string }; migrated: boolean; recovered?: boolean } | null;
	} catch (error) {
		if (error instanceof ChallengeStateError) throw error;
		if (error instanceof SyntaxError) {
			throw new ChallengeStateError('Saved workspace data is invalid JSON. Clear this site\'s local data to restart.');
		}
		throw new ChallengeStateError(error instanceof Error ? error.message : 'Saved workspace data is invalid.');
	}
	if (!result) return null;
	if (result.migrated || result.recovered) {
		try {
			if (localStorage.getItem(STORAGE_KEY) !== serialized) {
				throw new ChallengeStateError('Workspace changed by another tab. Refresh this tab and try again.');
			}
			localStorage.setItem(STORAGE_KEY, JSON.stringify(result.envelope));
		} catch (error) {
			if (error instanceof ChallengeStateError) throw error;
			throw new ChallengeStateError('Browser storage is full or unavailable. Existing workspace data could not be migrated.');
		}
	}
	return { state: result.envelope.state, revision: result.envelope.revision };
}

function withStateStorageLock<T>(operation: () => T | Promise<T>): Promise<T> {
	if (!globalThis.navigator?.locks?.request) {
		throw new ChallengeStateError('This browser cannot coordinate safe workspace writes across tabs.');
	}
	return withExclusiveStateStorageLock(globalThis.navigator.locks, STORAGE_LOCK_NAME, operation) as Promise<T>;
}

function readStoredState(): Promise<DemoStateSnapshot | null> {
	return withStateStorageLock(readStoredStateUnlocked);
}

function persistState(state: DemoState, expectedRevision: string | null): DemoStateSnapshot {
	let currentSerialized: string | null;
	try {
		currentSerialized = localStorage.getItem(STORAGE_KEY);
	} catch {
		throw new ChallengeStateError('Browser storage is unavailable. Local changes cannot be saved.');
	}
	let envelope: { state: DemoState; revision: string };
	try {
		envelope = nextStateEnvelope({
			serialized: currentSerialized,
			expectedRevision,
			state,
			assertState: assertDemoState,
			migrateLegacyState,
			createRevision: createStorageRevision
		}) as { state: DemoState; revision: string };
	} catch (error) {
		if (error instanceof ChallengeStateError) throw error;
		if (error instanceof TypeError && error.message === 'Workspace revision conflict.') {
			throw new ChallengeStateError('Workspace changed by another tab. Refresh this tab and try again.');
		}
		throw new ChallengeStateError('Workspace data could not be serialized for a local save.');
	}
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
	} catch {
		throw new ChallengeStateError('Browser storage is full or unavailable. The change was not saved.');
	}
	return { state: envelope.state, revision: envelope.revision };
}

async function loadSeedState(): Promise<DemoState> {
	let response: Response;
	try {
		response = await fetch(SEED_URL, { cache: 'no-store' });
	} catch {
		throw new ChallengeStateError('Could not load the bundled workspace data.');
	}
	if (!response.ok) {
		throw new ChallengeStateError(`Could not load the bundled workspace data (${response.status}).`);
	}
	let source: unknown;
	try {
		source = await response.json();
	} catch {
		throw new ChallengeStateError('The bundled workspace data is invalid JSON.');
	}
	if (!Array.isArray(source)) {
		throw new ChallengeStateError('The bundled workspace data is not a work-item list.');
	}
	const state: DemoState = { packs: rebaseSeedPacks(source as DemoPack[]) };
	assertDemoState(state);
	return state;
}

async function runDemoStateRefresh(): Promise<DemoState | null> {
	const startingRevision = stateRevision;
	demoStateLoading.set(true);
	try {
		const stored = await readStoredState();
		const state = stored?.state ?? (await loadSeedState());
		if (startingRevision !== stateRevision) return get(demoState);
		installDemoState(state, stored?.revision ?? null);
		return state;
	} catch (error) {
		if (startingRevision !== stateRevision) return get(demoState);
		demoStateError.set(errorMessage(error, 'Could not load workspace data.'));
		return null;
	} finally {
		if (startingRevision === stateRevision) demoStateLoading.set(false);
	}
}

function replaceDemoState(state: DemoState, revision: string | null): DemoState {
	stateRevision += 1;
	return installDemoState(state, revision);
}

export function displayToast(
	message: string,
	kind: 'info' | 'error' | 'success' = 'info'
): void {
	if (!browser) return;
	const id = `toast-${++toastCounter}`;
	toasts.update((items) => [...items, { id, message, kind }]);
}

export async function refreshDemoState(
	{ reuseRecent = false }: { reuseRecent?: boolean } = {}
): Promise<DemoState | null> {
	if (!browser) return null;
	const current = get(demoState);
	if (reuseRecent && current) return current;
	if (refreshFlight) return refreshFlight;
	refreshFlight = runDemoStateRefresh();
	try {
		return await refreshFlight;
	} finally {
		refreshFlight = null;
	}
}

/**
 * Restore the bundled live sample only after a person explicitly requests it.
 * This stays in the single browser-state owner: it clears this demo's local
 * workspace snapshot, then replaces the live view with the immutable seed.
 */
export async function resetDemoSampleState(): Promise<DemoState | null> {
	if (!browser) return null;
	stateRevision += 1;
	try {
		return await withStateStorageLock(() => resetPersistedState({
			remove: () => localStorage.removeItem(STORAGE_KEY),
			loadSeed: loadSeedState,
			install: (state) => replaceDemoState(state, null)
		}));
	} catch (error) {
		if (error instanceof ChallengeStateError) throw error;
		throw new ChallengeStateError('Browser storage is unavailable. The live sample could not be reset.');
	}
}

export async function saveBrowserState(
	mutate: (state: DemoState) => void,
	signal?: AbortSignal
): Promise<DemoState | null> {
	if (!browser) return null;
	signal?.throwIfAborted();
	const current = get(demoState) ?? (await refreshDemoState());
	if (!current) return null;
	const next = cloneState(current);
	mutate(next);
	const expectedRevision = storageRevision;
	try {
		const written = await withStateStorageLock(() => {
			signal?.throwIfAborted();
			return persistState(next, expectedRevision);
		});
		return replaceDemoState(written.state, written.revision);
	} catch (error) {
		if (signal?.aborted) throw error;
		if (error instanceof ChallengeStateError && error.message === 'Workspace changed by another tab. Refresh this tab and try again.') {
			const latest = await readStoredState();
			if (latest) replaceDemoState(latest.state, latest.revision);
		}
		throw error;
	}
}

function requireExecutionPack(state: DemoState, packId: string): DemoPack {
	const pack = state.packs.find((candidate) => candidate.id === packId);
	if (!pack) throw new ChallengeStateError('The task for this execution was not found.');
	return pack;
}

function executionEligibilityError(pack: DemoPack): string | null {
	if (pack.archived) return 'Archived tasks cannot be run.';
	if (pack.status === 'done') return 'Completed tasks cannot be run.';
	if (pack.status !== 'draft' && pack.status !== 'active') return 'Only draft or active tasks can be run.';
	if (normalizeStoredBlocker(pack.blocker) !== DEMO_BLOCKER_NONE) return 'Resolve this task’s blocker before running it.';
	if (typeof pack.blockedBy === 'string' && pack.blockedBy.trim()) return 'Resolve this task’s dependency before running it.';
	if (!String(pack.nextStep || '').trim()) return 'Add a next step before running this task.';
	if (!String(pack.doneWhen || '').trim()) return 'Add completion criteria before running this task.';
	return null;
}

export function buildExecutionRunInput(pack: DemoPack, requestedModel: string): RunInput {
	const eligibilityError = executionEligibilityError(pack);
	if (eligibilityError) throw new ChallengeStateError(eligibilityError);
	try {
		const currentStatus = pack.status === 'draft' ? 'draft' : 'active';
		return validateRunInput({
			version: RUN_VERSION,
			packId: pack.id,
			pack: projectTask(pack),
			currentStatus,
			context: [],
			requestedModel,
			...validateToolRequirements(pack.executionInputs ?? null, pack.executionOutputs ?? null),
			consent: true
		});
	} catch (error) {
		throw new ChallengeStateError(error instanceof Error ? error.message : 'The task execution input is invalid.');
	}
}

export function executionRunMatchesCurrentTask(pack: DemoPack, reference = pack.executionRun): boolean {
	if (!reference || reference.input.packId !== pack.id) return false;
	try {
		if (pack.status !== 'draft' && pack.status !== 'active') return false;
		// Historical snapshots never authorized fields introduced by a later writer.
		if (reference.input.version === 'browser-tool.v1' && pack.executionInputs != null) return false;
		if (reference.input.version !== RUN_VERSION && pack.executionOutputs != null) return false;
		const requirements = validateToolRequirements(pack.executionInputs ?? null, pack.executionOutputs ?? null);
		const current = validateRunInput({
			...reference.input,
			pack: projectTask(pack),
			currentStatus: pack.status,
			...(reference.input.version !== 'browser-tool.v1' ? { requiredInputFormats: requirements.requiredInputFormats } : {}),
			...(reference.input.version === RUN_VERSION ? { requiredOutputs: requirements.requiredOutputs } : {})
		});
		return executionInputMatches(current, reference.input);
	} catch {
		return false;
	}
}

export async function reserveExecutionRunReference(
	packId: string,
	reference: DemoExecutionRunReference
): Promise<DemoPack> {
	assertExecutionRunReference(reference, packId);
	if (reference.input.version !== RUN_VERSION) throw new ChallengeStateError('Review the current input requirements before reserving a new run.');
	if (reference.record !== null) throw new ChallengeStateError('A new task execution must be reserved before it has a server record.');
	const written = await saveBrowserState((draft) => {
		const pack = requireExecutionPack(draft, packId);
		const eligibilityError = executionEligibilityError(pack);
		if (eligibilityError) throw new ChallengeStateError(eligibilityError);
		if ((draft.pendingNextActionDrafts || []).some((pending) => pending.workId === packId)) {
			throw new ChallengeStateError('Resolve the pending action draft before running this task.');
		}
		if (!executionRunMatchesCurrentTask(pack, reference)) {
			throw new ChallengeStateError('The task changed after the execution preview was prepared.');
		}
		const previous = pack.executionRun;
		if (pack.retiredExecutionRuns?.some((entry) => entry.reference.id === reference.id)) {
			throw new ChallengeStateError('A retired task execution id cannot be reused.');
		}
		if (previous && (!previous.record || !TERMINAL_RUN_STATUSES.includes(previous.record.status))) {
			throw new ChallengeStateError('Refresh or finish the current task execution before starting another.');
		}
		pack.executionRun = structuredClone(reference);
	});
	const pack = written?.packs.find((candidate) => candidate.id === packId);
	if (!pack) throw new ChallengeStateError('The task execution reference was not saved.');
	return pack;
}

export async function clearUnsentExecutionRunReference(
	packId: string,
	runId: string,
	runKey: string,
	inputValue: RunInput
): Promise<DemoPack> {
	let input: RunInput;
	try {
		input = validateRunInput(inputValue);
	} catch (error) {
		throw new ChallengeStateError(error instanceof Error ? error.message : 'The reserved task execution input is invalid.');
	}
	const written = await saveBrowserState((draft) => {
		const pack = requireExecutionPack(draft, packId);
		const reference = pack.executionRun;
		if (!reference || reference.id !== runId || reference.key !== runKey || reference.record !== null ||
			!executionInputMatches(reference.input, input)) {
			throw new ChallengeStateError('The unsent task execution reservation is no longer current.');
		}
		delete pack.executionRun;
	});
	const pack = written?.packs.find((candidate) => candidate.id === packId);
	if (!pack) throw new ChallengeStateError('The unsent task execution reservation was not cleared.');
	return pack;
}

export async function retireUnavailableExecutionRun(
	packId: string,
	referenceValue: DemoExecutionRunReference,
	ownerConfirmed: boolean,
	signal?: AbortSignal
): Promise<DemoPack> {
	if (ownerConfirmed !== true) throw new ChallengeStateError('Review and confirm local retirement before continuing.');
	const reviewed = structuredClone(referenceValue);
	assertExecutionRunReference(reviewed, packId);
	if (reviewed.record !== null) {
		throw new ChallengeStateError('Only an unresolved request can use local retirement.');
	}
	signal?.throwIfAborted();
	let notFound = false;
	try {
		await readRun(reviewed.id, reviewed.key, packId, signal);
	} catch (cause) {
		if (!(cause instanceof NebiusRunClientError && cause.status === 404 && cause.code === 'not_found')) throw cause;
		notFound = true;
	}
	if (!notFound) throw new ChallengeStateError('A server receipt is available. Refresh this saved run before taking another action.');
	signal?.throwIfAborted();
	const written = await saveBrowserState((draft) => {
		signal?.throwIfAborted();
		const pack = requireExecutionPack(draft, packId);
		const reference = pack.executionRun;
		if (!reference || reference.id !== reviewed.id || reference.key !== reviewed.key || reference.record !== null ||
			!executionInputMatches(reference.input, reviewed.input)) {
			throw new ChallengeStateError('The reviewed request is no longer current. Refresh before continuing.');
		}
		const history = pack.retiredExecutionRuns || [];
		if (history.length >= RETIRED_EXECUTION_RUN_LIMIT) {
			throw new ChallengeStateError('Local retirement history is full. Export a workspace backup; no saved history was removed.');
		}
		pack.retiredExecutionRuns = [...history, {
			reference: structuredClone(reference), retiredAt: new Date().toISOString(), reason: 'server_not_found'
		}];
		delete pack.executionRun;
	}, signal);
	const pack = written?.packs.find((candidate) => candidate.id === packId);
	if (!pack) throw new ChallengeStateError('The request was not retired locally.');
	return pack;
}

export async function saveExecutionRunRecord(
	packId: string,
	runId: string,
	runKey: string,
	value: unknown
): Promise<DemoPack> {
	let record: RunRecord;
	try {
		record = await validateRunIntegrity(value);
	} catch (error) {
		throw new ChallengeStateError(error instanceof Error ? error.message : 'The task execution record is invalid.');
	}
	const written = await saveBrowserState((draft) => {
		const pack = requireExecutionPack(draft, packId);
		const reference = pack.executionRun;
		if (!reference || reference.id !== runId || reference.key !== runKey) {
			throw new ChallengeStateError('A newer task execution is already saved for this task.');
		}
		if (record.id !== runId || record.packId !== packId || !executionInputMatchesRecord(reference.input, record)) {
			throw new ChallengeStateError('The task execution record does not match its authorized input.');
		}
		const stored = reference.record;
		if (stored) {
			const storedJson = JSON.stringify(stored);
			const incomingJson = JSON.stringify(record);
			if (storedJson === incomingJson) return;
			// Late provider evidence may enrich a stopped run without changing its
			// terminal outcome. Never reopen it or accept a different terminal status.
			if (TERMINAL_RUN_STATUSES.includes(stored.status) && record.status !== stored.status) return;
			const storedTime = Date.parse(stored.updatedAt);
			const incomingTime = Date.parse(record.updatedAt);
			if (incomingTime < storedTime) return;
			if (incomingTime === storedTime) {
				throw new ChallengeStateError('The task execution service returned different records with the same update time. Refresh again after the run advances.');
			}
		}
		reference.record = structuredClone(record);
	});
	const pack = written?.packs.find((candidate) => candidate.id === packId);
	if (!pack) throw new ChallengeStateError('The task execution record was not saved.');
	return pack;
}

export async function saveExecutionRunEvidence(packId: string, runId: string, runKey: string): Promise<DemoPack> {
	let current = get(demoState);
	if (!current) current = await refreshDemoState();
	const currentPack = current ? requireExecutionPack(current, packId) : null;
	const captured = currentPack?.executionRun;
	if (!currentPack || !captured || captured.id !== runId || captured.key !== runKey || !captured.record) {
		throw new ChallengeStateError('The saved task execution result is no longer current.');
	}
	if (captured.record.status !== 'ready' || !executionRunMatchesCurrentTask(currentPack, captured)) {
		throw new ChallengeStateError('This result cannot be attached because the current task no longer matches its run snapshot.');
	}
	let record: RunRecord;
	try {
		record = await validateRunIntegrity(captured.record);
	} catch (error) {
		throw new ChallengeStateError(error instanceof Error ? error.message : 'The task execution result failed its integrity check.');
	}
	const digest = await runFilesDigest(record.files);
	if (record.checks.at(-1)?.sourceDigest !== digest) throw new ChallengeStateError('The generated files do not match the checked source.');
	const evidence = `Nebius browser tool run ${record.id}: ready; model ${record.requestedModel}; observed agent-authored checks passed; source ${digest}; saved ${record.updatedAt}.`;
	const capturedFiles = JSON.stringify(record.files);
	const written = await saveBrowserState((draft) => {
		const pack = requireExecutionPack(draft, packId);
		const eligibilityError = executionEligibilityError(pack);
		if (eligibilityError) throw new ChallengeStateError(`Run evidence cannot be saved: ${eligibilityError}`);
		if ((draft.pendingNextActionDrafts || []).some((pending) => pending.workId === packId)) {
			throw new ChallengeStateError('Run evidence cannot be saved while this task has a pending action draft.');
		}
		const reference = pack.executionRun;
		if (!reference || reference.id !== runId || reference.key !== runKey || !reference.record ||
			reference.record.updatedAt !== record.updatedAt || JSON.stringify(reference.record.files) !== capturedFiles ||
			!executionRunMatchesCurrentTask(pack, reference)) {
			throw new ChallengeStateError('The task or execution result changed before the evidence could be saved.');
		}
		const existing = String(pack.completionEvidence || '').trim();
		if (existing.split('\n').includes(evidence)) return;
		const next = existing ? `${existing}\n${evidence}` : evidence;
		if (next.length > 2000) throw new ChallengeStateError('Completion evidence is full. Shorten it before saving this run reference.');
		pack.completionEvidence = next;
	});
	const pack = written?.packs.find((candidate) => candidate.id === packId);
	if (!pack) throw new ChallengeStateError('The task execution evidence was not saved.');
	return pack;
}

export async function approveProjectPlan(
	brief: string,
	plan: ProjectPlan,
	approvalId: string,
	source: 'manual' | 'nebius'
): Promise<{ project: DemoProject; tasks: DemoPack[]; state: DemoState }> {
	const written = await saveBrowserState((draft) => {
		const approved = createProjectPlanState(draft, { brief, plan, approvalId, source, createdAt: new Date().toISOString() });
		Object.assign(draft, approved.state);
		draft.status = `Approved ${approved.project.title} with ${approved.tasks.length} ${approved.tasks.length === 1 ? 'task' : 'tasks'}.`;
		draft.actionReceipt = { summary: draft.status, pack: approved.tasks[0] };
	});
	if (!written) throw new ChallengeStateError('Project plan could not be saved.');
	const project = written.projects?.find((item) => item.id === approvalId);
	if (!project) throw new ChallengeStateError('Approved project did not return a receipt.');
	return { project, tasks: written.packs.filter((pack) => pack.projectId === project.id), state: written };
}

export async function approveProjectReplan(
	snapshot: ProjectSnapshot,
	replan: ProjectReplan,
	source: 'manual' | 'nebius'
): Promise<{ state: DemoState; changedIds: string[] }> {
	// Capture copied values before a possible refresh/lock wait so reviewed inputs cannot drift.
	const captured = validateProjectSnapshot(snapshot);
	const reviewed = validateProjectReplan(replan, captured);
	let changedIds: string[] = [];
	const written = await saveBrowserState((draft) => {
		const approved = applyProjectReplanState(draft, { snapshot: captured, replan: reviewed, source });
		changedIds = approved.changedIds;
		Object.assign(draft, approved.state);
		for (const change of reviewed.changes) {
			const pack = draft.packs.find((item) => item.id === change.id)!;
			const summary = reviewed.summary ? ` Summary: ${reviewed.summary}` : '';
			// The approved summary (600) and reason (400) fit intact, including the
			// timestamp and labels, within the existing 2,000-character activity limit.
			appendActivity(pack, `Approved ${source === 'nebius' ? 'Nebius' : 'manual'} project update.${summary} Reason: ${change.reason}`, 1200);
		}
		draft.status = `Applied ${source === 'nebius' ? 'Nebius' : 'manual'} project update to ${changedIds.length} ${changedIds.length === 1 ? 'task' : 'tasks'}.`;
		const receipt = { summary: draft.status, source, changedCount: changedIds.length, projectId: captured.project.id };
		draft.actionReceipt = receipt;
	});
	if (!written) throw new ChallengeStateError('Project update could not be saved.');
	return { state: written, changedIds };
}

export async function selectProject(projectId: string | null): Promise<void> {
	const written = await saveBrowserState((draft) => {
		if (projectId !== null && !draft.projects?.some((project) => project.id === projectId)) throw new ChallengeStateError('Selected project was not found.');
		draft.selectedProjectId = projectId;
	});
	if (!written) throw new ChallengeStateError('Project selection could not be saved.');
}

export type WorkspaceImportMode = 'replace' | 'merge';
export type WorkspaceImportPreview = {
	packs: number;
	pendingApprovals: number;
	collisions: number;
	collisionIds: string[];
	serialized: string;
};

function portableState(state: DemoState): DemoState {
	const copy = cloneState(state);
	delete copy.status;
	copy.actionReceipt = null;
	delete copy.filter;
	delete copy.energyFilter;
	return copy;
}

export function exportWorkspaceState(): string {
	const state = get(demoState);
	if (!state) throw new ChallengeStateError('Workspace data is not loaded yet.');
	assertDemoState(state);
	const revision = storageRevision || createStorageRevision();
	return JSON.stringify({ schemaVersion: 1, revision, state: portableState(state) }, null, 2);
}

export function previewWorkspaceImport(serialized: string): WorkspaceImportPreview {
	if (typeof serialized !== 'string' || !serialized.trim()) throw new ChallengeStateError('Choose a workspace export file first.');
	try {
		const result = readStateEnvelope(serialized, {
			assertState: assertDemoState,
			migrateLegacyState,
			createRevision: createStorageRevision
		}) as { envelope: { state: DemoState }; migrated: boolean } | null;
		if (!result) throw new ChallengeStateError('The workspace export is empty.');
		const current = get(demoState);
		const existingIds = new Set(current?.packs.map((pack) => pack.id) || []);
		const imported = result.envelope.state;
		return {
			packs: imported.packs.length,
			pendingApprovals: imported.pendingNextActionDrafts?.length || 0,
			collisions: imported.packs.filter((pack) => existingIds.has(pack.id)).length,
			collisionIds: imported.packs.filter((pack) => existingIds.has(pack.id)).map((pack) => pack.id),
			serialized
		};
	} catch (error) {
		if (error instanceof ChallengeStateError) throw error;
		throw new ChallengeStateError(error instanceof Error ? error.message : 'The workspace export is invalid.');
	}
}

// A work ID is not proof that an item in a different backup is the same work.
// Refuse an ambiguous merge rather than silently attaching a pending approval
// to another item or dropping a draft with the same target ID.
function assertSafePendingApprovalMerge(current: DemoState, imported: DemoState): void {
	const currentIds = new Set(current.packs.map((pack) => pack.id));
	const additions = new Set(imported.packs.filter((pack) => !currentIds.has(pack.id)).map((pack) => pack.id));
	const currentPending = current.pendingNextActionDrafts || [];
	const importedPending = imported.pendingNextActionDrafts || [];
	const currentTargets = new Set(currentPending.map((item) => item.workId));
	for (const item of importedPending) {
		if (currentTargets.has(item.workId)) {
			throw new ChallengeStateError('Cannot merge pending approvals with the same work item ID. No workspace data was changed.');
		}
		if ([item.workId, ...item.evidence.map((fact) => fact.workId)].some((id) => currentIds.has(id))) {
			throw new ChallengeStateError('Cannot merge a pending approval that refers to an existing work item ID. No workspace data was changed.');
		}
	}
	for (const item of currentPending) {
		if ([item.workId, ...item.evidence.map((fact) => fact.workId)].some((id) => !currentIds.has(id) && additions.has(id))) {
			throw new ChallengeStateError('Cannot merge work that would attach to a missing pending approval reference. No workspace data was changed.');
		}
	}
}

export async function importWorkspaceState(
	serialized: string,
	mode: WorkspaceImportMode
): Promise<{ packs: number; skipped: number }> {
	if (mode !== 'replace' && mode !== 'merge') throw new ChallengeStateError('Choose replace or merge for workspace import.');
	previewWorkspaceImport(serialized);
	const parsed = readStateEnvelope(serialized, {
		assertState: assertDemoState,
		migrateLegacyState,
		createRevision: createStorageRevision
	}) as { envelope: { state: DemoState } };
	let packs = 0;
	let skipped = 0;
	await saveBrowserState((draft) => {
		const imported = portableState(parsed.envelope.state);
		if (mode === 'replace') {
			draft.packs = imported.packs;
			draft.projects = imported.projects || [];
			draft.selectedProjectId = imported.selectedProjectId ?? null;
			draft.pendingNextActionDrafts = imported.pendingNextActionDrafts || [];
			draft.manualOrder = imported.manualOrder || imported.packs.map((pack) => pack.id);
			packs = draft.packs.length;
		} else {
			assertSafePendingApprovalMerge(draft, imported);
			draft.projects = mergedProjectRecords(draft, imported);
			draft.selectedProjectId = draft.selectedProjectId ?? imported.selectedProjectId ?? null;
			const ids = new Set(draft.packs.map((pack) => pack.id));
			const additions = imported.packs.filter((pack) => !ids.has(pack.id));
			skipped = imported.packs.length - additions.length;
			draft.packs.push(...additions);
			draft.manualOrder = [
				...((draft.manualOrder as string[] | undefined) || draft.packs.filter((pack) => !additions.includes(pack)).map((pack) => pack.id)),
				...additions.map((pack) => pack.id)
			];
			const pending = draft.pendingNextActionDrafts || [];
			draft.pendingNextActionDrafts = [...pending, ...(imported.pendingNextActionDrafts || [])];
			packs = additions.length;
		}
		assertDemoState(draft);
		repairActiveSelection(draft);
		draft.status = mode === 'replace' ? `Workspace replaced with ${packs} work items.` : `Workspace merged with ${packs} new work items.`;
		draft.actionReceipt = { summary: draft.status };
	});
	return { packs, skipped };
}

function appendActivity(pack: DemoPack, detail: string, maxLength = 400): boolean {
	const entry = formatActivityEntry(detail, { maxLength });
	if (!entry) return false;
	pack.activity = [...(pack.activity || []).slice(-99), entry];
	return true;
}

function actionSignature(pack: DemoPack): string {
	return `${normalizeText(pack.status, 40) || 'unknown'}|${normalizeStoredBlocker(pack.blocker)}|${normalizeText(pack.next, 200)}`;
}

function actionSummary(pack: DemoPack, action: string, changed: boolean): string {
	const title = workTitle(pack);
	if (action === 'done') return changed ? `Done saved for ${title}.` : `Done already saved for ${title}.`;
	if (action === 'start') return changed ? `Started ${title}.` : `${title} is already active.`;
	if (action === 'unblock') return changed ? `Blocker cleared for ${title}.` : `Blocker already clear for ${title}.`;
	if (action === 'block') return changed ? `Blocker added for ${title}.` : `${title} is already blocked.`;
	if (action === 'open') return changed ? `Work path opened for ${title}.` : `Work path already open for ${title}.`;
	return changed ? `${action} saved for ${title}.` : `${action} is already saved for ${title}.`;
}

function proofActivity(pack: DemoPack): string {
	if (NEBIUS_EDITION) return pack.completionEvidence?.trim()
		? 'Marked done with supplied completion evidence.'
		: 'Marked done without supplied completion evidence.';
	const target = normalizeText(pack.doneWhen, 1000);
	return target ? `Proof saved: ${target}` : 'Finished work.';
}

export async function runPackAction(packId: string, rawAction: string): Promise<DemoReceipt | null> {
	const action = normalizeText(rawAction, 40).toLowerCase();
	if (!PACK_ACTIONS.has(action)) {
		throw new ChallengeStateError(`Unsupported work action: ${action || 'missing'}.`);
	}
	let current = get(demoState);
	if (!current) current = await refreshDemoState();
	if (!current) return null;
	if (!current.packs.some((pack) => pack.id === packId)) {
		displayToast('That work item is no longer in the current workspace state.', 'error');
		return null;
	}

	const written = await saveBrowserState((draft) => {
		const pack = draft.packs.find((item) => item.id === packId)!;
		const before = actionSignature(pack);
		const wasDone = pack.status === 'done';
		let changed = false;

		if (action === 'archive') {
			changed = pack.archived !== true;
			pack.archived = true;
			if (changed && pack.status !== 'done') appendActivity(pack, 'Archived.');
			draft.pendingNextActionDrafts = (draft.pendingNextActionDrafts || [])
				.filter((pending) => pending.workId !== pack.id);
		} else if (action === 'open') {
			changed = appendActivity(pack, 'Opened.');
		} else {
			Object.assign(pack, packActionEffect(pack, action));
			if (action === 'done') discardPendingDraft(draft, pack.id);
			changed = actionSignature(pack) !== before;
			if (changed) {
				const detail = action === 'start'
					? 'Started.'
					: action === 'unblock'
						? 'Blocker set to None.'
						: action === 'block'
							? 'Blocked.'
							: proofActivity(pack);
				appendActivity(pack, detail);
			}
		}

		const unblockedWorkIds = action === 'done' && !wasDone
			? unblockPacksBlockedBy(draft.packs, pack, { onActivity: appendActivity, workTitle }).map((item) => item.id)
			: [];
		const summary = [actionSummary(pack, action, changed), unblockedReceiptSentence(unblockedWorkIds.length)]
			.filter(Boolean)
			.join(' ');
		const receipt: DemoReceipt = { summary, pack, ...(action === 'done' ? { unblockedWorkIds } : {}) };
		draft.selectedId = action === 'archive' ? repairActiveSelection(draft) : pack.id;
		draft.status = summary;
		draft.actionReceipt = receipt;
	});
	const receipt = written?.actionReceipt || null;
	if (receipt?.summary) {
		displayToast(receipt.summary, 'success');
	}
	return receipt;
}

export type BatchPackAction = 'done' | 'start' | 'block' | 'delete';

export async function runPackBatchAction(
	selectedIds: string[],
	action: BatchPackAction
): Promise<{ receipt: DemoReceipt; appliedCount: number; skippedCount: number } | null> {
	let appliedCount = 0;
	let skippedCount = 0;
	const written = await saveBrowserState((draft) => {
		const plan = planBatchAction(draft.packs, selectedIds, action);
		if (plan.eligibleIds.length === 0) {
			throw new ChallengeStateError('None of the selected work items can use that batch action.');
		}
		appliedCount = plan.eligibleIds.length;
		skippedCount = plan.skippedCount;

		let secondarySummary = '';
		const unblockedWorkIds: string[] = [];
		if (action === 'delete') {
			const cleanup = removePacksAndReferences(draft, plan.eligibleIds);
			const effects = [
				cleanup.discardedDrafts ? `Discarded ${cleanup.discardedDrafts} orphaned pending ${cleanup.discardedDrafts === 1 ? 'draft' : 'drafts'}.` : '',
				cleanup.repairedDependencies ? `Repaired ${cleanup.repairedDependencies} ${cleanup.repairedDependencies === 1 ? 'dependency' : 'dependencies'}.` : ''
			].filter(Boolean);
			secondarySummary = effects.join(' ');
		} else {
			for (const id of plan.eligibleIds) {
				const pack = draft.packs.find((candidate) => candidate.id === id)!;
				const wasDone = pack.status === 'done';
				Object.assign(pack, packActionEffect(pack, action));
				if (action === 'done') discardPendingDraft(draft, pack.id);
				appendActivity(pack, action === 'start' ? 'Started.' : action === 'block' ? 'Blocked.' : proofActivity(pack));
				if (action === 'done' && !wasDone) {
					unblockedWorkIds.push(...unblockPacksBlockedBy(draft.packs, pack, { onActivity: appendActivity, workTitle }).map((item) => item.id));
				}
			}
		}

		const label = { done: 'done', start: 'started', block: 'blocked', delete: 'deleted' }[action];
		const completed = `${appliedCount} ${appliedCount === 1 ? 'item' : 'items'} ${label}.`;
		const skipped = skippedCount
			? `${skippedCount} ineligible ${skippedCount === 1 ? 'item was' : 'items were'} skipped.`
			: '';
		const summary = [completed, skipped, secondarySummary].filter(Boolean).join(' ');
		draft.status = summary;
		draft.actionReceipt = { summary, ...(action === 'done' ? { unblockedWorkIds: [...new Set(unblockedWorkIds)] } : {}) };
	});
	if (!written?.actionReceipt?.summary) return null;
	return { receipt: written.actionReceipt, appliedCount, skippedCount };
}

export async function createPack(payload: Record<string, unknown>): Promise<{
	pack: DemoPack;
	state: DemoState;
	undoToken: CreatedPackUndoToken;
}> {
	const fields = normalizedCreatePackFields(payload);
	if (!globalThis.crypto?.randomUUID) {
		throw new ChallengeStateError('This browser cannot create a collision-safe local work id.');
	}
	const id = `challenge-${globalThis.crypto.randomUUID()}`;
	const pack: DemoPack = {
		...fields,
		id,
		activity: [formatActivityEntry('Created.')],
		pinned: false,
		archived: false
	};
	let previousSelectedId: string | null = null;
	const state = await saveBrowserState((draft) => {
		previousSelectedId = typeof draft.selectedId === 'string' ? draft.selectedId : null;
		if (fields.projectId && !draft.projects?.some((project) => project.id === fields.projectId)) {
			throw new ChallengeStateError('Selected project was not found.');
		}
		if (fields.projectId && draft.packs.filter((candidate) => candidate.projectId === fields.projectId).length >= REPLAN_LIMITS.tasks) {
			throw new ChallengeStateError(`This project already has ${REPLAN_LIMITS.tasks} tasks. Choose another project or No project.`);
		}
		draft.packs.push(pack);
		try {
			assertProjectState(draft);
		} catch (error) {
			throw new ChallengeStateError(errorMessage(error, 'The selected project could not accept this work item.'));
		}
		const summary = `Created ${formatWorkTitle(fields.title)}.`;
		const receipt: DemoReceipt = { summary, pack };
		draft.selectedId = id;
		draft.status = summary;
		draft.actionReceipt = receipt;
	});
	if (!state?.actionReceipt?.pack) throw new ChallengeStateError('Created work did not return a receipt.');
	const created = state.packs.find((item) => item.id === id)!;
	displayToast(`Created: ${formatWorkTitle(created.title)}`, 'success');
	return {
		pack: created,
		state,
		undoToken: { packId: created.id, expectedSignature: createdPackSignature(created), previousSelectedId }
	};
}

function createdPackSignature(pack: DemoPack): string {
	return JSON.stringify(pack);
}

function assertCreatedPackUndoToken(token: CreatedPackUndoToken): void {
	if (!token || typeof token !== 'object' || Array.isArray(token) ||
		Object.keys(token).sort().join(',') !== 'expectedSignature,packId,previousSelectedId' ||
		typeof token.packId !== 'string' || !token.packId || typeof token.expectedSignature !== 'string' || !token.expectedSignature ||
		(token.previousSelectedId !== null && (typeof token.previousSelectedId !== 'string' || !token.previousSelectedId))) {
		throw new ChallengeStateError('Created work undo token is invalid.');
	}
}

export async function undoCreatedPack(token: CreatedPackUndoToken): Promise<{ state: DemoState }> {
	assertCreatedPackUndoToken(token);
	let removedTitle = '';
	const state = await saveBrowserState((draft) => {
		const index = draft.packs.findIndex((pack) => pack.id === token.packId);
		if (index < 0) throw new ChallengeStateError('Created work is no longer available to undo.');
		const pack = draft.packs[index];
		if (createdPackSignature(pack) !== token.expectedSignature) {
			throw new ChallengeStateError('Created work changed and can no longer be undone.');
		}
		if (draft.packs.some((candidate) => candidate.blockedBy === token.packId)) {
			throw new ChallengeStateError('Created work is now used by a dependency and can no longer be undone.');
		}
		if (draft.pendingNextActionDrafts?.some((pending) => pending.workId === token.packId ||
			pending.evidence.some((fact) => fact.workId === token.packId)) ||
			(Array.isArray(draft.manualOrder) && draft.manualOrder.includes(token.packId))) {
			throw new ChallengeStateError('Created work has new edits and can no longer be undone.');
		}
		removedTitle = formatWorkTitle(pack.title);
		const createdSummary = `Created ${removedTitle}.`;
		const undoSummary = `Undid creation of ${removedTitle}.`;
		const ownsReceipt = draft.actionReceipt?.pack?.id === token.packId &&
			createdPackSignature(draft.actionReceipt.pack) === token.expectedSignature;
		draft.packs.splice(index, 1);
		if (draft.selectedId === token.packId) {
			if (token.previousSelectedId && draft.packs.some((candidate) => candidate.id === token.previousSelectedId)) {
				draft.selectedId = token.previousSelectedId;
			} else {
				delete draft.selectedId;
			}
		}
		if (draft.status === createdSummary) draft.status = undoSummary;
		if (ownsReceipt) draft.actionReceipt = { summary: undoSummary };
	});
	if (!state) throw new ChallengeStateError('Workspace data is not available.');
	displayToast(`Creation undone: ${removedTitle}`, 'success');
	return { state };
}

function normalizedCreatePackFields(payload: Record<string, unknown>): NormalizedCreatePackFields {
	const unsupportedFields = Object.keys(payload).filter((field) => !CREATE_PACK_FIELDS.has(field)).sort();
	if (unsupportedFields.length > 0) {
		throw new ChallengeStateError(`Work creation does not support field "${unsupportedFields[0]}".`);
	}
	const title = normalizeWorkTitle(payload.title);
	if (!title || (typeof payload.title === 'string' && hasLoneSurrogate(payload.title))) {
		throw new ChallengeStateError('A work title is required and must be 200 characters or fewer.');
	}
	const requestedStatus = normalizeText(payload.status, 40) || 'draft';
	if (!VALID_PACK_STATUSES.has(requestedStatus)) {
		throw new ChallengeStateError('Work path status is not supported.');
	}
	const due = normalizeText(payload.due, 40);
	if (due && !parseDateOnly(due)) throw new ChallengeStateError('Work due date must be a valid calendar date.');
	const energy = normalizeText(payload.energy, 40);
	if (energy && !PACK_ENERGIES.includes(energy)) throw new ChallengeStateError('Work energy is not supported.');
	const owner = normalizeText(payload.owner, 120);
	const area = normalizeText(payload.area, 120);
	const type = normalizeText(payload.type, 120);
	const recurrence = normalizeText(payload.recurrence, 120);
	const purpose = normalizeText(payload.purpose, 1000);
	const nextStep = normalizeText(payload.nextStep, 2000);
	const doneWhen = normalizeText(payload.doneWhen, 1000);
	const memory = normalizeIntakeNotes(payload.notes);
	const sourceUrl = normalizeIntakeSourceUrl(payload.sourceUrl);
	let projectId: string | undefined;
	if (payload.projectId !== undefined && payload.projectId !== null) {
		if (typeof payload.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u.test(payload.projectId)) {
			throw new ChallengeStateError('Selected project is invalid.');
		}
		projectId = payload.projectId;
	}
	return {
		title,
		status: requestedStatus,
		blocker: normalizeStoredBlocker(payload.blocker),
		next: normalizeText(payload.next, 200) || (requestedStatus === 'active' ? 'Open' : 'Set next action'),
		...(owner ? { owner } : {}),
		...(area ? { area } : {}),
		...(type ? { type } : {}),
		...(due ? { due } : {}),
		...(energy ? { energy } : {}),
		...(recurrence ? { recurrence } : {}),
		...(purpose ? { purpose } : {}),
		...(nextStep ? { nextStep } : {}),
		...(doneWhen ? { doneWhen } : {}),
		...(memory.length ? { memory } : {}),
		...(sourceUrl ? { sources: [sourceUrl] } : {}),
		...(projectId ? { projectId } : {})
	};
}

function hasLoneSurrogate(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0)!;
		return codePoint >= 0xd800 && codePoint <= 0xdfff;
	});
}

function normalizeIntakeNotes(value: unknown): string[] {
	if (value === undefined || value === '') return [];
	if (typeof value !== 'string' || hasLoneSurrogate(value) || /[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)) {
		throw new ChallengeStateError('Work notes contain invalid characters.');
	}
	// The intake textarea is one string; each nonempty trimmed line becomes one
	// existing memory entry, using the same 50-by-2000 bounds as the task editor.
	const entries = value.split(/\r\n?|\n/u).map((entry) => entry.trim()).filter(Boolean);
	if (entries.length > 50 || entries.some((entry) => entry.length > 2000)) {
		throw new ChallengeStateError('Work notes must contain at most 50 nonempty lines of at most 2000 characters each.');
	}
	return entries;
}

function normalizeIntakeSourceUrl(value: unknown): string | undefined {
	if (value === undefined || value === '') return undefined;
	if (typeof value !== 'string' || hasLoneSurrogate(value) || value.length > 2000 || /\p{Cc}/u.test(value)) {
		throw new ChallengeStateError('Source link must be a valid HTTP or HTTPS URL of 2000 characters or fewer.');
	}
	const normalized = value.trim();
	if (!normalized) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new ChallengeStateError('Source link must be a valid HTTP or HTTPS URL of 2000 characters or fewer.');
	}
	if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
		throw new ChallengeStateError('Source link must use HTTP or HTTPS and must not contain credentials.');
	}
	return normalized;
}

export function packPathSignature(pack: DemoPack): string {
	return JSON.stringify({
		fields: Object.fromEntries(FORWARD_PATH_FIELDS.map((field) => [field, pack[field] ?? ''])),
		memory: pack.memory ?? [], sources: pack.sources ?? [], executionInputs: pack.executionInputs ?? null, executionOutputs: pack.executionOutputs ?? null
	});
}

export async function savePackPath(
	packId: string,
	values: Record<string, unknown>,
	expectedPathSignature?: string
): Promise<{ saved: true; pack: DemoPack; receipt: DemoReceipt; state: DemoState }> {
	const written = await saveBrowserState((draft) => {
		const pack = draft.packs.find((item) => item.id === packId);
		if (!pack) throw new ChallengeStateError('Work item was not found.');
		const before = packPathSignature(pack);
		const activityFields = [...FORWARD_PATH_FIELDS, 'memory', 'sources', 'executionInputs', 'executionOutputs'] as const;
		const beforeValues = new Map(activityFields.map((field) => [field, JSON.stringify(pack[field] ?? (field === 'executionInputs' || field === 'executionOutputs' ? null : field === 'memory' || field === 'sources' ? [] : ''))]));
		if (expectedPathSignature !== undefined && before !== expectedPathSignature) {
			throw new ChallengeStateError('Saved work changed while you were editing. Review it before saving.');
		}
		const statusBefore = normalizeText(pack.status, 40);
		const allowed = new Set<string>([...FORWARD_PATH_FIELDS, 'memory', 'sources', 'executionInputs', 'executionOutputs']);
		for (const field of Object.keys(values)) if (!allowed.has(field)) throw new ChallengeStateError(`Unsupported work detail: ${field}.`);
		if (Object.hasOwn(values, 'executionInputs') || Object.hasOwn(values, 'executionOutputs')) {
			const reference = pack.executionRun;
			if (pack.archived || pack.status === 'done') throw new ChallengeStateError('Only open tasks can change tool requirements.');
			if (reference && (!reference.record || !TERMINAL_RUN_STATUSES.includes(reference.record.status))) {
				throw new ChallengeStateError('Refresh or finish the current run before changing its input or output requirements.');
			}
			const requirements = validateToolRequirements(
				Object.hasOwn(values, 'executionInputs') ? values.executionInputs : pack.executionInputs ?? null,
				Object.hasOwn(values, 'executionOutputs') ? values.executionOutputs : pack.executionOutputs ?? null);
			if (Object.hasOwn(values, 'executionInputs')) pack.executionInputs = requirements.requiredInputFormats;
			if (Object.hasOwn(values, 'executionOutputs')) pack.executionOutputs = requirements.requiredOutputs;
		}

		for (const field of FORWARD_PATH_FIELDS) {
			if (!Object.prototype.hasOwnProperty.call(values, field)) continue;
			let value: string;
			if (field === 'title') {
				const title = normalizeWorkTitle(values[field]);
				if (title === null) {
					throw new ChallengeStateError('A work title is required and must be 200 characters or fewer.');
				}
				value = title;
			} else if (NEBIUS_EDITION && field === 'completionEvidence') {
				const raw = values[field];
				if (typeof raw !== 'string') throw new ChallengeStateError('Completion evidence must be text.');
				const lines = raw.replace(/\r\n?/gu, '\n');
				if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\ud800-\udfff]/u.test(lines)) {
					throw new ChallengeStateError('Completion evidence contains invalid text.');
				}
				value = lines.trim();
				if (value.length > 2000) throw new ChallengeStateError('Completion evidence must be 2000 characters or fewer.');
			} else if (NEBIUS_EDITION && field === 'doneWhen') {
				const raw = values[field];
				if (typeof raw !== 'string' || raw.length > FIELD_LIMITS.doneWhen) {
					throw new ChallengeStateError(`Completion criteria must be text of at most ${FIELD_LIMITS.doneWhen} characters.`);
				}
				value = normalizeText(raw, FIELD_LIMITS.doneWhen);
			} else {
				value = normalizeText(values[field], field === 'nextStep' || field === 'completionEvidence' ? 2000 : field === 'purpose' || field === 'doneWhen' ? 1000 : 200);
			}
			if (field === 'status') {
				if (!VALID_PACK_STATUSES.has(value)) throw new ChallengeStateError('Work path status is not supported.');
				pack.status = value;
			} else if (field === 'blocker') {
				pack.blocker = normalizeStoredBlocker(value);
				if (pack.blocker === DEMO_BLOCKER_NONE && !Object.prototype.hasOwnProperty.call(values, 'blockedBy')) {
					pack.blockedBy = '';
				}
			} else {
				pack[field] = value;
			}
		}
		for (const field of ['memory', 'sources'] as const) {
			if (!Object.prototype.hasOwnProperty.call(values, field)) continue;
			const entries = values[field];
			if (!Array.isArray(entries) || entries.length > 50 || entries.some((entry) =>
				typeof entry !== 'string' || !entry.trim() || entry.length > 2000 || /\p{Cc}/u.test(entry))) {
				throw new ChallengeStateError(`Work ${field} must contain at most 50 nonempty lines of at most 2000 characters each.`);
			}
			pack[field] = [...entries];
		}

		if (!Object.prototype.hasOwnProperty.call(values, 'status') && pack.status !== 'done') {
			pack.status = pack.blockedBy
				? 'blocked'
				: forwardPathStatusForBlocker(pack.status, pack.blocker, pack.next);
		}
		let unblockedWorkIds: string[] = [];
		if (statusBefore !== 'done' && pack.status === 'done') {
			pack.blocker = DEMO_BLOCKER_NONE;
			pack.blockedBy = '';
			discardPendingDraft(draft, pack.id);
			unblockedWorkIds = unblockPacksBlockedBy(draft.packs, pack, { onActivity: appendActivity, workTitle }).map((item) => item.id);
		}
		if (NEBIUS_EDITION) {
			const changedCount = activityFields.filter((field) => beforeValues.get(field) !== JSON.stringify(pack[field] ?? (field === 'executionInputs' || field === 'executionOutputs' ? null : field === 'memory' || field === 'sources' ? [] : ''))).length;
			if (changedCount) appendActivity(pack, `Saved changes to ${changedCount} task ${changedCount === 1 ? 'field' : 'fields'}.`);
		}
		const summary = [
			packPathSignature(pack) === before ? `${workTitle(pack)}: unchanged.` : `${workTitle(pack)}: path updated.`,
			unblockedReceiptSentence(unblockedWorkIds.length)
		].filter(Boolean).join(' ');
		const receipt: DemoReceipt = { summary, pack, ...(pack.status === 'done' ? { unblockedWorkIds } : {}) };
		draft.status = summary;
		draft.actionReceipt = receipt;
	});
	if (!written?.actionReceipt?.pack) throw new ChallengeStateError('Work path was not saved.');
	displayToast('Saved.', 'success');
	return {
		saved: true,
		pack: written.actionReceipt.pack,
		receipt: written.actionReceipt,
		state: written
	};
}

export async function togglePackPinned(packId: string): Promise<void> {
	await saveBrowserState((draft) => {
		const pack = draft.packs.find((item) => item.id === packId);
		if (pack) pack.pinned = !pack.pinned;
	});
	displayToast('Pin toggled.', 'success');
}

export async function setStateFilter(filter: string): Promise<void> {
	const value = normalizeText(filter, 40);
	if (!STATE_FILTERS.includes(value)) throw new ChallengeStateError('Work filter is not supported.');
	await saveBrowserState((draft) => {
		draft.filter = value;
	});
}

export async function setSelectedWork(selectedId: string): Promise<void> {
	let current = get(demoState);
	if (!current) current = await refreshDemoState();
	if (!current?.packs.some((pack) => pack.id === selectedId)) return;
	await saveBrowserState((draft) => {
		draft.selectedId = selectedId;
	});
}

export async function savePackBrowserFields(
	packId: string,
	mutate: (pack: DemoPack) => void
): Promise<DemoState | null> {
	return saveBrowserState((draft) => {
		const pack = draft.packs.find((item) => item.id === packId);
		if (pack) mutate(pack);
	});
}
