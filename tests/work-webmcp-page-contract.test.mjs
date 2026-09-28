import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	WORK_CURRENT_TOOL_NAME,
	WORK_DRAFT_MAX_ITEMS,
	WORK_DRAFT_TOOL_NAME,
	WORK_SEARCH_TOOL_NAME,
	createCurrentWorkTool,
	createWorkDraftsTool,
	createShowWorkSearchTool,
	normalizeWorkSearch,
	routeWorkSearch,
	visibleDecisionDecider,
	workDraftInput,
	workItemPageView,
	workPageView,
	workSearchPresentationReceipt
} from '../svelte-frontend/src/routes/work/work-webmcp.mjs';
import { registerPageTools } from '../svelte-frontend/src/lib/webmcp.mjs';
import { decisionWorkspaceReviewFocusRequest, decisionWorkspaceReviewHref, decisionWorkspaceWorkFocusRequest, pendingDecisionWorkHref } from '../svelte-frontend/src/lib/decision-workspace-navigation.mjs';
import { summarizeWorkMetadata } from '../svelte-frontend/src/lib/work-metadata.mjs';
import { commandActionForLabel, filterPacks, orderPacks, primaryCommand, primaryCommandNavigation } from '../svelte-frontend/src/lib/demo-workflow.ts';
import { planBatchAction, removePacksAndReferences, repairActiveSelection } from '../svelte-frontend/src/lib/batch-actions.mjs';
import { recentPackActivity } from '../svelte-frontend/src/lib/activity.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/+page.svelte'), 'utf8');
const workDeleteDialogSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/WorkDeleteConfirmDialog.svelte'), 'utf8');
const workFilterControlsSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkFilterControls.svelte'), 'utf8');
const workDecisionWorkspaceSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkDecisionWorkspace.svelte'), 'utf8');
const workQuickAddSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkQuickAdd.svelte'), 'utf8');
const workRecentActivitySource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkRecentActivity.svelte'), 'utf8');
const workShortcutHelpSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkShortcutHelp.svelte'), 'utf8');
const workBatchActionsSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkBatchActions.svelte'), 'utf8');
const demoClientSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-client.ts'), 'utf8');
const workGridCardSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/components/WorkGridCard.svelte'), 'utf8');
const demoCssSource = fs.readFileSync(path.join(repoRoot, 'assets/demo.css'), 'utf8');
const workListCardSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/components/WorkListCard.svelte'), 'utf8');
const reviewRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/+page.svelte'), 'utf8');
const workMetadataSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/work-metadata.mjs'), 'utf8');
const helperSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/work-webmcp.mjs'), 'utf8');
const registrationSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/webmcp.mjs'), 'utf8');
const activityStripSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/WebMcpActivityStrip.svelte'), 'utf8');
const activitySource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/activity.ts'), 'utf8');
const workflowSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-workflow.ts'), 'utf8');
const decisionNavigationSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/decision-workspace-navigation.mjs'), 'utf8');
const workInteractionSmokeSource = fs.readFileSync(path.join(repoRoot, 'scripts/work-interaction-polish-smoke.mjs'), 'utf8');

function workView({ search = '', items = null, workspace = 4, matching = 3, blocked = 1, recommendation = null } = {}) {
	const projectedItems = items ?? [
		{ id: 'alpha / one', title: 'Alpha', workflow: 'Active', owner: 'Avery', due: null, blocker: null, purpose: 'not exposed' },
		{ id: 'beta', title: 'Beta', workflow: 'Blocked', owner: 'Blake', due: 'Aug 25', blocker: 'Waiting for proof', memory: ['not exposed'] }
	];
	return workPageView({
		scope: {
			search,
			appliedSearch: search,
			status: 'all',
			energy: 'all',
			area: 'all',
			recurrence: 'all',
			owner: 'all',
			dueUrgency: 'all',
			sort: 'urgency',
			hideDone: false,
			focusMode: false,
			density: 'grid',
			notExposed: true
		},
		counts: { workspace, matching, shown: projectedItems.length, remaining: matching - projectedItems.length, blocked },
		recommendation,
		items: projectedItems,
		rawPacks: [{ secret: 'not exposed' }]
	});
}

test('Work batch deletion uses one canonical singular-or-plural item noun', () => {
	assert.match(workDeleteDialogSource, /let batchItemNoun = \$derived\(selectedCount === 1 \? 'work item' : 'work items'\);/u);
	assert.match(workDeleteDialogSource, /`Delete \$\{selectedCount\.toLocaleString\(\)\} \$\{batchItemNoun\}\?`/u);
	assert.match(workDeleteDialogSource, /`Delete \$\{selectedCount\.toLocaleString\(\)\} \$\{batchItemNoun\}`/u);
	assert.match(workDeleteDialogSource, /<strong>\{selectedCount\.toLocaleString\(\)\}<\/strong> selected \{batchItemNoun\} will be permanently deleted\./u);
	assert.doesNotMatch(workDeleteDialogSource, /work item\{selectedCount === 1 \? '' : 's'\}/u);
});

test('Work overdue scope and due labels exclude terminal work', () => {
	const packs = [
		{ id: 'open-overdue', status: 'blocked', due: 'past', archived: false },
		{ id: 'done-past', status: 'done', due: 'past', archived: false },
		{ id: 'archived-past', status: 'active', due: 'past', archived: true }
	];
	const metadata = summarizeWorkMetadata(packs, {
		isMissingOwnerValue: () => false,
		dueUrgency: (pack) => pack.status === 'done' || pack.archived ? '' : pack.due === 'past' ? 'overdue' : ''
	});
	assert.equal(metadata.countByDueUrgency.overdue, 1);
	assert.match(workflowSource, /export function dueUrgency\(pack: DemoPack\)[\s\S]*?if \(pack\.status === 'done' \|\| pack\.archived\) return '';/u);
	assert.match(workflowSource, /export function dueDateLabel\(pack: DemoPack\)[\s\S]*?normalizeText\(pack\.due, 40\)/u);
	assert.match(workMetadataSource, /const urgency = dueUrgency\(pack\);/u);
	assert.match(routeSource, /dueUrgency\(p\)\s*===\s*dueUrgencyFilter/u);
	for (const source of [routeSource, workGridCardSource, workListCardSource, reviewRouteSource]) {
		assert.doesNotMatch(source, /dueUrgency\([^)]*\.due\)|dueDateLabel\([^)]*\.due\)/u);
	}
});

