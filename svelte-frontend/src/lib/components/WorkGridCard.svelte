<script lang="ts">
	import type { Snippet } from 'svelte';
	import { WornButton } from '$lib/components';
	import {
		PACK_ACTIONS,
		blockerText,
		dueDateLabel,
		dueUrgency,
		hasBlocker,
		packStatusLabel,
		primaryCommand,
		primaryCommandNavigation,
		canSetNextAction,
		workTitle,
		type DemoPack
	} from '$lib/demo-workflow';

	const NEBIUS_EDITION = typeof __NEBIUS_EDITION__ !== 'undefined' && __NEBIUS_EDITION__;

	let {
		pack,
		index,
		selectedId,
		focusedIndex,
		batchMode,
		batchSelected,
		busyId,
		batchCheckbox,
		onCardClick,
		onCardKeydown,
		onCardFocus,
		onPrimaryMutation
	}: {
		pack: DemoPack;
		index: number;
		selectedId?: string;
		focusedIndex: number;
		batchMode: boolean;
		batchSelected: boolean;
		busyId: string;
		batchCheckbox: Snippet<[DemoPack]>;
		onCardClick: (event: MouseEvent, packId: string) => void;
		onCardKeydown: (event: KeyboardEvent, index: number) => void;
		onCardFocus: (index: number) => void;
		onPrimaryMutation: (pack: DemoPack, action: string) => void;
	} = $props();
	let cmd = $derived(primaryCommand(pack));
	let commandHref = $derived(PACK_ACTIONS.has(cmd.action) ? undefined : primaryCommandNavigation(pack));
	let titleHref = $derived(canSetNextAction(pack) ? `/next?pack=${encodeURIComponent(pack.id || '')}` : null);
	let statusLabel = $derived(packStatusLabel(pack.status));

</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	role="listitem"
	tabindex={focusedIndex === index ? 0 : -1}
	class="demo-grid-card demo-focus-surface"
	class:selected={pack.id === selectedId}
	class:is-done={pack.status === 'done'}
	class:is-blocked={hasBlocker(pack)}
	class:is-batch-checked={batchSelected}
	class:batch-active={batchMode}
	aria-current={pack.id === selectedId ? 'true' : undefined}
	data-pack-id={pack.id}
	data-work-item
	onclick={(event) => onCardClick(event, pack.id!)}
	onkeydown={(event) => onCardKeydown(event, index)}
	onfocus={() => onCardFocus(index)}
