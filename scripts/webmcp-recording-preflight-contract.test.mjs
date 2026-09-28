import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	RECORDING_PREFLIGHT_SPEC,
	RECORDING_PREFLIGHT_TIMELINE_AT_MS,
	buildModelContextProbeInitScript,
	chromeExecutableCandidates,
	parseRecordingCueSheet,
	recordingCueProjectionFromSpec,
	removeVerifiedTempProfile
} from './webmcp-recording-preflight.mjs';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptsDirectory);
const harnessPath = path.join(scriptsDirectory, 'webmcp-recording-preflight.mjs');
const calibrationPath = path.join(scriptsDirectory, 'calibrate-work-first-recording.mjs');
const cuePath = path.join(repositoryRoot, 'docs', 'submission', 'webmcp', 'chrome-recording-script.md');
const [harnessSource, calibrationSource, cueSource] = await Promise.all([
	fs.readFile(harnessPath, 'utf8'),
	fs.readFile(calibrationPath, 'utf8'),
	fs.readFile(cuePath, 'utf8')
]);

function assertDeepFrozen(value, label = 'spec') {
	if (!value || typeof value !== 'object') return;
	assert.equal(Object.isFrozen(value), true, `${label} must be frozen.`);
	for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${label}.${key}`);
}

test('one deep-frozen recording specification owns the exact 1:50 choreography', () => {
	assertDeepFrozen(RECORDING_PREFLIGHT_SPEC);
	assert.equal(RECORDING_PREFLIGHT_SPEC.productionUrl, 'https://projects-webmcp-extension.pages.dev/');
	assert.equal(RECORDING_PREFLIGHT_SPEC.targetDurationMs, 110_000);
	assert.equal(RECORDING_PREFLIGHT_SPEC.hardStopMs, 120_000);
	assert.equal(RECORDING_PREFLIGHT_SPEC.routeSettleMs, 2_250);
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.browser, {
		name: 'Google Chrome', headed: true, viewport: null, presentation: 'fullscreen', toolbar: 'hidden',
		startFullscreen: true, nativeInnerWidth: 1_116, nativeInnerHeight: 698,
		nativeClientWidth: 1_101, nativeClientHeight: 698, nativeScrollWidth: 1_101,
		profilePrefix: 'projects-webmcp-recording-preflight-'
	});
	assert.deepEqual(
		Object.fromEntries(['guide', 'priority', 'work', 'review', 'next'].map((route) => [route, RECORDING_PREFLIGHT_SPEC.routes[route].tools.length])),
		{ guide: 1, priority: 1, work: 3, review: 2, next: 2 }
	);
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.routes, {
		landing: { path: '/', heading: 'Let an agent find the next move. Keep the final say.', tools: [] },
		guide: { path: '/webmcp-challenge', heading: 'Projects handoff guide', tools: ['get_projects_handoff_guide'] },
		priority: { path: '/priority', heading: 'Priority', tools: ['get_next_recommendation'] },
		work: { path: '/work', heading: 'Work', tools: ['get_current_work_view', 'show_work_search', 'create_work_drafts'] },
		review: { path: '/review', heading: 'Review', tools: ['get_current_review_queue', 'set_review_scope'] },
		next: { path: '/next', headings: ['Set the next action', 'Review the proposed next action'], tools: ['get_current_next_editor', 'prepare_next_action'] }
	});
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.toolSequence, [
		'get_projects_handoff_guide',
		'get_current_work_view',
		'show_work_search',
		'get_current_review_queue',
		'set_review_scope',
		'get_current_next_editor',
		'prepare_next_action',
		'get_current_work_view',
		'create_work_drafts'
	]);
	assert.deepEqual(
		{
			landingGuide: RECORDING_PREFLIGHT_SPEC.keyboard.landingToGuideTabs,
			guideTools: RECORDING_PREFLIGHT_SPEC.keyboard.guideToToolsTabs,
			toolsPriority: RECORDING_PREFLIGHT_SPEC.keyboard.toolsToPriorityTabs,
			priorityGuide: RECORDING_PREFLIGHT_SPEC.keyboard.priorityToGuideShiftTabs,
			guideFast: RECORDING_PREFLIGHT_SPEC.keyboard.guideToFastBriefShiftTabs,
			guideWork: RECORDING_PREFLIGHT_SPEC.keyboard.guideToWorkTabs,
			workTools: RECORDING_PREFLIGHT_SPEC.keyboard.workToToolsShiftTabs,
			toolsReview: RECORDING_PREFLIGHT_SPEC.keyboard.toolsToReviewTabs,
			reviewTools: RECORDING_PREFLIGHT_SPEC.keyboard.reviewToToolsShiftTabs,
			toolsNext: RECORDING_PREFLIGHT_SPEC.keyboard.toolsToNextTabs,
			nextWork: RECORDING_PREFLIGHT_SPEC.keyboard.nextToWorkShiftTabs,
			workPending: RECORDING_PREFLIGHT_SPEC.keyboard.workToPendingShiftTabs,
			pendingNext: RECORDING_PREFLIGHT_SPEC.keyboard.pendingToNextTabs
		},
		{
			landingGuide: 5, guideTools: 5, toolsPriority: 2, priorityGuide: 5, guideFast: 5, guideWork: 9,
			workTools: 11, toolsReview: 3, reviewTools: 3, toolsNext: 4, nextWork: 5, workPending: 13, pendingNext: 2
		}
	);
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.denominators, {
		guide: { visible: 8, workspace: 8 },
		work: { workspace: 8, matching: 4, blocked: 2 },
		review: { total: 5, searchMatches: 3, filtered: 2, shown: 2 },
		drafts: { before: 8, created: 3, after: 11 }
	});
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.draftTitles, [
		'Confirm donation pickup window',
		'Print shelf labels',
		'Prepare bike rack checklist'
	]);
	assert.equal(RECORDING_PREFLIGHT_SPEC.workQuery, 'Garage reset');
	assert.equal(RECORDING_PREFLIGHT_SPEC.reviewFilter, 'blocked');
	assert.equal(RECORDING_PREFLIGHT_SPEC.nextChoice, 'Confirm storage bin delivery');
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.priorityRecommendation, {
		title: 'Garden study: log interviews',
		reason: 'Due in 6 days · No blocker or pending decision.',
		workId: 'garden-study-log-interviews',
		destination: '/next?pack=garden-study-log-interviews',
		action: 'Open next action'
	});
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.landingFrame, {
		heading: 'Let an agent find the next move. Keep the final say.',
		lede: 'Browser workers read and narrow the same work you see, can add bounded Draft items, then prepare an unsaved next action for you to approve.',
		facts: ['No backend', 'No automatic starts'],
		action: 'Open the handoff workflow →',
		previewLabel: 'WebMCP handoff in Review: the agent narrows visible work, explains a blocker, and prepares a next action for human approval.'
	});
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.guideOpeningFrame, {
		scope: { workspace: 8, visible: 8, countText: '8 visible of 8 workspace' },
		trail: { summary: 'Ready for one bounded run', detail: 'No agent action recorded.', outcome: 'No action recorded', progress: '0 verified actions, 0 pending' },
		toolText: 'WebMCP 1 tool', pendingNavigationCount: 0, actionReceiptCount: 0
	});
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.guideLowerFrame, {
		brief: 'Use the WebMCP tools on Work, Review, and Next to inspect the visible project state, narrow the items that need attention, and prepare an evidence-based next action for my review. Do not save or change workspace data.',
		fastCreate: 'Use fast-create brief'
	});
	assert.deepEqual(
		Object.fromEntries(Object.entries(RECORDING_PREFLIGHT_SPEC.activityFrames).map(([checkpoint, frame]) => [checkpoint, { route: frame.route, provenance: frame.provenance }])),
		{
			work: { route: 'work', provenance: 'WebMCP · show_work_search' },
			review: { route: 'review', provenance: 'WebMCP · set_review_scope' },
			next: { route: 'next', provenance: 'WebMCP · prepare_next_action' },
			draft: { route: 'work', provenance: 'WebMCP · create_work_drafts' }
		}
	);
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.allowedSameOriginFetches, ['/data/demo-packs.json']);
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.forbiddenHumanActivations, ['Start', 'Save next action', 'Approve and save', 'Discard draft']);
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.trail, [
		{ checkpoint: 'work', verified: 1, pending: 0, decide: 'absent' },
		{ checkpoint: 'review', verified: 2, pending: 0, decide: 'absent' },
		{ checkpoint: 'next', verified: 3, pending: 1, decide: 'pending' },
		{ checkpoint: 'drafts', verified: 4, pending: 1, decide: 'pending' },
		{ checkpoint: 'final', verified: 4, pending: 1, decide: 'pending' }
	]);
	assert.deepEqual(RECORDING_PREFLIGHT_SPEC.timeline.map(({ atMs, id }) => [atMs, id]), [
		[0, 'landing-hold'], [6_000, 'landing-to-guide'], [12_000, 'guide-body-page-down'],
		[18_000, 'guide-to-priority'], [25_000, 'priority-to-guide'], [30_000, 'guide-to-work'],
		[46_000, 'work-to-review'], [60_000, 'review-to-next'], [70_000, 'next-body-arrow-downs'],
		[78_000, 'next-to-work'], [86_000, 'create-drafts'], [96_000, 'work-to-pending'],
		[103_000, 'final-body-arrow-downs'], [109_500, 'final-acceptance']
	]);
	assert.deepEqual(RECORDING_PREFLIGHT_TIMELINE_AT_MS, Object.fromEntries(RECORDING_PREFLIGHT_SPEC.timeline.map(({ id, atMs }) => [id, atMs])));
	assert.equal(Object.isFrozen(RECORDING_PREFLIGHT_TIMELINE_AT_MS), true);
});

test('the human cue sheet parses to the exact executable recording specification', () => {
	const parsed = parseRecordingCueSheet(cueSource);
	const expected = recordingCueProjectionFromSpec(RECORDING_PREFLIGHT_SPEC);
	assert.deepEqual(parsed, expected);
	assert.equal(parsed.productionUrl, RECORDING_PREFLIGHT_SPEC.productionUrl);
	assert.deepEqual(parsed.timeline, RECORDING_PREFLIGHT_SPEC.timeline);
	assert.deepEqual(parsed.browser, {
		presentation: 'fullscreen', toolbar: 'hidden', viewport: null,
		nativeInnerWidth: 1_116, nativeInnerHeight: 698,
		nativeClientWidth: 1_101, nativeClientHeight: 698, nativeScrollWidth: 1_101
	});
	assert.deepEqual(parsed.denominators.guide, { visible: 8, workspace: 8 });
	assert.deepEqual(
		{ workQuery: parsed.workQuery, reviewFilter: parsed.reviewFilter, nextChoice: parsed.nextChoice },
		{ workQuery: 'Garage reset', reviewFilter: 'blocked', nextChoice: 'Confirm storage bin delivery' }
	);
	assert.deepEqual(parsed.priorityRecommendation, RECORDING_PREFLIGHT_SPEC.priorityRecommendation);
	assert.deepEqual(parsed.landingFrame, RECORDING_PREFLIGHT_SPEC.landingFrame);
	assert.deepEqual(parsed.guideOpeningFrame, RECORDING_PREFLIGHT_SPEC.guideOpeningFrame);
	assert.deepEqual(parsed.guideLowerFrame, RECORDING_PREFLIGHT_SPEC.guideLowerFrame);
	assert.deepEqual(parsed.activityFrames, RECORDING_PREFLIGHT_SPEC.activityFrames);
	assert.doesNotMatch(cueSource, /\*\*(?:1 Work|Review in queue|3 Next)\*\*/u);

	assert.throws(
		() => parseRecordingCueSheet(cueSource.replace('then use five additional Tab presses to reach **Open the handoff workflow**', 'then use four additional Tab presses to reach **Open the handoff workflow**')),
		/missing its exact Landing to Guide keyboard destination/u
	);
	assert.throws(
		() => parseRecordingCueSheet(cueSource.replace('Guide → Priority: five Tab presses to reach **Tools**, then Enter; two Tab presses in the dialog reach **Priority**, then Enter', 'Guide → Priority: four Tab presses, then Enter')),
		/missing its exact Guide to Priority keyboard destination/u
	);
	assert.throws(
		() => parseRecordingCueSheet(cueSource.replace('Work receipt → Review: eleven Shift+Tab presses to reach **Tools**, then Enter; three Tab presses in the dialog reach **Review**, then Enter', 'Work receipt → Review: seven Shift+Tab presses, then Enter on **Review in queue**')),
		/missing its exact Work to Review keyboard destination/u
	);
	assert.throws(
		() => parseRecordingCueSheet(cueSource.replace('Review receipt → Next: three Shift+Tab presses to reach **Tools**, then Enter; four Tab presses in the dialog reach **Next**, then Enter', 'Review receipt → Next: three Shift+Tab presses, then Enter on **3 Next**')),
		/missing its exact Review to Next keyboard destination/u
	);
	assert.throws(
		() => parseRecordingCueSheet(cueSource.replace('Work Draft receipt → pending decision: thirteen Shift+Tab presses to reach **Pending 1**, then Enter; two Tab presses in the dialog reach **Review on Next**, then Enter', 'Work Draft receipt → pending decision: ten Shift+Tab presses, then Enter on **Pending 1**')),
		/missing its exact Work to pending keyboard destination/u
	);
	assert.throws(
		() => parseRecordingCueSheet(cueSource.replace('Priority → Guide: five Shift+Tab presses', 'Priority → Guide: six Shift+Tab presses')),
		/missing its exact Priority to Guide keyboard destination/u
	);
	assert.throws(
		() => parseRecordingCueSheet(cueSource.replace('Returned Guide → fast brief: five Shift+Tab presses', 'Returned Guide → fast brief: four Shift+Tab presses')),
		/missing its exact Guide to fast brief keyboard destination/u
	);
	assert.throws(
		() => parseRecordingCueSheet(cueSource.replace('then use nine additional Tabs to reach **Work**', 'then use five additional Tabs to reach **Work**')),
		/missing its exact Guide reader to Work keyboard destination/u
	);
	assert.notDeepEqual(
		parseRecordingCueSheet(cueSource.replace('Guide 1 / Priority 1 / Work 3 / Review 2 / Next 2', 'Guide 1 / Priority 1 / Work 2 / Review 2 / Next 2')),
		expected
	);
	assert.throws(
		() => parseRecordingCueSheet(cueSource.replaceAll('8 → 11', '8 → 10')),
		/missing its exact Draft 8 to 11 denominator/u
	);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('fullscreen Google Chrome inner viewport 1116 × 698', 'fullscreen Google Chrome inner viewport 1115 × 698')), expected);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('8 visible of 8', '7 visible of 8')), expected);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('Review filter `blocked`', 'Review filter `all`')), expected);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('title `Garden study: log interviews`', 'title `Different work`')), expected);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('`4 shown · 4 matching · 8 workspace`', '`3 shown · 4 matching · 8 workspace`')), expected);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('`No backend`', '`Backend optional`')), expected);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('`0 verified actions, 0 pending`', '`1 verified actions, 0 pending`')), expected);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('`Use fast-create brief` control', '`Use another brief` control')), expected);
	assert.notDeepEqual(parseRecordingCueSheet(cueSource.replace('final-acceptance@01:49.500', 'final-acceptance@01:49.000')), expected);
});

test('the test-only modelContext probe preserves descriptor identity, serialization, settlement, and teardown ownership', () => {
	const probeSource = buildModelContextProbeInitScript().toString();
	assert.match(probeSource, /const activeDescriptors = new Set\(\)[\s\S]*?const registrationSignals = new Map\(\)/u);
	assert.match(probeSource, /registerTool\(descriptor, options = \{\}\)[\s\S]*?signal instanceof AbortSignal[\s\S]*?queueMicrotask/u);
	assert.match(probeSource, /signal\.addEventListener\('abort', abort, \{ once: true \}\)[\s\S]*?activeDescriptors\.add\(descriptor\)/u);
	assert.match(probeSource, /executeTool\(descriptor, serializedInput\)[\s\S]*?!activeDescriptors\.has\(descriptor\)[\s\S]*?typeof serializedInput !== 'string'[\s\S]*?JSON\.parse\(serializedInput\)[\s\S]*?descriptor\.execute/u);
	assert.match(probeSource, /Object\.defineProperty\(document, 'modelContext'[\s\S]*?writable: false/u);
	assert.match(probeSource, /document\.addEventListener\('click', \(event\) => \{[\s\S]*?event\.target instanceof Element[\s\S]*?closest\('button, a, input\[type="submit"\]'\)[\s\S]*?forbiddenHumanActivations\.some\(\(forbidden\) => label === forbidden \|\| label\.startsWith\(`\$\{forbidden\} `\)\)[\s\S]*?evidence\.humanActivations\.push\(label\)[\s\S]*?\}, true\)/u);
	assert.doesNotMatch(probeSource, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|querySelector\('\[data-work-item/u);
});

test('the CLI owns installed Chrome, native viewport, exact keyboard order, diagnostics, and bounded cleanup', () => {
	assert.match(calibrationSource, /import \{ buildModelContextProbeInitScript, RECORDING_PREFLIGHT_SPEC \} from '\.\/webmcp-recording-preflight\.mjs'/u);
	assert.match(calibrationSource, /async function pressExactly\(page, key, label, expectedCount, predicate\)[\s\S]*?target-arrived-early[\s\S]*?exact-step-mismatch[\s\S]*?assert\.ok\(matched/u);
	for (const key of [
		'guideToToolsTabs', 'toolsToPriorityTabs', 'priorityToGuideShiftTabs', 'guideToFastBriefShiftTabs',
		'guideToWorkTabs', 'workToToolsShiftTabs', 'toolsToReviewTabs', 'reviewToToolsShiftTabs',
		'toolsToNextTabs', 'nextToWorkShiftTabs', 'workToPendingShiftTabs', 'pendingToNextTabs'
	]) assert.match(calibrationSource, new RegExp(`RECORDING_PREFLIGHT_SPEC\\.keyboard\\.${key}`, 'u'));
	assert.doesNotMatch(calibrationSource, /pressUntil|pressExactly\([^\n]+,\s*\d+\s*,/u);
	assert.match(calibrationSource, /guide-header-tools[\s\S]*?tools-priority[\s\S]*?priority-header-guide[\s\S]*?guide-fast-brief[\s\S]*?guide-header-work[\s\S]*?work-header-tools[\s\S]*?tools-review[\s\S]*?review-header-tools[\s\S]*?tools-next[\s\S]*?next-header-work[\s\S]*?work-header-pending[\s\S]*?pending-review-on-next[\s\S]*?waitForRoute\(page, '\/next'\)/u);
	assert.match(harnessSource, /await import\('playwright-core'\)/u);
	assert.doesNotMatch(harnessSource.split("await import('playwright-core')")[0], /from ['"]playwright-core['"]/u);
	assert.match(harnessSource, /fs\.mkdtemp\(path\.join\(os\.tmpdir\(\), RECORDING_PREFLIGHT_SPEC\.browser\.profilePrefix\)\)/u);
	assert.match(harnessSource, /chromium\.launchPersistentContext\(profilePath, \{[\s\S]*?executablePath: chromeExecutable[\s\S]*?headless: false[\s\S]*?viewport: null[\s\S]*?ignoreDefaultArgs: \['--enable-automation'\][\s\S]*?'--kiosk'[\s\S]*?'--disable-infobars'/u);
	assert.match(harnessSource, /assertFullscreenSettled\(page\)[\s\S]*?outerWidth === window\.screen\.width[\s\S]*?outerHeight === window\.screen\.height[\s\S]*?Math\.abs\(window\.innerHeight - window\.screen\.height\) <= 1[\s\S]*?emit\('browser-presentation-rejection'[\s\S]*?throw error[\s\S]*?index < 4[\s\S]*?for \(const sample of samples\)[\s\S]*?assert\.deepEqual\(sample, samples\[0\]\)[\s\S]*?sample\.innerWidth, RECORDING_PREFLIGHT_SPEC\.browser\.nativeInnerWidth[\s\S]*?sample\.innerHeight, RECORDING_PREFLIGHT_SPEC\.browser\.nativeInnerHeight[\s\S]*?sample\.outerWidth, RECORDING_PREFLIGHT_SPEC\.browser\.nativeInnerWidth[\s\S]*?sample\.screenWidth, RECORDING_PREFLIGHT_SPEC\.browser\.nativeInnerWidth[\s\S]*?sample\.clientWidth, RECORDING_PREFLIGHT_SPEC\.browser\.nativeClientWidth[\s\S]*?sample\.clientHeight, RECORDING_PREFLIGHT_SPEC\.browser\.nativeClientHeight[\s\S]*?sample\.scrollWidth, RECORDING_PREFLIGHT_SPEC\.browser\.nativeScrollWidth[\s\S]*?emit\('browser-presentation'/u);
	assert.match(harnessSource, /page\.goto\(spec\.productionUrl[\s\S]*?locator\('h1'[\s\S]*?assertFullscreenSettled\(page\)[\s\S]*?assertZeroOverflow\(page, 'landing-ready'\)[\s\S]*?assertLandingFrame\(page\)[\s\S]*?const startedAt = performance\.now\(\)/u);
	assert.match(harnessSource, /RECORDING_PREFLIGHT_TIMELINE_AT_MS = Object\.freeze\(Object\.fromEntries\([\s\S]*?RECORDING_PREFLIGHT_SPEC\.timeline\.map\(\(\{ id, atMs \}\) => \[id, atMs\]\)[\s\S]*?timeline ids must be unique/u);
	assert.match(harnessSource, /function cueAt\(id\)[\s\S]*?Object\.hasOwn\(RECORDING_PREFLIGHT_TIMELINE_AT_MS, id\)[\s\S]*?return RECORDING_PREFLIGHT_TIMELINE_AT_MS\[id\]/u);
	const runtimeCueIds = [...harnessSource.matchAll(/waitUntil\(startedAt, cueAt\('([^']+)'\)\)/gu)].map((match) => match[1]);
	assert.deepEqual(runtimeCueIds, RECORDING_PREFLIGHT_SPEC.timeline.slice(1).map(({ id }) => id));
	assert.match(harnessSource, /context\.addInitScript\(buildModelContextProbeInitScript\(\), \{[\s\S]*?forbiddenHumanActivations: RECORDING_PREFLIGHT_SPEC\.forbiddenHumanActivations[\s\S]*?\}\)/u);
	assert.match(harnessSource, /const serializedInput = JSON\.stringify\(input\)[\s\S]*?modelContext\.getTools\(\)[\s\S]*?modelContext\.executeTool\(descriptor, serializedInput\)/u);
	assert.match(harnessSource, /async function settleKeyboardStep\(page\) \{[\s\S]*?bounded\([\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?settledFocus = document\.activeElement[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?document\.activeElement !== settledFocus[\s\S]*?Exact keyboard step focus changed between rendered frames[\s\S]*?Exact keyboard step render settlement[\s\S]*?async function pressExact\(page, key, count, destination\) \{[\s\S]*?page\.keyboard\.press\(key\);[\s\S]*?settleKeyboardStep\(page\);/u);
	assert.match(harnessSource, /function focusMatchesDestination\(focus, \{ text, visibleText, path: expectedPath \}\)[\s\S]*?focus\.text !== text[\s\S]*?focus\.visibleText !== visibleText[\s\S]*?!focus\.href[\s\S]*?pathname !== expectedPath[\s\S]*?index < count - 1[\s\S]*?focusMatchesDestination\(focus, destination\)[\s\S]*?emit\('keyboard-rejection'[\s\S]*?Keyboard reached its declared destination after/iu);
	assert.match(harnessSource, /async function activateDialog\(page, accessibleName, checkpoint\) \{[\s\S]*?page\.keyboard\.press\('Enter'\)[\s\S]*?getByRole\('dialog', \{ name: accessibleName \}\)\.waitFor[\s\S]*?settleKeyboardStep\(page\)[\s\S]*?emit\('dialog'/u);
	assert.match(harnessSource, /async function bodyTab\(page, count, checkpoint\) \{[\s\S]*?body\.press\('Tab'\)[\s\S]*?settleKeyboardStep\(page\)/u);
	assert.match(harnessSource, /bodyTab\(page, spec\.keyboard\.landingBodyTabs, 'landing-reclaim'\)[\s\S]*?pressExact\(page, 'Tab', spec\.keyboard\.landingToGuideTabs, \{ path: spec\.routes\.guide\.path, text: 'Open the handoff workflow →' \}\)/u);
	assert.match(harnessSource, /bodyTab\(page, spec\.keyboard\.guideReaderBodyTabs, 'guide-reader-reclaim'\)[\s\S]*?pressExact\(page, 'Tab', spec\.keyboard\.guideToWorkTabs, \{ text: 'Work', path: spec\.routes\.work\.path \}\)/u);
	assert.match(harnessSource, /guideToToolsTabs, \{ text: 'Tools' \}\)[\s\S]*?activateDialog\(page, 'Tools', 'guide-tools'\)[\s\S]*?toolsToPriorityTabs, \{ text: 'Priority Standalone recommendation view'/u);
	assert.match(harnessSource, /workToToolsShiftTabs, \{ text: 'Tools' \}\)[\s\S]*?activateDialog\(page, 'Tools', 'work-tools'\)[\s\S]*?toolsToReviewTabs, \{ text: 'Review Full evidence queue'/u);
	assert.match(harnessSource, /reviewToToolsShiftTabs, \{ text: 'Tools, Review is the current view', visibleText: 'Tools Review' \}\)[\s\S]*?activateDialog\(page, 'Tools', 'review-tools'\)[\s\S]*?toolsToNextTabs, \{ text: 'Next Full next-action editor'/u);
	assert.match(harnessSource, /workToPendingShiftTabs, \{ text: 'Resume 1 pending approval', visibleText: 'Pending 1'[\s\S]*?activateDialog\(page, \/\^Pending approvals[\s\S]*?pendingToNextTabs, \{ text: 'Review on Next'/u);
	assert.doesNotMatch(harnessSource, /guideToPriorityTabs|workToReviewShiftTabs|reviewToNextShiftTabs|'1 Work'|'Review in queue'|'3 Next'/u);
	assert.doesNotMatch(harnessSource, /seekForward|MaxTabs/u);
	assert.match(harnessSource, /executeRegisteredTool\(page, 'get_projects_handoff_guide'[\s\S]*?locator\('\[data-webmcp-receipt="guide"\]'\)\.waitFor\(\{ state: 'visible'[\s\S]*?emit\('reader-receipt'[\s\S]*?actionFocusClaimed: false/u);
	assert.doesNotMatch(harnessSource, /assertVisibleFocus\(page, 'guide-reader'\)/u);
	assert.match(harnessSource, /catch \(error\) \{[\s\S]*?heading: document\.querySelector\('h1'\)[\s\S]*?status: document\.querySelector\('\[data-webmcp-status-pill\]'\)[\s\S]*?toolNames: document\.modelContext\?\.getTools\(\)[\s\S]*?emit\('route-rejection'[\s\S]*?did not settle within/u);
	assert.match(harnessSource, /const pill = document\.querySelector\('\[data-webmcp-status-pill\]'\)[\s\S]*?pillRendered:[\s\S]*?pillFullyVisible:[\s\S]*?catalog\.status, 'ready'[\s\S]*?catalog\.pillRendered, true[\s\S]*?routeName === 'guide'[\s\S]*?catalog\.pillFullyVisible, true/u);
	assert.match(harnessSource, /bodyKeyScroll\(page, key, count, checkpoint\)[\s\S]*?locator\('body'\)\.focus\(\)[\s\S]*?page\.keyboard\.press\(key\)[\s\S]*?page\.evaluate[\s\S]*?stableFrames >= 3[\s\S]*?requestAnimationFrame\(frame\)[\s\S]*?body-owned \$\{key\} settlement/u);
	assert.match(harnessSource, /const RECORDING_GUIDE_OPENING_FRAME = \{[\s\S]*?8 visible of 8 workspace[\s\S]*?Ready for one bounded run[\s\S]*?No agent action recorded\.[\s\S]*?No action recorded[\s\S]*?0 verified actions, 0 pending[\s\S]*?WebMCP 1 tool[\s\S]*?guideOpeningFrame: RECORDING_GUIDE_OPENING_FRAME[\s\S]*?async function assertOpeningGuideFrame\(page\) \{[\s\S]*?querySelector\('\[data-agent-scope-chooser\]'\)[\s\S]*?agent-scope-title \+ p[\s\S]*?querySelector\('\[data-webmcp-handoff-session\]'\)[\s\S]*?data-workspace-count[\s\S]*?data-visible-count[\s\S]*?RECORDING_PREFLIGHT_SPEC\.guideOpeningFrame[\s\S]*?countFullyVisible, true[\s\S]*?emit\('guide-opening-frame'/u);
	assert.match(harnessSource, /const RECORDING_LANDING_FRAME = \{[\s\S]*?Browser workers read and narrow the same work you see[\s\S]*?No backend[\s\S]*?No automatic starts[\s\S]*?Open the handoff workflow →[\s\S]*?WebMCP handoff in Review[\s\S]*?landingFrame: RECORDING_LANDING_FRAME[\s\S]*?async function assertLandingFrame\(page\) \{[\s\S]*?querySelector\('\.lp-hero'\)[\s\S]*?lp-hero-copy[\s\S]*?lp-preview[\s\S]*?RECORDING_PREFLIGHT_SPEC\.landingFrame[\s\S]*?frame\.copy\?\.fullyVisible, true[\s\S]*?frame\.preview\?\.fullyVisible, true[\s\S]*?emit\('landing-frame'/u);
	assert.match(harnessSource, /pressExact\(page, 'Tab', spec\.keyboard\.landingToGuideTabs[\s\S]*?activateRoute\(page, 'guide'\)[\s\S]*?assertOpeningGuideFrame\(page\)[\s\S]*?waitUntil\(startedAt, cueAt\('guide-body-page-down'\)/u);
	assert.match(harnessSource, /async function assertPriorityFrame\(page\) \{[\s\S]*?querySelector\('\[data-priority-next-recommendation\]'\)[\s\S]*?priority-recommendation-title[\s\S]*?priority-reason[\s\S]*?details\['Work ID'\][\s\S]*?details\.Destination[\s\S]*?actionHref[\s\S]*?RECORDING_PREFLIGHT_SPEC\.priorityRecommendation[\s\S]*?frame\.fullyVisible, true[\s\S]*?emit\('priority-frame'/u);
	assert.match(harnessSource, /activateRoute\(page, 'priority'\)[\s\S]*?locator\('\[data-priority-next-recommendation\]'\)\.waitFor[\s\S]*?assertPriorityFrame\(page\)[\s\S]*?waitUntil\(startedAt, cueAt\('priority-to-guide'\)/u);
	assert.match(harnessSource, /async function readActivityFrame\(page, route\) \{[\s\S]*?data-webmcp-receipt[\s\S]*?webmcp-activity-step[\s\S]*?webmcp-activity-outcome[\s\S]*?webmcp-activity-evidence[\s\S]*?webmcp-activity-authority[\s\S]*?webmcp-tool-provenance[\s\S]*?fullyVisible/u);
	assert.match(harnessSource, /const RECORDING_WORK_QUERY = 'Garage reset'[\s\S]*?const RECORDING_DENOMINATORS = \{[\s\S]*?const RECORDING_DRAFT_TITLES = \[[\s\S]*?function buildRecordingActivityFrames\(workQuery, denominators, draftTitles\)[\s\S]*?Step 1 · Narrow Work[\s\S]*?WebMCP · show_work_search[\s\S]*?Step 2 · Verify Review[\s\S]*?WebMCP · set_review_scope[\s\S]*?Step 3 · Prepare Next[\s\S]*?WebMCP · prepare_next_action[\s\S]*?Step 4 · Stage Drafts[\s\S]*?draftTitles\.join\(' · '\)[\s\S]*?WebMCP · create_work_drafts[\s\S]*?activityFrames: buildRecordingActivityFrames\(RECORDING_WORK_QUERY, RECORDING_DENOMINATORS, RECORDING_DRAFT_TITLES\)/u);
	assert.match(harnessSource, /async function assertActivityFrame\(page, checkpoint, phase\) \{[\s\S]*?RECORDING_PREFLIGHT_SPEC\.activityFrames\[checkpoint\][\s\S]*?Unknown recording activity frame[\s\S]*?readActivityFrame\(page, route\)[\s\S]*?assert\.deepEqual[\s\S]*?frame\.fullyVisible, true[\s\S]*?emit\(`\$\{checkpoint\}-frame`/u);
	assert.match(harnessSource, /assertVisibleFocus\(page, 'work-receipt'\)[\s\S]*?assertActivityFrame\(page, 'work', 'hold'\)[\s\S]*?assertTrail\(page, 'work'\)/u);
	assert.match(harnessSource, /assertVisibleFocus\(page, 'review-receipt'\)[\s\S]*?assertActivityFrame\(page, 'review', 'hold'\)[\s\S]*?assertTrail\(page, 'review'\)/u);
	assert.match(harnessSource, /assertVisibleFocus\(page, 'next-receipt'\)[\s\S]*?assertActivityFrame\(page, 'next', 'prepared'\)[\s\S]*?assertTrail\(page, 'next'\)/u);
	assert.match(harnessSource, /assertVisibleFocus\(page, 'draft-receipt'\)[\s\S]*?assertActivityFrame\(page, 'draft', 'hold'\)[\s\S]*?assertTrail\(page, 'drafts'\)/u);
	assert.match(harnessSource, /const RECORDING_GUIDE_LOWER_FRAME = \{[\s\S]*?Use the WebMCP tools on Work, Review, and Next[\s\S]*?Use fast-create brief[\s\S]*?guideLowerFrame: RECORDING_GUIDE_LOWER_FRAME[\s\S]*?async function assertGuideLowerFrame\(page\) \{[\s\S]*?querySelector\('\[data-agent-brief-input\]'\)[\s\S]*?querySelector\('\[data-agent-brief-fast-create\]'\)[\s\S]*?RECORDING_PREFLIGHT_SPEC\.guideLowerFrame[\s\S]*?frame\.brief\?\.fullyVisible, true[\s\S]*?frame\.fastCreate\?\.fullyVisible, true[\s\S]*?emit\('guide-lower-frame'/u);
	assert.match(harnessSource, /waitUntil\(startedAt, cueAt\('guide-body-page-down'\)\)[\s\S]*?bodyKeyScroll\(page, 'PageDown', spec\.keyboard\.guideBodyPageDowns, 'guide'\)[\s\S]*?assertZeroOverflow\(page, 'guide-lower'\)[\s\S]*?assertGuideLowerFrame\(page\)[\s\S]*?waitUntil\(startedAt, cueAt\('guide-to-priority'\)/u);
	assert.match(harnessSource, /async function assertPreparedNextFrame\(page\) \{[\s\S]*?locator\('#next-preparation-receipt'\)\.evaluate[\s\S]*?top: rect\.top[\s\S]*?bottom: rect\.bottom[\s\S]*?fullyVisible:[\s\S]*?emit\('prepared-frame-observation'[\s\S]*?receipt\.fullyVisible, true[\s\S]*?emit\('prepared-frame'/u);
	assert.match(harnessSource, /waitUntil\(startedAt, cueAt\('next-body-arrow-downs'\)\)[\s\S]*?bodyKeyScroll\(page, 'ArrowDown', spec\.keyboard\.nextBodyArrowDowns, 'next-prepared'\)[\s\S]*?assertZeroOverflow\(page, 'next-prepared-lower'\)[\s\S]*?assertPreparedNextFrame\(page\)[\s\S]*?waitUntil\(startedAt, cueAt\('next-to-work'\)\)[\s\S]*?pressExact\(page, 'Shift\+Tab', spec\.keyboard\.nextToWorkShiftTabs/u);
	assert.match(harnessSource, /waitUntil\(startedAt, cueAt\('final-body-arrow-downs'\)\)[\s\S]*?bodyKeyScroll\(page, 'ArrowDown', spec\.keyboard\.finalBodyArrowDowns, 'next-final'\)[\s\S]*?assertZeroOverflow\(page, 'next-final'\)[\s\S]*?assertActivityFrame\(page, 'next', 'restored-final'\)[\s\S]*?assertFinalHumanFrame\(page\)/u);
	assert.doesNotMatch(harnessSource, /waitUntil\(startedAt, \d/u);
	assert.match(harnessSource, /emit\('final-frame-observation', \{ actual: frame \}\)[\s\S]*?frame\.receipt\?\.fullyVisible[\s\S]*?frame\.buttons\.every/u);
	assert.match(harnessSource, /workToPendingShiftTabs, \{ text: 'Resume 1 pending approval', visibleText: 'Pending 1', path: spec\.routes\.next\.path \}[\s\S]*?pendingToNextTabs, \{ text: 'Review on Next', path: spec\.routes\.next\.path \}/u);
	assert.match(harnessSource, /assertFocusedDestination\(page, \{ text, visibleText, path: expectedPath \}\)[\s\S]*?if \(visibleText\) assert\.equal\(focus\.visibleText, visibleText\)/u);
	assert.equal((harnessSource.match(/#next-preparation-receipt/gu) ?? []).length, 3, 'Prepared-hold and restored-frame checks own the canonical Next receipt id.');
	assert.doesNotMatch(harnessSource, /#next-webmcp-preparation/u);
	assert.match(harnessSource, /consoleErrors: \[\], pageErrors: \[\], cspFailures: \[\], externalRequests: \[\], unexpectedRequests: \[\][\s\S]*?writeRequests: \[\], serverRequests: \[\], failedResponses: \[\], requestFailures: \[\]/u);
	assert.match(harnessSource, /finally \{[\s\S]*?context\?\.close\(\)[\s\S]*?browser\?\.isConnected\(\)[\s\S]*?removeVerifiedTempProfile\(profilePath\)[\s\S]*?cleanupExpected[\s\S]*?cleanupActual[\s\S]*?assert\.deepEqual\(cleanupActual, cleanupExpected\)[\s\S]*?runError \?\?= error[\s\S]*?emit\('cleanup'/u);
	assert.match(harnessSource, /const isMain = process\.argv\[1\][\s\S]*?fileURLToPath\(import\.meta\.url\)[\s\S]*?if \(isMain\)/u);

	assert.equal((harnessSource.match(/page\.goto\(/gu) ?? []).length, 1, 'Only the initial production navigation may use page.goto.');
	assert.doesNotMatch(harnessSource, /waitForTimeout|setViewportSize|\.click\(|chromium\.launch\(|channel\s*:|\bretry\b|\bfallback\b|alternate selector|relax(?:ed|ation)?/iu);
	assert.doesNotMatch(harnessSource, /localStorage\.(?:setItem|removeItem|clear)|sessionStorage\.(?:setItem|removeItem|clear)|page\.evaluate\([^)]*fetch\(/u);
});

test('runtime assertions substantively own catalogs, bounded actions, authority, trails, and diagnostics', () => {
	assert.match(harnessSource, /async function assertCatalog\(page, routeName\)[\s\S]*?catalog\.status, 'ready'[\s\S]*?catalog\.pillRendered, true[\s\S]*?catalog\.toolNames, expectedNames[\s\S]*?catalog\.pillText, `WebMCP \$\{expectedNames\.length\}/u);
	assert.match(harnessSource, /executeRegisteredTool\(page, 'get_projects_handoff_guide', \{\}\)[\s\S]*?visible: guide\.workScope\.visibleCount, workspace: guide\.workScope\.workspaceCount[\s\S]*?spec\.denominators\.guide[\s\S]*?guide\.agentBrief/u);
	assert.match(harnessSource, /executeRegisteredTool\(page, 'get_current_work_view', \{\}\)[\s\S]*?initialWork\.counts\.workspace, spec\.denominators\.work\.workspace[\s\S]*?executeRegisteredTool\(page, 'show_work_search', \{ query: spec\.workQuery \}\)[\s\S]*?workDenominators[\s\S]*?spec\.denominators\.work/u);
	assert.match(harnessSource, /executeRegisteredTool\(page, 'get_current_review_queue', \{\}\)[\s\S]*?initialReview\.counts\.totalReview, spec\.denominators\.review\.total[\s\S]*?executeRegisteredTool\(page, 'set_review_scope', \{ query: spec\.workQuery, filter: spec\.reviewFilter \}\)[\s\S]*?reviewDenominators[\s\S]*?spec\.denominators\.review/u);
	assert.match(harnessSource, /const evidence = evidenceForCurrentNext\(nextEditor, narrowedWork\.work, scopedReview\)[\s\S]*?executeRegisteredTool\(page, 'prepare_next_action', \{[\s\S]*?choice: spec\.nextChoice[\s\S]*?expectedMode: nextEditor\.editor\.mode[\s\S]*?expectedChoice: nextEditor\.editor\.choice[\s\S]*?evidence[\s\S]*?workspaceChanged, false[\s\S]*?requiresHumanSave, true/u);
	assert.match(harnessSource, /executeRegisteredTool\(page, 'create_work_drafts', \{[\s\S]*?expectedWorkspaceCount: spec\.denominators\.drafts\.before[\s\S]*?spec\.draftTitles\.map\(\(title\) => \(\{ title \}\)\)[\s\S]*?created\.created\.map\(\(\{ title \}\) => title\), spec\.draftTitles[\s\S]*?draftDenominators[\s\S]*?spec\.denominators\.drafts[\s\S]*?created\.requiresHumanStart, true/u);
	assert.match(harnessSource, /assertTrail\(page, 'work'\)[\s\S]*?assertTrail\(page, 'review'\)[\s\S]*?assertTrail\(page, 'next'\)[\s\S]*?assertTrail\(page, 'drafts'\)[\s\S]*?assertTrail\(page, 'final'\)/u);
	assert.match(harnessSource, /if \(expected\.decide === 'absent'\) assert\.equal\(decide, undefined\)[\s\S]*?assert\.equal\(decide\?\.label, 'Decide: pending'\)/u);
	assert.match(harnessSource, /frame\.heading, 'Review the proposed next action'[\s\S]*?frame\.receipt\?\.fullyVisible, true[\s\S]*?\['Discard draft', 'Approve and save'\][\s\S]*?Draft:\\s\*pending approval[\s\S]*?Workspace:\\s\*unchanged[\s\S]*?only you can approve Save[\s\S]*?frame\.humanActivations, \[\]/u);
	assert.match(harnessSource, /finalProbe\.executions, spec\.toolSequence[\s\S]*?finalProbe\.humanActivations, \[\][\s\S]*?assertDiagnosticsClean\(diagnostics\)/u);

	assert.match(harnessSource, /const observePage = \(page\) => \{[\s\S]*?page\.on\('console'[\s\S]*?diagnostics\.consoleErrors\.push[\s\S]*?diagnostics\.cspFailures\.push[\s\S]*?page\.on\('pageerror'[\s\S]*?diagnostics\.pageErrors\.push\(error\.stack \|\| error\.message\)/u);
	assert.match(harnessSource, /context\.on\('request'[\s\S]*?diagnostics\.externalRequests\.push[\s\S]*?diagnostics\.writeRequests\.push[\s\S]*?diagnostics\.serverRequests\.push[\s\S]*?const pathnameAndSearch = `\$\{url\.pathname\}\$\{url\.search\}`[\s\S]*?allowedSameOriginFetches\.includes\(pathnameAndSearch\)[\s\S]*?diagnostics\.unexpectedRequests\.push/u);
	assert.match(harnessSource, /context\.on\('response'[\s\S]*?response\.status\(\) >= 400[\s\S]*?diagnostics\.failedResponses\.push[\s\S]*?context\.on\('requestfailed'[\s\S]*?diagnostics\.requestFailures\.push/u);
	assert.match(harnessSource, /async function assertDiagnosticsClean\(diagnostics\)[\s\S]*?consoleErrors: diagnostics\.consoleErrors[\s\S]*?pageErrors: diagnostics\.pageErrors[\s\S]*?cspFailures: diagnostics\.cspFailures[\s\S]*?externalRequests: diagnostics\.externalRequests[\s\S]*?unexpectedRequests: diagnostics\.unexpectedRequests[\s\S]*?writeRequests: diagnostics\.writeRequests[\s\S]*?serverRequests: diagnostics\.serverRequests[\s\S]*?failedResponses: diagnostics\.failedResponses[\s\S]*?requestFailures: diagnostics\.requestFailures[\s\S]*?Object\.entries\(actual\)[\s\S]*?assert\.deepEqual\(entries, \[\][\s\S]*?emit\('diagnostics'/u);
	assert.match(harnessSource, /const choreography = runChoreography\(page, diagnostics\)[\s\S]*?bounded\(choreography, RECORDING_PREFLIGHT_SPEC\.hardStopMs, 'Recording preflight hard stop'\)/u);
});

test('Chrome lookup has one explicit override, supported installed paths, and bounded temp deletion', async () => {
	const candidates = chromeExecutableCandidates({
		CHROME_EXECUTABLE_PATH: 'D:\\Chrome for Testing\\chrome.exe',
		'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
		ProgramFiles: 'C:\\Program Files',
		LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local'
	}).map((candidate) => path.win32.normalize(candidate));
	assert.deepEqual(candidates, [
		'D:\\Chrome for Testing\\chrome.exe',
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files\\Google\\Chrome Dev\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome Dev\\Application\\chrome.exe',
		'C:\\Users\\tester\\AppData\\Local\\Google\\Chrome Dev\\Application\\chrome.exe'
	]);

	await assert.rejects(() => removeVerifiedTempProfile(repositoryRoot), /Refusing to remove unverified recording profile/u);
	const disposable = await fs.mkdtemp(path.join(os.tmpdir(), RECORDING_PREFLIGHT_SPEC.browser.profilePrefix));
	await fs.writeFile(path.join(disposable, 'owned.txt'), 'preflight only');
	await removeVerifiedTempProfile(disposable);
	await assert.rejects(() => fs.stat(disposable), (error) => error?.code === 'ENOENT');
});
