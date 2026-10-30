<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { WornAlert, WornBadge, WornButton, WornDialog, WornTimeline } from '$lib/components';
	import {
		buildExecutionRunInput,
		ChallengeStateError,
		clearUnsentExecutionRunReference,
		executionRunMatchesCurrentTask,
		reserveExecutionRunReference,
		retireUnavailableExecutionRun,
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
	import { RUN_VERSION, RUN_LIMITS, RUN_MODEL_TIMEOUT_MS, TERMINAL_RUN_STATUSES, validateRunIntegrity, type RunConfig, type RunInput, type RunRecord } from '$lib/nebius-execution-contract.mjs';
	import { projectTask } from '$lib/nebius-contract.mjs';
	import { taskRunReview } from '$lib/nebius-task-review.mjs';

	type Props = { pack: DemoPack; disabled?: boolean; disabledReason?: string; onEditInputs?: () => void; onEditOutputs?: () => void };
	type StageState = 'waiting' | 'active' | 'observed' | 'available' | 'unknown' | 'stopped';
	type RunStage = { id: 'source' | 'sandbox' | 'review'; title: string; state: StageState; detail: string };
	let { pack, disabled = false, disabledReason = '', onEditInputs, onEditOutputs }: Props = $props();

	let configState = $state<'loading' | 'available' | 'unavailable' | 'error'>('loading');
	let config = $state<RunConfig | null>(null);
	let configMessage = $state('');
	let requestBusy = $state(false);
	let requestLabel = $state('');
	let error = $state('');
	let notice = $state('');
	let configSessionRequired = $state(false);
	let runSessionGates = $state<Record<string, boolean>>({});
	let notFoundReference = $state<{ id: string; key: string } | null>(null);
	let retirementOpen = $state(false);
	let reviewedRetirement = $state.raw<DemoExecutionRunReference | null>(null);
	let retirementRequest: AbortController | null = null;
	let disposed = false;
	let actionRevision = 0;
	let active: AbortController | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	let reference = $derived(pack.executionRun || null);
	let currentSessionKey = $derived(JSON.stringify([pack.id, reference?.id || '']));
	let runSessionRequired = $derived(Boolean(runSessionGates[currentSessionKey]));
	let sessionRequired = $derived(configSessionRequired || runSessionRequired);
	let record = $derived(reference?.record || null);
	let runMatchesTask = $derived(Boolean(reference && executionRunMatchesCurrentTask(pack, reference)));
	let verified = $state<RunRecord | null>(null);
	let integrityError = $state('');
	let verificationRevision = 0;
	let verificationSignature: string | undefined;
	let recordSignature = $derived(reference ? JSON.stringify([reference.id, reference.key, reference.input, record]) : '');
	let runProjection = $derived(taskRunReview({ currentTask: projectTask(pack), currentInputFormats: pack.executionInputs ?? null,
		currentOutputs: pack.executionOutputs ?? null, reference, record, verified, integrityError,
		currentTaskMatches: runMatchesTask, taskStatus: pack.status || 'not set', completionEvidence: pack.completionEvidence || '', archived: Boolean(pack.archived) }));
	let verifiedRecord = $derived(['no-run', 'pending', 'verifying', 'invalid'].includes(runProjection.state) ? null : verified);
	let hasStoredRecord = $derived(Boolean(record));
	let authoredExample = $derived(runProjection.evidenceExplanation.authoredExample);
	$effect(() => {
		const signature = recordSignature;
		if (signature === verificationSignature) return;
		verificationSignature = signature;
		const candidate = record ? JSON.stringify(record) : '';
		const revision = ++verificationRevision;
		verified = null; integrityError = '';
		if (!candidate) return;
		void validateRunIntegrity(JSON.parse(candidate)).then(result => {
			if (!disposed && revision === verificationRevision && signature === recordSignature) verified = result;
		}).catch(cause => {
			if (!disposed && revision === verificationRevision && signature === recordSignature) integrityError = cause instanceof Error ? cause.message : 'The saved result failed verification.';
		});
	});
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
	let startDisabled = $derived(sessionRequired || requestBusy || configState !== 'available' || Boolean(eligibilityError) || currentRunBlocksStart || Boolean(record && !verifiedRecord));
	let resumeDisabled = $derived(sessionRequired || requestBusy || disabled || configState !== 'available' || !reference || reference.input.version !== RUN_VERSION || Boolean(record) || !runMatchesTask);
	let canReviewRetirement = $derived(Boolean(reference && !record &&
		notFoundReference?.id === reference.id && notFoundReference.key === reference.key));
	let statusLabel = $derived(record && !verifiedRecord ? runProjection.state === 'invalid' ? 'Saved result invalid' : 'Verifying saved result' : verifiedRecord
		? `${authoredExample ? 'Example · ' : ''}${!runMatchesTask ? 'Earlier result · ' : ''}${verifiedRecord.status.charAt(0).toUpperCase() + verifiedRecord.status.slice(1)}`
		: reference ? 'Uncertain' : configState === 'unavailable' ? 'Preview only' : 'Not started');
	let latestEvent = $derived(verifiedRecord?.events.at(-1)?.message || (reference && !record ? reference.input.version === RUN_VERSION
		? 'The start response is unknown. Refresh or explicitly resume this saved request.'
		: 'The outcome is unknown. Refresh this historical request; its old input cannot start a new run.' : ''));
	let runEvents = $derived((verifiedRecord?.events ?? []).slice().reverse().map(event => ({ date: event.at, title: event.message })));
	let runSummary = $derived.by(() => {
		const record = verifiedRecord;
		if (hasStoredRecord && !record) return runProjection.state === 'invalid' ? 'The saved result is invalid. Open Review to inspect or refresh it.' : 'Verifying the saved run before showing its source and checks.';
		if (reference && !runMatchesTask) return 'This request used earlier task requirements. Inspect it as history before building from the current task.';
		if (reference && !record) return 'The start outcome is unknown. Refresh the saved request before deciding whether to resume it.';
		if (record?.status === 'ready') return authoredExample ? 'An authored offline example is ready to try. Its check results are sample data.' : 'Recorded checks finished successfully. Try the tool and decide what to save.';
		if (record?.status === 'failed') return 'Inspect the saved attempt before running again.';
		if (record?.status === 'cancelled') return 'The run was cancelled. Its recorded work remains available to inspect.';
		if (record?.status === 'uncertain') return 'The outcome is uncertain. Inspect the recorded attempt before starting another run.';
		if (reference) return 'The build is in progress. Its current status and activity appear below.';
		return 'Build a small browser tool from this task, then try it before saving.';
	});
	let runStages = $derived.by((): RunStage[] => {
		const record = verifiedRecord;
		const source: RunStage = { id: 'source', title: 'Generate source', state: 'waiting', detail: 'Nemotron writes the files' };
		const sandbox: RunStage = { id: 'sandbox', title: 'Check in Sandbox', state: 'waiting', detail: 'Model-authored checks' };
		const review: RunStage = { id: 'review', title: 'Your review', state: 'waiting', detail: 'Try the tool and decide what to keep' };
		if (!reference) return [source, sandbox, review];
		if (!record) {
			source.state = sandbox.state = 'unknown';
			source.detail = sandbox.detail = hasStoredRecord ? statusLabel : 'Awaiting the server receipt';
			review.detail = hasStoredRecord ? 'Inspect the saved result in Review' : 'Refresh the saved request';
			return [source, sandbox, review];
		}
		if (authoredExample) {
			source.title = 'Example source'; source.state = record.files.length ? 'available' : 'stopped'; source.detail = `${record.files.length} authored files retained`;
			sandbox.title = 'Sample checks'; sandbox.state = record.checks.length ? 'available' : 'unknown'; sandbox.detail = 'Illustrative records · no live Sandbox execution';
			review.state = record.status === 'ready' ? 'available' : 'unknown'; review.detail = runMatchesTask ? 'Try the example · your decision' : 'Inspect the earlier example';
			return [source, sandbox, review];
		}
		const hasFiles = record.files.length > 0;
		const lastCheck = record.checks.at(-1);
		const lastGeneration = record.generationAttempts.at(-1);
		const sourceFailure = record.status === 'failed' && (['generation', 'response', 'tool_files', 'tool_page', 'tool_worker', 'tool_checks'].includes(record.failure?.stage || '')
			|| (lastGeneration?.outcome === 'rejected' && lastGeneration.attempt > record.attempt));
		if (record.status === 'generating' || record.status === 'repairing') {
			source.state = 'active';
			source.detail = record.status === 'repairing' ? 'Repair scheduled or in progress' : 'Generating the tool files';
		} else if (sourceFailure) {
			source.state = 'stopped'; source.detail = 'Latest source was not completed';
		} else if (hasFiles) {
			source.state = 'observed'; source.detail = `${record.files.length} files retained`;
		} else if (record.status === 'uncertain' || record.status === 'cancelling') {
			source.state = 'unknown'; source.detail = record.status === 'cancelling' ? 'Cancellation not yet confirmed' : 'Generation outcome unknown';
		} else if (terminal) {
			source.state = 'stopped'; source.detail = 'No source files retained';
		} else source.detail = 'Waiting to start';

		if (record.status === 'checking') {
			sandbox.state = 'active'; sandbox.detail = `Checking model attempt ${record.attempt}`;
		} else if (record.status === 'ready' && lastCheck?.exitCode === 0 && lastCheck.attempt === record.attempt) {
			sandbox.state = 'observed'; sandbox.detail = `Model attempt ${lastCheck.attempt} passed · ${record.checks.length} Sandbox ${record.checks.length === 1 ? 'result' : 'results'}`;
		} else if (lastCheck && lastCheck.exitCode !== 0) {
			sandbox.state = 'stopped'; sandbox.detail = `Model attempt ${lastCheck.attempt} failed · result retained`;
		} else if (record.status === 'uncertain' || record.status === 'cancelling') {
			sandbox.state = 'unknown'; sandbox.detail = 'No confirmed final check outcome';
		} else if (terminal) {
			sandbox.state = 'stopped'; sandbox.detail = lastCheck ? 'Check output retained; run stopped' : 'No check result recorded';
		} else sandbox.detail = hasFiles ? 'Waiting for the next check' : 'Waiting for valid source';

		if (!runMatchesTask) review.detail = 'Inspect the earlier result';
		else if (record.status === 'ready') {
			review.state = 'available'; review.detail = 'Ready to try · your decision';
		} else review.detail = terminal ? 'Inspect the saved attempt' : 'Available after a checked build';
		return [source, sandbox, review];
	});

	function clearPolling() {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = null;
	}

	function requireRunSession(cause: unknown, packId: string, runId: string) {
		if (cause instanceof NebiusRunClientError && cause.code === 'session_required') {
			runSessionGates[JSON.stringify([packId, runId])] = true;
		}
	}

	async function restoreControlFocus(control: Element | null, packId: string, targetId: string, sessionKey: string) {
		if (!control) return;
		await tick();
		if (disposed || pack.id !== packId || currentSessionKey !== sessionKey || document.activeElement !== document.body) return;
		const target = document.getElementById(targetId);
		target?.focus();
		if (!target || document.activeElement !== target) document.getElementById('nebius-task-run')?.focus();
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
		const capturedPackId = pack.id;
		const capturedSessionKey = currentSessionKey;
		const focusedControl = document.activeElement?.id === 'task-run-availability' ? document.activeElement : null;
		active?.abort();
		const controller = new AbortController();
		active = controller;
		configState = 'loading';
		configMessage = '';
		try {
			const result: RunConfigState = await getRunConfig(controller.signal);
			if (disposed || controller.signal.aborted) return;
			configSessionRequired = false;
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
			if (cause instanceof NebiusRunClientError && cause.code === 'session_required') configSessionRequired = true;
			config = null;
			configMessage = cause instanceof Error ? cause.message : 'Task execution availability could not be checked.';
			configState = 'error';
		} finally {
			if (!controller.signal.aborted) await restoreControlFocus(focusedControl, capturedPackId,
				configState === 'available' ? reference ? terminal ? 'task-run-review' : 'task-run-refresh' : 'task-run-start' : 'task-run-availability', capturedSessionKey);
		}
	}

	async function applyRecord(runId: string, runKey: string, value: unknown) {
		const capturedPackId = pack.id;
		const savedPack = await saveExecutionRunRecord(capturedPackId, runId, runKey, value);
		if (disposed || pack.id !== capturedPackId || savedPack.executionRun?.id !== runId) return;
		delete runSessionGates[JSON.stringify([capturedPackId, runId])];
		const saved = savedPack.executionRun.record;
		if (saved && !TERMINAL_RUN_STATUSES.includes(saved.status)) scheduleRefresh(capturedPackId, runId, runKey);
	}

	async function refreshKnownRun(options: { packId?: string; runId?: string; runKey?: string; quiet?: boolean; uncertaintyNotice?: string } = {}) {
		const capturedPackId = options.packId || pack.id;
		const runId = options.runId || reference?.id;
		const runKey = options.runKey || reference?.key;
		if (!runId || !runKey || requestBusy || !isCurrentRun(capturedPackId, runId, runKey)) return;
		const focusedControl = !options.quiet && document.activeElement?.id === 'task-run-refresh' ? document.activeElement : null;
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
				requireRunSession(cause, capturedPackId, runId);
				notFoundReference = cause instanceof NebiusRunClientError && cause.status === 404 && cause.code === 'not_found'
					? { id: runId, key: runKey } : null;
				if (notFoundReference) delete runSessionGates[JSON.stringify([capturedPackId, runId])];
				error = cause instanceof Error ? cause.message : 'The saved run could not be refreshed.';
			}
		} finally {
			if (!options.quiet && !disposed) {
				requestBusy = false;
				requestLabel = '';
				if (isCurrentRun(capturedPackId, runId, runKey) && actionRevision === capturedActionRevision) {
					await restoreControlFocus(focusedControl, capturedPackId, terminal ? 'task-run-review' : 'task-run-refresh', JSON.stringify([capturedPackId, runId]));
				}
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
			requireRunSession(cause, capturedPackId, credentials.id);
			if (cause instanceof NebiusRunClientError && cause.definitiveStartRejection) {
				try { await clearUnsentExecutionRunReference(capturedPackId, credentials.id, credentials.key, input); }
				catch (clearError) {
					error = clearError instanceof Error ? `${cause.message} ${clearError.message}` : cause.message;
					return;
				}
				error = cause.message;
			} else if (cause instanceof NebiusRunClientError && cause.uncertain) {
				notice = cause.message;
				if (pack.id === capturedPackId && !sessionRequired) scheduleRefresh(capturedPackId, credentials.id, credentials.key, cause.message);
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
			await retireUnavailableExecutionRun(capturedPackId, reviewed, true, controller.signal);
			if (disposed || pack.id !== capturedPackId) return;
			notFoundReference = null;
			retirementOpen = false;
			reviewedRetirement = null;
			notice = 'Local reference retired. The original request is preserved below; its outcome remains unknown.';
			await tick();
			document.getElementById('nebius-task-run')?.focus();
		} catch (cause) {
			if (disposed || controller.signal.aborted) return;
			requireRunSession(cause, capturedPackId, reviewed.id);
				error = cause instanceof Error ? cause.message : 'The request could not be retired locally.';
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
			if (disposed || !isCurrentRun(capturedPackId, id, key)) return;
			requireRunSession(cause, capturedPackId, id);
			// A rejected retry says nothing about the earlier POST's outcome.
			error = cause instanceof Error ? cause.message : 'The saved task request could not be resumed.';
			notice = 'The saved request is preserved. Refresh it to check whether the earlier start created a run.';
			if (!sessionRequired) scheduleRefresh(capturedPackId, id, key, notice);
		} finally {
			if (!disposed) {
				requestBusy = false;
				requestLabel = '';
			}
		}
	}

	async function cancelCurrentRun() {
		if (!reference || terminal || requestBusy || sessionRequired) return;
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
			requireRunSession(cause, capturedPackId, id);
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
		verificationRevision++;
		active?.abort();
		retirementRequest?.abort();
		clearPolling();
	});
