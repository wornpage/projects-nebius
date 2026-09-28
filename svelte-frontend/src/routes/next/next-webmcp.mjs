import {
	DECISION_WORKSPACE_CONTEXT,
	DECISION_WORKSPACE_CONTEXT_REASON,
	decisionWorkspaceContextDecider,
	exactWorkId
} from '../../lib/decision-workspace-navigation.mjs';

export const CURRENT_NEXT_EDITOR_TOOL_NAME = 'get_current_next_editor';
export const PREPARE_NEXT_ACTION_TOOL_NAME = 'prepare_next_action';
export const NEXT_EDITOR_PREVIEW_ID = 'next-action-preview';
export const NEXT_PREPARATION_RECEIPT_ID = 'next-preparation-receipt';
export const NEXT_PREPARATION_SUMMARY = 'Browser agent prepared an unsaved draft. No workspace data was saved.';
export const NEXT_ACTION_MAX_LENGTH = 200;

/** @returns {{ pending: boolean }} */
export function createNextDraftRevisionState() {
	return { pending: false };
}

/**
 * Keep the visible editor and its one durable pending draft in one ordered
 * revision. Rejected persistence restores the captured page state before the
 * revision is released for another edit or terminal action.
 *
 * @template TSnapshot
 * @template TDraft
 * @param {{ pending: boolean }} revision
 * @param {{
 *   capture: () => TSnapshot,
 *   preview: () => void,
 *   persist: () => Promise<TDraft>,
 *   settle: (draft: TDraft) => void,
 *   rollback: (snapshot: TSnapshot) => void,
 *   reject: (error: unknown) => void
 * }} options
 * @returns {Promise<{ status: 'settled', draft: TDraft } | { status: 'busy' | 'rejected', draft: null }>}
 */
export async function reviseNextDraft(revision, { capture, preview, persist, settle, rollback, reject }) {
	if (revision.pending) return { status: 'busy', draft: null };
	const snapshot = capture();
	revision.pending = true;
	try {
		preview();
		const draft = await persist();
		settle(draft);
		return { status: 'settled', draft };
	} catch (error) {
		rollback(snapshot);
		reject(error);
		return { status: 'rejected', draft: null };
	} finally {
		revision.pending = false;
	}
}

/**
 * @param {{ pending: boolean }} revision
 * @param {{ busy: boolean, stale: boolean, choice: string, mode: 'preset' | 'custom', draft: { choice: string, mode: 'preset' | 'custom' } | null }} editor
 * @returns {boolean}
 */
export function nextDraftTerminalAvailable(revision, { busy, stale, choice, mode, draft }) {
	return !revision.pending && !busy && !stale && Boolean(
		draft && choice && draft.choice === choice && draft.mode === mode
	);
}

/**
 * Execute Save or Discard only with the exact settled draft that passed the
 * route gate. The callback receives that consumed draft for truthful lineage.
 *
 * @template TDraft
 * @template TResult
 * @param {{ pending: boolean }} revision
 * @param {{
 *   busy: boolean,
 *   stale: boolean,
 *   choice: string,
 *   mode: 'preset' | 'custom',
 *   draft: TDraft & { choice: string, mode: 'preset' | 'custom' } | null,
 *   start?: () => void,
 *   finish?: () => void,
 *   action: (draft: TDraft) => Promise<TResult>
 * }} options
 * @returns {Promise<{ executed: false, draft: null, result: null } | { executed: true, draft: TDraft, result: TResult }>}
 */
export async function runSettledNextDraftAction(revision, { busy, stale, choice, mode, draft, start, finish, action }) {
	if (!draft || !nextDraftTerminalAvailable(revision, { busy, stale, choice, mode, draft })) {
		return { executed: false, draft: null, result: null };
	}
	const consumedDraft = draft;
	start?.();
	try {
		return { executed: true, draft: consumedDraft, result: await action(consumedDraft) };
	} finally {
		finish?.();
	}
}

/** @param {{ preparationInFlight: boolean, pendingDraft: { workId: string, choice: string } | null, visibleWorkId: string, preparationReceipt: { preparedAction: string } | null }} input @returns {boolean} */
export function shouldHydratePendingDraft({ preparationInFlight, pendingDraft, visibleWorkId, preparationReceipt }) {
	if (preparationInFlight || !pendingDraft || pendingDraft.workId !== visibleWorkId) return false;
	return preparationReceipt?.preparedAction !== pendingDraft.choice;
}

