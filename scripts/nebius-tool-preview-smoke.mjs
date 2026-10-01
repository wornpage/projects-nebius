import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authoredCheckerFiles, authoredPreviewReference, materializeAuthoredChecker } from '../tests/fixtures/nebius-release-checker.mjs';
import { PACKET_CASES, INCOMPLETE, CORRECTED, THREE_GAPS, READY, assertPacketResult } from '../tests/fixtures/nebius-release-packet-cases.mjs';
import { runFilesDigest, validateRunIntegrity } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const output = path.resolve(process.env.NEBIUS_PREVIEW_EVIDENCE_DIR || 'dist/nebius-tool-preview');
const report = {
  evidenceKind: 'authored-provider-free-fixture', oracle: 'frozen-strict-output', node: process.version,
  liveModelCalls: 0, liveSandboxRuns: 0, deployed: false,
  scope: 'production renderer in a local test host, not authenticated app routes',
  renderer: 'worker/nebius-run-preview.mjs', sourceDigest: null, browser: null,
  expectedPacketChecks: PACKET_CASES.length * 2, checks: [], passed: false,
};
let server, browser, parentPosts = 0;
const record = (name, detail = {}) => report.checks.push({ name, passed: true, ...detail });
const failure = error => error instanceof Error ? { name: error.name, message: error.message.slice(0, 800) } : { message: String(error).slice(0, 800) };
const observe = async (name, detail, check) => {
  try { await check(); record(name, detail); }
  catch (error) { report.checks.push({ name, passed: false, ...detail, error: failure(error) }); }
};

function options(args) {
  if (!args.length) return null;
  assert.equal(args.length, 4, 'Use --run-record PATH and --bindings PATH together, or no arguments for the authored fixture.');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    assert.ok(['--run-record', '--bindings'].includes(name) && !values.has(name), 'Unknown or duplicate qualification option.');
    assert.ok(value && !value.startsWith('--'), 'Each qualification option requires a path.');
    values.set(name, value);
  }
  assert.equal(values.size, 2);
  return { record: values.get('--run-record'), bindings: values.get('--bindings') };
}

async function boundedJson(file, maximum) {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile(), 'Qualification inputs must be regular files.');
    assert.ok(stat.size <= maximum, 'The qualification input file exceeds its size limit.');
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    assert.ok(length <= maximum, 'The qualification input file exceeds its size limit.');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw new TypeError('Qualification inputs must be valid JSON.'); }
  } finally { await handle.close(); }
}

function controlBindings(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Bindings must be an object.');
  assert.deepEqual(Object.keys(value).sort(), ['check', 'corrected', 'incomplete', 'input', 'output']);
  assert.ok(Object.values(value).every(id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,199}$/u.test(id)), 'Bindings must contain HTML IDs, not selectors or code.');
  assert.equal(new Set(Object.values(value)).size, 5, 'Each bound control needs a distinct ID.');
  return value;
}

