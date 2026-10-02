<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { WornAlert, WornBadge, WornButton, WornDialog, WornTimeline } from '$lib/components';
	import {
		buildExecutionRunInput,
		ChallengeStateError,
		clearUnsentExecutionRunReference,
		executionRunMatchesCurrentTask,
		reserveExecutionRunReference,
		retireUnavailableLegacyExecutionRun,
		saveExecutionRunRecord
	} from '$lib/demo-client';
	import type { DemoExecutionRunReference, DemoPack } from '$lib/demo-workflow';
	import {
		cancelRun,
		createRunCredentials,
		getRunConfig,
		NebiusRunClientError,
		readRun,
		startRun,
		type RunConfigState
	} from '$lib/nebius-execution-client';
	import { RUN_VERSION, TERMINAL_RUN_STATUSES, type RunConfig, type RunInput } from '$lib/nebius-execution-contract.mjs';

	type Props = { pack: DemoPack; disabled?: boolean; disabledReason?: string; onEditInputs?: () => void };
	let { pack, disabled = false, disabledReason = '', onEditInputs }: Props = $props();

	let configState = $state<'loading' | 'available' | 'unavailable' | 'error'>('loading');
	let config = $state<RunConfig | null>(null);
	let configMessage = $state('');
	let requestBusy = $state(false);
	let requestLabel = $state('');
	let error = $state('');
	let notice = $state('');
	let notFoundReference = $state<{ id: string; key: string } | null>(null);
	let retirementOpen = $state(false);
	let reviewedRetirement = $state.raw<DemoExecutionRunReference | null>(null);
	let retirementRequest: AbortController | null = null;
	let disposed = false;
	let actionRevision = 0;
	let active: AbortController | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	let reference = $derived(pack.executionRun || null);
	let record = $derived(reference?.record || null);
	let runMatchesTask = $derived(Boolean(reference && executionRunMatchesCurrentTask(pack, reference)));
	let terminal = $derived(Boolean(record && TERMINAL_RUN_STATUSES.includes(record.status)));
	let inputPreview = $derived.by((): RunInput | null => {
		if (config) {
			try { return buildExecutionRunInput(pack, config.requestedModel); } catch { return null; }
		}
		return reference?.input || null;
	});
	let eligibilityError = $derived.by(() => {
		if (disabled) return disabledReason || 'Finish the current task change before running this task.';
		if (!config) return '';
		try { buildExecutionRunInput(pack, config.requestedModel); return ''; }
		catch (cause) { return cause instanceof Error ? cause.message : 'This task cannot be run yet.'; }
	});
	let currentRunBlocksStart = $derived(Boolean(reference && (!record || !terminal)));
	let startDisabled = $derived(requestBusy || configState !== 'available' || Boolean(eligibilityError) || currentRunBlocksStart);
	let resumeDisabled = $derived(requestBusy || disabled || configState !== 'available' || !reference || reference.input.version !== RUN_VERSION || Boolean(record) || !runMatchesTask);
	let canReviewRetirement = $derived(Boolean(reference && !record && reference.input.version === 'browser-tool.v1' &&
		notFoundReference?.id === reference.id && notFoundReference.key === reference.key));
	let statusLabel = $derived(record && !runMatchesTask ? 'Earlier result' : record
		? record.status.charAt(0).toUpperCase() + record.status.slice(1)
		: reference ? 'Uncertain' : configState === 'unavailable' ? 'Preview only' : 'Not started');
	let latestEvent = $derived(record?.events.at(-1)?.message || (reference && !record ? reference.input.version === RUN_VERSION
		? 'The start response is unknown. Refresh or explicitly resume this saved request.'
		: 'The outcome is unknown. Refresh this historical request; its old input cannot start a new run.' : ''));
	let runEvents = $derived((record?.events ?? []).slice().reverse().map(event => ({ date: event.at, title: event.message })));

	function clearPolling() {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = null;
	}

	function isCurrentRun(packId: string, runId: string, runKey: string) {
		return !disposed && pack.id === packId && reference?.id === runId && reference.key === runKey;
	}

	function scheduleRefresh(packId: string, runId: string, runKey: string, uncertaintyNotice?: string) {
		clearPolling();
		if (disposed) return;
		pollTimer = setTimeout(() => void refreshKnownRun({ packId, runId, runKey, quiet: true, uncertaintyNotice }), 1800);
	}

	async function loadConfig() {
		active?.abort();
		const controller = new AbortController();
		active = controller;
		configState = 'loading';
		configMessage = '';
		try {
			const result: RunConfigState = await getRunConfig(controller.signal);
			if (disposed || controller.signal.aborted) return;
			if (result.available) {
				config = result.config;
				configState = 'available';
			} else {
				config = null;
				configMessage = result.message;
				configState = 'unavailable';
			}
		} catch (cause) {
			if (controller.signal.aborted) return;
			config = null;
			configMessage = cause instanceof Error ? cause.message : 'Task execution availability could not be checked.';
			configState = 'error';
		}
	}

	async function applyRecord(runId: string, runKey: string, value: unknown) {
		const capturedPackId = pack.id;
		const savedPack = await saveExecutionRunRecord(capturedPackId, runId, runKey, value);
		if (disposed || pack.id !== capturedPackId || savedPack.executionRun?.id !== runId) return;
		const saved = savedPack.executionRun.record;
		if (saved && !TERMINAL_RUN_STATUSES.includes(saved.status)) scheduleRefresh(capturedPackId, runId, runKey);
	}

	async function refreshKnownRun(options: { packId?: string; runId?: string; runKey?: string; quiet?: boolean; uncertaintyNotice?: string } = {}) {
		const capturedPackId = options.packId || pack.id;
		const runId = options.runId || reference?.id;
		const runKey = options.runKey || reference?.key;
		if (!runId || !runKey || requestBusy || !isCurrentRun(capturedPackId, runId, runKey)) return;
		clearPolling();
		const capturedActionRevision = options.quiet ? actionRevision : ++actionRevision;
		if (!options.quiet) {
			requestBusy = true;
			requestLabel = 'Refreshing…';
			error = '';
			notice = '';
		}
		try {
			const next = await readRun(runId, runKey, capturedPackId);
			if (!isCurrentRun(capturedPackId, runId, runKey)) return;
			notFoundReference = null;
			await applyRecord(runId, runKey, next);
			if (isCurrentRun(capturedPackId, runId, runKey) && actionRevision === capturedActionRevision
				&& options.uncertaintyNotice !== undefined && notice === options.uncertaintyNotice) {
				notice = '';
			}
		} catch (cause) {
			if (isCurrentRun(capturedPackId, runId, runKey) && actionRevision === capturedActionRevision) {
				notFoundReference = cause instanceof NebiusRunClientError && cause.status === 404 && cause.code === 'not_found'
					? { id: runId, key: runKey } : null;
				error = cause instanceof Error ? cause.message : 'The saved run could not be refreshed.';
			}
		} finally {
			if (!options.quiet && !disposed) {
				requestBusy = false;
				requestLabel = '';
			}
		}
	}

	async function runTask() {
		if (startDisabled || !config) return;
		const capturedPackId = pack.id;
		let input: RunInput;
		try {
			input = buildExecutionRunInput(pack, config.requestedModel);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'This task cannot be run yet.';
			return;
		}
		const credentials = createRunCredentials();
		actionRevision += 1;
		requestBusy = true;
		requestLabel = 'Starting…';
		error = '';
		notice = '';
		try {
			const reserved = await reserveExecutionRunReference(capturedPackId, { ...credentials, input, record: null });
			if (disposed || pack.id !== capturedPackId || reserved.executionRun?.id !== credentials.id) {
				try { await clearUnsentExecutionRunReference(capturedPackId, credentials.id, credentials.key, input); }
				catch (clearError) { console.warn('Could not clear an unsent task execution reservation:', clearError); }
				return;
			}
			const started = await startRun(credentials.id, credentials.key, input);
			if (disposed || pack.id !== capturedPackId) return;
			await applyRecord(credentials.id, credentials.key, started);
		} catch (cause) {
			if (disposed) return;
			if (cause instanceof NebiusRunClientError && cause.definitiveStartRejection) {
				try { await clearUnsentExecutionRunReference(capturedPackId, credentials.id, credentials.key, input); }
				catch (clearError) {
					error = clearError instanceof Error ? `${cause.message} ${clearError.message}` : cause.message;
					return;
				}
				error = cause.message;
			} else if (cause instanceof NebiusRunClientError && cause.uncertain) {
				notice = cause.message;
				if (pack.id === capturedPackId) scheduleRefresh(capturedPackId, credentials.id, credentials.key, cause.message);
			}
			else error = cause instanceof ChallengeStateError || cause instanceof Error ? cause.message : 'The task execution could not be started.';
		} finally {
			if (!disposed) {
				requestBusy = false;
				requestLabel = '';
			}
		}
	}

	function reviewLocalRetirement() {
		if (disabled || requestBusy || !canReviewRetirement || !reference) return;
		reviewedRetirement = structuredClone(reference);
		retirementOpen = true;
	}

	async function confirmLocalRetirement() {
		if (disabled || requestBusy || !retirementOpen || !reviewedRetirement) return;
		const capturedPackId = pack.id;
		const reviewed = structuredClone(reviewedRetirement);
		if (!isCurrentRun(capturedPackId, reviewed.id, reviewed.key)) return;
		const controller = new AbortController();
		retirementRequest = controller;
		actionRevision += 1;
		requestBusy = true;
		requestLabel = 'Verifying retirement…';
		error = '';
		notice = '';
		clearPolling();
		try {
			await retireUnavailableLegacyExecutionRun(capturedPackId, reviewed, true, controller.signal);
			if (disposed || pack.id !== capturedPackId) return;
			notFoundReference = null;
			retirementOpen = false;
			reviewedRetirement = null;
			notice = 'Local reference retired. The original request is preserved below; its outcome remains unknown.';
			await tick();
			document.getElementById('nebius-task-run')?.focus();
		} catch (cause) {
			if (disposed || controller.signal.aborted) return;
			error = cause instanceof Error ? cause.message : 'The historical request could not be retired locally.';
		} finally {
			if (!disposed) {
				requestBusy = false;
				requestLabel = '';
			}
			if (retirementRequest === controller) retirementRequest = null;
		}
	}

	async function resumeSavedRequest() {
		if (resumeDisabled || !reference || reference.record) return;
		const capturedPackId = pack.id;
		const { id, key } = reference;
		const input = structuredClone(reference.input);
		actionRevision += 1;
		requestBusy = true;
		requestLabel = 'Resuming…';
		error = '';
		notice = '';
		try {
			const started = await startRun(id, key, input);
			if (disposed || pack.id !== capturedPackId) return;
			await applyRecord(id, key, started);
		} catch (cause) {
			if (disposed) return;
			if (cause instanceof NebiusRunClientError && cause.definitiveStartRejection) {
				try { await clearUnsentExecutionRunReference(capturedPackId, id, key, input); }
				catch (clearError) {
					error = clearError instanceof Error ? `${cause.message} ${clearError.message}` : cause.message;
					return;
				}
				error = cause.message;
			} else if (cause instanceof NebiusRunClientError && cause.uncertain) {
				notice = cause.message;
				if (pack.id === capturedPackId) scheduleRefresh(capturedPackId, id, key, cause.message);
			}
			else error = cause instanceof Error ? cause.message : 'The saved task request could not be resumed.';
		} finally {
			if (!disposed) {
				requestBusy = false;
				requestLabel = '';
			}
		}
	}

	async function cancelCurrentRun() {
		if (!reference || terminal || requestBusy) return;
		const { id, key } = reference;
		const capturedPackId = pack.id;
		actionRevision += 1;
		requestBusy = true;
		requestLabel = 'Cancelling…';
		error = '';
		notice = '';
		clearPolling();
		try {
			const cancelled = await cancelRun(id, key, capturedPackId);
			if (disposed || pack.id !== capturedPackId) return;
			await applyRecord(id, key, cancelled);
		} catch (cause) {
			if (disposed) return;
			if (cause instanceof NebiusRunClientError && cause.uncertain) notice = cause.message;
			else error = cause instanceof Error ? cause.message : 'The cancellation request failed.';
		} finally {
			if (!disposed) {
				requestBusy = false;
				requestLabel = '';
			}
		}
	}

	onMount(() => {
		void loadConfig();
		if (reference && (!record || !terminal)) void refreshKnownRun({ quiet: true });
	});

	onDestroy(() => {
		disposed = true;
		active?.abort();
		retirementRequest?.abort();
		clearPolling();
	});
