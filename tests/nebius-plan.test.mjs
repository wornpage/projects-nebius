import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNebiusApi } from '../worker/nebius-api.mjs';
import { TOKEN_FACTORY_URL, planWithNebius, suggestWithNebius, reviewWithNebius, validatePlan } from '../worker/nebius-provider.mjs';
import { PLAN_VERSION, PLAN_LIMITS, validatePlanInput, validateProjectPlan } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';
import { PROMPT_VERSION } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { REVIEW_VERSION } from '../svelte-frontend/src/lib/nebius-review-contract.mjs';

const model = 'nvidia/test-model';
const task = (id, dependsOn = null) => ({ id, title: 'Clarify requirements', purpose: 'Determine the needed facts.', nextStep: 'Ask for the missing requirements.', doneWhen: 'Requirements are confirmed.', dependsOn });
const plan = () => ({ title: 'Prepare a small project', summary: '', tasks: [task('clarify'), task('outline', 'clarify')], missingInformation: ['Confirmed scope'] });
const envelope = (value = plan()) => ({ model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }], usage: { prompt_tokens: 30, completion_tokens: 100 } });
function harness(t) {
  const h = { calls: 0, reservations: 0, admissions: 0 };
  h.env = { NEBIUS_ENABLED: 'true', NEBIUS_ALLOWED_ORIGIN: 'https://app.test', NEBIUS_MODEL_ROUTINE: model, NEBIUS_MODEL_REASONING: model, NEBIUS_API_KEY: 'synthetic-key', NEBIUS_DAILY_CALL_LIMIT: '2',
    NEBIUS_IP_RATE_LIMITER: { limit: async () => { h.admissions++; return { success: true }; } },
    NEBIUS_BUDGET: { idFromName: name => name, get: name => { h.bucket = name; return { reserve: async limit => { if (h.reservations >= limit) return false; h.reservations++; return true; } }; } },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => { h.calls++; h.sent = { url, options }; return Response.json(envelope()); });
  h.body = () => ({ brief: 'Prepare a small project.\nClarify missing requirements first.', requestedModel: model, promptVersion: PLAN_VERSION, consent: true });
  h.send = (body = h.body(), { operation = 'plan-project', headers = {}, method = 'POST', query = '' } = {}) => handleNebiusApi(new Request(`https://app.test/api/nebius/${operation}${query}`, {
    method, headers: { origin: 'https://app.test', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), h.env);
  return h;
}

test('brief contract is exact, nonempty, bounded and retains normal LF/tab', () => {
  const value = { brief: 'A brief\n\twith requirements.' };
  assert.deepEqual(validatePlanInput(value), value);
  assert.notEqual(validatePlanInput(value), value);
  assert.equal(validatePlanInput({ brief: 'x'.repeat(PLAN_LIMITS.brief) }).brief.length, 4000);
  for (const bad of [null, [], {}, { brief: '' }, { brief: ' \n\t' }, { brief: 5 }, { brief: 'x'.repeat(4001) }, { brief: 'Fine', extra: 'private' },
    ...['\u0000', '\r', '\u000b', '\u007f', '\u0085'].map(control => ({ brief: `bad${control}` }))]) assert.throws(() => validatePlanInput(bad));
});

test('manual and model plans share the validator, which makes a fresh projection', () => {
  const value = plan(), result = validateProjectPlan(value);
  assert.deepEqual(result, value); assert.notEqual(result, value); assert.notEqual(result.tasks[0], value.tasks[0]);
  result.tasks[0].title = 'Different'; result.missingInformation.push('Different');
  assert.equal(value.tasks[0].title, 'Clarify requirements'); assert.equal(value.missingInformation.length, 1);
  const multiline = { ...plan(), summary: 'Line one\nLine two', tasks: [{ ...task('one'), purpose: 'One\n\tTwo', doneWhen: 'One\nTwo' }] };
  assert.deepEqual(validateProjectPlan(multiline), multiline);
});

test('all plan field boundaries accept their maximum', () => {
  const value = { title: 'x'.repeat(120), summary: 'x'.repeat(600), tasks: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: 'x'.repeat(200), purpose: 'x'.repeat(1000), nextStep: 'x'.repeat(200), doneWhen: 'x'.repeat(1000), dependsOn: i ? `t${i - 1}` : null })), missingInformation: Array(5).fill('x'.repeat(200)) };
  assert.deepEqual(validateProjectPlan(value), value);
  assert.doesNotThrow(() => validateProjectPlan({ ...plan(), tasks: [task('a'.repeat(40))] }));
});

