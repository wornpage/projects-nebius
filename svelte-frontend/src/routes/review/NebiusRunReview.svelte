<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { WornAlert, WornBadge, WornButton } from '$lib/components';
	import {
		ChallengeStateError,
		displayToast,
		executionRunMatchesCurrentTask,
		saveExecutionRunEvidence,
		saveExecutionRunRecord
	} from '$lib/demo-client';
	import type { DemoPack } from '$lib/demo-workflow';
	import { downloadRunPreviewHtml, readRun } from '$lib/nebius-execution-client';
	import { validateRunIntegrity, type RunFile, type RunRecord } from '$lib/nebius-execution-contract.mjs';

	type Props = { pack: DemoPack };
	let { pack }: Props = $props();
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

	let reference = $derived(pack.executionRun || null);
	let record = $derived(reference?.record || null);
	let currentTaskMatches = $derived(Boolean(reference && executionRunMatchesCurrentTask(pack, reference)));
	let ready = $derived(verified?.status === 'ready');
	let previewName = $derived(reference ? `nebius-preview-${reference.id}` : 'nebius-preview');

	$effect(() => {
		const candidate = record;
		const candidateId = reference?.id || '';
		const revision = ++integrityRevision;
		verified = null;
		integrityError = '';
		stopPreviewListener();
		previewOpen = false;
		previewStatus = '';
		if (!candidate || !candidateId) return;
		void validateRunIntegrity(candidate).then((result) => {
			if (revision === integrityRevision && reference?.id === candidateId && reference.record?.updatedAt === result.updatedAt) verified = result;
		}).catch((cause) => {
			if (revision === integrityRevision) integrityError = cause instanceof Error ? cause.message : 'The saved result failed its integrity check.';
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

	async function refreshResult() {
		if (!reference || busy) return;
		const { id, key } = reference;
		const packId = pack.id;
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

	async function downloadTool() {
		if (!reference || !ready || integrityError || busy) return;
		const { id, key } = reference;
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
		if (trigger?.isConnected) trigger.focus();
	}

	async function saveEvidence() {
		if (!reference || !ready || !currentTaskMatches || busy) return;
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
		}
	}

	function tokenCount(value: number | null): string {
		return value === null ? 'Unknown' : value.toLocaleString();
	}

	onDestroy(stopPreviewListener);
</script>

<section class="run-review demo-focus-surface" data-nebius-run-review data-pack-id={pack.id} tabindex="-1" aria-labelledby="run-review-title">
	<div class="run-review-head">
		<div>
			<p class="run-review-kicker">Task result</p>
			<h2 id="run-review-title" class="demo-card-title">{record ? 'Review generated browser tool' : 'Review task execution'}</h2>
		</div>
		<WornBadge label={record?.status || 'Uncertain'} />
	</div>

	{#if !reference}
		<WornAlert tone="info">This task has no saved execution run.</WornAlert>
	{:else}
		<p class="run-review-id">Run {reference.id}</p>
		{#if error}<WornAlert tone="danger">{error}</WornAlert>{/if}
		{#if savedMessage}<WornAlert tone="success">{savedMessage}</WornAlert>{/if}
		{#if !record}
			<WornAlert tone="warning">The start response is unknown. Refresh this saved run; do not start another paid operation yet.</WornAlert>
		{:else}
			{#if !currentTaskMatches}
				<WornAlert tone="warning">The task details have changed since this run started. You can inspect the result, but it cannot be saved as current evidence.</WornAlert>
			{/if}
			{#if integrityError}<WornAlert tone="danger">{integrityError}</WornAlert>{/if}
			{#if record.error}<WornAlert tone="danger">{record.error}</WornAlert>{/if}
			{#if record.failure}
				<details data-run-diagnostics><summary>Failure details</summary><dl><dt>Stage</dt><dd>{record.failure.stage.replaceAll('_', ' ')}</dd><dt>Code</dt><dd>{record.failure.code}</dd></dl></details>
			{:else if record.error}<p class="run-muted">No structured failure details were recorded for this run.</p>{/if}

			{#if ready}
				<div class="run-try" data-run-try>
					<WornButton type="button" variant={currentTaskMatches ? 'primary' : undefined} disabled={Boolean(busy) || Boolean(integrityError)} onclick={openPreview}>{currentTaskMatches ? 'Try your tool' : 'Inspect previous tool'}</WornButton>
					<p class="run-approval-note">Try the result before deciding what to keep. The model wrote its checks; they do not independently approve the tool.</p>
				</div>
			{/if}
			{#if previewOpen}
				<div class="run-preview-shell">
					<div class="run-preview-bar"><div class="run-preview-label" role="status">Isolated preview · {previewStatus}</div><WornButton type="button" size="sm" onclick={closePreview}>Close preview</WornButton></div>
					<iframe bind:this={previewFrame} name={previewName} title={`Isolated preview for ${record?.pack.title || 'generated browser tool'}`} src="about:blank" sandbox="allow-scripts"></iframe>
				</div>
			{/if}

			<div class="run-review-facts">
				<div><span>Model</span><strong>{record.requestedModel}</strong></div>
				<div><span>Model calls</span><strong>{record.usage.modelCalls} of 2</strong></div>
				<div><span>Recorded input tokens</span><strong>{tokenCount(record.usage.inputTokens)}</strong></div>
				<div><span>Recorded output tokens</span><strong>{tokenCount(record.usage.outputTokens)}</strong></div>
			</div>
			{#if !record.usage.totalsComplete}<p class="run-muted">Usage is incomplete. These counts include only recorded usage; the actual total may be higher.</p>{/if}

			<div class="run-review-criteria">
				<h3>Task criteria at run start</h3>
				<p>{record.pack.doneWhen}</p>
			</div>

			<section class="run-checks" aria-labelledby="run-checks-title">
				<h3 id="run-checks-title">Observed agent-authored checks</h3>
				{#if record.checks.length === 0}
					<p class="run-muted">No sandbox check result is available.</p>
				{:else}
					{#each record.checks as check (check.attempt)}
						<details>
							<summary>Model attempt {check.attempt} · Sandbox exit {check.exitCode}</summary>
							<dl><dt>Operation</dt><dd>{check.operationId}</dd><dt>Checkpoint</dt><dd>{check.checkpointId || 'Unknown'}</dd><dt>Source digest</dt><dd>{check.sourceDigest}</dd></dl>
							<h4>stdout</h4><pre>{check.stdout || '(empty)'}</pre>
							<h4>stderr</h4><pre>{check.stderr || '(empty)'}</pre>
						</details>
					{/each}
				{/if}
			</section>

			{#if verified?.generationAttempts.length}
				<details data-run-generation-history>
					<summary>Generation responses ({verified.generationAttempts.length})</summary>
					<p class="run-muted">Private source history. Passing source validation does not mean the tool passed its checks.</p>
					{#each verified.generationAttempts as generation (generation.attempt)}
						<details>
							<summary>Model attempt {generation.attempt} · {generation.outcome === 'accepted' ? 'source validation passed' : 'source rejected'}</summary>
							{#if generation.diagnostic}<p>{generation.diagnostic.message}</p><p class="run-muted">{generation.diagnostic.stage} · {generation.diagnostic.code}</p>{/if}
							{#if generation.retention === 'retained'}<pre>{generation.responseText}</pre>
							{:else}<p class="run-muted">Response text exceeded the retention size limit and was not saved.</p>{/if}
						</details>
					{/each}
				</details>
			{:else if verified && verified.usage.modelCalls > 0}
				<p class="run-muted">No identified generation response was retained for this run.</p>
			{/if}

			{#if verified?.files.length}
				<section class="run-files" aria-labelledby="run-files-title">
					<h3 id="run-files-title">Generated source</h3>
					{#each verified.files as file (file.path)}
						<details>
							<summary>{file.path}</summary>
							<WornButton type="button" size="sm" onclick={() => downloadSource(file)}>Download as text</WornButton>
							<pre>{file.content}</pre>
						</details>
					{/each}
				</section>
			{/if}
		{/if}

		<div class="run-review-actions">
			<WornButton type="button" disabled={Boolean(busy)} onclick={refreshResult}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh saved run'}</WornButton>
			{#if ready}
				<WornButton type="button" disabled={Boolean(busy) || Boolean(integrityError)} onclick={downloadTool}>{busy === 'download' ? 'Downloading…' : 'Download tool'}</WornButton>
				<WornButton type="button" disabled={Boolean(busy) || !currentTaskMatches || Boolean(integrityError)} onclick={saveEvidence}>{busy === 'save' ? 'Saving…' : 'Save run evidence'}</WornButton>
			{/if}
		</div>
		{#if ready}<p class="run-approval-note">These checks are agent-authored observations. Saving their run reference does not independently approve the result, mark the task done or publish the tool.</p>{/if}
	{/if}
</section>

<style>
	.run-review { border: 1px solid var(--worn-border); display: grid; gap: 14px; margin-bottom: 18px; padding: 16px; }
	.run-try { display: grid; gap: 8px; justify-items: start; }
	.run-review-head { align-items: center; display: flex; gap: 12px; justify-content: space-between; }
	.run-review-head h2, .run-review-id, .run-review-criteria p, .run-checks > p, .run-approval-note { margin: 0; }
	.run-review-kicker { color: var(--worn-text-muted); font-family: var(--font-typewriter); font-size: 11px; font-weight: 700; letter-spacing: .04em; margin: 0 0 3px; text-transform: uppercase; }
	.run-review-id, .run-muted, .run-approval-note { color: var(--worn-text-muted); font-size: .875rem; overflow-wrap: anywhere; }
	.run-review-facts { display: grid; gap: 8px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.run-review-facts div { background: var(--worn-bg-secondary); display: grid; gap: 3px; padding: 10px; }
	.run-review-facts span { color: var(--worn-text-muted); font-size: 11px; }
	.run-review-facts strong { overflow-wrap: anywhere; }
	.run-review-criteria, .run-checks, .run-files { border-top: 1px solid var(--worn-border); display: grid; gap: 9px; padding-top: 12px; }
	.run-review h3, .run-review h4 { margin: 0; }
	.run-review details { background: var(--worn-bg-secondary); padding: 10px; }
	.run-review summary { cursor: pointer; font-weight: 650; overflow-wrap: anywhere; }
	.run-review pre { background: var(--worn-bg); font-size: 12px; max-height: 360px; overflow: auto; padding: 10px; white-space: pre-wrap; }
	.run-review dl { display: grid; gap: 4px 10px; grid-template-columns: max-content minmax(0, 1fr); }
	.run-review dt { color: var(--worn-text-muted); }
	.run-review dd { margin: 0; overflow-wrap: anywhere; }
	.run-review-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
	.run-preview-shell { border: 1px solid var(--worn-border); display: grid; gap: 8px; padding: 10px; }
	.run-preview-bar { align-items: center; display: flex; gap: 8px; justify-content: space-between; }
	.run-preview-label { color: var(--worn-text-muted); font-size: 12px; font-weight: 700; }
	.run-preview-shell iframe { background: white; border: 1px solid var(--worn-border); height: 520px; width: 100%; }
	@media (max-width: 760px) { .run-review-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 480px) { .run-review-facts { grid-template-columns: 1fr; } .run-review-actions :global(.worn-btn), .run-try :global(.worn-btn) { width: 100%; } .run-preview-shell iframe { height: 420px; } }
</style>
