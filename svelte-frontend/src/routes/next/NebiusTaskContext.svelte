<script lang="ts">
	import { WornBadge, WornPanel, WornSelect } from '$lib/components';
	import { blockerText, hasBlocker, workTitle, type DemoPack } from '$lib/demo-workflow';

	let { pack, packs, disabled, onselect }: {
		pack: DemoPack;
		packs: DemoPack[];
		disabled: boolean;
		onselect: (pack: DemoPack) => void;
	} = $props();
	let status = $derived(pack.status ? pack.status.charAt(0).toUpperCase() + pack.status.slice(1) : 'No status');
	let options = $derived(packs.map((item) => ({ value: item.id, label: workTitle(item) })));
</script>

<aside class="task-context" aria-label="Selected task" data-nebius-current-task>
	<WornPanel heading="Task brief">
		<div class="context-body">
			<div class="context-state">
				<WornBadge label={status} variant={hasBlocker(pack) ? 'warn' : 'muted'} />
				<span>Saved in this browser</span>
			</div>
			<dl class="saved-step">
				<dt>Saved next step</dt>
				<dd data-nebius-saved-next-step>{pack.nextStep || 'No next step recorded.'}</dd>
			</dl>
			<details class="task-requirements">
				<summary>{hasBlocker(pack) ? 'Blocker and task details' : 'Purpose and completion criteria'}</summary>
				<dl>
					{#if hasBlocker(pack)}<dt>Blocker</dt><dd class="task-blocker">{blockerText(pack)}</dd>{/if}
					<dt>Purpose</dt><dd>{pack.purpose || 'No purpose recorded.'}</dd>
					<dt>Done when</dt><dd>{pack.doneWhen || 'No completion criteria recorded.'}</dd>
				</dl>
				<a class="context-work-link" href={`/work?focus=${encodeURIComponent(pack.id)}`}>View in Work <span aria-hidden="true">↗</span></a>
			</details>
			<div class="task-switcher" data-nebius-work-selector>
				<label for="nebius-work-item">Switch task</label>
				<WornSelect id="nebius-work-item" value={pack.id} {options} {disabled} onchange={(event) => {
					const selectedId = (event.currentTarget as HTMLSelectElement).value;
					const candidate = packs.find((item) => item.id === selectedId);
					if (candidate) onselect(candidate);
				}} />
			</div>
		</div>
	</WornPanel>
</aside>

<style>
	.task-context {
		--worn-panel-padding: 16px;
		--worn-panel-head-padding: 0;
		--worn-panel-head-margin-block-end: 12px;
		--worn-panel-heading-size: 1rem;
		--worn-panel-margin-block-end: 0;
		--worn-panel-border: var(--worn-border);
		--worn-panel-shadow: none;
		min-inline-size: 0;
	}
	.context-body { display: grid; gap: 16px; min-inline-size: 0; }
	.context-state { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
	.context-state > span { color: var(--worn-text-muted); font-size: .75rem; }
	dl, dd { margin: 0; }
	dt { color: var(--worn-text-secondary); font-size: .75rem; font-weight: 650; margin-block-end: 5px; }
	dd { font-size: .875rem; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
	.task-blocker { border: 1px solid var(--worn-warning-text); border-radius: var(--worn-radius-md); padding: 8px 12px; }
	.task-requirements { border-block-start: 1px solid var(--worn-border); }
	.task-requirements summary { align-content: center; cursor: pointer; font-size: .8125rem; min-block-size: 44px; }
	.task-requirements dl { display: grid; gap: 4px; padding-block: 4px 12px; }
	.task-requirements dd + dt { margin-block-start: 8px; }
	.task-switcher { display: grid; gap: 8px; min-inline-size: 0; }
	.task-switcher label { font-size: .8125rem; font-weight: 650; }
	.context-work-link { align-items: center; color: var(--worn-link); display: flex; font-size: .8125rem; justify-content: space-between; min-block-size: 44px; text-decoration: none; }
	.context-work-link:hover { text-decoration: underline; }
	.context-work-link:focus-visible, summary:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
</style>
