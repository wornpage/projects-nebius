<script lang="ts">
	import {
		createPack,
		DEMO_WORK_TITLE_MAX_LENGTH,
		displayToast
	} from '$lib/demo-client';
	import { normalizeWorkTitle } from '$lib/canonical-text.mjs';
	import { ENERGY_OPTIONS, PACK_ENERGIES } from '$lib/demo-workflow';
	import { WornButton, WornInput, WornSelect, WornTextarea } from '$lib/components';

	type WorkQuickAddFilters = {
		owner: string;
		area: string;
		energy: string;
		recurrence: string;
	};

	let {
		filters,
		onCreated,
		busy = $bindable(false)
	}: {
		filters: WorkQuickAddFilters;
		onCreated?: () => void;
		busy?: boolean;
	} = $props();

	const QUICK_METADATA_MAX_LENGTH = 120;
	let form: HTMLFormElement | null = null;
	let title = $state('');
	let proofTarget = $state('');
	let purpose = $state('');
	let writtenNextStep = $state('');
	let owner = $state('');
	let area = $state('');
	let type = $state('');
	let due = $state('');
	let energy = $state('');
	let recurrence = $state('');

	function setHumanQuickTitle(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (normalizeWorkTitle(input.value) === null) {
			input.value = title;
			return;
		}
		title = input.value;
	}

	async function quickCreate() {
		const normalizedTitle = title.trim();
		const normalizedProofTarget = proofTarget.trim();
		const normalizedOwner = owner.trim() || (filters.owner !== 'all' && filters.owner !== '_unassigned' ? filters.owner : '');
		const normalizedArea = area.trim() || (filters.area !== 'all' && filters.area !== '_none' ? filters.area : '');
		const normalizedType = type.trim();
		const normalizedDue = due.trim();
		const normalizedEnergy = PACK_ENERGIES.includes(energy)
			? energy
			: filters.energy !== 'all' && PACK_ENERGIES.includes(filters.energy) ? filters.energy : '';
		const normalizedRecurrence = recurrence.trim() || (filters.recurrence !== 'all' ? filters.recurrence : '');
		if (!normalizedTitle || busy) return;
		busy = true;
		try {
			await createPack({
				title: normalizedTitle,
				status: 'active',
				next: 'Open',
				doneWhen: normalizedProofTarget || undefined,
				purpose: purpose.trim() || undefined,
				nextStep: writtenNextStep.trim() || undefined,
				owner: normalizedOwner || undefined,
				area: normalizedArea || undefined,
				type: normalizedType || undefined,
				due: normalizedDue || undefined,
				energy: normalizedEnergy || undefined,
				recurrence: normalizedRecurrence || undefined
			});
			onCreated?.();
			title = '';
			proofTarget = '';
			purpose = '';
			writtenNextStep = '';
			owner = '';
			area = '';
			type = '';
			due = '';
			energy = '';
			recurrence = '';
		} catch {
			displayToast('Quick create failed', 'error');
		} finally {
			busy = false;
			setTimeout(() => form?.querySelector<HTMLInputElement>('.quick-create-input')?.focus(), 0);
		}
	}
</script>

