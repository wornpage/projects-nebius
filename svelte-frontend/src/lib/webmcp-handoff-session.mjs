const WEBMCP_HANDOFF_STEP_IDS = Object.freeze([
	'work-scope',
	'review-scope',
	'next-proposal',
	'draft-batch',
	'human-decision'
]);

const STEP_ORDER = new Map(WEBMCP_HANDOFF_STEP_IDS.map((id, index) => [id, index]));
const SESSION_FIELDS = new Set(['steps']);
const STEP_FIELDS = new Set(['id', 'title', 'summary', 'status', 'outcome', 'count']);
const STEP_STATES = Object.freeze({
	'work-scope': new Set(['complete:scope-verified']),
	'review-scope': new Set(['complete:scope-verified']),
	'next-proposal': new Set(['complete:proposal-prepared']),
	'draft-batch': new Set(['complete:drafts-created']),
	'human-decision': new Set([
		'pending:proposal-pending',
		'complete:proposal-approved',
		'complete:proposal-discarded'
	])
});

/** @typedef {{ id: string, title: string, summary: string, status: string, outcome: string, count?: number }} WebMcpHandoffStep */

/** @returns {{ steps: WebMcpHandoffStep[] }} */
export function emptyWebMcpHandoffSession() {
	return { steps: [] };
}

/**
 * @param {{ steps?: unknown }} session
 * @param {unknown} input
 */
export function recordWebMcpHandoffStepState(session, input) {
	const current = webMcpHandoffSessionView(session);
	const step = webMcpHandoffStep(input);
	const steps = current.steps
		.filter((candidate) => candidate.id !== step.id)
		.concat(step)
		.sort((left, right) => stepOrder(left.id) - stepOrder(right.id));
	return { steps };
}

/**
 * Terminalize only a consumed WebMCP-origin draft. Human-origin drafts leave
 * the verified handoff trail unchanged.
 *
 * @param {{ steps?: unknown }} session
 * @param {{ source?: unknown }} draft
 * @param {'proposal-approved' | 'proposal-discarded'} outcome
 */
export function recordWebMcpDraftDecisionState(session, draft, outcome) {
	const current = webMcpHandoffSessionView(session);
	if (!draft || (draft.source !== 'human' && draft.source !== 'webmcp')) {
		throw new TypeError('Pending next-action draft source is not recognized.');
	}
	if (outcome !== 'proposal-approved' && outcome !== 'proposal-discarded') {
		throw new TypeError('Pending next-action draft outcome is not recognized.');
	}
	if (draft.source === 'human') return current;
	return recordWebMcpHandoffStepState(current, {
		id: 'human-decision',
		title: 'Human decision',
		summary: outcome === 'proposal-approved' ? 'Approved and saved by person' : 'Discarded by person',
		status: 'complete',
		outcome
	});
}

/**
 * @param {{ steps?: unknown }} session
 * @returns {{ steps: WebMcpHandoffStep[], completedCount: number, pendingCount: number, currentStep: WebMcpHandoffStep | null, outcomeSummary: string }}
 */
export function webMcpHandoffTrailView(session) {
	const { steps } = webMcpHandoffSessionView(session);
	const draftStep = steps.find(({ id }) => id === 'draft-batch') || null;
	const decisionStep = steps.find(({ id }) => id === 'human-decision') || null;
	const outcomeParts = [];
	if (draftStep) {
		const draftCount = draftStep.count;
		if (typeof draftCount !== 'number') throw new TypeError('WebMCP Draft handoff step requires a count.');
		outcomeParts.push(`${draftCount} ${draftCount === 1 ? 'Draft' : 'Drafts'} created · none started`);
	}
	if (decisionStep) {
		outcomeParts.push({
			'proposal-pending': 'Proposal pending',
			'proposal-approved': 'Proposal approved',
			'proposal-discarded': 'Proposal discarded'
		}[decisionStep.outcome]);
	} else if (steps.some(({ id }) => id === 'next-proposal')) {
		outcomeParts.push('Proposal prepared');
	}
	return {
		steps,
		completedCount: steps.filter(({ status }) => status === 'complete').length,
		pendingCount: steps.filter(({ status }) => status === 'pending').length,
		currentStep: steps.at(-1) || null,
		outcomeSummary: outcomeParts.join(' · ') || (steps.length ? 'Read-only actions verified' : 'No action recorded')
	};
}

/** @param {{ steps?: unknown }} input @returns {{ steps: WebMcpHandoffStep[] }} */
function webMcpHandoffSessionView(input) {
	if (!input || typeof input !== 'object' || !Array.isArray(input.steps)) {
		throw new TypeError('WebMCP handoff session requires a steps array.');
	}
	if (Object.keys(input).some((key) => !SESSION_FIELDS.has(key))) {
		throw new TypeError('WebMCP handoff session contains an unsupported field.');
	}
	const steps = input.steps.map(webMcpHandoffStep);
	if (new Set(steps.map(({ id }) => id)).size !== steps.length) {
		throw new TypeError('WebMCP handoff session step ids must be unique.');
	}
	for (let index = 1; index < steps.length; index += 1) {
		if (stepOrder(steps[index - 1].id) >= stepOrder(steps[index].id)) {
			throw new TypeError('WebMCP handoff session steps must use canonical order.');
		}
	}
	return { steps: steps.map((step) => ({ ...step })) };
}

/** @param {string} id */
function stepOrder(id) {
	const order = STEP_ORDER.get(id);
	if (order === undefined) throw new TypeError('WebMCP handoff step id is not recognized.');
	return order;
}

/** @param {unknown} input @returns {WebMcpHandoffStep} */
function webMcpHandoffStep(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new TypeError('WebMCP handoff step requires an object.');
	}
	const candidate = /** @type {Record<string, unknown>} */ (input);
	if (Object.keys(candidate).some((key) => !STEP_FIELDS.has(key))) {
		throw new TypeError('WebMCP handoff step contains an unsupported field.');
	}
	const id = normalizedText(candidate.id, 'id', 40);
	if (!STEP_ORDER.has(id)) throw new TypeError('WebMCP handoff step id is not recognized.');
	const status = normalizedText(candidate.status, 'status', 20);
	const outcome = normalizedText(candidate.outcome, 'outcome', 40);
	const stepId = /** @type {keyof typeof STEP_STATES} */ (id);
	if (!STEP_STATES[stepId].has(`${status}:${outcome}`)) {
		throw new TypeError('WebMCP handoff step status and outcome do not match.');
	}
	const count = Number.isInteger(candidate.count) ? /** @type {number} */ (candidate.count) : null;
	if (id === 'draft-batch' && (count === null || count < 1 || count > 3)) {
		throw new TypeError('WebMCP Draft handoff step requires a count from 1 to 3.');
	}
	if (id !== 'draft-batch' && candidate.count !== undefined) {
		throw new TypeError('Only the WebMCP Draft handoff step accepts a count.');
	}
	const step = {
		id,
		title: normalizedText(candidate.title, 'title', 80),
		summary: normalizedText(candidate.summary, 'summary', 400),
		status,
		outcome
	};
	return id === 'draft-batch' ? { ...step, count: /** @type {number} */ (count) } : step;
}

/** @param {unknown} value @param {string} field @param {number} maxLength */
function normalizedText(value, field, maxLength) {
	if (typeof value !== 'string') throw new TypeError(`WebMCP handoff ${field} must be text.`);
	const text = value.trim().replace(/\s+/gu, ' ');
	if (!text || text.length > maxLength) {
		throw new TypeError(`WebMCP handoff ${field} must contain 1 to ${maxLength} characters.`);
	}
	return text;
}