const SINGLE_LINE_CONTROL = /\p{Cc}/u;
const PREPARE_INPUT_KEYS = ['choice', 'expectedMode', 'expectedChoice', 'evidence'];
const EVIDENCE_INPUT_KEYS = ['workId', 'field', 'expectedValue'];
const EVIDENCE_FIELDS = ['workflow', 'blocker'];
const EVIDENCE_FIELD_LABELS = Object.freeze({ workflow: 'Workflow', blocker: 'Blocker' });
const MAX_EVIDENCE_REFERENCES = 3;

/** @typedef {'preset' | 'custom'} NextEditorMode */
/** @typedef {'workflow' | 'blocker'} NextEvidenceField */
/** @typedef {{ id: string, title: string }} NextEditorWork */
/** @typedef {{ mode: NextEditorMode, choice: string }} NextEditorChoice */
/** @typedef {{ blocker: string | null, nextAction: string }} NextEditorPreview */
/** @typedef {{ mode: 'decision-workspace', reason: string, decider: string | null }} NextDecisionContext */
/** @typedef {{ workId: string, field: NextEvidenceField, expectedValue: string | null }} NextEvidenceReference */
/** @typedef {{ id: string, title: string, workflow: string, blocker: string | null }} NextEvidenceWork */
/** @typedef {{ work: NextEditorWork, field: NextEvidenceField, label: string, value: string | null }} NextVerifiedEvidence */
/** @typedef {{ summary: string, work: NextEditorWork, evidenceNote: string, evidence: NextVerifiedEvidence[], preparedAction: string, workspaceChanged: false, requiresHumanSave: true }} NextPreparationReceipt */
/** @typedef {{ work: NextEditorWork, decisionContext: NextDecisionContext | null, presetChoices: string[], editor: NextEditorChoice, preview: NextEditorPreview, preparationReceipt: NextPreparationReceipt | null, canSave: boolean, busy: boolean, staleReason: string | null }} NextEditorView */
/** @typedef {{ choice: string, expectedMode: NextEditorMode, expectedChoice: string, evidence: NextEvidenceReference[] }} PrepareNextActionInput */
/** @typedef {{ changed: boolean, focus: { id: string, focused: boolean, focusVisible: boolean, inViewport: boolean, pulsed: boolean }, next: NextEditorView }} PrepareNextActionReceipt */
/** @typedef {{ markMutated: () => void }} PrepareNextActionInvocation */

/**
 * Project only the current work item, choices, editor state, and preview already
 * rendered on Next. The human-owned Save command is intentionally outside this
 * projection and remains the only workspace mutation path.
 *
 * @param {unknown} input
 * @returns {NextEditorView | null}
 */
export function nextEditorPageView(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	if (typeof candidate.canSave !== 'boolean' || typeof candidate.busy !== 'boolean' || (candidate.staleReason !== null && typeof candidate.staleReason !== 'string')) return null;
	const work = nextEditorWork(candidate.work);
	if (!Object.hasOwn(candidate, 'decisionContext')) return null;
	const decisionContext = candidate.decisionContext === null
		? null
		: nextDecisionContext(candidate.decisionContext);
	const presetChoices = nextEditorPresetChoices(candidate.presetChoices);
	const editor = nextEditorChoice(candidate.editor);
	const preview = nextEditorPreview(candidate.preview);
	if (!Object.hasOwn(candidate, 'preparationReceipt')) return null;
	const preparationReceipt = candidate.preparationReceipt === null
		? null
		: nextPreparationReceipt(candidate.preparationReceipt);
	if (!work || (candidate.decisionContext !== null && !decisionContext) || !presetChoices || !editor || !preview || (candidate.preparationReceipt !== null && !preparationReceipt)) return null;
	if (editor.mode === 'preset' && (!editor.choice || !presetChoices.includes(editor.choice))) return null;
	if (candidate.canSave !== (Boolean(editor.choice) && !candidate.busy && candidate.staleReason === null)) return null;
	if (
		preparationReceipt &&
		(preparationReceipt.work.id !== work.id ||
			preparationReceipt.work.title !== work.title ||
			preparationReceipt.preparedAction !== editor.choice)
	) return null;
	return {
		work,
		decisionContext,
		presetChoices,
		editor,
		preview,
		preparationReceipt,
		canSave: candidate.canSave,
		busy: candidate.busy,
		staleReason: candidate.staleReason
	};
}