<form bind:this={form} class="quick-create-row" aria-label="Quick add a work item" onsubmit={(event) => { event.preventDefault(); quickCreate(); }}>
	<WornInput
		class="quick-create-input"
		bind:value={title}
		oninput={setHumanQuickTitle}
		placeholder="Quick-add a work item…"
		aria-label="Quick-add a work item"
		aria-describedby="quick-create-title-help"
		disabled={busy}
	/>
	<span class="quick-create-title-help" id="quick-create-title-help">Up to {DEMO_WORK_TITLE_MAX_LENGTH} Unicode characters.</span>
	<WornButton class="quick-create-submit" data-work-quick-create-submit type="submit" variant="primary" size="sm" disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add'}</WornButton>
	<details class="quick-create-options">
		<summary>Work details <span>Optional</span></summary>
		<p class="quick-create-details-help" id="quick-create-details-help">Blank owner, area, energy, and recurrence fields inherit active Work filters when possible.</p>
		<div class="quick-create-details-grid">
			{#if __NEBIUS_EDITION__}
				<label for="work-quick-purpose">Why it matters<WornTextarea id="work-quick-purpose" rows={2} bind:value={purpose} maxlength={1000} disabled={busy} /></label>
				<label for="work-quick-written-next">Written next step<WornTextarea id="work-quick-written-next" rows={2} bind:value={writtenNextStep} maxlength={2000} disabled={busy} /></label>
			{/if}
			<WornInput id="work-quick-owner" bind:value={owner} maxlength={QUICK_METADATA_MAX_LENGTH} placeholder="Owner" aria-label="Quick-add owner" aria-describedby="quick-create-details-help" disabled={busy} />
			<WornInput id="work-quick-area" bind:value={area} maxlength={QUICK_METADATA_MAX_LENGTH} placeholder="Area" aria-label="Quick-add area" aria-describedby="quick-create-details-help" disabled={busy} />
			<WornInput id="work-quick-type" bind:value={type} maxlength={QUICK_METADATA_MAX_LENGTH} placeholder="Type" aria-label="Quick-add type" disabled={busy} />
			<WornInput id="work-quick-due" class="quick-due-input" type="date" bind:value={due} aria-label="Quick-add due date" disabled={busy} />
			<WornSelect id="work-quick-energy" bind:value={energy} aria-label="Quick-add energy" options={[{ value: '', label: 'Energy' }, ...ENERGY_OPTIONS]} disabled={busy} />
			<WornInput id="work-quick-recurrence" bind:value={recurrence} maxlength={QUICK_METADATA_MAX_LENGTH} placeholder="Recurrence" aria-label="Quick-add recurrence" aria-describedby="quick-create-details-help" disabled={busy} />
			<WornInput id="work-quick-proof-target" class="quick-proof-input" bind:value={proofTarget} maxlength={1000} placeholder="What will prove this is done?" aria-label="Quick-add proof target" disabled={busy} />
		</div>
	</details>
</form>

<style>
	.quick-create-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;margin-block:8px 6px}
	:global(.quick-create-input){flex:1;min-width:0}
	.quick-create-title-help{clip:rect(0 0 0 0);clip-path:inset(50%);height:1px;overflow:hidden;position:absolute;white-space:nowrap;width:1px}
	.quick-create-row :global(.quick-create-submit){flex:0 0 auto;min-inline-size:max-content;white-space:nowrap}
	.quick-create-options{grid-column:1 / -1;min-width:0}
	.quick-create-options summary{align-items:center;background:var(--worn-surface);border:1px solid var(--worn-border-strong);border-radius:var(--worn-radius-sm);color:var(--worn-text-secondary);cursor:pointer;display:flex;font-size:13px;font-weight:700;gap:8px;min-block-size:36px;padding:6px 10px;width:max-content}
	.quick-create-options summary::after{content:'›';font-size:18px;line-height:1;transition:transform .12s ease}
	.quick-create-options[open] summary::after{transform:rotate(90deg)}
	.quick-create-options summary:focus-visible{outline:2px dashed var(--worn-focus);outline-offset:2px}
	.quick-create-options summary:hover{background:var(--worn-bg-secondary)}
	.quick-create-options summary span{color:var(--worn-text-muted);font-family:var(--font-typewriter);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
	.quick-create-details-help{color:var(--worn-text-muted);font-size:12px;margin:0 0 8px}
	.quick-create-details-grid{display:grid;gap:8px;grid-template-columns:repeat(3,minmax(0,1fr))}
	.quick-create-details-grid :global(.worn-input),.quick-create-details-grid :global(.worn-select){min-width:0;width:100%}
	.quick-create-details-grid :global(.quick-due-input){max-inline-size:200px}
	.quick-create-details-grid :global(.quick-proof-input){grid-column:1 / -1}
	@media(max-width:500px){
		.quick-create-row{margin-inline:4px}
	}
	@media(max-width:420px){
		.quick-create-row{align-items:stretch}
		.quick-create-row :global(.quick-create-submit){min-block-size:44px}
		.quick-create-options summary{min-block-size:44px}
		.quick-create-details-grid{grid-template-columns:minmax(0,1fr)}
		.quick-create-details-grid :global(.quick-proof-input){grid-column:auto}
	}
</style>
