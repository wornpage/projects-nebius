import { normalizeWorkSearch } from '../work/work-webmcp.mjs';

export const PROJECTS_HANDOFF_GUIDE_TOOL_NAME = 'get_projects_handoff_guide';

const ALLOWED_ROUTES = new Set(['/work', '/review', '/next']);
const TEXT_LIMIT = 1_000;
const WORK_QUERY_LIMIT = 120;
const DERIVED_SCOPE_LIMIT = 24;

/** @typedef {{ id: string, kind: 'derived', label: string, query: string, matchingCount: number }} DerivedGuideScopeChoice */
/** @typedef {{ workspaceCount: number, visibleCount: number, discoveredChoiceCount: number, shownChoiceCount: number, omittedChoiceCount: number, choices: DerivedGuideScopeChoice[] }} GuideScopeCatalog */

/**
 * Build a bounded catalog from the same visible packs and query counter that
 * Work uses. Areas are stable workspace fields; their matching counts still
 * come from Work's full shared text-search logic rather than an area-only
 * approximation.
 *
 * @param {number} workspaceCount
 * @param {unknown[]} visiblePacks
 * @param {(query: string) => number} countMatches
 * @returns {GuideScopeCatalog}
 */
export function deriveGuideWorkScopeCatalog(workspaceCount, visiblePacks, countMatches) {
	if (!nonnegativeInteger(workspaceCount) || !Array.isArray(visiblePacks) || visiblePacks.length > workspaceCount) {
		throw new TypeError('Guide Work scopes require exact workspace and visible denominators.');
	}
	if (typeof countMatches !== 'function') throw new TypeError('Guide Work scopes require the shared Work search counter.');

	const areas = /** @type {Map<string, string>} */ (new Map());
	for (const pack of visiblePacks) {
		if (!isRecord(pack)) continue;
		const area = normalizedScopeLabel(pack.area);
		if (!area) continue;
		const key = area.toLocaleLowerCase('en-US');
		if (!areas.has(key)) areas.set(key, area);
	}
	const discovered = [...areas.values()].sort((left, right) => left.localeCompare(right, 'en-US'));
	const shown = discovered.slice(0, DERIVED_SCOPE_LIMIT);
	const choices = shown.map((query, index) => {
		const matchingCount = countMatches(query);
		if (!nonnegativeInteger(matchingCount) || matchingCount < 1 || matchingCount > visiblePacks.length) {
			throw new TypeError('Guide Work scope count did not match the visible Work denominator.');
		}
		return {
			id: `area-${index + 1}`,
			kind: /** @type {'derived'} */ ('derived'),
			label: query,
			query,
			matchingCount
		};
	});

	return {
		workspaceCount,
		visibleCount: visiblePacks.length,
		discoveredChoiceCount: discovered.length,
		shownChoiceCount: choices.length,
		omittedChoiceCount: discovered.length - choices.length,
		choices
	};
}

/**
 * Read the guide from the public page instead of duplicating its values for
 * the tool. That keeps the browser-reader result aligned with the visible
 * guide while leaving the ordinary links usable without WebMCP.
 *
 * @param {{ querySelector: (selector: string) => any, querySelectorAll: (selector: string) => Iterable<any> }} documentRef
 */
export function readRenderedWebMcpChallengeGuide(documentRef) {
	const root = documentRef.querySelector('[data-webmcp-challenge-guide]');
	const agentBriefInput = documentRef.querySelector('[data-agent-brief-input]');
	const scopeChooser = documentRef.querySelector('[data-agent-scope-chooser]');
	const renderedScopeChoices = Array.from(documentRef.querySelectorAll('[data-agent-scope-choice]')).map((choice) => {
		const kind = choice.dataset.scopeKind ?? '';
		return {
			id: choice.dataset.scopeId ?? '',
			kind,
			label: choice.dataset.scopeLabel ?? '',
			query: kind === 'custom' ? null : choice.dataset.scopeQuery,
			matchingCount: kind === 'custom' ? null : Number(choice.dataset.scopeMatchCount)
		};
	});
	const renderedSteps = Array.from(documentRef.querySelectorAll('[data-webmcp-challenge-step]')).map((step, index) => ({
		position: index + 1,
		title: step.querySelector('h2')?.textContent?.trim() ?? '',
		description: step.querySelector('p')?.textContent?.trim() ?? '',
		href: step.querySelector('a')?.getAttribute('href') ?? ''
	}));
	const renderedSafety = Array.from(documentRef.querySelectorAll('[data-webmcp-challenge-safety] li')).map((item) => item.textContent?.trim() ?? '');
	return {
		title: root?.dataset.webmcpChallengeTitle ?? '',
		purpose: root?.dataset.webmcpChallengePurpose ?? '',
		steps: renderedSteps,
		safety: renderedSafety,
		agentBrief: agentBriefInput?.value,
		workQuery: scopeChooser?.dataset.selectedWorkQuery,
		workScope: {
			workspaceCount: Number(scopeChooser?.dataset.workspaceCount),
			visibleCount: Number(scopeChooser?.dataset.visibleCount),
			discoveredChoiceCount: Number(scopeChooser?.dataset.discoveredChoiceCount),
			shownChoiceCount: Number(scopeChooser?.dataset.shownChoiceCount),
			omittedChoiceCount: Number(scopeChooser?.dataset.omittedChoiceCount),
			choices: renderedScopeChoices,
			selected: {
				id: scopeChooser?.dataset.selectedScopeId,
				kind: scopeChooser?.dataset.selectedScopeKind,
				label: scopeChooser?.dataset.selectedScopeLabel,
				query: scopeChooser?.dataset.selectedWorkQuery,
				matchingCount: Number(scopeChooser?.dataset.selectedMatchCount)
			}
		}
	};
}

