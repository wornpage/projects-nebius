import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	PROJECTS_HANDOFF_GUIDE_TOOL_NAME,
	createWebMcpChallengeGuideTool,
	deriveGuideWorkScopeCatalog,
	readRenderedWebMcpChallengeGuide,
	webMcpChallengeGuideView
} from '../svelte-frontend/src/routes/webmcp-challenge/webmcp-challenge-webmcp.mjs';
import { guideWorkAction } from '../svelte-frontend/src/lib/guide-work-action.mjs';
import { routeWorkSearch } from '../svelte-frontend/src/routes/work/work-webmcp.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pageSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/webmcp-challenge/+page.svelte'), 'utf8');
const layoutSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/+layout.svelte'), 'utf8');
const pageConfig = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/+layout.ts'), 'utf8');
const svelteConfig = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/svelte.config.js'), 'utf8');
const appDocument = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/app.html'), 'utf8');
const webManifest = fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8');
const baselineReadme = fs.readFileSync(path.join(repoRoot, 'WEBMCP_BASELINE.md'), 'utf8');
const demoClientSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-client.ts'), 'utf8');
const reviewerTests = fs.readFileSync(path.join(repoRoot, 'docs/submission/webmcp/reviewer-tests.md'), 'utf8');
const editorSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/AgentBriefEditor.svelte'), 'utf8');
const webMcpStatusSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/WebMcpStatus.svelte'), 'utf8');
const webMcpRegistrationSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/webmcp.mjs'), 'utf8');
const guideActionSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/guide-work-action.mjs'), 'utf8');
const priorityRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/priority/+page.svelte'), 'utf8');
const workRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/+page.svelte'), 'utf8');
const reviewRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/+page.svelte'), 'utf8');
const nextRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/+page.svelte'), 'utf8');
const samplePacks = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/demo-packs.json'), 'utf8'));

function scopeFixture() {
	return {
		workspaceCount: 8,
		visibleCount: 8,
		discoveredChoiceCount: 2,
		shownChoiceCount: 2,
		omittedChoiceCount: 0,
		choices: [
			{ id: 'all', kind: 'all', label: 'All visible work', query: '', matchingCount: 8 },
			{ id: 'area-1', kind: 'derived', label: 'Household', query: 'Household', matchingCount: 4 },
			{ id: 'area-2', kind: 'derived', label: 'Research', query: 'Research', matchingCount: 4 },
			{ id: 'custom', kind: 'custom', label: 'Custom', query: null, matchingCount: null }
		],
		selected: { id: 'all', kind: 'all', label: 'All visible work', query: '', matchingCount: 8 }
	};
}

function guideFixture() {
	return {
		title: 'Projects handoff guide',
		purpose: 'People and browser agents share the same page.',
		steps: [
			{ position: 1, title: 'Understand work', description: 'Read the current view.', href: '/work' },
			{ position: 2, title: 'Inspect review', description: 'Read the queue.', href: '/review' },
			{ position: 3, title: 'Prepare next', description: 'Prepare a draft.', href: '/next' }
		],
		safety: ['Sample data stays local.', 'Page state is bounded.', 'Humans retain decisions.'],
		agentBrief: 'Read the visible project state.\nDo not save workspace data.',
		workQuery: '',
		workScope: scopeFixture()
	};
}

function selectedGuide({ id, kind, label, query, matchingCount }) {
	const guide = guideFixture();
	return {
		...guide,
		workQuery: query,
		workScope: {
			...guide.workScope,
			selected: { id, kind, label, query, matchingCount }
		}
	};
}

function renderedGuideDocument(fixture) {
	const root = {
		dataset: {
			webmcpChallengeTitle: fixture.title,
			webmcpChallengePurpose: fixture.purpose
		}
	};
	const briefInput = { value: fixture.agentBrief };
	const scopeChooser = {
		dataset: {
			workspaceCount: String(fixture.workScope.workspaceCount),
			visibleCount: String(fixture.workScope.visibleCount),
			discoveredChoiceCount: String(fixture.workScope.discoveredChoiceCount),
			shownChoiceCount: String(fixture.workScope.shownChoiceCount),
			omittedChoiceCount: String(fixture.workScope.omittedChoiceCount),
			selectedScopeId: fixture.workScope.selected.id,
			selectedScopeKind: fixture.workScope.selected.kind,
			selectedScopeLabel: fixture.workScope.selected.label,
			selectedWorkQuery: fixture.workScope.selected.query,
			selectedMatchCount: String(fixture.workScope.selected.matchingCount)
		}
	};
	const choices = fixture.workScope.choices.map((choice) => ({
		dataset: {
			scopeId: choice.id,
			scopeKind: choice.kind,
			scopeLabel: choice.label,
			...(choice.query === null ? {} : { scopeQuery: choice.query }),
			...(choice.matchingCount === null ? {} : { scopeMatchCount: String(choice.matchingCount) })
		}
	}));
	const steps = fixture.steps.map((step) => ({
		querySelector(selector) {
			if (selector === 'h2') return { textContent: step.title };
			if (selector === 'p') return { textContent: step.description };
			if (selector === 'a') return { getAttribute: (attribute) => attribute === 'href' ? step.href : null };
			return null;
		}
	}));
	return {
		root,
		briefInput,
		scopeChooser,
		querySelector(selector) {
			if (selector === '[data-webmcp-challenge-guide]') return root;
			if (selector === '[data-agent-brief-input]') return briefInput;
			if (selector === '[data-agent-scope-chooser]') return scopeChooser;
			return null;
		},
		querySelectorAll(selector) {
			if (selector === '[data-agent-scope-choice]') return choices;
			if (selector === '[data-webmcp-challenge-step]') return steps;
			if (selector === '[data-webmcp-challenge-safety] li') return fixture.safety.map((textContent) => ({ textContent }));
			return [];
		}
	};
}

