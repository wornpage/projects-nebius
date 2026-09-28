<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Skeleton as WornSkeleton } from '@wornpage/async-states';
	import { FoldedSurface as WornFoldedSurface } from '@wornpage/layout-surfaces';

	type Variant = 'list' | 'edit' | 'hero' | 'login';

	interface Props {
		sectionLabel?: string;
		title?: string;
		status?: string;
		variant?: Variant;
		labelledBy?: string;
		children?: Snippet;
		headActions?: Snippet;
		loading?: boolean;
	}
	const instanceId = $props.id();
	let { sectionLabel, title, status, variant, labelledBy, children, headActions, loading }: Props = $props();
	let sectionLabelId = $derived(sectionLabel ? `${instanceId}-label` : undefined);
	let titleId = $derived(title ? `${instanceId}-title` : undefined);
	let statusId = $derived(status ? `${instanceId}-status` : undefined);
	let routeLabelledBy = $derived(titleId ?? sectionLabelId ?? labelledBy);
</script>

<WornFoldedSurface
	as="section"
	reveal={variant === 'list' ? 'hidden' : 'hover'}
	class={`demo-panel${variant === 'list' ? ' demo-list-panel' : ''}${variant === 'edit' ? ' demo-edit-panel' : ''}${variant === 'hero' ? ' demo-home-hero' : ''}${variant === 'login' ? ' login-panel' : ''}`}
	aria-labelledby={routeLabelledBy}
	aria-describedby={statusId}
>
	{#if sectionLabel || title || status || headActions}
		<div class="demo-panel-head">
			<div class="demo-panel-heading">
				{#if sectionLabel}<span class="section-label" id={sectionLabelId}>{sectionLabel}</span>{/if}
				{#if title}<h1 class="demo-panel-title" id={titleId}>{title}</h1>{/if}
			</div>
			{#if status || headActions}
				<div class="demo-panel-meta">
					{#if status}<span class="demo-status" id={statusId} role="status">{status}</span>{/if}
					{#if headActions}{@render headActions()}{/if}
				</div>
			{/if}
		</div>
	{/if}
	{#if loading}
		<WornSkeleton lines={5} loading={true}><p>Loading…</p></WornSkeleton>
	{:else if children}
		{@render children()}
	{/if}
</WornFoldedSurface>

<style>
	/* WornPage is the Projects route shell. It owns its opaque surface,
	   compact header containment, and direct error-flow spacing here; the
	   remaining .demo-panel variants stay product-specific in demo.css. */
	:global(.demo-panel) {
		box-sizing: border-box;
		max-inline-size: 100%;
		min-inline-size: 0;
		background: var(--worn-surface, #fdfbf7);
	}
	:global(.demo-panel-head),
	:global(.demo-panel-head > *),
	:global(.demo-panel-heading),
	:global(.demo-panel-meta),
	:global(.demo-panel-meta > *),
	:global(.demo-panel-title),
	:global(.demo-status) {
		box-sizing: border-box;
		max-inline-size: 100%;
		min-inline-size: 0;
	}
	:global(.demo-panel-heading) {
		flex: 1 1 0;
	}
	:global(.demo-panel-meta) {
		align-items: center;
		display: flex;
		flex: 0 1 auto;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
		max-inline-size: min(100%, 65%);
	}
	:global(.demo-status) {
		flex: 1 1 20ch;
		max-inline-size: 48ch;
		overflow-wrap: anywhere;
	}
	:global(.demo-panel .worn-error + *) {
		margin-top: var(--worn-page-error-gap, 12px) !important;
	}
	@media (max-width: 700px) {
		:global(.demo-panel-meta) {
			align-items: stretch;
			justify-content: flex-start;
			max-inline-size: 100%;
			width: 100%;
		}
	}
</style>