</script>

<section id="nebius-task-run" class="task-run" aria-labelledby="task-run-title" tabindex="-1" data-nebius-task-run>
	<div class="task-run-head">
		<div>
			<p class="task-run-kicker">Nebius Token Factory</p>
			<h2 id="task-run-title">Build a tool</h2>
		</div>
		<WornBadge label={statusLabel} variant={integrityError ? 'warn' : runMatchesTask && verifiedRecord?.status === 'ready' ? 'accent' : runMatchesTask && (verifiedRecord?.status === 'failed' || verifiedRecord?.status === 'uncertain') ? 'warn' : undefined} />
	</div>
	<p class="task-run-scope" role="status" aria-live="polite" aria-atomic="true" data-run-status><span class="run-status-label">{statusLabel}.</span>{' '}{runSummary}</p>
	{#if authoredExample}<p class="task-run-muted" data-run-provenance>Authored offline example. Model counts and check results are illustrative; no live run is represented.</p>{/if}
	{#if integrityError}<WornAlert tone="danger">{integrityError}</WornAlert>{/if}
	{#if eligibilityError}<p class="task-run-blocked" role="status">{eligibilityError}</p>{/if}
	{#if sessionRequired}
		<WornAlert tone="warning">Sign-in may be required.{#if reference} Your saved request is preserved. The shown status may be out of date.{/if}</WornAlert>
		<div class="task-run-actions" data-run-session-required>
			<WornButton href="/work" target="_blank" rel="noopener noreferrer" variant="primary">Sign in (new tab)</WornButton>
			<p class="task-run-muted">Return here after signing in, then {configSessionRequired && runSessionRequired ? 'check availability and refresh the saved run' : configSessionRequired ? 'check availability again' : 'refresh the saved run'}.</p>
		</div>
	{/if}
	{#if notice && !sessionRequired}<WornAlert tone="warning">{notice}</WornAlert>{/if}
	{#if (!sessionRequired && error) || record?.error}<WornAlert tone="danger">{(!sessionRequired && error) || record?.error}</WornAlert>{/if}
	{#if configState === 'loading'}
		<p class="task-run-muted" role="status">Checking whether task execution is configured…</p>
	{:else if !sessionRequired && (configState === 'unavailable' || configState === 'error')}
		<WornAlert tone={configState === 'error' ? 'danger' : 'info'}>{configState === 'error' ? configMessage || 'Could not check tool-building availability.' : reference ? 'Building with Nebius is disabled here. You can still review saved runs.' : 'Building with Nebius is disabled here. You can still edit the task.'}</WornAlert>
	{/if}
	{#if reference && !terminal}
		<div class="task-run-progress">
			<strong>{requestLabel || statusLabel}</strong>
			{#if latestEvent}<p>{latestEvent}</p>{/if}
		</div>
	{/if}

	<div class="task-run-actions">
		{#if reference && (!record || !terminal)}
			<WornButton id="task-run-refresh" type="button" variant="primary" disabled={requestBusy} onclick={() => refreshKnownRun()}>{requestLabel === 'Refreshing…' ? requestLabel : 'Refresh saved run'}</WornButton>
			{#if !record}<WornButton type="button" disabled={resumeDisabled} onclick={resumeSavedRequest}>{requestLabel === 'Resuming…' ? requestLabel : 'Resume saved request'}</WornButton>{/if}
			<WornButton type="button" disabled={requestBusy || sessionRequired} onclick={cancelCurrentRun}>{requestLabel === 'Cancelling…' ? requestLabel : 'Cancel'}</WornButton>
			{#if canReviewRetirement}<WornButton type="button" disabled={disabled || requestBusy} onclick={reviewLocalRetirement}>Review local retirement</WornButton>{/if}
		{/if}
		{#if reference}
			<WornButton id="task-run-review" variant={terminal ? 'primary' : undefined} href={`/next?pack=${encodeURIComponent(pack.id)}&view=review`}>Review saved run</WornButton>
		{/if}
		{#if configState === 'unavailable' || configState === 'error'}
			<WornButton id="task-run-availability" type="button" variant={!reference ? 'primary' : undefined} size="sm" onclick={loadConfig}>Check availability again</WornButton>
		{/if}
		<WornButton id="task-run-start" type="button" variant={!reference && configState === 'available' ? 'primary' : undefined} disabled={startDisabled} onclick={runTask}>{requestLabel === 'Starting…' ? requestLabel : 'Build with Nebius'}</WornButton>
	</div>
	{#if !reference}
		<div class="task-run-example" data-task-run-offline-example>
			<WornButton href={`/recovery-rehearsal?pack=${encodeURIComponent(pack.id)}`} disabled={disabled || requestBusy}>Try offline Recovery Simulator</WornButton>
			<p class="task-run-muted">A fixed five-task reference. Compare its scope with your brief before recording evidence.</p>
		</div>
	{/if}
	<div class="task-run-track" data-run-track data-earlier={Boolean(reference && !runMatchesTask)}>
		<p class="task-run-track-label">{authoredExample ? 'Authored example stages' : reference && !runMatchesTask ? 'Earlier task requirements' : reference ? 'Recorded run stages' : 'From task to working tool'}</p>
		<ol aria-label={reference && !runMatchesTask ? 'Earlier run stages' : 'Task run stages'}>
			{#each runStages as stage, index (stage.id)}
				<li data-run-stage={stage.id} data-state={stage.state} aria-current={stage.state === 'active' && runMatchesTask ? 'step' : undefined}>
					<span class="task-run-marker" aria-hidden="true">{stage.state === 'observed' ? '✓' : stage.state === 'unknown' ? '?' : stage.state === 'stopped' ? '!' : index + 1}</span>
					<div><strong>{stage.title}</strong><span class="task-run-stage-detail">{stage.detail}</span></div>
				</li>
			{/each}
		</ol>
	</div>
	{#if config}
		<p class="task-run-muted" data-run-limits>New builds: at most {config.limits.maxModelCalls} model calls · {config.limits.maxSandboxRuns} × {config.limits.sandboxSeconds}s Sandbox checks · {config.limits.maxOutputTokens.toLocaleString()} output tokens per call ({(config.limits.maxModelCalls * config.limits.maxOutputTokens).toLocaleString()} maximum). Input tokens are billed separately.</p>
	{/if}
	<details class="task-run-input" data-run-output-requirements>
		<summary>Required tool outputs</summary>
		{#if pack.executionOutputs == null}<p>Required outputs are not specified by this task. The tool chooses them.</p>
		{:else if !pack.executionOutputs.length}<p>This task sets no minimum outputs. Additional status outputs are allowed.</p>
		{:else}<ul>{#each pack.executionOutputs as output (output.id)}<li><code>{output.id}</code>: {output.format === 'timeline' ? 'timeline' : 'plain text'}</li>{/each}</ul><p>The tool must include these outputs. Additional status outputs are allowed.</p>{/if}
		{#if onEditOutputs}<div class="task-run-input-actions"><WornButton type="button" size="sm" disabled={disabled || requestBusy || currentRunBlocksStart || pack.status === 'done' || Boolean(pack.archived)} onclick={onEditOutputs}>Edit required outputs</WornButton></div>{/if}
	</details>
	<details class="task-run-input" data-run-input-requirements>
		<summary>Task input requirements</summary>
		{#if pack.executionInputs == null}<p>Formats are not specified by this task. The model chooses them.</p>
		{:else if !pack.executionInputs.length}<p>This tool must have no text inputs.</p>
		{:else}<ul>{#each pack.executionInputs as input (input.id)}<li><code>{input.id}</code>: {input.format === 'json' ? 'JSON' : 'plain text'}</li>{/each}</ul><p>The generated tool must use these exact inputs and formats.</p>{/if}
		{#if onEditInputs}<div class="task-run-input-actions"><WornButton type="button" size="sm" disabled={disabled || requestBusy || currentRunBlocksStart || pack.status === 'done' || Boolean(pack.archived)} onclick={onEditInputs}>Edit task inputs</WornButton></div>{/if}
	</details>
	{#if configState === 'unavailable' && !reference}
		<p class="task-run-muted">No saved tool or Sandbox result.</p>
		<details class="task-run-input">
			<summary>What Sandbox will do</summary>
			<p>Validate the files and run Node checks in an isolated Nebius Sandbox, with up to {RUN_LIMITS.maxModelCalls - 1} conditional repairs within the {RUN_LIMITS.maxModelCalls}-call limit. You review the files and results.</p>
		</details>
	{/if}

	<details class="task-run-input">
		<summary>Input and limits</summary>
		{#if config}<p>Configured model: <strong>{config.requestedModel}</strong>. Each model response may take up to {RUN_MODEL_TIMEOUT_MS / 60000} minutes within the {config.limits.runSeconds / 60}-minute total run allowance.</p>{/if}
		{#if reference}<p>Run <code>{reference.id}</code></p>{/if}
		<p>Selected context: none. The task details shown below are the only task context authorized for this run.</p>
		{#if inputPreview}<pre>{JSON.stringify(inputPreview, null, 2)}</pre>{:else if configState === 'unavailable'}<p class="task-run-muted">The exact model, payload and run limits will appear when execution is enabled.</p>{:else}<p class="task-run-muted">Complete the task requirements to prepare an exact payload.</p>{/if}
	</details>

	{#if reference}
		{#if reference.input.version !== RUN_VERSION}<p class="task-run-muted">This historical request has no task-owned input specification. {record ? 'Its saved result remains available.' : 'Its outcome is unknown.'} It cannot be restarted with the old request.</p>{/if}
		{#if record && !runMatchesTask}<p class="task-run-muted">This saved run used earlier task requirements. Review it as history; a new run is required for the current task.</p>{/if}
		{#if !record && !runMatchesTask}<p class="task-run-muted">This pending request used earlier task requirements. Refresh it; if no server receipt exists, review local retirement before starting a new run.</p>{/if}
		{#if record}
		{#key currentSessionKey}
			<details class="task-run-input" data-run-diagnostics>
				<summary>Run details and usage</summary>
				{#if verifiedRecord}
				<p>{authoredExample ? 'Sample counts' : 'Recorded usage'} · {verifiedRecord.usage.modelCalls} model {verifiedRecord.usage.modelCalls === 1 ? 'call' : 'calls'} · {verifiedRecord.usage.inputTokens === null ? 'Unknown' : verifiedRecord.usage.inputTokens.toLocaleString()} input tokens · {verifiedRecord.usage.outputTokens === null ? 'Unknown' : verifiedRecord.usage.outputTokens.toLocaleString()} output tokens</p>
				{#if !verifiedRecord.usage.totalsComplete}<p>Usage is incomplete. These counts include only recorded usage; the actual total may be higher.</p>{/if}
				{#if verifiedRecord.failure}<p>Failure stage: {verifiedRecord.failure.stage.replaceAll('_', ' ')} · Code: <code>{verifiedRecord.failure.code}</code></p>{:else if verifiedRecord.error}<p>No structured failure details were recorded for this run.</p>{/if}
				{:else}<p>{integrityError ? 'Saved run details are unavailable until the result is verified.' : 'Verifying saved run details…'}</p>{/if}
			</details>
			<details class="task-run-history" data-run-activity>
				<summary>Run activity{#if verifiedRecord}{' · '}{runEvents.length} {runEvents.length === 1 ? 'event' : 'events'}{/if}</summary>
				{#if verifiedRecord && runEvents.length}
				<WornTimeline entries={runEvents} ariaLabel="Recorded sandbox run activity, newest first" headingLevel={3} density="compact" formatDate={(date) => new Date(date).toLocaleString()} />
				{:else if verifiedRecord}<p>No run activity is recorded.</p>
				{:else}<p>{integrityError ? 'Saved run activity is unavailable until the result is verified.' : 'Verifying saved run activity…'}</p>{/if}
			</details>
		{/key}
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
	.run-status-label { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	.task-run { background: transparent; border: 0; display: grid; gap: 12px; min-inline-size: 0; padding: 0; }
	.task-run:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.task-run-head { align-items: center; display: flex; gap: 12px; justify-content: space-between; }
	.task-run-head h2, .task-run-progress p, .task-run-scope, .task-run-input p { margin: 0; }
	.task-run-kicker { color: var(--worn-text-muted); font-family: var(--font-typewriter); font-size: 11px; font-weight: 700; letter-spacing: .04em; margin: 0 0 3px; text-transform: uppercase; }
	.task-run-scope, .task-run-input p, .task-run-muted { color: var(--worn-text-secondary); font-size: .9rem; line-height: 1.5; }
	.task-run-muted { margin: 0; }
	.run-status-label { block-size: 1px; clip-path: inset(50%); inline-size: 1px; overflow: hidden; position: absolute; white-space: nowrap; }
	.task-run-track { border-block: 1px solid var(--worn-border); padding-block: 12px; }
	.task-run-track-label { color: var(--worn-text-muted); font-family: var(--font-typewriter); font-size: 11px; font-weight: 700; letter-spacing: .03em; margin: 0 0 8px; text-transform: uppercase; }
	.task-run-track ol { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; }
	.task-run-track li { align-items: start; display: flex; gap: 10px; min-inline-size: 0; }
	.task-run-marker { align-items: center; border: 1px solid var(--worn-border-strong); border-radius: 50%; color: var(--worn-text-secondary); display: inline-flex; flex: 0 0 28px; font-size: .8rem; height: 28px; justify-content: center; }
	.task-run-track strong, .task-run-stage-detail { display: block; overflow-wrap: anywhere; }
	.task-run-track strong { font-size: .875rem; }
	.task-run-stage-detail { color: var(--worn-text-secondary); font-size: .8rem; line-height: 1.4; margin-block-start: 2px; }
	.task-run-track [data-state='observed'] .task-run-marker, .task-run-track [data-state='available'] .task-run-marker { background: var(--worn-bg-secondary); border-color: var(--worn-link); color: var(--worn-link); }
	.task-run-track [data-state='active'] .task-run-marker { border: 2px solid var(--worn-link); box-shadow: 0 0 0 3px var(--worn-bg-secondary); color: var(--worn-link); animation: run-stage-pulse 1.8s ease-in-out infinite; }
	.task-run-track[data-earlier='true'] .task-run-marker { background: transparent; border-color: var(--worn-border-strong); box-shadow: none; color: var(--worn-text-secondary); animation: none; }
	@keyframes run-stage-pulse { 50% { box-shadow: 0 0 0 6px var(--worn-bg-secondary); } }
	@media (prefers-reduced-motion: reduce) { .task-run-track [data-state='active'] .task-run-marker { animation: none; } }
	.task-run-history summary { align-content: center; cursor: pointer; font-size: .875rem; min-block-size: 44px; }
	.task-run-history summary:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.task-run-input { border-top: 1px solid var(--worn-border); padding-top: 8px; }
	.task-run-input[open] > summary { margin-block-end: 12px; }
	.task-run-input summary { align-content: center; cursor: pointer; font-weight: 650; min-block-size: 44px; overflow-wrap: anywhere; }
	.task-run-input p + p { margin-block-start: .5rem; }
	.task-run-input-actions { margin-block-start: 8px; }
	.task-run-input summary:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.task-run-input code { overflow-wrap: anywhere; }
	.task-run-input pre { background: var(--worn-bg-secondary); font-size: 12px; max-height: 320px; min-inline-size: 0; overflow: auto; overflow-wrap: anywhere; padding: 12px; white-space: pre-wrap; }
	.task-run-blocked { color: var(--worn-text-secondary); font-size: .875rem; margin: 0; }
	.task-run-progress { background: var(--worn-bg-secondary); display: grid; gap: 4px; padding: 12px; }
	.task-run-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
	.task-run-example { display: grid; gap: 8px; min-inline-size: 0; }
	.task-run-example :global(.worn-btn) { justify-self: start; min-block-size: 44px; }
	.task-run-actions :global(.worn-btn) { min-block-size: 44px; }
	@media (max-width: 1100px) { .task-run-track ol { grid-template-columns: 1fr; gap: 8px; } }
	@media (max-width: 560px) { .task-run-actions :global(.worn-btn) { width: 100%; } }
</style>
