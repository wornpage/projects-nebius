import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

const RECORDING_WORK_QUERY = 'Garage reset';
const RECORDING_DENOMINATORS = {
	guide: { visible: 8, workspace: 8 },
	work: { workspace: 8, matching: 4, blocked: 2 },
	review: { total: 5, searchMatches: 3, filtered: 2, shown: 2 },
	drafts: { before: 8, created: 3, after: 11 }
};
const RECORDING_DRAFT_TITLES = [
	'Confirm donation pickup window',
	'Print shelf labels',
	'Prepare bike rack checklist'
];
const RECORDING_LANDING_FRAME = {
	heading: 'Let an agent find the next move. Keep the final say.',
	lede: 'Browser workers read and narrow the same work you see, can add bounded Draft items, then prepare an unsaved next action for you to approve.',
	facts: ['No backend', 'No automatic starts'],
	action: 'Open the handoff workflow →',
	previewLabel: 'WebMCP handoff in Review: the agent narrows visible work, explains a blocker, and prepares a next action for human approval.'
};
const RECORDING_GUIDE_OPENING_FRAME = {
	scope: { workspace: 8, visible: 8, countText: '8 visible of 8 workspace' },
	trail: { summary: 'Ready for one bounded run', detail: 'No agent action recorded.', outcome: 'No action recorded', progress: '0 verified actions, 0 pending' },
	toolText: 'WebMCP 1 tool',
	pendingNavigationCount: 0,
	actionReceiptCount: 0
};
const RECORDING_GUIDE_LOWER_FRAME = {
	brief: 'Use the WebMCP tools on Work, Review, and Next to inspect the visible project state, narrow the items that need attention, and prepare an evidence-based next action for my review. Do not save or change workspace data.',
	fastCreate: 'Use fast-create brief'
};

function buildRecordingActivityFrames(workQuery, denominators, draftTitles) {
	return {
		work: {
			route: 'work', step: 'Step 1 · Narrow Work', outcome: `Work search updated for “${workQuery}”.`,
			cells: { 'Visible query': `“${workQuery}”`, 'Current scope': `${denominators.work.matching} shown · ${denominators.work.matching} matching · ${denominators.work.workspace} workspace`, Evidence: `${denominators.work.blocked} blocked in the matching work`, Status: 'Visible search updated · Not saved' },
			authority: 'Page view only · Workspace unchanged', provenance: 'WebMCP · show_work_search'
		},
		review: {
			route: 'review', step: 'Step 2 · Verify Review', outcome: `Review scope updated: “${workQuery}” · Blocked.`,
			cells: { 'Visible Review scope': `“${workQuery}” · Blocked`, 'Current queue': `${denominators.review.shown} shown · ${denominators.review.filtered} filtered · ${denominators.review.searchMatches} search matches · ${denominators.review.total} total review`, 'Search-match evidence': `${denominators.review.shown} blocked · 0 missing next · 0 missing owner`, Status: 'Visible queue updated · Not saved' },
			authority: 'Page view only · Workspace unchanged', provenance: 'WebMCP · set_review_scope'
		},
		next: {
			route: 'next', step: 'Step 3 · Prepare Next', outcome: 'Draft prepared — waiting for your approval.',
			cells: { 'Verified evidence': 'Garage reset: sort shelves — Workflow: Blocked. Garage reset: sort shelves — Blocker: Waiting on storage bins.', Status: 'Draft — waiting for your approval', Save: 'Not saved' },
			authority: 'Unsaved proposal · Human approval required', provenance: 'WebMCP · prepare_next_action'
		},
		draft: {
			route: 'work', step: 'Step 4 · Stage Drafts', outcome: `${denominators.drafts.created} draft work items created for human review.`,
			cells: { Created: `${denominators.drafts.created} · Draft`, 'Draft work': draftTitles.join(' · '), Workspace: `${denominators.drafts.before} → ${denominators.drafts.after}`, Authority: 'No work started · Human Start required' },
			authority: 'Draft only · Human Start required', provenance: 'WebMCP · create_work_drafts'
		}
	};
}

export const RECORDING_PREFLIGHT_SPEC = deepFreeze({
	productionUrl: 'https://projects-webmcp-extension.pages.dev/',
	targetDurationMs: 110_000,
	hardStopMs: 120_000,
	routeSettleMs: 2_250,
	browser: {
		name: 'Google Chrome',
		headed: true,
		viewport: null,
		presentation: 'fullscreen',
		toolbar: 'hidden',
		startFullscreen: true,
		nativeInnerWidth: 1_116,
		nativeInnerHeight: 698,
		nativeClientWidth: 1_101,
		nativeClientHeight: 698,
		nativeScrollWidth: 1_101,
		profilePrefix: 'projects-webmcp-recording-preflight-'
	},
	routes: {
		landing: { path: '/', heading: RECORDING_LANDING_FRAME.heading, tools: [] },
		guide: { path: '/webmcp-challenge', heading: 'Projects handoff guide', tools: ['get_projects_handoff_guide'] },
		priority: { path: '/priority', heading: 'Priority', tools: ['get_next_recommendation'] },
		work: { path: '/work', heading: 'Work', tools: ['get_current_work_view', 'show_work_search', 'create_work_drafts'] },
		review: { path: '/review', heading: 'Review', tools: ['get_current_review_queue', 'set_review_scope'] },
		next: { path: '/next', headings: ['Set the next action', 'Review the proposed next action'], tools: ['get_current_next_editor', 'prepare_next_action'] }
	},
	toolSequence: [
		'get_projects_handoff_guide',
		'get_current_work_view',
		'show_work_search',
		'get_current_review_queue',
		'set_review_scope',
		'get_current_next_editor',
		'prepare_next_action',
		'get_current_work_view',
		'create_work_drafts'
	],
	keyboard: {
		landingBodyTabs: 1,
		landingToGuideTabs: 5,
		guideToToolsTabs: 5,
		toolsToPriorityTabs: 2,
		priorityToGuideShiftTabs: 5,
		guideToFastBriefShiftTabs: 5,
		guideReaderBodyTabs: 1,
		guideToWorkTabs: 9,
		workToToolsShiftTabs: 11,
		toolsToReviewTabs: 3,
		reviewToToolsShiftTabs: 3,
		toolsToNextTabs: 4,
		nextToWorkShiftTabs: 5,
		workToPendingShiftTabs: 13,
		pendingToNextTabs: 2,
		guideBodyPageDowns: 1,
		nextBodyArrowDowns: 4,
		finalBodyArrowDowns: 8
	},
	denominators: RECORDING_DENOMINATORS,
	workQuery: RECORDING_WORK_QUERY,
	reviewFilter: 'blocked',
	nextChoice: 'Confirm storage bin delivery',
	priorityRecommendation: {
		title: 'Garden study: log interviews',
		reason: 'Due in 6 days · No blocker or pending decision.',
		workId: 'garden-study-log-interviews',
		destination: '/next?pack=garden-study-log-interviews',
		action: 'Open next action'
	},
	landingFrame: RECORDING_LANDING_FRAME,
	guideOpeningFrame: RECORDING_GUIDE_OPENING_FRAME,
	guideLowerFrame: RECORDING_GUIDE_LOWER_FRAME,
	activityFrames: buildRecordingActivityFrames(RECORDING_WORK_QUERY, RECORDING_DENOMINATORS, RECORDING_DRAFT_TITLES),
	draftTitles: RECORDING_DRAFT_TITLES,
	trail: [
		{ checkpoint: 'work', verified: 1, pending: 0, decide: 'absent' },
		{ checkpoint: 'review', verified: 2, pending: 0, decide: 'absent' },
		{ checkpoint: 'next', verified: 3, pending: 1, decide: 'pending' },
		{ checkpoint: 'drafts', verified: 4, pending: 1, decide: 'pending' },
		{ checkpoint: 'final', verified: 4, pending: 1, decide: 'pending' }
	],
	timeline: [
		{ atMs: 0, id: 'landing-hold' },
		{ atMs: 6_000, id: 'landing-to-guide' },
		{ atMs: 12_000, id: 'guide-body-page-down' },
		{ atMs: 18_000, id: 'guide-to-priority' },
		{ atMs: 25_000, id: 'priority-to-guide' },
		{ atMs: 30_000, id: 'guide-to-work' },
		{ atMs: 46_000, id: 'work-to-review' },
		{ atMs: 60_000, id: 'review-to-next' },
		{ atMs: 70_000, id: 'next-body-arrow-downs' },
		{ atMs: 78_000, id: 'next-to-work' },
		{ atMs: 86_000, id: 'create-drafts' },
		{ atMs: 96_000, id: 'work-to-pending' },
		{ atMs: 103_000, id: 'final-body-arrow-downs' },
		{ atMs: 109_500, id: 'final-acceptance' }
	],
	allowedSameOriginFetches: ['/data/demo-packs.json'],
	forbiddenHumanActivations: ['Start', 'Save next action', 'Approve and save', 'Discard draft']
});

export const RECORDING_PREFLIGHT_TIMELINE_AT_MS = Object.freeze(Object.fromEntries(
	RECORDING_PREFLIGHT_SPEC.timeline.map(({ id, atMs }) => [id, atMs])
));
if (Object.keys(RECORDING_PREFLIGHT_TIMELINE_AT_MS).length !== RECORDING_PREFLIGHT_SPEC.timeline.length) {
	throw new Error('Recording preflight timeline ids must be unique.');
}

function cueMatch(markdown, expression, label) {
	const match = markdown.match(expression);
	if (!match) throw new Error(`Recording cue sheet is missing its exact ${label}.`);
	return match;
}

