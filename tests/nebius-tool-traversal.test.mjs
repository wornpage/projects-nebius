import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { authoredCheckerFiles, authoredPreviewReference, materializeAuthoredChecker } from './fixtures/nebius-release-checker.mjs';
import { PACKET_CASES, INCOMPLETE, CORRECTED, THREE_GAPS, READY, assertPacketResult } from './fixtures/nebius-release-packet-cases.mjs';
import { runFilesDigest, validateRunFiles } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { renderRunPreview } from '../worker/nebius-run-preview.mjs';
import { planCheckerReplay } from '../scripts/nebius-retained-checker.mjs';

const files = await materializeAuthoredChecker();
const script = files.find(file => file.path === 'app.js').content;

const recordingBindings = { input: 'packet', output: 'result', check: 'check-packet', incomplete: 'load-incomplete', corrected: 'load-corrected' };
async function recordingFixture() {
  const record = structuredClone((await authoredPreviewReference(files)).record);
  record.requiredInputFormats = [{ id: 'packet', format: 'json' }];
  record.checks[0].stdout = 'Observed successful assertions: 9; validate calls: 4; handleMessage calls: 6\nControl events observed: 6/6; declared JSON example loaders: 2/2; inputs without a declared format: 0\n';
  return record;
}

test('recording plan derives observed counts and export digest from the ready record', async () => {
  const record = await recordingFixture(), plan = await planCheckerReplay(record, recordingBindings);
  assert.equal(plan.runId, record.id); assert.equal(plan.sourceDigest, record.checks[0].sourceDigest);
  assert.match(plan.exportDigest, /^[0-9a-f]{64}$/u);
  assert.equal(plan.checks.successfulAssertions, 9); assert.equal(plan.checks.successfulAttempt, 1);
  assert.deepEqual(plan.checks.jsonLoaders, { observed: 2, total: 2 }); assert.equal(plan.checks.failure, null);
});

test('recording plan distinguishes a source rejection before the only Sandbox check', async () => {
  const record = await recordingFixture(); record.attempt = 2; record.usage.modelCalls = 2; record.checks[0].attempt = 2;
  record.generationAttempts = [
    { attempt: 1, outcome: 'rejected', responseText: 'Authored rejected response.', retention: 'retained', diagnostic: { code: 'invalid_model_output', stage: 'tool_files', message: 'Authored source rejection.' } },
    { attempt: 2, outcome: 'accepted', responseText: 'Authored accepted response.', retention: 'retained', diagnostic: null }
  ];
  const plan = await planCheckerReplay(record, recordingBindings);
  assert.equal(plan.checks.failure.kind, 'source'); assert.equal(plan.checks.failure.attempt, 1);
  assert.equal(plan.checks.failure.text, 'Authored source rejection.'); assert.equal(plan.checks.sandboxResults, 1);
  assert.equal(plan.checks.successfulAttempt, 2);
});

test('recording plan derives a retained failed Sandbox check without inventing source rejection', async () => {
  const record = await recordingFixture(); record.attempt = 2; record.usage.modelCalls = 2;
  record.checks = [{ ...record.checks[0], exitCode: 1, stderr: 'Authored first check failed.\nMore detail.' }, { ...record.checks[0], attempt: 2 }];
  const plan = await planCheckerReplay(record, recordingBindings);
  assert.equal(plan.checks.failure.kind, 'sandbox'); assert.equal(plan.checks.failure.text, 'Authored first check failed.');
  assert.equal(plan.checks.sandboxResults, 2);
});

test('recording plan refuses cancelled and unknown outcomes even with an exit-zero check', async () => {
  for (const status of ['cancelled', 'uncertain']) {
    const record = await recordingFixture(); record.status = status;
    await assert.rejects(planCheckerReplay(record, recordingBindings), /Only a retained ready checker/u);
  }
});

test('recording plan requires the recorded task to own the bound JSON input', async () => {
  const record = await recordingFixture(); record.requiredInputFormats = null;
  await assert.rejects(planCheckerReplay(record, recordingBindings), /task-owned JSON input/u);
});

test('recording plan refuses missing or excessive observed counts', async () => {
  for (const stdout of ['No observed counts.', 'Observed successful assertions: 1001; declared JSON example loaders: 2/2;']) {
    const record = await recordingFixture(); record.checks[0].stdout = stdout;
    await assert.rejects(planCheckerReplay(record, recordingBindings), /bounded observed/u);
  }
});

test('recording plan refuses duplicate or non-ID control bindings', async () => {
  const record = await recordingFixture();
  await assert.rejects(planCheckerReplay(record, { ...recordingBindings, output: recordingBindings.input }), /unique observed HTML/u);
  await assert.rejects(planCheckerReplay(record, { ...recordingBindings, input: '#packet' }), /unique observed HTML/u);
});





// Execute only the committed authored fixture. This is not a security sandbox
// for arbitrary model code and does not call Token Factory Sandboxes.
function loadAuthoredModule(source = script) {
  const context = createContext({ module: { exports: {} } });
  runInContext(source, context, { timeout: 1000 });
  return text => {
    context.inputText = text;
    return runInContext('module.exports.validate(inputText)', context, { timeout: 1000 });
  };
}

function workerBridge() {
  const replies = [];
  const context = createContext({ self: { postMessage: reply => replies.push(JSON.parse(JSON.stringify(reply))) } });
  runInContext(script, context, { timeout: 1000 });
  return data => {
    context.inputMessage = data;
    runInContext('self.onmessage({data: inputMessage})', context, { timeout: 1000 });
    assert.equal(replies.length, 1);
    return replies.shift().patches;
  };
}

