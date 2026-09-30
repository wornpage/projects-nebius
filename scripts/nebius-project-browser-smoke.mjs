import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { OPERATION_PROFILES } from '../svelte-frontend/src/lib/nebius-routing-contract.mjs';

const root = path.resolve('dist/static-publish');
const storageKey = 'projects-webmcp-challenge-state-v1';
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
const requests = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/nebius/')) {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (url.pathname === '/api/nebius/config') {
      const operation = url.searchParams.get('operation');
      if (!Object.hasOwn(OPERATION_PROFILES, operation)) { response.statusCode = 400; response.end('{}'); return; }
      response.statusCode = enabled ? 200 : 404;
      response.end(JSON.stringify(enabled ? { available: true, operation, ...OPERATION_PROFILES[operation], requestedModel: model, promptVersion: 'task-change.v1', reviewVersion: 'nebius-review.v1', planVersion: 'project-plan.v1', replanVersion: 'project-replan.v1' } : { code: 'nebius_disabled' })); return;
    }
    if (url.pathname === '/api/nebius/plan-project' && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body));
      response.end(JSON.stringify({ requestId: 'synthetic-plan-request', plan, model, requestedModel: model, promptVersion: 'project-plan.v1', applied: false, usage: { input_tokens: 80, output_tokens: 260 } })); return;
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
  for (const disclosure of await control.locator('xpath=ancestor::details').all()) {
    if (!(await disclosure.evaluate(element => element.open))) await disclosure.locator(':scope > summary').press('Enter');
  }
}
async function fillVisible(control, value) { await revealControl(control); await control.fill(value); }
async function begin(page, brief) {
  await page.goto(`${origin}/work`);
  await page.locator('[data-nebius-project-workspace]').waitFor();
  const trigger = page.getByRole('button', { name: 'New project', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  await fillVisible(page.getByLabel('Project brief', { exact: true }), brief);
}
async function reviewAndApprove(page) {
  const priorCount = (await readState(page))?.projects?.length ?? 0;
  await page.getByRole('button', { name: 'Review plan', exact: true }).click();
  await page.getByRole('button', { name: 'Approve and create project', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('[data-project-draft-heading]'));
  await page.screenshot({ path: path.resolve(`dist/nebius-plan-review-${page.viewportSize().width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Approve and create project', exact: true }).click();
  await page.waitForFunction(({ key, count }) => { const saved = JSON.parse(localStorage.getItem(key)); return (saved?.state || saved)?.projects?.length === count + 1; }, { key: storageKey, count: priorCount });
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.addInitScript(({ storageKey, seed }) => { if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify({ packs: seed, pendingNextActionDrafts: [] })); }, { storageKey, seed });
    const errors = [], external = [];
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    enabled = false;
    await begin(page, 'Prepare a concise workshop outline and review it.');
    const beforeManual = await readState(page), callsBefore = requests.length;
    await page.getByRole('button', { name: 'Build plan myself', exact: true }).click();
    await page.getByLabel('Project title', { exact: true }).fill('My workshop');
    const task = page.locator('[data-plan-task]').first();
    await task.getByLabel('Task title', { exact: true }).fill('Write the workshop outline');
    await task.getByLabel('Why it matters', { exact: true }).fill('Make the session useful.');
    await task.getByLabel('Next step', { exact: true }).fill('Draft the learning objective.');
    await task.getByLabel('Completion criteria', { exact: true }).fill('A learning objective is written.');
    assert.deepEqual((await readState(page)).packs, beforeManual.packs, 'editing a manual plan creates no tasks');
    page.once('dialog', async dialog => { assert.equal(dialog.type(), 'confirm'); await dialog.dismiss(); });
    await page.getByRole('link', { name: 'Guide', exact: true }).click();
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
    await page.locator('#project-scope').waitFor();
    assert.equal((await readState(page)).projects[0].title, 'My workshop');
    assert.equal(await page.locator('#project-scope').inputValue(), project.id);
    await page.screenshot({ path: path.resolve(`dist/nebius-project-workspace-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no horizontal overflow at ${width}`);
    // Re-entering a selected project after a task visit preserves membership.
    const manualTask = manual.packs.find(item => item.projectId === project.id);
    await page.goto(`${origin}/next?pack=${encodeURIComponent(manualTask.id)}`);
    await page.getByRole('heading', { level: 1, name: manualTask.title, exact: true }).waitFor();
    assert.equal(await page.getByLabel('Switch task', { exact: true }).inputValue(), manualTask.id, 'the Next page selects the created task');
    await page.getByRole('link', { name: 'Work', exact: true }).click();
    await page.waitForURL('**/work');
    assert.equal(await page.locator('#project-scope').inputValue(), project.id);
    enabled = true;
    await begin(page, 'Organize a community workshop. Define the outline, confirm a venue, then prepare invitations.');
    const beforeModel = await readState(page), requestCount = requests.length;
    await page.locator('.nebius-generation > summary').click();
    await page.getByRole('checkbox', { name: 'I agree to send this project brief to Nebius.', exact: true }).check();
    await page.getByRole('button', { name: 'Generate plan with Nebius', exact: true }).click();
    await page.getByLabel('Project title', { exact: true }).waitFor();
    assert.equal(requests.length, requestCount + 1);
    assert.deepEqual(Object.keys(requests.at(-1)).sort(), ['brief', 'consent', 'promptVersion', 'requestedModel']);
    assert.equal(requests.at(-1).consent, true);
    assert.deepEqual(await readState(page), beforeModel, 'generation does not write the workspace');
    assert.equal(await page.locator('[data-plan-task]').count(), 3);
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
    await reviewAndApprove(page);
    const approved = await readState(page), modelProject = approved.projects.find(item => item.title === 'Our reviewed workshop');
    assert(modelProject); assert.equal(modelProject.source, 'nebius');
    const tasks = approved.packs.filter(item => item.projectId === modelProject.id);
    assert.equal(tasks.length, 3); assert.equal(tasks.filter(item => item.status === 'blocked').length, 2);
    assert(tasks.filter(item => item.blockedBy).every(item => tasks.some(candidate => candidate.id === item.blockedBy)));
    await page.reload(); await page.locator('#project-scope').waitFor();
    const reloaded = await readState(page);
    assert.deepEqual(reloaded.packs.filter(item => item.projectId === modelProject.id), tasks, 'reload retains complete dependency graph');
    assert.equal(reloaded.projects.length, 2);
    await page.goto(`${origin}/work?focus=${encodeURIComponent(manualTask.id)}`);
    await page.waitForFunction(({ key, id }) => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).selectedProjectId === id; }, { key: storageKey, id: project.id });
    assert.equal(await page.locator('#project-scope').inputValue(), project.id, 'an explicit focus link reveals the other project');
    await page.getByRole('link', { name: `Set the next action for ${manualTask.title}`, exact: true }).waitFor();
    await page.locator('#project-scope').selectOption('');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    // Portability includes project metadata and membership through the existing owner.
    await page.goto(`${origin}/webmcp-challenge`);
    await page.locator('details.worn-accordion summary').filter({ hasText: 'Backup and restore' }).click();
    await page.getByRole('button', { name: 'Prepare export', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download export' }).click();
    const exported = await readFile(await (await download).path(), 'utf8');
    assert.equal(JSON.parse(exported).state.projects.length, 2);
    await page.locator('.challenge-import-label input').setInputFiles({ name: 'project-workspace.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm Replace', exact: true }).click();
    await page.goto(`${origin}/work`); await page.locator('#project-scope').waitFor();
    assert.deepEqual((await readState(page)).projects, JSON.parse(exported).state.projects);
    assert.equal((await readState(page)).packs.filter(item => item.projectId === modelProject.id).length, 3);
    // A changed circumstance produces an editable, consented revision with no early writes.
    await page.locator('#project-scope').selectOption(modelProject.id);
    await page.waitForFunction(({ key, id }) => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).selectedProjectId === id; }, { key: storageKey, id: modelProject.id });
    const beforeRevision = await readState(page), beforeRequests = requests.length;
    await page.getByRole('button', { name: 'Update project', exact: true }).click();
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
    await page.getByRole('button', { name: 'Approve and save changes', exact: true }).click();
    await page.locator('[data-project-updated]').waitFor();
    const revised = await readState(page), outlineId = `${modelProject.id}:outline`;
    assert.equal(revised.packs.find(item => item.id === outlineId).nextStep, 'Write a beginner-friendly learning objective.');
    assert.deepEqual(revised.packs.filter(item => item.id !== outlineId), beforeRevision.packs.filter(item => item.id !== outlineId));
    await page.reload(); await page.locator('#project-scope').waitFor();
    assert.equal((await readState(page)).packs.find(item => item.id === outlineId).nextStep, 'Write a beginner-friendly learning objective.');
    // Manual changes work offline and pending proposals refuse concurrent edits.
    await page.getByRole('button', { name: 'Update project', exact: true }).click();
    await page.getByLabel('Project update', { exact: true }).fill('Clarify the objective wording.');
    await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
    const openTask = page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Define the workshop$/ }) });
    await revealControl(openTask.getByLabel('Task title', { exact: true }));
    await openTask.getByLabel('Task title', { exact: true }).fill('Define  the workshop');
    await openTask.getByLabel('Next step', { exact: true }).fill('Write and review the beginner objective.');
    await page.getByRole('textbox', { name: 'Quick-add a work item', exact: true }).fill('Unrelated quick task');
    page.once('dialog', async dialog => dialog.dismiss());
    await page.locator('[data-work-quick-create-submit]').click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); return (saved.state || saved).packs.some(item => item.title === 'Unrelated quick task'); }, storageKey);
    assert.equal(await page.locator('#project-scope').inputValue(), modelProject.id, 'quick-add cannot discard a draft without consent');
    assert.equal(await openTask.getByLabel('Next step', { exact: true }).inputValue(), 'Write and review the beginner objective.');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Approve and save changes', exact: true }).click();
    await page.locator('[data-project-updated]').waitFor();
    assert.equal((await readState(page)).packs.find(item => item.id === outlineId).nextStep, 'Write and review the beginner objective.');
    assert.equal((await readState(page)).packs.find(item => item.id === outlineId).title, 'Define the workshop', 'review and save use the same normalized title');
    await context.setOffline(false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Update project', exact: true }).click();
    await page.getByLabel('Project update', { exact: true }).fill('A draft that will become stale.');
    await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
    await fillVisible(page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Define the workshop$/ }) }).getByLabel('Next step', { exact: true }), 'This stale value must never save.');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    const otherTab = await context.newPage(); await otherTab.goto(`${origin}/work`);
    await otherTab.evaluate(({ key, id }) => { const saved = JSON.parse(localStorage.getItem(key)); saved.state.packs.find(item => item.id === id).nextStep = 'Saved by another tab.'; saved.revision = crypto.randomUUID(); localStorage.setItem(key, JSON.stringify(saved)); }, { key: storageKey, id: outlineId });
    await otherTab.close();
    await page.getByRole('button', { name: 'Approve and save changes', exact: true }).click();
    await page.locator('[data-project-update] [role="alert"]').first().waitFor();
    assert.equal((await readState(page)).packs.find(item => item.id === outlineId).nextStep, 'Saved by another tab.', 'concurrent persisted change survives refused approval');
    page.once('dialog', async dialog => dialog.accept()); await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    // Full sample reset explicitly clears projects and membership together.
    await page.goto(`${origin}/webmcp-challenge`);
    await page.getByText('Reset sample workspace', { exact: true }).click();
    await page.getByRole('button', { name: 'Reset sample', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm reset', exact: true }).click();
    await page.waitForFunction(key => { const saved = JSON.parse(localStorage.getItem(key)); const state = saved?.state || saved; return !state || (!state.projects?.length && state.packs.length === 4); }, storageKey);
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
      assert.match(await page.locator('[data-project-provenance]').innerText(), /Example plan/);
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
    assert.equal(starterApproved.projects.length, 1); assert.equal(starterApproved.projects[0].source, 'manual');
    assert.equal(starterApproved.packs.length, 7); assert.equal(requests.length, starterCalls);
    await page.reload(); await page.locator('#project-scope').waitFor();
    assert.equal((await readState(page)).projects[0].title, 'My first release');
    // Execute the actual visible project journey through evidence and completion.
    const journeyId = starterApproved.projects[0].id;
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
        const nextLinks = index === 1 ? page.getByRole('navigation', { name: 'Project next work', exact: true }) : page.locator('[data-ready-next]');
        await nextLinks.getByRole('link', { name: nextTitle, exact: true }).click();
      }
      await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
      assert.equal(await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open), true, 'the Evidence tab exposes the recording form');
      await page.locator('#nebius-review-evidence').fill(evidence[index]);
      await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
      await page.getByRole('button', { name: 'Mark done with recorded evidence', exact: true }).click();
      await page.waitForURL('**/work?focus=*');
      await page.locator('#project-scope').waitFor();
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
        await page.locator('[data-ready-next]').getByRole('link', { name: successor.title, exact: true }).waitFor();
        assert(!successor.activity.some(text => text.includes('finished with proof')));
      }
      if (index === 0) {
        await page.screenshot({ path: path.resolve(`dist/nebius-project-progress-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Update project', exact: true }).click();
        await page.getByLabel('Project update', { exact: true }).fill('The brief is confirmed. Prioritize support navigation wording in the page draft.');
        await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
        const taskEditor = page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Update the page$/ }) });
        await fillVisible(taskEditor.getByLabel('Next step', { exact: true }), 'Prepare support navigation wording from the confirmed brief.');
        await page.getByRole('button', { name: 'Review changes', exact: true }).click();
        await page.getByRole('button', { name: 'Approve and save changes', exact: true }).click();
        await page.locator('[data-project-updated]').waitFor();
        assert.equal((await readState(page)).packs.find(item => item.id === journeyTasks[0]).status, 'done');
      }
    }
    await page.reload(); await page.locator('#project-scope').waitFor();
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
    await page.getByRole('link', { name: 'Work', exact: true }).click();
    await page.getByRole('button', { name: 'Update project', exact: true }).click();
    const updateWhy = 'Switch online because the venue is unavailable. The meeting link still needs confirmation.';
    const taskWhy = 'The workshop moved online; we still need the meeting link.';
    await page.getByLabel('Project update', { exact: true }).fill(updateWhy);
    await page.getByRole('button', { name: 'Edit tasks myself', exact: true }).click();
    const workshopEdit = page.locator('[data-replan-task]').filter({ has: page.locator('legend').filter({ hasText: /^Draft the agenda and materials$/ }) });
    await fillVisible(workshopEdit.getByLabel('Blocker', { exact: true }), 'Meeting link unconfirmed');
    await fillVisible(workshopEdit.getByLabel('Reason', { exact: true }), taskWhy);
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByText('The approved summary and each task’s reason will be saved in its activity.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Approve and save changes', exact: true }).click();
    await page.locator('[data-project-updated]').waitFor();
    await page.reload();
    rehearsal = await readState(page);
    const revisedSecond = rehearsal.packs.find(item => item.id === secondTask.id);
    assert.equal(revisedSecond.blocker, 'Meeting link unconfirmed');
    assert(revisedSecond.activity.at(-1).includes(updateWhy));
    assert(revisedSecond.activity.at(-1).includes(taskWhy));
    await page.goto(`${origin}/next?pack=${encodeURIComponent(firstTask.id)}`);
    await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
    assert.equal(await page.locator('[data-nebius-evidence-review]').evaluate(element => element.open), true);
    assert.equal(await page.locator('[data-nebius-saved-criteria-text]').innerText(), firstTask.doneWhen);
    assert.equal(await page.locator('[data-nebius-optional-review]').evaluate(element => element.open), false, 'saved criteria are visible without opening AI review');
    await page.locator('[data-nebius-evidence-review]').screenshot({ path: path.resolve(`dist/nebius-rehearsal-criteria-${width}.png`) });
    await page.getByLabel('Evidence supplied by you', { exact: true }).fill('Rehearsal observation: eight beginners, an online session of 60 minutes, and the goal of identifying a safe first repair step are recorded.');
    await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
    await page.getByRole('button', { name: 'Mark done with recorded evidence', exact: true }).click();
    await page.waitForURL('**/work?focus=*');
    await page.locator('#project-scope').waitFor();
    rehearsal = await readState(page);
    const stillBlocked = rehearsal.packs.find(item => item.id === secondTask.id);
    assert.equal(stillBlocked.status, 'blocked');
    assert.equal(stillBlocked.blocker, 'Meeting link unconfirmed');
    assert.equal(stillBlocked.blockedBy, '');
    assert.deepEqual(rehearsal.actionReceipt.unblockedWorkIds, []);
    assert.equal(await page.locator('[data-ready-next]').count(), 0, 'a separate blocker is never advertised as ready');
    assert.equal(await page.locator('[data-project-progress-done]').innerText(), '1/3');
    await page.reload(); await page.locator('#project-scope').waitFor();
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
    results.push({ width, manualWithoutInference: true, generatedPlanNoWrite: true, approvalAtomic: true, cyclesRefused: true, dependencyReload: true, projectScope: true, explicitFocus: true, exportImport: true, reviewedReplan: true, manualReplanOffline: true, quickAddPreservesDraft: true, concurrentApprovalRefused: true, fullReset: true, examplePlans: 3, examplesNoInference: true, exampleApprovalReload: true, completedProjectJourney: true, freshReplanAfterCompletion: true, nextTaskLinks: true, independentBlockerPreserved: true, approvedReasonReload: true, manualCriteriaVisible: true, explicitBlockerResolution: true, rehearsalNoInference: true, overflow: false });
    await context.close();
  }
  console.log(JSON.stringify({ syntheticInference: true, cases: results }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