test('Projects workflow surfaces keep the Guide compact and product-labeled', () => {
	assert.match(layoutSource, /<nav aria-label="Projects application navigation">/u);
	assert.doesNotMatch(layoutSource, /aria-label="Challenge pages"|Projects workflow navigation/u);
	assert.match(pageSource, /Choose visible work and edit the brief; the browser agent can inspect, prepare, or add bounded Drafts while you control Start and final Save\./u);
	assert.match(pageSource, /<WornAccordion label="Authority boundary">/u);
	assert.match(pageSource, /<WornAccordion label=\{__NEBIUS_EDITION__ \? 'Backup and restore' : 'Workspace portability'\}>[\s\S]*?Import export/u);
	assert.match(pageSource, /challenge-export-primary[\s\S]*?inline-size: 124px;/u);
	assert.match(pageSource, /\.challenge-import-label \{[\s\S]*?background: var\(--worn-surface\);[\s\S]*?block-size: 32px;[\s\S]*?border: 1px solid var\(--worn-border\);[\s\S]*?border-radius: var\(--worn-radius\);[\s\S]*?font-size: 12px;[\s\S]*?line-height: 14\.4px;/u);
	assert.match(pageSource, /@media \(pointer: coarse\) \{ \.challenge-import-label \{ block-size: 44px; \} \}/u);
	assert.doesNotMatch(pageSource, /challenge-facts|Projects workflow capabilities/u);
	assert.match(editorSource, /All visible work is ready by default; choose a counted scope or Custom, then ask:/u);
	assert.match(pageSource, /title: 'Observe',[\s\S]*?title: 'Narrow',[\s\S]*?title: 'Prepare',/u);
	assert.doesNotMatch(pageSource, /title: 'Observe the workspace'|title: 'Explain what needs attention'|title: 'Prepare the handoff'/u);
});

test('one global accessible WebMCP catalog replaces the verbose Guide-only reader panel', () => {
	assert.doesNotMatch(pageSource, /webMcpGuideReaderStatus|data-webmcp-guide-reader-status|Guide reader status|Reader API/u);
	assert.match(layoutSource, /import WebMcpStatus from '\$lib\/WebMcpStatus\.svelte';/u);
	assert.equal(layoutSource.match(/<WebMcpStatus \/>/gu)?.length, 1);
	assert.match(webMcpStatusSource, /<button[\s\S]*?data-webmcp-status-pill[\s\S]*?aria-haspopup="dialog"[\s\S]*?aria-expanded=\{open\}[\s\S]*?aria-label=\{`WebMCP \$\{statusLabel\}, \$\{toolCountLabel\} on this page`\}/u);
	assert.match(webMcpStatusSource, /<span class="webmcp-status-name">WebMCP<\/span>[\s\S]*?<span class="webmcp-status-word">\{statusLabel\}<\/span>/u);
	assert.match(webMcpStatusSource, /\.webmcp-status-pill \{[\s\S]*?min-height: var\(--worn-target-min\);/u);
	assert.match(webMcpStatusSource, /<WornDialog bind:open title="WebMCP tools on this page" size="sm">/u);
	assert.match(webMcpStatusSource, /<h2 id="webmcp-native-status-heading">Native browser status<\/h2>[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/u);
	assert.match(webMcpStatusSource, /Current-page tools · \{toolCount\}[\s\S]*?\{#each \$webMcpCatalog\.tools as tool \(tool\.name\)\}[\s\S]*?<code>\{tool\.name\}<\/code>[\s\S]*?<p>\{tool\.description\}<\/p>/u);
	assert.match(webMcpStatusSource, /tool\.authority === 'read-only' \? 'Read only' : 'Page-changing \/ draft authority'/u);
	assert.match(webMcpRegistrationSource, /const catalogTools = descriptors\.map\(\(\{ descriptor, name \}\) =>/u);
	assert.doesNotMatch(`${layoutSource}\n${webMcpStatusSource}`, /get_projects_handoff_guide|get_next_recommendation|get_current_work_view|create_work_drafts|get_current_review_queue|prepare_next_action/u);
	for (const [label, source, expectedCount] of [
		['Guide', pageSource, 1],
		['Priority', priorityRouteSource, 1],
		['Work', workRouteSource, 3],
		['Review', reviewRouteSource, 2],
		['Next', nextRouteSource, 2]
	]) {
		const registeredArray = source.match(/registerPageTools\(document, \[([\s\S]*?)\]\s*(?:,\s*\{|\)\s*\))/u)?.[1] ?? '';
		assert.equal(registeredArray.match(/create[A-Z][A-Za-z]+Tool\(/gu)?.length, expectedCount, `${label} keeps its exact page-local tool count`);
	}
});

test('Guide editable fields include their live character bounds in accessible descriptions', () => {
	assert.match(editorSource, /<p class="agent-brief-limit" id="agent-brief-limit" aria-label=\{`\$\{brief\.length\} of 1000 characters`\}>/u);
	assert.match(editorSource, /<textarea[\s\S]*?id="agent-brief-input"[\s\S]*?aria-describedby="agent-brief-help agent-brief-limit agent-brief-status"/u);
	assert.match(editorSource, /<span id="agent-work-query-limit" aria-label=\{`\$\{workQuery\.length\} of 120 characters`\}>/u);
	assert.match(editorSource, /<input[\s\S]*?id="agent-work-query-input"[\s\S]*?aria-describedby="agent-work-query-help agent-work-query-limit agent-brief-status"/u);
});

test('work-first navigation keeps Pending and Tools in one compact row', () => {
	assert.match(layoutSource, /<nav aria-label="Projects application navigation">[\s\S]*?\{#if __NEBIUS_EDITION__\}[\s\S]*?href="\/next"[\s\S]*?>Next step<\/a>[\s\S]*?\{\/if\}/u);
	assert.match(layoutSource, /class="challenge-nav-control challenge-work-link"[\s\S]*?href="\/work"[\s\S]*?data-nav-label="Work"/u);
	assert.match(layoutSource, /data-nav-label=\{`Pending \$\{pendingNavigation\.count\}`\}/u);
	assert.match(layoutSource, /data-nav-label="Guide"[\s\S]*?data-tools-trigger[\s\S]*?data-nav-label="Tools"/u);
	assert.match(layoutSource, /aria-label=\{activeToolRoute \? `Tools, \$\{activeToolRoute\.label\} is the current view` : 'Tools'\}/u);
	assert.match(layoutSource, /<span>Tools<\/span>[\s\S]*?\{#if activeToolRoute\}<small aria-hidden="true">\{activeToolRoute\.label\}<\/small>\{\/if\}/u);
	assert.match(layoutSource, /<WornDialog bind:open=\{toolsOpen\} title="Tools" size="sm" onclose=\{restoreToolsFocus\}>/u);
	assert.match(layoutSource, /requestAnimationFrame\(\(\) => toolsTrigger\?\.focus\(\{ preventScroll: true \}\)\)/u);
	assert.match(layoutSource, /Priority[\s\S]*?Standalone recommendation view[\s\S]*?Review[\s\S]*?Full evidence queue[\s\S]*?Next[\s\S]*?Full next-action editor/u);
	assert.doesNotMatch(layoutSource, /label: '1 Work'|label: '2 Review'|label: '3 Next'/u);
	const compactStart = layoutSource.indexOf('@media (max-width: 700px)');
	const compactEnd = layoutSource.indexOf('@media (prefers-reduced-motion: reduce)', compactStart);
	assert.notEqual(compactStart, -1);
	assert.notEqual(compactEnd, -1);
	const compactSource = layoutSource.slice(compactStart, compactEnd);
	assert.match(compactSource, /\.challenge-shell-nav nav \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: nowrap;[\s\S]*?width: 100%;/u);
	assert.match(compactSource, /\.challenge-shell-nav \.challenge-nav-control \{[\s\S]*?flex: 1 1 0;/u);
	assert.doesNotMatch(compactSource, /\.tools-trigger small \{[\s\S]*?display: none;/u);
	assert.doesNotMatch(compactSource, /pending-approval-link[^}]*grid-column:\s*1\s*\/\s*-1/u);
	assert.match(layoutSource, /@media \(max-width: 900px\) and \(min-width: 701px\)[\s\S]*?\.challenge-shell-nav \.challenge-nav-control \{[^}]*min-height: var\(--worn-target-min\);/u);
	assert.match(layoutSource, /\.demo-recovery-error \{ color: var\(--worn-danger-text\);/u);
	assert.doesNotMatch(layoutSource, /var\(--worn-danger\)/u);
});

test('Guide derives bounded scope choices from stable fields and the supplied Work search counter', () => {
	const queries = [];
	const visible = [
		{ id: 'a', area: 'Research' },
		{ id: 'b', area: 'Household' },
		{ id: 'c', area: 'research' },
		{ id: 'd' }
	];
	const catalog = deriveGuideWorkScopeCatalog(5, visible, (query) => {
		queries.push(query);
		return query === 'Household' ? 1 : 2;
	});
	assert.deepEqual(queries, ['Household', 'Research']);
	assert.deepEqual(catalog, {
		workspaceCount: 5,
		visibleCount: 4,
		discoveredChoiceCount: 2,
		shownChoiceCount: 2,
		omittedChoiceCount: 0,
		choices: [
			{ id: 'area-1', kind: 'derived', label: 'Household', query: 'Household', matchingCount: 1 },
			{ id: 'area-2', kind: 'derived', label: 'Research', query: 'Research', matchingCount: 2 }
		]
	});
	const many = Array.from({ length: 30 }, (_, index) => ({ area: `Area ${String(index).padStart(2, '0')}` }));
	const bounded = deriveGuideWorkScopeCatalog(30, many, () => 1);
	assert.equal(bounded.discoveredChoiceCount, 30);
	assert.equal(bounded.shownChoiceCount, 24);
	assert.equal(bounded.omittedChoiceCount, 6);
	assert.equal(bounded.choices.length, 24);
	assert.throws(() => deriveGuideWorkScopeCatalog(3, visible, () => 1), /denominators/u);
	assert.throws(() => deriveGuideWorkScopeCatalog(4, visible, () => 5), /count/u);
});

test('Projects handoff guide accepts default, derived, and honest zero-match Custom scopes', () => {
	const all = guideFixture();
	assert.deepEqual(webMcpChallengeGuideView(all), all);
	const derived = selectedGuide({ id: 'area-2', kind: 'derived', label: 'Research', query: 'Research', matchingCount: 4 });
	assert.deepEqual(webMcpChallengeGuideView(derived), derived);
	const noMatch = selectedGuide({ id: 'custom', kind: 'custom', label: 'Custom', query: 'Definitely absent', matchingCount: 0 });
	assert.deepEqual(webMcpChallengeGuideView(noMatch), noMatch);
	const normalized = selectedGuide({ id: 'custom', kind: 'custom', label: 'Custom', query: '  another term  ', matchingCount: 0 });
	assert.equal(webMcpChallengeGuideView(normalized)?.workQuery, 'another term');
	assert.equal(webMcpChallengeGuideView(normalized)?.workScope.selected.query, 'another term');
	const emptyCustom = selectedGuide({ id: 'custom', kind: 'custom', label: 'Custom', query: '', matchingCount: 8 });
	assert.deepEqual(webMcpChallengeGuideView(emptyCustom), emptyCustom);
});

test('Guide actions, Guide projection, route arrival, and Work search share exact query and count outcomes', async () => {
	const workspaceCount = samplePacks.filter((pack) => !pack.archived).length;
	const researchQuery = routeWorkSearch(' Research ');
	const researchCount = samplePacks.filter((pack) => !pack.archived && pack.area === researchQuery).length;
	assert.equal(workspaceCount, 8);
	assert.equal(researchCount, 4);

	assert.deepEqual(guideWorkAction({ kind: 'all', label: 'All visible work', query: '', matchingCount: workspaceCount }), {
		disabled: false, href: '/work', label: 'Open all 8 work items'
	});
	assert.deepEqual(guideWorkAction({ kind: 'derived', label: 'Research', query: researchQuery, matchingCount: researchCount }), {
		disabled: false, href: '/work?search=Research', label: 'Open 4 Research items'
	});
	assert.deepEqual(guideWorkAction({ kind: 'custom', label: 'Custom', query: 'absent', matchingCount: 0 }), {
		disabled: true, href: null, label: 'No work matches'
	});
	assert.equal(guideWorkAction({ kind: 'custom', label: 'Custom', query: 'research & review', matchingCount: 1 }).href, '/work?search=research+%26+review');

	const guide = webMcpChallengeGuideView(selectedGuide({
		id: 'area-2', kind: 'derived', label: 'Research', query: researchQuery, matchingCount: researchCount
	}));
	assert.equal(guide?.workQuery, researchQuery);
	assert.deepEqual(guide?.workScope.selected, {
		id: 'area-2', kind: 'derived', label: 'Research', query: researchQuery, matchingCount: researchCount
	});
	assert.equal(samplePacks.filter((pack) => !pack.archived && pack.area === routeWorkSearch('absent')).length, 0);
	assert.match(guideActionSource, /new URLSearchParams\(\{ search: query \}\)/u);
	assert.match(pageSource, /guideVisiblePacks = \$derived\(filterPacks\(guidePacks, 'all', ''\)\)/u);
	assert.match(pageSource, /selectedMatchingCount = \$derived\(filterPacks\(guidePacks, 'all', workQuery\)\.length\)/u);
	assert.match(workRouteSource, /filterPacks\(scopedPacks,filter,debouncedQuery,energyFilter,areaFilter,recurrenceFilter,ownerFilter,hideDone\)/u);
	assert.match(editorSource, /guideWorkAction\(\{[\s\S]*?kind: selectedScopeKind,[\s\S]*?query: workQuery,[\s\S]*?matchingCount: selectedMatchingCount/u);
	assert.match(editorSource, /data-agent-scope-action-link[\s\S]*?href=\{selectedScopeAction\.href\}/u);
	assert.match(editorSource, /data-agent-scope-action-disabled[\s\S]*?disabled/u);
	assert.doesNotMatch(editorSource, /matching of \{scopeCatalog\.workspaceCount\} workspace/u);
});

test('Projects handoff guide rejects malformed, duplicate, negative, and mismatched scope projections', () => {
	const fixture = guideFixture();
	assert.equal(webMcpChallengeGuideView({ ...fixture, workScope: undefined }), null);
	assert.equal(webMcpChallengeGuideView({ ...fixture, steps: fixture.steps.slice(0, 2) }), null);
	assert.equal(webMcpChallengeGuideView({ ...fixture, safety: ['Only one'] }), null);
	assert.equal(webMcpChallengeGuideView({ ...fixture, agentBrief: 'x'.repeat(1001) }), null);
	assert.equal(webMcpChallengeGuideView({ ...fixture, agentBrief: 'Unsafe\u0007control' }), null);
	const duplicate = structuredClone(fixture);
	duplicate.workScope.choices[2].id = 'area-1';
	assert.equal(webMcpChallengeGuideView(duplicate), null);
	const duplicateQuery = structuredClone(fixture);
	duplicateQuery.workScope.choices[2].query = 'HOUSEHOLD';
	assert.equal(webMcpChallengeGuideView(duplicateQuery), null);
	const negative = structuredClone(fixture);
	negative.workScope.selected.matchingCount = -1;
	assert.equal(webMcpChallengeGuideView(negative), null);
	const denominator = structuredClone(fixture);
	denominator.workScope.visibleCount = 9;
	assert.equal(webMcpChallengeGuideView(denominator), null);
	const arithmetic = structuredClone(fixture);
	 arithmetic.workScope.omittedChoiceCount = 1;
	assert.equal(webMcpChallengeGuideView(arithmetic), null);
	const mismatchedCount = selectedGuide({ id: 'area-2', kind: 'derived', label: 'Research', query: 'Research', matchingCount: 3 });
	assert.equal(webMcpChallengeGuideView(mismatchedCount), null);
	const mismatchedQuery = selectedGuide({ id: 'area-2', kind: 'derived', label: 'Research', query: 'Household', matchingCount: 4 });
	assert.equal(webMcpChallengeGuideView(mismatchedQuery), null);
	const emptyCustomMismatch = selectedGuide({ id: 'custom', kind: 'custom', label: 'Custom', query: '', matchingCount: 0 });
	assert.equal(webMcpChallengeGuideView(emptyCustomMismatch), null);
	const tooLong = selectedGuide({ id: 'custom', kind: 'custom', label: 'Custom', query: 'x'.repeat(121), matchingCount: 0 });
	assert.equal(webMcpChallengeGuideView(tooLong), null);
	const control = selectedGuide({ id: 'custom', kind: 'custom', label: 'Custom', query: 'line\nbreak', matchingCount: 0 });
	assert.equal(webMcpChallengeGuideView(control), null);
});

test('Projects handoff guide descriptor is closed, read-only, live, clone-safe, and abort-aware', async () => {
	let guide = guideFixture();
	const tool = createWebMcpChallengeGuideTool(() => guide);
	assert.equal(tool.name, PROJECTS_HANDOFF_GUIDE_TOOL_NAME);
	assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
	assert.deepEqual(tool.annotations, {
		readOnlyHint: true,
		openWorldHint: false,
		untrustedContentHint: true
	});
	assert.deepEqual(await tool.execute({}), guide);
	guide = selectedGuide({ id: 'area-1', kind: 'derived', label: 'Household', query: 'Household', matchingCount: 4 });
	assert.deepEqual(await tool.execute({}), guide);
	guide = selectedGuide({ id: 'custom', kind: 'custom', label: 'Custom', query: 'No such work', matchingCount: 0 });
	const liveResult = await tool.execute({});
	assert.equal(liveResult.workQuery, 'No such work');
	assert.equal(liveResult.workScope.selected.matchingCount, 0);
	assert.deepEqual(structuredClone(liveResult), liveResult);
	await assert.rejects(tool.execute({ extra: true }), /empty object/u);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(tool.execute({}, { signal: controller.signal }), /abort/iu);
});

test('guide reader projects live DOM scope choices, selection, and denominators exactly', async () => {
	const fixture = guideFixture();
	const documentRef = renderedGuideDocument(fixture);
	const tool = createWebMcpChallengeGuideTool(() => readRenderedWebMcpChallengeGuide(documentRef));
	assert.deepEqual(await tool.execute({}), fixture);
	documentRef.briefInput.value = 'Edited live brief.';
	Object.assign(documentRef.scopeChooser.dataset, {
		selectedScopeId: 'area-2',
		selectedScopeKind: 'derived',
		selectedScopeLabel: 'Research',
		selectedWorkQuery: 'Research',
		selectedMatchCount: '4'
	});
	const changed = await tool.execute({});
	assert.equal(changed.agentBrief, 'Edited live brief.');
	assert.deepEqual(changed.workScope.selected, {
		id: 'area-2', kind: 'derived', label: 'Research', query: 'Research', matchingCount: 4
	});
	Object.assign(documentRef.scopeChooser.dataset, {
		selectedScopeId: 'custom',
		selectedScopeKind: 'custom',
		selectedScopeLabel: 'Custom',
		selectedWorkQuery: 'Definitely absent',
		selectedMatchCount: '0'
	});
	const noMatch = await tool.execute({});
	assert.equal(noMatch.workQuery, 'Definitely absent');
	assert.equal(noMatch.workScope.selected.matchingCount, 0);
	assert.match(pageSource, /<WornButton href=\{step\.href\} size="sm">\{step\.action\}<\/WornButton>/u);
	assert.doesNotMatch(pageSource, /Reader API unavailable|Guide reader status/u);
});

test('handoff route owns one data-backed reader without navigation, write, or model authority', () => {
	assert.match(pageConfig, /prerender\s*=\s*true/u);
	for (const route of ['/webmcp-challenge', '/work', '/review', '/next']) {
		assert.match(svelteConfig, new RegExp(`prerender:[\\s\\S]*?${route.replaceAll('/', '\\/')}`, 'u'));
	}
	assert.match(pageSource, /createWebMcpChallengeGuideTool\(\(\) => readRenderedWebMcpChallengeGuide\(document\)\)/u);
	assert.match(pageSource, /guidePacks = \$derived\(\(\$demoState\?\.packs \?\? \(__NEBIUS_EDITION__ \? nebiusSeedPacks : seedPacks\)\) as DemoPack\[\]\)/u);
	assert.match(pageSource, /guideVisiblePacks = \$derived\(filterPacks\(guidePacks, 'all', ''\)\)/u);
	assert.match(pageSource, /deriveGuideWorkScopeCatalog\([\s\S]*?\(query\) => filterPacks\(guidePacks, 'all', query\)\.length/u);
	assert.match(pageSource, /selectedMatchingCount = \$derived\(filterPacks\(guidePacks, 'all', workQuery\)\.length\)/u);
	assert.match(layoutSource, /shared workspace shell hydrates the one browser-local state owner[\s\S]*?refreshDemoState\(\{ reuseRecent: true \}\)/u);
	assert.match(pageSource, /<AgentBriefEditor scopeCatalog=\{guideScopeCatalog\} bind:selectedScopeId bind:workQuery \{selectedMatchingCount\} \/>/u);
	assert.match(pageSource, /Agent: change page-local scope, prepare an unsaved next action, or create up to three Draft items through the bounded Work tool\./u);
	assert.match(pageSource, /Person: control Start, final Save, blocking, completion, and deletion\./u);
	assert.doesNotMatch(pageSource, /approve, save, or discard every workspace change/u);
	assert.doesNotMatch(pageSource, /modelContext|registerTool/u);
	assert.match(webMcpRegistrationSource, /typeof modelContext\?\.registerTool !== 'function'[\s\S]*?status: 'unavailable'/u);
	assert.doesNotMatch(pageSource, /fetch\(|apiFetch|localStorage|sessionStorage|\.click\(|goto\(/u);
	assert.doesNotMatch(editorSource, /fetch\(|apiFetch|localStorage|sessionStorage|modelContext|goto\(/u);
	assert.doesNotMatch(`${pageSource}\n${editorSource}`, /Garage reset|Garden study|Household|Research/u);
	assert.match(appDocument, /Projects handoff workflow/u);
	assert.match(appDocument, /human-controlled saves/u);
	assert.match(webManifest, /read visible work, narrow review, and prepare a draft/u);
	assert.match(baselineReadme, /^Live submission: <https:\/\/projects-webmcp-extension\.pages\.dev\/webmcp-challenge>$/mu);
	assert.match(reviewerTests, /Public judge URL \(no account required\)/u);
	assert.match(editorSource, /data-agent-scope-chooser/u);
	assert.match(editorSource, /data-agent-scope-choice/u);
	assert.match(editorSource, /data-workspace-count=\{scopeCatalog\.workspaceCount\}/u);
	assert.match(editorSource, /data-selected-work-query=\{workQuery\}/u);
	assert.match(editorSource, /WornChip label=\{`All visible work · \$\{scopeCatalog\.visibleCount\}`\}[\s\S]*?pressed=\{selectedScopeId === 'all'\}/u);
	assert.match(editorSource, /WornChip label="Custom…"[\s\S]*?pressed=\{selectedScopeId === 'custom'\}/u);
	assert.match(editorSource, /\{#if selectedScopeId === 'custom'\}[\s\S]*?data-agent-work-query-input[\s\S]*?maxlength="120"/u);
	assert.match(editorSource, /an unmatched term stays at zero/u);
	assert.match(editorSource, /aria-live="polite" data-agent-scope-action/u);
	assert.match(editorSource, /Local draft · not saved · workspace unchanged/u);
	assert.match(editorSource, /@media \(max-width: 520px\)/u);
});

test('the live sample can be explicitly reset through the single browser-state owner', () => {
	assert.match(pageSource, /Reset live sample/u);
	assert.match(pageSource, /onclick=\{\(\) => \(resetConfirmOpen = true\)\}/u);
	assert.match(pageSource, /Explicitly restores this browser’s bundled sample and clears its prior local results\./u);
	assert.match(pageSource, /<WornDialog bind:open=\{resetConfirmOpen\} title=\{__NEBIUS_EDITION__ \? 'Confirm sample reset' : 'Confirm live sample reset'\}[\s\S]*?Export a backup first[\s\S]*?Confirm reset/u);
	assert.match(pageSource, /\{#if exportHref\}[\s\S]*?Download backup[\s\S]*?\{:else\}[\s\S]*?Prepare export first/u);
	assert.match(pageSource, /Confirm reset<\/WornButton>[\s\S]*?<\/WornDialog>/u);
	assert.match(pageSource, /onclick=\{\(\) => \{ resetConfirmOpen = false; void resetLiveSample\(\); \}\}/u);
	assert.match(pageSource, /import \{ ChallengeStateError, demoState, displayToast, exportWorkspaceState, importWorkspaceState, previewWorkspaceImport, resetDemoSampleState, type WorkspaceImportPreview \} from '\$lib\/demo-client';/u);
	assert.match(demoClientSource, /export async function resetDemoSampleState\(\): Promise<DemoState \| null> \{[\s\S]*?if \(!browser\) return null;[\s\S]*?stateRevision \+= 1;[\s\S]*?withStateStorageLock\(\(\) => resetPersistedState\([\s\S]*?remove: \(\) => localStorage\.removeItem\(STORAGE_KEY\),[\s\S]*?loadSeed: loadSeedState,[\s\S]*?install: \(state\) => replaceDemoState\(state, null\)/u);
	assert.match(pageSource, /\.challenge-import-label:focus-within \{ outline: 2px dashed var\(--worn-focus\); outline-offset: 2px; \}/u);
	assert.doesNotMatch(pageSource, /var\(--worn-danger\)/u);
	assert.doesNotMatch(editorSource, /var\(--worn-text-primary\)/u);
	assert.doesNotMatch(pageSource, /localStorage|sessionStorage|fetch\(/u);
});

test('Challenge demo-state writes use a versioned envelope and explicit cross-tab revision', () => {
	assert.doesNotMatch(demoClientSource, /stableStateFingerprint|JSON\.stringify\(state\) !== JSON\.stringify\(current\)/u);
	assert.match(demoClientSource, /let storageRevision: string \| null = null;/u);
	assert.match(demoClientSource, /readStateEnvelope\(serialized,[\s\S]*?migrateLegacyState,[\s\S]*?createRevision: createStorageRevision/u);
	assert.match(demoClientSource, /result\.migrated[\s\S]*?localStorage\.getItem\(STORAGE_KEY\) !== serialized[\s\S]*?localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(result\.envelope\)\)/u);
	assert.match(demoClientSource, /function readStoredState\(\): Promise<DemoStateSnapshot \| null> \{[\s\S]*?withStateStorageLock\(readStoredStateUnlocked\)/u);
	assert.match(demoClientSource, /nextStateEnvelope\(\{[\s\S]*?expectedRevision,[\s\S]*?state,[\s\S]*?localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(envelope\)\)/u);
	assert.match(demoClientSource, /function withStateStorageLock<T>\([\s\S]*?withExclusiveStateStorageLock\(globalThis\.navigator\.locks, STORAGE_LOCK_NAME, operation\)/u);
	assert.match(demoClientSource, /export async function saveBrowserState\([\s\S]*?mutate\(next\);[\s\S]*?const expectedRevision = storageRevision;[\s\S]*?withStateStorageLock\(\(\) => persistState\(next, expectedRevision\)\)[\s\S]*?replaceDemoState\(written\.state, written\.revision\)/u);
});

test('wide Guide layout keeps the existing steps in the left rail beside the editor without a dead quadrant', () => {
	const railStart = pageSource.indexOf('<div class="challenge-guide-rail">');
	const introStart = pageSource.indexOf('<div class="challenge-intro">');
	const stepsStart = pageSource.indexOf('<ol class="challenge-steps"');
	const editorStart = pageSource.indexOf('<AgentBriefEditor');
	assert.ok(railStart >= 0 && railStart < introStart && introStart < stepsStart && stepsStart < editorStart);
	assert.match(pageSource, /\.challenge-hero \{[\s\S]*?align-items: start;[\s\S]*?grid-template-columns: minmax\(0, 0\.82fr\) minmax\(360px, 1\.18fr\);/u);
	assert.match(pageSource, /\.challenge-guide-rail \{[\s\S]*?display: grid;[\s\S]*?gap: 24px;[\s\S]*?min-width: 0;/u);
	assert.match(pageSource, /\.challenge-steps \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/u);
	const layoutCss = pageSource.match(/\.challenge-hero \{[\s\S]*?@media \(max-width: 860px\)/u)?.[0] ?? '';
	assert.doesNotMatch(layoutCss, /min-height|overflow:\s*(?:hidden|clip)/u);
	assert.match(pageSource, /@media \(max-width: 860px\) \{[\s\S]*?\.challenge-hero\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/u);
	assert.match(pageSource, /<WornButton href=\{step\.href\} size="sm">\{step\.action\}<\/WornButton>/u);
	assert.match(pageSource, /import \{ WornAccordion, WornBadge, WornButton, WornDialog, WornPage, WornReceipt \} from '\$lib\/components';/u);
	assert.match(pageSource, /<div class="challenge-role-split" aria-label="Authority handoff">[\s\S]*?<WornBadge variant="accent" size="sm" label="Agent · inspect \+ prepare" \/>[\s\S]*?<span class="challenge-role-arrow" aria-hidden="true">→<\/span>[\s\S]*?<WornBadge size="sm" label="You · decide \+ save" \/>/u);
	assert.match(pageSource, /\.challenge-role-split \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;[\s\S]*?gap: 8px;/u);
	assert.match(pageSource, /\.challenge-number \{[\s\S]*?background: var\(--worn-accent\);[\s\S]*?border: 1px solid var\(--worn-accent\);[\s\S]*?color: var\(--worn-accent-text\);/u);
	for (const route of ['/work', '/review', '/next']) {
		assert.match(pageSource, new RegExp(`href: '${route}'`, 'u'), `${route} remains one of the usable Guide steps`);
	}
});

test('editable Guide brief preserves its safe default, explicit fast-create preset, composite copy, and manual-copy focus', () => {
	assert.match(editorSource, /DEFAULT_AGENT_BRIEF = '[^']*Do not save or change workspace data\.';/u);
	assert.match(editorSource, /FAST_CREATE_AGENT_BRIEF = '[^']*return to Work, read the latest workspace count, and create exactly three distinct browser-local Draft work items[^']*Do not save, start, block, complete, or delete work\. Stop on the visible create_work_drafts receipt\.';/u);
	assert.match(editorSource, /async function useFastCreateBrief\(\) \{[\s\S]*?brief = FAST_CREATE_AGENT_BRIEF;[\s\S]*?Fast-create brief loaded · local draft not saved · workspace unchanged[\s\S]*?await tick\(\);[\s\S]*?briefInput\?\.focus\(\);[\s\S]*?briefInput\?\.select\(\);/u);
	assert.match(editorSource, /<WornButton data-agent-brief-fast-create[\s\S]*?onclick=\{useFastCreateBrief\}>Use fast-create brief<\/WornButton>/u);
	assert.match(editorSource, /@media \(max-width: 520px\)[\s\S]*?\.agent-brief-actions :global\(\.worn-btn\) \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 44px;/u);
	assert.match(editorSource, /const scopedQuery = workQuery\.trim\(\);/u);
	assert.match(editorSource, /scopedQuery\s*\? `Brief for the browser agent:\\n\$\{brief\}\\n\\nWork to focus on:\\n\$\{scopedQuery\}`\s*:\s*brief/u);
	assert.match(editorSource, /navigator\.clipboard\.writeText\(copyText\)/u);
	assert.match(editorSource, /selectedScopeId = 'all';\s*workQuery = '';/u);
	assert.match(editorSource, /brief = DEFAULT_AGENT_BRIEF;/u);
	assert.match(editorSource, /briefInput\?\.focus\(\);[\s\S]*?briefInput\?\.select\(\);/u);
	assert.doesNotMatch(editorSource, /fetch\(|localStorage|sessionStorage|modelContext|goto\(/u);
});
