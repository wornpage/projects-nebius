import { decisionWorkspaceNextHref, decisionWorkspaceReviewHref, exactWorkId } from '../../lib/decision-workspace-navigation.mjs';
import { normalizeBoundedText, normalizeWorkTitle, WORK_TITLE_MAX_LENGTH } from '../../lib/canonical-text.mjs';

export const WORK_CURRENT_TOOL_NAME = 'get_current_work_view';
export const WORK_SEARCH_TOOL_NAME = 'show_work_search';
export const WORK_DRAFT_TOOL_NAME = 'create_work_drafts';
export const WORK_SEARCH_MAX_LENGTH = 120;
export const WORK_DRAFT_MAX_ITEMS = 3;
const WORK_DRAFT_FIELDS = new Set(['title', 'owner', 'area', 'type', 'due', 'energy', 'recurrence', 'proofTarget']);
const WORK_DRAFT_ENERGIES = new Set(['low', 'medium', 'high']);

/** @param {unknown} value */
function visibleContextLabel(value) {
	if (typeof value !== 'string') return null;
	const label = value.trim().replace(/\s+/gu, ' ');
	return label || null;
}

/**
 * @param {unknown} area
 * @param {unknown} decider
 */
export function visibleDecisionDecider(area, decider) {
	const areaLabel = visibleContextLabel(area);
	const deciderLabel = visibleContextLabel(decider);
	if (!deciderLabel) return null;
	return areaLabel?.toLocaleLowerCase('en-US') === deciderLabel.toLocaleLowerCase('en-US')
		? null
		: deciderLabel;
}

const WORK_STATUSES = new Set(['all', 'active', 'blocked', 'draft', 'done', 'review', 'archived']);
const WORK_SORTS = new Set(['urgency', 'due', 'title', 'status', 'energy', 'recent']);
const WORK_DENSITIES = new Set(['grid', 'card']);
const WORK_DUE_SCOPES = new Set(['all', 'overdue']);

/** @typedef {'grid' | 'card'} WorkDensity */
/** @typedef {{ search: string, appliedSearch: string, status: string, energy: string, area: string, recurrence: string, owner: string, dueUrgency: string, sort: string, hideDone: boolean, focusMode: boolean, density: WorkDensity }} WorkScopeView */
/** @typedef {{ workspace: number, matching: number, shown: number, remaining: number, blocked: number }} WorkCountsView */
/** @typedef {{ id: string, title: string, href: string, workflow: string, owner: string | null, due: string | null, blocker: string | null }} WorkItemView */
/** @typedef {{ id: string, title: string, href: string, reviewHref: string, reason: string, decider: string | null, decisionCount: number, blockedCount: number, overdueCount: number, sourceCount: number, outsideCurrentView?: true }} WorkDecisionRecommendationView */
/** @typedef {{ scope: WorkScopeView, counts: WorkCountsView, recommendation: WorkDecisionRecommendationView | null, items: WorkItemView[] }} WorkView */
/** @typedef {{ target: 'item', itemId: string, focused: boolean, focusVisible: boolean, inViewport: boolean, pulsed: boolean } | { target: 'search', itemId: null, focused: boolean, focusVisible: boolean, inViewport: boolean, pulsed: boolean }} WorkSearchFocus */
/** @typedef {{ changed: boolean, query: string, focus: WorkSearchFocus, work: WorkView }} WorkSearchReceipt */
/** @typedef {{ summary: string, cells: Array<{ label: string, value: string }>, scopeKey: string }} WorkPresentationReceipt */
/** @typedef {{ title: string, owner: string | null, area: string | null, type: string | null, due: string | null, energy: string | null, recurrence: string | null, proofTarget: string | null }} WorkCreationDraft */
/** @typedef {{ expectedWorkspaceCount: number, drafts: WorkCreationDraft[] }} WorkDraftInput */
/** @typedef {{ id: string, title: string, status: 'draft' }} WorkCreatedDraft */
/** @typedef {{ id: 'work-webmcp-activity', focused: true, focusVisible: true, inViewport: true, pulsed: true }} WorkDraftFocus */
/** @typedef {{ created: WorkCreatedDraft[], workspaceBefore: number, workspaceAfter: number, workspaceChanged: true, requiresHumanStart: true, focus: WorkDraftFocus }} WorkDraftReceipt */

