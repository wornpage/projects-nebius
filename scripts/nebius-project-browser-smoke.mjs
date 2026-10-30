import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { OPERATION_PROFILES } from '../svelte-frontend/src/lib/nebius-routing-contract.mjs';
import { REVIEW_VERSION } from '../svelte-frontend/src/lib/nebius-review-contract.mjs';
import { PLAN_VERSION, PLAN_GROUNDING_VERSION, planInputDigest, projectPlanDigest, createDiagnosticCandidate } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';
import { createPlanningTrace } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { handleRecordedExample, RECORDED_EXAMPLE_PATH } from '../worker/nebius-recorded-example.mjs';

const root = path.resolve('dist/static-publish');
const storageKey = 'projects-webmcp-challenge-state-v1';
async function followAppLink(page, label) {
  const link = page.getByRole('navigation', { name: 'Projects application navigation', exact: true }).getByRole('link', { name: label, exact: true });
  if (await link.isVisible()) return link.click();
  await page.getByRole('button', { name: 'Navigate', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Commands', exact: true });
  if (label === 'Work') {
    const previousProject = await page.evaluate(key => { const stored = JSON.parse(localStorage.getItem(key)); return (stored?.state || stored)?.selectedProjectId ?? null; }, storageKey);
    await menu.locator('[data-command-key="all-work"]').click();
    await page.waitForURL(url => url.pathname === '/work' && !url.searchParams.has('scope'));
    await page.waitForFunction(() => document.querySelector('#project-scope')?.value === '');
    // Keep this existing project journey scoped after using All work; scope
    // clearing itself is asserted independently in the shared-menu suite.
    if (previousProject) {
      await page.locator('#project-scope').selectOption(previousProject);
      await page.waitForFunction(({key,id}) => { const stored=JSON.parse(localStorage.getItem(key)); return (stored?.state||stored)?.selectedProjectId===id; }, {key:storageKey,id:previousProject});
    }
    return;
  }
  const current = menu.locator('[data-command-key^="task:"][aria-current]');
  await (await current.count() ? current : menu.locator('[data-command-key^="task:"]').first()).click();
}
const model = 'nvidia/synthetic-model';
const seed = JSON.parse(await readFile(path.join(root, 'data/demo-packs.json'), 'utf8'));
const plan = {
  title: 'Community workshop', summary: 'Prepare and announce a small workshop.',
  tasks: [
    { id: 'outline', title: 'Define the workshop', purpose: 'Agree what participants will learn.', nextStep: 'Write the learning objective.', doneWhen: 'The learning objective is written.', dependsOn: null },
    { id: 'logistics', title: 'Confirm the venue', purpose: 'Find a suitable place.', nextStep: 'Check venue availability.', doneWhen: 'A suitable venue is confirmed.', dependsOn: 'outline' },
    { id: 'invite', title: 'Prepare the invitation', purpose: 'Give participants the confirmed details.', nextStep: 'Draft the invitation.', doneWhen: 'Invitation contains the confirmed venue and learning objective.', dependsOn: 'logistics' },
  ], missingInformation: ['Workshop date has not been supplied.'],
};
let enabled = false;
let inferenceFailure = null;
let planningMode = 'reviewable';
let delayedPlan = null;
const diagnosticText = '<img src=x onerror=alert(1)> Rejected workshop';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function planningFixture(brief, mode = 'reviewable', failure = null) {
  const draft = structuredClone(plan), requestId = 'synthetic-plan-request';
  const blocked = ['not_grounded', 'unclear'].includes(mode);
  if (blocked) draft.title = diagnosticText;
  const stage = (stage, usage, override = {}) => ({ stage, model, reservation: 'reserved', providerAttempted: true, outcome: 'passed', usageKnown: true, usage, ...override });
  const first = stage('plan', failure ? { input_tokens: 20, output_tokens: 30 } : { input_tokens: 40, output_tokens: 180 });
  const second = stage('grounding-review', failure ? { input_tokens: 25, output_tokens: 60 } : { input_tokens: 40, output_tokens: 80 });
  let outcome = blocked ? 'blocked' : 'reviewable';
  if (blocked) second.outcome = 'blocked';
  if (failure || ['failed', 'unknown', 'budget', 'unknown_budget', 'initial_budget', 'cancelled', 'malformed'].includes(mode)) {
    outcome = 'failed'; second.outcome = 'failed';
    if (failure?.usageUnknown || mode === 'unknown') { second.usage = null; second.usageKnown = false; }
    if (['budget', 'unknown_budget', 'cancelled'].includes(mode)) Object.assign(second, { providerAttempted: false, usage: null, usageKnown: false,
      reservation: mode === 'budget' ? 'refused' : mode === 'unknown_budget' ? 'unknown' : 'not_requested', outcome: mode === 'budget' ? 'refused' : mode === 'cancelled' ? 'cancelled' : 'failed' });
    if (mode === 'initial_budget') {
      Object.assign(first, { reservation: 'refused', providerAttempted: false, outcome: 'refused', usage: null, usageKnown: false });
      Object.assign(second, { reservation: 'not_requested', providerAttempted: false, outcome: 'not_started', usage: null, usageKnown: false });
    }
  }
  const planningTrace = createPlanningTrace([first, second]), candidate = first.outcome === 'passed';
  const result = { requestId, model, requestedModel: model, groundingModel: model, promptVersion: PLAN_VERSION, groundingVersion: PLAN_GROUNDING_VERSION, applied: false,
    outcome, briefDigest: await planInputDigest({ brief }), candidateDigest: candidate ? await projectPlanDigest(draft) : null,
    plan: outcome === 'reviewable' ? draft : null,
    diagnosticCandidate: outcome !== 'reviewable' && candidate ? await createDiagnosticCandidate(draft, { requestId, brief, model }) : null,
    groundingReview: outcome === 'reviewable' ? { assessment: 'grounded', findings: [] } : blocked ? { assessment: mode, findings: [
      { category: 'unsupported_detail', planPath: '/title', planQuote: diagnosticText, briefQuote: '', reason: 'The brief does not establish this title.' },
    ] } : null, planningTrace, providerAttempted: planningTrace.providerAttempts > 0, usageUnknown: planningTrace.unknownUsageCalls > 0,
    usage: planningTrace.providerAttempts > 0 && !planningTrace.unknownUsageCalls ? { input_tokens: planningTrace.knownInputTokens, output_tokens: planningTrace.knownOutputTokens } : null };
  if (mode === 'malformed') result.diagnosticCandidate.candidateDigest = '0'.repeat(64);
  return result;
}
const requests = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === RECORDED_EXAMPLE_PATH) {
    const result = await handleRecordedExample({ url: url.href, method: request.method });
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(await result.text()); return;
  }
  if (url.pathname.startsWith('/api/nebius/')) {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (url.pathname === '/api/nebius/config') {
      const operation = url.searchParams.get('operation');
      if (!Object.hasOwn(OPERATION_PROFILES, operation)) { response.statusCode = 400; response.end('{}'); return; }
      response.statusCode = enabled ? 200 : 404;
      response.end(JSON.stringify(enabled ? { available: true, operation, ...OPERATION_PROFILES[operation], requestedModel: model, ...(operation === 'plan-project' ? { groundingModel: model } : {}), promptVersion: 'task-change.v1', reviewVersion: REVIEW_VERSION, planVersion: PLAN_VERSION, replanVersion: 'project-replan.v1' } : { code: 'nebius_disabled' })); return;
    }
    if (request.method === 'POST' && inferenceFailure) {
      let body = ''; for await (const chunk of request) body += chunk;
      const input = JSON.parse(body); requests.push(input); response.statusCode = 502;
      response.end(JSON.stringify({ requestId: 'synthetic-failure', code: 'invalid_model_output', error: 'PRIVATE_PROVIDER_DETAILS',
        ...(url.pathname === '/api/nebius/plan-project' ? await planningFixture(input.brief, 'failed', inferenceFailure) : inferenceFailure) })); return;
    }
    if (url.pathname === '/api/nebius/plan-project' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      const input = JSON.parse(body); requests.push(input);
      const mode = planningMode, result = await planningFixture(input.brief, mode);
      if (delayedPlan) { const delay = delayedPlan; delay.entered.resolve(); await delay.promise; }
      response.statusCode = result.outcome === 'failed' ? 502 : 200;
      response.end(JSON.stringify(result)); return;
    }
    if (url.pathname === '/api/nebius/replan-project' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      const input = JSON.parse(body); requests.push(input);
      const { archived, ...task } = input.snapshot.tasks.find(item => item.id.endsWith(':outline'));
      const replan = { summary: 'Adapt workshop to the new audience.', changes: [{ ...task, nextStep: 'Revise the learning objective for beginners.', reason: 'The audience has changed.' }], missingInformation: ['Confirm the audience size.'] };
      response.end(JSON.stringify({ requestId: 'synthetic-replan-request', replan, model, requestedModel: model, promptVersion: 'project-replan.v1', applied: false, usage: { input_tokens: 110, output_tokens: 90 } })); return;
    }
    response.statusCode = 404; response.end('{}'); return;
  }
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\//u, '') || 'index.html'; }
  catch { response.statusCode = 400; response.end(); return; }
  if (!path.extname(relative)) relative += '.html';
  const file = path.resolve(root, relative), contained = path.relative(root, file);
  if (contained.startsWith('..') || path.isAbsolute(contained)) { response.statusCode = 403; response.end(); return; }
  try {
    const data = await readFile(file);
    response.setHeader('content-type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
const readState = page => page.evaluate(key => { const saved = JSON.parse(localStorage.getItem(key)); return saved?.state || saved; }, storageKey);
async function revealControl(control) {
  // Locator.all() does not wait for Svelte to remount the editor after review.
  await control.waitFor({ state: 'attached' });
  for (const disclosure of await control.locator('xpath=ancestor::details').all()) {
    if (!(await disclosure.evaluate(element => element.open))) await disclosure.locator(':scope > summary').press('Enter');
  }
  await control.waitFor({ state: 'visible' });
}
async function fillVisible(control, value) { await revealControl(control); await control.fill(value); }
async function revealProjectDetails(page) {
  await page.locator('#project-scope').waitFor();
  await revealControl(page.locator('[data-project-overview]'));
}
async function checkButtonCopySpacing(page) {
  const pairs = await page.evaluate(() => {
    const pairs = [], seen = new Set();
    for (const button of document.querySelectorAll('main button, main a.worn-btn')) {
      if (!button.checkVisibility()) continue;
      const parent = button.parentElement;
      const box = ['flex', 'grid'].includes(getComputedStyle(parent).display) ? parent : button;
      if (seen.has(box)) continue;
      seen.add(box);
      const rect = box.getBoundingClientRect();
      for (const [element, before] of [[box.previousElementSibling, true], [box.nextElementSibling, false]]) {
        if (!element?.matches('p') || !element.checkVisibility() || !element.textContent.trim()) continue;
        const copy = element.getBoundingClientRect();
        if (copy.right <= rect.left || copy.left >= rect.right) continue;
        pairs.push({ button: button.textContent.trim(), gap: before ? rect.top - copy.bottom : copy.top - rect.bottom });
      }
    }
    return pairs;
  });
  for (const pair of pairs) assert(pair.gap >= 4, `${pair.button} needs a small gap from adjacent copy; observed ${pair.gap}px`);
  return pairs.length;
}
async function begin(page, brief) {
  await page.goto(`${origin}/work`);
  await page.locator('[data-nebius-project-workspace]').waitFor();
  const trigger = page.getByRole('button', { name: 'New project', exact: true });
  if (await trigger.isVisible()) {
    await trigger.click();
    await page.waitForFunction(() => document.activeElement?.matches('[data-project-draft-heading]'));
    assert.equal(await page.locator('[data-project-draft-heading]').evaluate(element => {
      const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight;
    }), true, 'New project moves keyboard focus and scroll to its form');
  }
  await fillVisible(page.getByLabel('Project brief', { exact: true }), brief);
}
async function checkQuickAddLayout(page, width) {
  await page.getByRole('button', { name: 'Add work', exact: true }).click();
  const details = page.locator('.quick-create-options');
  await details.locator(':scope > summary').click();
  const geometry = await details.evaluate(element => {
    const owner = element.querySelector('#work-quick-owner').getBoundingClientRect();
    const area = element.querySelector('#work-quick-area').getBoundingClientRect();
    const labels = [...element.querySelectorAll('label[for="work-quick-owner"], label[for="work-quick-area"]')];
    return { ownerHeight: owner.height, areaHeight: area.height,
      textareaHeight: element.querySelector('#work-quick-purpose').getBoundingClientRect().height,
      labelGaps: labels.map(label => parseFloat(getComputedStyle(label).rowGap)),
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(geometry.ownerHeight, geometry.areaHeight, 'Owner keeps the same natural height as Area');
  assert(geometry.ownerHeight < geometry.textareaHeight, 'Owner does not stretch to the adjacent textarea height');
  assert(geometry.ownerHeight >= 44, 'single-line inputs retain their minimum touch target');
  assert.deepEqual(geometry.labelGaps, [6, 6], 'both field titles have a small consistent gap');
  assert.equal(geometry.overflow, false);
  await details.screenshot({ path: path.resolve(`dist/nebius-quick-add-spacing-${width}.png`) });
  await details.locator(':scope > summary').click();
  return geometry;
}
async function reviewAndApprove(page) {
  const priorCount = (await readState(page))?.projects?.length ?? 0;
  await page.getByRole('button', { name: 'Review plan', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('[data-project-draft-heading]'));
  await checkButtonCopySpacing(page);
  await page.screenshot({ path: path.resolve(`dist/nebius-plan-review-${page.viewportSize().width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(({ key, count }) => { const saved = JSON.parse(localStorage.getItem(key)); return (saved?.state || saved)?.projects?.length === count + 1; }, { key: storageKey, count: priorCount });
}
async function checkGroundingButtons(width) {
  const context = await browser.newContext({ viewport: { width, height: width === 384 ? 468 : 900 }, serviceWorkers: 'block' });
  const external = [], errors = [], calls = requests.length;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${origin}/grounding-rehearsal`);
    const run = page.getByRole('button', { name: 'Run authored example', exact: true });
    await run.waitFor(); const before = await readState(page);
    assert.equal(await page.locator('[data-grounding-rehearsal]').evaluate(element => parseFloat(getComputedStyle(element).rowGap)), 8, 'authored action row and following copy have an 8px gap');
    let spacingPairs = await checkButtonCopySpacing(page);
    for (const mode of ['grounded', 'rejected', 'unclear', 'failed']) {
      await page.locator('#grounding-rehearsal-case').selectOption(mode);
      await run.click();
      await page.locator('.rehearsal-result').filter({ hasText: mode === 'grounded' ? 'Grounded' : mode === 'rejected' ? 'Rejected' : mode === 'unclear' ? 'Unclear' : 'Review failed' }).waitFor();
      spacingPairs += await checkButtonCopySpacing(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('[data-grounding-rehearsal]').screenshot({ path: path.resolve(`dist/nebius-rehearsal-buttons-${mode}-${width}.png`) });
      if (mode === 'grounded') {
        await page.getByLabel('Project summary', { exact: true }).fill('An authored rehearsal edit.');
        await page.getByRole('button', { name: 'Review draft', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Saving disabled', exact: true }).isEnabled(), false);
        await checkButtonCopySpacing(page);
        page.once('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'Reset example', exact: true }).click();
      } else assert.equal(await page.locator('[data-plan-editor]').count(), 0);
      assert.deepEqual(await readState(page), before, 'authored rehearsal cannot change saved work');
    }
    assert.equal(requests.length, calls, 'authored examples issue no HTTP inference requests');
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    return { authoredButtonCases: 4, authoredNoInference: true, authoredEditingReviewReset: true, spacingPairs };
  } finally { await context.close(); }
}
async function checkLandingEntry(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const errors = [], external = [], callsBefore = requests.length;
  await context.addInitScript(({ storageKey, seed }) => {
    if (window !== top) return;
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify({ packs: seed, pendingNextActionDrafts: [] }));
  }, { storageKey, seed });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  enabled = false;
  try {
    await page.goto(`${origin}/webmcp-challenge`);
    await page.waitForURL(url => url.pathname === '/landing.html' && url.hash === '#help');
    await page.locator('#help').waitFor();
    assert.equal(await page.getByRole('link', { name: 'Source and local setup', exact: true }).getAttribute('href'), 'https://github.com/wornpage/projects-nebius#run-without-credentials');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Help links fit the viewport');
    await page.screenshot({ path: path.resolve(`dist/nebius-help-clarity-${width}.png`), fullPage: true });
    await page.goto(`${origin}/work`);
    await page.locator('[data-nebius-project-workspace]').waitFor();
    const before = await readState(page);
    await page.goto(`${origin}/landing.html`);
    const entry = page.getByRole('link', { name: 'Build your own tool', exact: true });
    assert.equal(await page.getByRole('link', { name: 'Source and local setup', exact: true }).getAttribute('href'), 'https://github.com/wornpage/projects-nebius#run-without-credentials');
    assert.equal(await page.getByRole('link', { name: 'public v0.1.0 preview', exact: true }).count(), 0);
    await page.getByText('Try the recorded example without a new AI call.', { exact: false }).waitFor();
    await page.getByText('Try the recorded example without credentials.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Landing links fit the viewport');
    await page.screenshot({ path: path.resolve(`dist/nebius-landing-clarity-${width}.png`), fullPage: true });
    assert.equal(await entry.getAttribute('href'), '/work?starter=release-packet-checker');
    for (let count = 0; count < 40 && !await entry.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
    assert.equal(await entry.evaluate(element => element === document.activeElement), true, 'Landing example is reachable by real Tab navigation');
    await page.keyboard.press('Enter');
    await page.getByLabel('Project title', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Project title', { exact: true }).inputValue(), 'Build a release-packet checker');
    assert.equal(await page.locator('[data-plan-task]').count(), 2);
    assert.deepEqual(await readState(page), before, 'Opening the example never changes saved workspace state');
    assert.equal(new URL(page.url()).searchParams.has('starter'), false, 'The entry request is consumed without a reload');
    await page.getByRole('button', { name: 'Review plan', exact: true }).click();
    assert.deepEqual(await readState(page), before, 'Reviewing the example still creates no saved project or task');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.locator('[data-project-approved]').waitFor();
    const approved = await readState(page), project = approved.projects.find(item => item.title === 'Build a release-packet checker');
    assert.ok(project); assert.equal(project.source, 'manual');
    assert.equal(approved.packs.length, before.packs.length + 2);
    const tasks = approved.packs.filter(item => item.projectId === project.id);
    assert.deepEqual(tasks.map(item => item.id).sort(), [`${project.id}:build-checker`, `${project.id}:review-checker`].sort());
    assert.equal(tasks.find(item => item.id.endsWith(':review-checker')).blockedBy, `${project.id}:build-checker`);
    await page.reload(); await revealProjectDetails(page);
    assert.equal(await page.locator('[data-project-draft]').count(), 0, 'Reload after approval does not reopen an example draft');
    assert.deepEqual((await readState(page)).packs.filter(item => item.projectId === project.id), tasks);
    await page.getByRole('navigation', { name: 'Project next work', exact: true }).getByRole('link', { name: 'Build the release packet checker', exact: true }).click();
    await page.getByRole('heading', { level: 1, name: 'Build the release packet checker', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('pack'), `${project.id}:build-checker`);
    assert.equal(await page.getByLabel('Switch task', { exact: true }).inputValue(), `${project.id}:build-checker`);
    await page.getByRole('tab', { name: 'Tool', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'Tool', exact: true }).getAttribute('aria-selected'), 'true');
    const beforeInvalid = await readState(page);
    await page.goto(`${origin}/work?starter=unavailable-example`);
    await page.locator('[data-project-plan-error]').waitFor();
    assert.match(await page.locator('[data-project-plan-error]').innerText(), /Unknown project starter/u);
    assert.equal(await page.locator('[data-plan-task]').count(), 0, 'An unknown example does not select a fallback plan');
    assert.deepEqual(await readState(page), beforeInvalid);
    assert.equal(requests.length, callsBefore, 'Entry, review, approval and inspection request no inference');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    return { landingEntry: true, exampleReviewNoWrite: true, explicitApproval: true, buildTaskReachable: true, consumedEntryReload: true, unknownExampleRefused: true };
  } finally { await context.close(); }
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
  for (const width of [375, 384, 1280]) {
    const height = width === 384 ? 468 : 900;
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    await context.addInitScript(({ storageKey, seed }) => { if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify({ packs: seed, pendingNextActionDrafts: [] })); }, { storageKey, seed });
    const errors = [], external = [];
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    enabled = false;
    await begin(page, 'Prepare a concise workshop outline and review it.');
    const quickAddGeometry = await checkQuickAddLayout(page, width);
    await checkButtonCopySpacing(page);
    const beforeManual = await readState(page), callsBefore = requests.length;
    await page.getByRole('button', { name: 'Write plan myself', exact: true }).click();
    assert.equal(await page.getByLabel('Project summary', { exact: true }).inputValue(), 'Prepare a concise workshop outline and review it.', 'manual summary starts from the brief');
    await page.getByLabel('Project title', { exact: true }).fill('My workshop');
    const task = page.locator('[data-plan-task]').first();
    await task.getByLabel('Task title', { exact: true }).fill('Write the workshop outline');
    await task.getByLabel('Why it matters', { exact: true }).fill('Make the session useful.');
    await task.getByLabel('Next step', { exact: true }).fill('Draft the learning objective.');
    await task.getByLabel('Completion criteria', { exact: true }).fill('A learning objective is written.');
    assert.deepEqual((await readState(page)).packs, beforeManual.packs, 'editing a manual plan creates no tasks');
    page.once('dialog', async dialog => { assert.equal(dialog.type(), 'confirm'); await dialog.dismiss(); });
    await followAppLink(page, 'Task');
    assert.equal(new URL(page.url()).pathname, '/work');
    assert.equal(await task.getByLabel('Task title', { exact: true }).inputValue(), 'Write the workshop outline', 'canceling navigation keeps the edited draft');
    await context.setOffline(true);
    await reviewAndApprove(page);
    const manual = await readState(page), project = manual.projects[0];
    assert.equal(project.title, 'My workshop'); assert.equal(project.source, 'manual');
    assert.equal(manual.packs.filter(item => item.projectId === project.id).length, 1);
    assert.equal(manual.packs.length, beforeManual.packs.length + 1);
    assert.equal(requests.length, callsBefore, 'manual planning requires no model call');
    await context.setOffline(false);
    await page.reload();
    await revealProjectDetails(page);
    assert.equal((await readState(page)).projects[0].title, 'My workshop');
    assert.equal(await page.locator('#project-scope').inputValue(), project.id);
    await page.screenshot({ path: path.resolve(`dist/nebius-project-workspace-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no horizontal overflow at ${width}`);
    // Re-entering a selected project after a task visit preserves membership.
    const manualTask = manual.packs.find(item => item.projectId === project.id);
    await page.goto(`${origin}/next?pack=${encodeURIComponent(manualTask.id)}`);
    await page.getByRole('heading', { level: 1, name: manualTask.title, exact: true }).waitFor();
    assert.equal(await page.getByLabel('Switch task', { exact: true }).inputValue(), manualTask.id, 'the Next page selects the created task');
    await followAppLink(page, 'Work');
    await page.waitForURL('**/work');
    assert.equal(await page.locator('#project-scope').inputValue(), project.id);
    enabled = true;
    await begin(page, 'Organize a community workshop. Define the outline, confirm a venue, then prepare invitations.');
    const beforeModel = await readState(page), requestCount = requests.length;
    await page.locator('.nebius-generation > summary').click();
    const limits = await page.locator('[data-planning-consent-limits]').innerText();
    assert(limits.includes('Draft model: nvidia/synthetic-model') && limits.includes('Review model: nvidia/synthetic-model'));
    assert(limits.includes('Maximum 2 calls: 4,000 draft + 2,000 review = 6,000 output tokens total'));
    assert.equal(await page.getByRole('button', { name: 'Generate plan with Nebius', exact: true }).isDisabled(), true);
    await page.getByRole('checkbox', { name: 'I agree to send this brief and generated draft to Nebius for drafting and review.', exact: true }).check();
    await page.getByRole('button', { name: 'Generate plan with Nebius', exact: true }).click();
    await page.getByLabel('Project title', { exact: true }).waitFor();
    assert.equal(requests.length, requestCount + 1);
    assert.deepEqual(Object.keys(requests.at(-1)).sort(), ['brief', 'consent', 'promptVersion', 'requestedModel']);
    assert.equal(requests.at(-1).consent, true);
    assert.deepEqual(await readState(page), beforeModel, 'generation does not write the workspace');
    assert.equal(await page.locator('[data-plan-task]').count(), 3);
    assert.match(await page.locator('[data-model-review-coverage]').innerText(), /original generated draft/);
    await page.locator('[data-plan-editor]').screenshot({ path: path.resolve(`dist/nebius-v4-reviewable-${width}.png`) });
    assert.equal(await page.locator('[data-plan-task-panel]:not([open])').count(), 2, 'generated plan starts with two compact task summaries');
    const predecessor = page.locator('[data-plan-task]').last().getByRole('combobox', { name: 'Predecessor', exact: true });
    await revealControl(page.locator('[data-plan-task]').last());
    await predecessor.focus(); await page.keyboard.press('c');
    assert.equal(await predecessor.evaluate(element => element === document.activeElement), true, 'native selector typeahead keeps focus');
    const firstPredecessor = page.locator('[data-plan-task]').first().getByRole('combobox', { name: 'Predecessor', exact: true });
    await revealControl(page.locator('[data-plan-task]').first()); await firstPredecessor.selectOption('invite');
    await page.getByRole('button', { name: 'Review plan', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'cycle' }).waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('[data-project-plan-error]'));
    assert.equal(await page.locator('[data-plan-task-panel][open]').count(), 3, 'validation reveals all fields needed to repair dependencies');
    assert.deepEqual(await readState(page), beforeModel, 'cyclic edited plans cannot create any work');
    await page.locator('[data-plan-task]').first().getByRole('combobox', { name: 'Predecessor', exact: true }).selectOption('');
    await page.getByLabel('Project title', { exact: true }).fill('Our reviewed workshop');
    assert.match(await page.locator('[data-model-review-coverage]').innerText(), /Your edits have not been model reviewed/);
    assert.equal(requests.length, requestCount + 1, 'human edits do not dispatch a model audit');
    await reviewAndApprove(page);
    const approved = await readState(page), modelProject = approved.projects.find(item => item.title === 'Our reviewed workshop');
    assert(modelProject); assert.equal(modelProject.source, 'nebius');
    const tasks = approved.packs.filter(item => item.projectId === modelProject.id);
    assert.equal(tasks.length, 3); assert.equal(tasks.filter(item => item.status === 'blocked').length, 2);
    assert(tasks.filter(item => item.blockedBy).every(item => tasks.some(candidate => candidate.id === item.blockedBy)));
    await page.reload(); await revealProjectDetails(page);
    const reloaded = await readState(page);
    assert.deepEqual(reloaded.packs.filter(item => item.projectId === modelProject.id), tasks, 'reload retains complete dependency graph');
    assert.equal(reloaded.projects.length, 2);
    await page.goto(`${origin}/work?focus=${encodeURIComponent(manualTask.id)}`);
    await page.waitForFunction(({ key, id }) => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).selectedProjectId === id; }, { key: storageKey, id: project.id });
    assert.equal(await page.locator('#project-scope').inputValue(), project.id, 'an explicit focus link reveals the other project');
    await page.getByRole('link', { name: `Open task ${manualTask.title}`, exact: true }).waitFor();
    await page.locator('#project-scope').selectOption('');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    // Portability includes project metadata and membership through Work.
    await page.goto(`${origin}/work?menu=backup`);
    await page.getByRole('dialog', { name: 'Work menu', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Prepare backup', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download backup' }).click();
    const exported = await readFile(await (await download).path(), 'utf8');
    assert.equal(JSON.parse(exported).state.projects.length, 2);
    await page.locator('.work-backup-import input').setInputFiles({ name: 'project-workspace.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm replace', exact: true }).click();
    await page.goto(`${origin}/work`); await revealProjectDetails(page);
    assert.deepEqual((await readState(page)).projects, JSON.parse(exported).state.projects);
    assert.equal((await readState(page)).packs.filter(item => item.projectId === modelProject.id).length, 3);
    // A changed circumstance produces an editable, consented revision with no early writes.
    await page.locator('#project-scope').selectOption(modelProject.id);
    await page.waitForFunction(({ key, id }) => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).selectedProjectId === id; }, { key: storageKey, id: modelProject.id });
    const beforeRevision = await readState(page), beforeRequests = requests.length;
    await page.getByRole('button', { name: 'Revise tasks', exact: true }).click();
    await page.getByLabel('Project update', { exact: true }).fill('The workshop now serves beginners.');
    await page.locator('.replan-generation > summary').click();
    await page.getByRole('checkbox', { name: 'I agree to send this update and project context to Nebius.', exact: true }).check();
    await page.getByRole('button', { name: 'Draft changes with Nebius', exact: true }).click();
    await page.locator('[data-replan-task]').waitFor();
    assert.equal(requests.length, beforeRequests + 1);
    assert.deepEqual(Object.keys(requests.at(-1)).sort(), ['consent', 'promptVersion', 'requestedModel', 'snapshot', 'update']);
    assert.deepEqual(await readState(page), beforeRevision, 'replanning and editing do not write');
    await fillVisible(page.locator('[data-replan-task]').getByLabel('Next step', { exact: true }), 'Write a beginner-friendly learning objective.');
    page.once('dialog', async dialog => dialog.dismiss());
    await page.locator('#project-scope').selectOption(project.id);
    assert.equal(await page.locator('#project-scope').inputValue(), modelProject.id, 'canceling scope change preserves draft');
    assert.deepEqual(await readState(page), beforeRevision, 'canceling scope change preserves the saved project and tasks');
    assert.equal(await page.locator('[data-replan-task]').getByLabel('Next step', { exact: true }).inputValue(), 'Write a beginner-friendly learning objective.', 'canceling scope change retains the edited proposal');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.locator('[data-replan-diff]').waitFor();
    assert.match(await page.locator('[data-replan-diff]').innerText(), /Before[\s\S]*Write the learning objective\.[\s\S]*After[\s\S]*Write a beginner-friendly learning objective\./);
    assert.deepEqual(await readState(page), beforeRevision);
    await page.screenshot({ path: path.resolve(`dist/nebius-project-update-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.locator('[data-project-updated]').waitFor();
    const revised = await readState(page), outlineId = `${modelProject.id}:outline`;
    assert.equal(revised.packs.find(item => item.id === outlineId).nextStep, 'Write a beginner-friendly learning objective.');
    assert.deepEqual(revised.packs.filter(item => item.id !== outlineId), beforeRevision.packs.filter(item => item.id !== outlineId));
    await page.reload(); await revealProjectDetails(page);
    assert.equal((await readState(page)).packs.find(item => item.id === outlineId).nextStep, 'Write a beginner-friendly learning objective.');
    // Manual changes work offline and pending proposals refuse concurrent edits.
    await page.getByRole('button', { name: 'Revise tasks', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).isEnabled(), false, 'a change request is needed before manual editing');
    await page.getByLabel('Project update', { exact: true }).fill('Clarify the objective wording.');
    await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
    const openTask = page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Define the workshop$/ }) });
    await revealControl(openTask.getByLabel('Task title', { exact: true }));
    assert.equal(await openTask.getByLabel('Reason', { exact: true }).inputValue(), 'Clarify the objective wording.', 'manual task reasons start from the change request');
    const blockedTask = page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Confirm the venue$/ }) });
    await revealControl(blockedTask);
    const beforeClear = await readState(page);
    const oldBlocker = await blockedTask.getByLabel('Blocker', { exact: true }).inputValue();
    const oldDependency = await blockedTask.getByLabel('Predecessor', { exact: true }).inputValue();
    await blockedTask.getByRole('button', { name: 'Clear blockers', exact: true }).click();
    assert.equal(await blockedTask.getByLabel('Status', { exact: true }).inputValue(), 'active');
    assert.equal(await blockedTask.getByLabel('Blocker', { exact: true }).inputValue(), 'None');
    assert.equal(await blockedTask.getByLabel('Predecessor', { exact: true }).inputValue(), '');
    assert.deepEqual(await readState(page), beforeClear, 'clearing blockers only changes the unsaved draft');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    const blockerDiff = page.locator('[data-replan-diff]').filter({ has: page.getByRole('heading', { name: 'Confirm the venue', exact: true }) });
    await checkButtonCopySpacing(page);
    for (const field of ['Status', 'Blocker', 'Predecessor']) assert(await blockerDiff.getByText(field, { exact: true }).count(), `review includes the ${field} change`);
    await page.getByRole('button', { name: 'Back to editing', exact: true }).click();
    await revealControl(blockedTask.getByLabel('Status', { exact: true }));
    await blockedTask.getByLabel('Status', { exact: true }).selectOption('blocked');
    await blockedTask.getByLabel('Predecessor', { exact: true }).selectOption(oldDependency);
    await blockedTask.getByLabel('Blocker', { exact: true }).fill(oldBlocker);
    await fillVisible(openTask.getByLabel('Task title', { exact: true }), 'Define  the workshop');
    await openTask.getByLabel('Next step', { exact: true }).fill('Write and review the beginner objective.');
    await page.getByRole('button', { name: 'Add work', exact: true }).click();
    await page.getByRole('textbox', { name: 'Task title (required)', exact: true }).fill('Unrelated quick task');
    await page.locator('#work-quick-project').selectOption('');
    page.once('dialog', async dialog => dialog.dismiss());
    await page.locator('[data-work-quick-create-submit]').click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs.some(item => item.title === 'Unrelated quick task'); }, storageKey);
    assert.equal(await page.locator('#project-scope').inputValue(), modelProject.id, 'quick-add cannot discard a draft without consent');
    assert.equal(await openTask.getByLabel('Next step', { exact: true }).inputValue(), 'Write and review the beginner objective.');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.locator('[data-project-updated]').waitFor();
    assert.equal((await readState(page)).packs.find(item => item.id === outlineId).nextStep, 'Write and review the beginner objective.');
    assert.equal((await readState(page)).packs.find(item => item.id === outlineId).title, 'Define the workshop', 'review and save use the same normalized title');
    await context.setOffline(false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Revise tasks', exact: true }).click();
    await page.getByLabel('Project update', { exact: true }).fill('A draft that will become stale.');
    await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
    await fillVisible(page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Define the workshop$/ }) }).getByLabel('Next step', { exact: true }), 'This stale value must never save.');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    const otherTab = await context.newPage(); await otherTab.goto(`${origin}/work`);
    await otherTab.evaluate(({ key, id }) => { const saved = JSON.parse(localStorage.getItem(key)); saved.state.packs.find(item => item.id === id).nextStep = 'Saved by another tab.'; saved.revision = crypto.randomUUID(); localStorage.setItem(key, JSON.stringify(saved)); }, { key: storageKey, id: outlineId });
    await otherTab.close();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.locator('[data-project-update] [role="alert"]').first().waitFor();
    assert.equal((await readState(page)).packs.find(item => item.id === outlineId).nextStep, 'Saved by another tab.', 'concurrent persisted change survives refused approval');
    page.once('dialog', async dialog => dialog.accept()); await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    // Human-written examples provide a useful start without spending or saving early.
    enabled = false;
    await begin(page, '');
    const starterBefore = await readState(page), starterCalls = requests.length;
    for (const [index, id] of ['workshop', 'customer-handoff', 'website-release'].entries()) {
      if (index) page.once('dialog', async dialog => dialog.accept());
      await revealControl(page.locator(`[data-project-starter="${id}"]`));
      await page.locator(`[data-project-starter="${id}"]`).click();
      await page.getByLabel('Project title', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-plan-task]').count(), 3);
      assert.match(await page.locator('[data-project-provenance]').innerText(), /Human-written .+ example · unsaved/);
      // Loading an example moves focus after Svelte's pending render completes.
      await page.waitForFunction(() => document.activeElement?.id === 'project-title');
      assert.equal(await page.getByLabel('Project title', { exact: true }).evaluate(element => element === document.activeElement), true);
      assert.deepEqual(await readState(page), starterBefore);
      assert.equal(requests.length, starterCalls);
    }
    await page.getByLabel('Project title', { exact: true }).fill('My first release');
    page.once('dialog', async dialog => dialog.dismiss());
    await revealControl(page.locator('[data-project-starter="workshop"]'));
    await page.locator('[data-project-starter="workshop"]').click();
    assert.equal(await page.getByLabel('Project title', { exact: true }).inputValue(), 'My first release');
    await fillVisible(page.getByLabel('Project brief', { exact: true }), 'Release a small website with explicit review.');
    assert.equal(await page.locator('[data-plan-task]').count(), 3, 'editing an example brief retains the editable example plan');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const panel of await page.locator('[data-plan-task-panel], [data-plan-source-controls]').all()) {
      if (await panel.evaluate(element => element.open)) await panel.locator(':scope > summary').press('Enter');
    }
    await page.screenshot({ path: path.resolve(`dist/nebius-starters-${width}.png`), fullPage: true });
    await reviewAndApprove(page);
    const starterApproved = await readState(page);
    const starterProject = starterApproved.projects.find(item => item.id === starterApproved.selectedProjectId);
    assert.equal(starterApproved.projects.length, starterBefore.projects.length + 1); assert.equal(starterProject.source, 'manual');
    assert.deepEqual(starterApproved.projects.filter(item => item.id !== starterProject.id), starterBefore.projects, 'approving another project preserves existing projects');
    assert.equal(starterApproved.packs.length, starterBefore.packs.length + 3); assert.equal(requests.length, starterCalls);
    assert.deepEqual(starterApproved.packs.filter(item => item.projectId !== starterProject.id), starterBefore.packs, 'approving another project preserves existing tasks');
    await page.reload(); await revealProjectDetails(page);
    assert.equal((await readState(page)).projects.find(item => item.id === starterProject.id).title, 'My first release');
    // Execute the actual visible project journey through evidence and completion.
    const journeyId = starterProject.id;
    const projectDetails = page.locator('[data-project-details]');
    if (await projectDetails.evaluate(element => element.open)) await projectDetails.locator(':scope > summary').press('Enter');
    assert.equal(await page.locator('[data-project-goal]').isVisible(), true, 'The project goal remains visible when Details is closed.');
    assert.equal(await page.locator('[data-project-completion]').isVisible(), true, 'Completion count and progress remain visible when Details is closed.');
    await revealProjectDetails(page);
    const journeyTasks = ['release-brief', 'update-page', 'review-release'].map(id => `${journeyId}:${id}`);
    const evidence = [
      'Audience: existing customers. Goal: find support. Page: the support landing page. These details are recorded in this brief.',
      'The proposed page copy contains a support heading, contact instructions and navigation back to the product. The draft is ready for review against the customer-support goal.',
      'Review recorded: the proposed copy addresses the support goal. No remaining copy changes were identified. Publication still requires the owner to decide and carry it out.',
    ];
    for (let index = 0; index < journeyTasks.length; index++) {
      if (index === 0) await page.getByRole('link', { name: 'Confirm the release brief', exact: true }).click();
      else {
        const nextTitle = index === 1 ? 'Update the page' : 'Review release readiness';
        if (index === 1) await page.getByRole('navigation', { name: 'Project next work', exact: true }).getByRole('link', { name: nextTitle, exact: true }).click();
        else await page.getByRole('link', { name: 'Continue: ' + nextTitle, exact: true }).click();
      }
      await page.getByRole('tab', { name: 'Review', exact: true }).click();
      const taskBeforeCompletion = (await readState(page)).packs.find(item => item.id === journeyTasks[index]);
      if (!await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open)) {
        await page.locator('[data-nebius-evidence-review] > summary').click();
      }
      assert.equal(await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open), true, 'the Evidence disclosure exposes the recording form');
      await page.locator('#nebius-review-evidence').fill(evidence[index]);
      await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
      await page.getByRole('button', { name: 'Mark done with recorded evidence', exact: true }).click();
      await page.waitForURL('**/work?focus=*');
      await revealProjectDetails(page);
      const completedState = await readState(page);
      assert.equal(completedState.packs.find(item => item.id === journeyTasks[index]).status, 'done');
      assert.equal(completedState.packs.filter(item => item.projectId === journeyId && item.status === 'done').length, index + 1);
      assert.equal(completedState.selectedProjectId, journeyId);
      assert.equal(await page.locator('[data-project-progress-done]').innerText(), `${index + 1}/3`);
      assert.equal(await page.locator('[data-project-progress-remaining]').innerText(), String(2 - index));
      assert.equal(requests.length, starterCalls, 'recording and completing manual work makes no inference call');
      if (index < 2) {
        const successor = completedState.packs.find(item => item.id === journeyTasks[index + 1]);
        assert.equal(successor.status, 'active'); assert(!successor.blockedBy);
        assert.deepEqual(completedState.actionReceipt.unblockedWorkIds, [successor.id]);
        const continueTask = page.locator('[data-nebius-continue]');
        await continueTask.waitFor();
        assert.equal(await page.locator('[data-ready-next]').getByRole('link', { name: successor.title, exact: true }).count(), 0, 'The promoted successor is not duplicated in More ready tasks.');
        assert.equal(await continueTask.innerText(), 'Continue: ' + successor.title);
        assert.equal(new URL(await continueTask.getAttribute('href'), origin).searchParams.get('pack'), successor.id, 'Continue uses the existing first eligible task.');
        assert.equal(await page.locator('[data-nebius-task-history-action]').evaluate(element => element.classList.contains('is-primary')), false, 'History stays secondary when a ready successor exists.');
        assert.equal(await continueTask.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('[data-nebius-task-history-action]')) & Node.DOCUMENT_POSITION_FOLLOWING)), true, 'Continue precedes secondary task history in reading order');
        assert.equal(await page.locator('[data-nebius-work-entry] [data-nebius-selected-next-step]').count(), 0, 'completion does not keep the old instruction prominent');
        assert.equal(completedState.packs.find(item => item.id === journeyTasks[index]).nextStep, taskBeforeCompletion.nextStep, 'completion preserves the historical next step');
        assert(!successor.activity.some(text => text.includes('finished with proof')));
      }
      if (index === 0) {
        await page.screenshot({ path: path.resolve(`dist/nebius-project-progress-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Revise tasks', exact: true }).click();
        await page.getByLabel('Project update', { exact: true }).fill('The brief is confirmed. Prioritize support navigation wording in the page draft.');
        await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
        const taskEditor = page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Update the page$/ }) });
        await fillVisible(taskEditor.getByLabel('Next step', { exact: true }), 'Prepare support navigation wording from the confirmed brief.');
        await page.getByRole('button', { name: 'Review changes', exact: true }).click();
        await page.getByRole('button', { name: 'Save changes', exact: true }).click();
        await page.locator('[data-project-updated]').waitFor();
        assert.equal((await readState(page)).packs.find(item => item.id === journeyTasks[0]).status, 'done');
      }
    }
    await page.reload(); await revealProjectDetails(page);
    const finished = await readState(page);
    assert.equal(finished.packs.filter(item => item.projectId === journeyId && item.status === 'done').length, 3);
    assert.equal(finished.packs.filter(item => item.projectId === journeyId && item.status === 'active').length, 0);
    await page.locator('[data-project-all-done]').waitFor();
    assert.match(await page.locator('[data-project-all-done]').innerText(), /All tasks marked done/);
    await page.getByRole('combobox', { name: 'Filter by status', exact: true }).selectOption('active');
    // An explicit filter choice wins over the pending 100ms arrival-focus timer.
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#filter-status').inputValue(), 'active', 'arrival focus must not reset an explicit status filter');
    assert.equal((await readState(page)).filter, 'active');
    assert.equal(await page.locator('[data-project-progress-done]').innerText(), '3/3', 'list filtering never changes the project denominator');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.resolve(`dist/nebius-project-complete-${width}.png`), fullPage: true });
    // Rehearsal: a separate blocker must survive completion of its predecessor.
    enabled = false;
    const rehearsalCalls = requests.length;
    await begin(page, '');
    await page.getByRole('button', { name: 'Workshop example', exact: true }).click();
    await page.getByLabel('Project title', { exact: true }).fill('Rehearsal repair workshop');
    await reviewAndApprove(page);
    let rehearsal = await readState(page);
    const rehearsalId = rehearsal.selectedProjectId;
    const workshopTasks = rehearsal.packs.filter(item => item.projectId === rehearsalId);
    const firstTask = workshopTasks.find(item => !item.blockedBy);
    const secondTask = workshopTasks.find(item => item.blockedBy === firstTask.id);
    await page.goto(`${origin}/next?pack=${encodeURIComponent(secondTask.id)}`);
    await page.locator('[data-nebius-task-editor] > summary').click();
    await page.getByLabel('Blocker', { exact: true }).fill('Venue unconfirmed');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await page.getByText('Changes applied.', { exact: true }).waitFor();
    await followAppLink(page, 'Work');
    await page.getByRole('button', { name: 'Revise tasks', exact: true }).click();
    const updateWhy = 'Switch online because the venue is unavailable. The meeting link still needs confirmation.';
    const taskWhy = 'The workshop moved online; we still need the meeting link.';
    await page.getByLabel('Project update', { exact: true }).fill(updateWhy);
    await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
    const workshopEdit = page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Draft the agenda and materials$/ }) });
    await fillVisible(workshopEdit.getByLabel('Blocker', { exact: true }), 'Meeting link unconfirmed');
    await fillVisible(workshopEdit.getByLabel('Reason', { exact: true }), taskWhy);
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByText('The approved summary and each task’s reason will be saved in its activity.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.locator('[data-project-updated]').waitFor();
    await page.reload();
    rehearsal = await readState(page);
    const revisedSecond = rehearsal.packs.find(item => item.id === secondTask.id);
    assert.equal(revisedSecond.blocker, 'Meeting link unconfirmed');
    assert(revisedSecond.activity.at(-1).includes(updateWhy));
    assert(revisedSecond.activity.at(-1).includes(taskWhy));
    await page.goto(`${origin}/next?pack=${encodeURIComponent(firstTask.id)}`);
    await page.getByRole('tab', { name: 'Review', exact: true }).click();
    await page.getByRole('heading', { name: 'Completion criteria', exact: true }).waitFor();
    assert.equal(await page.locator('[data-current-full-criteria]').innerText(), firstTask.doneWhen);
    if (!await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open)) {
      await page.locator('[data-nebius-evidence-review] > summary').click();
    }
    assert.equal(await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open), true);
    await page.locator('[data-nebius-evidence-review]').screenshot({ path: path.resolve(`dist/nebius-rehearsal-criteria-${width}.png`) });
    await page.getByLabel('Evidence supplied by you', { exact: true }).fill('Rehearsal observation: eight beginners, an online session of 60 minutes, and the goal of identifying a safe first repair step are recorded.');
    await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
    await page.getByRole('button', { name: 'Mark done with recorded evidence', exact: true }).click();
    await page.waitForURL('**/work?focus=*');
    await revealProjectDetails(page);
    rehearsal = await readState(page);
    const stillBlocked = rehearsal.packs.find(item => item.id === secondTask.id);
    assert.equal(stillBlocked.status, 'blocked');
    assert.equal(stillBlocked.blocker, 'Meeting link unconfirmed');
    assert.equal(stillBlocked.blockedBy, '');
    assert.deepEqual(rehearsal.actionReceipt.unblockedWorkIds, []);
    assert.equal(await page.locator('[data-ready-next]').count(), 0, 'a separate blocker is never advertised as ready');
    assert.equal(await page.locator('[data-project-progress-done]').innerText(), '1/3');
    await page.reload(); await revealProjectDetails(page);
    assert.equal((await readState(page)).packs.find(item => item.id === secondTask.id).blocker, 'Meeting link unconfirmed');
    assert.equal(requests.length, rehearsalCalls, 'manual rehearsal makes no inference calls');
    await page.screenshot({ path: path.resolve(`dist/nebius-rehearsal-blocker-${width}.png`), fullPage: true });
    await page.goto(`${origin}/next?pack=${encodeURIComponent(secondTask.id)}`);
    await page.getByRole('heading', { name: secondTask.title, exact: true }).waitFor();
    const resolvedEditor = page.locator('[data-nebius-task-editor]');
    if (!await resolvedEditor.evaluate(element => element.open)) await resolvedEditor.locator(':scope > summary').click();
    await page.locator('#nebius-task-status').selectOption('active');
    await page.getByLabel('Blocker', { exact: true }).fill('None');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
    await page.getByText('Changes applied.', { exact: true }).waitFor();
    assert.equal((await readState(page)).packs.find(item => item.id === secondTask.id).status, 'active', 'a person can explicitly resolve the remaining blocker');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ width, height, quickAddGeometry, newProjectFocus: true, manualSummaryPrefilled: true, reasonsPrefilled: true, clearBlockersDraftOnly: true, blockerReviewDiff: true, manualWithoutInference: true, generatedPlanNoWrite: true, approvalAtomic: true, cyclesRefused: true, dependencyReload: true, projectScope: true, explicitFocus: true, exportImport: true, reviewedReplan: true, manualReplanOffline: true, quickAddPreservesDraft: true, concurrentApprovalRefused: true, examplePlans: 3, examplesNoInference: true, exampleApprovalReload: true, completedProjectJourney: true, freshReplanAfterCompletion: true, nextTaskLinks: true, independentBlockerPreserved: true, approvedReasonReload: true, manualCriteriaVisible: true, explicitBlockerResolution: true, rehearsalNoInference: true, overflow: false });
    await context.close();
    Object.assign(results[results.length - 1], await checkLandingEntry(width));
    Object.assign(results[results.length - 1], await checkGroundingButtons(width));
  }
  const providerFailureCases = [];
  for (const width of [375, 1280]) for (const operation of ['plan-project', 'replan-project']) for (const mode of ['known', 'unknown']) {
    enabled = true; inferenceFailure = { providerAttempted: true, usageUnknown: mode === 'unknown',
      usage: mode === 'unknown' ? null : { input_tokens: 45, output_tokens: 90 }, diagnostic: 'The response did not match the required project fields.' };
    const failureContext = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const failurePage = await failureContext.newPage(); failurePage.setDefaultTimeout(10000);
    const errors = [], external = [];
    failurePage.on('pageerror', error => errors.push(error.message));
    await failureContext.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    try {
      await begin(failurePage, operation === 'plan-project' ? 'Prepare a synthetic project with unknown owners.' : '');
      if (operation === 'replan-project') {
        await failurePage.getByRole('button', { name: 'Workshop example', exact: true }).click();
        await reviewAndApprove(failurePage);
        await failurePage.getByRole('button', { name: 'Revise tasks', exact: true }).click();
        await failurePage.getByLabel('Project update', { exact: true }).fill('The workshop now serves a different audience.');
        await failurePage.locator('.replan-generation > summary').click();
        await failurePage.getByRole('checkbox', { name: 'I agree to send this update and project context to Nebius.', exact: true }).check();
      } else {
        await failurePage.locator('.nebius-generation > summary').click();
        await failurePage.getByRole('checkbox', { name: 'I agree to send this brief and generated draft to Nebius for drafting and review.', exact: true }).check();
      }
      const before = await readState(failurePage), postCount = requests.length;
      await failurePage.getByRole('button', { name: operation === 'plan-project' ? 'Generate plan with Nebius' : 'Draft changes with Nebius', exact: true }).click();
      const details = failurePage.locator('[data-nebius-failure]'); await details.waitFor();
      const summary = details.locator('summary');
      for (let step = 0; step < 100 && !await summary.evaluate(element => element === document.activeElement); step++) await failurePage.keyboard.press('Tab');
      assert.equal(await summary.evaluate(element => element === document.activeElement), true, 'Tab reaches request details');
      await failurePage.keyboard.press('Enter'); assert.equal(await details.evaluate(element => element.open), true);
      assert.equal(await summary.evaluate(element => element.matches(':focus-visible')), true);
      await summary.evaluate(element => Promise.all((element.closest('.demo-panel')?.getAnimations() ?? []).map(animation => animation.finished)));
      assert(await summary.evaluate(element => element.getBoundingClientRect().height >= 44));
      assert((await details.innerText()).includes(operation === 'plan-project'
        ? mode === 'known' ? 'Known usage: 45 input tokens and 90 output tokens across 2 calls.' : 'Unknown usage: 1 call.'
        : mode === 'known' ? 'Provider reported 45 input tokens and 90 output tokens.' : 'Provider token usage was not reported.'));
      assert.equal(requests.length, postCount + 1, 'one synthetic request with no retry');
      assert.deepEqual(await readState(failurePage), before, 'failed inference never saves or replaces project work');
      assert.equal(await failurePage.locator(operation === 'plan-project' ? '[data-plan-task]' : '[data-replan-task]').count(), 0);
      assert.equal((await failurePage.locator('body').innerText()).includes('PRIVATE_PROVIDER_DETAILS'), false);
      assert.equal(await failurePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await details.screenshot({ path: path.resolve(`dist/nebius-failure-${operation}-${mode}-${width}.png`) });
      await fillVisible(failurePage.getByLabel(operation === 'plan-project' ? 'Project brief' : 'Project update', { exact: true }), 'Changed synthetic input.');
      await details.waitFor({ state: 'detached' });
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      providerFailureCases.push({ width, operation, mode, passed: true, noSavedWork: true, noRejectedProposal: true, oneRequest: true, keyboardDetails: true, clearedOnInputChange: true });
      await writeFile(path.resolve('dist/nebius-project-failure-progress.json'), JSON.stringify({ syntheticInference: true, expected: 8, observed: providerFailureCases.length, cases: providerFailureCases }, null, 2) + '\n');
    } catch (error) {
      providerFailureCases.push({ width, operation, mode, passed: false, error: error.message });
      await writeFile(path.resolve('dist/nebius-project-failure-progress.json'), JSON.stringify({ syntheticInference: true, expected: 8, observed: providerFailureCases.length, failed: true, cases: providerFailureCases }, null, 2) + '\n');
      throw error;
    } finally { await failureContext.close(); }
  }
  inferenceFailure = null;
  const planningCases = [];
  for (const width of [375, 1280]) {
    for (const mode of ['not_grounded', 'unclear', 'failed', 'malformed', 'unknown', 'budget', 'unknown_budget', 'initial_budget', 'cancelled']) {
      enabled = true; planningMode = mode;
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      try {
        const brief = 'Prepare a synthetic workshop. The audience and date are unknown.';
        await begin(page, brief);
        const before = await readState(page), count = requests.length;
        await page.locator('.nebius-generation > summary').click();
        await page.getByRole('checkbox', { name: 'I agree to send this brief and generated draft to Nebius for drafting and review.', exact: true }).check();
        await page.getByRole('button', { name: 'Generate plan with Nebius', exact: true }).click();
        await page.locator('.nebius-generation [role="status"]').filter({ hasText: mode === 'not_grounded' || mode === 'unclear' ? 'did not clear' : 'A plan is unavailable' }).waitFor();
        assert.equal(await page.locator('[data-plan-editor]').count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Review plan', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Create project', exact: true }).count(), 0);
        assert.deepEqual(await readState(page), before); assert.equal(requests.length, count + 1);
        if (['not_grounded', 'unknown', 'initial_budget'].includes(mode)) await page.locator('.nebius-generation').screenshot({ path: path.resolve(`dist/nebius-v4-${mode}-${width}.png`) });
        const diagnostic = page.locator('[data-planning-diagnostic]');
        if (!['initial_budget', 'malformed'].includes(mode)) {
          assert.equal(await diagnostic.evaluate(element => element.open), false);
          const summary = diagnostic.locator(':scope > summary'); await summary.focus(); await summary.press('Enter');
          assert.equal(await diagnostic.evaluate(element => element.open), true);
          assert(await summary.evaluate(element => element.getBoundingClientRect().height >= 44));
          const evidence = JSON.parse(await diagnostic.locator('pre').innerText());
          assert.equal(evidence.requestId, 'synthetic-plan-request'); assert.equal(evidence.model, model);
          assert.equal(evidence.briefDigest, await planInputDigest({ brief }));
          assert.equal(evidence.candidateDigest, await projectPlanDigest(evidence.plan));
          assert.equal(await diagnostic.locator('input, textarea, select, button, a, img, script').count(), 0);
          if (mode === 'not_grounded') await diagnostic.screenshot({ path: path.resolve(`dist/nebius-v4-read-only-evidence-${width}.png`) });
          if (['not_grounded', 'unclear'].includes(mode)) assert.equal(evidence.plan.title, diagnosticText, 'candidate HTML stays escaped text');
        } else assert.equal(await diagnostic.count(), 0);
        if (mode === 'initial_budget') {
          const trace = page.locator('[data-planning-trace]'); await trace.locator('summary').press('Enter');
          assert.match(await trace.innerText(), /0 of 2 provider calls attempted/);
          assert.match(await trace.innerText(), /reservation refused/);
        }
        if (['budget', 'unknown_budget'].includes(mode)) {
          const trace = page.locator('[data-planning-trace]'); await trace.locator('summary').press('Enter');
          assert.match(await trace.innerText(), /1 budget reservation ·/);
          assert.match(await trace.innerText(), mode === 'unknown_budget' ? /1 unknown reservation\./ : /0 unknown reservations\./);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await fillVisible(page.getByLabel('Project brief', { exact: true }), 'Changed synthetic brief.');
        assert.equal(await page.locator('[data-planning-diagnostic], [data-planning-trace]').count(), 0);
        assert.deepEqual(await readState(page), before); assert.deepEqual(errors, []);
        planningCases.push({ width, mode, passed: true, noEditorOrSave: true, noRetry: true, evidenceClearedOnInput: true });
      } finally { await context.close(); }
    }
    // A failed model result must leave an explicit human outline intact.
    planningMode = 'not_grounded';
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    try {
      await begin(page, ''); await page.getByRole('button', { name: 'Workshop example', exact: true }).click();
      await page.getByLabel('Project title', { exact: true }).fill('My human outline');
      await revealControl(page.locator('[data-plan-nebius-options]')); await page.locator('.nebius-generation > summary').click();
      await page.getByRole('checkbox', { name: 'I agree to send this brief and generated draft to Nebius for drafting and review.', exact: true }).check();
      const before = await readState(page); page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Generate plan with Nebius', exact: true }).click();
      await page.locator('[data-planning-diagnostic]').waitFor();
      assert.equal(await page.getByLabel('Project title', { exact: true }).inputValue(), 'My human outline');
      assert.match(await page.locator('[data-project-provenance]').innerText(), /Human-written .+ example/);
      assert.deepEqual(await readState(page), before);
      planningCases.push({ width, mode: 'manual-preserved', passed: true });
    } finally { await context.close(); }
    // An ignored late failed HTTP result cannot replace a newer reviewed model draft.
    for (const action of ['cancel', 'edit']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      const delay = { ...deferred(), entered: deferred() }; delayedPlan = delay; planningMode = 'failed';
      try {
        await begin(page, 'Old synthetic brief.'); const before = await readState(page);
        await page.locator('.nebius-generation > summary').click();
        await page.getByRole('checkbox', { name: 'I agree to send this brief and generated draft to Nebius for drafting and review.', exact: true }).check();
        await page.getByRole('button', { name: 'Generate plan with Nebius', exact: true }).click();
        await delay.entered.promise;
        if (action === 'cancel') await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
        await fillVisible(page.getByLabel('Project brief', { exact: true }), 'Current synthetic workshop brief.');
        delayedPlan = null; planningMode = 'reviewable';
        await page.getByRole('checkbox', { name: 'I agree to send this brief and generated draft to Nebius for drafting and review.', exact: true }).check();
        await page.getByRole('button', { name: 'Generate plan with Nebius', exact: true }).click();
        await page.getByLabel('Project title', { exact: true }).waitFor(); delay.resolve();
        await page.getByLabel('Project title', { exact: true }).fill('Current human-edited draft');
        await page.getByRole('button', { name: 'Review plan', exact: true }).click();
        await page.getByRole('button', { name: 'Create project', exact: true }).waitFor();
        assert.equal(await page.locator('[data-planning-diagnostic]').count(), 0);
        assert.match(await page.locator('[data-model-review-coverage]').innerText(), /Your edits have not been model reviewed/);
        assert.deepEqual(await readState(page), before);
        planningCases.push({ width, mode: action, passed: true, lateFailureCannotReplaceCurrentDraft: true });
      } finally { delay.resolve(); delayedPlan = null; await context.close(); }
    }
  }
  planningMode = 'reviewable';
  console.log(JSON.stringify({ syntheticInference: true, providerFailureCases, planningCases, cases: results }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
