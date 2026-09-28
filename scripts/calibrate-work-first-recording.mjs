import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { buildModelContextProbeInitScript, RECORDING_PREFLIGHT_SPEC } from './webmcp-recording-preflight.mjs';

const port = 4177;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [path.resolve('svelte-frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: 'svelte-frontend', stdio: 'ignore', windowsHide: true }
);
let browser;

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${origin}/webmcp-challenge`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Calibration server did not start.');
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function focusSnapshot(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const href = element instanceof HTMLAnchorElement ? `${element.pathname}${element.search}` : '';
    return {
      tag: element.tagName,
      text: (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/gu, ' ').trim(),
      visibleText: (element.textContent || '').replace(/\s+/gu, ' ').trim(),
      href,
      id: element.id,
      data: {
        tools: element.hasAttribute('data-tools-trigger'),
        pending: element.classList.contains('pending-approval-link'),
        receipt: element.getAttribute('data-webmcp-receipt') || element.closest('[data-webmcp-receipt]')?.getAttribute('data-webmcp-receipt') || ''
      }
    };
  });
}

async function pressExactly(page, key, label, expectedCount, predicate) {
  const trace = [];
  for (let count = 1; count <= expectedCount; count += 1) {
    await page.keyboard.press(key);
    await settle(page);
    const focus = await focusSnapshot(page);
    trace.push({ count, focus });

    if (count < expectedCount && predicate(focus)) {
      console.log(JSON.stringify({
        calibration: label,
        key,
        expectedCount,
        actualCount: count,
        destination: focus,
        outcome: 'target-arrived-early',
        trace
      }));
      throw new Error(`${label} reached its target after ${count} ${key} presses; expected exactly ${expectedCount}.`);
    }
  }

  const destination = trace.at(-1)?.focus ?? null;
  const matched = predicate(destination);
  console.log(JSON.stringify({
    calibration: label,
    key,
    expectedCount,
    actualCount: expectedCount,
    destination,
    outcome: matched ? 'exact-match' : 'exact-step-mismatch',
    trace
  }));
  assert.ok(matched, `${label} did not reach its target after exactly ${expectedCount} ${key} presses.`);
}

async function waitForRoute(page, pathname) {
  await page.waitForFunction((path) => location.pathname === path, pathname);
  if (pathname !== '/') {
    await page.waitForFunction(() => document.querySelector('[data-webmcp-status-pill]')?.getAttribute('data-webmcp-status') === 'ready');
  }
  await settle(page);
}

async function execute(page, name, input) {
  return page.evaluate(async ({ name, serialized }) => {
    const tools = document.modelContext?.getTools?.() || [];
    const descriptor = tools.find((tool) => tool.name === name);
    if (!descriptor) throw new Error(`Missing tool ${name}`);
    return document.modelContext.executeTool(descriptor, serialized);
  }, { name, serialized: JSON.stringify(input) });
}

async function bodyTab(page, count = 1) {
  const body = page.locator('body');
  for (let index = 0; index < count; index += 1) {
    await body.press('Tab');
    await settle(page);
  }
  console.log(JSON.stringify({ calibration: 'body-tab', count, destination: await focusSnapshot(page) }));
}

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 1101, height: 698 } });
  await context.addInitScript(buildModelContextProbeInitScript(), {
    forbiddenHumanActivations: RECORDING_PREFLIGHT_SPEC.forbiddenHumanActivations
  });
  const page = await context.newPage();
  await page.goto(`${origin}/webmcp-challenge`, { waitUntil: 'networkidle' });
  await waitForRoute(page, '/webmcp-challenge');

  // Exercise the exact recording route without its production-only timeline.
  await page.locator('body').press('PageDown');
  await settle(page);
  await pressExactly(page, 'Tab', 'guide-header-tools', RECORDING_PREFLIGHT_SPEC.keyboard.guideToToolsTabs, (focus) => focus?.data.tools === true);
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Tools' }).waitFor({ state: 'visible' });
  await pressExactly(page, 'Tab', 'tools-priority', RECORDING_PREFLIGHT_SPEC.keyboard.toolsToPriorityTabs, (focus) => focus?.href === '/priority');
  await page.keyboard.press('Enter');
  await waitForRoute(page, '/priority');

  await pressExactly(page, 'Shift+Tab', 'priority-header-guide', RECORDING_PREFLIGHT_SPEC.keyboard.priorityToGuideShiftTabs, (focus) => focus?.href === '/webmcp-challenge' && focus.visibleText === 'Guide');
  await page.keyboard.press('Enter');
  await waitForRoute(page, '/webmcp-challenge');
  await pressExactly(page, 'Shift+Tab', 'guide-fast-brief', RECORDING_PREFLIGHT_SPEC.keyboard.guideToFastBriefShiftTabs, (focus) => focus?.visibleText === 'Use fast-create brief');
  await page.keyboard.press('Enter');
  await execute(page, 'get_projects_handoff_guide', {});
  await page.locator('[data-webmcp-receipt="guide"]').waitFor({ state: 'visible' });

  await bodyTab(page, RECORDING_PREFLIGHT_SPEC.keyboard.guideReaderBodyTabs);
  await pressExactly(page, 'Tab', 'guide-header-work', RECORDING_PREFLIGHT_SPEC.keyboard.guideToWorkTabs, (focus) => focus?.href === '/work' && focus.visibleText === 'Work');
  await page.keyboard.press('Enter');
  await waitForRoute(page, '/work');

  const initialWork = await execute(page, 'get_current_work_view', {});
  assert.equal(initialWork.counts.workspace, 8);
  await execute(page, 'show_work_search', { query: RECORDING_PREFLIGHT_SPEC.workQuery });
  await page.locator('[data-webmcp-receipt="work"]').waitFor({ state: 'visible' });
  await pressExactly(page, 'Shift+Tab', 'work-header-tools', RECORDING_PREFLIGHT_SPEC.keyboard.workToToolsShiftTabs, (focus) => focus?.data.tools === true);
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Tools' }).waitFor({ state: 'visible' });
  await pressExactly(page, 'Tab', 'tools-review', RECORDING_PREFLIGHT_SPEC.keyboard.toolsToReviewTabs, (focus) => focus?.href === '/review');
  await page.keyboard.press('Enter');
  await waitForRoute(page, '/review');

  const initialReview = await execute(page, 'get_current_review_queue', {});
  assert.equal(initialReview.counts.totalReview, 5);
  const scopedReview = await execute(page, 'set_review_scope', { query: RECORDING_PREFLIGHT_SPEC.workQuery, filter: RECORDING_PREFLIGHT_SPEC.reviewFilter });
  await page.locator('[data-webmcp-receipt="review"]').waitFor({ state: 'visible' });
  await pressExactly(page, 'Shift+Tab', 'review-header-tools', RECORDING_PREFLIGHT_SPEC.keyboard.reviewToToolsShiftTabs, (focus) => focus?.data.tools === true);
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Tools' }).waitFor({ state: 'visible' });
  await pressExactly(page, 'Tab', 'tools-next', RECORDING_PREFLIGHT_SPEC.keyboard.toolsToNextTabs, (focus) => focus?.href === '/next');
  await page.keyboard.press('Enter');
  await waitForRoute(page, '/next');

  const nextEditor = await execute(page, 'get_current_next_editor', {});
  const currentWorkId = nextEditor.work.id;
  const workItem = scopedReview.review.items.find((item) => item.id === currentWorkId) || scopedReview.review.upNext;
  const evidence = [
    { workId: currentWorkId, field: 'workflow', expectedValue: workItem.workflow },
    { workId: currentWorkId, field: 'blocker', expectedValue: workItem.blocker }
  ];
  await execute(page, 'prepare_next_action', {
    choice: RECORDING_PREFLIGHT_SPEC.nextChoice,
    expectedMode: nextEditor.editor.mode,
    expectedChoice: nextEditor.editor.choice,
    evidence
  });
  await page.locator('[data-webmcp-receipt="next"]').waitFor({ state: 'visible' });
  await pressExactly(page, 'Shift+Tab', 'next-header-work', RECORDING_PREFLIGHT_SPEC.keyboard.nextToWorkShiftTabs, (focus) => focus?.href === '/work' && focus.visibleText === 'Work');
  await page.keyboard.press('Enter');
  await waitForRoute(page, '/work');

  const currentWork = await execute(page, 'get_current_work_view', {});
  await execute(page, 'create_work_drafts', {
    expectedWorkspaceCount: currentWork.counts.workspace,
    drafts: RECORDING_PREFLIGHT_SPEC.draftTitles.map((title) => ({ title }))
  });
  await page.locator('[data-webmcp-receipt="work"]').waitFor({ state: 'visible' });
  await pressExactly(page, 'Shift+Tab', 'work-header-pending', RECORDING_PREFLIGHT_SPEC.keyboard.workToPendingShiftTabs, (focus) => focus?.data.pending === true);
  await page.keyboard.press('Enter');
  const pendingDialog = page.getByRole('dialog', { name: /Pending approvals/ });
  await pendingDialog.waitFor({ state: 'visible' });
  await pressExactly(page, 'Tab', 'pending-review-on-next', RECORDING_PREFLIGHT_SPEC.keyboard.pendingToNextTabs, (focus) => focus?.href.startsWith('/next?pack=') && focus.visibleText === 'Review on Next');
  await page.keyboard.press('Enter');
  await waitForRoute(page, '/next');
  console.log(JSON.stringify({ calibration: 'complete', currentPath: new URL(page.url()).pathname }));
} finally {
  await browser?.close();
  server.kill();
}
