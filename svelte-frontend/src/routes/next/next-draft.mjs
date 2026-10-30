export const NEXT_EDITOR_PREVIEW_ID = 'next-action-preview';
export const NEXT_PREPARATION_RECEIPT_ID = 'next-preparation-receipt';
export const NEXT_PREPARATION_SUMMARY = 'An earlier agent prepared an unsaved draft. No workspace data was saved.';
export const NEXT_ACTION_MAX_LENGTH = 200;

/** @returns {{ pending: boolean }} */
export function createNextDraftRevisionState() {
	return { pending: false };
}

/**
 * Keep the editor and its durable pending draft in one ordered revision.
 * @template TSnapshot
 * @template TDraft
 * @param {{ pending: boolean }} revision
 * @param {{ capture: () => TSnapshot, preview: () => void, persist: () => Promise<TDraft>, settle: (draft: TDraft) => void, rollback: (snapshot: TSnapshot) => void, reject: (error: unknown) => void }} options
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

/** @param {{ pending: boolean }} revision @param {{ busy: boolean, stale: boolean, choice: string, mode: 'preset' | 'custom', draft: { choice: string, mode: 'preset' | 'custom' } | null }} editor */
export function nextDraftTerminalAvailable(revision, { busy, stale, choice, mode, draft }) {
	return !revision.pending && !busy && !stale && Boolean(draft && choice && draft.choice === choice && draft.mode === mode);
}

/**
 * Execute Save or Discard only with the exact settled draft that passed the route gate.
 * @template TDraft
 * @template TResult
 * @param {{ pending: boolean }} revision
 * @param {{ busy: boolean, stale: boolean, choice: string, mode: 'preset' | 'custom', draft: TDraft & { choice: string, mode: 'preset' | 'custom' } | null, start?: () => void, finish?: () => void, action: (draft: TDraft) => Promise<TResult> }} options
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