try {
  await mkdir(output, { recursive: true });
  const selected = options(process.argv.slice(2));
  let files, bindings, label, prefix;
  if (selected) {
    // Source is data only. Generated code executes in the production renderer's
    // isolated browser Worker, never in host Node or a substitute handler.
    const run = await validateRunIntegrity(await boundedJson(selected.record, 1048576));
    assert.equal(run.status, 'ready', 'Only a retained ready RunRecord can be qualified.');
    bindings = controlBindings(await boundedJson(selected.bindings, 4096));
    files = run.files;
    report.evidenceKind = 'retained-model-source';
    report.recordAuthority = 'Caller-supplied RunRecord file; integrity checked, not authenticated by this harness.';
    report.run = { id: run.id, requestedModel: run.requestedModel, updatedAt: run.updatedAt, recordedUsage: run.usage };
    label = 'Retained model source; no new model or Sandbox call';
    prefix = 'retained';
  } else {
    files = await materializeAuthoredChecker();
    bindings = controlBindings({ input: 'packet', output: 'result', check: 'check-packet', incomplete: 'load-incomplete', corrected: 'load-corrected' });
    label = 'Authored fixture, not model-generated output';
    prefix = 'authored';
  }
  report.sourceDigest = await runFilesDigest(files);
  await writeFile(path.join(output, prefix + '-files.json'), JSON.stringify(files, null, 2) + '\n');
  if (!selected) await writeFile(path.join(output, 'authored-source.json'), JSON.stringify(authoredCheckerFiles(), null, 2) + '\n');

  const { renderRunPreview } = await import('../worker/nebius-run-preview.mjs');
  const { chromium } = await import('playwright-core');
  const executablePath = process.env.CHROME_EXECUTABLE_PATH;
  assert.ok(executablePath, 'Set CHROME_EXECUTABLE_PATH to an existing Chromium executable; this test never downloads a browser.');
  const preview = await renderRunPreview(files);
  let bridgePreview, parentReference;
  const staticRoot = path.resolve('dist/static-publish');
  if (!selected) {
    await access(path.join(staticRoot, 'review.html')).catch(() => { throw new Error('Build the current review UI with npm run build:nebius before authored preview qualification.'); });
    parentReference = await authoredPreviewReference(files);
    report.scope = 'production renderer and compiled review UI in a local test host with synthetic API; not authenticated app routes or provider evidence';
    report.parentFixture = { kind: 'authored-synthetic-run-reference', sourceDigest: report.sourceDigest, expectedChecks: 12,
      component: 'svelte-frontend/src/routes/review/NebiusRunReview.svelte', recordIsProviderEvidence: false };
    // A deliberately slow authored handler proves event ordering in the real
    // renderer. This is never inserted into a retained RunRecord or model file.
    const bridgeFiles = authoredCheckerFiles();
    bridgeFiles[0].content = bridgeFiles[0].content.replace('</main>', '<button id="load-input-only" data-example-for="packet">Load input only</button></main>');
    bridgeFiles[1].content = bridgeFiles[1].content.replace('function handleMessage(message) {', `function handleMessage(message) {
  if (message.type === 'event' && ['input', 'change'].includes(message.event)) return [];
  if (message.type === 'event' && message.event === 'click') {
    const start = Date.now();
    while (Date.now() - start < 1000) {}
    if (message.id === 'load-input-only') return [{ id: 'packet', value: JSON.stringify({ candidate: 'probe', health: 'missing', review: 'pending', rollback: '' }) }];
  }`).replace("return [{ id: 'packet', value }, { id: 'result', text: validate(value) }];", "return [{ id: 'result', text: validate(value) }, { id: 'packet', value }];");
    const materialized = await materializeAuthoredChecker(bridgeFiles);
    bridgePreview = await renderRunPreview(materialized);
    report.bridgeFixture = { kind: 'authored-slow-handler-without-edit-patches', delayMilliseconds: 1000, sourceDigest: await runFilesDigest(materialized), expectedChecks: 8 };
    await writeFile(path.join(output, 'bridge-files.json'), JSON.stringify(materialized, null, 2) + '\n');
  }
  assert.match(preview.csp, /connect-src 'none'/u);
  assert.match(preview.csp, /sandbox allow-scripts/u);
  assert.doesNotMatch(preview.csp, /allow-same-origin/u);
  record('real preview renderer preserves the existing isolation policy');
  const sanitizerFiles = structuredClone(files);
  sanitizerFiles[0].content += '\n<button id="sanitizer-probe" onclick="alert(1)">probe</button>';
  const sanitized = await renderRunPreview(sanitizerFiles);
  assert.doesNotMatch(sanitized.html, /onclick=/u);
  record('real renderer removes a supplied inline event handler');

  const wrapper = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Preview qualification host</title></head><body>
<h1>Offline preview qualification</h1><p>${label}. Strict oracle; not independent project acceptance.</p>
<form method="post" action="/fixture-preview" target="fixture"><button id="open-preview" type="submit">Open preview</button></form>
${bridgePreview ? '<form method="post" action="/bridge-preview" target="fixture"><button id="open-bridge-preview" type="submit">Open authored event-order probe</button></form>' : ''}
<iframe id="fixture" name="fixture" title="Checker qualification preview" src="about:blank" sandbox="allow-scripts" style="width:100%;height:700px;border:0"></iframe>
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
  const parentPreviewPath = parentReference ? '/api/nebius/runs/' + parentReference.id + '/preview' : null;
  server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const headers = { 'cache-control': 'no-store', 'content-type': 'text/html;charset=utf-8', 'referrer-policy': 'same-origin' };
    if (url.pathname === parentPreviewPath && request.method === 'POST') {
      let text = ''; for await (const chunk of request) {
        text += chunk;
        if (Buffer.byteLength(text) > 100) { response.writeHead(413); response.end(); return; }
      }
      const params = [...new URLSearchParams(text)];
      if (text.length > 100 || params.length !== 1 || params[0][0] !== 'key' || params[0][1] !== parentReference.key) {
        response.writeHead(401, { 'content-type': 'application/json' }); response.end('{}'); return;
      }
      parentPosts += 1;
      response.writeHead(200, { ...headers, 'content-security-policy': preview.csp, 'referrer-policy': 'no-referrer' }); response.end(preview.html); return;
    }
    request.resume();
    if (url.pathname.startsWith('/api/')) {
      // Every other API is disabled. This test host cannot request inference.
      response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ code: 'execution_disabled', error: 'Synthetic preview test host only.' })); return;
    }
    if (request.url === '/' && request.method === 'GET') {
      response.writeHead(200, headers); response.end(wrapper);
    } else if (request.url === '/fixture-preview' && request.method === 'POST') {
      response.writeHead(200, { ...headers, 'content-security-policy': preview.csp }); response.end(preview.html);
    } else if (request.url === '/bridge-preview' && request.method === 'POST' && bridgePreview) {
      response.writeHead(200, { ...headers, 'content-security-policy': bridgePreview.csp }); response.end(bridgePreview.html);
    } else if (parentReference && request.method === 'GET') {
      let relative;
      try { relative = decodeURIComponent(url.pathname).replace(/^\//u, '') || 'index.html'; }
      catch { response.writeHead(400); response.end(); return; }
      if (!path.extname(relative)) relative += '.html';
      const file = path.resolve(staticRoot, relative), distance = path.relative(staticRoot, file);
      if (distance.startsWith('..') || path.isAbsolute(distance)) { response.writeHead(403); response.end(); return; }
      try {
        const bytes = await readFile(file);
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
        response.writeHead(200, { ...headers, 'content-type': types[path.extname(file)] || 'application/octet-stream' }); response.end(bytes);
      } catch { response.writeHead(404); response.end(); }
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
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const externalRequests = [], pageErrors = [];
    try {
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url.startsWith(origin + '/') || url.startsWith('blob:') || url === 'about:blank') return route.continue();
        externalRequests.push(url); return route.abort();
      });
      // Observe native UI events without changing source or the message bridge.
      await context.addInitScript(() => {
        if (window === top) return;
        window.qualificationEvents = [];
        for (const name of ['click', 'input', 'change', 'submit']) document.addEventListener(name, event => {
          const element = event.target instanceof Element ? event.target.closest('[id]') : null;
          if (element && window.qualificationEvents.length < 2000) window.qualificationEvents.push({ event: name, id: element.id,
            accepted: Array.from(document.body.querySelectorAll('[id]')).slice(0, 200).includes(element) });
        }, true);
      });

      const openTool = async (bridgeProbe = false) => {
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        page.setDefaultTimeout(4000);
        await page.goto(origin);
        await page.locator(bridgeProbe ? '#open-bridge-preview' : '#open-preview').click();
        await page.waitForFunction(() => document.getElementById('preview-status').textContent === 'ready');
        const frame = page.frames().find(item => item.url() === origin + (bridgeProbe ? '/bridge-preview' : '/fixture-preview'));
        assert.ok(frame, 'The actual rendered preview must be in the sandboxed frame.');
        await page.locator('#fixture').scrollIntoViewIfNeeded();
        for (const id of Object.values(bindings)) assert.equal(await frame.locator('#' + id).count(), 1, 'A bound ID must identify exactly one sanitized element.');
        const roles = await frame.evaluate(ids => Object.fromEntries(Object.entries(ids).map(([name, id]) => {
          const element = document.getElementById(id);
          return [name, { tag: element.tagName, type: element.type, disabled: element.disabled, readOnly: element.readOnly, tabIndex: element.tabIndex }];
        })), bindings);
        assert.ok(roles.input.tag === 'TEXTAREA' || (roles.input.tag === 'INPUT' && roles.input.type === 'text'));
        assert.ok(!roles.input.disabled && !roles.input.readOnly && roles.input.tabIndex >= 0);
        assert.ok(['OUTPUT', 'PRE'].includes(roles.output.tag));
        for (const name of ['check', 'incomplete', 'corrected']) assert.ok(!roles[name].disabled && roles[name].tabIndex >= 0 && (roles[name].tag === 'BUTTON' || (roles[name].tag === 'INPUT' && ['button', 'submit'].includes(roles[name].type))));
        report.bindings = bindings;
        const control = name => frame.locator('#' + bindings[name]);
        const text = () => control('output').textContent();
        const action = async perform => {
          const before = await page.evaluate(() => window.fixtureMessages.length);
          const count = await frame.evaluate(() => window.qualificationEvents.length);
          await perform();
          const events = await frame.evaluate(previous => window.qualificationEvents.slice(previous), count);
          const relevant = events.filter(event => event.accepted);
          // The ordered bridge accepts every mapped event, including both
          // click and submit. Wait for the complete action before the next one.
          if (relevant.length) await page.waitForFunction(expected => window.fixtureMessages.length >= expected, before + relevant.length);
          // ready follows patches; also observe a subsequent rendered DOM turn.
          await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.notEqual(await page.locator('#preview-status').textContent(), 'failed');
        };
        const fill = async value => {
          await action(() => control('input').fill(value));
          assert.equal(await control('input').inputValue(), value);
        };
        const check = async () => {
          await action(() => control('check').focus());
          await action(() => page.keyboard.press('Enter'));
          return text();
        };
        return { page, frame, control, text, action, fill, check };
      };

      const interaction = await openTool();
      try {
        assert.doesNotMatch(await interaction.text(), /Ready for human review/u);
        assert.equal(await interaction.frame.evaluate(() => { try { return parent.document.title; } catch { return 'blocked'; } }), 'blocked');
        record('opaque-origin worker handshake and parent DOM isolation', { width });
        assert.equal(await interaction.frame.evaluate(() => {
          try { void navigator.serviceWorker; return 'available'; } catch (error) { return error.name; }
        }), 'SecurityError');
        assert.equal(await interaction.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
        record('opaque preview denies service worker access and the fresh host has no registrations', { width });

        const loaders = { width, incomplete: null, corrected: null };
        await observe('both example loaders set inputs and corresponding checked outputs by keyboard', loaders, async () => {
          await interaction.action(() => interaction.control('incomplete').focus());
          assert.equal(await interaction.frame.evaluate(() => document.activeElement.id), bindings.incomplete);
          await interaction.action(() => interaction.page.keyboard.press('Enter'));
          assert.deepEqual(JSON.parse(await interaction.control('input').inputValue()), JSON.parse(INCOMPLETE));
          loaders.incomplete = await interaction.check();
          assert.equal(loaders.incomplete, THREE_GAPS);
          await interaction.action(() => interaction.control('corrected').focus());
          assert.equal(await interaction.frame.evaluate(() => document.activeElement.id), bindings.corrected);
          await interaction.action(() => interaction.page.keyboard.press('Space'));
          assert.deepEqual(JSON.parse(await interaction.control('input').inputValue()), JSON.parse(CORRECTED));
          assert.notEqual(await interaction.text(), THREE_GAPS, 'Loading another packet must clear or replace the old result.');
          loaders.corrected = await interaction.check();
          assert.equal(loaders.corrected, READY);
        });
        const edits = { width, afterEdit: null, afterCheck: null };
        await observe('editing and invalid input remove a previous readiness result', edits, async () => {
          await interaction.fill(CORRECTED);
          assert.equal(await interaction.check(), READY);
          await interaction.fill('{');
          edits.afterEdit = await interaction.text();
          // Capture both states even when the first assertion will fail.
          edits.afterCheck = await interaction.check();
          assert.doesNotMatch(edits.afterEdit, /Ready for human review|0 gaps/u);
          assertPacketResult(assert, edits.afterCheck, PACKET_CASES.find(item => item.name === 'malformed JSON'));
        });
      } finally { await interaction.page.close(); }

      if (bridgePreview) {
        for (const scenario of ['check then edit', 'two example loaders', 'example loader then edit', 'input-only loader']) {
          const detail = { width, category: 'bridge', case: scenario, fixtureKind: 'authored-slow-handler', actualInput: null, actualOutput: null, replies: null, nativeEvents: null };
          let tool;
          let before = 0, eventCount = 0;
          await observe('busy bridge: ' + scenario, detail, async () => {
            tool = await openTool(true);
            try {
              if (scenario === 'check then edit' || scenario === 'input-only loader') {
                await tool.fill(CORRECTED);
                assert.equal(await tool.check(), READY);
              }
              before = await tool.page.evaluate(() => window.fixtureMessages.length);
              eventCount = await tool.frame.evaluate(() => window.qualificationEvents.length);
              if (scenario === 'check then edit') {
                await tool.control('check').focus();
                await tool.page.keyboard.press('Enter');
                await tool.control('input').fill('{');
                assert.equal(await tool.text(), '', 'Old readiness must clear before the slow Worker replies.');
              } else if (scenario === 'two example loaders') {
                await tool.control('incomplete').focus();
                await tool.page.keyboard.press('Enter');
                await tool.control('corrected').focus();
                await tool.page.keyboard.press('Space');
              } else if (scenario === 'example loader then edit') {
                await tool.control('corrected').focus();
                await tool.page.keyboard.press('Space');
                await tool.control('input').fill('{');
              } else {
                await tool.frame.locator('#load-input-only').focus();
                await tool.page.keyboard.press('Enter');
              }
              const minimumReplies = scenario === 'input-only loader' ? 1 : 2;
              await tool.page.waitForFunction(({ before, minimumReplies }) => window.fixtureMessages.length >= before + minimumReplies, { before, minimumReplies });
              const expected = scenario === 'two example loaders' ? READY : '';
              await tool.frame.waitForFunction(({ id, expected }) => document.getElementById(id).textContent === expected, { id: bindings.output, expected });
              if (scenario === 'two example loaders') assert.deepEqual(JSON.parse(await tool.control('input').inputValue()), JSON.parse(CORRECTED));
              else if (scenario === 'input-only loader') assert.equal(JSON.parse(await tool.control('input').inputValue()).candidate, 'probe');
              else assert.equal(await tool.control('input').inputValue(), '{', 'A late reply must not overwrite newer user input.');
              assert.notEqual(await tool.page.locator('#preview-status').textContent(), 'failed');
            } finally {
              detail.actualInput = await tool.control('input').inputValue();
              detail.actualOutput = await tool.text();
              detail.replies = await tool.page.evaluate(count => window.fixtureMessages.length - count, before);
              detail.nativeEvents = await tool.frame.evaluate(count => window.qualificationEvents.slice(count), eventCount);
            }
          });
          await tool?.page.close();
        }
      }

      for (const scenario of PACKET_CASES) {
        const detail = { width, category: 'packet', case: scenario.name, expected: scenario.invalid ? 'Input error: ... without readiness' : scenario.expected, actual: null, observed: false };
        let tool;
        await observe('browser packet: ' + scenario.name, detail, async () => {
          // A fresh page/frame/Worker prevents a failed or busy case cascading.
          tool = await openTool();
          await tool.fill(scenario.input);
          detail.actual = await tool.check();
          detail.observed = true;
          assertPacketResult(assert, detail.actual, scenario);
          if (scenario.name === 'corrected example') await tool.page.screenshot({ path: path.join(output, prefix + '-preview-' + width + '.png') });
        });
        await tool?.page.close();
      }
      const layout = await openTool();
      try {
        const dimensions = await layout.frame.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(dimensions.content <= dimensions.viewport + 1, JSON.stringify(dimensions));
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(externalRequests, []);
        record('no horizontal overflow, page errors or external requests observed', { width });
      } finally { await layout.page.close(); }

      if (parentReference) {
        const storageKey = 'projects-webmcp-challenge-state-v1';
        const seed = { packs: [{ id: parentReference.input.packId, ...parentReference.input.pack, status: parentReference.input.currentStatus,
          next: 'Review', executionRun: parentReference }], selectedId: parentReference.input.packId, pendingNextActionDrafts: [] };
        await context.addInitScript(({ key, seed }) => {
          if (window !== top) return;
          if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
        }, { key: storageKey, seed });
        for (const scenario of ['later Worker failure', 'reopen running preview', 'close restores keyboard focus']) {
          const detail = { width, category: 'parent', case: scenario, fixtureKind: 'authored-synthetic-run-reference',
            actualParentStatus: null, actualChildStatus: null, newFrame: null, restoredFocus: null };
          let page, frame;
          await observe('compiled parent: ' + scenario, detail, async () => {
            page = await context.newPage(); page.setDefaultTimeout(4000);
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
            const review = page.locator('[data-nebius-run-review]');
            const button = review.getByRole('button', { name: 'Try your tool', exact: true });
            await button.waitFor({ state: 'visible' });
            assert.equal(await button.evaluate(element => element.classList.contains('is-primary')), true, 'Trying the current tool is the primary action.');
            assert.equal(await review.getByRole('button', { name: 'Save run evidence', exact: true }).evaluate(element => element.classList.contains('is-primary')), false, 'Saving a run is a separate secondary action.');
            assert.equal(await review.locator('[data-run-try]').evaluate(element => {
              const details = ['.run-review-facts', '.run-checks', '.run-files'];
              return details.every(selector => Boolean(element.compareDocumentPosition(element.closest('[data-nebius-run-review]').querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING));
            }), true, 'Trying the tool comes before usage, checks and source.');
            const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
            for (let count = 0; count < 100 && !await button.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
            assert.equal(await button.evaluate(element => element === document.activeElement), true, 'Try your tool is reachable by real Tab navigation.');
            await page.keyboard.press('Enter');
            await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
            frame = page.frames().find(item => item.url() === origin + parentPreviewPath);
            assert.ok(frame, 'The compiled review UI must open the actual renderer.');
            try {
              if (scenario === 'later Worker failure') {
                // One DOM turn fills the real bridge queue while a Worker reply
                // is pending. This stops only this test frame, never a provider.
                await frame.evaluate(() => { const button = document.getElementById('check-packet'); for (let count = 0; count < 34; count += 1) button.click(); });
                await frame.locator('body > p[role="status"]').filter({ hasText: 'Too many tool interactions' }).waitFor();
                await review.locator('.run-preview-label').filter({ hasText: 'Preview stopped' }).waitFor();
              } else if (scenario === 'reopen running preview') {
                await page.evaluate(() => { window.previousPreviewWindow = document.querySelector('[data-nebius-run-review] iframe').contentWindow; });
                await button.focus(); await page.keyboard.press('Enter');
                await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
                detail.newFrame = await page.evaluate(() => document.querySelector('[data-nebius-run-review] iframe').contentWindow !== window.previousPreviewWindow);
                assert.equal(detail.newFrame, true, 'Reopening replaces the old WindowProxy so late messages cannot target the new listener.');
              } else {
                const close = review.getByRole('button', { name: 'Close preview', exact: true });
                await close.focus(); await page.keyboard.press('Enter');
                await review.locator('iframe').waitFor({ state: 'detached' });
                await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-nebius-run-review] button'))
                  .some(button => button.textContent.trim() === 'Try your tool' && button === document.activeElement));
                detail.restoredFocus = await button.evaluate(element => element === document.activeElement);
                assert.equal(detail.restoredFocus, true, 'Closing restores focus to the preview trigger.');
              }
              assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), saved, 'Preview lifecycle never saves or approves run evidence.');
            } finally {
              detail.actualParentStatus = await review.locator('.run-preview-label').count() ? await review.locator('.run-preview-label').textContent() : '(closed)';
              detail.actualChildStatus = frame && !frame.isDetached() ? await frame.locator('body > p[role="status"]').textContent() : '(detached)';
            }
          });
          await page?.close();
        }
        await observe('compiled parent: rejected generation remains inert and keyboard readable', { width, category: 'parent', case: 'rejected-source-history', fixtureKind: 'authored-synthetic-run-reference' }, async () => {
          const page = await context.newPage(); page.setDefaultTimeout(4000);
          page.on('pageerror', error => pageErrors.push(error.message));
          const failedSeed = structuredClone(seed);
          const raw = '</pre><img id="injected-generation" src="x" onerror="window.generationInjected=true">';
          const record = failedSeed.packs[0].executionRun.record;
          Object.assign(record, { status: 'failed', attempt: 0, files: [], checks: [],
            error: 'Authored source rejection fixture.', failure: { code: 'invalid_model_output', stage: 'tool_files' },
            generationAttempts: [{ attempt: 1, outcome: 'rejected', responseText: raw, retention: 'retained',
              diagnostic: { code: 'invalid_model_output', stage: 'tool_files', message: 'Authored source rejection fixture.' } }] });
          await validateRunIntegrity(record);
          await page.addInitScript(({ key, seed }) => { if (window === top) localStorage.setItem(key, JSON.stringify(seed)); }, { key: storageKey, seed: failedSeed });
          try {
            await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
            const review = page.locator('[data-nebius-run-review]');
            const history = review.locator('[data-run-generation-history]');
            await history.waitFor({ state: 'visible' });
            const summary = history.locator(':scope > summary');
            for (let count = 0; count < 120 && !await summary.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
            assert.equal(await summary.evaluate(element => element === document.activeElement), true);
            await page.keyboard.press('Enter');
            await history.locator('details > summary').focus(); await page.keyboard.press('Enter');
            assert.equal(await history.locator('pre').textContent(), raw);
            assert.equal(await review.locator('#injected-generation, iframe').count(), 0);
            assert.equal(await page.evaluate(() => Boolean(window.generationInjected)), false);
            assert.equal(await review.getByRole('button', { name: 'Try your tool', exact: true }).count(), 0);
            assert.equal(await review.getByRole('button', { name: 'Save run evidence', exact: true }).count(), 0);
            await page.screenshot({ path: path.join(output, 'rejected-source-history-' + width + '.png') });
          } finally { await page.close(); }
        });
        await observe('compiled parent: stale result remains inspection only', { width, category: 'parent', case: 'stale', fixtureKind: 'authored-synthetic-run-reference' }, async () => {
          const page = await context.newPage(); page.setDefaultTimeout(4000);
          page.on('pageerror', error => pageErrors.push(error.message));
          const staleSeed = structuredClone(seed);
          staleSeed.packs[0].purpose += ' The current requirement has changed.';
          await page.addInitScript(({ key, seed }) => {
            if (window === top) localStorage.setItem(key, JSON.stringify(seed));
          }, { key: storageKey, seed: staleSeed });
          try {
            await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
            const review = page.locator('[data-nebius-run-review]');
            const inspect = review.getByRole('button', { name: 'Inspect previous tool', exact: true });
            await inspect.waitFor({ state: 'visible' });
            assert.equal(await review.getByRole('button', { name: 'Try your tool', exact: true }).count(), 0);
            assert.equal(await inspect.evaluate(element => element.classList.contains('is-primary')), false, 'A stale tool is never the primary current-result action');
            assert.equal(await review.getByRole('button', { name: 'Save run evidence', exact: true }).isDisabled(), true);
            await review.getByText('The task details have changed since this run started. You can inspect the result, but it cannot be saved as current evidence.', { exact: true }).waitFor();
            const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
            for (let count = 0; count < 100 && !await inspect.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
            assert.equal(await inspect.evaluate(element => element === document.activeElement), true);
            await page.keyboard.press('Enter');
            await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
            assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), saved, 'Stale inspection never saves or approves evidence');
          } finally { await page.close(); }
        });
        await observe('compiled parent: no page errors or external requests', { width, category: 'parent', case: 'isolation' }, async () => {
          assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
        });
      }
    } finally { await context.close(); }
  }
  report.verificationCompleted = true;
  report.passed = report.checks.every(check => check.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = failure(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  const packets = report.checks.filter(check => check.category === 'packet');
  report.packetSummary = { expected: report.expectedPacketChecks, recorded: packets.length, observed: packets.filter(check => check.observed).length, passed: packets.filter(check => check.passed).length, failed: packets.filter(check => !check.passed).length };
  if (report.bridgeFixture) {
    const probes = report.checks.filter(check => check.category === 'bridge');
    report.bridgeSummary = { expected: report.bridgeFixture.expectedChecks, recorded: probes.length, passed: probes.filter(check => check.passed).length, failed: probes.filter(check => !check.passed).length };
  }
  if (report.parentFixture) {
    const checks = report.checks.filter(check => check.category === 'parent');
    report.parentSummary = { expected: report.parentFixture.expectedChecks, recorded: checks.length, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length };
    report.parentFixture.syntheticPreviewPosts = parentPosts;
  }
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
