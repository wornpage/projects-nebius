<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { WornAlert, WornBadge, WornButton, WornTimeline } from '$lib/components';
	import {
		buildExecutionRunInput,
		ChallengeStateError,
		clearUnsentExecutionRunReference,
		executionRunMatchesCurrentTask,
		reserveExecutionRunReference,
		saveExecutionRunRecord
	} from '$lib/demo-client';
	import type { DemoPack } from '$lib/demo-workflow';
	import {
		cancelRun,
		createRunCredentials,
		getRunConfig,
		NebiusRunClientError,
		readRun,
		startRun,
		type RunConfigState
	} from '$lib/nebius-execution-client';
	import { TERMINAL_RUN_STATUSES, type RunConfig, type RunInput } from '$lib/nebius-execution-contract.mjs';

	type Props = { pack: DemoPack; disabled?: boolean; disabledReason?: string };
	let { pack, disabled = false, disabledReason = '' }: Props = $props();

	let configState = $state<'loading' | 'available' | 'unavailable' | 'error'>('loading');
	let config = $state<RunConfig | null>(null);
	let configMessage = $state('');
	let requestBusy = $state(false);
	let requestLabel = $state('');
	let error = $state('');
	let notice = $state('');
	let disposed = false;
	let active: AbortController | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	let reference = $derived(pack.executionRun || null);
	let record = $derived(reference?.record || null);
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
	let resumeDisabled = $derived(requestBusy || disabled || configState !== 'available' || !reference || Boolean(record) || !executionRunMatchesCurrentTask(pack, reference));
	let statusLabel = $derived(record
		? record.status.charAt(0).toUpperCase() + record.status.slice(1)
		: reference ? 'Uncertain' : configState === 'unavailable' ? 'Preview only' : 'Not started');
	let latestEvent = $derived(record?.events.at(-1)?.message || (reference && !record ? 'The start response is unknown. Refresh or explicitly resume this saved request.' : ''));
	let runEvents = $derived((record?.events ?? []).slice().reverse().map(event => ({ date: event.at, title: event.message })));

	function clearPolling() {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = null;
	}

	function scheduleRefresh(runId: string, runKey: string) {
		clearPolling();
		if (disposed) return;
		pollTimer = setTimeout(() => void refreshKnownRun({ runId, runKey, quiet: true }), 1800);
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
		if (saved && !TERMINAL_RUN_STATUSES.includes(saved.status)) scheduleRefresh(runId, runKey);
	}

	async function refreshKnownRun(options: { runId?: string; runKey?: string; quiet?: boolean } = {}) {
		const runId = options.runId || reference?.id;
		const runKey = options.runKey || reference?.key;
		if (!runId || !runKey || requestBusy || disposed) return;
		const capturedPackId = pack.id;
		clearPolling();
		if (!options.quiet) {
			requestBusy = true;
			requestLabel = 'Refreshing…';
			error = '';
			notice = '';
		}
		try {
			const next = await readRun(runId, runKey, capturedPackId);
			if (disposed || pack.id !== capturedPackId) return;
			await applyRecord(runId, runKey, next);
		} catch (cause) {
			if (!disposed) error = cause instanceof Error ? cause.message : 'The saved run could not be refreshed.';
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
			} else if (cause instanceof NebiusRunClientError && cause.uncertain) notice = cause.message;
			else error = cause instanceof ChallengeStateError || cause instanceof Error ? cause.message : 'The task execution could not be started.';
		} finally {
			if (!disposed) {
				requestBusy = false;
				requestLabel = '';
			}
		}
	}

	async function resumeSavedRequest() {
		if (resumeDisabled || !reference || reference.record) return;
		const capturedPackId = pack.id;
		const { id, key } = reference;
		const input = structuredClone(reference.input);
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
			} else if (cause instanceof NebiusRunClientError && cause.uncertain) notice = cause.message;
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
		clearPolling();
	});
</script>

