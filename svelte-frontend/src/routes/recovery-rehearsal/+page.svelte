<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { demoState, demoStateError, demoStateLoading, refreshDemoState } from '$lib/demo-client';
  import { workTitle } from '$lib/demo-workflow';
  import { WornPage, WornButton, WornAlert } from '$lib/components';
  const previewUrl = '/api/nebius/examples/recovery-simulator';
  let frame: HTMLIFrameElement | null = $state(null);
  let frameKey = $state(0);
  let failed = $state(false);
  let mounted = $state(false);
  let requested = $derived(mounted ? $page.url.searchParams.getAll('pack') : []);
  let validRequest = $derived(requested.length === 1 && requested[0].length > 0 && requested[0].length <= 200 && !/[\u0000-\u001f\u007f]/u.test(requested[0]));
  let task = $derived(validRequest ? $demoState?.packs.find(candidate => candidate.id === requested[0]) ?? null : null);
  let project = $derived(task?.projectId ? $demoState?.projects?.find(candidate => candidate.id === task.projectId) ?? null : null);
  let taskUrl = $derived(task ? `/next?pack=${encodeURIComponent(task.id)}` : '');
  let contextLoading = $derived(Boolean(validRequest && !task && (!$demoState || $demoStateLoading) && !$demoStateError));
  onMount(() => {
    mounted = true;
    const refreshContext = () => { if (requested.length) void refreshDemoState(); };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow || event.origin !== 'null') return;
      const value = event.data;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'status,type') return;
      if (value.type === 'nebius-tool-preview' && value.status === 'failed') failed = true;
    };
    window.addEventListener('message', receive);
    window.addEventListener('focus', refreshContext);
    return () => { window.removeEventListener('message', receive); window.removeEventListener('focus', refreshContext); };
  });
</script>

<svelte:head><title>Recovery Simulator · Wornpage Projects</title></svelte:head>
<WornPage sectionLabel="Project planning" title="Recovery Simulator" variant="list">
  {#snippet headActions()}
    {#if task}<WornButton href={`${taskUrl}&view=tool`}>Back to Task</WornButton>{:else}<WornButton href="/work">Back to Work</WornButton>{/if}
  {/snippet}
  {#if __NEBIUS_EDITION__}
    <p class="intro">Compare recovery options, then record your observations in Review.</p>
    <p class="provenance" data-recovery-provenance>Authored offline reference · calculations run in this browser.</p>
    {#if task}
      <section class="task-context" aria-label="Task context" data-recovery-task-context>
        {#if project}
          <a href={`/work?focus=${encodeURIComponent(task.id)}`} class="project-link">{project.title}</a>
          <p class="project-goal">{project.summary}</p>
        {/if}
        <h2>{workTitle(task)}</h2>
        <details><summary>Current task requirements</summary>
          <dl><dt>Purpose</dt><dd>{task.purpose || 'No purpose recorded.'}</dd><dt>Completion criteria</dt><dd>{task.doneWhen || 'No completion criteria recorded.'}</dd></dl>
        </details>
        <p>Fixed five-task reference. Its inputs stay separate from your Brief; set the target and assumptions here before recording results in Review.</p>
        <WornButton href={`${taskUrl}&view=review`}>Review this task</WornButton>
      </section>
    {:else if contextLoading}<p role="status">Loading task context…</p>
    {:else if requested.length}<WornAlert tone="warning">Task context is unavailable. Return to Work to choose a saved task; this example will stay separate.</WornAlert>{/if}
    <div class="actions">
      <WornButton onclick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}>Open larger view</WornButton>
      <WornButton onclick={() => { window.location.href = `${previewUrl}/download`; }}>Download simulator</WornButton>
    </div>
    <p class="provenance">Larger view and download contain the standalone example.</p>
    {#if failed}
      <WornAlert tone="warning">The preview stopped. Reload it to start again.</WornAlert>
      <WornButton onclick={() => { failed = false; frameKey += 1; }}>Reload preview</WornButton>
    {/if}
    <div class="tool-frame">
      {#if mounted}{#key frameKey}<iframe bind:this={frame} title="Recovery Simulator" src={previewUrl} sandbox="allow-scripts"></iframe>{/key}{/if}
    </div>
    {#if task}<div class="actions"><WornButton href={`${taskUrl}&view=review`}>Return to task review</WornButton></div>{/if}
    <details class="source-history"><summary>About this offline reference</summary><p>Authored reference based on a retained Nemotron attempt that failed its checks. Later fixes run locally; this view carries no successful build or Sandbox receipt.</p></details>
  {:else}
    <p>The recovery simulator belongs to the Nebius edition.</p>
  {/if}
</WornPage>

<style>
  .intro { margin: .25rem 0 .75rem; font-size: 1.1rem; }
  .actions { display: flex; flex-wrap: wrap; gap: .5rem; margin: .5rem 0; }
  .provenance { color: var(--worn-text-muted); font-size: .9rem; margin: .6rem 0 1rem; }
  .task-context { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; margin-block: 24px; min-width: 0; max-width: 75ch; }
  .task-context h2, .task-context p { margin: 0; overflow-wrap: anywhere; }
  .task-context h2 { font-size: 1.15rem; }
  .task-context p, .task-context dd, .source-history p { font-size: .9rem; line-height: 1.6; }
  .project-link { color: var(--worn-link); font-weight: 650; min-height: 44px; min-width: 0; overflow-wrap: anywhere; align-content: center; text-underline-offset: 3px; }
  .project-goal { color: var(--worn-text-secondary); }
  .task-context :global(.worn-btn) { justify-self: start; min-height: 44px; }
  .task-context summary, .source-history summary { align-content: center; cursor: pointer; min-height: 44px; font-weight: 650; }
  .task-context dl { margin: 8px 0; }
  .task-context dt { font-size: .8125rem; font-weight: 650; color: var(--worn-text-secondary); margin-block: 8px 4px; }
  .task-context dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .source-history { margin-block: 24px; max-width: 75ch; }
  .task-context summary:focus-visible, .source-history summary:focus-visible, .project-link:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
  .intro, .actions, .provenance, .task-context, .source-history { margin-inline: clamp(16px, 2vw, 24px); }
  :global(.demo-panel.demo-list-panel:has(.tool-frame) .demo-panel-head) { padding-inline: clamp(16px, 2vw, 24px); }
  .tool-frame { min-width: 0; overflow: hidden; border: 1px solid var(--worn-border, #bccbbf); border-radius: 12px; background: #f6f4ee; }
  iframe { display: block; border: 0; width: 100%; height: min(1100px, 82vh); min-height: 640px; }
  @media (max-width: 520px) { iframe { min-height: 740px; } }
</style>
