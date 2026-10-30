<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { WornAlert, WornBadge, WornButton, WornTimeline } from '$lib/components';
	import {
		ChallengeStateError,
		demoState,
		displayToast,
		executionRunMatchesCurrentTask,
		saveExecutionRunEvidence,
		saveExecutionRunRecord
	} from '$lib/demo-client';
	import type { DemoPack } from '$lib/demo-workflow';
	import { downloadRunPreviewHtml, readRun } from '$lib/nebius-execution-client';
	import { validateRunIntegrity, type RunFile, type RunRecord } from '$lib/nebius-execution-contract.mjs';
	import { projectTask } from '$lib/nebius-contract.mjs';
	import { taskRunReview } from '$lib/nebius-task-review.mjs';
	import { activityTextWithoutActor } from '$lib/activity';
	import NebiusEvidenceReview from '../next/NebiusEvidenceReview.svelte';
	import NebiusBriefPreview from '../next/NebiusBriefPreview.svelte';
	import NebiusProjectEvidence from '../next/NebiusProjectEvidence.svelte';
	import RequestChangeDiff from './RequestChangeDiff.svelte';

	type Props = { pack: DemoPack; readOnly?: boolean; onOpenTask?: (event: MouseEvent) => void; onstate?: (state: { dirty: boolean; busy: boolean }) => void };
	let { pack, readOnly = false, onOpenTask, onstate }: Props = $props();
	let busy = $state<'refresh' | 'download' | 'save' | ''>('');
	let error = $state('');
	let savedMessage = $state('');
	let verified = $state<RunRecord | null>(null);
	let integrityError = $state('');
	let previewOpen = $state(false);
	let previewFrame = $state<HTMLIFrameElement | null>(null);
	let previewStatus = $state('');
	let integrityRevision = 0;
	let stopPreviewMessages: (() => void) | null = null;
	let previewTimer: ReturnType<typeof setTimeout> | null = null;
	let previewOpening = false;
	let previewTrigger: HTMLButtonElement | null = null;
	let evidenceDirty = $state(false);
	let evidenceBusy = $state(false);
	let navigationNotice = $state('');
	let requestChangesOpen = $state(false);
	type ReviewView = 'preview' | 'review';
	let reviewElement = $state<HTMLElement | null>(null);
	let reviewBody = $state<HTMLElement | null>(null);
	let viewSwitch = $state<HTMLElement | null>(null);
	let narrow = $state(false);
	let activeView = $state<ReviewView>('review');
	const viewFocus: Partial<Record<ReviewView, HTMLElement>> = {};
	const viewScroll: Partial<Record<ReviewView, number>> = {};
	let rememberedIdentity = '';
	$effect(() => onstate?.({ dirty: evidenceDirty, busy: evidenceBusy }));

	let reference = $derived(pack.executionRun || null);
	let record = $derived(reference?.record || null);
	let serializedRecord = $derived(record ? JSON.stringify(record) : '');
	let runIdentity = $derived(reference ? JSON.stringify([pack.id, reference.id, reference.key]) : '');
	let currentTaskMatches = $derived(Boolean(reference && executionRunMatchesCurrentTask(pack, reference)));
	let staleRun = $derived(Boolean(reference && !currentTaskMatches));
	let previewName = $derived(reference ? `nebius-preview-${reference.id}` : 'nebius-preview');
	let review = $derived(taskRunReview({ currentTask: projectTask(pack), currentInputFormats: pack.executionInputs ?? null, currentOutputs: pack.executionOutputs ?? null,
		reference, record, verified, integrityError, currentTaskMatches, taskStatus: pack.status || 'not set',
		completionEvidence: pack.completionEvidence || '', archived: Boolean(pack.archived) }));
	let ready = $derived(review.state === 'ready');
	let trusted = $derived(['no-run', 'pending', 'verifying', 'invalid'].includes(review.state) ? null : verified);
	let runEvents = $derived((trusted?.events ?? []).map(event => ({ date: event.at, title: event.message })));
	let sectionIds = $derived({ request: `run-request-${pack.id}`, proposal: `run-proposal-${pack.id}`, evidence: `run-evidence-${pack.id}`, decision: `run-decision-${pack.id}` });
	let changedRequestFields = $derived(review.request.fields.filter(field => field.changed));
	let requestContentChanged = $derived(Boolean(changedRequestFields.length || review.request.inputFormatsChanged || review.request.outputsChanged));
	let requestChanges = $derived.by(() => {
		if (!reference) return [];
		const changes = changedRequestFields.map(field => ({ key: String(field.key), label: field.key === 'doneWhen' ? 'Completion criteria' : field.label,
			saved: field.requested ?? '', current: field.current ?? '', prose: true }));
		if (review.request.inputFormatsChanged) changes.push({ key: 'inputs', label: 'Tool inputs',
			saved: formatRequirements(review.request.requestedInputFormats), current: formatRequirements(review.request.currentInputFormats), prose: false });
		if (review.request.outputsChanged) changes.push({ key: 'outputs', label: 'Required outputs',
			saved: reference.input.version === 'browser-tool.v3' ? formatRequirements(review.request.requestedOutputs, true) : 'Not declared in this historical request',
			current: formatRequirements(review.request.currentOutputs, true), prose: false });
		return changes;
	});
	let statusOnlyDrift = $derived(staleRun && !requestContentChanged && reference?.input.currentStatus !== pack.status);
	let savedToolHistory = $derived(Boolean(reference) && !requestContentChanged && (readOnly || statusOnlyDrift));
	let toolSectionLabel = $derived(savedToolHistory ? 'Saved tool' : staleRun ? 'Previous tool' : 'Tool');
	let latestNote = $derived(activityTextWithoutActor(pack.memory?.at(-1) || ''));
	let requestStatusText = $derived(!reference ? 'Task brief' : requestContentChanged ? 'Request changed' : statusOnlyDrift ? 'Task state changed' : currentTaskMatches ? 'Request unchanged' : 'Request details');
	let toolStatusText = $derived(ready ? (savedToolHistory || staleRun ? 'Tool retained' : 'Tool ready to try') : review.label);
	let checksStatusText = $derived(review.evidenceExplanation.authoredExample ? 'Sample checks' : review.evidence.checkCount === null ? 'Results unverified' : review.evidence.checkCount === 0 ? 'No checks recorded' : 'Checks recorded');
	let decisionStatusText = $derived(pack.status === 'done' ? 'Task marked done' : pack.archived ? 'Saved history' : 'Review needed');

	function sectionElement(id: string) {
		const element = document.getElementById(id);
		return element && reviewElement?.contains(element) ? element : null;
	}
	function visibleFocusTarget(element: HTMLElement | null | undefined): element is HTMLElement {
		return Boolean(element?.isConnected && reviewElement?.contains(element) && !element.closest('[hidden]') &&
			element.getClientRects().length && !element.matches(':disabled, [aria-disabled="true"]'));
	}
	function viewForElement(element: Element | null): ReviewView | null {
		if (!element || !reviewElement?.contains(element)) return null;
		const view = element?.closest<HTMLElement>('[data-review-pane]')?.dataset.reviewPane;
		return view === 'preview' || view === 'review' ? view : null;
	}
	function rememberViewFocus(event: FocusEvent) {
		if (!(event.target instanceof HTMLElement)) return;
		const view = viewForElement(event.target);
		if (view) viewFocus[view] = event.target;
	}
	function rememberViewScroll() {
		if (narrow && ready && reviewBody) viewScroll[activeView] = window.scrollY - (reviewBody.getBoundingClientRect().top + window.scrollY);
	}
	function focusView(view: ReviewView) {
		const remembered = viewFocus[view];
		const section = sectionElement(view === 'preview' ? sectionIds.proposal : sectionIds.request);
		const fallback = (view === 'preview' ? section?.querySelector<HTMLElement>('button:not(:disabled)') : null) ?? section?.querySelector<HTMLElement>('h3');
		const target = visibleFocusTarget(remembered) ? remembered : fallback;
		if (visibleFocusTarget(target)) target.focus({ preventScroll: true });
	}
	let viewTransitionRevision = 0;
	async function selectView(view: ReviewView) {
		const revision = ++viewTransitionRevision;
		const identity = runIdentity;
		const trigger = document.activeElement;
		let focusMoved = false;
		const trackFocus = (event: FocusEvent) => {
			if (event.target instanceof HTMLElement && event.target !== trigger &&
				event.target !== document.body && event.target !== document.documentElement) focusMoved = true;
		};
		document.addEventListener('focusin', trackFocus, true);
		rememberViewScroll();
		activeView = view;
		try { await tick(); }
		finally { document.removeEventListener('focusin', trackFocus, true); }
		if (revision !== viewTransitionRevision || identity !== runIdentity || activeView !== view || focusMoved ||
			!document.hasFocus() || !reviewElement?.isConnected ||
			(document.activeElement !== trigger && document.activeElement !== document.body && document.activeElement !== document.documentElement)) return;
		if (narrow && ready && reviewBody) {
			const bodyTop = reviewBody.getBoundingClientRect().top + window.scrollY;
			const offset = viewScroll[view] ?? -(viewSwitch?.getBoundingClientRect().height || 0) - 8;
			window.scrollTo({ top: Math.max(0, bodyTop + offset), behavior: 'auto' });
		}
		focusView(view);
	}
	function revealHashView() {
		let id: string;
		try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
		if (Object.values(sectionIds).includes(id)) activeView = id === sectionIds.proposal ? 'preview' : 'review';
	}
	async function jumpToSection(event: MouseEvent, id: string) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		rememberViewScroll();
		activeView = id === sectionIds.proposal ? 'preview' : 'review';
		const destination = new URL(window.location.href);
		destination.hash = id;
		try {
			if (destination.href !== window.location.href) await goto(destination, { keepFocus: true, noScroll: true });
		} catch { return; }
		await tick();
		const section = sectionElement(id);
		section?.scrollIntoView({ block: 'start', behavior: 'auto' });
		section?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
	}
	export async function focusEvidence() {
		activeView = 'review';
		await tick();
		const summary = reviewElement?.querySelector<HTMLElement>('#nebius-evidence-recording > summary');
		if (visibleFocusTarget(summary)) summary.focus();
	}
	$effect(() => {
		const identity = runIdentity;
		if (identity === rememberedIdentity) return;
		rememberedIdentity = identity;
		delete viewFocus.preview; delete viewFocus.review;
		delete viewScroll.preview; delete viewScroll.review;
	});
	onMount(() => {
		const media = window.matchMedia('(max-width: 999px)');
		const update = () => {
			const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			const focusedView = viewForElement(focused);
			if (media.matches && focusedView) activeView = focusedView;
			const switchOwnedFocus = Boolean(focused && viewSwitch?.contains(focused));
			narrow = media.matches;
			if (!narrow && switchOwnedFocus) void tick().then(() => {
				if (document.activeElement === focused || document.activeElement === document.body) focusView(activeView);
			});
		};
		let frameFocusTimer: ReturnType<typeof setTimeout> | null = null;
		const rememberFrame = () => {
			if (frameFocusTimer) clearTimeout(frameFocusTimer);
			frameFocusTimer = setTimeout(() => {
				if (previewFrame && document.activeElement === previewFrame) viewFocus.preview = previewFrame;
				frameFocusTimer = null;
			}, 0);
		};
		revealHashView(); update();
		media.addEventListener('change', update);
		window.addEventListener('blur', rememberFrame);
		return () => { media.removeEventListener('change', update); window.removeEventListener('blur', rememberFrame); if (frameFocusTimer) clearTimeout(frameFocusTimer); };
	});
	afterNavigate(revealHashView);

	beforeNavigate((navigation) => {
		if (!evidenceDirty && !evidenceBusy) return;
		if (navigation.to?.url.origin === window.location.origin && navigation.to.url.pathname === window.location.pathname && navigation.to.url.search === window.location.search) return;
		navigation.cancel();
		if (navigation.type === 'leave') return;
		navigationNotice = evidenceBusy ? 'Wait for the evidence action to finish.' : 'Save or discard your evidence edits before leaving.';
		void focusEvidence();
	});
	$effect(() => { if (!evidenceDirty && !evidenceBusy) navigationNotice = ''; });

	function formatRequirements(items: { id: string; format: string }[] | null, outputs = false): string {
		return items === null ? 'Not specified' : items.length ? items.map(item => `${item.id}: ${item.format === 'json' ? 'JSON' : item.format === 'timeline' ? 'timeline' : 'plain text'}`).join('\n') : outputs ? 'No minimum outputs' : 'No text inputs';
	}
	function briefPreview(text: string): string {
		const characters = [...text];
		return characters.length > 180 ? `${characters.slice(0, 180).join('').trimEnd()}…` : text;
	}
	function editTask(event: MouseEvent) {
		if (evidenceDirty || evidenceBusy) {
			event.preventDefault();
			navigationNotice = evidenceBusy ? 'Wait for the evidence action to finish.' : 'Save or discard your evidence edits before leaving.';
			void focusEvidence();
			return;
		}
		onOpenTask?.(event);
	}

	$effect(() => {
		const serialized = serializedRecord;
		const identity = runIdentity;
		const revision = ++integrityRevision;
		verified = null;
		integrityError = '';
		stopPreviewListener();
		previewOpen = false;
		previewStatus = '';
		if (!serialized || !identity) return;
		const candidate = JSON.parse(serialized);
		void validateRunIntegrity(candidate).then((result) => {
			if (revision === integrityRevision && runIdentity === identity && serializedRecord === serialized) verified = result;
		}).catch((cause) => {
			if (revision === integrityRevision && runIdentity === identity && serializedRecord === serialized) integrityError = cause instanceof Error ? cause.message : 'The saved result failed its integrity check.';
		});
	});

	function stopPreviewListener() {
		stopPreviewMessages?.();
		stopPreviewMessages = null;
		if (previewTimer) clearTimeout(previewTimer);
		previewTimer = null;
	}

	function listenForPreviewStatus(frame: HTMLIFrameElement) {
		stopPreviewListener();
		let started = false;
		const receive = (event: MessageEvent) => {
			if (event.source !== frame.contentWindow || event.origin !== 'null') return;
			const value = event.data;
			if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'status,type' ||
				value.type !== 'nebius-tool-preview' || (value.status !== 'ready' && value.status !== 'failed')) return;
			if (value.status === 'ready') {
				started = true;
				previewStatus = 'Preview running';
				if (previewTimer) clearTimeout(previewTimer);
				previewTimer = null;
			} else {
				previewStatus = started ? 'Preview stopped. Reopen it or inspect source and checks.' : 'Preview could not run. Inspect source and checks.';
				stopPreviewListener();
			}
		};
		window.addEventListener('message', receive);
		stopPreviewMessages = () => window.removeEventListener('message', receive);
		previewTimer = setTimeout(() => {
			previewStatus = 'Preview could not run. Inspect source and checks.';
			stopPreviewListener();
		}, 8000);
	}

	function retainActionFocus(event: MouseEvent) {
		const captured = { id: reference?.id, key: reference?.key };
		const packId = pack.id;
		const trigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
		const ownedFocus = trigger !== null && document.activeElement === trigger;
		let focusMoved = false;
		const trackFocus = (next: FocusEvent) => {
			if (next.target instanceof HTMLElement && next.target !== trigger &&
				next.target !== document.body && next.target !== document.documentElement) focusMoved = true;
		};
		if (ownedFocus) document.addEventListener('focusin', trackFocus, true);
		return async () => {
			await tick();
			if (ownedFocus) document.removeEventListener('focusin', trackFocus, true);
			if (ownedFocus && !focusMoved && document.hasFocus() && visibleFocusTarget(trigger) && !trigger.disabled &&
				pack.id === packId && reference?.id === captured.id && reference?.key === captured.key &&
				(document.activeElement === trigger || document.activeElement === document.body || document.activeElement === document.documentElement)) {
				trigger.focus({ preventScroll: true });
			}
		};
	}

	async function refreshResult(event: MouseEvent) {
		if (readOnly || !reference || busy || evidenceDirty || evidenceBusy) return;
		const { id, key } = reference;
		const packId = pack.id;
		const restoreFocus = retainActionFocus(event);
		busy = 'refresh';
		error = '';
		savedMessage = '';
		try {
			const next = await readRun(id, key, packId);
			if (pack.id !== packId || pack.executionRun?.id !== id) return;
			await saveExecutionRunRecord(packId, id, key, next);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The saved run could not be refreshed.';
		} finally {
			busy = '';
			await restoreFocus();
		}
	}

	function downloadSource(file: RunFile) {
		if (!verified || verified.id !== reference?.id) return;
		const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${file.path}.txt`;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}

	async function downloadTool(event: MouseEvent) {
		if (!reference || !ready || integrityError || busy) return;
		const { id, key } = reference;
		const restoreFocus = retainActionFocus(event);
		busy = 'download';
		error = '';
		try {
			const html = await downloadRunPreviewHtml(id, key);
			if (pack.executionRun?.id !== id) return;
			const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'tool.html';
			anchor.click();
			setTimeout(() => URL.revokeObjectURL(url), 0);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'The complete tool could not be downloaded.';
		} finally {
			busy = '';
			await restoreFocus();
		}
	}

	async function openPreview(event: MouseEvent) {
		if (!reference || !ready || integrityError || previewOpening || busy) return;
		const captured = { id: reference.id, key: reference.key };
		const updatedAt = verified?.updatedAt;
		if (event.currentTarget instanceof HTMLButtonElement) previewTrigger = event.currentTarget;
		previewOpening = true;
		try {
			stopPreviewListener();
			previewOpen = false;
			await tick();
			if (reference?.id !== captured.id || reference.key !== captured.key || !ready || integrityError || verified?.updatedAt !== updatedAt) return;
			previewStatus = 'Opening isolated preview…';
			previewOpen = true;
			await tick();
			if (!previewOpen || reference?.id !== captured.id || reference.key !== captured.key || !ready || integrityError || verified?.updatedAt !== updatedAt) return;
			const iframe = previewFrame;
			if (!iframe) {
				error = 'The isolated preview frame could not be opened.';
				return;
			}
			listenForPreviewStatus(iframe);
			const form = document.createElement('form');
			form.method = 'POST';
			form.action = `/api/nebius/runs/${captured.id}/preview`;
			form.target = previewName;
			form.hidden = true;
			const key = document.createElement('input');
			key.type = 'hidden';
			key.name = 'key';
			key.value = captured.key;
			form.append(key);
			document.body.append(form);
			try { form.requestSubmit(); } finally { form.remove(); }
		} finally {
			previewOpening = false;
		}
	}

	async function closePreview() {
		const trigger = previewTrigger;
		stopPreviewListener();
		previewOpen = false;
		previewStatus = '';
		await tick();
		if (visibleFocusTarget(trigger)) trigger.focus();
	}

	async function saveEvidence(event: MouseEvent) {
		if (readOnly || !reference || !ready || !currentTaskMatches || busy || evidenceDirty || evidenceBusy) return;
		const restoreFocus = retainActionFocus(event);
		busy = 'save';
		error = '';
		savedMessage = '';
		try {
			await saveExecutionRunEvidence(pack.id, reference.id, reference.key);
			savedMessage = 'Run evidence saved. The task remains open.';
			displayToast(savedMessage, 'success');
		} catch (cause) {
			error = cause instanceof ChallengeStateError || cause instanceof Error ? cause.message : 'Run evidence could not be saved.';
		} finally {
			busy = '';
			await restoreFocus();
		}
	}

	function tokenCount(value: number | null): string {
		return value === null ? 'Unknown' : value.toLocaleString();
	}

	onDestroy(stopPreviewListener);
</script>

<section bind:this={reviewElement} class="run-review demo-focus-surface" class:has-tool={ready} class:stale-run={staleRun} data-nebius-run-review data-pack-id={pack.id} tabindex="-1" aria-labelledby="run-review-title" onfocusin={rememberViewFocus}>
	{#if !reference}
		<div class="run-review-head" id={sectionIds.proposal} data-nebius-task-review>
			<div><h2 id="run-review-title" class="demo-card-title">Review task</h2></div>
		</div>
	{:else}
	<div class="run-review-head">
		<div>
			<p class="run-review-kicker">Nebius · Task review</p>
			<h2 id="run-review-title" class="demo-card-title">Review this build</h2>
		</div>
		<WornBadge label={review.label} variant={review.state === 'ready' && currentTaskMatches ? 'accent' : undefined} />
	</div>
	<nav class="run-review-status" aria-label="Build review sections" data-review-status>
		<a href={`#${sectionIds.proposal}`} data-review-section-link="proposal" onclick={event => jumpToSection(event, sectionIds.proposal)}>{toolStatusText}</a><span aria-hidden="true">·</span>
		<a href={`#${sectionIds.request}`} data-review-section-link="request" onclick={event => jumpToSection(event, sectionIds.request)}>{requestStatusText}</a><span aria-hidden="true">·</span>
		<a href={`#${sectionIds.evidence}`} data-review-section-link="evidence" onclick={event => jumpToSection(event, sectionIds.evidence)}>{checksStatusText}</a><span aria-hidden="true">·</span>
		<a href={`#${sectionIds.decision}`} data-review-section-link="decision" onclick={event => jumpToSection(event, sectionIds.decision)}>{decisionStatusText}</a>
	</nav>
		{#if error}<WornAlert tone="danger">{error}</WornAlert>{/if}
		{#if readOnly}<WornAlert tone="info">This completed or archived task is open as read only history. You can inspect, try, or download the saved tool without reopening the task.</WornAlert>{/if}
		{#if savedMessage}<WornAlert tone="success">{savedMessage}</WornAlert>{/if}
		{#if !record}
			<WornAlert tone="warning">The start response is unknown. Refresh this saved run; do not start another paid operation yet.</WornAlert>
		{:else}
			{#if !currentTaskMatches && !(readOnly && statusOnlyDrift)}
				<WornAlert tone="warning">{statusOnlyDrift ? 'The task status has changed since this run started. You can inspect the saved tool, but this run cannot be saved as current evidence.' : 'The task details have changed since this run started. You can inspect the result, but it cannot be saved as current evidence.'}</WornAlert>
			{/if}
			{#if integrityError}<WornAlert tone="danger">{integrityError}</WornAlert>{/if}
			{#if record.error}<WornAlert tone="danger">{record.error}</WornAlert>{/if}
		{/if}
	{/if}
	<div bind:this={viewSwitch} class="review-view-switch" role="group" aria-label="Review view" hidden={!narrow || !ready}>
		<WornButton type="button" aria-pressed={activeView === 'preview'} aria-controls={sectionIds.proposal} onclick={() => selectView('preview')}>Preview</WornButton>
		<WornButton type="button" aria-pressed={activeView === 'review'} aria-controls={`${sectionIds.request} ${sectionIds.evidence} ${sectionIds.decision}`} onclick={() => selectView('review')}>Review</WornButton>
	</div>
	<div bind:this={reviewBody} class="review-body" class:has-tool={ready} data-review-body>
	{#if !reference}
		<section class="review-step task-criteria" id={sectionIds.request} aria-labelledby={`${sectionIds.request}-title`} data-nebius-task-criteria>
			<h3 id={`${sectionIds.request}-title`} tabindex="-1">Completion criteria</h3>
			{#key pack.id}<NebiusBriefPreview text={pack.doneWhen || 'No completion criteria saved.'} label="Completion criteria" currentCriteria />{/key}
		</section>
	{:else}
	<section class="review-step request-step" id={sectionIds.request} aria-labelledby={`${sectionIds.request}-title`} data-nebius-review-context data-review-pane="review" hidden={narrow && ready && activeView !== 'review'}>
		<h3 id={`${sectionIds.request}-title`} tabindex="-1">1 · Request</h3>
		<p>{briefPreview(reference?.input.pack.purpose || pack.purpose || 'No purpose saved.')}</p>
		{#if reference && !currentTaskMatches}
			<p class="request-drift">{changedRequestFields.length || review.request.inputFormatsChanged || review.request.outputsChanged ? 'Current task differs from this request.' : 'Task state changed since this run.'}{#if changedRequestFields.length}{' '}Changed: {changedRequestFields.map(field => field.label.toLowerCase()).join(', ')}.{/if}{#if review.request.inputFormatsChanged}{' '}Input requirements changed.{/if}{#if review.request.outputsChanged}{' '}Output requirements changed.{/if}{#if reference.input.currentStatus !== pack.status}{' '}Status: {reference.input.currentStatus} → {pack.status || 'not set'}.{/if}</p>
		{:else if reference}<p class="run-muted">Current task matches the saved request.</p>{/if}
		{#if requestChanges.length}
			<details class="request-changes" data-request-changes bind:open={requestChangesOpen}>
				<summary>See changes · {requestChanges.length} {requestChanges.length === 1 ? 'field' : 'fields'}</summary>
				<div class="request-change-list">
					{#each requestChanges as change (change.key)}
						<div class="request-change" data-request-change={change.key}>
							<h4>{change.label}</h4>
							{#if change.prose}
								{#if requestChangesOpen}<RequestChangeDiff label={change.label} saved={change.saved} current={change.current} />{/if}
							{:else}
							<dl>
								<div><dt><span aria-hidden="true">−</span>{' '}Saved request</dt><dd>{change.saved}</dd></div>
								<div><dt><span aria-hidden="true">+</span>{' '}Current task</dt><dd>{change.current}</dd></div>
							</dl>
							{/if}
						</div>
					{/each}
				</div>
			</details>
		{/if}
		<details class="current-criteria"><summary>Current completion criteria</summary>{#key pack.id}<NebiusBriefPreview text={pack.doneWhen || 'No completion criteria saved.'} label="Completion criteria" currentCriteria />{/key}</details>
		<details data-current-full-brief>
			<summary>{reference ? 'All request details' : 'Full task requirements'}</summary>
			<div class="request-fields">
			{#each review.request.fields as field (field.key)}
				<div class="request-field" class:changed={field.changed}>
					<h4>{field.label}{#if field.changed}<span class="field-change-label">Changed</span>{/if}</h4>
					<dl class:has-change={field.changed}>
						{#if reference}<div><dt>{field.changed ? 'At run start' : 'Requested · unchanged'}</dt><dd>{field.requested || 'Not specified'}</dd></div>{/if}
						{#if !reference || field.changed}<div><dt>Current task</dt><dd>{field.current || 'Not specified'}</dd></div>{/if}
					</dl>
				</div>
			{/each}
			<div class="request-field" class:changed={review.request.inputFormatsChanged}>
				<h4>Tool inputs{#if review.request.inputFormatsChanged}<span class="field-change-label">Changed</span>{/if}</h4>
				<dl class:has-change={review.request.inputFormatsChanged}>
					{#if reference}<div><dt>At run start</dt><dd>{formatRequirements(review.request.requestedInputFormats)}</dd></div>{/if}
					{#if !reference || review.request.inputFormatsChanged}<div><dt>Current task</dt><dd>{formatRequirements(review.request.currentInputFormats)}</dd></div>{/if}
				</dl>
			</div>
			<div class="request-field" class:changed={review.request.outputsChanged}>
				<h4>Required outputs{#if review.request.outputsChanged}<span class="field-change-label">Changed</span>{/if}</h4>
				<dl class:has-change={review.request.outputsChanged}>
					{#if reference}<div><dt>At run start</dt><dd>{reference.input.version === 'browser-tool.v3' ? formatRequirements(review.request.requestedOutputs, true) : 'Not declared in this historical request'}</dd></div>{/if}
					{#if !reference || review.request.outputsChanged}<div><dt>Current task</dt><dd>{formatRequirements(review.request.currentOutputs, true)}</dd></div>{/if}
				</dl>
			</div>
			</div>
		</details>
		{#if latestNote}<details><summary>Latest saved note</summary><p>{latestNote}</p></details>{/if}
	</section>

	<section class="review-step tool-step" id={sectionIds.proposal} aria-labelledby={`${sectionIds.proposal}-title`} data-run-proposal data-review-pane="preview" hidden={narrow && ready && activeView !== 'preview'}>
		<h3 id={`${sectionIds.proposal}-title`} tabindex="-1">2 · {toolSectionLabel}</h3>
		<p>{savedToolHistory && ready ? 'Tool requirements are unchanged. This result is retained with the task.' : staleRun && ready ? 'This tool was built for an earlier version of the task.' : review.proposal.summary}</p>
		{#if review.proposal.rejectedResponses}<p class="run-muted">{review.proposal.rejectedResponses} rejected {review.proposal.rejectedResponses === 1 ? 'attempt' : 'attempts'} recorded in Evidence. Rejected attempts are not a usable tool.</p>{/if}
			{#if ready}
				<div class="run-artifact" class:preview-is-open={previewOpen} data-run-canvas>
					<div class="run-artifact-intro">
						<div class="run-artifact-title">
							<p class="run-artifact-prompt">{savedToolHistory ? previewOpen ? 'Saved browser tool' : 'Inspect the saved tool.' : currentTaskMatches ? previewOpen ? 'Your browser tool' : 'Try it with your own inputs.' : previewOpen ? 'Earlier browser tool' : 'Inspect the earlier tool.'}</p>
							{#if previewOpen}<p class="run-preview-label" role="status">Isolated preview · {previewStatus}</p>
							{:else}<p class="run-muted">Runs in your browser. The downloaded HTML works independently.</p>{/if}
						</div>
						<div class="run-try" data-run-try>
							<WornButton type="button" variant={currentTaskMatches && !savedToolHistory ? 'primary' : undefined} disabled={Boolean(busy) || Boolean(integrityError)} onclick={openPreview}>{savedToolHistory ? 'Inspect saved tool' : currentTaskMatches ? 'Try your tool' : 'Inspect previous tool'}</WornButton>
							<WornButton type="button" disabled={Boolean(busy) || Boolean(integrityError)} onclick={downloadTool}>{busy === 'download' ? 'Downloading…' : savedToolHistory ? 'Download saved tool' : currentTaskMatches ? 'Download tool' : 'Download previous tool'}</WornButton>
							{#if previewOpen}<WornButton type="button" size="sm" onclick={closePreview}>Close preview</WornButton>{/if}
						</div>
					</div>
					{#if previewOpen}
						<div class="run-preview-shell">
							<iframe bind:this={previewFrame} name={previewName} title={`Isolated preview for ${verified?.pack.title || pack.title}`} src="about:blank" sandbox="allow-scripts"></iframe>
						</div>
					{/if}
				</div>
			{/if}
	</section>
	<section class="review-step evidence-step" id={sectionIds.evidence} aria-labelledby={`${sectionIds.evidence}-title`} data-run-evidence data-review-pane="review" hidden={narrow && ready && activeView !== 'review'}>
		<h3 id={`${sectionIds.evidence}-title`} tabindex="-1">3 · Build evidence</h3>
		<p class="evidence-origin">App summary · {review.evidenceExplanation.authoredExample ? 'authored sample data' : trusted ? 'saved run record' : 'no verified run record'}</p>
		<dl class="evidence-explanation" data-run-evidence-explanation>
			<div><dt>Checks written by</dt><dd>{review.evidenceExplanation.author}</dd></div>
			<div><dt>What ran</dt><dd>{review.evidenceExplanation.execution}</dd></div>
			<div><dt>Recorded result</dt><dd>{review.evidenceExplanation.result}</dd></div>
			<div><dt>Your decision</dt><dd>{review.evidenceExplanation.decision}</dd></div>
		</dl>
		{#if reference}
		<details class="run-details" data-run-details>
			<summary>Run details, checks and source{#if trusted}<span class="run-details-counts">{review.evidenceExplanation.authoredExample ? "Sample counts · " : ""}{trusted.usage.modelCalls} model {trusted.usage.modelCalls === 1 ? 'call' : 'calls'} · {trusted.checks.length} Sandbox {trusted.checks.length === 1 ? 'result' : 'results'} · {trusted.files.length} {trusted.files.length === 1 ? 'file' : 'files'}</span>{/if}</summary>
			<div class="run-details-body">
				<p class="run-review-id">Run {reference.id}</p>
			{#if trusted}
			{#if runEvents.length}
				<details class="run-build-history" data-run-build-history>
					<summary>Build history · {runEvents.length} {runEvents.length === 1 ? 'event' : 'events'}</summary>
					<WornTimeline entries={runEvents} ariaLabel="Recorded build activity, oldest first" headingLevel={4} density="compact" formatDate={(date) => new Date(date).toLocaleString()} />
				</details>
			{/if}
			{#if trusted.failure}
				<details data-run-diagnostics><summary>Failure details</summary><dl><dt>Stage</dt><dd>{trusted.failure.stage.replaceAll('_', ' ')}</dd><dt>Code</dt><dd>{trusted.failure.code}</dd></dl></details>
			{:else if trusted.error}<p class="run-muted">No structured failure details were recorded for this run.</p>{/if}
			<div class="run-review-facts">
				<div><span>Model</span><strong>{trusted.requestedModel}</strong></div>
				<div><span>Recorded model calls</span><strong>{trusted.usage.modelCalls}</strong></div>
				<div><span>Recorded input tokens</span><strong>{tokenCount(trusted.usage.inputTokens)}</strong></div>
				<div><span>Recorded output tokens</span><strong>{tokenCount(trusted.usage.outputTokens)}</strong></div>
			</div>
			{#if !trusted.usage.totalsComplete}<p class="run-muted">Usage is incomplete. These counts include only recorded usage; the actual total may be higher.</p>{/if}

			<section class="run-checks" aria-labelledby="run-checks-title">
				<h4 id="run-checks-title">Recorded Sandbox results</h4>
				{#if trusted.checks.length === 0}
					<p class="run-muted">No sandbox check result is available.</p>
				{:else}
					{#each trusted.checks as check (check.attempt)}
						<details>
							<summary>Model attempt {check.attempt} · Sandbox exit {check.exitCode}</summary>
							<dl><dt>Operation</dt><dd>{check.operationId}</dd><dt>Checkpoint</dt><dd>{check.checkpointId || 'Unknown'}</dd><dt>Source digest</dt><dd>{check.sourceDigest}</dd></dl>
							<div class="run-output"><h5>stdout</h5><pre>{check.stdout || '(empty)'}</pre></div>
							<div class="run-output"><h5>stderr</h5><pre>{check.stderr || '(empty)'}</pre></div>
						</details>
					{/each}
				{/if}
			</section>

			{#if trusted.generationAttempts.length}
				<details data-run-generation-history>
					<summary>Generation responses ({trusted.generationAttempts.length})</summary>
					<p class="run-muted">Source validation does not prove the tool passed its checks.</p>
					{#each trusted.generationAttempts as generation (generation.attempt)}
						<details>
							<summary>Model attempt {generation.attempt} · {generation.outcome === 'accepted' ? 'source validation passed' : 'source rejected'}</summary>
							{#if generation.diagnostic}<p>{generation.diagnostic.message}</p><p class="run-muted">{generation.diagnostic.stage} · {generation.diagnostic.code}</p>{/if}
							{#if generation.retention === 'retained'}<pre>{generation.responseText}</pre>
							{:else}<p class="run-muted">Response text exceeded the retention size limit and was not saved.</p>{/if}
						</details>
					{/each}
				</details>
			{:else if trusted.usage.modelCalls > 0}
				<p class="run-muted">No identified generation response was retained for this run.</p>
			{/if}

			{#if trusted.files.length}
				<section class="run-files" aria-labelledby="run-files-title">
					<h4 id="run-files-title">Generated source</h4>
					{#each trusted.files as file (file.path)}
						<details>
							<summary>{file.path}</summary>
							<WornButton type="button" size="sm" onclick={() => downloadSource(file)}>Download as text</WornButton>
							<pre>{file.content}</pre>
						</details>
					{/each}
				</section>
			{/if}
			{/if}
			</div>
		</details>
		{#if !readOnly}<WornButton type="button" disabled={Boolean(busy) || evidenceDirty || evidenceBusy} onclick={refreshResult}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh saved run'}</WornButton>{/if}
		{/if}
	</section>
	{/if}
	<section class="review-step decision-step" id={sectionIds.decision} aria-labelledby={`${sectionIds.decision}-title`} data-run-decision data-review-pane="review" hidden={narrow && ready && activeView !== 'review'}>
		<h3 id={`${sectionIds.decision}-title`} tabindex="-1"><span id={!reference ? sectionIds.evidence : undefined}>{reference ? '4 · Decision' : 'Your decision'}</span></h3>
		{#if reference}
		<h4>{review.decision.title}</h4>
		<p class="run-muted">Task: {pack.status || 'not set'}{pack.archived ? ' · archived' : ''} · {pack.completionEvidence?.trim() ? 'Evidence saved' : 'No evidence saved'}</p>
		<details class="decision-context"><summary>Decision context</summary><p>{review.decision.description}</p></details>
		{:else if readOnly}
			<p class="run-muted">This task is {pack.archived ? 'archived' : 'complete'}. Its saved evidence is read only.</p>
		{/if}
		{#if navigationNotice}<WornAlert tone="warning">{navigationNotice}</WornAlert>{/if}
		<NebiusProjectEvidence {pack} packs={$demoState?.packs ?? []} />
		{#if ready && !readOnly}<WornButton type="button" disabled={Boolean(busy) || !currentTaskMatches || Boolean(integrityError) || evidenceDirty || evidenceBusy || Boolean(pack.archived) || pack.status === 'done'} onclick={saveEvidence}>{busy === 'save' ? 'Saving…' : 'Use run as evidence'}</WornButton>{/if}
		<!-- Keep this editor mounted when another tab adds or removes the same task's run. -->
		{#key pack.id}<NebiusEvidenceReview {pack} decisionOnly expanded={!reference} disabled={readOnly || Boolean(busy) || Boolean(pack.archived) || pack.status === 'done'} onstate={({ dirty, busy: saving }) => { evidenceDirty = dirty; evidenceBusy = saving; }} />{/key}
		{#if reference}<WornButton data-nebius-context-navigation href={`/next?pack=${encodeURIComponent(pack.id)}`} onclick={editTask}>{readOnly ? 'View brief' : 'Edit task'}</WornButton>{/if}
	</section>
	</div>
</section>

<style>
	.run-review { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); margin-bottom: 16px; min-inline-size: 0; }
	.task-criteria :global([data-current-full-criteria]) { line-height: 1.6; margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
	.run-review-status { align-items: center; display: flex; flex-wrap: wrap; gap: .25rem .5rem; min-inline-size: 0; }
	.run-review-status a { align-content: center; color: var(--worn-link); font-size: .875rem; min-block-size: 44px; overflow-wrap: anywhere; text-underline-offset: .2em; }
	.run-review-status a:focus-visible, .review-step > h3:focus-visible { outline: 2px dashed var(--worn-focus); outline-offset: 3px; }
	.run-review-status > span { color: var(--worn-text-muted); }
	.review-view-switch { background: var(--worn-surface); border-block-end: 1px solid var(--worn-border); display: flex; gap: .5rem; padding-block: .5rem; position: sticky; top: 0; z-index: 5; }
	.review-view-switch :global(.worn-btn) { flex: 1; min-block-size: 44px; }
	.review-view-switch[hidden], .review-body > .review-step[hidden] { display: none; }
	.review-body { align-items: start; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); min-inline-size: 0; }
	.review-step { align-content: start; border-block-start: 1px solid var(--worn-border); display: grid; gap: 8px; min-inline-size: 0; padding-block: 12px; scroll-margin-block-start: 1rem; }
	.review-step.task-criteria { border-block-start: 0; padding-block-start: 0; }
	.review-step > p { line-height: 1.55; margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
	.review-step > :global(.worn-btn) { justify-self: start; max-inline-size: 100%; white-space: normal; }
	.review-step h3 { font-size: 1.05rem; }
	.decision-step { border-color: var(--worn-border-strong); }
	.request-drift, .field-change-label { color: var(--worn-warning, var(--worn-text)); }
	.request-fields { display: grid; gap: 1rem; padding-block: .75rem; }
	.request-change-list { display: grid; gap: 1rem; padding-block: .5rem; }
	.request-change { min-inline-size: 0; }
	.request-change h4 { font-size: .9rem; }
	.request-change dl { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: .5rem 0 0; }
	.request-change dl > div { border-inline-start: 1px solid var(--worn-field-border); min-inline-size: 0; padding-inline-start: .75rem; }
	.run-review .request-change dt { color: var(--worn-text); font-size: .8rem; font-weight: 650; margin-block-end: .35rem; }
	.request-change dd { font-size: .875rem; line-height: 1.5; white-space: pre-wrap; }
	@media (max-width: 600px) { .request-change dl { grid-template-columns: minmax(0, 1fr); } }
	.request-field { min-inline-size: 0; }
	.request-field h4 { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; font-size: .9rem; }
	.field-change-label { background: var(--worn-bg-secondary); border: 1px solid currentColor; border-radius: var(--worn-radius-sm); font-size: .75rem; font-weight: 600; line-height: 1.4; padding: .1rem .4rem; white-space: nowrap; }
	.request-field dl { display: grid; gap: .75rem; grid-template-columns: minmax(0, 1fr); margin: .5rem 0 0; }
	.request-field dl.has-change { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.request-field dl > div { border-inline-start: 1px solid var(--worn-border); min-inline-size: 0; padding: .25rem .75rem; }
	.request-field.changed dl > div { border-color: var(--worn-border-strong); }
	.request-field dt { font-size: .8125rem; margin-block-end: .375rem; }
	.request-field dd { font-size: .9375rem; line-height: 1.6; white-space: pre-wrap; }
	.run-try { align-items: center; display: flex; flex-wrap: wrap; gap: .5rem; }
	.run-try :global(.worn-btn) { min-block-size: 44px; }
	.run-artifact { min-inline-size: 0; }
	.run-artifact-intro { align-items: start; display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; text-align: start; }
	.run-artifact-title { max-inline-size: 58ch; min-inline-size: 0; }
	.run-artifact-prompt { font-size: 1rem; font-weight: 650; line-height: 1.4; margin: 0; overflow-wrap: anywhere; }
	.run-artifact-title .run-muted { margin: .35rem 0 0; }
	.preview-is-open .run-artifact-intro { padding-block-end: .75rem; }
	.run-review-head { align-items: start; justify-items: start; border-block-end: 1px solid var(--worn-border); display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) max-content; min-inline-size: 0; padding-block: 0 12px; }
	.has-tool .run-review-head h2 { font-size: clamp(1.4rem, 2.6vw, 2rem); line-height: 1.2; overflow-wrap: anywhere; }
	.run-review-head > div { min-inline-size: 0; }
	.run-review-head h2, .run-review-id, .run-checks > p { margin: 0; }
	.run-review-kicker { color: var(--worn-text-muted); font-family: var(--font-typewriter); font-size: 11px; font-weight: 700; letter-spacing: .04em; margin: 0 0 3px; text-transform: uppercase; }
	.run-review-id, .run-muted { color: var(--worn-text-muted); font-size: .875rem; overflow-wrap: anywhere; }
	.run-review-facts { display: grid; gap: 8px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.run-review-facts div { display: grid; gap: 3px; padding-block: .5rem; }
	.run-review-facts span { color: var(--worn-text-muted); font-size: .75rem; line-height: 1.5; }
	.run-review-facts strong { overflow-wrap: anywhere; }
	.run-checks, .run-files { border-top: 1px solid var(--worn-border); display: grid; gap: 9px; padding-top: 12px; }
	.run-review h3, .run-review h4, .run-review h5 { margin: 0; }
	.run-checks > h4, .run-files > h4 { font-size: .9375rem; }
	.run-output > h5 { font-size: .8125rem; }
	.run-review details { min-inline-size: 0; }
	.evidence-origin { font-size: .875rem; font-weight: 650; }
	.evidence-explanation { display: grid; gap: .875rem; margin: 0; }
	.evidence-explanation > div { display: grid; gap: .375rem 1rem; grid-template-columns: minmax(8rem, .7fr) minmax(0, 2fr); }
	.run-review .evidence-explanation dt { color: var(--worn-text); font-weight: 700; }
	.evidence-explanation dd { color: var(--worn-text); line-height: 1.5; }
	.run-review details > p { line-height: 1.5; margin-block: .5rem 0; }
	.run-review details.run-details { background: transparent; border-top: 1px solid var(--worn-border); padding: 16px 0 0; }
	.run-details-body { display: grid; gap: 16px; padding-block-start: 16px; }
	.run-details-counts { color: var(--worn-text-muted); display: block; font-size: .8rem; font-weight: 400; margin-block-start: 4px; }
	.run-review summary { align-content: center; cursor: pointer; font-weight: 650; min-block-size: 44px; overflow-wrap: anywhere; }
	.run-review summary:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	/* Sibling disclosures share one treatment while keeping their native behavior. */
	.decision-step > .decision-context, .decision-step > :global([data-nebius-evidence-review]) { background: transparent; border: 1px solid var(--worn-border); border-radius: var(--worn-radius); margin: 0; min-inline-size: 0; padding: 8px 12px; }
	.decision-step > .decision-context > summary, .decision-step > :global([data-nebius-evidence-review] > summary) { align-content: center; box-sizing: border-box; cursor: pointer; font-weight: 700; line-height: 1.5; min-block-size: 44px; overflow-wrap: anywhere; padding-block: .5rem; }
	.decision-step > .decision-context > summary:focus-visible, .decision-step > :global([data-nebius-evidence-review] > summary:focus-visible) { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	/* An ordinary task has one evidence editor, without saved-run context siblings. */
	.review-body:has(> .task-criteria) > .decision-step > :global([data-nebius-evidence-review]) { border: 0; border-radius: 0; padding: 0; }
	.run-review pre { background: var(--worn-bg); font-size: .8125rem; line-height: 1.6; margin-block: .5rem 0; max-height: 360px; min-inline-size: 0; overflow: auto; overflow-wrap: anywhere; padding: 12px; white-space: pre-wrap; }
	.run-output { display: grid; gap: .5rem; margin-block-start: 1rem; min-inline-size: 0; }
	.run-output > pre { margin: 0; }
	.run-details-body > .run-muted { line-height: 1.5; margin: 0; }
	.run-details dl { display: grid; gap: 4px 10px; grid-template-columns: max-content minmax(0, 1fr); }
	.run-review dt { color: var(--worn-text-muted); }
	.run-review dd { margin: 0; overflow-wrap: anywhere; }
	.run-preview-shell { border: 1px solid var(--worn-field-border); border-radius: var(--worn-radius-sm); display: grid; min-inline-size: 0; }
	.run-preview-label { color: var(--worn-text-muted); font-size: 12px; font-weight: 700; margin: 4px 0 0; }
	.run-preview-shell iframe { background: white; border: 0; border-radius: var(--worn-radius-sm); height: clamp(480px, 65vh, 760px); width: 100%; }
	@media (max-width: 760px) { .run-review-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (min-width: 1000px) {
		.review-body.has-tool { column-gap: 24px; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); grid-template-areas: 'preview request' 'preview evidence' 'preview decision'; }
		.has-tool > .request-step { grid-area: request; }
		.has-tool > .tool-step { align-self: start; grid-area: preview; position: sticky; top: 1rem; }
		.has-tool > .evidence-step { grid-area: evidence; }
		.has-tool > .decision-step { grid-area: decision; }
		.run-preview-shell iframe { height: clamp(260px, calc(100dvh - 15rem), 640px); }
	}
	@media (min-width: 1000px) and (max-height: 480px) { .has-tool > .tool-step { position: static; } }
	@media (max-width: 999px) { .has-tool > .review-step { scroll-margin-block-start: 4.5rem; } }
	@media (max-width: 480px) { .review-step { padding-block: 1rem; } .request-field dl.has-change, .evidence-explanation > div { grid-template-columns: minmax(0, 1fr); } .run-review-head { grid-template-columns: minmax(0, 1fr); } .run-review-facts > div:nth-child(-n+2) { grid-column: 1 / -1; } .run-try, .run-try :global(.worn-btn) { width: 100%; } .preview-is-open .run-artifact-intro { align-items: stretch; flex-direction: column; gap: 12px; } .run-preview-shell iframe { height: 65vh; min-height: 420px; } }
</style>
