import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { FIXTURE_INPUT, FIXTURE_MODEL, authoredCheckerFiles, nativeFileBlocks, authoredThreeAttemptReference } from './fixtures/nebius-release-checker.mjs';
import { streamEnvelope, streamEnvelopeBytes } from './helpers/nebius-stream-fixture.mjs';
import { RUN_LIMITS, RUN_RECORD_LIMITS, isRunConfig, RUN_MODEL_TIMEOUT_MS, RUN_VERSION, RUN_RECORD_FORMAT, RUN_EVIDENCE_LIMITS, runJsonBytes, runSnapshotFromRecord, validateRunInput, validateToolInputRequirements, validateRunIntegrity, validateRunRecord } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { RunProviderError } from '../worker/nebius-run-provider.mjs';
import { describeGenerationResponse, generationDiagnosticEvent } from '../worker/nebius-run-diagnostics.mjs';

// Import the actual orchestration and provider parsers, replacing only the
// platform base class, storage, and HTTP transport. No credentials or generated
// program execution: transport envelopes are authored. Retained-model-text
// tests parse their exact fixture without executing either generated script.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'fixture:cloudflare-workers', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'fixture:cloudflare-workers') return { format: 'module', shortCircuit: true,
      source: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }' };
    return next(url, context);
  },
});
const { NebiusRun, handleNebiusRuns } = await import('../worker/nebius-runs.mjs');
const { NebiusBudget } = await import('../worker/index.mjs');
hooks.deregister();

const id = '00000000-0000-4000-8000-000000000001', admission = '00000000-0000-4000-8000-000000000002';
const image = '00000000-0000-4000-8000-000000000003', key = 'a'.repeat(64);
const fixtureText = () => nativeFileBlocks(authoredCheckerFiles());
// Authored invalid response exercises aggregated diagnostics without retaining provider text.
const recoveryAsJson = (() => {
  const files = authoredCheckerFiles();
  const page = files.find(file => file.path === 'index.html');
  page.content = page.content.replace('</main>', '<pre id="schedule" data-output-format="timeline"></pre>\n</main>');
  files.find(file => file.path === 'checks.cjs').content = 'assert.equal(1, 1);\nconst PRIVATE_INVALID = ;';
  return JSON.stringify(Object.fromEntries(files.map(file => [file.path, file.content])));
})();
function completion(content, mutate = () => {}) {
  const raw = { model: FIXTURE_MODEL, usage: { prompt_tokens: 10, completion_tokens: 20 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, reasoning_content: 'PRIVATE_REASONING_NOT_RETAINED' } }] };
  mutate(raw);
  return streamEnvelope(raw);
}

async function harness(t, { input = FIXTURE_INPUT, responses = [fixtureText()], exits = [0], sandboxResponses = null, restoredOperationIds = [], reserve = () => true, onModel = async () => {}, onSandbox = async () => {}, onPoll = async () => {}, onCancel = async () => {}, start = true } = {}) {
  const data = new Map(); let alarmAt = null, transactionTail = Promise.resolve(), instance = null;
  const storage = {
    async get(name) { return structuredClone(data.get(name)); },
    async put(name, value) { data.set(name, structuredClone(value)); },
    async getAlarm() { return alarmAt; }, async setAlarm(value) { alarmAt = value; },
    async deleteAlarm() { alarmAt = null; }, async deleteAll() { data.clear(); },
    async transaction(fn) {
      const result = transactionTail.then(async () => {
        const before = structuredClone(data), beforeAlarm = alarmAt;
        try { return await fn(storage); }
        catch (error) { data.clear(); for (const [key, value] of before) data.set(key, value); alarmAt = beforeAlarm; throw error; }
      });
      transactionTail = result.then(() => {}, () => {});
      return result;
    },
  };
  const calls = [], reservations = [], operationIds = [...restoredOperationIds];
  const env = { NEBIUS_API_KEY: 'synthetic-fixture-key', NEBIUS_MODEL_REASONING: FIXTURE_MODEL,
    NEBIUS_SANDBOX_IAM_TOKEN: 'synthetic-fixture-token', NEBIUS_SANDBOX_PROJECT_ID: 'fixture-project', NEBIUS_SANDBOX_NODE_IMAGE_UUID: image,
    NEBIUS_BUDGET: { getByName: () => ({ reserveExecution: async (...args) => { reservations.push(args); return reserve(args[2]); } }) } };
  const current = () => instance ||= new NebiusRun({ storage }, env);
  let modelCount = 0, sandboxCount = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options.method, body });
    if (url === 'https://api.tokenfactory.nebius.com/v1/chat/completions') {
      const position = modelCount++;
      assert.ok(position < responses.length, 'Unexpected extra model call.');
      await onModel({ attempt: position + 1, run: current(), storage, body, signal: options.signal });
      const response = responses[position];
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : completion(response);
    }
    if (url === 'https://api.tokenfactory.nebius.com/sandboxes/v1/instances') {
      const position = sandboxCount++;
      assert.ok(position < (sandboxResponses ?? exits).length, 'Unexpected extra Sandbox submission.');
      await onSandbox({ run: current(), storage, body });
      if (sandboxResponses) return sandboxResponses[position];
      const operationId = `00000000-0000-4000-8000-${String(position + 10).padStart(12, '0')}`;
      operationIds.push(operationId);
      return Response.json({ uuid: admission, image }, { status: 201, headers: { location: `/sandboxes/v1/operations/${operationId}` } });
    }
    const operation = operationIds.findIndex(value => url.endsWith('/operations/' + value));
    if (operation !== -1 && options.method === 'GET') {
      await onPoll({ operation, run: current(), storage });
      const exit = exits[operation];
      return Response.json({ uuid: operationIds[operation], kind: 'instance', status: exit === 0 ? 'SUCCESS' : 'FAILED',
        metadata: { image, result: { state: { exit_code: exit }, stdout: { encoding: 'ascii', value: 'Authored transport fixture only.' },
          stderr: { encoding: 'ascii', value: exit ? 'Authored failing check.' : '' } } } });
    }
    if (operation !== -1 && options.method === 'DELETE') { await onCancel({ operation, run: current(), storage }); return new Response(null, { status: 202 }); }
    assert.fail('Unmocked network request.');
  });
  if (start) {
    const started = await current().startAdmitted(id, input, key, admission, 20);
    assert.equal(started.ok, true);
  }
  return { storage, env, current, calls, reservations,
    counts: () => ({ model: modelCount, sandbox: sandboxCount }),
    state: () => storage.get('state'),
    restart() { instance = new NebiusRun({ storage }, env); return instance; },
    async step() { alarmAt = null; await current().alarm(); const result = await storage.get('state'); await validateRunIntegrity(result.record); return result; },
    async finish() {
      for (let step = 0; step < 10; step++) {
        const result = await this.step();
        if (result.phase === 'retained') return result.record;
      }
      assert.fail('The bounded run did not finish.');
    },
  };
}

for (const status of [408, 500, 524]) test(`HTTP ${status} preserves an uncertain submission and cannot start again after reload`, async t => {
  const h = await harness(t, { responses: [new Response('Authored upstream failure', { status })], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.deepEqual(run.failure, { code: 'generation_uncertain', stage: 'generation' });
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: null, outputTokens: null, totalsComplete: false });
  assert.deepEqual(run.files, []); assert.deepEqual(run.checks, []); assert.deepEqual(run.generationAttempts, []);
  h.restart(); await h.step(); await h.step();
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

for (const [status, uncertain] of [
  ...[200, 202, 302, 408, 500, 502, 503, 504, 524, 599].map(status => [status, true]),
  ...[400, 401, 403, 404, 409, 422, 429].map(status => [status, false]),
]) test(`Sandbox POST HTTP ${status} retains ${uncertain ? 'uncertainty' : 'refusal'} without model repair, resubmission or polling after reload`, async t => {
  const h = await harness(t, { sandboxResponses: [new Response('UNTRUSTED_ERROR_BODY_NOT_RETAINED', { status })], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, uncertain ? 'uncertain' : 'failed');
  assert.deepEqual(run.failure, { code: uncertain ? 'sandbox_submission_uncertain' : 'sandbox_submission_failed', stage: 'sandbox' });
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: 10, outputTokens: 20, totalsComplete: true });
  assert.equal(run.attempt, 1);
  assert.equal(run.files.length, 3, 'Retain the accepted model response, not a fabricated Sandbox result.');
  assert.deepEqual(run.checks, []);
  assert.deepEqual(run.generationAttempts.map(entry => entry.outcome), ['accepted']);
  const retained = await h.state();
  assert.equal(retained.phase, 'retained');
  assert.equal(retained.operationId, null);
  assert.equal(await h.storage.getAlarm(), retained.retentionAt, 'Only ordinary retention cleanup remains scheduled.');
  assert.doesNotMatch(JSON.stringify(retained), /UNTRUSTED_ERROR_BODY_NOT_RETAINED/u);
  h.restart(); await h.step(); await h.step();
  assert.deepEqual(await h.state(), retained, 'Reloading and repeated alarms preserve the terminal record.');
  assert.deepEqual(h.counts(), { model: 1, sandbox: 1 });
  assert.equal(h.reservations.length, 1, 'No new model reservation or repair.');
  assert.deepEqual(h.calls.map(call => call.method), ['POST', 'POST'], 'Only generation and the one Sandbox submission occur.');
});

test('missing stream DONE preserves actually reported usage without admitting partial source or a repair', async t => {
  const raw = { model: FIXTURE_MODEL, usage: { prompt_tokens: 10, completion_tokens: 20 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: fixtureText() } }] };
  const bytes = streamEnvelopeBytes(raw), suffix = new TextEncoder().encode('data: [DONE]\n\n').length;
  const h = await harness(t, { responses: [new Response(bytes.subarray(0, bytes.length - suffix),
    { headers: { 'content-type': 'text/event-stream' } })], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: 10, outputTokens: 20, totalsComplete: true });
  assert.deepEqual(run.files, []); assert.deepEqual(run.checks, []); assert.deepEqual(run.generationAttempts, []);
  h.restart(); await h.step(); assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('a stalled response reader reaches the model deadline and never repairs or submits Sandbox', async t => {
  let cancelled = 0;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(': authored heartbeat\n\n')); },
    cancel() { cancelled++; } }, { highWaterMark: 0 });
  const h = await harness(t, { responses: [new Response(stream, { headers: { 'content-type': 'text/event-stream' } })], exits: [] });
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, _delay, ...args) => original(callback, 3, ...args));
  const run = await h.finish();
  assert.equal(run.status, 'uncertain'); assert.equal(run.failure.code, 'generation_timeout');
  assert.equal(run.usage.totalsComplete, false); assert.equal(cancelled, 1); assert.equal(stream.locked, false);
  h.restart(); await h.step(); assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('a reload observing an active stream cannot resubmit the model and the checked source remains exact', async t => {
  const raw = { model: FIXTURE_MODEL, usage: { prompt_tokens: 10, completion_tokens: 20 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: fixtureText() } }] };
  const bytes = streamEnvelopeBytes(raw); let offset = 0, reloaded = false, h;
  const stream = new ReadableStream({ async pull(controller) {
    if (offset > 0 && !reloaded) { reloaded = true; h.restart(); await h.current().alarm(); }
    if (offset === bytes.length) { controller.close(); return; }
    const end = Math.min(offset + 1024, bytes.length); controller.enqueue(bytes.subarray(offset, end)); offset = end;
  } }, { highWaterMark: 0 });
  h = await harness(t, { responses: [new Response(stream, { headers: { 'content-type': 'text/event-stream' } })] });
  const run = await h.finish();
  assert.equal(reloaded, true); assert.equal(run.status, 'ready');
  assert.equal(run.generationAttempts[0].responseText, fixtureText());
  assert.deepEqual(h.counts(), { model: 1, sandbox: 1 });
  h.restart(); await h.step(); assert.deepEqual(h.counts(), { model: 1, sandbox: 1 });
});

