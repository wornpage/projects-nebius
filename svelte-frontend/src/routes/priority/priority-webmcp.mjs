export const PRIORITY_RECOMMENDATION_TOOL_NAME = 'get_next_recommendation';

/**
 * @typedef {{ id: string, title: string, href: string, reason: string }} PriorityRecommendation
 */

/** @param {() => PriorityRecommendation | null} getRecommendation */
export function createPriorityRecommendationTool(getRecommendation) {
	if (typeof getRecommendation !== 'function') {
		throw new TypeError('Priority WebMCP requires a recommendation getter.');
	}

	return {
		name: PRIORITY_RECOMMENDATION_TOOL_NAME,
		title: 'Get next recommendation',
		description: 'Read the exact next recommendation currently visible on Priority. Returns only its id, title, href, and reason; this does not navigate, fetch, or write.',
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
			const recommendation = getRecommendation();
			if (recommendation === null) return null;
			return cloneRecommendation(recommendation);
		}
	};
}

/** @param {unknown} input */
function requireEmptyInput(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0) {
		throw new TypeError('Priority recommendation requires an empty object.');
	}
}

/** @param {unknown} value @returns {PriorityRecommendation} */
function cloneRecommendation(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Priority recommendation getter returned an invalid projection.');
	}
	const candidate = /** @type {Record<string, unknown>} */ (value);
	for (const field of ['id', 'title', 'href', 'reason']) {
		if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
			throw new TypeError('Priority recommendation getter returned an invalid projection.');
		}
	}
	return {
		id: /** @type {string} */ (candidate.id),
		title: /** @type {string} */ (candidate.title),
		href: /** @type {string} */ (candidate.href),
		reason: /** @type {string} */ (candidate.reason)
	};
}