/** @param {() => NextEditorView | null} getEditor */
export function createCurrentNextEditorTool(getEditor) {
	if (typeof getEditor !== 'function') throw new TypeError('Next WebMCP requires a current editor getter.');
	return {
		name: CURRENT_NEXT_EDITOR_TOOL_NAME,
		title: 'Get current Next editor',
		description: 'Read the exact current work item, visible Decision Workspace context when present, choices, unsaved editor, and preview shown on Next. This does not change or save the editor.',
		inputSchema: {
			type: 'object',
			properties: {},
			additionalProperties: false
		},
		annotations: {
			readOnlyHint: true,
			openWorldHint: false,
			untrustedContentHint: true
		},
		/** @param {unknown} input @param {{ signal?: AbortSignal }} [options] */
		async execute(input, options = {}) {
			options.signal?.throwIfAborted();
			requireEmptyInput(input);
			return cloneNextEditorView(getEditor());
		}
	};
}

/**
 * @template Snapshot
 * @param {(input: PrepareNextActionInput, invocation: PrepareNextActionInvocation) => Promise<PrepareNextActionReceipt>} prepareNextAction
 * @param {{ capture: () => Snapshot, restore: (snapshot: Snapshot) => unknown } | undefined} [transaction]
 */
export function createPrepareNextActionTool(prepareNextAction, transaction) {
	if (typeof prepareNextAction !== 'function') throw new TypeError('Next WebMCP requires a next-action preparer.');
	if (transaction !== undefined && (typeof transaction.capture !== 'function' || typeof transaction.restore !== 'function')) {
		throw new TypeError('Next WebMCP preparation transactions require capture and restore functions.');
	}
	return {
		name: PREPARE_NEXT_ACTION_TOOL_NAME,
		title: 'Prepare next-action preview',
		description: 'Prepare a durable browser-local pending next-action draft from one to three exact Work or Review facts. The page rejects stale or mismatched facts, generates the visible evidence note from the verified values, and never saves or writes workspace data fields. A person must later approve the draft; failed or aborted preparation restores its prior pending draft state.',
		inputSchema: {
			type: 'object',
			properties: {
				choice: { type: 'string', minLength: 1, maxLength: NEXT_ACTION_MAX_LENGTH, description: 'Preset label or custom next action to preview.' },
				expectedMode: { type: 'string', enum: ['preset', 'custom'], description: 'Editor mode returned by the latest current-editor read.' },
				expectedChoice: { type: 'string', maxLength: NEXT_ACTION_MAX_LENGTH, description: 'Editor choice returned by the latest current-editor read.' },
				evidence: {
					type: 'array',
					minItems: 1,
					maxItems: MAX_EVIDENCE_REFERENCES,
					description: 'Exact facts previously read from Work or Review. At least one fact must reference the current work item.',
					items: {
						type: 'object',
						properties: {
							workId: { type: 'string', minLength: 1, description: 'Exact work item id returned by Work or Review.' },
							field: { type: 'string', enum: EVIDENCE_FIELDS, description: 'Exact projected field being cited.' },
							expectedValue: {
								anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }],
								description: 'Exact field value returned by Work or Review; null is the canonical absent blocker.'
							}
						},
						required: EVIDENCE_INPUT_KEYS,
						additionalProperties: false
					}
				}
			},
			required: PREPARE_INPUT_KEYS,
			additionalProperties: false
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
			untrustedContentHint: true
		},
		/** @param {unknown} input @param {{ signal?: AbortSignal }} [options] */
		async execute(input, options = {}) {
			const snapshot = transaction?.capture();
			let mutated = false;
			try {
				options.signal?.throwIfAborted();
				const fields = prepareNextActionInput(input);
				const receipt = prepareNextActionReceipt(
					await prepareNextAction(fields, { markMutated: () => { mutated = true; } }),
					fields.choice,
					fields.evidence
				);
				options.signal?.throwIfAborted();
				return receipt;
			} catch (error) {
				if (mutated && transaction) await transaction.restore(/** @type {Snapshot} */ (snapshot));
				throw error;
			}
		}
	};
}

/** @param {unknown} input @returns {NextEditorWork | null} */
function nextEditorWork(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const id = exactWorkId(candidate.id);
	const title = pageText(candidate.title, 200);
	return id && title ? { id, title } : null;
}