test('authored checker traverses the actual native parser, validators and materializer', async () => {
  assert.deepEqual(validateRunFiles(files), files);
  assert.equal(script.match(/self\.onmessage/g)?.length, 1);
  assert.equal(script.match(/module\.exports/g)?.length, 1);
  for (const file of authoredCheckerFiles()) {
    const result = files.find(item => item.path === file.path).content;
    if (file.path === 'app.js') assert.ok(result.startsWith(file.content + '\n;\n'));
    else assert.equal(result, file.content);
  }
  assert.equal(await runFilesDigest(files), await runFilesDigest(await materializeAuthoredChecker()));
});

for (const scenario of PACKET_CASES) {
  test(`authored checker independent case: ${scenario.name}`, () => {
    assertPacketResult(assert, loadAuthoredModule()(scenario.input), scenario);
  });
}

test('authored checks exercise both supplied actual materialized functions', () => {
  let assertions = 0;
  const validate = loadAuthoredModule();
  const handleMessage = workerBridge();
  const countedAssert = new Proxy(assert, { get(target, key) {
    if (typeof target[key] !== 'function') return target[key];
    return (...args) => { assertions += 1; return target[key](...args); };
  } });
  const context = createContext({ assert: countedAssert, validate, handleMessage });
  runInContext(files.find(file => file.path === 'checks.cjs').content, context, { timeout: 1000 });
  assert.equal(assertions, 15);
});

test('actual appended worker bridge handles init, both example loaders and changed input', () => {
  const send = workerBridge();
  assert.doesNotMatch(send({ type: 'init', values: { packet: '' } })[0].text, /Ready for human review/u);
  for (const [id, input, expected] of [
    ['load-incomplete', INCOMPLETE, THREE_GAPS], ['load-corrected', CORRECTED, READY],
  ]) {
    const patches = send({ type: 'event', event: 'click', id, values: { packet: '' } });
    assert.deepEqual(JSON.parse(patches.find(patch => patch.id === 'packet').value), JSON.parse(input));
    assert.equal(patches.find(patch => patch.id === 'result').text, expected);
  }
  const changed = send({ type: 'event', event: 'input', id: 'packet', values: { packet: '{' } });
  assert.doesNotMatch(changed.find(patch => patch.id === 'result').text, /Ready for human review|0 gaps/u);
  const invalid = send({ type: 'event', event: 'click', id: 'check-packet', values: { packet: '{' } });
  assert.match(invalid.find(patch => patch.id === 'result').text, /^Input error:/u);
});

test('all independent cases survive actual worker message dispatch, not only direct function calls', () => {
  const send = workerBridge();
  for (const scenario of PACKET_CASES) {
    const patches = send({ type: 'event', event: 'click', id: 'check-packet', values: { packet: scenario.input } });
    assertPacketResult(assert, patches.find(patch => patch.id === 'result').text, scenario);
  }
});

test('independent oracle detects a tool that falsely reports every input ready', () => {
  const wrong = loadAuthoredModule('function validate() { return "0 gaps: Ready for human review"; }\nmodule.exports = { validate };');
  assert.throws(() => assertPacketResult(assert, wrong(INCOMPLETE), PACKET_CASES[0]));
  assert.throws(() => assertPacketResult(assert, wrong('null'), PACKET_CASES.find(item => item.name === 'null')));
});

test('known-good fixture does not require weaker page or worker validation', async () => {
  const badPage = authoredCheckerFiles();
  badPage[0].content += '\n<script>throw new Error("must be rejected")</script>';
  await assert.rejects(materializeAuthoredChecker(badPage), error => error.stage === 'tool_page' && error.code === 'page_script_forbidden');
  const badLogic = authoredCheckerFiles();
  badLogic[1].content += '\n// fetch';
  await assert.rejects(materializeAuthoredChecker(badLogic), error => error.stage === 'tool_worker');
});

test('a named-file repair preserves the page and checks and appends exactly one bridge', async () => {
  const replacements = authoredCheckerFiles().filter(file => file.path === 'app.js');
  replacements[0].content += '\n// Authored repair fixture, not a model repair.';
  const repaired = await materializeAuthoredChecker(replacements, { files, check: { exitCode: 1, stderr: 'Authored diagnostic fixture.' } });
  assert.deepEqual(repaired[0], files[0]);
  assert.deepEqual(repaired[2], files[2]);
  assert.equal(repaired[1].content.match(/self\.onmessage/g)?.length, 1);
  for (const scenario of PACKET_CASES) assertPacketResult(assert, loadAuthoredModule(repaired[1].content)(scenario.input), scenario);
});

