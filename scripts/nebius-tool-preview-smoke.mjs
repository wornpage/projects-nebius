import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authoredCheckerFiles, materializeAuthoredChecker } from '../tests/fixtures/nebius-release-checker.mjs';
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
let server, browser;
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
  let bridgePreview;
  if (!selected) {
    // A deliberately slow authored handler proves event ordering in the real
    // renderer. This is never inserted into a retained RunRecord or model file.
    const bridgeFiles = authoredCheckerFiles();
    bridgeFiles[1].content = bridgeFiles[1].content.replace('function handleMessage(message) {', `function handleMessage(message) {
  if (message.type === 'event' && message.event === 'click') {
    const start = Date.now();
    while (Date.now() - start < 1000) {}
  }`);
    const materialized = await materializeAuthoredChecker(bridgeFiles);
    bridgePreview = await renderRunPreview(materialized);
    report.bridgeFixture = { kind: 'authored-slow-handler', delayMilliseconds: 1000, sourceDigest: await runFilesDigest(materialized), expectedChecks: 6 };
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
  server = createServer((request, response) => {
    request.resume();
    const headers = { 'cache-control': 'no-store', 'content-type': 'text/html;charset=utf-8' };
    if (request.url === '/' && request.method === 'GET') {
      response.writeHead(200, headers); response.end(wrapper);
    } else if (request.url === '/fixture-preview' && request.method === 'POST') {
      response.writeHead(200, { ...headers, 'content-security-policy': preview.csp }); response.end(preview.html);
    } else if (request.url === '/bridge-preview' && request.method === 'POST' && bridgePreview) {
      response.writeHead(200, { ...headers, 'content-security-policy': bridgePreview.csp }); response.end(bridgePreview.html);
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
        for (const scenario of ['check then edit', 'two example loaders', 'example loader then edit']) {
          const detail = { width, category: 'bridge', case: scenario, fixtureKind: 'authored-slow-handler', actualInput: null, actualOutput: null, replies: null, nativeEvents: null };
          let tool;
          let before = 0, eventCount = 0;
          await observe('busy bridge: ' + scenario, detail, async () => {
            tool = await openTool(true);
            try {
              if (scenario === 'check then edit') {
                await tool.fill(CORRECTED);
                assert.equal(await tool.check(), READY);
              }
              before = await tool.page.evaluate(() => window.fixtureMessages.length);
              eventCount = await tool.frame.evaluate(() => window.qualificationEvents.length);
              if (scenario === 'check then edit') {
                await tool.control('check').focus();
                await tool.page.keyboard.press('Enter');
                await tool.control('input').fill('{');
              } else if (scenario === 'two example loaders') {
                await tool.control('incomplete').focus();
                await tool.page.keyboard.press('Enter');
                await tool.control('corrected').focus();
                await tool.page.keyboard.press('Space');
              } else {
                await tool.control('corrected').focus();
                await tool.page.keyboard.press('Space');
                await tool.control('input').fill('{');
              }
              const expected = scenario === 'two example loaders' ? READY : 'Input changed. Check packet again.';
              await tool.frame.waitForFunction(({ id, expected }) => document.getElementById(id).textContent === expected, { id: bindings.output, expected });
              if (scenario === 'two example loaders') assert.deepEqual(JSON.parse(await tool.control('input').inputValue()), JSON.parse(CORRECTED));
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
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
