<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		WornAccordion,
		WornBadge,
		WornButton,
		WornFoldedSurface,
		WornReactionButton,
		WornSelect
	} from '$lib/components';
	import {
		ENERGY_OPTIONS,
		PACK_ACTIONS,
		blockerText,
		dueDateLabel,
		dueUrgency,
		energyLabel,
		hasBlocker,
		ownerLabel,
		packAge,
		primaryCommand,
		primaryCommandNavigation,
		workflowCardClass,
		workflowLabel,
		canSetNextAction,
		workTitle,
		type DemoPack
	} from '$lib/demo-workflow';

	const REACTION_EMOJI = ['👍', '🎉', '🚀', '😅', '🔥'] as const;
	const NEBIUS_EDITION = typeof __NEBIUS_EDITION__ !== 'undefined' && __NEBIUS_EDITION__;
	const SNOOZE_OPTIONS = [
		{ value: '', label: 'Snooze' },
		{ value: '1', label: '1 day' },
		{ value: '3', label: '3 days' },
		{ value: '7', label: '7 days' }
	];
	const ENERGY_ACTION_OPTIONS = [
		{ value: '', label: 'Set energy', disabled: true },
		...ENERGY_OPTIONS
	];
	const instanceId = $props.id();
	const energySelectId = `${instanceId}-energy`;

	function displayedTypeLabel(value: unknown): string {
		return String(value ?? '');
	}
	function hasDistinctType(value: unknown): boolean {
		const type = displayedTypeLabel(value).trim().toLowerCase();
		return Boolean(type) && type !== 'general' && type !== 'task';
	}
	function typeAndAreaMatch(type: unknown, area: unknown): boolean {
		if (!hasDistinctType(type) || !area) return false;
		return displayedTypeLabel(type).trim().toLowerCase() === String(area).trim().toLowerCase();
	}

	let {
		pack,
		index,
		selectedId,
		focusedIndex,
		batchMode,
		busyId,
		busyAction,
		batchCheckbox,
		receipt,
		receiptUndo,
		snoozeDays,
		onCardClick,
		onCardKeydown,
		onCardFocus,
		onDragStart,
		onDragOver,
		onDragEnd,
		onDrop,
		onTrackRecent,
		onPrimaryMutation,
		onAction,
		onTogglePin,
		onApplySnooze,
		onRepeatPack,
		onReactPack,
		onUndoReceipt,
		onSetEnergy
	}: {
		pack: DemoPack;
		index: number;
		selectedId?: string;
		focusedIndex: number;
		batchMode: boolean;
		busyId: string;
		busyAction: string;
		batchCheckbox: Snippet<[DemoPack]>;
		receipt: { pack?: { id?: string }; summary?: string } | null;
		receiptUndo: { packId: string } | null;
		snoozeDays: Record<string, string>;
		onCardClick: (event: MouseEvent, packId: string) => void;
		onCardKeydown: (event: KeyboardEvent, index: number) => void;
		onCardFocus: (index: number) => void;
		onDragStart: (event: DragEvent, packId: string) => void;
		onDragOver: (event: DragEvent, packId: string) => void;
		onDragEnd: () => void;
		onDrop: (event: DragEvent, packId: string) => void;
		onTrackRecent: (packId: string) => void;
		onPrimaryMutation: (pack: DemoPack, action: string) => void;
		onAction: (pack: DemoPack, action: string) => void;
		onTogglePin: (pack: DemoPack) => void;
		onApplySnooze: (pack: DemoPack, key: string) => void;
		onRepeatPack: (pack: DemoPack) => void;
		onReactPack: (pack: DemoPack, emoji: string) => void;
		onUndoReceipt: () => void;
		onSetEnergy: (pack: DemoPack, energy: string) => void | Promise<void>;
	} = $props();

	let command = $derived(primaryCommand(pack));
	let commandHref = $derived(PACK_ACTIONS.has(command.action) ? undefined : primaryCommandNavigation(pack));
	let titleHref = $derived(NEBIUS_EDITION ? `/next?pack=${encodeURIComponent(pack.id || '')}${canSetNextAction(pack) ? '' : '&view=review'}` : canSetNextAction(pack) ? `/next?pack=${encodeURIComponent(pack.id || '')}` : null);
	let titleLabel = $derived(NEBIUS_EDITION ? `${canSetNextAction(pack) ? 'Open task' : 'View task history for'} ${workTitle(pack)}` : `Set the next action for ${workTitle(pack)}`);
	let workflow = $derived(workflowLabel(pack));
	let cardCls = $derived(workflowCardClass(pack, false, false));
	let packKey = $derived(pack.id || '');
	let executionLabel = $derived.by(() => {
		if (!NEBIUS_EDITION || !pack.executionRun) return '';
		if (!canSetNextAction(pack)) return 'View saved run';
		const status = pack.executionRun.record?.status;
		if (status === 'ready') return 'Tool ready for review';
		if (status === 'queued') return 'Run queued';
		if (status === 'generating') return 'Building tool';
		if (status === 'checking') return 'Checking tool';
		if (status === 'repairing') return 'Repairing tool';
		if (status === 'cancelling') return 'Cancellation requested';
		if (status === 'cancelled') return 'Run cancelled';
		if (status === 'failed') return 'Run needs attention';
		return 'Check run status';
	});

	function focusCardForKeyboardMove(event: MouseEvent) {
		(event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('[data-work-item][data-pack-id]')?.focus();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<!-- The card-level click only augments batch mode; the keyboard path is the explicit role="checkbox" button rendered with it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<WornFoldedSurface
	as="article"
	reveal="hover"
	class={`demo-work-card demo-focus-surface ${cardCls}${pack.id === selectedId ? ' selected' : ''}${batchMode ? ' batch-active' : ''}`}
	tabindex={focusedIndex === index ? 0 : -1}
	aria-label={`Work ${workTitle(pack)}`}
	aria-current={pack.id === selectedId ? 'true' : undefined}
	data-pack-id={pack.id}
	data-work-item
	ondragover={(event) => onDragOver(event, pack.id!)}
	ondrop={(event) => onDrop(event, pack.id!)}
	onclick={(event) => onCardClick(event, pack.id!)}
	onkeydown={(event) => onCardKeydown(event, index)}
	onfocus={() => onCardFocus(index)}
>
	{#if batchMode}
		{@render batchCheckbox(pack)}
	{/if}
	<div class="demo-card-head">
		{#if titleHref}
		<a class="demo-card-title" data-action="select" data-pack={pack.id} title={titleLabel} aria-label={titleLabel} href={titleHref} onclick={() => onTrackRecent(pack.id!)}>
			{#if pack.pinned}<span class="demo-pin-flag" role="img" title="Pinned to the top of the list" aria-label="Pinned"></span>{/if}
			{workTitle(pack)}
		</a>
		{:else}
		<span class="demo-card-title" data-work-terminal-title>
			{#if pack.pinned}<span class="demo-pin-flag" role="img" title="Pinned to the top of the list" aria-label="Pinned"></span>{/if}
			{workTitle(pack)}
		</span>
		{/if}
		{#if hasDistinctType(pack.type)}
			<span class="demo-type-badge" data-type={pack.type}>{displayedTypeLabel(pack.type)}</span>
			<span class="demo-age">{packAge(pack)}</span>
		{/if}
		<WornBadge label={workflow} />
		{#if NEBIUS_EDITION && pack.id === selectedId}<span class="demo-work-selected" aria-hidden="true">Selected</span>{/if}
		{#if pack.decision && pack.status !== 'done'}
			<WornBadge variant="warn" label="Needs decision" title={pack.decider ? `Decision needed from ${pack.decider}` : 'Decision needed'} />
		{/if}
		<button
			type="button"
			class="work-card-move-handle"
			draggable="true"
			data-work-drag-handle
			aria-label={`Move ${workTitle(pack)}. Drag to reorder or change energy; activate for keyboard move controls.`}
			title="Drag to reorder or change energy. Activate for keyboard move controls."
			ondragstart={(event) => onDragStart(event, pack.id!)}
			ondragend={onDragEnd}
			onclick={focusCardForKeyboardMove}
		>Move</button>
	</div>
	{#if NEBIUS_EDITION && !canSetNextAction(pack)}
		<p data-nebius-task-history>{pack.archived ? 'Archived task.' : 'Completed task.'}</p>
		{#if pack.nextStep || hasBlocker(pack)}
			<details data-nebius-historical-context>
				<summary>Previous task context</summary>
				{#if pack.nextStep}<p><b>Previous next step:</b> {pack.nextStep}</p>{/if}
				{#if hasBlocker(pack)}<p><b>Previous blocker:</b> {blockerText(pack)}</p>{/if}
			</details>
		{/if}
	{:else}
	{#if hasBlocker(pack)}
		<div class="demo-card-facts" role="group" aria-label="Blocker: {blockerText(pack)}.">
			<div class="demo-card-fact"><span>Blocker</span><strong>{blockerText(pack)}</strong></div>
		</div>
	{/if}
	{#if NEBIUS_EDITION && pack.nextStep}
		<div class="demo-card-facts" data-nebius-written-next-step>
			<div class="demo-card-fact"><span>Next step</span><strong>{pack.nextStep}</strong></div>
		</div>
	{/if}
	{/if}
	{#if executionLabel}
		<div class="demo-card-facts" data-nebius-run-status>
			<div class="demo-card-fact"><span>Last run update</span><a href={pack.executionRun?.record?.status === 'ready' || (NEBIUS_EDITION && !canSetNextAction(pack)) ? (NEBIUS_EDITION ? `/next?pack=${encodeURIComponent(packKey)}&view=review` : `/review?focus=${encodeURIComponent(packKey)}`) : (NEBIUS_EDITION ? `/next?pack=${encodeURIComponent(packKey)}&view=tool#nebius-task-run` : `/next?pack=${encodeURIComponent(packKey)}#nebius-task-run`)}>{executionLabel}</a></div>
		</div>
	{/if}
	{#if canSetNextAction(pack) && (!commandHref || commandHref !== titleHref)}
	<div class="work-command-row">
		{#if commandHref}
			<WornButton data-work-primary-navigation variant="primary" href={commandHref} aria-label={`${command.label} for ${workTitle(pack)}`} data-action="run-next" data-pack={pack.id}>
				{command.label}
			</WornButton>
		{:else}
			<WornButton data-work-primary-mutation type="button" variant="primary" data-action="run-next" data-pack={pack.id}
				aria-label={`${command.label} for ${workTitle(pack)}`}
				disabled={busyId === pack.id}
				onclick={() => onPrimaryMutation(pack, command.action)}
			>
				{busyId === pack.id ? 'Running…' : command.label}
			</WornButton>
		{/if}
	</div>
	{/if}
	<div class="demo-card-meta">
		{#if pack.due}<span class="due-{dueUrgency(pack)}">{dueDateLabel(pack)}</span>{/if}
		{#if pack.area && !typeAndAreaMatch(pack.type, pack.area)}<WornBadge variant="muted" label={pack.area} />{/if}
		{#if pack.recurrence && pack.recurrence !== 'none'}
			<WornBadge size="sm" label={pack.recurrence.charAt(0).toUpperCase() + pack.recurrence.slice(1)} />
		{/if}
		<span class="demo-owner-text">{ownerLabel(pack.owner)}</span>
	</div>
	{#if pack.status === 'done' && !pack.archived}
		<div class="demo-archive-row">
			<WornButton size="sm" variant="default" data-action="archive" data-pack={pack.id} disabled={busyId === pack.id} onclick={() => onAction(pack, 'archive')}>Archive</WornButton>
		</div>
	{/if}
	{#if receipt?.pack?.id === pack.id && receipt?.summary}
		<div class="demo-card-receipt" data-receipt-surface="card" data-card-receipt={pack.id} role="group" tabindex="-1">
			<span>Last result</span>
			<strong>{receipt.summary}</strong>
			{#if receiptUndo && receiptUndo.packId === pack.id}
				<WornButton type="button" size="sm" data-receipt-undo title="Undo this action and restore the previous state." onclick={onUndoReceipt}>Undo</WornButton>
			{/if}
		</div>
	{/if}
	{#if REACTION_EMOJI.some((emoji) => ((pack.reactions as Record<string, number>)?.[emoji] ?? 0) > 0)}
		<div class="demo-card-reactions">
			{#each REACTION_EMOJI.filter((emoji) => ((pack.reactions as Record<string, number>)?.[emoji] ?? 0) > 0) as emoji (emoji)}
				<WornReactionButton reaction={emoji} count={(pack.reactions as Record<string, number>)?.[emoji] ?? 0} pressed={true} disabled={busyId === pack.id} onclick={() => onReactPack(pack, emoji)} />
			{/each}
		</div>
	{/if}
	<WornAccordion label="Other actions" description={workTitle(pack)}>
		{#if pack.energy || pack.location || pack.milestone || pack.doneWhen}
			<dl class="demo-card-extra">
				{#if pack.energy}<div><dt>Energy</dt><dd>{energyLabel(String(pack.energy))}</dd></div>{/if}
				{#if pack.location}<div><dt>Location</dt><dd>{pack.location}</dd></div>{/if}
				{#if pack.milestone}<div><dt>Milestone</dt><dd>{pack.milestone}</dd></div>{/if}
				{#if pack.doneWhen}<div><dt>Proof target</dt><dd>{pack.doneWhen}</dd></div>{/if}
			</dl>
		{/if}
		<div class="work-card-energy-control">
			<label for={energySelectId}>Energy</label>
			<WornSelect
				id={energySelectId}
				value={String(pack.energy || '')}
				options={ENERGY_ACTION_OPTIONS}
				data-action="set-energy"
				data-pack={pack.id}
				disabled={busyId === pack.id}
				aria-label={`Set energy for ${workTitle(pack)}`}
				onchange={(event) => onSetEnergy(pack, (event.currentTarget as HTMLSelectElement).value)}
			/>
		</div>
		<div class="demo-card-reactions demo-card-reactions-picker">
			{#each REACTION_EMOJI as emoji (emoji)}
				<WornReactionButton reaction={emoji} count={(pack.reactions as Record<string, number>)?.[emoji] ?? 0} pressed={((pack.reactions as Record<string, number>)?.[emoji] ?? 0) > 0} disabled={busyId === pack.id} onclick={() => onReactPack(pack, emoji)} />
			{/each}
		</div>
		<div class="work-card-actions" onpointerdown={(event) => event.stopPropagation()} onclick={(event) => event.stopPropagation()}>
			<WornButton type="button" size="sm" data-action="open" data-pack={pack.id} disabled={busyId === pack.id && busyAction === 'open'} onclick={() => onAction(pack, 'open')}>Open</WornButton>
			<WornSelect
				class="work-snooze-select"
				bind:value={
					() => snoozeDays[packKey] ?? '',
					(value) => { snoozeDays[packKey] = value; }
				}
				options={SNOOZE_OPTIONS}
				data-action="snooze"
				data-pack={pack.id}
				disabled={busyId === pack.id}
				aria-label={`Snooze ${workTitle(pack)}`}
				onchange={() => onApplySnooze(pack, packKey)}
			/>
			<WornButton type="button" size="sm" data-action="repeat" data-pack={pack.id} disabled={busyId === pack.id} onclick={() => onRepeatPack(pack)}>Repeat</WornButton>
			<WornButton type="button" size="sm" data-action="pin" data-pack={pack.id} aria-pressed={pack.pinned} disabled={busyId === pack.id && busyAction === 'pin'} onclick={() => onTogglePin(pack)} title={pack.pinned ? 'Remove from the top of the list' : 'Keep this at the top of the list'}>{pack.pinned ? 'Unpin' : 'Pin'}</WornButton>
			<WornButton size="sm" data-action="focus" data-pack={pack.id} href={`/work?focus=${encodeURIComponent(pack.id || '')}`}>Focus</WornButton>
			{#if pack.status !== 'done'}
				{#if hasBlocker(pack)}
					<WornButton type="button" size="sm" data-action="unblock" data-pack={pack.id} disabled={busyId === pack.id} onclick={() => onAction(pack, 'unblock')}>Clear blocker</WornButton>
				{:else}
					<WornButton type="button" size="sm" data-action="block" data-pack={pack.id} disabled={busyId === pack.id} onclick={() => onAction(pack, 'block')}>Mark blocked</WornButton>
				{/if}
				<WornButton type="button" size="sm" data-action="done" data-pack={pack.id} disabled={busyId === pack.id} onclick={() => onAction(pack, 'done')}>Mark done</WornButton>
			{/if}
		</div>
	</WornAccordion>
</WornFoldedSurface>

<style>
	[data-nebius-task-history] { color: var(--worn-text-secondary); line-height: 1.5; margin: 4px 0; }
	[data-nebius-historical-context] { color: var(--worn-text-secondary); line-height: 1.5; overflow-wrap: anywhere; }
	[data-nebius-historical-context] summary { cursor: pointer; min-block-size: 44px; align-content: center; }
	.demo-card-extra { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 0 8px; font-size: 12px; }
	.demo-card-extra > div { display: contents; }
	.demo-card-extra dt { color: var(--worn-text-muted); font-family: var(--font-typewriter); }
	.demo-card-extra dd { margin: 0; color: var(--worn-text); }
	.demo-card-reactions { display: flex; gap: 4px; margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--worn-border); }
	.work-command-row, .work-card-actions { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; max-width: 100%; }
	.work-card-move-handle {
		appearance: none;
		background: var(--worn-surface);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius-sm);
		color: var(--worn-text-muted);
		cursor: grab;
		font: inherit;
		font-size: 12px;
		min-height: 44px;
		padding: 5px 8px;
		user-select: none;
	}
	.work-card-move-handle:active { cursor: grabbing; }
	.work-card-move-handle:focus-visible { outline: 2px dashed var(--worn-focus); outline-offset: 2px; }
	.work-card-energy-control { align-items: center; display: flex; gap: 8px; margin-block-start: 8px; max-width: 100%; min-width: 0; }
	.work-card-energy-control label { color: var(--worn-text-muted); font-size: 12px; font-weight: 600; }
	.work-card-energy-control :global(.worn-select) { min-height: 44px; width: min(100%, 220px); }
	.demo-card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; margin-block-start: 8px; }
	.work-command-row :global(.worn-btn), .work-card-actions :global(.worn-btn) { box-sizing: border-box; min-width: 0; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
	.work-card-actions :global(.worn-select) { box-sizing: border-box; min-width: 0; max-width: 100%; }
	:global(.demo-work-card.batch-active) .demo-card-head { min-block-size: 44px; padding-inline-start: 52px; }
	:global(.demo-work-card) { cursor: default; transition: box-shadow .1s ease, background .1s ease; user-select: text; -webkit-user-select: text; }
	/* Both density cards use these generated urgency classes. Keep the visual
	   contract with the list-card component rather than the route shell. */
	:global(.due-overdue) { border-color: var(--worn-danger-border) !important; background: var(--worn-danger-bg) !important; color: var(--worn-danger-text) !important; }
	:global(.due-today) { border-color: var(--worn-warning-border) !important; background: var(--worn-warning-bg) !important; color: var(--worn-warning-text) !important; }
	:global(.due-soon) { border-color: var(--worn-accent) !important; background: var(--worn-accent-50) !important; }
	@media (max-width: 640px) {
		.demo-card-meta { gap: 6px; margin-block-start: 6px; }
		.work-card-energy-control { align-items: stretch; flex-direction: column; }
		.work-card-energy-control :global(.worn-select) { width: 100%; }
		:global(.work-snooze-select) { width: 100%; }
	}
	@media (pointer: coarse) {
		.work-card-move-handle { min-height: 44px; min-width: 44px; }
	}
</style>
