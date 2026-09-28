<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { browser } from '$app/environment';
	import { beforeNavigate } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		demoState,
		demoStateError,
		refreshDemoState,
		setPackNextAction,
		savePendingNextActionDraft,
		revisePendingNextActionDraftChoice,
		discardPendingNextActionDraft,
		restorePendingNextActionDraft,
		pendingNextActionDraftFor,
		pendingDraftFingerprint,
		setSelectedWork,
		displayToast,
		ChallengeStateError,
		type PendingNextActionDraft
	} from '$lib/demo-client';
	import {
		NEXT_ACTION_CHOICES,
		nextChoiceForwardPath,
		blockerText,
		evidenceFacts,
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
	import { registerPageTools } from '$lib/webmcp.mjs';
	import { recordWebMcpDraftDecision, recordWebMcpHandoffStep } from '$lib/webmcp-handoff-store';
	import WebMcpActivityStrip from '$lib/WebMcpActivityStrip.svelte';
	import NextCandidatePicker from './NextCandidatePicker.svelte';
	import NextWorkContext from './NextWorkContext.svelte';
	import NebiusTaskContext from './NebiusTaskContext.svelte';
	import NebiusSuggestion from './NebiusSuggestion.svelte';
	import NebiusTaskEditor from './NebiusTaskEditor.svelte';
	import NebiusEvidenceReview from './NebiusEvidenceReview.svelte';
	import NebiusTaskRun from './NebiusTaskRun.svelte';
	import type { NebiusChanges } from '$lib/nebius-contract.mjs';
	import {
		NEXT_ACTION_MAX_LENGTH,
		NEXT_EDITOR_PREVIEW_ID,
		NEXT_PREPARATION_RECEIPT_ID,
		NEXT_PREPARATION_SUMMARY,
		PREPARE_NEXT_ACTION_TOOL_NAME,
		createNextDraftRevisionState,
		createCurrentNextEditorTool,
		createPrepareNextActionTool,
		evidenceMatchesReferences,
		nextDraftTerminalAvailable,
		nextEditorPageView,
		reviseNextDraft,
		runSettledNextDraftAction,
		verifiedNextEvidenceNote,
		verifyNextPreparationEvidence,
		shouldHydratePendingDraft
	} from './next-webmcp.mjs';

	type NextEditorMode = 'preset' | 'custom';
	type NextEvidenceField = 'workflow' | 'blocker';
	type NextEvidenceReference = {
		workId: string;
		field: NextEvidenceField;
		expectedValue: string | null;
	};
	type NextVerifiedEvidence = {
		work: { id: string; title: string };
		field: NextEvidenceField;
		label: string;
		value: string | null;
	};
	type PrepareNextActionInput = {
		choice: string;
		expectedMode: NextEditorMode;
		expectedChoice: string;
		evidence: NextEvidenceReference[];
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
	type NextPreparationSnapshot = {
		choice: string;
		customValue: string;
		showingCustom: boolean;
		editorChoiceStaged: boolean;
		preparationReceipt: PreparationReceipt | null;
		preparationPreviousEditor: EditorSnapshot | null;
		savedNextReceipt: SavedNextReceipt | null;
		pendingDraft: PendingNextActionDraft | null;
		invocationWorkId: string;
		preparationInFlight: boolean;
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
	let taskView = $state('next');
	const taskViews = [
		{ id: 'next', label: 'Next step', tabId: 'task-tab-next', panelId: 'task-panel-next' },
		{ id: 'build', label: 'Build tool', tabId: 'task-tab-build', panelId: 'task-panel-build' },
		{ id: 'evidence', label: 'Evidence', tabId: 'task-tab-evidence', panelId: 'task-panel-evidence' }
	];
	let navigationNotice = $state('');
	let nebiusProposal = $state<{ packId: string; changes: NebiusChanges; nonce: number } | null>(null);
	let nebiusProposalNonce = 0;
	let busy = $state(false);
	let errorText = $state('');
	let preparationReceipt = $state<PreparationReceipt | null>(null);
	let preparationInFlight = $state(false);
	let draftRevision = $state(createNextDraftRevisionState());
	let preparationPreviousEditor = $state<EditorSnapshot | null>(null);
	let savedNextReceipt = $state<SavedNextReceipt | null>(null);
	let editorPackId = $state('');
	let editorFocusRequest = 0;
	let saveFocusFrame: number | null = null;
	let stopNextWebMcp: (() => void) | null = null;
	let packs = $derived(
		(($demoState?.packs ?? []) as DemoPack[]).filter(canSetNextAction)
	);
	let requestedPackId = $derived(browser ? ($page.url.searchParams.get('pack') || '') : '');
	let decisionWorkspaceContextId = $derived(
		browser ? decisionWorkspaceContextPackId($page.url.searchParams) : ''
	);
	// Work and Review link here with an explicit ?pack= selection.
	let selectedId = $derived(
		chosenPackId ||
			// The prerender has no browser URL; hydration resolves the real query.
			requestedPackId ||
			$demoState?.selectedId ||
			''
	);
	// An explicit selection never falls back to a different work item.
	let demoLoaded = $derived(Boolean($demoState?.packs));
	let pack = $derived(
		packs.find((p) => p.id === selectedId) ||
			(!selectedId ? packs.find(isReview) || packs[0] : null) ||
			null
	);
	let visiblePackId = $derived(pack?.id || '');
	let dependencyTitle = $derived.by(() => {
		const linked = $demoState?.packs?.find((item) => item.id === pack?.blockedBy);
		return linked ? workTitle(linked) : null;
	});
	let pendingDraft = $derived(pendingNextActionDraftFor($demoState, visiblePackId));
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
	let routeUpdating = $derived(busy || preparationInFlight || draftRevision.pending);
	let routeBusy = $derived(routeUpdating || (__NEBIUS_EDITION__ && (nebEditorDirty || nebReviewDirty || nebReviewBusy)));
	let taskBlockingState = $derived.by(() => {
		if (nebEditorDirty) return { reason: 'Task edits are unsaved.', target: 'nebius-task-editor', label: 'Review or discard task edits' };
		if (nebReviewDirty) return { reason: 'Evidence edits are unsaved.', target: 'nebius-evidence-recording', label: 'Save or discard evidence' };
		if (nebReviewBusy) return { reason: 'Evidence review is in progress.', target: 'nebius-evidence-recording', label: 'View evidence review' };
		if (pendingDraft || editorChoiceStaged) return { reason: 'A pending action needs approval or discard before you can edit this task or request a suggestion.', target: 'nebius-button-action-panel', label: 'Resolve pending action' };
		if (nebUpdateDirty) return { reason: 'Your task update has not been saved.', target: 'nebius-task-update', label: 'Finish or clear the update' };
		return null;
	});
	async function focusTaskResolution(event: MouseEvent, targetId: string) {
		event.preventDefault();
		taskView = targetId === 'nebius-evidence-recording' ? 'evidence' : 'next';
		await tick();
		const target = document.getElementById(targetId);
		if (target instanceof HTMLDetailsElement) {
			target.open = true;
			target.querySelector('summary')?.focus();
		} else target?.focus();
		target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}
	let terminalDraftAvailable = $derived(nextDraftTerminalAvailable(draftRevision, {
		busy: routeBusy,
		stale: pendingDraftStale,
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
	let currentNextEditor = $derived.by(() => {
		if (!pack?.id || !preview) return null;
		return nextEditorPageView({
			work: { id: pack.id, title: workTitle(pack) },
			decisionContext: decisionWorkspaceContext,
			presetChoices: NEXT_ACTION_CHOICES,
			editor: { mode: effectiveMode, choice: effectiveChoice },
			preview: {
				blocker: hasBlocker(preview) ? blockerText(preview) : null,
				nextAction: effectiveChoice || 'Not set'
			},
			preparationReceipt: preparationReceipt && pendingDraft?.source === 'webmcp' && preparationReceipt.preparedAction === effectiveChoice
				? preparationReceipt
				: null,
			canSave: terminalDraftAvailable,
			staleReason: pendingDraftStale
				? 'Draft is stale. Refresh the evidence and prepare it again before approval.'
				: draftRevision.pending
					? 'The visible draft change is still being saved.'
					: pendingDraft && !terminalDraftAvailable
						? 'The visible editor does not match the settled pending draft.'
						: pendingDraft ? null : 'No pending draft. Prepare the visible choice before approval.',
			busy: routeBusy
		});
	});
	beforeNavigate((navigation) => {
		if (!__NEBIUS_EDITION__ || (!nebEditorDirty && !nebReviewDirty && !nebUpdateDirty)) return;
		navigation.cancel();
		if (navigation.type === 'leave') return;
		navigationNotice = nebUpdateDirty && !nebEditorDirty && !nebReviewDirty ? 'Clear your task update before leaving this page.' : 'Apply or discard your unsaved changes before leaving this page.';
		if (nebUpdateDirty && !nebEditorDirty && !nebReviewDirty) { document.querySelector<HTMLElement>('#nebius-task-update')?.focus(); return; }
		const editor = document.querySelector<HTMLDetailsElement>(nebReviewDirty ? '[data-nebius-evidence-review]' : '[data-nebius-task-editor]');
		if (editor) { editor.open = true; editor.querySelector('summary')?.focus(); }
	});
	$effect(() => { if (!nebEditorDirty && !nebReviewDirty && !nebUpdateDirty) navigationNotice = ''; });
	let preparationCells = $derived(preparationReceipt ? [
		{ label: 'Verified evidence', value: preparationReceipt.evidenceNote },
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
		stopNextWebMcp = registerPageTools(document, [
			createCurrentNextEditorTool(() => currentNextEditor),
			createPrepareNextActionTool(prepareNextActionFromWebMcp, {
				capture: captureNextPreparationSnapshot,
				restore: restoreNextPreparationSnapshot
			})
		], {
			onResult: ({ toolName, result }) => {
				if (toolName !== PREPARE_NEXT_ACTION_TOOL_NAME) return;
				const outcome = result as {
					next: {
						preparationReceipt: {
							preparedAction: string;
							evidence: unknown[];
							workspaceChanged: false;
						};
					};
				};
				recordWebMcpHandoffStep({
					id: 'next-proposal',
					title: 'Next prepared',
					summary: `Unsaved · ${outcome.next.preparationReceipt.preparedAction}`,
					status: 'complete',
					outcome: 'proposal-prepared'
				});
				recordWebMcpHandoffStep({
					id: 'human-decision',
					title: 'Human decision',
					summary: 'Pending approval',
					status: 'pending',
					outcome: 'proposal-pending'
				});
			}
		});
		return () => {
			stopNextWebMcp?.();
			stopNextWebMcp = null;
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

	function captureNextPreparationSnapshot(): NextPreparationSnapshot {
		return {
			choice,
			customValue,
			showingCustom,
			editorChoiceStaged,
			preparationReceipt: clonePreparationReceipt(preparationReceipt),
		preparationPreviousEditor: preparationPreviousEditor ? { ...preparationPreviousEditor } : null,
			savedNextReceipt,
			pendingDraft: pendingDraft ? structuredClone(pendingDraft) : null,
			invocationWorkId: pack?.id || '',
			preparationInFlight
		};
	}

	async function restoreNextPreparationSnapshot(snapshot: NextPreparationSnapshot) {
		choice = snapshot.choice;
		customValue = snapshot.customValue;
		showingCustom = snapshot.showingCustom;
		editorChoiceStaged = snapshot.editorChoiceStaged;
		preparationReceipt = clonePreparationReceipt(snapshot.preparationReceipt);
		preparationPreviousEditor = snapshot.preparationPreviousEditor ? { ...snapshot.preparationPreviousEditor } : null;
		savedNextReceipt = snapshot.savedNextReceipt;
		preparationInFlight = snapshot.preparationInFlight;
		if (snapshot.invocationWorkId) await restorePendingNextActionDraft(snapshot.invocationWorkId, snapshot.pendingDraft);
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
		if (routeBusy || !pack?.id) return;
		setNextEditorChoice(nextChoice.slice(0, NEXT_ACTION_MAX_LENGTH), mode, false);
		editorChoiceStaged = true;
		errorText = '';
	}

	async function setHumanNextEditorChoice(nextChoice: string, mode: NextEditorMode): Promise<boolean> {
		if (routeBusy || !pack?.id) return false;
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
		if (!draft || !shouldHydratePendingDraft({ preparationInFlight: preparationInFlight || draftRevision.pending, pendingDraft: draft, visibleWorkId: pack?.id || '', preparationReceipt })) return;
		preparationPreviousEditor = savedEditorBaseline(pack);
		preparationReceipt = preparationFromPending(draft);
		setNextEditorChoice(draft.choice, draft.mode, false);
		editorChoiceStaged = true;
	});

	async function prepareNextActionFromWebMcp(
		input: PrepareNextActionInput,
		invocation: { markMutated: () => void }
	) {
		if (routeBusy) throw new Error('Prepare next action is unavailable while Next is updating.');
		const current = currentNextEditor;
		if (!current) throw new Error('Prepare next action requires a visible Next editor.');
		const desiredMode: NextEditorMode = (NEXT_ACTION_CHOICES as readonly string[]).includes(input.choice)
			? 'preset'
			: 'custom';
		const verifiedEvidence = verifyNextPreparationEvidence(
			input.evidence,
			packs.map((candidate) => ({
				id: candidate.id,
				title: workTitle(candidate),
				...evidenceFacts(candidate)
			})),
			current.work.id
		) as NextVerifiedEvidence[];
		const evidenceNote = verifiedNextEvidenceNote(verifiedEvidence);
		const alreadyDesired = current.editor.mode === desiredMode && current.editor.choice === input.choice;
		const receiptAlreadyDesired = preparationReceipt?.preparedAction === input.choice &&
			preparationReceipt.evidenceNote === evidenceNote &&
			evidenceMatchesReferences(preparationReceipt.evidence, input.evidence) &&
			preparationReceipt.work.id === current.work.id;
		const matchesExpected = current.editor.mode === input.expectedMode && current.editor.choice === input.expectedChoice;
		if (!alreadyDesired && !matchesExpected) {
			throw new Error('Prepare next action rejected stale Next editor state.');
		}
		const pending: PendingNextActionDraft = {
			workId: current.work.id,
			choice: input.choice,
			mode: desiredMode,
			evidenceNote,
			evidence: input.evidence,
			originFingerprint: pendingDraftFingerprint($demoState!, { workId: current.work.id, choice: input.choice, mode: desiredMode, evidenceNote, evidence: input.evidence, originFingerprint: 'pending', source: 'webmcp' }),
			source: 'webmcp'
		};
		invocation.markMutated();
		preparationInFlight = true;
		if (!preparationReceipt) preparationPreviousEditor = savedEditorBaseline(pack);
		setNextEditorChoice(input.choice, desiredMode, false);
		editorChoiceStaged = true;
		preparationReceipt = {
			summary: NEXT_PREPARATION_SUMMARY,
			work: current.work,
			evidenceNote,
			evidence: verifiedEvidence,
			preparedAction: input.choice,
			workspaceChanged: false,
			requiresHumanSave: true
		};
		await savePendingNextActionDraft(pending);
		await tick();
		const target = document.getElementById(NEXT_PREPARATION_RECEIPT_ID);
		if (!(target instanceof HTMLElement)) throw new Error('Prepare next action could not find its visible preview.');
		const focusReceipt = focusAndPulse(target, {
			behavior: 'auto',
			block: 'center',
			requireVisibleFocus: true
		});
		if (!currentNextEditor) throw new Error('Prepare next action could not verify the visible editor.');
		preparationInFlight = false;
		return {
			changed: !alreadyDesired || !receiptAlreadyDesired,
			focus: { id: NEXT_PREPARATION_RECEIPT_ID, ...focusReceipt },
			next: currentNextEditor
		};
	}

	async function discardPreparation() {
		if (!pack?.id || !pendingDraft || routeBusy) return;
		const workId = pack.id;
		const consumedDraft = structuredClone(pendingDraft);
		const previous = preparationPreviousEditor;
		busy = true;
		errorText = '';
		try {
			// Discard is always safe, including when evidence has gone stale. Only
			// approval requires the exact settled fingerprint and editor match.
			await discardPendingNextActionDraft(workId);
			clearPreparation();
			recordWebMcpDraftDecision(consumedDraft, 'proposal-discarded');
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

	function editPack(candidate: DemoPack, options: { announce?: boolean; focus?: boolean } = {}) {
		if (!candidate.id || routeBusy || (__NEBIUS_EDITION__ && (nebEditorDirty || nebUpdateDirty))) return;
		chosenPackId = candidate.id;
		taskView = 'next';
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
		if (pendingDraft && pendingDraftStale) {
			errorText = 'Draft is stale. Refresh the evidence and prepare it again before approval.';
			return;
		}
		const workId = pack.id;
		try {
			await runSettledNextDraftAction(draftRevision, {
				busy: routeBusy,
				stale: pendingDraftStale,
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
					recordWebMcpDraftDecision(consumedDraft, 'proposal-approved');
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

<svelte:head><title>{__NEBIUS_EDITION__ ? 'Next step' : 'Next'} — Wornpage Projects™</title></svelte:head>

{#if !demoLoaded}
	<WornPage sectionLabel={__NEBIUS_EDITION__ ? 'Task' : 'Step 3 of 3 · Prepare'} title={__NEBIUS_EDITION__ ? 'Next step' : 'Next actions'} loading={!$demoStateError}>
		{#if $demoStateError}
			<WornError message="Could not load next actions" detail={$demoStateError} onretry={refreshNext} />
		{/if}
	</WornPage>
{:else if notFound}
	<WornPage title={__NEBIUS_EDITION__ ? 'Next step' : 'Next actions'}>
		{#if $demoStateError}
			<WornError message="Could not load next actions" detail={$demoStateError} onretry={refreshNext} />
		{/if}
		<WornError
			message="Work item not found"
			detail={selectedId ? `No loaded work item has id "${selectedId}".` : 'No work item id was provided.'}
		>
			<div class="demo-row-actions">
				<WornButton variant="primary" size="sm" href="/next">Next actions</WornButton>
			</div>
		</WornError>
	</WornPage>
{:else if pack && preview}
	<WornPage sectionLabel={__NEBIUS_EDITION__ ? 'Next step' : 'Step 3 of 3 · Prepare'} title={__NEBIUS_EDITION__ ? workTitle(pack) : preparationReceipt ? 'Review the proposed next action' : 'Set the next action'}>
		{#if !__NEBIUS_EDITION__ || decisionWorkspaceContext}<NextWorkContext workTitle={workTitle(pack)} decisionContext={decisionWorkspaceContext} />{/if}
		{#if __NEBIUS_EDITION__}
			{#if navigationNotice}<WornAlert tone="warning">{navigationNotice}</WornAlert>{/if}
			<div class="nebius-task-workspace">
				<NebiusTaskContext {pack} {packs} disabled={routeBusy || Boolean(pendingDraft) || editorChoiceStaged || nebEditorDirty || nebUpdateDirty} onselect={(candidate) => editPack(candidate, { announce: false, focus: false })} />
				<div class="nebius-task-tools">
				<WornTabs tabs={taskViews} bind:active={taskView} label="Task workspace" />
			{#if taskBlockingState}
				<p class="nebius-draft-resolution" role="status" data-nebius-draft-resolution>{taskBlockingState.reason} <a href={`#${taskBlockingState.target}`} onclick={(event) => focusTaskResolution(event, taskBlockingState.target)}>{taskBlockingState.label}</a></p>
			{/if}
			<!-- Keep every editor mounted: changing tabs must not discard drafts or stop a run. -->
			<div id="task-panel-next" class="task-tab-panel" role="tabpanel" aria-labelledby="task-tab-next" tabindex="0" hidden={taskView !== 'next'}>
			<NebiusSuggestion {pack} {dependencyTitle} disabled={routeBusy || Boolean(pendingDraft) || editorChoiceStaged || nebEditorDirty}
				ondirty={(dirty) => (nebUpdateDirty = dirty)}
				onUse={(changes) => {
					if (routeBusy || pendingDraft || editorChoiceStaged || nebEditorDirty) return;
					taskView = 'next';
					nebiusProposal = { packId: pack.id, changes, nonce: ++nebiusProposalNonce };
				}} />
			{#key pack.id}<NebiusTaskEditor {pack} {dependencyTitle} proposal={nebiusProposal} disabled={routeUpdating || Boolean(pendingDraft) || editorChoiceStaged || nebReviewDirty || nebReviewBusy} ondirty={(dirty) => (nebEditorDirty = dirty)} />{/key}
			</div>
			<div id="task-panel-build" class="task-tab-panel" role="tabpanel" aria-labelledby="task-tab-build" tabindex="0" hidden={taskView !== 'build'}>
			{#key pack.id}
				<NebiusTaskRun
					{pack}
					disabled={routeBusy || Boolean(pendingDraft) || editorChoiceStaged || nebEditorDirty || nebUpdateDirty || nebReviewDirty || nebReviewBusy}
					disabledReason={taskBlockingState?.reason || (routeUpdating ? 'Wait for the current task change to finish saving.' : '')}
				/>
			{/key}
			</div>
			<div id="task-panel-evidence" class="task-tab-panel" role="tabpanel" aria-labelledby="task-tab-evidence" tabindex="0" hidden={taskView !== 'evidence'}>
			<NebiusEvidenceReview {pack} expanded disabled={routeUpdating || Boolean(pendingDraft) || editorChoiceStaged || nebEditorDirty}
				onstate={({ dirty, busy }) => { nebReviewDirty = dirty; nebReviewBusy = busy; }} />
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
			<WebMcpActivityStrip
				id={NEXT_PREPARATION_RECEIPT_ID}
				route="next"
				outcome="Draft prepared — waiting for your approval."
				toolName={PREPARE_NEXT_ACTION_TOOL_NAME}
				cells={preparationCells}
			/>
		{:else if pendingDraft?.source === 'human' && !__NEBIUS_EDITION__}
			<WornAlert tone="info">Draft prepared by you. The Next action remains unsaved until you approve Save.</WornAlert>
		{/if}
		<div id="nebius-button-action-panel" class:nebius-button-action-panel={__NEBIUS_EDITION__} hidden={__NEBIUS_EDITION__ && !buttonActionVisible} tabindex="-1">
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
		{#if pendingDraftStale}
			<WornAlert tone="warning">Draft is stale. Refresh the visible work and re-prepare before approval; this draft cannot be saved.</WornAlert>
		{/if}

		{#if !__NEBIUS_EDITION__ || pendingDraft || editorChoiceStaged}
		<div class="demo-inline-form next-action-editor">
			<div class="demo-field">
				<p class="next-editor-step"><strong>1 · Choose an action</strong><span>Then prepare a browser-local draft before approval.</span></p>
				<fieldset class="next-choice-guard" disabled={routeBusy}>
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
						disabled={routeBusy}
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
					{#if !terminalDraftAvailable && !pendingDraftStale}
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
					<WornButton type="button" disabled={routeBusy} onclick={discardPreparation}>{pendingDraftStale ? 'Discard stale draft' : 'Discard draft'}</WornButton>
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

			<NextCandidatePicker {packs} currentPackId={pack.id || ''} onedit={editPack} />
		</WornCollapsible>
	</WornPage>
{:else}
	<WornPage title={__NEBIUS_EDITION__ ? 'Next step' : 'Next actions'}>
		{#if $demoStateError}
			<WornError message="Could not load next actions" detail={$demoStateError} onretry={refreshNext} />
		{/if}
		<WornEmpty
			title="No sample work available"
			description="Choose a work item in Work or load the challenge sample before preparing next actions."
		>
			<WornButton variant="primary" href="/webmcp-challenge">Open guide</WornButton>
			<WornButton href="/work">Open Work</WornButton>
		</WornEmpty>
	</WornPage>
{/if}

<style>
	.nebius-task-workspace { align-items: start; display: grid; gap: 24px; grid-template-columns: minmax(240px, .8fr) minmax(0, 1.8fr); margin-block: 16px 24px; min-inline-size: 0; }
	.nebius-task-tools, .task-tab-panel { min-inline-size: 0; }
	.task-tab-panel[hidden] { display: none; }
	.task-tab-panel:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 4px; }
	.task-tab-panel :global(.nebius-suggestion), .task-tab-panel :global(.nebius-review) { margin-block-start: 0; }
	@media (max-width: 900px) { .nebius-task-workspace { grid-template-columns: minmax(0, 1fr); gap: 20px; } }
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
