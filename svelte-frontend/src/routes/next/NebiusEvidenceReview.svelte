<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { packPathSignature, runPackAction, savePackPath } from '$lib/demo-client';
  import { projectTask } from '$lib/nebius-contract.mjs';
  import { isOperationConfig } from '$lib/nebius-routing-contract.mjs';
  import { REVIEW_LIMITS, REVIEW_VERSION, validateReviewInput, validateReviewOutput, type ReviewInput, type ReviewOutput } from '$lib/nebius-review-contract.mjs';
  import type { DemoPack } from '$lib/demo-workflow';
  import { WornAlert, WornButton, WornTextarea } from '$lib/components';

  let { pack, disabled = false, expanded = false, onstate = () => {} }: {
    pack: DemoPack; disabled?: boolean; expanded?: boolean; onstate?: (state: { dirty: boolean; busy: boolean }) => void;
  } = $props();
  const taskKey = (item: DemoPack) => JSON.stringify([item.id, item.title, item.purpose, item.nextStep, item.blocker, item.doneWhen]);
  let scopeKey = $state(untrack(() => taskKey(pack)));
  let criteriaText = $state(untrack(() => pack.doneWhen || ''));
  let evidence = $state(untrack(() => pack.completionEvidence || ''));
  let savedEvidence = $state(untrack(() => pack.completionEvidence || ''));
  let baselineSignature = $state(untrack(() => packPathSignature(pack)));
  let scopeId = $state(untrack(() => pack.id));
  let config = $state<{ requestedModel: string; reviewVersion: string; maxOutputTokens: number } | null>(null);
  let available = $state(false);
  let loadingConfig = $state(true);
  let online = $state(true);
  let pending = $state(false);
  let saving = $state(false);
  let result = $state<ReviewOutput | null>(null);
  let reviewedInput = $state<ReviewInput | null>(null);
  let usage = $state<{ input_tokens: number; output_tokens: number } | null>(null);
  let detailsElement: HTMLDetailsElement | undefined = $state();
  let analysisElement: HTMLDetailsElement | undefined = $state();
  let error = $state('');
  let notice = $state('');
  let generation = 0;
  let active: AbortController | null = null;
  let configController: AbortController | null = null;
  const criteria = (value: string) => value.split(/\r?\n/u).map((text) => text.trim()).filter(Boolean).map((text, index) => ({ id: `c${index + 1}`, text }));
  let selectedCount = $derived(criteria(criteriaText).length);
  let evidenceRecorded = $derived(Boolean(pack.completionEvidence?.trim()) && pack.completionEvidence?.trim() === evidence.trim());
  let dirty = $derived(evidence !== savedEvidence);
  let stale = $derived(dirty && packPathSignature(pack) !== baselineSignature);

  $effect(() => { onstate({ dirty, busy: pending || saving }); });

  function invalidate() {
    generation++; active?.abort(); active = null; pending = false;
    result = null; reviewedInput = null; usage = null; error = ''; notice = '';
  }
  $effect(() => {
    const next = taskKey(pack), signature = packPathSignature(pack);
    if (pack.id !== scopeId || (!dirty && !saving && signature !== baselineSignature)) {
      scopeId = pack.id; baselineSignature = signature;
      savedEvidence = pack.completionEvidence || ''; evidence = savedEvidence;
      criteriaText = pack.doneWhen || '';
    }
    if (next !== scopeKey) { scopeKey = next; invalidate(); }
  });
  async function loadConfig() {
    configController?.abort();
    const controller = new AbortController();
    configController = controller; config = null; available = false;
    loadingConfig = online;
    if (!online) return;
    try {
      const response = await fetch('/api/nebius/config?operation=review-evidence', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok || configController !== controller) return;
      const body = await response.json();
      if (isOperationConfig(body, 'review-evidence') && body.reviewVersion === REVIEW_VERSION) {
        config = { requestedModel: body.requestedModel, reviewVersion: body.reviewVersion, maxOutputTokens: body.maxOutputTokens };
        available = true;
      }
    } catch { /* An unavailable configuration never starts inference. */ }
    finally { if (configController === controller) loadingConfig = false; }
  }
  onMount(() => {
    if ((expanded || pack.completionEvidence?.trim()) && detailsElement) detailsElement.open = true;
    const update = () => { online = navigator.onLine; };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    void loadConfig();
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  });
  onDestroy(() => { generation++; active?.abort(); configController?.abort(); onstate({ dirty: false, busy: false }); });

  function discardEvidence() {
    if (pending || saving) return;
    savedEvidence = pack.completionEvidence || ''; evidence = savedEvidence;
    baselineSignature = packPathSignature(pack);
    invalidate(); notice = 'Evidence edits discarded. Saved evidence is unchanged.';
    detailsElement?.querySelector('summary')?.focus();
  }

  async function reviewEvidence() {
    if (!online || !available || !config || disabled || pending || saving || stale) return;
    error = ''; notice = '';
    let input: ReviewInput;
    try { input = validateReviewInput({ pack: projectTask(pack), criteria: criteria(criteriaText), evidence }); }
    catch {
      error = `Use one to ${REVIEW_LIMITS.criteria} criteria (up to ${REVIEW_LIMITS.criterionText} characters each) and up to ${REVIEW_LIMITS.evidence} characters of evidence.`;
      if (detailsElement) detailsElement.open = true;
      if (analysisElement) analysisElement.open = true;
      await tick();
      detailsElement?.querySelector<HTMLElement>('#nebius-review-criteria')?.focus();
      return;
    }
    const requestGeneration = ++generation, model = config.requestedModel;
    active?.abort(); active = new AbortController(); pending = true;
    result = null; reviewedInput = null; usage = null;
    try {
      const response = await fetch('/api/nebius/review-evidence', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: active.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: true, pack: input.pack, review: { criteria: input.criteria, evidence: input.evidence }, requestedModel: model, promptVersion: REVIEW_VERSION }),
      });
      if (requestGeneration !== generation) return;
      if (!response.ok) { error = response.status === 429 ? 'Review limit reached. Try later.' : 'Nebius review is unavailable. No work was changed.'; return; }
      const body = await response.json();
      if (requestGeneration !== generation) return;
      if (body.applied !== false || body.requestedModel !== model || body.model !== model || body.promptVersion !== REVIEW_VERSION
        || !Number.isSafeInteger(body.usage?.input_tokens) || body.usage.input_tokens < 0
        || !Number.isSafeInteger(body.usage?.output_tokens) || body.usage.output_tokens < 0) throw new Error('Unexpected review response');
      result = validateReviewOutput(body.review, input);
      reviewedInput = input;
      usage = { input_tokens: body.usage.input_tokens, output_tokens: body.usage.output_tokens };
    } catch {
      if (requestGeneration === generation) error = 'Nebius review is unavailable. No work was changed.';
    } finally { if (requestGeneration === generation) pending = false; }
  }

  async function recordEvidence() {
    if (pending || saving || disabled || stale || !evidence.trim() || evidence.length > REVIEW_LIMITS.evidence) return;
    saving = true; error = '';
    try {
      const recorded = await savePackPath(pack.id, { completionEvidence: evidence.trim(), status: pack.status }, baselineSignature);
      savedEvidence = recorded.pack.completionEvidence || ''; evidence = savedEvidence;
      baselineSignature = packPathSignature(recorded.pack);
      notice = 'Supplied evidence recorded. The task was not marked done.';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Evidence was not recorded.'; }
    finally { saving = false; }
  }
  async function markDone() {
    if (pending || saving || disabled || dirty || !evidenceRecorded) return;
    const workId = pack.id;
    saving = true; error = '';
    try {
      const receipt = await runPackAction(workId, 'done');
      if (!receipt) throw new Error('Completion did not return a saved result.');
      window.location.assign(`/work?focus=${encodeURIComponent(workId)}`);
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Completion was not saved.'; }
    finally { saving = false; }
  }
  const assessmentLabel: Record<string, string> = { supported: 'Supported by supplied text', partial: 'Partially supported', not_evidenced: 'Not evidenced', unclear: 'Unclear' };
</script>

<details id="nebius-evidence-recording" class="nebius-review" bind:this={detailsElement} data-nebius-evidence-review>
  <summary>Evidence and completion{dirty ? ' · unsaved evidence' : pack.completionEvidence?.trim() ? ' · evidence recorded' : ''}</summary>
  <div class="review-content">
  <p id="nebius-review-heading">Record what you did. Marking the task done is a separate action.</p>
  {#if !online}<WornAlert tone="info">Offline · you can still record evidence in this browser.</WornAlert>{/if}
  {#if error}<WornAlert tone="danger">{error}</WornAlert>{/if}
  {#if stale}<WornAlert tone="warning">Saved work changed. Your text is still here; discard the edits to load the latest evidence.</WornAlert>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}
  <section class="saved-criteria" aria-labelledby="nebius-saved-criteria-heading" data-nebius-saved-completion-criteria>
    <h3 id="nebius-saved-criteria-heading">Saved completion criteria</h3>
    {#if pack.doneWhen?.trim()}
      <p class="criteria-text" data-nebius-saved-criteria-text>{pack.doneWhen}</p>
    {:else}
      <p data-nebius-saved-criteria-absent>No completion criteria saved for this task.</p>
    {/if}
  </section>
  <fieldset disabled={disabled || pending || saving}>
    <label for="nebius-review-evidence">Evidence supplied by you<WornTextarea id="nebius-review-evidence" rows={4} maxlength={REVIEW_LIMITS.evidence} bind:value={evidence} oninput={invalidate} /></label>
  </fieldset>
  <div class="review-actions">
    <WornButton type="button" variant="primary" disabled={disabled || pending || saving || stale || !evidence.trim() || evidence.length > REVIEW_LIMITS.evidence || evidenceRecorded} onclick={() => void recordEvidence()}>Save evidence</WornButton>
    {#if dirty}<WornButton type="button" disabled={pending || saving} onclick={discardEvidence}>Discard evidence edits</WornButton>{/if}
  </div>
  {#if dirty}<p role="status">Evidence is unsaved. Record or discard it before leaving.</p>{/if}
  {#if evidenceRecorded}
    <div class="completion-action">
      <p>{pack.doneWhen?.trim() ? 'Evidence recorded. Compare it with the saved criteria above before marking done.' : 'Evidence recorded. No completion criteria are saved; completion is your decision.'}</p>
      {#if result && result.checks.some((check) => check.assessment !== 'supported')}
        <WornAlert tone="warning">Nebius found incomplete or unclear support for a selected criterion. Review the gap before marking done.</WornAlert>
      {/if}
      <WornButton type="button" disabled={disabled || pending || saving || dirty} onclick={() => void markDone()}>Mark done with recorded evidence</WornButton>
    </div>
  {/if}
  <details class="review-analysis" bind:this={analysisElement} data-nebius-optional-review>
    <summary>Optional · review with Nebius</summary>
    <div class="analysis-content">
    <p>Select criteria for this optional Nebius review. Editing them does not change the saved completion criteria above.</p>
    {#if loadingConfig}<p role="status">Checking review availability…</p>{:else if !available && online}<WornAlert tone="info">Nebius review is unavailable. Evidence recording remains available above.</WornAlert>{/if}
    {#if !available}<WornButton type="button" disabled={!online || loadingConfig} onclick={() => void loadConfig()}>Check review availability again</WornButton>{/if}
    <fieldset disabled={disabled || pending || saving}>
      <div class="review-field" data-nebius-selected-review-criteria>
      <label for="nebius-review-criteria">Criteria to check · one per line<WornTextarea id="nebius-review-criteria" rows={3} bind:value={criteriaText} oninput={invalidate} /></label>
      <p>{selectedCount} selected {selectedCount === 1 ? 'criterion' : 'criteria'}; maximum {REVIEW_LIMITS.criteria}. Other requirements may remain unchecked.</p>
      </div>
    </fieldset>
    <details class="review-task-preview">
      <summary>Data sent to Nebius</summary>
      <dl>
        <div><dt>Title</dt><dd>{pack.title || '(empty)'}</dd></div>
        <div><dt>Purpose</dt><dd>{pack.purpose || '(empty)'}</dd></div>
        <div><dt>Written next step</dt><dd>{pack.nextStep || '(empty)'}</dd></div>
        <div><dt>Blocker</dt><dd>{pack.blocker || '(empty)'}</dd></div>
        <div><dt>Done when</dt><dd>{pack.doneWhen || '(empty)'}</dd></div>
        <div><dt>Selected criteria</dt><dd>{criteria(criteriaText).map((item) => item.text).join('\n') || '(empty)'}</dd></div>
        <div><dt>Supplied evidence</dt><dd>{evidence || '(empty)'}</dd></div>
      </dl>
    </details>
    <p>Review with Nebius sends these five task fields, selected criteria, and your evidence. A source label alone is not evidence.</p>
    {#if available && config}<p>Planning and review · Model: {config.requestedModel}<br />At most {config.maxOutputTokens.toLocaleString()} output tokens per request. No automatic retry.</p>{/if}
    <div class="review-actions">
      <WornButton type="button" disabled={!online || !available || disabled || pending || saving || stale || selectedCount < 1 || selectedCount > REVIEW_LIMITS.criteria || !evidence.trim()} onclick={() => void reviewEvidence()}>{pending ? 'Reviewing…' : 'Review with Nebius'}</WornButton>
    </div>
  {#if result && reviewedInput}
    <div class="review-result" data-nebius-review-result>
      <h3>Advisory findings</h3>
      <p>{result.checks.length} of {reviewedInput.criteria.length} selected criteria assessed. This does not cover unselected requirements or independently verify supplied facts.</p>
      <ol>{#each result.checks as check, index (check.id)}<li><strong>{reviewedInput.criteria[index].text}</strong><p>{assessmentLabel[check.assessment]}</p><p>{check.reason}</p>{#if check.quote}<blockquote>{check.quote}</blockquote>{/if}</li>{/each}</ol>
      <p><strong>Consistency:</strong> {result.consistency.assessment} · {result.consistency.reason}</p>
      {#if usage}<p>Provider reported {usage.input_tokens} input tokens and {usage.output_tokens} output tokens.</p>{/if}
    </div>
  {/if}
    </div>
  </details>
  </div>
</details>

<style>
  .nebius-review { border: 1px solid var(--worn-border); border-radius: var(--worn-radius); margin-block: 1rem; min-inline-size: 0; overflow-wrap: anywhere; padding: .75rem 1rem; }
  .review-content { display: grid; gap: var(--worn-space-4); min-inline-size: 0; padding-block-start: var(--worn-space-4); }
  .review-content > :global(.worn-btn) { justify-self: start; }
  .review-analysis { border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); min-inline-size: 0; padding-inline: .75rem; }
  .analysis-content, .completion-action { display: grid; gap: .75rem; min-inline-size: 0; padding-block: .5rem .75rem; }
  .completion-action :global(.worn-btn), .analysis-content > :global(.worn-btn) { justify-self: start; }
  .review-field { display: grid; gap: var(--worn-space-2); min-inline-size: 0; }
  .review-field > p { color: var(--worn-text-secondary); font-size: 0.875rem; }
  .saved-criteria { border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); display: grid; gap: .5rem; min-inline-size: 0; padding: .75rem; }
  .saved-criteria h3 { font-size: .875rem; }
  .criteria-text { white-space: pre-wrap; overflow-wrap: anywhere; }
  summary { cursor: pointer; font-weight: 700; padding-block: 0.5rem; }
  h3, p { margin: 0; }
  p { line-height: 1.55; }
  .review-task-preview { border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); padding-inline: 0.75rem; }
  .review-task-preview dl { margin: 0 0 0.75rem; }
  .review-task-preview dl div { padding-block: 0.3rem; }
  .review-task-preview dt { font-weight: 650; }
  .review-task-preview dd { margin: 0; white-space: pre-wrap; }
  fieldset { border: 0; display: grid; gap: var(--worn-space-4); margin: 0; min-inline-size: 0; padding: 0; }
  label { display: grid; gap: var(--worn-space-2); font-weight: 650; min-inline-size: 0; }
  .review-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .review-result { background: var(--worn-surface); border: 1px solid var(--worn-border); border-radius: var(--worn-radius-sm); display: grid; gap: 0.75rem; padding: 1rem; }
  .review-result ol { display: grid; gap: var(--worn-space-4); margin: 0; padding-inline-start: 1.25rem; }
  .review-result li > * + * { margin-block-start: var(--worn-space-2); }
  blockquote { border-inline-start: 1px solid var(--worn-accent); margin: 0.5rem 0; padding-inline-start: 0.75rem; white-space: pre-wrap; }
</style>
