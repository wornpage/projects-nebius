<script lang="ts">
	import { WornDialog } from '$lib/components';
	import { webMcpCatalog } from '$lib/webmcp.mjs';

	let open = $state(false);
	let toolCount = $derived($webMcpCatalog.tools.length);
	let toolCountLabel = $derived(`${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`);
	let statusLabel = $derived.by(() => {
		switch ($webMcpCatalog.status) {
			case 'ready': return 'ready';
			case 'unavailable': return 'unavailable';
			case 'error': return 'registration error';
			default: return 'connecting';
		}
	});
	let nativeStatus = $derived.by(() => {
		switch ($webMcpCatalog.status) {
			case 'ready':
				return `Native WebMCP is ready. All ${toolCountLabel} on this page registered successfully.`;
			case 'unavailable':
				return 'Native WebMCP is unavailable in this browser. The ordinary page remains usable; the catalog below shows what a compatible browser can register.';
			case 'error':
				return 'Native WebMCP registration failed. This page catalog was aborted, and the ordinary page controls remain available.';
			default:
				return `Native WebMCP is connecting. Ready appears only after all ${toolCountLabel} on this page finish registering.`;
		}
	});
</script>

<button
	type="button"
	class="webmcp-status-pill"
	data-webmcp-status-pill
	data-webmcp-status={$webMcpCatalog.status}
	aria-haspopup="dialog"
	aria-expanded={open}
	aria-label={`WebMCP ${statusLabel}, ${toolCountLabel} on this page`}
	onclick={() => (open = true)}
>
	<span class="webmcp-status-dot" aria-hidden="true"></span>
	<span class="webmcp-status-name">WebMCP</span>
	<span class="webmcp-tool-count">{toolCountLabel}</span>
	<span class="webmcp-status-word">{statusLabel}</span>
</button>

<WornDialog bind:open title="WebMCP tools on this page" size="sm">
	<div class="webmcp-catalog" data-webmcp-status-dialog data-webmcp-status={$webMcpCatalog.status}>
		<section aria-labelledby="webmcp-native-status-heading">
			<h2 id="webmcp-native-status-heading">Native browser status</h2>
			<p class="webmcp-native-status" role="status" aria-live="polite" aria-atomic="true">
				<span class="webmcp-status-dot" aria-hidden="true"></span>
				<span>{nativeStatus}</span>
			</p>
		</section>

		<section aria-labelledby="webmcp-page-tools-heading">
			<h2 id="webmcp-page-tools-heading">Current-page tools · {toolCount}</h2>
			{#if toolCount > 0}
				<ul class="webmcp-tool-list">
					{#each $webMcpCatalog.tools as tool (tool.name)}
						<li data-webmcp-tool-row data-webmcp-tool-authority={tool.authority}>
							<div class="webmcp-tool-row-head">
								<code>{tool.name}</code>
								<span>{tool.authority === 'read-only' ? 'Read only' : 'Page-changing / draft authority'}</span>
							</div>
							<p>{tool.description}</p>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="webmcp-empty-catalog">Waiting for the current page catalog.</p>
			{/if}
		</section>
	</div>
</WornDialog>

<style>
	.webmcp-status-pill {
		align-items: center;
		background: var(--worn-surface);
		border: 1px solid var(--worn-border-strong);
		border-radius: 999px;
		color: var(--worn-text);
		cursor: pointer;
		display: inline-flex;
		font-family: var(--font-typewriter);
		font-size: 12px;
		font-weight: 700;
		gap: 7px;
		justify-self: end;
		min-height: var(--worn-target-min);
		padding: 6px 10px;
		white-space: nowrap;
	}

	.webmcp-status-pill:focus-visible {
		outline: 2px solid var(--worn-link);
		outline-offset: 2px;
	}

	.webmcp-status-dot {
		background: var(--worn-text-muted);
		border-radius: 50%;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--worn-text-muted) 15%, transparent);
		flex: 0 0 auto;
		height: 8px;
		width: 8px;
	}

	[data-webmcp-status='ready'] .webmcp-status-dot {
		background: #168653;
		box-shadow: 0 0 0 2px color-mix(in srgb, #168653 20%, transparent);
	}

	[data-webmcp-status='connecting'] .webmcp-status-dot {
		background: #b97810;
		box-shadow: 0 0 0 2px color-mix(in srgb, #b97810 20%, transparent);
	}

	[data-webmcp-status='error'] .webmcp-status-dot {
		background: #b3261e;
		box-shadow: 0 0 0 2px color-mix(in srgb, #b3261e 18%, transparent);
	}

	.webmcp-status-word {
		background: var(--worn-selected-bg);
		border: 1px solid var(--worn-border);
		border-radius: 999px;
		color: var(--worn-text-secondary);
		font-size: 10px;
		font-weight: 750;
		padding: 2px 6px;
		text-transform: capitalize;
	}

	.webmcp-tool-count {
		color: var(--worn-text-muted);
		font-size: 11px;
		font-weight: 600;
	}

	.webmcp-catalog,
	.webmcp-catalog section {
		display: grid;
		gap: 12px;
		min-width: 0;
	}

	.webmcp-catalog {
		gap: 20px;
		max-height: min(68vh, 620px);
		overflow-y: auto;
		padding: 2px;
	}

	.webmcp-catalog h2 {
		font-size: 14px;
		margin: 0;
	}

	.webmcp-native-status {
		align-items: start;
		background: var(--worn-selected-bg);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius-sm);
		color: var(--worn-text-secondary);
		display: grid;
		font-size: 13px;
		gap: 9px;
		grid-template-columns: auto minmax(0, 1fr);
		line-height: 1.5;
		margin: 0;
		padding: 10px;
	}

	.webmcp-native-status .webmcp-status-dot {
		margin-top: 6px;
	}

	.webmcp-tool-list {
		display: grid;
		gap: 9px;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.webmcp-tool-list li {
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius-sm);
		display: grid;
		gap: 8px;
		min-width: 0;
		padding: 11px;
	}

	.webmcp-tool-row-head {
		align-items: start;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: space-between;
	}

	.webmcp-tool-row-head code {
		color: var(--worn-text);
		font-family: var(--font-typewriter);
		font-size: 12px;
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.webmcp-tool-row-head span {
		background: var(--worn-selected-bg);
		border: 1px solid var(--worn-border);
		border-radius: 999px;
		color: var(--worn-text-secondary);
		font-family: var(--font-typewriter);
		font-size: 10px;
		font-weight: 700;
		padding: 3px 7px;
	}

	.webmcp-tool-list p,
	.webmcp-empty-catalog {
		color: var(--worn-text-secondary);
		font-size: 13px;
		line-height: 1.5;
		margin: 0;
	}

	@media (hover: hover) and (pointer: fine) {
		.webmcp-status-pill:hover {
			background: var(--worn-hover-bg);
		}
	}

	@media (max-width: 500px) {
		.webmcp-status-pill {
			gap: 4px;
			padding-inline: 7px;
		}

		.webmcp-status-name {
			display: none;
		}

		.webmcp-status-word {
			padding-inline: 4px;
		}

		.webmcp-tool-count {
			font-size: 10px;
		}

		.webmcp-catalog {
			max-height: 72vh;
		}

		.webmcp-tool-row-head {
			display: grid;
		}

		.webmcp-tool-row-head span {
			justify-self: start;
		}
	}

</style>
