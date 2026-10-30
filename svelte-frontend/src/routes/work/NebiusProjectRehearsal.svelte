<script lang="ts">
  import {
    REHEARSAL_EXAMPLE, captureRehearsal, previewRehearsal,
    type RehearsalTask, type RehearsalPreview
  } from '$lib/nebius-project-rehearsal.mjs';

  let { project, tasks }: {
    project: { id: string; title: string; summary: string } | null;
    tasks: Parameters<typeof captureRehearsal>[1];
  } = $props();

  const uid = $props.id();
  const exampleTarget = REHEARSAL_EXAMPLE.tasks.find(task => task.status === 'active' && !task.archived)?.id ?? '';
  let opened = $state(false);
  let sourcePreference = $state<'project' | 'example' | null>(null);
  let title = $state('Add CSV export');
  let targetId = $state('');
  let preview = $state<RehearsalPreview | null>(null);
  let previewTitle = $state('');
  let previewTarget = $state('');
  let notice = $state('');
  let error = $state('');
  let requirementInput = $state<HTMLInputElement | null>(null);
  let observedSource = '';

  let source = $derived(project && sourcePreference !== 'example' ? 'project' : 'example');
  let current = $derived(opened ? captureRehearsal(
    source === 'project' ? project : REHEARSAL_EXAMPLE.project,
    source === 'project' ? tasks : REHEARSAL_EXAMPLE.tasks
  ) : null);
  let snapshot = $derived(current?.ok ? current.snapshot : null);
  let sourceKey = $derived(`${source}:${snapshot?.signature ?? (current && !current.ok ? current.error : '')}`);
  // Gate rendering as well as clearing state: changed input can never show an old comparison.
  let visiblePreview = $derived(snapshot && preview?.sourceSignature === snapshot.signature &&
    title === previewTitle && targetId === previewTarget ? preview : null);
  let eligible = $derived(snapshot?.tasks.filter(task => !task.archived && task.status !== 'done') ?? []);

  $effect(() => {
    const key = opened ? sourceKey : '';
    if (key !== observedSource) {
      const hadSource = Boolean(observedSource);
      observedSource = key;
      preview = null;
      error = '';
      targetId = source === 'example' ? exampleTarget : '';
      notice = opened && hadSource ? 'Source changed. Preview cleared; review the current tasks before comparing again.' : '';
    }
  });

  function invalidate(message: string) {
    if (preview) notice = message;
    preview = null;
    error = '';
  }
  function changeTitle(event: Event) {
    title = (event.currentTarget as HTMLInputElement).value;
    invalidate('Requirement changed. Preview cleared.');
  }
  function changeTarget(event: Event) {
    targetId = (event.currentTarget as HTMLSelectElement).value;
    invalidate('Waiting task changed. Preview cleared.');
  }
  function compare() {
    if (!snapshot) return;
    const result = previewRehearsal(snapshot, { title, targetId });
    if (!result.ok) { preview = null; error = result.error; notice = ''; return; }
    previewTitle = title;
    previewTarget = targetId;
    preview = result.preview;
    error = '';
    notice = 'Preview ready. One temporary draft added; nothing saved.';
  }
  function reset() {
    // Transfer keyboard focus before the Reset button becomes disabled.
    requirementInput?.focus();
    preview = null;
    error = '';
    notice = 'Preview reset. Nothing saved.';
  }
  function predecessor(task: RehearsalTask, list: readonly RehearsalTask[]) {
    const index = list.findIndex(item => item.id === task.blockedBy);
    return index >= 0 ? `Task ${index + 1}: ${list[index].title}` : task.blockedBy;
  }
  function shortTitle(value: string) {
    return value.length > 31 ? `${value.slice(0, 30)}…` : value;
  }
</script>

