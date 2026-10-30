<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { demoState, approveProjectReplan } from '$lib/demo-client';
  import { projectSnapshot } from '$lib/nebius-replan-state.mjs';
  import { REPLAN_LIMITS, validateProjectReplan, validateReplanInput, type ProjectSnapshot, type ProjectReplan } from '$lib/nebius-replan-contract.mjs';
  import { normalizeWorkTitle } from '$lib/canonical-text.mjs';
  import { WornButton } from '$lib/components';
  import NebiusInferenceFailure from '$lib/NebiusInferenceFailure.svelte';
  import { createReplanClient, emptyReplanView } from './nebius-replan-client.mjs';

  let { projectId, onApproved }: { projectId: string; onApproved: () => Promise<void> } = $props();
  let opened = $state(false), update = $state(''), snapshot = $state<ProjectSnapshot | null>(null);
  let proposal = $state<ProjectReplan | null>(null), reviewed = $state<ProjectReplan | null>(null);
  let source = $state<'manual' | 'nebius'>('manual'), consent = $state(false), saving = $state(false);
  let error = $state(''), receipt = $state(''), heading = $state<HTMLHeadingElement | null>(null);
  let errorElement = $state<HTMLParagraphElement | null>(null);
  let updateContextOpen = $state(true);
  let updateElement = $state<HTMLElement | null>(null);
  let view = $state(emptyReplanView());
  const client = createReplanClient({ onChange: next => {
    view = next;
    if (next.phase === 'complete' && next.replan) {
      proposal = structuredClone(next.replan); reviewed = null; source = 'nebius';
      updateContextOpen = false;
      void tick().then(() => document.getElementById('replan-summary')?.focus());
    }
  } });
  const fields = [
    ['title', 'Task title'], ['purpose', 'Why it matters'], ['nextStep', 'Next step'],
    ['doneWhen', 'Completion criteria'], ['status', 'Status'], ['blocker', 'Blocker'], ['blockedBy', 'Predecessor'],
  ] as const;
  let dirty = $derived(Boolean(update.trim() || proposal));
  let busy = $derived(saving || view.phase === 'generating');
  let stale = $derived.by(() => {
    if (!snapshot || !$demoState) return false;
    try { return JSON.stringify(projectSnapshot($demoState, projectId)) !== JSON.stringify(snapshot); }
    catch { return true; }
  });
  $effect(() => { if (stale) client.setInput(null, ''); });
  onMount(() => { void client.reload(); return () => client.dispose(); });
  export function canLeave() {
    return !saving && (!dirty || window.confirm('Discard these unsaved project changes?'));
  }
  beforeNavigate(navigation => { if (!canLeave()) navigation.cancel(); });
  function beforeUnload(event: BeforeUnloadEvent) { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } }
  function initializeTaskPanel(panel: HTMLDetailsElement, initiallyOpen: boolean) {
    // Initialization only; native openness is never replayed from shared state
    // when another panel toggles or a draft field changes.
    panel.open = initiallyOpen;
  }
  async function showError(cause: unknown, fallback: string) {
    error = cause instanceof Error ? cause.message : fallback;
    updateContextOpen = true;
    await tick();
    updateElement?.querySelectorAll<HTMLDetailsElement>('[data-replan-task-panel]').forEach(panel => { panel.open = true; });
    errorElement?.focus();
  }
  async function begin() {
    try {
      if (!$demoState) return;
      snapshot = projectSnapshot($demoState, projectId); opened = true; receipt = ''; error = '';
      updateContextOpen = true;
      client.setInput(snapshot, update); await tick(); document.getElementById('project-update-text')?.focus();
    } catch (cause) { await showError(cause, 'This project cannot be revised.'); }
  }
  function editUpdate(event: Event) {
    update = (event.currentTarget as HTMLTextAreaElement).value;
    consent = false; client.setInput(snapshot, update); error = '';
  }
  async function outline() {
    try {
      const input = validateReplanInput({ snapshot, update });
      const changes = input.snapshot.tasks.filter(task => !task.archived && task.status !== 'done').map(({ archived, ...task }) => ({
        ...task, status: task.status === 'blocked' ? 'blocked' as const : 'active' as const, reason: input.update.slice(0, REPLAN_LIMITS.reason),
      }));
      if (!changes.length) throw new Error('This project has no open tasks to revise.');
      proposal = { summary: input.update.slice(0, REPLAN_LIMITS.summary), changes, missingInformation: [] }; source = 'manual'; reviewed = null; error = '';
      updateContextOpen = false;
      await tick(); document.getElementById('replan-summary')?.focus();
    } catch (cause) { await showError(cause, 'Describe what changed first.'); }
  }
  function changed(task: ProjectReplan['changes'][number]) {
    const before = snapshot?.tasks.find(item => item.id === task.id);
    return before && fields.some(([key]) => before[key] !== task[key]);
  }
  async function review() {
    try {
      if (stale || !snapshot || !proposal) throw new Error('The project changed. Discard this draft and start again.');
      const normalized = proposal.changes.map(task => {
        const title = normalizeWorkTitle(task.title);
        if (!title) throw new Error('Enter a valid task title.');
        return { ...task, title };
      });
      const changes = normalized.filter(changed);
      if (!changes.length) throw new Error('Change at least one task field before reviewing.');
      reviewed = validateProjectReplan({ ...proposal, changes }, snapshot);
      error = ''; await tick(); heading?.focus();
    } catch (cause) { await showError(cause, 'Check the proposed changes.'); }
  }
  async function apply() {
    if (!reviewed || !snapshot || saving || stale) return;
    saving = true; error = '';
    try {
      const result = await approveProjectReplan(snapshot, reviewed, source);
      receipt = `Saved changes to ${result.changedIds.length} ${result.changedIds.length === 1 ? 'task' : 'tasks'}.`;
      clear(); await onApproved(); await tick(); document.querySelector<HTMLElement>('[data-update-project]')?.focus();
    } catch (cause) { await showError(cause, 'Changes were not saved.'); }
    finally { saving = false; }
  }
  function clear() { opened = false; snapshot = null; update = ''; proposal = null; reviewed = null; consent = false; updateContextOpen = true; client.setInput(null, ''); }
  async function discard() {
    if (!canLeave()) return;
    clear(); error = '';
    await tick(); updateElement?.querySelector<HTMLButtonElement>('[data-update-project]')?.focus();
  }
  async function reviseInput() {
    if (!window.confirm('Discard this proposal to change the update?')) return;
    proposal = null; reviewed = null; consent = false; client.setInput(snapshot, update);
    updateContextOpen = true; await tick(); document.getElementById('project-update-text')?.focus();
  }
  function value(value: unknown, key: string) {
    if (key === 'blockedBy') { const task = snapshot?.tasks.find(task => task.id === value); return task ? `${task.title} (${task.id})` : 'None'; }
    return String(value || 'None');
  }
  function predecessor(task: ProjectReplan['changes'][number], id: string) {
    task.blockedBy = id || null;
    if (id) { task.status = 'blocked'; task.blocker = `Waiting for ${snapshot?.tasks.find(item => item.id === id)?.title ?? id}`.slice(0, 200); }
  }
  function clearBlockers(task: ProjectReplan['changes'][number]) {
    if (busy || stale) return;
    task.blockedBy = null; task.blocker = 'None'; task.status = 'active';
  }