test('retained preview rejects ambiguous or untrusted input before browser execution', async t => {
  // Synthetic record for rejection tests only, not evidence of a provider run.
  const fixtureRecord = (await authoredPreviewReference(files)).record;
  const bindings = { input: 'packet', output: 'result', check: 'check-packet', incomplete: 'load-incomplete', corrected: 'load-corrected' };
  const script = fileURLToPath(new URL('../scripts/nebius-tool-preview-smoke.mjs', import.meta.url));
  for (const [name, mutation, expected] of [
    ['partial options', (record, ids, paths) => ({ args: ['--run-record', paths.record] }), /Use --run-record PATH and --bindings PATH together/u],
    ['unknown option', (record, ids, paths) => ({ args: ['--run-record', paths.record, '--unknown', paths.bindings] }), /Unknown or duplicate/u],
    ['duplicate option', (record, ids, paths) => ({ args: ['--run-record', paths.record, '--run-record', paths.bindings] }), /Unknown or duplicate/u],
    ['source digest mismatch', record => { record.files[1].content += '\n// Authored data mutation'; }, /do not match the source that was checked/u],
    ['non-ready record', record => { record.status = 'failed'; }, /Only a retained ready RunRecord/u],
    ['response envelope instead of raw record', record => ({ record: { run: record } }), /saved execution record is invalid/u],
    ['extra binding key', (record, ids) => { ids.extra = 'unused'; }, /Expected values to be strictly deep-equal/u],
    ['selector instead of ID', (record, ids) => { ids.input = '#packet'; }, /HTML IDs, not selectors or code/u],
    ['duplicate control ID', (record, ids) => { ids.output = ids.input; }, /distinct ID/u],
    ['oversized bindings', () => ({ bindingsText: ' '.repeat(4097) }), /exceeds its size limit/u],
    ['oversized record', () => ({ recordText: ' '.repeat(1048577) }), /exceeds its size limit/u],
    ['malformed JSON without echoing its contents', () => ({ recordText: 'SECRET_FROM_MISPLACED_FILE' }), /Qualification inputs must be valid JSON/u],
  ]) {
    await t.test(name, child => {
      const parent = resolve(tmpdir());
      const directory = mkdtempSync(join(parent, 'nebius-preview-arguments-'));
      child.after(() => {
        const target = resolve(directory);
        assert.equal(dirname(target), parent);
        assert.ok(basename(target).startsWith('nebius-preview-arguments-'));
        rmSync(target, { recursive: true });
      });
      const paths = { record: join(directory, 'record.json'), bindings: join(directory, 'bindings.json') };
      const record = structuredClone(fixtureRecord), ids = { ...bindings };
      const changes = mutation(record, ids, paths) || {};
      writeFileSync(paths.record, changes.recordText ?? JSON.stringify(changes.record ?? record));
      writeFileSync(paths.bindings, changes.bindingsText ?? JSON.stringify(ids));
      const evidence = join(directory, 'evidence');
      const result = spawnSync(process.execPath, [script, ...(changes.args ?? ['--run-record', paths.record, '--bindings', paths.bindings])], {
        encoding: 'utf8', timeout: 6000, maxBuffer: 8192, windowsHide: true,
        env: { ...process.env, CHROME_EXECUTABLE_PATH: '', NEBIUS_PREVIEW_EVIDENCE_DIR: evidence },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stdout);
      assert.doesNotMatch(result.stdout, /SECRET_FROM_MISPLACED_FILE/u);
      const report = JSON.parse(readFileSync(join(evidence, 'report.json'), 'utf8'));
      assert.match(report.error.message, expected);
      assert.equal(report.browser, null);
      assert.equal(report.liveModelCalls, 0);
      assert.equal(report.liveSandboxRuns, 0);
      assert.equal(report.packetSummary.observed, 0);
      assert.equal(report.passed, false);
    });
  }
});

// Run only the trusted renderer bootstrap against a controlled DOM and Worker
// stub. Blob bytes are retained as data and never executed in host Node/vm.
// The real browser verifier separately runs the authored code in its Worker.
async function domBridgeHarness(prepare = () => {}) {
  let documentState, frameHasFocus = true;
  const focusCalls = [];
  class Element {
    constructor(id = '', tagName = 'DIV') {
      this.id = id; this.tagName = tagName; this.dataset = {}; this.textContent = '';
      this.attributes = new Map(); this.style = { setProperty(name, value, priority) { this[name] = value; this[name + 'Priority'] = priority; } }; this.childNodes = []; this.beforeNodes = []; this.labels = []; this.hidden = false; this.isConnected = true;
    }
    closest(selector) {
      if (selector === '[id]') return this;
      for (let node = this; node; node = node.parentElement) if ((selector.includes('[hidden]') && node.hidden) ||
        (selector.includes('[aria-hidden=') && node.getAttribute('aria-hidden') === 'true') ||
        (selector.includes('[inert]') && node.getAttribute('inert') !== null)) return node;
      return null;
    }
    matches(selector) { assert.equal(selector, ':disabled'); return this.disabled === true; }
    focus(options) { documentState.activeElement = this; focusCalls.push({ element: this, options }); }
    getClientRects() { return this.hidden || this.style.display === 'none' ? [] : [{}]; }
    getBoundingClientRect() { return this.box || { width: 100, height: 20, left: 10, top: 10, right: 110, bottom: 30 }; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { this.childNodes.push(...nodes); }
    before(node) { this.beforeNodes.push(node); }
  }
  class Input extends Element {}
  class Textarea extends Element { value = ''; }
  class Select extends Element {}
  class Button extends Element {}
  const elements = new Map([
    ['packet', new Textarea('packet')], ['result', new Element('result', 'OUTPUT')],
    ['load-incomplete', new Button('load-incomplete')], ['load-corrected', new Button('load-corrected')],
    ['check-packet', new Button('check-packet')], ['packet-form', new Element('packet-form')],
  ]);
  prepare(elements, Element);
  const listeners = new Map(), windowListeners = new Map(), timers = new Map();
  const created = [], frames = [], messages = [], notifications = [];
  let worker, timerId = 0;
  class Worker {
    terminated = 0;
    constructor() { worker = this; }
    postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); }
    terminate() { this.terminated += 1; }
  }
  const rendered = await renderRunPreview(files);
  const bootstrap = rendered.html.match(/<script>([\s\S]*)<\/script><\/body><\/html>$/u)?.[1];
  assert.ok(bootstrap, 'The actual renderer must supply its fixed bootstrap.');
  documentState = { documentElement: { clientWidth: 1280, clientHeight: 900 }, body: { querySelectorAll: selector => selector === '[id]' ? [...elements.values()] : [...elements.values()].filter(el=>el.getAttribute('aria-live')!==null||['status','alert','log','marquee','timer'].includes(el.getAttribute('role'))), append: () => {},
      addEventListener: (name, listener) => listeners.set(name, listener) },
      createElement: tag => { const element = new Element('', tag.toUpperCase()); created.push(element); return element; },
      getElementById: id => elements.get(id) || null, hasFocus: () => frameHasFocus };
  documentState.activeElement = documentState.body;
  const context = createContext({
    document: documentState,
    Element, HTMLElement: Element, HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLSelectElement: Select, HTMLButtonElement: Button,
    window: {}, parent: { postMessage: data => notifications.push({ ...data, renderedOutput: elements.get('result').textContent }) },
    atob: text => Buffer.from(text, 'base64').toString('binary'), Uint8Array,
    Blob: class {}, URL: { createObjectURL: () => 'blob:authored-unused-by-stub', revokeObjectURL: () => {} }, Worker,
    setTimeout: (callback, milliseconds) => { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout: id => timers.delete(id), addEventListener: (name, listener) => windowListeners.set(name, listener),
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    getComputedStyle: element => ({visibility:element.style.visibility || 'visible',opacity:element.style.opacity ?? '1',clip:element.style.clip || 'auto',clipPath:element.style.clipPath || 'none'}),
  });
  runInContext(bootstrap, context, { timeout: 1000 });
  return {
    elements, worker, status: created.find(el=>el.getAttribute('role')==='status'), created, messages, notifications, timers, focusCalls,
    focusControl(id) { documentState.activeElement = elements.get(id); listeners.get('focusin')({ target: documentState.activeElement }); },
    leaveFrame() { documentState.activeElement = documentState.body; frameHasFocus = false; },
    returnFrame() { frameHasFocus = true; windowListeners.get('focus')(); },
    activeControl() { return documentState.activeElement; },
    flushAnnouncements() { for (const callback of frames.splice(0)) callback(); },
    emit(name, id, value) {
      const target = elements.get(id); assert.ok(target);
      if (value !== undefined) target.value = value;
      listeners.get(name)({ target, preventDefault() {} });
    },
    reply(patches) { worker.onmessage({ data: { patches } }); },
    expire() { assert.equal(timers.size, 1); const timer = [...timers.values()][0]; assert.equal(timer.milliseconds, 5000); timer.callback(); },
    close() { windowListeners.get('pagehide')(); },
  };
}

test('preview restores its own control after frame focus without a Worker event', async () => {
  const h = await domBridgeHarness();
  h.focusControl('packet');
  const before = h.messages.length;
  h.leaveFrame(); h.returnFrame(); h.flushAnnouncements();
  assert.equal(h.activeControl(), h.elements.get('packet'));
  assert.equal(h.focusCalls.length, 1);
  assert.equal(h.focusCalls[0].options.preventScroll, true);
  assert.equal(h.messages.length, before);
});

test('preview focus restoration neither autofocuses nor replaces a new focused control', async () => {
  const h = await domBridgeHarness();
  h.returnFrame(); h.flushAnnouncements();
  assert.equal(h.focusCalls.length, 0);
  h.focusControl('packet'); h.leaveFrame(); h.returnFrame();
  h.focusControl('check-packet'); h.flushAnnouncements();
  assert.equal(h.activeControl(), h.elements.get('check-packet'));
  assert.equal(h.focusCalls.length, 0);
});

for (const unavailable of ['detached', 'disabled', 'hidden', 'inert', 'invisible']) {
  test('preview does not restore focus to a ' + unavailable + ' control', async () => {
    const h = await domBridgeHarness();
    const target = h.elements.get('packet');
    h.focusControl('packet'); h.leaveFrame();
    if (unavailable === 'detached') target.isConnected = false;
    if (unavailable === 'disabled') target.disabled = true;
    if (unavailable === 'hidden') target.hidden = true;
    if (unavailable === 'inert') target.setAttribute('inert', '');
    if (unavailable === 'invisible') target.style.visibility = 'hidden';
    h.returnFrame(); h.flushAnnouncements();
    assert.equal(h.focusCalls.length, 0);
  });
}

test('renderer gives anonymous outputs names and one pre-existing announcement channel', async () => {
  const bridge = await domBridgeHarness((elements, Element) => {
    const second = new Element('second', 'PRE'); second.dataset.output = 'true';
    elements.set('second', second);
    elements.get('packet').dataset.inputFormat = 'json';
  });
  const { status } = bridge;
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.getAttribute('aria-atomic'), 'true');
  assert.equal(status.textContent, '');
  assert.equal(bridge.messages.length, 1);
  assert.equal(bridge.elements.get('result').getAttribute('aria-label'), 'Result');
  assert.equal(bridge.elements.get('second').getAttribute('aria-label'), 'Result 2');
  for (const id of ['result', 'second']) {
    assert.equal(bridge.elements.get(id).getAttribute('role'), 'group');
    assert.equal(bridge.elements.get(id).getAttribute('aria-live'), 'off');
    assert.equal(bridge.elements.get(id).beforeNodes.length, 1);
  }
  assert.equal(bridge.created.filter(el=>el.getAttribute('role')==='status').length, 1);
  assert.equal(bridge.created.find(el=>el.tagName==='DD').textContent, 'JSON');
  bridge.reply([{id:'result',text:'First result'},{id:'second',text:'Second result'}]);
  assert.equal(status.textContent, '');
  bridge.flushAnnouncements();
  assert.equal(status.textContent, 'Result: First result\nResult 2: Second result');
});

