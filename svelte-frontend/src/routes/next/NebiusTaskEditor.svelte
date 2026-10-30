<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { packPathSignature, savePackPath } from '$lib/demo-client';
  import type { DemoPack } from '$lib/demo-workflow';
  import type { NebiusChanges } from '$lib/nebius-contract.mjs';
  import { canonicalizeText } from '$lib/canonical-text.mjs';
  import { normalizeStoredBlocker } from '$lib/workflow-rules.mjs';
  import { TERMINAL_RUN_STATUSES, TOOL_INPUT_LIMITS, TOOL_OUTPUT_LIMITS, validateToolInputRequirements, validateToolRequirements, type ToolInputRequirement, type ToolOutputRequirement } from '$lib/nebius-execution-contract.mjs';
  import { WornAlert, WornButton, WornInput, WornTextarea } from '$lib/components';

  type Proposal = { packId: string; changes: NebiusChanges; nonce: number } | null;
  type Draft = { title: string; purpose: string; blocker: string; status: string; nextStep: string; doneWhen: string; memoryText: string; sourcesText: string; executionInputs: ToolInputRequirement[] | null; executionOutputs: ToolOutputRequirement[] | null };
  let { pack, dependencyTitle = null, proposal = null, disabled = false, ondirty = () => {} }: {
    pack: DemoPack; dependencyTitle?: string | null; proposal?: Proposal; disabled?: boolean; ondirty?: (dirty: boolean) => void;
  } = $props();

  function values(item: DemoPack): Draft {
    return {
      title: item.title || '', purpose: item.purpose || '', blocker: displayBlocker(item.blocker), status: item.status || 'draft',
      nextStep: item.nextStep || '', doneWhen: item.doneWhen || '',
      memoryText: (item.memory || []).join('\n'), sourcesText: (item.sources || []).join('\n'),
      executionInputs: structuredClone(item.executionInputs ?? null),
      executionOutputs: structuredClone(item.executionOutputs ?? null),
    };
  }
  function displayBlocker(value: unknown): string {
    const blocker = normalizeStoredBlocker(value);
    return blocker === 'none' ? 'None' : blocker;
  }
  const lines = (value: string) => value.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  let baseline = $state(untrack(() => values(pack)));
  let draft = $state(untrack(() => values(pack)));
  let baselineSignature = $state(untrack(() => packPathSignature(pack)));
  let scopeId = $state(untrack(() => pack.id));
  let lastProposalNonce = 0;
  let reviewing = $state(false);
  let detailsElement: HTMLDetailsElement | undefined = $state();
  let reviewElement: HTMLDivElement | undefined = $state();
  let errorElement: HTMLDivElement | undefined = $state();
  let saving = $state(false);
  let error = $state('');
  let errorField = $state<keyof Draft | null>(null);
  const errorId = 'nebius-task-editor-error';
  function fieldError(field: keyof Draft) {
    const invalid = Boolean(error && errorField === field);
    return { 'aria-invalid': invalid ? true : undefined, 'aria-describedby': invalid ? errorId : undefined };
  }
  let notice = $state('');
  let dirty = $derived(JSON.stringify(draft) !== JSON.stringify(baseline));
  let stale = $derived(packPathSignature(pack) !== baselineSignature);
  let inputsLocked = $derived(pack.status === 'done' || Boolean(pack.archived) || Boolean(pack.executionRun && (!pack.executionRun.record || !TERMINAL_RUN_STATUSES.includes(pack.executionRun.record.status))));
  const labels: Array<[keyof Draft, string]> = [
    ['nextStep', 'Next step'], ['status', 'Status'], ['blocker', 'Blocker'],
    ['title', 'Title'], ['purpose', 'Purpose'], ['doneWhen', 'Done when'],
    ['memoryText', 'Task notes'], ['sourcesText', 'Source excerpts or references'],
    ['executionInputs', 'Tool inputs'], ['executionOutputs', 'Required outputs'],
  ];
  function normalized(value: Draft): Draft {
    return Object.fromEntries(Object.entries(value).map(([field, entry]) => [field,
      field === 'executionInputs' || field === 'executionOutputs' ? value[field]?.map(item => ({ id: item.id.trim(), format: item.format })) ?? null
        : field === 'memoryText' || field === 'sourcesText' ? lines(entry as string).join('\n') : field === 'blocker' ? displayBlocker(entry) : canonicalizeText(entry as string)
    ])) as Draft;
  }
  function displayValue(value: Draft[keyof Draft], field: keyof Draft): string {
    if (value === null) return 'Let the tool choose';
    if (Array.isArray(value)) return value.length ? value.map(item => `${item.id}: ${item.format === 'json' ? 'JSON' : item.format === 'timeline' ? 'timeline' : 'plain text'}`).join('\n') : field === 'executionOutputs' ? 'No minimum outputs' : 'No text inputs';
    return value;
  }
  let reviewed = $derived(normalized(draft));
  let changed = $derived(labels.filter(([field]) => JSON.stringify(draft[field]) !== JSON.stringify(baseline[field]) && JSON.stringify(reviewed[field]) !== JSON.stringify(baseline[field])));

  $effect(() => { ondirty(dirty || reviewing || saving); });
  $effect(() => {
    const id = pack.id, signature = packPathSignature(pack);
    if (id !== scopeId) {
      scopeId = id; baseline = values(pack); draft = values(pack); baselineSignature = signature;
      reviewing = false; saving = false; error = ''; notice = ''; lastProposalNonce = 0;
      if (detailsElement) detailsElement.open = false;
    } else if (!dirty && !saving && signature !== baselineSignature) {
      baseline = values(pack); draft = values(pack); baselineSignature = signature;
      reviewing = false; notice = 'Showing the latest saved task.';
    }
  });
  $effect(() => {
    const selected = proposal;
    if (!selected || selected.packId !== pack.id || selected.nonce === lastProposalNonce) return;
    lastProposalNonce = selected.nonce;
    if (dirty || reviewing || saving) return;
    const changes = selected.changes;
    if (stale || disabled) { error = 'Saved work changed. Review the latest task before using this suggestion.'; return; }
    if (pack.blockedBy && ((changes.blocker !== undefined && (!changes.blocker.trim() || changes.blocker === 'None')) || (changes.status !== undefined && changes.status !== 'blocked'))) {
      error = 'This task has a linked dependency. Resolve it in Work before applying an unblocking suggestion.';
      if (detailsElement) detailsElement.open = true;
      return;
    }
    const candidate = { ...draft, nextStep: changes.nextStep,
      ...(changes.blocker === undefined ? {} : { blocker: changes.blocker }),
      ...(changes.status === undefined ? {} : { status: changes.status }) };
    if (JSON.stringify(normalized(candidate)) === JSON.stringify(normalized(baseline))) {
      notice = 'No changes suggested. Your saved task already matches this response.';
      error = ''; reviewing = false;
      if (detailsElement) detailsElement.open = false;
      void tick().then(() => detailsElement?.querySelector('summary')?.focus());
      return;
    }
    draft = candidate;
    if (detailsElement) detailsElement.open = true;
    reviewing = true;
    void tick().then(() => reviewElement?.focus());
    notice = 'Suggestion ready for your review. Nothing has been saved.';
    error = '';
  });

  async function discard() {
    if (saving) return;
    baseline = values(pack); draft = values(pack); baselineSignature = packPathSignature(pack);
    reviewing = false; error = ''; errorField = null; notice = 'Edits discarded. Saved task details are unchanged.';
    if (detailsElement) detailsElement.open = false;
    await tick(); detailsElement?.querySelector('summary')?.focus();
  }
  async function review() {
    error = ''; errorField = null;
    if (stale) { await showError('Saved work changed. Discard these edits and review the latest task.'); return; }
    if (!draft.title.trim()) { await showError('A title is required.', 'title'); return; }
    for (const [field, limit] of [['title', 200], ['purpose', 1000], ['blocker', 200], ['nextStep', 2000], ['doneWhen', 4000]] as const) {
      if (draft[field].length > limit) { await showError(`${labels.find(([key]) => key === field)?.[1] || field} must be ${limit} characters or fewer.`, field); return; }
    }
    for (const field of ['memoryText', 'sourcesText'] as const) {
      const entries = lines(draft[field]);
      if (entries.length > 50 || entries.some((entry) => entry.length > 2000)) { await showError('Use at most 50 notes or sources, each at most 2000 characters.', field); return; }
    }
    try { validateToolInputRequirements(reviewed.executionInputs); }
    catch (cause) { await showError(cause instanceof Error ? cause.message : 'Tool inputs are invalid.', 'executionInputs'); return; }
    try { validateToolRequirements(reviewed.executionInputs, reviewed.executionOutputs); }
    catch (cause) { await showError(cause instanceof Error ? cause.message : 'Tool input or output requirements are invalid.', 'executionOutputs'); return; }
    if (!changed.length) { notice = 'No task details have changed.'; return; }
    if ((reviewed.status !== baseline.status || reviewed.blocker !== baseline.blocker)
      && ((pack.blockedBy && (reviewed.status !== 'blocked' || reviewed.blocker === 'None'))
        || (reviewed.status === 'blocked' && reviewed.blocker === 'None')
        || (reviewed.status === 'active' && reviewed.blocker !== 'None')
        || baseline.status === 'done')) {
      await showError('Blocked tasks need a blocker; active tasks need None. Resolve linked dependencies in Work first.', 'blocker'); return;
    }
    reviewing = true;
    await tick(); reviewElement?.focus();
  }
  async function showError(message: string, field?: keyof Draft) {
    error = message;
    errorField = field ?? null;
    if (detailsElement) detailsElement.open = true;
    await tick();
    const fieldIds: Record<keyof Draft, string> = { title: 'nebius-task-title', purpose: 'nebius-task-purpose', nextStep: 'nebius-written-step', doneWhen: 'nebius-task-done-when', blocker: 'nebius-task-blocker', status: 'nebius-task-status', memoryText: 'nebius-task-notes', sourcesText: 'nebius-task-sources', executionInputs: 'nebius-task-input-scope', executionOutputs: 'nebius-task-output-scope' };
    const input = field ? detailsElement?.querySelector<HTMLElement>(`#${fieldIds[field]}`) : null;
    for (let parent = input?.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (parent === detailsElement) break;
    }
    await tick();
    (input || errorElement)?.focus();
  }
  async function keepEditing() {
    reviewing = false;
    await tick(); detailsElement?.querySelector<HTMLElement>('#nebius-written-step')?.focus();
  }
  async function addInput() {
    if (inputsLocked || disabled || saving || draft.executionInputs === null || draft.executionInputs.length >= TOOL_INPUT_LIMITS.items) return;
    const index = draft.executionInputs.length;
    draft.executionInputs = [...draft.executionInputs, { id: '', format: 'text' }];
    await tick(); detailsElement?.querySelector<HTMLElement>(`#nebius-task-input-id-${index}`)?.focus();
  }
  async function removeInput(index: number) {
    if (inputsLocked || disabled || saving || draft.executionInputs === null) return;
    draft.executionInputs = draft.executionInputs.filter((_, position) => position !== index);
    await tick(); detailsElement?.querySelector<HTMLElement>('#nebius-task-input-scope')?.focus();
  }
  async function addOutput() {
    if (inputsLocked || disabled || saving || draft.executionOutputs === null || draft.executionOutputs.length >= TOOL_OUTPUT_LIMITS.items) return;
    const index = draft.executionOutputs.length;
    draft.executionOutputs = [...draft.executionOutputs, { id: '', format: 'text' }];
    await tick(); detailsElement?.querySelector<HTMLElement>(`#nebius-task-output-id-${index}`)?.focus();
  }
  async function removeOutput(index: number) {
    if (inputsLocked || disabled || saving || draft.executionOutputs === null) return;
    draft.executionOutputs = draft.executionOutputs.filter((_, position) => position !== index);
    await tick(); detailsElement?.querySelector<HTMLElement>('#nebius-task-output-scope')?.focus();
  }
  async function save(event: MouseEvent) {
    if (!reviewing || saving || stale || disabled) return;
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const ownedFocus = Boolean(trigger && document.activeElement === trigger);
    let focusMoved = false;
    const trackFocus = (next: FocusEvent) => {
      if (next.target instanceof HTMLElement && next.target !== trigger && next.target !== document.body && next.target !== document.documentElement) focusMoved = true;
    };
    if (ownedFocus) document.addEventListener('focusin', trackFocus, true);
    saving = true; error = ''; errorField = null;
    try {
      const fields: Record<string, unknown> = { status: reviewed.status };
      for (const [field] of changed) {
        fields[field === 'memoryText' ? 'memory' : field === 'sourcesText' ? 'sources' : field] =
          field === 'memoryText' || field === 'sourcesText' ? lines(reviewed[field] as string) : reviewed[field];
      }
      // The review explicitly preserves the existing dependency; blocker edits must not clear it.
      if (Object.prototype.hasOwnProperty.call(fields, 'blocker')) fields.blockedBy = pack.blockedBy || '';
      const result = await savePackPath(pack.id, fields, baselineSignature);
      baseline = values(result.pack); draft = values(result.pack); baselineSignature = packPathSignature(result.pack);
      reviewing = false; notice = 'Changes applied.';
      const currentFocus = document.activeElement;
      if (detailsElement && !(focusMoved && currentFocus instanceof HTMLElement && detailsElement.contains(currentFocus))) detailsElement.open = false;
      await tick();
      const summary = detailsElement?.querySelector('summary');
      if (ownedFocus && !focusMoved && document.hasFocus() && summary?.isConnected && !summary.closest('[hidden]') && summary.getClientRects().length) summary.focus({ preventScroll: true });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Task details were not saved. Review the changes and try again.';
    } finally { saving = false; if (ownedFocus) document.removeEventListener('focusin', trackFocus, true); }
  }
