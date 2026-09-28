<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { Dialog as BaseDialog } from '@wornpage/dialog';
	import { Collapsible as BaseCollapsible } from '@wornpage/disclosure';

	type SurfaceSize = 'sm' | 'md' | 'lg';

	interface Props {
		open?: boolean;
		title?: string;
		summary?: string;
		onclose?: () => void;
		onchange?: (open: boolean) => void;
		children?: Snippet;
		size?: SurfaceSize;
		dismissible?: boolean;
		ariaLabel?: string;
		panelId?: string;
	}

	let {
		open = $bindable(false),
		title,
		summary,
		onclose,
		onchange,
		children,
		size = 'md',
		dismissible = true,
		ariaLabel = '',
		panelId
	}: Props = $props();

	const WORK_COMMAND_PALETTE_TITLE = 'Work command palette';
	const WORK_COMMAND_INPUT_SELECTOR = 'input[aria-label="Filter work commands"]';
	const WORK_COMMAND_LIST_SELECTOR = '.work-command-palette-list';
	const WORK_COMMAND_OPTION_SELECTOR = '.work-command-entry';
	const WORK_COMMAND_LIST_ID = 'work-command-listbox';
	const WORK_FILTER_INPUT_SELECTOR = 'input[aria-label="Filter work items by text"]';

	let rendersCollapsible = $derived(typeof summary === 'string');

	function enhanceWorkCommandPalette(node: HTMLElement) {
		let destroyed = false;
		let syncScheduled = false;
		let chooseFirstOnSync = false;
		let initialFocusPending = true;

		function input(): HTMLInputElement | null {
			return node.querySelector<HTMLInputElement>(WORK_COMMAND_INPUT_SELECTOR);
		}

		function listbox(): HTMLElement | null {
			return node.querySelector<HTMLElement>(WORK_COMMAND_LIST_SELECTOR);
		}

		function options(): HTMLButtonElement[] {
			return Array.from(node.querySelectorAll<HTMLButtonElement>(WORK_COMMAND_OPTION_SELECTOR));
		}

		function optionLabel(option: HTMLButtonElement, index = 0): string {
			return option.querySelector('span')?.textContent?.trim() || `command-${index + 1}`;
		}

		function optionSlug(option: HTMLButtonElement, index: number): string {
			return optionLabel(option, index)
				.toLocaleLowerCase('en-US')
				.normalize('NFKD')
				.replace(/[\u0300-\u036f]/gu, '')
				.replace(/[^a-z0-9]+/gu, '-')
				.replace(/^-+|-+$/gu, '') || `command-${index + 1}`;
		}

		function assignOptionSemantics(items: HTMLButtonElement[]) {
			const duplicateCounts = new Map<string, number>();
			for (const [index, option] of items.entries()) {
				const base = optionSlug(option, index);
				const occurrence = (duplicateCounts.get(base) || 0) + 1;
				duplicateCounts.set(base, occurrence);
				option.id = `work-command-option-${base}${occurrence > 1 ? `-${occurrence}` : ''}`;
				option.setAttribute('role', 'option');
				option.setAttribute('aria-disabled', option.disabled ? 'true' : 'false');
				option.tabIndex = -1;
			}
		}

		function currentActive(items: HTMLButtonElement[]): HTMLButtonElement | null {
			return items.find((option) => option.getAttribute('aria-selected') === 'true')
				|| items.find((option) => option.classList.contains('work-command-entry-active'))
				|| null;
		}

		function publishActive(next: HTMLButtonElement | null, items: HTMLButtonElement[]) {
			const field = input();
			for (const option of items) {
				option.setAttribute('aria-selected', option === next ? 'true' : 'false');
			}
			if (!field) return;
			if (next) {
				field.setAttribute('aria-activedescendant', next.id);
				next.scrollIntoView({ block: 'nearest' });
			} else {
				field.removeAttribute('aria-activedescendant');
			}
		}

		function activate(next: HTMLButtonElement | null, items = options()) {
			if (!next || next.disabled) {
				publishActive(null, items);
				return;
			}
			// The existing page owns the command index. A synthetic focus event updates
			// that state without moving DOM focus away from the combobox input.
			next.dispatchEvent(new FocusEvent('focus'));
			publishActive(next, items);
			scheduleSync();
		}

		function sync(chooseFirst = false) {
			if (destroyed) return;
			const field = input();
			const list = listbox();
			if (!field || !list) return;

			list.id = WORK_COMMAND_LIST_ID;
			list.setAttribute('role', 'listbox');
			field.setAttribute('role', 'combobox');
			field.setAttribute('aria-autocomplete', 'list');
			field.setAttribute('aria-controls', WORK_COMMAND_LIST_ID);
			field.setAttribute('aria-expanded', 'true');
			field.setAttribute('aria-haspopup', 'listbox');

			const items = options();
			assignOptionSemantics(items);
			const enabled = items.filter((option) => !option.disabled);
			let active = chooseFirst ? enabled[0] || null : currentActive(items);
			if (!active || active.disabled || !items.includes(active)) active = enabled[0] || null;
			if (active && !active.classList.contains('work-command-entry-active')) {
				active.dispatchEvent(new FocusEvent('focus'));
			}
			publishActive(active, items);

			if (initialFocusPending) {
				initialFocusPending = false;
				field.focus({ preventScroll: true });
			}
		}

		function scheduleSync(chooseFirst = false) {
			chooseFirstOnSync = chooseFirstOnSync || chooseFirst;
			if (syncScheduled) return;
			syncScheduled = true;
			queueMicrotask(async () => {
				await tick();
				if (destroyed) return;
				const shouldChooseFirst = chooseFirstOnSync;
				chooseFirstOnSync = false;
				syncScheduled = false;
				sync(shouldChooseFirst);
			});
		}

		function moveActive(delta: -1 | 1) {
			const items = options();
			const enabled = items.filter((option) => !option.disabled);
			if (enabled.length === 0) {
				publishActive(null, items);
				return;
			}
			const active = currentActive(items);
			const position = active ? enabled.indexOf(active) : -1;
			const nextPosition = position < 0
				? (delta > 0 ? 0 : enabled.length - 1)
				: (position + delta + enabled.length) % enabled.length;
			activate(enabled[nextPosition], items);
		}

		function moveToBoundary(boundary: 'first' | 'last') {
			const items = options();
			const enabled = items.filter((option) => !option.disabled);
			activate(boundary === 'first' ? enabled[0] || null : enabled.at(-1) || null, items);
		}

		function runAnnouncedCommand() {
			const items = options();
			const active = currentActive(items);
			if (!active || active.disabled) return;
			active.click();
		}

		function closeThenFocusWorkSearch() {
			const field = input();
			field?.dispatchEvent(new KeyboardEvent('keydown', {
				bubbles: true,
				cancelable: true,
				key: 'Escape'
			}));
			queueMicrotask(async () => {
				await tick();
				requestAnimationFrame(() => {
					document.querySelector<HTMLInputElement>(WORK_FILTER_INPUT_SELECTOR)?.focus({ preventScroll: true });
				});
			});
		}

		function handleClick(event: MouseEvent) {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const option = target.closest<HTMLButtonElement>(WORK_COMMAND_OPTION_SELECTOR);
			if (!option || !node.contains(option) || option.disabled || optionLabel(option) !== 'Focus search') return;
			// Work content is inert until WornDialog completes teardown. Prevent the
			// route's eager focus attempt, close through its existing Escape owner, and
			// focus the visible search only after modal isolation has been released.
			event.preventDefault();
			event.stopImmediatePropagation();
			closeThenFocusWorkSearch();
		}

		function handleKeydown(event: KeyboardEvent) {
			const field = input();
			if (!field || event.target !== field) return;
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				event.stopPropagation();
				moveActive(event.key === 'ArrowDown' ? 1 : -1);
				return;
			}
			if (event.key === 'Home' || event.key === 'End') {
				event.preventDefault();
				event.stopPropagation();
				moveToBoundary(event.key === 'Home' ? 'first' : 'last');
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				runAnnouncedCommand();
			}
		}

		function handleInput(event: Event) {
			if (event.target === input()) scheduleSync(true);
		}

		function handleFocusIn() {
			scheduleSync();
		}

		const observer = new MutationObserver((records) => {
			const listChanged = records.some((record) => record.type === 'childList');
			scheduleSync(listChanged);
		});
		observer.observe(node, {
			attributes: true,
			attributeFilter: ['class', 'disabled'],
			childList: true,
			subtree: true
		});
		node.addEventListener('click', handleClick, true);
		node.addEventListener('keydown', handleKeydown, true);
		node.addEventListener('input', handleInput, true);
		node.addEventListener('focusin', handleFocusIn, true);
		scheduleSync(true);

		return {
			destroy() {
				destroyed = true;
				observer.disconnect();
				node.removeEventListener('click', handleClick, true);
				node.removeEventListener('keydown', handleKeydown, true);
				node.removeEventListener('input', handleInput, true);
				node.removeEventListener('focusin', handleFocusIn, true);
			}
		};
	}