for (const [label, mutate] of [
  ['extra plan fields', p => { p.owner = 'Invented'; }], ['missing summary', p => { delete p.summary; }],
  ['empty title', p => { p.title = ' '; }], ['long title', p => { p.title = 'x'.repeat(121); }],
  ['long summary', p => { p.summary = 'x'.repeat(601); }], ['non-text summary', p => { p.summary = null; }],
  ['no tasks', p => { p.tasks = []; }], ['nine tasks', p => { p.tasks = Array.from({ length: 9 }, (_, i) => task(`t${i}`)); }],
  ['sparse tasks', p => { p.tasks = Array(1); }], ['extra task fields', p => { p.tasks[0].status = 'done'; }],
  ['missing predecessor field', p => { delete p.tasks[0].dependsOn; }], ['invalid id', p => { p.tasks[0].id = 'Wrong'; }],
  ['overlong id', p => { p.tasks[0].id = 'a'.repeat(41); }], ['duplicate id', p => { p.tasks[1].id = 'clarify'; }],
  ['self predecessor', p => { p.tasks[0].dependsOn = 'clarify'; }], ['unknown predecessor', p => { p.tasks[0].dependsOn = 'absent'; }],
  ['two predecessors', p => { p.tasks[0].dependsOn = ['outline']; }], ['cycle', p => { p.tasks[0].dependsOn = 'outline'; }],
  ['long cycle', p => { p.tasks = [task('one', 'three'), task('two', 'one'), task('three', 'two')]; }],
  ['too many missing facts', p => { p.missingInformation = Array(6).fill('Missing'); }],
  ['long missing fact', p => { p.missingInformation = ['x'.repeat(201)]; }], ['blank missing fact', p => { p.missingInformation = [' ']; }],
  ['sparse missing facts', p => { p.missingInformation = Array(1); }], ['task title newline', p => { p.tasks[0].title = 'Bad\n'; }],
  ['next step newline', p => { p.tasks[0].nextStep = 'Bad\n'; }], ['purpose control', p => { p.tasks[0].purpose = 'Bad\u0085'; }],
  ['criteria control', p => { p.tasks[0].doneWhen = 'Bad\r'; }], ['missing fact newline', p => { p.missingInformation = ['Bad\n']; }],
  ...['title', 'purpose', 'nextStep', 'doneWhen'].flatMap(field => [
    [`empty task ${field}`, p => { p.tasks[0][field] = ' '; }],
    [`long task ${field}`, p => { p.tasks[0][field] = 'x'.repeat((field === 'title' ? PLAN_LIMITS.taskTitle : PLAN_LIMITS[field]) + 1); }],
  ]),
]) test(`plan contract refuses ${label}`, () => { const value = plan(); mutate(value); assert.throws(() => validateProjectPlan(value)); });

test('config adds planVersion while preserving existing protocol fields and keeping credentials private', async t => {
  const h = harness(t), response = await h.send(undefined, { operation: 'config', method: 'GET', query: '?operation=plan-project' }), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.planVersion, PLAN_VERSION);
  assert.equal(body.promptVersion, PROMPT_VERSION); assert.equal(body.reviewVersion, REVIEW_VERSION); assert.equal(body.requestedModel, model);
  assert.equal(h.calls, 0); assert.equal(h.reservations, 0); assert.equal(h.admissions, 0);
  assert(!JSON.stringify(body).includes('synthetic-key'));
});

