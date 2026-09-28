import { normalizeWorkSearch } from '../routes/work/work-webmcp.mjs';

/**
 * Build the visible Guide-to-Work action from the same normalized query and
 * matching denominator that the browser-agent projection exposes.
 *
 * @param {{ kind: string, label: string, query: unknown, matchingCount: number }} input
 */
export function guideWorkAction(input) {
	if (!input || typeof input !== 'object') return disabledGuideWorkAction();
	const { kind, label, matchingCount } = input;
	const query = normalizeWorkSearch(input.query);
	if (
		(kind !== 'all' && kind !== 'derived' && kind !== 'custom') ||
		typeof label !== 'string' ||
		!Number.isSafeInteger(matchingCount) || matchingCount < 0 ||
		query === null
	) return disabledGuideWorkAction();

	if (kind === 'custom' && query && matchingCount === 0) return disabledGuideWorkAction();
	if (!query) {
		return {
			disabled: false,
			href: '/work',
			label: `Open all ${matchingCount} work ${matchingCount === 1 ? 'item' : 'items'}`
		};
	}

	const term = kind === 'derived' ? label.trim() : `“${query}”`;
	if (!term) return disabledGuideWorkAction();
	return {
		disabled: false,
		href: `/work?${new URLSearchParams({ search: query }).toString()}`,
		label: `Open ${matchingCount} ${term} ${matchingCount === 1 ? 'item' : 'items'}`
	};
}

function disabledGuideWorkAction() {
	return { disabled: true, href: null, label: 'No work matches' };
}
