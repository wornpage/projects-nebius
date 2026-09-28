import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNebiusApi, REPLAN_REQUEST_LIMIT } from '../worker/nebius-api.mjs';
import { replanWithNebius, validateReplan, TOKEN_FACTORY_URL } from '../worker/nebius-provider.mjs';
import { REPLAN_VERSION, REPLAN_LIMITS, validateProjectSnapshot, validateReplanInput, validateProjectReplan } from '../svelte-frontend/src/lib/nebius-replan-contract.mjs';
import { PLAN_VERSION } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';

const model = 'nvidia/test-model';
const task = (id, blockedBy = null) => ({ id, title: 'Clarify requirements', purpose: 'Confirm the facts.', nextStep: 'Ask for requirements.', doneWhen: 'Requirements confirmed.', status: blockedBy ? 'blocked' : 'active', blocker: blockedBy ? 'Waiting for predecessor' : 'None', blockedBy, archived: false });
const snapshot = () => ({ project: { id: 'project_1', title: 'Small project', summary: '' }, tasks: [task('project_1:first'), task('project_1:second', 'project_1:first')] });
const change = (original, fields = {}) => { const { archived, ...item } = original; return { ...item, nextStep: 'Ask for revised requirements.', reason: 'The update needs clarification.', ...fields }; };
const replan = (context = snapshot()) => ({ summary: 'Clarify the update before proceeding.', changes: [change(context.tasks[0])], missingInformation: ['Confirmed scope'] });
const envelope = (value = replan()) => ({ model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }], usage: { prompt_tokens: 40, completion_tokens: 100 } });
function harness(t) {
  const h = { calls: 0, reservations: 0, admissions: 0 };
  h.env = { NEBIUS_ENABLED: 'true', NEBIUS_ALLOWED_ORIGIN: 'https://app.test', NEBIUS_MODEL_ROUTINE: model, NEBIUS_MODEL_REASONING: model, NEBIUS_API_KEY: 'synthetic-key', NEBIUS_DAILY_CALL_LIMIT: '2',
    NEBIUS_IP_RATE_LIMITER: { limit: async () => { h.admissions++; return { success: true }; } },
    NEBIUS_BUDGET: { idFromName: name => name, get: name => { h.bucket = name; return { reserve: async limit => { if (h.reservations >= limit) return false; h.reservations++; return true; } }; } } };
  t.mock.method(globalThis, 'fetch', async (url, options) => { h.calls++; h.sent = { url, options }; const input = JSON.parse(JSON.parse(options.body).messages[1].content); return Response.json(envelope(replan(input.snapshot))); });
  h.body = () => ({ snapshot: snapshot(), update: 'The requirements changed.\nClarify the scope.', requestedModel: model, promptVersion: REPLAN_VERSION, consent: true });
  h.send = (body = h.body(), { operation = 'replan-project', headers = {}, method = 'POST', query = '' } = {}) => handleNebiusApi(new Request(`https://app.test/api/nebius/${operation}${query}`, { method,
    headers: { origin: 'https://app.test', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), h.env);
  return h;
}

test('snapshot/input/replan are copied, canonical, bounded and do not mutate caller data', () => {
  const original = snapshot(); original.tasks.reverse(); const result = validateProjectSnapshot(original);
  assert.equal(result.tasks[0].id, 'project_1:first'); assert.equal(original.tasks[0].id, 'project_1:second');
  result.project.title = 'Changed'; result.tasks[0].title = 'Changed'; assert.equal(original.project.title, 'Small project'); assert.equal(original.tasks[1].title, 'Clarify requirements');
  const context = snapshot(), proposal = replan(context), output = validateProjectReplan(proposal, context);
  assert.deepEqual(output, proposal); output.changes[0].title = 'Changed'; output.missingInformation.push('More');
  assert.equal(proposal.changes[0].title, 'Clarify requirements'); assert.equal(proposal.missingInformation.length, 1);
  assert.deepEqual(validateReplanInput({ snapshot: context, update: 'A\n\tB' }), { snapshot: context, update: 'A\n\tB' });
});

for (const [label, mutate] of [
  ['extra snapshot field', s => { s.extra = true; }], ['extra metadata', s => { s.project.owner = 'PRIVATE'; }],
  ['missing task field', s => { delete s.tasks[0].archived; }], ['extra task field', s => { s.tasks[0].projectId = 'elsewhere'; }],
  ['zero tasks', s => { s.tasks = []; }], ['nine tasks', s => { s.tasks = Array.from({ length: 9 }, (_, i) => task(`t${i}`)); }],
  ['sparse tasks', s => { s.tasks = Array(1); }], ['duplicate ids', s => { s.tasks[1].id = s.tasks[0].id; }],
  ['nonboolean archive', s => { s.tasks[0].archived = 'false'; }], ['bad status', s => { s.tasks[0].status = 'completed'; }],
  ['blank project id', s => { s.project.id = ' '; }], ['long project id', s => { s.project.id = 'x'.repeat(121); }],
  ['long task id', s => { s.tasks[0].id = 'x'.repeat(201); }], ['blank task id', s => { s.tasks[0].id = ''; }],
  ['dangling dependency', s => { s.tasks[1].blockedBy = 'another-project:id'; }],
  ['self dependency', s => { s.tasks[1].blockedBy = s.tasks[1].id; }],
  ['cycle', s => { s.tasks[0] = { ...s.tasks[0], status: 'blocked', blocker: 'Waiting', blockedBy: s.tasks[1].id }; }],
  ['active predecessor', s => { s.tasks[1].status = 'active'; }], ['blocked None', s => { s.tasks[1].blocker = ' None '; }],
  ['long title', s => { s.tasks[0].title = 'x'.repeat(201); }], ['empty purpose', s => { s.tasks[0].purpose = ' '; }],
  ['long purpose', s => { s.tasks[0].purpose = 'x'.repeat(1001); }], ['long step', s => { s.tasks[0].nextStep = 'x'.repeat(201); }],
  ['long criteria', s => { s.tasks[0].doneWhen = 'x'.repeat(1001); }], ['long blocker', s => { s.tasks[0].blocker = 'x'.repeat(201); }],
  ['project title newline', s => { s.project.title = 'Bad\n'; }], ['title control', s => { s.tasks[0].title = 'Bad\n'; }],
  ['purpose control', s => { s.tasks[0].purpose = 'Bad\u0085'; }], ['summary control', s => { s.project.summary = 'Bad\r'; }],
]) test(`snapshot refuses ${label}`, () => { const value = snapshot(); mutate(value); assert.throws(() => validateProjectSnapshot(value)); });

test('update requires exact keys and meaningful bounded text', () => {
  const context = snapshot(); assert.equal(validateReplanInput({ snapshot: context, update: 'x'.repeat(2000) }).update.length, 2000);
  for (const update of ['', ' \n\t', null, 1, 'x'.repeat(2001), 'Bad\u0000', 'Bad\u0085', 'Bad\r']) assert.throws(() => validateReplanInput({ snapshot: context, update }));
  for (const value of [null, {}, { snapshot: context, update: 'Fine', extra: true }]) assert.throws(() => validateReplanInput(value));
});
test('recognized saved no-blocker sentinel has canonical snapshot equality and cannot create a no-op edit', () => {
  const context = snapshot(); context.tasks[0].blocker = 'none'; const canonical = validateProjectSnapshot(context);
  assert.equal(canonical.tasks[0].blocker, 'None'); assert.equal(context.tasks[0].blocker, 'none');
  const value = replan(canonical); value.summary = ''; value.changes[0].nextStep = canonical.tasks[0].nextStep;
  assert.throws(() => validateProjectReplan(value, context)); value.changes[0].nextStep = 'Ask a new question.';
  assert.doesNotThrow(() => validateProjectReplan(value, context));
});

for (const [label, mutate] of [
  ['extra output', p => { p.project = 'replacement'; }], ['missing summary', p => { delete p.summary; }], ['no changes', p => { p.changes = []; }],
  ['sparse changes', p => { p.changes = Array(1); }], ['duplicate changes', p => { p.changes.push(structuredClone(p.changes[0])); }],
  ['new task', p => { p.changes[0].id = 'invented'; }], ['cross-project task', p => { p.changes[0].id = 'another:task'; }],
  ['completion', p => { p.changes[0].status = 'done'; }], ['draft status', p => { p.changes[0].status = 'draft'; }],
  ['extra task key', p => { p.changes[0].next = 'Done'; }], ['active blocker', p => { p.changes[0].blocker = 'Waiting'; }],
  ['active noncanonical None', p => { p.changes[0].blocker = 'none'; }], ['blocked without blocker', p => { p.changes[0].status = 'blocked'; }],
  ['blank blocker', p => { p.changes[0].status = 'blocked'; p.changes[0].blocker = ' '; }],
  ['active predecessor', p => { p.changes[0].blockedBy = 'project_1:second'; }],
  ['self predecessor', p => { Object.assign(p.changes[0], { status: 'blocked', blocker: 'Waiting', blockedBy: 'project_1:first' }); }],
  ['dangling predecessor', p => { Object.assign(p.changes[0], { status: 'blocked', blocker: 'Waiting', blockedBy: 'another:task' }); }],
  ['cycle through unchanged task', p => { Object.assign(p.changes[0], { status: 'blocked', blocker: 'Waiting', blockedBy: 'project_1:second' }); }],
  ['no-op', p => { p.changes[0].nextStep = snapshot().tasks[0].nextStep; }], ['long reason', p => { p.changes[0].reason = 'x'.repeat(401); }],
  ['blank reason', p => { p.changes[0].reason = ' '; }], ['reason control', p => { p.changes[0].reason = 'Bad\u0085'; }],
  ['long summary', p => { p.summary = 'x'.repeat(601); }],
  ['six missing entries', p => { p.missingInformation = Array(6).fill('More'); }], ['sparse missing', p => { p.missingInformation = Array(1); }],
  ['long missing', p => { p.missingInformation = ['x'.repeat(201)]; }], ['blank missing', p => { p.missingInformation = [' ']; }],
  ['multiline missing', p => { p.missingInformation = ['Bad\n']; }],
]) test(`replan refuses ${label}`, () => { const value = replan(); mutate(value); assert.throws(() => validateProjectReplan(value, snapshot())); });

test('done and archived tasks remain context only and cannot be reopened', () => {
  for (const field of ['status', 'archived']) { const context = snapshot(); context.tasks[0][field] = field === 'status' ? 'done' : true;
    assert.throws(() => validateProjectReplan(replan(context), context));
    assert.doesNotThrow(() => validateProjectReplan({ ...replan(context), changes: [change(context.tasks[1])] }, context)); }
});
test('valid multi-task changes are sorted and full changed graph may safely remove a dependency', () => {
  const context = snapshot(), value = replan(context); value.changes = [change(context.tasks[1], { status: 'active', blocker: 'None', blockedBy: null }), change(context.tasks[0], { status: 'blocked', blocker: 'Awaiting second task', blockedBy: context.tasks[1].id })];
  const result = validateProjectReplan(value, context); assert.equal(result.changes[0].id, context.tasks[0].id); assert.equal(context.tasks[1].blockedBy, context.tasks[0].id);
});
test('all maximum project/task/output boundaries accept without truncation', () => {
  const context = { project: { id: 'p'.repeat(120), title: 'x'.repeat(120), summary: 'x'.repeat(600) }, tasks: Array.from({ length: 8 }, (_, i) => ({ ...task(`${i}${'x'.repeat(199)}`), title: 'x'.repeat(200), purpose: 'x'.repeat(1000), nextStep: 'x'.repeat(200), doneWhen: 'x'.repeat(1000) })) };
  const value = { summary: 'x'.repeat(600), changes: context.tasks.map(t => change(t, { blocker: 'x'.repeat(200), status: 'blocked', reason: 'x'.repeat(400) })), missingInformation: Array(5).fill('x'.repeat(200)) };
  assert.deepEqual(validateProjectSnapshot(context), context); assert.deepEqual(validateProjectReplan(value, context), value); assert.equal(REPLAN_LIMITS.tasks, 8);
});

test('config exposes replan protocol without secrets or consuming quota', async t => {
  const h = harness(t), response = await h.send(undefined, { operation: 'config', method: 'GET', query: '?operation=replan-project' }), body = await response.json();
  assert.equal(body.replanVersion, REPLAN_VERSION); assert.equal(body.planVersion, PLAN_VERSION); assert.equal(h.calls + h.admissions + h.reservations, 0); assert(!JSON.stringify(body).includes('synthetic-key'));
});
test('replan submits exact canonical context once with bounded allowance and returns applied false', async t => {
  const h = harness(t), input = h.body(), response = await h.send(input), body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.replan, replan()); assert.equal(body.applied, false); assert.equal(body.model, model); assert.equal(body.requestedModel, model); assert.equal(body.promptVersion, REPLAN_VERSION);
  assert.deepEqual(body.usage, { input_tokens: 40, output_tokens: 100 }); assert.equal(typeof body.requestId, 'string'); assert.equal(h.calls, 1); assert.equal(h.reservations, 1); assert.equal(h.bucket, 'token-factory-daily');
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(h.sent.url, TOKEN_FACTORY_URL); assert.equal(h.sent.options.redirect, 'manual');
  const sent = JSON.parse(h.sent.options.body); assert.deepEqual(JSON.parse(sent.messages[1].content), { snapshot: input.snapshot, update: input.update }); assert.equal(sent.max_tokens, 4000); assert.equal(sent.stream, false); assert.equal(sent.tools, undefined); assert.equal(sent.messages.length, 2); assert.match(sent.messages[0].content, /untrusted/); assert.match(sent.messages[0].content, /project-replan.v1/);
});
test('input/consent/model/method/body refusals precede provider and budget use', async t => {
  const h = harness(t);
  for (const [mutate, status] of [[b => { b.consent = false; }, 400], [b => { b.extra = 'PRIVATE'; }, 400], [b => { delete b.consent; }, 400], [b => { b.update = ''; }, 400], [b => { b.snapshot.tasks = []; }, 400], [b => { b.requestedModel = 'nvidia/changed'; }, 409], [b => { b.promptVersion = PLAN_VERSION; }, 409]]) { const value = h.body(); mutate(value); assert.equal((await h.send(value)).status, status); }
  assert.equal((await h.send('Bad JSON')).status, 400); assert.equal((await h.send('x'.repeat(REPLAN_REQUEST_LIMIT + 1))).status, 413); assert.equal((await h.send(undefined, { query: '?snapshot=PRIVATE' })).status, 400); assert.equal((await h.send(undefined, { headers: { 'content-type': 'text/plain' } })).status, 400); assert.equal((await h.send(undefined, { method: 'GET' })).status, 404); assert.equal(h.calls + h.reservations, 0);
});
for (const [label, modify, headers, status] of [
  ['disabled', h => { h.env.NEBIUS_ENABLED = 'false'; }, {}, 404], ['missing credential', h => { delete h.env.NEBIUS_API_KEY; }, {}, 503],
  ['origin config absent', h => { h.env.NEBIUS_ALLOWED_ORIGIN = ''; }, {}, 503], ['missing rate limit', h => { delete h.env.NEBIUS_IP_RATE_LIMITER; }, {}, 503],
  ['missing budget', h => { delete h.env.NEBIUS_BUDGET; }, {}, 503], ['daily cap invalid', h => { h.env.NEBIUS_DAILY_CALL_LIMIT = '10001'; }, {}, 503],
  ['wrong origin', () => {}, { origin: 'https://other.test' }, 403], ['cross-site', () => {}, { 'sec-fetch-site': 'cross-site' }, 403], ['missing ip', () => {}, { 'cf-connecting-ip': '' }, 503],
  ['rate refused', h => { h.env.NEBIUS_IP_RATE_LIMITER.limit = async () => ({ success: false }); }, {}, 429], ['rate unknown', h => { h.env.NEBIUS_IP_RATE_LIMITER.limit = async () => null; }, {}, 503],
  ['budget refused', h => { h.env.NEBIUS_BUDGET.get = () => ({ reserve: async () => false }); }, {}, 429], ['budget unknown', h => { h.env.NEBIUS_BUDGET.get = () => ({ reserve: async () => null }); }, {}, 503],
]) test(`API shares ${label} guard`, async t => { const h = harness(t); modify(h); assert.equal((await h.send(undefined, { headers })).status, status); assert.equal(h.calls, 0); });

for (const [label, modify] of [
  ['model identity', raw => { raw.model = 'nvidia/other'; }], ['truncation', raw => { raw.choices[0].finish_reason = 'length'; }],
  ['tool call', raw => { raw.choices[0].message.tool_calls = [{}]; }], ['function call', raw => { raw.choices[0].message.function_call = {}; }],
  ['extra choice', raw => { raw.choices.push(raw.choices[0]); }], ['wrong role', raw => { raw.choices[0].message.role = 'user'; }],
  ['invalid JSON', raw => { raw.choices[0].message.content = 'PRIVATE'; }], ['missing usage', raw => { delete raw.usage; }],
  ['invalid output', raw => { raw.choices[0].message.content = JSON.stringify({ ...replan(), extra: 'PRIVATE' }); }],
]) test(`provider refuses ${label} without raw content`, () => { const raw = envelope(); modify(raw); assert.throws(() => validateReplan(raw, model, { snapshot: snapshot() }), error => error.code === 'invalid_model_output' && !error.message.includes('PRIVATE')); });
test('provider errors are sanitized and receive no retry', async t => {
  const h = harness(t); t.mock.method(globalThis, 'fetch', async () => { h.calls++; return new Response('PRIVATE DATA', { status: 500 }); });
  const response = await h.send(), body = await response.json(); assert.equal(response.status, 502); assert.equal(body.code, 'nebius_request_failed'); assert(!JSON.stringify(body).includes('PRIVATE')); assert.equal(h.calls, 1);
});
test('replan timeout aborts the single stalled call', async () => {
  let calls = 0, signal; await assert.rejects(replanWithNebius({ model, apiKey: 'synthetic' }, { snapshot: snapshot(), update: 'Clarify' }, { timeoutMs: 10, fetcher: async (_, options) => { calls++; signal = options.signal; return new Promise(() => {}); } }), { code: 'inference_timeout' }); assert.equal(calls, 1); assert.equal(signal.aborted, true);
});
test('128 KiB provider output cap cancels overflowing streams', async () => {
  let cancelled = false; await assert.rejects(replanWithNebius({ model, apiKey: 'synthetic' }, { snapshot: snapshot(), update: 'Clarify' }, { fetcher: async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(131073)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }) }), { code: 'invalid_model_output' }); assert.equal(cancelled, true);
});
test('160 KiB endpoint cap fits full allowed UTF8 and JSON-escaped snapshots; old operations keep49 KiB', async t => {
  const h = harness(t), full = h.body(), fill = '\ud800';
  full.snapshot.project = { id: fill.repeat(120), title: fill.repeat(120), summary: fill.repeat(600) };
  full.snapshot.tasks = Array.from({ length: 8 }, (_, i) => ({ id: fill.repeat(199) + String.fromCharCode(0xd800 + i), title: fill.repeat(200), purpose: fill.repeat(1000), nextStep: fill.repeat(200), doneWhen: fill.repeat(1000), status: 'blocked', blocker: fill.repeat(200), blockedBy: i ? fill.repeat(199) + String.fromCharCode(0xd800 + i - 1) : null, archived: false }));
  full.update = fill.repeat(2000); full.requestedModel = 'nvidia/' + 'x'.repeat(151); h.env.NEBIUS_MODEL_REASONING = full.requestedModel;
  const length = Buffer.byteLength(JSON.stringify(full)); assert.equal(length, 161159); assert(length > 49152); assert(length <= REPLAN_REQUEST_LIMIT); assert.doesNotThrow(() => validateReplanInput({ snapshot: full.snapshot, update: full.update }));
  // Sanitized invalid model output still proves input passed admission/provider.
  const response = await h.send(full); assert.equal(response.status, 502); assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
  assert.equal((await h.send('x'.repeat(49153), { operation: 'plan-project' })).status, 413);
});