>
	{#if batchMode}
		{@render batchCheckbox(pack)}
	{/if}
	{#if titleHref}
		<a class="grid-card-title" href={titleHref} aria-label={`Set the next action for ${workTitle(pack)}`}>{workTitle(pack)}</a>
	{:else}
		<span class="grid-card-title" data-work-terminal-title>{workTitle(pack)}</span>
	{/if}
	<div class="grid-card-meta">
		{#if pack.owner}
			<span>{pack.owner}</span>
		{/if}
		<span class="grid-card-status">{statusLabel}</span>
		{#if pack.due}
			<span class="due-{dueUrgency(pack)}">{dueDateLabel(pack)}</span>
		{/if}
	</div>
	{#if hasBlocker(pack)}
		<div class="grid-card-facts">
			<span class="grid-card-fact">
				<span class="grid-card-fact-label">Blocked</span>
				<strong>{blockerText(pack)}</strong>
			</span>
		</div>
	{/if}
	{#if NEBIUS_EDITION && pack.nextStep}
		<div class="grid-card-facts" data-nebius-written-next-step>
			<span class="grid-card-fact">
				<span class="grid-card-fact-label">Next step</span>
				<strong>{pack.nextStep}</strong>
			</span>
		</div>
	{/if}
	{#if canSetNextAction(pack) && (!commandHref || commandHref !== titleHref)}
	<div class="grid-card-quick">
		{#if commandHref}
			<WornButton data-work-primary-navigation href={commandHref} size="sm" variant="primary"
				aria-label={`${cmd.label} for ${workTitle(pack)}`}
				title={cmd.label}
				data-action={cmd.action}
				onclick={(event) => { event.stopPropagation(); }}
			>{cmd.label}</WornButton>
		{:else}
			<WornButton data-work-primary-mutation type="button" size="sm" variant="primary"
				aria-label={`${cmd.label} for ${workTitle(pack)}`}
				title={cmd.label}
				data-action={cmd.action}
				onclick={(event) => { event.stopPropagation(); onPrimaryMutation(pack, cmd.action); }}
				disabled={busyId === pack.id}
			>{busyId === pack.id ? '…' : cmd.label}</WornButton>
		{/if}
	</div>
	{/if}
</div>

<style>
	.demo-grid-card{position:relative;min-width:0;padding:8px 10px;background:var(--worn-surface);border:1px solid var(--worn-border);border-radius:var(--worn-radius);display:flex;flex-direction:column;gap:4px;transition:box-shadow .1s ease,background .1s ease,border-color .12s;font-size:12px;min-height:44px;overflow:hidden;cursor:pointer}
	@media (hover: hover) and (pointer: fine) {
		.demo-grid-card:hover{border-color:var(--worn-border-strong);box-shadow:var(--worn-shadow-md)}
		.demo-grid-card .grid-card-title:hover{color:var(--worn-link)}
		.demo-grid-card.is-blocked:hover{background:color-mix(in srgb,var(--worn-warning-bg)70%,var(--worn-surface))}
	}
	.demo-grid-card .grid-card-title{min-width:0;max-width:100%;font-size:14px;font-weight:560;line-height:1.3;border:0;background:0;padding:0;text-align:left;color:var(--worn-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;font-family:inherit;min-height:unset}
	.demo-grid-card .grid-card-meta{display:flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--worn-text-muted);font-family:var(--font-typewriter)}
	.demo-grid-card .grid-card-meta > span{padding:0 4px;border-radius:2px;font-size:11px;font-weight:560;background:var(--worn-surface);border:1px solid var(--worn-border);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
	.grid-card-status{background:none;border:1px solid var(--worn-border);border-radius:2px;cursor:default;font-size:11px;font-weight:560;padding:0 4px;min-height:unset;line-height:1.6;color:var(--worn-text-muted);font-family:var(--font-typewriter)}
	.is-done .grid-card-status{background:var(--worn-success-bg);border-color:var(--worn-success-border);color:var(--worn-success-text)}
	.grid-card-facts{display:flex;gap:8px;flex-wrap:wrap;padding:2px 0}
	.grid-card-fact{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px;align-items:start;font-size:12px;font-family:var(--font-typewriter);color:var(--worn-text-muted);min-width:0;max-width:100%;width:100%;overflow:visible;white-space:normal}
	.grid-card-fact-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0;color:var(--worn-text-muted)}
	.grid-card-fact strong{font-size:12px;font-weight:550;color:var(--worn-text);min-width:0;overflow:visible;overflow-wrap:anywhere;text-overflow:clip;white-space:normal}
	.grid-card-quick{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;padding-top:2px;border-top:1px solid var(--worn-border);min-width:0;max-width:100%}
	@media (max-width: 800px) {
		.demo-grid-card { box-sizing: border-box; font-size: 14px; gap: 8px; inline-size: 100%; max-inline-size: 100%; padding: 12px; }
		.demo-grid-card .grid-card-title { box-sizing: border-box; display: block; font-size: 16px; line-height: 1.35; min-height: 44px; max-inline-size: 100%; overflow: visible; overflow-wrap: anywhere; padding: 10px 0; text-overflow: clip; white-space: normal; word-break: break-word; }
		.demo-grid-card .grid-card-meta { gap: 6px; }
		.demo-grid-card .grid-card-meta > span, .grid-card-status, :global(.demo-grid-card .grid-card-meta .worn-badge) { font-size: 13px; line-height: 1.6; max-inline-size: 100%; }
		.grid-card-facts { gap: 6px; padding: 4px 0; }
		.grid-card-fact { display: grid; font-size: 14px; gap: 6px; grid-template-columns: auto minmax(0, 1fr); max-width: 100%; overflow: visible; overflow-wrap: anywhere; text-overflow: clip; white-space: normal; word-break: break-word; }
		.grid-card-fact-label { font-size: 12px; }
		.grid-card-fact strong { font-size: 14px; overflow: visible; overflow-wrap: anywhere; text-overflow: clip; white-space: normal; word-break: break-word; }
		.grid-card-quick { gap: 6px; margin-top: 4px; padding-top: 6px; }
		:global(.demo-grid-card [data-work-primary-navigation]), :global(.demo-grid-card [data-work-primary-mutation]) { box-sizing: border-box; flex: 1 1 auto; font-size: 14px; min-width: 0; max-inline-size: 100%; overflow-wrap: anywhere; }
	}
	:global(.demo-batch-check-slot){position:absolute;z-index:2;inset-block-start:8px;inset-inline-start:8px}
	.demo-grid-card.batch-active .grid-card-title{display:block;box-sizing:border-box;inline-size:calc(100% - 52px);margin-inline-start:52px;min-block-size:44px}
	.demo-grid-card:active{background:color-mix(in srgb,var(--worn-accent)15%,var(--worn-surface));transition:background 0s}
	:global(.focus-mode) .demo-grid-card:not(.selected){border-color:var(--worn-border);box-shadow:none}:global(.focus-mode) .demo-grid-card.selected{border-color:var(--worn-accent);box-shadow:0 0 0 1px var(--worn-accent-50)}
	.demo-grid-card.is-done{background:color-mix(in srgb,var(--worn-success-bg)60%,var(--worn-surface));border-color:var(--worn-success-border);overflow:hidden}
	.demo-grid-card.is-blocked{background:color-mix(in srgb,var(--worn-warning-bg)60%,var(--worn-surface));border-color:var(--worn-warning-border,#fdba74)}
	.is-blocked .grid-card-fact-label{color:var(--worn-warning-text,#a85200)}
	.demo-grid-card.selected{border-color:var(--worn-accent);box-shadow:0 0 0 1px var(--worn-accent-50);background:color-mix(in srgb,var(--worn-accent)4%,var(--worn-surface))}
	.demo-grid-card.is-batch-checked{border-color:var(--worn-accent);box-shadow:0 0 0 1px var(--worn-accent);background:color-mix(in srgb,var(--worn-accent)6%,var(--worn-surface))}
</style>
