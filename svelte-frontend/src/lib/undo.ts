// Receipt-scoped undo for visible, browser-local Projects workflow actions.

import { get, writable } from 'svelte/store';
import { demoState, displayToast, saveBrowserState, savePackPath } from '$lib/demo-client';
import { workTitle, type DemoPack } from '$lib/demo-workflow';

interface ForwardPathFields {
	title: string;
	status: string;
	blocker: string;
	blockedBy: string;
	owner: string;
	due: string;
	next: string;
	doneWhen: string;
	purpose: string;
	[key: string]: string;
}

interface ActionUndo {
	type: 'action';
	packId: string;
	fields: ForwardPathFields;
	dependents: Array<{ packId: string; fields: ForwardPathFields }>;
}

interface BatchUndo {
	type: 'batch';
	action: string;
	targets: Array<{ packId: string; fields: ForwardPathFields }>;
}

type ReceiptUndo = ActionUndo | BatchUndo;

export const receiptUndo = writable<ReceiptUndo | null>(null);

let restoring = false;

function normalized(value: unknown): string {
	return String(value ?? '').trim();
}

function forwardPathSnapshot(pack: DemoPack): ForwardPathFields {
	return {
		title: normalized(pack.title),
		status: normalized(pack.status),
		blocker: normalized(pack.blocker),
		blockedBy: normalized(pack.blockedBy),
		owner: normalized(pack.owner),
		due: normalized(pack.due),
		next: normalized(pack.next),
		doneWhen: normalized(pack.doneWhen),
		purpose: normalized(pack.purpose)
	};
}

/** Capture the local fields changed by a supported receipt action. */
export function buildActionUndoSnapshot(
	packs: DemoPack[],
	packId: string,
	action: string
): ReceiptUndo | null {
	if (!['start', 'unblock', 'block', 'done'].includes(action)) return null;
	const pack = packs.find((item) => item.id === packId);
	if (!pack) return null;
	const dependents = action === 'done'
		? packs
			.filter((item) => item.id !== packId && normalized(item.blockedBy) === packId)
			.map((item) => ({ packId: item.id || '', fields: forwardPathSnapshot(item) }))
		: [];
	return { type: 'action', packId, fields: forwardPathSnapshot(pack), dependents };
}

/** Capture every item changed by one atomic batch, including done-action dependents. */
export function buildBatchUndoSnapshot(
	packs: DemoPack[],
	packIds: string[],
	action: string
): BatchUndo | null {
	if (!['start', 'block', 'done'].includes(action)) return null;
	const ids = new Set(packIds);
	const targets = new Map<string, ForwardPathFields>();
	for (const pack of packs) {
		const eligible = !pack.archived && (
			action === 'start' ? pack.status === 'draft' :
			action === 'block' ? pack.status !== 'done' && pack.status !== 'blocked' : pack.status !== 'done'
		);
		if (ids.has(pack.id) && eligible) targets.set(pack.id, forwardPathSnapshot(pack));
		if (action === 'done' && pack.blockedBy && ids.has(pack.blockedBy)) targets.set(pack.id, forwardPathSnapshot(pack));
	}
	if (targets.size === 0) return null;
	return { type: 'batch', action, targets: [...targets].map(([packId, fields]) => ({ packId, fields })) };
}

export function commitActionUndo(snapshot: ReceiptUndo | null): void {
	receiptUndo.set(snapshot);
}

export async function undoReceipt(): Promise<void> {
	const undo = get(receiptUndo);
	if (!undo || restoring) return;
	restoring = true;
	try {
		if (undo.type === 'batch') {
			await saveBrowserState((state) => {
				for (const target of undo.targets) {
					const pack = state.packs.find((item) => item.id === target.packId);
					if (pack) Object.assign(pack, target.fields);
				}
			});
			displayToast(`Undo complete. Restored ${undo.targets.length} work items.`, 'success');
		} else {
			const targets = [{ packId: undo.packId, fields: undo.fields }, ...undo.dependents];
			for (const target of targets) {
				if (target.packId) await savePackPath(target.packId, target.fields);
			}
			const pack = get(demoState)?.packs?.find((item) => item.id === undo.packId);
			displayToast(`Undo complete. ${pack ? workTitle(pack) : 'The work'} is back to its previous state.`, 'success');
		}
		receiptUndo.set(null);
	} catch (error) {
		displayToast(
			error instanceof Error && error.message
				? `Undo failed: ${error.message}`
				: 'Undo failed — the local state is unchanged.',
			'error'
		);
	} finally {
		restoring = false;
	}
}
