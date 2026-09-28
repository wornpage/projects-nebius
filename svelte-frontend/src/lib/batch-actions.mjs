import {
	DEMO_BLOCKER_NONE,
	forwardPathStatusForBlocker
} from './workflow-rules.mjs';

const BATCH_ACTIONS = new Set(['done', 'start', 'block', 'delete']);

/** @typedef {'done' | 'start' | 'block' | 'delete'} BatchAction */
/** @typedef {{ id: string, status?: string, archived?: boolean, blockedBy?: string, blocker?: string, next?: string }} BatchPack */
/** @typedef {{ workId: string, evidence?: Array<{ workId: string }> }} PendingDraft */
/** @typedef {{ packs: BatchPack[], selectedId?: string, pendingNextActionDrafts?: PendingDraft[], actionReceipt?: { pack?: BatchPack } | null }} BatchState */

/** @param {BatchPack | undefined} pack @param {BatchAction} action */
function eligibleForBatchAction(pack, action) {
	if (!pack) return false;
	if (action === 'delete') return true;
	if (pack.archived === true) return false;
	if (action === 'start') return pack.status === 'draft';
	if (action === 'done') return pack.status !== 'done';
	if (action === 'block') return pack.status !== 'done' && pack.status !== 'blocked';
	return false;
}

/** @param {BatchPack[]} packs @param {string[]} selectedIds @param {BatchAction} action */
export function planBatchAction(packs, selectedIds, action) {
	if (!BATCH_ACTIONS.has(action)) throw new Error(`Unsupported batch action: ${action}.`);
	const requestedIds = [...new Set(selectedIds.filter((id) => typeof id === 'string' && id))];
	const eligibleIds = requestedIds.filter((id) => {
		const pack = packs.find((candidate) => candidate.id === id);
		return eligibleForBatchAction(pack, action);
	});
	return {
		requestedCount: requestedIds.length,
		eligibleIds,
		skippedCount: requestedIds.length - eligibleIds.length
	};
}

/** @param {BatchState} state */
export function repairActiveSelection(state) {
	const selected = state.packs.find((pack) => pack.id === state.selectedId && pack.archived !== true);
	if (selected) return selected.id;
	state.selectedId = state.packs.find((pack) => pack.archived !== true)?.id || '';
	return state.selectedId;
}

/** @param {BatchState} state @param {string[]} packIds */
export function removePacksAndReferences(state, packIds) {
	const removedIds = new Set(packIds);
	const previousDrafts = Array.isArray(state.pendingNextActionDrafts)
		? state.pendingNextActionDrafts
		: [];
	state.pendingNextActionDrafts = previousDrafts.filter((draft) => (
		!removedIds.has(draft.workId)
		&& !(Array.isArray(draft.evidence) && draft.evidence.some((fact) => removedIds.has(fact.workId)))
	));

	let repairedDependencies = 0;
	for (const pack of state.packs) {
		if (removedIds.has(pack.id) || !pack.blockedBy || !removedIds.has(pack.blockedBy)) continue;
		pack.blockedBy = '';
		pack.blocker = DEMO_BLOCKER_NONE;
		pack.status = forwardPathStatusForBlocker(pack.status, DEMO_BLOCKER_NONE, pack.next);
		repairedDependencies += 1;
	}

	const deletedCount = state.packs.filter((pack) => removedIds.has(pack.id)).length;
	state.packs = state.packs.filter((pack) => !removedIds.has(pack.id));
	if (state.actionReceipt?.pack?.id && removedIds.has(state.actionReceipt.pack.id)) {
		state.actionReceipt = null;
	}
	repairActiveSelection(state);
	return {
		deletedCount,
		discardedDrafts: previousDrafts.length - state.pendingNextActionDrafts.length,
		repairedDependencies
	};
}