test('consented plan makes one bounded provider call and returns an unsaved validated proposal', async t => {
  const h = harness(t), input = h.body(), response = await h.send(input), body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.plan, plan()); assert.equal(body.applied, false);
  assert.equal(body.model, model); assert.equal(body.requestedModel, model); assert.equal(body.promptVersion, PLAN_VERSION);
  assert.deepEqual(body.usage, { input_tokens: 30, output_tokens: 100 }); assert.equal(typeof body.requestId, 'string');
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
  assert.equal(h.bucket, 'token-factory-daily'); assert.equal(h.sent.url, TOKEN_FACTORY_URL); assert.equal(h.sent.options.redirect, 'error');
  const sent = JSON.parse(h.sent.options.body);
  assert.deepEqual(JSON.parse(sent.messages[1].content), { brief: input.brief }); assert.equal(sent.messages.length, 2);
  assert.match(sent.messages[0].content, /project-plan.v1/); assert.match(sent.messages[0].content, /untrusted/);
  assert.equal(sent.max_tokens, 4000); assert.equal(sent.tools, undefined); assert.equal(sent.stream, false);
  assert.deepEqual(sent.response_format, { type: 'json_object' });
});

test('invalid input, consent, protocol and method are refused before budget/provider use', async t => {
  const h = harness(t);
  for (const [modify, status] of [[b => { b.consent = false; }, 400], [b => { delete b.consent; }, 400],
    [b => { b.extra = 'PRIVATE'; }, 400], [b => { b.brief = ''; }, 400], [b => { b.brief = 'x'.repeat(4001); }, 400],
    [b => { b.brief = 'bad\u0000'; }, 400], [b => { b.brief = {}; }, 400], [b => { b.requestedModel = 'nvidia/changed'; }, 409],
    [b => { b.promptVersion = PROMPT_VERSION; }, 409]]) {
    const body = h.body(); modify(body); assert.equal((await h.send(body)).status, status);
  }
  assert.equal((await h.send('bad JSON')).status, 400); assert.equal((await h.send('x'.repeat(49153))).status, 413);
  assert.equal((await h.send(undefined, { query: '?brief=private' })).status, 400);
  assert.equal((await h.send(undefined, { headers: { 'content-type': 'text/plain' } })).status, 400);
  assert.equal((await h.send(undefined, { method: 'GET' })).status, 404);
  assert.equal(h.calls, 0); assert.equal(h.reservations, 0);
});

for (const [label, modify, options, status] of [
  ['disabled', h => { h.env.NEBIUS_ENABLED = 'false'; }, {}, 404],
  ['missing key', h => { delete h.env.NEBIUS_API_KEY; }, {}, 503],
  ['missing origin config', h => { h.env.NEBIUS_ALLOWED_ORIGIN = ''; }, {}, 503],
  ['missing quota', h => { delete h.env.NEBIUS_BUDGET; }, {}, 503],
  ['bad daily bound', h => { h.env.NEBIUS_DAILY_CALL_LIMIT = '10001'; }, {}, 503],
  ['cross-site origin', () => {}, { headers: { origin: 'https://evil.test' } }, 403],
  ['absent origin', () => {}, { headers: { origin: '' } }, 403],
  ['cross-site fetch', () => {}, { headers: { 'sec-fetch-site': 'cross-site' } }, 403],
  ['missing edge IP', () => {}, { headers: { 'cf-connecting-ip': '' } }, 503],
  ['rate denial', h => { h.env.NEBIUS_IP_RATE_LIMITER.limit = async () => ({ success: false }); }, {}, 429],
  ['rate uncertainty', h => { h.env.NEBIUS_IP_RATE_LIMITER.limit = async () => ({}); }, {}, 503],
  ['rate exception', h => { h.env.NEBIUS_IP_RATE_LIMITER.limit = async () => { throw new Error('PRIVATE'); }; }, {}, 503],
  ['budget uncertainty', h => { h.env.NEBIUS_BUDGET.get = () => ({ reserve: async () => null }); }, {}, 503],
  ['budget exception', h => { h.env.NEBIUS_BUDGET.get = () => ({ reserve: async () => { throw new Error('PRIVATE'); } }); }, {}, 503],
]) test(`plan admission refuses ${label}`, async t => {
  const h = harness(t); modify(h); const response = await h.send(undefined, options);
  assert.equal(response.status, status); assert.equal(h.calls, 0); assert(!(await response.text()).includes('PRIVATE'));
});

