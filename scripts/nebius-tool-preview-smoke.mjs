import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authoredCheckerFiles, materializeAuthoredChecker } from '../tests/fixtures/nebius-release-checker.mjs';
import { PACKET_CASES, INCOMPLETE, CORRECTED, THREE_GAPS, READY, assertPacketResult } from '../tests/fixtures/nebius-release-packet-cases.mjs';
import { runFilesDigest } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const output = path.resolve(process.env.NEBIUS_PREVIEW_EVIDENCE_DIR || 'dist/nebius-tool-preview');
const report = {
  evidenceKind: 'authored-provider-free-fixture', node: process.version,
  liveModelCalls: 0, liveSandboxRuns: 0, deployed: false,
  renderer: 'worker/nebius-run-preview.mjs', sourceDigest: null, browser: null,
  checks: [], passed: false,
};
let server, browser;
const record = (name, detail = {}) => report.checks.push({ name, passed: true, ...detail });

try {
  await mkdir(output, { recursive: true });
  const { renderRunPreview } = await import('../worker/nebius-run-preview.mjs');
  const { chromium } = await import('playwright-core');
  const executablePath = process.env.CHROME_EXECUTABLE_PATH;
  assert.ok(executablePath, 'Set CHROME_EXECUTABLE_PATH to an existing Chromium executable; this test never downloads a browser.');
  const files = await materializeAuthoredChecker();
  report.sourceDigest = await runFilesDigest(files);
  await writeFile(path.join(output, 'authored-files.json'), JSON.stringify(files, null, 2) + '\n');
  const preview = await renderRunPreview(files);
  assert.match(preview.csp, /connect-src 'none'/u);
  assert.match(preview.csp, /sandbox allow-scripts/u);
  assert.doesNotMatch(preview.csp, /allow-same-origin/u);
  record('real preview renderer preserves the existing isolation policy');

  // Add an event attribute only for a sanitizer probe, not to the normal fixture.
  const sanitizerFiles = structuredClone(files);
  sanitizerFiles[0].content = sanitizerFiles[0].content.replace('id="check-packet"', 'id="check-packet" onclick="alert(1)"');
  const sanitized = await renderRunPreview(sanitizerFiles);
  assert.doesNotMatch(sanitized.html, /onclick=/u);
  record('real renderer removes a supplied inline event handler');

  const wrapper = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Authored preview test host</title></head><body>
<h1>Provider-free test host</h1><p>Authored fixture. Not a model run.</p>
<form method="post" action="/fixture-preview" target="fixture"><button id="open-preview" type="submit">Open authored preview</button></form>
<iframe id="fixture" name="fixture" title="Authored checker preview" src="about:blank" sandbox="allow-scripts" style="width:100%;height:700px;border:0"></iframe>
<output id="preview-status"></output>
<script>
window.fixtureMessages = [];
addEventListener('message', event => {
  const frame = document.getElementById('fixture');
  if (event.source !== frame.contentWindow || event.origin !== 'null') return;
  const data = event.data;
  if (!data || Object.keys(data).sort().join(',') !== 'status,type' || data.type !== 'nebius-tool-preview') return;
  window.fixtureMessages.push({origin:event.origin,status:data.status});
  document.getElementById('preview-status').textContent = data.status;
});
</script></body></html>`;
  server = createServer((request, response) => {
    request.resume();
    const headers = { 'cache-control': 'no-store', 'content-type': 'text/html;charset=utf-8' };
    if (request.url === '/' && request.method === 'GET') {
      response.writeHead(200, headers); response.end(wrapper);
    } else if (request.url === '/fixture-preview' && request.method === 'POST') {
      response.writeHead(200, { ...headers, 'content-security-policy': preview.csp }); response.end(preview.html);
    } else {
      response.writeHead(404, { 'cache-control': 'no-store' }); response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath, headless: true });
  report.browser = browser.version();

  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    try {
      const externalRequests = [], pageErrors = [];
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin + '/') || url.startsWith('blob:') || url === 'about:blank') return route.continue();
        externalRequests.push(url); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => pageErrors.push(error.message));
      page.setDefaultTimeout(7000);
      await page.goto(origin);
      await page.locator('#open-preview').click();
      await page.waitForFunction(() => document.getElementById('preview-status').textContent === 'ready');
      const frame = page.frames().find(item => item.url() === origin + '/fixture-preview');
      assert.ok(frame, 'The actual rendered preview must be in the sandboxed frame.');
      const text = () => frame.locator('#result').textContent();
      const waitText = expected => frame.waitForFunction(value => document.getElementById('result').textContent === value, expected);
      const waitEdited = () => waitText('Input changed. Check packet again.');
      const fillAndWait = async value => {
        const previous = await page.evaluate(() => window.fixtureMessages.length);
        await frame.locator('#packet').fill(value);
        await page.waitForFunction(count => window.fixtureMessages.length > count, previous);
        await waitEdited();
      };
      assert.doesNotMatch(await text(), /Ready for human review/u);
      assert.equal(await frame.evaluate(() => { try { return parent.document.title; } catch { return 'blocked'; } }), 'blocked');
      record('opaque-origin worker handshake and parent DOM isolation', { width });

      // Keyboard navigation, rather than programmatic clicks, drives these controls.
      await frame.locator('#packet').focus();
      await page.keyboard.press('Tab');
      assert.equal(await frame.evaluate(() => document.activeElement.id), 'load-incomplete');
      await page.keyboard.press('Enter'); await waitText(THREE_GAPS);
      assert.deepEqual(JSON.parse(await frame.locator('#packet').inputValue()), JSON.parse(INCOMPLETE));
      await page.keyboard.press('Tab');
      assert.equal(await frame.evaluate(() => document.activeElement.id), 'load-corrected');
      await page.keyboard.press('Space'); await waitText(READY);
      assert.deepEqual(JSON.parse(await frame.locator('#packet').inputValue()), JSON.parse(CORRECTED));
      record('both example loaders set input values and correct outputs by keyboard', { width });

      await fillAndWait('{');
      assert.doesNotMatch(await text(), /Ready for human review|0 gaps/u);
      await frame.locator('#check-packet').focus(); await page.keyboard.press('Enter');
      await frame.waitForFunction(() => document.getElementById('result').textContent.startsWith('Input error:'));
      assert.doesNotMatch(await text(), /Ready for human review|0 gaps/u);
      record('editing and invalid input remove a previous readiness result', { width });

      for (const scenario of PACKET_CASES) {
        // Set a different intermediate value to guarantee an input event for each case.
        await fillAndWait('__fixture_reset__');
        await fillAndWait(scenario.input);
        await frame.locator('#check-packet').focus(); await page.keyboard.press('Enter');
        if (scenario.invalid) {
          await frame.waitForFunction(() => document.getElementById('result').textContent.startsWith('Input error:'));
        } else {
          await waitText(scenario.expected);
        }
        assertPacketResult(assert, await text(), scenario);
        record('browser packet: ' + scenario.name, { width, actual: await text() });
      }
      const dimensions = await frame.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(dimensions.content <= dimensions.viewport + 1, JSON.stringify(dimensions));
      await page.screenshot({ path: path.join(output, `authored-preview-${width}.png`), fullPage: true });
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(externalRequests, []);
      const messages = await page.evaluate(() => window.fixtureMessages);
      assert.ok(messages.length > 0 && messages.every(message => message.origin === 'null' && message.status === 'ready'));
      record('no horizontal overflow, page errors, failed handshake or external requests observed', { width });
    } finally {
      await context.close();
    }
  }
  // Retain original authored code separately from its server-materialized source.
  await writeFile(path.join(output, 'authored-source.json'), JSON.stringify(authoredCheckerFiles(), null, 2) + '\n');
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