/**
 * Validate the exact public guide rendered by the handoff page. It exposes
 * only bounded scope labels and counts, with no work-item details or
 * navigation/write authority.
 *
 * @param {unknown} input
 */
export function webMcpChallengeGuideView(input) {
	if (!isRecord(input) || !Array.isArray(input.steps) || !Array.isArray(input.safety)) return null;
	const title = normalizedText(input.title);
	const purpose = normalizedText(input.purpose);
	const agentBrief = normalizedAgentBrief(input.agentBrief);
	const workQuery = normalizeWorkSearch(input.workQuery);
	if (!title || !purpose || agentBrief === null || workQuery === null || input.steps.length !== 3 || input.safety.length !== 3) return null;
	const workScope = guideWorkScopeView(input.workScope, workQuery);
	if (!workScope) return null;

	const steps = input.steps.map((entry, index) => challengeStep(entry, index + 1));
	const safety = input.safety.map(normalizedText);
	if (steps.some((step) => step === null) || safety.some((item) => item === null)) return null;
	const validSteps = /** @type {{ position: number, title: string, description: string, href: string }[]} */ (steps);
	if (new Set(validSteps.map(({ href }) => href)).size !== validSteps.length) return null;

	return {
		title,
		purpose,
		steps: validSteps,
		safety: /** @type {string[]} */ (safety),
		agentBrief,
		workQuery,
		workScope
	};
}

/** @param {() => unknown} getGuide */
export function createWebMcpChallengeGuideTool(getGuide) {
	if (typeof getGuide !== 'function') throw new TypeError('WebMCP challenge guide requires a current-page getter.');
	return {
		name: PROJECTS_HANDOFF_GUIDE_TOOL_NAME,
		title: 'Get Projects handoff guide',
		description: 'Read the current Projects handoff guide, including its editable browser-agent brief, discovered Work scopes with exact denominators, selected Work-search query, three workflow routes, and visible authority boundaries. This does not navigate, fetch, or write.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		annotations: {
			readOnlyHint: true,
			openWorldHint: false,
			untrustedContentHint: true
		},
		/** @param {unknown} input @param {{ signal?: AbortSignal }} [options] */
		async execute(input, options = {}) {
			options.signal?.throwIfAborted();
			if (!isRecord(input) || Object.keys(input).length !== 0) {
				throw new TypeError('Projects handoff guide accepts only an empty object.');
			}
			const guide = webMcpChallengeGuideView(getGuide());
			if (!guide) throw new TypeError('Projects handoff guide is not verifiable.');
			options.signal?.throwIfAborted();
			return guide;
		}
	};
}