test('planning and existing operations share the same daily reservation pool', async t => {
  const h = harness(t);
  assert.equal((await h.send()).status, 200);
  const pack = { title: 'Clarify', purpose: 'Confirm requirements', nextStep: 'Ask', blocker: 'None', doneWhen: 'Requirements confirmed' };
  // The synthetic plan response is invalid for a suggestion, but its real
  // provider attempt still consumes the second shared reservation.
  assert.equal((await h.send({ pack, context: [], currentStatus: 'active', update: '', requestedModel: model, promptVersion: PROMPT_VERSION, consent: true }, { operation: 'suggest-next-step' })).status, 502);
  assert.equal((await h.send()).status, 429); assert.equal(h.calls, 2); assert.equal(h.reservations, 2);
});

for (const [label, mutate] of [
  ['truncation', r => { r.choices[0].finish_reason = 'length'; }], ['model mismatch', r => { r.model = 'nvidia/other'; }],
  ['tool request', r => { r.choices[0].message.tool_calls = [{}]; }], ['malformed tools', r => { r.choices[0].message.tool_calls = {}; }],
  ['function call', r => { r.choices[0].message.function_call = {}; }], ['bad usage', r => { r.usage.completion_tokens = -1; }],
  ['missing usage', r => { delete r.usage; }], ['multiple choices', r => { r.choices.push(r.choices[0]); }],
  ['invalid JSON', r => { r.choices[0].message.content = 'PRIVATE'; }],
  ['invented fields', r => { r.choices[0].message.content = JSON.stringify({ ...plan(), owner: 'Invented' }); }],
  ['cyclic model plan', r => { const p = plan(); p.tasks[0].dependsOn = 'outline'; r.choices[0].message.content = JSON.stringify(p); }],
]) test(`provider plan refuses ${label}`, () => { const raw = envelope(); mutate(raw); assert.throws(() => validatePlan(raw, model), { code: 'invalid_model_output' }); });

test('invalid model plans produce no substitute or applied work', async t => {
  const h = harness(t);
  t.mock.method(globalThis, 'fetch', async () => { h.calls++; return Response.json(envelope({ ...plan(), tasks: [] })); });
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.code, 'invalid_model_output'); assert.equal(body.plan, undefined);
  assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
});

for (const status of [401, 403, 429, 500]) test(`provider ${status} is redacted, consumes budget and is not retried`, async t => {
  const h = harness(t);
  t.mock.method(globalThis, 'fetch', async () => { h.calls++; return new Response('PRIVATE secret provider detail', { status }); });
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, status === 429 ? 429 : 502); assert.equal(body.code, 'nebius_request_failed');
  assert(!JSON.stringify(body).includes('PRIVATE')); assert.equal(body.plan, undefined); assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
});

test('planning timeout aborts one stalled call with no retry', async () => {
  let calls = 0, signal;
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan' }, { timeoutMs: 10, fetcher: async (_, options) => { calls++; signal = options.signal; return new Promise(() => {}); } }), { code: 'inference_timeout' });
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});

test('planning response stream remains byte bounded and cancels excess output', async () => {
  let cancelled = false;
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan' }, { fetcher: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(140000)); }, cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }) }), { code: 'invalid_model_output' });
  assert.equal(cancelled, true);
});

test('suggestion and review retain their 1200-token provider allowance', async () => {
  const config = { model, apiKey: 'synthetic' }, pack = { title: 'Clarify', purpose: 'Confirm', nextStep: 'Ask', blocker: 'None', doneWhen: 'Requirements confirmed' };
  const state = { pack, context: [], currentStatus: 'active', update: '' };
  const suggestion = { changes: { nextStep: 'Ask for requirements.' }, reason: 'Requirements needed.', basis: ['title'], missingInformation: [] };
  const reviewState = { pack, criteria: [{ id: 'c1', text: pack.doneWhen }], evidence: 'Requirements confirmed' };
  const review = { checks: [{ id: 'c1', assessment: 'supported', reason: 'Claim is present.', quote: 'Requirements confirmed' }], consistency: { assessment: 'consistent', reason: 'No conflict in supplied text.' } };
  for (const [operation, input, output] of [[suggestWithNebius, state, suggestion], [reviewWithNebius, reviewState, review]]) {
    let sent;
    await operation(config, input, { fetcher: async (_, options) => { sent = JSON.parse(options.body); return Response.json(envelope(output)); } });
    assert.equal(sent.max_tokens, 1200); assert.equal(sent.tools, undefined);
  }
});
