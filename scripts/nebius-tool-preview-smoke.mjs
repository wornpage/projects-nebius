import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authoredCheckerFiles, authoredPreviewReference, materializeAuthoredChecker } from '../tests/fixtures/nebius-release-checker.mjs';
import { PACKET_CASES, INCOMPLETE, CORRECTED, THREE_GAPS, READY, assertPacketResult } from '../tests/fixtures/nebius-release-packet-cases.mjs';
import { RUN_RECORD_FORMAT, runFilesDigest, validateRunIntegrity, runToolRequirements } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const output = path.resolve(process.env.NEBIUS_PREVIEW_EVIDENCE_DIR || 'dist/nebius-tool-preview');
const viewports = [{ width: 375, height: 900, colorScheme: 'light' }, { width: 384, height: 468, colorScheme: 'dark' }, { width: 1280, height: 900, colorScheme: 'light' }];
const report = {
  evidenceKind: 'authored-provider-free-fixture', oracle: 'frozen-strict-output', node: process.version,
  liveModelCalls: 0, liveSandboxRuns: 0, deployed: false,
  scope: 'production renderer in a local test host, not authenticated app routes',
  renderer: 'worker/nebius-run-preview.mjs', sourceDigest: null, browser: null,
  viewports, expectedPacketChecks: PACKET_CASES.length * viewports.length, checks: [], diffPaletteChecks: [], passed: false,
};
let server, browser, parentPosts = 0;
const record = (name, detail = {}) => report.checks.push({ name, passed: true, ...detail });
const failure = error => error instanceof Error ? { name: error.name, message: error.message.slice(0, 800) } : { message: String(error).slice(0, 800) };
const progress = (stage, name, detail = {}, error) => console.log(JSON.stringify({
  stage, name, width: detail.width, category: detail.category,
  at: new Date().toISOString(), ...(error ? { errorType: ["AssertionError", "TimeoutError", "TypeError", "SyntaxError", "Error"].includes(error?.name) ? error.name : "Error" } : {}),
}));
const observe = async (name, detail, check) => {
  progress("start", name, detail);
  try { await check(); record(name, detail); progress("pass", name, detail); }
  catch (error) {
    report.checks.push({ name, passed: false, ...detail, error: failure(error) });
    progress("fail", name, detail, error);
  }
};

