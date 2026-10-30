<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { goto, replaceState } from '$app/navigation';
	import { COMMANDS_CONTEXT, isAllWorkScopeUrl, type CommandsHost } from '$lib/nebius-command-context';
	import { page } from '$app/stores';
	import { SvelteSet } from 'svelte/reactivity';
	import Command from '@lucide/svelte/icons/command';
	import Focus from '@lucide/svelte/icons/focus';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import {
		demoState,
		demoStateError,
		demoStateLoading,
		refreshDemoState,
		runPackAction,
		saveBrowserState,
		savePackPath,
		savePackBrowserFields,
		setStateFilter,
		ChallengeStateError,
		displayToast,
		actionBusy,
		selectProject,
		exportWorkspaceState,
		importWorkspaceState,
		previewWorkspaceImport,
		type WorkspaceImportPreview
	} from '$lib/demo-client';
	import {
		PACK_ACTIONS,
		blockerText,
		dueDateLabel,
		filterPacks,
		orderPacks,
		ownerLabel,
		primaryCommand,
		primaryCommandNavigation,
		hasBlocker,
		isMissingOwnerValue,
		canSetNextAction,
		isReview,
		isOpenDecision,
		dueUrgency,
		parseDateOnly,
		PACK_ENERGIES,
		recommendedDecisionWork,
		receiptCells,
		receiptReadyPacks,
		workTitle,
		type DemoPack
	} from '$lib/demo-workflow';
	import { WornDialog, WornEmpty, WornError, WornButton, WornIconButton, WornCheckbox, WornChip, WornAlert, WornPage, WornReceipt, WornSelect, WornInput } from '$lib/components';
	import { buildActionUndoSnapshot, commitActionUndo, receiptUndo, undoReceipt } from '$lib/undo';
	import { localDateInputValue } from '$lib/local-date.mjs';
	import { summarizeWorkMetadata } from '$lib/work-metadata.mjs';
	import { focusAndPulse } from '$lib/focus-pulse.mjs';
	import { settleProgressiveReveal } from '$lib/progressive-reveal.mjs';
	import { parseRecentWorkIds, prependRecentWorkId } from '$lib/recent-work.mjs';
	import { decisionWorkspaceWorkFocusRequest } from '$lib/decision-workspace-navigation.mjs';
	import WorkGridCard from '$lib/components/WorkGridCard.svelte';
	import WorkListCard from '$lib/components/WorkListCard.svelte';
	import WorkBatchActions from './WorkBatchActions.svelte';
	import WorkDecisionWorkspace from './WorkDecisionWorkspace.svelte';
	import WorkFilterControls from './WorkFilterControls.svelte';
	import WorkQuickAdd from './WorkQuickAdd.svelte';
	import NebiusProjectWorkspace from './NebiusProjectWorkspace.svelte';
	import NebiusProjectRehearsal from './NebiusProjectRehearsal.svelte';
	import WorkRecentActivity from './WorkRecentActivity.svelte';
	import WorkShortcutHelp from './WorkShortcutHelp.svelte';
	import {
		routeWorkSearch,
		visibleDecisionDecider
	} from './work-view-helpers.mjs';

	const FILTERS: Array<[string, string]> = [
		['all', 'All'],
		['active', 'Active'],
		['blocked', 'Blocked'],
		['draft', 'Draft'],
		['done', 'Done'],
		['review', __NEBIUS_EDITION__ ? 'Attention' : 'Review'],
		['archived', 'Archived']
	];
	// Keep the Work route responsive when a real workspace holds thousands of
	// packs. Filtering and sorting stay accurate across the full result, while
	// the DOM starts with a bounded, explicit slice that a person can expand.
	const WORK_RENDER_LIMIT = 100;

	// Persist the selected card/grid presentation in this browser.
	const VIEW_STORAGE_KEY = 'demo-view-work';
	const RECENT_STORAGE_KEY = 'projects-work-recent-v1';

	let query = $state('');
	let debouncedQuery = $state('');
	let busyId = $state('');
	let busyAction = $state('');
	let errorText = $state('');
	let dismissedReceiptSummary = $state('');
	let energyFilter = $state('all');
	let areaFilter = $state('all');
	let recurrenceFilter = $state('all');
	let ownerFilter = $state('all');

	// Declared before the filter deriveds that read it (TDZ-safe for TS).
	let packs = $derived(($demoState?.packs ?? []) as DemoPack[]);
	let selectedProjectId = $derived(__NEBIUS_EDITION__ ? $demoState?.selectedProjectId ?? null : null);
	let scopedPacks = $derived(selectedProjectId ? packs.filter(pack => pack.projectId === selectedProjectId) : packs);
	let scopedSelectedId = $derived(scopedPacks.some(pack => pack.id === $demoState?.selectedId) ? $demoState?.selectedId : null);
	let workMetadata = $derived.by(() => summarizeWorkMetadata(scopedPacks, { isMissingOwnerValue, dueUrgency }));
	let dueUrgencyFilter = $state('all');
	// The Work page begins with the complete sample workspace visible so people and page tools
	// share the same initial context on every browser visit.
	let hideDone = $state(false);

	// Debounce search query to avoid re-filtering on every keystroke
	let _debounceTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const nextQuery = query;
		clearTimeout(_debounceTimer);
		_debounceTimer = setTimeout(() => { debouncedQuery = nextQuery; }, 150);
		return () => clearTimeout(_debounceTimer);
	});
	let batchMode = $state(false);
	let batchSelected = new SvelteSet<string>();
	let focusMode = $state(false);
	const DENSITY_TABS: Array<{ id: 'card' | 'grid'; label: string }> = [
		{ id: 'card', label: 'Cards' },
		{ id: 'grid', label: 'Grid' }
	];
	let density = $state<'card' | 'grid'>('grid');
	let secondaryFiltersOpen = $state(false);
	let densityPanelTabs = $derived(
		packs.length > 1 ? DENSITY_TABS : DENSITY_TABS.filter((tab) => tab.id === density)
	);
	let recentIds = $state<string[]>([]);
	let recentPacks = $derived(recentIds
		.map((id) => scopedPacks.find((pack) => pack.id === id))
		.filter((pack): pack is DemoPack => Boolean(pack && canSetNextAction(pack))));
	let snoozeDays = $state<Record<string, string>>({});
	let quickAddBusy = $state(false);
	let quickAdd = $state<{ openIntake: () => Promise<void> } | null>(null);
  let projectWorkspace = $state<{ canChangeScope: () => boolean } | null>(null);
	let sortBy = $state('urgency');
	let manualOrderAnnouncement = $state('');
	let manualTargetId = $state('');
	let manualOrder = $derived(($demoState?.manualOrder ?? []) as string[]);
	let renderLimit = $state(WORK_RENDER_LIMIT);
	let commandPaletteOpen = $state(false);
	const commandHost = getContext<CommandsHost | undefined>(COMMANDS_CONTEXT);
	const commandContributionOwner = Symbol('Work commands');
	let appliedAllWorkRoute = '';
	let workMenuOpen = $state(false);
	let appliedWorkMenuRoute = $state('');
	let workMenuRouteFrame: number | null = null;
	let importBusy = $state(false);
	let importReadGeneration = 0;
	let importPreview = $state<WorkspaceImportPreview | null>(null);
	let importError = $state('');
	let importInput = $state<HTMLInputElement | null>(null);
	let exportHref = $state('');
	let replaceConfirmOpen = $state(false);
	let commandPaletteQuery = $state('');
	let commandPaletteActiveIndex = $state(0);
	type WorkCommand = {
		id: string;
		label: string;
		description: string;
		disabled?: boolean;
		run: () => void;
	};
	let commandPaletteCommands = $derived.by(() => {
		const normalized = commandPaletteQuery.trim().toLowerCase();
		const selectedId = $demoState?.selectedId;
		const selectedPack = scopedPacks.find((pack) => pack.id === selectedId) || null;
		const selectedCanSetNext = Boolean(selectedPack && canSetNextAction(selectedPack));
		const all: WorkCommand[] = [
			{
				id: 'add-work',
				label: __NEBIUS_EDITION__ ? 'Add work' : 'Quick add work',
				description: __NEBIUS_EDITION__ ? 'Open the draft task form.' : 'Focus the Quick Add form.',
				disabled: quickAddBusy,
				run: () => { void quickAdd?.openIntake(); }
			},
			{
				id: 'search',
				label: 'Focus search',
				description: showWorkControls ? 'Jump to the work filter search box.' : 'Search is available when there are multiple tasks or active filters.',
				disabled: !showWorkControls,
				run: () => {
					filterInput()?.focus();
				}
			},
			{
				id: 'review',
				label: __NEBIUS_EDITION__ ? 'Show attention items' : 'Open Review',
				description: __NEBIUS_EDITION__ ? 'Filter Work to tasks that need review.' : 'Jump to the review queue.',
				run: () => {
					if (__NEBIUS_EDITION__) void applyFilter('review');
					else goto('/review');
				}
			},
			{
				id: 'challenge',
				label: 'Open workspace backup',
				description: 'Export or import this browser workspace.',
				run: () => { workMenuOpen = true; }
			},
			{
				id: 'next-selected',
				label: __NEBIUS_EDITION__ ? 'Open selected task' : 'Open next for selected',
				description: selectedCanSetNext ? `Open ${workTitle(selectedPack!)} in ${__NEBIUS_EDITION__ ? 'Task' : 'Next'}` : selectedPack ? 'Completed work has no next action to edit.' : 'Select a work item first.',
				disabled: !selectedCanSetNext,
				run: () => {
					if (!selectedPack || !canSetNextAction(selectedPack)) return;
					goto(`/next?pack=${encodeURIComponent(selectedPack.id || '')}`);
				}
			},
			{
				id: 'next-decision',
				label: __NEBIUS_EDITION__ ? 'Open decision workspace task' : 'Open decision workspace item in Next',
				description: decisionWorkspace ? `Open ${workTitle(decisionWorkspace.pack)} in ${__NEBIUS_EDITION__ ? 'Task' : 'Next'}` : 'No visible decision item.',
				disabled: !decisionWorkspace,
				run: () => {
					if (!decisionWorkspace) return;
					goto(`/next?pack=${encodeURIComponent(decisionWorkspace.pack.id)}`);
				}
			},
			{
				id: 'clear-filters',
				label: 'Clear all filters',
				description: 'Reset status, filters, sort, and search.',
				run: () => {
					void clearAllFilters();
				}
			},
			{
				id: 'toggle-batch',
				label: batchMode ? 'Exit batch mode' : 'Enter batch mode',
				description: batchMode ? 'Turn off multi-select actions.' : 'Turn on multi-select actions for the card list.',
				run: () => {
					toggleBatchMode();
				}
			},
			{
				id: 'toggle-focus',
				label: focusMode ? 'Exit focus mode' : 'Enter focus mode',
				description: focusMode ? 'Return to full list view.' : scopedSelectedId ? 'Focus only on the selected work item.' : 'Select a work item first.',
				disabled: !scopedSelectedId,
				run: () => {
					toggleFocusMode();
				}
			},
			{
				id: 'show-work-command-list',
				label: 'Show advanced controls',
				description: 'Open advanced filter and density controls.',
				run: () => {
					secondaryFiltersOpen = true;
					commandPaletteOpen = false;
				}
			}
		];
		if (!normalized) return all;
		return all.filter((entry) => `${entry.label} ${entry.description}`.toLowerCase().includes(normalized));
	});

	$effect(() => {
		if (!__NEBIUS_EDITION__ || !commandHost) return;
		commandHost.publish(commandContributionOwner, {
			commands: commandPaletteCommands,
			scopeKey: selectedProjectId ? `project:${selectedProjectId}` : 'all',
			orderedIds: orderPacks(scopedPacks, sortBy, manualOrder).map(pack => pack.id!).filter(Boolean)
		});
		return () => commandHost.publish(commandContributionOwner, null);
	});

	$effect(() => {
		if (!__NEBIUS_EDITION__ || !browser || !$demoState || $page.url.pathname !== '/work') return;
		if (!isAllWorkScopeUrl($page.url)) { appliedAllWorkRoute = ''; return; }
		const routeKey = $page.url.href;
		if (appliedAllWorkRoute === routeKey) return;
		appliedAllWorkRoute = routeKey;
		void tick().then(async () => {
			if ($page.url.href !== routeKey) return;
			const clean = new URL($page.url);
			clean.searchParams.delete('scope');
			// Existing page guards have already permitted this navigation. Applying
			// its scope intent must not ask for the same discard decision twice.
			try { if ($demoState?.selectedProjectId) await selectProject(null); }
			catch (error) { errorText = describeError(error, 'All work could not be shown.'); }
			finally { if ($page.url.href === routeKey) replaceState(clean, $page.state); }
		});
	});

	onDestroy(() => {
		importReadGeneration += 1;
		if (workMenuRouteFrame !== null) cancelAnimationFrame(workMenuRouteFrame);
		if (exportHref) URL.revokeObjectURL(exportHref);
	});

	$effect(() => {
		if (!__NEBIUS_EDITION__ || !browser) return;
		if ($page.url.searchParams.get('menu') !== 'backup') {
			appliedWorkMenuRoute = '';
			return;
		}
		const routeKey = `${$page.url.pathname}${$page.url.search}${$page.url.hash}`;
		if (routeKey === appliedWorkMenuRoute) return;
		appliedWorkMenuRoute = routeKey;
		void tick().then(() => {
			if (`${$page.url.pathname}${$page.url.search}${$page.url.hash}` !== routeKey || $page.url.searchParams.get('menu') !== 'backup') return;
			workMenuRouteFrame = requestAnimationFrame(() => {
				workMenuRouteFrame = null;
				if (`${$page.url.pathname}${$page.url.search}${$page.url.hash}` === routeKey) workMenuOpen = true;
			});
		});
	});

	function prepareWorkspaceExport() {
		if (exportHref) URL.revokeObjectURL(exportHref);
		exportHref = URL.createObjectURL(new Blob([exportWorkspaceState()], { type: 'application/json' }));
		displayToast('Workspace backup is ready to download.', 'success');
	}

	async function selectWorkspaceFile(event: Event) {
		if (importBusy) return;
		const generation = ++importReadGeneration;
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		importPreview = null;
		importError = '';
		if (!file) return;
		try {
			const serialized = await file.text();
			if (generation !== importReadGeneration) return;
			importPreview = previewWorkspaceImport(serialized);
		} catch (error) {
			if (generation === importReadGeneration) importError = error instanceof Error ? error.message : 'The workspace backup is invalid.';
		}
	}

	async function applyWorkspaceImport(mode: 'replace' | 'merge') {
		if (!importPreview || importBusy) return;
		importBusy = true;
		try {
			const result = await importWorkspaceState(importPreview.serialized, mode);
			displayToast(mode === 'replace' ? `Workspace replaced with ${result.packs} work items.` : `Workspace merged with ${result.packs} new work items${result.skipped ? ` (${result.skipped} existing skipped)` : ''}.`, 'success');
			importPreview = null;
			if (importInput) importInput.value = '';
		} catch (error) {
			importError = error instanceof Error ? error.message : 'The workspace could not be imported.';
		} finally {
			importBusy = false;
		}
	}

	function requestWorkspaceImport(mode: 'replace' | 'merge') {
		if (mode === 'replace') {
			replaceConfirmOpen = true;
			return;
		}
		void applyWorkspaceImport(mode);
	}

	let filter = $derived($demoState?.filter || 'all');
	let visible = $derived((()=>{let v=orderPacks(filterPacks(scopedPacks,filter,debouncedQuery,energyFilter,areaFilter,recurrenceFilter,ownerFilter,hideDone), sortBy, manualOrder);if(dueUrgencyFilter!=='all'){v=v.filter(p=>dueUrgency(p)===dueUrgencyFilter)}const sel=$demoState?.selectedId;if(focusMode&&sel){return v.filter(p=>p.id===sel)}return v})());
	let manualTargetOptions = $derived(visible.map((pack) => ({ value: pack.id, label: workTitle(pack) })));
	let workspaceLoaded = $derived($demoState !== null);
	let pendingDecisionFocus = $derived(
		browser
			? decisionWorkspaceWorkFocusRequest($page.url.searchParams)
			: { present: false, workId: '' }
	);
	let focusedDecisionCandidate = $derived(
		pendingDecisionFocus.workId
			? packs.find((pack) => pack.id === pendingDecisionFocus.workId) || null
			: null
	);
	let focusedDecisionPack = $derived(
		focusedDecisionCandidate && isOpenDecision(focusedDecisionCandidate)
			? focusedDecisionCandidate
			: null
	);
	let focusedDecisionOutsideView = $derived(Boolean(
		focusedDecisionPack && !visible.some((pack) => pack.id === focusedDecisionPack.id)
	));
	let decisionWorkspaceContext = $derived(
		pendingDecisionFocus.present
			? focusedDecisionPack
				? [focusedDecisionPack, ...visible.filter((pack) => pack.id !== focusedDecisionPack.id)]
				: []
			: visible
	);
	let decisionWorkspace = $derived(recommendedDecisionWork(decisionWorkspaceContext));
	let pendingDecisionResumeError = $derived.by(() => {
		if (!pendingDecisionFocus.present || !workspaceLoaded || focusedDecisionPack) return '';
		if (!pendingDecisionFocus.workId) return 'This pending-decision link is invalid or exceeds the supported identifier length.';
		const candidate = packs.find((pack) => pack.id === pendingDecisionFocus.workId);
		if (!candidate) return 'The requested pending decision no longer exists in this workspace.';
		if (candidate.archived) return 'The requested pending decision is archived and cannot be resumed in Work.';
		if (candidate.status === 'done') return 'The requested pending decision is already complete and cannot be resumed.';
		if (candidate.decision !== true) return 'The requested work item is not an explicit open decision.';
		return 'The requested pending decision could not be resumed.';
	});
	let decisionWorkspaceDecider = $derived(
		decisionWorkspace
			? visibleDecisionDecider(decisionWorkspace.pack.area, decisionWorkspace.pack.decider)
			: null
	);
	let decisionWorkspaceReason = $derived(
		decisionWorkspace
			? focusedDecisionPack
				? `Resumed the exact pending decision from Pending approvals. ${focusedDecisionOutsideView ? 'It is outside the current list filters, which remain unchanged.' : 'It remains inside the current filtered and sorted view.'} ${decisionWorkspace.sameAreaBlockedCount} ${decisionWorkspace.pack.area || 'related'} ${decisionWorkspace.sameAreaBlockedCount === 1 ? 'item' : 'items'} with blocker${decisionWorkspace.sameAreaBlockedCount === 1 ? '' : 's'} in this decision context.`
				: `First open decision in this filtered and sorted view. ${decisionWorkspace.sameAreaBlockedCount} ${decisionWorkspace.pack.area || 'related'} ${decisionWorkspace.sameAreaBlockedCount === 1 ? 'item' : 'items'} with blocker${decisionWorkspace.sameAreaBlockedCount === 1 ? '' : 's'} in view. One of ${decisionWorkspace.visibleDecisionCount} open ${decisionWorkspace.visibleDecisionCount === 1 ? 'decision is' : 'decisions are'} shown.`
			: ''
	);
	let renderedVisible = $derived(visible.slice(0, renderLimit));
	let hasMoreVisible = $derived(renderedVisible.length < visible.length);
	let filterScope = $derived([selectedProjectId, filter, debouncedQuery, energyFilter, areaFilter, recurrenceFilter, ownerFilter, dueUrgencyFilter, sortBy, hideDone, focusMode].join('\u0000'));
	let appliedFilterScope = $state('');
	let appliedProjectScope = $state<string | null>(null);
	$effect(() => {
		if (filterScope !== appliedFilterScope) {
			appliedFilterScope = filterScope;
			renderLimit = WORK_RENDER_LIMIT;
		}
		if (__NEBIUS_EDITION__ && selectedProjectId !== appliedProjectScope) {
			appliedProjectScope = selectedProjectId;
			batchSelected.clear();
			focusMode = false;
			manualTargetId = '';
			if (browser) document.documentElement.classList.remove('focus-mode');
		}
	});
	let counts = $derived(countByFilter(scopedPacks));
	let hasDoneWork = $derived(workMetadata.hasDoneWork);
	let hideDoneApplies = $derived(hideDone && filter === 'all' && hasDoneWork);
	let statusFilterOptions = $derived(
		FILTERS.map(([value, label]) => ({ value, label: `${label} (${counts[value] ?? 0})` }))
	);
	let hasActiveFilters = $derived(
		filter !== 'all' || energyFilter !== 'all' || areaFilter !== 'all' || recurrenceFilter !== 'all' || ownerFilter !== 'all' || dueUrgencyFilter !== 'all' || hideDoneApplies || focusMode
	);
	let showWorkControls = $derived(
		packs.length > 0 && (packs.length > 1 || hasActiveFilters || query.trim().length > 0 || sortBy !== 'urgency')
	);
	let activeFilterLabel = $derived.by(() => {
		const parts: string[] = [];
		if (filter !== 'all') parts.push(`status: ${filter}`);
		if (energyFilter !== 'all') parts.push(`energy: ${energyFilter}`);
		if (areaFilter !== 'all') parts.push(`area: ${areaFilter}`);
		if (recurrenceFilter !== 'all') parts.push(`recurrence: ${recurrenceFilter}`);
		if (ownerFilter !== 'all') parts.push(`owner: ${ownerFilter === '_unassigned' ? 'Unassigned' : ownerFilter}`);
		if (dueUrgencyFilter !== 'all') parts.push(`due: ${dueUrgencyFilter}`);
		if (hideDoneApplies) parts.push('done hidden');
		if (focusMode) parts.push('focus mode');
		return parts.join(', ');
	});
	let blockedCount = $derived(visible.filter(hasBlocker).length);
	let nebiusSelectedPack = $derived(
		scopedPacks.find((candidate) => candidate.id === $demoState?.selectedId) ||
		visible[0] || null
	);
	let workStatus = $derived(
		packs.length === 0
			? undefined
			: `${renderedVisible.length} shown · ${visible.length} matching${selectedProjectId ? ` · ${scopedPacks.length} project` : ''} · ${packs.length} workspace${blockedCount > 0 ? ` · ${blockedCount} with blockers` : ''}`
	);
	let receipt = $derived($demoState?.actionReceipt || null);
	let readyNextPacks = $derived(__NEBIUS_EDITION__ ? receiptReadyPacks(receipt, packs, selectedProjectId) : []);
	let receiptVisible = $derived(Boolean(receipt?.summary && receipt.summary !== dismissedReceiptSummary));
	let nebiusContinuePack = $derived(
		nebiusSelectedPack && !canSetNextAction(nebiusSelectedPack) && receiptVisible
			? readyNextPacks[0] ?? null : null
	);
	let additionalReadyPacks = $derived(nebiusContinuePack
		? readyNextPacks.filter((pack) => pack.id !== nebiusContinuePack?.id)
		: readyNextPacks);
	let receiptFocusTimer: ReturnType<typeof setTimeout> | null = null;
	async function refreshWork(
		{
			reuseRecent = false,
			afterRefresh
		}: {
			reuseRecent?: boolean;
			afterRefresh?: (state: Awaited<ReturnType<typeof refreshDemoState>>) => void;
		} = {}
	): Promise<void> {
		const state = await refreshDemoState({ reuseRecent });
		afterRefresh?.(state);
	}

	function hydrateRecentWork(availablePacks: DemoPack[]) {
		try {
			recentIds = parseRecentWorkIds(sessionStorage.getItem(RECENT_STORAGE_KEY), availablePacks.map((pack) => pack.id));
			if (recentIds.length === 0) sessionStorage.removeItem(RECENT_STORAGE_KEY);
			else sessionStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentIds));
		} catch {
			recentIds = [];
		}
	}

	// URL search is a one-time, page-local arrival state. It does not write,
	// navigate, or initiate work beyond rendering the existing Work route.
	function applyRouteWorkSearch(searchParam: unknown): string {
		const routeSearch = routeWorkSearch(searchParam);
		query = routeSearch;
		debouncedQuery = routeSearch;
		return routeSearch;
	}

	async function focusRouteWorkSearchArrival(routeSearch: string) {
		if (!routeSearch) return;
		await tick();
		if (!filterInput() && !document.querySelector<HTMLElement>('[data-work-item][data-pack-id]')) return;
		focusWorkSearchDestination(true);
	}

	onMount(() => {
		let mounted = true;
		// A later interaction or focus destination owns focus, even while the
		// requested card is still rendering. Ignore document/body focus resets.
		const preserveArrivalFocus = (event: Event) => {
			if (!event.isTrusted) return;
			if (event.type === 'focusin' && (event.target === document.body || event.target === document.documentElement)) return;
			finishArrivalPreparation();
		};
		const arrivalEvents = ['keydown', 'pointerdown', 'focusin'] as const;
		for (const event of arrivalEvents) document.addEventListener(event, preserveArrivalFocus, true);
		const routeSearch = applyRouteWorkSearch($page.url.searchParams.get('search'));
		const routeFilter = __NEBIUS_EDITION__ && $page.url.searchParams.get('filter') === 'review' ? 'review' : '';
		if (routeFilter) void applyFilter(routeFilter);
		void refreshWork({
			reuseRecent: true,
			afterRefresh: (state) => {
				if (!mounted) return;
				hydrateRecentWork((state?.packs ?? packs) as DemoPack[]);
				void focusRouteWorkSearchArrival(routeSearch);
			}
		});
		try {
			const saved = localStorage.getItem(VIEW_STORAGE_KEY);
			if (saved === 'grid' || saved === 'card') density = saved as 'card' | 'grid';
		} catch {}
		return () => {
			mounted = false;
			for (const event of arrivalEvents) document.removeEventListener(event, preserveArrivalFocus, true);
			if (receiptFocusTimer) clearTimeout(receiptFocusTimer);
			receiptFocusTimer = null;
			// Leaving Work drops its route-only batch and focus modes.
			document.documentElement.classList.remove('batch-mode');
			if (focusMode) document.documentElement.classList.remove('focus-mode');
		};
	});

	function countByFilter(list: DemoPack[]): Record<string, number> {
		const next: Record<string, number> = Object.fromEntries(FILTERS.map(([key]) => [key, 0]));
		for (const pack of list) {
			if (!pack.archived) next[pack.status || ''] = (next[pack.status || ''] ?? 0) + 1;
			if (isReview(pack)) next.review += 1;
			if (pack.archived) next.archived += 1;
			if (!pack.archived) next.all += 1;
		}
		return next;
	}

	function describeError(error: unknown, fallback: string): string {
		if (error instanceof ChallengeStateError) {
			return error.message;
		}
		return fallback;
	}

	async function applyFilter(key: string): Promise<boolean> {
		errorText = '';
		try {
			await setStateFilter(key);
			return true;
		} catch (error) {
			errorText = describeError(error, 'Filter change did not save.');
			return false;
		}
	}

	async function handleStatusFilterChange(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		if (!(await applyFilter(select.value))) select.value = filter;
	}

	async function clearAllFilters(restoreFocus = true) {
		const filterReset = applyFilter('all');
		energyFilter = 'all';
		query = '';
		debouncedQuery = '';
		areaFilter = 'all';
		recurrenceFilter = 'all';
		ownerFilter = 'all';
		dueUrgencyFilter = 'all';
		sortBy = 'urgency';
		hideDone = false;
		focusMode = false;
		document.documentElement.classList.remove('focus-mode');
		await tick();
		if (restoreFocus) filterInput()?.focus();
		await filterReset;
		await tick();
		if (restoreFocus) (filterInput() ?? document.querySelector<HTMLElement>('[data-work-item][data-pack-id]'))?.focus();
	}

	async function clearSearch() {
		query = '';
		debouncedQuery = '';
		await tick();
		filterInput()?.focus({ preventScroll: true });
	}

	function handleDensityChange(id: string) {
		density = id as 'card' | 'grid';
		try { localStorage.setItem(VIEW_STORAGE_KEY, density); } catch {}
	}

	// ── Batch select ──

	function toggleBatchMode() {
		if (busyId === 'batch') return;
		batchMode = !batchMode;
		if (!batchMode) batchSelected.clear();
		document.documentElement.classList.toggle('batch-mode', batchMode);
		if (batchMode) displayToast('Select cards to act on them.', 'info');
	}

	function toggleFocusMode() {
		if (!focusMode && !scopedSelectedId) {
			displayToast('Select a work item before turning on Focus.', 'info');
			return;
		}
		focusMode = !focusMode;
		document.documentElement.classList.toggle('focus-mode', focusMode);
		if (focusMode) displayToast('Focus on. Press F to exit.', 'info');
	}

	// In batch mode a tap anywhere on the card toggles selection; inner
	// controls (buttons, links, the details toggle) keep their own behavior.
