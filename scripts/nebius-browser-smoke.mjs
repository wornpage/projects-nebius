import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { pendingDraftFingerprint, revisePendingDraftChoice } from '../svelte-frontend/src/lib/pending-next-action.mjs';
import { evidenceFacts, workTitle } from '../svelte-frontend/src/lib/demo-workflow.ts';
import { OPERATION_PROFILES } from '../svelte-frontend/src/lib/nebius-routing-contract.mjs';
import { RUN_VERSION, RUN_LIMITS, validateRunInput, validateRunIntegrity } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { projectTask } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { authoredPreviewReference, materializeAuthoredChecker } from '../tests/fixtures/nebius-release-checker.mjs';
import { handleRecordedExample, RECORDED_EXAMPLE_PATH } from '../worker/nebius-recorded-example.mjs';

const root = path.resolve('dist/static-publish');
const model = 'nvidia/synthetic-model';
const reasoningModel = 'nvidia/synthetic-reasoning-model';
const suggestion = 'Ask Mira to confirm the revised deadline.';
const storageKey = 'projects-webmcp-challenge-state-v1';
const config = { available: true, requestedModel: model, promptVersion: 'task-change.v1' };
const posts = [];
async function followAppLink(page, label, { expectBlocked = false } = {}) {
  const link = page.getByRole('navigation', { name: 'Projects application navigation', exact: true }).getByRole('link', { name: label, exact: true });
  if (await link.isVisible()) return link.click();
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Commands', exact: true });
  if (label === 'Work') {
    const previousProject = await page.evaluate(key => { const stored = JSON.parse(localStorage.getItem(key)); return (stored?.state || stored)?.selectedProjectId ?? null; }, storageKey);
    await menu.locator('[data-command-key="all-work"]').click();
    if (expectBlocked) return;
    await page.waitForURL(url => url.pathname === '/work' && !url.searchParams.has('scope'));
    await page.waitForFunction(() => document.querySelector('#project-scope')?.value === '');
    // These pre-existing project journeys return to the same project. The
    // shell suite separately verifies All work's deliberate scope clearing.
    if (previousProject) {
      await page.locator('#project-scope').selectOption(previousProject);
      await page.waitForFunction(({key,id}) => { const stored=JSON.parse(localStorage.getItem(key)); return (stored?.state||stored)?.selectedProjectId===id; }, {key:storageKey,id:previousProject});
    }
    return;
  }
  const current = menu.locator('[data-command-key^="task:"][aria-current]');
  await (await current.count() ? current : menu.locator('[data-command-key^="task:"]').first()).click();
}
async function reachByTab(page, locator) {
  await locator.waitFor({ state: 'visible' });
  for (let step = 0; step < 100; step++) {
    if (await locator.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard could not reach ${await locator.evaluate(element => element.textContent || element.getAttribute('aria-label') || element.id)}`);
}
async function assertDisabledChoices(panel) {
  assert.notEqual(await panel.locator('fieldset.next-choice-guard').getAttribute('disabled'), null);
  const buttons = panel.locator('[data-next-choices] button');
  const count = await buttons.count();
  assert(count > 0, 'the guarded editor exposes choice buttons');
  for (let index = 0; index < count; index++) assert.equal(await buttons.nth(index).isDisabled(), true, `choice ${index + 1} is disabled`);
}
async function waitForTaskSelection(page, id) {
  await page.waitForURL(url => url.pathname === '/next' && url.searchParams.get('pack') === id);
  await page.waitForFunction(id => {
    const selector = document.querySelector('#nebius-work-item');
    return selector?.value === id && !selector.disabled;
  }, id);
}
let failInference = false;
let failureMetadata = null;
let failureStatus = 502;
let failureCode = 'nebius_request_failed';
function syntheticFailure(response) {
  response.statusCode = failureStatus;
  response.end(JSON.stringify({ requestId: 'synthetic-failed-request', code: failureCode, error: 'PRIVATE_PROVIDER_DETAILS', ...(failureMetadata ?? {}) }));
}
let configEnabled = true;
let proposalMode = 'next-step';
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === RECORDED_EXAMPLE_PATH) {
    const result = await handleRecordedExample({ url: url.href, method: request.method });
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); return;
  }
  if (url.pathname.startsWith('/api/nebius/')) {
    response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store');
    if (url.pathname === '/api/nebius/config' && request.method === 'GET') {
      const operation = url.searchParams.get('operation');
      if (!Object.hasOwn(OPERATION_PROFILES, operation)) { response.statusCode = 400; response.end('{}'); return; }
      if (!configEnabled) response.statusCode = 404;
      response.end(JSON.stringify(configEnabled ? { ...config, operation, ...OPERATION_PROFILES[operation], requestedModel: operation === 'suggest-next-step' ? model : reasoningModel } : { code: 'nebius_disabled' })); return;
    }
    if (url.pathname === '/api/nebius/suggest-next-step' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk;
      posts.push(JSON.parse(text));
      if (failInference) { syntheticFailure(response); return; }
      const changes = proposalMode === 'block' ? { nextStep: suggestion, blocker: 'Delivery date still unconfirmed', status: 'blocked' }
        : proposalMode === 'clear' ? { nextStep: suggestion, blocker: 'None', status: 'active' } : { nextStep: suggestion };
      response.end(JSON.stringify({ ...config, model, applied: false, suggestion: { changes, reason: 'The deadline is not confirmed.', basis: ['purpose', 'blocker', ...(posts.at(-1).context.length ? ['context:0'] : [])], missingInformation: ['Confirmed deadline'] }, usage: { input_tokens: 30, output_tokens: 20 } })); return;
    }
    response.statusCode = 404; response.end('{}'); return;
  }
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\//u, '') || 'index.html'; } catch { response.statusCode = 400; response.end(); return; }
  if (!path.extname(relative)) relative += '.html';
  const file = path.resolve(root, relative), resolved = path.relative(root, file);
  if (resolved.startsWith('..') || path.isAbsolute(resolved)) { response.statusCode = 403; response.end(); return; }
  try {
    const data = await readFile(file);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    response.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream'); response.end(data);
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
async function checkLegacyPendingCompatibility(browser) {
  const cases = [];
  const project = pack => ({ title: workTitle(pack), ...evidenceFacts(pack), next: pack.next || '' });
  for (const width of [375, 1280]) for (const format of ['envelope', 'legacy']) {
    const state = { packs: [
      { id: 'legacy-live', title: 'Saved active task', status: 'active', blocker: 'none', next: 'Review', activity: [] },
      { id: 'legacy-missing-evidence', title: 'Task with missing evidence', status: 'active', blocker: 'none', next: 'Review', decision: true, activity: [] },
      { id: 'legacy-repeated-evidence', title: 'Task with repeated evidence', status: 'active', blocker: 'none', next: 'Review', decision: true, activity: [] },
      { id: 'legacy-duplicates', title: 'Task with duplicate drafts', status: 'active', blocker: 'none', next: 'Review', decision: true, activity: [] },
      { id: 'legacy-terminal', title: 'Completed saved task', status: 'done', blocker: 'none', next: 'Review', activity: [] }
    ], selectedId: 'legacy-live', pendingNextActionDrafts: [] };
    state.packs.push({ id: 'missing-fact', title: 'Originally available evidence', status: 'active', blocker: 'none', next: 'Review', activity: [] });
    for (const [workId, evidence] of [
      ['legacy-missing-target', []],
      ['legacy-missing-evidence', [{ workId: 'missing-fact', field: 'blocker', expectedValue: null }, { workId: 'missing-fact', field: 'blocker', expectedValue: null }]],
      ['legacy-terminal', []], ['legacy-live', []]
    ]) {
      const draft = { workId, choice: 'Focus', mode: 'preset', evidenceNote: `Saved note for ${workId}`, evidence, source: 'webmcp', originFingerprint: '' };
      draft.originFingerprint = pendingDraftFingerprint(state, draft, project);
      state.pendingNextActionDrafts.push(draft);
    }
    for (const [choice, label] of [['Open', 'first'], ['Start', 'second']]) {
      const draft = { workId: 'legacy-duplicates', choice, mode: 'preset', evidenceNote: `Duplicate ${label} note`, evidence: [], source: 'webmcp', originFingerprint: '' };
      draft.originFingerprint = pendingDraftFingerprint(state, draft, project);
      state.pendingNextActionDrafts.push(draft);
    }
    const repeated = { workId: 'legacy-repeated-evidence', choice: 'Focus', mode: 'preset', evidenceNote: 'Saved note for legacy-repeated-evidence', evidence: [{ workId: 'legacy-live', field: 'blocker', expectedValue: null }, { workId: 'legacy-live', field: 'blocker', expectedValue: 'Waiting' }], source: 'webmcp', originFingerprint: '' };
    repeated.originFingerprint = pendingDraftFingerprint(state, repeated, project);
    state.pendingNextActionDrafts.push(repeated);
    state.packs.pop();
    const missingReferenceDraft = state.pendingNextActionDrafts.find(draft => draft.workId === 'legacy-missing-evidence');
    assert.equal(pendingDraftFingerprint(state, missingReferenceDraft, project), missingReferenceDraft.originFingerprint, 'fixture reproduces the missing/no-blocker fingerprint ambiguity');
    const initial = format === 'envelope' ? { schemaVersion: 1, revision: 'legacy-pending-test', state } : state;
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const external = [], writes = [], errors = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (url.pathname.startsWith('/api/nebius/') && request.method() !== 'GET') { writes.push(url.pathname); return route.abort(); }
      return route.continue();
    });
    await context.addInitScript(({ key, initial }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
      const calls = []; Object.defineProperty(window, '__legacyRegistrations', { value: calls });
      Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool(tool) { calls.push(tool?.name); } } });
    }, { key: storageKey, initial });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${origin}/work`);
      const trigger = page.getByRole('button', { name: 'Pending approvals (7)', exact: true });
      await trigger.waitFor();
      const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      let saved = await read();
      assert.deepEqual(saved.state, state, 'opening Work preserves every saved pack and draft');
      if (format === 'envelope') assert.equal(saved.revision, initial.revision, 'viewing Work does not rewrite an existing envelope');
      assert.equal(await page.locator('[data-nav-label="Task"]').getAttribute('href'), '/next?pack=legacy-live', 'Task navigation skips non-resumable drafts');
      await page.goto(`${origin}/next?pack=legacy-missing-evidence`);
      const pendingPanel = page.locator('#nebius-button-action-panel');
      await pendingPanel.getByText('This draft references missing work.', { exact: false }).first().waitFor();
      assert.equal(await pendingPanel.getByRole('button', { name: 'Approve and save', exact: true }).isDisabled(), true);
      await assertDisabledChoices(pendingPanel);
      assert.equal(await pendingPanel.getByRole('button', { name: 'Discard draft', exact: true }).isEnabled(), true);
      assert.deepEqual((await read()).state, state, 'direct Task navigation and inspection make no mutation');
      await page.goto(`${origin}/work?focus=legacy-missing-evidence&context=pending-decision`);
      const decision = page.locator('[data-decision-workspace]');
      await decision.getByText('This draft references missing work.', { exact: false }).first().waitFor();
      assert.equal(await decision.locator('#decision-next-action').isDisabled(), true);
      assert.equal(await decision.locator('[data-decision-draft-evidence] li').count(), 2, 'repeated stored references remain visible');
      assert.equal(await decision.locator('[data-decision-intent="prepare"]').isDisabled(), true);
      assert.equal(await decision.getByRole('button', { name: 'Discard draft', exact: true }).isEnabled(), true);
      assert.deepEqual((await read()).state, state, 'direct Work inspection makes no mutation');
      await page.goto(`${origin}/next?pack=legacy-repeated-evidence`);
      const repeatedPanel = page.locator('#nebius-button-action-panel');
      await repeatedPanel.getByText('This draft repeats an evidence reference.', { exact: false }).first().waitFor();
      assert.equal(await repeatedPanel.getByRole('button', { name: 'Approve and save', exact: true }).isDisabled(), true);
      await assertDisabledChoices(repeatedPanel);
      await page.goto(`${origin}/work?focus=legacy-repeated-evidence&context=pending-decision`);
      const repeatedDecision = page.locator('[data-decision-workspace]');
      await repeatedDecision.getByText('This draft repeats an evidence reference.', { exact: false }).first().waitFor();
      assert.equal(await repeatedDecision.locator('[data-decision-draft-evidence] li').count(), 2);
      assert.equal(await repeatedDecision.locator('#decision-next-action').isDisabled(), true);
      assert.equal(await repeatedDecision.locator('[data-decision-intent="prepare"]').isDisabled(), true);
      assert.deepEqual((await read()).state, state, 'repeated references remain intact after inspection');
      await page.goto(`${origin}/next?pack=legacy-duplicates`);
      const duplicatePanel = page.locator('#nebius-button-action-panel');
      await page.getByText('Multiple drafts refer to this task.', { exact: false }).first().waitFor();
      assert.equal(await duplicatePanel.getByRole('button', { name: 'Approve and save', exact: true }).isDisabled(), true);
      await assertDisabledChoices(duplicatePanel);
      assert.equal(await duplicatePanel.getByRole('button', { name: 'Discard all 2 drafts for this task', exact: true }).isEnabled(), true);
      await page.goto(`${origin}/work?focus=legacy-duplicates&context=pending-decision`);
      const duplicateDecision = page.locator('[data-decision-workspace]');
      await duplicateDecision.getByText('Multiple drafts refer to this task.', { exact: false }).waitFor();
      assert.equal(await duplicateDecision.locator('#decision-next-action').isDisabled(), true);
      assert.equal(await duplicateDecision.locator('[data-decision-intent="prepare"]').isDisabled(), true);
      assert.equal(await duplicateDecision.getByRole('button', { name: 'Discard all 2 drafts for this task', exact: true }).isEnabled(), true);
      assert.deepEqual((await read()).state, state, 'duplicate drafts remain untouched after direct inspection');
      await page.goto(`${origin}/next?pack=legacy-live`);
      await page.getByRole('button', { name: 'Pending approvals (7)', exact: true }).waitFor();
      assert.deepEqual((await read()).state, state, 'opening Task preserves existing saved data');
      await page.getByRole('button', { name: 'Pending approvals (7)', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /Pending approvals/ });
      await dialog.waitFor();
      assert.equal(await dialog.getByText('orphaned', { exact: true }).count(), 3);
      assert.equal(await dialog.getByText('ambiguous', { exact: true }).count(), 3);
      await dialog.getByText('Duplicate first note', { exact: true }).waitFor();
      await dialog.getByText('Duplicate second note', { exact: true }).waitFor();
      for (const id of ['legacy-missing-target', 'legacy-missing-evidence', 'legacy-terminal', 'legacy-repeated-evidence']) {
        const note = dialog.getByText(`Saved note for ${id}`, { exact: true });
        await note.waitFor();
        const card = note.locator('xpath=ancestor::article');
        assert.equal(await card.getByRole('link', { name: 'Review on Next' }).count(), 0, 'orphaned drafts expose no approval path');
        await card.getByRole('button', { name: 'Discard', exact: true }).click();
        await page.waitForFunction(({ key, id }) => !JSON.parse(localStorage.getItem(key)).state.pendingNextActionDrafts.some(d => d.workId === id), { key: storageKey, id });
      }
      await dialog.getByRole('button', { name: 'Discard all 2 drafts for this task', exact: true }).first().click();
      await page.waitForFunction(key => !JSON.parse(localStorage.getItem(key)).state.pendingNextActionDrafts.some(d => d.workId === 'legacy-duplicates'), storageKey);
      saved = await read();
      assert.deepEqual(saved.state.packs, state.packs, 'discarding old drafts does not alter work');
      assert.deepEqual(saved.state.pendingNextActionDrafts, [state.pendingNextActionDrafts.find(draft => draft.workId === 'legacy-live')], 'the remaining live draft is untouched');
      assert.deepEqual(await page.evaluate(() => window.__legacyRegistrations), []);
      assert.deepEqual(external, []); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
      cases.push({ width, format, preservedOnOpen: true, threeOrphansInspectableAndDiscardable: true, duplicateGroupInspectableAndExplicitlyDiscarded: true, liveDraftPreserved: true, registrations: 0 });
    } finally { await context.close(); }
  }
  const invalidState = { packs: [{ id: 'valid-work', title: 'Preserved work', status: 'active', blocker: 'none', next: 'Review', activity: [] }], selectedId: 'valid-work', pendingNextActionDrafts: [
    { workId: 'invalid-draft', choice: 'Focus', mode: 'preset', evidenceNote: '', evidence: [{ workId: 'valid-work', field: 'bad-field', expectedValue: null }], originFingerprint: 'old', source: 'webmcp' },
    { workId: 'blank-reference', choice: 'Focus', mode: 'preset', evidenceNote: '', evidence: [{ workId: '  ', field: 'blocker', expectedValue: null }], originFingerprint: 'old', source: 'webmcp' }
  ] };
  const invalidContext = await browser.newContext({ viewport: { width: 375, height: 900 }, serviceWorkers: 'block' });
  const invalidWrites = [];
  await invalidContext.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || (url.pathname.startsWith('/api/nebius/') && request.method() !== 'GET')) { invalidWrites.push(url.href); return route.abort(); }
    return route.continue();
  });
  await invalidContext.addInitScript(({ key, state }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, revision: 'malformed-fixture', state })); }, { key: storageKey, state: invalidState });
  try {
    const page = await invalidContext.newPage();
    await page.goto(`${origin}/work`);
    await page.getByRole('alert', { name: 'Quarantined workspace records' }).waitFor();
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).state, storageKey);
    assert.deepEqual(saved.packs, invalidState.packs, 'malformed approval recovery preserves valid work');
    assert.deepEqual(saved.pendingNextActionDrafts, [], 'invalid evidence shape remains rejected');
    assert(saved.recoveryQuarantine.some(item => item.id === 'invalid-draft'));
    assert(saved.recoveryQuarantine.some(item => item.id === 'blank-reference'));
    assert.deepEqual(invalidWrites, []);
    cases.push({ width: 375, format: 'malformed-envelope', invalidEvidenceQuarantined: true, validWorkPreserved: true });
  } finally { await invalidContext.close(); }
  return cases;
}
async function checkUnavailableRequestRetirement(browser) {
  const cases = [];
  for (const width of [375, 1280]) for (const drift of ['task', 'model']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const pack = { id: 'retirement-fixture', title: 'Inspect an unavailable tool request', status: 'active',
      purpose: 'Check a synthetic packet.', nextStep: 'Build the checker.', doneWhen: 'Packet gaps are shown.',
      blocker: 'None', memory: [], activity: [], executionInputs: [{ id: 'packet', format: 'json' }] };
    const reference = { id: '00000000-0000-4000-8000-000000000091', key: 'a'.repeat(64), record: null,
      input: validateRunInput({ version: RUN_VERSION, packId: pack.id, pack: projectTask(pack), currentStatus: pack.status,
        context: [], requestedModel: reasoningModel, requiredInputFormats: pack.executionInputs, requiredOutputs: null, consent: true }) };
    pack.executionRun = structuredClone(reference);
    if (drift === 'task') pack.purpose = 'Updated packet requirements.';
    let reads = 0, starts = 0;
    const external = [], errors = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith('/api/nebius/runs/')) return route.continue();
      if (url.pathname.endsWith('/config')) return route.fulfill({ json: { available: true, version: RUN_VERSION,
        requestedModel: drift === 'model' ? 'nvidia/changed-fixture-model' : reasoningModel, limits: RUN_LIMITS } });
      assert.equal(url.pathname, '/api/nebius/runs/' + reference.id);
      if (request.method() === 'GET') { reads++; return route.fulfill({ status: 404, json: { code: 'not_found', error: 'The saved run was not found.' } }); }
      assert.equal(request.method(), 'POST'); assert.equal(drift, 'model'); starts++;
      return route.fulfill({ status: 409, json: { code: 'model_changed', error: 'The configured model changed.' } });
    });
    await context.addInitScript(({ key, pack }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, revision: 'retirement-fixture', state: { packs: [pack] } }));
    }, { key: storageKey, pack });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin + '/next?pack=' + pack.id);
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      await page.getByRole('heading', { name: 'Review this build', exact: true }).waitFor();
      assert.equal(await page.locator('[data-nebius-task-review]').count(), 0, 'an unavailable saved run is not treated as an ordinary task with no run');
      await page.getByRole('tab', { name: 'Tool', exact: true }).click();
      const review = page.getByRole('button', { name: 'Review local retirement', exact: true });
      await review.waitFor();
      assert.equal(await page.getByRole('button', { name: 'Build with Nebius', exact: true }).isDisabled(), true);
      const resume = page.getByRole('button', { name: 'Resume saved request', exact: true });
      if (drift === 'task') assert.equal(await resume.isDisabled(), true);
      else {
        await resume.click();
        await page.getByText('The saved request is preserved.', { exact: false }).waitFor();
        assert.equal(starts, 1);
      }
      const before = await page.evaluate(key => localStorage.getItem(key), storageKey);
      await review.click();
      const dialog = page.getByRole('dialog', { name: 'Retire unavailable local request', exact: true });
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Keep local reference', exact: true }).click();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before);
      await reachByTab(page, review); await page.keyboard.press('Enter'); await dialog.waitFor();
      const readsBeforeConfirmation = reads;
      await reachByTab(page, dialog.getByRole('button', { name: 'Confirm local retirement', exact: true }));
      await page.keyboard.press('Enter');
      await page.waitForFunction(key => !JSON.parse(localStorage.getItem(key)).state.packs[0].executionRun, storageKey);
      assert(reads > readsBeforeConfirmation, 'Confirmation performs a fresh server read.');
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).state.packs[0], storageKey);
      assert.deepEqual(saved.retiredExecutionRuns[0].reference, reference);
      assert.equal(saved.status, 'active'); assert.equal(saved.purpose, pack.purpose);
      assert.equal(starts, drift === 'model' ? 1 : 0, 'Retirement does not start replacement work.');
      await page.reload(); await page.getByRole('tab', { name: 'Tool', exact: true }).click();
      await page.locator('[data-retired-run-history] > summary').click();
      await page.getByText('Their outcomes remain unknown.', { exact: false }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Build with Nebius' && !button.disabled));
      assert.equal(await page.getByRole('button', { name: 'Build with Nebius', exact: true }).isEnabled(), true);
      assert.deepEqual(external, []); assert.deepEqual(errors, []);
      cases.push({ width, drift, keptBeforeConfirmation: true, freshRead: true, exactHistoryReload: true, automaticStarts: 0 });
    } catch (error) {
      await page.screenshot({ path: path.resolve(`dist/nebius-retirement-failure-${width}-${drift}.png`), fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
  return cases;
}
async function checkRunStagePresentation(browser) {
  const reference = await authoredPreviewReference(await materializeAuthoredChecker());
  // Exercise provider-stage presentation with an authored local fixture. Reserved
  // synthetic model names intentionally select the separate example UI instead.
  reference.input.requestedModel = 'nvidia/browser-stage-fixture';
  reference.record.requestedModel = reference.input.requestedModel;
  const accepted = attempt => ({ attempt, outcome: 'accepted', responseText: 'Authored source-admission fixture.', retention: 'retained', diagnostic: null });
  const rejected = attempt => ({ attempt, outcome: 'rejected', responseText: 'Authored rejected-source fixture.', retention: 'retained',
    diagnostic: { code: 'invalid_model_output', stage: 'tool_files', message: 'Authored source rejection.' } });
  const empty = { attempt: 0, files: [], checks: [], generationAttempts: [], error: null, failure: null };
  const calls = modelCalls => ({ modelCalls, inputTokens: 0, outputTokens: 0, totalsComplete: true });
  const failedCheck = { ...reference.record.checks[0], exitCode: 1, stdout: 'Authored failed-check fixture.' };
  const cases = [
    { name: 'idle', noReference: true, states: ['waiting', 'waiting', 'waiting'] },
    { name: 'unavailable', noReference: true, unavailable: true, states: ['waiting', 'waiting', 'waiting'] },
    { name: 'missing-receipt', record: null, states: ['unknown', 'unknown', 'waiting'] },
    { name: 'queued', change: { ...empty, status: 'queued', usage: calls(0) }, states: ['waiting', 'waiting', 'waiting'] },
    { name: 'generating', change: { ...empty, status: 'generating', usage: calls(1) }, states: ['active', 'waiting', 'waiting'] },
    { name: 'source-repair-before-sandbox', change: { ...empty, status: 'repairing', usage: calls(1), generationAttempts: [rejected(1)] }, states: ['active', 'waiting', 'waiting'] },
    { name: 'repair-retains-old-files', change: { status: 'repairing', usage: calls(2), checks: [failedCheck], generationAttempts: [accepted(1)] }, states: ['active', 'stopped', 'waiting'] },
    { name: 'checking', change: { status: 'checking', usage: calls(1), checks: [], generationAttempts: [accepted(1)] }, states: ['observed', 'active', 'waiting'] },
    { name: 'ready', change: { generationAttempts: [accepted(1)] }, states: ['observed', 'observed', 'available'] },
    { name: 'ready-after-source-repair', change: { attempt: 2, usage: calls(2), generationAttempts: [rejected(1), accepted(2)],
      checks: [{ ...reference.record.checks[0], attempt: 2 }] }, states: ['observed', 'observed', 'available'] },
    { name: 'ready-after-sandbox-repair', change: { attempt: 2, usage: calls(2), generationAttempts: [accepted(1), accepted(2)],
      checks: [failedCheck, { ...reference.record.checks[0], attempt: 2 }] }, states: ['observed', 'observed', 'available'] },
    { name: 'historical-ready-without-response-history', change: { generationAttempts: [] }, states: ['observed', 'observed', 'available'] },
    { name: 'failed-source', change: { ...empty, status: 'failed', usage: calls(2), generationAttempts: [rejected(1), rejected(2)],
      failure: { code: 'invalid_model_output', stage: 'tool_files' }, error: 'Authored source rejection.' }, states: ['stopped', 'stopped', 'waiting'] },
    { name: 'failed-second-source-keeps-first-files', change: { status: 'failed', usage: calls(2), checks: [failedCheck], generationAttempts: [accepted(1)],
      failure: { code: 'request_failed', stage: 'generation' }, error: 'Authored second-call failure.' }, states: ['stopped', 'stopped', 'waiting'] },
    { name: 'failed-sandbox', change: { status: 'failed', checks: [failedCheck], generationAttempts: [accepted(1)],
      failure: { code: 'sandbox_failed', stage: 'sandbox' }, error: 'Authored Sandbox failure.' }, states: ['observed', 'stopped', 'waiting'] },
    { name: 'historical-failure-without-stage', change: { ...empty, status: 'failed', usage: calls(1), error: 'Authored historical failure.' }, states: ['stopped', 'stopped', 'waiting'] },
    { name: 'uncertain-sandbox', change: { status: 'uncertain', checks: [], generationAttempts: [accepted(1)], error: 'Authored unconfirmed Sandbox outcome.' }, states: ['observed', 'unknown', 'waiting'] },
    { name: 'uncertain-with-pass', change: { status: 'uncertain', generationAttempts: [accepted(1)], error: 'Authored uncertain final outcome.' }, states: ['observed', 'unknown', 'waiting'] },
    { name: 'cancelled-with-pass', change: { status: 'cancelled', generationAttempts: [accepted(1)] }, states: ['observed', 'stopped', 'waiting'] },
    { name: 'cancelling', change: { ...empty, status: 'cancelling', usage: calls(1) }, states: ['unknown', 'unknown', 'waiting'] },
    { name: 'earlier-ready', earlier: true, change: {}, states: ['observed', 'observed', 'waiting'] },
    { name: 'earlier-generating', earlier: true, change: { ...empty, status: 'generating', usage: calls(1) }, states: ['active', 'waiting', 'waiting'] },
  ];
  const results = [];
  for (const width of [375, 1280]) for (const scenario of cases) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    let writes = 0; const errors = [], external = [];
    try {
      const record = scenario.noReference || scenario.record === null ? null
        : await validateRunIntegrity({ ...structuredClone(reference.record), ...structuredClone(scenario.change) });
      const pack = { id: reference.input.packId, ...reference.input.pack, status: 'active', next: 'Review',
        executionInputs: reference.input.requiredInputFormats, activity: [], completionEvidence: '' };
      if (!scenario.noReference) pack.executionRun = { ...structuredClone(reference), record };
      if (scenario.earlier) pack.purpose += ' Changed task requirements.';
      await context.addInitScript(({ key, pack }) => { if (window === top) localStorage.setItem(key, JSON.stringify({
        packs: [pack], selectedId: pack.id, pendingNextActionDrafts: [] })); }, { key: storageKey, pack });
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
        if (!url.pathname.startsWith('/api/nebius/')) return route.continue();
        if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: { error: 'UI fixture forbids all writes.' } }); }
        if (url.pathname === '/api/nebius/runs/config') return route.fulfill(scenario.unavailable
          ? { status: 404, json: { code: 'execution_disabled', error: 'Execution disabled in the authored UI fixture.' } }
          : { json: { available: true, version: RUN_VERSION, requestedModel: reference.input.requestedModel, limits: RUN_LIMITS } });
        if (url.pathname === '/api/nebius/runs/' + reference.id) return route.fulfill(record
          ? { json: { run: record } } : { status: 404, json: { code: 'not_found', error: 'Authored missing receipt.' } });
        return route.fulfill({ status: 404, json: { code: 'nebius_disabled' } });
      });
      const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/next?pack=' + encodeURIComponent(pack.id));
      await page.getByRole('tab', { name: 'Tool', exact: true }).click();
      const run = page.locator('#nebius-task-run');
      await page.waitForFunction(() => !document.querySelector('#nebius-task-run')?.textContent.includes('Checking whether task execution is configured'));
      await page.waitForFunction(() => !document.querySelector('#nebius-task-run')?.textContent.includes('Verifying saved'));
      const stages = run.locator('[data-run-stage]'); assert.equal(await stages.count(), 3);
      assert.deepEqual(await stages.evaluateAll(elements => elements.map(element => element.dataset.state)), scenario.states, scenario.name);
      assert.equal(await run.locator('[data-run-stage="review"] .task-run-marker').textContent(), '3', 'Human review never gets an automatic completion tick.');
      assert.equal(await run.locator('[data-run-track]').getAttribute('data-earlier'), String(Boolean(scenario.earlier)));
      assert.equal(await run.locator('[aria-current="step"]').count(), scenario.earlier ? 0 : scenario.states.filter(state => state === 'active').length);
      if (scenario.earlier) assert((await run.locator('.task-run-track-label').textContent()).includes('Earlier task requirements'));
      if (scenario.name === 'source-repair-before-sandbox') assert.doesNotMatch(await run.locator('[data-run-stage="sandbox"]').textContent(), /failed|passed/iu);
      if (scenario.name === 'ready-after-source-repair') assert.equal(await run.locator('[data-run-stage="sandbox"] .task-run-stage-detail').textContent(), 'Model attempt 2 passed · 1 Sandbox result');
      if (scenario.name === 'ready-after-sandbox-repair') assert.equal(await run.locator('[data-run-stage="sandbox"] .task-run-stage-detail').textContent(), 'Model attempt 2 passed · 2 Sandbox results');
      if (scenario.name === 'checking') assert.equal(await run.locator('[data-run-stage="sandbox"] .task-run-stage-detail').textContent(), 'Checking model attempt 1');
      const activeAnimations = await run.locator('[data-state="active"] .task-run-marker')
        .evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
      assert(activeAnimations.every(name => name === 'none'), 'Reduced motion stops every active stage pulse.');
      if (scenario.states.includes('active')) {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const animated = await run.locator('[data-state="active"] .task-run-marker')
          .evaluateAll(elements => elements.map(element => getComputedStyle(element).animationName));
        assert(animated.every(name => scenario.earlier ? name === 'none' : name.includes('run-stage-pulse')),
          'Only active stages of the current run may animate.');
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      const primary = run.locator('.is-primary:visible'); assert.equal(await primary.count(), 1);
      const box = await primary.boundingBox();
      if (box.y + box.height > 900) await page.screenshot({ path: path.resolve(`dist/nebius-stage-primary-${scenario.name}-${width}-failure.png`), fullPage: true });
      assert(box.y + box.height <= 900, `Primary action stays in the first screen: ${scenario.name} at ${width}px, bottom=${box.y + box.height}.`);
      await reachByTab(page, primary);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      const savedPack = (saved.state || saved).packs[0];
      assert.equal(savedPack.status, 'active'); assert.equal(savedPack.completionEvidence, '');
      assert.equal(writes, 0); assert.deepEqual(errors, []); assert.deepEqual(external, []);
      if (['ready', 'source-repair-before-sandbox', 'repair-retains-old-files'].includes(scenario.name)) await run.screenshot({ path: path.resolve(`dist/nebius-stage-${scenario.name}-${width}.png`) });
      results.push({ width, case: scenario.name, authoredFixture: true, states: scenario.states, humanReviewComplete: false, nativePrimaryReachable: true, writes: 0 });
    } finally { await context.close(); }
  }
  return results;
}

