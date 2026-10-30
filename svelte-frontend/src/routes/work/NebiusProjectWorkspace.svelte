<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
  import { isAllWorkScopeUrl } from '$lib/nebius-command-context';
  import { page } from '$app/stores';
  import { demoState, approveProjectPlan, selectProject, pendingNextActionDrafts } from '$lib/demo-client';
  import { hasBlocker, canSetNextAction, workTitle } from '$lib/demo-workflow';
  import { PLAN_LIMITS, validatePlanInput, validateProjectPlan, validateAuthoredProjectPlan, type ProjectPlan, type ProjectPlanTask } from '$lib/nebius-plan-contract.mjs';
  import { PROJECT_STARTERS, getProjectStarter } from '$lib/nebius-project-starters.mjs';
  import { projectProgress } from '$lib/nebius-project-progress.mjs';
  import { WornButton, WornMetric, WornMetricGrid, WornProgress, WornSelect } from '$lib/components';
  import { createPlanClient, emptyPlanView } from './nebius-plan-client.mjs';
  import NebiusProjectUpdate from './NebiusProjectUpdate.svelte';
  import NebiusInferenceFailure from '$lib/NebiusInferenceFailure.svelte';
  import { GROUNDING_REHEARSAL_BRIEF, GROUNDING_REHEARSAL_CASES, createGroundingRehearsalFetcher, type GroundingRehearsalCase } from '$lib/nebius-grounding-rehearsal.mjs';
  import { createFocusOwnership, createFocusOperationSlot, type FocusOwnership, type FocusOwnershipToken } from '$lib/nebius-deferred-focus.mjs';

  let { onApproved, rehearsal = false }: { onApproved: () => Promise<void>; rehearsal?: boolean } = $props();
  let rehearsalCase = $state<GroundingRehearsalCase>('grounded');
  let open = $state(false), brief = $state(''), proposal = $state<ProjectPlan | null>(null);
  let reviewed = $state<ProjectPlan | null>(null), source = $state<'manual' | 'nebius'>('manual');
  let starterLabel = $state('');
  let modelDraftEdited = $state(false);
  let consent = $state(false), saving = $state(false), error = $state(''), receipt = $state('');
  let approvalId = '', nextTask = 1;
  let focusOwnership: FocusOwnership | null = null;
  const generationFocus = createFocusOperationSlot();
  let draftHeading = $state<HTMLHeadingElement | null>(null);
  let errorElement = $state<HTMLParagraphElement | null>(null);
  let sourceControlsOpen = $state(true);
  let draftElement = $state<HTMLDivElement | null>(null);
  let updateEditor = $state<{ canLeave: () => boolean } | null>(null);
  const taskCount = (count: number) => `${count} ${count === 1 ? 'task' : 'tasks'}`;
  let view = $state(emptyPlanView());
  const rehearsalFetcher = createGroundingRehearsalFetcher(() => rehearsalCase);
  const client = createPlanClient({ fetcher: (input, init) => rehearsal ? rehearsalFetcher(input, init) : globalThis.fetch(input, init), onChange: next => {
    view = next;
    if (next.phase === 'loading') consent = false;
    if (next.phase !== 'complete' && source === 'nebius') {
      proposal = null; reviewed = null; approvalId = ''; modelDraftEdited = false; sourceControlsOpen = true;
    }
    if (next.phase === 'complete' && next.plan) {
      proposal = structuredClone(next.plan); source = 'nebius'; starterLabel = ''; reviewed = null; approvalId = '';
      modelDraftEdited = false;
      sourceControlsOpen = false;
      void focusProjectTitleAfterTick(generationFocus.current());
    }
    if (rehearsal && next.planningResult) sourceControlsOpen = false;
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
  let dirty = $derived(rehearsal ? modelDraftEdited : Boolean(brief.trim() || proposal));
  let busy = $derived(saving || view.phase === 'generating');

  beforeNavigate(navigation => {
    if (saving || (dirty && !window.confirm(rehearsal ? 'Discard your rehearsal edits and leave this page?' : 'Discard this unsaved project draft and leave Work?'))) navigation.cancel();
  });
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!dirty && !saving) return;
    event.preventDefault(); event.returnValue = '';
  }
  onMount(() => {
    focusOwnership = createFocusOwnership(document);
    const dispose = () => { focusOwnership?.dispose(); focusOwnership = null; client.dispose(); };
    if (rehearsal) {
      open = true; brief = GROUNDING_REHEARSAL_BRIEF; client.setBrief(brief); void client.reload();
      return dispose;
    }
    const arrival = new URL($page.url.href);
    const starterId = arrival.searchParams.get('starter');
    if (starterId !== null) {
      open = true;
      const focusOrigin = focusOwnership.capture();
      void loadProjectStarter(starterId).catch(cause => showError(cause, 'The requested example could not be opened.', focusOrigin));
      // Consume the entry request without saving the plan or reopening it on reload.
      arrival.searchParams.delete('starter');
      replaceState(arrival, $page.state);
    }
    void client.reload();
    return dispose;
  });
  function newTask(): ProjectPlanTask {
    let id = `task-${nextTask++}`;
    while (proposal?.tasks.some(task => task.id === id)) id = `task-${nextTask++}`;
    return { id, title: '', purpose: '', nextStep: '', doneWhen: '', dependsOn: null };
  }
  async function focusProjectTitleAfterTick(origin: FocusOwnershipToken | null) {
    await tick();
    focusOwnership?.focus(origin, document.getElementById('project-title'));
  }
  async function beginNewProject() {
    if (busy || (updateEditor && !updateEditor.canLeave())) return;
    const focusOrigin = focusOwnership?.capture() ?? null;
    open = true; receipt = '';
    await tick(); focusOwnership?.focus(focusOrigin, draftHeading);
  }
  function initializeTaskPanel(panel: HTMLDetailsElement, initiallyOpen: boolean) {
    // Set the initial state once. Native details owns subsequent user toggles;
    // queued toggle events must not rewrite another panel's open property.
    panel.open = initiallyOpen;
  }
  async function addTask() {
    if (!proposal || busy || proposal.tasks.length >= PLAN_LIMITS.tasks) return;
    const focusOrigin = focusOwnership?.capture() ?? null;
    markModelEdit(); const task = newTask(); proposal.tasks.push(task);
    await tick(); focusOwnership?.focus(focusOrigin, document.getElementById(`task-title-${task.id}`));
  }
  async function showError(cause: unknown, fallback: string, focusOrigin: FocusOwnershipToken | null) {
    error = cause instanceof Error ? cause.message : fallback;
    sourceControlsOpen = true;
    await tick();
    draftElement?.querySelectorAll<HTMLDetailsElement>('[data-plan-task-panel]').forEach(panel => { panel.open = true; });
    focusOwnership?.focus(focusOrigin, errorElement);
  }
  function editBrief(event: Event) {
    brief = (event.currentTarget as HTMLTextAreaElement).value.replace(/\r\n?/g, '\n');
    client.setBrief(brief);
    consent = false;
    if (source === 'nebius') { proposal = null; starterLabel = ''; }
    reviewed = null; approvalId = ''; error = ''; receipt = '';
  }
  async function loadProjectStarter(id: string) {
    if (busy) return;
    const focusOrigin = focusOwnership?.capture() ?? null;
    const starter = getProjectStarter(id);
    if (dirty && !window.confirm(`Replace this unsaved project draft with the ${starter.label.toLowerCase()} example plan?`)) return;
    client.setBrief(''); client.setBrief(starter.brief);
    brief = starter.brief; proposal = starter.plan; source = 'manual'; starterLabel = starter.label;
    sourceControlsOpen = false;
    reviewed = null; approvalId = ''; consent = false; error = ''; receipt = '';
    await focusProjectTitleAfterTick(focusOrigin);
  }
  async function changeBrief() {
    if (busy || !window.confirm('Discard the current unsaved plan so you can change its brief?')) return;
    const focusOrigin = focusOwnership?.capture() ?? null;
    proposal = null; starterLabel = ''; reviewed = null; approvalId = ''; error = '';
    client.setBrief(''); client.setBrief(brief);
    sourceControlsOpen = true; await tick(); focusOwnership?.focus(focusOrigin, document.getElementById('project-brief'));
  }
  async function generatePlan() {
    if (proposal && !window.confirm(rehearsal ? 'Replace this unsaved rehearsal draft with the selected authored example?' : 'Replace this unsaved plan if Nebius returns a valid new proposal?')) return;
    const operation = generationFocus.begin(focusOwnership?.capture() ?? null);
    try { await client.generate(); } finally { generationFocus.end(operation); }
  }
  function chooseRehearsalCase(event: Event) {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const item = GROUNDING_REHEARSAL_CASES.find(item => item.id === id);
    if (!item) throw new TypeError('Choose a supported authored example.');
    rehearsalCase = item.id;
    client.setBrief(''); client.setBrief(GROUNDING_REHEARSAL_BRIEF); brief = GROUNDING_REHEARSAL_BRIEF;
    proposal = null; reviewed = null; approvalId = ''; modelDraftEdited = false; error = ''; receipt = ''; open = true; sourceControlsOpen = true;
  }
  function markModelEdit() { if (source === 'nebius') modelDraftEdited = true; }
  async function outlineManually() {
    const focusOrigin = focusOwnership?.capture() ?? null;
    try {
      validatePlanInput({ brief }); client.setBrief(''); client.setBrief(brief);
      source = 'manual'; starterLabel = ''; proposal = { title: '', summary: brief.slice(0, PLAN_LIMITS.summary), tasks: [newTask()], missingInformation: [] };
      sourceControlsOpen = false;
      reviewed = null; approvalId = ''; error = ''; receipt = '';
      await focusProjectTitleAfterTick(focusOrigin);
    } catch (cause) { await showError(cause, 'Enter a project brief first.', focusOrigin); }
  }
  async function removeTask(id: string) {
    if (!proposal || busy || proposal.tasks.length <= 1) return;
    const focusOrigin = focusOwnership?.capture() ?? null;
    const removedIndex = proposal.tasks.findIndex(task => task.id === id);
    if (removedIndex < 0) return;
    markModelEdit();
    proposal.tasks = proposal.tasks.filter(task => task.id !== id).map(task => ({ ...task, dependsOn: task.dependsOn === id ? null : task.dependsOn }));
    const nextIndex = Math.min(removedIndex, proposal.tasks.length - 1);
    await tick();
    const panels = draftElement?.querySelectorAll<HTMLDetailsElement>('[data-plan-task-panel]');
    const target = panels?.[nextIndex]?.querySelector<HTMLElement>('summary')
      ?? draftElement?.querySelector<HTMLButtonElement>('[data-plan-add-task]');
    if (focusOwnership?.focus(focusOrigin, target ?? null)) target?.scrollIntoView({ block: 'nearest' });
  }
  async function reviewPlan() {
    const focusOrigin = focusOwnership?.capture() ?? null;
    try {
      validatePlanInput({ brief }); reviewed = source === 'manual' ? validateAuthoredProjectPlan(proposal) : validateProjectPlan(proposal);
      approvalId ||= `project-${crypto.randomUUID()}`; error = '';
      await tick(); focusOwnership?.focus(focusOrigin, draftHeading);
    } catch (cause) { await showError(cause, 'Check every required plan field and dependency.', focusOrigin); }
  }
  async function backToEditing() {
    const focusOrigin = focusOwnership?.capture() ?? null;
    reviewed = null;
    await focusProjectTitleAfterTick(focusOrigin);
  }
  async function approve() {
    if (rehearsal || !reviewed || saving) return;
    const focusOrigin = focusOwnership?.capture() ?? null;
    saving = true; error = '';
    try {
      const result = await approveProjectPlan(brief, reviewed, approvalId, source);
      brief = ''; proposal = null; starterLabel = ''; reviewed = null; client.setBrief(''); approvalId = ''; open = false;
      sourceControlsOpen = true;
      receipt = `Created ${result.project.title} with ${taskCount(result.tasks.length)}. No tasks have been executed.`;
      await onApproved();
    } catch (cause) { await showError(cause, 'Approval did not save. Review and try again.', focusOrigin); }
    finally { saving = false; }
  }
  async function discard() {
    if (busy || (dirty && !window.confirm(rehearsal ? 'Discard your rehearsal edits?' : 'Discard this unsaved project draft?'))) return;
    const focusOrigin = focusOwnership?.capture() ?? null;
    resetProjectDraft();
    if (rehearsal) {
      brief = GROUNDING_REHEARSAL_BRIEF; open = true; client.setBrief(brief);
      await tick(); focusOwnership?.focus(focusOrigin, document.getElementById('grounding-rehearsal-case')); return;
    }
    await tick(); focusOwnership?.focus(focusOrigin, document.querySelector<HTMLButtonElement>('[data-new-project]'));
  }
  function resetProjectDraft() {
    brief = ''; proposal = null; starterLabel = ''; reviewed = null; client.setBrief(''); approvalId = ''; error = ''; open = false;
    sourceControlsOpen = true;
  }
  afterNavigate(({ from, to }) => {
    if (!rehearsal && from?.url.pathname === '/work' && isAllWorkScopeUrl(to?.url)) resetProjectDraft();
  });
  export function canChangeScope() { return !updateEditor || updateEditor.canLeave(); }
  async function changeScope(value: string) {
    if (rehearsal) return;
    scopeSelection = value;
    if (updateEditor && !updateEditor.canLeave()) { scopeSelection = selectedProjectId ?? ''; return; }
    try { await selectProject(value || null); error = ''; }
    catch (cause) { scopeSelection = selectedProjectId ?? ''; error = cause instanceof Error ? cause.message : 'Project selection did not save.'; }
  }
</script>

<svelte:window onbeforeunload={beforeUnload} />
<section class="project-workspace" class:rehearsal data-nebius-project-workspace aria-label="Project workspace">
  {#if rehearsal}
    <div class="rehearsal-notice" data-grounding-rehearsal>
      <div class="rehearsal-actions">
        <label for="grounding-rehearsal-case">Authored case<select id="grounding-rehearsal-case" value={rehearsalCase} onchange={chooseRehearsalCase} disabled={busy}>{#each GROUNDING_REHEARSAL_CASES as item}<option value={item.id}>{item.label}</option>{/each}</select></label>
        <WornButton variant="primary" onclick={generatePlan} disabled={!view.config || !brief.trim() || busy}>Run authored example</WornButton>
      </div>
      {#if view.phase === 'blocked'}<p role="status" class="rehearsal-result"><strong>{view.planningResult?.groundingReview?.assessment === 'unclear' ? 'Unclear' : 'Rejected'} · read-only draft.</strong></p>
      {:else if view.phase === 'error'}<p role="status" class="rehearsal-result"><strong>{view.planningResult ? 'Review failed · read-only draft.' : 'The example could not be loaded.'}</strong></p>
      {:else if view.phase === 'complete'}<p role="status" class="rehearsal-result"><strong>{modelDraftEdited ? 'Edited draft · not assessed.' : reviewed ? 'Grounded · draft in review.' : 'Grounded · draft ready to edit.'}</strong></p>
      {:else}<p>{GROUNDING_REHEARSAL_CASES.find(item => item.id === rehearsalCase)?.description}</p>{/if}
      <p class="muted">No model or Sandbox calls. Changes aren’t saved.</p>
      {#if !open}<WornButton onclick={() => { open = true; brief = GROUNDING_REHEARSAL_BRIEF; client.setBrief(brief); }}>Open rehearsal</WornButton>{/if}
    </div>
  {:else}
  <div class="project-heading">
    <label for="project-scope">Project scope
      <WornSelect id="project-scope" bind:value={() => scopeSelection, changeScope} disabled={saving}
        options={[{ value: '', label: 'All work' }, ...projects.map(item => ({ value: item.id, label: item.title }))]} />
    </label>
    <WornButton data-new-project variant={scoped.length === 0 ? 'primary' : undefined} onclick={beginNewProject} disabled={busy}>New project</WornButton>
  </div>
  {#if project}
    <h2>{project.title}</h2>
    <p class="project-summary" data-project-goal>{project.summary}</p>
    <div data-project-completion>
      <p class="completion-summary" data-project-progress-summary>{progress.done}/{progress.total} tasks marked done · includes archived</p>
    {#if progress.total > 0}
      <div class="completion-progress">
        <WornProgress value={progress.done} max={progress.total} label="Tasks marked done" ariaLabel={`${progress.done} of ${progress.total} tasks marked done, including archived tasks`} />
      </div>
    {/if}
    </div>
  {/if}
  <details class="project-details" data-project-details>
    <summary>Details{#if !project}<span class="details-label"> · {scoped.length} workspace {scoped.length === 1 ? 'task' : 'tasks'} · includes archived</span>{/if}</summary>
  {#if project}
    <p class="muted">{project.source === 'manual' ? 'Human-created plan' : 'Nebius proposal approved by a human'}</p>
    <div class="overview project-progress" data-project-progress aria-label="Actual project progress">
      <div><strong data-project-progress-done>{progress.done}/{progress.total}</strong><span>Marked done</span><small>Includes archived</small></div>
      <div><strong data-project-progress-remaining>{progress.remaining}</strong><span>Open remaining</span><small>Neither done nor archived</small></div>
      <div><strong data-project-progress-archived>{progress.archived}</strong><span>Archived</span><small data-project-progress-archived-unfinished>{progress.archivedUnfinished} unfinished · may also be done</small></div>
    </div>
    {#if progress.allDone}<p role="status" data-project-all-done>All tasks marked done. Evidence and publication acceptance are separate.</p>{/if}
  {/if}
  <WornMetricGrid ariaLabel="Current work in this scope" data-project-overview>
    <WornMetric value={nextWork.length} label="Ready to work" description="Open, active tasks without blockers" />
    <WornMetric value={blockers.length} label="Blocked" tone={blockers.length ? 'warning' : 'default'} description="Open tasks with blockers" />
    <WornMetric value={pending.length} label="Awaiting approval" description="Unsaved action drafts" />
  </WornMetricGrid>
  <p class="scope-note">All {taskCount(scoped.length)} in {project ? 'this project' : 'All work'}, including archived, before list filters · {taskCount($demoState?.packs.length ?? 0)} in the workspace.</p>
  {#if project && nextWork.length}<nav class="next-work" aria-label="Project next work">{#each nextWork.slice(0, 3) as pack (pack.id)}<a href={`/next?pack=${encodeURIComponent(pack.id)}`}>{workTitle(pack)}</a>{/each}{#if nextWork.length > 3}<span class="muted" data-project-next-count>Showing 3 of {nextWork.length} ready tasks</span>{/if}</nav>{/if}
  </details>
  {#if receipt}<p role="status" data-project-approved>{receipt}</p>{/if}
  {#if error}<p class="error" role="alert" tabindex="-1" bind:this={errorElement} data-project-plan-error>{error}</p>{/if}
  {#if project && !open}{#key project.id}<NebiusProjectUpdate bind:this={updateEditor} projectId={project.id} {onApproved} />{/key}{/if}
  {/if}
  {#if rehearsal && error}<p class="error" role="alert" tabindex="-1" bind:this={errorElement}>{error}</p>{/if}
  {#if open}
    <div class="project-draft" data-project-draft bind:this={draftElement}>
      {#if rehearsal && view.planningResult}<NebiusInferenceFailure planningResult={view.planningResult} authored />{/if}
      <h2 bind:this={draftHeading} tabindex="-1" data-project-draft-heading>{rehearsal ? reviewed ? 'Review authored draft' : proposal ? 'Edit authored draft' : 'Example brief' : reviewed ? 'Review new project' : proposal ? 'Edit project plan' : 'New project'}</h2>
      {#if !reviewed}
      <details class="plan-source-controls" data-plan-source-controls bind:open={sourceControlsOpen}>
        <summary>{rehearsal ? 'Brief and details' : proposal ? 'Brief and draft options' : 'Choose a starting point'}</summary>
        {#if !rehearsal}<div class="project-starters" data-project-starters>
        <h3>Start with an example</h3>
        <p class="muted">Human-written plans you can edit.</p>
        <div class="starter-actions">{#each PROJECT_STARTERS as starter (starter.id)}<WornButton id={`project-starter-${starter.id}`} data-project-starter={starter.id} onclick={() => loadProjectStarter(starter.id)} disabled={busy}>{starter.label} example</WornButton>{/each}</div>
      </div>
        {#if !proposal}<h3>Or write a brief</h3>{/if}{/if}
        <label for="project-brief">{rehearsal ? 'Fixed authored brief' : 'Project brief'}<textarea id="project-brief" rows="3" value={brief} oninput={editBrief} maxlength={PLAN_LIMITS.brief} readonly={rehearsal} disabled={saving || Boolean(proposal && !starterLabel)} placeholder="Describe the outcome, requirements and constraints."></textarea></label>
        {#if proposal && !rehearsal}<WornButton onclick={changeBrief} disabled={busy}>Change brief</WornButton>{/if}
        {#if !proposal && !rehearsal}<div class="actions"><WornButton onclick={outlineManually} disabled={busy || !brief.trim()}>Write plan myself</WornButton></div>{/if}
        {#if !rehearsal}
        <details class="nebius-generation" data-plan-nebius-options><summary>{view.phase === 'unavailable' || (view.phase === 'error' && !view.config) ? 'Draft with Nebius · unavailable' : 'Draft with Nebius'}</summary>
          <p class="muted">Nebius drafts from your brief, then reviews valid drafts against it. Both calls use Nebius. Nothing is saved automatically.</p>
          <details data-plan-send-preview><summary>Preview brief sent to Nebius</summary><p class="brief-review">{brief || 'Enter a project brief above.'}</p></details>
          {#if view.config}<p class="model-info" data-planning-consent-limits>Draft model: {view.config.requestedModel}<br />Review model: {view.config.groundingModel}<br />Maximum {view.config.maxModelCalls} calls: {view.config.maxOutputTokens.toLocaleString()} draft + {view.config.groundingMaxOutputTokens.toLocaleString()} review = {view.config.maxOutputTokensTotal.toLocaleString()} output tokens total · no automatic retry. Review runs only after a valid draft. Model review is advisory, not independent verification.</p>{/if}
          <label class="consent"><input type="checkbox" bind:checked={consent} disabled={busy} />I agree to send this brief and generated draft to Nebius for drafting and review.</label>
          <div class="actions"><WornButton onclick={generatePlan} disabled={!view.config || !brief.trim() || !consent || busy}>Generate plan with Nebius</WornButton><WornButton onclick={() => client.reload()} disabled={busy || view.phase === 'loading'}>Check model settings</WornButton></div>
          {#if view.phase === 'generating'}<WornButton onclick={() => client.cancel()}>Cancel generation</WornButton>{/if}
          {#if view.phase === 'loading' || view.phase === 'generating'}<p role="status">{view.phase === 'loading' ? 'Loading model settings…' : 'Drafting and reviewing an unsaved plan…'}</p>{/if}
          {#if view.error}<p class="muted" role="status">{view.error}</p>{/if}
          <NebiusInferenceFailure failure={view.failure} planningResult={view.planningResult} />
        </details>
        {/if}
      </details>
        {#if proposal}
          <div data-plan-editor oninput={markModelEdit} onchange={markModelEdit}>
          <p class="provenance" data-project-provenance>{rehearsal ? 'Temporary draft' : starterLabel ? `Human-written ${starterLabel.toLowerCase()} example · unsaved` : source === 'manual' ? 'Manual plan · unsaved' : 'Nebius draft · unsaved'}</p>
          {#if source === 'nebius'}<p class="muted" data-model-review-coverage>{rehearsal ? modelDraftEdited ? 'Your edits are not covered by the authored assessment.' : 'The authored assessment covers the original draft.' : modelDraftEdited ? 'Your edits have not been model reviewed.' : 'The advisory model review covers the original generated draft.'}</p>{/if}
          {#if view.usage && source === 'nebius' && !rehearsal}<p class="muted">{view.usage.input_tokens} input tokens · {view.usage.output_tokens} output tokens</p>{/if}
          <label for="project-title">Project title<input id="project-title" bind:value={proposal.title} maxlength={PLAN_LIMITS.title} disabled={busy} /></label>
          <label for="project-summary">Project summary<textarea id="project-summary" bind:value={proposal.summary} maxlength={PLAN_LIMITS.summary} rows="2" disabled={busy}></textarea></label>
          {#if source === 'manual' && !starterLabel && brief.length > PLAN_LIMITS.summary}<p class="muted">Summary starts with the first {PLAN_LIMITS.summary} characters of your brief. Edit it as needed; the full brief is kept.</p>{/if}
          {#key proposal}
          {#each proposal.tasks as task, index (task.id)}
            <details class="task-panel" data-plan-task-panel={task.id} use:initializeTaskPanel={index === 0 || !task.title.trim()}>
              <summary><span class="task-panel-title">Task {index + 1} · {task.title || 'Untitled task'}</span><span class="task-panel-context">{task.nextStep || 'Next step needed'} · Predecessor: {proposal.tasks.find(candidate => candidate.id === task.dependsOn)?.title || 'None'}</span></summary>
            <fieldset data-plan-task disabled={busy}><legend class:visually-hidden={rehearsal}>Task {index + 1}</legend>
              <label for={`task-title-${task.id}`}>Task title<input id={`task-title-${task.id}`} bind:value={task.title} maxlength={PLAN_LIMITS.taskTitle} /></label>
              <label for={`task-purpose-${task.id}`}>Why it matters<textarea id={`task-purpose-${task.id}`} bind:value={task.purpose} maxlength={PLAN_LIMITS.purpose} rows="2"></textarea></label>
              <label for={`task-next-${task.id}`}>Next step<input id={`task-next-${task.id}`} bind:value={task.nextStep} maxlength={PLAN_LIMITS.nextStep} /></label>
              <label for={`task-done-${task.id}`}>Completion criteria<textarea id={`task-done-${task.id}`} bind:value={task.doneWhen} maxlength={PLAN_LIMITS.doneWhen} rows="2"></textarea></label>
              {#if task.executionInputs != null}<p class="muted">Tool inputs: {task.executionInputs.length ? task.executionInputs.map(input => `${input.id}: ${input.format === 'json' ? 'JSON' : 'text'}`).join(', ') : 'No text inputs'}. You can edit these requirements in the Task Tool panel after creating the task.</p>{/if}
              {#if task.executionOutputs != null}<p class="muted">Required outputs: {task.executionOutputs.length ? task.executionOutputs.map(output => `${output.id}: ${output.format === 'timeline' ? 'timeline' : 'plain text'}`).join(', ') : 'No minimum outputs'}. Additional status outputs are allowed. You can edit these requirements after creating the task.</p>{/if}
              <div class="task-predecessor"><label for={`task-dependency-${task.id}`}>Predecessor</label><select id={`task-dependency-${task.id}`} value={task.dependsOn ?? ''} onchange={event => { task.dependsOn = event.currentTarget.value || null; }}><option value="">None — ready to start</option>{#each proposal.tasks.filter(candidate => candidate.id !== task.id) as candidate (candidate.id)}<option value={candidate.id}>{candidate.title || candidate.id}</option>{/each}</select></div>
              <WornButton onclick={() => removeTask(task.id)} disabled={proposal.tasks.length <= 1 || busy}>Remove task {index + 1}</WornButton>
            </fieldset>
            </details>
          {/each}
          {/key}
          <div class="actions"><WornButton data-plan-add-task onclick={addTask} disabled={busy || proposal.tasks.length >= PLAN_LIMITS.tasks}>Add task</WornButton><span class="muted">{proposal.tasks.length} of {PLAN_LIMITS.tasks} tasks maximum</span></div>
          {#if proposal.missingInformation.length}<div class="missing"><h3>Questions to resolve</h3><ul>{#each proposal.missingInformation as item}<li>{item}</li>{/each}</ul></div>{/if}
          <WornButton variant="primary" onclick={reviewPlan} disabled={busy}>{rehearsal ? 'Review draft' : 'Review plan'}</WornButton>
          </div>
        {/if}
      {:else}
        <h3>{reviewed.title}</h3><p>{reviewed.summary}</p><p class="provenance" data-project-provenance>{rehearsal ? 'Temporary draft' : starterLabel ? `Human-written ${starterLabel.toLowerCase()} example` : source === 'manual' ? 'Human-created plan' : 'Nebius proposal'} · {taskCount(reviewed.tasks.length)}{rehearsal ? '' : ' to create'}</p>
        {#if source === 'nebius'}<p class="muted" data-model-review-coverage>{rehearsal ? modelDraftEdited ? 'Your edits are not covered by the authored assessment.' : 'The authored assessment covers the original draft.' : modelDraftEdited ? 'Your edits have not been model reviewed.' : 'The advisory model review covers the original generated draft.'}</p>{/if}
        <details><summary>Review project brief</summary><p class="brief-review">{brief}</p></details>
        <ol class="review-list">{#each reviewed.tasks as task (task.id)}<li><strong>{task.title}</strong><p>{task.purpose}</p><dl><dt>Next step</dt><dd>{task.nextStep}</dd><dt>Completion criteria</dt><dd>{task.doneWhen}</dd>{#if task.executionInputs != null}<dt>Tool inputs</dt><dd>{task.executionInputs.length ? task.executionInputs.map(input => `${input.id}: ${input.format === 'json' ? 'JSON' : 'text'}`).join(', ') : 'No text inputs'}</dd>{/if}{#if task.executionOutputs != null}<dt>Required outputs</dt><dd>{task.executionOutputs.length ? task.executionOutputs.map(output => `${output.id}: ${output.format === 'timeline' ? 'timeline' : 'plain text'}`).join(', ') : 'No minimum outputs'}</dd>{/if}<dt>Predecessor</dt><dd>{reviewed.tasks.find(candidate => candidate.id === task.dependsOn)?.title ?? 'None — ready to start'}</dd></dl></li>{/each}</ol>
        {#if reviewed.missingInformation.length}<h3>Questions to resolve</h3><ul>{#each reviewed.missingInformation as item}<li>{item}</li>{/each}</ul>{/if}
        {#if !rehearsal}<p class="muted">Creates the project and tasks together. Tasks with a predecessor start blocked.</p>{/if}
        <div class="actions"><WornButton onclick={backToEditing} disabled={saving}>Back to editing</WornButton><WornButton variant="primary" onclick={approve} disabled={saving || rehearsal}>{rehearsal ? 'Saving disabled' : saving ? 'Creating…' : 'Create project'}</WornButton></div>
      {/if}
      <div class="draft-footer"><span class="muted">{rehearsal ? 'Temporary example' : reviewed ? 'Not created yet' : 'Unsaved draft'}</span><WornButton onclick={discard} disabled={busy}>{rehearsal ? 'Reset example' : 'Discard draft'}</WornButton></div>
    </div>
  {/if}
</section>

<style>
  .task-predecessor { display: grid; gap: 8px; min-width: 0; margin-block: 16px 12px; }
  .task-predecessor > label { margin: 0; }
  .task-panel:last-of-type { padding-block-end: 0; }
  .project-workspace .project-draft :global(button) { min-height: 44px; min-block-size: 44px; }
  .rehearsal .task-panel[open] .task-panel-context{display:none}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
  .rehearsal-notice{display:grid;gap:.5rem;border:2px solid var(--worn-border-strong);border-radius:var(--worn-radius-sm);padding:1rem;margin-block:.5rem 1rem;overflow-wrap:anywhere}.rehearsal-notice p{line-height:1.5}
  .rehearsal-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:.75rem}.rehearsal-actions label{margin:0}.rehearsal-actions :global(button){max-width:100%;white-space:normal}
  @media(max-width:500px){.rehearsal-actions{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
  .project-workspace{border:1px solid var(--worn-border);border-radius:var(--worn-radius);padding:1rem;margin-block:0 1rem;background:var(--worn-surface);min-width:0}
  .project-heading,.actions,.draft-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem}
  .actions{margin-block:.5rem}
  .plan-source-controls,.task-panel{border-block-start:1px solid var(--worn-border);padding-block:.75rem;margin-block:.75rem;min-width:0}.task-panel summary{overflow-wrap:anywhere}.task-panel-title{font-weight:700}.task-panel-context{display:block;font-weight:400;font-size:.8rem;color:var(--worn-text-secondary);margin-top:.35rem}.task-panel fieldset{border:0;padding:0;margin-block:.5rem 0}.error:focus{outline:2px solid var(--worn-focus);outline-offset:3px}
  .project-starters{border-block-start:1px solid var(--worn-border);padding-block:.75rem;margin-block:.5rem .75rem;min-width:0}.project-starters h3{margin-block:0 .4rem}.starter-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-block-start:.5rem}.starter-actions :global(button){max-width:100%;white-space:normal;overflow-wrap:anywhere}
  .model-info{font-size:.8rem;color:var(--worn-text-secondary);overflow-wrap:anywhere;line-height:1.5}.plan-source-controls>h3{margin-block:.75rem .4rem}.nebius-generation{border-block-start:1px solid var(--worn-border);padding-block:.75rem}
  .project-heading label{flex:1;max-width:32rem;margin-block:0}.project-workspace h2{font-size:1.15rem;margin-block:.65rem .35rem}.project-workspace h3{font-size:1rem}
  .project-summary{margin-block:.35rem .5rem;overflow-wrap:anywhere}.project-details{margin-top:.5rem}.project-details>summary{font-size:.85rem;overflow-wrap:anywhere}.details-label{font-weight:400;color:var(--worn-text-secondary);margin-inline-start:.75rem}
  .completion-summary{font-size:.875rem;font-weight:600;margin-block:.75rem .5rem}.completion-progress{margin-block:.5rem .75rem}.project-workspace :global(.worn-metric-grid){margin-block:1rem}
  label{display:grid;gap:.35rem;font-size:.875rem;font-weight:600;min-width:0;margin-block:.7rem}input:not([type=checkbox]),textarea,select{box-sizing:border-box;width:100%;min-width:0;font:inherit;color:var(--worn-text);background:var(--worn-bg);border:1px solid var(--worn-field-border);border-radius:var(--worn-radius-sm);padding:.65rem;min-height:44px}textarea{resize:vertical}input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--worn-focus);outline-offset:2px}
  .overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.75rem;margin-block:1rem}.overview div{display:grid;gap:.25rem;padding-block:.5rem}.overview strong{font-size:1.3rem}.overview span{font-weight:600;font-size:.875rem}.overview small,.muted,.scope-note{color:var(--worn-text-secondary);font-size:.8rem}.scope-note{margin-block:.65rem}.next-work{display:flex;gap:1rem;flex-wrap:wrap}.next-work a{overflow-wrap:anywhere}.project-draft{border-top:1px solid var(--worn-border);margin-top:1rem}.nebius-generation{margin-block:1rem}.consent{display:flex;align-items:center;font-weight:400}.consent input{width:1.2rem;height:1.2rem}summary{cursor:pointer;font-weight:600;padding-block:.5rem}.provenance{font-size:.85rem;border:1px solid var(--worn-border);padding:.5rem}.error{color:var(--worn-danger-text);overflow-wrap:anywhere}fieldset{margin-block:1rem;border:1px solid var(--worn-border);border-radius:var(--worn-radius-sm);min-width:0;padding:.75rem}legend{font-weight:700}.draft-footer{border-top:1px solid var(--worn-border);padding-top:.75rem;margin-top:1rem}.review-list{padding-left:1.3rem}.review-list li{padding-block:.5rem;overflow-wrap:anywhere}dt{font-weight:600;font-size:.85rem}dd{margin:0 0 .6rem;white-space:pre-wrap;font-size:.85rem}.brief-review{white-space:pre-wrap;overflow-wrap:anywhere}
  @media(max-width:500px){.project-workspace{padding:.75rem}.overview{gap:.5rem}.overview small{font-size:.7rem}.project-heading{align-items:flex-end}.project-heading label{flex-basis:100%}.actions{justify-content:flex-start}}
</style>