function integer(value) {
	return Number.parseInt(value, 10);
}

function cueBacktickValues(markdown, expression, label, expectedCount) {
	const line = cueMatch(markdown, expression, label)[0];
	const values = [...line.matchAll(/`([^`]+)`/gu)].map((match) => match[1]);
	if (values.length !== expectedCount) throw new Error(`Recording cue sheet ${label} must contain ${expectedCount} exact values.`);
	return values;
}

export function recordingCueProjectionFromSpec(spec = RECORDING_PREFLIGHT_SPEC) {
	return {
		productionUrl: spec.productionUrl,
		browser: {
			presentation: spec.browser.presentation,
			toolbar: spec.browser.toolbar,
			viewport: spec.browser.viewport,
			nativeInnerWidth: spec.browser.nativeInnerWidth,
			nativeInnerHeight: spec.browser.nativeInnerHeight,
			nativeClientWidth: spec.browser.nativeClientWidth,
			nativeClientHeight: spec.browser.nativeClientHeight,
			nativeScrollWidth: spec.browser.nativeScrollWidth
		},
		targetDurationMs: spec.targetDurationMs,
		hardStopMs: spec.hardStopMs,
		routeSettleMs: spec.routeSettleMs,
		catalogCounts: {
			guide: spec.routes.guide.tools.length,
			priority: spec.routes.priority.tools.length,
			work: spec.routes.work.tools.length,
			review: spec.routes.review.tools.length,
			next: spec.routes.next.tools.length
		},
		toolSequence: [...spec.toolSequence],
		timeline: spec.timeline.map(({ id, atMs }) => ({ id, atMs })),
		workQuery: spec.workQuery,
		reviewFilter: spec.reviewFilter,
		nextChoice: spec.nextChoice,
		priorityRecommendation: structuredClone(spec.priorityRecommendation),
		landingFrame: structuredClone(spec.landingFrame),
		guideOpeningFrame: structuredClone(spec.guideOpeningFrame),
		guideLowerFrame: structuredClone(spec.guideLowerFrame),
		activityFrames: structuredClone(spec.activityFrames),
		keyboard: {
			landingBodyTabs: spec.keyboard.landingBodyTabs,
			landingToGuideTabs: spec.keyboard.landingToGuideTabs,
			guideToToolsTabs: spec.keyboard.guideToToolsTabs,
			toolsToPriorityTabs: spec.keyboard.toolsToPriorityTabs,
			priorityToGuideShiftTabs: spec.keyboard.priorityToGuideShiftTabs,
			guideToFastBriefShiftTabs: spec.keyboard.guideToFastBriefShiftTabs,
			guideToWorkTabs: spec.keyboard.guideToWorkTabs,
			workToToolsShiftTabs: spec.keyboard.workToToolsShiftTabs,
			toolsToReviewTabs: spec.keyboard.toolsToReviewTabs,
			reviewToToolsShiftTabs: spec.keyboard.reviewToToolsShiftTabs,
			toolsToNextTabs: spec.keyboard.toolsToNextTabs,
			nextToWorkShiftTabs: spec.keyboard.nextToWorkShiftTabs,
			workToPendingShiftTabs: spec.keyboard.workToPendingShiftTabs,
			pendingToNextTabs: spec.keyboard.pendingToNextTabs,
			guideReaderBodyTabs: spec.keyboard.guideReaderBodyTabs
		},
		bodyScrolls: {
			owner: 'body',
			guide: { key: 'PageDown', count: spec.keyboard.guideBodyPageDowns },
			nextPrepared: { key: 'ArrowDown', count: spec.keyboard.nextBodyArrowDowns },
			final: { key: 'ArrowDown', count: spec.keyboard.finalBodyArrowDowns }
		},
		denominators: structuredClone(spec.denominators),
		draftTitles: [...spec.draftTitles],
		trail: spec.trail.map(({ checkpoint, verified, pending, decide }) => ({ checkpoint, verified, pending, decide }))
	};
}

/**
 * Parse the human cue sheet into the same contract projection used by the
 * executable preflight. This is intentionally strict: changing a denominator
 * or keyboard destination requires changing the cue and frozen spec together.
 */
export function parseRecordingCueSheet(markdown) {
	if (typeof markdown !== 'string') throw new TypeError('Recording cue sheet must be Markdown text.');
	const browser = cueMatch(markdown, /Put the captured tab in Chrome fullscreen so the browser toolbar is hidden[\s\S]*?native fullscreen Chrome viewport; do not apply a viewport override/u, 'fullscreen browser presentation');
	const productionUrl = cueMatch(markdown, /Production URL: `([^`]+)`\./u, 'production URL');
	const nativeGeometry = cueMatch(markdown, /fullscreen Google Chrome inner viewport (\d+) × (\d+), document client viewport (\d+) × (\d+) and scroll width (\d+)/u, 'native fullscreen geometry');
	const duration = cueMatch(markdown, /Target final length: \*\*(\d+):(\d{2})\*\*\. Hard stop: \*\*(\d+):(\d{2})\*\*\./u, 'target and hard-stop duration');
	const settle = cueMatch(markdown, /fixed \*\*(\d+(?:\.\d+)?)-second settle window\*\*/u, 'route-settle boundary');
	const catalogs = cueMatch(markdown, /Exact current-page catalogs:\s*Guide\s+(\d+)\s*\/\s*Priority\s+(\d+)\s*\/\s*Work\s+(\d+)\s*\/\s*Review\s+(\d+)\s*\/\s*Next\s+(\d+)\./u, 'route catalog denominator');
	const sequence = cueMatch(markdown, /Registered tool sequence:\s*`?([a-z][a-z0-9_]*(?:`?\s*→\s*`?[a-z][a-z0-9_]*)+)`?\./u, 'registered tool sequence')[1]
		.split(/`?\s*→\s*`?/u);
	const boundedInputs = cueMatch(markdown, /Exact bounded inputs: Work\/Review query `([^`]+)`; Review filter `([^`]+)`; Next choice `([^`]+)`\./u, 'bounded tool inputs');
	const priorityRecommendation = cueMatch(markdown, /Priority hold: title `([^`]+)`; reason `([^`]+)`; Work ID `([^`]+)`; destination `([^`]+)`; action `([^`]+)`; entire recommendation fully visible\./u, 'Priority hold');
	const workFrame = cueBacktickValues(markdown, /^15\. Work hold:[^\n]+$/mu, 'Work hold', 8);
	const reviewFrame = cueBacktickValues(markdown, /^16\. Review hold:[^\n]+$/mu, 'Review hold', 8);
	const nextFrame = cueBacktickValues(markdown, /^17\. Next hold:[^\n]+$/mu, 'Next hold', 7);
	const draftFrame = cueBacktickValues(markdown, /^18\. Draft hold:[^\n]+$/mu, 'Draft hold', 8);
	const landingFrame = cueBacktickValues(markdown, /^20\. Landing hold:[^\n]+$/mu, 'Landing hold', 6);
	const guideOpeningFrame = cueBacktickValues(markdown, /^12\. Opening Guide frame:[^\n]+$/mu, 'opening Guide frame', 6);
	const guideOpeningCount = cueMatch(guideOpeningFrame[0], /^(\d+) visible of (\d+) workspace$/u, 'opening Guide scope');
	const guideLowerFrame = cueBacktickValues(markdown, /^10\. Guide:[^\n]+$/mu, 'lower Guide frame', 2);
	const timelineText = cueMatch(markdown, /Executable target timeline: ([^\n]+)\./u, 'executable target timeline')[1];
	const timeline = timelineText.split(/\s*→\s*/u).map((entry) => {
		const match = cueMatch(entry, /^`([a-z][a-z0-9-]+)@(\d{2}):(\d{2})\.(\d{3})`$/u, 'timeline event');
		return { id: match[1], atMs: (integer(match[2]) * 60 + integer(match[3])) * 1_000 + integer(match[4]) };
	});
	const workToReview = cueMatch(markdown, /Work receipt → Review:\s*eleven Shift\+Tab presses to reach \*\*Tools\*\*, then Enter; three Tab presses in the dialog reach \*\*Review\*\*, then Enter/u, 'Work to Review keyboard destination');
	const reviewToNext = cueMatch(markdown, /Review receipt → Next:\s*three Shift\+Tab presses to reach \*\*Tools\*\*, then Enter; four Tab presses in the dialog reach \*\*Next\*\*, then Enter/u, 'Review to Next keyboard destination');
	const nextToWork = cueMatch(markdown, /Prepared Next receipt → Work:\s*five Shift\+Tab presses, then Enter on \*\*Work\*\*/u, 'Next to Work keyboard destination');
	const workToPending = cueMatch(markdown, /Work Draft receipt → pending decision:\s*thirteen Shift\+Tab presses to reach \*\*Pending 1\*\*, then Enter; two Tab presses in the dialog reach \*\*Review on Next\*\*, then Enter/u, 'Work to pending keyboard destination');
	const landingToGuide = cueMatch(markdown, /Landing → Guide: press Tab on the page body to reclaim focus, then use five additional Tab presses to reach \*\*Open the handoff workflow\*\* and press Enter; any earlier or later destination fails the take/u, 'Landing to Guide keyboard destination');
	const guideToPriority = cueMatch(markdown, /Guide → Priority:\s*five Tab presses to reach \*\*Tools\*\*, then Enter; two Tab presses in the dialog reach \*\*Priority\*\*, then Enter/u, 'Guide to Priority keyboard destination');
	const guideBodyTab = cueMatch(markdown, /press Tab once on the page body to reclaim page focus/u, 'Guide reader body-owned Tab');
	const priorityToGuide = cueMatch(markdown, /Priority → Guide:\s*five Shift\+Tab presses/u, 'Priority to Guide keyboard destination');
	const guideToFastBrief = cueMatch(markdown, /Returned Guide → fast brief:\s*five Shift\+Tab presses/u, 'Guide to fast brief keyboard destination');
	const guideToWork = cueMatch(markdown, /After the Guide reader inserts its receipt, reclaim page focus with one body-owned Tab, then use nine additional Tabs to reach \*\*Work\*\*/u, 'Guide reader to Work keyboard destination');
	const guidePageDown = cueMatch(markdown, /Guide:[^\n]*?one PageDown pressed on the page body/u, 'Guide body PageDown');
	const nextArrowDown = cueMatch(markdown, /Next:[^\n]*?four ArrowDown presses on the page body/u, 'prepared Next body ArrowDown');
	const finalArrowDown = cueMatch(markdown, /then send ArrowDown to the page body eight times at 01:43/u, 'final body ArrowDown');
	const work = cueMatch(markdown, /4 matching of 8; 2 blocked/u, 'Work 8 to 4 denominator');
	const guide = cueMatch(markdown, /(\d+) visible of (\d+); trail says `Ready for one bounded run`/u, 'Guide visible/workspace denominator');
	const review = cueMatch(markdown, /2 shown, 2 filtered, 3 search matches, 5 total/u, 'Review 5 to 3 to 2 denominator');
	const drafts = cueMatch(markdown, /`3 · Draft`; `8 → 11`/u, 'Draft 8 to 11 denominator');
	const titles = ['Confirm donation pickup window', 'Print shelf labels', 'Prepare bike rack checklist'];
	for (const title of titles) cueMatch(markdown, new RegExp(`(?:^|[\`])${title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:[\`]|$)`, 'mu'), `Draft title ${title}`);
	const trail = cueMatch(markdown, /trail advances from 1 verified → 2 verified → 3 verified \+ 1 pending → 4 verified \+ 1 pending[\s\S]*?Decide remains pending/u, 'action-trail progression');
	void workToReview; void reviewToNext; void nextToWork; void workToPending; void landingToGuide; void guideToPriority; void guideBodyTab; void priorityToGuide; void guideToFastBrief; void guideToWork;
	void browser; void guidePageDown; void nextArrowDown; void finalArrowDown; void work; void review; void drafts; void trail;
	return {
		productionUrl: productionUrl[1],
		browser: {
			presentation: 'fullscreen', toolbar: 'hidden', viewport: null,
			nativeInnerWidth: integer(nativeGeometry[1]), nativeInnerHeight: integer(nativeGeometry[2]),
			nativeClientWidth: integer(nativeGeometry[3]), nativeClientHeight: integer(nativeGeometry[4]),
			nativeScrollWidth: integer(nativeGeometry[5])
		},
		targetDurationMs: (integer(duration[1]) * 60 + integer(duration[2])) * 1_000,
		hardStopMs: (integer(duration[3]) * 60 + integer(duration[4])) * 1_000,
		routeSettleMs: Number.parseFloat(settle[1]) * 1_000,
		catalogCounts: {
			guide: integer(catalogs[1]), priority: integer(catalogs[2]), work: integer(catalogs[3]),
			review: integer(catalogs[4]), next: integer(catalogs[5])
		},
		toolSequence: sequence,
		timeline,
		workQuery: boundedInputs[1],
		reviewFilter: boundedInputs[2],
		nextChoice: boundedInputs[3],
		priorityRecommendation: {
			title: priorityRecommendation[1],
			reason: priorityRecommendation[2],
			workId: priorityRecommendation[3],
			destination: priorityRecommendation[4],
			action: priorityRecommendation[5]
		},
		landingFrame: { heading: landingFrame[0], lede: landingFrame[1], facts: [landingFrame[2], landingFrame[3]], action: landingFrame[4], previewLabel: landingFrame[5] },
		guideOpeningFrame: {
			scope: { visible: integer(guideOpeningCount[1]), workspace: integer(guideOpeningCount[2]), countText: guideOpeningFrame[0] },
			trail: { summary: guideOpeningFrame[1], detail: guideOpeningFrame[2], outcome: guideOpeningFrame[3], progress: guideOpeningFrame[4] },
			toolText: guideOpeningFrame[5], pendingNavigationCount: 0, actionReceiptCount: 0
		},
		guideLowerFrame: { brief: guideLowerFrame[0], fastCreate: guideLowerFrame[1] },
		activityFrames: {
			work: { route: 'work', step: workFrame[0], provenance: workFrame[1], outcome: workFrame[2], cells: { 'Visible query': workFrame[3], 'Current scope': workFrame[4], Evidence: workFrame[5], Status: workFrame[6] }, authority: workFrame[7] },
			review: { route: 'review', step: reviewFrame[0], provenance: reviewFrame[1], outcome: reviewFrame[2], cells: { 'Visible Review scope': reviewFrame[3], 'Current queue': reviewFrame[4], 'Search-match evidence': reviewFrame[5], Status: reviewFrame[6] }, authority: reviewFrame[7] },
			next: { route: 'next', step: nextFrame[0], provenance: nextFrame[1], outcome: nextFrame[2], cells: { 'Verified evidence': nextFrame[3], Status: nextFrame[4], Save: nextFrame[5] }, authority: nextFrame[6] },
			draft: { route: 'work', step: draftFrame[0], provenance: draftFrame[1], outcome: draftFrame[2], cells: { Created: draftFrame[3], 'Draft work': draftFrame[4], Workspace: draftFrame[5], Authority: draftFrame[6] }, authority: draftFrame[7] }
		},
		keyboard: {
			landingBodyTabs: 1,
			landingToGuideTabs: 5,
			guideToToolsTabs: 5,
			toolsToPriorityTabs: 2,
			priorityToGuideShiftTabs: 5,
			guideToFastBriefShiftTabs: 5,
			guideToWorkTabs: 9,
			workToToolsShiftTabs: 11,
			toolsToReviewTabs: 3,
			reviewToToolsShiftTabs: 3,
			toolsToNextTabs: 4,
			nextToWorkShiftTabs: 5,
			workToPendingShiftTabs: 13,
			pendingToNextTabs: 2,
			guideReaderBodyTabs: 1
		},
		bodyScrolls: {
			owner: 'body',
			guide: { key: 'PageDown', count: 1 },
			nextPrepared: { key: 'ArrowDown', count: 4 },
			final: { key: 'ArrowDown', count: 8 }
		},
		denominators: {
			guide: { visible: integer(guide[1]), workspace: integer(guide[2]) },
			work: { workspace: 8, matching: 4, blocked: 2 },
			review: { total: 5, searchMatches: 3, filtered: 2, shown: 2 },
			drafts: { before: 8, created: 3, after: 11 }
		},
		draftTitles: titles,
		trail: [
			{ checkpoint: 'work', verified: 1, pending: 0, decide: 'absent' },
			{ checkpoint: 'review', verified: 2, pending: 0, decide: 'absent' },
			{ checkpoint: 'next', verified: 3, pending: 1, decide: 'pending' },
			{ checkpoint: 'drafts', verified: 4, pending: 1, decide: 'pending' },
			{ checkpoint: 'final', verified: 4, pending: 1, decide: 'pending' }
		]
	};
}

/**
 * The page probe intentionally implements only the registration surface used
 * by this preflight. Descriptors remain in the page realm and execute only by
 * exact object identity with serialized JSON input.
 */
export function buildModelContextProbeInitScript() {
	return ({ forbiddenHumanActivations }) => {
		const activeDescriptors = new Set();
		const registrationSignals = new Map();
		const evidence = {
			registrations: 0,
			aborts: 0,
			executions: [],
			humanActivations: []
		};

		const modelContext = Object.freeze({
			registerTool(descriptor, options = {}) {
				if (!descriptor || typeof descriptor !== 'object' || typeof descriptor.execute !== 'function') {
					throw new TypeError('Recording preflight accepts executable descriptor objects only.');
				}
				if (activeDescriptors.has(descriptor) || registrationSignals.has(descriptor)) {
					throw new Error('Recording preflight rejects duplicate descriptor registration.');
				}
				const signal = options.signal;
				if (!(signal instanceof AbortSignal)) {
					throw new TypeError('Recording preflight requires one page-owned registration abort signal.');
				}
				registrationSignals.set(descriptor, signal);
				evidence.registrations += 1;
				return new Promise((resolve, reject) => {
					let settled = false;
					const abort = () => {
						activeDescriptors.delete(descriptor);
						registrationSignals.delete(descriptor);
						evidence.aborts += 1;
						if (!settled) reject(signal.reason ?? new DOMException('Registration aborted.', 'AbortError'));
					};
					signal.addEventListener('abort', abort, { once: true });
					queueMicrotask(() => {
						if (signal.aborted) return;
						settled = true;
						activeDescriptors.add(descriptor);
						resolve(undefined);
					});
				});
			},
			getTools() {
				return Array.from(activeDescriptors);
			},
			async executeTool(descriptor, serializedInput) {
				if (!activeDescriptors.has(descriptor)) {
					throw new Error('Recording preflight executes only an active registered descriptor identity.');
				}
				if (typeof serializedInput !== 'string') {
					throw new TypeError('Recording preflight tool input must be serialized JSON.');
				}
				const input = JSON.parse(serializedInput);
				const controller = new AbortController();
				const result = await descriptor.execute(input, { signal: controller.signal });
				evidence.executions.push(descriptor.name);
				return result;
			}
		});

		Object.defineProperty(document, 'modelContext', {
			configurable: false,
			enumerable: false,
			value: modelContext,
			writable: false
		});
		Object.defineProperty(globalThis, '__projectsRecordingPreflight', {
			configurable: false,
			enumerable: false,
			value: Object.freeze({
				snapshot() {
					return {
						registrations: evidence.registrations,
						aborts: evidence.aborts,
						activeNames: Array.from(activeDescriptors, ({ name }) => name).sort(),
						executions: [...evidence.executions],
						humanActivations: [...evidence.humanActivations]
					};
				}
			}),
			writable: false
		});

		document.addEventListener('click', (event) => {
			const target = event.target instanceof Element ? event.target.closest('button, a, input[type="submit"]') : null;
			if (!target) return;
			const label = (target.getAttribute('aria-label') || target.textContent || '').replace(/\s+/gu, ' ').trim();
			if (forbiddenHumanActivations.some((forbidden) => label === forbidden || label.startsWith(`${forbidden} `))) {
				evidence.humanActivations.push(label);
			}
		}, true);
	};
}

export function chromeExecutableCandidates(environment = process.env) {
	const programFilesX86 = environment['PROGRAMFILES(X86)'] || environment['ProgramFiles(x86)'];
	return [
		environment.CHROME_EXECUTABLE_PATH,
		environment.ProgramFiles && path.join(environment.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
		programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
		environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
		environment.ProgramFiles && path.join(environment.ProgramFiles, 'Google', 'Chrome Dev', 'Application', 'chrome.exe'),
		programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome Dev', 'Application', 'chrome.exe'),
		environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Google', 'Chrome Dev', 'Application', 'chrome.exe')
	].filter(Boolean);
}

export async function findInstalledChrome(environment = process.env) {
	for (const candidate of chromeExecutableCandidates(environment)) {
		try {
			const stat = await fs.stat(candidate);
			if (stat.isFile()) return candidate;
		} catch {}
	}
	throw new Error(`Google Chrome was not found at the configured or supported installed locations: ${chromeExecutableCandidates(environment).join(', ')}`);
}

export async function removeVerifiedTempProfile(profilePath) {
	const resolvedTemp = path.resolve(os.tmpdir());
	const resolvedProfile = path.resolve(profilePath);
	const expectedPrefix = path.join(resolvedTemp, RECORDING_PREFLIGHT_SPEC.browser.profilePrefix);
	if (!resolvedProfile.startsWith(expectedPrefix) || path.dirname(resolvedProfile) !== resolvedTemp) {
		throw new Error(`Refusing to remove unverified recording profile: ${resolvedProfile}`);
	}
	await fs.rm(resolvedProfile, { recursive: true, force: true });
	try {
		await fs.stat(resolvedProfile);
		throw new Error(`Recording profile still exists after cleanup: ${resolvedProfile}`);
	} catch (error) {
		if (error && typeof error === 'object' && /** @type {{ code?: string }} */ (error).code === 'ENOENT') return;
		throw error;
	}
}

function emit(type, details) {
	process.stdout.write(`${JSON.stringify({ type, ...details })}\n`);
}

function elapsedMs(startedAt) {
	return Math.round(performance.now() - startedAt);
}

async function waitUntil(startedAt, targetMs) {
	const remaining = targetMs - (performance.now() - startedAt);
	if (remaining < 0) throw new Error(`Recording choreography missed its ${targetMs}ms monotonic cue by ${Math.ceil(-remaining)}ms.`);
	if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

function cueAt(id) {
	if (!Object.hasOwn(RECORDING_PREFLIGHT_TIMELINE_AT_MS, id)) {
		throw new Error(`Recording choreography requested an unknown timeline cue: ${id}`);
	}
	return RECORDING_PREFLIGHT_TIMELINE_AT_MS[id];
}

async function bounded(promise, timeoutMs, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function activeFocus(page) {
	return page.evaluate(() => {
		const element = document.activeElement;
		if (!(element instanceof HTMLElement)) return null;
		const rect = element.getBoundingClientRect();
		return {
			tag: element.tagName,
			text: (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/gu, ' ').trim(),
			visibleText: (element.textContent || '').replace(/\s+/gu, ' ').trim(),
			href: element instanceof HTMLAnchorElement ? `${element.pathname}${element.search}` : '',
			focusVisible: element.matches(':focus-visible'),
			fullyVisible: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
		};
	});
}

function focusMatchesDestination(focus, { text, visibleText, path: expectedPath }) {
	if (!focus) return false;
	if (text && focus.text !== text) return false;
	if (visibleText && focus.visibleText !== visibleText) return false;
	if (expectedPath && (!focus.href || new URL(focus.href, RECORDING_PREFLIGHT_SPEC.productionUrl).pathname !== expectedPath)) return false;
	return true;
}

async function assertFocusedDestination(page, { text, visibleText, path: expectedPath }) {
	const focus = await activeFocus(page);
	assert.ok(focus, 'A keyboard destination must own focus.');
	assert.equal(focus.focusVisible, true, `Keyboard destination must be visibly focused: ${JSON.stringify(focus)}`);
	assert.equal(focus.fullyVisible, true, `Keyboard destination must be fully visible: ${JSON.stringify(focus)}`);
	if (text) assert.equal(focus.text, text);
	if (visibleText) assert.equal(focus.visibleText, visibleText);
	if (expectedPath) assert.equal(new URL(focus.href, RECORDING_PREFLIGHT_SPEC.productionUrl).pathname, expectedPath);
	return focus;
}

async function settleKeyboardStep(page) {
	await bounded(
		page.evaluate(() => new Promise((resolve, reject) => requestAnimationFrame(() => {
			const settledFocus = document.activeElement;
			requestAnimationFrame(() => {
				if (document.activeElement !== settledFocus) {
					reject(new Error('Exact keyboard step focus changed between rendered frames.'));
					return;
				}
				resolve();
			});
		}))),
		RECORDING_PREFLIGHT_SPEC.routeSettleMs,
		'Exact keyboard step render settlement'
	);
}

async function pressExact(page, key, count, destination) {
	for (let index = 0; index < count; index += 1) {
		await page.keyboard.press(key);
		await settleKeyboardStep(page);
		if (index < count - 1) {
			const focus = await activeFocus(page);
			if (focusMatchesDestination(focus, destination)) {
				const actualCount = index + 1;
				emit('keyboard-rejection', { key, expectedCount: count, actualCount, destination, actual: focus });
				throw new Error(`Keyboard reached its declared destination after ${actualCount} of ${count} ${key} presses.`);
			}
		}
	}
	const focus = await assertFocusedDestination(page, destination);
	emit('keyboard', { key, count, expected: destination, actual: focus });
}

async function bodyKeyScroll(page, key, count, checkpoint) {
	const before = await page.evaluate(() => scrollY);
	await page.locator('body').focus();
	for (let index = 0; index < count; index += 1) await page.keyboard.press(key);
	const after = await bounded(page.evaluate((startingScrollY) => new Promise((resolve, reject) => {
		let last = scrollY;
		let stableFrames = 0;
		let totalFrames = 0;
		const frame = () => {
			const current = scrollY;
			stableFrames = Math.abs(current - last) < 0.5 ? stableFrames + 1 : 0;
			last = current;
			totalFrames += 1;
			if (stableFrames >= 3 && Math.abs(current - startingScrollY) >= 1) return resolve(current);
			if (totalFrames >= 180) return reject(new Error('Body-owned scroll did not settle.'));
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	}), before), RECORDING_PREFLIGHT_SPEC.routeSettleMs, `${checkpoint} body-owned ${key} settlement`);
	emit('keyboard', { key, owner: 'body', count, checkpoint, actual: { before, after } });
}

async function bodyTab(page, count, checkpoint) {
	const body = page.locator('body');
	for (let index = 0; index < count; index += 1) {
		await body.press('Tab');
		await settleKeyboardStep(page);
	}
	emit('keyboard', { key: 'Tab', owner: 'body', count, checkpoint });
}

async function readCatalog(page) {
	return page.evaluate(() => {
		const pill = document.querySelector('[data-webmcp-status-pill]');
		const rect = pill?.getBoundingClientRect();
		return {
			status: pill?.getAttribute('data-webmcp-status'),
			pillText: pill?.textContent?.replace(/\s+/gu, ' ').trim(),
			pillRendered: !!pill && !!rect && rect.width > 0 && rect.height > 0 && getComputedStyle(pill).visibility !== 'hidden',
			pillFullyVisible: !!rect && rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
			toolNames: document.modelContext?.getTools().map(({ name }) => name).sort() ?? [],
			probe: globalThis.__projectsRecordingPreflight?.snapshot()
		};
	});
}

async function assertCatalog(page, routeName) {
	const route = RECORDING_PREFLIGHT_SPEC.routes[routeName];
	const expectedNames = [...route.tools].sort();
	const catalog = await readCatalog(page);
	assert.equal(catalog.status, 'ready', `${routeName} WebMCP pill must be ready.`);
	assert.equal(catalog.pillRendered, true, `${routeName} WebMCP pill must be rendered.`);
	if (routeName === 'guide') assert.equal(catalog.pillFullyVisible, true, 'Guide WebMCP pill must be fully visible.');
	assert.deepEqual(catalog.toolNames, expectedNames, `${routeName} must expose its exact page catalog.`);
	assert.equal(catalog.pillText, `WebMCP ${expectedNames.length} ${expectedNames.length === 1 ? 'tool' : 'tools'}`);
	emit('catalog', { route: routeName, expected: { status: 'ready', rendered: true, guideFullyVisible: routeName === 'guide', toolNames: expectedNames }, actual: catalog });
	return catalog;
}

async function assertZeroOverflow(page, checkpoint) {
	const dimensions = await page.evaluate(() => ({
		innerWidth,
		innerHeight,
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth
	}));
	assert.equal(dimensions.scrollWidth, dimensions.clientWidth, `${checkpoint} has horizontal overflow.`);
	emit('overflow', { checkpoint, expected: { scrollWidthEqualsClientWidth: true }, actual: dimensions });
	return dimensions;
}

async function assertFullscreenSettled(page) {
	try {
		await page.waitForFunction(() => (
			window.outerWidth === window.screen.width &&
			window.outerHeight === window.screen.height &&
			Math.abs(window.innerWidth - window.screen.width) <= 1 &&
			Math.abs(window.innerHeight - window.screen.height) <= 1
		), undefined, { timeout: RECORDING_PREFLIGHT_SPEC.routeSettleMs });
	} catch (error) {
		const actual = await page.evaluate(() => ({
			innerWidth, innerHeight, outerWidth, outerHeight,
			screenWidth: screen.width, screenHeight: screen.height,
			clientWidth: document.documentElement.clientWidth,
			clientHeight: document.documentElement.clientHeight,
			scrollWidth: document.documentElement.scrollWidth
		}));
		emit('browser-presentation-rejection', {
			expected: { presentation: 'fullscreen', toolbar: 'hidden', viewportOverride: false },
			actual
		});
		throw error;
	}
	const samples = await page.evaluate(async () => {
		const receipts = [];
		for (let index = 0; index < 4; index += 1) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			receipts.push({
				innerWidth, innerHeight, outerWidth, outerHeight,
				screenWidth: screen.width, screenHeight: screen.height,
				clientWidth: document.documentElement.clientWidth,
				clientHeight: document.documentElement.clientHeight,
				scrollWidth: document.documentElement.scrollWidth
			});
		}
		return receipts;
	});
	assert.equal(samples.length, 4);
	for (const sample of samples) {
		assert.deepEqual(sample, samples[0]);
		assert.equal(sample.innerWidth, RECORDING_PREFLIGHT_SPEC.browser.nativeInnerWidth);
		assert.equal(sample.innerHeight, RECORDING_PREFLIGHT_SPEC.browser.nativeInnerHeight);
		assert.equal(sample.outerWidth, RECORDING_PREFLIGHT_SPEC.browser.nativeInnerWidth);
		assert.equal(sample.outerHeight, RECORDING_PREFLIGHT_SPEC.browser.nativeInnerHeight);
		assert.equal(sample.screenWidth, RECORDING_PREFLIGHT_SPEC.browser.nativeInnerWidth);
		assert.equal(sample.screenHeight, RECORDING_PREFLIGHT_SPEC.browser.nativeInnerHeight);
		assert.equal(sample.clientWidth, RECORDING_PREFLIGHT_SPEC.browser.nativeClientWidth);
		assert.equal(sample.clientHeight, RECORDING_PREFLIGHT_SPEC.browser.nativeClientHeight);
		assert.equal(sample.scrollWidth, RECORDING_PREFLIGHT_SPEC.browser.nativeScrollWidth);
	}
	const [actual] = samples;
	assert.equal(actual.outerWidth, actual.screenWidth);
	assert.equal(actual.outerHeight, actual.screenHeight);
	assert.ok(Math.abs(actual.innerWidth - actual.screenWidth) <= 1);
	assert.ok(Math.abs(actual.innerHeight - actual.screenHeight) <= 1);
	assert.equal(actual.clientWidth, RECORDING_PREFLIGHT_SPEC.browser.nativeClientWidth);
	assert.equal(actual.clientHeight, RECORDING_PREFLIGHT_SPEC.browser.nativeClientHeight);
	assert.equal(actual.scrollWidth, RECORDING_PREFLIGHT_SPEC.browser.nativeScrollWidth);
	emit('browser-presentation', {
		expected: {
			presentation: 'fullscreen', toolbar: 'hidden', stableFrames: 4, viewportOverride: false,
			innerWidth: RECORDING_PREFLIGHT_SPEC.browser.nativeInnerWidth,
			innerHeight: RECORDING_PREFLIGHT_SPEC.browser.nativeInnerHeight,
			clientWidth: RECORDING_PREFLIGHT_SPEC.browser.nativeClientWidth,
			clientHeight: RECORDING_PREFLIGHT_SPEC.browser.nativeClientHeight,
			scrollWidth: RECORDING_PREFLIGHT_SPEC.browser.nativeScrollWidth
		},
		actual: { ...actual, presentation: 'fullscreen', toolbar: 'hidden', stableFrames: samples.length, viewportOverride: false }
	});
}

async function waitForRouteReady(page, routeName, activatedAt) {
	const route = RECORDING_PREFLIGHT_SPEC.routes[routeName];
	try {
		await page.waitForFunction(({ route }) => {
			const heading = document.querySelector('h1')?.textContent?.replace(/\s+/gu, ' ').trim();
			const expectedHeadings = route.headings ?? [route.heading];
			const status = document.querySelector('[data-webmcp-status-pill]')?.getAttribute('data-webmcp-status');
			const names = document.modelContext?.getTools().map(({ name }) => name).sort() ?? [];
			return location.pathname === route.path && expectedHeadings.includes(heading) && status === 'ready' &&
				JSON.stringify(names) === JSON.stringify([...route.tools].sort());
		}, { route }, { timeout: RECORDING_PREFLIGHT_SPEC.routeSettleMs });
	} catch (error) {
		const actual = await page.evaluate(() => ({
			path: location.pathname,
			heading: document.querySelector('h1')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			status: document.querySelector('[data-webmcp-status-pill]')?.getAttribute('data-webmcp-status') ?? null,
			toolNames: document.modelContext?.getTools().map(({ name }) => name).sort() ?? []
		}));
		emit('route-rejection', { route: routeName, expected: { path: route.path, headings: route.headings ?? [route.heading], status: 'ready', toolNames: [...route.tools].sort(), settleMsAtMost: RECORDING_PREFLIGHT_SPEC.routeSettleMs }, actual });
		throw new Error(`${routeName} did not settle within ${RECORDING_PREFLIGHT_SPEC.routeSettleMs}ms: ${JSON.stringify(actual)}`, { cause: error });
	}
	const settleMs = Math.round(performance.now() - activatedAt);
	assert.ok(settleMs <= RECORDING_PREFLIGHT_SPEC.routeSettleMs, `${routeName} settled in ${settleMs}ms.`);
	const focus = await activeFocus(page);
	emit('route', { route: routeName, expected: { path: route.path, settleMsAtMost: RECORDING_PREFLIGHT_SPEC.routeSettleMs }, actual: { path: new URL(page.url()).pathname, settleMs, focus } });
	await assertCatalog(page, routeName);
	await assertZeroOverflow(page, `${routeName}-ready`);
}

async function activateRoute(page, routeName) {
	const activatedAt = performance.now();
	await page.keyboard.press('Enter');
	await waitForRouteReady(page, routeName, activatedAt);
}

async function activateDialog(page, accessibleName, checkpoint) {
	const activatedAt = performance.now();
	const expectedAccessibleName = accessibleName instanceof RegExp ? accessibleName.toString() : accessibleName;
	await page.keyboard.press('Enter');
	await page.getByRole('dialog', { name: accessibleName }).waitFor({
		state: 'visible',
		timeout: RECORDING_PREFLIGHT_SPEC.routeSettleMs
	});
	await settleKeyboardStep(page);
	const settleMs = Math.round(performance.now() - activatedAt);
	assert.ok(settleMs <= RECORDING_PREFLIGHT_SPEC.routeSettleMs, `${checkpoint} dialog settled in ${settleMs}ms.`);
	emit('dialog', { checkpoint, expected: { accessibleName: expectedAccessibleName, settleMsAtMost: RECORDING_PREFLIGHT_SPEC.routeSettleMs }, actual: { settleMs, focus: await activeFocus(page) } });
}

async function executeRegisteredTool(page, toolName, input) {
	const serializedInput = JSON.stringify(input);
	const result = await bounded(page.evaluate(async ({ toolName, serializedInput }) => {
		const modelContext = document.modelContext;
		if (!modelContext || typeof modelContext.getTools !== 'function' || typeof modelContext.executeTool !== 'function') {
			throw new Error('Native recording probe is unavailable.');
		}
		const tools = modelContext.getTools();
		const descriptor = tools.find((tool) => tool.name === toolName);
		if (!descriptor) throw new Error(`Registered descriptor not found: ${toolName}`);
		if (tools.filter((tool) => tool.name === toolName).length !== 1) throw new Error(`Registered descriptor is not unique: ${toolName}`);
		return modelContext.executeTool(descriptor, serializedInput);
	}, { toolName, serializedInput }), RECORDING_PREFLIGHT_SPEC.routeSettleMs, `Tool ${toolName}`);
	emit('tool', { toolName, input, actual: result });
	return result;
}

async function assertVisibleFocus(page, checkpoint) {
	const focus = await activeFocus(page);
	assert.ok(focus && focus.focusVisible && focus.fullyVisible, `${checkpoint} requires a fully visible :focus-visible destination.`);
	emit('focus', { checkpoint, expected: { focusVisible: true, fullyVisible: true }, actual: focus });
}

async function readTrail(page) {
	return page.evaluate(() => {
		const rail = document.querySelector('[data-webmcp-handoff-session]');
		const steps = Array.from(rail?.querySelectorAll('[data-webmcp-handoff-step]') ?? [], (step) => ({
			id: step.getAttribute('data-webmcp-handoff-step'),
			label: step.getAttribute('aria-label')
		}));
		const progress = rail?.querySelector('.webmcp-handoff-progress')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
		return { progress, steps, text: rail?.textContent?.replace(/\s+/gu, ' ').trim() ?? '' };
	});
}

async function assertTrail(page, checkpoint) {
	const expected = RECORDING_PREFLIGHT_SPEC.trail.find((candidate) => candidate.checkpoint === checkpoint);
	assert.ok(expected, `Unknown trail checkpoint: ${checkpoint}`);
	const trail = await readTrail(page);
	assert.equal(trail.progress, `${expected.verified} verified actions, ${expected.pending} pending`);
	const decide = trail.steps.find(({ id }) => id === 'human-decision');
	if (expected.decide === 'absent') assert.equal(decide, undefined);
	else assert.equal(decide?.label, 'Decide: pending');
	emit('trail', { checkpoint, expected, actual: trail });
}

function evidenceForCurrentNext(nextEditor, priorWork, reviewReceipt) {
	const workId = nextEditor?.work?.id;
	const candidates = [
		...(priorWork?.items ?? []),
		reviewReceipt?.review?.upNext,
		...(reviewReceipt?.review?.items ?? [])
	].filter(Boolean);
	const match = candidates.find((item) => item.id === workId);
	assert.ok(match, `No prior exact evidence exists for Next work ${workId}.`);
	return [
		{ workId, field: 'workflow', expectedValue: match.workflow },
		{ workId, field: 'blocker', expectedValue: match.blocker }
	];
}

async function assertOpeningGuideFrame(page) {
	const frame = await page.evaluate(() => {
		const scope = document.querySelector('[data-agent-scope-chooser]');
		const countLine = scope?.querySelector('#agent-scope-title + p');
		const countRect = countLine?.getBoundingClientRect();
		const rail = document.querySelector('[data-webmcp-handoff-session]');
		const tool = document.querySelector('[data-webmcp-status-pill]');
		return {
			scope: {
				workspace: Number(scope?.getAttribute('data-workspace-count')),
				visible: Number(scope?.getAttribute('data-visible-count')),
				countText: countLine?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
				countFullyVisible: !!countRect && countRect.top >= 0 && countRect.bottom <= innerHeight && countRect.left >= 0 && countRect.right <= innerWidth
			},
			trail: {
				summary: rail?.querySelector('.webmcp-handoff-summary strong')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
				detail: rail?.querySelector('.webmcp-handoff-summary small')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
				outcome: rail?.querySelector('.webmcp-handoff-authority strong')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
				progress: rail?.querySelector('.webmcp-handoff-progress')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null
			},
			toolText: tool?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			pendingNavigationCount: document.querySelectorAll('a[aria-label^="Resume "][aria-label*=" pending approval"]').length,
			actionReceiptCount: document.querySelectorAll('[data-webmcp-receipt]').length
		};
	});
	emit('guide-opening-frame-observation', { actual: frame });
	const { countFullyVisible, ...scope } = frame.scope;
	assert.deepEqual(
		{ scope, trail: frame.trail, toolText: frame.toolText, pendingNavigationCount: frame.pendingNavigationCount, actionReceiptCount: frame.actionReceiptCount },
		RECORDING_PREFLIGHT_SPEC.guideOpeningFrame
	);
	assert.equal(countFullyVisible, true);
	emit('guide-opening-frame', {
		expected: { workspace: 8, visible: 8, ready: true, noAction: true, verified: 0, pending: 0, pendingNavigationCount: 0, actionReceiptCount: 0 },
		actual: frame
	});
}

async function assertLandingFrame(page) {
	const frame = await page.evaluate(() => {
		const inspect = (element) => {
			if (!(element instanceof HTMLElement)) return null;
			const rect = element.getBoundingClientRect();
			return {
				top: rect.top,
				bottom: rect.bottom,
				fullyVisible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
			};
		};
		const hero = document.querySelector('.lp-hero');
		const copy = hero?.querySelector('.lp-hero-copy');
		const preview = hero?.querySelector('.lp-preview');
		return {
			heading: hero?.querySelector('h1')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			lede: hero?.querySelector('.lp-lede')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			facts: Array.from(hero?.querySelectorAll('.lp-fine span:not(.lp-dot)') ?? [], (fact) => fact.textContent?.trim() ?? ''),
			action: hero?.querySelector('a[href="/webmcp-challenge"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			previewLabel: preview?.getAttribute('aria-label') ?? null,
			copy: inspect(copy),
			preview: inspect(preview)
		};
	});
	emit('landing-frame-observation', { actual: frame });
	assert.deepEqual(
		{ heading: frame.heading, lede: frame.lede, facts: frame.facts, action: frame.action, previewLabel: frame.previewLabel },
		RECORDING_PREFLIGHT_SPEC.landingFrame
	);
	assert.equal(frame.copy?.fullyVisible, true);
	assert.equal(frame.preview?.fullyVisible, true);
	emit('landing-frame', { expected: { canonicalCopy: true, noBackend: true, noAutomaticStarts: true, workflowAction: true, preview: true, fullyVisible: true }, actual: frame });
}

async function assertPriorityFrame(page) {
	const frame = await page.evaluate(() => {
		const root = document.querySelector('[data-priority-next-recommendation]');
		const rect = root?.getBoundingClientRect();
		const details = Object.fromEntries(Array.from(root?.querySelectorAll('dl > div') ?? [], (row) => [
			row.querySelector('dt')?.textContent?.trim() ?? '',
			row.querySelector('dd')?.textContent?.trim() ?? ''
		]));
		const action = root?.querySelector('a');
		return {
			title: root?.querySelector('#priority-recommendation-title')?.textContent?.trim() ?? null,
			reason: root?.querySelector('.priority-reason')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			workId: details['Work ID'] ?? null,
			destination: details.Destination ?? null,
			action: action?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			actionHref: action instanceof HTMLAnchorElement ? `${action.pathname}${action.search}` : null,
			top: rect?.top ?? null,
			bottom: rect?.bottom ?? null,
			fullyVisible: !!rect && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
		};
	});
	emit('priority-frame-observation', { actual: frame });
	assert.deepEqual(
		{ title: frame.title, reason: frame.reason, workId: frame.workId, destination: frame.destination, action: frame.action },
		RECORDING_PREFLIGHT_SPEC.priorityRecommendation
	);
	assert.equal(frame.actionHref, RECORDING_PREFLIGHT_SPEC.priorityRecommendation.destination);
	assert.equal(frame.fullyVisible, true, 'The complete Priority recommendation must remain visible during its hold.');
	emit('priority-frame', { expected: { ...RECORDING_PREFLIGHT_SPEC.priorityRecommendation, fullyVisible: true }, actual: frame });
}

async function readActivityFrame(page, route) {
	return page.evaluate((receiptRoute) => {
		const root = document.querySelector(`[data-webmcp-receipt="${receiptRoute}"]`);
		const rect = root?.getBoundingClientRect();
		return {
			step: root?.querySelector('.webmcp-activity-step')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			outcome: root?.querySelector('.webmcp-activity-outcome')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			cells: Object.fromEntries(Array.from(root?.querySelectorAll('.webmcp-activity-evidence > div') ?? [], (cell) => [
				cell.querySelector('dt')?.textContent?.trim() ?? '',
				cell.querySelector('dd')?.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
			])),
			authority: root?.querySelector('.webmcp-activity-authority')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			provenance: root?.querySelector('.webmcp-tool-provenance')?.textContent?.replace(/\s+/gu, ' ').trim() ?? null,
			top: rect?.top ?? null,
			bottom: rect?.bottom ?? null,
			fullyVisible: !!rect && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
		};
	}, route);
}

async function assertActivityFrame(page, checkpoint, phase) {
	const expected = RECORDING_PREFLIGHT_SPEC.activityFrames[checkpoint];
	assert.ok(expected, `Unknown recording activity frame: ${checkpoint}`);
	const { route, ...expectedContent } = expected;
	const frame = await readActivityFrame(page, route);
	emit(`${checkpoint}-frame-observation`, { phase, actual: frame });
	assert.deepEqual(
		{ step: frame.step, outcome: frame.outcome, cells: frame.cells, authority: frame.authority, provenance: frame.provenance },
		expectedContent
	);
	assert.equal(frame.fullyVisible, true, `The complete ${expected.step} receipt must remain visible at ${phase}.`);
	emit(`${checkpoint}-frame`, { phase, expected: { ...expectedContent, fullyVisible: true }, actual: frame });
}

async function assertGuideLowerFrame(page) {
	const frame = await page.evaluate(() => {
		const inspect = (element) => {
			if (!(element instanceof HTMLElement)) return null;
			const rect = element.getBoundingClientRect();
			return {
				text: element instanceof HTMLTextAreaElement ? element.value : element.textContent?.replace(/\s+/gu, ' ').trim(),
				top: rect.top,
				bottom: rect.bottom,
				fullyVisible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
			};
		};
		return {
			brief: inspect(document.querySelector('[data-agent-brief-input]')),
			fastCreate: inspect(document.querySelector('[data-agent-brief-fast-create]'))
		};
	});
	emit('guide-lower-frame-observation', { actual: frame });
	assert.deepEqual({ brief: frame.brief?.text, fastCreate: frame.fastCreate?.text }, RECORDING_PREFLIGHT_SPEC.guideLowerFrame);
	assert.equal(frame.brief?.fullyVisible, true, 'The Guide PageDown must reveal the complete browser-agent brief.');
	assert.equal(frame.fastCreate?.fullyVisible, true, 'The Guide PageDown must reveal the complete fast-create control.');
	emit('guide-lower-frame', { expected: { ...RECORDING_PREFLIGHT_SPEC.guideLowerFrame, briefFullyVisible: true, fastCreateFullyVisible: true }, actual: frame });
}

async function assertPreparedNextFrame(page) {
	const receipt = await page.locator('#next-preparation-receipt').evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return {
			text: element.textContent?.replace(/\s+/gu, ' ').trim(),
			top: rect.top,
			bottom: rect.bottom,
			fullyVisible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
		};
	});
	emit('prepared-frame-observation', { actual: { receipt } });
	assert.equal(receipt.fullyVisible, true, 'The prepared Next hold must keep its canonical receipt fully visible.');
	emit('prepared-frame', { expected: { receiptFullyVisible: true }, actual: { receipt } });
}

async function assertFinalHumanFrame(page) {
	const frame = await page.evaluate(() => {
		const receipt = document.querySelector('#next-preparation-receipt');
		const buttons = Array.from(document.querySelectorAll('button')).filter((button) => ['Discard draft', 'Approve and save'].includes(button.textContent?.trim() ?? ''));
		const inspect = (element) => {
			if (!(element instanceof HTMLElement)) return null;
			const rect = element.getBoundingClientRect();
			return { text: element.textContent?.replace(/\s+/gu, ' ').trim(), top: rect.top, bottom: rect.bottom, fullyVisible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth };
		};
		return {
			heading: document.querySelector('h1')?.textContent?.trim(),
			receipt: inspect(receipt),
			buttons: buttons.map(inspect),
			authority: document.querySelector('.next-authority')?.textContent?.replace(/\s+/gu, ' ').trim(),
			humanActivations: globalThis.__projectsRecordingPreflight?.snapshot().humanActivations ?? []
		};
	});
	emit('final-frame-observation', { actual: frame });
	assert.equal(frame.heading, 'Review the proposed next action');
	assert.equal(frame.receipt?.fullyVisible, true);
	assert.deepEqual(frame.buttons.map(({ text }) => text), ['Discard draft', 'Approve and save']);
	assert.equal(frame.buttons.every(({ fullyVisible }) => fullyVisible), true);
	assert.match(frame.authority ?? '', /Draft:\s*pending approval[\s\S]*?Workspace:\s*unchanged[\s\S]*?only you can approve Save/u);
	assert.deepEqual(frame.humanActivations, []);
	emit('final-frame', { expected: { heading: 'Review the proposed next action', buttons: ['Discard draft', 'Approve and save'], simultaneousVisibility: true, decide: 'pending', activations: [] }, actual: frame });
}

async function assertDiagnosticsClean(diagnostics) {
	const actual = {
		consoleErrors: diagnostics.consoleErrors,
		pageErrors: diagnostics.pageErrors,
		cspFailures: diagnostics.cspFailures,
		externalRequests: diagnostics.externalRequests,
		unexpectedRequests: diagnostics.unexpectedRequests,
		writeRequests: diagnostics.writeRequests,
		serverRequests: diagnostics.serverRequests,
		failedResponses: diagnostics.failedResponses,
		requestFailures: diagnostics.requestFailures
	};
	for (const [name, entries] of Object.entries(actual)) assert.deepEqual(entries, [], `${name} must be empty.`);
	emit('diagnostics', { expected: Object.fromEntries(Object.keys(actual).map((key) => [key, []])), actual });
}

async function runChoreography(page, diagnostics) {
	const spec = RECORDING_PREFLIGHT_SPEC;
	await page.goto(spec.productionUrl, { waitUntil: 'domcontentloaded' });
	await page.locator('h1', { hasText: spec.routes.landing.heading }).waitFor({ state: 'visible', timeout: spec.routeSettleMs });
	await assertFullscreenSettled(page);
	await assertZeroOverflow(page, 'landing-ready');
	await assertLandingFrame(page);
	const startedAt = performance.now();

	await waitUntil(startedAt, cueAt('landing-to-guide'));
	await bodyTab(page, spec.keyboard.landingBodyTabs, 'landing-reclaim');
	await pressExact(page, 'Tab', spec.keyboard.landingToGuideTabs, { path: spec.routes.guide.path, text: 'Open the handoff workflow →' });
	await activateRoute(page, 'guide');
	await assertOpeningGuideFrame(page);

	await waitUntil(startedAt, cueAt('guide-body-page-down'));
	await bodyKeyScroll(page, 'PageDown', spec.keyboard.guideBodyPageDowns, 'guide');
	await assertZeroOverflow(page, 'guide-lower');
	await assertGuideLowerFrame(page);

	await waitUntil(startedAt, cueAt('guide-to-priority'));
	await pressExact(page, 'Tab', spec.keyboard.guideToToolsTabs, { text: 'Tools' });
	await activateDialog(page, 'Tools', 'guide-tools');
	await pressExact(page, 'Tab', spec.keyboard.toolsToPriorityTabs, { text: 'Priority Standalone recommendation view', path: spec.routes.priority.path });
	await activateRoute(page, 'priority');
	await page.locator('[data-priority-next-recommendation]').waitFor({ state: 'visible', timeout: spec.routeSettleMs });
	await assertPriorityFrame(page);

	await waitUntil(startedAt, cueAt('priority-to-guide'));
	await pressExact(page, 'Shift+Tab', spec.keyboard.priorityToGuideShiftTabs, { text: 'Guide', path: spec.routes.guide.path });
	await activateRoute(page, 'guide');
	await pressExact(page, 'Shift+Tab', spec.keyboard.guideToFastBriefShiftTabs, { text: 'Use fast-create brief' });
	await page.keyboard.press('Enter');
	await page.locator('[data-agent-brief-input]').evaluate((element) => {
		if (!(element instanceof HTMLTextAreaElement) || !element.value.includes('create exactly three distinct browser-local Draft work items')) {
			throw new Error('Fast-create brief did not become the live Guide brief.');
		}
	});
	const guide = await executeRegisteredTool(page, 'get_projects_handoff_guide', {});
	assert.deepEqual(
		{ visible: guide.workScope.visibleCount, workspace: guide.workScope.workspaceCount },
		spec.denominators.guide
	);
	assert.match(guide.agentBrief, /create exactly three distinct browser-local Draft work items/u);
	emit('denominator', { checkpoint: 'guide', expected: spec.denominators.guide, actual: { visible: guide.workScope.visibleCount, workspace: guide.workScope.workspaceCount } });
	await page.locator('[data-webmcp-receipt="guide"]').waitFor({ state: 'visible', timeout: spec.routeSettleMs });
	emit('reader-receipt', { checkpoint: 'guide', expected: { rendered: true, actionFocusClaimed: false }, actual: { rendered: true, actionFocusClaimed: false } });
	await assertZeroOverflow(page, 'guide-fast-reader');

	await waitUntil(startedAt, cueAt('guide-to-work'));
	await bodyTab(page, spec.keyboard.guideReaderBodyTabs, 'guide-reader-reclaim');
	await pressExact(page, 'Tab', spec.keyboard.guideToWorkTabs, { text: 'Work', path: spec.routes.work.path });
	await activateRoute(page, 'work');
	const initialWork = await executeRegisteredTool(page, 'get_current_work_view', {});
	assert.equal(initialWork.counts.workspace, spec.denominators.work.workspace);
	const narrowedWork = await executeRegisteredTool(page, 'show_work_search', { query: spec.workQuery });
	const workDenominators = { workspace: narrowedWork.work.counts.workspace, matching: narrowedWork.work.counts.matching, blocked: narrowedWork.work.counts.blocked };
	assert.deepEqual(
		workDenominators,
		spec.denominators.work
	);
	emit('denominator', { checkpoint: 'work', expected: spec.denominators.work, actual: workDenominators });
	await assertVisibleFocus(page, 'work-receipt');
	await assertActivityFrame(page, 'work', 'hold');
	await assertTrail(page, 'work');
	await assertZeroOverflow(page, 'work-narrowed');

	await waitUntil(startedAt, cueAt('work-to-review'));
	await pressExact(page, 'Shift+Tab', spec.keyboard.workToToolsShiftTabs, { text: 'Tools' });
	await activateDialog(page, 'Tools', 'work-tools');
	await pressExact(page, 'Tab', spec.keyboard.toolsToReviewTabs, { text: 'Review Full evidence queue', path: spec.routes.review.path });
	await activateRoute(page, 'review');
	const initialReview = await executeRegisteredTool(page, 'get_current_review_queue', {});
	assert.equal(initialReview.counts.totalReview, spec.denominators.review.total);
	const scopedReview = await executeRegisteredTool(page, 'set_review_scope', { query: spec.workQuery, filter: spec.reviewFilter });
	const reviewDenominators = { total: scopedReview.review.counts.totalReview, searchMatches: scopedReview.review.counts.searchMatches, filtered: scopedReview.review.counts.filtered, shown: scopedReview.review.counts.shown };
	assert.deepEqual(
		reviewDenominators,
		spec.denominators.review
	);
	emit('denominator', { checkpoint: 'review', expected: spec.denominators.review, actual: reviewDenominators });
	await assertVisibleFocus(page, 'review-receipt');
	await assertActivityFrame(page, 'review', 'hold');
	await assertTrail(page, 'review');
	await assertZeroOverflow(page, 'review-scoped');

	await waitUntil(startedAt, cueAt('review-to-next'));
	await pressExact(page, 'Shift+Tab', spec.keyboard.reviewToToolsShiftTabs, { text: 'Tools, Review is the current view', visibleText: 'Tools Review' });
	await activateDialog(page, 'Tools', 'review-tools');
	await pressExact(page, 'Tab', spec.keyboard.toolsToNextTabs, { text: 'Next Full next-action editor', path: spec.routes.next.path });
	await activateRoute(page, 'next');
	const nextEditor = await executeRegisteredTool(page, 'get_current_next_editor', {});
	const evidence = evidenceForCurrentNext(nextEditor, narrowedWork.work, scopedReview);
	const prepared = await executeRegisteredTool(page, 'prepare_next_action', {
		choice: spec.nextChoice,
		expectedMode: nextEditor.editor.mode,
		expectedChoice: nextEditor.editor.choice,
		evidence
	});
	assert.equal(prepared.next.preparationReceipt.preparedAction, spec.nextChoice);
	assert.equal(prepared.next.preparationReceipt.workspaceChanged, false);
	assert.equal(prepared.next.preparationReceipt.requiresHumanSave, true);
	emit('proposal', {
		checkpoint: 'next',
		expected: { choice: spec.nextChoice, workspaceChanged: false, requiresHumanSave: true },
		actual: {
			choice: prepared.next.preparationReceipt.preparedAction,
			workspaceChanged: prepared.next.preparationReceipt.workspaceChanged,
			requiresHumanSave: prepared.next.preparationReceipt.requiresHumanSave
		}
	});
	await assertVisibleFocus(page, 'next-receipt');
	await assertActivityFrame(page, 'next', 'prepared');
	await assertTrail(page, 'next');
	await assertZeroOverflow(page, 'next-prepared');

	await waitUntil(startedAt, cueAt('next-body-arrow-downs'));
	await bodyKeyScroll(page, 'ArrowDown', spec.keyboard.nextBodyArrowDowns, 'next-prepared');
	await assertZeroOverflow(page, 'next-prepared-lower');
	await assertPreparedNextFrame(page);

	await waitUntil(startedAt, cueAt('next-to-work'));
	await pressExact(page, 'Shift+Tab', spec.keyboard.nextToWorkShiftTabs, { text: 'Work', path: spec.routes.work.path });
	await activateRoute(page, 'work');
	const currentWork = await executeRegisteredTool(page, 'get_current_work_view', {});
	assert.equal(currentWork.counts.workspace, spec.denominators.drafts.before);

	await waitUntil(startedAt, cueAt('create-drafts'));
	const created = await executeRegisteredTool(page, 'create_work_drafts', {
		expectedWorkspaceCount: spec.denominators.drafts.before,
		drafts: spec.draftTitles.map((title) => ({ title }))
	});
	assert.deepEqual(created.created.map(({ title }) => title), spec.draftTitles);
	const draftDenominators = { before: created.workspaceBefore, created: created.created.length, after: created.workspaceAfter };
	assert.deepEqual(
		draftDenominators,
		spec.denominators.drafts
	);
	assert.equal(created.requiresHumanStart, true);
	emit('denominator', {
		checkpoint: 'drafts',
		expected: { ...spec.denominators.drafts, titles: spec.draftTitles, requiresHumanStart: true },
		actual: { ...draftDenominators, titles: created.created.map(({ title }) => title), requiresHumanStart: created.requiresHumanStart }
	});
	await assertVisibleFocus(page, 'draft-receipt');
	await assertActivityFrame(page, 'draft', 'hold');
	await assertTrail(page, 'drafts');
	await assertZeroOverflow(page, 'work-drafts');

	await waitUntil(startedAt, cueAt('work-to-pending'));
	await pressExact(page, 'Shift+Tab', spec.keyboard.workToPendingShiftTabs, { text: 'Resume 1 pending approval', visibleText: 'Pending 1', path: spec.routes.next.path });
	await activateDialog(page, /^Pending approvals \(1\)$/u, 'pending-approvals');
	await pressExact(page, 'Tab', spec.keyboard.pendingToNextTabs, { text: 'Review on Next', path: spec.routes.next.path });
	await activateRoute(page, 'next');
	await page.locator('#next-preparation-receipt').waitFor({ state: 'visible', timeout: spec.routeSettleMs });
	await assertTrail(page, 'final');

	await waitUntil(startedAt, cueAt('final-body-arrow-downs'));
	await bodyKeyScroll(page, 'ArrowDown', spec.keyboard.finalBodyArrowDowns, 'next-final');
	await assertZeroOverflow(page, 'next-final');
	await assertActivityFrame(page, 'next', 'restored-final');
	await assertFinalHumanFrame(page);

	await waitUntil(startedAt, cueAt('final-acceptance'));
	const durationMs = elapsedMs(startedAt);
	assert.ok(durationMs <= spec.targetDurationMs, `Recording cue finished at ${durationMs}ms, after the 1:50 target.`);
	const finalProbe = await page.evaluate(() => globalThis.__projectsRecordingPreflight?.snapshot());
	assert.deepEqual(finalProbe.executions, spec.toolSequence);
	assert.deepEqual(finalProbe.humanActivations, []);
	await assertDiagnosticsClean(diagnostics);
	emit('acceptance', { expected: { durationMsAtMost: spec.targetDurationMs, toolSequence: spec.toolSequence }, actual: { durationMs, toolSequence: finalProbe.executions } });
}

function createDiagnostics(context) {
	const diagnostics = {
		consoleErrors: [], pageErrors: [], cspFailures: [], externalRequests: [], unexpectedRequests: [],
		writeRequests: [], serverRequests: [], failedResponses: [], requestFailures: []
	};
	const productionOrigin = new URL(RECORDING_PREFLIGHT_SPEC.productionUrl).origin;
	const observedPages = new WeakSet();
	const observePage = (page) => {
		if (observedPages.has(page)) return;
		observedPages.add(page);
		page.on('console', (message) => {
			if (!['warning', 'error'].includes(message.type())) return;
			const receipt = `${message.type()}: ${message.text()}`;
			diagnostics.consoleErrors.push(receipt);
			if (/Content Security Policy|\bCSP\b/iu.test(message.text())) diagnostics.cspFailures.push(receipt);
		});
		page.on('pageerror', (error) => diagnostics.pageErrors.push(error.stack || error.message));
	};
	for (const page of context.pages()) observePage(page);
	context.on('page', observePage);
	context.on('request', (request) => {
		const url = new URL(request.url());
		if (!['http:', 'https:'].includes(url.protocol)) return;
		const receipt = `${request.method()} ${url.href}`;
		if (url.origin !== productionOrigin) diagnostics.externalRequests.push(receipt);
		if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) diagnostics.writeRequests.push(receipt);
		if (/^\/(?:api|mcp)(?:\/|$)/u.test(url.pathname)) diagnostics.serverRequests.push(receipt);
		const pathnameAndSearch = `${url.pathname}${url.search}`;
		if (url.origin === productionOrigin && ['fetch', 'xhr'].includes(request.resourceType()) &&
			!RECORDING_PREFLIGHT_SPEC.allowedSameOriginFetches.includes(pathnameAndSearch)) {
			diagnostics.unexpectedRequests.push(receipt);
		}
	});
	context.on('response', (response) => {
		if (response.status() >= 400) diagnostics.failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
	});
	context.on('requestfailed', (request) => diagnostics.requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`));
	return diagnostics;
}

export async function runRecordingPreflight() {
	const chromeExecutable = await findInstalledChrome();
	const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), RECORDING_PREFLIGHT_SPEC.browser.profilePrefix));
	let context;
	let browser;
	let runError = null;
	let contextClosed = false;
	let browserDisconnected = false;
	let profileRemoved = false;
	try {
		const { chromium } = await import('playwright-core');
		context = await chromium.launchPersistentContext(profilePath, {
			executablePath: chromeExecutable,
			headless: false,
			viewport: null,
			acceptDownloads: false,
			ignoreDefaultArgs: ['--enable-automation'],
			args: ['--kiosk', '--disable-infobars', '--no-first-run', '--no-default-browser-check']
		});
		browser = context.browser();
		await context.addInitScript(buildModelContextProbeInitScript(), {
			forbiddenHumanActivations: RECORDING_PREFLIGHT_SPEC.forbiddenHumanActivations
		});
		const diagnostics = createDiagnostics(context);
		const page = context.pages()[0] ?? await context.newPage();
		page.setDefaultTimeout(RECORDING_PREFLIGHT_SPEC.routeSettleMs);
		const choreography = runChoreography(page, diagnostics);
		choreography.catch(() => {});
		await bounded(choreography, RECORDING_PREFLIGHT_SPEC.hardStopMs, 'Recording preflight hard stop');
	} catch (error) {
		runError = error;
		emit('failure', { message: error instanceof Error ? error.message : String(error) });
	} finally {
		try {
			await context?.close();
			contextClosed = true;
		} catch (error) { runError ??= error; }
		try {
			if (browser?.isConnected()) await browser.close();
			browserDisconnected = browser ? !browser.isConnected() : true;
		} catch (error) { runError ??= error; }
		try {
			await removeVerifiedTempProfile(profilePath);
			profileRemoved = await fs.stat(profilePath).then(() => false, (error) => error?.code === 'ENOENT');
		} catch (error) { runError ??= error; }
		const cleanupExpected = { contextClosed: true, browserDisconnected: true, profileRemoved: true };
		const cleanupActual = { contextClosed, browserDisconnected, profileRemoved };
		try {
			assert.deepEqual(cleanupActual, cleanupExpected);
		} catch (error) {
			runError ??= error;
		}
		emit('cleanup', {
			expected: cleanupExpected,
			actual: cleanupActual
		});
	}
	if (runError) throw runError;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	runRecordingPreflight().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
		process.exitCode = 1;
	});
}
