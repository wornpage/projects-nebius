import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const port = 4177;
const origin = `http://127.0.0.1:${port}`;
const artifactRoot = path.resolve('dist/static-publish');
const nebiusEdition = true;
const legacyCacheName = 'projects-webmcp-v2-atomic-1';
const unrelatedCacheName = 'unrelated-browser-cache';
const staticServerSource = String.raw`
const { readFile } = require('node:fs');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const path = require('node:path');
const root = process.env.ARTIFACT_ROOT;
const port = Number(process.env.PORT);
let workerFixture = null;
process.on('message', (message) => {
  if (message.type !== 'worker-fixture') return;
  workerFixture = message;
  process.send({ id: message.id });
});
const mime = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml']
]);
function publishedPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
  let relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!path.extname(relativePath)) relativePath += '.html';
  const target = path.resolve(root, relativePath);
  const relativeTarget = path.relative(root, target);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) return null;
  return target;
}
createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.end('Method not allowed');
    return;
  }
  let target;
  try { target = publishedPath(request.url || '/'); }
  catch {
    response.statusCode = 400;
    response.end('Bad request');
    return;
  }
  if (!target) {
    response.statusCode = 403;
    response.end('Forbidden');
    return;
  }
  readFile(target, (error, body) => {
    if (error) {
      response.statusCode = error.code === 'ENOENT' ? 404 : 500;
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.statusCode = 200;
    // Only the isolated update cases use this fixture. The preceding offline
    // checks serve the production worker unchanged. Each synthetic revision
    // owns a distinct cache; a delayed skipWaiting exposes premature reloads.
    if (path.basename(target) === 'sw.js' && workerFixture) {
      const fixture = workerFixture;
      let source = body.toString('utf8');
      const generation = createHash('sha256').update(source + ':' + fixture.revision).digest('hex').slice(0, 16);
      source = source.replace(/const CACHE_GENERATION = '[a-f0-9]{16}';/, "const CACHE_GENERATION = '" + generation + "';");
      if (fixture.failInstall) source = source.replace('...BUILD_ASSETS,', "...BUILD_ASSETS,\n '/__offline-smoke-missing-required.js',");
      source += '\nconst smokeRevision = ' + fixture.revision + ';\n' +
        'const smokeSkipWaiting = self.skipWaiting.bind(self);\n' +
        'self.skipWaiting = async () => { await new Promise(resolve => setTimeout(resolve, ' + fixture.delayMs + ')); return smokeSkipWaiting(); };\n' +
        'self.addEventListener("message", event => { if (event.data?.type === "SMOKE_REVISION") event.ports[0].postMessage(smokeRevision); });\n';
      body = Buffer.from(source);
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', mime.get(path.extname(target).toLowerCase()) || 'application/octet-stream');
    response.end(request.method === 'HEAD' ? undefined : body);
  });
}).listen(port, '127.0.0.1');
`;
const server = spawn(process.execPath, ['-e', staticServerSource], {
	env: { ...process.env, ARTIFACT_ROOT: artifactRoot, PORT: String(port) },
	stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
	windowsHide: true
});

let browser;
let context;
let lastStage = 'starting production artifact server';
let fixtureId = 0;
function setWorkerFixture(revision, { delayMs = 0, failInstall = false } = {}) {
	return new Promise((resolve, reject) => {
		const id = ++fixtureId;
		const timer = setTimeout(() => { server.off('message', receive); reject(new Error('Worker fixture did not acknowledge its revision.')); }, 5000);
		const receive = (message) => {
			if (message.id !== id) return;
			clearTimeout(timer);
			server.off('message', receive);
			resolve();
		};
		server.on('message', receive);
		server.send({ type: 'worker-fixture', id, revision, delayMs, failInstall });
	});
}
const watchdog = setTimeout(() => {
	process.stderr.write(`Offline browser smoke exceeded 90 seconds during: ${lastStage}\n`);
	process.exitCode = 1;
	void context?.close().catch(() => {});
	void browser?.close().catch(() => {});
	server.kill('SIGKILL');
}, 90000);