/**
 * Project the exact bounded Work view already available to the person. The
 * complete packs never cross the page-tool boundary and every denominator is
 * explicit so expanding, filtering, or changing density cannot hide scope.
 *
 * @param {unknown} input
 * @returns {WorkView | null}
 */
export function workPageView(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const scope = workScopeView(candidate.scope);
	const counts = workCountsView(candidate.counts);
	const recommendation = workDecisionRecommendationView(candidate.recommendation);
	if (!scope || !counts || recommendation === undefined || !Array.isArray(candidate.items)) return null;

	const items = candidate.items.map(workItemPageView);
	if (items.some((item) => item === null)) return null;
	const projectedItems = /** @type {WorkItemView[]} */ (items);
	const recommendationAllowance = recommendation?.outsideCurrentView === true ? 1 : 0;
	if (
		new Set(projectedItems.map(({ id }) => id)).size !== projectedItems.length ||
		counts.shown !== projectedItems.length ||
		counts.matching !== counts.shown + counts.remaining ||
		counts.workspace < counts.matching ||
		counts.blocked > counts.matching ||
		(recommendation !== null && (
			recommendation.decisionCount < 1 ||
			recommendation.decisionCount > counts.matching + recommendationAllowance ||
			recommendation.blockedCount < counts.blocked ||
			recommendation.blockedCount > counts.blocked + recommendationAllowance ||
			recommendation.overdueCount > counts.matching + recommendationAllowance
		))
	) {
		return null;
	}

	return { scope, counts, recommendation, items: projectedItems };
}

/** @param {unknown} input @returns {WorkItemView | null} */
export function workItemPageView(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const id = exactWorkId(candidate.id);
	const title = normalizedText(candidate.title);
	const workflow = normalizedText(candidate.workflow);
	const owner = nullableText(candidate.owner);
	const due = nullableText(candidate.due);
	const blocker = nullableText(candidate.blocker);
	if (!id || !title || !workflow || owner === undefined || due === undefined || blocker === undefined) return null;
	return {
		id,
		title,
		href: `/next?pack=${encodeURIComponent(id)}`,
		workflow,
		owner,
		due,
		blocker
	};
}

/** @param {() => WorkView | null} getWork */
export function createCurrentWorkTool(getWork) {
	if (typeof getWork !== 'function') throw new TypeError('Work WebMCP requires a current-view getter.');
	return {
		name: WORK_CURRENT_TOOL_NAME,
		title: 'Get current Work view',
		description: 'Read the exact filtered, sorted, density-aware, and bounded work-item view currently rendered on Work, including explicit workspace, matching, shown, and remaining counts plus the rendered decision recommendation when one is visible.',
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
			return cloneWorkView(getWork());
		}
	};
}

/** @param {(query: string) => Promise<WorkSearchReceipt>} showSearch */
export function createShowWorkSearchTool(showSearch) {
	if (typeof showSearch !== 'function') throw new TypeError('Work WebMCP requires a search presenter.');
	return {
		name: WORK_SEARCH_TOOL_NAME,
		title: 'Show Work search',
		description: "Set only Work's visible text search, preserving every other active page filter. This changes page-local presentation, focuses the first result or search field, and never modifies workspace data.",
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					maxLength: WORK_SEARCH_MAX_LENGTH,
					description: 'Text to show in Work search. Use an empty string to clear it.'
				}
			},
			required: ['query'],
			additionalProperties: false
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
			untrustedContentHint: true
		},
		/** @param {unknown} input @param {{ signal?: AbortSignal }} [options] */
		async execute(input, options = {}) {
			options.signal?.throwIfAborted();
			const query = workSearchInput(input);
			const receipt = workSearchReceipt(await showSearch(query));
			options.signal?.throwIfAborted();
			return receipt;
		}
	};
}

