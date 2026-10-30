export const WORK_SEARCH_MAX_LENGTH = 120;

/** @param {unknown} value */
function visibleContextLabel(value) {
	if (typeof value !== 'string') return null;
	const label = value.trim().replace(/\s+/gu, ' ');
	return label || null;
}

/** @param {unknown} area @param {unknown} decider */
export function visibleDecisionDecider(area, decider) {
	const areaLabel = visibleContextLabel(area);
	const deciderLabel = visibleContextLabel(decider);
	if (!deciderLabel) return null;
	return areaLabel?.toLocaleLowerCase('en-US') === deciderLabel.toLocaleLowerCase('en-US') ? null : deciderLabel;
}

/** @param {unknown} value @returns {string | null} */
export function normalizeWorkSearch(value) {
	if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return null;
	const query = value.trim();
	return query.length <= WORK_SEARCH_MAX_LENGTH ? query : null;
}

/** Normalize a saved Work search link without granting it write authority. @param {unknown} value */
export function routeWorkSearch(value) {
	return normalizeWorkSearch(value) ?? '';
}