test('archived work appears only in the archived status view', () => {
	const packs = [
		{ id: 'active', status: 'active', archived: false },
		{ id: 'archived-active', status: 'active', archived: true }
	];
	assert.deepEqual(filterPacks(packs, 'active', '').map((pack) => pack.id), ['active']);
	assert.deepEqual(filterPacks(packs, 'all', '').map((pack) => pack.id), ['active']);
	assert.deepEqual(filterPacks(packs, 'archived', '').map((pack) => pack.id), ['archived-active']);
	assert.match(routeSource, /let recentPacks = \$derived\([\s\S]*?Boolean\(pack && canSetNextAction\(pack\)\)/u);
	assert.match(routeSource, /if \(!pack\.archived\) next\[pack\.status \|\| ''\]/u);
});

test('Manual sort owns a stable persisted order and keyboard controls', () => {
	const packs = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];
	assert.deepEqual(orderPacks(packs, 'manual', ['c', 'a', 'b']).map((pack) => pack.id), ['c', 'a', 'b']);
	assert.match(workflowSource, /orderPacks\(packs: DemoPack\[\], sortBy = 'urgency', manualOrder: string\[\] = \[\]\)/u);
	assert.match(routeSource, /sortBy === 'manual' && e\.altKey[\s\S]*?moveFocusedManual/u);
	const cardKeys = routeSource.slice(routeSource.indexOf('function handleCardKeys'), routeSource.indexOf('\n\t// "/" focuses the filter'));
	assert.ok(cardKeys.indexOf("sortBy === 'manual' && e.altKey") < cardKeys.indexOf("if (e.key === 'ArrowDown')"), 'Alt+Arrow manual ordering wins before ordinary roving focus');
	assert.match(routeSource, /Manual ordering controls[\s\S]*?Move focused up[\s\S]*?Move focused down[\s\S]*?aria-live="polite"/u);
	assert.match(routeSource, /Card to reorder[\s\S]*?manualTargetId[\s\S]*?moveFocusedManual/u);
	assert.match(workFilterControlsSource, /value: 'manual', label: 'Manual'/u);
	assert.match(workInteractionSmokeSource, /#sort-work[\s\S]*?selectOption\('manual'\)[\s\S]*?Move focused down[\s\S]*?manualOrder/u);
});

test('Work focus mode implements and documents its advertised F shortcut', () => {
	const windowKeys = routeSource.slice(
		routeSource.indexOf('function handleWindowKeys'),
		routeSource.indexOf('\n\tfunction handleCardClick')
	);
	assert.match(routeSource, /title=\{focusMode \? 'Exit Focus \(F\)' : scopedSelectedId \? 'Focus on selected work \(F\)' : 'Select a work item to use Focus'\}/u);
	assert.match(routeSource, /displayToast\('Focus on\. Press F to exit\.', 'info'\)/u);
	assert.match(
		windowKeys,
		/const editing = tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT' \|\| Boolean\(\(e\.target as HTMLElement\)\?\.isContentEditable\);[\s\S]*?if \(shortcutHelpOpen \|\| editing\) return;[\s\S]*?if \(\(e\.key === 'f' \|\| e\.key === 'F'\) && !e\.ctrlKey && !e\.metaKey && !e\.altKey && !e\.repeat\) \{\s*e\.preventDefault\(\);\s*toggleFocusMode\(\);\s*return;\s*\}/u
	);
	assert.equal(windowKeys.match(/e\.key === 'f'/gu)?.length, 1);
	assert.doesNotMatch(windowKeys, /e\.key === '\?'/u);
	assert.match(routeSource, /import WorkShortcutHelp from '\.\/WorkShortcutHelp\.svelte';[\s\S]*?let shortcutHelpOpen = \$state\(false\);[\s\S]*?<WorkShortcutHelp bind:open=\{shortcutHelpOpen\} \/>/u);
	assert.doesNotMatch(routeSource, /showShortcutHelp|Keyboard shortcuts \(\?\)|shortcut-grid|shortcut-actions|data-action="work-shortcuts"/u);
	assert.match(workShortcutHelpSource, /let \{ open = \$bindable\(false\) \}[\s\S]*?event\.key !== '\?'[\s\S]*?!open && \(tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT' \|\| target\?\.isContentEditable\)[\s\S]*?open = !open;/u);
	assert.match(workShortcutHelpSource, /<svelte:window onkeydown=\{handleShortcutKey\} \/>[\s\S]*?data-action="work-shortcuts"[\s\S]*?<WornDialog bind:open title="Keyboard shortcuts" size="sm">/u);
	assert.match(workShortcutHelpSource, /<WornKbd keys=\{\['F'\]\} \/><\/dt><dd>Toggle focus mode<\/dd>/u);
	assert.match(workShortcutHelpSource, /<WornKbd keys=\{\['C \/ N'\]\} \/><\/dt><dd>Focus quick-add when available<\/dd>[\s\S]*?<WornKbd keys=\{\['\?'\]\} \/><\/dt><dd>Toggle help<\/dd>/u);
	assert.match(workShortcutHelpSource, /\.shortcut-actions :global\(\.worn-btn\)\{min-height:44px\}/u);
	assert.doesNotMatch(workShortcutHelpSource, /fetch\(|localStorage|sessionStorage|saveBrowserState|createPack|runPackAction/u);
});

test('Work O shortcut names its exact Next editor destination', () => {
	const cardKeys = routeSource.slice(
		routeSource.indexOf('function handleCardKeys'),
		routeSource.indexOf('\n\t// "/" focuses the filter')
	);
	const selectionOwner = routeSource.slice(
		routeSource.indexOf('function selectPack'),
		routeSource.indexOf('\n\t// Pin and reaction controls')
	);
	assert.match(cardKeys, /if \(\(e\.key === 'o' \|\| e\.key === 'O'\)[\s\S]*?selectPack\(pack\);/u);
	assert.match(cardKeys, /const cards = document\.querySelectorAll\('\[data-work-item\]\[data-pack-id\]'\);/u);
	assert.doesNotMatch(`${routeSource}\n${demoCssSource}`, /demo-landing-card/u);
	assert.match(selectionOwner, /goto\(`\/next\?pack=\$\{encodeURIComponent\(pack\.id\)\}`\);/u);
	assert.match(workShortcutHelpSource, /<WornKbd keys=\{\['O'\]\} \/><\/dt><dd>Open next-action editor<\/dd>/u);
	assert.doesNotMatch(workShortcutHelpSource, /<WornKbd keys=\{\['O'\]\} \/><\/dt><dd>Open details<\/dd>/u);
});

test('Work projects only its live scope, explicit denominators, and bounded rendered items', () => {
	const view = workView();
	assert.deepEqual(view, {
		scope: {
			search: '', appliedSearch: '', status: 'all', energy: 'all', area: 'all', recurrence: 'all', owner: 'all',
			dueUrgency: 'all', sort: 'urgency', hideDone: false, focusMode: false, density: 'grid'
		},
		counts: { workspace: 4, matching: 3, shown: 2, remaining: 1, blocked: 1 },
		recommendation: null,
		items: [
			{ id: 'alpha / one', title: 'Alpha', href: '/next?pack=alpha%20%2F%20one', workflow: 'Active', owner: 'Avery', due: null, blocker: null },
			{ id: 'beta', title: 'Beta', href: '/next?pack=beta', workflow: 'Blocked', owner: 'Blake', due: 'Aug 25', blocker: 'Waiting for proof' }
		]
	});
	assert.deepEqual(Object.keys(view).sort(), ['counts', 'items', 'recommendation', 'scope']);
	assert.doesNotMatch(JSON.stringify(view), /not exposed|secret/u);
	assert.match(routeSource, /items: renderedVisible\.map\(\(pack\) => workItemPageView\(\{[\s\S]*?\.\.\.evidenceFacts\(pack\)[\s\S]*?owner: density === 'grid'/u);
	assert.doesNotMatch(routeSource, /workflow: density === 'grid'/u);
	const pendingSearch = workPageView({ ...view, scope: { ...view.scope, search: 'nee', appliedSearch: '' } });
	assert.equal(pendingSearch.scope.search, 'nee');
	assert.equal(pendingSearch.scope.appliedSearch, '');
	assert.deepEqual(pendingSearch.counts, view.counts);
	assert.deepEqual(workItemPageView({ id: 'encoded / id', title: ' Item ', workflow: ' Active ', owner: null, due: null, blocker: null }), {
		id: 'encoded / id', title: 'Item', href: '/next?pack=encoded%20%2F%20id', workflow: 'Active', owner: null, due: null, blocker: null
	});
	assert.deepEqual(workItemPageView({ id: ' exact id ', title: 'Exact ID', workflow: 'Active', owner: null, due: null, blocker: null }), {
		id: ' exact id ', title: 'Exact ID', href: '/next?pack=%20exact%20id%20', workflow: 'Active', owner: null, due: null, blocker: null
	});

	for (const malformed of [
		null,
		{},
		{ scope: {}, counts: {}, items: [] },
		{ ...view, scope: { ...view.scope, status: 'unknown' } },
		{ ...view, scope: { ...view.scope, density: 'table' } },
		{ ...view, counts: { ...view.counts, workspace: 2 } },
		{ ...view, counts: { ...view.counts, matching: 4 } },
		{ ...view, counts: { ...view.counts, blocked: 4 } },
		{ ...view, recommendation: {} },
		{ ...view, items: [view.items[0], view.items[0]], counts: { ...view.counts, shown: 2 } },
		{ ...view, items: [{ id: '', title: 'Missing ID', workflow: 'Active', owner: null, due: null, blocker: null }], counts: { ...view.counts, shown: 1, remaining: 2 } }
	]) {
		assert.equal(workPageView(malformed), null);
	}
});

test('Work projects only the rendered decision recommendation and rejects impossible signal counts', () => {
	const recommendation = {
		id: 'bike rack / choice',
		title: 'Choose bike rack',
		reason: 'First open decision in this filtered and sorted view.',
		decider: 'Household',
		decisionCount: 1,
		blockedCount: 1,
		overdueCount: 1,
		sourceCount: 2,
		memory: ['not exposed']
	};
	const view = workView({ recommendation });
	assert.deepEqual(view?.recommendation, {
		id: 'bike rack / choice',
		title: 'Choose bike rack',
		href: '/next?pack=bike%20rack%20%2F%20choice&context=decision-workspace',
		reviewHref: '/review?focus=bike%20rack%20%2F%20choice',
		reason: 'First open decision in this filtered and sorted view.',
		decider: 'Household',
		decisionCount: 1,
		blockedCount: 1,
		overdueCount: 1,
		sourceCount: 2
	});
	assert.doesNotMatch(JSON.stringify(view), /not exposed/u);
	const outsideRecommendation = workView({
		recommendation: {
			...recommendation,
			decisionCount: 2,
			blockedCount: 2,
			overdueCount: 2,
			outsideCurrentView: true
		}
	});
	assert.equal(outsideRecommendation?.recommendation?.outsideCurrentView, true);
	assert.equal(workPageView({
		...outsideRecommendation,
		recommendation: { ...outsideRecommendation.recommendation, blockedCount: 3 }
	}), null);
	const exactIdRecommendation = workView({ recommendation: { ...recommendation, id: ' bike rack / choice ' } });
	assert.equal(exactIdRecommendation?.recommendation?.id, ' bike rack / choice ');
	assert.equal(exactIdRecommendation?.recommendation?.href, '/next?pack=%20bike%20rack%20%2F%20choice%20&context=decision-workspace');
	assert.equal(exactIdRecommendation?.recommendation?.reviewHref, '/review?focus=%20bike%20rack%20%2F%20choice%20');
	for (const invalidRecommendation of [
		{ ...recommendation, decisionCount: 0 },
		{ ...recommendation, decisionCount: 4 },
		{ ...recommendation, blockedCount: 0 },
		{ ...recommendation, blockedCount: 4 },
		{ ...recommendation, overdueCount: 4 }
	]) {
		assert.equal(workPageView({ ...view, recommendation: invalidRecommendation }), null);
	}
});

test('Decision Workspace uses one exact encoded Review destination for visible and reader handoffs', () => {
	const exactId = '  review / exact id  ';
	const longExactId = ` ${'r'.repeat(201)} / exact `;
	assert.equal(decisionWorkspaceReviewHref(exactId), '/review?focus=%20%20review%20%2F%20exact%20id%20%20');
	assert.equal(decisionWorkspaceReviewHref(longExactId), `/review?focus=${encodeURIComponent(longExactId)}`);
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams(decisionWorkspaceReviewHref(exactId).split('?')[1])), { present: true, workId: exactId });
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams(decisionWorkspaceReviewHref(longExactId).split('?')[1])), { present: true, workId: longExactId });
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams('focus=one&focus=two')), { present: true, workId: '' });
	assert.deepEqual(decisionWorkspaceReviewFocusRequest(new URLSearchParams('focus=')), { present: true, workId: '' });
	assert.throws(() => decisionWorkspaceReviewHref(''), /exact work item id/u);

	const pendingId = 'pending / exact id';
	const workHref = pendingDecisionWorkHref(pendingId);
	assert.equal(workHref, '/work?focus=pending%20%2F%20exact%20id&context=pending-decision');
	assert.deepEqual(decisionWorkspaceWorkFocusRequest(new URLSearchParams(workHref.split('?')[1])), { present: true, workId: pendingId });
	assert.deepEqual(decisionWorkspaceWorkFocusRequest(new URLSearchParams('focus=generic-card')), { present: false, workId: '' });
	assert.deepEqual(decisionWorkspaceWorkFocusRequest(new URLSearchParams('focus=one&focus=two&context=pending-decision')), { present: true, workId: '' });
	assert.deepEqual(decisionWorkspaceWorkFocusRequest(new URLSearchParams('focus=&context=pending-decision')), { present: true, workId: '' });
	assert.deepEqual(decisionWorkspaceWorkFocusRequest(new URLSearchParams(`focus=${'x'.repeat(201)}&context=pending-decision`)), { present: true, workId: '' });
	assert.deepEqual(decisionWorkspaceWorkFocusRequest(new URLSearchParams('focus=valid&context=pending-decision&context=pending-decision')), { present: true, workId: '' });
	assert.equal(pendingDecisionWorkHref('x'.repeat(201)), null);
	assert.match(routeSource, /import \{ browser \} from '\$app\/environment';[\s\S]*?browser[\s\S]*?decisionWorkspaceWorkFocusRequest\(\$page\.url\.searchParams\)[\s\S]*?: \{ present: false, workId: '' \}/u);
	assert.match(routeSource, /\$effect\(\(\) => \{\s*if \(!browser\) return;\s*const focusValues = \$page\.url\.searchParams\.getAll\('focus'\);/u);
	assert.match(routeSource, /pendingDecisionFocus\.present[\s\S]*?focusedDecisionPack[\s\S]*?: \[\][\s\S]*?recommendedDecisionWork\(decisionWorkspaceContext\)/u);
	assert.match(routeSource, /data-decision-resume-rejected[\s\S]*?pendingDecisionResumeError/u);
	assert.doesNotMatch(routeSource, /if \(attempts <= 1\) applyFilter\('all'\)/u);
});

test('the current-Work descriptor is closed, read-only, untrusted-content aware, and live', async () => {
	let current = workView();
	let reads = 0;
	const tool = createCurrentWorkTool(() => {
		reads += 1;
		return current;
	});
	assert.equal(tool.name, WORK_CURRENT_TOOL_NAME);
	assert.equal(tool.name, 'get_current_work_view');
	assert.equal(tool.title, 'Get current Work view');
	assert.match(tool.description, /filtered, sorted, density-aware, and bounded/u);
	assert.match(tool.description, /workspace, matching, shown, and remaining/u);
	assert.match(tool.description, /rendered decision recommendation/u);
	assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
	assert.deepEqual(tool.annotations, { readOnlyHint: true, openWorldHint: false, untrustedContentHint: true });

	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(() => tool.execute({ unexpected: true }, { signal: aborted.signal }), { name: 'AbortError' });
	assert.equal(reads, 0);
	await assert.rejects(() => tool.execute(), /empty object/u);
	for (const malformed of [null, [], { unexpected: true }]) {
		await assert.rejects(() => tool.execute(malformed), /empty object/u);
	}
	assert.equal(reads, 0);

	const canonical = structuredClone(current);
	const first = await tool.execute({}, { signal: new AbortController().signal });
	assert.equal(reads, 1);
	assert.deepEqual(first, current);
	assert.notEqual(first, current);
	assert.notEqual(first.scope, current.scope);
	assert.notEqual(first.counts, current.counts);
	assert.notEqual(first.items, current.items);
	for (let index = 0; index < first.items.length; index += 1) {
		assert.notEqual(first.items[index], current.items[index]);
	}
	first.scope.search = 'mutated result';
	first.counts.workspace = 999;
	first.items[0].title = 'Mutated first item';
	first.items[1].owner = 'Mutated second owner';
	first.items.push({ ...first.items[0], id: 'result-only' });
	assert.deepEqual(current, canonical);

	current = null;
	assert.equal(await tool.execute({}), null);
	assert.equal(reads, 2);
	assert.throws(() => createCurrentWorkTool(null), /current-view getter/u);
});

test('the Work-search descriptor declares and verifies one reversible page-local interaction', async () => {
	const calls = [];
	const focusProof = { focused: true, focusVisible: true, inViewport: true, pulsed: true };
	const tool = createShowWorkSearchTool(async (query) => {
		calls.push(query);
		const work = workView({ search: query });
		return { changed: true, query, focus: { target: 'item', itemId: work.items[0].id, ...focusProof }, work };
	});
	assert.equal(tool.name, WORK_SEARCH_TOOL_NAME);
	assert.equal(tool.name, 'show_work_search');
	assert.equal(tool.title, 'Show Work search');
	assert.match(tool.description, /only Work's visible text search/u);
	assert.match(tool.description, /never modifies workspace data/u);
	assert.deepEqual(tool.inputSchema, {
		type: 'object',
		properties: {
			query: { type: 'string', maxLength: 120, description: 'Text to show in Work search. Use an empty string to clear it.' }
		},
		required: ['query'],
		additionalProperties: false
	});
	assert.deepEqual(tool.annotations, {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
		untrustedContentHint: true
	});

	const result = await tool.execute({ query: ' needle ' }, { signal: new AbortController().signal });
	assert.deepEqual(calls, ['needle']);
	assert.equal(result.changed, true);
	assert.equal(result.query, 'needle');
	assert.deepEqual(result.focus, { target: 'item', itemId: 'alpha / one', ...focusProof });
	assert.equal(result.work.scope.search, 'needle');
	assert.equal(result.work.scope.appliedSearch, 'needle');
	assert.notEqual(result.work, workView({ search: 'needle' }));
	for (const field of Object.keys(focusProof)) {
		const unverified = createShowWorkSearchTool(async () => ({
			...structuredClone(result),
			focus: { ...result.focus, [field]: false }
		}));
		await assert.rejects(() => unverified.execute({ query: 'needle' }), /verifiable page receipt/u);
	}
	await assert.rejects(() => tool.execute({ query: 'needle', status: 'active' }), /accepts only query/u);
	await assert.rejects(() => tool.execute({ query: 42 }), /must be a string/u);
	await assert.rejects(() => tool.execute({ query: 'line\nbreak' }), /control characters/u);
	await assert.rejects(() => tool.execute({ query: 'x'.repeat(121) }), /120 characters or fewer/u);
	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(() => tool.execute({ query: '' }, { signal: aborted.signal }), { name: 'AbortError' });
	assert.throws(() => createShowWorkSearchTool(null), /search presenter/u);

	const mismatched = createShowWorkSearchTool(async () => ({
		changed: true,
		query: 'needle',
		focus: { target: 'item', itemId: 'beta', ...focusProof },
		work: workView({ search: 'needle' })
	}));
	await assert.rejects(() => mismatched.execute({ query: 'needle' }), /focus did not match/u);
	const emptyWork = workView({ search: 'missing', items: [], matching: 0, blocked: 0 });
	const empty = createShowWorkSearchTool(async () => ({
		changed: true,
		query: 'missing',
		focus: { target: 'search', itemId: null, ...focusProof },
		work: emptyWork
	}));
	const noMatch = await empty.execute({ query: 'missing' });
	assert.deepEqual(noMatch.focus, { target: 'search', itemId: null, ...focusProof });
	assert.deepEqual(noMatch.work.counts, { workspace: 4, matching: 0, shown: 0, remaining: 0, blocked: 0 });
	assert.deepEqual(noMatch.work.items, []);
});

test('one exported Work-search normalizer serves tools and safe URL arrival', () => {
	assert.equal(normalizeWorkSearch('  Research  '), 'Research');
	assert.equal(routeWorkSearch('  Research  '), 'Research');
	assert.equal(normalizeWorkSearch('x'.repeat(121)), null);
	assert.equal(normalizeWorkSearch('line\nbreak'), null);
	assert.equal(routeWorkSearch('x'.repeat(121)), '');
	assert.equal(routeWorkSearch('line\nbreak'), '');
	assert.equal(routeWorkSearch(null), '');
	assert.match(helperSource, /const query = normalizeWorkSearch\(candidate\.query\);/u);
	assert.match(routeSource, /function applyRouteWorkSearch\(searchParam: unknown\)[\s\S]*?const routeSearch = routeWorkSearch\(searchParam\);[\s\S]*?query = routeSearch;[\s\S]*?debouncedQuery = routeSearch;/u);
	assert.match(routeSource, /const routeSearch = applyRouteWorkSearch\(\$page\.url\.searchParams\.get\('search'\)\);/u);
	assert.match(routeSource, /void focusRouteWorkSearchArrival\(routeSearch\);/u);
	const arrival = routeSource.match(/function applyRouteWorkSearch[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.doesNotMatch(arrival, /fetch\(|localStorage|sessionStorage|goto\(|runPackAction|registerPageTools/u);
});

test('human and WebMCP Work search share one explicit length boundary', () => {
	assert.match(helperSource, /export const WORK_SEARCH_MAX_LENGTH = 120;/u);
	assert.match(helperSource, /maxLength: WORK_SEARCH_MAX_LENGTH,/u);
	assert.match(helperSource, /query\.length <= WORK_SEARCH_MAX_LENGTH \? query : null/u);
	assert.match(workFilterControlsSource, /import \{ WORK_SEARCH_MAX_LENGTH \} from '\.\/work-webmcp\.mjs';/u);
	assert.match(workFilterControlsSource, /function setHumanWorkSearch\(nextQuery: string\) \{[\s\S]*?query = nextQuery\.slice\(0, WORK_SEARCH_MAX_LENGTH\);[\s\S]*?\}/u);
	assert.match(workFilterControlsSource, /<WornInput[\s\S]*?type="search"[\s\S]*?maxlength=\{WORK_SEARCH_MAX_LENGTH\}[\s\S]*?bind:value=\{query\}[\s\S]*?oninput=\{\(\) => setHumanWorkSearch\(query\)\}/u);
});

test('Work presentation receipts freeze the normalized query and live denominators', () => {
	const work = workView({ search: 'Garage reset', workspace: 8, matching: 4, blocked: 2 });
	const receipt = workSearchPresentationReceipt({
		changed: true,
		query: 'Garage reset',
		focus: { target: 'item', itemId: work.items[0].id, focused: true, focusVisible: true, inViewport: true, pulsed: true },
		work
	});
	assert.equal(receipt.summary, 'Work search updated for “Garage reset”.');
	assert.deepEqual(receipt.cells, [
		{ label: 'Visible query', value: '“Garage reset”' },
		{ label: 'Current scope', value: '2 shown · 4 matching · 8 workspace' },
		{ label: 'Evidence', value: '2 blocked in the matching work' },
		{ label: 'Status', value: 'Visible search updated · Not saved' }
	]);
	assert.equal(receipt.scopeKey, JSON.stringify({ scope: work.scope, counts: work.counts }));

	const clearedWork = workView({ search: '', workspace: 8, matching: 3, blocked: 1 });
	const cleared = workSearchPresentationReceipt({
		changed: true,
		query: '',
		focus: { target: 'item', itemId: clearedWork.items[0].id, focused: true, focusVisible: true, inViewport: true, pulsed: true },
		work: clearedWork
	});
	assert.equal(cleared.summary, 'Work search cleared to show all work.');
	assert.equal(cleared.cells[0].value, 'All work · search cleared');
});

test('Work receipt insertion is followed by strict revalidation and failure clears the provisional receipt', async () => {
	const resultHandler = routeSource.match(/async function recordWorkWebMcpResult[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(resultHandler, /if \(toolName === WORK_DRAFT_TOOL_NAME\)[\s\S]*?if \(toolName !== WORK_SEARCH_TOOL_NAME\) return;[\s\S]*?webMcpActivityReceipt = \{ \.\.\.workSearchPresentationReceipt\(result\), toolName \};[\s\S]*?await tick\(\);[\s\S]*?focusWorkSearchDestination\(true\)/u);
	assert.match(resultHandler, /finalFocus\.target !== outcome\.focus\.target[\s\S]*?finalFocus\.itemId !== outcome\.focus\.itemId[\s\S]*?throw new Error\('Work receipt focus did not match the rendered search destination\.'\)/u);

	let registered;
	let visibleReceipt = null;
	const events = [];
	const strictFailure = new Error('Visible focus verification failed: {"inViewport":false}');
	const view = workView({ search: 'Garage reset' });
	const validPageState = structuredClone(view);
	const focus = {
		target: 'item',
		itemId: view.items[0].id,
		focused: true,
		focusVisible: true,
		inViewport: true,
		pulsed: true
	};
	registerPageTools({
		modelContext: { registerTool(candidate) { registered = candidate; } }
	}, [createShowWorkSearchTool(async () => ({
		changed: true,
		query: 'Garage reset',
		focus,
		work: view
	}))], {
		onResult: async () => {
			visibleReceipt = { summary: 'Provisional Work search success' };
			events.push('receipt');
			await Promise.resolve();
			events.push('strict revalidation');
			throw strictFailure;
		},
		onInvocationError: async ({ error }) => {
			assert.equal(error, strictFailure);
			visibleReceipt = null;
			events.push('clear');
			await Promise.resolve();
		}
	});

	await assert.rejects(() => registered.execute({ query: 'Garage reset' }), strictFailure);
	assert.deepEqual(events, ['receipt', 'strict revalidation', 'clear']);
	assert.equal(visibleReceipt, null);
	assert.deepEqual(view, validPageState);
	const failureHandler = routeSource.match(/async function clearFailedWorkWebMcpReceipt[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(failureHandler, /toolName === WORK_DRAFT_TOOL_NAME[\s\S]*?webMcpActivityReceipt\?\.toolName === toolName[\s\S]*?webMcpActivityReceipt = null;[\s\S]*?await tick\(\);/u);
	assert.doesNotMatch(failureHandler, /query\s*=|debouncedQuery\s*=/u);
});

test('Work renders and returns one canonical bounded view through its existing search owner', () => {
	assert.equal(visibleDecisionDecider('Household', 'Household'), null);
	assert.equal(visibleDecisionDecider(' Household ', 'household'), null);
	assert.equal(visibleDecisionDecider('Household', 'Jordan'), 'Jordan');
	assert.equal(visibleDecisionDecider('', 'Research lead'), 'Research lead');
	assert.equal(visibleDecisionDecider('Research', null), null);
	assert.match(routeSource, /import \{ registerPageTools \} from '\$lib\/webmcp\.mjs';/u);
	assert.match(routeSource, /import \{[\s\S]*?createCurrentWorkTool,[\s\S]*?createShowWorkSearchTool,[\s\S]*?workItemPageView,[\s\S]*?workPageView[\s\S]*?\} from '\.\/work-webmcp\.mjs';/u);
	assert.match(routeSource, /let currentWorkView = \$derived\.by\(\(\) => workPageView\(\{[\s\S]*?search: query,[\s\S]*?appliedSearch: debouncedQuery,[\s\S]*?matching: visible\.length,[\s\S]*?shown: renderedVisible\.length,[\s\S]*?items: renderedVisible\.map\(\(pack\) => workItemPageView\(/u);
	assert.match(workflowSource, /export function recommendedDecisionWork\(visiblePacks: DemoPack\[\]\)[\s\S]*?const decisions = visiblePacks\.filter\([\s\S]*?const pack = decisions\[0\];/u);
	assert.match(workflowSource, /visibleBlockedCount: visiblePacks\.filter\(hasBlocker\)\.length/u);
	assert.match(routeSource, /let decisionWorkspaceContext = \$derived\([\s\S]*?let decisionWorkspace = \$derived\(recommendedDecisionWork\(decisionWorkspaceContext\)\);[\s\S]*?recommendation: decisionWorkspace[\s\S]*?reason: decisionWorkspaceReason/u);
	assert.match(routeSource, /let decisionWorkspaceDecider = \$derived\([\s\S]*?visibleDecisionDecider\(decisionWorkspace\.pack\.area, decisionWorkspace\.pack\.decider\)[\s\S]*?decider: decisionWorkspaceDecider/u);
	assert.match(routeSource, /import WorkDecisionWorkspace from '\.\/WorkDecisionWorkspace\.svelte';[\s\S]*?\{#if decisionWorkspace\}[\s\S]*?<WorkDecisionWorkspace[\s\S]*?recommendation=\{decisionWorkspace\}[\s\S]*?reason=\{decisionWorkspaceReason\}[\s\S]*?decider=\{decisionWorkspaceDecider\}/u);
	assert.match(workDecisionWorkspaceSource, /\{#if decider\}<span data-decision-workspace-decider>\{decider\}<\/span>\{\/if\}/u);
	assert.doesNotMatch(workDecisionWorkspaceSource, /data-decision-workspace-decider>\{recommendation\.pack\.decider\}/u);
	assert.match(workDecisionWorkspaceSource, /data-decision-workspace[\s\S]*?Decision workspace[\s\S]*?Needs a decision[\s\S]*?data-decision-workspace-review[\s\S]*?data-decision-workspace-next/u);
	assert.match(workDecisionWorkspaceSource, /data-decision-workspace-review[\s\S]*?href=\{decisionWorkspaceReviewHref\(recommendation\.pack\.id\)\}/u);
	assert.match(workDecisionWorkspaceSource, /data-decision-workspace-next[\s\S]*?href=\{decisionWorkspaceNextHref\(recommendation\.pack\.id\)\}/u);
	assert.match(helperSource, /href: decisionWorkspaceNextHref\(id\)/u);
	assert.match(helperSource, /reviewHref: decisionWorkspaceReviewHref\(id\)/u);
	assert.equal(decisionNavigationSource.match(/export function decisionWorkspaceNextHref/gu)?.length, 1);
	assert.equal(decisionNavigationSource.match(/export function decisionWorkspaceReviewHref/gu)?.length, 1);
	const decisionWorkspaceMarkup = workDecisionWorkspaceSource.match(/<section[\s\S]*?<\/section>/u)?.[0] ?? '';
	assert.doesNotMatch(decisionWorkspaceMarkup, /onclick|doAction|runPrimary|savePack|createPack/u);
	assert.doesNotMatch(workDecisionWorkspaceSource, /decision-workspace\{[^}]*margin-inline:/u);
	assert.match(routeSource, /let hideDone = \$state\(false\);/u);
	assert.doesNotMatch(routeSource, /demo-hide-done/u);
	assert.match(routeSource, /\{#each renderedVisible as pack, i \(pack\.id\)\}/u);
	assert.match(routeSource, /function focusWorkSearchDestination\(requireVisibleFocus: boolean\)[\s\S]*?\[data-work-item\]\[data-pack-id\][\s\S]*?focusAndPulse\(destination, \{[\s\S]*?behavior: 'auto',[\s\S]*?block: 'center',[\s\S]*?requireVisibleFocus[\s\S]*?target: 'item'[\s\S]*?target: 'search'/u);
	assert.match(routeSource, /async function showWorkSearchFromWebMcp\(nextQuery: string\) \{[\s\S]*?query = nextQuery;\s*debouncedQuery = nextQuery;[\s\S]*?await tick\(\);[\s\S]*?focus: focusWorkSearchDestination\(true\),[\s\S]*?work: currentWorkView/u);
	assert.match(routeSource, /async function recordWorkWebMcpResult[\s\S]*?if \(toolName === WORK_DRAFT_TOOL_NAME\)[\s\S]*?id: 'draft-batch'[\s\S]*?id: 'human-decision'[\s\S]*?if \(toolName !== WORK_SEARCH_TOOL_NAME\) return;[\s\S]*?webMcpActivityReceipt = \{ \.\.\.workSearchPresentationReceipt\(result\), toolName \}/u);
	assert.match(helperSource, /function workSearchPresentationReceipt[\s\S]*?Visible query[\s\S]*?Current scope[\s\S]*?Evidence[\s\S]*?Status[\s\S]*?Not saved/u);
	assert.match(routeSource, /webMcpActivityReceipt = \{ \.\.\.workSearchPresentationReceipt\(result\), toolName \};[\s\S]*?await tick\(\);[\s\S]*?focusWorkSearchDestination\(true\)[\s\S]*?finalFocus\.target !== outcome\.focus\.target[\s\S]*?throw new Error\('Work receipt focus did not match the rendered search destination\.'\)[\s\S]*?id: 'work-scope'/u);
	assert.match(routeSource, /let workReceiptScopeKey = \$derived\([\s\S]*?currentWorkView\.scope[\s\S]*?currentWorkView\.counts/u);
	assert.match(routeSource, /\$effect\(\(\) => \{[\s\S]*?webMcpActivityReceipt\?\.scopeKey[\s\S]*?webMcpActivityReceipt\.scopeKey !== workReceiptScopeKey[\s\S]*?webMcpActivityReceipt = null/u);
	assert.match(helperSource, /scopeKey: JSON\.stringify\(\{ scope: work\.scope, counts: work\.counts \}\)/u);
	assert.match(routeSource, /import WebMcpActivityStrip from '\$lib\/WebMcpActivityStrip\.svelte';/u);
	assert.match(routeSource, /\{#if webMcpActivityReceipt\}[\s\S]*?<WebMcpActivityStrip[\s\S]*?id="work-webmcp-activity"[\s\S]*?route="work"[\s\S]*?outcome=\{webMcpActivityReceipt\.summary\}[\s\S]*?toolName=\{webMcpActivityReceipt\.toolName\}[\s\S]*?cells=\{webMcpActivityReceipt\.cells\}[\s\S]*?\/>[\s\S]*?\{#each densityPanelTabs/u);
	assert.doesNotMatch(routeSource, /ondone=\{\(\) => \(webMcpActivityReceipt = null\)\}/u);
	assert.doesNotMatch(routeSource, /work-presenter-result|webmcp-tool-label/u);
	assert.match(activityStripSource, /data-webmcp-receipt=\{route\}[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/u);
	assert.match(activityStripSource, /Live WebMCP handoff[\s\S]*?webmcp-activity-outcome[\s\S]*?webmcp-activity-evidence[\s\S]*?WebMCP · \{toolName\}/u);
	assert.match(activityStripSource, /grid-template-columns: repeat\(auto-fit, minmax\(min\(190px, 100%\), 1fr\)\);[\s\S]*?@media \(max-width: 500px\)/u);
	assert.match(routeSource, /\.demo-work-list\s*\{\s*overflow:\s*visible;\s*padding-block-start:\s*8px;\s*\}/u);
	assert.match(routeSource, /registerPageTools\(document, \[[\s\S]*?createCurrentWorkTool\(\(\) => currentWorkView\),[\s\S]*?createShowWorkSearchTool\(showWorkSearchFromWebMcp\)[\s\S]*?\], \{[\s\S]*?onInvocationError: clearFailedWorkWebMcpReceipt,[\s\S]*?onResult: recordWorkWebMcpResult[\s\S]*?\}\)/u);
	assert.match(routeSource, /stopWorkWebMcp\?\.\(\);\s*stopWorkWebMcp = null;/u);
	assert.match(routeSource, /stopWorkWebMcp = null;\s*webMcpActivityReceipt = null;/u);
	assert.doesNotMatch(routeSource, /document\.modelContext|registerTool\(/u);
	assert.doesNotMatch(`${routeSource}\n${helperSource}\n${registrationSource}`, /\/api\/mcp-proxy|jsonrpc|tools\/call|unregisterTool/u);
	assert.doesNotMatch(helperSource, /\.\.\.(?:pack|item|work)|purpose:|memory:|sources:|activity:/u);
});

test('repeated Work and Review action disclosures include their visible work title', () => {
	assert.match(workListCardSource, /<WornAccordion label="Other actions" description=\{workTitle\(pack\)\}>/u);
	assert.match(reviewRouteSource, /<WornAccordion label="Other actions" description=\{workTitle\(pack\)\}>/u);
	assert.equal(workListCardSource.match(/<WornAccordion label="Other actions"/gu)?.length, 1);
	assert.equal(reviewRouteSource.match(/<WornAccordion label="Other actions"/gu)?.length, 1);
});

test('Work text search uses only its intentional visible evidence allowlist', () => {
	const searchHaystack = workflowSource.match(/return \[\s*pack\.title,[\s\S]*?pack\.area\s*\]\s*\.join\(' '\)\.toLowerCase\(\)\.includes\(q\);/u)?.[0] ?? '';
	for (const field of ['pack.title', 'pack.type', 'pack.next', 'pack.owner', 'pack.due', 'pack.blocker', 'pack.area']) {
		assert.match(searchHaystack, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
	}
	for (const hiddenField of ['pack.sources', 'pack.purpose', 'pack.memory', 'memory', 'activityTextWithoutActor']) {
		assert.doesNotMatch(searchHaystack, new RegExp(hiddenField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
	}
	assert.doesNotMatch(workflowSource, /activityTextWithoutActor/u);
});

test('Work active-filter count excludes the separately persisted display density', () => {
	const activeFilterCount = workFilterControlsSource.match(/let activeSecondaryFilterCount = \$derived\([\s\S]*?\n\t\);/u)?.[0] ?? '';
	assert.match(activeFilterCount, /Number\(sortBy !== 'urgency'\)/u);
	assert.doesNotMatch(activeFilterCount, /density/u);
	const clearCondition = workFilterControlsSource.match(/\{#if filter !== 'all'[\s\S]*?<WornChip size="sm" label="Clear"/u)?.[0] ?? '';
	assert.doesNotMatch(clearCondition, /density/u);
});

test('successful Work batch delete restores focus through an enabled durable fallback', () => {
	assert.match(routeSource, /import WorkBatchActions from '\.\/WorkBatchActions\.svelte';[\s\S]*?<WorkBatchActions[\s\S]*?active=\{batchMode\}[\s\S]*?\{packs\}[\s\S]*?selected=\{batchSelected\}[\s\S]*?bind:busyId[\s\S]*?bind:errorText[\s\S]*?\/>/u);
	assert.match(workBatchActionsSource, /active: boolean;[\s\S]*?packs: DemoPack\[\];[\s\S]*?selected: SvelteSet<string>;[\s\S]*?busyId: string;[\s\S]*?errorText: string;[\s\S]*?busyId = \$bindable\(\)[\s\S]*?errorText = \$bindable\(\)/u);
	assert.match(routeSource, /let batchMode = \$state\(false\);[\s\S]*?let batchSelected = new SvelteSet<string>\(\);[\s\S]*?function toggleBatchMode\(\)[\s\S]*?function toggleBatchSelection\(packId: string\)[\s\S]*?<WorkBatchActions[\s\S]*?active=\{batchMode\}[\s\S]*?selected=\{batchSelected\}/u);
	assert.match(routeSource, /\{#snippet batchCheckbox\(pack: DemoPack\)\}[\s\S]*?checked=\{batchSelected\.has\(pack\.id!\)\}[\s\S]*?onchange=\{\(\) => toggleBatchSelection\(pack\.id!\)\}[\s\S]*?<WorkGridCard[\s\S]*?batchSelected=\{batchSelected\.has\(pack\.id!\)\}[\s\S]*?\{batchCheckbox\}[\s\S]*?<WorkListCard[\s\S]*?\{batchMode\}[\s\S]*?\{batchCheckbox\}/u);
	assert.match(workBatchActionsSource, /actionBusy,[\s\S]*?displayToast,[\s\S]*?runPackBatchAction,[\s\S]*?ChallengeStateError[\s\S]*?from '\$lib\/demo-client';/u);
	assert.match(workBatchActionsSource, /let deleteFallbackFocus = \$state<HTMLElement \| null>\(null\);/u);
	const deleteRequest = workBatchActionsSource.match(/function requestDelete\(event: MouseEvent\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(deleteRequest, /const ids = \[\.\.\.selected\];[\s\S]*?deleteTarget = \{ ids, count: ids\.length \};[\s\S]*?deleteReturnFocus = event\.currentTarget as HTMLElement;[\s\S]*?deleteFallbackFocus = document\.querySelector<HTMLElement>\('\[data-action="batch-mode"\]'\);[\s\S]*?deleteDialogOpen = true;/u);
	const confirmBatchDelete = workBatchActionsSource.match(/async function confirmDelete\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(confirmBatchDelete, /const target = deleteTarget;[\s\S]*?if \(!target\) return;[\s\S]*?await runBatchAction\('delete', target\.ids, false\);[\s\S]*?deleteTarget = null;/u);
	assert.match(workBatchActionsSource, /<WorkDeleteConfirmDialog[\s\S]*?fallbackFocus=\{deleteFallbackFocus\}[\s\S]*?onconfirm=\{confirmDelete\}/u);
	assert.doesNotMatch(routeSource, /WorkDeleteConfirmDialog|batchDeleteDialogOpen|batchDeleteTarget|batchDeleteReturnFocus|batchDeleteFallbackFocus|requestBatchDelete|confirmBatchDelete/u);
	assert.match(workDeleteDialogSource, /import \{ tick \} from 'svelte';/u);
	assert.match(workDeleteDialogSource, /fallbackFocus\?: HTMLElement \| null;/u);
	const restoreFocus = workDeleteDialogSource.match(/async function restoreFocus\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(restoreFocus, /await tick\(\);[\s\S]*?\[returnFocus, fallbackFocus\][\s\S]*?:disabled[\s\S]*?aria-disabled="true"[\s\S]*?focus\(\{ preventScroll: true \}\)/u);
	const confirmDelete = workDeleteDialogSource.match(/async function confirm\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(confirmDelete, /await onconfirm\(\);[\s\S]*?open = false;[\s\S]*?await restoreFocus\(\);/u);
});

test('Work batch toolbar disables empty Deselect and hands completed Deselect focus to Batch', () => {
	const batchToolbar = workBatchActionsSource.match(/<div class="demo-batch-bar"[\s\S]*?<\/div>/u)?.[0] ?? '';
	assert.match(batchToolbar, /data-action="batch-clear" disabled=\{selected\.size === 0 \|\| busyId === 'batch'\}/u);
	assert.match(batchToolbar, /data-action="batch-done"[\s\S]*?onclick=\{\(\) => runBatchAction\('done'\)\}[\s\S]*?data-action="batch-start"[\s\S]*?onclick=\{\(\) => runBatchAction\('start'\)\}[\s\S]*?data-action="batch-block"[\s\S]*?onclick=\{\(\) => runBatchAction\('block'\)\}[\s\S]*?data-action="batch-delete"[\s\S]*?onclick=\{requestDelete\}/u);
	const clearSelection = workBatchActionsSource.match(/async function clearSelection\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(clearSelection, /if \(busyId === 'batch' \|\| selected\.size === 0\) return;/u);
	assert.match(clearSelection, /selected\.clear\(\);[\s\S]*?await focusBatchModeToggle\(\);/u);
	assert.match(workBatchActionsSource, /@media \(min-width: 421px\)[\s\S]*?\.demo-batch-bar[\s\S]*?display: flex;[\s\S]*?@media \(max-width: 420px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
	assert.doesNotMatch(routeSource, /demo-batch-bar|demo-batch-count|clearBatchSelection|focusBatchModeToggle/u);
});

test('Work batch actions are planned by eligibility, committed once, and restore durable focus', () => {
	assert.match(workBatchActionsSource, /let hasIncompleteSelected = \$derived\([\s\S]*?selected\.size > 0 && packs\.some\(\(pack\) => selected\.has\(pack\.id!\) && !pack\.archived && pack\.status !== 'done'\)[\s\S]*?\);/u);
	assert.match(workBatchActionsSource, /let hasDraftSelected = \$derived\([\s\S]*?!pack\.archived && pack\.status === 'draft'[\s\S]*?let hasBlockableSelected = \$derived\([\s\S]*?!pack\.archived && pack\.status !== 'done' && pack\.status !== 'blocked'/u);
	const batchToolbar = workBatchActionsSource.match(/<div class="demo-batch-bar"[\s\S]*?<\/div>/u)?.[0] ?? '';
	assert.match(batchToolbar, /data-action="batch-done" disabled=\{!hasIncompleteSelected \|\| busyId === 'batch'\}/u);
	assert.match(batchToolbar, /data-action="batch-start" disabled=\{!hasDraftSelected \|\| busyId === 'batch'\}/u);
	assert.match(batchToolbar, /data-action="batch-block" disabled=\{!hasBlockableSelected \|\| busyId === 'batch'\}/u);
	const batchAction = workBatchActionsSource.match(/async function runBatchAction\([\s\S]*?\n\t\}/u)?.[0] ?? '';
	const beforeFirstMutation = batchAction.match(/async function runBatchAction\([\s\S]*?\n\t\ttry \{/u)?.[0] ?? '';
	assert.match(beforeFirstMutation, /if \(selectedIds\.length === 0 \|\| busyId\) return;[\s\S]*?busyId = 'batch';[\s\S]*?busyAction = action;[\s\S]*?errorText = '';[\s\S]*?try \{/u);
	assert.doesNotMatch(beforeFirstMutation, /await /u);
	assert.match(batchAction, /const undoSnapshot = action === 'delete' \? null : buildBatchUndoSnapshot\(packs, selectedIds, action\);[\s\S]*?const result = await runPackBatchAction\(selectedIds, action\);[\s\S]*?commitActionUndo\(result\.appliedCount > 0 \? undoSnapshot : null\);[\s\S]*?displayToast\(result\.receipt\.summary \|\| 'Batch action complete\.', 'success'\)/u);
	assert.doesNotMatch(batchAction, /for \(const id|runPackAction|saveBrowserState/u);
	assert.match(batchAction, /catch \(error\) \{[\s\S]*?error instanceof ChallengeStateError[\s\S]*?\? error\.message[\s\S]*?: 'The batch action failed — the local state is unchanged\.';[\s\S]*?if \(reportError\) errorText = message;[\s\S]*?else throw new Error\(message\);/u);
	assert.match(batchAction, /finally \{[\s\S]*?busyAction = null;[\s\S]*?busyId = '';[\s\S]*?actionBusy\.set\(''\);/u);
	assert.match(batchAction, /completedBatchAction = true;[\s\S]*?finally[\s\S]*?busyId = '';[\s\S]*?if \(completedBatchAction && action !== 'delete'\) await focusBatchModeToggle\(\);/u);
	const focusBatchModeToggle = workBatchActionsSource.match(/async function focusBatchModeToggle\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(focusBatchModeToggle, /await tick\(\);[\s\S]*?\[data-action="batch-mode"\][\s\S]*?isConnected[\s\S]*?getClientRects\(\)\.length > 0[\s\S]*?:disabled[\s\S]*?aria-disabled="true"[\s\S]*?focus\(\{ preventScroll: true \}\)/u);
	assert.doesNotMatch(routeSource, /batchBusyAction|hasDraftSelected|hasIncompleteSelected|batchAction\(/u);
	assert.doesNotMatch(workBatchActionsSource, /registerPageTools|modelContext|fetch\(|goto\(|onBatch/u);
});

test('batch plans reject mixed ineligible transitions and deletion repairs references', () => {
	const packs = [
		{ id: 'draft', status: 'draft' },
		{ id: 'active', status: 'active' },
		{ id: 'blocked', status: 'blocked' },
		{ id: 'done', status: 'done' },
		{ id: 'archived', status: 'active', archived: true }
	];
	assert.deepEqual(planBatchAction(packs, packs.map((pack) => pack.id), 'start'), {
		requestedCount: 5,
		eligibleIds: ['draft'],
		skippedCount: 4
	});
	assert.deepEqual(planBatchAction(packs, packs.map((pack) => pack.id), 'done').eligibleIds, ['draft', 'active', 'blocked']);
	assert.deepEqual(planBatchAction(packs, packs.map((pack) => pack.id), 'block').eligibleIds, ['draft', 'active']);
	assert.deepEqual(planBatchAction(packs, ['archived'], 'delete').eligibleIds, ['archived']);

	const state = {
		packs: [
			{ id: 'removed', status: 'done' },
			{ id: 'dependent', status: 'blocked', blocker: 'Waiting', blockedBy: 'removed', next: 'Open' },
			{ id: 'archived', status: 'active', archived: true }
		],
		selectedId: 'removed',
		pendingNextActionDrafts: [
			{ workId: 'removed', evidence: [] },
			{ workId: 'dependent', evidence: [{ workId: 'removed' }] }
		],
		actionReceipt: { pack: { id: 'removed' } }
	};
	assert.deepEqual(removePacksAndReferences(state, ['removed']), {
		deletedCount: 1,
		discardedDrafts: 2,
		repairedDependencies: 1
	});
	assert.deepEqual(state.packs.map((pack) => pack.id), ['dependent', 'archived']);
	assert.equal(state.packs[0].blockedBy, '');
	assert.equal(state.packs[0].status, 'active');
	assert.equal(state.selectedId, 'dependent');
	assert.deepEqual(state.pendingNextActionDrafts, []);
	assert.equal(state.actionReceipt, null);
	state.packs[0].archived = true;
	assert.equal(repairActiveSelection(state), '');
});

test('compact Work grid cards remain readable and contained for fine and coarse pointers', () => {
	assert.doesNotMatch(`${workGridCardSource}\n${demoCssSource}`, /grid-card-action/u);
	assert.doesNotMatch(workGridCardSource, /@media \(max-width: 800px\) and \(pointer: coarse\)/u);
	const compactRules = workGridCardSource.match(/@media \(max-width: 800px\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(compactRules, /\.demo-grid-card \{ box-sizing: border-box; font-size: 14px; gap: 8px; inline-size: 100%; max-inline-size: 100%; padding: 12px; \}/u);
	assert.match(compactRules, /\.grid-card-title \{ box-sizing: border-box; display: block; font-size: 16px; line-height: 1\.35; min-height: 44px; max-inline-size: 100%; overflow: visible; overflow-wrap: anywhere;[\s\S]*?white-space: normal; word-break: break-word; \}/u);
	assert.match(compactRules, /\.grid-card-meta > span, \.grid-card-status,[\s\S]*?font-size: 13px; line-height: 1\.6; max-inline-size: 100%;/u);
	assert.match(compactRules, /\.grid-card-fact \{[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\); max-width: 100%; overflow: visible; overflow-wrap: anywhere;/u);
	assert.match(compactRules, /\.grid-card-quick \{ gap: 6px; margin-top: 4px; padding-top: 6px; \}/u);
	assert.match(compactRules, /\[data-work-primary-navigation\][\s\S]*?\[data-work-primary-mutation\][\s\S]*?font-size: 14px; min-width: 0; max-inline-size: 100%; overflow-wrap: anywhere;/u);
	assert.doesNotMatch(compactRules, /min-height: 40px/u);
	assert.match(routeSource, /@media\(max-width:800px\)\{[\s\S]*?:global\(\[data-work-item\] \.worn-btn\[data-work-primary-navigation\]\),[\s\S]*?:global\(\[data-work-item\] \.worn-btn\[data-work-primary-mutation\]\)\{min-height:44px\}/u);
	assert.match(workGridCardSource, /<WornButton data-work-primary-navigation href=\{commandHref\} size="sm" variant="primary"[\s\S]*?onclick=\{\(event\) => \{ event\.stopPropagation\(\); \}\}/u);
	assert.match(workGridCardSource, /<WornButton data-work-primary-mutation type="button" size="sm" variant="primary"[\s\S]*?onclick=\{\(event\) => \{ event\.stopPropagation\(\); onPrimaryMutation\(pack, cmd\.action\); \}\}/u);
});

test('both Work densities expose complete work-item collection semantics', () => {
	assert.match(routeSource, /class="demo-work-grid"[^\n]*role="list" aria-label="Work items grid"/u);
	assert.match(workGridCardSource, /<div\s+role="listitem"/u);
	assert.match(workListCardSource, /<WornFoldedSurface[\s\S]*?as="article"[\s\S]*?aria-label=\{`Work \$\{workTitle\(pack\)\}`\}[\s\S]*?data-work-item/u);
});

test('Work card headers omit the generic task label', () => {
	assert.match(workListCardSource, /function hasDistinctType\(value: unknown\): boolean \{[\s\S]*?type !== 'general' && type !== 'task';[\s\S]*?\}/u);
	assert.match(workListCardSource, /function typeAndAreaMatch[\s\S]*?if \(!hasDistinctType\(type\) \|\| !area\) return false;/u);
	assert.match(workListCardSource, /\{#if hasDistinctType\(pack\.type\)\}[\s\S]*?demo-type-badge[\s\S]*?demo-age[\s\S]*?\{\/if\}/u);
	assert.doesNotMatch(workListCardSource, /\{#if pack\.type && pack\.type !== 'general'\}/u);
});

test('Work primary actions keep their visible command and add work-item context', () => {
	assert.match(workGridCardSource, /<WornButton data-work-primary-navigation[^>]*aria-label=\{`\$\{cmd\.label\} for \$\{workTitle\(pack\)\}`\}/u);
	assert.match(workGridCardSource, /<WornButton data-work-primary-mutation[^>]*aria-label=\{`\$\{cmd\.label\} for \$\{workTitle\(pack\)\}`\}/u);
	assert.match(workListCardSource, /<WornButton data-work-primary-navigation[^>]*aria-label=\{`\$\{command\.label\} for \$\{workTitle\(pack\)\}`\}/u);
	assert.match(workListCardSource, /<WornButton data-work-primary-mutation[^>]*aria-label=\{`\$\{command\.label\} for \$\{workTitle\(pack\)\}`\}/u);
});

test('Work titles own same-destination Next navigation while distinct commands remain available', () => {
	const sameDestinationPack = { id: 'same destination', next: '' };
	assert.equal(primaryCommand(sameDestinationPack).action, 'set-next');
	assert.equal(primaryCommandNavigation(sameDestinationPack), '/next?pack=same%20destination');
	assert.equal(primaryCommandNavigation({ id: 'blocked', blocker: 'Waiting', next: 'Open' }), '/review?focus=blocked');
	assert.equal(primaryCommand({ id: 'finish', next: 'Done' }).action, 'done');
	assert.deepEqual(commandActionForLabel('Start', false), { label: 'Start', action: 'start' });
	assert.deepEqual(commandActionForLabel('Open', false), { label: 'Open', action: 'start' });
	assert.deepEqual(commandActionForLabel('Ask legal to confirm the terms', false), { label: 'Ask legal to confirm the terms', action: 'start' });
	assert.deepEqual(commandActionForLabel('Start', true), { label: 'Start', action: 'start' });
	assert.deepEqual(commandActionForLabel('Open', true), { label: 'Open task', action: 'edit' });
	assert.deepEqual(commandActionForLabel('Ask legal to confirm the terms', true), { label: 'Open task', action: 'edit' });
	assert.equal(primaryCommandNavigation({ id: 'custom step', next: 'Ask legal to confirm the terms' }), '/work?focus=custom%20step');
	assert.equal(primaryCommandNavigation({ id: 'custom step', next: 'Open' }), '/work?focus=custom%20step');
	assert.equal(primaryCommandNavigation({ id: 'custom step', next: 'Open', blocker: 'none' }), '/work?focus=custom%20step');
	for (const source of [workGridCardSource, workListCardSource]) {
		assert.match(source, /let titleHref = \$derived\(canSetNextAction\(pack\) \? `\/next\?pack=\$\{encodeURIComponent\(pack\.id \|\| ''\)\}` : null\);/u);
		assert.match(source, /\{#if canSetNextAction\(pack\) && \(!commandHref \|\| commandHref !== titleHref\)\}/u);
		assert.match(source, /\{:else\}[\s\S]*?data-work-terminal-title/u);
		assert.doesNotMatch(source, /commandHref === titleHref/u);
	}
	assert.match(workGridCardSource, /<a class="grid-card-title" href=\{titleHref\}/u);
	assert.match(workListCardSource, /class="demo-card-title"[\s\S]*?href=\{titleHref\}/u);
});

test('custom workers create only bounded Draft-status work with visible human authority', async () => {
	let received = null;
	const tool = createWorkDraftsTool(async (input) => {
		received = structuredClone(input);
		return {
			created: input.drafts.map((draft, index) => ({ id: `worker-draft-${index + 1}`, title: draft.title, status: 'draft' })),
			workspaceBefore: input.expectedWorkspaceCount,
			workspaceAfter: input.expectedWorkspaceCount + input.drafts.length,
			workspaceChanged: true,
			requiresHumanStart: true,
			focus: { id: 'work-webmcp-activity', focused: true, focusVisible: true, inViewport: true, pulsed: true }
		};
	});
	assert.equal(tool.name, WORK_DRAFT_TOOL_NAME);
	assert.equal(WORK_DRAFT_MAX_ITEMS, 3);
	assert.deepEqual(tool.annotations, {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
		untrustedContentHint: true
	});
	assert.equal(tool.inputSchema.properties.drafts.minItems, 1);
	assert.equal(tool.inputSchema.properties.drafts.maxItems, 3);
	assert.equal(tool.inputSchema.properties.drafts.items.additionalProperties, false);
	assert.deepEqual(tool.inputSchema.properties.drafts.items.required, ['title']);
	const input = {
		expectedWorkspaceCount: 8,
		drafts: [
			{ title: '  Interview suppliers  ', owner: '  Avery  ', area: 'Research', energy: 'high', proofTarget: 'Three calls logged' },
			{ title: 'Draft rollout plan', due: '2026-09-12', recurrence: 'weekly' }
		]
	};
	const result = await tool.execute(input);
	assert.deepEqual(received, {
		expectedWorkspaceCount: 8,
		drafts: [
			{ title: 'Interview suppliers', owner: 'Avery', area: 'Research', type: null, due: null, energy: 'high', recurrence: null, proofTarget: 'Three calls logged' },
			{ title: 'Draft rollout plan', owner: null, area: null, type: null, due: '2026-09-12', energy: null, recurrence: 'weekly', proofTarget: null }
		]
	});
	assert.deepEqual(result, {
		created: [
			{ id: 'worker-draft-1', title: 'Interview suppliers', status: 'draft' },
			{ id: 'worker-draft-2', title: 'Draft rollout plan', status: 'draft' }
		],
		workspaceBefore: 8,
		workspaceAfter: 10,
		workspaceChanged: true,
		requiresHumanStart: true,
		focus: { id: 'work-webmcp-activity', focused: true, focusVisible: true, inViewport: true, pulsed: true }
	});
	for (const invalid of [
		{},
		{ expectedWorkspaceCount: 8, drafts: [] },
		{ expectedWorkspaceCount: 8, drafts: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }] },
		{ expectedWorkspaceCount: 8, drafts: [{ title: 'Same' }, { title: ' same ' }] },
		{ expectedWorkspaceCount: 8, drafts: [{ title: 'Bad date', due: '2026-02-30' }] },
		{ expectedWorkspaceCount: 8, drafts: [{ title: 'Bad energy', energy: 'urgent' }] },
		{ expectedWorkspaceCount: 8, drafts: [{ title: 'Null owner', owner: null }] },
		{ expectedWorkspaceCount: 8, drafts: [{ title: 'Raw over limit', owner: 'A'.repeat(121) }] },
		{ expectedWorkspaceCount: 8, drafts: [{ title: 'Extra', secret: 'no' }] },
		{ expectedWorkspaceCount: 8, drafts: [{ title: 'Control\u0000character' }] }
	]) {
		assert.throws(() => workDraftInput(invalid));
	}
	assert.match(routeSource, /createCurrentWorkTool\(\(\) => currentWorkView\),[\s\S]*?createShowWorkSearchTool\(showWorkSearchFromWebMcp\),[\s\S]*?createWorkDraftsTool\(createWorkerDraftsFromWebMcp\)/u);
	assert.match(routeSource, /async function createWorkerDraftsFromWebMcp[\s\S]*?expectedWorkspaceCount !== packs\.length[\s\S]*?existingTitles[\s\S]*?duplicateDraft[\s\S]*?already exists\. Choose a unique title\.[\s\S]*?\$state\.snapshot\(webMcpActivityReceipt\)[\s\S]*?work-webmcp-activity[\s\S]*?await createDraftPacks\([\s\S]*?status: 'draft',[\s\S]*?next: 'Start'[\s\S]*?label: 'Draft work',[\s\S]*?result\.packs\.map\(\(pack\) => workTitle\(pack\)\)\.join\(' · '\)[\s\S]*?requiresHumanStart: true/u);
	assert.doesNotMatch(routeSource.match(/async function createWorkerDraftsFromWebMcp[\s\S]*?\n\t\}/u)?.[0] ?? '', /structuredClone\(webMcpActivityReceipt\)/u);
	assert.match(routeSource, /catch \(error\) \{[\s\S]*?webMcpActivityReceipt = previousReceipt;[\s\S]*?await tick\(\);[\s\S]*?throw error instanceof ChallengeStateError \? new Error\(error\.message\) : error;/u);
	assert.equal(routeSource.match(/<WebMcpActivityStrip/gu)?.length, 1, 'Work keeps one shared WebMCP activity strip');
	assert.doesNotMatch(routeSource.match(/async function createWorkerDraftsFromWebMcp[\s\S]*?\n\t\}/u)?.[0] ?? '', /createPack\(|runPackAction|saveBrowserState|fetch\(/u);
	assert.match(demoClientSource, /export async function createDraftPacks[\s\S]*?payloads\.length < 1 \|\| payloads\.length > 3[\s\S]*?status !== 'draft'[\s\S]*?draft\.packs\.length !== expectedWorkspaceCount[\s\S]*?draft\.packs\.push\(\.\.\.packs\)/u);
});

test('Quick Add stays available through the one createPack path in both Work densities', () => {
	assert.equal((routeSource.match(/<WorkQuickAdd/gu) ?? []).length, 1, 'Work renders one route-local Quick Add owner');
	assert.equal((workQuickAddSource.match(/<form[\s\S]*?class="quick-create-row"/gu) ?? []).length, 1, 'Quick Add owns one form');
	assert.match(workQuickAddSource, /<form[\s\S]*?class="quick-create-row"[^>]*aria-label="Quick add a work item"/u);
	const quickAddIndex = routeSource.indexOf('<WorkQuickAdd');
	const densityPanelsIndex = routeSource.indexOf('{#each densityPanelTabs');
	assert.ok(quickAddIndex >= 0 && quickAddIndex < densityPanelsIndex, 'Quick Add is owned once outside the density panels');
	assert.match(routeSource, /import WorkQuickAdd from '\.\/WorkQuickAdd\.svelte';[\s\S]*?let quickAddBusy = \$state\(false\);[\s\S]*?if \(quickAddBusy \|\| busyId\)[\s\S]*?<WorkQuickAdd[\s\S]*?filters=\{\{ owner: ownerFilter, area: areaFilter, energy: energyFilter, recurrence: recurrenceFilter \}\}[\s\S]*?bind:busy=\{quickAddBusy\}/u);
	assert.match(routeSource, /function revealQuickAddReceipt\(\) \{[\s\S]*?dismissedReceiptSummary = '';[\s\S]*?revealReceipt\(\);[\s\S]*?\}/u);
	assert.match(routeSource, /<WorkQuickAdd[\s\S]*?onCreated=\{revealQuickAddReceipt\}[\s\S]*?bind:busy=\{quickAddBusy\}/u);
	assert.match(routeSource, /\(e\.key === 'n' \|\| e\.key === 'c'\)[\s\S]*?document\.querySelector<HTMLInputElement>\('\.quick-create-input'\)[\s\S]*?input\.focus\(\)/u);
	assert.doesNotMatch(workQuickAddSource, /@media\(max-width:420px\)\{[\s\S]*?\.quick-create-row\{display:none\}/u);
	const quickCreateSource = workQuickAddSource.match(/async function quickCreate\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	for (const field of ['proofTarget', 'owner', 'area', 'type', 'due', 'energy', 'recurrence']) {
		assert.match(workQuickAddSource, new RegExp(`let ${field} = \\$state\\(''\\);`, 'u'));
	}
	assert.match(quickCreateSource, /const normalizedProofTarget = proofTarget\.trim\(\);[\s\S]*?const normalizedOwner = owner\.trim\(\)[\s\S]*?const normalizedArea = area\.trim\(\)[\s\S]*?const normalizedType = type\.trim\(\);[\s\S]*?const normalizedDue = due\.trim\(\);[\s\S]*?PACK_ENERGIES\.includes\(energy\)[\s\S]*?const normalizedRecurrence = recurrence\.trim\(\)[\s\S]*?await createPack\(\{[\s\S]*?title: normalizedTitle,[\s\S]*?status: 'active',[\s\S]*?next: 'Open',[\s\S]*?doneWhen: normalizedProofTarget \|\| undefined,[\s\S]*?owner: normalizedOwner \|\| undefined,[\s\S]*?area: normalizedArea \|\| undefined,[\s\S]*?type: normalizedType \|\| undefined,[\s\S]*?due: normalizedDue \|\| undefined,[\s\S]*?energy: normalizedEnergy \|\| undefined,[\s\S]*?recurrence: normalizedRecurrence \|\| undefined/u);
	assert.match(quickCreateSource, /normalizedOwner = owner\.trim\(\) \|\| \(filters\.owner !== 'all' && filters\.owner !== '_unassigned' \? filters\.owner : ''\)/u);
	assert.match(quickCreateSource, /normalizedArea = area\.trim\(\) \|\| \(filters\.area !== 'all' && filters\.area !== '_none' \? filters\.area : ''\)/u);
	assert.match(quickCreateSource, /normalizedEnergy = PACK_ENERGIES\.includes\(energy\)[\s\S]*?filters\.energy !== 'all' && PACK_ENERGIES\.includes\(filters\.energy\) \? filters\.energy : ''/u);
	assert.match(quickCreateSource, /normalizedRecurrence = recurrence\.trim\(\) \|\| \(filters\.recurrence !== 'all' \? filters\.recurrence : ''\)/u);
	assert.match(quickCreateSource, /if \(!normalizedTitle \|\| busy\) return;[\s\S]*?busy = true;[\s\S]*?try \{[\s\S]*?await createPack/u);
	assert.match(workQuickAddSource, /onCreated\?: \(\) => void;/u);
	assert.match(quickCreateSource, /await createPack\([\s\S]*?\}\);[\s\S]*?onCreated\?\.\(\);/u);
	for (const field of ['title', 'proofTarget', 'owner', 'area', 'type', 'due', 'energy', 'recurrence']) {
		assert.match(quickCreateSource, new RegExp(`${field} = '';`, 'u'));
	}
	assert.match(quickCreateSource, /await createPack\([\s\S]*?title = '';[\s\S]*?proofTarget = '';[\s\S]*?owner = '';[\s\S]*?area = '';[\s\S]*?type = '';[\s\S]*?due = '';[\s\S]*?energy = '';[\s\S]*?recurrence = '';[\s\S]*?\} catch \{[\s\S]*?displayToast\('Quick create failed', 'error'\);/u);
	assert.equal((workQuickAddSource.match(/await createPack\(/gu) ?? []).length, 1);
	assert.match(quickCreateSource, /finally \{[\s\S]*?busy = false;[\s\S]*?setTimeout\(\(\) => form\?\.querySelector<HTMLInputElement>\('\.quick-create-input'\)\?\.focus\(\), 0\);/u);
	assert.match(workQuickAddSource, /<summary>Work details <span>Optional<\/span><\/summary>[\s\S]*?Quick-add owner[\s\S]*?Quick-add area[\s\S]*?Quick-add type[\s\S]*?Quick-add due date[\s\S]*?Quick-add energy[\s\S]*?Quick-add recurrence[\s\S]*?Quick-add proof target/u);
	assert.match(workQuickAddSource, /<WornInput id="work-quick-due" class="quick-due-input" type="date"/u);
	assert.match(workQuickAddSource, /\.quick-create-options summary\{[\s\S]*?background:var\(--worn-surface\)[\s\S]*?border:1px solid var\(--worn-border-strong\)[\s\S]*?cursor:pointer[\s\S]*?\.quick-create-options summary::after\{content:'›'[\s\S]*?\.quick-create-options\[open\] summary::after\{transform:rotate\(90deg\)[\s\S]*?\.quick-create-options summary:focus-visible\{outline:2px dashed var\(--worn-focus\)/u);
	assert.match(workQuickAddSource, /\.quick-create-details-grid :global\(\.quick-due-input\)\{max-inline-size:200px\}/u);
	assert.match(workListCardSource, /\{#if pack\.energy \|\| pack\.location \|\| pack\.milestone \|\| pack\.doneWhen\}[\s\S]*?<dt>Proof target<\/dt><dd>\{pack\.doneWhen\}<\/dd>/u);
	assert.match(workQuickAddSource, /\.quick-create-details-grid\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[\s\S]*?@media\(max-width:420px\)[\s\S]*?\.quick-create-details-grid\{grid-template-columns:minmax\(0,1fr\)\}/u);
	assert.match(workQuickAddSource, /@media\(max-width:500px\)\{\s*\.quick-create-row\{margin-inline:4px\}\s*\}/u);
	assert.doesNotMatch(quickCreateSource, /localStorage|saveBrowserState|fetch\(/u);
	assert.doesNotMatch(routeSource, /async function quickCreate\(|await createPack\(|let quick(?:Title|ProofTarget|Owner|Area|Type|Due|Energy|Recurrence)\s*=|<form[^>]*quick-create-row|\.quick-create-row\{/u);
	const createPackSource = demoClientSource.match(/export async function createPack[\s\S]*?\n\}\n\nexport function packPathSignature/u)?.[0] ?? '';
	assert.match(demoClientSource, /const CREATE_PACK_FIELDS = new Set\(\[[\s\S]*?'title',[\s\S]*?'status',[\s\S]*?'next',[\s\S]*?'blocker',[\s\S]*?'owner',[\s\S]*?'area',[\s\S]*?'type',[\s\S]*?'due',[\s\S]*?'energy',[\s\S]*?'recurrence',[\s\S]*?'purpose',[\s\S]*?'doneWhen'[\s\S]*?\]\);/u);
	assert.match(createPackSource, /Object\.keys\(payload\)\.filter\(\(field\) => !CREATE_PACK_FIELDS\.has\(field\)\)\.sort\(\)[\s\S]*?Work creation does not support field/u);
	assert.match(createPackSource, /const summary = `Created \$\{formatWorkTitle\(fields\.title\)\}\.`;[\s\S]*?const receipt: DemoReceipt = \{ summary, pack \};[\s\S]*?draft\.actionReceipt = receipt;[\s\S]*?if \(!state\?\.actionReceipt\?\.pack\) throw new ChallengeStateError\('Created work did not return a receipt\.'\);/u);
	assert.match(createPackSource, /const due = normalizeText\(payload\.due, 40\);[\s\S]*?!parseDateOnly\(due\)[\s\S]*?const energy = normalizeText\(payload\.energy, 40\);[\s\S]*?!PACK_ENERGIES\.includes\(energy\)/u);
	for (const [field, limit] of [['owner', 120], ['area', 120], ['type', 120], ['recurrence', 120], ['purpose', 1000], ['doneWhen', 1000]]) {
		assert.match(createPackSource, new RegExp(`const ${field} = normalizeText\\(payload\\.${field}, ${limit}\\);`, 'u'));
	}
	assert.doesNotMatch(createPackSource, /\.\.\.payload/u);
});

test('Work Focus mode requires selected work before claiming an active state', () => {
	assert.match(routeSource, /let selectedProjectId = \$derived\(__NEBIUS_EDITION__ \? \$demoState\?\.selectedProjectId \?\? null : null\);/u);
	assert.match(routeSource, /let scopedPacks = \$derived\(selectedProjectId \? packs\.filter\(pack => pack\.projectId === selectedProjectId\) : packs\);/u);
	const toggleFocusSource = routeSource.match(/function toggleFocusMode\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	const windowKeysSource = routeSource.match(/function handleWindowKeys\(e: KeyboardEvent\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(toggleFocusSource, /if \(!focusMode && !scopedSelectedId\) \{[\s\S]*?displayToast\('Select a work item before turning on Focus\.', 'info'\);[\s\S]*?return;[\s\S]*?\}/u);
	assert.match(toggleFocusSource, /focusMode = !focusMode;[\s\S]*?document\.documentElement\.classList\.toggle\('focus-mode', focusMode\);[\s\S]*?if \(focusMode\) displayToast\('Focus on\. Press F to exit\.', 'info'\);/u);
	assert.match(windowKeysSource, /if \(shortcutHelpOpen \|\| editing\) return;[\s\S]*?if \(\s*\(e\.key === 'f' \|\| e\.key === 'F'\)[\s\S]*?!e\.repeat[\s\S]*?e\.preventDefault\(\);[\s\S]*?toggleFocusMode\(\);[\s\S]*?return;/u);
	assert.match(routeSource, /<WornIconButton[^>]*label="Focus"[^>]*title=\{focusMode \? 'Exit Focus \(F\)' : scopedSelectedId \? 'Focus on selected work \(F\)' : 'Select a work item to use Focus'\}[^>]*data-action="focus-mode"[^>]*aria-pressed=\{focusMode\}[^>]*disabled=\{!focusMode && !scopedSelectedId\}[^>]*onclick=\{toggleFocusMode\}[^>]*>/u);
});

test('Quick Add and the canonical create owner share one explicit title-length boundary', () => {
	assert.match(demoClientSource, /export const DEMO_WORK_TITLE_MAX_LENGTH = WORK_TITLE_MAX_LENGTH;/u);
	assert.match(
		demoClientSource,
		/export async function createPack[\s\S]*?const title = normalizeWorkTitle\(payload\.title\);/u
	);
	assert.match(workQuickAddSource, /DEMO_WORK_TITLE_MAX_LENGTH,[\s\S]*?\} from '\$lib\/demo-client';/u);
	assert.match(
		workQuickAddSource,
		/function setHumanQuickTitle\(event: Event\) \{[\s\S]*?normalizeWorkTitle\(input\.value\) === null[\s\S]*?input\.value = title;[\s\S]*?return;[\s\S]*?title = input\.value;[\s\S]*?\}/u
	);
	assert.match(
		workQuickAddSource,
		/<WornInput[\s\S]*?class="quick-create-input"[\s\S]*?bind:value=\{title\}[\s\S]*?oninput=\{setHumanQuickTitle\}[\s\S]*?aria-describedby="quick-create-title-help"/u
	);
	assert.doesNotMatch(workQuickAddSource, /input\.value\.slice\(/u);
});

test('expanded Recent activity follows the Work page heading hierarchy', () => {
	assert.match(activitySource, /function latestActivityCandidate\([\s\S]*?pack: DemoPack,[\s\S]*?accepts: \(entry: ActivityEntry\) => boolean,[\s\S]*?preferLaterTie = false[\s\S]*?if \(!candidate\.text \|\| !accepts\(candidate\)\) continue;/u);
	assert.match(activitySource, /const latest = latestActivityCandidate\([\s\S]*?normalizedActivityAt\(entry\.at\)[\s\S]*?entry\.text\.trim\(\)[\s\S]*?activityTextWithoutActor\(entry\)\.trim\(\)\.toLowerCase\(\) !== 'archived\.'[\s\S]*?true[\s\S]*?\);/u);
	assert.equal(activitySource.match(/latestActivityCandidate\(/gu)?.length, 2);
	assert.doesNotMatch(activitySource, /acceptsAnyActivity|accepts:\s*\(entry: ActivityEntry\) => boolean\s*=\s*[A-Za-z_$]/u);
	assert.match(routeSource, /import WorkRecentActivity from '\.\/WorkRecentActivity\.svelte';[\s\S]*?<WorkRecentActivity \{packs\} \/>/u);
	assert.doesNotMatch(routeSource, /RECENT_ACTIVITY_LIMIT|allRecentActivity|recentActivity|recentTimelineEntries|recentPackActivity|activityEvidenceText|activityActor|demo-work-recent/u);
	assert.match(workRecentActivitySource, /const RECENT_ACTIVITY_LIMIT = 6;[\s\S]*?recentPackActivity\(packs, Math\.max\(RECENT_ACTIVITY_LIMIT, packs\.length\)\)\.slice\(0, RECENT_ACTIVITY_LIMIT\)/u);
	assert.match(workRecentActivitySource, /description: activityEvidenceText\(entry\),[\s\S]*?href: canSetNextAction\([\s\S]*?\? `\/next\?pack=\$\{encodeURIComponent\(entry\.packId\)\}`[\s\S]*?: `\/work\?focus=\$\{encodeURIComponent\(entry\.packId\)\}`,[\s\S]*?meta: activityActor\(entry\) \|\| undefined,[\s\S]*?title: entry\.packTitle/u);
	const recentTimeline = workRecentActivitySource.match(/<WornAccordion label="Recent activity">[\s\S]*?<WornTimeline[\s\S]*?\/>/u)?.[0] ?? '';
	assert.match(recentTimeline, /entries=\{timelineEntries\}[\s\S]*?ariaLabel="Recent work activity"[\s\S]*?density="compact"/u);
	assert.match(recentTimeline, /headingLevel=\{2\}/u);
	assert.doesNotMatch(recentTimeline, /headingLevel=\{3\}/u);
	assert.match(workRecentActivitySource, /:global\(\.demo-work-recent-timeline\)\{--worn-timeline-max-inline-size:100%;margin-top:6px\}/u);
	assert.doesNotMatch(workRecentActivitySource, /fetch\(|localStorage|sessionStorage|saveBrowserState|createPack|runPackAction/u);
	assert.deepEqual(recentPackActivity([
		{ id: 'active', title: 'Active', archived: false, activity: ['[2026-09-03 12:00:00] Started.'] },
		{ id: 'archived', title: 'Archived', archived: true, activity: ['[2026-09-03 13:00:00] Started.'] }
	]), [{ at: '2026-09-03 12:00:00', text: 'Started.', packId: 'active', packTitle: 'Active' }]);
});

test('Work waits for first workspace resolution before rendering a real empty state', () => {
	assert.match(routeSource, /let workspaceLoaded = \$derived\(\$demoState !== null\);/u);
	assert.match(routeSource, /<WornPage[^>]*loading=\{!workspaceLoaded && \(\$demoStateLoading \|\| !\$demoStateError\)\}/u);
	assert.equal(
		routeSource.match(/workspaceLoaded && visible\.length === 0/gu)?.length,
		2,
		'Both density views gate their empty state on completed workspace hydration'
	);
});

test('Work keeps the static edition stage label and gives Nebius a direct Work overview', () => {
	assert.match(routeSource, /sectionLabel=\{__NEBIUS_EDITION__ \? 'Work overview' : 'Step 1 of 3 · Observe'\}/u);
	assert.doesNotMatch(routeSource, /Step 1 of 3 · Inspect/u);
	assert.match(routeSource, /\$\{blockedCount\} with blockers/u);
	assert.match(routeSource, /Edit the task or ask Nebius for help/u);
	assert.match(routeSource, /Open next step/u);
	for (const source of [workGridCardSource, workListCardSource]) {
		assert.match(source, /NEBIUS_EDITION && pack\.nextStep/u);
		assert.match(source, />Next step</u);
		assert.match(source, /data-nebius-written-next-step/u);
	}
	assert.match(workDecisionWorkspaceSource, /let workspaceOpen = \$state\(false\);[\s\S]*?if \(resumed \|\| pendingDraft\) workspaceOpen = true/u);
	assert.doesNotMatch(workDecisionWorkspaceSource, /matchMedia|onMount/u);
	assert.match(workDecisionWorkspaceSource, /<details class="decision-workspace-disclosure" bind:open=\{workspaceOpen\}>[\s\S]*?<summary class="decision-workspace-summary">[\s\S]*?\{workspaceOpen \? 'Hide details' : 'Review decision'\}/u);
	assert.match(workDecisionWorkspaceSource, /aria-label="Observe, narrow, prepare, decide"[\s\S]*?<span>Observe<\/span>[\s\S]*?<span>Narrow<\/span>[\s\S]*?<span>Prepare<\/span>[\s\S]*?<span>Decide<\/span>/u);
});

test('Work names its command surface and gives card energy and drag explicit controls', () => {
	assert.match(routeSource, /import Command from '@lucide\/svelte\/icons\/command';/u);
	assert.match(routeSource, /<WornButton[\s\S]*?class="work-command-trigger"[\s\S]*?aria-label="Command palette"[\s\S]*?<Command aria-hidden="true" \/>[\s\S]*?<span>Commands<\/span>/u);
	const listCardSurface = workListCardSource.match(/<WornFoldedSurface[\s\S]*?>/u)?.[0] ?? '';
	assert.doesNotMatch(listCardSurface, /\bdraggable=/u);
	assert.doesNotMatch(listCardSurface, /\bondragstart=/u);
	assert.match(workListCardSource, /class="work-card-move-handle"[\s\S]*?draggable="true"[\s\S]*?data-work-drag-handle[\s\S]*?Drag to reorder or change energy/u);
	assert.match(workListCardSource, /<label for=\{energySelectId\}>Energy<\/label>[\s\S]*?<WornSelect[\s\S]*?data-action="set-energy"[\s\S]*?aria-label=\{`Set energy for \$\{workTitle\(pack\)\}`\}[\s\S]*?onSetEnergy/u);
	assert.match(routeSource, /async function setPackEnergy\(pack: DemoPack, energy: string\)[\s\S]*?!PACK_ENERGIES\.includes\(energy\)[\s\S]*?savePackBrowserFields\(pack\.id[\s\S]*?target\.energy = energy/u);
	assert.match(routeSource, /<WorkListCard[\s\S]*?onSetEnergy=\{setPackEnergy\}/u);
});