test('the actual run uses the shared model timeout and retains the original whole-run deadline', async t => {
  const h = await harness(t), original = globalThis.setTimeout, delays = [];
  const before = await h.state();
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => { delays.push(delay); return original(callback, delay, ...args); });
  const state = await h.step();
  assert(delays[0] > RUN_MODEL_TIMEOUT_MS - 1000 && delays[0] <= RUN_MODEL_TIMEOUT_MS);
  assert.equal(state.deadline, before.deadline);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('generation response wait is clamped to the remaining whole-run time', async t => {
  const h = await harness(t), original = globalThis.setTimeout, delays = [];
  const state = await h.state(); state.deadline = Date.now() + 3000; await h.storage.put('state', state);
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => { delays.push(delay); return original(callback, delay, ...args); });
  await h.step();
  assert(delays[0] > 0 && delays[0] <= 3000);
  assert(delays[0] < RUN_MODEL_TIMEOUT_MS);
});

test('second model request is clamped to the unchanged overall deadline', async t => {
  const h=await harness(t,{responses:['bad first',fixtureText()]});
  const initial=await h.state();await h.step();
  const before=await h.state();assert.equal(before.deadline,initial.deadline);
  const clock=t.mock.method(Date,'now',()=>initial.deadline-3000),original=globalThis.setTimeout,delays=[];
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{delays.push(delay);return original(callback,delay,...args);});
  let state;try{state=await h.step();}finally{clock.mock.restore();}
  assert.equal(state.deadline,initial.deadline);assert(delays[0]>0&&delays[0]<=3000);assert(delays[0]<RUN_MODEL_TIMEOUT_MS);
  assert.equal((await h.finish()).status,'ready');assert.deepEqual(h.counts(),{model:2,sandbox:1});
});

test('an actual generation timeout ends uncertain without repair or Sandbox submission', async t => {
  const h = await harness(t, { onModel: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), { once: true })) });
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, _delay, ...args) => original(callback, 3, ...args));
  const state = await h.step();
  assert.equal(state.record.status, 'uncertain');
  assert.equal(state.record.failure.code, 'generation_timeout');
  assert.equal(state.record.usage.inputTokens, null);
  assert.equal(state.record.usage.outputTokens, null);
  assert.equal(state.record.usage.totalsComplete, false);
  await h.step();
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('rejected response repairs once before its first Sandbox check, preserving both responses and usage', async t => {
  const rejected = 'Rejected authored source: wrong fences';
  const h = await harness(t, { responses: [rejected, fixtureText()] });
  const first = await h.step();
  assert.equal(first.phase, 'model-ready');
  assert.equal(first.record.attempt, 0);
  assert.equal(first.record.generationAttempts[0].responseText, rejected);
  assert.equal(first.record.checks.length, 0);
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
  assert.deepEqual(h.reservations.map(args => args[2]), [1, 2]);
  assert.equal(run.attempt, 2);
  assert.deepEqual(run.checks.map(check => check.attempt), [2]);
  assert.deepEqual(run.generationAttempts.map(entry => entry.outcome), ['rejected', 'accepted']);
  assert.deepEqual(run.usage, { modelCalls: 2, inputTokens: 20, outputTokens: 40, totalsComplete: true });
  const repair = h.calls.filter(call => call.url.endsWith('/chat/completions'))[1].body.messages;
  assert.ok(repair[1].content.includes(rejected));
  assert.match(repair[0].content, /Return all three complete files exactly once/u);
  assert.doesNotMatch(JSON.stringify(run), /PRIVATE_REASONING_NOT_RETAINED|synthetic-fixture-key|synthetic-fixture-token/u);
  assert.equal((await h.current().read(key)).run.generationAttempts.length, 2);
  await h.step();
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
});

