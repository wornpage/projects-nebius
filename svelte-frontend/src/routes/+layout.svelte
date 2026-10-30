<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import { page } from '$app/stores';
	import { demoState, demoStateError, displayToast, pendingNextActionDrafts, refreshDemoState, resetDemoSampleState, toasts } from '$lib/demo-client';
	import { pendingDraftCountFor, pendingDraftHasDuplicateEvidence, pendingDraftNavigation, pendingDraftReferencesAvailable } from '$lib/pending-next-action.mjs';
	import { canSetNextAction } from '$lib/demo-workflow';
	import WornToast from '$lib/components/WornToast.svelte';
	import ThemePicker from '$lib/components/ThemePicker.svelte';
	import NebiusNavigate from '$lib/components/NebiusNavigate.svelte';
	import PendingApprovalsCenter from '$lib/PendingApprovalsCenter.svelte';
	import { TASK_LOCATION_CONTEXT, type TaskLocation } from '$lib/nebius-shell-navigation.mjs';
	import { projectNavigation } from '$lib/nebius-command-navigation.mjs';
	import { COMMANDS_CONTEXT, type CommandsHost, type WorkCommandContribution } from '$lib/nebius-command-context';
	import { WornButton } from '$lib/components';

	let { children }: { children: any } = $props();
	let pathname = $derived($page.url.pathname);
	let routeLabel = $derived(pathname === '/work' ? 'Work' : pathname === '/next' ? 'Task' :
		pathname === '/recovery-rehearsal' ? 'Recovery Simulator' : pathname === '/grounding-rehearsal' ? 'Grounding rehearsal' : 'Projects');
	let pendingApprovals = $derived(pendingNextActionDrafts($demoState));
	let resumableApprovals = $derived.by(() => {
		const packs = $demoState?.packs ?? [];
		return pendingApprovals.filter(draft => {
			const target = packs.find(pack => pack.id === draft.workId);
			return Boolean(target && canSetNextAction(target) && pendingDraftCountFor({ pendingNextActionDrafts: pendingApprovals }, draft.workId) === 1 && !pendingDraftHasDuplicateEvidence(draft) && pendingDraftReferencesAvailable({ packs }, draft));
		});
	});
	let pendingNavigation = $derived(pendingDraftNavigation({ pendingNextActionDrafts: resumableApprovals }));
	let pendingResumeHref = $derived(pendingNavigation.resumeHref);
	let approvalsOpen = $state(false);
	let shellMounted = $state(false);
	let taskLocation = $state<TaskLocation | null>(null);
	setContext(TASK_LOCATION_CONTEXT, (location: TaskLocation | null) => { taskLocation = location; });
	let selectedTaskId = $derived(shellMounted ? $page.url.searchParams.get('pack') : null);
	let navigationView = $derived(pathname === '/next' && taskLocation?.id === selectedTaskId
		? taskLocation.view : shellMounted ? $page.url.searchParams.get('view') ?? 'brief' : 'brief');
	let navigationTaskHref = $derived(pathname === '/next' && selectedTaskId
		? `${pathname}${$page.url.search}` : pendingNavigation.count > 0 ? pendingResumeHref : '/next');
	let navigationTaskTitle = $derived($demoState?.packs?.find((pack) => pack.id === selectedTaskId)?.title ?? 'Task');
	let compactNavigation = $state(false);
	let commandMenu = $state<{ open: () => void } | null>(null);
	let workCommands = $state<WorkCommandContribution[]>([]);
	let commandOwner: symbol | null = null;
	let lastWorkOrder = $state<{ scopeKey: string; orderedIds: string[] } | null>(null);
	setContext<CommandsHost>(COMMANDS_CONTEXT, {
		open: () => commandMenu?.open(),
		publish: (owner, contribution) => {
			if (contribution) {
				commandOwner = owner;
				workCommands = contribution.commands;
				lastWorkOrder = { scopeKey: contribution.scopeKey, orderedIds: contribution.orderedIds };
			} else if (owner === commandOwner) {
				commandOwner = null;
				workCommands = [];
			}
		}
	});
	let navigationProject = $derived.by(() => {
		const options = {
			packs: $demoState?.packs ?? [], projects: $demoState?.projects ?? [],
			selectedProjectId: $demoState?.selectedProjectId ?? null,
			currentTaskId: pathname === '/next' ? selectedTaskId ?? taskLocation?.id ?? null : $demoState?.selectedId ?? null,
			pathname
		};
		const model = projectNavigation(options);
		return lastWorkOrder && (lastWorkOrder.scopeKey === model.scopeKey || lastWorkOrder.scopeKey === 'all')
			? projectNavigation({ ...options, orderedIds: lastWorkOrder.orderedIds }) : model;
	});
	let recoveryBusy = $state(false);
	let recoveryError = $state('');
	let online = $state(true);
	let waitingWorker = $state<ServiceWorker | null>(null);
	let requestedWorker = $state<ServiceWorker | null>(null);
	let updateAvailable = $derived(waitingWorker !== null || requestedWorker !== null);
	let reconcileUpdate: (() => void) | null = null;
	let quarantined = $derived((($demoState?.recoveryQuarantine ?? []) as Array<{ id: string; reason: string }>));

	onMount(() => {
		shellMounted = true;
		const compactQuery = window.matchMedia('(max-width: 700px)');
		const syncCompactNavigation = () => (compactNavigation = compactQuery.matches);
		syncCompactNavigation();
		compactQuery.addEventListener('change', syncCompactNavigation);
		// The shared workspace shell hydrates the one browser-local state owner.
		// Guide only derives and renders that state; it owns no fetch or storage path.
		void refreshDemoState({ reuseRecent: true });
		online = navigator.onLine;
		const setOnline = () => (online = navigator.onLine);
		window.addEventListener('online', setOnline);
		window.addEventListener('offline', setOnline);
		let mounted = true;
		let registration: ServiceWorkerRegistration | null = null;
		const workerListeners = new Map<ServiceWorker, () => void>();
		const watchWorker = (worker: ServiceWorker | null | undefined) => {
			if (!worker || workerListeners.has(worker)) return;
			const changed = () => syncUpdate();
			workerListeners.set(worker, changed);
			worker.addEventListener('statechange', changed);
		};
		const syncUpdate = () => {
			if (!mounted) return;
			watchWorker(registration?.installing);
			watchWorker(registration?.waiting);
			if (requestedWorker?.state === 'redundant') requestedWorker = null;
			const waiting = registration?.waiting;
			waitingWorker = waiting?.state === 'installed' && waiting !== navigator.serviceWorker.controller ? waiting : null;
			// A different tab may activate the update. Only the tab that requested
			// this exact worker reloads, after activation and control both settle.
			if (requestedWorker && navigator.serviceWorker.controller === requestedWorker && requestedWorker.state === 'activated') {
				requestedWorker = null;
				waitingWorker = null;
				location.reload();
			}
			for (const [worker, listener] of workerListeners) {
				if (worker.state === 'activated' || worker.state === 'redundant') {
					worker.removeEventListener('statechange', listener);
					workerListeners.delete(worker);
				}
			}
		};
		if ('serviceWorker' in navigator) {
			reconcileUpdate = syncUpdate;
			navigator.serviceWorker.addEventListener('controllerchange', syncUpdate);
			void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registered) => {
				if (!mounted) return;
				registration = registered;
				registration.addEventListener('updatefound', syncUpdate);
				syncUpdate();
			}).catch(() => {});
		}
		return () => {
			compactQuery.removeEventListener('change', syncCompactNavigation);
			mounted = false;
			reconcileUpdate = null;
			requestedWorker = null;
			waitingWorker = null;
			if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', syncUpdate);
			registration?.removeEventListener('updatefound', syncUpdate);
			for (const [worker, listener] of workerListeners) worker.removeEventListener('statechange', listener);
			workerListeners.clear();
			window.removeEventListener('online', setOnline);
			window.removeEventListener('offline', setOnline);
		};
	});


	function openShellCommands(event: KeyboardEvent) {
		if (!__NEBIUS_EDITION__ || pathname === '/work' || event.defaultPrevented || event.repeat ||
			!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
		const target = event.target as HTMLElement;
		if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[aria-modal="true"], dialog[open]')) return;
		event.preventDefault();
		commandMenu?.open();
	}

	function dismissToast(id: string) {
		toasts.update((items) => items.filter((item) => item.id !== id));
	}

	function reloadForUpdate() {
		const worker = waitingWorker;
		if (!worker || requestedWorker) return;
		requestedWorker = worker;
		reconcileUpdate?.();
		if (requestedWorker === worker && worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
	}

	async function recoverWorkspace() {
		if (recoveryBusy) return;
		recoveryBusy = true;
		recoveryError = '';
		try {
			await resetDemoSampleState();
			displayToast('Local workspace restored from the bundled sample.', 'success');
		} catch (error) {
			recoveryError = error instanceof Error ? error.message : 'The local workspace could not be restored.';
		} finally {
			recoveryBusy = false;
		}
	}
</script>

<svelte:head>
	{#if __NEBIUS_EDITION__}
		<link rel="stylesheet" href="/assets/theme.css" />
		<script src="/assets/theme.js"></script>
	{/if}
</svelte:head>

<svelte:window onkeydown={openShellCommands} />

<div class="challenge-shell" class:ui-lab-shell={__NEBIUS_EDITION__} class:workspace-polish={__NEBIUS_EDITION__ && (pathname === '/work' || pathname === '/next')}>
	<a class="challenge-skip" href="#challenge-main">Skip to current page</a>

	<header class="challenge-shell-nav">
		<a
			class="challenge-brand"
			href="/landing.html"
			data-sveltekit-reload
			aria-label="Wornpage Projects landing page"
		>
			<span>Wornpage Projects</span>
			<small>Nebius edition</small>
		</a>

		<nav aria-label="Projects application navigation" class:compact-primary-navigation={__NEBIUS_EDITION__}>
			<a
				class="challenge-nav-control challenge-work-link"
				href="/work"
				data-nav-label="Work"
				aria-current={pathname === '/work' ? 'page' : undefined}
			>Work</a>
			{#if __NEBIUS_EDITION__}
				<a class="challenge-nav-control" href={pendingNavigation.count > 0 ? pendingResumeHref : '/next'} data-nav-label="Task" aria-label={pendingNavigation.count > 0 ? `Task, resume ${pendingNavigation.count} pending approval${pendingNavigation.count === 1 ? '' : 's'}` : 'Task'} aria-current={pathname === '/next' ? 'page' : undefined}>Task</a>
			{/if}
		</nav>

		{#if __NEBIUS_EDITION__}
		<div class="challenge-utilities">
			{#if pendingApprovals.length > 0}
				<WornButton size="sm" type="button" onclick={() => (approvalsOpen = true)}>Pending approvals ({pendingApprovals.length})</WornButton>
			{/if}
			<div class="challenge-navigate-control" class:task-command-trigger={pathname !== '/work'}>
				<NebiusNavigate bind:this={commandMenu} navigation={navigationProject} commands={pathname === '/work' ? workCommands : []} taskHref={navigationTaskHref} taskTitle={navigationTaskTitle} {pathname} currentView={navigationView} triggerLabel={compactNavigation ? 'Navigate' : 'Commands'} triggerVisible={compactNavigation || pathname !== '/work'} />
			</div>
			<div class="challenge-theme-control"><ThemePicker /></div>
		</div>
		{/if}
		{#if updateAvailable}<WornButton class="offline-status" size="sm" type="button" onclick={reloadForUpdate} disabled={requestedWorker !== null}>{requestedWorker ? 'Updating…' : 'Reload to update'}</WornButton>{:else if !online}<span class="offline-status" role="status" aria-live="polite">Offline mode — local workspace remains available.</span>{/if}
	</header>
	{#if pendingApprovals.length > 0}
		<PendingApprovalsCenter bind:open={approvalsOpen} drafts={pendingApprovals} packs={$demoState?.packs ?? []} />
	{/if}


	{#if $demoStateError}
		<section class="demo-recovery" role="alert" aria-label="Workspace recovery">
			<div><strong>Workspace data needs recovery.</strong><span>Reset restores the bundled sample and removes only this browser's local changes.</span></div>
			<WornButton size="sm" variant="primary" type="button" onclick={recoverWorkspace} disabled={recoveryBusy}>{recoveryBusy ? 'Restoring…' : 'Reset local workspace'}</WornButton>
			{#if recoveryError}<span class="demo-recovery-error">{recoveryError}</span>{/if}
		</section>
	{/if}
	{#if quarantined.length > 0}
		<section class="demo-recovery" role="alert" aria-label="Quarantined workspace records">
			<div><strong>{quarantined.length} workspace record{quarantined.length === 1 ? '' : 's'} quarantined.</strong><span>Valid work remains available. Reset restores the bundled sample and removes this browser's local changes.</span><ul>{#each quarantined as item}<li>{item.id}: {item.reason}</li>{/each}</ul></div>
			<WornButton size="sm" variant="primary" type="button" onclick={recoverWorkspace} disabled={recoveryBusy}>{recoveryBusy ? 'Restoring…' : 'Reset local workspace'}</WornButton>
		</section>
	{/if}

	<div class="demo-toast-container" class:nebius-toast-container={__NEBIUS_EDITION__}>
		{#each $toasts as toast (toast.id)}
			<WornToast {toast} ondismiss={() => dismissToast(toast.id)} />
		{/each}
	</div>

	<main id="challenge-main" class="challenge-route" tabindex="-1" aria-label={`${routeLabel} page`}>
		{@render children()}
	</main>

</div>

<style>
	.challenge-shell {
		--challenge-focus-mint: var(--worn-link);
		align-content: start;
		box-sizing: border-box;
		display: grid;
		gap: var(--worn-space-5);
		margin: 0 auto;
		max-width: 1240px;
		min-height: 100vh;
		min-width: 0;
		padding: var(--worn-space-5) calc(var(--worn-space-4) * 2) calc(var(--worn-space-6) * 2);
		width: 100%;
	}

	.challenge-skip {
		background: var(--worn-text);
		border-radius: var(--worn-radius-sm);
		color: var(--worn-bg);
		font-weight: 700;
		left: 12px;
		padding: 10px 14px;
		position: fixed;
		top: 8px;
		transform: translateY(calc(-100% - 16px));
		transition: transform 0.12s ease;
		z-index: 300;
	}

	.challenge-skip:focus {
		transform: translateY(0);
	}

	.challenge-skip:not(:focus) {
		clip-path: inset(50%);
		height: 1px;
		overflow: hidden;
		padding: 0;
		white-space: nowrap;
		width: 1px;
	}

	.challenge-shell-nav {
		align-items: center;
		animation: challenge-nav-arrive 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		background: var(--worn-surface);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius-md);
		display: flex;
		gap: var(--worn-space-4);
		justify-content: space-between;
		min-width: 0;
		padding: var(--worn-space-2) var(--worn-space-3);
	}

	.challenge-theme-control { flex: 0 0 auto; min-width: 0; }
	.challenge-utilities { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.challenge-navigate-control { display: contents; }
	.challenge-navigate-control.task-command-trigger { display: block; }
	.challenge-navigate-control :global(.nebius-navigate-trigger) {
		min-height: 44px; border: 1px solid var(--worn-field-border); border-radius: var(--worn-radius);
		padding: .5rem .75rem; background: var(--worn-surface); color: var(--worn-text); font: inherit; font-size: .875rem; cursor: pointer;
	}

	.challenge-brand {
		color: var(--worn-text);
		display: grid;
		flex: 0 1 auto;
		font-weight: 700;
		line-height: 1.15;
		min-height: 44px;
		min-width: 0;
		padding: 0 var(--worn-space-3);
		place-content: center start;
		text-decoration: none;
	}

	.challenge-brand span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.challenge-brand small {
		color: var(--worn-text-muted);
		font-family: var(--font-typewriter);
		font-size: var(--worn-text-xs);
		font-weight: 560;
	}

	.ui-lab-shell .challenge-brand small {
		font-family: var(--font-family-sans);
		font-size: .75rem;
	}

	.challenge-shell-nav nav {
		align-items: center;
		display: flex;
		flex: 0 1 auto;
		flex-wrap: nowrap;
		gap: var(--worn-space-1);
		justify-content: flex-end;
		min-width: 0;
	}

	/* Tablet and compact layouts retain one deliberate application row. */
	@media (max-width: 900px) and (min-width: 701px) {
		.challenge-shell-nav {
			display: grid;
			gap: var(--worn-space-2) var(--worn-space-3);
			grid-template-columns: minmax(0, 1fr) auto;
			padding: var(--worn-space-2);
		}
		.challenge-utilities { grid-column: 2; grid-row: 1; }
		.challenge-shell-nav nav { gap: var(--worn-space-1); grid-column: 1 / -1; justify-content: stretch; }
		.challenge-shell-nav .challenge-nav-control { flex: 1 1 0; font-size: var(--worn-text-xs); justify-content: center; min-height: var(--worn-target-min); padding-inline: var(--worn-space-2); }
		.challenge-brand { min-height: var(--worn-target-min); padding-inline: var(--worn-space-2); }
	}

	.challenge-nav-control {
		align-items: center;
		appearance: none;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--worn-radius-sm);
		box-sizing: border-box;
		color: var(--worn-text-secondary);
		cursor: pointer;
		display: inline-flex;
		font-family: var(--font-typewriter);
		font-size: var(--worn-text-sm);
		font-weight: 650;
		justify-content: center;
		line-height: 1;
		margin: 0;
		min-height: var(--worn-target-min);
		min-width: 0;
		padding: 0 var(--worn-space-3);
		text-decoration: none;
		white-space: nowrap;
		transition:
			background-color 180ms ease,
			border-color 180ms ease,
			box-shadow 180ms ease,
			color 180ms ease,
			translate 180ms ease;
	}

	.challenge-work-link {
		background: color-mix(in srgb, var(--worn-accent) 8%, transparent);
		color: var(--worn-text);
		font-weight: 800;
	}




	.challenge-nav-control[aria-current='page'] {
		background: var(--worn-selected-bg);
		border-color: var(--worn-border-strong);
		box-shadow: inset 0 -2px 0 var(--worn-accent);
		color: var(--worn-selected-fg);
		translate: 0 -1px;
	}
	.challenge-nav-control[aria-current='page'] {
		text-decoration-line: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: .25em;
	}








	.challenge-brand:focus-visible,
	.challenge-nav-control:focus-visible {
		outline: 2px solid var(--challenge-focus-mint);
		outline-offset: 2px;
	}

	.challenge-route {
		display: grid;
		gap: var(--worn-space-6);
		min-width: 0;
	}
	.offline-status { color: var(--worn-text-secondary); font-family: var(--font-typewriter); font-size: var(--worn-text-xs); line-height: 1.3; max-inline-size: 220px; text-align: end; }

	.demo-recovery { align-items: center; background: var(--worn-surface); border: 1px solid var(--worn-border-strong); border-radius: var(--worn-radius); display: flex; flex-wrap: wrap; gap: var(--worn-space-3); justify-content: space-between; padding: var(--worn-space-3) var(--worn-space-4); }
	.demo-recovery div { display: grid; gap: var(--worn-space-1); min-width: 0; }
	.demo-recovery span { color: var(--worn-text-secondary); font-size: var(--worn-text-sm); }
	.demo-recovery-error { color: var(--worn-danger-text); flex-basis: 100%; }

	.challenge-route > :global(.demo-panel) {
		animation: challenge-route-arrive 380ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
		transform-origin: top center;
	}
	.workspace-polish .challenge-route > :global(.demo-panel) {
		animation: workspace-arrive 120ms ease-out both;
		transform-origin: initial;
	}
	@keyframes workspace-arrive {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.challenge-route :global(.worn-receipt) {
		box-shadow: var(--worn-shadow-sm);
		margin-block: var(--worn-space-4);
		padding: var(--worn-space-4) var(--worn-space-5);
	}

	.challenge-route :global(.worn-receipt-head) {
		padding-bottom: var(--worn-space-3);
	}

	.challenge-route :global(.worn-receipt-lines > div) {
		padding-block: var(--worn-space-2);
	}


	@keyframes challenge-nav-arrive {
		from {
			opacity: 0;
			translate: 0 -8px;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}

	@keyframes challenge-route-arrive {
		from {
			scale: 0.992;
			translate: 0 12px;
		}
		to {
			scale: 1;
			translate: 0 0;
		}
	}


	.demo-toast-container {
		display: grid;
		gap: var(--worn-space-2);
		pointer-events: none;
		position: fixed;
		right: calc(var(--worn-space-3) + env(safe-area-inset-right, 0px));
		top: calc(var(--worn-space-3) + env(safe-area-inset-top, 0px));
		width: min(420px, calc(100vw - (var(--worn-space-3) * 2)));
		z-index: 200;
	}

	.demo-toast-container > :global(*) {
		pointer-events: auto;
	}
	.demo-toast-container.nebius-toast-container > :global(*) {
		pointer-events: none;
	}
	.nebius-toast-container :global(button) {
		pointer-events: auto;
	}


	/* A solid, mint arrival ring is distinct from persistent keyboard focus
	   without resembling a diagnostic boundary. */
	:global(.demo-focus-pulse[data-focus-arrival='true']) {
		animation: challenge-focus-pulse 900ms ease-out both;
		outline: 2px solid var(--challenge-focus-mint) !important;
		outline-offset: 2px;
	}

	/* Card-like focused and arrival targets use the same rounded boundary as the
	   surface itself. Draw the cue inside those surfaces so grid containment
	   cannot clip one or more sides of the ring. */
	:global(.demo-focus-surface:focus-visible),
	:global(.demo-focus-surface.demo-focus-pulse[data-focus-arrival='true']) {
		border-radius: var(--worn-radius);
		outline: 0 !important;
		position: relative;
	}

	:global(.demo-focus-surface:focus-visible::after),
	:global(.demo-focus-surface.demo-focus-pulse[data-focus-arrival='true']::after) {
		border-radius: var(--demo-focus-ring-radius, inherit);
		box-sizing: border-box;
		content: '';
		inset: var(--demo-focus-ring-inset, 0);
		pointer-events: none;
		position: absolute;
		z-index: 4;
	}

	:global(.demo-focus-surface:focus-visible::after) {
		border: 2px solid var(--challenge-focus-mint);
	}

	:global(.demo-focus-surface.demo-focus-pulse[data-focus-arrival='true']::after) {
		animation: challenge-focus-pulse 900ms ease-out both;
		border: 2px solid var(--challenge-focus-mint);
	}

	@keyframes challenge-focus-pulse {
		0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--challenge-focus-mint) 0%, transparent); }
		45% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--challenge-focus-mint) 26%, transparent); }
		100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--challenge-focus-mint) 12%, transparent); }
	}

	@media (hover: hover) and (pointer: fine) {
		.challenge-brand:hover,
		.challenge-nav-control:hover {
			background: var(--worn-hover-bg);
			color: var(--worn-text);
		}
	}

	@media (max-width: 700px) {
		.challenge-shell {
			gap: var(--worn-space-3);
			padding: var(--worn-space-3) var(--worn-space-2) calc(var(--worn-space-4) * 2);
		}

		.challenge-shell-nav {
			align-items: stretch;
			display: grid;
			gap: var(--worn-space-2);
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.challenge-brand { grid-column: 1; grid-row: 1; }
		.challenge-utilities { grid-column: 1 / -1; grid-row: 2; justify-content: space-between; }
		.challenge-theme-control { max-inline-size: 100%; }
		.challenge-shell-nav:has(.challenge-navigate-control) .challenge-brand { grid-column: 1 / -1; }
		.challenge-navigate-control { display: block; min-width: 0; }

		.challenge-shell-nav nav {
			display: flex;
			flex-wrap: nowrap;
			grid-column: 1 / -1;
			grid-row: 2;
			justify-content: stretch;
			width: 100%;
		}

		.challenge-shell-nav .challenge-nav-control {
			flex: 1 1 0;
			font-size: var(--worn-text-xs);
			justify-content: center;
			padding-inline: var(--worn-space-1);
		}
		.challenge-shell-nav nav.compact-primary-navigation { display: none; }

		.challenge-route :global(.worn-receipt) {
			margin-block: var(--worn-space-3) var(--worn-space-4);
			padding: var(--worn-space-4);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.challenge-skip {
			transition: none;
		}

		.challenge-shell-nav,
		.challenge-route > :global(.demo-panel),
		.workspace-polish .challenge-route > :global(.demo-panel) {
			animation: none;
		}

		.challenge-skip:focus {
			transform: none;
		}

		.challenge-nav-control {
			transition: none;
		}

		:global(.demo-focus-pulse[data-focus-arrival='true']),
		:global(.demo-focus-surface.demo-focus-pulse[data-focus-arrival='true']::after) {
			animation: none;
		}
	}

	@media (max-width: 360px) {
		.challenge-brand small {
			display: none;
		}
		.challenge-shell-nav nav {
			grid-row: 3;
		}
		.challenge-nav-control {
			font-size: 10px;
		}
	}
</style>
