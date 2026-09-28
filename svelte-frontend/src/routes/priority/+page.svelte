<script lang="ts">
	import { onMount } from 'svelte';
	import { demoState, demoStateError, demoStateLoading, refreshDemoState } from '$lib/demo-client';
	import { type DemoPack } from '$lib/demo-workflow';
	import { WornButton, WornEmpty, WornError, WornPage } from '$lib/components';
	import { selectNextRecommendation } from '$lib/workflow-rules.mjs';
	import { registerPageTools } from '$lib/webmcp.mjs';
	import { createPriorityRecommendationTool } from './priority-webmcp.mjs';

	let packs = $derived(($demoState?.packs ?? []) as DemoPack[]);
	let recommendation = $derived(selectNextRecommendation(packs));

	async function refreshPriority() {
		await refreshDemoState();
	}

	onMount(() => registerPageTools(document, [
		createPriorityRecommendationTool(() => recommendation)
	]));
</script>

<svelte:head>
	<title>Priority — Wornpage Projects™</title>
	<meta
		name="description"
		content="Read the single highest-priority actionable work recommendation from the visible Projects workspace."
	/>
</svelte:head>

<WornPage
	sectionLabel="Recommended next · Read only"
	title="Priority"
	status={recommendation ? '1 recommendation' : undefined}
	loading={$demoState === null || ($demoStateLoading && packs.length === 0)}
>
	{#if $demoStateError}
		<WornError
			message="Could not load Priority"
			detail={$demoStateError}
			onretry={refreshPriority}
		/>
	{/if}

	{#if recommendation}
		<section
			class="priority-recommendation"
			data-priority-next-recommendation
			aria-labelledby="priority-recommendation-title"
		>
			<p class="priority-kicker">Next recommendation</p>
			<h2 id="priority-recommendation-title">{recommendation.title}</h2>
			<p class="priority-reason">{recommendation.reason}</p>
			{#if !__NEBIUS_EDITION__}
			<dl>
				<div>
					<dt>Work ID</dt>
					<dd>{recommendation.id}</dd>
				</div>
				<div>
					<dt>Destination</dt>
					<dd class="priority-destination">{recommendation.href}</dd>
				</div>
			</dl>
			{/if}
			<WornButton href={recommendation.href} variant="primary">{__NEBIUS_EDITION__ ? 'Open next step' : 'Open next action'}</WornButton>
		</section>
	{:else if $demoState !== null && !$demoStateLoading && !$demoStateError}
		<WornEmpty
			title="No actionable recommendation"
			description={__NEBIUS_EDITION__ ? 'No task is ready to start. Check Work for blockers, drafts or pending decisions.' : 'No loaded, non-archived work item is active, unblocked, dependency-ready, and free of a pending decision.'}
		>
			<WornButton href="/work" variant="primary">Open Work</WornButton>
		</WornEmpty>
	{/if}
</WornPage>

<style>
	.priority-recommendation {
		align-items: start;
		background: var(--worn-surface);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius);
		display: grid;
		gap: 14px;
		max-width: 760px;
		padding: clamp(18px, 4vw, 30px);
	}

	.priority-kicker {
		color: var(--worn-text-muted);
		font-family: var(--font-typewriter);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		margin: 0;
		text-transform: uppercase;
	}

	h2 {
		color: var(--worn-text);
		font-size: clamp(24px, 4vw, 36px);
		line-height: 1.15;
		margin: 0;
	}

	.priority-reason {
		color: var(--worn-text-secondary);
		font-size: 17px;
		line-height: 1.55;
		margin: 0;
	}

	dl {
		display: grid;
		gap: 10px;
		margin: 4px 0;
	}

	dl div {
		display: grid;
		gap: 4px;
		grid-template-columns: minmax(88px, max-content) minmax(0, 1fr);
	}

	dt {
		color: var(--worn-text-muted);
		font-family: var(--font-typewriter);
		font-size: 12px;
		font-weight: 700;
	}

	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.priority-destination {
		color: var(--worn-text-secondary);
		font-family: var(--font-typewriter);
		font-size: 15px;
		line-height: 1.5;
	}

	.priority-recommendation :global(.worn-btn) {
		justify-self: start;
	}

	@media (max-width: 520px) {
		dl div {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
