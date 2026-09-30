import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { revisePendingDraftChoice } from '../svelte-frontend/src/lib/pending-next-action.mjs';
import { OPERATION_PROFILES } from '../svelte-frontend/src/lib/nebius-routing-contract.mjs';

const root = path.resolve('dist/static-publish');
const model = 'nvidia/synthetic-model';
const reasoningModel = 'nvidia/synthetic-reasoning-model';
const suggestion = 'Ask Mira to confirm the revised deadline.';
const storageKey = 'projects-webmcp-challenge-state-v1';
const config = { available: true, requestedModel: model, promptVersion: 'task-change.v1' };
const posts = [];
const reviewPosts = [];
async function reachByTab(page, locator) {
  await locator.waitFor({ state: 'visible' });
  for (let step = 0; step < 100; step++) {
    if (await locator.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard could not reach ${await locator.evaluate(element => element.textContent || element.getAttribute('aria-label') || element.id)}`);
}
let failInference = false;
let configEnabled = true;
let proposalMode = 'next-step';
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/nebius/')) {
    response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store');
    if (url.pathname === '/api/nebius/config' && request.method === 'GET') {
      const operation = url.searchParams.get('operation');
      if (!Object.hasOwn(OPERATION_PROFILES, operation)) { response.statusCode = 400; response.end('{}'); return; }
      if (!configEnabled) response.statusCode = 404;
      response.end(JSON.stringify(configEnabled ? { ...config, operation, ...OPERATION_PROFILES[operation], requestedModel: operation === 'suggest-next-step' ? model : reasoningModel, reviewVersion: 'nebius-review.v1' } : { code: 'nebius_disabled' })); return;
    }
    if (url.pathname === '/api/nebius/suggest-next-step' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk;
      posts.push(JSON.parse(text));
      if (failInference) { response.statusCode = 502; response.end(JSON.stringify({ code: 'nebius_request_failed', error: 'PRIVATE_PROVIDER_DETAILS' })); return; }
      const changes = proposalMode === 'block' ? { nextStep: suggestion, blocker: 'Delivery date still unconfirmed', status: 'blocked' }
        : proposalMode === 'clear' ? { nextStep: suggestion, blocker: 'None', status: 'active' } : { nextStep: suggestion };
      response.end(JSON.stringify({ ...config, model, applied: false, suggestion: { changes, reason: 'The deadline is not confirmed.', basis: ['purpose', 'blocker', ...(posts.at(-1).context.length ? ['context:0'] : [])], missingInformation: ['Confirmed deadline'] }, usage: { input_tokens: 30, output_tokens: 20 } })); return;
    }
    if (url.pathname === '/api/nebius/review-evidence' && request.method === 'POST') {
      let text = ''; for await (const chunk of request) text += chunk;
      const requestBody = JSON.parse(text); reviewPosts.push(requestBody);
      assert.equal(requestBody.requestedModel, reasoningModel);
      response.end(JSON.stringify({ ...config, requestedModel: reasoningModel, promptVersion: 'nebius-review.v1', model: reasoningModel, applied: false, review: {
        checks: requestBody.review.criteria.map(item => ({ id: item.id, assessment: 'partial', reason: 'The supplied text does not establish every selected criterion.', quote: requestBody.review.evidence.slice(0, 500) })),
        consistency: { assessment: 'consistent', reason: 'No conflict appears in the supplied text.' },
      }, usage: { input_tokens: 45, output_tokens: 30 } })); return;
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
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
  for (const width of [375, 1280]) {
    failInference = false; configEnabled = true; proposalMode = 'next-step';
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const unexpected = [], errors = [];
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
    await page.locator('[data-nebius-work-entry]').getByText('Selected: Plan the project handoff', { exact: false }).waitFor();
    assert.equal(await page.locator('nav .challenge-nav-control').evaluateAll(items => items.every(item => item.scrollWidth <= item.clientWidth + 1)), true, 'navigation labels fit their controls');
    await page.screenshot({ path: path.resolve(`dist/nebius-work-${width}.png`), fullPage: true });
    await page.locator('[data-nebius-work-entry]').getByRole('link', { name: 'Open next step' }).click();
    await page.waitForURL('**/next?pack=nebius-test');
    const taskHeading = page.getByRole('heading', { level: 1, name: taskSeed[0].title, exact: true });
    await taskHeading.waitFor();
    assert.equal(await taskHeading.count(), 1);
    assert.equal(await page.getByLabel('Switch task', { exact: true }).inputValue(), taskSeed[0].id);
    assert.equal(await page.locator('[data-nebius-saved-next-step]').innerText(), 'Draft a date proposal.');
    assert.equal(new URL(page.url()).searchParams.get('pack'), 'nebius-test');
    const workSelector = page.getByLabel('Switch task');
    await workSelector.selectOption('nebius-extra');
    await page.locator('[data-nebius-suggestion]').waitFor();
    assert.equal(await workSelector.inputValue(), 'nebius-extra');
    await workSelector.selectOption('nebius-test');
    await page.locator('[data-nebius-suggestion]').waitFor();
    const buttonActionPanel = page.locator('#nebius-button-action-panel');
    assert.equal(await buttonActionPanel.isVisible(), false, 'ordinary legacy action editor is absent from the Nebius task flow');
    assert.equal(await page.getByRole('button', { name: 'Show button action controls', exact: true }).count(), 0);
    const editsStart = posts.length;
    await page.locator('[data-nebius-task-editor] > summary').click();
    await page.locator('[data-nebius-task-editor] details > summary').filter({ hasText: 'Task context' }).click();
    await page.locator('#nebius-task-purpose').fill('Agree the delivery plan and stakeholders.');
    await page.getByRole('link', { name: 'Work', exact: true }).click();
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
    await page.getByRole('link', { name: 'Work', exact: true }).click();
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
    const beforeReview = await page.evaluate(key => localStorage.getItem(key), storageKey), reviewCount = reviewPosts.length;
    await reachByTab(page, page.getByRole('tab', { name: 'Next step', exact: true }));
    await page.keyboard.press('End');
    assert.equal(await page.getByRole('tab', { name: 'Evidence', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('tab', { name: 'Evidence', exact: true }).evaluate(element => element === document.activeElement), true);
    assert.equal(await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open), true);
    await page.locator('#nebius-review-evidence').fill('Mira sent a proposed date. Confirmation is still pending.');
    assert.equal(await workSelector.isDisabled(), true, 'unsaved evidence protects task selection');
    assert.equal(await page.locator('#nebius-task-purpose').isDisabled(), true, 'task editing cannot replace a dirty evidence draft');
    assert.equal(await generate.isDisabled(), true, 'another suggestion cannot replace context during evidence editing');
    await page.getByRole('link', { name: 'Work', exact: true }).click();
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
    await page.locator('[data-nebius-optional-review] > summary').click();
    await page.getByRole('button', { name: 'Review with Nebius', exact: true }).click();
    await page.locator('[data-nebius-review-result]').waitFor();
    await page.screenshot({ path: path.resolve(`dist/nebius-review-${width}.png`), fullPage: true });
    assert.equal(reviewPosts.length, reviewCount + 1);
    assert.equal(reviewPosts.at(-1).review.criteria.length, 1);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), beforeReview, 'model review is advisory');
    await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].completionEvidence?.startsWith('Mira sent a proposed date.'); }, storageKey);
    const recorded = await page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); return saved.state || saved; }, storageKey);
    assert.notEqual(recorded.packs[0].status, 'done');
    await page.reload();
    await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
    await page.locator('#nebius-review-evidence').waitFor();
    assert.equal(await page.locator('#nebius-review-evidence').inputValue(), recorded.packs[0].completionEvidence, 'saved evidence survives a return visit');
    assert.equal(await page.locator('#nebius-written-step').count(), 1, 'saved written step remains editable after reload');
    const beforeOffline = posts.length + reviewPosts.length;
    await page.getByRole('tab', { name: 'Next step', exact: true }).click();
    await page.locator('#nebius-task-update').fill('Preserve this update while offline.');
    await context.setOffline(true);
    await page.getByText('You are offline. Browser-local edits remain available.', { exact: false }).waitFor();
    await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
    await page.getByText('Offline · you can still record evidence', { exact: false }).waitFor();
    assert.equal(await page.locator('#nebius-task-update').inputValue(), 'Preserve this update while offline.');
    await page.getByRole('link', { name: 'Finish or clear the update', exact: true }).click();
    assert.equal(await page.locator('#nebius-task-update').evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Clear update', exact: true }).click();
    assert.equal(await page.locator('#nebius-task-update').count(), 0, 'empty update input closes while offline');
    await page.locator('[data-nebius-task-editor] > summary').click();
    await page.locator('#nebius-task-blocker').fill('Deadline still unconfirmed after an offline edit.');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].blocker === 'Deadline still unconfirmed after an offline edit.'; }, storageKey);
    assert.equal(await generate.isDisabled(), true);
    await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
    await page.locator('[data-nebius-optional-review] > summary').click();
    assert.equal(await page.getByRole('button', { name: 'Review with Nebius', exact: true }).isDisabled(), true);
    assert.equal(posts.length + reviewPosts.length, beforeOffline, 'going offline must not start inference');
    await context.setOffline(false);
    await page.getByText('You are offline. Browser-local edits remain available.', { exact: false }).waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: 'Next step', exact: true }).click();
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
    await page.getByRole('textbox', { name: 'Quick-add a work item' }).fill('Organize vendor review');
    await page.locator('.quick-create-options summary').click();
    await page.locator('#work-quick-purpose').fill('Choose a reviewer.');
    await page.locator('#work-quick-written-next').fill('Ask Taylor to review the proposal.');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
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
    await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
    await otherPage.getByRole('tab', { name: 'Evidence', exact: true }).click();
    await page.locator('#nebius-review-evidence').fill('First-tab evidence that must not overwrite another saved version.');
    await otherPage.locator('#nebius-review-evidence').fill('Mira sent a proposed date. The other tab recorded a later observation.');
    await otherPage.getByRole('button', { name: 'Save evidence', exact: true }).click();
    await otherPage.getByText('Supplied evidence recorded. The task was not marked done.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
    await page.getByText('Workspace changed by another tab. Refresh this tab and try again.', { exact: true }).waitFor();
    assert.equal(await page.locator('#nebius-review-evidence').inputValue(), 'First-tab evidence that must not overwrite another saved version.', 'failed stale save retains the typed evidence');
    const savedEvidenceAfterConflict = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).state.packs[0].completionEvidence, storageKey);
    assert.equal(savedEvidenceAfterConflict, 'Mira sent a proposed date. The other tab recorded a later observation.');
    await page.getByRole('button', { name: 'Discard evidence edits', exact: true }).click();
    await otherPage.getByRole('button', { name: 'Mark done with recorded evidence', exact: true }).click();
    try { await otherPage.waitForURL('**/work?focus=nebius-test', { timeout: 3000 }); }
    catch {
      const snapshot = await otherPage.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); const item = (saved.state || saved).packs.find(pack => pack.id === 'nebius-test'); return { status: item?.status, completionEvidence: Boolean(item?.completionEvidence) }; }, storageKey);
      throw new Error(`Completion did not navigate: ${otherPage.url()}; saved: ${JSON.stringify(snapshot)}; page errors: ${errors.join(' | ')}`);
    }
    await otherPage.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs[0].status === 'done'; }, storageKey);
    const completed = await otherPage.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); return saved.state || saved; }, storageKey);
    assert(completed.packs[0].activity.some(item => item.includes('Marked done with supplied completion evidence.')));
    assert(completed.packs[0].activity.every(item => !item.includes('Proof saved: Mira confirms the date.')));
    await otherPage.goto(`${origin}/webmcp-challenge`);
    await otherPage.locator('details.worn-accordion summary').filter({ hasText: 'Backup and restore' }).click();
    await otherPage.getByRole('button', { name: 'Prepare export', exact: true }).click();
    const downloadPromise = otherPage.waitForEvent('download');
    await otherPage.getByRole('link', { name: 'Download export' }).click();
    const exportedText = await readFile(await (await downloadPromise).path(), 'utf8');
    const exported = JSON.parse(exportedText), exportedPack = exported.state.packs.find(pack => pack.id === 'nebius-test');
    assert.equal(exportedPack.nextStep, suggestion);
    assert(exportedPack.completionEvidence.startsWith('Mira sent a proposed date.'));
    assert.deepEqual(exportedPack.memory, ['DO_NOT_SEND', 'PRIVATE_NOTE_TWO']);
    const beforeImportRevision = exported.revision;
    await otherPage.locator('.challenge-import-label input').setInputFiles({ name: 'projects-workspace.json', mimeType: 'application/json', buffer: Buffer.from(exportedText) });
    await otherPage.getByRole('button', { name: 'Replace', exact: true }).click();
    await otherPage.getByRole('button', { name: 'Confirm Replace', exact: true }).click();
    await otherPage.waitForFunction(({ key, revision }) => JSON.parse(localStorage.getItem(key)).revision !== revision, { key: storageKey, revision: beforeImportRevision });
    const imported = await otherPage.evaluate(key => JSON.parse(localStorage.getItem(key)).state.packs.find(pack => pack.id === 'nebius-test'), storageKey);
    assert.equal(imported.nextStep, suggestion);
    assert.equal(imported.completionEvidence, exportedPack.completionEvidence);
    await otherPage.close();
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    results.push({ width, workEntry: true, taskSelection: true, legacyEditorHidden: true, multiFieldDraftReviewed: true, statusPreservedByTextEdit: true, contextEditNoInference: true, privateNotesExcluded: true, generationNoSave: true, useNoSave: true, reviewBeforeApprove: true, saveFocusVisible: true, unsavedNavigationGuard: true, evidenceDiscardNoSave: true, staleEvidenceRetained: true, writtenStepSaved: true, returnVisitPersistence: true, buttonActionUnchanged: true, reviewAdvisoryNoSave: true, evidenceRecordedBeforeDone: true, offlineLocalSaveNoSpend: true, humanCompletion: true, exportImportRoundtrip: true, failureRedacted: true, unavailableNoSpend: true, meaningfulQuickCreate: true, staleTabRefused: true, overflow: false });
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
    await legacyPage.getByRole('tab', { name: 'Evidence', exact: true }).click();
    assert.equal(await legacyPage.locator('[data-nebius-saved-criteria-absent]').innerText(), 'No completion criteria saved for this task.');
    assert.equal(await legacyPage.locator('[data-nebius-optional-review]').evaluate(element => element.open), false);
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
  assert.match(guideHtml, /From a plan to your next step/u, 'prerendered guide explains the Nebius project workflow');
  assert.doesNotMatch(guideHtml, /Brief for the browser agent/u, 'Nebius guide does not embed the old browser-agent tutorial');
  const keyboardCases = [];
  for (const width of [375, 1280]) {
  configEnabled = true;
  const freshContext = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  const freshPage = await freshContext.newPage();
  freshPage.setDefaultTimeout(10000);
  const keyboardErrors = [];
  freshPage.on('pageerror', error => keyboardErrors.push(error.message));
  await freshPage.goto(`${origin}/work`);
  await freshPage.getByText('4 workspace', { exact: false }).waitFor();
  await freshPage.getByText('Decide whether the release is ready', { exact: true }).waitFor();
  await reachByTab(freshPage, freshPage.locator('[data-nebius-work-entry]').getByRole('link', { name: 'Open next step', exact: true }));
  await freshPage.keyboard.press('Enter');
  await freshPage.waitForURL('**/next?pack=*');
  await reachByTab(freshPage, freshPage.getByLabel('Switch task', { exact: true }));
  await freshPage.keyboard.press('Home');
  await freshPage.keyboard.press('ArrowDown');
  await freshPage.keyboard.press('ArrowDown');
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
  await reachByTab(freshPage, freshPage.getByRole('tab', { name: 'Next step', exact: true }));
  await freshPage.keyboard.press('End');
  assert.equal(await freshPage.getByRole('tab', { name: 'Evidence', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await freshPage.getByRole('tab', { name: 'Evidence', exact: true }).evaluate(element => element === document.activeElement), true);
  await reachByTab(freshPage, freshPage.locator('#nebius-review-evidence'));
  await freshPage.keyboard.type('Keyboard traversal observation: Work and Next controls were reachable. Dialog checks remain incomplete.');
  await reachByTab(freshPage, freshPage.locator('[data-nebius-optional-review] > summary'));
  await freshPage.keyboard.press('Enter');
  await reachByTab(freshPage, freshPage.getByRole('button', { name: 'Review with Nebius', exact: true }));
  await freshPage.keyboard.press('Enter');
  await freshPage.locator('[data-nebius-review-result]').waitFor();
  await reachByTab(freshPage, freshPage.getByRole('button', { name: 'Save evidence', exact: true }));
  await freshPage.keyboard.press('Enter');
  await freshPage.getByText('Supplied evidence recorded. The task was not marked done.', { exact: true }).waitFor();
  assert.equal(await freshPage.locator('#nebius-button-action-panel').isVisible(), false, 'normal Nebius work uses the unified task editor');
  await reachByTab(freshPage, freshPage.getByRole('tab', { name: 'Evidence', exact: true }));
  await freshPage.keyboard.press('Home');
  assert.equal(await freshPage.getByRole('tab', { name: 'Next step', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await freshPage.getByRole('tab', { name: 'Next step', exact: true }).evaluate(element => element === document.activeElement), true);
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
  await reachByTab(freshPage, freshPage.getByRole('link', { name: 'Guide', exact: true }));
  await freshPage.keyboard.press('Enter');
  await freshPage.waitForURL('**/webmcp-challenge');
  await freshPage.getByRole('heading', { name: 'From a plan to your next step', exact: true }).waitFor();
  assert.equal(await freshPage.locator('#agent-brief-input').count(), 0);
  assert.equal(await freshPage.getByRole('region', { name: 'Verified action trail', exact: true }).count(), 0);
  assert.equal(await freshPage.locator('nav[aria-label="Projects application navigation"] a[href="/next"]').innerText(), 'Next step');
  assert.equal(await freshPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `guide has no overflow at ${width}`);
  for (const dismiss of await freshPage.getByRole('button', { name: /^Dismiss notification:/ }).all()) await dismiss.click();
  await freshPage.waitForFunction(() => document.querySelectorAll('.demo-toast-container button').length === 0);
  await freshPage.screenshot({ path: path.resolve(`dist/nebius-usability-guide-${width}.png`), fullPage: true });
  await reachByTab(freshPage, freshPage.getByText('Reset sample workspace', { exact: true }));
  await freshPage.keyboard.press('Enter');
  for (const [triggerName, dialogName] of [['Reset sample', 'Confirm sample reset'], ['Tools', 'Tools']]) {
    const trigger = freshPage.getByRole('button', { name: triggerName, exact: true });
    await reachByTab(freshPage, trigger);
    await freshPage.keyboard.press('Enter');
    const dialog = freshPage.getByRole('dialog', { name: dialogName, exact: true });
    await dialog.waitFor();
    for (let press = 0; press < 8; press++) {
      await freshPage.keyboard.press('Tab');
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, `${dialogName} retains keyboard focus`);
    }
    await freshPage.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true, `${dialogName} restores trigger focus`);
  }
  assert.deepEqual(keyboardErrors, []);
  keyboardCases.push({ width, workToNext: true, modelGuidanceToSave: true, reviewToRecordedEvidence: true, candidateLayout: candidateGeometry, unifiedProposalApproval: true, guideDialogs: true });
  await freshContext.close();
  }
  console.log(JSON.stringify({ syntheticInference: true, freshSyntheticWorkItems: 4, linkedDependencyClearanceRefused: true, recoveryCases, keyboardCases, cases: results }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
