<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { beforeNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/stores';
  import { demoState, approveProjectPlan, selectProject, pendingNextActionDrafts } from '$lib/demo-client';
  import { hasBlocker, canSetNextAction, workTitle } from '$lib/demo-workflow';
  import { PLAN_LIMITS, validatePlanInput, validateProjectPlan, type ProjectPlan, type ProjectPlanTask } from '$lib/nebius-plan-contract.mjs';
  import { PROJECT_STARTERS, getProjectStarter } from '$lib/nebius-project-starters.mjs';
  import { projectProgress } from '$lib/nebius-project-progress.mjs';
  import { WornButton, WornMetric, WornMetricGrid, WornProgress, WornSelect } from '$lib/components';
  import { createPlanClient, emptyPlanView } from './nebius-plan-client.mjs';
  import NebiusProjectUpdate from './NebiusProjectUpdate.svelte';

  let { onApproved }: { onApproved: () => Promise<void> } = $props();
  let open = $state(false), brief = $state(''), proposal = $state<ProjectPlan | null>(null);
  let reviewed = $state<ProjectPlan | null>(null), source = $state<'manual' | 'nebius'>('manual');
  let starterLabel = $state('');
  let consent = $state(false), saving = $state(false), error = $state(''), receipt = $state('');
  let approvalId = '', nextTask = 1;
  let draftHeading = $state<HTMLHeadingElement | null>(null);
  let errorElement = $state<HTMLParagraphElement | null>(null);
  let sourceControlsOpen = $state(true);
  let draftElement = $state<HTMLDivElement | null>(null);
  let updateEditor = $state<{ canLeave: () => boolean } | null>(null);
  const taskCount = (count: number) => `${count} ${count === 1 ? 'task' : 'tasks'}`;
  let view = $state(emptyPlanView());
  const client = createPlanClient({ onChange: next => {
    view = next;
    if (next.phase === 'complete' && next.plan) {
      proposal = structuredClone(next.plan); source = 'nebius'; starterLabel = ''; reviewed = null; approvalId = '';
      sourceControlsOpen = false;
      void tick().then(() => document.getElementById('project-title')?.focus());
    }
  } });
  let projects = $derived($demoState?.projects ?? []);
  let selectedProjectId = $derived($demoState?.selectedProjectId ?? null);
  let scopeSelection = $state('');
  $effect(() => { scopeSelection = selectedProjectId ?? ''; });
  let project = $derived(projects.find(candidate => candidate.id === selectedProjectId) ?? null);
  let scoped = $derived(($demoState?.packs ?? []).filter(pack => !selectedProjectId || pack.projectId === selectedProjectId));
  let progress = $derived(projectProgress(scoped));
  let openTasks = $derived(scoped.filter(pack => !pack.archived && pack.status !== 'done'));
  let nextWork = $derived(openTasks.filter(pack => pack.status === 'active' && !hasBlocker(pack) && canSetNextAction(pack)));
  let blockers = $derived(openTasks.filter(hasBlocker));
  let pending = $derived(pendingNextActionDrafts($demoState).filter(item => scoped.some(pack => pack.id === item.workId)));
  let dirty = $derived(Boolean(brief.trim() || proposal));
  let busy = $derived(saving || view.phase === 'generating');

  beforeNavigate(navigation => {
    if (saving || (dirty && !window.confirm('Discard this unsaved project draft and leave Work?'))) navigation.cancel();
  });
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!dirty && !saving) return;
    event.preventDefault(); event.returnValue = '';
  }
  onMount(() => {
    const arrival = new URL($page.url.href);
    const starterId = arrival.searchParams.get('starter');
    if (starterId !== null) {
      open = true;
      void loadProjectStarter(starterId).catch(cause => showError(cause, 'The requested example could not be opened.'));
      // Consume the entry request without saving the plan or reopening it on reload.
      arrival.searchParams.delete('starter');
      replaceState(arrival, $page.state);
    }
    void client.reload();
    return () => client.dispose();
  });
  function newTask(): ProjectPlanTask {
    let id = `task-${nextTask++}`;
    while (proposal?.tasks.some(task => task.id === id)) id = `task-${nextTask++}`;
    return { id, title: '', purpose: '', nextStep: '', doneWhen: '', dependsOn: null };
  }
  function initializeTaskPanel(panel: HTMLDetailsElement, initiallyOpen: boolean) {
    // Set the initial state once. Native details owns subsequent user toggles;
    // queued toggle events must not rewrite another panel's open property.
    panel.open = initiallyOpen;
  }
  async function addTask() {
    if (!proposal || busy || proposal.tasks.length >= PLAN_LIMITS.tasks) return;
    const task = newTask(); proposal.tasks.push(task);
    await tick(); document.getElementById(`task-title-${task.id}`)?.focus();
  }
  async function showError(cause: unknown, fallback: string) {
    error = cause instanceof Error ? cause.message : fallback;
    sourceControlsOpen = true;
    await tick();
    draftElement?.querySelectorAll<HTMLDetailsElement>('[data-plan-task-panel]').forEach(panel => { panel.open = true; });
    errorElement?.focus();
  }
  function editBrief(event: Event) {
    brief = (event.currentTarget as HTMLTextAreaElement).value.replace(/\r\n?/g, '\n');
    client.setBrief(brief);
    if (!starterLabel || source !== 'manual') { proposal = null; starterLabel = ''; }
    reviewed = null; approvalId = ''; error = ''; receipt = '';
  }
  async function loadProjectStarter(id: string) {
    if (busy) return;
    const starter = getProjectStarter(id);
    if (dirty && !window.confirm(`Replace this unsaved project draft with the ${starter.label.toLowerCase()} example plan?`)) return;
    client.setBrief(''); client.setBrief(starter.brief);
    brief = starter.brief; proposal = starter.plan; source = 'manual'; starterLabel = starter.label;
    sourceControlsOpen = false;
    reviewed = null; approvalId = ''; consent = false; error = ''; receipt = '';
    await tick(); document.getElementById('project-title')?.focus();
  }
  async function changeBrief() {
    if (busy || !window.confirm('Discard the current unsaved plan so you can change its brief?')) return;
    proposal = null; starterLabel = ''; reviewed = null; approvalId = ''; error = '';
    client.setBrief(''); client.setBrief(brief);
    sourceControlsOpen = true; await tick(); document.getElementById('project-brief')?.focus();
  }
  async function generatePlan() {
    if (proposal && !window.confirm('Replace this unsaved plan if Nebius returns a valid new proposal?')) return;
    await client.generate();
  }
  async function outlineManually() {
    try {
      validatePlanInput({ brief }); client.setBrief(''); client.setBrief(brief);
      source = 'manual'; starterLabel = ''; proposal = { title: '', summary: '', tasks: [newTask()], missingInformation: [] };
      sourceControlsOpen = false;
      reviewed = null; approvalId = ''; error = ''; receipt = '';
      await tick(); document.getElementById('project-title')?.focus();
    } catch (cause) { await showError(cause, 'Enter a project brief first.'); }
  }
  async function removeTask(id: string) {
    if (!proposal || busy || proposal.tasks.length <= 1) return;
    const removedIndex = proposal.tasks.findIndex(task => task.id === id);
    if (removedIndex < 0) return;
    proposal.tasks = proposal.tasks.filter(task => task.id !== id).map(task => ({ ...task, dependsOn: task.dependsOn === id ? null : task.dependsOn }));
    const nextIndex = Math.min(removedIndex, proposal.tasks.length - 1);
    await tick();
    const panels = draftElement?.querySelectorAll<HTMLDetailsElement>('[data-plan-task-panel]');
    const target = panels?.[nextIndex]?.querySelector<HTMLElement>('summary')
      ?? draftElement?.querySelector<HTMLButtonElement>('[data-plan-add-task]');
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }
  async function reviewPlan() {
    try {
      validatePlanInput({ brief }); reviewed = validateProjectPlan(proposal);
      approvalId ||= `project-${crypto.randomUUID()}`; error = '';
      await tick(); draftHeading?.focus();
    } catch (cause) { await showError(cause, 'Check every required plan field and dependency.'); }
  }
  async function backToEditing() {
    reviewed = null;
    await tick(); document.getElementById('project-title')?.focus();
  }
  async function approve() {
    if (!reviewed || saving) return;
    saving = true; error = '';
    try {
      const result = await approveProjectPlan(brief, reviewed, approvalId, source);
      brief = ''; proposal = null; starterLabel = ''; reviewed = null; client.setBrief(''); approvalId = ''; open = false;
      sourceControlsOpen = true;
      receipt = `Approved ${result.project.title}: ${taskCount(result.tasks.length)} created. No tasks have been executed.`;
      await onApproved();
    } catch (cause) { await showError(cause, 'Approval did not save. Review and try again.'); }
    finally { saving = false; }
  }
  async function discard() {
    if (busy || (dirty && !window.confirm('Discard this unsaved project draft?'))) return;
    brief = ''; proposal = null; starterLabel = ''; reviewed = null; client.setBrief(''); approvalId = ''; error = ''; open = false;
    sourceControlsOpen = true;
    await tick(); document.querySelector<HTMLButtonElement>('[data-new-project]')?.focus();
  }
  export function canChangeScope() { return !updateEditor || updateEditor.canLeave(); }
  async function changeScope(value: string) {
    scopeSelection = value;
    if (updateEditor && !updateEditor.canLeave()) { scopeSelection = selectedProjectId ?? ''; return; }
    try { await selectProject(value || null); error = ''; }
    catch (cause) { scopeSelection = selectedProjectId ?? ''; error = cause instanceof Error ? cause.message : 'Project selection did not save.'; }
  }