/** @param {unknown} input @returns {NextDecisionContext | null} */
function nextDecisionContext(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const decider = candidate.decider === null ? null : decisionWorkspaceContextDecider(candidate.decider);
	if (
		candidate.mode !== DECISION_WORKSPACE_CONTEXT ||
		candidate.reason !== DECISION_WORKSPACE_CONTEXT_REASON ||
		(candidate.decider !== null && !decider)
	) return null;
	return {
		mode: DECISION_WORKSPACE_CONTEXT,
		reason: DECISION_WORKSPACE_CONTEXT_REASON,
		decider
	};
}

/** @param {unknown} input @returns {string[] | null} */
function nextEditorPresetChoices(input) {
	if (!Array.isArray(input) || input.length === 0) return null;
	const choices = input.map((value) => pageText(value, NEXT_ACTION_MAX_LENGTH));
	if (choices.some((value) => !value)) return null;
	const normalized = /** @type {string[]} */ (choices);
	return new Set(normalized).size === normalized.length ? normalized : null;
}

/** @param {unknown} input @returns {NextEditorChoice | null} */
function nextEditorChoice(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	if (candidate.mode !== 'preset' && candidate.mode !== 'custom') return null;
	const choice = pageText(candidate.choice, NEXT_ACTION_MAX_LENGTH, true);
	return choice === null ? null : { mode: candidate.mode, choice };
}

/** @param {unknown} input @returns {NextEditorPreview | null} */
function nextEditorPreview(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const blocker = candidate.blocker === null ? null : pageText(candidate.blocker, 200);
	const nextAction = pageText(candidate.nextAction, NEXT_ACTION_MAX_LENGTH);
	if ((candidate.blocker !== null && !blocker) || !nextAction) return null;
	return { blocker, nextAction };
}

/** @param {unknown} input @returns {NextPreparationReceipt | null} */
function nextPreparationReceipt(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const work = nextEditorWork(candidate.work);
	const evidence = nextVerifiedEvidenceList(candidate.evidence);
	const evidenceNote = evidence ? verifiedNextEvidenceNote(evidence) : '';
	const preparedAction = pageText(candidate.preparedAction, NEXT_ACTION_MAX_LENGTH);
	if (
		candidate.summary !== NEXT_PREPARATION_SUMMARY || !work || !evidence ||
		candidate.evidenceNote !== evidenceNote || !preparedAction ||
		candidate.workspaceChanged !== false || candidate.requiresHumanSave !== true
	) return null;
	return {
		summary: NEXT_PREPARATION_SUMMARY,
		work,
		evidenceNote,
		evidence,
		preparedAction,
		workspaceChanged: false,
		requiresHumanSave: true
	};
}

/** @param {unknown} input */
function requireEmptyInput(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0) {
		throw new TypeError('Next current editor requires an empty object.');
	}
}

/** @param {unknown} input @returns {PrepareNextActionInput} */
function prepareNextActionInput(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new TypeError('Prepare next action requires an object input.');
	}
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const keys = Object.keys(candidate);
	if (keys.some((key) => !PREPARE_INPUT_KEYS.includes(key))) {
		throw new TypeError('Prepare next action accepts only choice, expectedMode, expectedChoice, and evidence.');
	}
	if (!PREPARE_INPUT_KEYS.every((key) => Object.hasOwn(candidate, key))) {
		throw new TypeError('Prepare next action requires choice, expectedMode, expectedChoice, and evidence.');
	}
	if (typeof candidate.choice !== 'string') throw new TypeError('choice must be a string.');
	if (typeof candidate.expectedChoice !== 'string') throw new TypeError('expectedChoice must be a string.');
	if (candidate.expectedMode !== 'preset' && candidate.expectedMode !== 'custom') {
		throw new TypeError('expectedMode must be preset or custom.');
	}
	if (SINGLE_LINE_CONTROL.test(candidate.choice)) throw new TypeError('choice cannot contain control characters.');
	if (SINGLE_LINE_CONTROL.test(candidate.expectedChoice)) throw new TypeError('expectedChoice cannot contain control characters.');
	const choice = candidate.choice.trim();
	const expectedChoice = candidate.expectedChoice.trim();
	if (!choice) throw new TypeError('choice cannot be empty.');
	if (choice.length > NEXT_ACTION_MAX_LENGTH) throw new TypeError(`choice must be ${NEXT_ACTION_MAX_LENGTH} characters or fewer.`);
	if (expectedChoice.length > NEXT_ACTION_MAX_LENGTH) throw new TypeError(`expectedChoice must be ${NEXT_ACTION_MAX_LENGTH} characters or fewer.`);
	const evidence = nextEvidenceReferenceList(candidate.evidence);
	if (!evidence) {
		throw new TypeError(`evidence must contain one to ${MAX_EVIDENCE_REFERENCES} unique exact work facts.`);
	}
	return { choice, expectedMode: candidate.expectedMode, expectedChoice, evidence };
}

