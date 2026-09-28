// @ts-nocheck -- runtime browser-state validation; public types are in .d.mts.
import { validateProjectSnapshot, validateProjectReplan } from './nebius-replan-contract.mjs';
import { assertProjectState } from './nebius-project-state.mjs';
import { normalizeWorkTitle } from './canonical-text.mjs';

/** Capture every member, including terminal context, without truncating stored fields. */
export function projectSnapshot(state, projectId) {
	assertProjectState(state);
	if (new Set(state.packs.map((pack) => pack.id)).size !== state.packs.length) {
		throw new TypeError('Workspace task ids must be unique.');
	}
	const project = state.projects?.find((item) => item.id === projectId);
	if (!project) throw new TypeError('Project was not found.');
	return validateProjectSnapshot({
		project: { id: project.id, title: project.title, summary: project.summary },
		tasks: state.packs.filter((pack) => pack.projectId === projectId).map((pack) => ({
			id: pack.id, title: pack.title, purpose: pack.purpose, nextStep: pack.nextStep,
			doneWhen: pack.doneWhen, status: pack.status, blocker: pack.blocker,
			blockedBy: pack.blockedBy === undefined || pack.blockedBy === '' ? null : pack.blockedBy, archived: pack.archived ?? false
		}))
	});
}

/** Pure, immutable approval: validate the complete proposal before changing any task. */
export function applyProjectReplanState(state, { snapshot, replan, source }) {
	if (source !== 'manual' && source !== 'nebius') throw new TypeError('Project update source is invalid.');
	const captured = validateProjectSnapshot(snapshot);
	const current = projectSnapshot(state, captured.project.id);
	if (JSON.stringify(captured) !== JSON.stringify(current)) {
		throw new TypeError('Project changed since this update began. Start a new update from the current project.');
	}
	const approved = validateProjectReplan(replan, captured);
	const changedIds = approved.changes.map((change) => change.id);
	const targets = new Set(changedIds);
	if (state.pendingNextActionDrafts?.some((draft) => targets.has(draft.workId))) {
		throw new TypeError('A changed task has a pending next-action draft. Review or discard that draft before applying this update.');
	}
	for (const change of approved.changes) {
		if (normalizeWorkTitle(change.title) !== change.title) {
			throw new TypeError('Changed task titles must use the canonical browser work title.');
		}
	}
	const next = structuredClone(state);
	const changes = new Map(approved.changes.map((change) => [change.id, change]));
	for (const pack of next.packs) {
		const change = changes.get(pack.id);
		if (!change) continue;
		for (const field of ['title', 'purpose', 'nextStep', 'doneWhen', 'status', 'blocker']) pack[field] = change[field];
		if (change.blockedBy === null) delete pack.blockedBy;
		else pack.blockedBy = change.blockedBy;
	}
	assertProjectState(next);
	// Also verify the resulting selected-project projection; unchanged context participates.
	projectSnapshot(next, captured.project.id);
	return { state: next, changedIds };
}
