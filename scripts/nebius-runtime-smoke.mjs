import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { RECORDED_EXAMPLE_PATH, RECORDED_EXAMPLE_DIGEST } from '../worker/nebius-recorded-example.mjs';
import { resolveSocialImageUrl, SOCIAL_IMAGE_PATH } from './social-image-metadata.mjs';

const EXPECTED_RENDERED_EXAMPLE_DIGEST = '62a3af930809f5589924980ea07adfcaf5d0b461b0d033be7b790af79e49eb03';
const recordedViewports = [{ width: 375, height: 900 }, { width: 384, height: 468 }, { width: 1280, height: 900 }];

const arguments_ = process.argv.slice(2);
assert(arguments_.length === 0 || (arguments_.length === 1 && arguments_[0] === '--landing-browser'), 'Use no arguments or --landing-browser.');
const landingBrowser = arguments_[0] === '--landing-browser';
if (landingBrowser) assert(process.env.CHROME_EXECUTABLE_PATH, 'Set CHROME_EXECUTABLE_PATH; this check never installs a browser.');

async function inspectLanding(origin) {
  const { chromium } = await import('playwright-core');
  const { PACKET_CASES, THREE_GAPS, READY, assertPacketResult } = await import('../tests/fixtures/nebius-release-packet-cases.mjs');
  const output = path.resolve(process.env.NEBIUS_LANDING_EVIDENCE_DIR || `dist/nebius-landing-${Date.now()}`);
  await mkdir(output, { recursive: true });
  const report = { scope: 'Recorded model source through the actual credential-free local Worker and landing iframe; not a fresh generation.', sourceDigest: RECORDED_EXAMPLE_DIGEST,
    modelCalls: 0, sandboxRuns: 0, expectedPacketObservations: PACKET_CASES.length * recordedViewports.length, viewports: recordedViewports, widths: [], cases: [], forbiddenRequests: [], errors: [], passed: false };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH });
  const reach = async (page, target, reverse = false) => {
    for (let count = 0; count < 60; count++) {
      if (await target.evaluate(element => element === document.activeElement)) return;
      await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    }
    throw new Error('The recorded-example control was not keyboard reachable.');
  };
  try {
    for (const { width, height } of recordedViewports) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.protocol === 'blob:' || url.protocol === 'data:') return route.continue();
        if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()) || (url.pathname.startsWith('/api/') && url.pathname !== RECORDED_EXAMPLE_PATH)) {
          report.forbiddenRequests.push({ method: request.method(), path: url.pathname }); return route.abort();
        }
        return route.continue();
      });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(8000);
        page.on('pageerror', error => report.errors.push(error.message));
        const response = await page.goto(origin + '/landing');
        assert.equal(response.status(), 200);
        assert.equal((await response.allHeaders())['x-frame-options'], 'DENY', 'The landing retains its existing framing protection.');
        await page.getByRole('heading', { level: 1, name: 'Describe the task. Keep the tool.', exact: true }).waitFor();
        await page.getByText('Recorded Nemotron example · October 19', { exact: true }).waitFor();
        assert.equal(await page.getByRole('link', { name: 'Build your own tool', exact: true }).getAttribute('href'), '/work?starter=release-packet-checker');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, `landing-${width}.png`) });
        const expectedSocialImage = resolveSocialImageUrl(process.env.NEBIUS_PUBLIC_ORIGIN) || SOCIAL_IMAGE_PATH;
        assert.equal(await page.locator('meta[property="og:image"]').getAttribute('content'), expectedSocialImage);
        assert.equal(await page.locator('meta[name="twitter:image"]').getAttribute('content'), expectedSocialImage);
        const repairCard = page.locator('.neb-workflow-card').filter({ has: page.getByRole('heading', { name: 'Run and repair', exact: true }) });
        assert.match(await repairCard.textContent(), /may try one repair\. If that repair passes validation, the checks can run again\./u);
        await repairCard.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `landing-repair-${width}.png`) });
        const tryExample = page.getByRole('link', { name: 'Try the example', exact: true });
        await reach(page, tryExample); await page.keyboard.press('Enter');
        assert.equal(new URL(page.url()).hash, '#recorded-example');
        const section = page.locator('#recorded-example');
        assert.equal(await section.evaluate(element => element === document.activeElement), true, 'The fragment moves focus to the interactive example.');
        const iframe = page.locator('.neb-example-frame');
        assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts');
        assert.equal(await iframe.getAttribute('title'), 'Recorded Nemotron release-packet checker');
        const tool = page.frameLocator('.neb-example-frame');
        await tool.locator('#input-json').waitFor({ state: 'visible' });
        for (const [id, expected] of [['load-incomplete', THREE_GAPS], ['load-complete', READY]]) {
          await reach(page, tool.locator('#' + id)); await page.keyboard.press('Enter');
          const frame = page.frames().find(frame => frame.url() === origin + RECORDED_EXAMPLE_PATH);
          await frame.waitForFunction(({ expected }) => document.getElementById('output').textContent === expected, { expected });
          await page.screenshot({ path: path.join(output, `example-${id}-${width}.png`) });
        }
        const download = page.getByRole('link', { name: 'Download the example tool', exact: true });
        await reach(page, download, true);
        const pending = page.waitForEvent('download'); await page.keyboard.press('Enter');
        const downloaded = await pending;
        const { readFile } = await import('node:fs/promises');
        const html = await readFile(await downloaded.path());
        assert.equal(createHash('sha256').update(html).digest('hex'), EXPECTED_RENDERED_EXAMPLE_DIGEST);
        report.widths.push({ width, height, socialMetadataAndRepairCopy: true, nativeEntryAndExamples: true, downloadMatchesCurrentRenderedExport: true, hostFramingPolicyPreserved: true, opaqueFrame: true, overflow: false });
        await page.close();
        for (const scenario of PACKET_CASES) {
          const observation = { width, height, case: scenario.name, observed: false, passed: false };
          const sample = await context.newPage(); sample.setDefaultTimeout(8000);
          sample.on('pageerror', error => report.errors.push(error.message));
          try {
            const response = await sample.goto(origin + RECORDED_EXAMPLE_PATH);
            assert.equal(response.status(), 200);
            await sample.locator('#input-json').fill(scenario.input);
            await sample.locator('#check-button').click();
            await sample.waitForFunction(() => document.getElementById('output').textContent !== '');
            observation.actual = await sample.locator('#output').textContent(); observation.observed = true;
            assertPacketResult(assert, observation.actual, scenario); observation.passed = true;
          } catch (error) { observation.error = error.message; }
          finally { report.cases.push(observation); await sample.close(); }
        }
      } finally { await context.close(); }
    }
    assert.deepEqual(report.forbiddenRequests, []); assert.deepEqual(report.errors, []);
    assert.equal(report.cases.length, report.expectedPacketObservations);
    assert(report.cases.every(item => item.observed && item.passed)); report.passed = true;
  } catch (error) { report.failure = error.message; throw error; }
  finally {
    await browser.close();
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ recordedLanding: report.passed, packetObservations: report.cases.length, packetPasses: report.cases.filter(item => item.passed).length, modelCalls: 0, sandboxRuns: 0, evidence: output }));
  }
}

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