test('renderer preserves supplied output names and reports historical input declarations', async () => {
  for (const [format, expected] of [[undefined,'Not declared'],['text','Plain text'],['json','JSON']]) {
    const bridge = await domBridgeHarness((elements, Element) => {
      if (format !== undefined) elements.get('packet').dataset.inputFormat = format;
      const label = new Element('result-label'); label.textContent = '  Packet outcome  ';
      elements.set(label.id, label);
      elements.get('result').setAttribute('aria-labelledby', label.id);
      elements.get('result').setAttribute('aria-label', 'Lower precedence name');
    });
    assert.equal(bridge.elements.get('packet').dataset.inputFormat, format);
    assert.equal(bridge.created.find(el=>el.tagName==='DD').textContent, expected);
    assert.equal(bridge.elements.get('result').getAttribute('aria-label'), 'Packet outcome');
    assert.equal(bridge.elements.get('result').beforeNodes.length, 1);
    assert.equal(bridge.elements.get('result').beforeNodes[0].hidden, true);
  }
});

test('renderer exposes aria-only and hidden output names as visible captions', async () => {
  for (const labelSource of ['aria-label', 'hidden reference', 'CSS-hidden reference']) {
    const bridge = await domBridgeHarness((elements, Element) => {
      const output = elements.get('result');
      if (labelSource === 'aria-label') output.setAttribute('aria-label', 'Packet outcome');
      else {
        const label = new Element('result-label'); label.textContent = 'Packet outcome';
        if (labelSource === 'hidden reference') label.hidden = true;
        else label.style.display = 'none';
        elements.set(label.id, label); output.setAttribute('aria-labelledby', label.id);
      }
    });
    const output = bridge.elements.get('result');
    assert.equal(output.getAttribute('aria-label'), 'Packet outcome');
    assert.equal(output.beforeNodes.length, 1);
    assert.equal(output.beforeNodes[0].textContent, 'Packet outcome');
    assert.equal(output.beforeNodes[0].getAttribute('aria-hidden'), 'true');
    assert.equal(output.beforeNodes[0].getAttribute('data-nebius-output-label'), '');
    bridge.reply([{ id: 'result', hidden: true }]);
    assert.equal(output.beforeNodes[0].hidden, true);
  }
});