/** @param {(input: WorkDraftInput) => Promise<WorkDraftReceipt>} createDrafts */
export function createWorkDraftsTool(createDrafts) {
	if (typeof createDrafts !== 'function') throw new TypeError('Work WebMCP requires a draft-work creator.');
	const draftProperties = {
		title: { type: 'string', minLength: 1, maxLength: WORK_TITLE_MAX_LENGTH, description: 'Required NFC-normalized work title, bounded by Unicode characters.' },
		owner: { type: 'string', maxLength: 120 },
		area: { type: 'string', maxLength: 120 },
		type: { type: 'string', maxLength: 120 },
		due: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
		energy: { type: 'string', enum: ['low', 'medium', 'high'] },
		recurrence: { type: 'string', maxLength: 120 },
		proofTarget: { type: 'string', maxLength: 1000 }
	};
	return {
		name: WORK_DRAFT_TOOL_NAME,
		title: 'Create draft work items',
		description: `Create one to ${WORK_DRAFT_MAX_ITEMS} browser-local work items atomically in Draft status. This changes the visible workspace but cannot start, block, complete, or delete work; a person must use the existing visible controls to act on every draft.`,
		inputSchema: {
			type: 'object',
			properties: {
				expectedWorkspaceCount: {
					type: 'integer',
					minimum: 0,
					description: 'Exact workspace count returned by the latest Work reader.'
				},
				drafts: {
					type: 'array',
					minItems: 1,
					maxItems: WORK_DRAFT_MAX_ITEMS,
					items: {
						type: 'object',
						properties: draftProperties,
						required: ['title'],
						additionalProperties: false
					}
				}
			},
			required: ['expectedWorkspaceCount', 'drafts'],
			additionalProperties: false
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
			untrustedContentHint: true
		},
		/** @param {unknown} input @param {{ signal?: AbortSignal }} [options] */
		async execute(input, options = {}) {
			options.signal?.throwIfAborted();
			const createInput = workDraftInput(input);
			return workDraftReceipt(await createDrafts(createInput), createInput);
		}
	};
}

/** @param {unknown} input @returns {WorkDraftInput} */
export function workDraftInput(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new TypeError('Work draft preparation requires an object input.');
	}
	const candidate = /** @type {Record<string, unknown>} */ (input);
	if (Object.keys(candidate).some((key) => key !== 'expectedWorkspaceCount' && key !== 'drafts')) {
		throw new TypeError('Work draft preparation accepts only expectedWorkspaceCount and drafts.');
	}
	if (!Number.isSafeInteger(candidate.expectedWorkspaceCount) || /** @type {number} */ (candidate.expectedWorkspaceCount) < 0) {
		throw new TypeError('Work draft preparation requires a non-negative workspace count.');
	}
	if (!Array.isArray(candidate.drafts) || candidate.drafts.length < 1 || candidate.drafts.length > WORK_DRAFT_MAX_ITEMS) {
		throw new TypeError(`Work draft preparation requires one to ${WORK_DRAFT_MAX_ITEMS} drafts.`);
	}
	const drafts = candidate.drafts.map(workCreationDraft);
	const titleKeys = drafts.map(({ title }) => title.toLocaleLowerCase('en-US'));
	if (new Set(titleKeys).size !== titleKeys.length) throw new TypeError('Work draft titles must be unique.');
	return {
		expectedWorkspaceCount: /** @type {number} */ (candidate.expectedWorkspaceCount),
		drafts
	};
}

