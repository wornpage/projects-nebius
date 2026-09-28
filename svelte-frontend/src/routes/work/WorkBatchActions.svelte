<script lang="ts">
	import { tick } from 'svelte';
	import type { SvelteSet } from 'svelte/reactivity';
	import {
		actionBusy,
		displayToast,
		runPackBatchAction,
		ChallengeStateError
	} from '$lib/demo-client';
	import { buildBatchUndoSnapshot, commitActionUndo } from '$lib/undo';
	import { WornButton } from '$lib/components';
	import type { DemoPack } from '$lib/demo-workflow';
	import WorkDeleteConfirmDialog from '$lib/WorkDeleteConfirmDialog.svelte';

	type BatchAction = 'done' | 'start' | 'block' | 'delete';

	interface Props {
		active: boolean;
		packs: DemoPack[];
		selected: SvelteSet<string>;
		busyId: string;
		errorText: string;
	}

	let {
		active,
		packs,
		selected,
		busyId = $bindable(),
		errorText = $bindable()
	}: Props = $props();

	let busyAction = $state<BatchAction | null>(null);
	let deleteDialogOpen = $state(false);
	let deleteTarget = $state<{ ids: string[]; count: number } | null>(null);
	let deleteReturnFocus = $state<HTMLElement | null>(null);
	let deleteFallbackFocus = $state<HTMLElement | null>(null);
	let hasDraftSelected = $derived(
		selected.size > 0 && packs.some((pack) => selected.has(pack.id!) && !pack.archived && pack.status === 'draft')
	);
	let hasIncompleteSelected = $derived(
		selected.size > 0 && packs.some((pack) => selected.has(pack.id!) && !pack.archived && pack.status !== 'done')
	);
	let hasBlockableSelected = $derived(
		selected.size > 0 && packs.some((pack) => selected.has(pack.id!) && !pack.archived && pack.status !== 'done' && pack.status !== 'blocked')
	);

	async function focusBatchModeToggle() {
		await tick();
		const batchToggle = document.querySelector<HTMLElement>('[data-action="batch-mode"]');
		if (
			batchToggle?.isConnected &&
			batchToggle.getClientRects().length > 0 &&
			!batchToggle.matches(':disabled, [aria-disabled="true"]')
		) {
			batchToggle.focus({ preventScroll: true });
		}
	}

	async function clearSelection() {
		if (busyId === 'batch' || selected.size === 0) return;
		selected.clear();
		await focusBatchModeToggle();
	}

	function requestDelete(event: MouseEvent) {
		if (busyId || selected.size === 0) return;
		const ids = [...selected];
		deleteTarget = { ids, count: ids.length };
		deleteReturnFocus = event.currentTarget as HTMLElement;
		deleteFallbackFocus = document.querySelector<HTMLElement>('[data-action="batch-mode"]');
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		const target = deleteTarget;
		if (!target) return;
		await runBatchAction('delete', target.ids, false);
		deleteTarget = null;
	}

	async function runBatchAction(
		action: BatchAction,
		selectedIds = [...selected],
		reportError = true
	) {
		if (selectedIds.length === 0 || busyId) return;
		busyId = 'batch';
		busyAction = action;
		errorText = '';
		let completedBatchAction = false;
		const undoSnapshot = action === 'delete' ? null : buildBatchUndoSnapshot(packs, selectedIds, action);
		try {
			const result = await runPackBatchAction(selectedIds, action);
			if (!result) throw new ChallengeStateError('The batch action returned no receipt.');
			commitActionUndo(result.appliedCount > 0 ? undoSnapshot : null);
			displayToast(result.receipt.summary || 'Batch action complete.', 'success');
			selected.clear();
			completedBatchAction = true;
		} catch (error) {
			const message = error instanceof ChallengeStateError
				? error.message
				: 'The batch action failed — the local state is unchanged.';
			if (reportError) errorText = message;
			else throw new Error(message);
		} finally {
			busyAction = null;
			busyId = '';
			actionBusy.set('');
		}
		if (completedBatchAction && action !== 'delete') await focusBatchModeToggle();
	}
</script>

{#if active}
	<div class="demo-batch-bar" class:is-active={selected.size > 0} role="toolbar" aria-label="Batch actions">
		<span class="demo-batch-count" aria-live="polite" aria-atomic="true">{selected.size} selected</span>
		<WornButton size="sm" type="button" data-action="batch-done" disabled={!hasIncompleteSelected || busyId === 'batch'} onclick={() => runBatchAction('done')}>{busyAction === 'done' ? 'Finishing…' : 'Done'}</WornButton>
		<WornButton size="sm" type="button" data-action="batch-start" disabled={!hasDraftSelected || busyId === 'batch'} onclick={() => runBatchAction('start')}>{busyAction === 'start' ? 'Starting…' : 'Start'}</WornButton>
		<WornButton size="sm" type="button" data-action="batch-block" disabled={!hasBlockableSelected || busyId === 'batch'} onclick={() => runBatchAction('block')}>{busyAction === 'block' ? 'Blocking…' : 'Block'}</WornButton>
		<WornButton variant="danger" size="sm" type="button" data-action="batch-delete" disabled={selected.size === 0 || busyId === 'batch'} onclick={requestDelete}>Delete</WornButton>
		<WornButton size="sm" type="button" data-action="batch-clear" disabled={selected.size === 0 || busyId === 'batch'} onclick={clearSelection}>Deselect</WornButton>
	</div>
{/if}

<WorkDeleteConfirmDialog
	bind:open={deleteDialogOpen}
	selectedCount={deleteTarget?.count || 0}
	returnFocus={deleteReturnFocus}
	fallbackFocus={deleteFallbackFocus}
	onconfirm={confirmDelete}
/>

<style>
	@media (min-width: 421px) {
		.demo-batch-bar {
			align-items: center;
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			min-width: 0;
			padding: 8px;
		}
	}
	@media (max-width: 420px) {
		.demo-batch-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; min-width: 0; }
		.demo-batch-count { grid-column: 1 / -1; }
		.demo-batch-bar :global(.worn-btn) { min-width: 0; width: 100%; }
	}
</style>