test('renderer reuses a matching visible native output label without duplicating it', async () => {
  for (const ariaName of [null, 'Packet outcome', 'Different accessible outcome']) {
    const bridge = await domBridgeHarness((elements, Element) => {
      const label = new Element('result-label'); label.textContent = 'Packet outcome';
      const output = elements.get('result'); output.labels = [label];
      if (ariaName) output.setAttribute('aria-label', ariaName);
    });
    const output = bridge.elements.get('result');
    assert.equal(output.getAttribute('aria-label'), ariaName || 'Packet outcome');
    assert.equal(output.beforeNodes.length, 1);
    assert.equal(output.beforeNodes[0].hidden, ariaName !== 'Different accessible outcome');
  }
});

test('renderer provides captions for clipped, tiny, offscreen and transparent naming elements', async () => {
  for (const presentation of ['clipped', 'tiny', 'offscreen', 'transparent']) {
    const bridge = await domBridgeHarness((elements, Element) => {
      const label = new Element('result-label'); label.textContent = 'Packet outcome';
      if (presentation === 'clipped') label.style.clipPath = 'inset(50%)';
      if (presentation === 'tiny') label.box = { width: 1, height: 1, left: 10, top: 10, right: 11, bottom: 11 };
      if (presentation === 'offscreen') label.box = { width: 100, height: 20, left: -9999, top: 10, right: -9899, bottom: 30 };
      if (presentation === 'transparent') label.style.opacity = '0';
      elements.set(label.id, label); elements.get('result').setAttribute('aria-labelledby', label.id);
    });
    assert.equal(bridge.elements.get('result').beforeNodes[0].hidden, false, presentation);
    assert.equal(bridge.elements.get('result').beforeNodes[0].style.display, 'block');
    assert.equal(bridge.elements.get('result').beforeNodes[0].style.displayPriority, 'important');
  }
});

test('renderer hands visible captions over when a naming element is hidden and restored', async () => {
  const bridge = await domBridgeHarness((elements, Element) => {
    const label = new Element('result-label'); label.textContent = 'Packet outcome';
    elements.set(label.id, label); elements.get('result').setAttribute('aria-labelledby', label.id);
  });
  const caption = bridge.elements.get('result').beforeNodes[0];
  assert.equal(caption.hidden, true);
  bridge.reply([{ id: 'result-label', hidden: true }]);
  assert.equal(caption.hidden, false); assert.equal(caption.style.display, 'block');
  bridge.emit('click', 'check-packet');
  bridge.reply([{ id: 'result-label', hidden: false }]);
  assert.equal(caption.hidden, true); assert.equal(caption.style.display, 'none');
  assert.equal(bridge.elements.get('result').beforeNodes.length, 1);
});

test('renderer supplies one portable default style layer without changing authored files', async () => {
  const original = structuredClone(files);
  const preview = await renderRunPreview(files);
  assert.deepEqual(files, original);
  assert.equal(preview.html.split('@layer nebius-preview-base').length - 1, 1);
  assert.match(preview.html, /data-example-for\]:hover/u);
  assert.match(preview.csp, /connect-src 'none'/u);
  assert.match(preview.csp, /font-src 'none'/u);
});