/** @param {unknown} input @returns {WorkCreationDraft} */
function workCreationDraft(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Each Work draft must be an object.');
	const candidate = /** @type {Record<string, unknown>} */ (input);
	if (Object.keys(candidate).some((key) => !WORK_DRAFT_FIELDS.has(key))) throw new TypeError('Work drafts contain an unsupported field.');
	const title = normalizeWorkTitle(candidate.title);
	if (!title) throw new TypeError('Work draft title is outside its allowed length.');
	const owner = workDraftText(candidate.owner, 120);
	const area = workDraftText(candidate.area, 120);
	const type = workDraftText(candidate.type, 120);
	const due = workDraftText(candidate.due, 40);
	const energy = workDraftText(candidate.energy, 40);
	const recurrence = workDraftText(candidate.recurrence, 120);
	const proofTarget = workDraftText(candidate.proofTarget, 1000);
	if (due && !exactCalendarDay(due)) throw new TypeError('Work draft due date must be a valid calendar date.');
	if (energy && !WORK_DRAFT_ENERGIES.has(energy)) throw new TypeError('Work draft energy is not supported.');
	return { title, owner, area, type, due, energy, recurrence, proofTarget };
}

/** @param {unknown} value @param {number} maxLength */
function workDraftText(value, maxLength) {
	if (value === undefined) return null;
	const text = normalizeBoundedText(value, maxLength);
	if (text === null) throw new TypeError('Work draft text is outside its allowed length.');
	return text || null;
}

/** @param {string} value */
function exactCalendarDay(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** @param {unknown} input @param {WorkDraftInput} createInput @returns {WorkDraftReceipt} */
function workDraftReceipt(input, createInput) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Work draft creation returned no verifiable receipt.');
	const candidate = /** @type {Record<string, unknown>} */ (input);
	if (!Array.isArray(candidate.created) || candidate.created.length !== createInput.drafts.length) {
		throw new TypeError('Work draft creation returned no verifiable created items.');
	}
	const created = candidate.created.map((entry, index) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('Work draft creation returned an invalid item.');
		const item = /** @type {Record<string, unknown>} */ (entry);
		const id = exactWorkId(item.id);
		const title = normalizedText(item.title);
		if (!id || title !== createInput.drafts[index].title || item.status !== 'draft') throw new TypeError('Work draft creation returned an invalid item.');
		return { id, title, status: /** @type {'draft'} */ ('draft') };
	});
	const focus = candidate.focus;
	if (
		candidate.workspaceBefore !== createInput.expectedWorkspaceCount ||
		candidate.workspaceAfter !== createInput.expectedWorkspaceCount + created.length ||
		candidate.workspaceChanged !== true || candidate.requiresHumanStart !== true ||
		!focus || typeof focus !== 'object' || Array.isArray(focus)
	) throw new TypeError('Work draft creation returned no verifiable receipt.');
	const focusCandidate = /** @type {Record<string, unknown>} */ (focus);
	if (
		focusCandidate.id !== 'work-webmcp-activity' || focusCandidate.focused !== true ||
		focusCandidate.focusVisible !== true || focusCandidate.inViewport !== true || focusCandidate.pulsed !== true
	) throw new TypeError('Work draft preparation focus was not verified.');
	return {
		created,
		workspaceBefore: createInput.expectedWorkspaceCount,
		workspaceAfter: createInput.expectedWorkspaceCount + created.length,
		workspaceChanged: true,
		requiresHumanStart: true,
		focus: { id: 'work-webmcp-activity', focused: true, focusVisible: true, inViewport: true, pulsed: true }
	};
}