test('two source rejections terminate without Sandbox or a third model call', async t => {
  const h = await harness(t, { responses: ['bad first', 'bad second'], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.deepEqual(h.counts(), { model: 2, sandbox: 0 });
  assert.deepEqual(run.generationAttempts.map(entry => entry.responseText), ['bad first', 'bad second']);
  assert.equal(run.failure.stage, 'tool_files');
  const stopped=await h.state();h.restart();await h.step();await h.step();
  assert.deepEqual(await h.state(),stopped);assert.deepEqual(h.counts(),{model:2,sandbox:0});
  assert.deepEqual(h.reservations.map(args=>args[2]),[1,2]);
});

test('one source repair receives missing-file and app-syntax diagnostics together', async t => {
  const files = authoredCheckerFiles().filter(file => file.path !== 'checks.cjs');
  files.find(file => file.path === 'app.js').content += '\nconst PRIVATE_APP_IDENTIFIER = ;';
  const response = nativeFileBlocks(files);
  const h = await harness(t, { responses: [response, response], exits: [] });
  const initial = await h.state(), first = await h.step();
  assert.equal(first.record.status, 'repairing');
  assert.equal(first.deadline, initial.deadline);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
  const diagnostic = first.record.generationAttempts[0].diagnostic;
  assert.equal(diagnostic.stage, 'tool_files');
  assert.match(diagnostic.message, /Missing required source files: checks\.cjs\./u);
  assert.match(diagnostic.message, /app\.js:\d+:\d+ is not a valid standalone/u);
  assert.doesNotMatch(diagnostic.message, /PRIVATE_APP_IDENTIFIER/u);
  const run = await h.finish();
  const repair = h.calls.filter(call => call.url.endsWith('/chat/completions'))[1].body;
  assert.deepEqual(JSON.parse(repair.messages[1].content.split('Source rejection (diagnostic data):\n')[1]), diagnostic);
  assert.equal(run.status, 'failed');
  assert.deepEqual(run.generationAttempts.map(entry => entry.responseText), [response, response]);
  assert.deepEqual(h.counts(), { model: 2, sandbox: 0 });
  assert.deepEqual(h.reservations.map(args => args[2]), [1, 2]);
  await h.step();
  assert.deepEqual(h.counts(), { model: 2, sandbox: 0 });
});

test('authored invalid tool reports both page and checks syntax defects before Sandbox', async t => {
  const h = await harness(t, {responses:[recoveryAsJson], exits:[]});
  const initial = await h.state();
  const state = await h.step();
  assert.equal(state.phase, 'model-ready');
  assert.equal(state.record.status, 'repairing');
  assert.equal(state.deadline, initial.deadline);
  assert.deepEqual(h.counts(), {model:1,sandbox:0});
  assert.equal(state.record.files.length, 0);
  assert.equal(state.record.checks.length, 0);
  assert.equal(state.record.generationAttempts.length, 1);
  const rejected = state.record.generationAttempts[0];
  assert.equal(rejected.outcome, 'rejected');
  assert.equal(rejected.responseText, recoveryAsJson);
  assert.equal(rejected.diagnostic.stage, 'preview');
  assert.match(rejected.diagnostic.message, /index\.html: <pre id="schedule">/u);
  assert.match(rejected.diagnostic.message, /Use <output data-output-format="timeline">/u);
  assert.match(rejected.diagnostic.message, /checks\.cjs:2:\d+ cannot compile/u);
  assert(rejected.diagnostic.message.length <= 463);
  assert.deepEqual(state.record.usage, {modelCalls:1,inputTokens:10,outputTokens:20,totalsComplete:true});
});

test('bounded repair receives authored-source diagnostics and stops after a second rejection', async t => {
  const h = await harness(t, {responses:[recoveryAsJson,recoveryAsJson], exits:[]});
  const first = await h.step(), diagnostic = first.record.generationAttempts[0].diagnostic.message;
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.stage, 'preview');
  assert.deepEqual(h.counts(), {model:2,sandbox:0});
  assert.deepEqual(h.reservations.map(args => args[2]), [1,2]);
  assert.equal(run.files.length, 0); assert.equal(run.checks.length, 0);
  assert.deepEqual(run.generationAttempts.map(entry => entry.responseText), [recoveryAsJson,recoveryAsJson]);
  assert(run.generationAttempts.every(entry => entry.outcome === 'rejected' && entry.diagnostic.message === diagnostic));
  const repair = h.calls.filter(call => call.url.endsWith('/chat/completions'))[1].body;
  assert(repair.messages[1].content.includes(recoveryAsJson));
  const repairDiagnostic = JSON.parse(repair.messages[1].content.split('\n\nSource rejection (diagnostic data):\n')[1]);
  assert.equal(repairDiagnostic.message, diagnostic);
  assert.match(repair.messages[0].content, /This is a conditional repair within the existing model-call limit/u);
  await h.step(); assert.deepEqual(h.counts(), {model:2,sandbox:0});
});

test('authored-source repair obeys ordinary quota refusal without an unsubmitted model call', async t => {
  const h = await harness(t, {responses:[recoveryAsJson], exits:[], reserve:attempt => attempt === 1});
  const run = await h.finish();
  assert.equal(run.status, 'failed'); assert.equal(run.failure.code, 'daily_limit');
  assert.deepEqual(h.counts(), {model:1,sandbox:0});
  assert.equal(run.usage.modelCalls, 1); assert.equal(run.generationAttempts.length, 1);
  assert.equal(run.generationAttempts[0].responseText, recoveryAsJson);
});

test('checks-only syntax rejection uses tool_checks and never submits Sandbox work', async t => {
  const files = authoredCheckerFiles(); files.find(file => file.path === 'checks.cjs').content = 'assert.equal(1, 1);\nconst PRIVATE_NAME_DO_NOT_ECHO = ;';
  const text = nativeFileBlocks(files);
  const h = await harness(t, {responses:[text,text], exits:[]});
  const run = await h.finish();
  assert.equal(run.status, 'failed'); assert.equal(run.failure.stage, 'tool_checks');
  assert.deepEqual(h.counts(), {model:2,sandbox:0});
  assert.match(run.error, /checks\.cjs:2:\d+ cannot compile/u);
  assert.doesNotMatch(run.error, /PRIVATE_NAME_DO_NOT_ECHO/u);
  assert.equal(run.generationAttempts[0].responseText, text);
});

test('failed Sandbox then rejected repair keeps the checked first files and both responses', async t => {
  const h = await harness(t, { responses: [fixtureText(), 'bad repair'], exits: [1] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.attempt, 1);
  assert.deepEqual(run.checks.map(check => check.attempt), [1]);
  assert.deepEqual(run.generationAttempts.map(entry => entry.outcome), ['accepted', 'rejected']);
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
});

for (const exit of [0, 1]) test(`Sandbox repairs remain bounded with final exit ${exit}`, async t => {
  // Transport/state test only: a changed response is not proof of a useful fix.
  const files = authoredCheckerFiles(); files[1].content += '\n// Authored second response for state-machine coverage.';
  const h = await harness(t, { responses: [fixtureText(), nativeFileBlocks(files)], exits: [1, exit],onModel:({attempt,body})=>{
    assert.equal(body.max_tokens,32000);assert.equal(body.stream,true);assert.deepEqual(body.stream_options,{include_usage:true});
    assert.deepEqual(body.chat_template_kwargs,attempt===1?{enable_thinking:true,low_effort:true,force_nonempty_content:true}:{enable_thinking:true,low_effort:true,force_nonempty_content:true});
    assert.equal(body.response_format.json_schema.name,attempt===1?'browser_tool_source':'browser_tool_replacements');
  } });
  const run = await h.finish();
  assert.equal(run.status, exit === 0 ? 'ready' : 'failed');
  assert.deepEqual(run.checks.map(check => check.attempt), [1, 2]);
  assert.deepEqual(h.counts(), { model: 2, sandbox: 2 });
  assert.deepEqual(h.reservations.map(args => args[2]), [1, 2]);
  assert.deepEqual(run.usage, {modelCalls:2,inputTokens:20,outputTokens:40,totalsComplete:true});
  for(const attempt of [1,2])assert.equal(run.events.filter(event=>event.message.startsWith(`Generation ${attempt} response: `)).length,1);
  h.restart(); await h.step(); await h.step();
  assert.deepEqual(h.counts(), { model: 2, sandbox: 2 });
});

test('byte-identical repair retains the rejection and skips a duplicate failed Sandbox check', async t => {
  const h = await harness(t, { responses: [fixtureText(), fixtureText()], exits: [1] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.code, 'unchanged_repair');
  assert.equal(run.failure.stage, 'tool_files');
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
  assert.deepEqual(run.checks.map(check => check.attempt), [1]);
  assert.equal(run.attempt, 1);
  assert.deepEqual(run.generationAttempts.map(entry => entry.outcome), ['accepted', 'rejected']);
  assert.equal(run.generationAttempts[1].responseText, fixtureText());
  assert.equal(run.generationAttempts[1].diagnostic.code, 'unchanged_repair');
  assert.deepEqual(run.usage, { modelCalls: 2, inputTokens: 20, outputTokens: 40, totalsComplete: true });
  await h.step();
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
});

test('source rejection then failed Sandbox stops at two calls without another repair', async t => {
  const h=await harness(t,{responses:['bad first',fixtureText()],exits:[1]});
  const run=await h.finish();assert.equal(run.status,'failed');
  assert.deepEqual(h.counts(),{model:2,sandbox:1});assert.deepEqual(run.checks.map(check=>check.attempt),[2]);
  assert.deepEqual(run.generationAttempts.map(entry=>entry.outcome),['rejected','accepted']);
  const requests=h.calls.filter(call=>call.url.endsWith('/chat/completions')).map(call=>call.body);
  assert.equal(requests.length,2);assert.match(requests[1].messages[0].content,/source-rejection repair/u);
  const stopped=await h.state();h.restart();await h.step();await h.step();
  assert.deepEqual(await h.state(),stopped);assert.deepEqual(h.reservations.map(args=>args[2]),[1,2]);
  assert.deepEqual(h.counts(),{model:2,sandbox:1});
});

test('duplicate page IDs are retained and repaired before any Sandbox submission', async t => {
  const files = authoredCheckerFiles(); files[0].content += '\n<output id="result"></output>';
  const h = await harness(t, { responses: [nativeFileBlocks(files), fixtureText()] });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.equal(run.generationAttempts[0].diagnostic.stage, 'preview');
  assert.match(run.generationAttempts[0].diagnostic.message, /IDs must be unique/u);
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
});

test('new textual inputs without a declared format use the existing bounded source repair', async t => {
  const files = authoredCheckerFiles();
  files[0].content = files[0].content.replace(' data-input-format="json"', '');
  const h = await harness(t, { responses: [nativeFileBlocks(files), fixtureText()] });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.equal(run.generationAttempts[0].diagnostic.stage, 'preview');
  assert.match(run.generationAttempts[0].diagnostic.message, /explicit data-input-format.*Missing: packet/u);
  assert.equal(run.generationAttempts[0].responseText, nativeFileBlocks(files));
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
});

test('an unspecified task preserves a text declaration rather than inferring JSON from prose', async t => {
  const files = authoredCheckerFiles();
  files[0].content = files[0].content.replace('data-input-format="json"', 'data-input-format="text"');
  const h = await harness(t, { responses: [nativeFileBlocks(files)] });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.match(run.files[0].content, /data-input-format="text"/u);
  assert.doesNotMatch(run.files[0].content, /data-input-format="json"/u);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 1 });
});

test('task-owned input requirements distinguish unspecified, empty and complete formats', () => {
  assert.equal(validateToolInputRequirements(null), null);
  assert.deepEqual(validateToolInputRequirements([]), []);
  const original = [{ id: 'packet', format: 'json' }, { id: 'notes', format: 'text' }];
  const validated = validateToolInputRequirements(original);
  assert.deepEqual(validated, original);
  validated[0].id = 'changed';
  assert.equal(original[0].id, 'packet');
  for (const value of [undefined, {}, 'json', Array(1), [{ id: 'packet', format: 'JSON' }],
    [{ id: '#packet', format: 'json' }], [{ id: 'x'.repeat(81), format: 'text' }],
    [{ id: 'packet', format: 'json', extra: true }], [{ id: 'packet', format: 'json' }, { id: 'packet', format: 'text' }],
    Array.from({ length: 9 }, (_, index) => ({ id: 'input' + index, format: 'text' }))]) {
    assert.throws(() => validateToolInputRequirements(value));
  }
  const missing = { ...FIXTURE_INPUT }; delete missing.requiredInputFormats;
  assert.throws(() => validateRunInput(missing));
  const legacy = { ...missing, version: 'browser-tool.v1' }; delete legacy.requiredOutputs;
  assert.deepEqual(validateRunInput(legacy), legacy);
  assert.throws(() => validateRunInput({ ...legacy, requiredInputFormats: null }));
});

test('a JSON requirement rejects a text downgrade before Sandbox and repairs with the same immutable specification', async t => {
  const input = { ...FIXTURE_INPUT, requiredInputFormats: [{ id: 'packet', format: 'json' }] };
  const { consent, ...snapshot } = input;
  const files = authoredCheckerFiles();
  files[0].content = files[0].content.replace('data-input-format="json"', 'data-input-format="text"');
  const h = await harness(t, { input, responses: [nativeFileBlocks(files), fixtureText()], onModel: ({ body }) => {
    assert.ok(body.messages[1].content.startsWith('Reviewed task input (untrusted data):\n' + JSON.stringify(snapshot, null, 2)));
    assert.match(body.messages[0].content, /requiredInputFormats is authoritative/u);
  }, onSandbox: ({ body }) => {
    const contract = JSON.parse(Buffer.from(body.stdin.value, 'base64').toString('utf8')).pageContract;
    assert.equal(contract.elements.find(element => element.id === 'packet').format, 'json');
  } });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.equal(run.version, RUN_VERSION);
  assert.deepEqual(run.requiredInputFormats, input.requiredInputFormats);
  assert.equal(run.generationAttempts[0].diagnostic.stage, 'preview');
  assert.match(run.generationAttempts[0].diagnostic.message, /packet must declare data-input-format="json"/u);
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
  assert.deepEqual(run.checks.map(check => check.attempt), [2]);
});

test('two format downgrades stop without Sandbox or a third model call', async t => {
  const input = { ...FIXTURE_INPUT, requiredInputFormats: [{ id: 'packet', format: 'json' }] };
  const files = authoredCheckerFiles();
  files[0].content = files[0].content.replace('data-input-format="json"', 'data-input-format="text"');
  const h = await harness(t, { input, responses: [nativeFileBlocks(files), nativeFileBlocks(files)], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.stage, 'preview');
  assert.deepEqual(h.counts(), { model: 2, sandbox: 0 });
  assert.deepEqual(run.generationAttempts.map(entry => entry.outcome), ['rejected', 'rejected']);
});

test('required outputs stay fixed through rejection, one repair and Sandbox admission', async t => {
  const input={...FIXTURE_INPUT,requiredOutputs:[{id:'result',format:'text'}]};
  const bad=authoredCheckerFiles();bad[0].content=bad[0].content.replaceAll('<output ', '<span ').replaceAll('</output>', '</span>');
  const {consent,...snapshot}=input;
  const h=await harness(t,{input,responses:[nativeFileBlocks(bad),fixtureText()],onModel:({body})=>{
    assert(body.messages[1].content.startsWith('Reviewed task input (untrusted data):\n'+JSON.stringify(snapshot,null,2)));
    assert.match(body.messages[0].content,/requiredOutputs is a MINIMUM/u);
  },onSandbox:({body})=>{
    const page=JSON.parse(Buffer.from(body.stdin.value,'base64').toString('utf8')).pageContract;
    assert.equal(page.elements.find(e=>e.id==='result').tag,'output');
  }});
  const run=await h.finish();assert.equal(run.status,'ready');
  assert.deepEqual(run.requiredOutputs,input.requiredOutputs);
  assert.match(run.generationAttempts[0].diagnostic.message,/Required output result must use an output element/u);
  assert.deepEqual(h.counts(),{model:2,sandbox:1});
  assert.deepEqual(run.checks.map(check=>check.attempt),[2]);
});

test('a missing required output cannot reach Sandbox after any bounded response', async t => {
  const input={...FIXTURE_INPUT,requiredOutputs:[{id:'impact',format:'text'}]};
  const h=await harness(t,{input,responses:[fixtureText(),fixtureText(),fixtureText()],exits:[]});
  const run=await h.finish();assert.equal(run.status,'failed');
  assert.match(run.error,/Required output impact is missing/u);
  assert.deepEqual(h.counts(),{model:2,sandbox:0});
});

test('output-only changes conflict with an already reserved run', async t => {
  const h=await harness(t,{responses:[],exits:[]});
  const changed={...FIXTURE_INPUT,requiredOutputs:[{id:'result',format:'text'}]};
  assert.equal((await h.current().inspectStart(id,changed,key)).code,'run_conflict');
  assert.equal((await h.current().startAdmitted(id,changed,key,admission,20)).code,'run_conflict');
  assert.deepEqual(h.counts(),{model:0,sandbox:0});
});

test('historical v2 previews still enforce their saved input contract and refuse new starts', async t => {
  const h=await harness(t,{input:{...FIXTURE_INPUT,requiredInputFormats:[{id:'packet',format:'json'}]}});
  const run=await h.finish();run.version='browser-tool.v2';delete run.requiredOutputs;
  const verified=await validateRunIntegrity(run);assert.deepEqual(verified,run);
  const snapshot=runSnapshotFromRecord(verified);assert.equal(Object.hasOwn(snapshot,'requiredOutputs'),false);
  assert.equal((await h.current().inspectStart(id,{...snapshot,consent:true},key)).code,'run_input_changed');
  const env={NEBIUS_ALLOWED_ORIGIN:'http://127.0.0.1',NEBIUS_RUNS:{getByName:()=>({read:async()=>({ok:true,run})})}};
  const request=()=>new Request('http://127.0.0.1/api/nebius/runs/'+id+'/preview',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'http://127.0.0.1'},body:new URLSearchParams({key}).toString()});
  assert.equal((await handleNebiusRuns(request(),env)).status,200);
  run.requiredInputFormats=[{id:'packet',format:'text'}];
  assert.notEqual((await handleNebiusRuns(request(),env)).status,200);
});

