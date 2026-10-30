<script lang="ts">
  import type { NebiusFailureDetails } from './nebius-contract.mjs';
  import type { PlanningResult } from './nebius-plan-contract.mjs';
  let { failure = null, planningResult = null, authored = false }: { failure?: NebiusFailureDetails | null; planningResult?: PlanningResult | null; authored?: boolean } = $props();
</script>

{#if planningResult}
  <details class="inference-failure" data-nebius-failure data-planning-trace>
    <summary>{authored ? 'Example trace' : 'Planning request details'}</summary>
    {#if authored}
      <p>Illustrative data; no requests were made.</p>
      {#if planningResult.groundingReview?.findings.length}
        <div class="example-findings">{#each planningResult.groundingReview.findings as finding}
          <p>{finding.reason}</p>
          {#if finding.planQuote}<blockquote><strong>Draft:</strong> {finding.planQuote}</blockquote>{/if}
          {#if finding.briefQuote}<blockquote><strong>Brief:</strong> {finding.briefQuote}</blockquote>{/if}
        {/each}</div>
      {/if}
      <dl class="example-stages">{#each planningResult.planningTrace.stages as stage (stage.stage)}
        <div><dt>{stage.stage === 'plan' ? 'Draft' : 'Review'}</dt><dd>{stage.outcome.replaceAll('_', ' ')} · {stage.usageKnown && stage.usage ? `${stage.usage.input_tokens} input / ${stage.usage.output_tokens} output tokens` : 'usage unknown'}</dd></div>
      {/each}</dl>
      <details><summary>Full example data</summary><pre>{JSON.stringify(planningResult, null, 2)}</pre></details>
    {:else}
    <p>{planningResult.planningTrace.providerAttempts} of 2 provider calls attempted · {planningResult.planningTrace.budgetReservations} budget {planningResult.planningTrace.budgetReservations === 1 ? 'reservation' : 'reservations'} · {planningResult.planningTrace.unknownReservations} unknown {planningResult.planningTrace.unknownReservations === 1 ? 'reservation' : 'reservations'}.</p>
    <p>Known usage: {planningResult.planningTrace.knownInputTokens} input tokens and {planningResult.planningTrace.knownOutputTokens} output tokens across {planningResult.planningTrace.knownUsageCalls} {planningResult.planningTrace.knownUsageCalls === 1 ? 'call' : 'calls'}. Unknown usage: {planningResult.planningTrace.unknownUsageCalls} {planningResult.planningTrace.unknownUsageCalls === 1 ? 'call' : 'calls'}.</p>
    <ul>{#each planningResult.planningTrace.stages as stage (stage.stage)}
      <li><strong>{stage.stage}</strong>: reservation {stage.reservation}; provider {stage.providerAttempted ? 'attempted' : 'not attempted'}; outcome {stage.outcome}.<br />Model: {stage.model}. {stage.usageKnown && stage.usage ? `${stage.usage.input_tokens} input / ${stage.usage.output_tokens} output tokens` : stage.providerAttempted ? 'Token usage unknown; this call may have consumed credits.' : 'No provider call attempted; no token usage reported.'}</li>
    {/each}</ul>
    <p>Request: {planningResult.requestId}<br />Brief SHA-256: {planningResult.briefDigest}<br />Generated draft SHA-256: {planningResult.candidateDigest ?? 'No valid draft'}</p>
    {#if planningResult.groundingReview}
      <p>Advisory model review: {planningResult.groundingReview.assessment}. This is not independent verification.</p>
      {#if planningResult.groundingReview.findings.length}<ul>{#each planningResult.groundingReview.findings as finding}<li>{finding.category} · {finding.planPath}<br />Plan quote: {finding.planQuote || '(none)'}<br />Brief quote: {finding.briefQuote || '(none)'}<br />{finding.reason}</li>{/each}</ul>{/if}
    {/if}
    <p>No task changes were saved by this request.</p>
    {/if}
  </details>
  {#if planningResult.diagnosticCandidate}
    <details class="inference-failure" data-planning-diagnostic>
      <summary>{authored ? 'Draft · read only' : 'Rejected draft evidence · read only'}</summary>
      {#if !authored}<p>This rejected draft is evidence only. It has no approval or save action.</p>{/if}
      <pre>{JSON.stringify(authored ? planningResult.diagnosticCandidate.plan : planningResult.diagnosticCandidate, null, 2)}</pre>
    </details>
  {/if}
{:else if failure}
  <details class="inference-failure" data-nebius-failure>
    <summary>Request details</summary>
    {#if failure.diagnostic}<p>{failure.diagnostic}</p>{/if}
    {#if failure.usage}
      <p>Provider reported {failure.usage.input_tokens} input tokens and {failure.usage.output_tokens} output tokens.</p>
    {:else}
      <p>Provider token usage was not reported. This request may still have consumed credits.</p>
    {/if}
    <p>No task changes were saved by this request.</p>
  </details>
{/if}

<style>
  details{margin-block:.75rem;border:1px solid var(--worn-border);border-radius:var(--worn-radius-sm);padding:.5rem .75rem;min-width:0}
  summary{min-height:44px;align-content:center;font-weight:600;cursor:pointer;overflow-wrap:anywhere}
  summary:focus-visible{outline:2px solid var(--worn-focus);outline-offset:3px}
  p{margin-block:.65rem 0;overflow-wrap:anywhere}
  .example-stages{margin-block:.65rem}.example-stages div+div{margin-top:.6rem}.example-stages dt{font-weight:600}.example-stages dd{margin:0;line-height:1.5;overflow-wrap:anywhere}.example-findings blockquote{margin:.5rem 0;padding-left:.6rem;border-left:1px solid var(--worn-border);overflow-wrap:anywhere;line-height:1.5}
  li{margin-block:.65rem;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;max-width:100%}
</style>