{#snippet dependencySketch(list: readonly RehearsalTask[])}
  {@const visible = list.slice(0, 6)}
  <div class="sketch" aria-hidden="true">
    <svg viewBox={`0 0 430 ${visible.length * 42 + 12}`} focusable="false">
      {#each visible as task, index (task.id)}
        {@const previous = visible.findIndex(item => item.id === task.blockedBy)}
        {#if previous >= 0}
          <path class="dependency" d={`M 22 ${previous * 42 + 25} H 6 V ${index * 42 + 25} H 16`} />
          <path class="dependency" d={`M 12 ${index * 42 + 21} L 16 ${index * 42 + 25} L 12 ${index * 42 + 29}`} />
        {/if}
        <circle class:changed={task.change !== 'unchanged'} class:done={task.status === 'done'} cx="27" cy={index * 42 + 25} r="12" />
        <text class="node-number" x="27" y={index * 42 + 29} text-anchor="middle">{index + 1}</text>
        <text class="node-title" x="51" y={index * 42 + 29}>{shortTitle(task.title)}</text>
        {#if task.change !== 'unchanged'}<path class="change-mark" d={`M 417 ${index * 42 + 18} v 14 M 410 ${index * 42 + 25} h 14`} />{/if}
      {/each}
    </svg>
  </div>
  {#if list.length > 6}<p class="sketch-note">Sketch shows the first 6 tasks. The ordered list below includes all {list.length}.</p>{/if}
{/snippet}

{#snippet taskList(list: readonly RehearsalTask[], column: string)}
  <ol class="task-list" data-rehearsal-list={column} aria-label={`${column === 'current' ? 'Current' : 'Preview'} tasks in project order`}>
    {#each list as task (task.id)}
      <li data-rehearsal-task={task.id} class:task-added={task.change === 'added'} class:task-changed={task.change === 'changed'}>
        <details class="task-detail">
          <summary>
            <span class="task-name">{task.title}</span>
            <span class="task-meta"><span class="change-label">{task.change === 'added' ? 'Added' : task.change === 'changed' ? 'Changed' : 'Unchanged'}</span><span class="status-label">{task.status}</span>{#if task.archived}<span>Archived</span>{/if}</span>
          </summary>
          <div class="task-context">
            <p>{#if task.blockedBy}<strong>Depends on:</strong> {predecessor(task, list)}{:else}No predecessor.{/if}</p>
            {#if task.blocker}<p class="blocker"><strong>Saved blocker note:</strong> {task.blocker}</p>{/if}
            {#if task.hasSavedRun}<p>Saved run attached · attachment only.</p>{/if}
            {#if task.change === 'added'}
              <p>Temporary draft · no saved task or run.</p>
            {:else if source === 'project'}
              <a href={`/next?pack=${encodeURIComponent(task.id)}&view=brief`}>Open saved task<span class="visually-hidden">: {task.title}</span><span aria-hidden="true"> ↗</span></a>
            {/if}
          </div>
        </details>
      </li>
    {/each}
  </ol>
{/snippet}

<details class="project-rehearsal" data-project-rehearsal bind:open={opened}>
  <summary class="rehearsal-summary"><span>Project rehearsal</span><span class="summary-note">Try a requirement before changing a plan</span></summary>
  {#if opened}
    <div class="rehearsal-body">
      <header class="intro">
        <p class="eyebrow">Temporary prototype</p>
        <h2>What would one new requirement change?</h2>
        <p>Compare a temporary draft with the current task order. Nothing is saved.</p>
      </header>
      <div class="source-row">
        <div class="field"><label for={`${uid}-source`}>Compare</label>
          <select id={`${uid}-source`} data-rehearsal-source value={source} onchange={event => { sourcePreference = event.currentTarget.value as 'project' | 'example'; invalidate('Source changed. Preview cleared.'); }}>
            <option value="project" disabled={!project}>Current project{!project ? ' · select a project first' : ''}</option>
            <option value="example">Authored offline example</option>
          </select>
        </div>
        <div class="source-context">
          <p class="eyebrow">{source === 'example' ? 'Authored offline example' : 'Selected project'}</p>
          <h3>{source === 'example' ? REHEARSAL_EXAMPLE.project.title : project?.title}</h3>
          {#if snapshot?.project.goal}<p>{snapshot.project.goal}</p>{/if}
          {#if !project}<p class="muted">Select a project in Work to rehearse its saved tasks.</p>{/if}
        </div>
      </div>
      {#if current && !current.ok}
        <p class="error" role="alert">This source cannot be rehearsed: {current.error} Choose the authored offline example to explore a comparison.</p>
      {/if}
      {#if snapshot}
        <form class="requirement-form" onsubmit={event => { event.preventDefault(); compare(); }}>
          <div class="field"><label for={`${uid}-requirement`}>New requirement</label>
            <input id={`${uid}-requirement`} bind:this={requirementInput} value={title} oninput={changeTitle} maxlength="160" required />
          </div>
          <div class="field"><label for={`${uid}-target`}>Task that will wait</label>
            <select id={`${uid}-target`} value={targetId} onchange={changeTarget} required disabled={!eligible.length}>
              <option value="">Choose a task explicitly</option>
              {#each eligible as task (task.id)}<option value={task.id}>{snapshot.tasks.findIndex(item => item.id === task.id) + 1}. {task.title}</option>{/each}
            </select>
          </div>
          <p class="form-note">The chosen task will wait for the new requirement. The new draft inherits its previous predecessor, if any.</p>
          {#if !eligible.length}<p class="muted">There are no unfinished, unarchived tasks to place a requirement before.</p>{/if}
          <div class="actions">
            <button type="submit" class="primary" disabled={!title.trim() || !targetId || !eligible.length}>Preview change</button>
            <button type="button" onclick={reset} disabled={!visiblePreview}>Reset preview</button>
          </div>
        </form>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <p class="announcement" role="status" aria-live="polite">{notice}</p>
        <div class="comparison">
          <section class="comparison-column" data-rehearsal-current aria-labelledby={`${uid}-current`}>
            <header class="column-heading"><h3 id={`${uid}-current`}>Current</h3><p class="count" data-rehearsal-count>{snapshot.progress.done} / {snapshot.progress.total} <span>done</span></p><p class="muted">{snapshot.progress.remaining} remaining · {snapshot.progress.archived} archived</p></header>
            {@render dependencySketch(snapshot.tasks)}
            {@render taskList(snapshot.tasks, 'current')}
          </section>
          <section class="comparison-column preview-column" data-rehearsal-preview aria-labelledby={`${uid}-preview`}>
            <header class="column-heading"><h3 id={`${uid}-preview`}>Preview</h3>
              {#if visiblePreview}<p class="count" data-rehearsal-count>{visiblePreview.progress.done} / {visiblePreview.progress.total} <span>done</span></p><p class="muted">{visiblePreview.progress.remaining} remaining · {visiblePreview.progress.archived} archived</p>{:else}<p class="preview-prompt">Awaiting your comparison</p>{/if}
            </header>
            {#if visiblePreview}
              <p class="delta" data-rehearsal-delta>+1 temporary task · total changes from {snapshot.progress.total} to {visiblePreview.progress.total}. Completed tasks stay at {snapshot.progress.done}.</p>
              <p class="dependency-explanation"><strong>{visiblePreview.tasks.find(task => task.id === visiblePreview.changedId)?.title}</strong> now waits for <strong>{visiblePreview.tasks.find(task => task.id === visiblePreview.addedId)?.title}</strong>. {#if visiblePreview.tasks.find(task => task.id === visiblePreview.addedId)?.blockedBy}The new draft waits for {predecessor(visiblePreview.tasks.find(task => task.id === visiblePreview.addedId)!, visiblePreview.tasks)}.{:else}The new draft has no predecessor.{/if}</p>
              {@render dependencySketch(visiblePreview.tasks)}
              {@render taskList(visiblePreview.tasks, 'preview')}
            {:else}
              <div class="empty-preview"><span aria-hidden="true">↳</span><p>Enter a requirement and choose the task that will wait, then preview the change.</p></div>
            {/if}
          </section>
        </div>
        <p class="denominator-note">Both totals include archived tasks. Remaining excludes done and archived tasks. Saved run attachments do not establish verification or readiness.</p>
      {/if}
    </div>
  {/if}
</details>

<style>
  .project-rehearsal{margin-block:1.5rem;padding-inline:1.5rem;background:transparent;color:var(--worn-text);min-width:0;overflow-wrap:anywhere}
  .rehearsal-summary{min-height:56px;box-sizing:border-box;padding:1rem 0;font-weight:700;cursor:pointer}
  .summary-note{font-size:.85rem;font-weight:400;color:var(--worn-text-secondary);margin-inline-start:1rem}
  .rehearsal-body{padding:.75rem 0 1.5rem;min-width:0}
  h2,h3,p{margin:0}h2{font-size:clamp(1.35rem,2vw,1.75rem);line-height:1.25;letter-spacing:-.025em;margin-block:.45rem .6rem}h3{font-size:1rem;line-height:1.5}
  p{line-height:1.55}.intro>p:last-child{color:var(--worn-text-secondary);max-width:65ch}.eyebrow{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--worn-text-secondary)}
  .source-row{display:grid;gap:1.25rem;margin-block:1.5rem 2rem}.source-context{min-width:0}.source-context h3{margin-block:.2rem .35rem}.source-context>p:not(.eyebrow){font-size:.85rem;max-width:70ch}
  .field{display:grid;align-content:start;gap:.5rem;min-width:0}label{font-size:.85rem;font-weight:600;min-width:0}input,select,button{font:inherit;min-height:44px;box-sizing:border-box;border-radius:.65rem;color:var(--worn-text)}input,select{width:100%;min-width:0;padding:.65rem .7rem;border:1px solid var(--worn-field-border);background:var(--worn-bg)}
  .requirement-form{display:grid;gap:1rem;min-width:0}.form-note{font-size:.82rem;color:var(--worn-text-secondary)}.actions{display:flex;flex-wrap:wrap;gap:.6rem}button{padding:.65rem 1rem;border:1px solid var(--worn-border-strong);background:var(--worn-bg);font-size:.85rem;font-weight:600;cursor:pointer;max-width:100%;overflow-wrap:anywhere}button.primary{background:var(--worn-text);color:var(--worn-bg);border-color:var(--worn-text)}button:disabled{opacity:.5;cursor:default}
  :is(input,select,button,summary,a):focus-visible{outline:3px solid var(--worn-focus);outline-offset:3px}.announcement{font-size:.85rem;min-height:1.5em;margin-block:1rem;color:var(--worn-text-secondary)}.error{color:var(--worn-danger-text);margin-block:.75rem}
  .comparison{display:grid;gap:2rem;min-width:0;margin-block-start:1.5rem}.comparison-column{min-width:0}.column-heading h3{font-size:.8rem;letter-spacing:.08em;text-transform:uppercase}.count{font-size:1.8rem;letter-spacing:-.04em;line-height:1.3;margin-block:.5rem .25rem;font-weight:650;font-variant-numeric:tabular-nums}.count span{font-size:.85rem;font-weight:400;letter-spacing:0}.muted,.sketch-note{font-size:.8rem;color:var(--worn-text-secondary)}
  .sketch{margin-block:1rem .5rem;color:var(--worn-text);max-width:430px}.sketch svg{display:block;width:100%;max-height:270px}.dependency{fill:none;stroke:var(--worn-text-secondary);stroke-width:1.25;opacity:.7}.sketch circle{fill:var(--worn-bg);stroke:var(--worn-border-strong);stroke-width:1.5}.sketch circle.done{fill:var(--worn-surface)}.sketch circle.changed{stroke:var(--worn-text);stroke-width:2.5}.node-number{fill:var(--worn-text);font-size:13px;font-weight:600}.node-title{fill:var(--worn-text);font-size:16px}.change-mark{stroke:var(--worn-text);stroke-width:1.5}.sketch-note{margin-block:.5rem}
  .task-list{padding-inline-start:1.6rem;margin-block:.75rem 0}.task-list li{padding-inline-start:.25rem;min-width:0}.task-list li+li{margin-block-start:.25rem}.task-list li::marker{color:var(--worn-text-secondary);font-size:.8rem}.task-detail summary{cursor:pointer;min-height:64px;box-sizing:border-box;padding:.7rem .15rem;line-height:1.4}.task-name{font-weight:600;font-size:.9rem}.task-meta{display:flex;flex-wrap:wrap;gap:.35rem .75rem;padding-block-start:.3rem;font-size:.72rem;color:var(--worn-text-secondary)}.status-label{text-transform:capitalize}.task-added .change-label,.task-changed .change-label{font-weight:700;color:var(--worn-text)}.task-context{padding-block:.1rem .8rem;font-size:.8rem}.task-context p+p{margin-block-start:.4rem}.blocker{white-space:pre-wrap}.task-context a{display:inline-flex;align-items:center;min-height:44px;color:var(--worn-text);text-underline-offset:3px;line-height:1.5;gap:.2rem}.delta{font-size:.82rem;font-weight:600;margin-block:1rem .5rem}.dependency-explanation{font-size:.82rem;color:var(--worn-text-secondary)}
  .preview-prompt{font-size:1rem;color:var(--worn-text-secondary);margin-block:.75rem}.empty-preview{display:flex;gap:.85rem;align-items:flex-start;padding-block:1.5rem;color:var(--worn-text-secondary);max-width:34ch;font-size:.9rem}.empty-preview>span{font-size:1.7rem;line-height:1}.denominator-note{font-size:.76rem;color:var(--worn-text-secondary);margin-block-start:1.5rem;padding-block-start:.8rem;border-block-start:1px solid var(--worn-border);max-width:95ch}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  @media(min-width:650px){.source-row{grid-template-columns:minmax(180px,.8fr) minmax(0,1.5fr)}.requirement-form{grid-template-columns:1fr 1fr}.form-note,.actions{grid-column:1/-1}}
  @media(min-width:900px){.comparison{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2.5rem}}
  @media(max-width:899px){.preview-column{border-block-start:1px solid var(--worn-border);padding-block-start:1.5rem}}
  @media(max-width:649px){.sketch,.sketch-note{display:none}}
  @media(max-width:480px){.project-rehearsal{padding-inline:1rem}.summary-note{display:block;margin-inline-start:1.1rem;margin-block-start:.35rem}.actions button{flex:1 1 auto}.source-row{gap:1rem}}
  @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto;transition:none}}
</style>