/** @param {unknown} input @param {string} choice @param {NextEvidenceReference[]} references @returns {PrepareNextActionReceipt} */
function prepareNextActionReceipt(input, choice, references) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new TypeError('Prepare next action did not return a verifiable page receipt.');
	}
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const next = cloneNextEditorView(candidate.next);
	const focus = candidate.focus;
	const expectedMode = next?.presetChoices.includes(choice) ? 'preset' : 'custom';
	if (
		typeof candidate.changed !== 'boolean' || !next || next.busy || !next.canSave ||
		!focus || typeof focus !== 'object' || Array.isArray(focus) ||
		/** @type {Record<string, unknown>} */ (focus).id !== NEXT_PREPARATION_RECEIPT_ID ||
		/** @type {Record<string, unknown>} */ (focus).focused !== true ||
		/** @type {Record<string, unknown>} */ (focus).focusVisible !== true ||
		/** @type {Record<string, unknown>} */ (focus).inViewport !== true ||
		/** @type {Record<string, unknown>} */ (focus).pulsed !== true
	) {
		throw new TypeError('Prepare next action did not return a verifiable page receipt.');
	}
	if (next.editor.mode !== expectedMode || next.editor.choice !== choice) {
		throw new TypeError('Prepare next action did not preserve the prepared choice.');
	}
	if (
		!next.preparationReceipt ||
		!evidenceMatchesReferences(next.preparationReceipt.evidence, references) ||
		next.preparationReceipt.preparedAction !== choice
	) {
		throw new TypeError('Prepare next action did not preserve the visible evidence receipt.');
	}
	return {
		changed: candidate.changed,
		focus: {
			id: NEXT_PREPARATION_RECEIPT_ID,
			focused: true,
			focusVisible: true,
			inViewport: true,
			pulsed: true
		},
		next
	};
}

/**
 * Verify agent-supplied field/value references against the page's current,
 * normalized workspace facts. The returned values, not agent prose, are the
 * only source for the visible evidence note.
 *
 * @param {unknown} references
 * @param {unknown} workspace
 * @param {unknown} currentWorkId
 * @returns {NextVerifiedEvidence[]}
 */
export function verifyNextPreparationEvidence(references, workspace, currentWorkId) {
	const normalizedReferences = nextEvidenceReferenceList(references);
	const normalizedCurrentWorkId = exactWorkId(currentWorkId);
	if (!normalizedReferences || !normalizedCurrentWorkId) {
		throw new TypeError('Prepare next action requires valid evidence references and a current work item.');
	}
	if (!Array.isArray(workspace)) throw new TypeError('Prepare next action requires current workspace evidence.');
	const work = workspace.map(nextEvidenceWork);
	if (work.some((candidate) => !candidate)) {
		throw new TypeError('Prepare next action received malformed workspace evidence.');
	}
	const normalizedWork = /** @type {NextEvidenceWork[]} */ (work);
	if (new Set(normalizedWork.map((candidate) => candidate.id)).size !== normalizedWork.length) {
		throw new TypeError('Prepare next action received duplicate workspace evidence.');
	}
	if (!normalizedReferences.some((reference) => reference.workId === normalizedCurrentWorkId)) {
		throw new TypeError('Prepare next action evidence must include the current work item.');
	}
	return normalizedReferences.map((reference) => {
		const item = normalizedWork.find((candidate) => candidate.id === reference.workId);
		if (!item) throw new TypeError(`Prepare next action could not verify work item ${reference.workId}.`);
		const value = item[reference.field];
		if (value !== reference.expectedValue) {
			throw new TypeError(`Prepare next action rejected stale ${reference.field} evidence for ${reference.workId}.`);
		}
		return {
			work: { id: item.id, title: item.title },
			field: reference.field,
			label: EVIDENCE_FIELD_LABELS[reference.field],
			value
		};
	});
}