async function checkWorkIntakeAndKeyboard(browser) {
  const cases = [], expected = 8;
  for (const width of [375, 1280]) for (const theme of ['neutral-light', 'neutral-dark', 'original-light', 'original-dark']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const errors = [], external = [], writes = [];
    const project = { id: 'work-regression-project', title: 'Work regression project', brief: 'Local authored Work fixtures.', summary: 'Check task intake and history.', source: 'manual', createdAt: '2026-10-24T00:00:00.000Z' };
    const packs = [
      { id: 'work-regression-open', title: 'Active Work fixture', projectId: project.id, status: 'active', next: 'Open', blocker: 'none', purpose: 'Check Work controls.', nextStep: 'Observe the controls.', doneWhen: 'Observed locally.', activity: [] },
      { id: 'work-regression-done', title: 'Done Work fixture', projectId: project.id, status: 'done', next: 'Open', blocker: 'none', purpose: 'Retain completed work.', nextStep: 'Inspect the saved history.', doneWhen: 'History is retained.', completionEvidence: 'Authored completed observation.', activity: [] },
      { id: 'work-regression-archived', title: 'Archived Work fixture', projectId: project.id, status: 'active', archived: true, next: 'Open', blocker: 'none', purpose: 'Retain archived work.', nextStep: 'Inspect the saved history.', doneWhen: 'History is retained.', activity: [] },
    ];
    await context.addInitScript(({ key, packs, project }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({
      packs, projects: [project], selectedProjectId: project.id, selectedId: packs[1].id, pendingNextActionDrafts: [],
    })); }, { key: storageKey, packs, project });
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (url.pathname.startsWith('/api/nebius/') && request.method() !== 'GET') { writes.push(url.pathname); return route.fulfill({ status: 405, json: { error: 'Work fixture forbids provider writes.' } }); }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    const confirmAction = async (accept, action, type = 'confirm') => {
      const received = page.waitForEvent('dialog'); const result = action();
      const dialog = await received; assert.equal(dialog.type(), type);
      if (accept) await dialog.accept(); else await dialog.dismiss();
      await result;
    };
    const openIntake = async () => {
      await page.getByRole('button', { name: 'Add work', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.id === 'work-quick-title');
    };
    const expectDanger = async locator => {
      await locator.waitFor({ state: 'visible' });
      assert.equal(await locator.evaluate(element => {
        const probe = document.createElement('span'); probe.style.color = 'var(--worn-danger-text)'; element.append(probe);
        const expectedColor = getComputedStyle(probe).color; probe.remove();
        return getComputedStyle(element).color === expectedColor && expectedColor !== getComputedStyle(document.body).color;
      }), true, 'visible error uses the theme danger-text token');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'error state fits the current viewport');
    };
    try {
      await page.goto(origin + '/work');
      await page.locator('[data-appearance-trigger]').click();
      await page.locator(`input[name="appearance-palette"][value="${theme.split('-')[0]}"]`).check();
      await page.locator(`input[name="appearance-mode"][value="${theme.split('-')[1]}"]`).check();
      assert.equal(await page.locator('html').getAttribute('data-theme-choice'), theme);
      await page.keyboard.press('Escape');
      const entry = page.locator('[data-nebius-work-entry]');
      await entry.getByText('Done Work fixture', { exact: true }).waitFor();
      assert.match(await entry.getByRole('link', { name: 'View task history', exact: true }).getAttribute('href'), /pack=work-regression-done&view=review/u);
      await page.getByRole('button', { name: 'Additional work filters', exact: true }).click();
      await page.getByRole('tab', { name: 'Cards', exact: true }).click();
      const doneCard = page.locator('[data-work-item][data-pack-id="work-regression-done"]');
      assert.equal(await doneCard.getAttribute('aria-current'), 'true');
      assert.equal(await doneCard.evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth) > 0), true, 'selected card retains a visible border');
      await doneCard.getByRole('link', { name: 'View task history for Done Work fixture', exact: true }).waitFor();
      await page.locator('[data-work-item][data-pack-id="work-regression-open"]').getByRole('link', { name: 'Open task Active Work fixture', exact: true }).waitFor();
      // Move focus as soon as the real form is inserted, before opening settles.
      await page.evaluate(() => {
        window.__workIntakeMoved = false;
        const observer = new MutationObserver(() => {
          const notes = document.querySelector('#work-quick-notes');
          if (!notes) return;
          observer.disconnect(); notes.focus(); window.__workIntakeMoved = document.activeElement === notes;
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
      await page.getByRole('button', { name: 'Add work', exact: true }).click();
      await page.waitForFunction(() => window.__workIntakeMoved);
      assert.equal(await page.locator('#work-quick-notes').evaluate(element => element === document.activeElement), true, 'opening retains focus moved to Notes');
      await page.locator('#work-quick-notes').fill('A draft entered after moving focus.');
      assert.equal(await page.locator('#work-quick-title').inputValue(), '');
      await confirmAction(true, () => page.getByRole('button', { name: 'Cancel', exact: true }).click());
      await page.waitForFunction(() => document.activeElement?.id === 'work-add-trigger');
      // Untouched project inheritance and validation messages are not a draft.
      await openIntake();
      assert.equal(await page.locator('#work-quick-project').inputValue(), project.id);
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expectDanger(page.locator('#work-quick-title-error'));
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.id === 'work-add-trigger');
      assert.equal(await page.locator('#work-add-trigger').evaluate(element => element === document.activeElement), true);
      await openIntake();
      await entry.getByRole('link', { name: 'View task history', exact: true }).click();
      await page.waitForURL('**/next?pack=work-regression-done&view=review');
      await followAppLink(page, 'Work');
      const before = await page.evaluate(key => localStorage.getItem(key), storageKey);
      await openIntake();
      await page.locator('#work-quick-notes').fill('A meaningful notes-only draft.');
      await confirmAction(false, () => page.getByRole('button', { name: 'Cancel', exact: true }).click());
      await page.waitForFunction(() => document.activeElement?.id === 'work-quick-title');
      assert.equal(await page.locator('#work-quick-notes').inputValue(), 'A meaningful notes-only draft.');
      assert.equal(await page.locator('#work-quick-title').evaluate(element => element === document.activeElement), true);
      await confirmAction(false, () => entry.getByRole('link', { name: 'View task history', exact: true }).click());
      await page.waitForFunction(() => document.activeElement?.id === 'work-quick-title');
      assert.equal(new URL(page.url()).pathname, '/work');
      assert.equal(await page.locator('#work-quick-title').evaluate(element => element === document.activeElement), true);
      await confirmAction(false, () => page.reload({ timeout: 1500 }).catch(() => {}), 'beforeunload');
      assert.equal(await page.locator('#work-quick-notes').inputValue(), 'A meaningful notes-only draft.');
      await confirmAction(true, () => page.getByRole('button', { name: 'Cancel', exact: true }).click());
      await page.waitForFunction(() => document.activeElement?.id === 'work-add-trigger');
      assert.equal(await page.locator('#work-add-trigger').evaluate(element => element === document.activeElement), true);
      // Hold the actual local storage lock to observe an in-flight save without a provider.
      await openIntake();
      await page.locator('#work-quick-title').fill('Busy intake fixture');
      await page.evaluate(key => { void navigator.locks.request(key + '-write', () => new Promise(resolve => { window.__releaseIntakeLock = resolve; })); }, storageKey);
      await page.waitForFunction(() => typeof window.__releaseIntakeLock === 'function');
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
      await entry.getByRole('link', { name: 'View task history', exact: true }).click();
      assert.equal(new URL(page.url()).pathname, '/work');
      await page.waitForFunction(() => document.activeElement?.id === 'work-intake-form');
      assert.equal(await page.locator('#work-intake-form').evaluate(element => element === document.activeElement), true);
      await confirmAction(false, () => page.reload({ timeout: 1500 }).catch(() => {}), 'beforeunload');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before, 'draft and held save do not persist early');
      await page.evaluate(() => window.__releaseIntakeLock());
      await page.locator('[data-work-intake-confirmation]').waitFor();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await page.locator('[data-work-intake-confirmation]').waitFor({ state: 'detached' });
      // Palette navigation cannot trigger background /, F, C/N or nested help.
      await page.getByRole('button', { name: 'Work menu', exact: true }).click();
      const menu = page.getByRole('dialog', { name: 'Work menu', exact: true }); await menu.waitFor();
      const focusModeBefore = await page.locator('[data-action="focus-mode"]').getAttribute('aria-pressed');
      for (const key of ['f', '/', 'c', 'n', '?', 'Control+k']) await page.keyboard.press(key);
      assert.equal(await page.getByRole('dialog').count(), 1);
      assert.equal(await page.locator('#work-intake-form').count(), 0);
      assert.equal(await page.locator('[data-action="focus-mode"]').getAttribute('aria-pressed'), focusModeBefore);
      assert.equal(await menu.evaluate(element => element.contains(document.activeElement)), true);
      await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Command palette', exact: true }).click();
      const palette = page.getByRole('dialog', { name: 'Commands', exact: true }); await palette.waitFor();
      const paletteSearch = palette.getByRole('combobox', { name: 'Find tasks or commands', exact: true });
      await page.waitForFunction(() => document.activeElement?.hasAttribute('data-nebius-command-search') === true);
      const queryBeforeKeys = await paletteSearch.inputValue();
      const command = palette.getByRole('option', { name: /Focus search/u });
      await command.focus();
      assert.equal(await command.evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('?'); await page.keyboard.press('f'); await page.keyboard.press('/');
      assert.equal(await page.getByRole('dialog').count(), 1);
      assert.equal(await paletteSearch.inputValue(), queryBeforeKeys, 'modal shortcut probe does not accidentally type into initial search autofocus');
      assert.equal(await command.evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Escape'); await palette.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Command palette', exact: true }).click(); await palette.waitFor();
      await palette.getByRole('option', { name: /^Add work/u }).click();
      await palette.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.id === 'work-quick-title');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.id === 'work-add-trigger');
      // Actual manual validation errors must remain readable in every explicit theme.
      await page.getByRole('button', { name: 'New project', exact: true }).click();
      await page.locator('#project-brief').fill('Author a local error fixture.');
      await page.getByRole('button', { name: 'Write plan myself', exact: true }).click();
      await page.getByRole('button', { name: 'Review plan', exact: true }).click();
      assert.equal(await page.locator('[data-project-plan-error]').innerText(), 'Project title must be nonempty text of at most 120 characters.');
      await expectDanger(page.locator('[data-project-plan-error]'));
      await page.screenshot({ path: path.resolve(`dist/nebius-work-errors-${theme}-${width}.png`), fullPage: true });
      await confirmAction(true, () => page.getByRole('button', { name: 'Discard draft', exact: true }).click());
      await page.getByRole('button', { name: 'Revise tasks', exact: true }).click();
      await page.locator('#project-update-text').fill('Check an unchanged manual proposal.');
      await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
      await page.getByRole('button', { name: 'Review changes', exact: true }).click();
      assert.equal(await page.locator('[data-project-replan-error]').innerText(), 'Change at least one task field before reviewing.');
      await expectDanger(page.locator('[data-project-replan-error]'));
      await confirmAction(true, () => page.getByRole('button', { name: 'Discard changes', exact: true }).click());
      // Fresh fixture states are scoped to this isolated context only.
      for (const terminal of [packs[1], packs[2]]) {
        await page.evaluate(({ key, pack }) => localStorage.setItem(key, JSON.stringify({ packs: [pack], selectedId: pack.id, pendingNextActionDrafts: [] })), { key: storageKey, pack: { ...terminal, projectId: undefined } });
        await page.reload(); await entry.getByText(terminal.title, { exact: true }).waitFor();
        assert.match(await entry.getByRole('link', { name: 'View task history', exact: true }).getAttribute('href'), /&view=review$/u);
        await entry.locator('[data-nebius-task-history]').waitFor();
        assert.equal(await entry.locator('[data-nebius-selected-next-step]').count(), 0, 'terminal task entry does not present an obsolete next step as current work');
        const oldContext = entry.locator('[data-nebius-historical-context]');
        if (await oldContext.count()) {
          assert.equal(await oldContext.evaluate(element => element.open), false, 'terminal context is collapsed initially');
          const savedTerminal = await page.evaluate(key => localStorage.getItem(key), storageKey);
          await oldContext.locator('summary').press('Enter');
          if (terminal.nextStep) assert((await oldContext.innerText()).includes(terminal.nextStep), 'historical next step remains available');
          assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), savedTerminal, 'inspecting history does not rewrite saved work');
          await oldContext.locator('summary').press('Enter');
        }
        await followAppLink(page, 'Task');
        await page.waitForURL(url => url.pathname === '/next' && (!url.searchParams.has('pack') || url.searchParams.get('pack') === terminal.id));
        await page.getByRole('heading', { level: 1, name: terminal.title, exact: true }).waitFor();
        await page.locator('[data-nebius-readonly-brief]').waitFor();
        assert.equal(await page.getByRole('button', { name: 'Generate suggestion', exact: true }).count(), 0);
        await page.reload();
        await page.getByRole('heading', { level: 1, name: terminal.title, exact: true }).waitFor();
        await page.locator('[data-nebius-readonly-brief]').waitFor();
        await followAppLink(page, 'Work');
        await entry.getByText(terminal.title, { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Command palette', exact: true }).click(); await palette.waitFor();
        const unavailableSearch = palette.getByRole('option', { name: /Focus search/u });
        assert.equal(await unavailableSearch.isDisabled(), true, 'clean one-item search command is unavailable');
        await page.keyboard.press('Escape'); await palette.waitFor({ state: 'hidden' });
        await page.keyboard.press('/');
        await page.getByText('Search is available when there are multiple tasks or active filters.', { exact: true }).filter({ visible: true }).waitFor();
        assert.equal(await page.locator('[aria-label="Filter work items by text"]').count(), 0);
      }
      await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ packs: [], pendingNextActionDrafts: [] })), storageKey);
      await page.reload(); await entry.getByText('Choose a task', { exact: true }).waitFor();
      assert.equal(await entry.getByRole('button', { name: 'Open task', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Command palette', exact: true }).click(); await palette.waitFor();
      assert.equal(await palette.getByRole('option', { name: /Focus search/u }).isDisabled(), true);
      await page.keyboard.press('Escape'); await palette.waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
      cases.push({ width, theme, passed: true, openingFocusMovementRetained: true, commandIntakeFocus: true, inheritedDefaultsClean: true, notesDraftCancelAndNavigation: true, dirtyAndBusyReloadPreserved: true,
        busyLocalSaveGuarded: true, selectedDoneAndArchivedHistory: true, bareTerminalTaskAndReload: true, listTitleNames: true, modalKeyboardOwnership: true, unavailableSearch: true,
        emptyTaskActionDisabled: true, intakePlanReplanDangerErrors: true, providerWrites: 0 });
    } catch (error) {
      cases.push({ width, theme, passed: false, error: error.message });
      await page.screenshot({ path: path.resolve(`dist/nebius-work-regression-failure-${theme}-${width}.png`), fullPage: true });
      throw error;
    } finally {
      await writeFile(path.resolve('dist/nebius-work-regression-progress.json'), JSON.stringify({ syntheticFixtures: true, expected, observed: cases.length,
        passed: cases.filter(item => item.passed).length, failed: cases.filter(item => item.passed === false).length, notRun: expected - cases.length, cases }, null, 2) + '\n');
      await context.close();
    }
  }
  assert.equal(cases.length, expected);
  return cases;
}

