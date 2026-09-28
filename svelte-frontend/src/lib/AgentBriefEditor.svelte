<script lang="ts">
	import { tick } from 'svelte';
	import { WornButton, WornChip } from '$lib/components';
	import { guideWorkAction } from '$lib/guide-work-action.mjs';

	type DerivedScopeChoice = {
		id: string;
		kind: 'derived';
		label: string;
		query: string;
		matchingCount: number;
	};
	type ScopeCatalog = {
		workspaceCount: number;
		visibleCount: number;
		discoveredChoiceCount: number;
		shownChoiceCount: number;
		omittedChoiceCount: number;
		choices: DerivedScopeChoice[];
	};

	export const DEFAULT_AGENT_BRIEF = 'Use the WebMCP tools on Work, Review, and Next to inspect the visible project state, narrow the items that need attention, and prepare an evidence-based next action for my review. Do not save or change workspace data.';
	export const FAST_CREATE_AGENT_BRIEF = 'Use the WebMCP tools on Work, Review, and Next to inspect the visible project state, narrow the items that need attention, and prepare an evidence-based next action for my review without saving it. Then return to Work, read the latest workspace count, and create exactly three distinct browser-local Draft work items based on the visible project state. Do not save, start, block, complete, or delete work. Stop on the visible create_work_drafts receipt.';

	let {
		scopeCatalog,
		selectedScopeId = $bindable('all'),
		workQuery = $bindable(''),
		selectedMatchingCount
	}: {
		scopeCatalog: ScopeCatalog;
		selectedScopeId?: string;
		workQuery?: string;
		selectedMatchingCount: number;
	} = $props();

	let brief = $state(DEFAULT_AGENT_BRIEF);
	let customQuery = $state('');
	let status = $state('Local draft · not saved · workspace unchanged');
	let briefInput = $state<HTMLTextAreaElement | null>(null);
	let selectedDerivedScope = $derived(scopeCatalog.choices.find(({ id }) => id === selectedScopeId) ?? null);
	let selectedScopeKind = $derived(selectedScopeId === 'custom' ? 'custom' : selectedDerivedScope ? 'derived' : 'all');
	let selectedScopeLabel = $derived(selectedScopeId === 'custom' ? 'Custom' : selectedDerivedScope?.label ?? 'All visible work');
	let selectedScopeAction = $derived(guideWorkAction({
		kind: selectedScopeKind,
		label: selectedScopeLabel,
		query: workQuery,
		matchingCount: selectedMatchingCount
	}));

	$effect(() => {
		if (selectedScopeId === 'all' || selectedScopeId === 'custom' || selectedDerivedScope) return;
		selectedScopeId = 'all';
		workQuery = '';
	});

	function noteLocalDraft() {
		status = 'Local draft · not saved · workspace unchanged';
	}

	function chooseScope(id: string) {
		selectedScopeId = id;
		if (id === 'custom') {
			workQuery = customQuery;
		} else if (id === 'all') {
			workQuery = '';
		} else {
			workQuery = scopeCatalog.choices.find((choice) => choice.id === id)?.query ?? '';
		}
		noteLocalDraft();
	}

	function noteCustomQuery() {
		customQuery = workQuery;
		noteLocalDraft();
	}

	function resetBrief() {
		brief = DEFAULT_AGENT_BRIEF;
		customQuery = '';
		selectedScopeId = 'all';
		workQuery = '';
		noteLocalDraft();
	}

	async function useFastCreateBrief() {
		brief = FAST_CREATE_AGENT_BRIEF;
		status = 'Fast-create brief loaded · local draft not saved · workspace unchanged';
		await tick();
		briefInput?.focus();
		briefInput?.select();
	}

	async function copyBrief() {
		try {
			if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard API unavailable.');
			const scopedQuery = workQuery.trim();
			const copyText = scopedQuery
				? `Brief for the browser agent:\n${brief}\n\nWork to focus on:\n${scopedQuery}`
				: brief;
			await navigator.clipboard.writeText(copyText);
			status = scopedQuery
				? 'Brief and work scope copied · local draft not saved · workspace unchanged'
				: 'Brief copied · local draft not saved · workspace unchanged';
		} catch {
			status = 'Copy unavailable · brief selected for manual copy · workspace unchanged';
			await tick();
			briefInput?.focus();
			briefInput?.select();
		}
	}