<section id="nebius-task-run" class="task-run" aria-labelledby="task-run-title" data-nebius-task-run>
	<div class="task-run-head">
		<div>
			<p class="task-run-kicker">Nebius Sandbox</p>
			<h2 id="task-run-title">Build a tool</h2>
		</div>
		<WornBadge label={statusLabel} variant={record?.status === 'ready' ? 'accent' : record?.status === 'failed' || record?.status === 'uncertain' ? 'warn' : undefined} />
	</div>
	<p class="task-run-scope">{configState === 'available' ? 'Turn this task into a small browser tool. Nemotron generates the files, Nebius Sandbox runs the checks, and you review the result.' : 'Preview how this task can become a browser tool: generate files with Nemotron, run checks in Nebius Sandbox, then review the result.'}</p>
	<ol class="task-run-stages" aria-label="How a task run works">
		<li><span aria-hidden="true">1</span><div><strong>Build</strong><small>Generate the tool files</small></div></li>
		<li><span aria-hidden="true">2</span><div><strong>Check</strong><small>Run checks, with one repair</small></div></li>
		<li><span aria-hidden="true">3</span><div><strong>Review</strong><small>Preview and decide what to keep</small></div></li>
	</ol>
	<p class="task-run-muted">Checks are written by the model. You decide whether to save evidence or mark the task done.</p>
	{#if configState === 'unavailable' && !reference}
		<p class="task-run-muted"><strong>Preview only — execution disabled.</strong> No tool or Sandbox result has been generated for this task.</p>
		<details class="task-run-input">
			<summary>What Sandbox will do</summary>
			<p>Run the generated tool's Node checks in an isolated Nebius Sandbox. If a check fails, the workflow allows one repair and another check. Return the files and recorded check output for your review.</p>
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
		<div class="task-run-progress" aria-live="polite">
			<span>Run {reference.id}</span>
			<strong>{requestLabel || statusLabel}</strong>
			{#if latestEvent}<p>{latestEvent}</p>{/if}
		</div>
		{#if runEvents.length}
			<details class="task-run-history">
				<summary>Run activity · {runEvents.length} {runEvents.length === 1 ? 'event' : 'events'}</summary>
				<WornTimeline entries={runEvents} ariaLabel="Recorded sandbox run activity, newest first" headingLevel={3} density="compact" formatDate={(date) => new Date(date).toLocaleString()} />
			</details>
		{/if}
	{/if}

	<div class="task-run-actions">
		<WornButton type="button" variant="primary" disabled={startDisabled} onclick={runTask}>{requestLabel === 'Starting…' ? requestLabel : 'Run this task'}</WornButton>
		{#if reference && (!record || !terminal)}
			<WornButton type="button" disabled={requestBusy} onclick={() => refreshKnownRun()}>{requestLabel === 'Refreshing…' ? requestLabel : 'Refresh saved run'}</WornButton>
			{#if !record}<WornButton type="button" disabled={resumeDisabled} onclick={resumeSavedRequest}>{requestLabel === 'Resuming…' ? requestLabel : 'Resume saved request'}</WornButton>{/if}
			<WornButton type="button" disabled={requestBusy} onclick={cancelCurrentRun}>{requestLabel === 'Cancelling…' ? requestLabel : 'Cancel'}</WornButton>
		{/if}
		{#if record?.status === 'ready'}
			<WornButton href={`/review?focus=${encodeURIComponent(pack.id)}`}>Review result</WornButton>
		{/if}
	</div>
</section>

<style>
	.task-run { border: 1px solid var(--worn-border); border-radius: var(--worn-radius); display: grid; gap: 16px; min-inline-size: 0; padding: 16px; }
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
	.task-run-input summary { cursor: pointer; font-weight: 650; }
	.task-run-input pre { background: var(--worn-bg-secondary); font-size: 12px; max-height: 320px; overflow: auto; padding: 12px; white-space: pre-wrap; }
	.task-run-blocked { color: var(--worn-text-secondary); font-size: .875rem; margin: 0; }
	.task-run-progress { background: var(--worn-bg-secondary); display: grid; gap: 4px; padding: 12px; }
	.task-run-progress span { overflow-wrap: anywhere; }
	.task-run-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
	@media (max-width: 1100px) { .task-run-stages { grid-template-columns: 1fr; } }
	@media (max-width: 560px) { .task-run-facts { grid-template-columns: 1fr; } .task-run-actions :global(.worn-btn) { width: 100%; } }
</style>