async function checkEvidenceReferenceChanges(browser) {
  const cases = [];
  for (const width of [375, 1280]) for (const direction of ['add', 'remove']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const errors = [], external = [], writes = [];
    const pack = { id: 'clarity-evidence', title: 'Review the handoff', status: 'active', purpose: 'Review the supplied handoff.', next: 'Review', nextStep: 'Record the review.', doneWhen: 'The handoff has been checked.', blocker: 'None', memory: [], activity: [], executionInputs: [{ id: 'packet', format: 'json' }] };
    const reference = { id: '00000000-0000-4000-8000-000000000153', key: 'b'.repeat(64), record: null,
      input: validateRunInput({ version: RUN_VERSION, packId: pack.id, pack: projectTask(pack), currentStatus: pack.status, context: [], requestedModel: reasoningModel, requiredInputFormats: pack.executionInputs, requiredOutputs: null, consent: true }) };
    if (direction === 'remove') pack.executionRun = structuredClone(reference);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.href); return route.abort(); }
      if (!['GET', 'HEAD'].includes(request.method())) { writes.push({ method: request.method(), path: url.pathname }); return route.abort(); }
      return route.continue();
    });
    await context.addInitScript(({ key, pack }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, revision: 'clarity-reference-initial', state: { packs: [pack], selectedId: pack.id, pendingNextActionDrafts: [] } }));
    }, { key: storageKey, pack });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000);
    try {
      await page.goto(origin + '/next?pack=' + pack.id + '&view=review');
      await page.getByRole('heading', { name: direction === 'add' ? 'Review task' : 'Review this build', exact: true }).waitFor();
      const evidence = `Unsaved ${direction} reference evidence must survive the other tab.`;
      await page.locator('#nebius-review-evidence').fill(evidence);
      const other = await context.newPage(); await other.goto(origin + '/work');
      const latest = await other.evaluate(({ key, reference, direction }) => {
        const envelope = JSON.parse(localStorage.getItem(key)), task = envelope.state.packs[0];
        if (direction === 'add') task.executionRun = reference; else delete task.executionRun;
        envelope.revision = 'clarity-reference-' + direction + '-other-tab';
        const value = JSON.stringify(envelope); localStorage.setItem(key, value); return value;
      }, { key: storageKey, reference, direction });
      const save = page.getByRole('button', { name: 'Save evidence', exact: true });
      if (await save.isEnabled()) await save.click();
      await page.getByRole('heading', { name: direction === 'add' ? 'Review this build' : 'Review task', exact: true }).waitFor();
      assert.equal(await page.locator('#nebius-review-evidence').inputValue(), evidence, 'same-task reference changes preserve the typed evidence');
      assert.equal(await page.getByLabel('Switch task', { exact: true }).isDisabled(), true, 'the retained dirty draft still guards task selection');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), latest, 'conflict must not overwrite the other tab or save the draft');
      await page.getByRole('button', { name: 'Discard evidence edits', exact: true }).click();
      assert.equal(await page.locator('#nebius-review-evidence').inputValue(), '');
      assert.equal(await page.getByLabel('Switch task', { exact: true }).isDisabled(), false);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), latest, 'discard changes no saved fields');
      assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
      cases.push({ width, direction, passed: true, draftPreserved: true, conflictDidNotSave: true, providerWrites: 0 });
    } catch (error) {
      cases.push({ width, direction, passed: false, error: error.message });
      await page.screenshot({ path: path.resolve(`dist/nebius-clarity-reference-${direction}-${width}-failure.png`), fullPage: true });
      throw error;
    } finally {
      await writeFile(path.resolve('dist/nebius-clarity-reference-progress.json'), JSON.stringify({ expected: 4, observed: cases.length, passed: cases.filter(c => c.passed).length, failed: cases.filter(c => !c.passed).length, notRun: 4 - cases.length, cases }, null, 2) + '\n');
      await context.close();
    }
  }
  return cases;
}

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
  const legacyPendingCases = await checkLegacyPendingCompatibility(browser);
  if (process.argv.includes('--legacy-only')) console.log(JSON.stringify({ syntheticFixtures: true, legacyPendingCases }, null, 2));
  else {
  const clarityReferenceCases = await checkEvidenceReferenceChanges(browser);
  if (process.argv.includes('--clarity-only')) console.log(JSON.stringify({ syntheticFixtures: true, clarityReferenceCases }, null, 2));
  else {
  const runStageCases = await checkRunStagePresentation(browser);
  const retirementCases = await checkUnavailableRequestRetirement(browser);
  const workRegressionCases = await checkWorkIntakeAndKeyboard(browser);
  for (const width of [375, 1280]) {
    failInference = false; configEnabled = true; proposalMode = 'next-step';
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const unexpected = [], errors = [];
    await context.addInitScript(() => {
      const registrations = [];
      Object.defineProperty(window, '__nebiusToolRegistrations', { value: registrations });
      Object.defineProperty(document, 'modelContext', { configurable: true, value: {
        registerTool(tool) { registrations.push(tool?.name ?? '(unnamed)'); }
      } });
    });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { unexpected.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const taskSeed = [
      { id: 'nebius-test', title: 'Plan the project handoff', status: 'active', owner: 'Mira', purpose: 'Agree the delivery plan.', next: 'Review', nextStep: 'Draft a date proposal.', blocker: 'Deadline not confirmed', doneWhen: 'Mira confirms the date.', memory: ['DO_NOT_SEND'], activity: [] },
      { id: 'nebius-extra', title: 'Check the agenda', status: 'active', next: 'Open', blocker: 'none', purpose: 'Prepare the meeting.', doneWhen: 'Agenda approved.' },
    ];
    await context.addInitScript(({ storageKey, packs }) => {
      if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify({
        packs,
        selectedId: 'nebius-test', pendingNextActionDrafts: [],
      }));
    }, { storageKey, packs: taskSeed });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.goto(`${origin}/work`);
    await page.locator('[data-nebius-work-entry]').getByText('Plan the project handoff', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__nebiusToolRegistrations), [], 'Work must not register browser model tools');
    assert.equal(await page.locator('nav .challenge-nav-control').evaluateAll(items => items.every(item => item.scrollWidth <= item.clientWidth + 1)), true, 'navigation labels fit their controls');
    await page.screenshot({ path: path.resolve(`dist/nebius-work-${width}.png`), fullPage: true });
    await page.locator('[data-nebius-work-entry]').getByRole('link', { name: 'Open task', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/next' && url.searchParams.get('pack') === 'nebius-test' && url.searchParams.get('view') === 'brief');
    const taskHeading = page.getByRole('heading', { level: 1, name: taskSeed[0].title, exact: true });
    await taskHeading.waitFor();
    assert.deepEqual(await page.evaluate(() => window.__nebiusToolRegistrations), [], 'Task must not register browser model tools');
    assert.equal(await taskHeading.count(), 1);
    assert.equal(await page.locator('#nebius-work-item').count(), 1, 'one task selector serves all tabs');
    const briefFields = page.locator('[data-nebius-brief-fields]');
    await briefFields.waitFor();
    assert((await briefFields.innerText()).includes(taskSeed[0].purpose));
    assert((await briefFields.innerText()).includes(taskSeed[0].nextStep));
    assert((await briefFields.innerText()).includes(taskSeed[0].doneWhen));
    assert.equal(await briefFields.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('[data-nebius-suggestion]')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'the task brief precedes AI controls in reading order');
    assert.equal(await page.getByLabel('Switch task', { exact: true }).inputValue(), taskSeed[0].id);
    assert.equal(await page.locator('[data-nebius-saved-next-step]').innerText(), 'Draft a date proposal.');
    assert.equal(new URL(page.url()).searchParams.get('pack'), 'nebius-test');
    const workSelector = page.getByLabel('Switch task');
    await workSelector.selectOption('nebius-extra');
    await waitForTaskSelection(page, 'nebius-extra');
    await page.getByRole('heading', { level: 1, name: taskSeed[1].title, exact: true }).waitFor();
    await page.reload(); await waitForTaskSelection(page, 'nebius-extra');
    await page.locator('[data-nebius-suggestion]').waitFor();
    assert.equal(await workSelector.inputValue(), 'nebius-extra');
    await workSelector.selectOption('nebius-test');
    await waitForTaskSelection(page, 'nebius-test');
    await page.goBack(); await waitForTaskSelection(page, 'nebius-extra');
    await page.getByRole('heading', { level: 1, name: taskSeed[1].title, exact: true }).waitFor();
    await page.goForward(); await waitForTaskSelection(page, 'nebius-test');
    await page.getByRole('heading', { level: 1, name: taskSeed[0].title, exact: true }).waitFor();
    await page.locator('[data-nebius-suggestion]').waitFor();
    const buttonActionPanel = page.locator('#nebius-button-action-panel');
    assert.equal(await buttonActionPanel.isVisible(), false, 'ordinary legacy action editor is absent from the Nebius task flow');
    assert.equal(await page.getByRole('button', { name: 'Show button action controls', exact: true }).count(), 0);
    const editsStart = posts.length;
    await page.locator('[data-nebius-task-editor] > summary').click();
    await page.locator('[data-nebius-task-editor] details > summary').filter({ hasText: 'Task context' }).click();
    await page.locator('#nebius-task-purpose').fill('Agree the delivery plan and stakeholders.');
    await followAppLink(page, 'Work', { expectBlocked: true });
    await page.getByText('Apply or discard your unsaved changes before leaving this page.', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/next');
    assert.equal(await page.locator('#nebius-task-purpose').inputValue(), 'Agree the delivery plan and stakeholders.');
    await page.locator('[data-nebius-task-editor] details > summary').filter({ hasText: 'Notes and sources' }).click();
    await page.locator('#nebius-task-notes').fill('DO_NOT_SEND\nPRIVATE_NOTE_TWO');
    await page.locator('#nebius-task-sources').fill('Meeting agenda excerpt');
    await page.locator('[data-nebius-task-editor]').getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].purpose === 'Agree the delivery plan and stakeholders.'; }, storageKey);
    await page.waitForFunction(() => document.activeElement?.matches('[data-nebius-task-editor] > summary'));
    await page.getByText('Changes applied.', { exact: true }).waitFor();
    assert.equal(posts.length, editsStart, 'editing task context must not request inference');
    // Validation reveals a required field even when its context disclosure is closed.
    await page.locator('[data-nebius-task-editor] > summary').click();
    const contextSummary = page.locator('[data-nebius-task-editor] details > summary').filter({ hasText: 'Task context' });
    await contextSummary.click();
    await page.locator('#nebius-task-title').fill('');
    await contextSummary.click();
    await page.locator('[data-nebius-task-editor]').getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByText('A title is required.', { exact: true }).waitFor();
    await page.locator('#nebius-task-title').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#nebius-task-title').isVisible(), true);
    assert.equal(await page.locator('#nebius-task-title').evaluate(element => element === document.activeElement), true, 'validation focuses the revealed title field');
    await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
    await page.locator('.context-picker summary').click();
    await page.locator('.context-choice').filter({ hasText: 'PRIVATE_NOTE_TWO' }).locator('input').check();
    await page.locator('.context-choice').filter({ hasText: 'Meeting agenda excerpt' }).locator('input').check();
    const generate = page.locator('[data-nebius-suggestion]').getByRole('button', { name: 'Generate suggestion', exact: true, includeHidden: true });
    await generate.waitFor();
    await page.screenshot({ path: path.resolve(`dist/nebius-workbench-${width}.png`), fullPage: true });
    const before = await page.evaluate(key => localStorage.getItem(key), storageKey), count = posts.length;
    await generate.focus(); await page.keyboard.press('Enter'); await page.locator('[data-nebius-result]').waitFor();
    assert.equal(posts.length, count + 1); assert.equal(posts.at(-1).consent, true);
    assert.equal(JSON.stringify(posts.at(-1)).includes('DO_NOT_SEND'), false);
    assert.equal(posts.at(-1).pack.nextStep, 'Draft a date proposal.');
    assert.equal(posts.at(-1).pack.purpose, 'Agree the delivery plan and stakeholders.');
    assert.equal(posts.at(-1).pack.next, undefined);
    assert.equal(posts.at(-1).currentStatus, 'active', 'manual context edits preserve the existing status');
    assert.equal(posts.at(-1).update, '');
    assert.deepEqual(posts.at(-1).context, [
      { kind: 'note', text: 'PRIVATE_NOTE_TWO' },
      { kind: 'source', text: 'Meeting agenda excerpt' },
    ]);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before, 'generation must not save');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow at ${width}`);
    await page.locator('[data-nebius-suggestion]').screenshot({ path: path.resolve(`dist/nebius-${width}.png`) });
    await page.locator('[data-nebius-suggestion]').getByRole('button', { name: 'Review changes', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.match(await page.locator('[data-nebius-task-preview]').innerText(), /Ask Mira to confirm the revised deadline/);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before, 'using suggestion only stages the editor');
    const approve = page.getByRole('button', { name: 'Apply changes', exact: true }); await approve.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Review task changes');
    await page.keyboard.press('Tab');
    assert.equal(await approve.evaluate(element => element === document.activeElement), true, 'Tab moves from the change review to human approval');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before, 'review only stages details');
    await page.keyboard.press('Enter');
    await page.waitForFunction(({ key, suggestion }) => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].nextStep === suggestion; }, { key: storageKey, suggestion });
    await page.waitForFunction(() => document.activeElement?.matches('[data-nebius-task-editor] > summary'));
    const after = await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); return saved.state || saved; }, storageKey);
    assert.equal(after.packs[0].next, 'Review');
    assert.equal(after.packs[0].status, 'active', 'next-step proposal alone does not silently change task status');
    assert.equal(after.packs[0].blocker, 'Deadline not confirmed');
    assert.deepEqual(after.pendingNextActionDrafts || [], []);
    // A supplied update can produce a multi-field draft; every field is reviewed before one save.
    proposalMode = 'block';
    await page.locator('#nebius-task-update').fill('Delivery date is still unconfirmed.');
    await followAppLink(page, 'Work', { expectBlocked: true });
    await page.getByText('Clear your task update before leaving this page.', { exact: true }).waitFor();
    assert.equal(await page.locator('#nebius-task-update').inputValue(), 'Delivery date is still unconfirmed.');
    assert.equal(await workSelector.isDisabled(), true, 'a typed update cannot disappear through task selection');
    const beforeMulti = await page.evaluate(key => localStorage.getItem(key), storageKey);
    await generate.click();
    await page.locator('[data-nebius-result]').waitFor();
    assert.equal(posts.at(-1).update, 'Delivery date is still unconfirmed.');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), beforeMulti);
    await page.locator('[data-nebius-suggestion]').getByRole('button', { name: 'Review changes', exact: true }).click();
    const changePreview = page.locator('[data-nebius-task-preview]');
    await changePreview.getByText('Delivery date still unconfirmed', { exact: false }).waitFor();
    assert.match(await changePreview.innerText(), /blocked/i);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), beforeMulti, 'multi-field preview is unsaved');
    if (width <= 500) assert.equal(await changePreview.locator('td').evaluateAll(cells => cells.every(cell => cell.getBoundingClientRect().width >= 180)), true, 'mobile change values have full readable width');
    await changePreview.screenshot({ path: path.resolve(`dist/nebius-change-draft-${width}.png`) });
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); const task = (saved.state || saved).packs[0]; return task.status === 'blocked' && task.blocker === 'Delivery date still unconfirmed'; }, storageKey);
    await page.getByRole('button', { name: 'Clear update', exact: true }).click();
    proposalMode = 'next-step';
    const beforeReview = await page.evaluate(key => localStorage.getItem(key), storageKey);
    await reachByTab(page, page.getByRole('tab', { name: 'Brief', exact: true }));
    await page.keyboard.press('End');
    assert.equal(await page.getByRole('tab', { name: 'Review', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('tab', { name: 'Review', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('heading', { name: 'Review task', exact: true }).waitFor();
    assert.equal(await page.locator('[data-nebius-task-review]').count(), 1);
    const reviewState = JSON.parse(beforeReview);
    assert.equal(await page.locator('[data-nebius-task-criteria] [data-current-full-criteria]').innerText(), (reviewState.state || reviewState).packs.find(pack => pack.id === 'nebius-test').doneWhen);
    assert.doesNotMatch(await page.locator('#task-panel-review').innerText(), /Review this build|No saved run|Results unverified|Build evidence/u, 'ordinary task review contains no empty build sections');
    if (!await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open)) {
      await page.locator('[data-nebius-evidence-review] > summary').click();
    }
    assert.equal(await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open), true);
    await page.locator('#nebius-review-evidence').fill('Mira sent a proposed date. Confirmation is still pending.');
    assert.equal(await page.getByRole('button', { name: 'Save evidence', exact: true }).evaluate(element => element.classList.contains('is-primary')), true, 'Unsaved evidence has the primary save action.');
    assert.equal(await workSelector.isDisabled(), true, 'unsaved evidence protects task selection');
    assert.equal(await page.locator('#nebius-task-purpose').isDisabled(), true, 'task editing cannot replace a dirty evidence draft');
    assert.equal(await generate.isDisabled(), true, 'another suggestion cannot replace context during evidence editing');
    await followAppLink(page, 'Work', { expectBlocked: true });
    await page.getByText('Apply or discard your unsaved changes before leaving this page.', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/next');
    assert.equal(await page.locator('#nebius-review-evidence').inputValue(), 'Mira sent a proposed date. Confirmation is still pending.');
    let unloadDialogs = 0;
    page.once('dialog', async dialog => { assert.equal(dialog.type(), 'beforeunload'); unloadDialogs++; await dialog.dismiss(); });
    await page.reload({ timeout: 1500 }).catch(() => {});
    assert.equal(unloadDialogs, 1, 'reloading a dirty evidence draft asks the browser to preserve unsaved work');
    await page.getByRole('button', { name: 'Discard evidence edits', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#nebius-review-evidence').inputValue(), '');
    assert.equal(await workSelector.isDisabled(), false, 'discard releases the task selector');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), beforeReview, 'discarding evidence does not save');
    await page.locator('#nebius-review-evidence').fill('Mira sent a proposed date. Confirmation is still pending.');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), beforeReview, 'editing evidence remains unsaved until Save evidence');
    await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].completionEvidence?.startsWith('Mira sent a proposed date.'); }, storageKey);
    const recorded = await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); return saved.state || saved; }, storageKey);
    assert.notEqual(recorded.packs[0].status, 'done');
    assert.equal(await page.getByRole('button', { name: 'Mark done with recorded evidence', exact: true }).evaluate(element => element.classList.contains('is-primary')), true, 'After evidence is saved, the separate completion decision becomes primary.');
    assert.equal(await page.getByRole('button', { name: 'Save evidence', exact: true }).evaluate(element => element.classList.contains('is-primary')), false);
    await page.reload();
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    await page.locator('#nebius-review-evidence').waitFor();
    assert.equal(await page.locator('#nebius-review-evidence').inputValue(), recorded.packs[0].completionEvidence, 'saved evidence survives a return visit');
    assert.equal(await page.locator('#nebius-written-step').count(), 1, 'saved written step remains editable after reload');
    const beforeOffline = posts.length;
    await page.getByRole('tab', { name: 'Brief', exact: true }).click();
    await page.locator('#nebius-task-update').fill('Preserve this update while offline.');
    await context.setOffline(true);
    await page.getByText('You are offline. Browser-local edits remain available.', { exact: false }).waitFor();
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    await page.getByText('Offline · you can still record evidence', { exact: false }).waitFor();
    assert.equal(await page.locator('#nebius-task-update').inputValue(), 'Preserve this update while offline.');
    await page.getByRole('link', { name: 'Finish or clear the update', exact: true }).click();
    // Recovery switches tabs and reveals the update before moving focus.
    await page.waitForFunction(() => document.activeElement?.id === 'nebius-task-update');
    assert.equal(await page.locator('#nebius-task-update').evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Clear update', exact: true }).click();
    assert.equal(await page.locator('#nebius-task-update').count(), 0, 'empty update input closes while offline');
    await page.locator('[data-nebius-task-editor] > summary').click();
    await page.locator('#nebius-task-blocker').fill('Deadline still unconfirmed after an offline edit.');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].blocker === 'Deadline still unconfirmed after an offline edit.'; }, storageKey);
    assert.equal(await generate.isDisabled(), true);
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    assert.equal(posts.length, beforeOffline, 'going offline must not start inference');
    await context.setOffline(false);
    await page.getByText('You are offline. Browser-local edits remain available.', { exact: false }).waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: 'Brief', exact: true }).click();
    await generate.waitFor(); failInference = true;
    await generate.click(); await page.getByText('A suggestion is unavailable. Reload the preview to try again.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-nebius-result]').count(), 0);
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE_PROVIDER_DETAILS'), false);
    configEnabled = false; failInference = false;
    const unavailableCount = posts.length;
    await page.reload();
    await page.getByText('Nebius is unavailable here.', { exact: false }).waitFor();
    assert.equal(await page.locator('#nebius-task-update').count(), 0, 'unavailable generation does not invite an unusable update draft');
    assert.equal(await page.locator('[data-nebius-saved-next-step]').isVisible(), true, 'saved next step remains visible without inference');
    assert.equal(posts.length, unavailableCount);
    await page.goto(`${origin}/work`);
    await page.getByRole('button', { name: 'Add work', exact: true }).click();
    await page.getByRole('textbox', { name: 'Task title (required)', exact: true }).fill('Organize vendor review');
    await page.locator('.quick-create-options summary').click();
    await page.locator('#work-quick-purpose').fill('Choose a reviewer.');
    await page.locator('#work-quick-written-next').fill('Ask Taylor to review the proposal.');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs.some(pack => pack.title === 'Organize vendor review' && pack.nextStep === 'Ask Taylor to review the proposal.'); }, storageKey);
    await page.goto(`${origin}/next?pack=nebius-test`);
    await page.locator('[data-nebius-task-editor] > summary').click();
    await page.locator('[data-nebius-task-editor] details > summary').filter({ hasText: 'Task context' }).click();
    await page.locator('#nebius-task-purpose').fill('Unsaved first-tab edit.');
    const otherPage = await context.newPage();
    otherPage.on('pageerror', error => errors.push(error.message));
    await otherPage.goto(`${origin}/next?pack=nebius-test`);
    await otherPage.locator('[data-nebius-task-editor] > summary').click();
    await otherPage.locator('[data-nebius-task-editor] details > summary').filter({ hasText: 'Task context' }).click();
    await otherPage.locator('#nebius-task-purpose').fill('Saved in the other tab.');
    await otherPage.getByRole('button', { name: 'Review changes', exact: true }).click();
    await otherPage.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await otherPage.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].purpose === 'Saved in the other tab.'; }, storageKey);
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await page.getByText('Workspace changed by another tab. Refresh this tab and try again.', { exact: true }).waitFor();
    const conflictState = await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); return saved.state || saved; }, storageKey);
    assert.equal(conflictState.packs[0].purpose, 'Saved in the other tab.');
    await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.matches('[data-nebius-task-editor] > summary'));
    await page.reload();
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    await otherPage.getByRole('tab', { name: 'Review', exact: true }).click();
    await page.locator('#nebius-review-evidence').fill('First-tab evidence that must not overwrite another saved version.');
    await otherPage.locator('#nebius-review-evidence').fill('Mira sent a proposed date. The other tab recorded a later observation.');
    await otherPage.getByRole('button', { name: 'Save evidence', exact: true }).click();
    await otherPage.getByText('Evidence saved. The task is still open.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
    await page.getByText('Workspace changed by another tab. Refresh this tab and try again.', { exact: true }).waitFor();
    assert.equal(await page.locator('#nebius-review-evidence').inputValue(), 'First-tab evidence that must not overwrite another saved version.', 'failed stale save retains the typed evidence');
    const savedEvidenceAfterConflict = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).state.packs[0].completionEvidence, storageKey);
    assert.equal(savedEvidenceAfterConflict, 'Mira sent a proposed date. The other tab recorded a later observation.');
    await page.getByRole('button', { name: 'Discard evidence edits', exact: true }).click();
    const completionNavigationStarted = Date.now();
    try {
      await Promise.all([
        otherPage.waitForURL('**/work?focus=nebius-test', { timeout: 10000 }),
        otherPage.getByRole('button', { name: 'Mark done with recorded evidence', exact: true }).click(),
      ]);
      await otherPage.getByRole('heading', { name: 'Work', level: 1, exact: true }).waitFor();
    }
    catch {
      // The other tab may be between documents; read shared state in this stable tab.
      const snapshot = await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); const item = (saved.state || saved).packs.find(pack => pack.id === 'nebius-test'); return { status: item?.status, completionEvidence: Boolean(item?.completionEvidence) }; }, storageKey);
      throw new Error(`Completion did not navigate: ${otherPage.url()}; saved: ${JSON.stringify(snapshot)}; page errors: ${errors.join(' | ')}`);
    }
    const completionNavigationMs = Date.now() - completionNavigationStarted;
    await otherPage.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].status === 'done'; }, storageKey);
    const completed = await otherPage.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); return saved.state || saved; }, storageKey);
    assert(completed.packs[0].activity.some(item => item.includes('Marked done with supplied completion evidence.')));
    assert(completed.packs[0].activity.every(item => !item.includes('Proof saved: Mira confirms the date.')));
    await otherPage.goto(`${origin}/work?menu=backup`);
    await otherPage.getByRole('dialog', { name: 'Work menu', exact: true }).waitFor();
    await otherPage.getByRole('button', { name: 'Prepare backup', exact: true }).click();
    const downloadPromise = otherPage.waitForEvent('download');
    await otherPage.getByRole('link', { name: 'Download backup' }).click();
    const exportedText = await readFile(await (await downloadPromise).path(), 'utf8');
    const exported = JSON.parse(exportedText), exportedPack = exported.state.packs.find(pack => pack.id === 'nebius-test');
    assert.equal(exportedPack.nextStep, suggestion);
    assert(exportedPack.completionEvidence.startsWith('Mira sent a proposed date.'));
    assert.deepEqual(exportedPack.memory, ['DO_NOT_SEND', 'PRIVATE_NOTE_TWO']);
    const beforeImportRevision = exported.revision;
    await otherPage.locator('.work-backup-import input').setInputFiles({ name: 'projects-workspace.json', mimeType: 'application/json', buffer: Buffer.from(exportedText) });
    await otherPage.getByRole('button', { name: 'Replace', exact: true }).click();
    await otherPage.getByRole('button', { name: 'Confirm replace', exact: true }).click();
    await otherPage.waitForFunction(({ key, revision }) => JSON.parse(localStorage.getItem(key)).revision !== revision, { key: storageKey, revision: beforeImportRevision });
    const imported = await otherPage.evaluate(key => JSON.parse(localStorage.getItem(key)).state.packs.find(pack => pack.id === 'nebius-test'), storageKey);
    assert.equal(imported.nextStep, suggestion);
    assert.equal(imported.completionEvidence, exportedPack.completionEvidence);
    await otherPage.close();
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    results.push({ width, workEntry: true, taskSelection: true, taskSelectionUrlReloadBackForward: true, legacyEditorHidden: true, multiFieldDraftReviewed: true, statusPreservedByTextEdit: true, contextEditNoInference: true, privateNotesExcluded: true, generationNoSave: true, useNoSave: true, reviewBeforeApprove: true, saveFocusVisible: true, unsavedNavigationGuard: true, evidenceDiscardNoSave: true, staleEvidenceRetained: true, writtenStepSaved: true, returnVisitPersistence: true, buttonActionUnchanged: true, evidenceRecordedBeforeDone: true, offlineLocalSaveNoSpend: true, humanCompletion: true, completionNavigationMs, exportImportRoundtrip: true, failureRedacted: true, unavailableNoSpend: true, meaningfulQuickCreate: true, staleTabRefused: true, overflow: false });
    await context.close();
  }
  // Existing action drafts remain recoverable after the new proposal flow takes over.
  const recoveryCases = [];
  configEnabled = true; proposalMode = 'next-step';
  for (const action of ['discard', 'approve']) {
    const legacyState = { packs: [{ id: 'legacy-pending', title: 'Resume earlier approval', status: 'active', next: 'Review', blocker: 'none', purpose: 'Keep saved decisions recoverable.', activity: [] }], selectedId: 'legacy-pending', pendingNextActionDrafts: [] };
    revisePendingDraftChoice(legacyState, { workId: 'legacy-pending', choice: 'Focus', mode: 'preset' }, item => ({ title: item.title, workflow: 'Ready', blocker: null, next: item.next }));
    const legacyContext = await browser.newContext({ viewport: { width: 375, height: 900 }, serviceWorkers: 'block' });
    await legacyContext.addInitScript(({ storageKey, state }) => { if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify(state)); }, { storageKey, state: legacyState });
    const legacyPage = await legacyContext.newPage();
    await legacyPage.goto(`${origin}/next?pack=legacy-pending`);
    const legacyPanel = legacyPage.locator('#nebius-button-action-panel');
    await legacyPanel.waitFor({ state: 'visible' });
    const stateBefore = await legacyPage.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    await legacyPage.getByRole('link', { name: 'Resolve pending action', exact: true }).click();
    await legacyPage.waitForFunction(() => document.activeElement?.id === 'nebius-button-action-panel', null, { timeout: 10000 });
    assert.equal(await legacyPanel.evaluate(element => element === document.activeElement), true, 'pending draft resolution focuses its approval panel');
    assert.deepEqual(await legacyPage.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), stateBefore, 'resolving the view does not save the draft');
    await legacyPanel.getByRole('button', { name: action === 'discard' ? 'Discard draft' : 'Approve and save', exact: true }).click();
    await legacyPage.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).pendingNextActionDrafts.length === 0; }, storageKey);
    const stateAfter = await legacyPage.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    const oldTask = (stateBefore.state || stateBefore).packs[0], newTask = (stateAfter.state || stateAfter).packs[0];
    assert.equal(newTask.next, action === 'discard' ? oldTask.next : 'Focus');
    assert.equal(newTask.status, oldTask.status);
    if (action === 'approve') await legacyPanel.getByText('Next action set to "Focus".', { exact: true }).waitFor({ state: 'visible' });
    recoveryCases.push({ action, pendingCleared: true, taskStatusPreserved: true });
    await legacyPage.getByRole('tab', { name: 'Review', exact: true }).click();
    await legacyPage.getByRole('heading', { name: 'Completion criteria', exact: true }).waitFor();
    assert.equal(await legacyPage.locator('[data-current-full-criteria]').innerText(), 'No completion criteria saved.');
    await legacyContext.close();
  }
  // A proposed clearance cannot remove a linked dependency behind the person's back.
  proposalMode = 'clear';
  const linkedContext = await browser.newContext({ viewport: { width: 375, height: 900 }, serviceWorkers: 'block' });
  await linkedContext.addInitScript(({ storageKey }) => { if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify({
    packs: [{ id: 'linked-work', title: 'Prepare the delivery', status: 'blocked', blocker: 'Awaiting the source task', blockedBy: 'source-work', next: 'Review', nextStep: 'Check dependency progress.', purpose: 'Prepare delivery.', doneWhen: 'Source task complete.', activity: [] },
      { id: 'source-work', title: 'Approve delivery inputs', status: 'active', blocker: 'none', next: 'Open', activity: [] }], selectedId: 'linked-work', pendingNextActionDrafts: []
  })); }, { storageKey });
  const linkedPage = await linkedContext.newPage();
  await linkedPage.goto(`${origin}/next?pack=linked-work`);
  await linkedPage.getByRole('button', { name: 'Generate suggestion', exact: true }).click();
  await linkedPage.locator('[data-nebius-result]').waitFor();
  const linkedBefore = await linkedPage.evaluate(key => localStorage.getItem(key), storageKey);
  await linkedPage.locator('[data-nebius-suggestion]').getByRole('button', { name: 'Review changes', exact: true }).click();
  await linkedPage.getByText('This task has a linked dependency.', { exact: false }).waitFor();
  assert.equal(await linkedPage.getByRole('button', { name: 'Apply changes', exact: true }).count(), 0);
  assert.equal(await linkedPage.evaluate(key => localStorage.getItem(key), storageKey), linkedBefore);
  await linkedContext.close();
  proposalMode = 'next-step';
  const guideHtml = await readFile(path.join(root, 'webmcp-challenge.html'), 'utf8');
  assert.match(guideHtml, /Opening the current page/u, 'prerendered saved link opens the current help owner');
  assert.doesNotMatch(guideHtml, /Brief for the browser agent/u, 'Nebius guide does not embed the old browser-agent tutorial');
  const keyboardCases = [];
  for (const width of [375, 1280]) {
  configEnabled = true;
  // Playwright's block-mode init script reads navigator.serviceWorker in every
  // frame; that getter throws in the landing example's opaque sandbox. Use a
  // fresh normal context so the app's actual sandbox policy owns that denial.
  const freshContext = await browser.newContext({ viewport: { width, height: 900 } });
  const freshPage = await freshContext.newPage();
  freshPage.setDefaultTimeout(10000);
  const keyboardErrors = [];
  const keyboardExternalRequests = [];
  freshPage.on('pageerror', error => keyboardErrors.push(error.message));
  await freshContext.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { keyboardExternalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await freshPage.goto(`${origin}/work`);
  await freshPage.locator('[data-project-details] > summary').filter({ hasText: '4 workspace tasks' }).waitFor();
  await freshPage.getByRole('link', { name: 'Open task Decide whether the release is ready', exact: true }).waitFor();
  await reachByTab(freshPage, freshPage.locator('[data-nebius-work-entry]').getByRole('link', { name: 'Open task', exact: true }));
  await freshPage.keyboard.press('Enter');
  await freshPage.waitForURL('**/next?pack=*');
  await reachByTab(freshPage, freshPage.getByLabel('Switch task', { exact: true }));
  await freshPage.keyboard.press('Home');
  await waitForTaskSelection(freshPage, 'nebius-release-health');
  await reachByTab(freshPage, freshPage.getByLabel('Switch task', { exact: true }));
  await freshPage.keyboard.press('ArrowDown');
  await waitForTaskSelection(freshPage, 'nebius-onboarding-copy');
  await reachByTab(freshPage, freshPage.getByLabel('Switch task', { exact: true }));
  await freshPage.keyboard.press('ArrowDown');
  await waitForTaskSelection(freshPage, 'nebius-keyboard-review');
  assert.equal(await freshPage.getByLabel('Switch task', { exact: true }).inputValue(), 'nebius-keyboard-review');
  await reachByTab(freshPage, freshPage.getByRole('button', { name: 'Generate suggestion', exact: true }));
  await freshPage.keyboard.press('Enter');
  await freshPage.locator('[data-nebius-result]').waitFor();
  await reachByTab(freshPage, freshPage.locator('[data-nebius-suggestion]').getByRole('button', { name: 'Review changes', exact: true }));
  await freshPage.keyboard.press('Enter');
  await freshPage.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Review task changes');
  await freshPage.keyboard.press('Tab');
  await freshPage.keyboard.press('Enter');
  await freshPage.getByText('Changes applied.', { exact: true }).waitFor();
  await reachByTab(freshPage, freshPage.getByRole('tab', { name: 'Brief', exact: true }));
  await freshPage.keyboard.press('End');
  assert.equal(await freshPage.getByRole('tab', { name: 'Review', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await freshPage.getByRole('tab', { name: 'Review', exact: true }).evaluate(element => element === document.activeElement), true);
  await reachByTab(freshPage, freshPage.locator('[data-nebius-evidence-review] > summary'));
  if (!await freshPage.locator('[data-nebius-evidence-review]').evaluate(element => element.open)) {
    await freshPage.keyboard.press('Enter');
  }
  assert.equal(await freshPage.locator('[data-nebius-evidence-review]').evaluate(element => element.open), true);
  await reachByTab(freshPage, freshPage.locator('#nebius-review-evidence'));
  await freshPage.keyboard.type('Keyboard traversal observation: Work and Next controls were reachable. Dialog checks remain incomplete.');
  await reachByTab(freshPage, freshPage.getByRole('button', { name: 'Save evidence', exact: true }));
  await freshPage.keyboard.press('Enter');
  await freshPage.getByText('Evidence saved. The task is still open.', { exact: true }).waitFor();
  assert.equal(await freshPage.locator('#nebius-button-action-panel').isVisible(), false, 'normal Nebius work uses the unified task editor');
  await reachByTab(freshPage, freshPage.getByRole('tab', { name: 'Review', exact: true }));
  await freshPage.keyboard.press('Home');
  assert.equal(await freshPage.getByRole('tab', { name: 'Brief', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await freshPage.getByRole('tab', { name: 'Brief', exact: true }).evaluate(element => element === document.activeElement), true);
  await reachByTab(freshPage, freshPage.getByRole('button', { name: 'Advanced options', exact: true }));
  await freshPage.keyboard.press('Enter');
  await reachByTab(freshPage, freshPage.locator('details.worn-accordion > summary').filter({ hasText: 'Choose another item' }));
  await freshPage.keyboard.press('Enter');
  const candidateGeometry = await freshPage.locator('.next-other-list [data-pack-id]').evaluateAll(rows => rows.map(row => {
    const card = row.getBoundingClientRect(), description = row.firstElementChild.getBoundingClientRect();
    const actions = row.querySelector('.demo-row-actions').getBoundingClientRect();
    return { rowWidth: card.width, textWidth: description.width, actionGap: actions.top - description.bottom, buttonHeights: [...row.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) };
  }));
  assert(candidateGeometry.length > 0);
  for (const row of candidateGeometry) {
    assert(row.buttonHeights.every(height => height > 0 && height <= 80), 'candidate actions keep their normal height');
    if (width <= 500) {
      assert(row.textWidth >= row.rowWidth * 0.8, 'mobile candidate description spans the card');
      assert(row.actionGap >= 8, 'mobile candidate actions sit below the description');
    }
  }
  await freshPage.locator('.next-other-list').screenshot({ path: path.resolve(`dist/nebius-candidates-${width}.png`) });
  await freshPage.goto(origin + '/guide');
  await freshPage.waitForURL(url => url.pathname === '/landing.html' && url.hash === '#help');
  await freshPage.locator('#help').waitFor();
  assert.equal(await freshPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Saved Help link fits the viewport');
  await freshPage.screenshot({ path: path.resolve(`dist/nebius-usability-help-${width}.png`), fullPage: true });
  assert.deepEqual(keyboardErrors, []);
  assert.deepEqual(keyboardExternalRequests, []);
  keyboardCases.push({ width, workToNext: true, modelGuidanceToSave: true, reviewToRecordedEvidence: true, candidateLayout: candidateGeometry, unifiedProposalApproval: true, helpSavedLink: true });
  await freshContext.close();
  }
  const providerFailureCases = [];
  const operation = 'suggest-next-step';
  for (const width of [375, 1280]) for (const mode of ['known', 'unknown', 'pre-provider']) {
    configEnabled = true; failInference = true;
    failureCode = mode === 'pre-provider' ? 'daily_limit' : 'invalid_model_output';
    failureStatus = mode === 'pre-provider' ? 429 : 502;
    failureMetadata = mode === 'pre-provider' ? null : { providerAttempted: true, usageUnknown: mode === 'unknown',
      usage: mode === 'unknown' ? null : { input_tokens: 45, output_tokens: 90 }, diagnostic: '<img src=x onerror="window.__badFailure=true">' };
    const failureContext = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const failurePage = await failureContext.newPage(); failurePage.setDefaultTimeout(10000);
    const errors = [], external = [];
    failurePage.on('pageerror', error => errors.push(error.message));
    await failureContext.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    try {
      await failurePage.goto(`${origin}/next?pack=nebius-release-health`);
      const savedBefore = await failurePage.evaluate(key => localStorage.getItem(key), storageKey);
      await reachByTab(failurePage, failurePage.getByRole('button', { name: 'Generate suggestion', exact: true }));
      await failurePage.keyboard.press('Enter');
      const details = failurePage.locator('[data-nebius-failure]');
      if (mode === 'pre-provider') {
        await failurePage.getByText('The demo has reached its daily generation limit.', { exact: true }).waitFor();
        assert.equal(await details.count(), 0, 'a refused request does not fabricate provider details');
      } else {
        await details.waitFor(); const summary = details.locator('summary');
        await reachByTab(failurePage, summary); await failurePage.keyboard.press('Enter');
        assert.equal(await details.evaluate(element => element.open), true);
        assert.equal(await summary.evaluate(element => element.matches(':focus-visible')), true);
        // Measure the settled target, after the panel's scale arrival animation.
        await summary.evaluate(element => Promise.all((element.closest('.demo-panel')?.getAnimations() ?? []).map(animation => animation.finished)));
        assert(await summary.evaluate(element => element.getBoundingClientRect().height >= 44));
        const text = await details.innerText();
        assert(text.includes(mode === 'known' ? 'Provider reported 45 input tokens and 90 output tokens.' : 'Provider token usage was not reported.'));
        assert(text.includes('No task changes were saved by this request.'));
        assert.equal(await failurePage.locator('img[src="x"]').count(), 0, 'diagnostic markup is escaped');
        assert.equal(await failurePage.evaluate(() => Boolean(window.__badFailure)), false);
        assert.equal(await failurePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await details.screenshot({ path: path.resolve(`dist/nebius-failure-${operation}-${mode}-${width}.png`) });
      }
      assert.equal(await failurePage.locator('[data-nebius-result]').count(), 0);
      assert.equal(await failurePage.evaluate(key => localStorage.getItem(key), storageKey), savedBefore, 'failed inference saves no work');
      assert.equal((await failurePage.locator('body').innerText()).includes('PRIVATE_PROVIDER_DETAILS'), false);
      await failurePage.getByLabel('Switch task', { exact: true }).selectOption('nebius-keyboard-review');
      await details.waitFor({ state: 'detached' });
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      providerFailureCases.push({ width, operation, mode, noSavedWork: true, noRejectedResult: true,
        detailsClearedOnInputChange: mode === 'pre-provider' ? null : true, keyboardDetailsObserved: mode === 'pre-provider' ? null : true, escapedDiagnostic: mode === 'pre-provider' ? null : true });
      await writeFile(path.resolve('dist/nebius-provider-failure-progress.json'), JSON.stringify({ syntheticInference: true, expected: 6, observed: providerFailureCases.length, cases: providerFailureCases }, null, 2) + '\n');
    } catch (error) {
      providerFailureCases.push({ width, operation, mode, passed: false, error: error.message });
      await writeFile(path.resolve('dist/nebius-provider-failure-progress.json'), JSON.stringify({ syntheticInference: true, expected: 6, observed: providerFailureCases.length, failed: true, cases: providerFailureCases }, null, 2) + '\n');
      throw error;
    } finally { await failureContext.close(); }
  }
  failInference = false; failureMetadata = null; failureStatus = 502; failureCode = 'nebius_request_failed';
  console.log(JSON.stringify({ syntheticInference: true, freshSyntheticWorkItems: 4, linkedDependencyClearanceRefused: true, legacyPendingCases, clarityReferenceCases, runStageCases, retirementCases, workRegressionExpected: 8, workRegressionCases, recoveryCases, keyboardCases, providerFailureCases, cases: results }, null, 2));
  }
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