/** @param {unknown} input @returns {WorkScopeView | null} */
function workScopeView(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const search = exactSearch(candidate.search);
	const appliedSearch = exactSearch(candidate.appliedSearch);
	const status = normalizedText(candidate.status);
	const energy = normalizedText(candidate.energy);
	const area = normalizedText(candidate.area);
	const recurrence = normalizedText(candidate.recurrence);
	const owner = normalizedText(candidate.owner);
	const dueUrgency = normalizedText(candidate.dueUrgency);
	const sort = normalizedText(candidate.sort);
	const density = normalizedText(candidate.density);
	if (
		search === null || appliedSearch === null || !status || !WORK_STATUSES.has(status) || !energy || !area || !recurrence || !owner ||
		!dueUrgency || !WORK_DUE_SCOPES.has(dueUrgency) || !sort || !WORK_SORTS.has(sort) ||
		!density || !WORK_DENSITIES.has(density) || typeof candidate.hideDone !== 'boolean' || typeof candidate.focusMode !== 'boolean'
	) {
		return null;
	}
	return {
		search,
		appliedSearch,
		status,
		energy,
		area,
		recurrence,
		owner,
		dueUrgency,
		sort,
		hideDone: candidate.hideDone,
		focusMode: candidate.focusMode,
		density: /** @type {WorkDensity} */ (density)
	};
}

/** @param {unknown} input @returns {WorkCountsView | null} */
function workCountsView(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const keys = ['workspace', 'matching', 'shown', 'remaining', 'blocked'];
	if (keys.some((key) => !Number.isInteger(candidate[key]) || /** @type {number} */ (candidate[key]) < 0)) return null;
	return {
		workspace: /** @type {number} */ (candidate.workspace),
		matching: /** @type {number} */ (candidate.matching),
		shown: /** @type {number} */ (candidate.shown),
		remaining: /** @type {number} */ (candidate.remaining),
		blocked: /** @type {number} */ (candidate.blocked)
	};
}

/** @param {unknown} input @returns {WorkDecisionRecommendationView | null | undefined} */
function workDecisionRecommendationView(input) {
	if (input === null) return null;
	if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const id = exactWorkId(candidate.id);
	const title = normalizedText(candidate.title);
	const reason = normalizedText(candidate.reason);
	const decider = nullableText(candidate.decider);
	const decisionCount = nonNegativeSafeInteger(candidate.decisionCount);
	const blockedCount = nonNegativeSafeInteger(candidate.blockedCount);
	const overdueCount = nonNegativeSafeInteger(candidate.overdueCount);
	const sourceCount = nonNegativeSafeInteger(candidate.sourceCount);
	const outsideCurrentView = candidate.outsideCurrentView === true;
	if (candidate.outsideCurrentView !== undefined && typeof candidate.outsideCurrentView !== 'boolean') return undefined;
	if (!id || !title || !reason || decider === undefined || decisionCount === null || blockedCount === null || overdueCount === null || sourceCount === null) return undefined;
	return {
		id,
		title,
		href: decisionWorkspaceNextHref(id),
		reviewHref: decisionWorkspaceReviewHref(id),
		reason,
		decider,
		decisionCount,
		blockedCount,
		overdueCount,
		sourceCount,
		...(outsideCurrentView ? { outsideCurrentView: true } : {})
	};
}

/** @param {unknown} value @returns {number | null} */
function nonNegativeSafeInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** @param {unknown} input */
function requireEmptyInput(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0) {
		throw new TypeError('Work current view requires an empty object.');
	}
}

/** @param {unknown} input */
function workSearchInput(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new TypeError('Work search requires an object input.');
	}
	const candidate = /** @type {Record<string, unknown>} */ (input);
	if (Object.keys(candidate).some((key) => key !== 'query')) {
		throw new TypeError('Work search accepts only query.');
	}
	if (typeof candidate.query !== 'string') throw new TypeError('Work search query must be a string.');
	if (/\p{Cc}/u.test(candidate.query)) throw new TypeError('Work search query cannot contain control characters.');
	const query = normalizeWorkSearch(candidate.query);
	if (query === null) throw new TypeError(`Work search query must be ${WORK_SEARCH_MAX_LENGTH} characters or fewer.`);
	return query;
}