</script>

<svelte:window onbeforeunload={beforeUnload} />
<section class="project-workspace" data-nebius-project-workspace aria-label="Project workspace">
  <div class="project-heading">
    <label for="project-scope">Project scope
      <WornSelect id="project-scope" bind:value={() => scopeSelection, changeScope} disabled={saving}
        options={[{ value: '', label: 'All work' }, ...projects.map(item => ({ value: item.id, label: item.title }))]} />
    </label>
    <WornButton variant="primary" data-new-project onclick={() => { if (!updateEditor || updateEditor.canLeave()) { open = true; receipt = ''; } }} disabled={saving}>New project</WornButton>
  </div>
  {#if project}<h2>{project.title}</h2><p class="muted">{project.summary}</p><p class="muted">{project.source === 'manual' ? 'Human-created plan' : 'Nebius proposal approved by a human'}</p>{/if}
  {#if project}
    {#if progress.total > 0}
      <div class="completion-progress">
        <WornProgress value={progress.done} max={progress.total} label="Tasks marked done" ariaLabel={`${progress.done} of ${progress.total} tasks marked done, including archived tasks`} />
      </div>
    {/if}
    <div class="overview project-progress" data-project-progress aria-label="Actual project progress">
      <div><strong data-project-progress-done>{progress.done}/{progress.total}</strong><span>Tasks marked done</span><small>Done status, including archived tasks</small></div>
      <div><strong data-project-progress-remaining>{progress.remaining}</strong><span>Open remaining</span><small>Not done and not archived</small></div>
      <div><strong data-project-progress-archived>{progress.archived}</strong><span>Archived</span><small data-project-progress-archived-unfinished>{progress.archivedUnfinished} unfinished · archived can overlap done</small></div>
    </div>
    {#if progress.allDone}<p role="status" data-project-all-done>All tasks marked done. Evidence and publication acceptance are separate.</p>{/if}
  {/if}
  <WornMetricGrid ariaLabel="Current work in this scope" data-project-overview>
    <WornMetric value={nextWork.length} label="Ready to work" description="Active, open tasks without blockers" />
    <WornMetric value={blockers.length} label="Blocked" tone={blockers.length ? 'warning' : 'default'} description="Open tasks with a recorded blocker" />
    <WornMetric value={pending.length} label="Awaiting approval" description="Unsaved action drafts in this scope" />
  </WornMetricGrid>
  <p class="scope-note">Counts cover all {taskCount(scoped.length)} in {project ? 'this project' : 'All work'}, including archived tasks, before list filters · {taskCount($demoState?.packs.length ?? 0)} in the workspace.</p>
  {#if project && nextWork.length}<nav class="next-work" aria-label="Project next work">{#each nextWork.slice(0, 3) as pack (pack.id)}<a href={`/next?pack=${encodeURIComponent(pack.id)}`}>{workTitle(pack)}</a>{/each}{#if nextWork.length > 3}<span class="muted" data-project-next-count>Showing 3 of {nextWork.length} ready tasks</span>{/if}</nav>{/if}
  {#if receipt}<p role="status" data-project-approved>{receipt}</p>{/if}
  {#if error}<p class="error" role="alert" tabindex="-1" bind:this={errorElement} data-project-plan-error>{error}</p>{/if}
  {#if project && !open}{#key project.id}<NebiusProjectUpdate bind:this={updateEditor} projectId={project.id} {onApproved} />{/key}{/if}
  {#if open}
    <div class="project-draft" data-project-draft bind:this={draftElement}>
      <h2 bind:this={draftHeading} tabindex="-1" data-project-draft-heading>{reviewed ? 'Review new project' : proposal ? 'Edit project plan' : 'New project'}</h2>
      {#if !reviewed}
      <details class="plan-source-controls" data-plan-source-controls bind:open={sourceControlsOpen}>
        <summary>{proposal ? 'Brief and draft options' : 'Choose a starting point'}</summary>
        <div class="project-starters" data-project-starters>
        <h3>Start with an example</h3>
        <p class="muted">Human-written plans you can edit.</p>
        <div class="starter-actions">{#each PROJECT_STARTERS as starter (starter.id)}<WornButton id={`project-starter-${starter.id}`} data-project-starter={starter.id} onclick={() => loadProjectStarter(starter.id)} disabled={busy}>{starter.label} example</WornButton>{/each}</div>
      </div>
        {#if !proposal}<h3>Or write a brief</h3>{/if}
        <label for="project-brief">Project brief<textarea id="project-brief" rows="3" value={brief} oninput={editBrief} maxlength={PLAN_LIMITS.brief} disabled={saving || Boolean(proposal && !starterLabel)} placeholder="Describe the outcome, requirements and constraints."></textarea></label>
        {#if proposal}<WornButton onclick={changeBrief} disabled={busy}>Change brief</WornButton>{/if}
        {#if !proposal}<div class="actions"><WornButton onclick={outlineManually} disabled={busy || !brief.trim()}>Build plan myself</WornButton></div>{/if}
        <details class="nebius-generation" data-plan-nebius-options><summary>{view.phase === 'unavailable' || (view.phase === 'error' && !view.config) ? 'Draft with Nebius · unavailable' : 'Draft with Nebius'}</summary>
          <p class="muted">Nebius uses only the project brief to draft a plan.</p>
          <details data-plan-send-preview><summary>Preview brief sent to Nebius</summary><p class="brief-review">{brief || 'Enter a project brief above.'}</p></details>
          {#if view.config}<p class="model-info">Model: {view.config.requestedModel}<br />Up to {view.config.maxOutputTokens.toLocaleString()} output tokens per request · no automatic retry.</p>{/if}
          <label class="consent"><input type="checkbox" bind:checked={consent} disabled={busy} />I agree to send this project brief to Nebius.</label>
          <div class="actions"><WornButton onclick={generatePlan} disabled={!view.config || !brief.trim() || !consent || busy}>Generate plan with Nebius</WornButton><WornButton onclick={() => client.reload()} disabled={busy || view.phase === 'loading'}>Reload settings</WornButton></div>
          {#if view.phase === 'loading' || view.phase === 'generating'}<p role="status">{view.phase === 'loading' ? 'Loading model settings…' : 'Generating an unsaved plan…'}</p>{/if}
          {#if view.error}<p class="muted" role="status">{view.error}</p>{/if}
        </details>
      </details>
        {#if proposal}
          <p class="provenance" data-project-provenance>{starterLabel ? `Example plan — edit before approval · human-written ${starterLabel.toLowerCase()} example` : source === 'manual' ? 'Manual plan · unsaved' : 'Nebius draft · unsaved'}</p>
          {#if view.usage && source === 'nebius'}<p class="muted">{view.usage.input_tokens} input tokens · {view.usage.output_tokens} output tokens</p>{/if}
          <label for="project-title">Project title<input id="project-title" bind:value={proposal.title} maxlength={PLAN_LIMITS.title} disabled={busy} /></label>
          <label for="project-summary">Project summary<textarea id="project-summary" bind:value={proposal.summary} maxlength={PLAN_LIMITS.summary} rows="2" disabled={busy}></textarea></label>
          {#key proposal}
          {#each proposal.tasks as task, index (task.id)}
            <details class="task-panel" data-plan-task-panel={task.id} use:initializeTaskPanel={index === 0 || !task.title.trim()}>
              <summary><span class="task-panel-title">Task {index + 1} · {task.title || 'Untitled task'}</span><span class="task-panel-context">{task.nextStep || 'Next step needed'} · Predecessor: {proposal.tasks.find(candidate => candidate.id === task.dependsOn)?.title || 'None'}</span></summary>
            <fieldset data-plan-task disabled={busy}><legend>Task {index + 1}</legend>
              <label for={`task-title-${task.id}`}>Task title<input id={`task-title-${task.id}`} bind:value={task.title} maxlength={PLAN_LIMITS.taskTitle} /></label>
              <label for={`task-purpose-${task.id}`}>Why it matters<textarea id={`task-purpose-${task.id}`} bind:value={task.purpose} maxlength={PLAN_LIMITS.purpose} rows="2"></textarea></label>
              <label for={`task-next-${task.id}`}>Next step<input id={`task-next-${task.id}`} bind:value={task.nextStep} maxlength={PLAN_LIMITS.nextStep} /></label>
              <label for={`task-done-${task.id}`}>Completion criteria<textarea id={`task-done-${task.id}`} bind:value={task.doneWhen} maxlength={PLAN_LIMITS.doneWhen} rows="2"></textarea></label>
              <label for={`task-dependency-${task.id}`}>Predecessor<select id={`task-dependency-${task.id}`} value={task.dependsOn ?? ''} onchange={event => { task.dependsOn = event.currentTarget.value || null; }}><option value="">None — ready to start</option>{#each proposal.tasks.filter(candidate => candidate.id !== task.id) as candidate (candidate.id)}<option value={candidate.id}>{candidate.title || candidate.id}</option>{/each}</select></label>
              <WornButton onclick={() => removeTask(task.id)} disabled={proposal.tasks.length <= 1 || busy}>Remove task {index + 1}</WornButton>
            </fieldset>
            </details>
          {/each}
          {/key}
          <div class="actions"><WornButton data-plan-add-task onclick={addTask} disabled={busy || proposal.tasks.length >= PLAN_LIMITS.tasks}>Add task</WornButton><span class="muted">{proposal.tasks.length} of {PLAN_LIMITS.tasks} tasks maximum</span></div>
          {#if proposal.missingInformation.length}<div class="missing"><h3>Questions to resolve</h3><ul>{#each proposal.missingInformation as item}<li>{item}</li>{/each}</ul></div>{/if}
          <WornButton variant="primary" onclick={reviewPlan} disabled={busy}>Review plan</WornButton>
        {/if}
      {:else}
        <h3>{reviewed.title}</h3><p>{reviewed.summary}</p><p class="provenance" data-project-provenance>{starterLabel ? `Human-written ${starterLabel.toLowerCase()} example` : source === 'manual' ? 'Human-created plan' : 'Nebius proposal'} · {taskCount(reviewed.tasks.length)} to create</p>
        <details><summary>Review project brief</summary><p class="brief-review">{brief}</p></details>
        <ol class="review-list">{#each reviewed.tasks as task (task.id)}<li><strong>{task.title}</strong><p>{task.purpose}</p><dl><dt>Next step</dt><dd>{task.nextStep}</dd><dt>Completion criteria</dt><dd>{task.doneWhen}</dd><dt>Predecessor</dt><dd>{reviewed.tasks.find(candidate => candidate.id === task.dependsOn)?.title ?? 'None — ready to start'}</dd></dl></li>{/each}</ol>
        {#if reviewed.missingInformation.length}<h3>Questions to resolve</h3><ul>{#each reviewed.missingInformation as item}<li>{item}</li>{/each}</ul>{/if}
        <p class="muted">Creates the project and tasks together. Tasks with a predecessor start blocked.</p>
        <div class="actions"><WornButton onclick={backToEditing} disabled={saving}>Back to editing</WornButton><WornButton variant="primary" onclick={approve} disabled={saving}>{saving ? 'Creating…' : 'Approve and create project'}</WornButton></div>
      {/if}
      <div class="draft-footer"><span class="muted">{reviewed ? 'Not created yet' : 'Unsaved draft'}</span><WornButton onclick={discard} disabled={busy}>Discard draft</WornButton></div>
    </div>
  {/if}
</section>

<style>
  .project-workspace{border:1px solid var(--worn-border);border-radius:var(--worn-radius);padding:1rem;margin-block:0 1rem;background:var(--worn-surface);min-width:0}
  .project-heading,.actions,.draft-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem}
  .plan-source-controls,.task-panel{border:1px solid var(--worn-border);border-radius:var(--worn-radius-sm);padding:.75rem;margin-block:.75rem;min-width:0}.task-panel summary{overflow-wrap:anywhere}.task-panel-title{font-weight:700}.task-panel-context{display:block;font-weight:400;font-size:.8rem;color:var(--worn-text-secondary);margin-top:.35rem}.task-panel fieldset{border:0;padding:0;margin-block:.5rem 0}.error:focus{outline:2px solid var(--worn-focus);outline-offset:3px}
  .project-starters{border:1px solid var(--worn-border);border-radius:var(--worn-radius-sm);padding:.65rem;margin-block:.5rem .75rem;min-width:0}.project-starters h3{margin-block:0 .4rem}.starter-actions{display:flex;flex-wrap:wrap;gap:.5rem}.starter-actions :global(button){max-width:100%;white-space:normal;overflow-wrap:anywhere}
  .model-info{font-size:.8rem;color:var(--worn-text-secondary);overflow-wrap:anywhere;line-height:1.5}.plan-source-controls>h3{margin-block:.75rem .4rem}.nebius-generation{border:1px solid var(--worn-border);border-radius:var(--worn-radius-sm);padding:.65rem}
  .project-heading label{flex:1;max-width:32rem}.project-workspace h2{font-size:1.15rem;margin-block:1rem .4rem}.project-workspace h3{font-size:1rem}
  .completion-progress{margin-block:1rem}.project-workspace :global(.worn-metric-grid){margin-block:1rem}
  label{display:grid;gap:.35rem;font-size:.875rem;font-weight:600;min-width:0;margin-block:.7rem}input:not([type=checkbox]),textarea,select{box-sizing:border-box;width:100%;min-width:0;font:inherit;color:var(--worn-text);background:var(--worn-bg);border:1px solid var(--worn-border-strong);border-radius:var(--worn-radius-sm);padding:.65rem;min-height:44px}textarea{resize:vertical}input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--worn-focus);outline-offset:2px}
  .overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;margin-block:1rem}.overview div{display:grid;gap:.25rem;border:1px solid var(--worn-border);padding:.7rem}.overview strong{font-size:1.3rem}.overview span{font-weight:600;font-size:.875rem}.overview small,.muted,.scope-note{color:var(--worn-text-secondary);font-size:.8rem}.scope-note{margin-block:.65rem}.next-work{display:flex;gap:1rem;flex-wrap:wrap}.next-work a{overflow-wrap:anywhere}.project-draft{border-top:1px solid var(--worn-border);margin-top:1rem}.nebius-generation{margin-block:1rem}.consent{display:flex;align-items:center;font-weight:400}.consent input{width:1.2rem;height:1.2rem}summary{cursor:pointer;font-weight:600;padding-block:.5rem}.provenance{font-size:.85rem;border:1px solid var(--worn-border);padding:.5rem}.error{color:var(--worn-danger);overflow-wrap:anywhere}fieldset{margin-block:1rem;border:1px solid var(--worn-border);border-radius:var(--worn-radius-sm);min-width:0;padding:.75rem}legend{font-weight:700}.draft-footer{border-top:1px solid var(--worn-border);padding-top:.75rem;margin-top:1rem}.review-list{padding-left:1.3rem}.review-list li{padding-block:.5rem;overflow-wrap:anywhere}dt{font-weight:600;font-size:.85rem}dd{margin:0 0 .6rem;white-space:pre-wrap;font-size:.85rem}.brief-review{white-space:pre-wrap;overflow-wrap:anywhere}
  @media(max-width:500px){.project-workspace{padding:.75rem}.overview{gap:.5rem}.overview small{font-size:.7rem}.project-heading{align-items:flex-end}.project-heading label{flex-basis:100%}.actions{justify-content:flex-start}}
</style>
