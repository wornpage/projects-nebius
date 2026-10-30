<script lang="ts">
	import { WornBadge, WornButton, WornSelect } from '$lib/components';
	import { blockerText, hasBlocker, workTitle, type DemoPack } from '$lib/demo-workflow';
	import NebiusBriefPreview from './NebiusBriefPreview.svelte';

	let { pack, packs, disabled, showBrief = true, onedit, onselect }: {
		pack: DemoPack;
		packs: DemoPack[];
		disabled: boolean;
		showBrief?: boolean;
		onedit?: (event: MouseEvent) => void;
		onselect: (pack: DemoPack) => void;
	} = $props();
	let status = $derived(pack.status ? pack.status.charAt(0).toUpperCase() + pack.status.slice(1) : 'No status');
	let options = $derived(packs.map((item) => ({ value: item.id, label: workTitle(item) })));
	let purpose = $derived(pack.purpose || 'No purpose recorded.');
	let criteria = $derived(pack.doneWhen || 'No completion criteria recorded.');
	let nextStep = $derived(pack.nextStep || 'No next step recorded.');
	let notes = $derived(pack.memory ?? []);
	let sources = $derived(pack.sources ?? []);
</script>

<section class="task-context" class:compact={!showBrief} aria-label="Selected task" data-nebius-current-task>
		<div class="context-body">
			{#if showBrief}
			<div class="brief-heading"><h2>Task brief</h2>{#if onedit}<WornButton variant="primary" href="#nebius-task-editor" onclick={onedit}>Edit brief</WornButton>{/if}</div>
			<dl class="task-goal" data-nebius-brief-fields>
				<dt>Purpose</dt><dd>{#key pack.id}<NebiusBriefPreview text={purpose} label="Purpose" />{/key}</dd>
				<dt>Next step</dt><dd data-nebius-saved-next-step>{nextStep}</dd>
				<dt>Completion criteria</dt><dd>{#key pack.id}<NebiusBriefPreview text={criteria} label="Completion criteria" />{/key}</dd>
				{#if hasBlocker(pack)}<dt>Blocker</dt><dd class="task-blocker">{blockerText(pack)}</dd>{/if}
			</dl>
			{#if notes.length || sources.length}
				<details class="full-brief captured-context" data-nebius-captured-context>
					<summary>Notes and sources · {notes.length} {notes.length === 1 ? 'note' : 'notes'} · {sources.length} {sources.length === 1 ? 'source' : 'sources'}</summary>
					{#if notes.length}
						<h3>Notes</h3>
						<ul aria-label="Notes">{#each notes as note}<li>{note}</li>{/each}</ul>
					{/if}
					{#if sources.length}
						<h3>Sources</h3>
						<ul aria-label="Sources">{#each sources as source}<li>{source}</li>{/each}</ul>
					{/if}
				</details>
			{/if}
			{/if}
			<div class="context-controls">
			<div class="context-state">
				<WornBadge label={status} variant={hasBlocker(pack) ? 'warn' : 'muted'} />
				{#if showBrief}<span>Saved in browser</span>{/if}
			</div>
			<div class="task-switcher" data-nebius-work-selector>
				<label for="nebius-work-item">Switch task</label>
				<WornSelect id="nebius-work-item" value={pack.id} {options} {disabled} onchange={(event) => {
					const selectedId = (event.currentTarget as HTMLSelectElement).value;
					const candidate = packs.find((item) => item.id === selectedId);
					if (candidate) onselect(candidate);
				}} />
			</div>
			<a class="context-work-link" href={`/work?focus=${encodeURIComponent(pack.id)}`}>View in Work <span aria-hidden="true">↗</span></a>
			</div>
		</div>
</section>

<style>
	.task-context { border-block-end: 1px solid var(--worn-border); margin-block-end: 12px; min-inline-size: 0; padding-block-end: 12px; }
	.brief-heading { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 20px; justify-content: space-between; }
	.brief-heading h2 { font-size: 1rem; margin: 0; }
	.brief-heading :global(.worn-btn) { min-block-size: 44px; }
	.context-body { display: grid; gap: 12px; min-inline-size: 0; }
	.context-controls { align-items: center; display: flex; flex-wrap: wrap; gap: 12px; min-inline-size: 0; }
	.context-state { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
	.context-state > span { color: var(--worn-text-muted); font-size: .8125rem; }
	dl, dd { margin: 0; }
	dt { color: var(--worn-text-secondary); font-size: .8125rem; font-weight: 650; margin-block-end: 4px; }
	dd { font-size: .9375rem; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
	.task-blocker { border: 1px solid var(--worn-warning-text); border-radius: var(--worn-radius-md); padding: 8px 12px; }
	.task-goal { display: grid; gap: 4px; }
	.task-goal dd + dt { margin-block-start: 8px; }
	.full-brief { border-block-start: 1px solid var(--worn-border); }
	.full-brief summary { align-content: center; cursor: pointer; font-size: .8125rem; min-block-size: 44px; }
	.full-brief summary:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.captured-context h3 { color: var(--worn-text-secondary); font-size: .8125rem; margin: 8px 0 4px; }
	.captured-context ul { margin: 0 0 12px; padding-inline-start: 1.25rem; }
	.captured-context li { font-size: .875rem; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
	.captured-context li + li { margin-block-start: 6px; }
	.task-switcher { display: grid; flex: 1 1 16rem; gap: 4px; min-inline-size: 0; }
	.task-switcher label { font-size: .8125rem; font-weight: 650; }
	.context-work-link { align-items: center; color: var(--worn-link); display: flex; font-size: .8125rem; justify-content: space-between; min-block-size: 44px; text-decoration: none; }
	.context-work-link:hover { text-decoration: underline; }
	.context-work-link:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.compact .context-controls { align-items: start; display: grid; gap: 4px 12px; grid-template-columns: minmax(0, 1fr) max-content; }
	.task-context.compact { border-block-end: 0; margin-block-end: 8px; padding-block-end: 0; }
	.compact .task-switcher { grid-column: 1; grid-row: 1 / span 2; }
	.compact .context-state { align-self: end; grid-column: 2; grid-row: 1; }
	.compact .context-work-link { gap: 2px; grid-column: 2; grid-row: 2; }
</style>
