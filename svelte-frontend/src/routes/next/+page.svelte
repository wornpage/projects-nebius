<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import { TASK_LOCATION_CONTEXT, type TaskLocationSink } from '$lib/nebius-shell-navigation.mjs';
	import { browser } from '$app/environment';
	import { beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		demoState,
		demoStateError,
		refreshDemoState,
		setPackNextAction,
		revisePendingNextActionDraftChoice,
		discardPendingNextActionDraft,
		pendingNextActionDraftFor,
		pendingDraftFingerprint,
		setSelectedWork,
		displayToast,
		ChallengeStateError,
		type PendingNextActionDraft
	} from '$lib/demo-client';
	import { pendingDraftCountFor, pendingDraftHasDuplicateEvidence, pendingDraftReferencesAvailable } from '$lib/pending-next-action.mjs';
	import {
		NEXT_ACTION_CHOICES,
		nextChoiceForwardPath,
		blockerText,
		canSetNextAction,
		isReview,
		hasBlocker,
		isOpenDecision,
		workTitle,
		type DemoPack
	} from '$lib/demo-workflow';
	import {
		WornAlert,
		WornButton,
		WornChip,
		WornEmpty,
		WornError,
		WornInput,
		WornPage,
		WornTabs,
		WornReceipt,
		WornCollapsible
	} from '$lib/components';
	import { workItemIssues } from '$lib/work-item-issues';
	import { focusAndPulse } from '$lib/focus-pulse.mjs';
	import {
		DECISION_WORKSPACE_CONTEXT,
		DECISION_WORKSPACE_CONTEXT_REASON,
		decisionWorkspaceContextDecider,
		decisionWorkspaceContextPackId
	} from '$lib/decision-workspace-navigation.mjs';
	import NextCandidatePicker from './NextCandidatePicker.svelte';
	import NextWorkContext from './NextWorkContext.svelte';
	import NebiusTaskContext from './NebiusTaskContext.svelte';
	import NebiusSuggestion from './NebiusSuggestion.svelte';
	import NebiusTaskEditor from './NebiusTaskEditor.svelte';
	import NebiusRunReview from '../review/NebiusRunReview.svelte';
	import NebiusTaskRun from './NebiusTaskRun.svelte';
	import NebiusProjectEvidence from './NebiusProjectEvidence.svelte';
	import type { NebiusChanges } from '$lib/nebius-contract.mjs';
	import {
		NEXT_ACTION_MAX_LENGTH,
		NEXT_EDITOR_PREVIEW_ID,
		NEXT_PREPARATION_RECEIPT_ID,
		NEXT_PREPARATION_SUMMARY,
		createNextDraftRevisionState,
		nextDraftTerminalAvailable,
		reviseNextDraft,
		runSettledNextDraftAction,
		shouldHydratePendingDraft
	} from './next-draft.mjs';

	type NextEditorMode = 'preset' | 'custom';
	type NextEvidenceField = 'workflow' | 'blocker';
	type NextVerifiedEvidence = {
		work: { id: string; title: string };
		field: NextEvidenceField;
		label: string;
		value: string | null;
	};
	type PreparationReceipt = {
		summary: string;
		work: { id: string; title: string };
		evidenceNote: string;
		evidence: NextVerifiedEvidence[];
		preparedAction: string;
		workspaceChanged: false;
		requiresHumanSave: true;
	};
	type EditorSnapshot = { mode: NextEditorMode; choice: string };
	type SavedNextReceipt = { summary: string; pack: DemoPack };
	type DecisionWorkspaceContext = {
		mode: 'decision-workspace';
		reason: string;
		decider: string | null;
	};
	type HumanRevisionSnapshot = {
		choice: string;
		customValue: string;
		showingCustom: boolean;
		editorChoiceStaged: boolean;
		preparationReceipt: PreparationReceipt | null;
		preparationPreviousEditor: EditorSnapshot | null;
		savedNextReceipt: SavedNextReceipt | null;
	};

	let chosenPackId = $state('');
	let choice = $state('');
	let customValue = $state('');
	let showingCustom = $state(false);
	let editorChoiceStaged = $state(false);
	let nebEditorDirty = $state(false);
	let nebUpdateDirty = $state(false);
	let nebReviewDirty = $state(false);
	let nebReviewBusy = $state(false);
	let taskView = $state('brief');
	const publishTaskLocation = getContext<TaskLocationSink | undefined>(TASK_LOCATION_CONTEXT);
	$effect(() => {
		if (!__NEBIUS_EDITION__ || !publishTaskLocation) return;
		publishTaskLocation(pack?.id ? { id: pack.id, view: taskView } : null);
		return () => publishTaskLocation(null);
	});
	const taskViews = [
		{ id: 'brief', label: 'Brief', tabId: 'task-tab-brief', panelId: 'task-panel-brief' },
		{ id: 'tool', label: 'Tool', tabId: 'task-tab-tool', panelId: 'task-panel-tool' },
		{ id: 'review', label: 'Review', tabId: 'task-tab-review', panelId: 'task-panel-review' }
	];
	const legacyTaskViewAliases: Readonly<Record<string, string>> = {
		next: 'brief',
		build: 'tool',
		evidence: 'review'
	};
	let navigationNotice = $state('');
	let nebiusProposal = $state<{ packId: string; changes: NebiusChanges; nonce: number } | null>(null);
	let nebiusProposalNonce = 0;
	let busy = $state(false);
	let errorText = $state('');
	let preparationReceipt = $state<PreparationReceipt | null>(null);
	let draftRevision = $state(createNextDraftRevisionState());
	let preparationPreviousEditor = $state<EditorSnapshot | null>(null);
	let savedNextReceipt = $state<SavedNextReceipt | null>(null);
	let editorPackId = $state('');
	let editorFocusRequest = 0;
	let saveFocusFrame: number | null = null;
	let allPacks = $derived(($demoState?.packs ?? []) as DemoPack[]);
	let taskProject = $derived($demoState?.projects?.find((project) => project.id === pack?.projectId));
	let packs = $derived(allPacks.filter(canSetNextAction));
	let requestedPackId = $derived(browser ? ($page.url.searchParams.get('pack') || '') : '');
	let runReviewHandle = $state<{ focusEvidence: () => Promise<void> } | null>(null);
	let decisionWorkspaceContextId = $derived(
		browser ? decisionWorkspaceContextPackId($page.url.searchParams) : ''
	);
	// Work and Review link here with an explicit ?pack= selection.
	let selectedId = $derived(
		(!__NEBIUS_EDITION__ ? chosenPackId : '') ||
			// The prerender has no browser URL; hydration resolves the real query.
			requestedPackId ||
			$demoState?.selectedId ||
			''
	);
	// An explicit selection never falls back to a different work item.
	let demoLoaded = $derived(Boolean($demoState?.packs));
	let pack = $derived(
		packs.find((p) => p.id === selectedId) ||
		(__NEBIUS_EDITION__ && selectedId
			? allPacks.find((p) => p.id === selectedId && !canSetNextAction(p)) || null
			: null) ||
			(!selectedId ? packs.find(isReview) || packs[0] : null) ||
			null
	);
	let readOnlyTask = $derived(Boolean(__NEBIUS_EDITION__ && pack && !canSetNextAction(pack)));
	let taskContextPacks = $derived(pack && readOnlyTask ? [pack, ...packs.filter((candidate) => candidate.id !== pack?.id)] : packs);
	let visiblePackId = $derived(pack?.id || '');
	let appliedTaskViewRequest = $state('');
	$effect(() => {
		if (!__NEBIUS_EDITION__ || !browser || !pack?.id || pack.id !== requestedPackId) return;
		const params = $page.url.searchParams;
		const requestKey = `${pack.id}:${$page.url.search}`;
		if (requestKey === appliedTaskViewRequest) return;
		appliedTaskViewRequest = requestKey;
		const views = params.getAll('view');
		const requested = views.length === 1 ? views[0] : '';
		const canonicalView = legacyTaskViewAliases[requested] || requested;
		const requestedView = params.getAll('pack').length === 1 && taskViews.some(view => view.id === canonicalView) ? canonicalView : 'brief';
		taskView = requestedView;
		if (requestedView !== 'brief') {
			const origin = document.activeElement;
			void tick().then(() => {
				if (requestKey !== appliedTaskViewRequest || pack?.id !== requestedPackId || (document.activeElement !== origin && document.activeElement !== document.body)) return;
				const tab = document.getElementById(`task-tab-${requestedView}`);
				if (tab) focusAndPulse(tab, { behavior: 'auto', block: 'center' });
			});
		}
	});
	let dependencyTitle = $derived.by(() => {
		const linked = $demoState?.packs?.find((item) => item.id === pack?.blockedBy);
		return linked ? workTitle(linked) : null;
	});
	let pendingDraft = $derived(pendingNextActionDraftFor($demoState, visiblePackId));
	let missingDraftReferences = $derived(Boolean(pendingDraft && $demoState && !pendingDraftReferencesAvailable($demoState, pendingDraft)));
	let duplicateDraftEvidence = $derived(Boolean(pendingDraft && pendingDraftHasDuplicateEvidence(pendingDraft)));
	let duplicateDraftCount = $derived($demoState ? pendingDraftCountFor($demoState, visiblePackId) : 0);
	let draftUnavailable = $derived(missingDraftReferences || duplicateDraftEvidence || duplicateDraftCount > 1);
	let buttonActionVisible = $derived(Boolean(pendingDraft) || editorChoiceStaged || Boolean(savedNextReceipt));
	let pendingDraftStale = $derived(pendingDraft ? pendingDraft.originFingerprint !== pendingDraftFingerprint($demoState!, pendingDraft) : false);
	// Only declare not-found once the demo state has landed — until then the
	// requested pack may simply not have arrived yet.
	let notFound = $derived(Boolean(selectedId) && demoLoaded && !pack);
	let decisionWorkspaceContext = $derived.by((): DecisionWorkspaceContext | null => {
		if (!pack?.id || pack.id !== requestedPackId || pack.id !== decisionWorkspaceContextId || !isOpenDecision(pack)) return null;
		const decider = decisionWorkspaceContextDecider(pack.decider);
		return {
			mode: DECISION_WORKSPACE_CONTEXT,
			reason: DECISION_WORKSPACE_CONTEXT_REASON,
			decider
		};
	});
	// The editor previews the pack AS IF the current choice were saved, so the
	// fact lines and help always show what the main button will really run.
	let effectiveChoice = $derived(showingCustom ? choice.trim() : choice || defaultChoiceFor(pack));
	let effectiveMode = $derived<NextEditorMode>(
		showingCustom || !(NEXT_ACTION_CHOICES as readonly string[]).includes(effectiveChoice)
			? 'custom'
			: 'preset'
	);
	let routeUpdating = $derived(busy || draftRevision.pending);
	let routeBusy = $derived(routeUpdating || (__NEBIUS_EDITION__ && (nebEditorDirty || nebReviewDirty || nebReviewBusy)));
	let taskBlockingState = $derived.by(() => {
		if (nebEditorDirty) return { reason: 'Task edits are unsaved.', target: 'nebius-task-editor', label: 'Review or discard task edits' };
		if (nebReviewDirty) return { reason: 'Evidence edits are unsaved.', target: 'nebius-evidence-recording', label: 'Save or discard evidence' };
		if (nebReviewBusy) return { reason: 'Evidence review is in progress.', target: 'nebius-evidence-recording', label: 'View evidence review' };
		if (pendingDraft || editorChoiceStaged) return { reason: 'A pending action needs approval or discard before you can edit this task or request a suggestion.', target: 'nebius-button-action-panel', label: 'Resolve pending action' };
		if (nebUpdateDirty) return { reason: 'Your task update has not been saved.', target: 'nebius-task-update', label: 'Finish or clear the update' };
		return null;
	});
	async function focusTaskResolution(targetId: string, event?: MouseEvent) {
		event?.preventDefault();
		taskView = targetId === 'nebius-evidence-recording' ? 'review' : 'brief';
		await tick();
		if (targetId === 'nebius-evidence-recording' && runReviewHandle) {
			await runReviewHandle.focusEvidence();
			return;
		}
		const target = document.getElementById(targetId);
		if (target instanceof HTMLDetailsElement) {
			target.open = true;
			target.querySelector('summary')?.focus();
		} else {
			for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
				if (parent instanceof HTMLDetailsElement) parent.open = true;
			}
			await tick(); target?.focus();
		}
		target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
	}
	let terminalDraftAvailable = $derived(nextDraftTerminalAvailable(draftRevision, {
		busy: routeBusy,
		stale: pendingDraftStale || draftUnavailable,
		choice: effectiveChoice,
		mode: effectiveMode,
		draft: pendingDraft
	}));
	let pendingDraftMatchesEditor = $derived(Boolean(
		pendingDraft && pendingDraft.choice === effectiveChoice && pendingDraft.mode === effectiveMode
	));
	let previewChoice = $derived(effectiveChoice || defaultChoiceFor(pack));
	let preview = $derived(
		pack ? ({ ...pack, ...nextChoiceForwardPath(pack, previewChoice) } as DemoPack) : null
	);
	beforeNavigate((navigation) => {
		if (!__NEBIUS_EDITION__ || (!nebEditorDirty && !nebReviewDirty && !nebUpdateDirty)) return;
		const destination = navigation.to?.url;
		if (destination && destination.origin === window.location.origin && destination.pathname === window.location.pathname &&
			destination.search === window.location.search && destination.hash !== window.location.hash) return;
		navigation.cancel();
		if (navigation.type === 'leave') return;
		navigationNotice = nebUpdateDirty && !nebEditorDirty && !nebReviewDirty ? 'Clear your task update before leaving this page.' : 'Apply or discard your unsaved changes before leaving this page.';
		const targetId = nebUpdateDirty && !nebEditorDirty && !nebReviewDirty
			? 'nebius-task-update'
			: nebReviewDirty ? 'nebius-evidence-recording' : 'nebius-task-editor';
		void focusTaskResolution(targetId);
	});
	$effect(() => { if (!nebEditorDirty && !nebReviewDirty && !nebUpdateDirty) navigationNotice = ''; });
	let preparationCells = $derived(preparationReceipt ? [
		{ label: 'Recorded evidence', value: preparationReceipt.evidenceNote },
		{ label: 'Status', value: 'Draft — waiting for your approval' },
		{ label: 'Save', value: 'Not saved' }
	] : []);
	let savedNextCells = $derived(savedNextReceipt ? [
		{ label: 'Work item', value: workTitle(savedNextReceipt.pack) },
		{ label: 'Saved next action', value: savedNextReceipt.pack.next || 'Open' },
		{ label: 'Blocker', value: blockerText(savedNextReceipt.pack) },
		{ label: 'Proof target', value: savedNextReceipt.pack.doneWhen || 'Not set' }
	] : []);

	// Describe the save command directly; the preview already owns workflow facts.
	let saveNextHelp = $derived.by(() => {
		if (!pack) return '';
		if (!effectiveChoice) return 'Type a custom next action.';
		if (!pendingDraft) return `Prepare "${effectiveChoice}" as a browser-local draft for ${workTitle(pack)}. The workspace stays unchanged.`;
		if (duplicateDraftCount > 1) return 'Multiple drafts refer to this task. Inspect or discard them before preparing another.';
		if (missingDraftReferences) return 'This draft references missing work. Inspect or discard it before preparing another.';
		if (duplicateDraftEvidence) return 'This draft repeats an evidence reference. Inspect or discard it before preparing another.';
		if (pendingDraftStale) return 'This draft is stale. Refresh the evidence before approval.';
		if (draftRevision.pending) return 'Wait for the visible draft change to finish saving.';
		if (!pendingDraftMatchesEditor) return 'The visible choice differs from the pending draft. Update the draft before approval.';
		if (!terminalDraftAvailable) return 'Finish preparing the visible draft before approval.';
		return `Save "${effectiveChoice}" as the next action for ${workTitle(pack)}.`;
	});

	async function refreshNext() {
		await refreshDemoState();
	}

	onMount(() => {
		void refreshDemoState({ reuseRecent: true });
		return () => {
			clearPreparation();
		};
	});

	async function scheduleEditorFocus(target: 'custom' | 'choices') {
		const request = ++editorFocusRequest;
		const origin = document.activeElement;
		await tick();
		if (request !== editorFocusRequest) return;

		const pulseTarget = document.querySelector(
			target === 'custom' ? '#custom-next-input' : '[data-next-choices]'
		) as HTMLElement | null;
		const focusTarget = target === 'custom'
			? pulseTarget
			: pulseTarget?.querySelector('button') as HTMLElement | null;
		if (!focusTarget || !pulseTarget) return;

		const active = document.activeElement;
		const focusStillOwned = !active || active === document.body || active === origin || active === focusTarget;
		if (!focusStillOwned) return;
		focusAndPulse(focusTarget, { behavior: 'smooth', block: 'center', pulseTarget });
	}

	onDestroy(() => {
		editorFocusRequest += 1;
		if (saveFocusFrame !== null) cancelAnimationFrame(saveFocusFrame);
		saveFocusFrame = null;
	});

	// Map the saved action to one visible editor choice.
	function defaultChoiceFor(target: DemoPack | null): string {
		if (!target) return 'Open';
		const stored = String(target.next || '').trim();
		if (stored) return stored;
		return 'Open';
	}

	function savedEditorBaseline(target: DemoPack | null): EditorSnapshot {
		const choice = defaultChoiceFor(target);
		return { choice, mode: (NEXT_ACTION_CHOICES as readonly string[]).includes(choice) ? 'preset' : 'custom' };
	}

	function clearPreparation() {
		preparationReceipt = null;
		preparationPreviousEditor = null;
	}

	function preparationFromPending(draft: PendingNextActionDraft): PreparationReceipt {
		const evidence = draft.evidence.map((reference) => {
			const candidate = packs.find((item) => item.id === reference.workId);
			return {
				work: { id: reference.workId, title: candidate ? workTitle(candidate) : reference.workId },
				field: reference.field,
				label: reference.field === 'workflow' ? 'Workflow' : 'Blocker',
				value: reference.expectedValue
			};
		}) as NextVerifiedEvidence[];
		return { summary: NEXT_PREPARATION_SUMMARY, work: { id: draft.workId, title: pack ? workTitle(pack) : draft.workId }, evidenceNote: draft.evidenceNote, evidence, preparedAction: draft.choice, workspaceChanged: false, requiresHumanSave: true };
	}

	function clonePreparationReceipt(receipt: PreparationReceipt | null): PreparationReceipt | null {
		return receipt ? { ...receipt, work: { ...receipt.work } } : null;
	}

	function captureHumanRevisionSnapshot(): HumanRevisionSnapshot {
		return {
			choice,
			customValue,
			showingCustom,
			editorChoiceStaged,
			preparationReceipt: clonePreparationReceipt(preparationReceipt),
			preparationPreviousEditor: preparationPreviousEditor ? { ...preparationPreviousEditor } : null,
			savedNextReceipt
		};
	}

	function restoreHumanRevisionSnapshot(snapshot: HumanRevisionSnapshot) {
		choice = snapshot.choice;
		customValue = snapshot.customValue;
		showingCustom = snapshot.showingCustom;
		editorChoiceStaged = snapshot.editorChoiceStaged;
		preparationReceipt = clonePreparationReceipt(snapshot.preparationReceipt);
		preparationPreviousEditor = snapshot.preparationPreviousEditor ? { ...snapshot.preparationPreviousEditor } : null;
		savedNextReceipt = snapshot.savedNextReceipt;
	}

	function setNextEditorChoice(nextChoice: string, mode: NextEditorMode, clearAgentPreparation = true) {
		if (clearAgentPreparation) clearPreparation();
		savedNextReceipt = null;
		choice = nextChoice;
		showingCustom = mode === 'custom';
		if (mode === 'custom') customValue = nextChoice;
	}

	function stageHumanNextEditorChoice(nextChoice: string, mode: NextEditorMode) {
		if (routeBusy || !pack?.id || draftUnavailable) return;
		setNextEditorChoice(nextChoice.slice(0, NEXT_ACTION_MAX_LENGTH), mode, false);
		editorChoiceStaged = true;
		errorText = '';
	}

	async function setHumanNextEditorChoice(nextChoice: string, mode: NextEditorMode): Promise<boolean> {
		if (routeBusy || !pack?.id || draftUnavailable) return false;
		const boundedChoice = nextChoice.slice(0, NEXT_ACTION_MAX_LENGTH);
		const pendingChoice = boundedChoice.trim();
		if (!pendingChoice) {
			if (!preparationPreviousEditor) preparationPreviousEditor = savedEditorBaseline(pack);
			setNextEditorChoice(boundedChoice, mode, false);
			errorText = '';
			return false;
		}
		const workId = pack.id;
		const outcome = await reviseNextDraft(draftRevision, {
			capture: captureHumanRevisionSnapshot,
			preview: () => {
				if (!preparationPreviousEditor) preparationPreviousEditor = savedEditorBaseline(pack);
				setNextEditorChoice(boundedChoice, mode, false);
				editorChoiceStaged = true;
				errorText = '';
			},
			persist: async () => {
				const state = await revisePendingNextActionDraftChoice(workId, pendingChoice, mode);
				const revisedDraft = pendingNextActionDraftFor(state, workId);
				if (!revisedDraft || revisedDraft.choice !== pendingChoice || revisedDraft.mode !== mode) {
					throw new ChallengeStateError('The pending draft change did not settle.');
				}
				return revisedDraft;
			},
			settle: (revisedDraft) => {
				setNextEditorChoice(boundedChoice, mode, false);
				preparationReceipt = preparationFromPending(revisedDraft);
			},
			rollback: restoreHumanRevisionSnapshot,
			reject: () => {
				errorText = 'The draft change was not saved. Your previous draft is still pending.';
			}
		});
		return outcome.status === 'settled';
	}

	$effect(() => {
		const nextPackId = pack?.id || '';
		if (!nextPackId || nextPackId === editorPackId) return;
		editorPackId = nextPackId;
		const initialChoice = defaultChoiceFor(pack);
		setNextEditorChoice(
			initialChoice,
			(NEXT_ACTION_CHOICES as readonly string[]).includes(initialChoice) ? 'preset' : 'custom'
		);
		editorChoiceStaged = false;
		errorText = '';
	});

	$effect(() => {
		const draft = pendingDraft;
		if (!draft || !shouldHydratePendingDraft({ preparationInFlight: draftRevision.pending, pendingDraft: draft, visibleWorkId: pack?.id || '', preparationReceipt })) return;
		preparationPreviousEditor = savedEditorBaseline(pack);
		preparationReceipt = preparationFromPending(draft);
		setNextEditorChoice(draft.choice, draft.mode, false);
		editorChoiceStaged = true;
	});

	async function discardPreparation() {
		if (!pack?.id || !pendingDraft || routeBusy) return;
		const workId = pack.id;
		const previous = preparationPreviousEditor;
		busy = true;
		errorText = '';
		try {
			// Discard is always safe, including when evidence has gone stale. Only
			// approval requires the exact settled fingerprint and editor match.
			await discardPendingNextActionDraft(workId);
			clearPreparation();
			if (previous) {
				setNextEditorChoice(previous.choice, previous.mode, false);
				editorChoiceStaged = false;
				await scheduleEditorFocus(previous.mode === 'custom' ? 'custom' : 'choices');
			}
		} catch (error) {
			errorText = error instanceof ChallengeStateError ? error.message : 'Discarding the pending draft failed.';
		} finally {
			busy = false;
		}
	}

	async function editPack(candidate: DemoPack, options: { announce?: boolean; focus?: boolean } = {}) {
		if (!candidate.id) return;
		if (__NEBIUS_EDITION__ && (nebReviewDirty || nebReviewBusy)) {
			void focusTaskResolution('nebius-evidence-recording');
			return;
		}
		if (routeBusy || (__NEBIUS_EDITION__ && (nebEditorDirty || nebUpdateDirty))) return;
		if (__NEBIUS_EDITION__) {
			const id = candidate.id;
			busy = true;
			try {
				taskView = 'brief';
				await goto(`/next?pack=${encodeURIComponent(id)}&view=brief`, { keepFocus: true, noScroll: true });
				if ($page.url.pathname !== '/next' || $page.url.searchParams.get('pack') !== id) return;
				choice = ''; customValue = ''; showingCustom = false;
				clearPreparation(); savedNextReceipt = null; errorText = '';
				await setSelectedWork(id);
				if ($page.url.pathname !== '/next' || $page.url.searchParams.get('pack') !== id) return;
				if (options.announce !== false) displayToast(`Opened ${workTitle(candidate)}`, 'success');
				if (options.focus !== false) scheduleEditorFocus('choices');
			} catch (cause) { errorText = cause instanceof Error ? cause.message : 'The task could not be opened.'; }
			finally { busy = false; }
			return;
		}
		chosenPackId = candidate.id;
		taskView = 'brief';
		choice = '';
		customValue = '';
		showingCustom = false;
		clearPreparation();
		savedNextReceipt = null;
		errorText = '';
		// Keep the browser-local selection in step with the visible editor.
		setSelectedWork(candidate.id).catch((e) => console.warn('Failed to sync selected work:', e));
		if (options.announce !== false) displayToast(`Editing next action for ${workTitle(candidate)}`, 'success');
		// A new work item always starts at the bounded choice group.
		if (options.focus !== false) scheduleEditorFocus('choices');
	}

	async function saveChoice() {
		if (routeBusy || !pack?.id || !effectiveChoice) return;
		if (draftUnavailable) {
			errorText = duplicateDraftCount > 1 ? 'Multiple drafts refer to this task. Inspect or discard them before preparing another.' : duplicateDraftEvidence ? 'This draft repeats an evidence reference. Inspect or discard it before preparing another.' : 'This draft references missing work. Inspect or discard it before preparing another.';
			return;
		}
		if (pendingDraft && pendingDraftStale) {
			errorText = 'Draft is stale. Refresh the evidence and prepare it again before approval.';
			return;
		}
		const workId = pack.id;
		try {
			await runSettledNextDraftAction(draftRevision, {
				busy: routeBusy,
				stale: pendingDraftStale || draftUnavailable,
				choice: effectiveChoice,
				mode: effectiveMode,
				draft: pendingDraft,
				start: () => {
					busy = true;
					errorText = '';
					if (saveFocusFrame !== null) cancelAnimationFrame(saveFocusFrame);
					saveFocusFrame = null;
				},
				finish: () => (busy = false),
				action: async (consumedDraft) => {
					const result = await setPackNextAction(workId);
					const summary = result?.receipt?.summary || `Next action saved: ${consumedDraft.choice}.`;
					savedNextReceipt = { summary, pack: result.pack };
					clearPreparation();
					editorChoiceStaged = false;
					displayToast(summary, 'success');
					// Land focus on the preview so keyboard users land on the updated
					// state — the /next analogue of the pack page's afterSave receipt
					// focus. The save button itself would keep focus with no move.
					saveFocusFrame = requestAnimationFrame(() => {
						saveFocusFrame = null;
						const el = document.querySelector('[data-next-preview]') as HTMLElement | null;
						if (!el) return;
						focusAndPulse(el, { behavior: 'smooth', block: 'center' });
					});
				}
			});
		} catch (error) {
			errorText =
				error instanceof ChallengeStateError ? error.message : 'Saving the next action failed.';
		}
	}

