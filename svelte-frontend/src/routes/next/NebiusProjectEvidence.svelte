<script lang="ts">
  import { workTitle, type DemoPack } from '$lib/demo-workflow';

  let { pack, packs }: { pack: DemoPack; packs: readonly DemoPack[] } = $props();
  let expandedPackId = $state<string | null>(null);
  let references = $derived(pack.projectId?.trim() ? packs.filter((source) =>
    source.id !== pack.id && source.projectId === pack.projectId && source.status === 'done'
    && Boolean(source.completionEvidence?.trim())
  ) : []);
</script>

{#if references.length}
  {#key pack.id}
    <details class="project-evidence" data-project-evidence ontoggle={(event) => { expandedPackId = event.currentTarget.open ? pack.id : null; }}>
      <summary>Other completed work in this project ({references.length})</summary>
      {#if expandedPackId === pack.id}
        <div class="reference-content">
          <p class="reference-note">Reference only. These saved notes belong to other tasks and do not become this task’s own evidence.</p>
          <ul>
            {#each references as source (source.id)}
              <li data-project-evidence-task={source.id}>
                <div class="source-heading">
                  <h3>{workTitle(source)}</h3>
                  <span class="source-status">Done{source.archived ? ' · Archived' : ''}</span>
                </div>
                <p class="saved-evidence">{source.completionEvidence}</p>
                <a href={`/next?pack=${encodeURIComponent(source.id)}&view=review`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${workTitle(source)} in Task Review (opens in a new tab)`}>Task Review <span>(opens in a new tab)</span></a>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </details>
  {/key}
{/if}

<style>
  .project-evidence {
    border: 1px solid var(--worn-border);
    border-radius: var(--worn-radius);
    color: var(--worn-text);
    font-family: system-ui, sans-serif;
    margin-block: 8px;
    min-inline-size: 0;
    overflow-wrap: anywhere;
    padding-inline: 12px;
  }
  summary { box-sizing: border-box; cursor: pointer; font-weight: 650; line-height: 1.5; min-block-size: 44px; padding-block: 11px; }
  summary:focus-visible, a:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; border-radius: 2px; }
  .reference-content { min-inline-size: 0; padding-block: 0 8px; }
  p, h3 { margin: 0; }
  .reference-note, .source-status { color: var(--worn-text-secondary); font-size: .875rem; line-height: 1.5; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { border-block-start: 1px solid var(--worn-border); margin-block-start: 12px; min-inline-size: 0; padding-block-start: 12px; }
  .source-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; min-inline-size: 0; }
  h3 { font-size: 1rem; line-height: 1.5; min-inline-size: 0; }
  .saved-evidence { line-height: 1.55; margin-block: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  a { box-sizing: border-box; color: var(--worn-link); display: inline-block; line-height: 1.5; min-block-size: 44px; padding-block: 10px; text-underline-offset: 3px; }
  a span { font-size: .875rem; }
</style>
