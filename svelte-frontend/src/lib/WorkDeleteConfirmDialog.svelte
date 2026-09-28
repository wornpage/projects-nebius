<script lang="ts">
	import { tick } from 'svelte';
	import { WornButton, WornDialog } from '$lib/components';

	interface Props {
		open?: boolean;
		itemTitle?: string | null;
		selectedCount?: number;
		returnFocus?: HTMLElement | null;
		fallbackFocus?: HTMLElement | null;
		onconfirm: () => Promise<void>;
	}

	let {
		open = $bindable(false),
		itemTitle = null,
		selectedCount = 0,
		returnFocus = null,
		fallbackFocus = null,
		onconfirm
	}: Props = $props();

	let busy = $state(false);
	let error = $state('');
	let isBatch = $derived(selectedCount > 0);
	let batchItemNoun = $derived(selectedCount === 1 ? 'work item' : 'work items');
	let title = $derived(isBatch ? `Delete ${selectedCount.toLocaleString()} ${batchItemNoun}?` : 'Delete work item?');
	let confirmLabel = $derived(isBatch ? `Delete ${selectedCount.toLocaleString()} ${batchItemNoun}` : 'Delete work item');

	async function restoreFocus() {
		await tick();
		const target = [returnFocus, fallbackFocus].find((candidate) =>
			candidate?.isConnected &&
			candidate.getClientRects().length > 0 &&
			!candidate.matches(':disabled, [aria-disabled="true"]')
		);
		target?.focus({ preventScroll: true });
	}

	function dismiss() {
		if (busy) return;
		open = false;
		error = '';
		void restoreFocus();
	}

	async function confirm() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await onconfirm();
			open = false;
			await restoreFocus();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not delete the selected work.';
		} finally {
			busy = false;
		}
	}
</script>

<WornDialog bind:open title={title} size="sm" dismissible={!busy} onclose={dismiss}>
	{#if isBatch}
		<p class="work-delete-copy"><strong>{selectedCount.toLocaleString()}</strong> selected {batchItemNoun} will be permanently deleted.</p>
	{:else}
		<p class="work-delete-copy"><strong>{itemTitle || 'Untitled work item'}</strong> will be permanently deleted.</p>
	{/if}
	{#if error}
		<p class="work-delete-error" role="alert">{error}</p>
	{/if}
	<div class="work-delete-actions" aria-label="Delete work confirmation actions">
		<WornButton type="button" disabled={busy} onclick={dismiss}>Cancel</WornButton>
		<WornButton type="button" variant="danger" aria-disabled={busy} aria-busy={busy} onclick={confirm}>{busy ? 'Deleting...' : confirmLabel}</WornButton>
	</div>
</WornDialog>

<style>
	.work-delete-copy {
		margin: 0 0 12px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.work-delete-error {
		background: var(--worn-danger-bg);
		border: 1px solid var(--worn-danger-border);
		color: var(--worn-danger-text);
		margin: 0 0 12px;
		overflow-wrap: anywhere;
		padding: 8px 10px;
	}
	.work-delete-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}
	@media (max-width: 400px) {
		.work-delete-actions {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}
		.work-delete-actions :global(.worn-btn) {
			width: 100%;
		}
	}
</style>
