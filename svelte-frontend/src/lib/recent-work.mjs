const RECENT_WORK_LIMIT = 5;

/**
 * @param {unknown} value
 * @param {Iterable<unknown>} availableIds
 * @param {number} limit
 * @returns {string[]}
 */
function normalizeRecentWorkIds(value, availableIds, limit = RECENT_WORK_LIMIT) {
	if (!Array.isArray(value)) return [];
	const available = new Set(availableIds);
	const seen = new Set();
	/** @type {string[]} */
	const result = [];
	for (const candidate of value) {
		if (typeof candidate !== 'string' || !available.has(candidate) || seen.has(candidate)) continue;
		seen.add(candidate);
		result.push(candidate);
		if (result.length >= limit) break;
	}
	return result;
}

/**
 * @param {string | null | undefined} raw
 * @param {Iterable<unknown>} availableIds
 * @param {number} limit
 * @returns {string[]}
 */
export function parseRecentWorkIds(raw, availableIds, limit = RECENT_WORK_LIMIT) {
	if (!raw) return [];
	try {
		return normalizeRecentWorkIds(JSON.parse(raw), availableIds, limit);
	} catch {
		return [];
	}
}

/**
 * @param {unknown} current
 * @param {unknown} id
 * @param {Iterable<unknown>} availableIds
 * @param {number} limit
 * @returns {string[]}
 */
export function prependRecentWorkId(current, id, availableIds, limit = RECENT_WORK_LIMIT) {
	return normalizeRecentWorkIds([id, ...(Array.isArray(current) ? current : [])], availableIds, limit);
}
