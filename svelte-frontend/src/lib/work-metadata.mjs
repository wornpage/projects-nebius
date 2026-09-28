/** @typedef {import('./demo-workflow').DemoPack} DemoPack */

/**
 * Derive the Work route's selector metadata in one pass.  The route supplies
 * its existing normalization/date helpers so this remains behaviorally tied
 * to the UI's canonical semantics.
 * @param {DemoPack[]} packs
 * @param {{ isMissingOwnerValue: (value: string | undefined) => boolean, dueUrgency: (pack: DemoPack) => string }} helpers
 */
export function summarizeWorkMetadata(packs, { isMissingOwnerValue, dueUrgency }) {
	const uniqueAreas = new Set();
	const uniqueRecurrences = new Set();
	const uniqueOwners = new Set();
	/** @type {Record<string, number>} */ const countByEnergy = { all: packs.length };
	/** @type {Record<string, number>} */ const countByArea = {};
	/** @type {Record<string, number>} */ const countByRecurrence = {};
	/** @type {Record<string, number>} */ const countByOwner = {};
	/** @type {Record<string, number>} */ const countByDueUrgency = { all: packs.length, overdue: 0, today: 0, soon: 0 };
	let hasDoneWork = false;

	for (const pack of packs) {
		const area = pack.area;
		if (area) uniqueAreas.add(area);
		const recurrence = pack.recurrence;
		if (recurrence && recurrence !== 'none') uniqueRecurrences.add(recurrence);
		const owner = pack.owner?.trim();
		if (owner && !isMissingOwnerValue(owner)) uniqueOwners.add(owner);

		const energyKey = pack.energy || '';
		countByEnergy[energyKey] = (countByEnergy[energyKey] ?? 0) + 1;
		const areaKey = area || '_none';
		countByArea[areaKey] = (countByArea[areaKey] ?? 0) + 1;
		const recurrenceKey = recurrence || '';
		countByRecurrence[recurrenceKey] = (countByRecurrence[recurrenceKey] ?? 0) + 1;
		const ownerKey = isMissingOwnerValue(pack.owner) ? '_unassigned' : String(pack.owner).trim();
		countByOwner[ownerKey] = (countByOwner[ownerKey] ?? 0) + 1;
		const urgency = dueUrgency(pack);
		if (urgency) countByDueUrgency[urgency] = (countByDueUrgency[urgency] ?? 0) + 1;
		if (!pack.archived && pack.status === 'done') hasDoneWork = true;
	}

	return {
		uniqueAreas: Array.from(uniqueAreas),
		uniqueRecurrences: Array.from(uniqueRecurrences),
		uniqueOwners: Array.from(uniqueOwners),
		countByEnergy,
		countByArea,
		countByRecurrence,
		countByOwner,
		countByDueUrgency,
		hasDoneWork
	};
}