</script>

{#if rendersCollapsible}
	{#if summary === 'Advanced options'}
		<div class="advanced-options-spacing" data-next-advanced-options>
			<BaseCollapsible bind:open summary={summary || ''} {ariaLabel} {panelId} {onchange}>
				{@render children?.()}
			</BaseCollapsible>
		</div>
	{:else}
		<BaseCollapsible bind:open summary={summary || ''} {ariaLabel} {panelId} {onchange}>
			{@render children?.()}
		</BaseCollapsible>
	{/if}
{:else}
	<BaseDialog bind:open {title} {onclose} {size} {dismissible}>
		{#if title === WORK_COMMAND_PALETTE_TITLE}
			<div class="work-command-palette-boundary" data-work-command-palette-boundary use:enhanceWorkCommandPalette>
				{@render children?.()}
			</div>
		{:else}
			{@render children?.()}
		{/if}
	</BaseDialog>
{/if}

<style>
	.advanced-options-spacing {
		box-sizing: border-box;
		max-inline-size: 100%;
		min-inline-size: 0;
		padding-block-start: var(--worn-space-4);
	}

	.work-command-palette-boundary {
		max-inline-size: 100%;
		min-inline-size: 0;
	}

	@media (max-width: 500px) {
		.advanced-options-spacing {
			padding-block-start: var(--worn-space-3);
		}
	}
</style>