</script>

<section id="nebius-task-run" class="task-run" aria-labelledby="task-run-title" tabindex="-1" data-nebius-task-run>
	<div class="task-run-head">
		<div>
			<p class="task-run-kicker">Nebius Sandbox</p>
			<h2 id="task-run-title">Build a tool</h2>
		</div>
		<WornBadge label={statusLabel} variant={runMatchesTask && record?.status === 'ready' ? 'accent' : runMatchesTask && (record?.status === 'failed' || record?.status === 'uncertain') ? 'warn' : undefined} />
	</div>
	<p class="task-run-scope">{configState === 'available' ? 'Turn this task into a small browser tool. Nemotron generates the files, Nebius Sandbox runs the checks, and you review the result.' : 'Preview how this task can become a browser tool: generate files with Nemotron, run checks in Nebius Sandbox, then review the result.'}</p>
	<ol class="task-run-stages" aria-label="How a task run works">
		<li><span aria-hidden="true">1</span><div><strong>Build</strong><small>Generate the tool files</small></div></li>
		<li><span aria-hidden="true">2</span><div><strong>Check</strong><small>One repair if needed</small></div></li>
		<li><span aria-hidden="true">3</span><div><strong>Review</strong><small>Preview and decide what to keep</small></div></li>
	</ol>
	<p class="task-run-muted">Checks are written by the model. You decide whether to save evidence or mark the task done.</p>
	<details class="task-run-input" data-run-input-requirements>
		<summary>Task input requirements</summary>
		{#if pack.executionInputs == null}<p>Formats are not specified by this task. The model chooses them.</p>
		{:else if !pack.executionInputs.length}<p>This tool must have no text inputs.</p>
		{:else}<ul>{#each pack.executionInputs as input (input.id)}<li><code>{input.id}</code>: {input.format === 'json' ? 'JSON' : 'plain text'}</li>{/each}</ul><p>The generated tool must use these exact inputs and formats.</p>{/if}
		{#if onEditInputs}<WornButton type="button" size="sm" disabled={disabled || requestBusy || currentRunBlocksStart || pack.status === 'done' || Boolean(pack.archived)} onclick={onEditInputs}>Edit task inputs</WornButton>{/if}
	</details>
	{#if configState === 'unavailable' && !reference}
		<p class="task-run-muted"><strong>Preview only — execution disabled.</strong> No current tool or Sandbox result is saved for this task.</p>
		<details class="task-run-input">
			<summary>What Sandbox will do</summary>
			<p>Validate the generated files, then run their Node checks in an isolated Nebius Sandbox. One source or check failure can be repaired within the two-call limit. Review the files, responses and check output afterward.</p>
			<p>Example use: build a release checklist that flags missing health, reviewer and rollback evidence. This is a proposed use, not an executed result.</p>
		</details>
	{/if}

	{#if configState === 'loading'}
		<p class="task-run-muted" role="status">Checking whether task execution is configured…</p>
	{:else if configState === 'unavailable' || configState === 'error'}
		<WornAlert tone={configState === 'error' ? 'danger' : 'info'}>{configMessage || 'Task execution is not configured here.'}</WornAlert>
		<WornButton type="button" size="sm" onclick={loadConfig}>Retry availability check</WornButton>
	{:else if config}
		<div class="task-run-facts" aria-label="Task execution limits">
			<div><span>Configured model</span><strong>{config.requestedModel}</strong></div>
			<div><span>Model calls</span><strong>At most {config.limits.maxModelCalls}</strong></div>
			<div><span>Sandbox checks</span><strong>At most {config.limits.maxSandboxRuns} × {config.limits.sandboxSeconds}s</strong></div>
			<div><span>Output per model call</span><strong>At most {config.limits.maxOutputTokens.toLocaleString()} tokens</strong></div>
		</div>
	{/if}

	<details class="task-run-input">
		<summary>Input and limits</summary>
		<p>Selected context: none. The task details shown below are the only task context authorized for this run.</p>
		{#if inputPreview}<pre>{JSON.stringify(inputPreview, null, 2)}</pre>{:else if configState === 'unavailable'}<p class="task-run-muted">The exact model, payload and run limits will appear when execution is enabled.</p>{:else}<p class="task-run-muted">Complete the task requirements to prepare an exact payload.</p>{/if}
	</details>

	{#if eligibilityError}<p class="task-run-blocked" role="status">{eligibilityError}</p>{/if}
	{#if notice}<WornAlert tone="warning">{notice}</WornAlert>{/if}
	{#if error || record?.error}<WornAlert tone="danger">{error || record?.error}</WornAlert>{/if}
	{#if reference}
		{#if reference.input.version !== RUN_VERSION}<p class="task-run-muted">This historical request has no task-owned input specification. {record ? 'Its saved result remains available.' : 'Its outcome is unknown.'} It cannot be restarted with the old request.</p>{/if}
		{#if record && !runMatchesTask}<p class="task-run-muted">This saved run used earlier task requirements. Review it as history; a new run is required for the current task.</p>{/if}
		<div class="task-run-progress" aria-live="polite">
			<span>Run {reference.id}</span>
			<strong>{requestLabel || record?.status || statusLabel}</strong>
			{#if latestEvent}<p>{latestEvent}</p>{/if}
		</div>
		{#if record}
			<details class="task-run-input" data-run-diagnostics>
				<summary>Run details and usage</summary>
				<p>{record.usage.modelCalls} of 2 model calls · {record.usage.inputTokens === null ? 'Unknown' : record.usage.inputTokens.toLocaleString()} recorded input tokens · {record.usage.outputTokens === null ? 'Unknown' : record.usage.outputTokens.toLocaleString()} recorded output tokens</p>
				{#if !record.usage.totalsComplete}<p>Usage is incomplete. These counts include only recorded usage; the actual total may be higher.</p>{/if}
				{#if record.failure}<p>Failure stage: {record.failure.stage.replaceAll('_', ' ')} · Code: <code>{record.failure.code}</code></p>{:else if record.error}<p>No structured failure details were recorded for this run.</p>{/if}
			</details>
		{/if}
		{#if runEvents.length}
			<details class="task-run-history">
				<summary>Run activity · {runEvents.length} {runEvents.length === 1 ? 'event' : 'events'}</summary>
				<WornTimeline entries={runEvents} ariaLabel="Recorded sandbox run activity, newest first" headingLevel={3} density="compact" formatDate={(date) => new Date(date).toLocaleString()} />
			</details>
		{/if}
	{/if}
	{#if pack.retiredExecutionRuns?.length}
		<details class="task-run-input" data-retired-run-history>
			<summary>Retired local requests · {pack.retiredExecutionRuns.length}</summary>
			<p>These requests had no server receipt when checked. Their outcomes remain unknown. The original snapshots are retained in your workspace backup.</p>
			{#each pack.retiredExecutionRuns as entry (entry.reference.id)}
				<details class="task-run-input">
					<summary>Run {entry.reference.id}</summary>
					<p>Retired locally {new Date(entry.retiredAt).toLocaleString()} · server receipt not found · outcome unknown</p>
					<pre>{JSON.stringify(entry.reference.input, null, 2)}</pre>
				</details>
			{/each}
		</details>
	{/if}

	<div class="task-run-actions">
		<WornButton type="button" variant="primary" disabled={startDisabled} onclick={runTask}>{requestLabel === 'Starting…' ? requestLabel : 'Run this task'}</WornButton>
		{#if reference && (!record || !terminal)}
			<WornButton type="button" disabled={requestBusy} onclick={() => refreshKnownRun()}>{requestLabel === 'Refreshing…' ? requestLabel : 'Refresh saved run'}</WornButton>
			{#if !record}<WornButton type="button" disabled={resumeDisabled} onclick={resumeSavedRequest}>{requestLabel === 'Resuming…' ? requestLabel : 'Resume saved request'}</WornButton>{/if}
			<WornButton type="button" disabled={requestBusy} onclick={cancelCurrentRun}>{requestLabel === 'Cancelling…' ? requestLabel : 'Cancel'}</WornButton>
			{#if canReviewRetirement}<WornButton type="button" disabled={disabled || requestBusy} onclick={reviewLocalRetirement}>Review local retirement</WornButton>{/if}
		{/if}
		{#if record?.status === 'ready'}
			<WornButton href={`/review?focus=${encodeURIComponent(pack.id)}`}>Review result</WornButton>
		{/if}
	</div>
</section>

<WornDialog bind:open={retirementOpen} title="Retire unavailable local request" size="sm" dismissible={!requestBusy} onclose={() => { reviewedRetirement = null; }}>
	{#if reviewedRetirement}
		<p>The server did not find run <code>{reviewedRetirement.id}</code>. Its outcome is unknown.</p>
		<p>Retiring releases this task's local reservation and preserves the original request in history. It does not confirm cancellation or start another run. The server is checked again before saving.</p>
		<details class="task-run-input"><summary>Original request snapshot</summary><pre>{JSON.stringify(reviewedRetirement.input, null, 2)}</pre></details>
		{#if error}<WornAlert tone="danger">{error}</WornAlert>{/if}
		<div class="task-run-actions">
			<WornButton type="button" disabled={requestBusy} onclick={() => { retirementOpen = false; reviewedRetirement = null; }}>Keep local reference</WornButton>
			<WornButton type="button" variant="primary" disabled={disabled || requestBusy} onclick={confirmLocalRetirement}>{requestBusy ? requestLabel : 'Confirm local retirement'}</WornButton>
		</div>
	{/if}
</WornDialog>

<style>
	.task-run { border: 1px solid var(--worn-border); border-radius: var(--worn-radius); display: grid; gap: 16px; min-inline-size: 0; padding: 16px; }
	.task-run:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.task-run-head { align-items: center; display: flex; gap: 12px; justify-content: space-between; }
	.task-run-head h2, .task-run-progress p, .task-run-scope, .task-run-input p { margin: 0; }
	.task-run-kicker { color: var(--worn-text-muted); font-family: var(--font-typewriter); font-size: 11px; font-weight: 700; letter-spacing: .04em; margin: 0 0 3px; text-transform: uppercase; }
	.task-run-scope, .task-run-input p, .task-run-muted { color: var(--worn-text-secondary); font-size: .9rem; line-height: 1.5; }
	.task-run-muted { margin: 0; }
	.task-run-stages { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; }
	.task-run-stages li { align-items: start; background: var(--worn-bg-secondary); border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); display: flex; gap: 8px; min-inline-size: 0; padding: 12px; }
	.task-run-stages li > span { align-items: center; border: 1px solid var(--worn-border-strong); border-radius: 50%; color: var(--worn-text-secondary); display: inline-flex; flex: 0 0 24px; font-size: .75rem; height: 24px; justify-content: center; }
	.task-run-stages strong, .task-run-stages small { display: block; overflow-wrap: anywhere; }
	.task-run-stages strong { font-size: .875rem; }
	.task-run-stages small { color: var(--worn-text-secondary); font-size: .75rem; line-height: 1.4; margin-block-start: 4px; }
	.task-run-history summary { align-content: center; cursor: pointer; font-size: .875rem; min-block-size: 44px; }
	.task-run-history summary:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.task-run-facts { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.task-run-facts div { background: var(--worn-bg-secondary); display: grid; gap: 2px; padding: 10px; }
	.task-run-facts span, .task-run-progress span { color: var(--worn-text-muted); font-size: 11px; }
	.task-run-facts strong { overflow-wrap: anywhere; }
	.task-run-input { border-top: 1px solid var(--worn-border); padding-top: 10px; }
	.task-run-input summary { cursor: pointer; font-weight: 650; overflow-wrap: anywhere; }
	.task-run-input pre { background: var(--worn-bg-secondary); font-size: 12px; max-height: 320px; overflow: auto; padding: 12px; white-space: pre-wrap; }
	.task-run-blocked { color: var(--worn-text-secondary); font-size: .875rem; margin: 0; }
	.task-run-progress { background: var(--worn-bg-secondary); display: grid; gap: 4px; padding: 12px; }
	.task-run-progress span { overflow-wrap: anywhere; }
	.task-run-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
	@media (max-width: 1100px) { .task-run-stages { grid-template-columns: 1fr; } }
	@media (max-width: 560px) { .task-run-facts { grid-template-columns: 1fr; } .task-run-actions :global(.worn-btn) { width: 100%; } }
</style>