test('result announcements use complete patch batches and repeat unchanged results', async () => {
  const bridge = await domBridgeHarness();
  bridge.reply([{id:'result',text:'Ready'}]); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Result: Ready');
  bridge.emit('click','load-corrected');
  bridge.reply([{id:'result',text:'Ready'},{id:'packet',value:'new input'}]);
  assert.equal(bridge.status.textContent, '');
  assert.equal(bridge.elements.get('result').textContent, 'Ready');
  bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Result: Ready');
});

test('edits invalidate one announcement and stale replies cannot restore it', async () => {
  const bridge = await domBridgeHarness();
  bridge.reply([{id:'result',text:'Old result'}]); bridge.flushAnnouncements();
  bridge.emit('input','packet','first edit'); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Results cleared. Check the updated input.');
  bridge.emit('input','packet','second edit'); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Results cleared. Check the updated input.');
  bridge.reply([{id:'result',text:'Stale result'}]); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Results cleared. Check the updated input.');
  bridge.reply([{id:'result',text:'Current result'}]); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Result: Current result');
});

test('an edit cancels a result announcement scheduled for the next frame', async () => {
  const bridge = await domBridgeHarness();
  bridge.reply([{id:'result',text:'Pending old result'}]);
  bridge.emit('input','packet','changed'); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Results cleared. Check the updated input.');
});

test('hidden outputs are excluded and fatal errors cancel queued announcements', async () => {
  const bridge = await domBridgeHarness();
  bridge.reply([{id:'result',text:'Hidden result'},{id:'result',hidden:true}]); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, '');
  bridge.emit('click','check-packet');
  bridge.reply([{id:'result',hidden:false},{id:'result',text:'Visible result'}]); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Result: Visible result');
  bridge.emit('click','check-packet');
  bridge.reply([{id:'result',hidden:true}]); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Results cleared. Check the updated input.');
  bridge.emit('click','check-packet');
  bridge.reply([{id:'result',hidden:false},{id:'result',text:'Pending result'}]);
  bridge.emit('click','check-packet'); bridge.expire(); bridge.flushAnnouncements();
  assert.match(bridge.status.textContent, /stopped responding/u);
  assert.equal(bridge.status.style.cssText, '');
  assert.doesNotMatch(bridge.status.textContent, /Pending result/u);
});

test('CSS-hidden and aria-hidden results are not announced', async () => {
  for (const hide of [el=>{el.style.visibility='hidden';},el=>{el.style.display='none';},el=>el.setAttribute('aria-hidden','true')]) {
    const bridge = await domBridgeHarness(elements=>hide(elements.get('result')));
    bridge.reply([{id:'result',text:'Not visible'}]); bridge.flushAnnouncements();
    assert.equal(bridge.status.textContent, '');
  }
});

test('a result hidden before its announcement frame is not read out', async () => {
  const bridge = await domBridgeHarness();
  bridge.reply([{id:'result',text:'Pending visible result'}]);
  bridge.elements.get('result').hidden = true;
  bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, '');
});

test('editing after a fatal error cannot erase the runtime failure message', async () => {
  const bridge = await domBridgeHarness();
  bridge.reply([{id:'result',text:'Previous result'}]); bridge.flushAnnouncements();
  bridge.emit('click','check-packet'); bridge.expire();
  const failure = bridge.status.textContent;
  bridge.emit('input','packet','edited after failure'); bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, failure);
  assert.equal(bridge.status.style.cssText, '');
  assert.equal(bridge.elements.get('result').textContent, '');
});

test('hiding an unrelated control does not repeat an unchanged result announcement', async () => {
  const bridge = await domBridgeHarness();
  bridge.reply([{id:'result',text:'Existing result'}]); bridge.flushAnnouncements();
  bridge.emit('click','check-packet');
  bridge.reply([{id:'check-packet',hidden:true}]);
  assert.equal(bridge.status.textContent, 'Result: Existing result');
});

test('a hidden-only text update does not repeat another visible result', async () => {
  const bridge = await domBridgeHarness((elements, Element) => {
    const hidden = new Element('hidden-result', 'PRE'); hidden.dataset.output = 'true'; hidden.hidden = true;
    elements.set(hidden.id, hidden);
  });
  bridge.reply([{id:'result',text:'Visible result'},{id:'hidden-result',text:'Hidden result'}]); bridge.flushAnnouncements();
  bridge.emit('click','check-packet');
  bridge.reply([{id:'hidden-result',text:'Changed hidden result'}]);
  assert.equal(bridge.status.textContent, 'Result: Visible result');
  bridge.flushAnnouncements();
  assert.equal(bridge.status.textContent, 'Result: Visible result');
});

test('announcement text is bounded while the full plain-text result is preserved', async () => {
  const bridge = await domBridgeHarness();
  const text = '<b>Plain text</b>' + 'x'.repeat(15000);
  bridge.reply([{id:'result',text}]); bridge.flushAnnouncements();
  assert.equal(bridge.elements.get('result').textContent, text);
  assert.ok(bridge.status.textContent.length <= 4000);
  assert.match(bridge.status.textContent, /^Result: <b>Plain text<\/b>/u);
  assert.match(bridge.status.textContent, /Full results remain in the tool\.$/u);
});