</script>

<svelte:head><title>{__NEBIUS_EDITION__ ? 'Task' : 'Next'} — Wornpage Projects™</title></svelte:head>

{#if !demoLoaded}
	<WornPage sectionLabel={__NEBIUS_EDITION__ ? 'Task' : 'Step 3 of 3 · Prepare'} title={__NEBIUS_EDITION__ ? 'Task' : 'Next actions'} loading={!$demoStateError}>
		{#if $demoStateError}
			<WornError message="Could not load next actions" detail={$demoStateError} onretry={refreshNext} />
		{/if}
	</WornPage>
{:else if notFound}
	<WornPage title={__NEBIUS_EDITION__ ? 'Task' : 'Next actions'}>
		{#if $demoStateError}
			<WornError message="Could not load next actions" detail={$demoStateError} onretry={refreshNext} />
		{/if}
		<WornError
			message="Work item not found"
			detail={selectedId ? `No loaded work item has id "${selectedId}".` : 'No work item id was provided.'}
		>
			<div class="demo-row-actions">
				<WornButton variant="primary" size="sm" href={__NEBIUS_EDITION__ ? '/work' : '/next'}>{__NEBIUS_EDITION__ ? 'Open Work' : 'Next actions'}</WornButton>
			</div>
		</WornError>
	</WornPage>
{:else if pack && preview}
	<WornPage sectionLabel={__NEBIUS_EDITION__ ? taskViews.find(view => view.id === taskView)?.label || 'Brief' : 'Step 3 of 3 · Prepare'} title={__NEBIUS_EDITION__ ? workTitle(pack) : preparationReceipt ? 'Review the proposed next action' : 'Set the next action'}>
		{#if !__NEBIUS_EDITION__ || decisionWorkspaceContext}<NextWorkContext workTitle={workTitle(pack)} decisionContext={decisionWorkspaceContext} />{/if}
		{#if __NEBIUS_EDITION__}
			{#if taskProject}
				<div class="task-project-context" data-nebius-task-project>
					<a href={`/work?focus=${encodeURIComponent(pack.id)}`}><span>Project</span> {taskProject.title}</a>
					<p>{taskProject.summary}</p>
				</div>
			{/if}
			{#if navigationNotice}<WornAlert tone="warning">{navigationNotice}</WornAlert>{/if}
			<div class="nebius-task-workspace" class:review-layout={taskView === 'review'} data-nebius-task-workspace data-pack-id={pack.id}>
				<div class="nebius-task-tools">
				<div class="nebius-task-nav"><WornTabs tabs={taskViews} bind:active={taskView} label="Task workspace" /></div>
			{#if taskBlockingState}
				<p class="nebius-draft-resolution" role="status" data-nebius-draft-resolution>{taskBlockingState.reason} <a href={`#${taskBlockingState.target}`} onclick={(event) => focusTaskResolution(taskBlockingState.target, event)}>{taskBlockingState.label}</a></p>
			{/if}
			<NebiusTaskContext {pack} packs={taskContextPacks} showBrief={taskView === 'brief'} onedit={readOnlyTask ? undefined : (event) => void focusTaskResolution('nebius-task-editor', event)} disabled={routeBusy || Boolean(pendingDraft) || editorChoiceStaged || nebEditorDirty || nebUpdateDirty || nebReviewDirty || nebReviewBusy} onselect={(candidate) => editPack(candidate, { announce: false, focus: false })} />
			<!-- Keep every editor mounted: changing tabs must not discard drafts or stop a run. -->
			<div id="task-panel-brief" class="task-tab-panel" role="tabpanel" aria-labelledby="task-tab-brief" tabindex="0" hidden={taskView !== 'brief'}>
			<NebiusProjectEvidence {pack} packs={allPacks} />
			{#if readOnlyTask}
				<section class="task-readonly" aria-labelledby="task-readonly-brief-title" data-nebius-readonly-brief>
					<h2 id="task-readonly-brief-title">Saved brief</h2>
					<WornAlert tone="info">This task is {pack.archived ? 'archived' : 'complete'}. Its saved brief, tool, and review history are read only.</WornAlert>
				</section>
			{:else}
			{#key pack.id}<NebiusTaskEditor {pack} {dependencyTitle} proposal={nebiusProposal} disabled={routeUpdating || Boolean(pendingDraft) || editorChoiceStaged || nebReviewDirty || nebReviewBusy} ondirty={(dirty) => (nebEditorDirty = dirty)} />{/key}
			<NebiusSuggestion {pack} {dependencyTitle} disabled={routeBusy || Boolean(pendingDraft) || editorChoiceStaged || nebEditorDirty}
				ondirty={(dirty) => (nebUpdateDirty = dirty)}
				onUse={(changes) => {
					if (routeBusy || pendingDraft || editorChoiceStaged || nebEditorDirty) return;
					taskView = 'brief';
					nebiusProposal = { packId: pack.id, changes, nonce: ++nebiusProposalNonce };
				}} />
			{/if}
			</div>
			<div id="task-panel-tool" class="task-tab-panel" role="tabpanel" aria-labelledby="task-tab-tool" tabindex="0" hidden={taskView !== 'tool'}>
			{#if readOnlyTask}
				<section class="task-readonly" aria-labelledby="task-readonly-tool-title" data-nebius-readonly-tool>
					<h2 id="task-readonly-tool-title">Saved tool</h2>
					<p>{pack.executionRun ? `Saved run ${pack.executionRun.id} · ${pack.executionRun.record?.status || 'status unknown'}.` : 'No saved tool run is attached to this task.'}</p>
					<p>Completed and archived tasks cannot build, resume, cancel, or retire runs. Open Review to inspect or download the retained result.</p>
					<WornButton type="button" disabled={!pack.executionRun} onclick={() => (taskView = 'review')}>Open Review</WornButton>
				</section>
			{:else}
			{#key pack.id}
				<NebiusTaskRun
					{pack}
					disabled={routeBusy || Boolean(pendingDraft) || editorChoiceStaged || nebEditorDirty || nebUpdateDirty || nebReviewDirty || nebReviewBusy}
					disabledReason={taskBlockingState?.reason || (routeUpdating ? 'Wait for the current task change to finish saving.' : '')}
					onEditInputs={() => void focusTaskResolution('nebius-task-input-scope')}
					onEditOutputs={() => void focusTaskResolution('nebius-task-output-scope')}
				/>
			{/key}
			{/if}
			</div>
			<div id="task-panel-review" class="task-tab-panel" role="tabpanel" aria-labelledby="task-tab-review" tabindex="0" hidden={taskView !== 'review'}>
			{#key pack.id}<NebiusRunReview bind:this={runReviewHandle} {pack} readOnly={readOnlyTask}
				onOpenTask={(event) => { event.preventDefault(); taskView = 'brief'; void tick().then(() => document.getElementById('task-tab-brief')?.focus()); }}
				onstate={({ dirty, busy }) => { nebReviewDirty = dirty; nebReviewBusy = busy; }} />{/key}
			</div>
				</div>
			</div>
		{/if}
		{#if $demoStateError}
			<WornError message="Could not load next actions" detail={$demoStateError} onretry={refreshNext} />
		{/if}
		{#if errorText}
			<WornAlert tone="danger" dismissible dismissLabel="Dismiss next-action error">{errorText}</WornAlert>
		{/if}
		{#if preparationReceipt && pendingDraft?.source === 'webmcp'}
			<section id={NEXT_PREPARATION_RECEIPT_ID} aria-label="Earlier agent draft" tabindex="-1">
				<WornAlert tone="info">An earlier agent prepared this unsaved draft. Review its evidence before approving or discarding it.</WornAlert>
				<dl>{#each preparationCells as cell}<div><dt>{cell.label}</dt><dd>{cell.value}</dd></div>{/each}</dl>
			</section>
		{:else if pendingDraft?.source === 'human' && !__NEBIUS_EDITION__}
			<WornAlert tone="info">Draft prepared by you. The Next action remains unsaved until you approve Save.</WornAlert>
		{/if}
		<div id="nebius-button-action-panel" class:nebius-button-action-panel={__NEBIUS_EDITION__} hidden={__NEBIUS_EDITION__ && (readOnlyTask || !buttonActionVisible)} tabindex="-1">
		{#if __NEBIUS_EDITION__}<h2>{savedNextReceipt ? 'Action saved' : 'Pending action draft'}</h2>{/if}
		<div class="next-presenter-result">
			<div class="demo-command-lines compact demo-focus-surface" id={NEXT_EDITOR_PREVIEW_ID} data-next-preview data-next-work-id={pack.id} tabindex="-1">
				{#if hasBlocker(preview)}
					<div class="demo-command-line" data-command-field="blocker"><span>Current blocker</span><strong>{blockerText(preview)}</strong></div>
				{/if}
				<div class="demo-command-line" data-command-field="button-runs-next"><span>Proposed next action</span><strong>{effectiveChoice || 'Not set'}</strong></div>
			</div>
			{#if savedNextReceipt}
				<WornReceipt
					summary={savedNextReceipt.summary}
					announce={false}
					cells={savedNextCells}
					ondone={() => (savedNextReceipt = null)}
				/>
			{/if}
		</div>
		{#if __NEBIUS_EDITION__}<p class="next-authority">{savedNextReceipt ? 'Next action saved.' : 'This action is a separate draft. Approve and save it, or discard it to return to task editing.'}</p>
		{:else}<p class="next-authority"><strong>Draft:</strong> {savedNextReceipt ? 'none · completed' : pendingDraft ? pendingDraftStale ? 'stale' : 'pending approval' : 'none'} · <strong>Workspace:</strong> {savedNextReceipt ? 'updated' : 'unchanged'} · <strong>Authority:</strong> {savedNextReceipt ? 'saved and approved by the person' : pendingDraft ? 'only you can approve Save' : 'create a draft before approval'}.</p>{/if}
		{#if duplicateDraftCount > 1}
			<WornAlert tone="warning">Multiple drafts refer to this task. Use Pending approvals to inspect each; discard removes all {duplicateDraftCount} drafts for this task.</WornAlert>
		{:else if missingDraftReferences}
			<WornAlert tone="warning">This draft references missing work. Inspect its evidence or discard it before preparing a new action.</WornAlert>
		{:else if duplicateDraftEvidence}
			<WornAlert tone="warning">This draft repeats an evidence reference. Inspect its evidence or discard it before preparing a new action.</WornAlert>
		{:else if pendingDraftStale}
			<WornAlert tone="warning">Draft is stale. Refresh the visible work and re-prepare before approval; this draft cannot be saved.</WornAlert>
		{/if}

		{#if !readOnlyTask && (!__NEBIUS_EDITION__ || pendingDraft || editorChoiceStaged)}
		<div class="demo-inline-form next-action-editor">
			<div class="demo-field">
				<p class="next-editor-step"><strong>1 · Choose an action</strong><span>Then prepare a browser-local draft before approval.</span></p>
				<fieldset class="next-choice-guard" disabled={routeBusy || draftUnavailable}>
				<div class="next-choice-content">
				<div class="demo-chip-row" role="group" aria-label="Next action choices" aria-busy={routeBusy} data-next-choices>
					{#each NEXT_ACTION_CHOICES as act}
						<WornChip label={act} size="sm" pressed={(editorChoiceStaged || Boolean(pendingDraft)) && !showingCustom && effectiveChoice === act}
							onclick={() => stageHumanNextEditorChoice(act, 'preset')} />
					{/each}
					<WornChip label="Custom…" size="sm" pressed={(editorChoiceStaged || Boolean(pendingDraft)) && effectiveMode === 'custom'}
						onclick={async () => { stageHumanNextEditorChoice(customValue, 'custom'); await scheduleEditorFocus('custom'); }} />
				</div>
				{#if effectiveMode === 'custom'}
					<WornInput
						id="custom-next-input"
						aria-label="Custom next action"
						placeholder="Type a custom next action…"
						maxlength={NEXT_ACTION_MAX_LENGTH}
						value={choice}
						disabled={routeBusy || draftUnavailable}
						oninput={(event) => stageHumanNextEditorChoice((event.currentTarget as HTMLInputElement).value, 'custom')} />
				{/if}
				</div>
				</fieldset>
			</div>
			<span id="apply-next-action-help" class="next-save-help">{saveNextHelp}</span>
			<div class="next-save-actions">
				{#if !pendingDraft}
					<WornButton
						data-next-prepare-draft
						type="button"
						variant="primary"
						disabled={!effectiveChoice || routeBusy}
						aria-describedby="apply-next-action-help"
						onclick={async () => { await setHumanNextEditorChoice(effectiveChoice, effectiveMode); }}
					>
						{draftRevision.pending ? 'Preparing draft…' : '2 · Prepare draft'}
					</WornButton>
				{:else}
					<div class="next-draft-actions">
					{#if !terminalDraftAvailable && !pendingDraftStale && !draftUnavailable}
						<WornButton
							data-next-prepare-draft
							type="button"
							disabled={!effectiveChoice || routeBusy}
							aria-describedby="apply-next-action-help"
							onclick={async () => { await setHumanNextEditorChoice(effectiveChoice, effectiveMode); }}
						>
							{draftRevision.pending ? 'Updating draft…' : 'Update draft'}
						</WornButton>
					{/if}
					<WornButton type="button" disabled={routeBusy} onclick={discardPreparation}>{duplicateDraftCount > 1 ? `Discard all ${duplicateDraftCount} drafts for this task` : pendingDraftStale ? 'Discard stale draft' : 'Discard draft'}</WornButton>
					</div>
					<WornButton variant="primary" disabled={!terminalDraftAvailable} aria-describedby="apply-next-action-help" onclick={saveChoice}>
						{busy ? 'Saving…' : 'Approve and save'}
					</WornButton>
				{/if}
			</div>
		</div>
		{/if}
		</div>

		<WornCollapsible summary="Advanced options">
			{#if workItemIssues(pack).length > 0}
				<div class="next-item-warnings" data-next-item-warnings>
					{#each workItemIssues(pack) as v}
						<WornAlert tone="warning">{v.message}</WornAlert>
					{/each}
				</div>
			{/if}

			<NextCandidatePicker {packs} currentPackId={pack.id || ''} disabled={routeBusy || nebReviewDirty || nebReviewBusy} onedit={editPack} />
		</WornCollapsible>
	</WornPage>
{:else}
	<WornPage title={__NEBIUS_EDITION__ ? 'Task' : 'Next actions'}>
		{#if $demoStateError}
			<WornError message="Could not load next actions" detail={$demoStateError} onretry={refreshNext} />
		{/if}
		<WornEmpty
			title="No sample work available"
			description="Choose a work item in Work or load the challenge sample before preparing next actions."
		>
			<WornButton variant="primary" href="/work">Open Work</WornButton>
		</WornEmpty>
	</WornPage>
{/if}

<style>
	.task-project-context { margin-block: 0 20px; max-inline-size: 78ch; }
	.task-project-context a { color: var(--worn-link); display: inline-block; font-size: .9375rem; font-weight: 650; line-height: 1.6; padding-block: 6px; text-underline-offset: 3px; }
	.task-project-context a span { color: var(--worn-text-secondary); font-size: .8125rem; font-weight: 500; margin-inline-end: 8px; }
	.task-project-context a:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 4px; border-radius: 2px; }
	.task-project-context p { color: var(--worn-text-secondary); font-size: .9375rem; line-height: 1.6; margin: 4px 0 0; overflow-wrap: anywhere; }
	/* The review switch and tool use the page scrollport, not a clipped card. */
	:global(body:has([data-nebius-task-workspace])) { overflow-x: clip; overflow-y: visible; }
	:global(.demo-panel:has([data-nebius-task-workspace])) { overflow: visible; padding: clamp(16px, 2vw, 24px); }
	:global(.demo-panel:has([data-nebius-task-workspace]) .demo-panel-head) { border-block-end: 1px solid var(--worn-border); padding: 0 0 12px; }
	:global(.demo-panel:has([data-nebius-task-workspace]) .demo-panel-title) { font-size: clamp(1.5rem, 3vw, 2rem); line-height: 1.2; }
	.nebius-task-workspace { margin-block: 12px 16px; min-inline-size: 0; }
	.nebius-task-tools, .task-tab-panel { min-inline-size: 0; }
	.nebius-task-nav { background: var(--worn-bg-secondary); border: 1px solid var(--worn-border); border-radius: var(--worn-radius); box-shadow: var(--worn-shadow-sm); margin-block-end: 12px; min-inline-size: 0; padding: 4px; }
	.nebius-task-nav :global(.worn-tabs-shell) { margin-block-end: 0; }
	.nebius-task-nav :global([role="tablist"]) { border: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; margin: 0; padding: 0; }
	.nebius-task-nav :global([role="tab"]) { border: 2px solid transparent; border-radius: var(--worn-radius-sm); justify-content: center; margin-block-end: 0; max-inline-size: none; min-block-size: 44px; min-inline-size: 0; padding: 8px 4px; white-space: nowrap; }
	.nebius-task-nav :global(.worn-tab-label) { overflow: visible; text-overflow: clip; white-space: nowrap; }
	.nebius-task-nav :global([role="tab"][aria-selected="true"]) { background: var(--worn-selected-bg); border-color: var(--worn-link); color: var(--worn-selected-fg); font-weight: 700; }
	.nebius-task-nav :global([role="tab"]:focus-visible) { outline: 2px dashed var(--worn-focus); outline-offset: -6px; }
	@media (prefers-reduced-motion: no-preference) { .nebius-task-nav :global([role="tab"]) { transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease; } }
	.task-tab-panel[hidden] { display: none; }
	.task-tab-panel:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 4px; }
	.task-tab-panel :global(.nebius-suggestion), .task-tab-panel :global(.nebius-review) { margin-block-start: 0; }
	:global(#task-panel-review .run-review) { grid-template-columns: minmax(0, 1fr); }
	.task-readonly { border: 1px solid var(--worn-border); border-radius: var(--worn-radius); display: grid; gap: 14px; padding: 16px; }
	.task-readonly h2, .task-readonly p { margin: 0; }
	.task-readonly p { color: var(--worn-text-secondary); line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
	.task-readonly :global(.worn-btn) { justify-self: start; }
	.nebius-draft-resolution { border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); line-height: 1.5; overflow-wrap: anywhere; padding: .75rem; }
	.nebius-draft-resolution a { display: inline-block; margin-inline-start: .25rem; }
	.next-choice-guard { border: 0; margin: 0; min-inline-size: 0; padding: 0; }
	.next-choice-content { display: grid; gap: var(--worn-space-4); min-inline-size: 0; }
	.next-choice-content .demo-chip-row { margin-block-start: 0; }
	.nebius-button-action-panel { border-block-start: 1px solid var(--worn-border); margin-block-start: 1rem; padding-block-start: 1rem; }
	.nebius-button-action-panel[hidden] { display: none; }
	/* Inline style attributes are blocked by the shared CSP — scoped classes. */
	.next-action-editor {
		align-items: center;
		display: grid;
		gap: var(--worn-space-4);
		grid-template-columns: minmax(0, 1fr) auto;
		margin-block-start: var(--worn-space-4);
	}
	.demo-command-lines.demo-focus-surface {
		--demo-focus-ring-inset: -6px;
		--demo-focus-ring-radius: calc(var(--worn-radius) + 6px);
	}
	.next-presenter-result {
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.next-action-editor > .demo-field {
		display: grid;
		gap: var(--worn-space-4);
		grid-column: 1 / -1;
		min-width: 0;
		width: 100%;
	}
	.next-editor-step {
		align-items: baseline;
		color: var(--worn-text-secondary);
		display: flex;
		flex-wrap: wrap;
		font-size: 13px;
		gap: 6px 10px;
		line-height: 1.5;
		margin: 0;
	}
	.next-editor-step strong {
		color: var(--worn-text);
	}
	.next-authority,
	.next-save-help {
		color: var(--worn-text-secondary);
		font-size: 13px;
		line-height: 1.5;
		margin: 0;
	}
	.next-authority {
		margin-block-start: 12px;
	}
	.next-save-help {
		display: block;
		min-width: 0;
	}
	.next-save-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
		justify-self: end;
	}
	.next-draft-actions { display: flex; flex-wrap: wrap; gap: var(--worn-space-2); }
	.next-item-warnings {
		display: grid;
		gap: 8px;
		margin-block-start: 16px;
		max-inline-size: 100%;
		min-inline-size: 0;
	}
	@media (max-width: 500px) {
		.next-action-editor {
			grid-template-columns: minmax(0, 1fr);
		}
		.next-action-editor > .demo-field {
			grid-column: auto;
		}
		.demo-inline-form {
			align-items: stretch;
			flex-direction: column;
		}
		.demo-chip-row {
			max-width: 100%;
		}
		.demo-row-actions {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			width: 100%;
		}
		.demo-row-actions :global(.worn-btn),
		.demo-inline-form > :global(.worn-btn),
		.next-save-actions :global(.worn-btn) {
			min-width: 0;
			width: 100%;
		}
		.next-save-help {
			flex: 0 0 auto;
		}
		.next-save-actions {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			justify-self: stretch;
			width: 100%;
		}
		.next-draft-actions {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
			min-width: 0;
		}
	}
</style>
