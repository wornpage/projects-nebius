<script lang="ts">
  import { WornPage, WornButton } from '$lib/components';
  import NebiusProjectWorkspace from '../work/NebiusProjectWorkspace.svelte';
</script>

<svelte:head><title>Offline grounding rehearsal · Wornpage Projects</title></svelte:head>
<WornPage sectionLabel="Authored examples · no AI calls" title="Grounding rehearsal" variant="list">
  <div class="rehearsal-nav"><WornButton href="/work">Back to Work</WornButton></div>
  {#if __NEBIUS_EDITION__}
    <NebiusProjectWorkspace rehearsal onApproved={async () => { throw new Error('A rehearsal must never save work.'); }} />
  {:else}
    <p>The offline grounding rehearsal belongs to the Nebius edition.</p>
  {/if}
</WornPage>

<style>.rehearsal-nav{margin-block:.5rem .75rem}</style>
