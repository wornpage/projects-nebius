<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { WornAlert, WornButton, WornTextarea } from '$lib/components';
  import type { DemoPack } from '$lib/demo-workflow';
  import { CONTEXT_LIMITS, type NebiusContextItem, type NebiusChanges } from '$lib/nebius-contract.mjs';
  import { createSuggestionClient, emptySuggestionView, type SuggestionView } from './nebius-client.mjs';
  import { canonicalizeText } from '$lib/canonical-text.mjs';
  import { normalizeStoredBlocker } from '$lib/workflow-rules.mjs';
  let { pack, dependencyTitle = null, disabled = false, onUse, ondirty = () => {} }: { pack: DemoPack; dependencyTitle?: string | null; disabled?: boolean; onUse: (changes: NebiusChanges) => void; ondirty?: (dirty: boolean) => void } = $props();
  const id = $props.id();
  let view = $state<SuggestionView>(emptySuggestionView());
  let used = $state(false);
  let online = $state(true);
  let selectedKeys = $state<string[]>([]);
  let selectionScope = $state('');
  let updateText = $state('');
  let updateScope = $state('');
  let suggestionHasChanges = $derived(Boolean(view.result && (
    canonicalizeText(view.result.changes.nextStep) !== canonicalizeText(pack.nextStep || '')
    || (view.result.changes.status !== undefined && view.result.changes.status !== pack.status)
    || (view.result.changes.blocker !== undefined && normalizeStoredBlocker(view.result.changes.blocker) !== normalizeStoredBlocker(pack.blocker))
  )));
  const client = createSuggestionClient({ onChange: next => { view = next; } });
  const fields = [['title', 'Title'], ['purpose', 'Purpose'], ['nextStep', 'Written next step'], ['blocker', 'Blocker'], ['doneWhen', 'Done when']] as const;
  let availableContext = $derived([
    ...(pack.memory || []).map((text, index) => ({ key: `note:${index}`, kind: 'note' as const, text })),
    ...(pack.sources || []).map((text, index) => ({ key: `source:${index}`, kind: 'source' as const, text })),
  ]);
  let selectedContext = $derived(availableContext.filter((entry) => selectedKeys.includes(entry.key)).map(({ kind, text }) => ({ kind, text })) as NebiusContextItem[]);
  $effect(() => {
    if (pack.id !== updateScope) { updateScope = pack.id || ''; updateText = ''; }
    const scope = JSON.stringify([pack.id, pack.memory, pack.sources]);
    if (scope !== selectionScope) { selectionScope = scope; selectedKeys = []; }
    const key = JSON.stringify([pack.id, pack.title, pack.purpose, pack.nextStep, pack.blocker, pack.doneWhen, pack.status, pack.blockedBy, selectedKeys, updateText]);
    used = false; void client.setTask(key, pack, selectedContext, updateText);
  });
  $effect(() => { ondirty(Boolean(updateText)); });
  async function clearUpdate() {
    updateText = '';
    await tick();
    const target = document.getElementById('nebius-task-update') || document.getElementById(`${id}-heading`);
    target?.focus();
  }
  function selectContext(key: string, checked: boolean) {
    if (!checked) { selectedKeys = selectedKeys.filter((current) => current !== key); return; }
    if (!selectedKeys.includes(key) && selectedKeys.length < CONTEXT_LIMITS.items) selectedKeys = [...selectedKeys, key];
  }
  function basisLabel(id: string): string {
    if (id.startsWith('context:')) {
      const entry = selectedContext[Number(id.slice('context:'.length))];
      return entry ? `${entry.kind === 'note' ? 'Selected note' : 'Selected source'}: ${entry.text}` : 'Selected context';
    }
    return ({ title: 'Task title', purpose: 'Purpose', nextStep: 'Current next step', blocker: 'Blocker', doneWhen: 'Done when', currentStatus: 'Current status', update: 'Your update' } as Record<string, string>)[id] || id;
  }
  onMount(() => {
    const update = () => { online = navigator.onLine; };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  });
  onDestroy(() => { client.dispose(); ondirty(false); });
