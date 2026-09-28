<script lang="ts">
	interface Props {
		workTitle: string;
		decisionContext: {
			mode: 'decision-workspace';
			reason: string;
			decider: string | null;
		} | null;
	}

	let { workTitle, decisionContext }: Props = $props();
</script>

<dl class="next-work-context" data-next-current-work>
	<div>
		<dt>Current work</dt>
		<dd>{workTitle}</dd>
	</div>
	{#if decisionContext}
		<div class="next-decision-context" data-next-decision-context data-next-decision-mode={decisionContext.mode}>
			<dt>Decision workspace context</dt>
			<dd data-next-decision-reason>{decisionContext.reason}</dd>
		</div>
		{#if decisionContext.decider}
			<div data-next-decision-decider>
				<dt>Decision owner</dt>
				<dd>{decisionContext.decider}</dd>
			</div>
		{/if}
	{/if}
</dl>

<style>
	.next-work-context {
		background: var(--worn-bg-secondary);
		border: 1px solid var(--worn-accent);
		border-radius: var(--worn-radius);
		box-sizing: border-box;
		margin: 0 0 14px;
		max-inline-size: 100%;
		min-inline-size: 0;
		padding: 12px 14px;
	}
	.next-work-context > div {
		display: grid;
		gap: 4px;
		min-inline-size: 0;
	}
	.next-work-context > div + div {
		border-top: 1px solid var(--worn-border);
		padding-top: 10px;
	}
	.next-work-context dt,
	.next-work-context dd {
		margin: 0;
		min-inline-size: 0;
	}
	.next-work-context dt {
		color: var(--worn-text-muted);
		font-family: var(--font-typewriter);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.next-work-context dd {
		color: var(--worn-text);
		font-size: 15px;
		font-weight: 700;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	@media (max-width: 500px) {
		.next-work-context {
			padding: 12px;
		}
	}
</style>
