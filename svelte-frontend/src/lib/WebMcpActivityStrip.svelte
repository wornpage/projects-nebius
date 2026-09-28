<script lang="ts">
	type ActivityCell = {
		label: string;
		value: string;
	};

	let {
		id,
		route,
		outcome,
		toolName,
		cells
	}: {
		id?: string;
		route: 'work' | 'review' | 'next';
		outcome: string;
		toolName: string;
		cells: ActivityCell[];
	} = $props();

	const routeLabel = $derived(route[0].toUpperCase() + route.slice(1));
	const receiptMeta = $derived.by(() => {
		switch (toolName) {
			case 'show_work_search':
				return { step: 'Step 1 · Narrow Work', authority: 'Page view only · Workspace unchanged' };
			case 'set_review_scope':
				return { step: 'Step 2 · Verify Review', authority: 'Page view only · Workspace unchanged' };
			case 'prepare_next_action':
				return { step: 'Step 3 · Prepare Next', authority: 'Unsaved proposal · Human approval required' };
			case 'create_work_drafts':
				return { step: 'Step 4 · Stage Drafts', authority: 'Draft only · Human Start required' };
			default:
				return { step: `${routeLabel} activity`, authority: 'Bounded page tool' };
		}
	});
</script>

<div class="webmcp-activity-inset">
	<section
		{id}
		class="webmcp-activity-strip"
		data-webmcp-receipt={route}
		aria-label={`Latest ${routeLabel} agent activity`}
		role="status"
		aria-live="polite"
		aria-atomic="true"
	>
		<div class="webmcp-activity-strip-head">
			<p class="webmcp-activity-kicker">Live WebMCP handoff</p>
			<span class="webmcp-activity-step">{receiptMeta.step}</span>
		</div>
		<p class="webmcp-activity-outcome">{outcome}</p>
		<dl class="webmcp-activity-evidence">
			{#each cells as cell (cell.label)}
				<div>
					<dt>{cell.label}</dt>
					<dd>{cell.value}</dd>
				</div>
			{/each}
		</dl>
		<footer class="webmcp-activity-strip-foot">
			<span class="webmcp-activity-authority">{receiptMeta.authority}</span>
			<p class="webmcp-tool-provenance">WebMCP · {toolName}</p>
		</footer>
	</section>
</div>

<style>
	.webmcp-activity-inset {
		box-sizing: border-box;
		min-width: 0;
		padding: 12px;
		width: 100%;
	}

	.webmcp-activity-strip {
		background: color-mix(in srgb, var(--worn-selected-bg) 58%, var(--worn-surface));
		border: 1px solid var(--worn-accent);
		border-radius: var(--worn-radius);
		box-sizing: border-box;
		box-shadow: var(--worn-shadow-sm);
		display: grid;
		gap: 8px;
		max-inline-size: 100%;
		min-width: 0;
		padding: 12px 14px;
		position: static;
		width: 100%;
	}

	.webmcp-activity-strip-head {
		align-items: baseline;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		justify-content: space-between;
		min-width: 0;
	}

	.webmcp-activity-kicker,
	.webmcp-activity-step,
	.webmcp-activity-authority,
	.webmcp-tool-provenance,
	.webmcp-activity-outcome,
	.webmcp-activity-evidence,
	.webmcp-activity-evidence dt,
	.webmcp-activity-evidence dd {
		margin: 0;
	}

	.webmcp-activity-kicker {
		color: var(--worn-link);
		font-size: 12px;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.webmcp-activity-step,
	.webmcp-activity-authority {
		background: var(--worn-surface);
		border: 1px solid var(--worn-border);
		border-radius: 999px;
		color: var(--worn-text-secondary);
		font-size: 12px;
		font-weight: 750;
		padding: 4px 8px;
	}

	.webmcp-tool-provenance {
		color: var(--worn-text-secondary);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	.webmcp-activity-outcome {
		color: var(--worn-text);
		font-size: 18px;
		font-weight: 700;
		line-height: 1.3;
	}

	.webmcp-activity-evidence {
		display: grid;
		gap: 6px 14px;
		grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
		min-width: 0;
	}

	.webmcp-activity-evidence > div {
		border-top: 1px solid color-mix(in srgb, var(--worn-border) 82%, transparent);
		min-width: 0;
		padding-top: 6px;
	}

	.webmcp-activity-evidence dt {
		color: var(--worn-text-muted);
		font-size: 12px;
		font-weight: 650;
		line-height: 1.3;
	}

	.webmcp-activity-evidence dd {
		color: var(--worn-text-secondary);
		font-size: 14px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.webmcp-activity-strip-foot {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		justify-content: space-between;
	}

	.webmcp-activity-authority {
		color: var(--worn-link);
	}

	@media (max-width: 500px) {
		.webmcp-activity-inset {
			padding: 8px;
		}

		.webmcp-activity-strip {
			gap: 6px;
			padding: 11px 12px;
		}

		.webmcp-activity-outcome {
			font-size: 16px;
		}

		.webmcp-activity-evidence {
			gap: 4px 10px;
		}

		.webmcp-activity-evidence dt {
			font-size: 11px;
		}

		.webmcp-activity-evidence dd {
			font-size: 12px;
		}

		.webmcp-activity-strip-head {
			align-items: start;
			flex-direction: column;
		}

		.webmcp-activity-strip-foot {
			align-items: start;
			flex-direction: column;
		}
	}
</style>