</script>

{#if view.phase !== 'hidden'}
  <section class="nebius-suggestion" aria-labelledby={`${id}-heading`} aria-busy={view.phase === 'generating' || view.phase === 'loading'} data-nebius-suggestion>
    <h2 id={`${id}-heading`} tabindex="-1">Ask Nebius</h2>
    {#if pack.blockedBy}<p>Linked dependency kept in this browser: <a href={`/work?focus=${encodeURIComponent(pack.blockedBy)}`}>{dependencyTitle || 'Linked task is unavailable'}</a>. Suggestions cannot clear this link.</p>{/if}
    {#if (online && view.config && view.phase !== 'unavailable') || updateText}
    <label class="update-field" for="nebius-task-update">Task update · optional<WornTextarea id="nebius-task-update" rows={3} maxlength={1000} bind:value={updateText} disabled={disabled || view.phase === 'generating'} placeholder="What changed or what help do you need?" /></label>
    {/if}
    {#if updateText}<WornButton type="button" disabled={view.phase === 'generating'} onclick={clearUpdate}>Clear update</WornButton>{/if}
    <p role="status" aria-live="polite">{view.phase === 'loading' ? 'Loading model settings…' : view.phase === 'generating' ? 'Generating a suggestion…' : view.phase === 'complete' ? !suggestionHasChanges ? 'No changes suggested. Your saved task already matches this response.' : used ? 'Review the task draft to apply changes.' : 'Suggestion ready. Nothing has been saved.' : ''}</p>
    {#if !online}<WornAlert tone="info">You are offline. Browser-local edits remain available. Reconnect before asking Nebius again; generation will not restart automatically.</WornAlert>{/if}
    {#if view.error}<WornAlert tone="danger">{view.error}</WornAlert>{/if}
    {#if view.phase === 'unavailable'}
      <WornAlert tone="info">{disabled ? 'Nebius is unavailable here.' : 'Nebius is unavailable here. Task editing and the Evidence view are still available.'}</WornAlert>
      <WornButton type="button" disabled={!online} onclick={() => void client.reload()}>Check availability again</WornButton>
    {/if}
    {#if view.task && view.config}
      {#if availableContext.length > 0}
        <details class="context-picker">
          <summary>Optional notes and sources · {selectedKeys.length} of {availableContext.length} selected</summary>
          <p>Select up to {CONTEXT_LIMITS.items} entries to send. None are included by default. A reference label does not supply the referenced document.</p>
          {#each availableContext as entry (entry.key)}
            <label class="context-choice">
              <input type="checkbox" checked={selectedKeys.includes(entry.key)} disabled={entry.text.length > CONTEXT_LIMITS.text || (!selectedKeys.includes(entry.key) && selectedKeys.length >= CONTEXT_LIMITS.items)} onchange={(event) => selectContext(entry.key, event.currentTarget.checked)} />
              <span><strong>{entry.kind === 'note' ? 'Note' : 'Source'}</strong>: {entry.text}{entry.text.length > CONTEXT_LIMITS.text ? ` (too long to send; edit to ${CONTEXT_LIMITS.text} characters or fewer)` : ''}</span>
            </label>
          {/each}
        </details>
      {/if}
      <p class="send-summary">Uses the saved task{view.update ? ' and your update' : ''}{selectedKeys.length ? `, plus ${selectedKeys.length} selected context ${selectedKeys.length === 1 ? 'entry' : 'entries'}` : ''}.</p>
      <details>
        <summary>Data sent to Nebius</summary>
        <p class="model">Routine guidance · Model: {view.config.requestedModel}<br />At most {view.config.maxOutputTokens.toLocaleString()} output tokens per request. No automatic retry.</p>
        <p>Sends five task fields, current status ({view.currentStatus}), {view.update ? 'your update' : 'an empty update'}, and {selectedKeys.length} of {availableContext.length} optional entries.</p>
        <dl>{#each fields as [field, label]}<div><dt>{label}</dt><dd>{view.task[field] || '(empty)'}</dd></div>{/each}</dl>
        <dl><div><dt>Current status</dt><dd>{view.currentStatus}</dd></div><div><dt>Task update</dt><dd>{view.update || '(empty)'}</dd></div></dl>
        <p>{selectedKeys.length} of {availableContext.length} optional entries selected for this request.</p>
        {#each selectedContext as entry}<p class="selected-context"><strong>{entry.kind === 'note' ? 'Selected note' : 'Selected source'}:</strong> {entry.text}</p>{/each}
      </details>
      {#if view.phase === 'ready' || view.phase === 'generating'}
        <p>Generate sends the previewed data to Nebius Token Factory. Changes stay unsaved until you approve them.</p>
        <WornButton type="button" variant="primary" disabled={!online || disabled || view.phase !== 'ready'} onclick={() => { if (online && !disabled) void client.generate(); }}> {view.phase === 'generating' ? 'Generating…' : 'Generate suggestion'} </WornButton>
      {/if}
    {/if}
    {#if view.result}
      <div data-nebius-result>
        <p class="suggested-action">{view.result.changes.nextStep}</p>
        {#if view.result.changes.status !== undefined}<p><strong>Status:</strong> {view.result.changes.status}</p>{/if}
        {#if view.result.changes.blocker !== undefined}<p><strong>Blocker:</strong> {view.result.changes.blocker}</p>{/if}
      </div>
      <p>{view.result.reason}</p>
      <details><summary>Basis and provider usage</summary><p>{view.result.basis.map(basisLabel).join(' · ')}</p>
      {#if view.usage}<p class="model">Provider reported {view.usage.input_tokens} input tokens and {view.usage.output_tokens} output tokens.</p>{/if}</details>
      {#if view.result.missingInformation.length > 0}
        <div><strong>Information still needed</strong><ul>{#each view.result.missingInformation as item}<li>{item}</li>{/each}</ul></div>
      {/if}
      <p class="model">Model suggestion · check the facts before using it.</p>
      {#if suggestionHasChanges}
        <WornButton type="button" disabled={disabled || used} onclick={() => { if (!disabled && view.result) { onUse(view.result.changes); used = true; } }}>Review changes</WornButton>
      {:else}
        <WornButton type="button" disabled={disabled} onclick={() => document.getElementById('nebius-task-update')?.focus()}>Add an update</WornButton>
      {/if}
    {/if}
    {#if view.phase === 'error' || view.phase === 'complete'}
      <WornButton type="button" disabled={!online || disabled} onclick={() => { if (online && !disabled) { used = false; void client.reload(); } }}>Reload preview</WornButton>
    {/if}
  </section>
{/if}

<style>
  .nebius-suggestion { border: 1px solid var(--worn-border); border-radius: var(--worn-radius); padding: 1rem; margin-block: 1rem; min-inline-size: 0; overflow-wrap: anywhere; }
  h2 { font-size: 1.1rem; margin-block: 0 0.5rem; }
  p { max-inline-size: 70ch; margin-block: 0.7rem; }
  summary { cursor: pointer; padding-block: 0.75rem; }
  dl div { padding-block: 0.4rem; }
  dt { font-weight: 600; }
  dd { margin: 0; white-space: pre-wrap; }
  .model { font-size: 0.875rem; }
  .suggested-action { font-weight: 600; white-space: pre-wrap; }
  .update-field { display: grid; gap: 0.5rem; font-weight: 650; }
  .context-picker { border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); padding: 0.5rem 0.75rem; }
  .context-choice { align-items: start; display: flex; gap: 0.5rem; margin-block: 0.5rem; overflow-wrap: anywhere; }
  .context-choice input { flex: none; margin-block-start: 0.25rem; }
  .selected-context { white-space: pre-wrap; }
</style>