test('a cancelled late response still records a rejected format mismatch without advancing', async t => {
  const input = { ...FIXTURE_INPUT, requiredInputFormats: [{ id: 'packet', format: 'json' }] };
  const files = authoredCheckerFiles();
  files[0].content = files[0].content.replace('data-input-format="json"', 'data-input-format="text"');
  const h = await harness(t, { input, responses: [nativeFileBlocks(files)], exits: [],
    onModel: async ({ run }) => { assert.equal((await run.cancel(key)).ok, true); } });
  const run = await h.finish();
  assert.equal(run.status, 'cancelled');
  assert.equal(run.generationAttempts[0].outcome, 'rejected');
  assert.equal(run.generationAttempts[0].diagnostic.stage, 'preview');
  assert.deepEqual(run.requiredInputFormats, input.requiredInputFormats);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('a dummy JSON control cannot substitute for the complete task-owned input set', async t => {
  const input = { ...FIXTURE_INPUT, requiredInputFormats: [{ id: 'packet', format: 'json' }] };
  const files = authoredCheckerFiles();
  files[0].content += '\n<input id="dummy" data-input-format="json" hidden>';
  const h = await harness(t, { input, responses: [nativeFileBlocks(files), fixtureText()] });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.match(run.generationAttempts[0].diagnostic.message, /exactly match the task-owned input IDs/u);
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
});

test('an explicit no-text-input requirement rejects generated text controls', async t => {
  const h = await harness(t, { input: { ...FIXTURE_INPUT, requiredInputFormats: [] }, responses: [fixtureText(), fixtureText()], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.deepEqual(h.counts(), { model: 2, sandbox: 0 });
});

test('input requirements belong to request identity and cannot change on an existing run', async t => {
  const h = await harness(t);
  const changed = { ...FIXTURE_INPUT, requiredInputFormats: [] };
  const inspected = await h.current().inspectStart(id, changed, key);
  assert.equal(inspected.code, 'run_conflict');
  assert.deepEqual(h.counts(), { model: 0, sandbox: 0 });
  assert.equal(h.reservations.length, 0);
});

test('historical v1 records retain unknown formats while legacy starts are refused', async t => {
  const h = await harness(t);
  const run = await h.finish();
  run.version = 'browser-tool.v1'; delete run.requiredInputFormats; delete run.requiredOutputs;
  const validated = await validateRunIntegrity(run);
  assert.deepEqual(validated, run);
  const snapshot = runSnapshotFromRecord(validated);
  assert.equal(Object.hasOwn(snapshot, 'requiredInputFormats'), false);
  const legacy = { ...snapshot, consent: true };
  assert.equal((await h.current().inspectStart(id, legacy, key)).code, 'run_input_changed');
  assert.equal((await h.current().startAdmitted(id, legacy, key, admission, 20)).code, 'run_input_changed');
  const beforeCounts = h.counts();
  const response = await handleNebiusRuns(new Request('http://127.0.0.1/api/nebius/runs/' + id, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-nebius-run-format': RUN_RECORD_FORMAT, authorization: 'Bearer ' + key, origin: 'http://127.0.0.1' },
    body: JSON.stringify(legacy),
  }), {});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'run_input_changed');
  assert.deepEqual(h.counts(), beforeCounts);
});

test('an old queued snapshot cannot resume generation through an alarm', async t => {
  const h = await harness(t, { responses: [], exits: [] });
  const state = await h.state();
  state.record.version = 'browser-tool.v1'; delete state.record.requiredInputFormats; delete state.record.requiredOutputs;
  await h.storage.put('state', state);
  const observed = await h.step();
  assert.equal(observed.phase, 'retained');
  assert.equal(observed.record.status, 'failed');
  assert.equal(observed.record.failure.code, 'run_input_changed');
  assert.deepEqual(h.counts(), { model: 0, sandbox: 0 });
  assert.equal(h.reservations.length, 0);
});

for (const attempt of [1, 2]) test(`cancellation during model response ${attempt} retains source but never advances`, async t => {
  const h = await harness(t, { responses: attempt === 1 ? [fixtureText()] : ['bad first', 'bad second'].slice(0,attempt), exits: [],
    onModel: async ({ attempt: observed, run }) => { if (observed === attempt) assert.equal((await run.cancel(key)).ok, true); } });
  const run = await h.finish();
  assert.equal(run.status, 'cancelled');
  assert.equal(run.generationAttempts.length, attempt);
  assert.equal(run.usage.totalsComplete, true);
  assert.deepEqual(h.counts(), { model: attempt, sandbox: 0 });
});

test('second cancelled response remains terminal through reload', async t => {
  const h=await harness(t,{responses:['bad first',fixtureText()],exits:[],onModel:async({attempt,run})=>{
    if(attempt===2)assert.equal((await run.cancel(key)).ok,true);
  }});
  const run=await h.finish();assert.equal(run.status,'cancelled');assert.equal(run.usage.modelCalls,2);
  assert.equal(run.generationAttempts.length,2);assert.equal(run.checks.length,0);
  const stopped=await h.state();h.restart();await h.step();await h.step();
  assert.deepEqual(await h.state(),stopped);assert.deepEqual(h.counts(),{model:2,sandbox:0});
});

test('second unknown response retains only observed subtotals and never resubmits after reload', async t => {
  const h=await harness(t,{responses:['bad first',new Error('Authored lost second response')],exits:[]});
  const run=await h.finish();assert.equal(run.status,'uncertain');
  assert.deepEqual(run.usage,{modelCalls:2,inputTokens:10,outputTokens:20,totalsComplete:false});
  assert.deepEqual(run.generationAttempts.map(entry=>entry.responseText),['bad first']);
  const stopped=await h.state();h.restart();await h.step();await h.step();
  assert.deepEqual(await h.state(),stopped);assert.deepEqual(h.counts(),{model:2,sandbox:0});
});

test('unknown model response stops with incomplete usage and no retry', async t => {
  const h = await harness(t, { responses: [new Error('Authored lost-response fixture')], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.equal(run.usage.totalsComplete, false);
  assert.deepEqual(run.generationAttempts, []);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('a large provider envelope reaches the existing run checks without retaining reasoning', async t => {
  const response = completion(fixtureText(), raw => { raw.choices[0].message.reasoning_content = 'AUTHORED_LARGE_REASONING_' + 'x'.repeat(200000); });
  const h = await harness(t, { responses: [response] });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.deepEqual(h.counts(), { model: 1, sandbox: 1 });
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: 10, outputTokens: 20, totalsComplete: true });
  assert.equal(run.generationAttempts[0].responseText, fixtureText());
  assert.doesNotMatch(JSON.stringify(run), /AUTHORED_LARGE_REASONING|reasoning_content/u);
  assert(runJsonBytes({ run }) < 512 * 1024);
});

test('an oversized SSE frame stops uncertain with unknown usage and no repair or Sandbox check', async t => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: ' + ' '.repeat(512 * 1024))); },
    cancel() { cancelled += 1; },
  }), { headers: { 'content-type': 'text/event-stream' } });
  const h = await harness(t, { responses: [response], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.deepEqual(run.failure, { code: 'generation_uncertain', stage: 'response' });
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: null, outputTokens: null, totalsComplete: false });
  assert.deepEqual(run.files, []);
  assert.deepEqual(run.checks, []);
  assert.deepEqual(run.generationAttempts, []);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
  assert.equal(cancelled, 1);
  await h.step();
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('a malformed stream persists only fixed shape diagnostics and never retries', async t => {
  const event = { id: 'authored-completion', object: 'chat.completion.chunk', model: FIXTURE_MODEL,
    choices: [{ index: 0, delta: { role: 'assistant', PRIVATE_FIXTURE_SECRET: 'PRIVATE_FIXTURE_SECRET' }, finish_reason: null }] };
  const response = new Response('data: ' + JSON.stringify(event) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const h = await harness(t, { responses: [response], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.deepEqual(run.failure, { code: 'generation_uncertain', stage: 'response' });
  assert.match(run.error, /shape: extra_delta; event 1/u);
  assert.doesNotMatch(JSON.stringify(run), /PRIVATE_FIXTURE_SECRET|authored-completion/u);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
  h.restart(); await h.step(); await h.step();
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('invalid initial provisional usage persists its fixed diagnostic, unknown usage and no retry', async t => {
  const event = { id: 'private-upstream-id', object: 'chat.completion.chunk', model: FIXTURE_MODEL,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    usage: { prompt_tokens: 'PRIVATE_FIXTURE_SECRET', completion_tokens: 0 } };
  const response = new Response('data: ' + JSON.stringify(event) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const h = await harness(t, { responses: [response], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.deepEqual(run.failure, { code: 'generation_uncertain', stage: 'response' });
  assert.match(run.error, /shape: usage_with_choice; event 1/u);
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: null, outputTokens: null, totalsComplete: false });
  assert.doesNotMatch(JSON.stringify(run), /PRIVATE_FIXTURE_SECRET|private-upstream-id/u);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
  h.restart(); await h.step(); await h.step();
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('choice-frame provisional usage reaches a successful run using only final authoritative usage', async t => {
  const raw = { model: FIXTURE_MODEL, usage: { prompt_tokens: 10, completion_tokens: 20 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: fixtureText() } }] };
  const stream = new TextDecoder().decode(streamEnvelopeBytes(raw));
  const end = stream.indexOf('\n\n');
  assert(end > 0);
  const first = JSON.parse(stream.slice('data: '.length, end));
  first.usage = { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 };
  const response = new Response('data: ' + JSON.stringify(first) + stream.slice(end),
    { headers: { 'content-type': 'text/event-stream' } });
  const h = await harness(t, { responses: [response] });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: 10, outputTokens: 20, totalsComplete: true });
  assert.deepEqual(h.counts(), { model: 1, sandbox: 1 });
});

test('large envelopes do not raise final-source retention or allow an unretained repair', async t => {
  const response = completion('x'.repeat(70000), raw => { raw.choices[0].message.reasoning_content = 'AUTHORED_LARGE_REASONING_' + 'x'.repeat(200000); });
  const h = await harness(t, { responses: [response], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.generationAttempts[0].retention, 'size_limit');
  assert.equal(run.generationAttempts[0].responseText, null);
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: 10, outputTokens: 20, totalsComplete: true });
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
  assert.doesNotMatch(JSON.stringify(run), /AUTHORED_LARGE_REASONING|reasoning_content/u);
});

test('an unretained length response reports exhaustion and remains terminal without repair after reload',async t=>{
  // Synthetic transport only; no missing actual provider text is reconstructed.
  const response=completion('AUTHORED_PRIVATE_EXHAUSTED_SOURCE'+'x'.repeat(70000),raw=>{
    raw.choices[0].finish_reason='length';
    raw.usage.completion_tokens=32000;
    raw.usage.completion_tokens_details={reasoning_tokens:32000};
  });
  const h=await harness(t,{responses:[response],exits:[]});
  const run=await h.finish();
  assert.equal(run.status,'failed');
  assert.deepEqual(run.failure,{code:'invalid_model_output',stage:'tool_files'});
  assert.equal(run.error,'Nebius reached the output limit before completing the tool files.');
  assert.deepEqual(run.generationAttempts,[{attempt:1,outcome:'rejected',responseText:null,retention:'size_limit',
    diagnostic:{code:'invalid_model_output',stage:'tool_files',message:run.error}}]);
  assert.deepEqual(run.usage,{modelCalls:1,inputTokens:10,outputTokens:32000,totalsComplete:true});
  assert.deepEqual(run.files,[]);assert.deepEqual(run.checks,[]);
  assert.deepEqual(h.counts(),{model:1,sandbox:0});
  assert.equal(h.reservations.length,1);
  assert.doesNotMatch(JSON.stringify(run),/AUTHORED_PRIVATE|PRIVATE_REASONING|x{30}/u);
  const retained=await h.state();
  h.restart();await h.step();await h.step();
  assert.deepEqual(await h.state(),retained);
  assert.deepEqual(h.counts(),{model:1,sandbox:0});
  assert.equal(h.reservations.length,1);
});

test('unknown repair response retains the first call subtotal without fabricating completion', async t => {
  const h = await harness(t, { responses: ['bad first', new Error('Authored lost repair response')], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.deepEqual(run.usage, { modelCalls: 2, inputTokens: 10, outputTokens: 20, totalsComplete: false });
  assert.equal(run.generationAttempts.length, 1);
  assert.deepEqual(h.counts(), { model: 2, sandbox: 0 });
});

test('HTTP quota error stops at its observed response and never uses source repair', async t => {
  const h = await harness(t, { responses: [Response.json({ error: 'fixture' }, { status: 429 })], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.code, 'rate_limited');
  assert.equal(run.usage.totalsComplete, false);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

for (const rejected of [false, true]) test(`late ${rejected ? 'rejected' : 'valid'} response enriches an expired cancellation stop without restarting`, async t => {
  const h = await harness(t, { responses: [rejected ? 'bad late source' : fixtureText()], exits: [], onModel: async ({ run, storage }) => {
    assert.equal((await run.cancel(key)).ok, true);
    const pending = await storage.get('state');
    const clock = t.mock.method(Date, 'now', () => pending.submission.deadline + 1);
    try { await run.alarm(); } finally { clock.mock.restore(); }
    assert.equal((await run.read(key)).run.status, 'uncertain');
  } });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.equal(run.generationAttempts.length, 1);
  assert.equal(run.generationAttempts[0].outcome, rejected ? 'rejected' : 'accepted');
  assert.deepEqual(run.usage, { modelCalls: 1, inputTokens: 10, outputTokens: 20, totalsComplete: true });
  assert.deepEqual(run.files, []);
  assert.deepEqual(run.checks, []);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
  await h.step();
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

for (const phase of ['model-submitting', 'sandbox-submitting']) test(`restarted ${phase} never repeats an unknown submission`, async t => {
  const h = await harness(t, { responses: [], exits: [] });
  const state = await h.state();
  state.phase = phase;
  await h.storage.put('state', state);
  assert.equal((await h.finish()).status, 'uncertain');
  assert.deepEqual(h.counts(), { model: 0, sandbox: 0 });
});

test('daily quota refusal during repair retains evidence and does not count an unsubmitted call', async t => {
  const h = await harness(t, { responses: ['bad first'], exits: [], reserve: attempt => attempt === 1 });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.code, 'daily_limit');
  assert.equal(run.generationAttempts.length, 1);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
  assert.equal(run.usage.modelCalls, 1);
});

test('deadline reached during rejected response prevents repair', async t => {
  const h = await harness(t, { responses: ['bad first'], exits: [], onModel: async ({ storage }) => {
    const state = await storage.get('state'); state.deadline = Date.now() - 1; await storage.put('state', state);
  } });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.generationAttempts.length, 1);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('near-limit escaped response survives reload exactly within the serialized API ceiling', async t => {
  const rejected = '\u0001'.repeat(Math.floor((RUN_EVIDENCE_LIMITS.responseBytes - 2) / 6));
  const h = await harness(t, { responses: [rejected, fixtureText()] });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.equal(run.generationAttempts[0].responseText, rejected);
  assert.ok(runJsonBytes({ run }) < 512 * 1024);
  assert.deepEqual(await validateRunIntegrity(JSON.parse(JSON.stringify(run))), run);
});

test('oversize final text is explicitly omitted and cannot seed another call', async t => {
  const h = await harness(t, { responses: ['x'.repeat(70000)], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.equal(run.generationAttempts[0].retention, 'size_limit');
  assert.equal(run.generationAttempts[0].responseText, null);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

for (const [name, mutate] of [
  ['model mismatch', raw => { raw.model = 'nvidia/other-model'; }],
  ['missing usage', raw => { delete raw.usage; }],
  ['wrong role', raw => { raw.choices[0].message.role = 'user'; }],
  ['tool call', raw => { raw.choices[0].message.tool_calls = [{}]; }],
]) test(`unidentified ${name} response is never retained or used for repair`, async t => {
  const h = await harness(t, { responses: [completion('UNTRUSTED_MARKER', mutate)], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.equal(run.usage.totalsComplete, false);
  assert.deepEqual(run.generationAttempts, []);
  assert.doesNotMatch(JSON.stringify(run), /UNTRUSTED_MARKER/u);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('old response-format clients are rejected before any run admission', async () => {
  const response = await handleNebiusRuns(new Request('http://127.0.0.1/api/nebius/runs/config', {
    headers: { 'x-nebius-run-format': 'run-diagnostics.v1' },
  }), {});
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'run_format_changed');
  assert.match(body.error, /Reload/u);
  assert.equal(RUN_RECORD_FORMAT, 'run-diagnostics.v3');
});

test('a lost admitted POST survives a stale-format resume and is recovered by current GET', async t => {
  const h = await harness(t, { start: false });
  let rateAdmissions = 0, runAdmissions = 0;
  const env = { ...h.env, NEBIUS_EXECUTION_ENABLED: 'true', NEBIUS_ALLOWED_ORIGIN: 'http://127.0.0.1',
    NEBIUS_DAILY_CALL_LIMIT: '20', NEBIUS_DAILY_RUN_LIMIT: '3',
    NEBIUS_IP_RATE_LIMITER: { limit: async () => { rateAdmissions++; return { success: true }; } },
    NEBIUS_RUN_BUDGET: { getByName: () => ({ reserve: async () => { runAdmissions++; return true; } }) },
    NEBIUS_RUNS: { getByName: runId => { assert.equal(runId, id); return h.current(); } } };
  const request = (method, format) => new Request('http://127.0.0.1/api/nebius/runs/' + id, {
    method, headers: { 'content-type': 'application/json', 'x-nebius-run-format': format,
      authorization: 'Bearer ' + key, origin: 'http://127.0.0.1' },
    ...(method === 'POST' ? { body: JSON.stringify(FIXTURE_INPUT) } : {}) });
  const original = await handleNebiusRuns(request('POST', RUN_RECORD_FORMAT), env);
  assert.equal(original.status, 202);
  // The server admitted this POST, but the authored browser fixture loses its body.
  let localReference = { id, key, input: structuredClone(FIXTURE_INPUT), record: null };
  const saved = structuredClone(localReference), serverBefore = await h.state();
  const retry = await handleNebiusRuns(request('POST', 'run-diagnostics.v2'), env);
  const rejection = await retry.json();
  assert.equal(retry.status, 409);
  assert.equal(rejection.code, 'run_format_changed');
  // Frozen cached-client classification from the earlier published client.
  const cachedDefinitiveRejections = new Set(['400:invalid_request', '404:execution_disabled',
    '409:model_changed', '409:run_conflict', '409:run_input_changed', '429:rate_limited', '429:daily_limit']);
  if (cachedDefinitiveRejections.has(`${retry.status}:${rejection.code}`)) localReference = null;
  assert.deepEqual(localReference, saved, 'Cached clients must retain the ID, key and original snapshot.');
  assert.deepEqual(await h.state(), serverBefore);
  assert.equal(rateAdmissions, 1);
  assert.equal(runAdmissions, 1);
  const recovered = await handleNebiusRuns(request('GET', RUN_RECORD_FORMAT), env);
  assert.equal(recovered.status, 200);
  assert.deepEqual((await recovered.json()).run, serverBefore.record);
  assert.deepEqual(await h.state(), serverBefore);
  assert.deepEqual(h.counts(), { model: 0, sandbox: 0 });
  assert.equal(h.reservations.length, 0);
});

test('historical records normalize unknown generation evidence without inventing it', async t => {
  const h = await harness(t);
  const run = await h.finish(); delete run.generationAttempts;
  assert.deepEqual(validateRunRecord(run).generationAttempts, []);
  assert.throws(() => validateRunRecord({ ...run, generationAttempts: null }), /generation evidence/u);
});

test('source repair retains diagnostics and the two-call operation profiles', async t => {
  const h = await harness(t, { responses: ['Authored malformed first response', fixtureText()], onModel: async ({ attempt, body }) => {
    assert.equal(body.max_tokens, 32000);
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, {include_usage: true});
    assert.equal(body.response_format.json_schema.name, 'browser_tool_source');
    assert.deepEqual(body.chat_template_kwargs, attempt === 1
      ? {enable_thinking: true, low_effort: true, force_nonempty_content: true}
      : {enable_thinking: true, low_effort: true, force_nonempty_content: true});
  } });
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.deepEqual(h.counts(), {model: 2, sandbox: 1});
  assert.equal(run.events.filter(event => event.message.startsWith('Generation 1 response: ')).length, 1);
  assert.equal(run.events.filter(event => event.message.startsWith('Generation 2 response: ')).length, 1);
  assert.deepEqual(run.generationAttempts.map(entry => entry.outcome), ['rejected', 'accepted']);
  assert.deepEqual(run.usage, {modelCalls: 2, inputTokens: 20, outputTokens: 40, totalsComplete: true});
  await h.step();
  assert.deepEqual(h.counts(), {model: 2, sandbox: 1});
});

test('failed-check repair keeps both operation profiles and two checks without a third operation', async t => {
  const replacement = authoredCheckerFiles();
  replacement[1].content += '\n// Authored changed source for bounded repair state coverage.';
  const h = await harness(t, {responses: [fixtureText(), nativeFileBlocks(replacement)], exits: [1, 0], onModel: async ({ attempt, body }) => {
    assert.equal(body.max_tokens, 32000);
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, {include_usage: true});
    assert.equal(body.response_format.json_schema.name, attempt === 1 ? 'browser_tool_source' : 'browser_tool_replacements');
    assert.deepEqual(body.chat_template_kwargs, attempt === 1
      ? {enable_thinking: true, low_effort: true, force_nonempty_content: true}
      : {enable_thinking: true, low_effort: true, force_nonempty_content: true});
  }});
  const run = await h.finish();
  assert.equal(run.status, 'ready');
  assert.deepEqual(h.counts(), {model: 2, sandbox: 2});
  assert.deepEqual(run.checks.map(check => check.attempt), [1, 2]);
  assert.equal(run.events.filter(event => /^Generation [12] response: /u.test(event.message)).length, 2);
  assert.deepEqual(run.usage, {modelCalls: 2, inputTokens: 20, outputTokens: 40, totalsComplete: true});
  await h.step();
  assert.deepEqual(h.counts(), {model: 2, sandbox: 2});
});

test('failed Sandbox then rejected source stops without a third repair', async t => {
  const h=await harness(t,{responses:[fixtureText(),'bad repair'],exits:[1],onModel:({attempt,body})=>{
    assert.equal(body.max_tokens,32000);assert.equal(body.stream,true);assert.deepEqual(body.stream_options,{include_usage:true});
    assert.deepEqual(body.chat_template_kwargs,attempt===1
      ?{enable_thinking:true,low_effort:true,force_nonempty_content:true}:{enable_thinking:true,low_effort:true,force_nonempty_content:true});
    assert.equal(body.response_format.json_schema.name,attempt===1?'browser_tool_source':'browser_tool_replacements');
  }});
  const run=await h.finish();assert.equal(run.status,'failed');
  assert.deepEqual(h.counts(),{model:2,sandbox:1});assert.deepEqual(run.checks.map(check=>check.attempt),[1]);
  assert.deepEqual(run.generationAttempts.map(entry=>entry.outcome),['accepted','rejected']);
  assert.equal(run.generationAttempts[1].responseText,'bad repair');
  assert.deepEqual(run.usage,{modelCalls:2,inputTokens:20,outputTokens:40,totalsComplete:true});
  const stopped=await h.state();h.restart();await h.step();await h.step();
  assert.deepEqual(await h.state(),stopped);assert.deepEqual(h.counts(),{model:2,sandbox:1});
  assert.deepEqual(h.reservations.map(args=>args[2]),[1,2]);
});

test('second Sandbox submission uncertainty preserves prior checks and never repairs or resubmits', async t => {
  const responses=[0,1].map(index=>{const files=authoredCheckerFiles();files[1].content+=`\n// Authored response ${index}.`;return nativeFileBlocks(files);});
  const h=await harness(t,{responses,exits:[1,0],onSandbox:async({storage})=>{
    if((await storage.get('state')).record.attempt===2)throw new Error('Authored lost second Sandbox receipt');
  }});
  const run=await h.finish();assert.equal(run.status,'uncertain');
  assert.deepEqual(run.checks.map(check=>check.attempt),[1]);assert.equal(run.usage.totalsComplete,true);
  const stopped=await h.state();h.restart();await h.step();await h.step();
  assert.deepEqual(await h.state(),stopped);assert.deepEqual(h.counts(),{model:2,sandbox:2});
});

test('restored three-entry ready records keep exact source integrity, reject a fourth and retain the serialized cap', async () => {
  const {record:run}=await authoredThreeAttemptReference('ready');
  assert.equal(run.generationAttempts.length,3);assert.equal(run.checks.length,3);
  assert.deepEqual(await validateRunIntegrity(JSON.parse(JSON.stringify(run))),run);
  assert.throws(()=>validateRunRecord({...run,attempt:4}),/execution record is invalid/u);
  assert.throws(()=>validateRunRecord({...run,usage:{...run.usage,modelCalls:4}}),/execution usage is invalid/u);
  assert.throws(()=>validateRunRecord({...run,checks:[...run.checks,{...run.checks[2],attempt:4}]}),/check record is invalid/u);
  assert.throws(()=>validateRunRecord({...run,generationAttempts:[...run.generationAttempts,{...run.generationAttempts[2],attempt:4}]}),/generation evidence is invalid/u);
  const altered=structuredClone(run);altered.files[1].content+='\n// Authored tampering.';
  await assert.rejects(()=>validateRunIntegrity(altered),/source|digest/u);
  const oversized=structuredClone(run),escaped='\u0001';
  oversized.files=run.files.map((file,index)=>({...file,content:index<2?escaped.repeat(30000):'Authored bounded check source'}));
  oversized.generationAttempts=run.generationAttempts.map(entry=>({...entry,responseText:escaped.repeat(10922)}));
  assert(runJsonBytes(oversized)>RUN_EVIDENCE_LIMITS.recordBytes);
  assert(oversized.generationAttempts.every(entry=>runJsonBytes(entry.responseText)<=RUN_EVIDENCE_LIMITS.responseBytes));
  assert.throws(()=>validateRunRecord(oversized),/serialized size limit/u);
});

test('an unretained second response stays omitted and terminal after reload', async t => {
  const h=await harness(t,{responses:['bad first','x'.repeat(70000)],exits:[]});
  const run=await h.finish();assert.equal(run.status,'failed');assert.equal(run.usage.modelCalls,2);
  assert.deepEqual(run.generationAttempts.map(entry=>entry.retention),['retained','size_limit']);
  assert.equal(run.generationAttempts[1].responseText,null);assert.deepEqual(run.files,[]);assert.deepEqual(run.checks,[]);
  assert.doesNotMatch(JSON.stringify(run),/x{30}/u);
  const stopped=await h.state();h.restart();await h.step();assert.deepEqual(await h.state(),stopped);
  assert.deepEqual(h.counts(),{model:2,sandbox:0});
});

test('restored three near-limit escaped responses survive without increasing retention limits', async () => {
  const {record:run}=await authoredThreeAttemptReference('ready');
  const first='\u0001'.repeat(10922),second='\u0002'.repeat(10922);
  run.generationAttempts[0].responseText=first;run.generationAttempts[1].responseText=second;
  assert(runJsonBytes(run)<RUN_EVIDENCE_LIMITS.recordBytes);assert(runJsonBytes({run})<512*1024);
  assert.deepEqual(await validateRunIntegrity(JSON.parse(JSON.stringify(run))),run);
  assert.equal(run.generationAttempts.length,3);assert.equal(run.usage.modelCalls,3);
});

test('a confirmed two-call terminal failure cannot reopen under the three-call reader', async t => {
  const h=await harness(t,{responses:['bad first','bad second'],exits:[],reserve:attempt=>attempt<3});
  const run=await h.finish();assert.equal(run.status,'failed');assert.equal(run.usage.modelCalls,2);
  const stopped=await h.state();h.restart();await h.step();await h.step();
  const repeat=await h.current().startAdmitted(id,FIXTURE_INPUT,key,admission,20);
  assert.equal(repeat.ok,true);assert.equal(repeat.run.status,'failed');
  assert.deepEqual(await h.state(),stopped);assert.deepEqual(h.counts(),{model:2,sandbox:0});
});

test('execution budget admits daily counts 18 through 20 once per attempt and refuses any third or excess call', async()=>{
  const now=new Date('2026-10-28T12:00:00.000Z'),day='2026-10-28',data=new Map([['daily',{day,count:18}]]);
  const storage={async get(name){return structuredClone(data.get(name));},
    async list({prefix,limit}){return new Map([...data].filter(([name])=>name.startsWith(prefix)).slice(0,limit));},
    async put(name,value){if(typeof name==='string')data.set(name,structuredClone(value));else for(const [key,item]of Object.entries(name))data.set(key,structuredClone(item));},
    async delete(names){for(const name of Array.isArray(names)?names:[names])data.delete(name);},async transaction(fn){return fn(storage);}};
  const budget=new NebiusBudget({storage},{});
  for(const attempt of [1,2]){
    assert.equal(await budget.reserveExecution(id,admission,attempt,20,now),true);
    assert.deepEqual(data.get('daily'),{day,count:18+attempt});
    assert.equal(await budget.reserveExecution(id,admission,attempt,20,now),true);
    assert.deepEqual(data.get('daily'),{day,count:18+attempt},'Idempotent receipt does not charge twice');
  }
  const before=structuredClone(data);
  for(const attempt of [0,3,4,1.5])await assert.rejects(()=>budget.reserveExecution(id,admission,attempt,20,now),/Invalid execution budget request/u);
  assert.equal(await budget.reserveExecution(image,admission,1,20,now),false);
  assert.deepEqual(data,before,'No reset, refund or third receipt');
  assert.equal([...data.keys()].filter(name=>name.startsWith('execution:')).length,2);
  const legacyKey='execution:'+id+':'+admission+':3';
  data.set(legacyKey,{day,expiresAt:now.getTime()+60000});
  const historical=structuredClone(data);
  await assert.rejects(()=>budget.reserveExecution(id,admission,3,20,now),/Invalid execution budget request/u);
  assert.deepEqual(data,historical,'An old third-attempt receipt stays intact without authorizing a new call.');
  assert.equal(RUN_LIMITS.maxModelCalls,2);assert.equal(RUN_LIMITS.maxSandboxRuns,2);
});

test('known generation outcomes cannot contradict an observed check or ready state', async t => {
  const h = await harness(t);
  const run = await h.finish();
  const entry = run.generationAttempts[0];
  entry.outcome = 'rejected';
  entry.diagnostic = { code: 'invalid_model_output', stage: 'tool_files', message: 'Authored contradictory evidence fixture.' };
  assert.throws(() => validateRunRecord(run), /cannot reference rejected generation source/u);
  assert.throws(() => validateRunRecord({ ...run, status: 'checking' }), /cannot reference rejected generation source/u);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function lateErrorAfterWatchdog(t,message){
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const lateError=new RunProviderError('generation_timeout',message,true,'generation');
  const h=await harness(t,{onModel:async()=>{entered.resolve();await release.promise;throw lateError;},exits:[]});
  const active=h.step();await entered.promise;const pending=await h.state(),clock=t.mock.method(Date,'now',()=>pending.submission.deadline+1);
  try{await h.restart().alarm();}finally{clock.mock.restore();}
  release.resolve();await active;return {h,pending,lateError,retained:await h.state()};
}

// Method-overlap controls below are adversarial stale-callback tests, not a
// claim that Cloudflare normally runs simultaneous alarm handlers. The local
// workerd integration suite separately exercises real scheduled delivery.
test('pending submission reads and replayed handlers preserve its durable deadline', async t => {
  const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  const h = await harness(t, { onModel: async () => { entered.resolve(); await release.promise; } });
  const active = h.step(); await entered.promise;
  const pending = await h.state();
  assert.equal(pending.phase, 'model-submitting');
  assert.equal(await h.storage.getAlarm(), pending.submission.deadline);
  await h.current().read(key); await h.current().inspectStart(id, FIXTURE_INPUT, key);
  await h.restart().alarm();
  assert.equal((await h.state()).record.status, 'generating');
  assert.equal(await h.storage.getAlarm(), pending.submission.deadline);
  assert.deepEqual(h.counts(), {model:1,sandbox:0});
  release.resolve(); await active;
  assert.equal((await h.finish()).status, 'ready');
  assert.deepEqual(h.counts(), {model:1,sandbox:1});
});

test('two stale model-ready handlers make only one external model submission', async t => {
  const entered = deferred(), release = deferred(); t.after(() => release.resolve());
  const h = await harness(t, {onModel:async()=>{entered.resolve();await release.promise;}});
  const first=h.current().alarm(),second=h.current().alarm();await entered.promise;
  assert.equal(h.counts().model,1);release.resolve();await Promise.all([first,second]);
  assert.equal((await h.finish()).status,'ready');assert.deepEqual(h.counts(),{model:1,sandbox:1});
  assert(h.reservations.every(args=>args[2]===1));
});

test('two stale sandbox-ready handlers make only one Sandbox submission', async t => {
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const h=await harness(t,{onSandbox:async()=>{entered.resolve();await release.promise;}});await h.step();
  const first=h.current().alarm(),second=h.current().alarm();await entered.promise;
  assert.equal(h.counts().sandbox,1);release.resolve();await Promise.all([first,second]);
  assert.equal((await h.finish()).status,'ready');assert.deepEqual(h.counts(),{model:1,sandbox:1});
});

test('a restarted pending submission expires uncertain without resubmission', async t => {
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const h=await harness(t,{onModel:async()=>{entered.resolve();await release.promise;}});
  const first=h.step();await entered.promise;const pending=await h.state();
  await h.restart().alarm();assert.equal((await h.state()).phase,'model-submitting');
  const clock=t.mock.method(Date,'now',()=>pending.submission.deadline+1);
  try{await h.current().alarm();}finally{clock.mock.restore();}
  const stopped=await h.state();assert.equal(stopped.record.status,'uncertain');assert.equal(stopped.record.failure.code,'submission_receipt_deadline');assert.equal(stopped.record.usage.totalsComplete,false);
  release.resolve();await first;const late=await h.state();
  assert.equal(late.record.status,'uncertain');assert.equal(late.record.failure.code,'submission_receipt_deadline');assert.equal(late.record.usage.totalsComplete,true);
  assert.equal(late.record.files.length,0);assert.equal(late.record.checks.length,0);assert.equal(late.record.generationAttempts.length,1);
  assert.deepEqual(h.counts(),{model:1,sandbox:0});
});

test('second pending submission survives reload, expires uncertain and retains its late response without reopening',async t=>{
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const h=await harness(t,{responses:['bad first',fixtureText()],exits:[],onModel:async({attempt})=>{
    if(attempt===2){entered.resolve();await release.promise;}
  }});
  await h.step();const active=h.step();await entered.promise;
  const pending=await h.state();assert.equal(pending.record.usage.modelCalls,2);
  await h.restart().alarm();assert.equal((await h.state()).phase,'model-submitting');
  assert.deepEqual(h.counts(),{model:2,sandbox:0});assert.equal(await h.storage.getAlarm(),pending.submission.deadline);
  const clock=t.mock.method(Date,'now',()=>pending.submission.deadline+1);
  try{await h.current().alarm();}finally{clock.mock.restore();}
  assert.equal((await h.state()).record.status,'uncertain');
  release.resolve();await active;const late=await h.state();
  assert.equal(late.record.status,'uncertain');assert.equal(late.record.failure.code,'submission_receipt_deadline');
  assert.equal(late.record.usage.totalsComplete,true);assert.equal(late.record.generationAttempts.length,2);
  assert.deepEqual(late.record.files,[]);assert.deepEqual(late.record.checks,[]);
  h.restart();await h.step();await h.step();assert.deepEqual(await h.state(),late);
  assert.deepEqual(h.counts(),{model:2,sandbox:0});assert.deepEqual(h.reservations.map(args=>args[2]),[1,2]);
});

test('watchdog winner retains one bounded error-only late timeout audit without reopening or inventing evidence',async t=>{
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const lateError=new RunProviderError('generation_timeout','Late timeout\u0000 '+ 'x'.repeat(1000),true,'generation');
  const h=await harness(t,{onModel:async()=>{entered.resolve();await release.promise;throw lateError;},exits:[]});
  const active=h.step();await entered.promise;const pending=await h.state();
  const clock=t.mock.method(Date,'now',()=>pending.submission.deadline+1);
  try{await h.restart().alarm();}finally{clock.mock.restore();}
  const stopped=await h.state();assert.equal(stopped.record.status,'uncertain');assert.deepEqual(stopped.record.failure,{code:'submission_receipt_deadline',stage:'generation'});
  assert.deepEqual(stopped.record.usage,{modelCalls:1,inputTokens:null,outputTokens:null,totalsComplete:false});assert.deepEqual(stopped.record.generationAttempts,[]);
  release.resolve();await active;const retained=await h.state();
  assert.equal(retained.record.status,'uncertain');assert.deepEqual(retained.record.failure,stopped.record.failure);assert.deepEqual(retained.record.usage,stopped.record.usage);
  assert.deepEqual(retained.record.generationAttempts,[]);assert.deepEqual(retained.record.files,[]);assert.deepEqual(retained.record.checks,[]);
  assert.doesNotMatch(JSON.stringify(retained.record),/synthetic-fixture-key|synthetic-fixture-token/u);
  const prefix='Late generation failure evidence for attempt 1: ',events=retained.record.events.filter(event=>event.message.startsWith(prefix));assert.equal(events.length,1);
  assert(events[0].message.length<=240);assert.doesNotMatch(events[0].message,/\u0000/u);
  const audit=JSON.parse(events[0].message.slice(prefix.length));assert.deepEqual({...audit,message:undefined},{attempt:1,code:'generation_timeout',stage:'generation',message:undefined,responseObserved:false,usageObserved:false});
  assert.match(audit.message,/Late timeout/u);
  const before=JSON.stringify(retained.record);await h.current().retainLateGeneration(1,pending.submission.id,null,null,lateError);assert.equal(JSON.stringify((await h.state()).record),before);
  await h.current().retainLateGeneration(2,pending.submission.id,null,null,new RunProviderError('different_attempt','must not persist',true,'generation'));
  await h.current().retainLateGeneration(1,'00000000-0000-4000-8000-000000000099',null,null,new RunProviderError('wrong_owner','must not persist',true,'generation'));
  assert.equal(JSON.stringify((await h.state()).record),before);assert.deepEqual(h.counts(),{model:1,sandbox:0});
});

for(const[name,message]of[
  ['quotes and backslashes',('"\\'.repeat(500))],
  ['astral Unicode','😀'.repeat(500)],
  ['control characters','before\u0000\u0001\u001f\u007fafter'.repeat(100)],
])test(`late error audit remains complete JSON under ${name}`,async t=>{
  const {retained}=await lateErrorAfterWatchdog(t,message),prefix='Late generation failure evidence for attempt 1: ';
  const event=retained.record.events.find(item=>item.message.startsWith(prefix));assert(event);assert(event.message.length<=240);assert.equal(event.message.at(-1),'}');
  const audit=JSON.parse(event.message.slice(prefix.length));assert.equal(audit.code,'generation_timeout');assert.equal(audit.stage,'generation');assert.equal(audit.responseObserved,false);assert.equal(audit.usageObserved,false);
  assert.doesNotMatch(audit.message,/[\u0000-\u001f\u007f]/u);assert.deepEqual(retained.record.generationAttempts,[]);
});

async function holdReceived(h,t){
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const run=h.current(),original=run.commit.bind(run);
  t.mock.method(run,'commit',async(expected,update)=>{
    const saved=await original(expected,update);
    if(expected.phase==='model-submitting'&&saved?.phase==='model-validating'){entered.resolve();await release.promise;}
    return saved;
  });
  const active=h.step();await entered.promise;return {active,release};
}

test('known response survives a restored validator without another model call', async t => {
  const h=await harness(t);const held=await holdReceived(h,t);const pending=await h.state();
  assert.equal(pending.phase,'model-validating');assert.equal(pending.record.usage.totalsComplete,true);
  assert.equal(pending.pendingGeneration.response.responseText,fixtureText());
  assert.equal((await h.current().read(key)).run.files.length,0);
  assert.equal(Object.hasOwn((await h.current().read(key)).run,'pendingGeneration'),false);
  await h.restart().alarm();assert.equal((await h.state()).phase,'sandbox-ready');
  held.release.resolve();await held.active;
  assert.equal((await h.finish()).status,'ready');assert.deepEqual(h.counts(),{model:1,sandbox:1});
  assert.equal((await h.state()).pendingGeneration,null);
});

test('cancellation after receipt restoration classifies evidence and never starts Sandbox', async t => {
  const h=await harness(t,{exits:[]});const held=await holdReceived(h,t);
  await h.restart().cancel(key);const cancel=await h.state();
  assert.equal(cancel.phase,'model-validating');assert.match(cancel.record.events.at(-1).message,/Received source validation/);
  await h.current().alarm();const stopped=await h.state();
  assert.equal(stopped.record.status,'cancelled');assert.equal(stopped.record.generationAttempts.length,1);assert.equal(stopped.pendingGeneration,null);
  const before=JSON.stringify(stopped.record);held.release.resolve();await held.active;
  assert.equal(JSON.stringify((await h.state()).record),before);assert.deepEqual(h.counts(),{model:1,sandbox:0});
});

test('a restored rejected receipt schedules only the existing one repair', async t => {
  const files=authoredCheckerFiles();files[0].content=files[0].content.replace(' data-input-format="json"','');
  const text=nativeFileBlocks(files),h=await harness(t,{responses:[text,fixtureText()]});
  const held=await holdReceived(h,t);await h.restart().alarm();
  const rejected=await h.state();assert.equal(rejected.phase,'model-ready');assert.equal(rejected.record.generationAttempts.length,1);
  assert.equal(rejected.record.generationAttempts[0].outcome,'rejected');assert.equal(rejected.pendingGeneration,null);
  held.release.resolve();await held.active;
  assert.equal((await h.finish()).status,'ready');assert.deepEqual(h.counts(),{model:2,sandbox:1});
});

test('whole-run expiry during local validation retains known response without promoting a tool', async t => {
  const h=await harness(t,{exits:[]});const held=await holdReceived(h,t);const pending=await h.state();
  const clock=t.mock.method(Date,'now',()=>pending.deadline+1);
  try{await h.restart().alarm();}finally{clock.mock.restore();}
  const stopped=await h.state();assert.equal(stopped.record.status,'failed');assert.equal(stopped.record.usage.totalsComplete,true);
  assert.equal(stopped.record.generationAttempts[0].responseText,fixtureText());assert.equal(stopped.record.generationAttempts[0].outcome,'rejected');
  assert.equal(stopped.pendingGeneration,null);held.release.resolve();await held.active;
  assert.equal((await h.state()).record.status,'failed');assert.deepEqual(h.counts(),{model:1,sandbox:0});
});

test('a stale first-attempt owner cannot stop or rewrite a second submission', async t => {
  let old;const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const h=await harness(t,{responses:['bad first',fixtureText()],onModel:async({attempt,storage})=>{
    if(attempt===1)old=await storage.get('state');else{entered.resolve();await release.promise;}
  }});
  await h.step();const second=h.step();await entered.promise;
  const before=await h.state();assert.notEqual(before.submission.id,old.submission.id);
  await h.restart().finish(old,'failed','Stale attempt must not win','Stale source failure');
  await h.current().retainLateGeneration(1,old.submission.id,{inputTokens:999,outputTokens:999},null,null);
  assert.deepEqual(await h.state(),before);release.resolve();await second;
  assert.equal((await h.finish()).status,'ready');assert.deepEqual(h.counts(),{model:2,sandbox:1});
});

test('two cancellation handlers claim only one DELETE and preserve terminal evidence', async t => {
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const h=await harness(t,{onCancel:async()=>{entered.resolve();await release.promise;}});await h.step();await h.step();await h.current().cancel(key);
  const first=h.step();await entered.promise;assert.equal((await h.state()).cancelSubmitted,true);
  await h.restart().alarm();const terminal=await h.state();assert.equal(terminal.record.status,'cancelled');
  release.resolve();await first;assert.equal((await h.state()).record.checks.length,1);
  assert.equal(h.calls.filter(call=>call.method==='DELETE').length,1);assert.deepEqual(h.counts(),{model:1,sandbox:1});
});

test('simultaneous terminal observations record one check and one atomic outcome', async t => {
  const both=deferred(),release=deferred();let polls=0;t.after(()=>release.resolve());
  const h=await harness(t,{onPoll:async()=>{polls++;if(polls===2)both.resolve();await release.promise;}});await h.step();await h.step();
  const first=h.current().alarm(),second=h.current().alarm();await both.promise;release.resolve();await Promise.all([first,second]);
  const state=await h.state();assert.equal(state.phase,'retained');assert.equal(state.record.status,'ready');assert.equal(state.record.checks.length,1);
  assert.equal(await h.storage.getAlarm(),state.retentionAt);assert.deepEqual(h.counts(),{model:1,sandbox:1});
});

test('interruption after terminal-check commit leaves a complete idempotent result', async t => {
  const h=await harness(t);await h.step();await h.step();const run=h.current(),commit=run.commit.bind(run);let interrupted=false;
  t.mock.method(run,'commit',async(expected,update)=>{const saved=await commit(expected,update);if(!interrupted&&expected.phase==='sandbox-polling'&&saved?.phase==='retained'){interrupted=true;throw new Error('Authored interruption after atomic commit');}return saved;});
  await h.step();const before=await h.state();assert.equal(before.record.status,'ready');assert.equal(before.record.checks.length,1);
  await h.restart().alarm();assert.deepEqual((await h.state()).record,before.record);assert.deepEqual(h.counts(),{model:1,sandbox:1});
});

test('pending receipt is bounded, excludes reasoning and remains outside the public record', async t => {
  const files=authoredCheckerFiles();
  for(const [name,target]of [['app.js',30000],['checks.cjs',25000],['index.html',8000]]){
    const file=files.find(f=>f.path===name),line=name==='index.html'?'\n<!--'+'x'.repeat(880)+'-->':'\n//'+'x'.repeat(880);
    while(Buffer.byteLength(file.content)+Buffer.byteLength(line)<target)file.content+=line;
  }
  const text=nativeFileBlocks(files),raw=completion(text,envelope=>{envelope.choices[0].message.reasoning_content='REASONING_MUST_NOT_PERSIST_'+ 'r'.repeat(150000);});
  const h=await harness(t,{responses:[raw]});const held=await holdReceived(h,t),state=await h.state();
  assert(runJsonBytes(state.pendingGeneration)<210000);assert(runJsonBytes(state)<750000);
  assert.doesNotMatch(JSON.stringify(state),/REASONING_MUST_NOT_PERSIST|reasoning_content|synthetic-fixture-key/);
  assert.equal(Object.hasOwn((await h.current().read(key)).run,'pendingGeneration'),false);
  held.release.resolve();await held.active;assert.equal((await h.finish()).status,'ready');assert.equal((await h.state()).pendingGeneration,null);
});

test('a retried claim callback cannot return an ownership token that did not commit', async t => {
  const h=await harness(t,{responses:[],exits:[]}),run=h.current(),expected=await h.state();
  t.mock.method(h.storage,'transaction',async callback=>{
    await callback(h.storage);
    const competing=await h.state();competing.submission.id='00000000-0000-4000-8000-000000000099';
    await h.storage.put('state',competing);
    // Simulate a callback retry that discovers a different committed owner.
    await callback(h.storage);
  });
  const claimed=await run.claimSubmission(expected,'model-submitting',RUN_MODEL_TIMEOUT_MS,current=>({ ...current,
    usageBase:{...current.record.usage},record:{...current.record,status:'generating',usage:{modelCalls:1,inputTokens:null,outputTokens:null,totalsComplete:false}} }));
  assert.equal(claimed,null);assert.equal((await h.state()).submission.id,'00000000-0000-4000-8000-000000000099');
  assert.deepEqual(h.counts(),{model:0,sandbox:0});
});

test('an owned model claim that expires before fetch makes no request or counter refund', async t => {
  const h=await harness(t,{responses:[],exits:[]}),run=h.current(),claim=run.claimSubmission.bind(run);let clock;
  t.mock.method(run,'claimSubmission',async(...args)=>{const state=await claim(...args);clock=t.mock.method(Date,'now',()=>state.submission.responseDeadline+1);return state;});
  try{await h.step();}finally{clock?.mock.restore();}
  const state=await h.state();assert.equal(state.record.status,'failed');assert.equal(state.record.failure.code,'submission_deadline');
  assert.deepEqual(state.record.usage,{modelCalls:0,inputTokens:0,outputTokens:0,totalsComplete:true});
  assert.equal(h.reservations.length,1);assert.deepEqual(h.counts(),{model:0,sandbox:0});
});

for(const [name,mutate] of [
  ['missing owner', state=>{delete state.submission;}],
  ['wrong owner format',state=>{state.submission.id='invalid';}],
  ['wrong phase',state=>{state.submission.phase='sandbox-submitting';}],
  ['wrong attempt',state=>{state.submission.attempt=2;}],
  ['deadline beyond whole run',state=>{state.submission.deadline=state.deadline+1;}],
]) test(`malformed pending metadata (${name}) stops without another submission`,async t=>{
  const entered=deferred(),release=deferred();t.after(()=>release.resolve());
  const h=await harness(t,{onModel:async()=>{entered.resolve();await release.promise;},exits:[]});
  const first=h.step();await entered.promise;const state=await h.state();mutate(state);await h.storage.put('state',state);
  await h.restart().alarm();assert.equal((await h.state()).record.status,'uncertain');
  release.resolve();await first;assert.equal((await h.state()).record.status,'uncertain');assert.deepEqual(h.counts(),{model:1,sandbox:0});
});

test('cancellation during Sandbox submission preserves the eventual operation receipt',async t=>{
  const h=await harness(t,{onSandbox:async({run,storage})=>{
    await run.cancel(key);const pending=await storage.get('state');assert.equal(pending.phase,'sandbox-submitting');
    await run.alarm();assert.equal((await storage.get('state')).record.status,'cancelling');
  }});
  const result=await h.finish();assert.equal(result.status,'cancelled');
  assert.equal(h.calls.filter(call=>call.method==='DELETE').length,1);assert.deepEqual(h.counts(),{model:1,sandbox:1});
});


test('current configuration advertises two calls while record readers retain three',()=>{
  assert.deepEqual(RUN_RECORD_LIMITS,{maxModelCalls:3,maxSandboxRuns:3});
  assert.equal(RUN_LIMITS.maxModelCalls,2);assert.equal(RUN_LIMITS.maxSandboxRuns,2);
  const config={available:true,version:RUN_VERSION,requestedModel:FIXTURE_MODEL,limits:RUN_LIMITS};
  assert.equal(isRunConfig(config),true);
  assert.equal(isRunConfig({...config,limits:{...RUN_LIMITS,maxModelCalls:3,maxSandboxRuns:3}}),false);
});

for(const status of ['ready','failed','cancelled','uncertain'])test('restored three-attempt '+status+' record reads without new work',async t=>{
  const reference=await authoredThreeAttemptReference(status),h=await harness(t,{responses:[],exits:[]});
  const state=await h.state();state.record=reference.record;state.phase='retained';state.retentionAt=Date.now()+60000;
  await h.storage.put('state',state);const before=JSON.stringify(state.record);
  assert.deepEqual(await validateRunIntegrity(JSON.parse(before)),state.record);
  assert.equal(JSON.stringify((await h.current().read(key)).run),before);
  const env={NEBIUS_RUNS:{getByName:()=>h.current()}};
  const request=new Request('http://127.0.0.1/api/nebius/runs/'+id,{headers:{'x-nebius-run-format':RUN_RECORD_FORMAT,authorization:'Bearer '+key}});
  const response=await handleNebiusRuns(request,env);assert.equal(response.status,200);
  assert.equal(JSON.stringify((await response.json()).run),before);
  if(status==='ready'){
    const preview=await handleNebiusRuns(new Request('http://127.0.0.1/api/nebius/runs/'+id+'/preview',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:'http://127.0.0.1'},body:'key='+key}),env);
    assert.equal(preview.status,200);assert.match(preview.headers.get('content-type'),/text\/html/u);
  }
  h.restart();await h.step();await h.step();assert.equal(JSON.stringify((await h.state()).record),before);
  assert.deepEqual(h.counts(),{model:0,sandbox:0});assert.equal(h.reservations.length,0);
});

test('restored third-attempt pending state expires and retains late source usage and diagnostics without scheduling',async t=>{
  const reference=await authoredThreeAttemptReference('uncertain'),h=await harness(t,{responses:[],exits:[]});
  const record=reference.record,lateResponse=record.generationAttempts.pop();
  record.attempt=2;record.files[1].content=record.files[1].content.replace('Authored historical response 3.','Authored historical response 2.');
  record.usage={modelCalls:3,inputTokens:20,outputTokens:40,totalsComplete:false};
  const state=await h.state(),submissionId='00000000-0000-4000-8000-000000000099',startedAt=Date.now();
  record.createdAt=state.record.createdAt;record.updatedAt=state.record.updatedAt;record.status='generating';record.error=null;record.failure=null;
  Object.assign(state,{record,phase:'model-submitting',submission:{id:submissionId,phase:'model-submitting',attempt:3,startedAt,responseDeadline:startedAt+1000,deadline:startedAt+2000},
    usageBase:{modelCalls:2,inputTokens:20,outputTokens:40,totalsComplete:true}});
  await h.storage.put('state',state);
  await h.restart().alarm();assert.equal((await h.state()).phase,'model-submitting');
  assert.equal((await h.current().read(key)).run.usage.modelCalls,3);
  const clock=t.mock.method(Date,'now',()=>state.submission.deadline+1);
  try{await h.current().alarm();}finally{clock.mock.restore();}
  const stopped=await h.state();assert.equal(stopped.record.status,'uncertain');
  const originalFiles=structuredClone(record.files),originalChecks=structuredClone(record.checks),originalFailure=structuredClone(stopped.record.failure);
  const diagnostics=describeGenerationResponse({model:FIXTURE_MODEL,usage:{completion_tokens:20,completion_tokens_details:{reasoning_tokens:7}},
    choices:[{finish_reason:'stop',message:{role:'assistant',content:lateResponse.responseText}}]},FIXTURE_MODEL);
  assert.match(generationDiagnosticEvent(3,diagnostics).message,/^Generation 3 response:/u);
  assert.equal(generationDiagnosticEvent(4,diagnostics),null);
  await h.current().retainLateGeneration(3,submissionId,{inputTokens:10,outputTokens:20},
    {responseText:lateResponse.responseText,retention:'retained'},null,diagnostics);
  const late=await h.state();assert.equal(late.record.status,'uncertain');assert.deepEqual(late.record.failure,originalFailure);
  assert.deepEqual(late.record.files,originalFiles);assert.deepEqual(late.record.checks,originalChecks);
  assert.deepEqual(late.record.usage,{modelCalls:3,inputTokens:30,outputTokens:60,totalsComplete:true});
  assert.equal(late.record.generationAttempts.length,3);assert.deepEqual(late.record.generationAttempts[2],lateResponse);
  assert.equal(late.record.events.filter(event=>event.message.startsWith('Generation 3 response:')).length,1);
  const bytes=JSON.stringify(late);h.restart();await h.step();
  await h.current().retainLateGeneration(3,submissionId,{inputTokens:10,outputTokens:20},{responseText:lateResponse.responseText,retention:'retained'},null,diagnostics);
  assert.equal(JSON.stringify(await h.state()),bytes);assert.deepEqual(h.counts(),{model:0,sandbox:0});assert.equal(h.reservations.length,0);
});

for(const [phase,attempt,priorChecks]of [
  ['model-validating',3,2],['sandbox-ready',3,0],['sandbox-ready',3,1],['sandbox-ready',2,2],
])test(`restored ${phase} attempt ${attempt} with ${priorChecks} checks cannot submit beyond current limits`,async t=>{
  const reference=await authoredThreeAttemptReference('ready'),h=await harness(t,{responses:[],exits:[]});
  const state=await h.state(),record=structuredClone(reference.record),finalResponse=record.generationAttempts[2];
  record.createdAt=state.record.createdAt;record.updatedAt=state.record.updatedAt;
  record.status=phase==='model-validating'?'generating':'checking';record.checks=record.checks.slice(0,priorChecks);
  record.attempt=phase==='model-validating'?2:attempt;
  if(attempt===2){
    record.files[1].content=record.files[1].content.replace('Authored historical response 3.','Authored historical response 2.');
    record.usage={modelCalls:2,inputTokens:20,outputTokens:40,totalsComplete:true};record.generationAttempts=record.generationAttempts.slice(0,2);
  }
  Object.assign(state,{record,phase,sourceDigest:reference.record.checks.at(-1).sourceDigest});
  if(phase==='model-validating'){
    record.generationAttempts=record.generationAttempts.slice(0,2);
    const startedAt=Date.now();state.submission={id:'00000000-0000-4000-8000-000000000097',phase:'model-submitting',attempt:3,
      startedAt,responseDeadline:startedAt+1000,deadline:startedAt+2000};
    state.pendingGeneration={attempt:3,files:reference.record.files,response:{responseText:finalResponse.responseText,retention:'retained'}};
  }
  await h.storage.put('state',state);const run=await h.finish();
  assert.equal(run.status,'failed');assert.equal(run.failure.code,'run_limit');assert.equal(run.failure.stage,'sandbox');
  assert.equal(run.checks.length,priorChecks);assert.equal(run.usage.modelCalls,attempt);
  assert.equal(run.generationAttempts.length,attempt);assert.equal(run.files.length,3);
  if(attempt===3)assert.deepEqual(run.generationAttempts[2],finalResponse);
  const stopped=await h.state();h.restart();await h.step();await h.step();assert.deepEqual(await h.state(),stopped);
  assert.deepEqual(h.counts(),{model:0,sandbox:0});assert.equal(h.reservations.length,0);assert.equal(h.calls.length,0);
});

for(const exit of [0,1])test(`already-submitted historical third check retains observed exit ${exit} without another submission`,async t=>{
  const reference=await authoredThreeAttemptReference('ready'),last=reference.record.checks[2];
  const h=await harness(t,{responses:[],exits:[exit],restoredOperationIds:[last.operationId]});
  const state=await h.state(),record=structuredClone(reference.record);
  record.createdAt=state.record.createdAt;record.updatedAt=state.record.updatedAt;record.status='checking';record.checks=record.checks.slice(0,2);
  Object.assign(state,{record,phase:'sandbox-polling',operationId:last.operationId,sourceDigest:last.sourceDigest});
  await h.storage.put('state',state);const run=await h.finish();
  assert.equal(run.status,exit===0?'ready':'failed');assert.equal(run.checks.length,3);assert.equal(run.checks[2].attempt,3);
  assert.equal(run.checks[2].operationId,last.operationId);assert.equal(run.checks[2].exitCode,exit);assert.equal(run.usage.modelCalls,3);
  assert.deepEqual(run.generationAttempts,record.generationAttempts);assert.deepEqual(run.files,record.files);
  assert.deepEqual(h.counts(),{model:0,sandbox:0});assert.equal(h.reservations.length,0);
  assert.deepEqual(h.calls.map(call=>call.method),['GET']);
  const stopped=await h.state();h.restart();await h.step();assert.deepEqual(await h.state(),stopped);
});
