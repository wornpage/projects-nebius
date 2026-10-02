import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { FIXTURE_INPUT, FIXTURE_MODEL, authoredCheckerFiles, nativeFileBlocks } from './fixtures/nebius-release-checker.mjs';
import { RUN_VERSION, RUN_RECORD_FORMAT, RUN_EVIDENCE_LIMITS, runJsonBytes, runSnapshotFromRecord, validateRunInput, validateToolInputRequirements, validateRunIntegrity, validateRunRecord } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

// Import the actual orchestration and provider parsers, replacing only the
// platform base class, storage, and HTTP transport. No credentials or generated
// program execution: every provider response is an authored fixture.
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
hooks.deregister();

const id = '00000000-0000-4000-8000-000000000001', admission = '00000000-0000-4000-8000-000000000002';
const image = '00000000-0000-4000-8000-000000000003', key = 'a'.repeat(64);
const fixtureText = () => nativeFileBlocks(authoredCheckerFiles());
function completion(content, mutate = () => {}) {
  const raw = { model: FIXTURE_MODEL, usage: { prompt_tokens: 10, completion_tokens: 20 },
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content, reasoning_content: 'PRIVATE_REASONING_NOT_RETAINED' } }] };
  mutate(raw);
  return Response.json(raw);
}

async function harness(t, { input = FIXTURE_INPUT, responses = [fixtureText()], exits = [0], reserve = () => true, onModel = async () => {}, onSandbox = async () => {} } = {}) {
  const data = new Map(); let alarmAt = null;
  const storage = {
    async get(name) { return structuredClone(data.get(name)); },
    async put(name, value) { data.set(name, structuredClone(value)); },
    async getAlarm() { return alarmAt; }, async setAlarm(value) { alarmAt = value; },
    async deleteAlarm() { alarmAt = null; }, async deleteAll() { data.clear(); },
    async transaction(fn) { return fn(storage); },
  };
  const calls = [], reservations = [], operationIds = [];
  const env = { NEBIUS_API_KEY: 'synthetic-fixture-key', NEBIUS_MODEL_REASONING: FIXTURE_MODEL,
    NEBIUS_SANDBOX_IAM_TOKEN: 'synthetic-fixture-token', NEBIUS_SANDBOX_PROJECT_ID: 'fixture-project', NEBIUS_SANDBOX_NODE_IMAGE_UUID: image,
    NEBIUS_BUDGET: { getByName: () => ({ reserveExecution: async (...args) => { reservations.push(args); return reserve(args[2]); } }) } };
  const current = () => new NebiusRun({ storage }, env);
  let modelCount = 0, sandboxCount = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options.method, body });
    if (url === 'https://api.tokenfactory.nebius.com/v1/chat/completions') {
      const position = modelCount++;
      assert.ok(position < responses.length, 'Unexpected extra model call.');
      await onModel({ attempt: position + 1, run: current(), storage, body });
      const response = responses[position];
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : completion(response);
    }
    if (url === 'https://api.tokenfactory.nebius.com/sandboxes/v1/instances') {
      const position = sandboxCount++;
      assert.ok(position < exits.length, 'Unexpected extra Sandbox submission.');
      await onSandbox({ run: current(), storage, body });
      const operationId = `00000000-0000-4000-8000-${String(position + 10).padStart(12, '0')}`;
      operationIds.push(operationId);
      return Response.json({ uuid: admission, image }, { status: 201, headers: { location: `/sandboxes/v1/operations/${operationId}` } });
    }
    const operation = operationIds.findIndex(value => url.endsWith('/operations/' + value));
    if (operation !== -1 && options.method === 'GET') {
      const exit = exits[operation];
      return Response.json({ uuid: operationIds[operation], kind: 'instance', status: exit === 0 ? 'SUCCESS' : 'FAILED',
        metadata: { image, result: { state: { exit_code: exit }, stdout: { encoding: 'ascii', value: 'Authored transport fixture only.' },
          stderr: { encoding: 'ascii', value: exit ? 'Authored failing check.' : '' } } } });
    }
    if (operation !== -1 && options.method === 'DELETE') return new Response(null, { status: 202 });
    assert.fail('Unmocked network request.');
  });
  const started = await current().startAdmitted(id, input, key, admission, 20);
  assert.equal(started.ok, true);
  return { storage, env, current, calls, reservations,
    counts: () => ({ model: modelCount, sandbox: sandboxCount }),
    state: () => storage.get('state'),
    async step() { await current().alarm(); const result = await storage.get('state'); await validateRunIntegrity(result.record); return result; },
    async finish() {
      for (let step = 0; step < 10; step++) {
        const result = await this.step();
        if (result.phase === 'retained') return result.record;
      }
      assert.fail('The bounded run did not finish.');
    },
  };
}

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
  assert.match(repair[0].content, /Return all three complete file blocks/u);
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