</script>

<details id="nebius-task-editor" class="nebius-task-editor" bind:this={detailsElement} data-nebius-task-editor>
  <summary>{reviewing ? 'Review changes' : 'Edit task'}{dirty ? ' · unsaved' : ''}</summary>
  <div class="task-editor-content">
  {#if stale}<WornAlert tone="warning">Saved work changed while these details were open. Discard the draft to load the latest version.</WornAlert>{/if}
  {#if error}<div id={errorId} tabindex="-1" bind:this={errorElement} data-nebius-task-error><WornAlert tone="danger">{error}</WornAlert></div>{/if}
  {#if !reviewing}
  <fieldset disabled={disabled || saving}>
    <label for="nebius-written-step">Next step<WornTextarea id="nebius-written-step" {...fieldError('nextStep')} rows={3} maxlength={2000} bind:value={draft.nextStep} /></label>
    <label for="nebius-task-status">Status<select id="nebius-task-status" {...fieldError('status')} bind:value={draft.status} disabled={baseline.status === 'done'}><option value="draft">Draft</option><option value="active">Active</option><option value="blocked">Blocked</option>{#if baseline.status === 'done'}<option value="done">Done</option>{/if}</select></label>
    <label for="nebius-task-blocker">Blocker<WornTextarea id="nebius-task-blocker" {...fieldError('blocker')} rows={2} maxlength={200} bind:value={draft.blocker} /></label>
    {#if pack.blockedBy}<p>Linked dependency: <a href={`/work?focus=${encodeURIComponent(pack.blockedBy)}`}>{dependencyTitle || 'Linked task is unavailable'}</a>. Resolve it in Work before clearing its blocker.</p>{/if}
    <details><summary>Task context</summary><div class="context-fields">
    <label for="nebius-task-title">Title<WornInput id="nebius-task-title" {...fieldError('title')} maxlength={200} bind:value={draft.title} /></label>
    <label for="nebius-task-purpose">Purpose<WornTextarea id="nebius-task-purpose" {...fieldError('purpose')} rows={3} maxlength={1000} bind:value={draft.purpose} /></label>
    <label for="nebius-task-done-when">Done when<WornTextarea id="nebius-task-done-when" {...fieldError('doneWhen')} rows={3} maxlength={4000} bind:value={draft.doneWhen} /></label>
    </div></details>
    <details><summary>Tool input requirements</summary><fieldset class="context-fields" disabled={inputsLocked}>
    <label for="nebius-task-input-scope">Text inputs<select id="nebius-task-input-scope" {...fieldError('executionInputs')} value={draft.executionInputs === null ? 'unspecified' : draft.executionInputs.length ? 'defined' : 'none'} onchange={event => { draft.executionInputs = event.currentTarget.value === 'unspecified' ? null : event.currentTarget.value === 'none' ? [] : [{ id: '', format: 'text' }]; }}><option value="unspecified">Let the tool choose</option><option value="none">No text inputs</option><option value="defined">Specify inputs</option></select></label>
    {#if draft.executionInputs !== null}
      {#each draft.executionInputs as input, index}
        <div class="tool-input-row">
          <label for={`nebius-task-input-id-${index}`}>Input {index + 1} ID<WornInput id={`nebius-task-input-id-${index}`} maxlength={TOOL_INPUT_LIMITS.id} bind:value={input.id} /></label>
          <label for={`nebius-task-input-format-${index}`}>Input {index + 1} format<select id={`nebius-task-input-format-${index}`} bind:value={input.format}><option value="text">Plain text</option><option value="json">JSON</option></select></label>
          <WornButton type="button" onclick={() => void removeInput(index)}>Remove input {index + 1}</WornButton>
        </div>
      {/each}
      <WornButton type="button" disabled={draft.executionInputs.length >= TOOL_INPUT_LIMITS.items} onclick={() => void addInput()}>Add input</WornButton>
    {/if}
    <p>These are the complete text inputs the generated tool must use. Checkbox and button controls are separate.</p>
    {#if inputsLocked}<p>Finish the current run before changing its input requirements.</p>{/if}
    </fieldset></details>
    <details><summary>Required tool outputs</summary><fieldset class="context-fields" disabled={inputsLocked}>
    <label for="nebius-task-output-scope">Required outputs<select id="nebius-task-output-scope" {...fieldError('executionOutputs')} value={draft.executionOutputs === null ? 'unspecified' : draft.executionOutputs.length ? 'defined' : 'none'} onchange={event => { draft.executionOutputs = event.currentTarget.value === 'unspecified' ? null : event.currentTarget.value === 'none' ? [] : [{ id: '', format: 'text' }]; }}><option value="unspecified">Let the tool choose</option><option value="none">No minimum outputs</option><option value="defined">Specify required outputs</option></select></label>
    {#if draft.executionOutputs !== null}
      {#each draft.executionOutputs as output, index}
        <div class="tool-input-row">
          <label for={`nebius-task-output-id-${index}`}>Output {index + 1} ID<WornInput id={`nebius-task-output-id-${index}`} maxlength={TOOL_OUTPUT_LIMITS.id} bind:value={output.id} /></label>
          <label for={`nebius-task-output-format-${index}`}>Output {index + 1} format<select id={`nebius-task-output-format-${index}`} bind:value={output.format}><option value="text">Plain text</option><option value="timeline">Timeline</option></select></label>
          <WornButton type="button" onclick={() => void removeOutput(index)}>Remove output {index + 1}</WornButton>
        </div>
      {/each}
      <WornButton type="button" disabled={draft.executionOutputs.length >= TOOL_OUTPUT_LIMITS.items} onclick={() => void addOutput()}>Add output</WornButton>
    {/if}
    <p>The tool must include these outputs. Additional status outputs are allowed. Input and output IDs must be different.</p>
    {#if inputsLocked}<p>Only open tasks with no run in progress can change required outputs.</p>{/if}
    </fieldset></details>
    <details><summary>Notes and sources</summary><div class="context-fields">
    <label for="nebius-task-notes">Task notes · one per line<WornTextarea id="nebius-task-notes" {...fieldError('memoryText')} rows={3} bind:value={draft.memoryText} /></label>
    <label for="nebius-task-sources">Source excerpts or references · one per line<WornTextarea id="nebius-task-sources" {...fieldError('sourcesText')} rows={3} bind:value={draft.sourcesText} /></label>
    <p>Choose which saved entries to send in the suggestion preview.</p>
    </div></details>
  </fieldset>
  {/if}
  {#if reviewing}
    <div class="nebius-review" role="group" aria-label="Review task changes" tabindex="-1" bind:this={reviewElement} data-nebius-task-preview>
      {#snippet comparisonRow(label: string, before: string, after: string)}
        <!-- Explicit roles preserve table semantics when mobile CSS changes element display. -->
        <!-- svelte-ignore a11y_no_redundant_roles -->
        <tr role="row"><th scope="row" role="rowheader">{label}</th><td role="cell"><span class="mobile-value-label" aria-hidden="true">Before</span>{before || '(empty)'}</td><td role="cell"><span class="mobile-value-label" aria-hidden="true">After</span>{after || '(empty)'}</td></tr>
      {/snippet}
      <!-- svelte-ignore a11y_no_redundant_roles -->
      <table role="table"><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Field</th><th scope="col" role="columnheader">Before</th><th scope="col" role="columnheader">After</th></tr></thead><tbody role="rowgroup">
      {#each changed as [field, label]}{@render comparisonRow(label, displayValue(baseline[field], field), displayValue(reviewed[field], field))}{/each}
      </tbody></table>
      <p>Apply saves these changes in this browser.</p>
      {#if pack.blockedBy}<p>Linked dependency stays: {dependencyTitle || 'Linked task is unavailable'}.</p>{/if}
    </div>
  {/if}
  <div class="task-editor-actions">
  {#if reviewing}
    <WornButton type="button" variant="primary" disabled={disabled || saving || stale || !changed.length} onclick={save}>{saving ? 'Applying…' : 'Apply changes'}</WornButton>
    <WornButton type="button" disabled={saving} onclick={() => void keepEditing()}>Edit changes</WornButton>
  {:else}
    <WornButton type="button" variant="primary" disabled={disabled || saving || !dirty || stale} onclick={review}>Review changes</WornButton>
  {/if}
  <WornButton type="button" disabled={saving || (!dirty && !reviewing)} onclick={discard}>Discard edits</WornButton>
  </div>
  </div>
</details>
{#if notice}<p class="task-notice" role="status" data-nebius-task-notice>{notice}</p>{/if}
<details class="task-activity" data-nebius-task-activity>
  <summary>Activity · {(pack.activity || []).length} {(pack.activity || []).length === 1 ? 'entry' : 'entries'}</summary>
  {#if pack.activity?.length}<ol reversed>{#each [...pack.activity].reverse() as entry}<li>{entry}</li>{/each}</ol>{:else}<p>No saved activity yet.</p>{/if}
</details>

<style>
  .nebius-task-editor { border: 1px solid var(--worn-border); border-radius: var(--worn-radius); margin-block: 8px; min-inline-size: 0; padding: 12px; }
  .task-editor-content { display: grid; gap: 12px; min-inline-size: 0; padding-block-start: 12px; }
  .task-editor-actions { display: flex; flex-wrap: wrap; gap: var(--worn-space-2); }
  summary { align-content: center; cursor: pointer; font-weight: 700; min-block-size: 44px; }
  p { margin: 0; }
  p { line-height: 1.55; }
  fieldset { border: 0; display: grid; gap: 12px; margin: 0; min-inline-size: 0; padding: 0; }
  label { display: grid; font-weight: 650; gap: var(--worn-space-2); min-inline-size: 0; }
  select { background: var(--worn-surface); border: 1px solid var(--worn-field-border); border-radius: var(--worn-radius-sm); color: var(--worn-text); font: inherit; min-block-size: 44px; padding: 0.5rem; }
  select:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 2px; }
  .context-fields { display: grid; gap: 12px; margin-block-start: 12px; }
  .tool-input-row { display: grid; gap: var(--worn-space-2); grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .tool-input-row :global(button) { justify-self: start; }
  .nebius-review { background: var(--worn-surface); border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); display: grid; gap: 0.75rem; overflow-wrap: anywhere; padding: 0.75rem; }
  table { border-collapse: collapse; table-layout: fixed; width: 100%; }
  th, td { border-block-end: 1px solid var(--worn-border); padding: 0.75rem 0.5rem; text-align: start; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
  th { font-weight: 650; }
  .mobile-value-label { display: none; }
  .nebius-review:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
  .task-notice { color: var(--worn-text-secondary); margin-block: 0.5rem 1rem; }
  .task-activity { margin-block: 8px; overflow-wrap: anywhere; }
  .task-activity ol { display: grid; gap: 0.5rem; padding-inline-start: 1.5rem; }
  .task-activity > p { margin-block-start: 0.5rem; }
  @media (max-width: 500px) {
    .tool-input-row { grid-template-columns: minmax(0, 1fr); }
    table, tbody { display: block; }
    thead { clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; width: 1px; }
    tbody tr { border-block-end: 1px solid var(--worn-border); display: grid; padding-block: 0.75rem; }
    tbody tr:last-child { border-block-end: 0; }
    th, td { border: 0; padding: 0.35rem 0; }
    .mobile-value-label { color: var(--worn-text-secondary); display: block; font-size: 0.875rem; font-weight: 650; margin-block-end: 0.25rem; }
  }
</style>
