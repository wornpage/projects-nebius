<script lang="ts">
	import { page } from '$app/stores';
	import { WornButton, WornError, WornPage } from '$lib/components';
</script>

<svelte:head><title>Error — Wornpage Projects™</title></svelte:head>

<!-- Root error boundary for unknown challenge routes and load failures. -->
<WornPage sectionLabel={$page.status === 404 ? undefined : `Error ${$page.status}`} title="{$page.status === 404 ? 'Page not found' : 'Could not load this page'}">
	{#if $page.status === 404}
		<p data-error-description>The address does not match a public Projects page.</p>
	{:else}
		<WornError
			message={`Projects could not load ${$page.url.pathname}.`}
			onretry={$page.status >= 500 ? () => location.reload() : undefined}
		/>
	{/if}
	<div class="demo-quick-actions">
		<WornButton href="/webmcp-challenge">Open the guide</WornButton>
	</div>
</WornPage>