const port = await availablePort();
let inspectorPort;
do { inspectorPort = await availablePort(); } while (inspectorPort === port);
const origin = `http://127.0.0.1:${port}`;
const emptyVars = path.resolve(`dist/nebius-runtime-${process.pid}-${port}.vars`);
await writeFile(emptyVars, '', { flag: 'wx' });
// Always local and disabled: this gate proves startup and routing without
// reading a saved task, requesting inference, or deploying any resource.
const worker = spawn(process.execPath, [
  path.resolve('node_modules/wrangler/bin/wrangler.js'), 'dev', '--local',
  '--config', 'wrangler.nebius.jsonc', '--ip', '127.0.0.1', '--port', String(port),
  '--inspector-ip', '127.0.0.1', '--inspector-port', String(inspectorPort),
  '--env-file', emptyVars,
  '--var', 'NEBIUS_ENABLED:false',
  '--var', 'NEBIUS_EXECUTION_ENABLED:false',
], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
let log = '', launchError;
worker.on('error', error => { launchError = error; });
for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => { log = (log + chunk.toString()).slice(-16000); });

try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (worker.exitCode !== null || worker.signalCode !== null) throw new Error(`Local Worker exited before startup.\n${log}`);
    try {
      const response = await fetch(`${origin}/api/nebius/config?operation=suggest-next-step`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 404 && (await response.json()).code === 'nebius_disabled') { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, `Local Worker did not start within 30 seconds.\n${log}`);
  const landing = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /id="nebius-title"/u);
  const next = await fetch(`${origin}/next?pack=nebius-keyboard-review`, { signal: AbortSignal.timeout(5000) });
  assert.equal(next.status, 200);
  const taskShell = await next.text();
  assert.match(taskShell, /<title>Task — Wornpage Projects™<\/title>/u);
  assert.match(taskShell, /<main\b[^>]*aria-label="Task page"/u);
  const example = await fetch(origin + RECORDED_EXAMPLE_PATH, { signal: AbortSignal.timeout(5000) });
  assert.equal(example.status, 200);
  assert.equal(example.headers.get('x-nebius-source-digest'), RECORDED_EXAMPLE_DIGEST);
  assert.match(example.headers.get('content-security-policy'), /frame-ancestors 'self'; sandbox allow-scripts/u);
  assert.equal(example.headers.get('x-frame-options'), null);
  assert.equal(createHash('sha256').update(await example.text()).digest('hex'), EXPECTED_RENDERED_EXAMPLE_DIGEST);
  for (const operation of ['suggest-next-step', 'review-evidence', 'plan-project', 'replan-project']) {
    const response = await fetch(`${origin}/api/nebius/${operation}`, {
      method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', origin }, body: '{}',
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'nebius_disabled');
  }
  const identity = await fetch(origin + '/api/nebius/build-info', { signal: AbortSignal.timeout(5000) });
  assert.equal(identity.status, 200);
  const identityBody = await identity.json();
  assert.equal(identityBody.available, true);
  assert.match(identityBody.versionId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
  assert.equal(identityBody.executionEnabled, false);
  assert.equal(identityBody.guidanceEnabled, false);
  assert.equal(identityBody.limits.maxOutputTokens, 32000);
  assert.equal(identityBody.limits.maxModelCalls, 2);
  console.log(JSON.stringify({ localWorkerdStarted: true, nebiusLanding: 200, taskShellRoute: 200, disabledOperations: 4, buildIdentityVerifiedLocally: true, inferenceCalls: 0, deployed: false }));
  if (landingBrowser) await inspectLanding(origin);
} finally {
  if (worker.exitCode === null && worker.signalCode === null && worker.pid) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    } else {
      worker.kill('SIGTERM');
      await Promise.race([new Promise(resolve => worker.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (worker.exitCode === null) worker.kill('SIGKILL');
    }
  }
  await rm(emptyVars, { force: true });
}
