<script lang="ts">
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import { WornButton, WornDialog, WornIconButton, WornKbd } from '$lib/components';

	let { open = $bindable(false) }: { open?: boolean } = $props();
	const NEBIUS_EDITION = typeof __NEBIUS_EDITION__ !== 'undefined' && __NEBIUS_EDITION__;

	function handleShortcutKey(event: KeyboardEvent) {
		if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return;
		if (!open && document.querySelector('[aria-modal="true"], dialog[open]')) return;
		const target = event.target as HTMLElement | null;
		const tag = target?.tagName;
		if (!open && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable)) return;
		event.preventDefault();
		open = !open;
	}
</script>

<svelte:window onkeydown={handleShortcutKey} />

<WornIconButton size="sm" label="Keyboard shortcuts" title="Keyboard shortcuts (?)" aria-haspopup="dialog" aria-expanded={open} data-action="work-shortcuts" onclick={() => (open = true)}>
	<Keyboard aria-hidden="true" />
</WornIconButton>

<WornDialog bind:open title="Keyboard shortcuts" size="sm">
	<p class="shortcut-help">Card shortcuts apply while a work card has focus. In batch mode, Enter or Space toggles its selection.</p>
	<dl class="shortcut-grid">
		<dt><WornKbd keys={['↑ / ↓']} /></dt><dd>Navigate</dd>
		<dt><WornKbd keys={['D']} /></dt><dd>Mark done</dd>
		<dt><WornKbd keys={['B']} /></dt><dd>Mark blocked</dd>
		<dt><WornKbd keys={['O / Enter']} /></dt><dd>{NEBIUS_EDITION ? 'Open task' : 'Open next-action editor'}</dd>
		<dt><WornKbd keys={['Space']} /></dt><dd>Run the card’s primary action</dd>
		<dt><WornKbd keys={['F']} /></dt><dd>Toggle focus mode</dd>
		<dt><WornKbd keys={['/']} /></dt><dd>Search when available</dd>
		<dt><WornKbd keys={['C / N']} /></dt><dd>{NEBIUS_EDITION ? 'Open Add work' : 'Focus quick-add when available'}</dd>
		<dt><WornKbd keys={['Esc']} /></dt><dd>Close / blur search</dd>
		<dt><WornKbd keys={['?']} /></dt><dd>Toggle help</dd>
	</dl>
	<div class="shortcut-actions">
		<WornButton variant="primary" type="button" onclick={() => (open = false)}>Close</WornButton>
	</div>
</WornDialog>

<style>
	.shortcut-help{color:var(--worn-text-secondary);font-size:13px;line-height:1.5;margin:0 0 16px}
	.shortcut-grid{align-items:center;display:grid;font-size:13px;gap:8px 16px;grid-template-columns:minmax(0,max-content) minmax(0,1fr);line-height:1.5;margin-bottom:18px}
	.shortcut-grid dt,.shortcut-grid dd{margin:0;min-width:0;overflow-wrap:anywhere}
	.shortcut-grid dt{text-align:right}
	.shortcut-actions{display:flex;justify-content:flex-end}
	.shortcut-actions :global(.worn-btn){min-height:44px}
</style>
