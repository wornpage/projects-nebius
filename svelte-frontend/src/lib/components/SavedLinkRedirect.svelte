<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { savedNebiusLinkDestination } from '$lib/decision-workspace-navigation.mjs';
	let { route }: { route: 'priority' | 'review' | 'help' } = $props();
	let destination = $state<{href: string, document: boolean} | null>(null);
	let failed = $state(false);
	onMount(() => {
		destination = savedNebiusLinkDestination(route, $page.url);
		if (destination.document) window.location.replace(destination.href);
		else void goto(destination.href, { replaceState: true }).catch(() => {failed = true;});
	});
</script>

<svelte:head><title>Opening saved page — Wornpage Projects™</title></svelte:head>

<section aria-label="Saved page">
	<p role="status">{failed ? 'The page could not open automatically.' : 'Opening the current page…'}</p>
	<a href={destination?.href || '/work'} data-sveltekit-reload>{destination ? 'Open the current page' : 'Open Work'}</a>
</section>
