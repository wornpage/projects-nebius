<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { demoState, demoStateError, displayToast, pendingNextActionDrafts, refreshDemoState, resetDemoSampleState, toasts } from '$lib/demo-client';
	import { pendingDraftNavigation } from '$lib/pending-next-action.mjs';
	import WornToast from '$lib/components/WornToast.svelte';
	import WebMcpHandoffRail from '$lib/WebMcpHandoffRail.svelte';
	import WebMcpStatus from '$lib/WebMcpStatus.svelte';
	import { WornButton, WornDialog } from '$lib/components';
	import PendingApprovalsCenter from '$lib/PendingApprovalsCenter.svelte';

	type RoutePath = '/webmcp-challenge' | '/priority' | '/work' | '/review' | '/next';
	type RouteItem = {
		href: RoutePath;
		label: string;
		description?: string;
	};

	const ROUTES: readonly RouteItem[] = [
		{ href: '/work', label: 'Work' },
		{ href: '/webmcp-challenge', label: 'Guide' },
		{ href: '/priority', label: 'Priority', description: __NEBIUS_EDITION__ ? 'Find work that needs attention.' : 'Standalone recommendation view' },
		{ href: '/review', label: 'Review', description: __NEBIUS_EDITION__ ? 'Browse blockers and missing task details.' : 'Full evidence queue' },
		{ href: '/next', label: __NEBIUS_EDITION__ ? 'Next step' : 'Next', description: 'Full next-action editor' }
	];
	const TOOL_ROUTES = ROUTES.filter((item) =>
		item.href === '/priority' || item.href === '/review' || (!__NEBIUS_EDITION__ && item.href === '/next')
	);

	let { children }: { children: any } = $props();
	let pathname = $derived($page.url.pathname);
	let routeLabel = $derived(ROUTES.find((item) => item.href === pathname)?.label ?? 'WebMCP demo');
	let activeToolRoute = $derived(TOOL_ROUTES.find((item) => item.href === pathname) ?? null);
	let pendingApprovals = $derived(pendingNextActionDrafts($demoState));
	let pendingNavigation = $derived(pendingDraftNavigation({ pendingNextActionDrafts: pendingApprovals }));
	let pendingResumeHref = $derived(pendingNavigation.resumeHref);
	let recoveryBusy = $state(false);
	let recoveryError = $state('');
	let pendingCenterOpen = $state(false);
	let toolsOpen = $state(false);
	let toolsTrigger: HTMLButtonElement | null = $state(null);
	let online = $state(true);
	let waitingWorker = $state<ServiceWorker | null>(null);
	let requestedWorker = $state<ServiceWorker | null>(null);
	let updateAvailable = $derived(waitingWorker !== null || requestedWorker !== null);
	let reconcileUpdate: (() => void) | null = null;
	let quarantined = $derived((($demoState?.recoveryQuarantine ?? []) as Array<{ id: string; reason: string }>));

	onMount(() => {
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

	function restoreToolsFocus() {
		requestAnimationFrame(() => toolsTrigger?.focus({ preventScroll: true }));
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

<div class="challenge-shell">
	<a class="challenge-skip" href="#challenge-main">Skip to current page</a>

	<header class="challenge-shell-nav">
		<a
			class="challenge-brand"
			href="/landing.html"
			data-sveltekit-reload
			aria-label="Wornpage Projects landing page"
		>
			<span>Wornpage Projects</span>
			<small>{__NEBIUS_EDITION__ ? 'Nebius edition' : 'WebMCP edition'}</small>
		</a>

		<nav aria-label="Projects application navigation">
			<a
				class="challenge-nav-control challenge-work-link"
				href="/work"
				data-nav-label="Work"
				aria-current={pathname === '/work' ? 'page' : undefined}
			>Work</a>
			{#if __NEBIUS_EDITION__}
				<a class="challenge-nav-control" href="/next" aria-current={pathname === '/next' ? 'page' : undefined}>Next step</a>
			{/if}
			{#if pendingNavigation.count > 0}
				<a
					class="challenge-nav-control pending-approval-link"
					href={pendingResumeHref}
					data-nav-label={`Pending ${pendingNavigation.count}`}
					aria-label={`Resume ${pendingNavigation.count} pending approval${pendingNavigation.count === 1 ? '' : 's'}`}
					onclick={(event) => { event.preventDefault(); pendingCenterOpen = true; }}
				>Pending {pendingNavigation.count}</a>
			{/if}
			<a
				class="challenge-nav-control"
				href="/webmcp-challenge"
				data-nav-label="Guide"
				aria-current={pathname === '/webmcp-challenge' ? 'page' : undefined}
			>Guide</a>
			<button
				class="challenge-nav-control tools-trigger"
				class:contains-current-route={Boolean(activeToolRoute)}
				type="button"
				data-tools-trigger
				data-nav-label="Tools"
				data-route-active={activeToolRoute ? 'true' : undefined}
				aria-haspopup="dialog"
				aria-expanded={toolsOpen}
				aria-controls="workflow-tools-panel"
				aria-label={activeToolRoute ? `Tools, ${activeToolRoute.label} is the current view` : 'Tools'}
				bind:this={toolsTrigger}
				onclick={() => (toolsOpen = true)}
			>
				<span>Tools</span>
				{#if activeToolRoute}<small aria-hidden="true">{activeToolRoute.label}</small>{/if}
			</button>
		</nav>

		{#if !__NEBIUS_EDITION__}<WebMcpStatus />{/if}
		{#if updateAvailable}<WornButton class="offline-status" size="sm" type="button" onclick={reloadForUpdate} disabled={requestedWorker !== null}>{requestedWorker ? 'Updating…' : 'Reload to update'}</WornButton>{:else if !online}<span class="offline-status" role="status" aria-live="polite">Offline mode — local workspace remains available.</span>{/if}
	</header>

	{#if !__NEBIUS_EDITION__}<WebMcpHandoffRail />{/if}

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

	<div class="demo-toast-container">
		{#each $toasts as toast (toast.id)}
			<WornToast {toast} ondismiss={() => dismissToast(toast.id)} />
		{/each}
	</div>

	<main id="challenge-main" class="challenge-route" tabindex="-1" aria-label={`${routeLabel} page`}>
		{@render children()}
	</main>

	<PendingApprovalsCenter bind:open={pendingCenterOpen} drafts={pendingApprovals} packs={($demoState?.packs ?? []) as any} />

	<WornDialog bind:open={toolsOpen} title="Tools" size="sm" onclose={restoreToolsFocus}>
		<div id="workflow-tools-panel" class="workflow-tools-panel" data-workflow-tools-panel>
			<p class="workflow-tools-intro">{__NEBIUS_EDITION__ ? 'Find tasks that need attention. Open a task’s Next step to edit it or review evidence with Nebius.' : 'Optional focused views support Work: narrow evidence, prepare a handoff, then return for the human decision.'}</p>
			<nav class="workflow-tools-list" aria-label="Project tools">
				{#each TOOL_ROUTES as item (item.href)}
					<a
						class="workflow-tools-link"
						href={item.href}
						data-workflow-tool-link
						data-tool-label={item.label}
						aria-current={pathname === item.href ? 'page' : undefined}
						onclick={() => (toolsOpen = false)}
					>
						<strong>{item.label}</strong>
						<span>{item.description}</span>
					</a>
				{/each}
			</nav>
		</div>
	</WornDialog>
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

	.challenge-shell-nav nav {
		align-items: center;
		display: flex;
		flex: 0 1 auto;
		flex-wrap: nowrap;
		gap: var(--worn-space-1);
		justify-content: flex-end;
		min-width: 0;
	}

	/* Tablet and compact layouts retain one deliberate application row:
	   Work, Pending when present, Guide, and the secondary Tools surface. */
	@media (max-width: 900px) and (min-width: 701px) {
		.challenge-shell-nav {
			display: grid;
			gap: var(--worn-space-2) var(--worn-space-3);
			grid-template-columns: minmax(0, 1fr) auto;
			padding: var(--worn-space-2);
		}
		.challenge-shell-nav :global(.webmcp-status-pill) { grid-column: 2; grid-row: 1; }
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

	.pending-approval-link {
		border-color: color-mix(in srgb, var(--worn-warning-text) 35%, var(--worn-border));
	}

	.tools-trigger {
		flex-direction: column;
		gap: var(--worn-space-1);
	}

	.tools-trigger small {
		color: inherit;
		font-family: var(--font-typewriter);
		font-size: 9px;
		font-weight: 750;
		line-height: 1;
		max-inline-size: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.challenge-nav-control[aria-current='page'],
	.tools-trigger[data-route-active='true'] {
		background: var(--worn-selected-bg);
		border-color: var(--worn-border-strong);
		box-shadow: inset 0 -2px 0 var(--worn-accent);
		color: var(--worn-selected-fg);
		translate: 0 -1px;
	}

	.workflow-tools-panel {
		display: grid;
		gap: var(--worn-space-4);
		max-inline-size: 100%;
		min-inline-size: 0;
	}

	.workflow-tools-intro {
		color: var(--worn-text-secondary);
		font-size: var(--worn-text-md);
		line-height: 1.5;
		margin: 0;
	}

	.workflow-tools-list {
		display: grid;
		gap: var(--worn-space-2);
	}

	.workflow-tools-link {
		background: color-mix(in srgb, var(--worn-surface) 92%, var(--worn-bg));
		border: 1px solid color-mix(in srgb, var(--worn-border) 72%, transparent);
		border-radius: var(--worn-radius);
		color: var(--worn-text);
		display: grid;
		gap: var(--worn-space-1);
		min-width: 0;
		padding: var(--worn-space-3) var(--worn-space-4);
		text-decoration: none;
	}

	.workflow-tools-link strong {
		font-size: var(--worn-text-lg);
	}

	.workflow-tools-link span {
		color: var(--worn-text-secondary);
		font-size: var(--worn-text-sm);
		line-height: 1.4;
	}

	.workflow-tools-link[aria-current='page'] {
		background: var(--worn-selected-bg);
		border-color: var(--worn-border-strong);
		box-shadow: inset 0 -2px 0 var(--worn-accent);
	}

	.challenge-brand:focus-visible,
	.challenge-nav-control:focus-visible,
	.workflow-tools-link:focus-visible {
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

	.challenge-route :global([data-webmcp-receipt]) {
		animation: challenge-receipt-arrive 440ms cubic-bezier(0.16, 1, 0.3, 1) both;
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

	@keyframes challenge-receipt-arrive {
		0% {
			opacity: 0;
			translate: 0 -12px;
		}
		72% {
			opacity: 1;
			translate: 0 2px;
		}
		100% {
			opacity: 1;
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
		.challenge-nav-control:hover,
		.workflow-tools-link:hover {
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
		.challenge-shell-nav :global(.webmcp-status-pill) { grid-column: 2; grid-row: 1; }

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
		.challenge-route :global([data-webmcp-receipt]) {
			animation: none;
		}

		.challenge-skip:focus {
			transform: none;
		}

		.challenge-nav-control,
		.workflow-tools-link {
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
		.challenge-shell-nav :global(.webmcp-status-pill) {
			grid-column: 1 / -1;
			grid-row: 2;
			justify-content: center;
			justify-self: stretch;
		}
		.challenge-shell-nav nav {
			grid-row: 3;
		}
		.challenge-nav-control {
			font-size: 10px;
		}
	}
</style>