for (const exit of [0, 1]) test(`existing Sandbox repair remains bounded with second exit ${exit}`, async t => {
  // Transport/state test only: a changed response is not proof of a useful fix.
  const files = authoredCheckerFiles(); files[1].content += '\n// Authored second response for state-machine coverage.';
  const h = await harness(t, { responses: [fixtureText(), nativeFileBlocks(files)], exits: [1, exit] });
  const run = await h.finish();
  assert.equal(run.status, exit === 0 ? 'ready' : 'failed');
  assert.deepEqual(run.checks.map(check => check.attempt), [1, 2]);
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

test('source repair reaching its first failed Sandbox has no model call left', async t => {
  const h = await harness(t, { responses: ['bad first', fixtureText()], exits: [1] });
  const run = await h.finish();
  assert.equal(run.status, 'failed');
  assert.deepEqual(h.counts(), { model: 2, sandbox: 1 });
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
  const legacy = { ...missing, version: 'browser-tool.v1' };
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
    assert.match(body.messages[0].content, /task-owned input specification/u);
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
  run.version = 'browser-tool.v1'; delete run.requiredInputFormats;
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
  state.record.version = 'browser-tool.v1'; delete state.record.requiredInputFormats;
  await h.storage.put('state', state);
  const observed = await h.step();
  assert.equal(observed.phase, 'retained');
  assert.equal(observed.record.status, 'failed');
  assert.equal(observed.record.failure.code, 'run_input_changed');
  assert.deepEqual(h.counts(), { model: 0, sandbox: 0 });
  assert.equal(h.reservations.length, 0);
});

for (const attempt of [1, 2]) test(`cancellation during model response ${attempt} retains source but never advances`, async t => {
  const h = await harness(t, { responses: attempt === 1 ? [fixtureText()] : ['bad first', 'bad second'], exits: [],
    onModel: async ({ attempt: observed, run }) => { if (observed === attempt) assert.equal((await run.cancel(key)).ok, true); } });
  const run = await h.finish();
  assert.equal(run.status, 'cancelled');
  assert.equal(run.generationAttempts.length, attempt);
  assert.equal(run.usage.totalsComplete, true);
  assert.deepEqual(h.counts(), { model: attempt, sandbox: 0 });
});

test('unknown model response stops with incomplete usage and no retry', async t => {
  const h = await harness(t, { responses: [new Error('Authored lost-response fixture')], exits: [] });
  const run = await h.finish();
  assert.equal(run.status, 'uncertain');
  assert.equal(run.usage.totalsComplete, false);
  assert.deepEqual(run.generationAttempts, []);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
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

for (const rejected of [false, true]) test(`late ${rejected ? 'rejected' : 'valid'} response enriches a cancellation stop without restarting`, async t => {
  const h = await harness(t, { responses: [rejected ? 'bad late source' : fixtureText()], exits: [], onModel: async ({ run }) => {
    assert.equal((await run.cancel(key)).ok, true);
    await run.alarm();
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
  assert.equal(run.status, 'failed');
  assert.deepEqual(run.generationAttempts, []);
  assert.doesNotMatch(JSON.stringify(run), /UNTRUSTED_MARKER/u);
  assert.deepEqual(h.counts(), { model: 1, sandbox: 0 });
});

test('old response-format clients are rejected before any run admission', async () => {
  const response = await handleNebiusRuns(new Request('http://127.0.0.1/api/nebius/runs/config', {
    headers: { 'x-nebius-run-format': 'run-diagnostics.v1' },
  }), {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Reload/u);
  assert.equal(RUN_RECORD_FORMAT, 'run-diagnostics.v3');
});

test('historical records normalize unknown generation evidence without inventing it', async t => {
  const h = await harness(t);
  const run = await h.finish(); delete run.generationAttempts;
  assert.deepEqual(validateRunRecord(run).generationAttempts, []);
  assert.throws(() => validateRunRecord({ ...run, generationAttempts: null }), /generation evidence/u);
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
