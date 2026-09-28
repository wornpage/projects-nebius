/** @typedef {{ id: string, title?: string, status?: string, blocker?: string, next?: string, [key: string]: unknown }} PendingPack */
/** @typedef {{ workId: string, field: 'workflow' | 'blocker', expectedValue: string | null }} PendingEvidence */
/** @typedef {{ workId: string, choice: string, mode: 'preset' | 'custom', evidenceNote: string, evidence: PendingEvidence[], originFingerprint: string, source: 'human' | 'webmcp', [key: string]: unknown }} PendingDraft */
/** @typedef {{ pendingNextActionDrafts?: PendingDraft[] }} PendingDraftContainer */
/** @typedef {{ title?: string, workflow?: string, blocker?: string | null, next?: string, [key: string]: unknown }} PendingProjection */

/** @template {{ id: string }} TPack @param {{ packs: TPack[], pendingNextActionDrafts?: PendingDraft[] }} state @param {PendingDraft} draft @param {(pack: TPack) => PendingProjection} projectPack @returns {string} */
export function pendingDraftFingerprint(state, draft, projectPack) {
	const origin = state.packs.find((pack) => pack.id === draft.workId);
	return JSON.stringify({
		workId: draft.workId,
		origin: origin ? projectPack(origin) : null,
		facts: draft.evidence.map((reference) => {
			const pack = state.packs.find((item) => item.id === reference.workId);
			return { workId: reference.workId, field: reference.field, value: pack ? projectPack(pack)[reference.field] : null };
		})
	});
}

/** @param {PendingDraftContainer} state @param {string} workId @returns {void} */
export function discardPendingDraft(state, workId) {
	state.pendingNextActionDrafts = (state.pendingNextActionDrafts || []).filter((draft) => draft.workId !== workId);
}

/** @param {PendingDraftContainer} state @param {PendingDraft} draft @returns {void} */
export function upsertPendingDraft(state, draft) {
	const pending = state.pendingNextActionDrafts || [];
	const index = pending.findIndex((item) => item.workId === draft.workId);
	state.pendingNextActionDrafts = index < 0
		? [...pending, structuredClone(draft)]
		: pending.map((item, itemIndex) => itemIndex === index ? structuredClone(draft) : item);
}

/**
 * @template {{ id: string }} TPack
 * @param {{ packs: TPack[], pendingNextActionDrafts?: PendingDraft[] }} state
 * @param {{ workId: string, choice: string, mode: 'preset' | 'custom' }} revision
 * @param {(pack: TPack) => PendingProjection} projectPack
 * @returns {PendingDraft}
 */
export function revisePendingDraftChoice(state, { workId, choice, mode }, projectPack) {
	const current = (state.pendingNextActionDrafts || []).find((draft) => draft.workId === workId) || null;
	const draft = {
		workId,
		choice,
		mode,
		evidenceNote: current ? current.evidenceNote : 'Human-created draft; approval remains human-owned.',
		evidence: current ? structuredClone(current.evidence) : [],
		originFingerprint: current ? current.originFingerprint : '',
		source: current ? current.source : 'human'
	};
	if (!current) draft.originFingerprint = pendingDraftFingerprint(state, draft, projectPack);
	upsertPendingDraft(state, draft);
	return draft;
}

/** @param {PendingDraftContainer} state @param {string} workId @param {PendingDraft | null} priorDraft @returns {void} */
export function restorePendingDraft(state, workId, priorDraft) {
	if (priorDraft) upsertPendingDraft(state, priorDraft);
	else discardPendingDraft(state, workId);
}

/** @param {PendingDraftContainer} state @returns {{ count: number, resumeHref: string }} */
export function pendingDraftNavigation(state) {
	const drafts = state.pendingNextActionDrafts || [];
	return { count: drafts.length, resumeHref: drafts[0] ? `/next?pack=${encodeURIComponent(drafts[0].workId)}` : '/next' };
}

/**
 * @template T
 * @param {{ current: T, clone: (value: T) => T, mutate: (value: T) => void, persist: (value: T) => void, install: (value: T) => T }} options
 * @returns {T}
 */
export function cloneMutatePersist({ current, clone, mutate, persist, install }) {
	const next = clone(current);
	mutate(next);
	persist(next);
	return install(next);
}

/** @template T @param {string | null} serialized @param {(value: T) => void} assertState @returns {T | null} */
export function hydrateSerializedState(serialized, assertState) {
	if (serialized === null) return null;
	const state = JSON.parse(serialized);
	assertState(state);
	return state;
}

/**
 * @template T
 * @param {{ remove: () => void, loadSeed: () => Promise<T>, install: (value: T) => T }} options
 * @returns {Promise<T>}
 */
export async function resetPersistedState({ remove, loadSeed, install }) {
	remove();
	const seed = await loadSeed();
	return install(seed);
}

/** @template {{ id: string }} TPack @param {{ packs: TPack[], pendingNextActionDrafts?: PendingDraft[] }} state @param {string} workId @param {{ projectPack: (pack: TPack) => PendingProjection, nextPath: (pack: TPack, choice: string) => Partial<TPack> }} options @returns {{ pack: TPack, draft: PendingDraft }} */
export function approvePendingDraft(state, workId, { projectPack, nextPath }) {
	const draft = (state.pendingNextActionDrafts || []).find((candidate) => candidate.workId === workId) || null;
	if (!draft) throw new Error('Pending approval draft was not found.');
	if (pendingDraftFingerprint(state, draft, projectPack) !== draft.originFingerprint) {
		throw new Error('Draft is stale. Refresh the evidence and prepare it again before approval.');
	}
	const pack = state.packs.find((item) => item.id === workId);
	if (!pack) throw new Error('Pending approval work item was not found.');
	Object.assign(pack, nextPath(pack, draft.choice));
	discardPendingDraft(state, workId);
	return { pack, draft };
}
