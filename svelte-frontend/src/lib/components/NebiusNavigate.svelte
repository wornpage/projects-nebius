<script module lang="ts">
	export function matchesCommand(label: string, query: string) {
		return label.toLowerCase().includes(query.trim().toLowerCase());
	}

	/** Keyboard selection is separate from a task's current-location marker. */
	export function nextCommandKey(items: { key: string; disabled?: boolean }[], current: string, intent: 'next' | 'previous' | 'first' | 'last') {
		const enabled = items.filter((item) => !item.disabled);
		if (!enabled.length) return '';
		if (intent === 'first') return enabled[0].key;
		if (intent === 'last') return enabled[enabled.length - 1].key;
		const index = enabled.findIndex((item) => item.key === current);
		return enabled[(index < 0 ? (intent === 'next' ? 0 : enabled.length - 1) : index + (intent === 'next' ? 1 : -1) + enabled.length) % enabled.length].key;
	}
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { beforeNavigate, onNavigate } from '$app/navigation';
	import { isPlainNavigationClick, shellNavigation } from '$lib/nebius-shell-navigation.mjs';
	import { filterCommandNavigation, type ProjectNavigationModel } from '$lib/nebius-command-navigation.mjs';

	interface WorkCommand { id: string; label: string; description: string; disabled?: boolean; run: () => void }
	interface Option { key: string; label: string; href?: string; commandId?: string; description?: string; disabled?: boolean; current?: boolean; status?: string; archived?: boolean }
	interface Props {
		taskHref?: string;
		taskTitle?: string;
		pathname?: string;
		currentView?: string;
		active?: boolean;
		triggerVisible?: boolean;
		triggerLabel?: string;
		navigation?: ProjectNavigationModel | null;
		commands?: WorkCommand[];
		onOpen?: () => void;
	}
	let { taskHref = '/next', taskTitle = 'Task', pathname = '/', currentView = '', active = true, triggerVisible = true,
		triggerLabel = 'Navigate', navigation = null, commands = [], onOpen }: Props = $props();
	const uid = $props.id();
	let trigger: HTMLButtonElement;
	let dialog: HTMLDialogElement;
	let search: HTMLInputElement;
	let opener: HTMLElement | null = null;
	let isOpen = $state(false);
	let query = $state('');
	let selectedKey = $state('');
	let requestedHref = '';
	let focusAfterNavigation = false;
	let backdropPointer = false;
	let mounted = $state(false);
	let currentTask = $derived(navigation?.tasks.find((item) => item.current));
	let detailLinks = $derived(pathname === '/next' && currentTask ? shellNavigation({ taskHref: currentTask.href, pathname, currentView }).filter((item) => item.detail) : []);
	let filteredNavigation = $derived(navigation ? filterCommandNavigation(navigation, query) : null);
	let groups = $derived.by(() => {
		const allWork = navigation?.allWork ?? { label: 'All work', href: '/work?scope=all' };
		return [
			{ key: 'work', label: '', items: matchesCommand(allWork.label, query) ? [{ key: 'all-work', label: allWork.label, href: allWork.href }] as Option[] : [] },
			{ key: 'tasks', label: navigation?.scopeLabel ?? 'Tasks', items: (filteredNavigation?.tasks ?? []).map((item) => ({ ...item, key: `task:${item.id}`, label: item.title })) as Option[] },
			{ key: 'views', label: `Current task views${taskTitle && taskTitle !== 'Task' ? `: ${taskTitle}` : ''}`, items: detailLinks.filter((item) => matchesCommand(item.label, query)).map((item) => ({ ...item, key: `view:${item.label}` })) as Option[] },
			{ key: 'commands', label: 'Work commands', items: commands.filter((item) => matchesCommand(item.label, query)).map((item) => ({ ...item, key: `command:${item.id}`, commandId: item.id })) as Option[] }
		];
	});
	let options = $derived(groups.flatMap((group) => group.items));
	let totalOptions = $derived(1 + (navigation?.tasks.length ?? 0) + detailLinks.length + commands.length);
	let selectedIndex = $derived(options.findIndex((item) => item.key === selectedKey));
	$effect(() => {
		if (!options.some((item) => item.key === selectedKey && !item.disabled)) selectedKey = nextCommandKey(options, '', 'first');
	});

	function visible(element: HTMLElement | null | undefined): element is HTMLElement {
		return Boolean(element?.isConnected && element.getClientRects().length && !element.closest('[inert]') &&
			!element.matches(':disabled, [aria-disabled="true"]') && getComputedStyle(element).visibility !== 'hidden');
	}

	function focusMain() {
		if (document.querySelector('dialog:modal')) return;
		const main = document.querySelector<HTMLElement>('#challenge-main, main');
		if (visible(main)) {
			if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
			main.focus({ preventScroll: true });
		}
	}

	function restoreFocus() {
		if (document.querySelector('dialog:modal')) return;
		const primary = [...document.querySelectorAll<HTMLElement>('.challenge-shell-nav a[data-nav-label]')];
		const target = [opener, active && triggerVisible ? trigger : null, primary.find((item) => item.getAttribute('aria-current') === 'page'), ...primary].find(visible);
		if (target) target.focus({ preventScroll: true });
		else focusMain();
	}

	function dismiss() {
		requestedHref = '';
		if (dialog?.open) dialog.close('dismiss');
	}

	function closed() {
		if (dialog.open) return;
		isOpen = false;
		if (dialog.returnValue !== 'navigation' && dialog.returnValue !== 'command') restoreFocus();
	}

	/** All shell and Work openers share this one native dialog. */
	export function open() {
		if (!active || !dialog || document.querySelector('[aria-modal="true"], dialog[open]')) return;
		opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		onOpen?.();
		query = '';
		selectedKey = nextCommandKey(options, '', 'first');
		requestedHref = '';
		dialog.returnValue = '';
		dialog.showModal();
		isOpen = true;
		void tick().then(() => { if (dialog.open) search.focus({ preventScroll: true }); });
	}

	function observeLink(event: MouseEvent) {
		if (!isPlainNavigationClick(event)) return;
		const anchor = event.currentTarget as HTMLAnchorElement;
		requestedHref = anchor.href;
		// Release modal inertness before page guards resolve an unsaved editor.
		dialog.close('navigation');
		isOpen = false;
	}

	async function activateCommand(id: string) {
		if (!commands.some((item) => item.id === id && !item.disabled)) return;
		requestedHref = '';
		dialog.close('command');
		isOpen = false;
		await tick();
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		const command = commands.find((item) => item.id === id);
		if (command && !command.disabled) command.run();
	}

	// History cancellation retains the page guard's own resolution focus.
	beforeNavigate((navigation) => {
		focusAfterNavigation = Boolean(dialog?.open) ||
			(navigation.type === 'link' && navigation.to?.url.href === requestedHref);
		requestedHref = '';
		if (dialog?.open) {
			dialog.close('navigation');
			isOpen = false;
		}
	});
	onNavigate(() => {
		if (!focusAfterNavigation) return;
		focusAfterNavigation = false;
		return () => { void tick().then(() => requestAnimationFrame(focusMain)); };
	});

	function reconcileVisibility() {
		if (!active || (opener === trigger && (!triggerVisible || !visible(trigger))) || (isOpen && !visible(opener))) {
			if (dialog?.open) dismiss();
			else if (document.activeElement === trigger) restoreFocus();
		}
	}
	$effect(() => { if (mounted) { active; triggerVisible; reconcileVisibility(); } });
	onMount(() => {
		mounted = true;
		const observer = new ResizeObserver(reconcileVisibility);
		observer.observe(trigger);
		window.addEventListener('resize', reconcileVisibility);
		return () => {
			mounted = false;
			observer.disconnect();
			window.removeEventListener('resize', reconcileVisibility);
			if (dialog.open) dialog.close();
		};
	});

	function isBackdrop(event: MouseEvent | PointerEvent) {
		const rect = dialog.getBoundingClientRect();
		return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
	}

	function handleKeys(event: KeyboardEvent) {
		if (event.defaultPrevented || !dialog.open) return;
		if (event.key === 'Tab') {
			const controls = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input')].filter((item) => visible(item) && item.tabIndex >= 0);
			const first = controls[0], last = controls.at(-1);
			if (!first || !last) return;
			const outside = !dialog.contains(document.activeElement) || !controls.includes(document.activeElement as HTMLElement);
			if ((event.shiftKey && (document.activeElement === first || outside)) || (!event.shiftKey && (document.activeElement === last || outside))) {
				event.preventDefault();
				(event.shiftKey ? last : first).focus();
			}
			return;
		}
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const intent = ({ ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last' } as const)[event.key as 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'];
		if (intent) {
			event.preventDefault();
			selectedKey = nextCommandKey(options, selectedKey, intent);
			search.focus({ preventScroll: true });
			void tick().then(() => dialog.querySelector<HTMLElement>('[data-nebius-command-option][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
		} else if (event.key === 'Enter' && event.target === search) {
			event.preventDefault();
			dialog.querySelector<HTMLElement>('[data-nebius-command-option][aria-selected="true"]')?.click();
		}
	}
</script>

<button bind:this={trigger} type="button" class="challenge-nav-control nebius-navigate-trigger" hidden={!triggerVisible} data-nebius-command-trigger aria-haspopup="dialog" aria-expanded={isOpen} aria-controls={`${uid}-dialog`} onclick={open}>{triggerLabel}</button>
<dialog bind:this={dialog} id={`${uid}-dialog`} class="nebius-navigate" data-nebius-command-dialog aria-labelledby={`${uid}-title`} onclose={closed} onkeydown={handleKeys}
	oncancel={() => { requestedHref = ''; }}
	onpointerdown={(event) => { backdropPointer = event.button === 0 && isBackdrop(event); }}
	onpointercancel={() => { backdropPointer = false; }}
	onclick={(event) => { if (backdropPointer && isBackdrop(event)) dismiss(); backdropPointer = false; }}>
	<div class="navigate-heading"><h2 id={`${uid}-title`}>Commands</h2><button type="button" class="navigate-close" onclick={dismiss} aria-label="Close commands">Close</button></div>
	<input bind:this={search} bind:value={query} type="search" role="combobox" data-nebius-command-search aria-label="Find tasks or commands" placeholder="Find tasks or commands" aria-autocomplete="list" aria-expanded={isOpen} aria-controls={`${uid}-list`} aria-activedescendant={selectedIndex >= 0 ? `${uid}-option-${selectedIndex}` : undefined} />
	<p class="navigate-count" aria-live="polite">{options.length} of {totalOptions} tasks and commands</p>
	<div role="listbox" id={`${uid}-list`} aria-label="Tasks and commands" data-nebius-command-list>
		{#each groups as group (group.key)}
			{#if group.items.length || group.key === 'tasks'}
				<div role="group" aria-label={group.label || 'Work'}>
					{#if group.label}<p class="navigate-group">{group.label}</p>{/if}
					{#each group.items as item (item.key)}
						{@const index = options.findIndex((option) => option.key === item.key)}
						{#if item.href}
							<a id={`${uid}-option-${index}`} href={item.href} role="option" data-nebius-command-option data-command-key={item.key} aria-selected={selectedKey === item.key} aria-current={item.current ? 'true' : undefined} tabindex="-1" onclick={observeLink}>
								<span class="navigate-label">{item.label}</span><span class="navigate-meta">{#if item.current}<small>Current task{group.key === 'views' ? ' view' : ''}</small>{/if}{#if item.status}<small>{item.status}</small>{/if}{#if item.archived}<small>Archived</small>{/if}</span>
							</a>
						{:else}
							<button id={`${uid}-option-${index}`} type="button" role="option" data-nebius-command-option data-command-key={item.key} aria-selected={selectedKey === item.key} aria-disabled={item.disabled || undefined} disabled={item.disabled} tabindex="-1" aria-describedby={item.description ? `${uid}-description-${index}` : undefined} onclick={() => { if (item.commandId) void activateCommand(item.commandId); }}>
								<span class="navigate-label">{item.label}{#if item.description}<small id={`${uid}-description-${index}`} class="navigate-description">{item.description}</small>{/if}</span>
							</button>
						{/if}
					{/each}
				</div>
			{/if}
		{/each}
	</div>
	{#if !options.length}<p class="navigate-empty" role="status">No tasks or commands match your search.</p>{/if}
</dialog>

<style>
	.nebius-navigate-trigger { min-height: 44px; }
	.nebius-navigate-trigger[hidden] { display: none; }
	.nebius-navigate { box-sizing: border-box; width: min(540px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); padding: 20px; overflow: auto; border: 1px solid var(--worn-field-border, #888); border-radius: 12px; background: var(--worn-surface, Canvas); color: var(--worn-text, CanvasText); box-shadow: 0 20px 70px #0005; }
	.nebius-navigate[open] { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; overflow: hidden; }
	.nebius-navigate::backdrop { background: #0007; }
	.navigate-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
	h2 { font-size: 1.2rem; margin: 0; }
	button, input { font: inherit; color: inherit; }
	.navigate-close { min-height: 44px; min-width: 60px; padding: 8px 12px; background: transparent; border: 1px solid var(--worn-field-border, #888); border-radius: 6px; cursor: pointer; }
	input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 10px 12px; background: var(--worn-surface, Canvas); border: 1px solid var(--worn-field-border, #888); border-radius: 6px; }
	[role='listbox'], [role='group'] { display: grid; gap: 6px; }
	[role='listbox'] { overflow-y: auto; min-height: 0; max-height: calc(100dvh - 236px); align-content: start; padding: 6px; }
	[role='option'] { min-height: 44px; width: 100%; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid transparent; border-radius: 6px; color: inherit; background: transparent; text-decoration: none; text-align: left; cursor: pointer; }
	[role='option']:hover, [role='option'][aria-selected='true'] { border-color: var(--worn-field-border, #888); background: var(--worn-surface-hover, color-mix(in srgb, currentColor 8%, transparent)); }
	[role='option'][aria-current] .navigate-label { font-weight: 700; }
	[role='option']:disabled { cursor: default; opacity: .65; }
	.navigate-label { min-width: 0; overflow-wrap: anywhere; }
	.navigate-meta { display: flex; flex: 0 0 auto; flex-direction: column; align-items: flex-end; gap: 4px; max-width: 45%; }
	.navigate-meta:empty { display: none; }
	.navigate-meta small { white-space: nowrap; }
	small { font-size: .75rem; overflow-wrap: anywhere; }
	.navigate-description { display: block; margin-top: 4px; font-weight: 400; }
	.navigate-group { margin: 12px 0 4px; font-size: .82rem; font-weight: 650; overflow-wrap: anywhere; }
	.navigate-count, .navigate-empty { margin: 12px 0; font-size: .82rem; overflow-wrap: anywhere; }
	a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--worn-text, Highlight); outline-offset: 2px; }
</style>