/** @param {unknown} input @param {string} workQuery */
function guideWorkScopeView(input, workQuery) {
	if (!isRecord(input) || !Array.isArray(input.choices) || !isRecord(input.selected)) return null;
	const workspaceCount = boundedCount(input.workspaceCount);
	const visibleCount = boundedCount(input.visibleCount);
	const discoveredChoiceCount = boundedCount(input.discoveredChoiceCount);
	const shownChoiceCount = boundedCount(input.shownChoiceCount);
	const omittedChoiceCount = boundedCount(input.omittedChoiceCount);
	if (
		workspaceCount === null || visibleCount === null || visibleCount > workspaceCount
		|| discoveredChoiceCount === null || shownChoiceCount === null || omittedChoiceCount === null
		|| shownChoiceCount > DERIVED_SCOPE_LIMIT
		|| discoveredChoiceCount !== shownChoiceCount + omittedChoiceCount
		|| input.choices.length !== shownChoiceCount + 2
	) return null;

	const choices = input.choices.map(scopeChoice);
	if (choices.some((choice) => choice === null)) return null;
	const validChoices = /** @type {Array<{ id: string, kind: 'all' | 'derived' | 'custom', label: string, query: string | null, matchingCount: number | null }>} */ (choices);
	const allChoice = validChoices[0];
	const customChoice = validChoices.at(-1);
	const derivedChoices = validChoices.slice(1, -1);
	if (
		allChoice?.id !== 'all' || allChoice.kind !== 'all' || allChoice.label !== 'All visible work'
		|| allChoice.query !== '' || allChoice.matchingCount !== visibleCount
		|| customChoice?.id !== 'custom' || customChoice.kind !== 'custom' || customChoice.label !== 'Custom'
		|| customChoice.query !== null || customChoice.matchingCount !== null
		|| derivedChoices.length !== shownChoiceCount
		|| derivedChoices.some((choice) => choice.kind !== 'derived' || !choice.query || choice.matchingCount === null || choice.matchingCount < 1 || choice.matchingCount > visibleCount)
	) return null;
	const ids = validChoices.map(({ id }) => id);
	const derivedQueries = derivedChoices.map(({ query }) => query?.toLocaleLowerCase('en-US'));
	if (new Set(ids).size !== ids.length || new Set(derivedQueries).size !== derivedQueries.length) return null;

	const selectedId = normalizedScopeId(input.selected.id);
	const selectedKind = scopeKind(input.selected.kind);
	const selectedLabel = normalizedScopeLabel(input.selected.label);
	const selectedQuery = normalizeWorkSearch(input.selected.query);
	const selectedMatchingCount = boundedCount(input.selected.matchingCount);
	if (!selectedId || !selectedKind || !selectedLabel || selectedQuery === null || selectedMatchingCount === null || selectedMatchingCount > visibleCount || selectedQuery !== workQuery) return null;
	const selectedChoice = validChoices.find(({ id }) => id === selectedId);
	if (!selectedChoice || selectedChoice.kind !== selectedKind || selectedChoice.label !== selectedLabel) return null;
	if (selectedKind === 'custom') {
		if (selectedId !== 'custom' || (selectedQuery === '' && selectedMatchingCount !== visibleCount)) return null;
	} else if (selectedChoice.query !== selectedQuery || selectedChoice.matchingCount !== selectedMatchingCount) {
		return null;
	}

	return {
		workspaceCount,
		visibleCount,
		discoveredChoiceCount,
		shownChoiceCount,
		omittedChoiceCount,
		choices: validChoices,
		selected: {
			id: selectedId,
			kind: selectedKind,
			label: selectedLabel,
			query: selectedQuery,
			matchingCount: selectedMatchingCount
		}
	};
}

/** @param {unknown} input */
function scopeChoice(input) {
	if (!isRecord(input)) return null;
	const id = normalizedScopeId(input.id);
	const kind = scopeKind(input.kind);
	const label = normalizedScopeLabel(input.label);
	if (!id || !kind || !label) return null;
	if (kind === 'custom') {
		return input.query === null && input.matchingCount === null
			? { id, kind, label, query: null, matchingCount: null }
			: null;
	}
	const query = normalizeWorkSearch(input.query);
	const matchingCount = boundedCount(input.matchingCount);
	return query === null || matchingCount === null ? null : { id, kind, label, query, matchingCount };
}

/** @param {unknown} value */
function normalizedScopeId(value) {
	if (typeof value !== 'string') return null;
	const id = value.trim();
	return id && id.length <= 80 && /^[a-z0-9-]+$/u.test(id) ? id : null;
}

/** @param {unknown} value */
function normalizedScopeLabel(value) {
	if (typeof value !== 'string') return null;
	const label = value.trim();
	return label && label.length <= WORK_QUERY_LIMIT && !/\p{Cc}/u.test(label) ? label : null;
}

/** @param {unknown} value */
function scopeKind(value) {
	return value === 'all' || value === 'derived' || value === 'custom' ? value : null;
}

/** @param {unknown} value @returns {number | null} */
function boundedCount(value) {
	return typeof value === 'number' && nonnegativeInteger(value) && value <= 1_000_000 ? value : null;
}

/** @param {unknown} value @returns {value is number} */
function nonnegativeInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** @param {unknown} input @param {number} position */
function challengeStep(input, position) {
	if (!isRecord(input) || input.position !== position) return null;
	const title = normalizedText(input.title);
	const description = normalizedText(input.description);
	const href = typeof input.href === 'string' && ALLOWED_ROUTES.has(input.href) ? input.href : null;
	return title && description && href ? { position, title, description, href } : null;
}

/** @param {unknown} value */
function normalizedText(value) {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text && text.length <= TEXT_LIMIT && !/\p{Cc}/u.test(text) ? text : null;
}

/** @param {unknown} value */
function normalizedAgentBrief(value) {
	if (typeof value !== 'string') return null;
	const text = value.replace(/\r\n?/gu, '\n').trim();
	if (text.length > TEXT_LIMIT || /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u.test(text)) return null;
	return text;
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