</script>

<section class="agent-brief-editor" aria-labelledby="agent-brief-title">
	<div class="agent-brief-heading">
		<div>
			<p class="agent-brief-kicker">Editable browser-agent brief</p>
			<h2 id="agent-brief-title">Set the next investigation</h2>
		</div>
		<p class="agent-brief-limit" id="agent-brief-limit" aria-label={`${brief.length} of 1000 characters`}>{brief.length}/1000</p>
	</div>
	<p class="agent-brief-help" id="agent-brief-help">All visible work is ready by default; choose a counted scope or Custom, then ask: <q>Follow the brief on this page.</q></p>
	<section
		class="agent-scope-chooser"
		aria-labelledby="agent-scope-title"
		data-agent-scope-chooser
		data-workspace-count={scopeCatalog.workspaceCount}
		data-visible-count={scopeCatalog.visibleCount}
		data-discovered-choice-count={scopeCatalog.discoveredChoiceCount}
		data-shown-choice-count={scopeCatalog.shownChoiceCount}
		data-omitted-choice-count={scopeCatalog.omittedChoiceCount}
		data-selected-scope-id={selectedScopeId}
		data-selected-scope-kind={selectedScopeKind}
		data-selected-scope-label={selectedScopeLabel}
		data-selected-work-query={workQuery}
		data-selected-match-count={selectedMatchingCount}
	>
		<div class="agent-scope-heading">
			<h3 id="agent-scope-title">Work to focus on</h3>
			<p>{scopeCatalog.visibleCount} visible of {scopeCatalog.workspaceCount} workspace</p>
		</div>
		<div class="agent-scope-options" role="group" aria-label="Work scope choices">
			<span
				data-agent-scope-choice
				data-scope-id="all"
				data-scope-kind="all"
				data-scope-label="All visible work"
				data-scope-query=""
				data-scope-match-count={scopeCatalog.visibleCount}
			>
				<WornChip label={`All visible work · ${scopeCatalog.visibleCount}`} size="sm" pressed={selectedScopeId === 'all'} onclick={() => chooseScope('all')} />
			</span>
			{#each scopeCatalog.choices as scope (scope.id)}
				<span
					data-agent-scope-choice
					data-scope-id={scope.id}
					data-scope-kind={scope.kind}
					data-scope-label={scope.label}
					data-scope-query={scope.query}
					data-scope-match-count={scope.matchingCount}
				>
					<WornChip label={`${scope.label} · ${scope.matchingCount}`} size="sm" pressed={selectedScopeId === scope.id} onclick={() => chooseScope(scope.id)} />
				</span>
			{/each}
			<span
				data-agent-scope-choice
				data-scope-id="custom"
				data-scope-kind="custom"
				data-scope-label="Custom"
			>
				<WornChip label="Custom…" size="sm" pressed={selectedScopeId === 'custom'} onclick={() => chooseScope('custom')} />
			</span>
		</div>
		{#if scopeCatalog.omittedChoiceCount > 0}
			<p class="agent-brief-help">Showing {scopeCatalog.shownChoiceCount} of {scopeCatalog.discoveredChoiceCount} discovered scopes. Use Custom for another visible term.</p>
		{/if}
		<div class="agent-scope-action" aria-live="polite" data-agent-scope-action>
			{#if selectedScopeAction.href}
				<WornButton data-agent-scope-action-link href={selectedScopeAction.href} size="sm" variant="primary">{selectedScopeAction.label}</WornButton>
			{:else}
				<WornButton data-agent-scope-action-disabled type="button" size="sm" variant="primary" disabled>{selectedScopeAction.label}</WornButton>
			{/if}
		</div>
		{#if selectedScopeId === 'custom'}
			<div class="agent-work-query-field">
				<div class="agent-work-query-label">
					<label for="agent-work-query-input">Custom Work search term (optional)</label>
					<span id="agent-work-query-limit" aria-label={`${workQuery.length} of 120 characters`}>{workQuery.length}/120</span>
				</div>
				<input
					bind:value={workQuery}
					data-agent-work-query-input
					id="agent-work-query-input"
					maxlength="120"
					type="text"
					aria-describedby="agent-work-query-help agent-work-query-limit agent-brief-status"
					oninput={noteCustomQuery}
				/>
				<p id="agent-work-query-help" class="agent-brief-help">Empty includes all visible work; an unmatched term stays at zero.</p>
			</div>
		{/if}
	</section>
	<label for="agent-brief-input">Brief for the browser agent</label>
	<textarea
		bind:this={briefInput}
		bind:value={brief}
		data-agent-brief-input
		id="agent-brief-input"
		maxlength="1000"
		rows="6"
		aria-describedby="agent-brief-help agent-brief-limit agent-brief-status"
		oninput={noteLocalDraft}
	></textarea>
	<div class="agent-brief-actions">
		<WornButton type="button" size="sm" onclick={copyBrief}>Copy brief</WornButton>
		<WornButton data-agent-brief-fast-create type="button" size="sm" onclick={useFastCreateBrief}>Use fast-create brief</WornButton>
		<WornButton type="button" size="sm" onclick={resetBrief}>Reset</WornButton>
		<p id="agent-brief-status" class="agent-brief-status" aria-live="polite">{status}</p>
	</div>
</section>

<style>
	.agent-brief-editor {
		background: var(--worn-bg-secondary);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius);
		display: grid;
		gap: 12px;
		padding: 16px;
	}
	.agent-brief-heading,
	.agent-scope-heading {
		align-items: start;
		display: flex;
		gap: 12px;
		justify-content: space-between;
	}
	.agent-brief-kicker,
	.agent-brief-limit {
		color: var(--worn-text-secondary);
		font-family: var(--font-typewriter);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		margin: 0;
		text-transform: uppercase;
	}
	.agent-brief-limit {
		white-space: nowrap;
	}
	.agent-brief-editor h2 {
		font-size: 18px;
		margin: 3px 0 0;
	}
	.agent-brief-help,
	.agent-brief-status,
	.agent-scope-heading p {
		color: var(--worn-text-secondary);
		font-size: 14px;
		line-height: 1.5;
		margin: 0;
	}
	.agent-brief-editor label,
	.agent-scope-heading h3 {
		font-size: 14px;
		font-weight: 700;
		margin: 0;
	}
	.agent-scope-heading p {
		font-family: var(--font-typewriter);
		font-size: 12px;
		white-space: nowrap;
	}
	.agent-scope-chooser,
	.agent-work-query-field {
		display: grid;
		gap: 8px;
	}
	.agent-scope-chooser {
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius);
		padding: 12px;
	}
	.agent-scope-options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.agent-scope-options span {
		display: inline-flex;
		min-width: 0;
	}
	.agent-scope-action {
		display: flex;
		justify-content: flex-start;
	}
	.agent-work-query-label {
		align-items: baseline;
		display: flex;
		gap: 12px;
		justify-content: space-between;
	}
	.agent-work-query-label span {
		color: var(--worn-text-secondary);
		font-family: var(--font-typewriter);
		font-size: 12px;
		white-space: nowrap;
	}
	.agent-brief-editor input,
	.agent-brief-editor textarea {
		background: var(--worn-surface);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius);
		box-sizing: border-box;
		color: var(--worn-text);
		font: inherit;
		line-height: 1.5;
		padding: 10px 12px;
		width: 100%;
	}
	.agent-brief-editor textarea {
		min-height: 144px;
		resize: vertical;
	}
	.agent-brief-editor input:focus-visible,
	.agent-brief-editor textarea:focus-visible {
		outline: 2px dashed var(--worn-focus);
		outline-offset: 2px;
	}
	.agent-brief-actions {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.agent-brief-status {
		flex: 1 1 220px;
	}
	@media (max-width: 520px) {
		.agent-brief-editor {
			padding: 14px;
		}
		.agent-brief-heading,
		.agent-scope-heading {
			align-items: start;
			flex-direction: column;
		}
		.agent-scope-heading p {
			white-space: normal;
		}
		.agent-scope-options :global(button) {
			max-width: 100%;
		}
		.agent-brief-actions :global(.worn-btn) {
			flex: 1 1 auto;
			min-height: 44px;
		}
		.agent-brief-status {
			flex-basis: 100%;
		}
	}
</style>
