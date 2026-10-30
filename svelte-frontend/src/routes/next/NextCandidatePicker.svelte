<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { setSelectedWork } from '$lib/demo-client';
	import { blockerText, isReview, workTitle, type DemoPack } from '$lib/demo-workflow';
	import { settleProgressiveReveal } from '$lib/progressive-reveal.mjs';
	import { WornAccordion, WornButton } from '$lib/components';

	let {
		packs,
		currentPackId,
		disabled = false,
		onedit
	}: {
		packs: DemoPack[];
		currentPackId: string;
		disabled?: boolean;
		onedit: (candidate: DemoPack) => void;
	} = $props();

	const NEXT_CANDIDATE_RENDER_LIMIT = 100;
	let renderLimit = $state(NEXT_CANDIDATE_RENDER_LIMIT);
	let listRoot = $state<HTMLElement | null>(null);
	let candidates = $derived(packs.filter(isReview).filter((candidate) => candidate.id !== currentPackId));
	let renderedCandidates = $derived(candidates.slice(0, renderLimit));
	let hasMoreCandidates = $derived(renderedCandidates.length < candidates.length);

	async function focusCandidate(candidate: DemoPack) {
		if (!candidate.id || disabled) return;
		try {
			await setSelectedWork(candidate.id);
		} catch {
			// Browser-local selection is a nicety; the explicit Work focus request still owns navigation.
		}
		goto(`/work?focus=${encodeURIComponent(candidate.id)}`);
	}

	async function showMoreCandidates(event: MouseEvent) {
		const trigger = event.currentTarget;
		if (!(trigger instanceof HTMLElement)) return;
		const previousCount = renderedCandidates.length;
		const nextLimit = previousCount + NEXT_CANDIDATE_RENDER_LIMIT;
		const removesTrigger = nextLimit >= candidates.length;
		renderLimit = nextLimit;
		await settleProgressiveReveal({
			settled: tick(),
			removesTrigger,
			trigger,
			getDestination: () => {
				const pulseTarget = listRoot?.querySelectorAll<HTMLElement>('[data-pack-id]')[previousCount];
				const focusTarget = pulseTarget?.querySelector<HTMLElement>('.demo-row-actions button');
				return pulseTarget && focusTarget ? { focusTarget, pulseTarget } : null;
			}
		});
	}
</script>

{#if candidates.length > 0}
	<WornAccordion label={`Choose another item (${candidates.length})`}>
		<div class="demo-list next-other-list" bind:this={listRoot}>
			{#each renderedCandidates as candidate (candidate.id)}
				<div class="demo-row has-row-support" data-pack-id={candidate.id}>
					<div>
						<strong>{workTitle(candidate)}</strong>
						{#if blockerText(candidate) !== 'None'}
							<span>{blockerText(candidate)}</span>
						{/if}
					</div>
					<div class="demo-row-actions">
						<WornButton
							type="button"
							variant="primary"
							size="sm"
							aria-label={`Set next action for ${workTitle(candidate)}`}
							disabled={disabled}
							onclick={() => onedit(candidate)}
						>
							Set next action
						</WornButton>
						<WornButton
							type="button"
							size="sm"
							aria-label={`Focus ${workTitle(candidate)} in Work`}
							disabled={disabled}
							onclick={() => focusCandidate(candidate)}
						>
							Focus in Work
						</WornButton>
					</div>
				</div>
			{/each}
			{#if candidates.length > NEXT_CANDIDATE_RENDER_LIMIT}
				<div class="next-load-more">
					<span aria-live="polite">{renderedCandidates.length} of {candidates.length} shown</span>
					{#if hasMoreCandidates}
						<WornButton type="button" size="sm" data-action="show-more-next-candidates" onclick={showMoreCandidates}>
							Show {Math.min(NEXT_CANDIDATE_RENDER_LIMIT, candidates.length - renderedCandidates.length)} more
						</WornButton>
					{/if}
				</div>
			{/if}
		</div>
	</WornAccordion>
{/if}

<style>
	.demo-row.has-row-support{padding:10px 12px}
	.demo-row.has-row-support > div:first-child{min-width:0;overflow-wrap:anywhere}
	.next-other-list{margin-top:8px}
	.next-load-more{align-items:center;color:var(--worn-text-muted);display:flex;flex-wrap:wrap;font-size:12px;gap:8px;justify-content:flex-end;margin-top:12px}
	@media(max-width:500px){
		.demo-row.has-row-support{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;gap:12px}
		.demo-row-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}
		.demo-row.has-row-support > .demo-row-actions{grid-column:1;justify-self:stretch;align-items:start}
		.demo-row-actions :global(.worn-btn),.next-load-more :global(.worn-btn){min-width:0;width:100%}
		.next-load-more{align-items:stretch;flex-direction:column}
	}
</style>