test('DOM bridge preserves ordered events and their captured input values while busy', async () => {
  const bridge = await domBridgeHarness();
  bridge.emit('input', 'packet', 'first');
  bridge.emit('input', 'packet', 'second');
  bridge.emit('click', 'check-packet');
  assert.equal(bridge.messages.length, 1);
  bridge.reply([]);
  assert.deepEqual(bridge.messages[1], { type: 'event', event: 'input', id: 'packet', values: { packet: 'first' } });
  bridge.reply([{ id: 'result', text: 'stale first answer' }]);
  assert.equal(bridge.elements.get('result').textContent, '');
  assert.equal(bridge.messages[2].values.packet, 'second');
  bridge.reply([{ id: 'result', text: 'Input changed' }]);
  assert.equal(bridge.messages[3].id, 'check-packet');
  assert.equal(bridge.messages[3].values.packet, 'second');
  bridge.reply([{ id: 'result', text: 'checked second' }]);
  assert.equal(bridge.elements.get('result').textContent, 'checked second');
  assert.equal(bridge.timers.size, 0);
});

test('DOM bridge delivers both queued example actions instead of dropping the second', async () => {
  const bridge = await domBridgeHarness(); bridge.reply([]);
  bridge.emit('click', 'load-incomplete'); bridge.emit('click', 'load-corrected');
  bridge.reply([{ id: 'packet', value: INCOMPLETE }, { id: 'result', text: THREE_GAPS }]);
  assert.equal(bridge.messages[2].id, 'load-corrected');
  bridge.reply([{ id: 'packet', value: CORRECTED }, { id: 'result', text: READY }]);
  assert.equal(bridge.elements.get('packet').value, CORRECTED);
  assert.equal(bridge.elements.get('result').textContent, READY);
});

test('DOM bridge discards stale value and answer patches after a newer user edit', async () => {
  const bridge = await domBridgeHarness(); bridge.reply([{ id: 'result', text: 'Initial result' }]);
  bridge.emit('click', 'load-corrected'); bridge.emit('input', 'packet', '{');
  assert.equal(bridge.elements.get('result').textContent, '', 'Clear synchronously before the pending reply.');
  bridge.reply([{ id: 'packet', value: CORRECTED }, { id: 'result', text: READY }]);
  assert.equal(bridge.elements.get('packet').value, '{');
  assert.equal(bridge.elements.get('result').textContent, '');
  bridge.reply([{ id: 'result', text: 'Input changed' }]);
  assert.equal(bridge.elements.get('result').textContent, 'Input changed');
});

test('DOM bridge clears old results before a value-patch batch, regardless of patch order', async () => {
  const bridge = await domBridgeHarness(); bridge.reply([{ id: 'result', text: READY }]);
  bridge.emit('click', 'load-incomplete');
  bridge.reply([{ id: 'packet', value: INCOMPLETE }]);
  assert.equal(bridge.elements.get('result').textContent, '', 'A loader need not supply an explicit clear patch.');
  bridge.emit('click', 'load-corrected');
  bridge.reply([{ id: 'result', text: READY }, { id: 'packet', value: CORRECTED }]);
  assert.equal(bridge.elements.get('result').textContent, READY, 'Pre-clearing must not erase the new result.');
});

test('DOM bridge handles click and submit as separate ordered native events', async () => {
  const bridge = await domBridgeHarness(); bridge.reply([]);
  bridge.emit('click', 'check-packet'); bridge.emit('submit', 'packet-form');
  bridge.reply([{ id: 'result', text: 'checked' }]);
  assert.equal(bridge.messages[2].event, 'submit');
  assert.equal(bridge.messages[2].id, 'packet-form');
  bridge.reply([]);
  assert.equal(bridge.elements.get('result').textContent, 'checked');
  assert.equal(bridge.timers.size, 0);
});

test('DOM bridge stops explicitly at 33 pending events instead of silently losing them', async () => {
  const bridge = await domBridgeHarness();
  for (let index = 0; index < 32; index += 1) bridge.emit('click', 'check-packet');
  assert.equal(bridge.worker.terminated, 0);
  bridge.emit('click', 'check-packet');
  assert.equal(bridge.worker.terminated, 1);
  assert.match(bridge.status.textContent, /Too many tool interactions/u);
  bridge.reply([]); bridge.emit('click', 'check-packet');
  assert.equal(bridge.messages.length, 1);
  assert.equal(bridge.timers.size, 0);
});

test('DOM bridge deadline terminates the Worker and prevents queued dispatch or retry', async () => {
  const bridge = await domBridgeHarness(); bridge.emit('input', 'packet', 'new'); bridge.expire();
  assert.equal(bridge.worker.terminated, 1);
  assert.match(bridge.status.textContent, /stopped responding/u);
  bridge.reply([]); bridge.emit('click', 'check-packet');
  assert.equal(bridge.messages.length, 1);
  assert.equal(bridge.timers.size, 0);
});

test('DOM bridge rejects an invalid stale reply before it can dispatch pending events', async () => {
  const bridge = await domBridgeHarness(); bridge.emit('input', 'packet', 'new');
  bridge.reply(Array.from({ length: 101 }, () => ({ id: 'result', text: 'too many patches' })));
  assert.equal(bridge.worker.terminated, 1);
  assert.match(bridge.status.textContent, /unsupported update/u);
  assert.equal(bridge.messages.length, 1);
  assert.equal(bridge.timers.size, 0);
});