let focusedIndex = $state(0);
let manualFocusId = $state('');
let shortcutHelpOpen = $state(false);

function handleCardKeys(e: KeyboardEvent, cardIndex: number = -1) {
  if (e.target !== e.currentTarget) return;
  // Both Work densities expose the same canonical focus and identity selector.
  const cards = document.querySelectorAll('[data-work-item][data-pack-id]');
  if (!cards.length) return;
  const current = Array.from(cards).indexOf(document.activeElement as Element);
  if (sortBy === 'manual' && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); void moveFocusedManual(e.key === 'ArrowUp' ? -1 : 1); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); const next = (current + 1) % cards.length; (cards[next] as HTMLElement)?.focus(); focusedIndex = next; return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); const prev = (current - 1 + cards.length) % cards.length; (cards[prev] as HTMLElement)?.focus(); focusedIndex = prev; return; }
  // Action shortcuts on focused cards
	if (current < 0) return;
  const packId = (cards[current] as HTMLElement)?.dataset?.packId;
  if (!packId) return;
  const pack = packs.find(p => p.id === packId);
  if (!pack) return;
  if (batchMode && (e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); toggleBatchSelection(packId); return; }
  if (!batchMode && e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); selectPack(pack); return; }
  if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); doAction(pack, 'done'); return; }
  if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); doAction(pack, 'block'); return; }
  if ((e.key === 'o' || e.key === 'O') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); selectPack(pack); return; }
  if (e.key === ' ' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); runPrimary(pack); return; }
}

	// "/" focuses the filter, Escape leaves it. Kept in the script block rather
	// than inline on <svelte:window>: TypeScript generics in markup read as
	// component tags to the drift guard's missing-import detector.
	const FILTER_INPUT = '[aria-label="Filter work items by text"]';
	function filterInput(): HTMLInputElement | null {
		return document.querySelector<HTMLInputElement>(FILTER_INPUT);
	}
	function focusWorkSearchDestination(requireVisibleFocus: boolean) {
		const firstItem = document.querySelector<HTMLElement>('[data-work-item][data-pack-id]');
		const destination = firstItem ?? filterInput();
		if (!destination) throw new Error('Work search is unavailable because no work list is rendered.');
		const focusReceipt = focusAndPulse(destination, {
			behavior: 'auto',
			block: 'center',
			requireVisibleFocus
		});
		return firstItem
			? { target: 'item' as const, itemId: firstItem.dataset.packId || '', ...focusReceipt }
			: { target: 'search' as const, itemId: null, ...focusReceipt };
	}
	function handleWindowKeys(e: KeyboardEvent) {
		// Dialogs and the palette own their keyboard events, including Escape.
		if (commandPaletteOpen || workMenuOpen || shortcutHelpOpen || document.querySelector('[aria-modal="true"], dialog[open]')) return;
		const tag = (e.target as HTMLElement)?.tagName;
		const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean((e.target as HTMLElement)?.isContentEditable);
		if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !editing) {
			e.preventDefault();
			openWorkCommandPalette();
			return;
		}
		if (editing) return;
		if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
			e.preventDefault();
			toggleFocusMode();
			return;
		}
		if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
			e.preventDefault();
			const search = filterInput();
			if (search) search.focus();
			else displayToast('Search is available when there are multiple tasks or active filters.', 'info');
			focusedIndex = -1;
			return;
		}
		if (e.key === 'Escape') { filterInput()?.blur(); focusedIndex = -1; }
		// The same route-owned form is available through the visible button and Commands.
		if ((e.key === 'n' || e.key === 'c') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
			if (quickAdd) { e.preventDefault(); void quickAdd.openIntake(); }
		}
	}

	function closeWorkCommandPalette() {
		commandPaletteOpen = false;
		commandPaletteQuery = '';
		commandPaletteActiveIndex = 0;
	}

	function openWorkCommandPalette() {
		if (__NEBIUS_EDITION__) {
			commandHost?.open();
			return;
		}
		commandPaletteOpen = true;
		commandPaletteQuery = '';
		const enabled = enabledCommandIndices();
		commandPaletteActiveIndex = enabled.length > 0 ? enabled[0] : -1;
	}

	async function runWorkCommand(command: WorkCommand) {
		if (command.disabled) return;
		commandPaletteOpen = false;
		commandPaletteQuery = '';
		commandPaletteActiveIndex = 0;
		// Finish modal cleanup and return focus before starting a command's own focus lifecycle.
		await tick();
		command.run();
	}

	function runActiveWorkCommand() {
		if (commandPaletteActiveIndex < 0) return;
		const command = commandPaletteCommands[commandPaletteActiveIndex];
		if (command) runWorkCommand(command);
	}

	function enabledCommandIndices() {
		return commandPaletteCommands
			.map((command, index) => command.disabled ? -1 : index)
			.filter((index) => index >= 0);
	}

	function moveCommandPaletteSelection(delta: number) {
		const enabled = enabledCommandIndices();
		if (enabled.length === 0) {
			commandPaletteActiveIndex = -1;
			return;
		}
		if (commandPaletteActiveIndex < 0) {
			commandPaletteActiveIndex = enabled[0];
			return;
		}
		const activePosition = enabled.indexOf(commandPaletteActiveIndex);
		if (activePosition === -1) {
			commandPaletteActiveIndex = enabled[0];
			return;
		}
		const nextPosition = (activePosition + delta + enabled.length) % enabled.length;
		commandPaletteActiveIndex = enabled[nextPosition];
	}

	async function focusActiveCommand() {
		await tick();
		const button = document.querySelector<HTMLButtonElement>(`[data-work-command-index="${commandPaletteActiveIndex}"]`);
		button?.focus();
	}

	$effect(() => {
		if (!commandPaletteOpen) return;
		if (commandPaletteCommands.length === 0) {
			commandPaletteActiveIndex = -1;
			return;
		}
		const enabled = enabledCommandIndices();
		if (enabled.length === 0) {
			commandPaletteActiveIndex = -1;
			return;
		}
		if (commandPaletteActiveIndex < 0 || commandPaletteActiveIndex >= commandPaletteCommands.length || commandPaletteCommands[commandPaletteActiveIndex]?.disabled) {
			commandPaletteActiveIndex = enabled[0];
		}
	});

	function handleWorkCommandInputKeydown(event: KeyboardEvent) {
		if (!commandPaletteOpen) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveCommandPaletteSelection(1);
			void focusActiveCommand();
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveCommandPaletteSelection(-1);
			void focusActiveCommand();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			runActiveWorkCommand();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			closeWorkCommandPalette();
			return;
		}
	}

	function handleCardClick(event: MouseEvent, packId: string) {
		if ((event.target as HTMLElement).closest('a, button, input, label, select, textarea, summary')) return;
		if (batchMode) {
			event.preventDefault();
			toggleBatchSelection(packId);
			return;
		}
		const pack = packs.find((p) => p.id === packId);
		if (pack) selectPack(pack);
	}

	function toggleBatchSelection(packId: string) {
		if (busyId === 'batch') return;
		if (batchSelected.has(packId)) batchSelected.delete(packId);
		else batchSelected.add(packId);
	}

	async function doAction(pack: DemoPack, action: string) {
		if (!pack.id || busyId) return;
		errorText = '';
		busyId = pack.id;
		busyAction = action;
		actionBusy.set(pack.id);
		try {
			const snapshot = buildActionUndoSnapshot(packs, pack.id, action);
			const result = await runPackAction(pack.id, action);
			commitActionUndo(snapshot);
			dismissedReceiptSummary = '';
			if (!result?.summary) {
				errorText = 'The action ran but returned no receipt.';
			}
			revealReceipt();
		} catch (error) {
			errorText = describeError(error, 'Action failed — the local state is unchanged.');
		} finally {
			busyId = '';
			busyAction = '';
			actionBusy.set('');
		}
	}

	// Scroll the route receipt into view and focus it after an action fired
	// further down the list; smoothness comes from .demo-main scroll-behavior
	// (already disabled under prefers-reduced-motion).
	function revealReceipt() {
		if (receiptFocusTimer) clearTimeout(receiptFocusTimer);
		receiptFocusTimer = setTimeout(() => {
			const el = document.getElementById('work-receipt');
			receiptFocusTimer = null;
			if (!el) return;
			// 'start', not 'nearest': the receipt can be taller than a short
			// viewport, and its heading is the part that must be visible.
			focusAndPulse(el, { block: 'start' });
		}, 80);
	}

	async function revealQuickAddReceipt(pack: DemoPack) {
		if (__NEBIUS_EDITION__) {
			// Quick Add owns the actionable confirmation. Keep project editors mounted;
			// changing scope must still respect their existing unsaved-edit guard.
			dismissedReceiptSummary = $demoState?.actionReceipt?.summary ?? '';
			try {
				const targetProjectId = pack.projectId ?? null;
				if (selectedProjectId !== targetProjectId && (!projectWorkspace || projectWorkspace.canChangeScope())) await selectProject(targetProjectId);
				await clearAllFilters(false);
			} catch (error) { errorText = describeError(error, 'Draft saved. Its project view could not be shown; use Open task.'); }
			return;
		}
		dismissedReceiptSummary = '';
		revealReceipt();
	}

	function runPrimary(pack: DemoPack) {
		if (!canSetNextAction(pack)) return;
		const command = primaryCommand(pack);
		if (PACK_ACTIONS.has(command.action)) {
			doAction(pack, command.action);
			return;
		}
		goto(primaryCommandNavigation(pack));
	}

	// A generic focus link may focus a card only when that card already belongs
	// to the current rendered list. A Pending-approvals context instead focuses
	// the exact validated decision workspace and never rewrites saved filters.
	let focusedArrivalKey = '';
	let preparedFocusScope = '';
	let preparedFocusFilters = '';
	let cancelArrivalFocus: (() => void) | null = null;
	function finishArrivalPreparation() {
		if (!__NEBIUS_EDITION__) return;
		const values = $page.url.searchParams.getAll('focus');
		if (values.length !== 1 || !values[0]) return;
		const resume = decisionWorkspaceWorkFocusRequest($page.url.searchParams);
		focusedArrivalKey = `${resume.present ? 'decision' : 'card'}:${values[0]}`;
		cancelArrivalFocus?.();
	}
	$effect(() => {
		if (!browser) return;
		const focusValues = $page.url.searchParams.getAll('focus');
		if (focusValues.length !== 1 || !focusValues[0]) return;
		const target = focusValues[0];
		const resume = decisionWorkspaceWorkFocusRequest($page.url.searchParams);
		const candidate = packs.find((pack) => pack.id === target) || null;
		if (resume.present && (!resume.workId || !candidate || !isOpenDecision(candidate))) return;
		if (!resume.present && !candidate) return;
		const focusKey = `${resume.present ? 'decision' : 'card'}:${target}`;
		if (focusKey === focusedArrivalKey) return;
		if (__NEBIUS_EDITION__ && candidate && selectedProjectId !== (candidate.projectId ?? null)) {
			if (preparedFocusScope === focusKey) return;
			preparedFocusScope = focusKey;
			void selectProject(candidate.projectId ?? null).catch(error => { errorText = describeError(error, 'Could not reveal this task project.'); });
			return;
		}
		if (__NEBIUS_EDITION__ && !resume.present && candidate && !visible.some(pack => pack.id === target)) {
			if (preparedFocusFilters === focusKey) return;
			preparedFocusFilters = focusKey;
			void clearAllFilters(false).then(() => focusedArrivalKey !== focusKey && candidate.archived ? applyFilter('archived') : undefined);
			return;
		}
		if (__NEBIUS_EDITION__ && !resume.present) {
			const targetIndex = visible.findIndex(pack => pack.id === target);
			if (targetIndex >= renderLimit) { renderLimit = targetIndex + 1; return; }
		}
		let cancelled = false;
		const focusTimers = new Set<ReturnType<typeof setTimeout>>();
		const scheduleFocus = (callback: () => void, delay: number) => {
			const timer = setTimeout(() => {
				focusTimers.delete(timer);
				if (!cancelled) callback();
			}, delay);
			focusTimers.add(timer);
		};
		const tryFocus = (attempts: number) => {
			if (cancelled || focusedArrivalKey === focusKey) return;
			const selector = resume.present
				? `[data-decision-workspace][data-decision-pack-id="${CSS.escape(target)}"]`
				: `[data-work-item][data-pack-id="${CSS.escape(target)}"]`;
			const destination = document.querySelector<HTMLElement>(selector);
			if (destination) {
				focusedArrivalKey = focusKey;
				focusAndPulse(destination, { block: 'center' });
				return;
			}
			if (attempts < 5) scheduleFocus(() => tryFocus(attempts + 1), 80);
		};
		scheduleFocus(() => tryFocus(0), 100);
		const cancel = () => {
			cancelled = true;
			for (const timer of focusTimers) clearTimeout(timer);
			focusTimers.clear();
		};
		cancelArrivalFocus = cancel;
		return () => { cancel(); if (cancelArrivalFocus === cancel) cancelArrivalFocus = null; };
	});

	function trackRecent(packId: string) {
		recentIds = prependRecentWorkId(recentIds, packId, packs.map((pack) => pack.id));
		try { sessionStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentIds)); } catch {}
	}

	function selectPack(pack: DemoPack) {
		if (!pack.id || !canSetNextAction(pack)) return;
		trackRecent(pack.id);
		goto(`/next?pack=${encodeURIComponent(pack.id)}`);
	}

	// Pin and reaction controls update only this browser's saved sample state.
	async function togglePin(pack: DemoPack) {
		if (!pack.id || busyId) return;
		busyId = pack.id;
		busyAction = 'pin';
		try {
			await savePackBrowserFields(pack.id, (target) => {
				target.pinned = !target.pinned;
			});
		} catch { displayToast('Pin toggle failed', 'error'); } finally {
			busyId = '';
			busyAction = '';
		}
	}

	async function setPackEnergy(pack: DemoPack, energy: string) {
		if (!pack.id || busyId || !PACK_ENERGIES.includes(energy)) return;
		busyId = pack.id;
		busyAction = 'energy';
		try {
			await savePackBrowserFields(pack.id, (target) => {
				target.energy = energy;
			});
			displayToast(`Energy set to ${energy}.`, 'success');
		} catch {
			displayToast('Energy change failed', 'error');
		} finally {
			busyId = '';
			busyAction = '';
		}
	}

	async function snoozePack(pack: DemoPack, days: number) {
		if (!pack.id || busyId) return;
		const current = pack.due ? parseDateOnly(pack.due) : new Date();
		if (!current) {
			displayToast('Snooze failed', 'error');
			return;
		}
		current.setDate(current.getDate() + days);
		const newDue = localDateInputValue(current);
		busyId = pack.id;
		try {
			await savePackPath(pack.id, { due: newDue });
		} catch { displayToast('Snooze failed', 'error'); } finally {
			busyId = '';
		}
	}

	async function showMoreWork(event: MouseEvent) {
		const trigger = event.currentTarget as HTMLElement;
		const previousCount = renderedVisible.length;
		const nextLimit = renderLimit + WORK_RENDER_LIMIT;
		const removesTrigger = nextLimit >= visible.length;
		renderLimit = nextLimit;
		await settleProgressiveReveal({
			settled: tick(),
			removesTrigger,
			trigger,
			getDestination: () => {
				const firstNewCard = document.querySelectorAll<HTMLElement>('[data-work-item][data-pack-id]')[previousCount];
				return firstNewCard ? { focusTarget: firstNewCard } : null;
			}
		});
	}

	function applySnooze(pack: DemoPack, key: string) {
		const packId = pack.id;
		if (!packId) return;
		const focused = document.activeElement as HTMLElement | null;
		const restoreFocus = focused?.matches('.work-snooze-select') ?? false;
		const days = Number(snoozeDays[key] || '');
		snoozeDays[key] = '';
		if (![1, 3, 7].includes(days)) return;
		if (restoreFocus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`.work-snooze-select[data-pack="${CSS.escape(packId)}"]`)?.focus());
		void snoozePack(pack, days);
	}

	async function repeatPack(pack: DemoPack) {
		if (!pack.id || busyId) return;
		busyId = pack.id;
		try {
			await savePackPath(pack.id, { status: 'active', next: 'Open', blocker: 'none' });
		} catch { displayToast('Repeat failed', 'error'); } finally {
			busyId = '';
		}
	}

	async function reactPack(pack: DemoPack, emoji: string) {
		if (!pack.id) return;
		try {
			await savePackBrowserFields(pack.id, (target) => {
				const reactions = { ...((target.reactions as Record<string, number>) || {}) };
				reactions[emoji] = (reactions[emoji] || 0) + 1;
				target.reactions = reactions;
			});
		} catch { displayToast('Reaction failed', 'error'); }
	}

	// ── Drag-to-reorder: move the dragged item beside its drop target ──
	let dragSrcId = '';
	function handleDragStart(e: DragEvent, packId: string) {
		if (batchMode) { e.preventDefault(); return; }
		dragSrcId = packId;
		e.dataTransfer!.effectAllowed = 'move';
		(e.currentTarget as HTMLElement | null)?.closest<HTMLElement>('[data-work-item][data-pack-id]')?.classList.add('dragging');
	}
	function handleDragOver(e: DragEvent, packId: string) {
		if (batchMode) return;
		if (sortBy !== 'manual') return;
		if (!dragSrcId || packId === dragSrcId) return;
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
		document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
		(e.currentTarget as HTMLElement | null)?.classList.add('drag-over');
	}
	function handleDragEnd() {
		document.querySelectorAll('.dragging, .drag-over').forEach((el) => el.classList.remove('dragging', 'drag-over'));
		dragSrcId = '';
		energyDragTarget = '';
	}
	function handleDrop(e: DragEvent, targetId: string) {
		if (batchMode) { e.preventDefault(); return; }
		if (sortBy !== 'manual') { e.preventDefault(); handleDragEnd(); return; }
		e.preventDefault();
		const sourceId = dragSrcId;
		handleDragEnd();
		if (!sourceId || sourceId === targetId) return;
		saveBrowserState((draft) => {
			const order = [...((draft.manualOrder as string[] | undefined) || draft.packs.map((pack) => pack.id))];
			const from = order.indexOf(sourceId);
			const to = order.indexOf(targetId);
			if (from < 0 || to < 0) return;
			order.splice(from, 1);
			order.splice(order.indexOf(targetId), 0, sourceId);
			draft.manualOrder = order;
		}).catch(() => {
			displayToast('Reorder did not save.', 'error');
		});
	}
	async function moveFocusedManual(delta: -1 | 1) {
		if (sortBy !== 'manual' || busyId) return;
		const focusedId = manualTargetId || manualFocusId || (document.activeElement as HTMLElement | null)?.dataset.packId || $demoState?.selectedId || '';
		const currentIndex = visible.findIndex((pack) => pack.id === focusedId);
		const target = visible[currentIndex + delta];
		if (!focusedId || currentIndex < 0 || !target?.id) return;
		try {
			await saveBrowserState((draft) => {
				const order = [...((draft.manualOrder as string[] | undefined) || draft.packs.map((pack) => pack.id))];
				const from = order.indexOf(focusedId);
				const to = order.indexOf(target.id);
				if (from < 0 || to < 0) return;
				order.splice(from, 1);
				order.splice(order.indexOf(target.id) + (delta > 0 ? 1 : 0), 0, focusedId);
				draft.manualOrder = order;
			});
			manualOrderAnnouncement = `${workTitle(packs.find((pack) => pack.id === focusedId) || target)} moved ${delta < 0 ? 'before' : 'after'} ${workTitle(target)}.`;
		} catch { displayToast('Manual reorder did not save.', 'error'); }
	}
	// Drag-to-energy: drop a card on an energy chip to set its energy level
	let energyDragTarget = $state('');
	function handleEnergyDragOver(e: DragEvent, energy: string) {
		if (!dragSrcId) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		energyDragTarget = energy;
	}
	function handleEnergyDragLeave(energy: string) {
		if (energyDragTarget === energy) energyDragTarget = '';
	}
	async function handleEnergyDrop(e: DragEvent, energy: string) {
		e.preventDefault();
		const id=dragSrcId;
		handleDragEnd();
		if(!id||!PACK_ENERGIES.includes(energy))return;
		try{await savePackBrowserFields(id,target=>{target.energy=energy})}catch(e){displayToast('Energy change failed','error')}
	}