// Reveal mounted sections through the same native buttons used by a person.
// Wide layouts expose both panes and need no view selection.
async function showReviewView(review, view) {
  await review.waitFor({ state: 'visible' });
  await review.locator('[data-run-canvas]').waitFor({ state: 'attached' });
  const group = review.locator('.review-view-switch');
  if (!await group.isVisible()) return;
  const button = group.getByRole('button', { name: view === 'preview' ? 'Preview' : 'Review', exact: true });
  const switched = await button.getAttribute('aria-pressed') !== 'true';
  if (switched) await button.press('Enter');
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await review.locator(view === 'preview' ? '[data-run-proposal]' : '[data-nebius-review-context]').waitFor({ state: 'visible' });
  if (switched) await review.page().waitForFunction(view => {
    const focused = document.activeElement;
    return focused?.closest('[data-review-pane]')?.getAttribute('data-review-pane') === view;
  }, view);
}

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
  let previewRequirements = {};
  if (selected) {
    // Source is data only. Generated code executes in the production renderer's
    // isolated browser Worker, never in host Node or a substitute handler.
    const run = await validateRunIntegrity(await boundedJson(selected.record, 1048576));
    assert.equal(run.status, 'ready', 'Only a retained ready RunRecord can be qualified.');
    bindings = controlBindings(await boundedJson(selected.bindings, 4096));
    files = run.files;
    previewRequirements = runToolRequirements(run);
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
  const preview = await renderRunPreview(files, previewRequirements);
  let bridgePreview, captionPreview, parentReference;
  const staticRoot = path.resolve('dist/static-publish');
  if (!selected) {
    await access(path.join(staticRoot, 'review.html')).catch(() => { throw new Error('Build the current review UI with npm run build before authored preview qualification.'); });
    parentReference = await authoredPreviewReference(files);
    report.scope = 'production renderer and compiled review UI in a local test host with synthetic API; not authenticated app routes or provider evidence';
    report.parentFixture = { kind: 'authored-synthetic-run-reference', sourceDigest: report.sourceDigest, expectedChecks: 32 * viewports.length,
      component: 'svelte-frontend/src/routes/review/NebiusRunReview.svelte', recordIsProviderEvidence: false,
      previewPostCountScope: 'all attempts before body or key validation' };
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
    report.bridgeFixture = { kind: 'authored-slow-handler-without-edit-patches', delayMilliseconds: 1000, sourceDigest: await runFilesDigest(materialized), expectedChecks: 4 * viewports.length };
    await writeFile(path.join(output, 'bridge-files.json'), JSON.stringify(materialized, null, 2) + '\n');
    const captionFiles = authoredCheckerFiles();
    captionFiles[0].content = captionFiles[0].content.replace('</style>', 'p { display:none!important; } .clipped-name { position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);clip-path:inset(50%);overflow:hidden; }\n</style>')
      .replace('<output id="result"', '<output aria-labelledby="visible-result-name" id="result"')
      .replace('</main>', '<span id="visible-result-name">Packet outcome</span><button id="hide-label">Hide label</button><button id="show-label">Show label</button><span id="clipped-result-name" class="clipped-name">Clipped outcome</span><output id="clipped-result" aria-labelledby="clipped-result-name"></output></main>');
    captionFiles[1].content = captionFiles[1].content.replace('function handleMessage(message) {', `function handleMessage(message) {
  if (message.type === 'event' && message.event === 'click' && message.id === 'hide-label') return [{ id: 'visible-result-name', hidden: true }];
  if (message.type === 'event' && message.event === 'click' && message.id === 'show-label') return [{ id: 'visible-result-name', hidden: false }];`);
    const captionMaterialized = await materializeAuthoredChecker(captionFiles);
    captionPreview = await renderRunPreview(captionMaterialized);
    report.captionFixture = { kind: 'authored-output-label-visibility-probe', expectedChecks: viewports.length, providerEvidence: false };
    await writeFile(path.join(output, 'caption-files.json'), JSON.stringify(captionMaterialized, null, 2) + '\n');
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
${captionPreview ? '<form method="post" action="/caption-preview" target="fixture"><button id="open-caption-preview" type="submit">Open authored label-visibility probe</button></form>' : ''}
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
      parentPosts += 1;
      let text = ''; for await (const chunk of request) {
        text += chunk;
        if (Buffer.byteLength(text) > 100) { response.writeHead(413); response.end(); return; }
      }
      const params = [...new URLSearchParams(text)];
      if (text.length > 100 || params.length !== 1 || params[0][0] !== 'key' || params[0][1] !== parentReference.key) {
        response.writeHead(401, { 'content-type': 'application/json' }); response.end('{}'); return;
      }
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
    } else if (request.url === '/caption-preview' && request.method === 'POST' && captionPreview) {
      response.writeHead(200, { ...headers, 'content-security-policy': captionPreview.csp }); response.end(captionPreview.html);
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

  for (const { width, height, colorScheme } of viewports) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme });
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

      const openTool = async (variant = 'packet') => {
        assert(['packet', 'bridge', 'caption'].includes(variant));
        const target = variant === 'bridge' ? { button: '#open-bridge-preview', path: '/bridge-preview' }
          : variant === 'caption' ? { button: '#open-caption-preview', path: '/caption-preview' } : { button: '#open-preview', path: '/fixture-preview' };
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        page.setDefaultTimeout(4000);
        await page.goto(origin);
        await page.locator(target.button).click();
        await page.waitForFunction(() => document.getElementById('preview-status').textContent === 'ready');
        const frame = page.frames().find(item => item.url() === origin + target.path);
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

        const presentation = { width, inputFormat: null, inputFormatLabel: null, outputName: null };
        await observe('renderer names results and exposes unchanged input declarations', presentation, async () => {
          const announcer = interaction.frame.locator('body > p[role="status"][aria-label="Tool updates"]');
          assert.equal(await announcer.count(), 1);
          assert.equal(await announcer.getAttribute('aria-live'), 'polite');
          assert.equal(await announcer.getAttribute('aria-atomic'), 'true');
          presentation.outputName = await interaction.control('output').getAttribute('aria-label');
          assert.ok(presentation.outputName?.trim());
          await interaction.frame.getByText(presentation.outputName, { exact: true }).waitFor({ state: 'visible' });
          assert.equal(await interaction.control('output').getAttribute('role'), 'group');
          assert.equal(await interaction.control('output').getAttribute('aria-live'), 'off');
          presentation.inputFormat = await interaction.control('input').getAttribute('data-input-format');
          presentation.inputFormatLabel = presentation.inputFormat === 'json' ? 'JSON' : presentation.inputFormat === 'text' ? 'Plain text' : 'Not declared';
          const formats = interaction.frame.locator('body > details').last();
          await formats.locator('summary').click();
          assert.ok((await formats.locator('dd').allTextContents()).includes(presentation.inputFormatLabel));
          await formats.locator('summary').click();
        });
        const readability = { width };
        await observe('preview text, control sizing and keyboard focus remain readable without horizontal overflow', readability, async () => {
          Object.assign(readability, await interaction.frame.evaluate(ids => {
            const input = document.getElementById(ids.input), output = document.getElementById(ids.output);
            return { inputFont: parseFloat(getComputedStyle(input).fontSize), outputFont: parseFloat(getComputedStyle(output).fontSize),
              actionBackground: getComputedStyle(document.getElementById(ids.check)).backgroundColor,
              exampleBackground: getComputedStyle(document.getElementById(ids.incomplete)).backgroundColor,
              buttons: ['check', 'incomplete', 'corrected'].map(name => ({ id: ids[name], label: document.getElementById(ids[name]).textContent.trim(), height: document.getElementById(ids[name]).getBoundingClientRect().height })),
              documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth };
          }, bindings));
          await interaction.action(() => interaction.control('input').focus());
          await interaction.action(() => interaction.page.keyboard.press('Tab'));
          readability.focus = await interaction.frame.evaluate(() => {
            const element = document.activeElement, style = getComputedStyle(element);
            const colorProbe = document.createElement('canvas').getContext('2d');
            colorProbe.fillStyle = style.outlineColor;
            colorProbe.fillRect(0, 0, 1, 1);
            return { id: element.id, visible: element.matches(':focus-visible'), outlineStyle: style.outlineStyle,
              outlineWidth: parseFloat(style.outlineWidth), outlineColor: style.outlineColor, outlineAlpha: colorProbe.getImageData(0, 0, 1, 1).data[3] };
          });
          assert.ok(readability.inputFont >= 16 && readability.outputFont >= 16, 'Packet input and result need readable text.');
          assert.ok(readability.buttons.every(button => button.height >= 44), 'Packet actions need usable target height.');
          assert.equal(readability.actionBackground, 'rgb(255, 254, 250)', 'The renderer uses its reviewed neutral button palette.');
          assert.equal(readability.exampleBackground, readability.actionBackground);
          assert.deepEqual(readability.buttons.map(button => button.label), ['Check packet', 'Load incomplete example', 'Load corrected example'], 'Action and loaders remain distinct through explicit labels, not color.');
          assert.ok(readability.documentWidth <= readability.viewportWidth + 1, 'The isolated page must fit its width.');
          assert.ok(['check', 'incomplete', 'corrected'].some(name => bindings[name] === readability.focus.id));
          assert.equal(readability.focus.visible, true);
          assert.ok(readability.focus.outlineWidth >= 2 && !['none', 'hidden'].includes(readability.focus.outlineStyle) && readability.focus.outlineAlpha > 0, 'Keyboard focus needs a nontransparent outline.');
        });
        const announcements = { width, complete: null, repeated: null, afterEdit: null, invalid: null, focus: null };
        await observe('polite result announcements preserve focus and clear stale readiness', announcements, async () => {
          const announcer = interaction.frame.locator('body > p[role="status"][aria-label="Tool updates"]');
          await interaction.fill(CORRECTED);
          assert.equal(await interaction.check(), READY);
          announcements.complete = await announcer.textContent();
          assert.equal(announcements.complete, presentation.outputName + ': ' + READY);
          announcements.focus = await interaction.frame.evaluate(() => document.activeElement.id);
          assert.equal(announcements.focus, bindings.check);
          await interaction.frame.evaluate(() => {
            window.previewAnnouncements = [];
            const region = document.querySelector('body > p[role="status"][aria-label="Tool updates"]');
            window.previewAnnouncementObserver = new MutationObserver(() => window.previewAnnouncements.push(region.textContent));
            window.previewAnnouncementObserver.observe(region, {childList:true,characterData:true,subtree:true});
          });
          await interaction.check();
          announcements.repeated = await interaction.frame.evaluate(() => {
            window.previewAnnouncementObserver.disconnect();
            return window.previewAnnouncements;
          });
          assert.ok(announcements.repeated.includes(''));
          assert.equal(announcements.repeated.filter(text=>text===announcements.complete).length, 1);
          await interaction.fill('{');
          announcements.afterEdit = await announcer.textContent();
          assert.doesNotMatch(announcements.afterEdit, /Ready for human review|0 gaps/u);
          const invalidResult = await interaction.check();
          announcements.invalid = await announcer.textContent();
          assert.equal(announcements.invalid, presentation.outputName + ': ' + invalidResult);
          assert.match(announcements.invalid, /Input error:/u);
          assert.equal(await interaction.frame.evaluate(() => document.activeElement.id), bindings.check);
        });

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
            tool = await openTool('bridge');
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

      if (captionPreview) {
        await observe('renderer captions survive broad CSS and follow label visibility patches', { width, category: 'caption', fixtureKind: 'authored-output-label-visibility-probe' }, async () => {
          const tool = await openTool('caption');
          try {
            const caption = tool.frame.locator('[data-nebius-output-label]').filter({ hasText: 'Packet outcome' });
            const clipped = tool.frame.locator('[data-nebius-output-label]').filter({ hasText: 'Clipped outcome' });
            await tool.frame.locator('#visible-result-name').scrollIntoViewIfNeeded();
            await caption.waitFor({ state: 'hidden' });
            await clipped.waitFor({ state: 'visible' });
            assert.equal(await clipped.evaluate(element => getComputedStyle(element).display), 'block', 'Authored p display:none!important cannot suppress the renderer caption.');
            for (let iteration = 0; iteration < 2; iteration++) {
              await tool.action(() => tool.frame.locator('#hide-label').focus());
              await tool.action(() => tool.page.keyboard.press('Enter'));
              await caption.waitFor({ state: 'visible' });
              assert.equal(await caption.count(), 1);
              await tool.action(() => tool.frame.locator('#show-label').focus());
              await tool.action(() => tool.page.keyboard.press('Enter'));
              await caption.waitFor({ state: 'hidden' });
              await tool.frame.locator('#visible-result-name').waitFor({ state: 'visible' });
            }
            await tool.page.screenshot({ path: path.join(output, 'caption-visibility-' + width + '.png'), fullPage: true });
          } finally { await tool.page.close(); }
        });
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
          next: 'Review', activity: [], completionEvidence: '', executionRun: parentReference }], selectedId: parentReference.input.packId, pendingNextActionDrafts: [] };
        await context.addInitScript(({ key, seed }) => {
          if (window !== top) return;
          if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
        }, { key: storageKey, seed });
        for (const scenario of ['linked status and default view', 'switch preserves preview and dirty evidence', 'resize follows focused pane', 'hidden async completion preserves focus']) {
          const detail = { width, height, category: 'parent', case: scenario, fixtureKind: 'authored-synthetic-run-reference' };
          await observe('compiled parent: ' + scenario, detail, async () => {
            const page = await context.newPage(); page.setDefaultTimeout(5000);
            page.on('pageerror', error => pageErrors.push(scenario + ': ' + error.message));
            await page.addInitScript(({ key, seed }) => { if (window === top) localStorage.setItem(key, JSON.stringify(seed)); }, { key: storageKey, seed });
            const beforePosts = parentPosts;
            let release; const released = new Promise(resolve => { release = resolve; });
            let releaseDownload = () => {}, releaseRefresh = () => {};
            try {
              await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
              const review = page.locator('[data-nebius-run-review]');
              await review.waitFor({ state: 'visible' });
              await page.waitForFunction(() => document.activeElement?.id === 'task-tab-review');
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
              const group = review.locator('.review-view-switch');
              const previewButton = group.getByRole('button', { name: 'Preview', exact: true });
              const reviewButton = group.getByRole('button', { name: 'Review', exact: true });
              if (scenario === 'linked status and default view') {
                assert.equal(await group.isVisible(), width < 1000);
                assert.equal(await review.locator('[data-nebius-review-context]').isVisible(), true);
                assert.equal(await review.locator('[data-run-proposal]').isVisible(), width >= 1000);
                if (width < 1000) {
                  assert.equal(await reviewButton.getAttribute('aria-pressed'), 'true');
                  assert.equal(await previewButton.getAttribute('aria-pressed'), 'false');
                  assert.equal(await group.getByRole('tab').count(), 0, 'Views use ordinary native buttons, not document tabs.');
                  for (const button of [previewButton, reviewButton]) {
                    assert.equal(await button.evaluate(element => element.tagName), 'BUTTON');
                    const ids = (await button.getAttribute('aria-controls')).split(' ');
                    assert(ids.length > 0);
                    for (const id of ids) assert.equal(await review.locator('[id="' + id + '"]').count(), 1);
                  }
                }
                assert.deepEqual(await review.locator('[data-review-section-link]').evaluateAll(links => links.map(link => link.dataset.reviewSectionLink)), ['proposal', 'request', 'evidence', 'decision']);
                for (const target of ['proposal', 'request', 'evidence', 'decision', 'decision']) {
                  const link = review.locator('[data-review-section-link="' + target + '"]');
                  await link.press('Enter');
                  const id = (await link.getAttribute('href')).slice(1);
                  const section = review.locator('[id="' + id + '"]');
                  await section.waitFor({ state: 'visible' });
                  await page.waitForFunction(id => document.activeElement?.id === id + '-title', id);
                  assert.equal(decodeURIComponent(new URL(page.url()).hash.slice(1)), id);
                  assert.equal(await section.locator(':scope > h3').evaluate(element => element === document.activeElement), true);
                }
                assert.equal(await review.locator('iframe').count(), 0, 'Reading status links cannot start the tool.');
                assert.equal(parentPosts, beforePosts);
              } else if (scenario === 'switch preserves preview and dirty evidence') {
                await page.evaluate(() => {
                  window.reviewScrollEvents = [];
                  addEventListener('scroll', event => {
                    if (window.reviewScrollEvents.length >= 80) return;
                    const body = document.querySelector('[data-review-body]');
                    if (!body) return;
                    const target = event.target instanceof Element ? event.target : null;
                    window.reviewScrollEvents.push({ y: scrollY, bodyTop: body.getBoundingClientRect().top + scrollY,
                      view: document.querySelector('.review-view-switch [aria-pressed="true"]')?.textContent,
                      target: target ? { tag: target.tagName, id: target.id, className: target.className, scrollTop: target.scrollTop, overflow: getComputedStyle(target).overflowY } : 'document' });
                  }, true);
                });
                // Exercise switching at every original viewport, including a
                // wide-to-narrow transition for the desktop observation.
                if (width >= 1000) await page.setViewportSize({ width: 900, height });
                await group.waitFor({ state: 'visible' });
                const switchGeometry = () => group.evaluate(element => {
                  const bounds = node => { const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; };
                  const ancestors = [];
                  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                    const style = getComputedStyle(parent);
                    ancestors.push({ tag: parent.tagName, id: parent.id, className: parent.className, ...bounds(parent),
                      scrollTop: parent.scrollTop, scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight,
                      overflowX: style.overflowX, overflowY: style.overflowY, position: style.position });
                  }
                  return { hash: location.hash, y: scrollY, ...bounds(element), ancestors };
                });
                detail.initialSwitchGeometry = await switchGeometry();
                await showReviewView(review, 'preview');
                await review.getByRole('button', { name: 'Try your tool', exact: true }).press('Enter');
                await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
                const frame = page.frames().find(item => item.url() === origin + parentPreviewPath);
                assert(frame);
                await frame.locator('#packet').fill(CORRECTED);
                await frame.locator('#check-packet').press('Enter');
                await frame.locator('#result').filter({ hasText: READY }).waitFor();
                await frame.locator('#packet').focus();
                await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
                const toolCaret = await frame.locator('#packet').evaluate(element => [element.selectionStart, element.selectionEnd]);
                assert.equal(await frame.locator('#packet').evaluate(element => element === document.activeElement), true, 'The actual tool input owns focus before changing views.');
                await page.evaluate(() => { window.persistentReviewFrame = document.querySelector('[data-nebius-run-review] iframe'); window.persistentReviewWindow = window.persistentReviewFrame.contentWindow; });
                detail.initialIframeFocus = await page.evaluate(() => document.activeElement === window.persistentReviewFrame);
                assert.equal(detail.initialIframeFocus, true, 'The native tool field owns focus before changing views.');
                const offset = () => review.locator('[data-review-body]').evaluate(element => window.scrollY - (element.getBoundingClientRect().top + window.scrollY));
                const previewReadingOffset = await offset();
                detail.initialReviewEntryGeometry = await switchGeometry();
                await showReviewView(review, 'review');
                const recording = review.locator('#nebius-evidence-recording');
                if (!await recording.evaluate(element => element.open)) await recording.locator(':scope > summary').press('Enter');
                const evidence = recording.getByLabel('Evidence supplied by you', { exact: true });
                await evidence.evaluate(element => { window.persistentReviewEvidence = element; });
                const dirty = 'Unsaved authored local evidence. No provider operation.';
                await evidence.fill(dirty);
                await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
                const caret = await evidence.evaluate(element => [element.selectionStart, element.selectionEnd]);
                detail.initialEvidenceFocus = await evidence.evaluate(element => element === document.activeElement);
                assert.equal(detail.initialEvidenceFocus, true, 'The edited evidence field owns focus before testing switch restoration.');
                const beforeWheelOffset = await offset();
                await page.mouse.wheel(0, -90);
                await page.waitForTimeout(100);
                const readingOffset = await offset();
                assert(Math.abs(readingOffset - beforeWheelOffset) > 1, 'Native wheel input actually changes the Review reading position before testing restoration.');
                detail.readingOffsets = { preview: previewReadingOffset, reviewBeforeWheel: beforeWheelOffset, review: readingOffset };
                detail.switches = [];
                for (let count = 0; count < 2; count++) {
                  const switched = { iteration: count + 1 };
                  detail.switches.push(switched);
                  switched.beforePreview = await switchGeometry();
                  await previewButton.click();
                  try {
                    await page.waitForFunction(() => document.activeElement === window.persistentReviewFrame);
                    await frame.waitForFunction(() => document.activeElement?.id === 'packet');
                  }
                  finally {
                    detail.returnedPreviewFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.slice(0, 80), iframeFocused: document.activeElement === window.persistentReviewFrame }));
                    detail.returnedChildFocus = await frame.evaluate(() => {
                      const input = document.getElementById('packet');
                      return { tag: document.activeElement?.tagName, id: document.activeElement?.id,
                        documentFocused: document.hasFocus(), caret: [input.selectionStart, input.selectionEnd], input: input.value, output: document.getElementById('result').textContent };
                    });
                    switched.previewOffset = await offset();
                    switched.frameBounds = await review.locator('iframe').evaluate(element => {
                      const rect = element.getBoundingClientRect();
                      return { top: rect.top, bottom: rect.bottom, viewport: innerHeight };
                    });
                  }
                  assert.equal(await page.evaluate(() => document.activeElement === window.persistentReviewFrame), true, 'Returning to Preview restores the iframe focus.');
                  assert.equal(await frame.locator('#packet').evaluate(element => element === document.activeElement), true);
                  assert.deepEqual(await frame.locator('#packet').evaluate(element => [element.selectionStart, element.selectionEnd]), toolCaret);
                  assert(Math.abs(await offset() - previewReadingOffset) <= 2, 'Returning to Preview preserves its relative reading position.');
                  assert.equal(await frame.locator('#packet').inputValue(), CORRECTED);
                  assert.equal(await frame.locator('#result').textContent(), READY);
                  switched.beforeReview = await switchGeometry();
                  await reviewButton.click();
                  await page.waitForFunction(() => document.activeElement === window.persistentReviewEvidence);
                  switched.reviewOffset = await offset();
                  assert.equal(await evidence.evaluate(element => element === document.activeElement), true, 'Returning to Review restores the edited field.');
                  assert.deepEqual(await evidence.evaluate(element => [element.selectionStart, element.selectionEnd]), caret);
                  assert.equal(await evidence.inputValue(), dirty);
                  assert(Math.abs(await offset() - readingOffset) <= 2, 'Returning to Review preserves its relative reading position.');
                  assert.equal(await page.evaluate(() => window.persistentReviewFrame === document.querySelector('[data-nebius-run-review] iframe') && window.persistentReviewWindow === window.persistentReviewFrame.contentWindow), true);
                }
                assert.equal(parentPosts, beforePosts + 1, 'Switches neither reopen the preview nor request another operation.');
              } else if (scenario === 'resize follows focused pane') {
                await page.setViewportSize({ width: 1280, height });
                await group.waitFor({ state: 'hidden' });
                await review.getByRole('button', { name: 'Try your tool', exact: true }).focus();
                await page.setViewportSize({ width: 900, height });
                await group.waitFor({ state: 'visible' });
                await review.locator('[data-run-proposal]').waitFor({ state: 'visible' });
                assert.equal(await previewButton.getAttribute('aria-pressed'), 'true');
                assert.equal(await review.getByRole('button', { name: 'Try your tool', exact: true }).evaluate(element => element === document.activeElement), true);
                await page.setViewportSize({ width: 1280, height });
                await group.waitFor({ state: 'hidden' });
                const summary = review.locator('[data-current-full-brief] > summary');
                await summary.waitFor({ state: 'visible' });
                await summary.focus();
                await page.setViewportSize({ width: 900, height });
                await group.waitFor({ state: 'visible' });
                await review.locator('[data-nebius-review-context]').waitFor({ state: 'visible' });
                assert.equal(await reviewButton.getAttribute('aria-pressed'), 'true');
                assert.equal(await summary.evaluate(element => element === document.activeElement), true);
                assert.equal(parentPosts, beforePosts);
              } else {
                await page.setViewportSize({ width: 900, height });
                await group.waitFor({ state: 'visible' });
                await page.route(origin + parentPreviewPath, async route => { await released; await route.continue(); });
                await showReviewView(review, 'preview');
                await Promise.all([
                  page.waitForRequest(request => request.url() === origin + parentPreviewPath && request.method() === 'POST'),
                  review.getByRole('button', { name: 'Try your tool', exact: true }).press('Enter'),
                ]);
                await showReviewView(review, 'review');
                const summary = review.locator('[data-current-full-brief] > summary');
                await summary.focus();
                release();
                await page.waitForFunction(() => document.querySelector('.run-preview-label')?.textContent.includes('Preview running'));
                assert.equal(await summary.evaluate(element => element === document.activeElement), true, 'Preview completion cannot steal focus into the hidden pane.');
                assert.equal(await review.locator('[data-run-proposal]').isVisible(), false);
                assert.equal(await reviewButton.getAttribute('aria-pressed'), 'true');
                assert.equal(parentPosts, beforePosts + 1);
                await page.unroute(origin + parentPreviewPath);
                const downloadReleased = new Promise(resolve => { releaseDownload = resolve; });
                await page.route(origin + parentPreviewPath, async route => {
                  assert.equal(route.request().method(), 'POST');
                  assert.equal(new URLSearchParams(route.request().postData()).get('key'), parentReference.key);
                  await downloadReleased;
                  await route.fulfill({ status: 200, contentType: 'text/html;charset=utf-8', body: preview.html });
                });
                await showReviewView(review, 'preview');
                const downloaded = page.waitForEvent('download');
                await Promise.all([
                  page.waitForRequest(request => request.url() === origin + parentPreviewPath && request.method() === 'POST'),
                  review.getByRole('button', { name: 'Download tool', exact: true }).press('Enter'),
                ]);
                await showReviewView(review, 'review');
                await summary.focus();
                releaseDownload();
                assert.equal((await downloaded).suggestedFilename(), 'tool.html');
                await page.waitForFunction(() => [...document.querySelectorAll('[data-run-try] button')].some(button => button.textContent.trim() === 'Download tool' && !button.disabled));
                assert.equal(await summary.evaluate(element => element === document.activeElement), true, 'A completed download cannot restore focus into its hidden pane.');
                assert.equal(await review.locator('[data-run-proposal]').isVisible(), false);

                const refreshReleased = new Promise(resolve => { releaseRefresh = resolve; });
                await page.route(origin + '/api/nebius/runs/' + parentReference.id, async route => {
                  assert.equal(route.request().method(), 'GET');
                  assert.equal(route.request().headers().authorization, 'Bearer ' + parentReference.key);
                  await refreshReleased;
                  await route.fulfill({ status: 404, json: { code: 'missing_run', error: 'Authored hidden refresh failure fixture.' } });
                });
                await Promise.all([
                  page.waitForRequest(request => request.url() === origin + '/api/nebius/runs/' + parentReference.id && request.method() === 'GET'),
                  review.getByRole('button', { name: 'Refresh saved run', exact: true }).press('Enter'),
                ]);
                await showReviewView(review, 'preview');
                const close = review.getByRole('button', { name: 'Close preview', exact: true });
                await close.focus();
                releaseRefresh();
                await review.getByText('Authored hidden refresh failure fixture.', { exact: true }).waitFor();
                assert.equal(await close.evaluate(element => element === document.activeElement), true, 'A completed refresh cannot restore focus into its hidden pane.');
                assert.equal(await review.locator('[data-nebius-review-context]').isVisible(), false);
                detail.hiddenAsyncActions = ['preview', 'download', 'failed refresh'];
              }
              assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), saved, 'Reading, switching, resizing and preview completion preserve the exact saved workspace.');
              detail.savedWorkspaceUnchanged = true;
            } finally {
              if (scenario === 'switch preserves preview and dirty evidence') detail.scrollEvents = await page.evaluate(() => window.reviewScrollEvents || []).catch(() => []);
              release(); releaseDownload(); releaseRefresh(); await page.close();
            }
          });
        }
        for (const scenario of ['focused layout and context', 'recorded build history', 'missing focused id', 'ambiguous focused id']) {
          await observe('compiled parent: ' + scenario, { width, category: 'parent', case: scenario, fixtureKind: 'authored-synthetic-run-reference' }, async () => {
            const page = await context.newPage(); page.setDefaultTimeout(5000);
            page.on('pageerror', error => pageErrors.push(scenario + ': ' + error.message));
            const workspaceSeed = structuredClone(seed);
            if (scenario === 'recorded build history') workspaceSeed.packs[0].executionRun.record.events = [
              { at: parentReference.record.createdAt, message: 'Synthetic first response rejected.' },
              { at: parentReference.record.updatedAt, message: 'Synthetic repaired source checked.' },
            ];
            workspaceSeed.packs.push({ id: 'fixture-unrelated-review', title: 'Unrelated review item', status: 'blocked', blocker: 'Needs fixture confirmation',
              purpose: 'An unrelated synthetic task.', doneWhen: 'The fixture is confirmed.', nextStep: 'Review the fixture.', next: 'Review', owner: 'Fixture owner', activity: [] });
            await page.addInitScript(({ key, seed }) => { if (window === top) localStorage.setItem(key, JSON.stringify(seed)); }, { key: storageKey, seed: workspaceSeed });
            const beforePosts = parentPosts;
            try {
              const query = scenario === 'missing focused id' ? 'focus=fixture-missing-run'
                : scenario === 'ambiguous focused id' ? 'focus=' + encodeURIComponent(parentReference.input.packId) + '&focus=fixture-unrelated-review'
                : 'focus=' + encodeURIComponent(parentReference.input.packId);
              await page.goto(origin + '/review?' + query);
              if (scenario === 'missing focused id' || scenario === 'ambiguous focused id') {
                const missing = scenario === 'missing focused id';
                await page.waitForURL(url => url.pathname === (missing ? '/next' : '/work'));
                if (missing) await page.getByText('Work item not found', { exact: true }).waitFor();
                else {
                  assert.equal(new URL(page.url()).searchParams.get('filter'), 'review');
                  assert.equal(new URL(page.url()).searchParams.has('focus'), false);
                }
                await page.getByRole('heading', { level: 1, name: missing ? 'Task' : 'Work', exact: true }).waitFor();
                assert.equal(await page.locator('[data-nebius-run-review]').count(), 0);
                const document = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
                assert.equal((document.state || document).selectedId, workspaceSeed.selectedId, 'Saved focus links cannot choose another task.');
                assert.equal(parentPosts, beforePosts);
                return;
              }
              await page.waitForURL(url => url.pathname === '/next' && url.searchParams.get('view') === 'review');
              const workspace = page.locator('#task-panel-review');
              const review = page.locator('[data-nebius-run-review]');
              await review.waitFor({ state: 'visible' });
              await page.getByRole('heading', { level: 1, name: 'Authored release packet checker fixture', exact: true }).waitFor();
              assert.equal(await page.locator('[data-review-list], #review-filter-query, #copy-review-summary, .review-priority-shell, .review-list-count').count(), 0, 'Focused execution excludes unrelated queue controls and counts.');

              const task = page.locator('[data-nebius-review-context]');
              assert.equal(await task.locator('[data-request-changes]').count(), 0, 'Unchanged requests do not offer a diff.');
              const disclosure = task.locator('[data-current-full-brief]');
              assert.equal(await disclosure.evaluate(element => element.open), false, 'Full request comparison starts collapsed.');
              if (scenario === 'recorded build history') {
                const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
                await review.locator('[data-run-details] > summary').press('Enter');
                const history = review.locator('[data-run-build-history]');
                await history.locator(':scope > summary').waitFor();
                assert.equal(await history.evaluate(element => element.open), false, 'Recorded history starts collapsed.');
                await history.locator(':scope > summary').press('Enter');
                const text = await history.textContent();
                assert(text.includes('2 events'));
                assert(text.indexOf('Synthetic first response rejected.') < text.indexOf('Synthetic repaired source checked.'), 'Recorded events retain their original chronological order.');
                assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), saved, 'Inspecting history does not change the task or its evidence.');
                assert.equal(parentPosts, beforePosts, 'Inspecting history never requests a tool preview.');
                return;
              }
              await showReviewView(review, 'preview');
              const layout = await workspace.evaluate(element => {
                const context = element.querySelector('[data-nebius-review-context]').getBoundingClientRect();
                const tool = element.querySelector('[data-run-proposal]').getBoundingClientRect();
                return { context: { left: context.left, right: context.right, top: context.top, bottom: context.bottom, width: context.width },
                  tool: { left: tool.left, right: tool.right, top: tool.top, width: tool.width }, content: document.documentElement.scrollWidth, viewport: innerWidth };
              });
              assert.equal(await review.locator('[data-run-build-history]').count(), 0, 'A run with no recorded events has no invented history.');
              assert(layout.content <= layout.viewport + 1, 'The workspace fits the viewport.');
              if (width >= 1000) {
                assert(layout.tool.right <= layout.context.left + 1, 'The ready tool occupies the left pane and Request the right pane.');
                assert(Math.abs(layout.tool.top - layout.context.top) <= 1, 'The two panes start together.');
                assert.equal(await review.locator('[data-run-proposal]').evaluate(element => getComputedStyle(element).position), 'sticky');
              } else {
                assert.equal(await review.locator('[data-nebius-review-context]').isVisible(), false);
                assert.equal(await review.locator('[data-run-proposal]').isVisible(), true);
              }
              const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
              const tryTool = review.getByRole('button', { name: 'Try your tool', exact: true });
              if (await tryTool.evaluate(element => element === document.activeElement)) await page.keyboard.press('Shift+Tab');
              for (let count = 0; count < 80 && !await tryTool.evaluate(element => element === document.activeElement); count++) await page.keyboard.press('Tab');
              assert(await tryTool.evaluate(element => element === document.activeElement));
              await page.keyboard.press('Enter');
              await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
              await page.evaluate(() => { window.contextTogglePreview = document.querySelector('[data-nebius-run-review] iframe').contentWindow; });
              const afterOpenPosts = parentPosts;
              await showReviewView(review, 'review');
              const summary = disclosure.locator(':scope > summary');
              for (let count = 0; count < 80 && !await summary.evaluate(element => element === document.activeElement); count++) await page.keyboard.press('Shift+Tab');
              assert(await summary.evaluate(element => element === document.activeElement), 'Current task context is reachable by native keyboard navigation.');
              await page.keyboard.press('Enter');
              assert.equal(await disclosure.evaluate(element => element.open), true);
              await page.keyboard.press('Enter');
              assert.equal(await disclosure.evaluate(element => element.open), false);
              assert.equal(await page.evaluate(() => window.contextTogglePreview === document.querySelector('[data-nebius-run-review] iframe').contentWindow), true, 'Context changes must not replace the running preview.');
              assert.equal(parentPosts, afterOpenPosts, 'Context disclosure requests no new preview.');
              assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), saved, 'Reading context cannot save evidence or complete work.');
              await page.screenshot({ path: path.join(output, 'task-workspace-' + width + '.png'), fullPage: true });
            } finally { await page.close(); }
          });
        }
        for (const scenario of ['later Worker failure', 'reopen running preview', 'close restores keyboard focus']) {
          const detail = { width, category: 'parent', case: scenario, fixtureKind: 'authored-synthetic-run-reference',
            actualParentStatus: null, actualChildStatus: null, newFrame: null, restoredFocus: null };
          let page, frame;
          await observe('compiled parent: ' + scenario, detail, async () => {
            page = await context.newPage(); page.setDefaultTimeout(4000);
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
            const review = page.locator('[data-nebius-run-review]');
            const button = review.getByRole('button', { name: 'Try your tool', exact: true, includeHidden: true });
            await review.waitFor({ state: 'visible' });
            assert.equal(await review.getByRole('heading', { level: 2 }).textContent(), 'Review this build', 'The result has one concise action heading below the task title.');
            await review.locator('[data-run-details] > summary').click();
            assert.deepEqual(await review.locator('.run-files details > summary').allTextContents(), parentReference.record.files.map(file => file.path), 'Run details preserve the actual retained files.');
            assert.match(await review.locator('[data-run-evidence-explanation]').innerText(), /No live Sandbox execution/);
            assert.match(await review.locator('[data-run-evidence-explanation]').innerText(), /sample runs/);
            await review.locator('[data-run-details] > summary').click();
            assert.equal(await review.locator('.run-artifact-title h3').count(), 0, 'The artifact does not repeat the task title in a nested heading.');
            assert.equal(await review.locator('.run-details-counts').textContent(), 'Sample counts · 1 model call · 1 Sandbox result · 3 files', 'The collapsed counts identify sample provenance and preserve every denominator.');
            assert.equal(await button.evaluate(element => element.classList.contains('is-primary')), true, 'Trying the current tool is the primary action.');
            assert.equal(await review.getByRole('button', { name: 'Use run as evidence', exact: true }).evaluate(element => element.classList.contains('is-primary')), false, 'Saving a run is a separate secondary action.');
            assert.equal(await review.locator('[data-run-try]').evaluate(element => {
              const details = ['.run-review-facts', '.run-checks', '.run-files'];
              return details.every(selector => Boolean(element.compareDocumentPosition(element.closest('[data-nebius-run-review]').querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING));
            }), true, 'Trying the tool comes before usage, checks and source.');
            const disclosure = review.locator('[data-run-details]');
            assert.equal(await disclosure.count(), 1, 'One disclosure owns run metadata, checks and source.');
            assert.equal(await disclosure.evaluate(element => element.open), false, 'Technical details start collapsed.');
            assert.equal(await review.locator('[data-run-canvas]').evaluate(element =>
              Boolean(element.compareDocumentPosition(element.closest('[data-nebius-run-review]').querySelector('[data-run-details]')) & Node.DOCUMENT_POSITION_FOLLOWING)),
              true, 'The artifact canvas precedes technical details.');
            const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
            await showReviewView(review, 'preview');
            if (await button.evaluate(element => element === document.activeElement)) await page.keyboard.press('Shift+Tab');
            for (let count = 0; count < 100 && !await button.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
            assert.equal(await button.evaluate(element => element === document.activeElement), true, 'Try your tool is reachable by real Tab navigation.');
            await page.keyboard.press('Enter');
            await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
            assert.equal(await review.locator('.run-artifact-intro .run-preview-label').count(), 1, 'The status and tool actions share one toolbar.');
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
        for (const scenario of ['refresh restores focus', 'failed refresh restores focus', 'refresh preserves moved focus']) {
          const detail = { width, category: 'parent', case: scenario, fixtureKind: 'authored-synthetic-run-reference',
            refreshRequests: [], focusPreserved: null, taskFieldsUnchanged: null,
            documentHasFocusAtActivation: null, documentHasFocusAfter: null };
          await observe('compiled parent: ' + scenario, detail, async () => {
            const page = await context.newPage(); page.setDefaultTimeout(4000);
            page.on('pageerror', error => pageErrors.push(error.message));
            let releaseRefresh;
            const refreshReleased = new Promise(resolve => { releaseRefresh = resolve; });
            try {
              await page.route(origin + '/api/nebius/runs/' + parentReference.id, async route => {
                const request = route.request();
                detail.refreshRequests.push({ method: request.method(),
                  correctKey: request.headers().authorization === 'Bearer ' + parentReference.key,
                  correctFormat: request.headers()['x-nebius-run-format'] === RUN_RECORD_FORMAT });
                await refreshReleased;
                const failed = scenario === 'failed refresh restores focus';
                await route.fulfill({ status: failed ? 404 : 200, contentType: 'application/json',
                  body: JSON.stringify(failed ? { code: 'missing_run', error: 'Authored refresh failure fixture.' } : { run: parentReference.record }) });
              });
              await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
              const review = page.locator('[data-nebius-run-review]');
              await review.waitFor({ state: 'visible' });
              const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
              const taskBefore = (saved.state || saved).packs.find(pack => pack.id === parentReference.input.packId);
              const refresh = review.getByRole('button', { name: 'Refresh saved run', exact: true });
              // The real component intentionally restores focus only while its
              // document is foreground. Native keyboard assertions need that
              // precondition; a background page must not steal focus.
              await page.bringToFront();
              await page.waitForFunction(() => document.hasFocus());
              detail.documentHasFocusAtActivation = await page.evaluate(() => document.hasFocus());
              for (let count = 0; count < 100 && !await refresh.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
              assert.equal(await refresh.evaluate(element => element === document.activeElement), true, 'Refresh is reachable through native Tab navigation.');
              await Promise.all([
                page.waitForRequest(request => request.url() === origin + '/api/nebius/runs/' + parentReference.id && request.method() === 'GET', { timeout: 4000 }),
                page.keyboard.press('Enter'),
              ]);
              const busy = review.getByRole('button', { name: 'Refreshing…', exact: true });
              assert.equal(await busy.isDisabled(), true, 'The request must be pending before observing focus changes.');
              if (scenario === 'refresh preserves moved focus') {
                await page.keyboard.press('Tab');
                assert.equal(await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== document.documentElement && !document.activeElement.disabled), true, 'Native Tab moves to another usable control while refresh is pending.');
                await page.evaluate(() => { window.refreshUserFocus = document.activeElement; });
              }
              releaseRefresh();
              await refresh.waitFor({ state: 'visible' });
              assert.equal(await refresh.isEnabled(), true);
              if (scenario === 'failed refresh restores focus') await review.getByText('Authored refresh failure fixture.', { exact: true }).waitFor();
              if (scenario === 'refresh preserves moved focus') {
                detail.focusPreserved = await page.evaluate(() => document.activeElement === window.refreshUserFocus);
                assert.equal(detail.focusPreserved, true, 'Completing refresh must not steal focus from another control.');
              } else {
                await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-nebius-run-review] button'))
                  .some(button => button.textContent.trim() === 'Refresh saved run' && button === document.activeElement));
                detail.focusPreserved = await refresh.evaluate(element => element === document.activeElement);
                assert.equal(detail.focusPreserved, true, 'Refresh restores its activating button after temporarily disabling it.');
              }
              assert.deepEqual(detail.refreshRequests, [{ method: 'GET', correctKey: true, correctFormat: true }]);
              const next = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
              const taskAfter = (next.state || next).packs.find(pack => pack.id === parentReference.input.packId);
              for (const field of ['status', 'completionEvidence', 'activity', 'completionReceipt', 'completedAt']) assert.deepEqual(taskAfter[field] ?? null, taskBefore[field] ?? null, 'Refresh cannot alter task field ' + field);
              assert.equal(taskAfter.executionRun.id, parentReference.id);
              assert.equal(taskAfter.executionRun.record.status, 'ready');
              detail.taskFieldsUnchanged = true;
            } finally {
              detail.documentHasFocusAfter = await page.evaluate(() => document.hasFocus()).catch(() => null);
              releaseRefresh(); await page.close();
            }
          });
        }
        for (const scenario of ['download restores focus', 'failed download restores focus', 'download preserves moved focus', 'save restores focus']) {
          const detail = { width, category: 'parent', case: scenario, fixtureKind: 'authored-synthetic-run-reference', focusPreserved: null };
          await observe('compiled parent: ' + scenario, detail, async () => {
            const page = await context.newPage(); page.setDefaultTimeout(4000);
            page.on('pageerror', error => pageErrors.push(error.message));
            let release; const released = new Promise(resolve => { release = resolve; });
            const saving = scenario === 'save restores focus';
            try {
              if (!saving) await page.route(origin + parentPreviewPath, async route => {
                const request = route.request(); assert.equal(request.method(), 'POST');
                assert.equal(new URLSearchParams(request.postData()).get('key'), parentReference.key);
                await released;
                const failed = scenario === 'failed download restores focus';
                await route.fulfill(failed
                  ? { status: 404, json: { code: 'missing_run', error: 'Authored download failure fixture.' } }
                  : { status: 200, contentType: 'text/html;charset=utf-8', body: preview.html });
              });
              await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
              const review = page.locator('[data-nebius-run-review]');
              const name = saving ? 'Use run as evidence' : 'Download tool';
              const button = review.getByRole('button', { name, exact: true });
              await page.waitForFunction(() => document.activeElement?.id === 'task-tab-review');
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              await showReviewView(review, saving ? 'review' : 'preview');
              await button.waitFor({ state: 'visible' });
              if (saving) {
                await showReviewView(review, 'preview');
                await review.getByRole('button', { name: 'Try your tool', exact: true }).click();
                await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
                await page.evaluate(() => { window.savedActionFrame = document.querySelector('[data-nebius-run-review] iframe').contentWindow; });
                await showReviewView(review, 'review');
              }
              detail.phase = 'reach-action';
              for (let count = 0; count < 100 && !await button.evaluate(element => element === document.activeElement); count++) await page.keyboard.press('Tab');
              assert.equal(await button.evaluate(element => element === document.activeElement), true);
              await button.evaluate(element => { window.originalActionButton = element; });
              const download = !saving && scenario !== 'failed download restores focus' ? page.waitForEvent('download') : null;
              detail.phase = 'activate-action';
              await page.keyboard.press('Enter');
              if (!saving) {
                await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-nebius-run-review] button')).some(button => button.textContent.trim() === 'Downloading…'));
                if (scenario === 'download preserves moved focus') {
                  await page.keyboard.press('Tab');
                  assert.equal(await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== document.documentElement && !document.activeElement.disabled), true);
                  await page.evaluate(() => { window.actionMovedFocus = document.activeElement; });
                }
                release();
                if (download) assert.equal((await download).suggestedFilename(), 'tool.html');
                if (scenario === 'failed download restores focus') await review.getByText('Authored download failure fixture.', { exact: true }).waitFor();
              } else {
                await review.getByText('Run evidence saved. The task remains open.', { exact: true }).waitFor();
                const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
                const pack = (saved.state || saved).packs.find(pack => pack.id === parentReference.input.packId);
                assert.equal(pack.status, 'active'); assert(pack.completionEvidence.includes(parentReference.id));
                assert.equal(await review.locator('iframe').count(), 1, 'Saving unchanged run evidence preserves the verified preview.');
                assert.equal(await page.evaluate(() => document.querySelector('[data-nebius-run-review] iframe').contentWindow === window.savedActionFrame), true);
              }
              await page.waitForFunction(name => Array.from(document.querySelectorAll('[data-nebius-run-review] button')).some(button => button.textContent.trim() === name && !button.disabled), name);
              detail.phase = 'restore-focus';
              if (scenario === 'download preserves moved focus') {
                assert.equal(await page.evaluate(() => document.activeElement === window.actionMovedFocus), true, 'Download cannot steal moved focus.');
              } else await page.waitForFunction(name => Array.from(document.querySelectorAll('[data-nebius-run-review] button')).some(button => button.textContent.trim() === name && button === document.activeElement), name);
              detail.focusPreserved = true;
            } finally {
              detail.finalFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, id: document.activeElement?.id,
                text: document.activeElement?.textContent?.slice(0, 100), documentFocused: document.hasFocus(),
                originalConnected: Boolean(window.originalActionButton?.isConnected) })).catch(() => null);
              release(); await page.close();
            }
          });
        }
        for (const mutation of ['source', 'check-metadata', 'access-key']) {
          const detail = { width, category: 'parent', case: 'same-timestamp-' + mutation, fixtureKind: 'authored-synthetic-run-reference' };
          await observe('compiled parent: changed ' + mutation + ' invalidates the old preview', detail, async () => {
            const page = await context.newPage(); page.setDefaultTimeout(4000); let guide;
            page.on('pageerror', error => pageErrors.push(error.message));
            await page.addInitScript(({ key, seed }) => { if (window === top) localStorage.setItem(key, JSON.stringify(seed)); }, { key: storageKey, seed });
            try {
              await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
              const review = page.locator('[data-nebius-run-review]');
              await showReviewView(review, 'preview');
              await review.getByRole('button', { name: 'Try your tool', exact: true }).click();
              await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
              const document = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
              assert.equal(document.schemaVersion, 1);
              const reference = document.state.packs.find(pack => pack.id === parentReference.input.packId).executionRun;
              const unchangedId = reference.id, unchangedTime = reference.record.updatedAt;
              if (mutation === 'source') reference.record.files[0].content += '\n<!-- Authored changed source, old check digest retained. -->';
              else if (mutation === 'check-metadata') reference.record.checks[0].stdout += '\nAuthored metadata change.';
              else reference.key = '1'.repeat(64);
              assert.equal(reference.id, unchangedId); assert.equal(reference.record.updatedAt, unchangedTime);
              // Exercise the real backup/import owner in another tab, then
              // the existing stale-save conflict path. That installs the
              // latest workspace in this mounted Review without a reload.
              guide = await context.newPage(); guide.setDefaultTimeout(4000);
              await guide.goto(origin + '/work?menu=backup');
              await guide.getByRole('dialog', { name: 'Work menu', exact: true }).waitFor();
              await guide.locator('input[type="file"]').setInputFiles({ name: 'authored-change.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
              await guide.getByText(/Preview:.*1 work items/u).waitFor();
              await guide.getByRole('button', { name: 'Replace', exact: true }).click();
              await guide.getByRole('button', { name: 'Confirm replace', exact: true }).click();
              await guide.locator('#challenge-main').getByText('Workspace replaced with 1 work items.', { exact: true }).waitFor();
              const imported = await guide.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
              await page.bringToFront();
              await page.waitForFunction(() => document.hasFocus());
              await showReviewView(review, 'review');
              // Rejection can remove this activating button and its iframe in
              // the same update; native Enter avoids a mouse gesture spanning
              // that layout change while exercising the unchanged save owner.
              await review.getByRole('button', { name: 'Use run as evidence', exact: true }).press('Enter');
              await review.getByText('Workspace changed by another tab. Refresh this tab and try again.', { exact: true }).waitFor();
              await review.locator('iframe').waitFor({ state: 'detached' });
              if (mutation === 'source') {
                await review.getByText('The generated files do not match the source that was checked.', { exact: true }).waitFor();
                assert.equal(await review.getByRole('button', { name: 'Try your tool', exact: true, includeHidden: true }).count(), 0);
                assert.equal(await review.getByRole('button', { name: 'Use run as evidence', exact: true, includeHidden: true }).count(), 0);
              } else {
                await showReviewView(review, 'preview');
                await review.getByRole('button', { name: 'Try your tool', exact: true }).waitFor({ state: 'visible' });
              }
              assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), imported,
                'The conflicting save must preserve the imported workspace without adding stale evidence.');
              detail.previewClosed = true; detail.sameIdAndTimestamp = true; detail.sourceIntegrityRejected = mutation === 'source';
              detail.conflictingSaveRejected = true; detail.importedWorkspacePreserved = true;
            } finally { await guide?.close(); await page.close(); }
          });
        }
        const rejectedDetail = { width, category: 'parent', case: 'rejected-source-history', fixtureKind: 'authored-synthetic-run-reference', layout: null, clippingRegressionDetected: null };
        await observe('compiled parent: rejected generation remains inert, contained and keyboard readable', rejectedDetail, async () => {
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
            assert.equal(await page.getByText('Generated tool', { exact: true }).count(), 0, 'Rejected source must not acquire generated-tool page framing.');
            await review.getByRole('heading', { level: 2, name: 'Review this build', exact: true }).waitFor();
            // Task settles Review-tab focus over two animation frames. Begin
            // the keyboard proof after that owner finishes, not during it.
            await page.waitForFunction(() => document.activeElement?.id === 'task-tab-review');
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const runSummary = review.locator('[data-run-details] > summary');
            for (let count = 0; count < 120 && !await runSummary.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
            assert.equal(await runSummary.evaluate(element => element === document.activeElement), true, 'Run details is keyboard reachable after route arrival.');
            await page.keyboard.press('Enter');
            await history.waitFor({ state: 'visible' });
            const summary = history.locator(':scope > summary');
            for (let count = 0; count < 120 && !await summary.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
            assert.equal(await summary.evaluate(element => element === document.activeElement), true, 'Generation history is keyboard reachable after opening Run details.');
            await page.keyboard.press('Enter');
            await history.locator('details > summary').focus(); await page.keyboard.press('Enter');
            assert.equal(await history.locator('pre').textContent(), raw);
            assert.equal(await review.locator('#injected-generation, iframe').count(), 0);
            assert.equal(await page.evaluate(() => Boolean(window.generationInjected)), false);
            assert.equal(await review.getByRole('button', { name: 'Try your tool', exact: true, includeHidden: true }).count(), 0);
            assert.equal(await review.getByRole('button', { name: 'Use run as evidence', exact: true, includeHidden: true }).count(), 0);
            // Document scrollWidth alone misses clipped children when an ancestor
            // hides overflow. Measure the actual compiled card and its contents.
            const measure = () => review.evaluate(card => {
              const bounds = element => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right, height: rect.height };
              };
              const box = bounds(card), style = getComputedStyle(card);
              const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
              const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
              const elements = [...new Set([...card.children, ...card.querySelectorAll('.run-review-head > *, .worn-alert, .worn-alert *, .review-step > *, .review-step pre')])];
              const violations = elements.filter(element => element.getClientRects().length).flatMap(element => {
                const rect = bounds(element);
                return rect.left < left - 1 || rect.right > right + 1
                  ? [{ element: element.className || element.tagName, ...rect }] : [];
              });
              const badge = card.querySelector('.run-review-head .worn-badge');
              if (!badge) throw new Error('The actual status badge must be present.');
              return { card: box, content: { left, right }, viewport: document.documentElement.clientWidth,
                badge: { ...bounds(badge), text: badge.textContent.trim(), lineHeight: parseFloat(getComputedStyle(badge).lineHeight) }, violations };
            });
            rejectedDetail.layout = await measure();
            assert.deepEqual(rejectedDetail.layout.violations, [], 'Every visible card child, alert and heading must fit inside the card padding.');
            assert.ok(rejectedDetail.layout.card.left >= -1 && rejectedDetail.layout.card.right <= rejectedDetail.layout.viewport + 1);
            assert.equal(rejectedDetail.layout.badge.text, 'Run failed');
            assert.ok(rejectedDetail.layout.badge.height < 2 * rejectedDetail.layout.badge.lineHeight, 'The status label stays on one line.');
            if (width === 375) {
              // Force the actual retained-response block beyond the card in
              // this synthetic page. The geometry detector must reject it.
              const responseBlock = review.locator('pre').first();
              const originalStyle = await responseBlock.getAttribute('style');
              const overflowWidth = await review.evaluate(card => card.getBoundingClientRect().width + 128);
              await responseBlock.evaluate((element, width) => {
                element.style.minWidth = width + 'px'; element.style.width = width + 'px'; element.style.whiteSpace = 'pre';
              }, overflowWidth);
              try {
                const regressed = await measure();
                rejectedDetail.clippingRegressionDetected = regressed.violations.length > 0;
                assert.equal(rejectedDetail.clippingRegressionDetected, true, 'Removing containment must reproduce detectable child overflow.');
              } finally { await responseBlock.evaluate((element, style) => {
                if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style);
              }, originalStyle); }
            }
            await review.screenshot({ path: path.join(output, 'rejected-source-history-' + width + '.png') });
          } finally { await page.close(); }
        });
        for (const scenario of ['unknown-start', 'uncertain-result']) {
          const detail = { width, category: 'parent', case: scenario, fixtureKind: 'authored-synthetic-run-reference',
            actualStatus: null, keyboardReachable: null, stateUnchanged: null, previewPostsUnchanged: null, layout: null };
          await observe('compiled parent: ' + scenario + ' never offers a successful tool', detail, async () => {
            const page = await context.newPage(); page.setDefaultTimeout(4000);
            page.on('pageerror', error => pageErrors.push(error.message));
            const unknownSeed = structuredClone(seed);
            if (scenario === 'unknown-start') unknownSeed.packs[0].executionRun.record = null;
            else {
              Object.assign(unknownSeed.packs[0].executionRun.record, { status: 'uncertain', attempt: 1,
                files: [], checks: [], generationAttempts: [], failure: null,
                error: 'Authored unknown model-response fixture.',
                usage: { modelCalls: 1, inputTokens: null, outputTokens: null, totalsComplete: false } });
              await validateRunIntegrity(unknownSeed.packs[0].executionRun.record);
            }
            await page.addInitScript(({ key, seed }) => {
              if (window === top) localStorage.setItem(key, JSON.stringify(seed));
            }, { key: storageKey, seed: unknownSeed });
            const postsBefore = parentPosts;
            try {
              await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
              const review = page.locator('[data-nebius-run-review]');
              const refresh = review.getByRole('button', { name: 'Refresh saved run', exact: true });
              await refresh.waitFor({ state: 'visible' });
              assert.equal(await page.getByText('Generated tool', { exact: true }).count(), 0, 'Unknown outcomes must not acquire generated-tool page framing.');
              await review.getByRole('heading', { level: 2, name: 'Review this build', exact: true }).waitFor();
              if (scenario === 'unknown-start') {
                await review.getByText('The start response is unknown. Refresh this saved run; do not start another paid operation yet.', { exact: true }).waitFor();
              } else {
                const summary = review.locator('[data-run-details] > summary');
                for (let count = 0; count < 120 && !await summary.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
                assert.equal(await summary.evaluate(element => element === document.activeElement), true, 'Run details remains keyboard reachable.');
                await page.keyboard.press('Enter');
                await review.getByText('No identified generation response was retained for this run.', { exact: true }).waitFor();
                await review.getByText('Authored unknown model-response fixture.', { exact: true }).waitFor();
                await review.getByText('Usage is incomplete. These counts include only recorded usage; the actual total may be higher.', { exact: true }).waitFor();
                assert.equal(await review.locator('.run-review-facts > div').filter({ hasText: 'Recorded model calls' }).locator('strong').textContent(), '1');
                await review.getByText('No sandbox check result is available.', { exact: true }).waitFor();
              }
              detail.actualStatus = await review.locator('.run-review-head .worn-badge').textContent();
              assert.equal(detail.actualStatus.trim(), scenario === 'unknown-start' ? 'Result unavailable' : 'Run outcome uncertain');
              assert.equal(await review.getByRole('heading', { level: 2 }).textContent(), 'Review this build', 'An unknown outcome with no generated files must not claim a generated tool exists.');
              for (const name of ['Try your tool', 'Inspect previous tool', 'Download tool', 'Use run as evidence']) {
                assert.equal(await review.getByRole('button', { name, exact: true, includeHidden: true }).count(), 0, 'Unknown outcomes must not offer ' + name);
              }
              assert.equal(await review.locator('[data-run-try], iframe').count(), 0);
              const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
              for (let count = 0; count < 120 && !await refresh.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
              detail.keyboardReachable = await refresh.evaluate(element => element === document.activeElement);
              assert.equal(detail.keyboardReachable, true, 'The existing refresh action remains keyboard reachable without starting it.');
              detail.layout = await review.evaluate(card => {
                const box = card.getBoundingClientRect();
                return { left: box.left, right: box.right, viewport: document.documentElement.clientWidth,
                  content: document.documentElement.scrollWidth };
              });
              assert.ok(detail.layout.left >= -1 && detail.layout.right <= detail.layout.viewport + 1);
              assert.ok(detail.layout.content <= detail.layout.viewport + 1);
              detail.stateUnchanged = await page.evaluate(key => localStorage.getItem(key), storageKey) === saved;
              detail.previewPostsUnchanged = parentPosts === postsBefore;
              assert.equal(detail.stateUnchanged, true, 'Reading and focusing an unknown result never saves evidence or completes the task.');
              assert.equal(detail.previewPostsUnchanged, true, 'Unknown results never request a tool preview.');
              await review.screenshot({ path: path.join(output, scenario + '-' + width + '.png') });
            } finally { await page.close(); }
          });
        }
        await observe('compiled parent: stale result remains inspection only', { width, category: 'parent', case: 'stale', fixtureKind: 'authored-synthetic-run-reference' }, async () => {
          const page = await context.newPage(); page.setDefaultTimeout(4000);
          page.on('pageerror', error => pageErrors.push(error.message));
          const staleSeed = structuredClone(seed);
          staleSeed.packs[0].purpose += ' The current requirement has changed. '.repeat(12);
          staleSeed.packs[0].doneWhen = 'Current criteria changed after the recorded run. '.repeat(8).trim();
          await page.addInitScript(({ key, seed }) => {
            if (window === top) localStorage.setItem(key, JSON.stringify(seed));
          }, { key: storageKey, seed: staleSeed });
          try {
            await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
            const review = page.locator('[data-nebius-run-review]');
            const inspect = review.getByRole('button', { name: 'Inspect previous tool', exact: true, includeHidden: true });
            await review.waitFor({ state: 'visible' });
            assert.equal(await inspect.count(), 1, 'The retained stale action stays mounted.');
            assert.equal(await review.getByRole('button', { name: 'Try your tool', exact: true, includeHidden: true }).count(), 0);
            assert.equal(await inspect.evaluate(element => element.classList.contains('is-primary')), false, 'A stale tool is never the primary current-result action');
            assert.equal(await review.getByRole('button', { name: 'Use run as evidence', exact: true }).isDisabled(), true);
            await review.getByText('The task details have changed since this run started. You can inspect the result, but it cannot be saved as current evidence.', { exact: true }).waitFor();
            const currentContext = page.locator('[data-nebius-review-context]');
            const changes = currentContext.locator('[data-request-changes]');
            const beforeDiff = await page.evaluate(key => localStorage.getItem(key), storageKey);
            assert.equal(await changes.evaluate(element => element.open), false, 'The compact diff starts closed.');
            assert.equal(await changes.locator('[data-request-inline-diff]').count(), 0, 'Inline comparison is not mounted before disclosure.');
            await changes.locator(':scope > summary').press('Enter');
            assert.deepEqual(await changes.locator('[data-request-change]').evaluateAll(elements => elements.map(element => element.dataset.requestChange)), ['purpose', 'doneWhen'], 'Only revised request fields appear.');
            for (const field of ['purpose', 'doneWhen']) {
              const entry = changes.locator('[data-request-change="' + field + '"]');
              await entry.locator('[data-request-inline-diff]').waitFor();
              const originals = entry.locator('[data-diff-originals]');
              await originals.locator('summary').press('Enter');
              assert.deepEqual(await entry.locator('dd').allTextContents(), [parentReference.record.pack[field], staleSeed.packs[0][field]], 'Saved and current values remain exact.');
              assert.deepEqual(await entry.locator('dt').allTextContents(), ['Saved request', 'Current task']);
              assert.equal(await originals.locator('summary').evaluate(element => element === document.activeElement), true, 'Full-text disclosure keeps keyboard focus.');
              await originals.locator('summary').press('Enter');
            }
            assert((await changes.locator('[data-diff-kind="added"]').allTextContents()).some(text => text.includes('[+ Added]')), 'Additions have a visible non-color cue.');
            assert((await changes.locator('[data-diff-kind="removed"]').allTextContents()).some(text => text.includes('[− Removed]')), 'Removals have a visible non-color cue.');
            for (const theme of ['neutral-light', 'neutral-dark', 'original-light', 'original-dark']) {
              await page.locator('[data-appearance-trigger]').press('Enter');
              await page.locator(`input[name="appearance-palette"][value="${theme.split('-')[0]}"]`).check();
              await page.locator(`input[name="appearance-mode"][value="${theme.split('-')[1]}"]`).check();
              assert.equal(await page.locator('html').getAttribute('data-theme-choice'), theme);
              await page.keyboard.press('Escape');
              progress("settle", "stale request palette: " + theme, { width, category: "parent" });
              // Arbitrary evaluate promises are not bounded by locator timeouts.
              // Preserve normal motion and fail instead of sampling mid-transition.
              await page.waitForFunction(() => document.getAnimations()
                .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
                .every(animation => animation.playState === "finished"), undefined, { timeout: 4000 });
              progress("settled", "stale request palette: " + theme, { width, category: "parent" });
              const contrasts = await changes.locator('[data-diff-kind="added"], [data-diff-kind="removed"]').evaluateAll(elements => elements.map(element => {
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
                const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
                const parents = []; for (let node = element; node; node = node.parentElement) parents.push(node);
                for (const node of parents.reverse()) { ctx.fillStyle = getComputedStyle(node).backgroundColor; ctx.fillRect(0, 0, 1, 1); }
                const background = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
                ctx.fillStyle = getComputedStyle(element).color; ctx.fillRect(0, 0, 1, 1);
                const foreground = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
                const luminance = values => values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
                const a = luminance(background), b = luminance(foreground);
                return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
              }));
              assert(contrasts.length && contrasts.every(ratio => ratio >= 4.5), 'Diff text meets normal-text contrast in ' + theme);
              const fullTextSummary = changes.locator('[data-diff-originals] > summary').first();
              await fullTextSummary.press('Enter');
              assert.equal(await fullTextSummary.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none'), true, 'Diff disclosure has a visible keyboard focus cue.');
              await fullTextSummary.press('Enter');
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
              assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), beforeDiff);
              await changes.screenshot({ path: path.join(output, `request-diff-${theme}-${width}.png`) });
              report.diffPaletteChecks.push({ width, theme, passed: true, minimumContrast: Math.min(...contrasts), savedWorkUnchanged: true, keyboardFocus: true });
              progress("pass", "stale request palette: " + theme, { width, category: "parent" });
            }
            const diffLayout = await changes.evaluate(element => ({ width: element.scrollWidth, available: element.clientWidth }));
            assert.ok(diffLayout.width <= diffLayout.available + 1, 'Long changed text wraps inside the diff.');
            assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), beforeDiff, 'Opening the diff never changes saved work.');
            await changes.screenshot({ path: path.join(output, 'request-diff-' + width + '.png') });
            const fullBrief = currentContext.locator('[data-current-full-brief]');
            assert.equal(await fullBrief.evaluate(element => element.open), false, 'Full requirements start collapsed rather than competing with the tool.');
            await fullBrief.locator(':scope > summary').press('Enter');
            const comparedValues = await currentContext.locator('.request-fields dd').allTextContents();
            assert(comparedValues.includes(staleSeed.packs[0].doneWhen), 'The comparison retains current completion criteria.');
            assert(comparedValues.includes(parentReference.record.pack.doneWhen), 'The comparison retains the historical authorized criteria.');
            await currentContext.locator('.current-criteria > summary').press('Enter');
            assert.equal(await currentContext.locator('[data-current-full-criteria]').textContent(), staleSeed.packs[0].doneWhen, 'The full current requirements remain available through a native disclosure.');
            const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
            await showReviewView(review, 'preview');
            if (await inspect.evaluate(element => element === document.activeElement)) await page.keyboard.press('Shift+Tab');
            for (let count = 0; count < 100 && !await inspect.evaluate(element => element === document.activeElement); count += 1) await page.keyboard.press('Tab');
            assert.equal(await inspect.evaluate(element => element === document.activeElement), true);
            await page.keyboard.press('Enter');
            await review.locator('.run-preview-label').filter({ hasText: 'Preview running' }).waitFor();
            assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), saved, 'Stale inspection never saves or approves evidence');
          } finally { await page.close(); }
        });
        await observe('compiled parent: request diff distinguishes unspecified and empty requirements', { width, category: 'parent', case: 'request-format-diff', fixtureKind: 'authored-synthetic-run-reference' }, async () => {
          const page = await context.newPage(); page.setDefaultTimeout(4000);
          page.on('pageerror', error => pageErrors.push(error.message));
          const revised = structuredClone(seed);
          revised.packs[0].executionInputs = [];
          revised.packs[0].executionOutputs = [];
          await page.addInitScript(({ key, seed }) => { if (window === top) localStorage.setItem(key, JSON.stringify(seed)); }, { key: storageKey, seed: revised });
          try {
            await page.goto(origin + '/next?pack=' + encodeURIComponent(parentReference.input.packId) + '&view=review');
            const review = page.locator('[data-nebius-run-review]');
            await review.waitFor({ state: 'visible' });
            const changes = review.locator('[data-request-changes]');
            await changes.locator(':scope > summary').press('Enter');
            assert.deepEqual(await changes.locator('[data-request-change]').evaluateAll(elements => elements.map(element => element.dataset.requestChange)), ['inputs', 'outputs']);
            assert.deepEqual(await changes.locator('[data-request-change="inputs"] dd').allTextContents(), ['Not specified', 'No text inputs']);
            assert.deepEqual(await changes.locator('[data-request-change="outputs"] dd').allTextContents(), [parentReference.input.version === 'browser-tool.v3' ? 'Not specified' : 'Not declared in this historical request', 'No minimum outputs']);
            assert.equal(await review.getByRole('button', { name: 'Use run as evidence', exact: true }).isDisabled(), true);
          } finally { await page.close(); }
        });
        for (const stateOnly of ['done', 'archived']) {
          await observe('compiled parent: ' + stateOnly + ' state alone does not invent a request diff', { width, category: 'parent', case: 'request-state-only-' + stateOnly, fixtureKind: 'authored-synthetic-run-reference' }, async () => {
            const page = await context.newPage(); page.setDefaultTimeout(4000);
            page.on('pageerror', error => pageErrors.push(error.message));
            const history = structuredClone(seed);
            if (stateOnly === 'done') history.packs[0].status = 'done';
            else history.packs[0].archived = true;
            await page.addInitScript(({ key, seed }) => { if (window === top) localStorage.setItem(key, JSON.stringify(seed)); }, { key: storageKey, seed: history });
            try {
              await page.goto(origin + '/next?pack=' + encodeURIComponent(parentReference.input.packId) + '&view=review');
              const review = page.locator('[data-nebius-run-review]');
              await showReviewView(review, 'preview');
              await review.getByRole('button', { name: 'Inspect saved tool', exact: true }).waitFor();
              assert.equal(await review.locator('[data-request-changes]').count(), 0, 'State-only history does not revise request content.');
            } finally { await page.close(); }
          });
        }
        await observe('compiled parent: Work shortcuts and task views preserve run authority', { width, height, category: 'parent', case: 'work-to-review-navigation', fixtureKind: 'authored-synthetic-run-reference' }, async () => {
          const page = await context.newPage(); page.setDefaultTimeout(4000);
          page.on('pageerror', error => pageErrors.push(error.message));
          const navigationSeed = structuredClone(seed);
          const longTitle = 'Authored ' + 'Z'.repeat(180);
          navigationSeed.packs[0].title = longTitle;
          navigationSeed.packs[0].executionRun.input.pack.title = longTitle;
          navigationSeed.packs[0].executionRun.record.pack.title = longTitle;
          await page.addInitScript(({ key, seed }) => {
            if (window === top && location.pathname === '/work') localStorage.setItem(key, JSON.stringify(seed));
          }, { key: storageKey, seed: navigationSeed });
          const beforePosts = parentPosts;
          const packId = parentReference.input.packId;
          const taskBefore = structuredClone(navigationSeed.packs[0]);
          try {
            await page.goto(origin + '/work');
            let entry = page.locator('[data-nebius-work-entry]');
            const entryAction = entry.getByRole('link', { name: 'Review saved run', exact: true });
            await entryAction.waitFor();
            assert.equal(await entry.evaluate(element => {
              const box=element.getBoundingClientRect();
              return document.documentElement.scrollWidth<=innerWidth && [...element.querySelectorAll('strong,a')].every(child=>{const r=child.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right;});
            }),true,'Long task titles and the primary action fit Work.');
            await entry.screenshot({path:path.join(output,'work-task-shortcuts-'+width+'.png')});
            await entryAction.press('Enter');
            await page.waitForURL(url=>url.pathname==='/next'&&url.searchParams.get('pack')===packId&&url.searchParams.get('view')==='review');
            await page.waitForFunction(()=>document.getElementById('task-tab-review')?.getAttribute('aria-selected')==='true');
            await page.getByRole('tab',{name:'Brief',exact:true}).press('Enter');
            await page.getByRole('tab',{name:'Tool',exact:true}).press('Enter');
            assert.equal(await page.getByRole('button',{name:'Build with Nebius',exact:true}).isDisabled(),true);
            await page.getByRole('tab',{name:'Review',exact:true}).press('Enter');
            await page.getByRole('heading',{name:'Review this build',exact:true}).waitFor();
            for(const query of ['view=unknown','view=build&view=evidence','pack=another-task&view=build']) {
              await page.goto(origin+'/next?pack='+encodeURIComponent(packId)+'&'+query);
              await page.waitForFunction(()=>document.getElementById('task-tab-brief')?.getAttribute('aria-selected')==='true');
              assert.equal(await page.locator('[data-nebius-task-workspace]').getAttribute('data-pack-id'),packId);
              await page.getByRole('tab',{name:'Tool',exact:true}).press('Enter');
              assert.equal(await page.getByRole('button',{name:'Build with Nebius',exact:true}).isDisabled(),true);
            }
            const document = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
            assert.deepEqual((document.state || document).packs.find(task => task.id === packId), taskBefore, 'Navigation must preserve task facts, evidence and the saved run.');
            assert.equal(parentPosts, beforePosts, 'Navigation never opens a preview or starts a provider operation.');
          } finally { await page.close(); }
        });
        for (const scenario of ['evidence edits guard navigation and discard', 'saved evidence and explicit completion']) {
          const detail = { width, height, category: 'parent', case: scenario, fixtureKind: 'authored-synthetic-run-reference' };
          await observe('compiled parent: ' + scenario, detail, async () => {
            const page = await context.newPage(); page.setDefaultTimeout(4000);
            page.on('pageerror', error => pageErrors.push(error.message));
            const dialogs = [];
            page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
            // Seed only the authored Review entry, never the completion redirect.
            await page.addInitScript(({ key, seed }) => {
              if (window === top && location.pathname === '/review') localStorage.setItem(key, JSON.stringify(seed));
            }, { key: storageKey, seed });
            const beforePosts = parentPosts;
            try {
              await page.goto(origin + '/review?focus=' + encodeURIComponent(parentReference.input.packId));
              const review = page.locator('[data-nebius-run-review]');
              await review.getByRole('button', { name: 'Use run as evidence', exact: true }).waitFor();
              const recording = review.locator('#nebius-evidence-recording');
              if (!await recording.evaluate(element => element.open)) await recording.locator(':scope > summary').press('Enter');
              const evidence = recording.getByLabel('Evidence supplied by you', { exact: true });
              const original = await page.evaluate(key => localStorage.getItem(key), storageKey);
              const originalEvidence = await evidence.inputValue();
              const supplied = 'Authored offline browser-check evidence. No provider or Sandbox execution occurred.';
              detail.phase = 'edit-evidence';
              await evidence.fill(supplied);
              await recording.getByRole('button', { name: 'Save evidence', exact: true }).waitFor();
              assert.equal(await review.getByRole('button', { name: 'Use run as evidence', exact: true }).isDisabled(), true);
              assert.equal(await review.getByRole('button', { name: 'Refresh saved run', exact: true }).isDisabled(), true);
              assert.equal(await recording.getByRole('button', { name: 'Mark done with recorded evidence', exact: true }).count(), 0);
              if (scenario === 'evidence edits guard navigation and discard') {
                detail.phase = 'edit-task-navigation';
                await review.getByRole('link', { name: 'Edit task', exact: true }).press('Enter');
                await review.getByText('Save or discard your evidence edits before leaving.', { exact: true }).waitFor();
                await page.waitForFunction(() => document.querySelector('#nebius-evidence-recording > summary') === document.activeElement);
                assert.equal(new URL(page.url()).pathname, '/next');
                assert.equal(await evidence.inputValue(), supplied);
                assert.equal(await recording.locator(':scope > summary').evaluate(element => element === document.activeElement), true);
                detail.phase = 'request-anchor';
                await review.locator('[data-review-section-link="request"]').press('Enter');
                await page.waitForURL(url => url.hash.startsWith('#run-request-'));
                await page.waitForFunction(() => document.activeElement?.id === document.querySelector('[data-nebius-review-context] > h3')?.id);
                assert(new URL(page.url()).hash.startsWith('#run-request-'));
                detail.phase = 'decision-anchor';
                await review.locator('[data-review-section-link="decision"]').press('Enter');
                await page.waitForURL(url => url.hash.startsWith('#run-decision-'));
                await page.waitForFunction(() => document.activeElement?.id === document.querySelector('[data-run-decision] > h3')?.id);
                assert.equal(await evidence.inputValue(), supplied, 'Section navigation preserves unsaved text.');
                detail.phase = 'work-navigation';
                const workLink = page.getByRole('navigation', { name: 'Projects application navigation', exact: true }).getByRole('link', { name: 'Work', exact: true });
                if (await workLink.isVisible()) await workLink.press('Enter');
                else {
                  await page.getByRole('button', { name: 'Navigate', exact: true }).press('Enter');
                  await page.getByRole('dialog', { name: 'Commands', exact: true }).locator('[data-command-key="all-work"]').press('Enter');
                }
                await page.waitForFunction(() => document.querySelector('#nebius-evidence-recording > summary') === document.activeElement);
                await review.getByText('Save or discard your evidence edits before leaving.', { exact: true }).waitFor();
                assert.equal(new URL(page.url()).pathname, '/next', 'Route navigation is blocked while evidence is dirty.');
                detail.phase = 'discard';
                await recording.getByRole('button', { name: 'Discard evidence edits', exact: true }).press('Enter');
                await recording.getByText('Evidence edits discarded. Saved evidence is unchanged.', { exact: true }).waitFor();
                assert.equal(await evidence.inputValue(), originalEvidence);
                assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), original, 'Editing and discarding preserve the exact saved workspace.');
                assert.equal(await review.getByRole('button', { name: 'Use run as evidence', exact: true }).isDisabled(), false);
                await review.screenshot({ path: path.join(output, 'review-evidence-discard-' + width + '.png') });
                detail.discardPreservedWorkspace = true;
              } else {
                await recording.getByRole('button', { name: 'Save evidence', exact: true }).press('Enter');
                await recording.getByText('Evidence saved. The task is still open.', { exact: true }).waitFor();
                let document = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
                let task = (document.state || document).packs.find(task => task.id === parentReference.input.packId);
                assert.equal(task.status, 'active', 'Saving evidence never completes the task.');
                assert.equal(task.completionEvidence, supplied);
                assert.deepEqual(task.executionRun, parentReference, 'Manual evidence cannot rewrite the saved run.');
                const done = recording.getByRole('button', { name: 'Mark done with recorded evidence', exact: true });
                await Promise.all([page.waitForURL(url => url.pathname === '/work'), done.press('Enter')]);
                await page.getByText(/^Done saved for Authored release/u).waitFor();
                document = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
                task = (document.state || document).packs.find(task => task.id === parentReference.input.packId);
                assert.equal(task.status, 'done'); assert.equal(task.completionEvidence, supplied);
                assert.deepEqual(task.executionRun, parentReference);
                assert.equal(new URL(page.url()).searchParams.get('focus'), parentReference.input.packId);
                assert.deepEqual(dialogs, [], 'Successful completion must not open a leave warning.');
                await page.screenshot({ path: path.join(output, 'review-evidence-completion-' + width + '.png') });
                await page.goto(origin + '/next?pack=' + encodeURIComponent(parentReference.input.packId) + '&view=review');
                await page.getByText('This completed or archived task is open as read only history. You can inspect, try, or download the saved tool without reopening the task.', { exact: true }).waitFor();
                const completionDiff = page.locator('[data-request-changes]');
                await completionDiff.locator(':scope > summary').press('Enter');
                assert.deepEqual(await completionDiff.locator('[data-request-change]').evaluateAll(elements => elements.map(element => element.dataset.requestChange)), ['blocker'], 'Completion clears the blocker; its exact projected request value remains visible.');
                await completionDiff.locator('[data-diff-saved]').waitFor({ state: 'attached' });
                assert.deepEqual(await completionDiff.locator('dd').allTextContents(), ['None', 'none']);
                detail.evidenceSavedBeforeCompletion = true; detail.completionRedirectedWithoutDialog = true;
              }
              assert.equal(parentPosts, beforePosts, 'Evidence and completion cannot start a preview or provider operation.');
            } catch (error) {
              detail.failureUrl = page.url();
              detail.failureText = (await page.locator('body').innerText().catch(() => '')).slice(0, 12000);
              await page.screenshot({ path: path.join(output, 'evidence-failure-' + width + '.png'), fullPage: true }).catch(() => {});
              throw error;
            } finally { await page.close(); }
          });
        }
        await observe('compiled parent: no page errors or external requests', { width, category: 'parent', case: 'isolation' }, async () => {
          assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
        });
      }
    } finally { await context.close(); }
  }
  assert.equal(report.checks.filter(check => check.category === 'packet').length, report.expectedPacketChecks, 'Every prewritten packet case must be recorded.');
  if (report.bridgeFixture) assert.equal(report.checks.filter(check => check.category === 'bridge').length, report.bridgeFixture.expectedChecks, 'Every planned bridge observation must be recorded.');
  if (report.parentFixture) assert.equal(report.checks.filter(check => check.category === 'parent').length, report.parentFixture.expectedChecks, 'Every planned compiled-parent observation must be recorded.');
  if (report.captionFixture) assert.equal(report.checks.filter(check => check.category === 'caption').length, report.captionFixture.expectedChecks, 'Every planned authored caption-visibility observation must be recorded.');
  report.verificationCompleted = true;
  report.passed = report.checks.every(check => check.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = failure(error);
  progress("error", "preview suite", {}, error);
  process.exitCode = 1;
} finally {
  progress("cleanup", "browser");
  await browser?.close();
  progress("cleanup", "test server");
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