try {
	assert.equal(existsSync(path.join(artifactRoot, 'sw.js')), true, 'run the production build before the offline browser smoke');
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try { if ((await fetch(`${origin}/sw.js`)).ok) break; } catch {}
		await new Promise((resolve) => setTimeout(resolve, 250));
		if (attempt === 59) throw new Error('Production artifact server did not become ready.');
	}

	lastStage = 'validating the generated service worker';
	const serviceWorkerResponse = await fetch(`${origin}/sw.js`);
	assert.equal(serviceWorkerResponse.status, 200, 'built service worker script is served');
	const serviceWorkerSource = await serviceWorkerResponse.text();
	assert.doesNotMatch(serviceWorkerSource, /__PROJECTS_SW_|CACHE_GENERATION = 'source-dev'/u, 'the production worker contains no source-only build marker');
	const generation = serviceWorkerSource.match(/const CACHE_GENERATION = '([a-f0-9]{16})'; \/\/ generated by build-svelte-frontend\.mjs/u)?.[1];
	assert.ok(generation, 'the production worker has a content-derived cache generation');
	const activeCacheName = `projects-webmcp-v2-${generation}`;
	const buildAssetsJson = serviceWorkerSource.match(/const BUILD_ASSETS = Object\.freeze\((\[[^\n]*\])\); \/\/ generated by build-svelte-frontend\.mjs/u)?.[1];
	assert.ok(buildAssetsJson, 'the production worker contains the generated client-asset manifest');
	const buildAssets = JSON.parse(buildAssetsJson);
	assert.ok(buildAssets.length > 0, 'the generated client-asset manifest is nonempty');
	assert.equal(buildAssets.every((asset) => asset.startsWith('/_app-r191/')), true, 'only built Svelte client assets enter the generated manifest');
	for (const assetPath of ['/landing.html', '/assets/landing.css', '/assets/theme.js']) {
		assert.match(serviceWorkerSource, new RegExp(`['\"]${assetPath.replaceAll('/', '\\/')}['\"]`, 'u'), `${assetPath} is explicitly precached`);
	}
	const precacheSource = serviceWorkerSource.match(/const PRECACHE = Object\.freeze\(\[([\s\S]*?)\]\);/u)?.[1] ?? '';
	assert.doesNotMatch(precacheSource, /['"]\/sw\.js['"]/u, 'the browser-managed worker script is not stored in Cache Storage');
	assert.match(serviceWorkerSource, /async function precacheRequiredAssets\(\)[\s\S]*?await caches\.delete\(ACTIVE_CACHE_NAME\)[\s\S]*?cache\.addAll\(PRECACHE\.map[\s\S]*?catch \(error\)[\s\S]*?await caches\.delete\(ACTIVE_CACHE_NAME\)[\s\S]*?throw error/u, 'required batch precache failure removes the incomplete generation and rejects installation');
	assert.match(serviceWorkerSource, /isOwnedCache\(key\) && key !== ACTIVE_CACHE_NAME/u, 'activation removes only obsolete app-owned caches');
	assert.match(serviceWorkerSource, /NETWORK_FIRST_PATHS[\s\S]*?'\/data\/demo-packs\.json'[\s\S]*?'\/assets\/theme\.js'[\s\S]*?'\/assets\/landing\.css'/u, 'unversioned landing and seed assets prefer the network');
	assert.doesNotMatch(serviceWorkerSource, /['"]\/assets\/landing\.js['"]/u, 'the retired WebMCP replay is not precached');

	lastStage = 'launching Chrome';
	browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
	context = await browser.newContext({ serviceWorkers: 'allow' });
	const page = await context.newPage();
	page.setDefaultTimeout(10000);
	page.setDefaultNavigationTimeout(15000);

	lastStage = 'seeding cache ownership fixtures';
	await page.goto(`${origin}/data/demo-packs.json`, { waitUntil: 'domcontentloaded' });
	await page.evaluate(async ({ legacyCacheName, unrelatedCacheName }) => {
		const legacy = await caches.open(legacyCacheName);
		await legacy.put('/legacy-cache-marker', new Response('legacy'));
		const unrelated = await caches.open(unrelatedCacheName);
		await unrelated.put('/unrelated-cache-marker', new Response('preserve me'));
	}, { legacyCacheName, unrelatedCacheName });

	lastStage = 'loading Work before service-worker registration';
	await page.goto(`${origin}/work`, { waitUntil: 'domcontentloaded' });
	lastStage = 'waiting for generated service-worker activation';
	await page.evaluate(() => navigator.serviceWorker.register('/sw.js'));
	await Promise.race([
		page.evaluate(() => navigator.serviceWorker.ready.then(() => true)),
		new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not become ready.')), 15000))
	]);
	lastStage = 'reloading Work under the active service worker';
	await page.reload({ waitUntil: 'domcontentloaded' });
	await page.getByRole('heading', { level: 1, name: 'Work', exact: true }).waitFor();
	if (nebiusEdition) {
		const header = page.locator('.challenge-shell-nav');
		assert.match(await header.innerText(), /Nebius edition/u);
		assert.doesNotMatch(await header.innerText(), /UI lab|WebMCP/u, 'release branding does not expose retired or laboratory labels');
		assert.equal(await header.locator('a[href="/webmcp-challenge"]').count(), 0, 'legacy saved links are not active navigation');
	}

	lastStage = 'verifying the complete active cache';
	const installedCaches = await page.evaluate(async ({ activeCacheName, buildAssets, legacyCacheName, unrelatedCacheName }) => {
		const keys = await caches.keys();
		const active = await caches.open(activeCacheName);
		const unrelated = await caches.open(unrelatedCacheName);
		const missingBuildAssets = [];
		for (const asset of buildAssets) {
			if (!(await active.match(asset))) missingBuildAssets.push(asset);
		}
		return {
			activeInstalled: keys.includes(activeCacheName),
			legacyRemoved: !keys.includes(legacyCacheName),
			unrelatedPreserved: keys.includes(unrelatedCacheName) && Boolean(await unrelated.match('/unrelated-cache-marker')),
			workerScriptCached: Boolean(await active.match('/sw.js')),
			missingBuildAssets
		};
	}, { activeCacheName, buildAssets, legacyCacheName, unrelatedCacheName });
	assert.equal(installedCaches.activeInstalled, true, 'the complete generated cache is installed');
	assert.equal(installedCaches.legacyRemoved, true, 'the obsolete app cache is removed after successful activation');
	assert.equal(installedCaches.unrelatedPreserved, true, 'activation preserves caches owned by other same-origin features');
	assert.equal(installedCaches.workerScriptCached, false, 'the active cache does not duplicate the browser-managed service worker script');
	assert.deepEqual(installedCaches.missingBuildAssets, [], 'every generated Svelte client asset is installed before activation');

	lastStage = 'refreshing a poisoned Work navigation';
	await page.evaluate(async ({ activeCacheName }) => {
		const cache = await caches.open(activeCacheName);
		await cache.put('/work', new Response(
			'<!doctype html><html><body><main id="stale-work-cache">stale work cache</main></body></html>',
			{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
		));
	}, { activeCacheName });
	await page.goto(`${origin}/work`, { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('main.challenge-route');
	assert.equal(await page.locator('#stale-work-cache').count(), 0, 'online navigation does not serve a poisoned cached page');
	const refreshedWorkCache = await page.evaluate(async ({ activeCacheName }) => {
		const cache = await caches.open(activeCacheName);
		const response = await cache.match('/work');
		return response ? (await response.text()).includes('challenge-route') : false;
	}, { activeCacheName });
	assert.equal(refreshedWorkCache, true, 'the live Work response replaces the poisoned cache entry');

	lastStage = 'hydrating an unvisited Next route offline';
	await context.setOffline(true);
	await page.goto(`${origin}/landing.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });
	assert.equal(await page.locator(nebiusEdition ? '#nebius-title' : '#replay-demo').count(), 1, 'the correct edition landing loads offline');
	await page.goto(`${origin}/next${nebiusEdition ? '?pack=nebius-keyboard-review' : ''}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
	assert.equal(await page.locator('main.challenge-route').count(), 1, 'an unvisited Next route hydrates offline after a clean install');
	if (nebiusEdition) {
		lastStage = 'checking Nebius query selection and local save offline';
		const expectedTask = JSON.parse(readFileSync(path.join(artifactRoot, 'data/demo-packs.json'), 'utf8')).find(pack => pack.id === 'nebius-keyboard-review');
		assert.ok(expectedTask, 'the bundled Nebius fixture contains the requested offline task');
		await page.getByRole('heading', { level: 1, name: expectedTask.title, exact: true }).waitFor();
		assert.equal(await page.getByLabel('Switch task', { exact: true }).inputValue(), 'nebius-keyboard-review', 'offline task URL uses the Next shell and preserves task identity');
		await page.locator('[data-nebius-task-editor] > summary').click();
		await page.locator('#nebius-written-step').fill('Record the keyboard route while disconnected.');
		await page.getByRole('button', { name: 'Review changes', exact: true }).click();
		await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
		await page.getByText('Changes applied.', { exact: true }).waitFor();
		await page.reload({ waitUntil: 'domcontentloaded' });
		await page.locator('[data-nebius-task-editor] > summary').click();
		assert.equal(await page.locator('#nebius-written-step').inputValue(), 'Record the keyboard route while disconnected.', 'offline reload retains approved local text');
		const inferenceCacheBypassed = await page.evaluate(async ({ activeCacheName }) => {
			const cache = await caches.open(activeCacheName);
			await cache.put('/api/nebius/config?operation=suggest-next-step', new Response(JSON.stringify({ available: true, requestedModel: 'nvidia/stale-cache' }), { headers: { 'content-type': 'application/json' } }));
			try { await fetch('/api/nebius/config?operation=suggest-next-step'); return false; }
			catch { return true; }
			finally { await cache.delete('/api/nebius/config?operation=suggest-next-step'); }
		}, { activeCacheName });
		assert.equal(inferenceCacheBypassed, true, 'model configuration bypasses the service worker even if a stale cache entry exists');
	}
	await page.goto(`${origin}/webmcp-challenge`, { waitUntil: 'domcontentloaded', timeout: 10000 });
	await page.waitForURL(url => url.pathname === '/landing.html' && url.hash === '#help');
	assert.equal(await page.locator('#help').count(), 1, 'Saved Guide link resolves to Help offline');
	await page.goto(`${origin}/work`, { waitUntil: 'domcontentloaded', timeout: 10000 });
	assert.equal(await page.locator('main.challenge-route').count(), 1, 'Work loads offline from the refreshed cache');
	assert.equal(await page.locator('#stale-work-cache').count(), 0, 'offline Work uses the refreshed response, not the poisoned one');
	const cachedSeed = await page.evaluate(async () => (await (await fetch('/data/demo-packs.json')).json()).length);
	assert.ok(cachedSeed > 0, 'bundled seed data is available offline');
	await context.close();

	lastStage = 'installing an isolated update-lifecycle fixture';
	await setWorkerFixture(0);
	context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 425, height: 900 } });
	const updateRequests = [];
	context.on('request', (request) => updateRequests.push({ method: request.method(), url: request.url(), worker: Boolean(request.serviceWorker()) }));
	await context.addInitScript(() => {
		// Capture the controller at document creation, before hydration or a later
		// claim can disguise which worker served a prematurely reloaded document.
		const controller = navigator.serviceWorker.controller;
		window.smokeInitialController = new Promise((resolve) => {
			if (!controller) { resolve(null); return; }
			const channel = new MessageChannel();
			channel.port1.onmessage = (event) => { channel.port1.close(); resolve(event.data); };
			controller.postMessage({ type: 'SMOKE_REVISION' }, [channel.port2]);
		});
		window.smokeDocumentId = crypto.randomUUID();
	});
	const primary = await context.newPage();
	primary.setDefaultTimeout(10000);
	await primary.goto(`${origin}/next${nebiusEdition ? '?pack=nebius-keyboard-review' : ''}`, { waitUntil: 'domcontentloaded' });
	await primary.evaluate(() => navigator.serviceWorker.ready);
	await primary.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
	await primary.reload({ waitUntil: 'domcontentloaded' });
	await primary.waitForSelector('main.challenge-route');
	assert.equal(await primary.evaluate(() => window.smokeInitialController), 0, 'the initial document uses fixture revision zero');

	const observations = [];
	const observe = (name, passed, details = undefined) => observations.push({ name, passed, details });
	const updateButton = (target) => target.getByRole('button', { name: 'Reload to update', exact: true });
	const waitForControllerRevision = (target, expected) => target.waitForFunction(async (revision) => {
		const worker = navigator.serviceWorker.controller;
		if (!worker) return false;
		const channel = new MessageChannel();
		const response = new Promise((resolve) => { channel.port1.onmessage = (event) => { channel.port1.close(); resolve(event.data); }; });
		worker.postMessage({ type: 'SMOKE_REVISION' }, [channel.port2]);
		return (await response) === revision;
	}, expected);
	const tabToUpdate = async (target) => {
		await target.keyboard.press('Control+Home');
		for (let index = 0; index < 30; index += 1) {
			await target.keyboard.press('Tab');
			if (await updateButton(target).evaluate((button) => button === document.activeElement)) return index + 1;
		}
		throw new Error('The update control was not reachable with native Tab.');
	};
	const storageSnapshot = (target) => target.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])));
	await primary.evaluate(async ({ unrelatedCacheName }) => {
		const unrelated = await caches.open(unrelatedCacheName);
		await unrelated.put('/unrelated-cache-marker', new Response('preserve me'));
	}, { unrelatedCacheName });
	const storageBefore = await storageSnapshot(primary);

	lastStage = 'checking that native update waits for control before reload';
	await setWorkerFixture(1, { delayMs: 700 });
	await primary.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
	await updateButton(primary).waitFor();
	const updateTabs = await tabToUpdate(primary);
	observe('waiting update is reachable with native Tab', updateTabs > 0, { updateTabs });
	const reload = primary.waitForEvent('domcontentloaded');
	await primary.keyboard.press('Enter');
	await reload;
	await primary.waitForSelector('main.challenge-route');
	const reloadedController = await primary.evaluate(() => window.smokeInitialController);
	observe('reload starts under the requested new controller', reloadedController === 1, { expected: 1, actual: reloadedController, activationDelayMs: 700 });
	await waitForControllerRevision(primary, 1);
	observe('completed update clears its notice', await updateButton(primary).count() === 0);
	observe('approved local workspace survives update reload', JSON.stringify(await storageSnapshot(primary)) === JSON.stringify(storageBefore));
	// Allow the old implementation to reach the next independent case even if
	// its stale notice failed above; a manual reload starts a clean document.
	await primary.reload({ waitUntil: 'domcontentloaded' });
	await primary.waitForSelector('main.challenge-route');
	if (nebiusEdition) {
		await primary.locator('[data-nebius-task-editor] > summary').press('Enter');
		await primary.locator('#nebius-written-step').fill('An unsaved edit must survive another tab updating.');
	}
	const secondary = await context.newPage();
	await secondary.goto(`${origin}/work`, { waitUntil: 'domcontentloaded' });
	await secondary.waitForSelector('main.challenge-route');

	lastStage = 'checking a passive tab when another tab activates an update';
	await setWorkerFixture(2);
	await secondary.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
	await Promise.all([updateButton(primary).waitFor(), updateButton(secondary).waitFor()]);
	observe('both open tabs notice the waiting update', true);
	const passiveDocument = await primary.evaluate(() => window.smokeDocumentId);
	const secondReload = secondary.waitForEvent('domcontentloaded');
	await tabToUpdate(secondary);
	await secondary.keyboard.press('Enter');
	await secondReload;
	await secondary.waitForSelector('main.challenge-route');
	const secondController = await secondary.evaluate(() => window.smokeInitialController);
	observe('second tab reload also uses its requested controller', secondController === 2, { expected: 2, actual: secondController });
	await waitForControllerRevision(primary, 2);
	// The secondary's navigation follows clients.claim. Allow Svelte's queued
	// render to settle before observing the passive tab's notice.
	await primary.waitForTimeout(100);
	observe('passive tab clears the update notice', await updateButton(primary).count() === 0);
	observe('passive tab does not reload', await primary.evaluate(() => window.smokeDocumentId) === passiveDocument);
	observe('another tab activation preserves local workspace', JSON.stringify(await storageSnapshot(primary)) === JSON.stringify(storageBefore));
	if (nebiusEdition) observe('another tab activation preserves the unsaved editor', await primary.locator('#nebius-written-step').inputValue() === 'An unsaved edit must survive another tab updating.');
	await secondary.close();
	await primary.reload({ waitUntil: 'domcontentloaded' });
	await primary.waitForSelector('main.challenge-route');

	lastStage = 'checking a failed required-asset installation';
	const cachesBeforeFailure = await primary.evaluate(() => caches.keys());
	await setWorkerFixture(3, { failInstall: true });
	await primary.evaluate(async () => {
		const registration = await navigator.serviceWorker.getRegistration();
		await new Promise((resolve, reject) => {
			registration.addEventListener('updatefound', () => {
				const worker = registration.installing;
				worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(); });
			}, { once: true });
			registration.update().catch(reject);
		});
	});
	observe('failed installation leaves no update notice', await updateButton(primary).count() === 0);
	observe('failed installation preserves the active and unrelated caches', JSON.stringify((await primary.evaluate(() => caches.keys())).sort()) === JSON.stringify(cachesBeforeFailure.sort()));
	observe('lifecycle checks make only same-origin GET requests', updateRequests.every((request) => request.method === 'GET' && new URL(request.url).origin === origin && !new URL(request.url).pathname.includes('/runs/start')), { requests: updateRequests.length });
	const report = { edition: nebiusEdition ? 'nebius' : 'webmcp', cache: activeCacheName, generation: 'build-derived', buildAssets: buildAssets.length, unvisitedOfflineRoute: nebiusEdition ? 'next?pack=nebius-keyboard-review' : 'next', offlineLocalReload: nebiusEdition, inferenceCacheBypassed: nebiusEdition, unrelatedCachePreserved: true, freshness: 'network-first', cachedSeed, updateFixture: 'production worker with separate synthetic cache generations, revision probe and 700ms activation delay', observations, passed: observations.filter((item) => item.passed).length, failed: observations.filter((item) => !item.passed).length };
	if (process.env.OFFLINE_SMOKE_EVIDENCE_DIRECTORY) {
		mkdirSync(process.env.OFFLINE_SMOKE_EVIDENCE_DIRECTORY, { recursive: true });
		writeFileSync(path.join(process.env.OFFLINE_SMOKE_EVIDENCE_DIRECTORY, `${report.edition}-offline-update.json`), JSON.stringify(report, null, 2) + '\n');
	}
	console.log(JSON.stringify(report));
	assert.equal(report.failed, 0, 'all update lifecycle observations pass');
} finally {
	clearTimeout(watchdog);
	await context?.close().catch(() => {});
	await browser?.close().catch(() => {});
	server.kill();
}
