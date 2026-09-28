import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright-core';

const port = 4173;
const landingPort = 4174;
const origin = `http://127.0.0.1:${port}`;
const landingOrigin = `http://127.0.0.1:${landingPort}`;
const viteCli = path.resolve('svelte-frontend/node_modules/vite/bin/vite.js');
const server = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(port)], { cwd: 'svelte-frontend', stdio: 'ignore', windowsHide: true });
const landingServer = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(landingPort), '--strictPort'], { cwd: '.', stdio: 'ignore', windowsHide: true });
let browser;

async function waitForServer(url) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try { if ((await fetch(url)).ok) return; } catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Browser smoke server did not become ready: ${url}`);
}

const HERO_PROOF_PATTERN = /Verified action trail[\s\S]*?One accountable handoff[\s\S]*?3 verified · 1 pending[\s\S]*?Work 4 of 8 · Review 2 facts[\s\S]*?Agent stopped before Save[\s\S]*?Not saved[\s\S]*?Workflow[\s\S]*?Blocked[\s\S]*?Blocker[\s\S]*?Waiting on final details[\s\S]*?Proposed next action[\s\S]*?Confirm handoff details[\s\S]*?Human approval required/u;

try {
	await Promise.all([
		waitForServer(`${origin}/next`),
		waitForServer(`${landingOrigin}/landing.html`)
	]);
	browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });

	const noScriptPage = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1100, height: 900 } });
	await noScriptPage.goto(`${landingOrigin}/landing.html`, { waitUntil: 'domcontentloaded' });
	const noScriptProof = await noScriptPage.locator('.lp-preview .lp-panel[data-hero-product-proof]').evaluate((panel) => ({
		text: panel.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
		actions: [...panel.querySelectorAll('.lp-proof-action')].map((action) => action.textContent?.trim()),
		runtimeMarker: document.documentElement.getAttribute('data-hero-product-proof')
	}));
	assert.match(noScriptProof.text, HERO_PROOF_PATTERN, 'the signature product proof is present in the initial HTML');
	assert.deepEqual(noScriptProof.actions, ['Discard draft', 'Approve and save']);
	assert.equal(noScriptProof.runtimeMarker, null, 'the no-script proof does not depend on the runtime-ready marker');
	await noScriptPage.close();

	const landingPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
	await landingPage.goto(`${landingOrigin}/landing.html`, { waitUntil: 'networkidle' });
	await landingPage.waitForFunction(() => document.documentElement.getAttribute('data-hero-product-proof') === 'ready');
	const heroProof = await landingPage.locator('.lp-preview .lp-panel').evaluate((panel) => ({
		marker: panel.hasAttribute('data-hero-product-proof'),
		text: panel.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
		actions: [...panel.querySelectorAll('.lp-proof-action')].map((action) => action.textContent?.trim())
	}));
	assert.equal(heroProof.marker, true, 'the first fold exposes the signature product proof marker');
	assert.match(heroProof.text, HERO_PROOF_PATTERN);
	assert.deepEqual(heroProof.actions, ['Discard draft', 'Approve and save']);

	await landingPage.locator('#replay').scrollIntoViewIfNeeded();
	const replayStates = ['observe', 'narrow', 'prepare', 'decide'];
	for (let index = 0; index < replayStates.length; index += 1) {
		const state = replayStates[index];
		await landingPage.locator(`[data-replay="${index + 1}"]`).click();
		await landingPage.waitForFunction((expected) => document.querySelector('#replay-demo')?.getAttribute('data-replay-state') === expected, state);
		const replay = await landingPage.locator('#replay-demo').evaluate((demo) => ({
			state: demo.getAttribute('data-replay-state'),
			label: demo.getAttribute('aria-label'),
			stage: demo.querySelector('#replay-stage-label')?.textContent?.trim(),
			activeViews: [...demo.querySelectorAll('[data-replay-view].is-active')].map((view) => view.getAttribute('data-replay-view')),
			currentProgress: [...demo.querySelectorAll('[data-replay-progress].is-current')].length,
			pressedSteps: [...document.querySelectorAll('.lp-replay-step[aria-pressed="true"]')].map((step) => step.getAttribute('data-replay')),
			text: demo.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
		}));
		assert.equal(replay.state, state);
		assert.match(replay.label ?? '', new RegExp(`^${state[0].toUpperCase()}${state.slice(1)}:`, 'u'));
		assert.equal(replay.stage, `${state[0].toUpperCase()}${state.slice(1)} · ${index + 1} of 4`);
		assert.deepEqual(replay.activeViews, [state]);
		assert.equal(replay.currentProgress, 1);
		assert.deepEqual(replay.pressedSteps, [String(index + 1)]);
		if (state === 'decide') {
			assert.match(replay.text, /Agent stopped here[\s\S]*?Your decision[\s\S]*?Discard draft[\s\S]*?Approve and save[\s\S]*?No workspace change until you choose\./u);
		}
	}
	const playButton = landingPage.locator('#replay-play');
	await playButton.click();
	assert.equal(await playButton.getAttribute('aria-pressed'), 'true');
	assert.match((await playButton.textContent()) ?? '', /Stop the handoff/u);
	assert.equal(await landingPage.locator('#replay-demo').getAttribute('data-replay-state'), 'observe');
	await playButton.click();
	assert.equal(await playButton.getAttribute('aria-pressed'), 'false');
	assert.match((await playButton.textContent()) ?? '', /Watch the handoff/u);
	assert.equal(await landingPage.locator('#replay-demo').getAttribute('data-replay-state'), 'observe');
	assert.equal((await landingPage.locator('#replay-note').textContent())?.trim(), 'Press play — four steps, about ten seconds. No account, no setup.');
	await landingPage.setViewportSize({ width: 390, height: 900 });
	await landingPage.locator('#replay').scrollIntoViewIfNeeded();
	const landingMetrics = await landingPage.evaluate(() => ({
		documentWidth: document.documentElement.scrollWidth,
		viewportWidth: document.documentElement.clientWidth,
		demoWidth: document.querySelector('#replay-demo')?.getBoundingClientRect().width ?? 0,
		heroWidth: document.querySelector('.lp-preview')?.getBoundingClientRect().width ?? 0,
		replayDecisionActions: document.querySelectorAll('#replay-demo .lp-proof-action').length,
		heroDecisionActions: document.querySelectorAll('.lp-preview .lp-proof-action').length
	}));
	assert.ok(landingMetrics.documentWidth <= landingMetrics.viewportWidth, `landing proof should not overflow: ${landingMetrics.documentWidth}px > ${landingMetrics.viewportWidth}px`);
	assert.ok(landingMetrics.demoWidth > 0 && landingMetrics.demoWidth <= landingMetrics.viewportWidth);
	assert.ok(landingMetrics.heroWidth > 0 && landingMetrics.heroWidth <= landingMetrics.viewportWidth);
	assert.equal(landingMetrics.replayDecisionActions, 2);
	assert.equal(landingMetrics.heroDecisionActions, 2);
	console.log(JSON.stringify({ noScriptHeroProof: true, heroProof: true, landingReplay: replayStates, humanBoundary: true, mobileOverflow: false }));
	await landingPage.close();

	const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
	await page.goto(`${origin}/next`, { waitUntil: 'domcontentloaded' });
	await page.evaluate(async () => {
		const seed = await (await fetch('/data/demo-packs.json')).json();
		localStorage.setItem('projects-webmcp-challenge-state-v1', JSON.stringify({ packs: seed, pendingNextActionDrafts: [{ workId: seed[0].id, choice: 'Clear the garage floor', mode: 'preset', evidenceNote: 'Smoke test', evidence: [{ workId: seed[0].id, field: 'workflow', expectedValue: 'Blocked' }], originFingerprint: 'smoke', source: 'webmcp' }] }));
	});
	async function checkViewport(width) {
		await page.setViewportSize({ width, height: 900 });
		await page.reload({ waitUntil: 'networkidle' });
		await page.waitForSelector('.pending-approval-link', { state: 'visible' });
		const result = await page.locator('.challenge-shell-nav').evaluate((header) => {
			const nav = header.querySelector(':scope > nav');
			const controls = [...nav.querySelectorAll(':scope > .challenge-nav-control')];
			const navRect = nav.getBoundingClientRect();
			const headerRect = header.getBoundingClientRect();
			const brandRect = header.querySelector('.challenge-brand').getBoundingClientRect();
			const pending = header.querySelector('.pending-approval-link');
			const work = header.querySelector('.challenge-work-link');
			const tools = header.querySelector('[data-tools-trigger]');
			return {
				controlCount: controls.length,
				labels: controls.map((control) => control.dataset.navLabel),
				controlTops: controls.map((control) => Math.round(control.getBoundingClientRect().top)),
				controlHeights: controls.map((control) => Math.round(control.getBoundingClientRect().height)),
				navTop: Math.round(navRect.top),
				navWidth: navRect.width,
				pendingTop: Math.round(pending.getBoundingClientRect().top),
				pendingWidth: pending.getBoundingClientRect().width,
				workTop: Math.round(work.getBoundingClientRect().top),
				toolsTop: Math.round(tools.getBoundingClientRect().top),
				brandWidth: brandRect.width,
				headerHeight: headerRect.height,
				statusTop: Math.round(header.querySelector('.webmcp-status-pill').getBoundingClientRect().top),
				statusHeight: Math.round(header.querySelector('.webmcp-status-pill').getBoundingClientRect().height),
				statusWord: header.querySelector('.webmcp-status-word')?.textContent?.trim(),
				statusToolCount: header.querySelector('.webmcp-tool-count')?.textContent?.trim(),
				statusToolCountVisible: header.querySelector('.webmcp-tool-count')?.getClientRects().length === 1,
				documentWidth: document.documentElement.scrollWidth,
				viewportWidth: document.documentElement.clientWidth,
				toolsActive: tools.dataset.routeActive === 'true',
				toolsLabel: tools.getAttribute('aria-label'),
				toolsText: tools.textContent?.replace(/\s+/gu, ' ').trim(),
				toolsCurrentFits: tools.querySelector('small')?.scrollWidth <= tools.querySelector('small')?.clientWidth + 1,
				workDefault: work.classList.contains('challenge-work-link'),
				workCurrent: work.getAttribute('aria-current'),
				saveBoundary: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Approve and save')
			};
		});
		assert.equal(result.controlCount, 4);
		assert.deepEqual(result.labels, ['Work', 'Pending 1', 'Guide', 'Tools']);
		assert.ok(result.headerHeight < 180, `header should remain compact, got ${result.headerHeight}px`);
		assert.ok(result.statusTop < result.navTop, 'WebMCP status should remain grouped above the application row');
		assert.ok(result.statusHeight >= 44, `WebMCP status should keep the shared target minimum, got ${result.statusHeight}px`);
		assert.equal(result.statusWord, 'unavailable', 'WebMCP status must remain visible as text');
		assert.equal(result.statusToolCount, '2 tools', 'WebMCP status must show the exact current-page tool count');
		assert.equal(result.statusToolCountVisible, true, 'WebMCP tool count must remain visible');
		assert.ok(result.navWidth > 0, 'application navigation should use the available row');
		assert.ok(result.documentWidth <= result.viewportWidth, `header should not overflow horizontally: ${result.documentWidth}px > ${result.viewportWidth}px`);
		assert.ok(result.brandWidth > (width <= 360 ? 130 : 180), 'Wornpage Projects brand should retain readable width');
		assert.ok(result.controlTops.every((top) => Math.abs(top - result.controlTops[0]) <= 1), 'all primary navigation controls should share one row');
		assert.ok(result.controlHeights.every((height) => height >= 44), `navigation controls should keep the shared target minimum: ${result.controlHeights.join(', ')}`);
		assert.ok(Math.abs(result.pendingTop - result.workTop) <= 1, 'Pending stays on the Work row');
		assert.ok(Math.abs(result.toolsTop - result.workTop) <= 1, 'Tools stays on the Work row');
		assert.ok(result.pendingWidth > 0);
		assert.equal(result.toolsActive, true, 'Tools should visibly own the current Next route');
		assert.match(result.toolsLabel ?? '', /Tools, Next is the current view/u);
		assert.match(result.toolsText ?? '', /Tools Next/u);
		assert.equal(result.toolsCurrentFits, true, 'current view wording should remain fully visible');
		assert.equal(result.workDefault, true);
		assert.equal(result.workCurrent, null, 'Work keeps default prominence without falsely claiming the current Next route');
		assert.equal(result.saveBoundary, true, 'human-only Approve and save boundary remains visible');
		console.log(JSON.stringify({ viewport: `${width}x900`, ...result }));
	}
	await checkViewport(320);
	await checkViewport(390);
	await checkViewport(700);
	await checkViewport(768);

	await page.setViewportSize({ width: 320, height: 900 });
	await page.reload({ waitUntil: 'networkidle' });
	const handoffRail = page.locator('[data-webmcp-handoff-session]');
	const collapsedRailHeight = await handoffRail.evaluate((rail) => rail.getBoundingClientRect().height);
	assert.ok(collapsedRailHeight < 180, `idle action trail should stay compact, got ${collapsedRailHeight}px`);
	assert.equal(await handoffRail.locator('button, a, input, select, textarea').count(), 0, 'idle action trail adds no focus stop');
	assert.match(await handoffRail.innerText(), /Observe[\s\S]*Narrow[\s\S]*Prepare[\s\S]*Decide[\s\S]*human-owned/iu);
	await page.evaluate(async () => {
		const { recordWebMcpHandoffStep } = await import('/src/lib/webmcp-handoff-store.ts');
		recordWebMcpHandoffStep({
			id: 'work-scope',
			title: 'Work narrowed',
			summary: '4 matching of 8',
			status: 'complete',
			outcome: 'scope-verified'
		});
	});
	await handoffRail.locator('[data-webmcp-handoff-step="work-scope"]').waitFor({ state: 'visible' });
	const activeRailHeight = await handoffRail.evaluate((rail) => rail.getBoundingClientRect().height);
	assert.ok(activeRailHeight > collapsedRailHeight, 'recorded evidence should appear automatically');
	await page.setViewportSize({ width: 768, height: 900 });
	assert.equal(await handoffRail.locator('[data-webmcp-handoff-step="work-scope"]').isVisible(), true, 'wide screens show recorded evidence by default');
	console.log(JSON.stringify({ actionTrail: { viewport: '320x900', collapsedRailHeight, activeRailHeight, emptyFocusStops: 0, activeNarrowEvidenceVisible: true, activeWideEvidenceVisible: true } }));

	const toolsTrigger = page.locator('[data-tools-trigger]');
	await toolsTrigger.focus();
	await page.keyboard.press('Enter');
	const toolsDialog = page.getByRole('dialog', { name: 'Tools' });
	await toolsDialog.waitFor({ state: 'visible' });
	const toolsState = await toolsDialog.locator('[data-workflow-tool-link]').evaluateAll((links) =>
		links.map((link) => ({
			label: link.dataset.toolLabel,
			current: link.getAttribute('aria-current'),
			description: link.querySelector('span')?.textContent?.trim()
		}))
	);
	assert.deepEqual(toolsState, [
		{ label: 'Priority', current: null, description: 'Standalone recommendation view' },
		{ label: 'Review', current: null, description: 'Full evidence queue' },
		{ label: 'Next', current: 'page', description: 'Full next-action editor' }
	]);
	await page.keyboard.press('Escape');
	await toolsDialog.waitFor({ state: 'hidden' });
	await page.waitForFunction(() => document.activeElement?.hasAttribute('data-tools-trigger'));
	assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-tools-trigger')), true, 'Tools dismissal restores trigger focus');
} finally {
	await browser?.close();
	server.kill();
	landingServer.kill();
}
