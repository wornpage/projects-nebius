export const DECISION_WORKSPACE_CONTEXT = 'decision-workspace';
export const DECISION_WORKSPACE_CONTEXT_REASON = "This item remains an explicit open decision. Decision Workspace selects the first open decision in Work's filtered and sorted view.";

const DECIDER_MAX_LENGTH = 200;
const SINGLE_LINE_CONTROL = /\p{Cc}/u;

/** @param {unknown} workId @returns {string} */
export function decisionWorkspaceNextHref(workId) {
	const normalizedId = exactWorkId(workId);
	if (!normalizedId) throw new TypeError('Decision Workspace navigation requires an exact work item id.');
	return `/next?pack=${encodeURIComponent(normalizedId)}&context=${DECISION_WORKSPACE_CONTEXT}`;
}

/** @param {unknown} workId @returns {string} */
export function decisionWorkspaceReviewHref(workId) {
	const normalizedId = exactWorkId(workId);
	if (!normalizedId) throw new TypeError('Decision Workspace navigation requires an exact work item id.');
	return `/review?focus=${encodeURIComponent(normalizedId)}`;
}

export const PENDING_DECISION_CONTEXT = 'pending-decision';
export const PENDING_DECISION_FOCUS_MAX_LENGTH = 200;

/** @param {unknown} value @returns {string | null} */
function boundedPendingDecisionId(value) {
	if (typeof value !== 'string' || !value.trim() || value.length > PENDING_DECISION_FOCUS_MAX_LENGTH || SINGLE_LINE_CONTROL.test(value)) return null;
	return value;
}

/** @param {unknown} workId @returns {string | null} */
export function pendingDecisionWorkHref(workId) {
	const normalizedId = boundedPendingDecisionId(workId);
	return normalizedId
		? `/work?focus=${encodeURIComponent(normalizedId)}&context=${PENDING_DECISION_CONTEXT}`
		: null;
}

/**
 * Read only the explicit Pending-approvals resume contract. Generic Work card
 * focus links remain separate and never gain decision or persistence authority.
 *
 * @param {unknown} searchParams
 * @returns {{ present: boolean, workId: string }}
 */
export function decisionWorkspaceWorkFocusRequest(searchParams) {
	if (!searchParams || typeof /** @type {{ getAll?: unknown }} */ (searchParams).getAll !== 'function') {
		return { present: false, workId: '' };
	}
	const params = /** @type {{ getAll: (name: string) => string[] }} */ (searchParams);
	const contexts = params.getAll('context');
	if (!contexts.includes(PENDING_DECISION_CONTEXT)) return { present: false, workId: '' };
	const workIds = params.getAll('focus');
	if (contexts.length !== 1 || workIds.length !== 1) return { present: true, workId: '' };
	return { present: true, workId: boundedPendingDecisionId(workIds[0]) || '' };
}

/**
 * Accept one exact focus request only. The Review route still has to prove the
 * requested id is in its currently rendered review queue before focusing it.
 *
 * @param {unknown} searchParams
 * @returns {{ present: boolean, workId: string }}
 */
export function decisionWorkspaceReviewFocusRequest(searchParams) {
	if (!searchParams || typeof /** @type {{ getAll?: unknown }} */ (searchParams).getAll !== 'function') {
		return { present: false, workId: '' };
	}
	const params = /** @type {{ getAll: (name: string) => string[] }} */ (searchParams);
	const workIds = params.getAll('focus');
	if (workIds.length === 0) return { present: false, workId: '' };
	return {
		present: true,
		workId: workIds.length === 1 ? exactWorkId(workIds[0]) || '' : ''
	};
}

/**
 * Treat the route marker only as a bounded presentation request. The caller
 * must still verify that the exact loaded pack remains an open decision.
 *
 * @param {unknown} searchParams
 * @returns {string}
 */
export function decisionWorkspaceContextPackId(searchParams) {
	if (!searchParams || typeof /** @type {{ getAll?: unknown }} */ (searchParams).getAll !== 'function') return '';
	const params = /** @type {{ getAll: (name: string) => string[] }} */ (searchParams);
	const contexts = params.getAll('context');
	const workIds = params.getAll('pack');
	if (contexts.length !== 1 || contexts[0] !== DECISION_WORKSPACE_CONTEXT || workIds.length !== 1) return '';
	return exactWorkId(workIds[0]) || '';
}

/** @param {unknown} value @returns {string | null} */
export function decisionWorkspaceContextDecider(value) {
	if (typeof value !== 'string' || SINGLE_LINE_CONTROL.test(value)) return null;
	const normalized = value.trim();
	return normalized && normalized.length <= DECIDER_MAX_LENGTH ? normalized : null;
}

/** @param {unknown} value @returns {string | null} */
export function exactWorkId(value) {
	return typeof value === 'string' && Boolean(value.trim())
		? value
		: null;
}
