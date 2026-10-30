import { normalizeWorkSearch, routeWorkSearch, visibleDecisionDecider } from '../svelte-frontend/src/routes/work/work-view-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';



import { savedNebiusLinkDestination, decisionWorkspaceReviewHref, decisionWorkspaceWorkFocusRequest, pendingDecisionWorkHref } from '../svelte-frontend/src/lib/decision-workspace-navigation.mjs';
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

test('intake fields clear their previous validation error when edited', () => {
	for (const [id, field, event] of [['notes', 'notesError', 'oninput'], ['source', 'sourceError', 'oninput'], ['project', 'projectError', 'onchange']]) {
		assert.match(workQuickAddSource, new RegExp(`id="work-quick-${id}"[^\\n]*${event}=\\{\\(\\) => \\{ ${field} = ''; \\}\\}`));
	}
});

test('current navigation has a non-color cue and narrow Work actions wrap as controls', () => {
	const layout = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/+layout.svelte'), 'utf8');
	assert.match(layout, /\.challenge-nav-control\[aria-current='page'\] \{\s*text-decoration-line: underline;\s*text-decoration-thickness: 2px;\s*text-underline-offset: \.25em;/u);
	assert.match(routeSource, /@media\(max-width:420px\)\{[\s\S]*?\.work-head-actions\{flex-wrap:wrap;gap:4px;justify-content:flex-start;width:100%\}/u);
});
const workRecentActivitySource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkRecentActivity.svelte'), 'utf8');
const workShortcutHelpSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkShortcutHelp.svelte'), 'utf8');
const workBatchActionsSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/WorkBatchActions.svelte'), 'utf8');
const demoClientSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-client.ts'), 'utf8');
const workGridCardSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/components/WorkGridCard.svelte'), 'utf8');
const demoCssSource = fs.readFileSync(path.join(repoRoot, 'assets/demo.css'), 'utf8');
const workListCardSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/components/WorkListCard.svelte'), 'utf8');

const workMetadataSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/work-metadata.mjs'), 'utf8');
const helperSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/work-view-helpers.mjs'), 'utf8');
const activitySource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/activity.ts'), 'utf8');
const workflowSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-workflow.ts'), 'utf8');
const decisionNavigationSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/decision-workspace-navigation.mjs'), 'utf8');
const workInteractionSmokeSource = fs.readFileSync(path.join(repoRoot, 'scripts/work-interaction-polish-smoke.mjs'), 'utf8');
const frontendRequire = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const ts = frontendRequire('typescript');



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
	for (const source of [routeSource, workGridCardSource, workListCardSource]) {
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
		/const editing = tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT' \|\| Boolean\(\(e\.target as HTMLElement\)\?\.isContentEditable\);[\s\S]*?if \(editing\) return;[\s\S]*?if \(\(e\.key === 'f' \|\| e\.key === 'F'\) && !e\.ctrlKey && !e\.metaKey && !e\.altKey && !e\.repeat\) \{\s*e\.preventDefault\(\);\s*toggleFocusMode\(\);\s*return;\s*\}/u
	);
	assert.equal(windowKeys.match(/e\.key === 'f'/gu)?.length, 1);
	assert.doesNotMatch(windowKeys, /e\.key === '\?'/u);
	assert.match(routeSource, /import WorkShortcutHelp from '\.\/WorkShortcutHelp\.svelte';[\s\S]*?let shortcutHelpOpen = \$state\(false\);[\s\S]*?<WorkShortcutHelp bind:open=\{shortcutHelpOpen\} \/>/u);
	assert.doesNotMatch(routeSource, /showShortcutHelp|Keyboard shortcuts \(\?\)|shortcut-grid|shortcut-actions|data-action="work-shortcuts"/u);
	assert.match(workShortcutHelpSource, /let \{ open = \$bindable\(false\) \}[\s\S]*?event\.key !== '\?'[\s\S]*?!open && \(tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT' \|\| target\?\.isContentEditable\)[\s\S]*?open = !open;/u);
	assert.match(workShortcutHelpSource, /<svelte:window onkeydown=\{handleShortcutKey\} \/>[\s\S]*?data-action="work-shortcuts"[\s\S]*?<WornDialog bind:open title="Keyboard shortcuts" size="sm">/u);
	assert.match(workShortcutHelpSource, /<WornKbd keys=\{\['F'\]\} \/><\/dt><dd>Toggle focus mode<\/dd>/u);
	assert.match(workShortcutHelpSource, /<WornKbd keys=\{\['C \/ N'\]\} \/><\/dt><dd>\{NEBIUS_EDITION \? 'Open Add work' : 'Focus quick-add when available'\}<\/dd>[\s\S]*?<WornKbd keys=\{\['\?'\]\} \/><\/dt><dd>Toggle help<\/dd>/u);
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
	assert.match(workShortcutHelpSource, /<WornKbd keys=\{\['O \/ Enter'\]\} \/><\/dt><dd>\{NEBIUS_EDITION \? 'Open task' : 'Open next-action editor'\}<\/dd>/u);
	assert.doesNotMatch(workShortcutHelpSource, /<WornKbd keys=\{\['O'\]\} \/><\/dt><dd>Open details<\/dd>/u);
});





test('Decision Workspace uses one exact encoded Review destination for visible and reader handoffs', () => {
	const exactId = '  review / exact id  ';
	const longExactId = ` ${'r'.repeat(201)} / exact `;
	assert.equal(decisionWorkspaceReviewHref(exactId), '/next?pack=%20%20review%20%2F%20exact%20id%20%20&view=review');
	assert.equal(decisionWorkspaceReviewHref(longExactId), `/next?pack=${encodeURIComponent(longExactId)}&view=review`);
	assert.equal(new URL(decisionWorkspaceReviewHref(exactId), 'http://example.test').searchParams.get('pack'), exactId);
	assert.equal(new URL(decisionWorkspaceReviewHref(longExactId), 'http://example.test').searchParams.get('pack'), longExactId);
	assert.equal(savedNebiusLinkDestination('review', { search: '?focus=one&focus=two', hash: '' }).href, '/work?filter=review');
	assert.equal(savedNebiusLinkDestination('review', { search: '?focus=', hash: '' }).href, '/work?filter=review');
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





test('Work search normalizes safe URL arrival', () => {
	assert.equal(normalizeWorkSearch('  Research  '), 'Research');
	assert.equal(routeWorkSearch('  Research  '), 'Research');
	assert.equal(normalizeWorkSearch('x'.repeat(121)), null);
	assert.equal(normalizeWorkSearch('line\nbreak'), null);
	assert.equal(routeWorkSearch('x'.repeat(121)), '');
	assert.equal(routeWorkSearch('line\nbreak'), '');
	assert.equal(routeWorkSearch(null), '');
	assert.match(routeSource, /function applyRouteWorkSearch\(searchParam: unknown\)[\s\S]*?const routeSearch = routeWorkSearch\(searchParam\);[\s\S]*?query = routeSearch;[\s\S]*?debouncedQuery = routeSearch;/u);
	assert.match(routeSource, /const routeSearch = applyRouteWorkSearch\(\$page\.url\.searchParams\.get\('search'\)\);/u);
	assert.match(routeSource, /void focusRouteWorkSearchArrival\(routeSearch\);/u);
	const arrival = routeSource.match(/function applyRouteWorkSearch[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.doesNotMatch(arrival, /fetch\(|localStorage|sessionStorage|goto\(|runPackAction|registerPageTools/u);
});

test('Work search uses one explicit length boundary', () => {
	assert.match(helperSource, /export const WORK_SEARCH_MAX_LENGTH = 120;/u);
	assert.match(helperSource, /query\.length <= WORK_SEARCH_MAX_LENGTH \? query : null/u);
	assert.match(workFilterControlsSource, /import \{ WORK_SEARCH_MAX_LENGTH \} from '\.\/work-view-helpers\.mjs';/u);
	assert.match(workFilterControlsSource, /function setHumanWorkSearch\(nextQuery: string\) \{[\s\S]*?query = nextQuery\.slice\(0, WORK_SEARCH_MAX_LENGTH\);[\s\S]*?\}/u);
	assert.match(workFilterControlsSource, /<WornInput[\s\S]*?type="search"[\s\S]*?maxlength=\{WORK_SEARCH_MAX_LENGTH\}[\s\S]*?bind:value=\{query\}[\s\S]*?oninput=\{\(\) => setHumanWorkSearch\(query\)\}/u);
});







test('repeated Work and Review action disclosures include their visible work title', () => {
	assert.match(workListCardSource, /<WornAccordion label="Other actions" description=\{workTitle\(pack\)\}>/u);

	assert.equal(workListCardSource.match(/<WornAccordion label="Other actions"/gu)?.length, 1);

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
		assert.match(source, /let titleHref = \$derived\([\s\S]*?canSetNextAction\(pack\)[\s\S]*?`\/next\?pack=\$\{encodeURIComponent\(pack\.id \|\| ''\)\}`/u);
		assert.match(source, /\{#if canSetNextAction\(pack\) && \(!commandHref \|\| commandHref !== titleHref\)\}/u);
		assert.match(source, /\{:else\}[\s\S]*?data-work-terminal-title/u);
		assert.doesNotMatch(source, /commandHref === titleHref/u);
	}
	assert.match(workListCardSource, /NEBIUS_EDITION \? `\/next\?pack=[^\n]*&view=review'[^\n]*: null\);/u);
	assert.match(workGridCardSource, /: NEBIUS_EDITION \? `\/next\?pack=\$\{encodeURIComponent\(pack\.id \|\| ''\)\}&view=review` : null\);/u);
	assert.match(workGridCardSource, /aria-label=\{canSetNextAction\(pack\) \? \(NEBIUS_EDITION \? `Open task \$\{workTitle\(pack\)\}` : `Set the next action for \$\{workTitle\(pack\)\}`\) : `View task history for \$\{workTitle\(pack\)\}`\}/u);
	assert.match(workGridCardSource, /<a class="grid-card-title" href=\{titleHref\}/u);
	assert.match(workListCardSource, /class="demo-card-title"[\s\S]*?href=\{titleHref\}/u);
});



test('Quick Add stays available through the one createPack path in both Work densities', () => {
	assert.equal((routeSource.match(/<WorkQuickAdd/gu) ?? []).length, 1, 'Work renders one route-local Quick Add owner');
	assert.equal((workQuickAddSource.match(/<form[\s\S]*?class="quick-create-row"/gu) ?? []).length, 1, 'Quick Add owns one form');
	assert.match(workQuickAddSource, /<form[\s\S]*?class="quick-create-row"[^>]*aria-label=\{__NEBIUS_EDITION__ \? 'Add work' : 'Quick add a work item'\}/u);
	const quickAddIndex = routeSource.indexOf('<WorkQuickAdd');
	const densityPanelsIndex = routeSource.indexOf('{#each densityPanelTabs');
	assert.ok(quickAddIndex >= 0 && quickAddIndex < densityPanelsIndex, 'Quick Add is owned once outside the density panels');
	assert.match(routeSource, /import WorkQuickAdd from '\.\/WorkQuickAdd\.svelte';[\s\S]*?let quickAddBusy = \$state\(false\);[\s\S]*?disabled: quickAddBusy[\s\S]*?<WorkQuickAdd[\s\S]*?filters=\{\{ owner: ownerFilter, area: areaFilter, energy: energyFilter, recurrence: recurrenceFilter \}\}[\s\S]*?bind:busy=\{quickAddBusy\}/u);
	assert.match(routeSource, /function revealQuickAddReceipt\(pack: DemoPack\) \{[\s\S]*?dismissedReceiptSummary = '';[\s\S]*?revealReceipt\(\);[\s\S]*?\}/u);
	assert.match(routeSource, /<WorkQuickAdd[\s\S]*?onCreated=\{revealQuickAddReceipt\}[\s\S]*?bind:busy=\{quickAddBusy\}/u);
	assert.match(routeSource, /\(e\.key === 'n' \|\| e\.key === 'c'\)[\s\S]*?quickAdd\.openIntake\(\)/u);
	assert.doesNotMatch(workQuickAddSource, /@media\(max-width:420px\)\{[\s\S]*?\.quick-create-row\{display:none\}/u);
	const quickCreateSource = workQuickAddSource.match(/async function quickCreate\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	for (const field of ['proofTarget', 'owner', 'area', 'type', 'due', 'energy', 'recurrence']) {
		assert.match(workQuickAddSource, new RegExp(`let ${field} = \\$state\\(''\\);`, 'u'));
	}
	assert.match(quickCreateSource, /const normalizedProofTarget = proofTarget\.trim\(\);[\s\S]*?const normalizedOwner = owner\.trim\(\)[\s\S]*?const normalizedArea = area\.trim\(\)[\s\S]*?const normalizedType = type\.trim\(\);[\s\S]*?const normalizedDue = due\.trim\(\);[\s\S]*?PACK_ENERGIES\.includes\(energy\)[\s\S]*?const normalizedRecurrence = recurrence\.trim\(\)[\s\S]*?await createPack\(\{[\s\S]*?title: normalizedTitle,[\s\S]*?status: __NEBIUS_EDITION__ \? 'draft' : 'active',[\s\S]*?next: 'Open',[\s\S]*?doneWhen: normalizedProofTarget \|\| undefined,[\s\S]*?owner: normalizedOwner \|\| undefined,[\s\S]*?area: normalizedArea \|\| undefined,[\s\S]*?type: normalizedType \|\| undefined,[\s\S]*?due: normalizedDue \|\| undefined,[\s\S]*?energy: normalizedEnergy \|\| undefined,[\s\S]*?recurrence: normalizedRecurrence \|\| undefined/u);
	assert.match(quickCreateSource, /normalizedOwner = owner\.trim\(\) \|\| \(filters\.owner !== 'all' && filters\.owner !== '_unassigned' \? filters\.owner : ''\)/u);
	assert.match(quickCreateSource, /normalizedArea = area\.trim\(\) \|\| \(filters\.area !== 'all' && filters\.area !== '_none' \? filters\.area : ''\)/u);
	assert.match(quickCreateSource, /normalizedEnergy = PACK_ENERGIES\.includes\(energy\)[\s\S]*?filters\.energy !== 'all' && PACK_ENERGIES\.includes\(filters\.energy\) \? filters\.energy : ''/u);
	assert.match(quickCreateSource, /normalizedRecurrence = recurrence\.trim\(\) \|\| \(filters\.recurrence !== 'all' \? filters\.recurrence : ''\)/u);
	assert.match(quickCreateSource, /if \(busy\) return;[\s\S]*?else if \(!normalizedTitle\) titleError[\s\S]*?busy = true;[\s\S]*?try \{[\s\S]*?await createPack/u);
	assert.match(workQuickAddSource, /onCreated\?: \(pack: DemoPack\) => void \| Promise<void>;/u);
	assert.match(quickCreateSource, /await createPack\([\s\S]*?\}\);[\s\S]*?onCreated\?\.\(result\.pack\);/u);
	for (const field of ['title', 'proofTarget', 'owner', 'area', 'type', 'due', 'energy', 'recurrence']) {
		assert.match(workQuickAddSource.match(/function resetDraft\(\)[\s\S]*?\n\t\}/u)?.[0] ?? '', new RegExp(`${field} = '';`, 'u'));
	}
	assert.match(quickCreateSource, /await createPack\([\s\S]*?\} catch \(error\) \{[\s\S]*?displayToast\('Quick create failed', 'error'\);[\s\S]*?return;[\s\S]*?resetDraft\(\);/u);
	assert.equal((workQuickAddSource.match(/await createPack\(/gu) ?? []).length, 1);
	assert.match(quickCreateSource, /busy = false;[\s\S]*?await tick\(\);[\s\S]*?if \(restoreFocus\)[\s\S]*?else form\?\.querySelector<HTMLInputElement>\('\.quick-create-input'\)\?\.focus\(\);/u);
	assert.match(workQuickAddSource, /<summary>Work details <span>Optional<\/span><\/summary>[\s\S]*?Owner \(optional\)[\s\S]*?Area \(optional\)[\s\S]*?Type \(optional\)[\s\S]*?Due date \(optional\)[\s\S]*?Energy \(optional\)[\s\S]*?Recurrence \(optional\)[\s\S]*?Proof target \(optional\)/u);
	assert.match(workQuickAddSource, /<WornInput id="work-quick-due" class="quick-due-input" type="date"/u);
	assert.match(workQuickAddSource, /\.quick-create-options summary\{[\s\S]*?background:var\(--worn-surface\)[\s\S]*?border:1px solid var\(--worn-border-strong\)[\s\S]*?cursor:pointer[\s\S]*?\.quick-create-options summary::after\{content:'›'[\s\S]*?\.quick-create-options\[open\] summary::after\{transform:rotate\(90deg\)[\s\S]*?\.quick-create-options summary:focus-visible\{outline:2px dashed var\(--worn-focus\)/u);
	assert.match(workQuickAddSource, /\.quick-create-details-grid :global\(\.quick-due-input\)\{max-inline-size:200px\}/u);
	assert.match(workListCardSource, /\{#if pack\.energy \|\| pack\.location \|\| pack\.milestone \|\| pack\.doneWhen\}[\s\S]*?<dt>Proof target<\/dt><dd>\{pack\.doneWhen\}<\/dd>/u);
	assert.match(workQuickAddSource, /\.quick-create-details-grid\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)[\s\S]*?@media\(max-width:700px\)[\s\S]*?\.quick-create-details-grid\{grid-template-columns:minmax\(0,1fr\)\}/u);
	assert.match(workQuickAddSource, /@media\(max-width:500px\)\{\s*\.quick-create-row\{margin-inline:4px\}/u);
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
	assert.match(windowKeysSource, /if \(editing\) return;[\s\S]*?if \(\s*\(e\.key === 'f' \|\| e\.key === 'F'\)[\s\S]*?!e\.repeat[\s\S]*?e\.preventDefault\(\);[\s\S]*?toggleFocusMode\(\);[\s\S]*?return;/u);
	assert.match(routeSource, /<WornIconButton[^>]*label="Focus"[^>]*title=\{focusMode \? 'Exit Focus \(F\)' : scopedSelectedId \? 'Focus on selected work \(F\)' : 'Select a work item to use Focus'\}[^>]*data-action="focus-mode"[^>]*aria-pressed=\{focusMode\}[^>]*disabled=\{!focusMode && !scopedSelectedId\}[^>]*onclick=\{toggleFocusMode\}[^>]*>/u);
});

test('Nebius Add work exposes one labelled draft form before filters and through Commands', () => {
	assert.ok(routeSource.indexOf('<WorkQuickAdd') < routeSource.indexOf('<WorkFilterControls'));
	assert.match(routeSource, /id: 'add-work',[\s\S]*?label: __NEBIUS_EDITION__ \? 'Add work'[\s\S]*?quickAdd\?\.openIntake\(\)/u);
	assert.match(workQuickAddSource, /id="work-add-trigger"[^>]*aria-expanded=\{open\}[^>]*onclick=\{openIntake\}>Add work/u);
	assert.match(workQuickAddSource, /\{#if !__NEBIUS_EDITION__ \|\| open\}\s*<form/u);
	assert.match(workQuickAddSource, /Task title \(required\)/u);
	for (const [id, label] of [['notes', 'Notes'], ['source', 'Source link'], ['project', 'Project']]) {
		assert.ok(workQuickAddSource.includes(`for="work-quick-${id}">${label} (optional)`));
	}
	assert.match(workQuickAddSource, /projectId = selectedProjectId \?\? '';/u);
	assert.match(workQuickAddSource, /status: __NEBIUS_EDITION__ \? 'draft' : 'active'/u);
	assert.match(workQuickAddSource, /\{ notes, sourceUrl: sourceUrl\.trim\(\), projectId: projectId \|\| null \}/u);
	assert.match(workQuickAddSource, /'Save draft' : 'Add'/u);
	assert.doesNotMatch(workQuickAddSource, /runPackAction|execute|fetch\(|localStorage|saveBrowserState/u);
});

test('Nebius intake keeps failure values, field-linked errors, and ordinary multiline Notes', () => {
	const quickCreate = workQuickAddSource.match(/async function quickCreate\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	const failure = quickCreate.match(/\} catch \(error\) \{([\s\S]*?)\n\t\t\}/u)?.[1] ?? '';
	assert.ok(failure.includes('saveError ='), 'The persistence failure branch remains explicit');
	assert.doesNotMatch(failure, /resetDraft\(|title =|notes =|sourceUrl =|projectId =/u);
	for (const field of ['title', 'notes', 'source', 'project']) {
		assert.ok(workQuickAddSource.includes(`work-quick-${field}-error`));
	}
	assert.match(workQuickAddSource, /querySelector<HTMLElement>\('\[aria-invalid="true"\]'\)\?\.focus\(\)/u);
	assert.match(workQuickAddSource, /<WornTextarea id="work-quick-notes"[^>]*rows=\{4\}[^>]*bind:value=\{notes\}/u);
	assert.doesNotMatch(workQuickAddSource, /onkeydown|onkeypress|onkeyup/u, 'Notes Enter remains a newline; submission belongs to the form');
	const cancel = workQuickAddSource.match(/async function cancelIntake\(\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(cancel, /resetDraft\(\); open = false;[\s\S]*?work-add-trigger/u);
	assert.doesNotMatch(cancel, /createPack|saveBrowserState|undoCreatedPack/u);
});

test('Nebius intake confirms through Open task and guarded Undo with one existing success announcer', () => {
	assert.equal((workQuickAddSource.match(/await undoCreatedPack\(/gu) ?? []).length, 1);
	assert.match(workQuickAddSource, /await undoCreatedPack\(created\.undoToken\);/u);
	assert.match(workQuickAddSource, /data-work-intake-confirmation[\s\S]*?id="work-intake-open-task"[^>]*href=\{`\/next\?pack=\$\{encodeURIComponent\(created\.pack\.id\)\}&view=brief`\}/u);
	assert.match(workQuickAddSource, /id="work-intake-undo"[^>]*onclick=\{undoCreation\}>Undo/u);
	assert.match(workQuickAddSource, /onCreated\?\.\(result\.pack\);[\s\S]*?busy = false;[\s\S]*?await tick\(\);[\s\S]*?if \(restoreFocus\)/u);
	assert.match(workQuickAddSource, /const sourceElement = document\.activeElement;[\s\S]*?const beganOnUndo = sourceElement\?\.id === 'work-intake-undo';[\s\S]*?busy = true;[\s\S]*?const restoreFocus = beganOnUndo/u);
	assert.match(workQuickAddSource, /created = null; onUndone\?\.\(\); busy = false;[\s\S]*?await tick\(\);[\s\S]*?if \(restoreFocus &&/u);
	assert.doesNotMatch(workQuickAddSource, /aria-live|role="(?:alert|status)"|displayToast\([^;]*'success'/u);
});

test('Nebius reveal keeps the chosen project and respects unsaved project editors', () => {
	const reveal = routeSource.match(/async function revealQuickAddReceipt\(pack: DemoPack\) \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.match(reveal, /const targetProjectId = pack\.projectId \?\? null;/u);
	assert.match(reveal, /selectedProjectId !== targetProjectId && \(!projectWorkspace \|\| projectWorkspace\.canChangeScope\(\)\)[\s\S]*?await selectProject\(targetProjectId\);/u);
	assert.match(reveal, /await clearAllFilters\(false\);/u);
	assert.doesNotMatch(reveal, /selectProject\(null\)|discard|goto\(/u);
	assert.match(reveal, /dismissedReceiptSummary = \$demoState\?\.actionReceipt\?\.summary \?\? '';/u);
});

// Execute the actual component handler, without duplicating its persistence or
// callback failure logic. DOM focus and create/reveal are bounded test doubles.
async function runIntakeHandler({ failCreate = false } = {}) {
	const calls = { create: 0, reveal: 0, reset: 0, focus: [], toasts: [] };
	const pack = { id: 'saved-draft', title: 'Retained draft', status: 'draft' };
	const undoToken = { packId: pack.id, expectedSignature: 'saved-signature', previousSelectedId: null };
	const input = {};
	const context = vm.createContext({
		__NEBIUS_EDITION__: true, URL, Error,
		busy: false, open: true, title: 'Retained draft', notes: 'Keep these notes', sourceUrl: '', projectId: '', initialProjectId: '',
		proofTarget: '', purpose: '', writtenNextStep: '', owner: '', area: '', type: '', due: '', energy: '', recurrence: '',
		titleError: '', notesError: '', sourceError: '', projectError: '', saveError: '', revealWarning: '', undoError: '', created: null,
		projects: [], filters: { owner: 'all', area: 'all', energy: 'all', recurrence: 'all' },
		PACK_ENERGIES: [], DEMO_WORK_TITLE_MAX_LENGTH: 200,
		normalizeWorkTitle: value => value.trim(), tick: async () => {},
		form: { contains: value => value === input },
		document: { activeElement: input, body: {}, getElementById: id => ({ focus: () => calls.focus.push(id) }) },
		createPack: async () => {
			calls.create++;
			if (failCreate) throw new Error('Storage unavailable');
			return { pack, undoToken, state: { unnecessaryWorkspaceCopy: true } };
		},
		onCreated: async () => { calls.reveal++; throw new Error('View reveal failed'); },
		displayToast: (...args) => calls.toasts.push(args)
	});
	const reset = workQuickAddSource.match(/function resetDraft\(\) \{[\s\S]*?\n\t\}/u)?.[0];
	const handler = workQuickAddSource.match(/async function quickCreate\(\) \{[\s\S]*?\n\t\}/u)?.[0];
	assert.ok(reset && handler, 'Exercise the actual reset and save functions');
	const { outputText } = ts.transpileModule(`${reset}\n${handler}\nquickCreate();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
	await vm.runInContext(outputText, context);
	return { context, calls, pack, undoToken };
}

test('a persisted draft survives a throwing reveal callback and keeps successful focus', async () => {
	const { context, calls, pack, undoToken } = await runIntakeHandler();
	assert.equal(calls.create, 1, 'The already-persisted draft is never retried');
	assert.equal(calls.reveal, 1);
	assert.equal(context.open, false);
	assert.equal(context.title, '');
	assert.equal(context.saveError, '', 'View failure is never reported as a failed save');
	assert.equal(context.busy, false);
	assert.match(context.revealWarning, /Saved\..*Work view/u);
	assert.equal(context.created.pack, pack);
	assert.equal(context.created.undoToken, undoToken);
	assert.deepEqual(Object.keys(context.created).sort(), ['pack', 'undoToken'], 'Confirmation retains no whole-workspace state');
	assert.deepEqual(calls.focus, ['work-intake-open-task']);
	assert.deepEqual(calls.toasts, [], 'The callback failure does not emit a misleading create-failed toast');
	assert.match(workQuickAddSource, /data-work-intake-confirmation[\s\S]*?\{#if revealWarning\}<p[^>]*data-work-intake-reveal-warning>\{revealWarning\} Use Open task to continue\./u);
});

test('a rejected persistence operation retains the draft and never calls the reveal callback', async () => {
	const { context, calls } = await runIntakeHandler({ failCreate: true });
	assert.equal(calls.create, 1);
	assert.equal(calls.reveal, 0);
	assert.equal(context.open, true);
	assert.equal(context.title, 'Retained draft');
	assert.equal(context.notes, 'Keep these notes');
	assert.equal(context.created, null);
	assert.equal(context.revealWarning, '');
	assert.equal(context.saveError, 'Storage unavailable');
	assert.equal(context.busy, false);
	assert.deepEqual(calls.focus, ['work-intake-save-error']);
});

async function runUndoHandler({ userMovedFocus = false } = {}) {
	const focus = [];
	const undoButton = { id: 'work-intake-undo' };
	const otherField = { id: 'another-editor' };
	const document = { activeElement: undoButton, body: {}, getElementById: id => ({ focus: () => focus.push(id) }) };
	const token = { packId: 'saved-draft', expectedSignature: 'saved-signature', previousSelectedId: null };
	let undos = 0;
	const context = vm.createContext({
		document, busy: false, created: { pack: { id: token.packId }, undoToken: token }, undoError: '',
		undoCreatedPack: async passedToken => {
			assert.equal(passedToken, token);
			undos++;
			// Disabling the activation button can blur it to BODY before save settles.
			document.activeElement = userMovedFocus ? otherField : document.body;
		},
		onUndone: () => {}, tick: async () => {}
	});
	const handler = workQuickAddSource.match(/async function undoCreation\(\) \{[\s\S]*?\n\t\}/u)?.[0];
	assert.ok(handler, 'Exercise the actual component Undo handler');
	const { outputText } = ts.transpileModule(`${handler}\nundoCreation();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
	await vm.runInContext(outputText, context);
	return { context, document, otherField, focus, undos };
}

test('successful Undo returns focus to enabled Add work after its disabled trigger blurs to BODY', async () => {
	const { context, focus, undos } = await runUndoHandler();
	assert.equal(undos, 1);
	assert.equal(context.created, null);
	assert.equal(context.busy, false);
	assert.equal(context.undoError, '');
	assert.deepEqual(focus, ['work-add-trigger']);
});

test('successful Undo preserves focus moved into another editor while persistence is pending', async () => {
	const { context, document, otherField, focus, undos } = await runUndoHandler({ userMovedFocus: true });
	assert.equal(undos, 1);
	assert.equal(context.created, null);
	assert.equal(context.busy, false);
	assert.equal(document.activeElement, otherField);
	assert.deepEqual(focus, []);
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
		/function setHumanQuickTitle\(event: Event\) \{[\s\S]*?title = \(event\.currentTarget as HTMLInputElement\)\.value;/u
	);
	assert.match(
		workQuickAddSource,
		/<WornInput[\s\S]*?class="quick-create-input"[\s\S]*?bind:value=\{title\}[\s\S]*?oninput=\{setHumanQuickTitle\}[\s\S]*?aria-describedby=\{`quick-create-title-help/u
	);
	assert.doesNotMatch(workQuickAddSource, /input\.value\.slice\(/u);
	assert.doesNotMatch(workQuickAddSource, /input\.value = title/u, 'Invalid pasted text remains available for correction');
	assert.match(workQuickAddSource, /const normalizedTitle = normalizeWorkTitle\(title\);[\s\S]*?if \(normalizedTitle === null\) titleError =/u);
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
	const nebiusEntry = routeSource.match(/<section class="nebius-work-entry"[\s\S]*?<\/section>/u)?.[0] ?? '';
	assert.match(nebiusEntry, /nebiusSelectedPack \? workTitle\(nebiusSelectedPack\) : 'Choose a task'/u);
	assert.match(nebiusEntry, /Create or open a task to continue\./u);
	assert.match(nebiusEntry, /\{:else if nebiusSelectedPack\.executionRun\}\s*<WornButton variant="primary" href=\{`\/next\?pack=\$\{encodeURIComponent\(nebiusSelectedPack\.id\)\}&view=review`\}>Review saved run<\/WornButton>\s*\{:else\}\s*<WornButton variant="primary" href=\{`\/next\?pack=\$\{encodeURIComponent\(nebiusSelectedPack\.id\)\}&view=brief`\}>Open task/u);
	assert.match(nebiusEntry, /disabled>Open task/u);
	assert.match(nebiusEntry, /data-nebius-selected-next-step[\s\S]*?nebiusSelectedPack\.nextStep/u);
	assert.match(nebiusEntry, /hasBlocker\(nebiusSelectedPack\)[\s\S]*?blockerText\(nebiusSelectedPack\)/u);
	assert.equal((routeSource.match(/<section[^>]*\bdata-nebius-work-entry>/gu) ?? []).length, 1);
	const entryIndex = routeSource.indexOf('<section class="nebius-work-entry"');
	assert.ok(routeSource.indexOf('<NebiusProjectWorkspace') < entryIndex);
	assert.match(routeSource, /<NebiusProjectWorkspace[^>]*onApproved=\{async \(\) => \{\s*await clearAllFilters\(false\);\s*await tick\(\);\s*document\.querySelector<HTMLAnchorElement>\('\[data-nebius-work-entry\] a'\)\?\.focus\(\);/u);
	for (const control of ['<WorkFilterControls', '<WorkQuickAdd', '<WornReceipt id="work-receipt"']) assert.ok(entryIndex < routeSource.indexOf(control));
	assert.doesNotMatch(nebiusEntry, />Open brief<|>Open tool<|view=build/u);
	assert.ok(nebiusEntry.indexOf('class="nebius-work-actions"') < nebiusEntry.indexOf('class="nebius-work-context"'), 'The task action precedes long supporting text');
	assert.match(routeSource, /\.nebius-work-context \[data-nebius-selected-next-step\] \{[^}]*-webkit-line-clamp: 3/u);
	assert.match(routeSource, /\.nebius-work-entry > div:first-child \{[^}]*min-inline-size: 0/u);
	assert.match(routeSource, /\.nebius-work-entry strong \{[^}]*overflow-wrap: anywhere/u);
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