/** @param {unknown} input @returns {string} */
export function verifiedNextEvidenceNote(input) {
	const evidence = nextVerifiedEvidenceList(input);
	if (!evidence) throw new TypeError('Verified Next evidence note requires one to three exact facts.');
	return evidence.map((fact) => `${fact.work.title} — ${fact.label}: ${fact.value ?? 'None'}.`).join(' ');
}

/** @param {unknown} input @returns {NextEvidenceReference[] | null} */
function nextEvidenceReferenceList(input) {
	if (!Array.isArray(input) || input.length < 1 || input.length > MAX_EVIDENCE_REFERENCES) return null;
	const references = input.map(nextEvidenceReference);
	if (references.some((reference) => !reference)) return null;
	const normalized = /** @type {NextEvidenceReference[]} */ (references);
	const keys = normalized.map((reference) => `${reference.workId}\u0000${reference.field}`);
	return new Set(keys).size === keys.length ? normalized : null;
}

/** @param {unknown} input @returns {NextEvidenceReference | null} */
function nextEvidenceReference(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const keys = Object.keys(candidate);
	if (keys.length !== EVIDENCE_INPUT_KEYS.length || keys.some((key) => !EVIDENCE_INPUT_KEYS.includes(key))) return null;
	const workId = exactWorkId(candidate.workId);
	if (!workId || !EVIDENCE_FIELDS.includes(/** @type {string} */ (candidate.field))) return null;
	const field = /** @type {NextEvidenceField} */ (candidate.field);
	const absentBlocker = field === 'blocker' && candidate.expectedValue === null;
	const expectedValue = absentBlocker ? null : pageText(candidate.expectedValue, 200);
	if (!absentBlocker && expectedValue === null) return null;
	return { workId, field, expectedValue };
}

/** @param {unknown} input @returns {NextEvidenceWork | null} */
function nextEvidenceWork(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const id = exactWorkId(candidate.id);
	const title = pageText(candidate.title, 200);
	const workflow = pageText(candidate.workflow, 200);
	const absentBlocker = candidate.blocker === null;
	const blocker = absentBlocker ? null : pageText(candidate.blocker, 200);
	return id && title && workflow && (absentBlocker || blocker) ? { id, title, workflow, blocker } : null;
}

/** @param {unknown} input @returns {NextVerifiedEvidence[] | null} */
function nextVerifiedEvidenceList(input) {
	if (!Array.isArray(input) || input.length < 1 || input.length > MAX_EVIDENCE_REFERENCES) return null;
	const evidence = input.map(nextVerifiedEvidence);
	if (evidence.some((fact) => !fact)) return null;
	const normalized = /** @type {NextVerifiedEvidence[]} */ (evidence);
	const keys = normalized.map((fact) => `${fact.work.id}\u0000${fact.field}`);
	return new Set(keys).size === keys.length ? normalized : null;
}

/** @param {unknown} input @returns {NextVerifiedEvidence | null} */
function nextVerifiedEvidence(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const work = nextEditorWork(candidate.work);
	if (!work || !EVIDENCE_FIELDS.includes(/** @type {string} */ (candidate.field))) return null;
	const field = /** @type {NextEvidenceField} */ (candidate.field);
	const absentBlocker = field === 'blocker' && candidate.value === null;
	const value = absentBlocker ? null : pageText(candidate.value, 200);
	if (!absentBlocker && value === null) return null;
	if (candidate.label !== EVIDENCE_FIELD_LABELS[field]) return null;
	return { work, field, label: EVIDENCE_FIELD_LABELS[field], value };
}

/** @param {NextVerifiedEvidence[]} evidence @param {NextEvidenceReference[]} references */
export function evidenceMatchesReferences(evidence, references) {
	return evidence.length === references.length && evidence.every((fact, index) => (
		fact.work.id === references[index].workId &&
		fact.field === references[index].field &&
		fact.value === references[index].expectedValue
	));
}

/** @param {unknown} view @returns {NextEditorView | null} */
function cloneNextEditorView(view) {
	return nextEditorPageView(view);
}

/** @param {unknown} value @param {number} limit @param {boolean} [allowEmpty] */
function pageText(value, limit, allowEmpty = false) {
	if (typeof value !== 'string' || value.length > limit || SINGLE_LINE_CONTROL.test(value)) return null;
	if (!allowEmpty && !value) return null;
	return value;
}