</script>

<svelte:window onbeforeunload={beforeUnload} />
<section class="project-update" data-project-update aria-label="Project updates" bind:this={updateElement}>
  {#if !opened}<WornButton data-update-project onclick={begin}>Revise tasks</WornButton>{/if}
  {#if receipt}<p role="status" data-project-updated>{receipt}</p>{/if}
  {#if error}<p role="alert" class="error" tabindex="-1" bind:this={errorElement} data-project-replan-error>{error}</p>{/if}
  {#if opened && snapshot}
    <h3 tabindex="-1" bind:this={heading} data-project-update-heading>{reviewed ? 'Review task changes' : proposal ? 'Edit task changes' : 'Revise tasks'}</h3>
    <p class="update-scope"><strong>{snapshot.project.title}</strong> · {snapshot.tasks.filter(task => !task.archived && task.status !== 'done').length} open of {snapshot.tasks.length} tasks</p>
    {#if stale}<p role="alert">This project changed after the draft started. Discard it and start again.</p>{/if}
    {#if !reviewed}
      <details class="update-context" data-replan-update-context bind:open={updateContextOpen}>
        <summary>{proposal ? 'Update text and draft options' : 'What changed?'}</summary>
      <label for="project-update-text">Project update</label>
      <textarea id="project-update-text" value={update} oninput={editUpdate} maxlength="2000" rows="3" placeholder="Describe new priorities, requirements or constraints." disabled={!!proposal || busy || stale}></textarea>
      {#if proposal}<div class="actions"><WornButton onclick={reviseInput} disabled={busy || stale}>Change update</WornButton></div>{/if}
      {#if !proposal}
        <div class="actions"><WornButton onclick={outline} disabled={busy || stale || !update.trim()}>Edit tasks myself</WornButton></div>
        <details class="replan-generation" data-replan-nebius-options><summary>{view.phase === 'unavailable' || (view.phase === 'error' && !view.config) ? 'Suggest changes with Nebius · unavailable' : 'Suggest changes with Nebius'}</summary>
          <p class="muted">Nebius uses this update and all {snapshot.tasks.length} project tasks, including done and archived tasks as context.</p>
          <details data-replan-send-preview><summary>Preview information sent</summary><pre>{JSON.stringify({ snapshot, update }, null, 2)}</pre></details>
          {#if view.error}<p role="status">{view.error}</p>{/if}
          <NebiusInferenceFailure failure={view.failure} />
          {#if view.config}<p class="model-info">Model: {view.config.requestedModel}<br />Up to {view.config.maxOutputTokens.toLocaleString()} output tokens per request · no automatic retry.</p>{/if}
          <label class="consent"><input type="checkbox" bind:checked={consent} disabled={busy || stale} /> I agree to send this update and project context to Nebius.</label>
          <div class="actions"><WornButton onclick={() => client.generate(consent)} disabled={!consent || !view.config || busy || stale || !update.trim()}>{view.phase === 'generating' ? 'Drafting changes…' : 'Draft changes with Nebius'}</WornButton>
            <WornButton onclick={() => client.reload()} disabled={busy}>Check model settings</WornButton></div>
        </details>
      {/if}
      </details>
      {#if proposal}
        <p class="provenance">{source === 'manual' ? 'Manual draft' : 'Nebius draft'} · unsaved</p>
        {#if source === 'nebius' && view.usage}<p class="muted">{view.usage.input_tokens} input tokens · {view.usage.output_tokens} output tokens</p>{/if}
        <label for="replan-summary">Change summary</label><textarea id="replan-summary" bind:value={proposal.summary} maxlength="600" rows="2" disabled={busy || stale}></textarea>
        {#key proposal}
        {#each proposal.changes as task, index (task.id)}
          <details class="task-panel" data-replan-task-panel={task.id} use:initializeTaskPanel={index === 0}>
            <summary><span class="task-panel-title">{task.title || 'Untitled task'}</span><span class="task-panel-context">{task.nextStep || 'Next step needed'} · Predecessor: {snapshot.tasks.find(item => item.id === task.blockedBy)?.title || 'None'}</span></summary>
          <fieldset data-replan-task disabled={busy || stale}><legend>{snapshot.tasks.find(item => item.id === task.id)?.title}</legend>
            {#each fields.slice(0, 4) as [key, label]}
              <label for={`replan-${key}-${task.id}`}>{label}</label>
              <textarea id={`replan-${key}-${task.id}`} bind:value={task[key]} maxlength={key === 'title' ? REPLAN_LIMITS.taskTitle : key === 'purpose' ? REPLAN_LIMITS.purpose : key === 'doneWhen' ? REPLAN_LIMITS.doneWhen : REPLAN_LIMITS.nextStep} rows={key === 'purpose' || key === 'doneWhen' ? 2 : 1}></textarea>
            {/each}
            <label for={`replan-status-${task.id}`}>Status</label><select id={`replan-status-${task.id}`} bind:value={task.status}><option value="active">Active</option><option value="blocked">Blocked</option></select>
            <label for={`replan-blocker-${task.id}`}>Blocker</label><input id={`replan-blocker-${task.id}`} bind:value={task.blocker} maxlength="200" />
            <label for={`replan-dependency-${task.id}`}>Predecessor</label><select id={`replan-dependency-${task.id}`} value={task.blockedBy ?? ''} onchange={event => predecessor(task, event.currentTarget.value)}><option value="">None</option>{#each snapshot.tasks.filter(item => item.id !== task.id) as item}<option value={item.id}>{item.title} ({item.id})</option>{/each}</select>
            <label for={`replan-reason-${task.id}`}>Reason</label><textarea id={`replan-reason-${task.id}`} bind:value={task.reason} maxlength={REPLAN_LIMITS.reason} rows="2"></textarea>
            {#if task.blockedBy || task.status === 'blocked'}<div class="actions"><WornButton onclick={() => clearBlockers(task)} disabled={busy || stale}>Clear blockers</WornButton></div><p class="field-help">Clears the predecessor and blocker, and sets Active in this draft. Review before saving.</p>{/if}
          </fieldset>
          </details>
        {/each}
        {/key}
        <p class="muted">Only changed tasks will be saved.</p>
        <div class="actions"><WornButton variant="primary" onclick={review} disabled={busy || stale}>Review changes</WornButton></div>
      {/if}
    {:else}
      <p>{reviewed.summary}</p><p class="provenance">{source === 'manual' ? 'Manual changes' : 'Nebius proposal'} · {reviewed.changes.length} {reviewed.changes.length === 1 ? 'task' : 'tasks'} to update</p>
      {#each reviewed.changes as task (task.id)}
        <article class="diff" data-replan-diff><h4>{snapshot.tasks.find(item => item.id === task.id)?.title}</h4><p>{task.reason}</p>
          {#each fields as [key, label]}{@const before = snapshot.tasks.find(item => item.id === task.id)!}
            {#if before[key] !== task[key]}<div class="field-diff"><strong>{label}</strong><div><span>Before</span><p>{value(before[key], key)}</p></div><div><span>After</span><p>{value(task[key], key)}</p></div></div>{/if}
          {/each}
        </article>
      {/each}
      {#if reviewed.missingInformation.length}<h4>Questions to resolve</h4><ul>{#each reviewed.missingInformation as item}<li>{item}</li>{/each}</ul>{/if}
      <p class="field-help">The approved summary and each task’s reason will be saved in its activity.</p>
      <div class="actions"><WornButton onclick={async () => { reviewed = null; await tick(); document.getElementById('replan-summary')?.focus(); }} disabled={saving}>Back to editing</WornButton><WornButton variant="primary" onclick={apply} disabled={saving || stale}>{saving ? 'Saving…' : 'Save changes'}</WornButton></div>
    {/if}
    <div class="actions footer"><span class="muted">Unsaved changes</span><WornButton onclick={discard} disabled={saving}>Discard changes</WornButton></div>
  {/if}
</section>

<style>
  .update-context,.task-panel{border:1px solid var(--worn-border);border-radius:var(--worn-radius-sm);padding:.75rem;margin-block:.75rem;min-width:0}.task-panel summary{overflow-wrap:anywhere}.task-panel-title{font-weight:700}.task-panel-context{display:block;font-weight:400;font-size:.8rem;color:var(--worn-text-secondary);margin-top:.35rem}.task-panel fieldset{border:0;padding:0;margin-block:.5rem 0}.error:focus{outline:2px solid var(--worn-focus);outline-offset:3px}
  .model-info,.field-help,.update-scope{font-size:.8rem;color:var(--worn-text-secondary);overflow-wrap:anywhere;line-height:1.5}.field-help{margin-block:.65rem 0}.replan-generation{border:1px solid var(--worn-border);border-radius:var(--worn-radius-sm);padding:.65rem}
  .project-update{border-top:1px solid var(--worn-border);margin-top:1rem;padding-top:1rem;min-width:0}h3{font-size:1.1rem}h4{margin-block:.5rem}label{display:block;font-size:.875rem;font-weight:600;margin-block:.9rem .35rem}input:not([type=checkbox]),textarea,select{box-sizing:border-box;width:100%;min-width:0;min-height:44px;font:inherit;color:var(--worn-text);background:var(--worn-bg);border:1px solid var(--worn-field-border);border-radius:var(--worn-radius-sm);padding:.65rem}textarea{resize:vertical}input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--worn-focus);outline-offset:2px}.actions{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-block:.9rem}.footer{border-top:1px solid var(--worn-border);padding-top:.75rem;justify-content:space-between}.muted{font-size:.8rem;color:var(--worn-text-secondary)}summary{cursor:pointer;font-weight:600;padding-block:.65rem}.consent{display:flex;gap:.5rem;align-items:center;font-weight:400}.consent input{width:1.2rem;height:1.2rem;flex-shrink:0}fieldset,.diff,.provenance{border:1px solid var(--worn-border);padding:.75rem;margin-block:1rem;min-width:0;border-radius:var(--worn-radius-sm)}legend{font-weight:600;overflow-wrap:anywhere}.error{color:var(--worn-danger-text)}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:20rem;overflow:auto;font-size:.8rem}.field-diff{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-block:1rem}.field-diff>strong{grid-column:1/-1}.field-diff span{font-size:.8rem;color:var(--worn-text-secondary)}p,.field-diff{overflow-wrap:anywhere}.field-diff p{white-space:pre-wrap;margin-block:.25rem}.field-diff>div{min-width:0}@media(max-width:500px){.field-diff{grid-template-columns:1fr}.field-diff>strong{grid-column:auto}}
</style>
