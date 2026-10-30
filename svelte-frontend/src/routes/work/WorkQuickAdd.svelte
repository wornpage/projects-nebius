<script lang="ts">
	import { tick } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { isAllWorkScopeUrl } from '$lib/nebius-command-context';
	import { createPack, undoCreatedPack, DEMO_WORK_TITLE_MAX_LENGTH, displayToast, type CreatedPackUndoToken } from '$lib/demo-client';
	import { normalizeWorkTitle } from '$lib/canonical-text.mjs';
	import { ENERGY_OPTIONS, PACK_ENERGIES, type DemoPack } from '$lib/demo-workflow';
	import { WornButton, WornInput, WornSelect, WornTextarea } from '$lib/components';

	type WorkQuickAddFilters = { owner: string; area: string; energy: string; recurrence: string };
	let { filters, projects = [], selectedProjectId = null, onCreated, onUndone, busy = $bindable(false) }: {
		filters: WorkQuickAddFilters;
		projects?: Array<{ id: string; title: string }>;
		selectedProjectId?: string | null;
		onCreated?: (pack: DemoPack) => void | Promise<void>;
		onUndone?: () => void;
		busy?: boolean;
	} = $props();

	const QUICK_METADATA_MAX_LENGTH = 120;
	let form = $state<HTMLFormElement | null>(null);
	let open = $state(false);
	let title = $state('');
	let notes = $state('');
	let sourceUrl = $state('');
	let projectId = $state('');
	let initialProjectId = $state('');
	let intakeFocusRequest = 0;
	let proofTarget = $state('');
	let purpose = $state('');
	let writtenNextStep = $state('');
	let owner = $state('');
	let area = $state('');
	let type = $state('');
	let due = $state('');
	let energy = $state('');
	let recurrence = $state('');
	let titleError = $state('');
	let notesError = $state('');
	let sourceError = $state('');
	let projectError = $state('');
	let saveError = $state('');
	let revealWarning = $state('');
	let created = $state<{ pack: DemoPack; undoToken: CreatedPackUndoToken } | null>(null);
	let undoError = $state('');
	let dirty = $derived(Boolean(title.trim() || notes.trim() || sourceUrl.trim() || proofTarget.trim() || purpose.trim() || writtenNextStep.trim() || owner.trim() || area.trim() || type.trim() || due || energy || recurrence.trim() || projectId !== initialProjectId));

	async function recoverDraftFocus() {
		await tick();
		if (busy) form?.focus();
		else form?.querySelector<HTMLInputElement>('.quick-create-input')?.focus();
	}
	beforeNavigate(navigation => {
		if (navigation.willUnload) {
			// SvelteKit turns a cancelled document exit into the browser's native prompt.
			if (busy || dirty) navigation.cancel();
			return;
		}
		if (busy || (dirty && !window.confirm('Discard this unsaved task draft and leave Work?'))) {
			navigation.cancel();
			void recoverDraftFocus();
		}
	});
	function beforeUnload(event: BeforeUnloadEvent) {
		if (!dirty && !busy) return;
		event.preventDefault(); event.returnValue = '';
	}

	function resetDraft() {
		title = ''; notes = ''; sourceUrl = ''; proofTarget = ''; purpose = ''; writtenNextStep = '';
		owner = ''; area = ''; type = ''; due = ''; energy = ''; recurrence = '';
		projectId = ''; initialProjectId = '';
		titleError = ''; notesError = ''; sourceError = ''; projectError = ''; saveError = '';
	}

	afterNavigate(({ from, to }) => {
		if (!__NEBIUS_EDITION__ || from?.url.pathname !== '/work' || !isAllWorkScopeUrl(to?.url)) return;
		// The same Work component survives this route change. All guards have
		// now permitted leaving the draft, so honor the accepted discard once.
		intakeFocusRequest += 1;
		resetDraft();
		open = false;
	});

	export async function openIntake() {
		if (busy) return;
		const request = ++intakeFocusRequest;
		const trigger = document.activeElement;
		let focusMoved = false;
		const trackFocus = (event: FocusEvent) => {
			if (event.target instanceof HTMLElement && event.target !== trigger && event.target !== document.body && event.target !== document.documentElement) focusMoved = true;
		};
		document.addEventListener('focusin', trackFocus, true);
		try {
			if (__NEBIUS_EDITION__ && !open) { projectId = selectedProjectId ?? ''; initialProjectId = projectId; open = true; }
			await tick();
			if (request !== intakeFocusRequest || busy || (__NEBIUS_EDITION__ && !open) || !form?.isConnected || focusMoved || !document.hasFocus()) return;
			if (document.activeElement !== trigger && document.activeElement !== document.body && document.activeElement !== document.documentElement) return;
			form.querySelector<HTMLInputElement>('.quick-create-input')?.focus();
		} finally { document.removeEventListener('focusin', trackFocus, true); }
	}

	async function cancelIntake() {
		if (busy) return;
		if (dirty && !window.confirm('Discard this unsaved task draft?')) { await recoverDraftFocus(); return; }
		resetDraft(); open = false;
		await tick(); document.getElementById('work-add-trigger')?.focus();
	}

	// Preserve pasted and dictated text; explain invalid values when saving.
	function setHumanQuickTitle(event: Event) {
		title = (event.currentTarget as HTMLInputElement).value;
		if (titleError) titleError = '';
	}

	async function quickCreate() {
		if (busy) return;
		titleError = ''; notesError = ''; sourceError = ''; projectError = ''; saveError = '';
		const normalizedTitle = normalizeWorkTitle(title);
		if (normalizedTitle === null) titleError = `Use up to ${DEMO_WORK_TITLE_MAX_LENGTH} characters, without control characters.`;
		else if (!normalizedTitle) titleError = 'Enter a task title.';
		if (__NEBIUS_EDITION__) {
			const lines = notes.split(/\r\n?|\n/u).map(line => line.trim()).filter(Boolean);
			if (lines.length > 50 || lines.some(line => line.length > 2000)) notesError = 'Use up to 50 nonempty notes lines, with up to 2,000 characters per line.';
			else if (/[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(notes)) notesError = 'Remove control characters or invalid Unicode from Notes.';
			if (sourceUrl.trim()) {
				try {
					const url = new URL(sourceUrl.trim());
					if (sourceUrl.trim().length > 2000 || /[\p{Cc}\ud800-\udfff]/u.test(sourceUrl) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
				} catch { sourceError = 'Enter a complete http:// or https:// link, up to 2,000 characters, without a username or password.'; }
			}
			if (projectId && !projects.some(project => project.id === projectId)) projectError = 'Choose a saved project or No project.';
		}
		if (titleError || notesError || sourceError || projectError) {
			await tick(); form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); return;
		}
		const normalizedProofTarget = proofTarget.trim();
		const normalizedOwner = owner.trim() || (filters.owner !== 'all' && filters.owner !== '_unassigned' ? filters.owner : '');
		const normalizedArea = area.trim() || (filters.area !== 'all' && filters.area !== '_none' ? filters.area : '');
		const normalizedType = type.trim();
		const normalizedDue = due.trim();
		const normalizedEnergy = PACK_ENERGIES.includes(energy) ? energy : filters.energy !== 'all' && PACK_ENERGIES.includes(filters.energy) ? filters.energy : '';
		const normalizedRecurrence = recurrence.trim() || (filters.recurrence !== 'all' ? filters.recurrence : '');
		busy = true;
		let result: Awaited<ReturnType<typeof createPack>>;
		try {
			result = await createPack({
				title: normalizedTitle,
				status: __NEBIUS_EDITION__ ? 'draft' : 'active',
				next: 'Open',
				...(__NEBIUS_EDITION__ ? { notes, sourceUrl: sourceUrl.trim(), projectId: projectId || null } : {}),
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
		} catch (error) {
			saveError = error instanceof Error ? error.message : 'Could not save this draft. Try again.';
			if (!__NEBIUS_EDITION__) displayToast('Quick create failed', 'error');
			busy = false;
			await tick();
			if (form?.contains(document.activeElement) || document.activeElement === document.body) document.getElementById('work-intake-save-error')?.focus();
			return;
		}
		const restoreFocus = form?.contains(document.activeElement) || document.activeElement === document.body;
		if (__NEBIUS_EDITION__) { created = { pack: result.pack, undoToken: result.undoToken }; undoError = ''; open = false; }
		resetDraft(); revealWarning = '';
		try {
			await onCreated?.(result.pack);
		} catch {
			revealWarning = 'Saved. The Work view could not be updated.';
		}
		busy = false;
		await tick();
		if (restoreFocus) {
			if (__NEBIUS_EDITION__) document.getElementById('work-intake-open-task')?.focus();
			else form?.querySelector<HTMLInputElement>('.quick-create-input')?.focus();
		}
	}

	async function undoCreation() {
		if (!created || busy) return;
		const sourceElement = document.activeElement;
		const beganOnUndo = sourceElement?.id === 'work-intake-undo';
		busy = true; undoError = '';
		try {
			await undoCreatedPack(created.undoToken);
			const restoreFocus = beganOnUndo && (document.activeElement === sourceElement || document.activeElement === document.body);
			created = null; onUndone?.(); busy = false;
			await tick();
			if (restoreFocus && (document.activeElement === sourceElement || document.activeElement === document.body)) document.getElementById('work-add-trigger')?.focus();
		} catch (error) {
			undoError = error instanceof Error ? error.message : 'Could not undo. The task has been kept.';
			await tick();
			if (document.activeElement?.id === 'work-intake-undo' || document.activeElement === document.body) document.getElementById('work-intake-undo-error')?.focus();
		} finally { busy = false; }
	}
</script>

<svelte:window onbeforeunload={beforeUnload} />

{#if __NEBIUS_EDITION__}
	<div class="intake-trigger-row">
		<WornButton id="work-add-trigger" type="button" variant="primary" aria-expanded={open} aria-controls="work-intake-form" disabled={busy} onclick={openIntake}>Add work</WornButton>
		<span>Create a draft task. Only the title is required.</span>
	</div>
{/if}

{#if !__NEBIUS_EDITION__ || open}
<form bind:this={form} id="work-intake-form" class="quick-create-row" class:nebius-intake={__NEBIUS_EDITION__} aria-label={__NEBIUS_EDITION__ ? 'Add work' : 'Quick add a work item'} tabindex="-1" novalidate onsubmit={(event) => { event.preventDefault(); quickCreate(); }}>
	<label class="quick-title-label" for="work-quick-title">{__NEBIUS_EDITION__ ? 'Task title (required)' : 'Work title (required)'}</label>
	<WornInput id="work-quick-title" class="quick-create-input" bind:value={title} oninput={setHumanQuickTitle} placeholder={__NEBIUS_EDITION__ ? 'What do you want to do?' : 'Quick-add a work item…'} required aria-invalid={Boolean(titleError)} aria-describedby={`quick-create-title-help${titleError ? ' work-quick-title-error' : ''}`} disabled={busy} />
	<span class="quick-create-title-help" id="quick-create-title-help">Up to {DEMO_WORK_TITLE_MAX_LENGTH} Unicode characters.</span>
	{#if titleError}<p class="intake-error" id="work-quick-title-error">{titleError}</p>{/if}
	{#if __NEBIUS_EDITION__}
		<label class="intake-field" for="work-quick-notes">Notes (optional)<WornTextarea id="work-quick-notes" rows={4} bind:value={notes} oninput={() => { notesError = ''; }} aria-invalid={Boolean(notesError)} aria-describedby={notesError ? 'work-quick-notes-error' : 'work-quick-notes-help'} disabled={busy} /></label>
		<p class="intake-help" id="work-quick-notes-help">Up to 50 nonempty lines, 2,000 characters per line.</p>
		{#if notesError}<p class="intake-error" id="work-quick-notes-error">{notesError}</p>{/if}
		<label class="intake-field" for="work-quick-source">Source link (optional)<WornInput id="work-quick-source" type="url" bind:value={sourceUrl} oninput={() => { sourceError = ''; }} aria-invalid={Boolean(sourceError)} aria-describedby={sourceError ? 'work-quick-source-error' : undefined} disabled={busy} /></label>
		{#if sourceError}<p class="intake-error" id="work-quick-source-error">{sourceError}</p>{/if}
		<label class="intake-field" for="work-quick-project">Project (optional)<WornSelect id="work-quick-project" bind:value={projectId} onchange={() => { projectError = ''; }} options={[{ value: '', label: 'No project' }, ...projects.map(project => ({ value: project.id, label: project.title }))]} aria-invalid={Boolean(projectError)} aria-describedby={projectError ? 'work-quick-project-error' : 'work-quick-project-help'} disabled={busy} /></label>
		<p class="intake-help" id="work-quick-project-help">Saved in the selected project, or under All work with No project.</p>
		{#if projectError}<p class="intake-error" id="work-quick-project-error">{projectError}</p>{/if}
	{/if}
	<details class="quick-create-options">
		<summary>Work details <span>Optional</span></summary>
		<p class="quick-create-details-help" id="quick-create-details-help">Blank owner, area, energy, and recurrence fields inherit active Work filters when possible.</p>
		<div class="quick-create-details-grid">
			{#if __NEBIUS_EDITION__}
				<label for="work-quick-purpose">Why it matters (optional)<WornTextarea id="work-quick-purpose" rows={2} bind:value={purpose} maxlength={1000} disabled={busy} /></label>
				<label for="work-quick-written-next">Written next step (optional)<WornTextarea id="work-quick-written-next" rows={2} bind:value={writtenNextStep} maxlength={2000} disabled={busy} /></label>
			{/if}
			<label for="work-quick-owner">Owner (optional)<WornInput id="work-quick-owner" bind:value={owner} maxlength={QUICK_METADATA_MAX_LENGTH} aria-describedby="quick-create-details-help" disabled={busy} /></label>
			<label for="work-quick-area">Area (optional)<WornInput id="work-quick-area" bind:value={area} maxlength={QUICK_METADATA_MAX_LENGTH} aria-describedby="quick-create-details-help" disabled={busy} /></label>
			<label for="work-quick-type">Type (optional)<WornInput id="work-quick-type" bind:value={type} maxlength={QUICK_METADATA_MAX_LENGTH} disabled={busy} /></label>
			<label for="work-quick-due">Due date (optional)<WornInput id="work-quick-due" class="quick-due-input" type="date" bind:value={due} disabled={busy} /></label>
			<label for="work-quick-energy">Energy (optional)<WornSelect id="work-quick-energy" bind:value={energy} options={[{ value: '', label: 'Inherit filter' }, ...ENERGY_OPTIONS]} disabled={busy} /></label>
			<label for="work-quick-recurrence">Recurrence (optional)<WornInput id="work-quick-recurrence" bind:value={recurrence} maxlength={QUICK_METADATA_MAX_LENGTH} aria-describedby="quick-create-details-help" disabled={busy} /></label>
			<label for="work-quick-proof-target">Proof target (optional)<WornInput id="work-quick-proof-target" class="quick-proof-input" bind:value={proofTarget} maxlength={1000} placeholder="What will prove this is done?" disabled={busy} /></label>
		</div>
	</details>
	{#if saveError}<p class="intake-error" id="work-intake-save-error" tabindex="-1">{saveError} Your entries are still here.</p>{/if}
	{#if !__NEBIUS_EDITION__ && revealWarning}<p class="intake-error">{revealWarning}</p>{/if}
	<div class="intake-actions">
		<WornButton class="quick-create-submit" data-work-quick-create-submit type="submit" variant="primary" size="sm" disabled={busy}>{busy ? 'Saving…' : __NEBIUS_EDITION__ ? 'Save draft' : 'Add'}</WornButton>
		{#if __NEBIUS_EDITION__}<WornButton type="button" disabled={busy} onclick={cancelIntake}>Cancel</WornButton>{/if}
	</div>
</form>
{/if}

{#if __NEBIUS_EDITION__ && created}
	<section class="intake-confirmation" aria-label="Saved draft" data-work-intake-confirmation>
		<p><strong>Draft saved:</strong> {created.pack.title}</p>
		{#if revealWarning}<p class="intake-error" data-work-intake-reveal-warning>{revealWarning} Use Open task to continue.</p>{/if}
		<div class="intake-actions">
			<WornButton id="work-intake-open-task" href={`/next?pack=${encodeURIComponent(created.pack.id)}&view=brief`}>Open task</WornButton>
			<WornButton id="work-intake-undo" type="button" disabled={busy} onclick={undoCreation}>Undo</WornButton>
		</div>
		<p class="intake-help">Undo is available while this task is unchanged and no other work depends on it.</p>
		{#if undoError}<p class="intake-error" id="work-intake-undo-error" tabindex="-1">{undoError}</p>{/if}
	</section>
{/if}

<style>
	.quick-create-row{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-items:start;margin-block:8px 12px;min-inline-size:0}
	.quick-create-row:focus{outline:2px solid var(--worn-focus);outline-offset:3px}
	.nebius-intake{padding:16px;border:1px solid var(--worn-border-strong);border-radius:var(--worn-radius-sm)}
	:global(.quick-create-input){min-width:0;width:100%}
	.quick-title-label,.intake-field,.quick-create-details-grid label{display:grid;gap:6px;min-width:0;font-weight:600}
	.quick-create-title-help,.intake-help,.quick-create-details-help{color:var(--worn-text-secondary);font-size:13px;line-height:1.5;margin:0}
	.intake-trigger-row,.intake-actions{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-block:8px}
	.intake-trigger-row span{color:var(--worn-text-secondary);font-size:13px}
	.intake-confirmation{margin-block:12px;padding:12px;border:1px solid var(--worn-border-strong);overflow-wrap:anywhere}
	.intake-confirmation p{margin-block:4px 8px}
	.intake-error{color:var(--worn-danger-text);margin:0;font-weight:600}
	.quick-create-options{min-width:0}
	.quick-create-options summary{align-items:center;background:var(--worn-surface);border:1px solid var(--worn-border-strong);border-radius:var(--worn-radius-sm);color:var(--worn-text-secondary);cursor:pointer;display:flex;font-size:13px;font-weight:700;gap:8px;min-block-size:44px;padding:6px 10px;width:max-content}
	.quick-create-options summary::after{content:'›';font-size:18px;line-height:1;transition:transform .12s ease}
	.quick-create-options[open] summary::after{transform:rotate(90deg)}
	.quick-create-options summary:focus-visible{outline:2px dashed var(--worn-focus);outline-offset:2px}
	.quick-create-row :global(:focus-visible),.intake-confirmation :global(:focus-visible){outline:2px solid var(--worn-focus);outline-offset:3px}
	.quick-create-options summary:hover{background:var(--worn-bg-secondary)}
	.quick-create-options summary span{color:var(--worn-text-muted);font-size:11px;font-weight:600;text-transform:uppercase}
	.quick-create-details-help{margin-block:8px}
	.quick-create-details-grid{display:grid;align-items:start;gap:12px;grid-template-columns:repeat(3,minmax(0,1fr))}
	.intake-field :global(.worn-input),.intake-field :global(.worn-select),.quick-create-details-grid :global(.worn-input),.quick-create-details-grid :global(.worn-select){min-width:0;width:100%}
	.quick-create-details-grid :global(.quick-due-input){max-inline-size:200px}
	.intake-actions :global(button),.intake-actions :global(a),.intake-trigger-row :global(button){min-block-size:44px}
	@media(max-width:500px){.quick-create-row{margin-inline:4px}.nebius-intake{padding:12px}}
	@media(max-width:700px){.quick-create-details-grid{grid-template-columns:minmax(0,1fr)}}
</style>