</script>

{#snippet workEmptyState()}
	{#if packs.length > 0 && hasActiveFilters}
		<WornEmpty
			title="No matches"
			description={`No work items match ${activeFilterLabel}.`}
		>
			<WornButton variant="primary" size="md" onclick={() => clearAllFilters()} data-action="clear-filters">Clear all filters</WornButton>
		</WornEmpty>
	{:else if query.trim()}
		<WornEmpty
			title={`No work matches "${query.trim()}"`}
			description="Try a shorter or broader query, or clear search and review results."
		>
			<WornButton variant="primary" size="md" onclick={clearSearch}>Clear search</WornButton>
		</WornEmpty>
	{:else}
		<WornEmpty
			title="No sample work available"
			description={__NEBIUS_EDITION__ ? 'Add a task or start a new project in Work.' : 'Load the guide sample to preview each step, or add your own items in Work.'}
		>
			<WornButton variant="primary" size="md" href="/work">Work</WornButton>
		</WornEmpty>
	{/if}
{/snippet}

{#snippet batchCheckbox(pack: DemoPack)}
	<div class="demo-batch-check-slot"><WornCheckbox checked={batchSelected.has(pack.id!)} disabled={busyId === 'batch'} ariaLabel={`Select ${workTitle(pack)} for batch actions`} aria-checked={batchSelected.has(pack.id!)} data-batch-check onchange={() => toggleBatchSelection(pack.id!)} /></div>
{/snippet}

<svelte:window onkeydown={handleWindowKeys} />

<svelte:head><title>Work — Wornpage Projects™</title></svelte:head>

<!-- Keep existing browser-local items visible during a background refresh;
     show the skeleton only when there is genuinely nothing to render. -->
<WornPage sectionLabel={__NEBIUS_EDITION__ ? 'Work overview' : 'Step 1 of 3 · Observe'} title="Work" status={workStatus} variant="list" loading={!workspaceLoaded && ($demoStateLoading || !$demoStateError)}>

	{#snippet headActions()}
		<div class="work-head-actions">
			<WorkShortcutHelp bind:open={shortcutHelpOpen} />
			{#if __NEBIUS_EDITION__}<WornButton size="sm" href={scopedSelectedId ? `/recovery-rehearsal?pack=${encodeURIComponent(scopedSelectedId)}` : '/recovery-rehearsal'}>Try recovery simulator</WornButton>{/if}
			{#if __NEBIUS_EDITION__}<WornButton size="sm" aria-haspopup="dialog" aria-expanded={workMenuOpen} onclick={() => (workMenuOpen = true)}>Work menu</WornButton>{/if}
			<WornButton
				class="work-command-trigger"
				size="sm"
				aria-label="Command palette"
				title="Open command palette (⌘/Ctrl + K)"
				aria-haspopup="dialog"
				onclick={openWorkCommandPalette}
			>
				<Command aria-hidden="true" />
				<span>Commands</span>
			</WornButton>
			{#if packs.length > 1 || batchMode}
				<WornIconButton class={batchMode ? 'work-mode-active' : undefined} size="sm" label="Batch" title="Toggle batch select mode" data-action="batch-mode" aria-pressed={batchMode} disabled={busyId === 'batch'} onclick={toggleBatchMode}>
					<ListChecks aria-hidden="true" />
				</WornIconButton>
			{/if}
			{#if packs.length > 1 || focusMode}
				<WornIconButton
					class={focusMode ? 'work-mode-active' : undefined}
					size="sm"
					label="Focus"
					title={focusMode ? 'Exit Focus (F)' : scopedSelectedId ? 'Focus on selected work (F)' : 'Select a work item to use Focus'}
					data-action="focus-mode"
					aria-pressed={focusMode}
					disabled={!focusMode && !scopedSelectedId}
					onclick={toggleFocusMode}
				>
					<Focus aria-hidden="true" />
				</WornIconButton>
			{/if}
		</div>
	{/snippet}

	<!-- Keep the last good local view below a refresh error and offer Retry. -->
	{#if $demoStateError}
		<WornError message="Could not load work items." detail={$demoStateError} onretry={refreshWork} />
	{/if}

	{#if pendingDecisionResumeError}
		<div data-decision-resume-rejected>
			<WornAlert tone="warning">{pendingDecisionResumeError}</WornAlert>
		</div>
	{/if}

	{#if __NEBIUS_EDITION__}
		<NebiusProjectWorkspace bind:this={projectWorkspace} onApproved={async () => {
			await clearAllFilters(false);
			await tick();
			document.querySelector<HTMLAnchorElement>('[data-nebius-work-entry] a')?.focus();
		}} />
		<section class="nebius-work-entry" aria-label="Task actions" data-nebius-work-entry>
			<div>
				<strong>{nebiusSelectedPack ? workTitle(nebiusSelectedPack) : 'Choose a task'}</strong>
			</div>
			<div class="nebius-work-actions">
			{#if nebiusSelectedPack}
				{#if !canSetNextAction(nebiusSelectedPack)}
					{#if nebiusContinuePack}
						<WornButton data-nebius-continue variant="primary" href={`/next?pack=${encodeURIComponent(nebiusContinuePack.id)}`}>Continue: {workTitle(nebiusContinuePack)}</WornButton>
					{/if}
					<WornButton data-nebius-task-history-action variant={nebiusContinuePack ? 'default' : 'primary'} href={`/next?pack=${encodeURIComponent(nebiusSelectedPack.id)}&view=review`}>View task history</WornButton>
				{:else if nebiusSelectedPack.executionRun}
					<WornButton variant="primary" href={`/next?pack=${encodeURIComponent(nebiusSelectedPack.id)}&view=review`}>Review saved run</WornButton>
				{:else}
					<WornButton variant="primary" href={`/next?pack=${encodeURIComponent(nebiusSelectedPack.id)}&view=brief`}>Open task</WornButton>
				{/if}
			{:else}
				<WornButton variant="primary" type="button" disabled>Open task</WornButton>
			{/if}
			</div>
			<div class="nebius-work-context">
				{#if nebiusSelectedPack}
					{#if !canSetNextAction(nebiusSelectedPack)}
						<p data-nebius-task-history><b>{nebiusSelectedPack.archived ? 'Archived task.' : 'Completed task.'}</b></p>
						{#if nebiusSelectedPack.nextStep || hasBlocker(nebiusSelectedPack)}
							<details data-nebius-historical-context>
								<summary>Previous task context</summary>
								{#if nebiusSelectedPack.nextStep}<p><b>Previous next step:</b> {nebiusSelectedPack.nextStep}</p>{/if}
								{#if hasBlocker(nebiusSelectedPack)}<p><b>Previous blocker:</b> {blockerText(nebiusSelectedPack)}</p>{/if}
							</details>
						{/if}
					{:else}
					{#if nebiusSelectedPack.nextStep}<p data-nebius-selected-next-step><b>Next step:</b> {nebiusSelectedPack.nextStep}</p>{/if}
					{#if hasBlocker(nebiusSelectedPack)}<p data-nebius-selected-blocker><b>Blocker:</b> {blockerText(nebiusSelectedPack)}</p>{/if}
					{#if nebiusSelectedPack.executionRun}<p>Review the saved run before deciding what to do next.</p>{/if}
					{/if}
				{:else}<p>Create or open a task to continue.</p>{/if}
			</div>
		</section>
		{#if receiptVisible && additionalReadyPacks.length}
			<section class="demo-ready-next" aria-labelledby="ready-next-heading" data-ready-next>
				<h2 id="ready-next-heading">{nebiusContinuePack ? 'More ready tasks' : 'Ready next'}</h2>
				<ul>
					{#each additionalReadyPacks as pack (pack.id)}
						<li><a href={`/next?pack=${encodeURIComponent(pack.id)}`}>{workTitle(pack)}</a></li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}

	{#if __NEBIUS_EDITION__}
		<NebiusProjectRehearsal
			project={$demoState?.projects?.find(project => project.id === selectedProjectId) ?? null}
			tasks={selectedProjectId ? orderPacks(scopedPacks, sortBy, manualOrder) : []}
		/>
	{/if}

	<WorkQuickAdd
		bind:this={quickAdd}
		filters={{ owner: ownerFilter, area: areaFilter, energy: energyFilter, recurrence: recurrenceFilter }}
		projects={$demoState?.projects ?? []}
		{selectedProjectId}
		onCreated={revealQuickAddReceipt}
		onUndone={() => { dismissedReceiptSummary = $demoState?.actionReceipt?.summary ?? ''; }}
		bind:busy={quickAddBusy}
	/>

	{#if decisionWorkspace}
		<WorkDecisionWorkspace
			recommendation={decisionWorkspace}
			reason={decisionWorkspaceReason}
			decider={decisionWorkspaceDecider}
			resumed={Boolean(focusedDecisionPack)}
			outsideCurrentView={focusedDecisionOutsideView}
		/>
	{/if}

	{#if showWorkControls}
		<WorkFilterControls
			{filter}
			{statusFilterOptions}
			bind:query
			{workMetadata}
			bind:energyFilter
			bind:areaFilter
			bind:recurrenceFilter
			bind:ownerFilter
			bind:dueUrgencyFilter
			bind:sortBy
			bind:hideDone
			{hideDoneApplies}
			bind:density
			bind:secondaryFiltersOpen
			densityTabs={DENSITY_TABS}
			{energyDragTarget}
			packCount={packs.length}
			onStatusFilterChange={handleStatusFilterChange}
			onClearAllFilters={clearAllFilters}
			onEnergyDragOver={handleEnergyDragOver}
			onEnergyDragLeave={handleEnergyDragLeave}
			onEnergyDrop={handleEnergyDrop}
			onDensityChange={handleDensityChange}
			onInteraction={finishArrivalPreparation}
		/>
	{/if}
	<WorkBatchActions
		active={batchMode}
		{packs}
		selected={batchSelected}
		bind:busyId
		bind:errorText
	/>
	{#if sortBy === 'manual' && visible.length > 1}
		<div class="manual-order-toolbar" role="toolbar" aria-label="Manual ordering controls">
			<span>Manual order</span>
			<WornSelect aria-label="Card to reorder" options={manualTargetOptions} bind:value={manualTargetId} />
			<WornButton size="sm" type="button" disabled={!manualTargetId && !manualFocusId && !$demoState?.selectedId} onclick={() => moveFocusedManual(-1)}>Move focused up</WornButton>
			<WornButton size="sm" type="button" disabled={!manualTargetId && !manualFocusId && !$demoState?.selectedId} onclick={() => moveFocusedManual(1)}>Move focused down</WornButton>
			<span aria-live="polite">{manualOrderAnnouncement}</span>
		</div>
	{/if}

	{#if receiptVisible && receipt}
		<WornReceipt id="work-receipt"
			summary={receipt.summary || ''}
			announce={false}
			cells={receipt.pack ? receiptCells(receipt.pack) : []}
			undoAvailable={receipt ? ($receiptUndo?.type === 'batch' || Boolean($receiptUndo && receipt.pack?.id && $receiptUndo.type === 'action' && $receiptUndo.packId === receipt.pack.id)) : false}
			onundo={() => undoReceipt()}
			ondone={() => (dismissedReceiptSummary = receipt?.summary || '')}
		/>
	{/if}

	{#if errorText}
		<WornAlert tone="danger" dismissible dismissLabel="Dismiss work-list error">{errorText}</WornAlert>
	{/if}

	{#each densityPanelTabs as densityTab (densityTab.id)}
	<div
		role={packs.length > 1 && secondaryFiltersOpen ? 'tabpanel' : undefined}
		id={packs.length > 1 ? `work-density-panel-${densityTab.id}` : undefined}
		aria-labelledby={packs.length > 1 && secondaryFiltersOpen ? `work-density-tab-${densityTab.id}` : undefined}
		hidden={packs.length > 1 && densityTab.id !== density}
	>
	{#if densityTab.id === density}
	{#if density === 'grid'}
		<div class="demo-work-grid" class:batch-active={batchMode} role="list" aria-label="Work items grid">
			{#each renderedVisible as pack, i (pack.id)}
				<WorkGridCard
					{pack}
					index={i}
					selectedId={$demoState?.selectedId}
					{focusedIndex}
					{batchMode}
					batchSelected={batchSelected.has(pack.id!)}
					{busyId}
					{batchCheckbox}
					onCardClick={handleCardClick}
					onCardKeydown={handleCardKeys}
					onCardFocus={(index) => { focusedIndex = index; manualFocusId = pack.id!; manualTargetId = pack.id!; }}
					onPrimaryMutation={doAction}
				/>
			{/each}
		</div>
		{#if hasMoreVisible}
			<div class="work-load-more">
				<span aria-live="polite">{renderedVisible.length} of {visible.length} shown</span>
				<WornButton type="button" size="sm" data-action="show-more-work" onclick={showMoreWork}>Show {Math.min(WORK_RENDER_LIMIT, visible.length - renderedVisible.length)} more</WornButton>
			</div>
		{/if}
	{#if workspaceLoaded && visible.length === 0}
		{@render workEmptyState()}
	{/if}
	{:else}
	<!-- Card density. The switcher offers two modes but this branch was deleted
	     along with the retired landing/table views, so choosing "Cards" rendered
	     an empty page — and the handlers it is the only caller of (snoozePack,
	     repeatPack, togglePin, selectPack) sat dead. Restored from 4682a52; the
	     .demo-work-card CSS was never removed. -->
	<div class="demo-work-list">
		{#if recentPacks.length > 0}
			<nav class="demo-chip-row" aria-label="Recently viewed work">
				{#each recentPacks as pack (pack.id)}
					<WornChip size="sm" label={workTitle(pack)} href={`/next?pack=${encodeURIComponent(pack.id || '')}`} data-action="recent-work" />
				{/each}
			</nav>
		{/if}
		{#each renderedVisible as pack, i (pack.id)}
			<WorkListCard
				{pack}
				index={i}
				selectedId={$demoState?.selectedId}
				{focusedIndex}
				{batchMode}
				{busyId}
				{busyAction}
				{batchCheckbox}
				{receipt}
				receiptUndo={$receiptUndo?.type === 'action' ? $receiptUndo : null}
				{snoozeDays}
				onCardClick={handleCardClick}
				onCardKeydown={handleCardKeys}
				onCardFocus={(index) => { focusedIndex = index; manualFocusId = pack.id!; manualTargetId = pack.id!; }}
				onDragStart={handleDragStart}
				onDragOver={handleDragOver}
				onDragEnd={handleDragEnd}
				onDrop={handleDrop}
				onTrackRecent={trackRecent}
				onPrimaryMutation={doAction}
				onAction={doAction}
				onTogglePin={togglePin}
				onApplySnooze={applySnooze}
				onRepeatPack={repeatPack}
				onReactPack={reactPack}
				onUndoReceipt={undoReceipt}
				onSetEnergy={setPackEnergy}
			/>
		{/each}
		{#if hasMoreVisible}
			<div class="work-load-more">
				<span aria-live="polite">{renderedVisible.length} of {visible.length} shown</span>
				<WornButton type="button" size="sm" data-action="show-more-work" onclick={showMoreWork}>Show {Math.min(WORK_RENDER_LIMIT, visible.length - renderedVisible.length)} more</WornButton>
			</div>
		{:else if workspaceLoaded && visible.length === 0}
			{@render workEmptyState()}
		{/if}
	</div>
		{/if}
	{/if}
	</div>
	{/each}

	{#if !__NEBIUS_EDITION__}<WornDialog bind:open={commandPaletteOpen} title="Work command palette" size="sm">
		<p class="work-command-palette-help">Filter commands with your keyboard and run one safe action.</p>
		<WornInput
			type="search"
			value={commandPaletteQuery}
			oninput={(event) => {
				commandPaletteQuery = (event.currentTarget as HTMLInputElement).value;
			}}
			onkeydown={handleWorkCommandInputKeydown}
			placeholder="Type command…"
			aria-label="Filter work commands"
			autofocus
		/>
		<div class="work-command-palette-list" role="listbox" aria-label="Work command actions">
			{#if commandPaletteCommands.length === 0}
				<p class="work-command-empty" role="status">No matching commands.</p>
			{:else}
				{#each commandPaletteCommands as command, commandIndex (command.id)}
					<button
						type="button"
						data-work-command-index={commandIndex}
						class="work-command-entry"
						disabled={command.disabled}
						class:work-command-entry-active={commandIndex === commandPaletteActiveIndex}
						onclick={() => runWorkCommand(command)}
						onfocus={() => (commandPaletteActiveIndex = commandIndex)}
					>
						<span>{command.label}</span>
						<small>{command.description}</small>
					</button>
				{/each}
			{/if}
		</div>
		<div class="work-command-palette-actions">
			<WornButton type="button" onclick={closeWorkCommandPalette}>Close</WornButton>
		</div>
	</WornDialog>{/if}

	<WorkRecentActivity {packs} />
</WornPage>

{#if __NEBIUS_EDITION__}
	<WornDialog bind:open={workMenuOpen} title="Work menu" size="sm">
		<section class="work-backup" aria-labelledby="work-backup-title">
			<h2 id="work-backup-title">Workspace backup</h2>
			<p>Download projects, tasks, pending drafts, and saved tool results. Review a backup before merging it or replacing this browser workspace.</p>
			{#if packs.some((pack) => pack.executionRun)}<p>Keep this backup private: it includes saved tool results and access to their retained runs.</p>{/if}
			<div class="work-backup-actions">
				<WornButton type="button" size="sm" onclick={prepareWorkspaceExport}>Prepare backup</WornButton>
				{#if exportHref}<a class="work-backup-download" href={exportHref} download="projects-workspace.json">Download backup</a>{/if}
				<label class="work-backup-import">Import backup<input bind:this={importInput} type="file" accept="application/json" disabled={importBusy} onchange={selectWorkspaceFile} /></label>
			</div>
			{#if importError}<p class="work-backup-error" role="alert">{importError}</p>{/if}
			{#if importPreview}
				<div class="work-backup-preview" aria-live="polite"><strong>Preview:</strong> {importPreview.packs} work items · {importPreview.pendingApprovals} pending approvals · {importPreview.collisions} existing ID collisions{importPreview.collisionIds.length ? ` (${importPreview.collisionIds.join(', ')})` : ''}.</div>
				<div class="work-backup-actions"><WornButton size="sm" variant="primary" disabled={importBusy} onclick={() => requestWorkspaceImport('merge')}>Merge</WornButton><WornButton size="sm" variant="danger" disabled={importBusy} onclick={() => requestWorkspaceImport('replace')}>Replace</WornButton></div>
			{/if}
			<p><a href="/landing.html#help">Help and local setup</a></p>
		</section>
	</WornDialog>
	<WornDialog bind:open={replaceConfirmOpen} title="Confirm workspace replacement" size="sm">
		<p class="work-backup-warning">Replace will discard the current browser workspace and restore the imported file. Download a backup first if you may need the current state.</p>
		<div class="work-backup-actions"><WornButton type="button" onclick={() => (replaceConfirmOpen = false)}>Cancel</WornButton><WornButton type="button" variant="danger" disabled={importBusy} onclick={() => { replaceConfirmOpen = false; void applyWorkspaceImport('replace'); }}>Confirm replace</WornButton></div>
	</WornDialog>
{/if}

<style>
	.work-backup { display: grid; gap: 12px; }
	.work-backup h2, .work-backup p { margin: 0; }
	.work-backup p, .work-backup-preview, .work-backup-warning { color: var(--worn-text-secondary); line-height: 1.5; }
	.work-backup-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
	.work-backup-download, .work-backup-import { align-content: center; border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); color: var(--worn-text); cursor: pointer; font-family: var(--font-typewriter); font-size: 12px; font-weight: 650; min-block-size: 32px; padding: 4px 10px; text-decoration: none; }
	.work-backup-import input { max-inline-size: 1px; opacity: 0; position: absolute; }
	.work-backup-import:focus-within, .work-backup-download:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 2px; }
	.work-backup-error { color: var(--worn-danger-text) !important; }
	.demo-ready-next { border-inline-start: 1px solid var(--worn-border-strong); margin-block: 1rem; min-width: 0; padding-inline: 1rem; }
	.demo-ready-next h2 { font-size: 1rem; margin: 0 0 .5rem; }
	.demo-ready-next ul { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; list-style: none; margin: 0; padding: 0; }
	.demo-ready-next li { max-width: 100%; min-width: 0; }
	.demo-ready-next a, .demo-ready-next a:visited { align-items: center; color: var(--worn-text); display: inline-flex; min-height: 44px; overflow-wrap: anywhere; text-decoration: underline; text-underline-offset: .2em; }
	.demo-ready-next a:hover { text-decoration-thickness: 2px; }
	.demo-ready-next a:focus-visible { border-radius: 2px; outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.nebius-work-entry { align-items: center; background: var(--worn-surface); border: 1px solid var(--worn-border-strong); border-radius: var(--worn-radius); box-shadow: var(--worn-shadow-sm); display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; justify-content: space-between; margin-block: 1rem 1.5rem; padding: clamp(1rem, 2.5vw, 1.5rem); }
	.nebius-work-entry p { color: var(--worn-text-secondary); line-height: 1.55; margin: 0; overflow-wrap: anywhere; }
	.nebius-work-entry > div:first-child { flex: 1 1 14rem; max-inline-size: 100%; min-inline-size: 0; }
	.nebius-work-entry strong { display: block; font-size: clamp(1.1rem, 1.8vw, 1.35rem); line-height: 1.35; overflow-wrap: anywhere; }
	.nebius-work-context { display: grid; flex: 1 0 100%; gap: .5rem; min-inline-size: 0; }
	.nebius-work-context b { color: var(--worn-text); font-weight: 650; }
	.nebius-work-context [data-nebius-selected-next-step] { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
	.nebius-work-actions { display: flex; flex-wrap: wrap; gap: .5rem; min-inline-size: 0; }
	.nebius-work-actions :global(.worn-btn) { max-inline-size: 100%; min-block-size: 44px; white-space: normal; }
	@media (max-width: 480px) { .nebius-work-actions { flex: 1 1 100%; } .nebius-work-actions :global(.worn-btn) { flex: 1; } }
	.manual-order-toolbar { margin-top: 12px; }
	.work-head-actions {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}
	:global(.work-command-trigger svg) { height: 16px; width: 16px; }
	:global(.work-mode-active) {
		background: var(--worn-selected-bg) !important;
		border-color: var(--worn-link) !important;
		box-shadow: inset 0 0 0 1px var(--worn-link);
		color: var(--worn-selected-fg) !important;
	}
	@media(max-width:420px){
		:global(.demo-panel-head:has(.work-head-actions)){align-items:flex-start;flex-wrap:wrap}
		.work-head-actions{flex-wrap:wrap;gap:4px;justify-content:flex-start;width:100%}
	}
	@media(max-width:700px){
		:global(.demo-panel-head:has(.work-head-actions)){gap:8px;padding-block:7px}
		:global(.demo-panel-head:has(.work-head-actions) .demo-panel-title){margin-block:0}
	}
	.demo-work-list {
		overflow: visible;
		padding-block-start: 8px;
	}
	/* Grid density view */
	/* minmax(280px, …) means each column is AT LEAST 280px wide — below that the
	   track stops shrinking and the grid overflows its container. min(280px,100%)
	   keeps the intent (roughly 280px cards) while letting a narrow screen win. */
	.demo-work-grid{display:grid;margin-top:4px;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:8px;max-width:100%;min-width:0}
	.work-load-more{align-items:center;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:12px;color:var(--worn-text-muted);font-size:12px}
	@media(max-width:800px){
		.demo-work-grid{grid-template-columns:1fr}
		:global([data-work-item] .worn-btn[data-work-primary-navigation]),
		:global([data-work-item] .worn-btn[data-work-primary-mutation]){min-height:44px}
	}
	.work-command-palette-help { color: var(--worn-text-muted); font-size: 13px; margin: 0 0 10px; }
	.work-command-palette-list { border-top: 1px solid var(--worn-border); display: grid; gap: 8px; margin-top: 8px; max-height: 50vh; overflow: auto; padding-top: 8px; }
	.work-command-entry { appearance: none; background: var(--worn-surface); border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); color: var(--worn-text); display: grid; font: inherit; gap: 4px; padding: 10px 12px; text-align: left; width: 100%; }
	.work-command-entry:hover { background: var(--worn-selected-bg); border-color: var(--worn-field-border); }
	.work-command-entry:focus-visible { outline: 2px dashed var(--worn-focus); outline-offset: -4px; }
	.work-command-entry-active { background: var(--worn-selected-bg); border: 2px solid var(--worn-field-border); }
	.work-command-entry-active span { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: .2em; }
	.work-command-entry:disabled { opacity: 0.6; }
	.work-command-entry span { font-weight: 610; }
	.work-command-entry small { color: var(--worn-text-muted); font-size: 12px; }
	.work-command-empty { color: var(--worn-text-muted); margin: 0; }
	.work-command-palette-actions { display: flex; justify-content: flex-end; margin-top: 12px; }

</style>
