import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright-core';

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const storageKey = 'projects-webmcp-challenge-state-v1';
const server = spawn(
	process.execPath,
	[path.resolve('svelte-frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
	{ cwd: 'svelte-frontend', stdio: 'ignore', windowsHide: true }
);
let browser;

async function waitForServer() {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch(`${origin}/work`);
			if (response.ok) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Work smoke server did not start at ${origin}.`);
}

async function assertCardCommands(page, density) {
	const sameDestination = page.locator('[data-pack-id="same-destination"]');
	await sameDestination.waitFor({ state: 'visible' });
	assert.equal(await sameDestination.locator('a[href="/next?pack=same-destination"]').count(), 1, `${density} cards retain one canonical Next title link.`);
	assert.equal(await sameDestination.locator('[data-work-primary-navigation]').count(), 0, `${density} cards omit only the duplicate primary Next link.`);

	const distinctNavigation = page.locator('[data-pack-id="review-destination"]');
	assert.equal(await distinctNavigation.locator('[data-work-primary-navigation][href="/review?focus=review-destination"]').count(), 1, `${density} cards retain a distinct Review navigation command.`);

	const mutation = page.locator('[data-pack-id="mutation-command"]');
	assert.equal(await mutation.locator('[data-work-primary-mutation]').count(), 1, `${density} cards retain mutation commands.`);

	const terminal = page.locator('[data-pack-id="terminal-done"]');
	assert.equal(await terminal.locator('[data-work-terminal-title]').count(), 1, `${density} cards render completed titles without Next navigation.`);
	assert.equal(await terminal.locator('a[href^="/next?pack="]').count(), 0, `${density} cards do not expose a completed Next link.`);
	assert.equal(await terminal.locator('[data-work-primary-navigation], [data-work-primary-mutation]').count(), 0, `${density} cards do not expose a completed primary command.`);
}

async function waitForActiveCommand(page, expectedLabel) {
	await page.waitForFunction((label) => {
		const input = document.querySelector('input[aria-label="Filter work commands"]');
		const activeId = input?.getAttribute('aria-activedescendant');
		const active = activeId ? document.getElementById(activeId) : null;
		return active?.querySelector('span')?.textContent?.trim() === label;
	}, expectedLabel);
}

async function assertPaletteInputFocus(page) {
	assert.equal(
		await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
		'Filter work commands',
		'Command navigation keeps DOM focus in the combobox input.'
	);
}

async function readWorkspace(page) {
	return page.evaluate((key) => {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed.state ?? parsed;
	}, storageKey);
}

try {
	await waitForServer();
	browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
	const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
	await page.addInitScript(() => {
		window.__workToolRegistrations = [];
		Object.defineProperty(document, 'modelContext', {
			configurable: true,
			value: {
				registerTool(tool) {
					window.__workToolRegistrations.push({
						name: tool.name,
						annotations: structuredClone(tool.annotations)
					});
				}
			}
		});
	});
	const seedRequested = Promise.withResolvers();
	const seedRelease = Promise.withResolvers();
	await page.route('**/data/demo-packs.json', async (route) => {
		seedRequested.resolve();
		await seedRelease.promise;
		await route.continue();
	});
	await page.goto(`${origin}/work`, { waitUntil: 'domcontentloaded' });
	await seedRequested.promise;
	await page.getByRole('status', { name: 'Loading' }).waitFor({ state: 'visible' });
	assert.equal(await page.getByText('No sample work available', { exact: true }).count(), 0, 'Cold Work load never flashes a false empty state.');
	seedRelease.resolve();
	await page.waitForLoadState('networkidle');
	await page.unroute('**/data/demo-packs.json');
	await page.evaluate((key) => {
		localStorage.setItem(key, JSON.stringify({
			packs: [
				{ id: 'same-destination', title: 'Same destination', status: 'active', blocker: 'none', next: '', activity: ['[2026-09-03 09:00] Created.'] },
				{ id: 'review-destination', title: 'Review destination', status: 'blocked', blocker: 'Waiting for review', next: 'Open', activity: ['[2026-09-03 09:00] Created.'] },
				{ id: 'mutation-command', title: 'Mutation command', status: 'active', blocker: 'none', next: 'Done', activity: ['[2026-09-03 09:00] Created.'] },
				{ id: 'terminal-done', title: 'Terminal done', status: 'done', blocker: 'none', next: '', activity: ['[2026-09-03 09:00] Finished.'] }
			]
		}));
	}, storageKey);
	await page.reload({ waitUntil: 'networkidle' });
	await page.locator('[data-pack-id="same-destination"]').waitFor({ state: 'visible' });

	const registrationsBeforeQuickAdd = await page.evaluate(() => structuredClone(window.__workToolRegistrations));
	assert.deepEqual(registrationsBeforeQuickAdd.map((tool) => tool.name), ['get_current_work_view', 'show_work_search', 'create_work_drafts']);
	await assertCardCommands(page, 'grid');
	await page.goto(`${origin}/next?pack=terminal-done`, { waitUntil: 'networkidle' });
	await page.getByText('Work item not found', { exact: true }).waitFor({ state: 'visible' });
	assert.equal(await page.locator('[data-next-choices]').count(), 0, 'A direct completed Next URL never renders an editor.');
	await page.goto(`${origin}/work`, { waitUntil: 'networkidle' });
	await page.locator('[data-pack-id="same-destination"]').waitFor({ state: 'visible' });

	const paletteTrigger = page.getByRole('button', { name: 'Command palette' });
	await paletteTrigger.focus();
	await page.keyboard.press('Control+K');
	const paletteDialog = page.getByRole('dialog', { name: 'Work command palette' });
	await paletteDialog.waitFor({ state: 'visible' });
	await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Filter work commands');
	const paletteInput = page.getByRole('combobox', { name: 'Filter work commands' });
	assert.equal(await paletteInput.getAttribute('aria-controls'), 'work-command-listbox');
	assert.equal(await paletteInput.getAttribute('aria-expanded'), 'true');
	assert.equal(await paletteInput.getAttribute('aria-autocomplete'), 'list');
	const paletteOptions = page.locator('#work-command-listbox [role="option"]');
	assert.equal(await paletteOptions.count(), 9, 'Every rendered command participates in one listbox.');
	assert.ok(await page.locator('#work-command-listbox [role="option"][aria-disabled="true"]').count() >= 2, 'Unavailable commands stay exposed and disabled.');
	await waitForActiveCommand(page, 'Focus search');
	await assertPaletteInputFocus(page);

	await paletteInput.press('ArrowUp');
	await waitForActiveCommand(page, 'Show advanced controls');
	await assertPaletteInputFocus(page);
	await paletteInput.press('ArrowDown');
	await waitForActiveCommand(page, 'Focus search');
	await paletteInput.press('ArrowDown');
	await waitForActiveCommand(page, 'Open Review');
	await paletteInput.press('ArrowDown');
	await waitForActiveCommand(page, 'Open WebMCP guide');
	await paletteInput.press('ArrowDown');
	await waitForActiveCommand(page, 'Clear all filters');
	await assertPaletteInputFocus(page);

	await paletteInput.fill('search');
	await waitForActiveCommand(page, 'Focus search');
	await paletteInput.press('Enter');
	await paletteDialog.waitFor({ state: 'hidden' });
	await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Filter work items by text');

	await paletteTrigger.focus();
	await paletteTrigger.click();
	await paletteDialog.waitFor({ state: 'visible' });
	const reopenedPaletteInput = page.getByRole('combobox', { name: 'Filter work commands' });
	await reopenedPaletteInput.fill('advanced');
	await waitForActiveCommand(page, 'Show advanced controls');
	await reopenedPaletteInput.press('Escape');
	await paletteDialog.waitFor({ state: 'hidden' });
	await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Command palette');

	await page.getByRole('button', { name: 'Additional work filters' }).click();
	await page.getByRole('tab', { name: 'Cards' }).click();
	await assertCardCommands(page, 'card');
	const manualCard = page.locator('[data-pack-id="same-destination"]');
	assert.equal(await manualCard.getAttribute('draggable'), null, 'The full Work card is not an undisclosed drag source.');
	const moveHandle = manualCard.locator('[data-work-drag-handle]');
	assert.equal(await moveHandle.getAttribute('draggable'), 'true', 'Card dragging begins from the labeled Move handle.');
	await manualCard.locator('summary').filter({ hasText: 'Other actions' }).click();
	const energySelect = manualCard.getByRole('combobox', { name: 'Set energy for Same destination' });
	await energySelect.selectOption('high');
	await page.waitForFunction((key) => {
		const raw = localStorage.getItem(key);
		if (!raw) return false;
		const parsed = JSON.parse(raw);
		const state = parsed.state ?? parsed;
		return state.packs?.find((pack) => pack.id === 'same-destination')?.energy === 'high';
	}, storageKey);
	await page.locator('#sort-work').selectOption('manual');
	await manualCard.focus();
	await page.getByRole('button', { name: 'Move focused down' }).click();
	await page.waitForFunction((key) => {
		const raw = localStorage.getItem(key);
		if (!raw) return false;
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed.state?.manualOrder) && parsed.state.manualOrder.includes('same-destination');
	}, storageKey);

	const title = 'Quick add receipt smoke';
	await page.locator('.quick-create-input').fill(title);
	await page.locator('[data-work-quick-create-submit]').click();
	const receipt = page.locator('#work-receipt');
	await receipt.waitFor({ state: 'visible' });
	assert.match((await receipt.textContent()) ?? '', /Created Quick add receipt smoke\./u);
	await page.waitForFunction(() => document.activeElement?.id === 'work-receipt');
	assert.equal(await page.evaluate(() => document.activeElement?.id), 'work-receipt', 'Quick Add focuses the shared durable action receipt.');
	assert.deepEqual(await page.evaluate(() => structuredClone(window.__workToolRegistrations)), registrationsBeforeQuickAdd, 'Quick Add does not change Work WebMCP authority.');

	await page.reload({ waitUntil: 'networkidle' });
	await page.locator('#work-receipt').waitFor({ state: 'visible' });
	assert.match((await page.locator('#work-receipt').textContent()) ?? '', /Created Quick add receipt smoke\./u);
	assert.equal(await page.locator('[data-work-item]').filter({ hasText: title }).count(), 1, 'Quick Add persists the created item with its receipt.');

	// Replace the fixture with one explicit decision and prove the complete
	// human flow now finishes on Work without Review -> Next route hopping.
	await page.evaluate((key) => {
		localStorage.setItem(key, JSON.stringify({
			filter: 'active',
			packs: [
				{
					id: 'first-decision',
					title: 'First ranked decision',
					status: 'active',
					blocker: 'none',
					next: 'Open',
					decision: true,
					decider: 'Operations owner',
					area: 'Operations',
					activity: ['[2026-09-03 08:00] Created.']
				},
				{
					id: 'inline-decision',
					title: 'Confirm launch handoff',
					status: 'blocked',
					blocker: 'Waiting on final details',
					next: 'Open',
					decision: true,
					decider: 'Launch owner',
					area: 'Launch',
					sources: ['Launch brief'],
					activity: ['[2026-09-03 09:00] Created.']
				},
				{
					id: 'supporting-work',
					title: 'Package release notes',
					status: 'active',
					blocker: 'none',
					next: 'Open',
					area: 'Launch',
					activity: ['[2026-09-03 09:00] Created.']
				}
			]
		}));
	}, storageKey);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`${origin}/work`, { waitUntil: 'networkidle' });
	const ordinaryDecision = page.locator('[data-decision-workspace]');
	await ordinaryDecision.waitFor({ state: 'visible' });
	assert.equal(
		await ordinaryDecision.locator('.decision-workspace-disclosure').getAttribute('open'),
		null,
		'An ordinary Work visit starts with the Decision Workspace summarized.'
	);
	assert.equal(await ordinaryDecision.locator('.decision-workspace-body').isVisible(), false);
	const firstWorkTop = await page.locator('[data-work-item]').first().evaluate((item) => item.getBoundingClientRect().top);
	assert.ok(firstWorkTop < 900, `The first Work card should enter the 900px desktop viewport; observed y=${firstWorkTop}.`);

	await page.setViewportSize({ width: 900, height: 800 });
	await page.goto(`${origin}/work?focus=inline-decision&context=pending-decision`, { waitUntil: 'networkidle' });

	const decision = page.locator('[data-decision-workspace]');
	await decision.waitFor({ state: 'visible' });
	assert.equal(new URL(page.url()).pathname, '/work');
	assert.equal(await decision.getAttribute('data-decision-pack-id'), 'inline-decision', 'The pending link wins over the first ranked decision.');
	assert.equal(await decision.getAttribute('data-decision-resumed'), 'true');
	assert.equal(await decision.getAttribute('data-decision-outside-view'), 'true');
	assert.equal(await decision.locator('.decision-workspace-disclosure').getAttribute('open'), '', 'A resumed pending decision automatically opens its editor.');
	assert.match((await decision.locator('[data-decision-resume-status]').textContent()) ?? '', /outside the current list filters[\s\S]*left unchanged/u);
	assert.match((await decision.locator('[data-decision-workspace-title]').textContent()) ?? '', /Confirm launch handoff/u);
	assert.doesNotMatch((await decision.locator('[data-decision-workspace-title]').textContent()) ?? '', /First ranked decision/u);
	assert.match((await decision.locator('[data-decision-evidence]').textContent()) ?? '', /Workflow[\s\S]*Blocked[\s\S]*Blocker[\s\S]*Waiting on final details/u);
	assert.match((await decision.textContent()) ?? '', /Observe[\s\S]*Narrow[\s\S]*Prepare[\s\S]*Decide/u);
	await decision.getByRole('button', { name: 'Why this decision is surfaced' }).click();
	assert.equal(await decision.locator('[data-decision-workspace-review]').count(), 1, 'Review remains a secondary deep link.');
	assert.equal(await decision.locator('[data-decision-workspace-next]').count(), 1, 'Next remains a secondary full-editor deep link.');

	const desktopDecisionRhythm = await decision.evaluate((workspace) => {
		const rootStyle = getComputedStyle(document.documentElement);
		const explanation = workspace.querySelector('.decision-workspace-explanation');
		const grid = workspace.querySelector('.decision-editor-grid');
		const panels = [...workspace.querySelectorAll('.decision-editor-panel')];
		if (!(explanation instanceof HTMLElement) || !(grid instanceof HTMLElement) || panels.length !== 2) return null;
		return {
			tokens: {
				space3: Number.parseFloat(rootStyle.getPropertyValue('--worn-space-3')),
				space4: Number.parseFloat(rootStyle.getPropertyValue('--worn-space-4')),
				space5: Number.parseFloat(rootStyle.getPropertyValue('--worn-space-5')),
				radiusMd: Number.parseFloat(rootStyle.getPropertyValue('--worn-radius-md'))
			},
			explanationPadding: Number.parseFloat(getComputedStyle(explanation).paddingBlockStart),
			gridGap: Number.parseFloat(getComputedStyle(grid).gap),
			outerRadius: Number.parseFloat(getComputedStyle(workspace).borderTopLeftRadius),
			panelBorders: panels.map((panel) => Number.parseFloat(getComputedStyle(panel).borderTopWidth)),
			contained: workspace.scrollWidth <= workspace.clientWidth + 1
		};
	});
	assert.ok(desktopDecisionRhythm, 'Decision workspace exposes the shared desktop rhythm.');
	assert.deepEqual(desktopDecisionRhythm.tokens, { space3: 12, space4: 16, space5: 20, radiusMd: 10 });
	assert.equal(desktopDecisionRhythm.explanationPadding, desktopDecisionRhythm.tokens.space4);
	assert.equal(desktopDecisionRhythm.gridGap, desktopDecisionRhythm.tokens.space3);
	assert.equal(desktopDecisionRhythm.outerRadius, desktopDecisionRhythm.tokens.radiusMd);
	assert.deepEqual(desktopDecisionRhythm.panelBorders, [0, 0], 'Inner decision panels are quieter than the emphasized outer surface.');
	assert.equal(desktopDecisionRhythm.contained, true);

	await page.setViewportSize({ width: 390, height: 800 });
	const compactDecisionRhythm = await decision.evaluate((workspace) => {
		const rootStyle = getComputedStyle(document.documentElement);
		const explanation = workspace.querySelector('.decision-workspace-explanation');
		if (!(explanation instanceof HTMLElement)) return null;
		return {
			space3: Number.parseFloat(rootStyle.getPropertyValue('--worn-space-3')),
			explanationPadding: Number.parseFloat(getComputedStyle(explanation).paddingBlockStart),
			workspacePadding: Number.parseFloat(getComputedStyle(workspace).paddingBlockStart),
			contained: workspace.scrollWidth <= workspace.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth
		};
	});
	assert.ok(compactDecisionRhythm, 'Decision workspace exposes the shared compact rhythm.');
	assert.equal(compactDecisionRhythm.explanationPadding, compactDecisionRhythm.space3);
	assert.equal(compactDecisionRhythm.workspacePadding, compactDecisionRhythm.space3);
	assert.equal(compactDecisionRhythm.contained, true);
	await page.setViewportSize({ width: 900, height: 800 });

	await decision.locator('#decision-next-action').selectOption('Focus');
	await decision.getByRole('button', { name: 'Prepare for approval' }).click();
	await page.waitForFunction((key) => {
		const raw = localStorage.getItem(key);
		if (!raw) return false;
		const parsed = JSON.parse(raw);
		const state = parsed.state ?? parsed;
		const draft = state.pendingNextActionDrafts?.find((candidate) => candidate.workId === 'inline-decision');
		return draft?.choice === 'Focus' && draft?.source === 'human' && draft?.evidence?.length === 2;
	}, storageKey);
	await decision.getByText(/Human-prepared · Not saved · Human approval required/u).waitFor({ state: 'visible' });
	assert.match((await decision.locator('[data-decision-draft-evidence]').textContent()) ?? '', /Confirm launch handoff[\s\S]*Workflow: Blocked[\s\S]*Blocker: Waiting on final details/u);
	assert.equal(new URL(page.url()).pathname, '/work', 'Preparing the draft stays on Work.');

	await decision.getByRole('button', { name: 'Approve and save' }).click();
	await page.waitForFunction((key) => {
		const raw = localStorage.getItem(key);
		if (!raw) return false;
		const parsed = JSON.parse(raw);
		const state = parsed.state ?? parsed;
		const pack = state.packs?.find((candidate) => candidate.id === 'inline-decision');
		return pack?.next === 'Focus' && !(state.pendingNextActionDrafts || []).some((draft) => draft.workId === 'inline-decision');
	}, storageKey);
	assert.equal(new URL(page.url()).pathname, '/work', 'Approval completes without navigating away from Work.');
	await decision.locator('[data-decision-outcome]').waitFor({ state: 'visible' });
	assert.match((await decision.locator('[data-decision-outcome]').textContent()) ?? '', /Next action set to "Focus"\.[\s\S]*Approved by you\./u);
	assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-decision-outcome')), true, 'Approval lands focus on the completed inline decision state.');
	const completedWorkspace = await readWorkspace(page);
	assert.deepEqual(
		completedWorkspace.pendingNextActionDrafts || [],
		[],
		'The approved inline draft is consumed atomically.'
	);
	assert.equal(completedWorkspace.filter, 'active', 'Resuming a hidden pending decision never rewrites the saved Work filter.');

	await page.goto(`${origin}/next?pack=inline-decision`, { waitUntil: 'networkidle' });
	await page.locator('[data-next-advanced-options] .worn-collapsible').waitFor({ state: 'visible' });
	const desktopSpacing = await page.evaluate(() => {
		const editor = document.querySelector('.next-action-editor');
		const wrapper = document.querySelector('[data-next-advanced-options]');
		const disclosure = wrapper?.querySelector('.worn-collapsible');
		if (!(editor instanceof HTMLElement) || !(wrapper instanceof HTMLElement) || !(disclosure instanceof HTMLElement)) return null;
		const rootStyle = getComputedStyle(document.documentElement);
		return {
			padding: Number.parseFloat(getComputedStyle(wrapper).paddingBlockStart),
			token: Number.parseFloat(rootStyle.getPropertyValue('--worn-space-4')),
			gap: disclosure.getBoundingClientRect().top - editor.getBoundingClientRect().bottom
		};
	});
	assert.ok(desktopSpacing, 'Next renders the Advanced options spacing boundary.');
	assert.equal(desktopSpacing.padding, desktopSpacing.token);
	assert.equal(desktopSpacing.token, 16);
	assert.ok(desktopSpacing.gap >= desktopSpacing.token - 1, 'Advanced options clears the action buttons by at least its desktop rhythm token.');

	await page.setViewportSize({ width: 390, height: 800 });
	const compactSpacing = await page.evaluate(() => {
		const editor = document.querySelector('.next-action-editor');
		const wrapper = document.querySelector('[data-next-advanced-options]');
		const disclosure = wrapper?.querySelector('.worn-collapsible');
		if (!(editor instanceof HTMLElement) || !(wrapper instanceof HTMLElement) || !(disclosure instanceof HTMLElement)) return null;
		const rootStyle = getComputedStyle(document.documentElement);
		return {
			padding: Number.parseFloat(getComputedStyle(wrapper).paddingBlockStart),
			token: Number.parseFloat(rootStyle.getPropertyValue('--worn-space-3')),
			gap: disclosure.getBoundingClientRect().top - editor.getBoundingClientRect().bottom
		};
	});
	assert.ok(compactSpacing, 'Next keeps the Advanced options spacing boundary on compact screens.');
	assert.equal(compactSpacing.padding, compactSpacing.token);
	assert.equal(compactSpacing.token, 12);
	assert.ok(compactSpacing.gap >= compactSpacing.token - 1, 'Advanced options clears the action buttons by at least its compact rhythm token.');

	console.log(JSON.stringify({
		cards: { grid: 'same-destination suppressed; distinct navigation and mutation retained', card: 'same-destination suppressed; distinct navigation and mutation retained' },
		workViewport: { coldLoad: 'loading without false empty', ordinaryDecision: 'collapsed', firstCardTop: firstWorkTop, energy: 'high via labeled select', dragOwner: 'Move handle' },
		commandPalette: { keyboard: 'combobox active-descendant navigation', disabled: 'skipped', escape: 'trigger focus restored' },
		unifiedDecision: { route: '/work', focus: 'exact pending decision outside unchanged filters', evidence: 'visible', draft: 'prepared', approval: 'saved without navigation' },
		visualRhythm: { desktop: desktopDecisionRhythm, compact: compactDecisionRhythm },
		advancedOptions: { desktop: desktopSpacing, compact: compactSpacing },
		quickAdd: { receipt: 'visible, focused, and durable after reload' },
		terminalNext: { cards: 'static', directRoute: 'editor refused' },
		webMcp: registrationsBeforeQuickAdd.map((tool) => tool.name)
	}));
} finally {
	await browser?.close();
	server.kill();
}