/**
 * The single public Work-search normalizer. Route-arrival input must fail
 * closed while the page tool reports invalid caller input, so callers decide
 * whether a null result becomes the all-work view or a validation error.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeWorkSearch(value) {
	if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return null;
	const query = value.trim();
	return query.length <= WORK_SEARCH_MAX_LENGTH ? query : null;
}

/**
 * Normalize route input without giving a URL any authority beyond Work's
 * local visible search. Invalid input deliberately falls back to all work.
 *
 * @param {unknown} value
 */
export function routeWorkSearch(value) {
	return normalizeWorkSearch(value) ?? '';
}

/**
 * Build the human receipt only from the validated presenter result. This
 * freezes the exact live rendered denominators returned by the canonical Work
 * search setter; later human scope changes invalidate the receipt by scopeKey.
 *
 * @param {unknown} input
 * @returns {WorkPresentationReceipt}
 */
export function workSearchPresentationReceipt(input) {
	const { changed, query, work } = workSearchReceipt(input);
	const queryLabel = query ? `“${query}”` : 'All work · search cleared';
	const summary = query
		? `Work search ${changed ? 'updated' : 'confirmed'} for “${query}”.`
		: changed
			? 'Work search cleared to show all work.'
			: 'Work search is already clear.';
	return {
		summary,
		cells: [
			{ label: 'Visible query', value: queryLabel },
			{
				label: 'Current scope',
				value: `${work.counts.shown} shown · ${work.counts.matching} matching · ${work.counts.workspace} workspace`
			},
			{ label: 'Evidence', value: `${work.counts.blocked} blocked in the matching work` },
			{ label: 'Status', value: 'Visible search updated · Not saved' }
		],
		scopeKey: JSON.stringify({ scope: work.scope, counts: work.counts })
	};
}

/** @param {unknown} input @returns {WorkSearchReceipt} */
function workSearchReceipt(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new TypeError('Work search did not return a verifiable page receipt.');
	}
	const candidate = /** @type {Record<string, unknown>} */ (input);
	const query = exactSearch(candidate.query);
	const work = cloneWorkView(candidate.work);
	const focus = workSearchFocus(candidate.focus);
	if (
		typeof candidate.changed !== 'boolean' || query === null || !work || !focus ||
		work.scope.search !== query || work.scope.appliedSearch !== query
	) {
		throw new TypeError('Work search did not return a verifiable page receipt.');
	}
	const firstId = work.items[0]?.id ?? null;
	if (
		(focus.target === 'item' && focus.itemId !== firstId) ||
		(focus.target === 'search' && firstId !== null)
	) {
		throw new TypeError('Work search focus did not match the rendered result.');
	}
	return { changed: candidate.changed, query, focus, work };
}

/** @param {unknown} input @returns {WorkSearchFocus | null} */
function workSearchFocus(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	const candidate = /** @type {Record<string, unknown>} */ (input);
	if (
		candidate.focused !== true || candidate.focusVisible !== true ||
		candidate.inViewport !== true || candidate.pulsed !== true
	) return null;
	const evidence = { focused: true, focusVisible: true, inViewport: true, pulsed: true };
	if (candidate.target === 'search' && candidate.itemId === null) {
		return { target: 'search', itemId: null, ...evidence };
	}
	const itemId = normalizedText(candidate.itemId);
	return candidate.target === 'item' && itemId ? { target: 'item', itemId, ...evidence } : null;
}

/** @param {unknown} view @returns {WorkView | null} */
function cloneWorkView(view) {
	return workPageView(view);
}

/** @param {unknown} value @returns {string | null} */
function exactSearch(value) {
	if (typeof value !== 'string' || value.length > WORK_SEARCH_MAX_LENGTH || /\p{Cc}/u.test(value)) return null;
	return value;
}

/** @param {unknown} value @returns {string | null} */
function normalizedText(value) {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text || null;
}

/** @param {unknown} value @returns {string | null | undefined} */
function nullableText(value) {
	return value === null ? null : normalizedText(value) ?? undefined;
}