test('DOM bridge script errors and page close stop pending work exactly once', async () => {
  for (const reason of ['error', 'close']) {
    const bridge = await domBridgeHarness(); bridge.emit('click', 'check-packet');
    if (reason === 'error') bridge.worker.onerror({ preventDefault() {} }); else bridge.close();
    bridge.close(); bridge.reply([]); bridge.emit('click', 'check-packet');
    assert.equal(bridge.worker.terminated, 1);
    assert.equal(bridge.messages.length, 1);
    assert.equal(bridge.timers.size, 0);
    assert.equal(bridge.notifications.filter(item => item.status === 'failed').length, 1);
  }
});

test('DOM bridge reports ready after patches and ignores unsolicited idle replies', async () => {
  const bridge = await domBridgeHarness(); bridge.reply([{ id: 'result', text: 'Initialized' }]);
  assert.equal(bridge.notifications.at(-1).renderedOutput, 'Initialized');
  bridge.reply([{ id: 'result', text: 'unsolicited' }]);
  assert.equal(bridge.elements.get('result').textContent, 'Initialized');
  bridge.emit('click', 'check-packet');
  bridge.reply([{ id: 'result', text: 'Checked' }]);
  assert.equal(bridge.notifications.at(-1).renderedOutput, 'Checked');
});

// Exercise the two actual trusted component functions, removing only their
// two TypeScript parameter annotations. This is not execution of model code.
function parentPreviewHarness() {
  const source = readFileSync(new URL('../svelte-frontend/src/routes/review/NebiusRunReview.svelte', import.meta.url), 'utf8');
  const start = source.indexOf('function stopPreviewListener()');
  const end = source.indexOf('function retainActionFocus(', start);
  assert.ok(start >= 0 && end > start);
  const functions = source.slice(start, end).replace(': HTMLIFrameElement', '').replace(': MessageEvent', '');
  const listeners = new Set(), timers = new Map(); let timerId = 0;
  const context = createContext({
    window: { addEventListener: (name, fn) => { assert.equal(name, 'message'); listeners.add(fn); },
      removeEventListener: (name, fn) => { assert.equal(name, 'message'); listeners.delete(fn); } },
    setTimeout: (callback, milliseconds) => { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  runInContext(`let stopPreviewMessages = null; let previewTimer = null; let previewStatus = 'Opening';
${functions}
this.unit = { listenForPreviewStatus, stopPreviewListener, status: () => previewStatus };`, context, { timeout: 1000 });
  const frame = { contentWindow: {} };
  return { listeners, timers, frame, status: context.unit.status,
    listen: (target = frame) => context.unit.listenForPreviewStatus(target),
    stop: () => context.unit.stopPreviewListener(),
    emit(status, changes = {}) { for (const listener of [...listeners]) listener({ source: frame.contentWindow, origin: 'null', data: { type: 'nebius-tool-preview', status }, ...changes }); },
    expire() { assert.equal(timers.size, 1); const [id, timer] = [...timers.entries()][0]; assert.equal(timer.milliseconds, 8000); timers.delete(id); timer.callback(); },
  };
}

test('parent preview stays subscribed after readiness and reflects a later failure', () => {
  const h = parentPreviewHarness(); h.listen(); h.emit('ready');
  assert.equal(h.status(), 'Preview running'); assert.equal(h.listeners.size, 1); assert.equal(h.timers.size, 0);
  h.emit('failed'); assert.match(h.status(), /^Preview stopped/u);
  assert.equal(h.listeners.size, 0); h.emit('ready'); assert.match(h.status(), /^Preview stopped/u);
});

test('parent startup failure cleans up its listener and deadline', () => {
  const h = parentPreviewHarness(); h.listen(); h.emit('failed');
  assert.match(h.status(), /could not run/u); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});

test('parent startup deadline stops a preview that never acknowledges initialization', () => {
  const h = parentPreviewHarness(); h.listen(); h.expire();
  assert.match(h.status(), /could not run/u); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});

test('parent rejects unexpected sources, origins and message shapes without cancelling startup', () => {
  const h = parentPreviewHarness(); h.listen();
  for (const changes of [{ source: {} }, { origin: 'https://foreign.example' }, { origin: '' },
    { data: null }, { data: [] }, { data: { type: 'nebius-tool-preview', status: 'ready', extra: true } },
    { data: { type: 'other', status: 'ready' } }, { data: { type: 'nebius-tool-preview', status: 'busy' } }]) h.emit('ready', changes);
  assert.equal(h.status(), 'Opening'); assert.equal(h.listeners.size, 1); assert.equal(h.timers.size, 1);
  h.emit('failed'); assert.match(h.status(), /could not run/u);
});

test('parent replacement removes the old listener and rejects the old WindowProxy', () => {
  const h = parentPreviewHarness(); h.listen();
  const nextFrame = { contentWindow: {} }; h.listen(nextFrame);
  assert.equal(h.listeners.size, 1); assert.equal(h.timers.size, 1);
  h.emit('failed'); assert.equal(h.status(), 'Opening');
  h.emit('ready', { source: nextFrame.contentWindow });
  h.emit('failed', { source: nextFrame.contentWindow });
  assert.match(h.status(), /^Preview stopped/u); assert.equal(h.listeners.size, 0);
});

test('parent explicit cleanup is idempotent and rejects subsequent messages', () => {
  const h = parentPreviewHarness(); h.listen(); h.stop(); h.stop(); h.emit('ready');
  assert.equal(h.status(), 'Opening'); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});

test('parent repeated readiness retains one listener without rescheduling startup', () => {
  const h = parentPreviewHarness(); h.listen(); h.emit('ready'); h.emit('ready');
  assert.equal(h.status(), 'Preview running'); assert.equal(h.listeners.size, 1); assert.equal(h.timers.size, 0);
});
