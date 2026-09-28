import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { handleNebiusApi } from '../worker/nebius-api.mjs';
import { reserveDailyCall } from '../worker/nebius-budget.mjs';
import { suggestWithNebius, validateSuggestion, TOKEN_FACTORY_URL } from '../worker/nebius-provider.mjs';
import { projectTask, validateTask, validateSuggestionText, PROMPT_VERSION } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { REVIEW_VERSION } from '../svelte-frontend/src/lib/nebius-review-contract.mjs';
const model = 'nvidia/synthetic-model';
const pack = { title: 'Plan the handoff', purpose: 'Coordinate work', nextStep: 'Draft a date proposal.', blocker: 'No deadline', doneWhen: 'Owner approves the plan' };
const state = { pack, context: [], currentStatus: 'blocked', update: '' };
const proposal = () => ({ changes: { nextStep: 'Ask the owner to confirm the deadline.' }, reason: 'The deadline is missing.', basis: ['purpose', 'blocker'], missingInformation: ['Confirmed deadline'] });
const output = () => ({ model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(proposal()) } }], usage: { prompt_tokens: 30, completion_tokens: 20 } });
const reviewOutput = () => ({ model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ checks: [{ id: 'c1', assessment: 'partial', reason: 'A proposal is present but approval is missing.', quote: 'Owner sent a proposed date.' }], consistency: { assessment: 'consistent', reason: 'The supplied text does not conflict.' } }) } }], usage: { prompt_tokens: 45, completion_tokens: 30 } });
function harness(t) {
  const h = { calls: 0, reservations: 0 };
  h.env = { NEBIUS_ENABLED: 'true', NEBIUS_ALLOWED_ORIGIN: 'https://app.test', NEBIUS_MODEL_ROUTINE: model, NEBIUS_MODEL_REASONING: model, NEBIUS_API_KEY: 'synthetic-key', NEBIUS_DAILY_CALL_LIMIT: '2',
    NEBIUS_IP_RATE_LIMITER: { limit: async () => ({ success: true }) },
    NEBIUS_BUDGET: { idFromName: name => name, get: () => ({ reserve: async limit => { if (h.reservations >= limit) return false; h.reservations++; return true; } }) },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => { h.calls++; h.sent = { url, options }; return Response.json(output()); });
  h.body = () => ({ ...state, pack: { ...pack }, requestedModel: model, promptVersion: PROMPT_VERSION, consent: true });
  h.send = (method = 'POST', body = h.body(), headers = {}, operation = 'suggest-next-step') => handleNebiusApi(new Request(`https://app.test/api/nebius/${method === 'GET' ? `config?operation=${operation}` : operation}`, {
    method, headers: { origin: 'https://app.test', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }), h.env);
  return h;
}
test('configuration is read-only and never reveals credentials', async t => {
  const h = harness(t), response = await h.send('GET'), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.requestedModel, model);
  assert.equal(h.calls, 0); assert.equal(h.reservations, 0); assert(!JSON.stringify(body).includes('synthetic-key'));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('review sends selected criteria and evidence once, returning advisory findings only', async t => {
  const h = harness(t);
  t.mock.method(globalThis, 'fetch', async (url, options) => { h.calls++; h.sent = { url, options }; return Response.json(reviewOutput()); });
  const request = { consent: true, pack, review: { criteria: [{ id: 'c1', text: pack.doneWhen }], evidence: 'Owner sent a proposed date.' }, requestedModel: model, promptVersion: REVIEW_VERSION };
  const response = await h.send('POST', request, {}, 'review-evidence'), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.applied, false); assert.equal(body.review.checks[0].assessment, 'partial');
  assert.equal(body.review.selectedCount, 1); assert.equal(body.review.exhaustive, false);
  assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
  const sent = JSON.parse(h.sent.options.body);
  assert.deepEqual(JSON.parse(sent.messages[1].content), { pack, criteria: request.review.criteria, evidence: request.review.evidence });
});
test('review refuses altered criteria, missing consent and unsupported quotes before a task write', async t => {
  const h = harness(t);
  const base = { consent: true, pack, review: { criteria: [{ id: 'c1', text: pack.doneWhen }], evidence: 'Owner sent a proposed date.' }, requestedModel: model, promptVersion: REVIEW_VERSION };
  for (const body of [{ ...base, consent: false }, { ...base, review: { ...base.review, criteria: [{ id: 'wrong', text: pack.doneWhen }] } }, { ...base, review: { ...base.review, extra: 'PRIVATE' } }, { ...base, review: { ...base.review, evidence: '' } }]) {
    assert.equal((await h.send('POST', body, {}, 'review-evidence')).status, 400);
  }
  assert.equal(h.calls, 0); assert.equal(h.reservations, 0);
  t.mock.method(globalThis, 'fetch', async (url, options) => { h.calls++; h.sent = { url, options }; const raw = reviewOutput(); raw.choices[0].message.content = JSON.stringify({ checks: [{ id: 'c1', assessment: 'supported', reason: 'Claimed', quote: 'NOT_IN_EVIDENCE' }], consistency: { assessment: 'consistent', reason: 'Fine.' } }); return Response.json(raw); });
  assert.equal((await h.send('POST', base, {}, 'review-evidence')).status, 502);
});
test('consented request sends one bounded projection to the fixed Token Factory endpoint', async t => {
  const h = harness(t), response = await h.send(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.applied, false); assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
  assert.equal(h.sent.url, TOKEN_FACTORY_URL); assert.equal(h.sent.options.redirect, 'error');
  assert.equal(h.sent.options.headers.authorization, 'Bearer synthetic-key');
  const sent = JSON.parse(h.sent.options.body);
  assert.deepEqual(JSON.parse(sent.messages[1].content), state);
  assert.equal(sent.max_tokens, 1200); assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.equal(sent.tools, undefined); assert.equal(body.suggestion.changes.nextStep, 'Ask the owner to confirm the deadline.');
  assert.match(sent.messages[0].content, /task-change.v1/); assert.match(sent.messages[0].content, /clarification/);
});
for (const [label, modify, status] of [
  ['disabled', h => { h.env.NEBIUS_ENABLED = 'false'; }, 404],
  ['missing secret', h => { delete h.env.NEBIUS_API_KEY; }, 503],
  ['invalid model', h => { h.env.NEBIUS_MODEL_ROUTINE = 'other/model'; }, 503],
  ['missing origin', h => { h.env.NEBIUS_ALLOWED_ORIGIN = ''; }, 503],
  ['invalid daily limit', h => { h.env.NEBIUS_DAILY_CALL_LIMIT = 'unlimited'; }, 503],
  ['rate denial', h => { h.env.NEBIUS_IP_RATE_LIMITER.limit = async () => ({ success: false }); }, 429],
  ['rate unavailable', h => { h.env.NEBIUS_IP_RATE_LIMITER.limit = async () => { throw new Error('PRIVATE'); }; }, 503],
  ['budget unavailable', h => { h.env.NEBIUS_BUDGET.get = () => ({ reserve: async () => { throw new Error('PRIVATE'); } }); }, 503],
]) test(`no provider call when ${label}`, async t => {
  const h = harness(t); modify(h); const response = await h.send();
  assert.equal(response.status, status); assert.equal(h.calls, 0); assert(!(await response.text()).includes('PRIVATE'));
});
test('explicit consent, exact preview keys, model identity and origin are enforced before reserving budget', async t => {
  const h = harness(t);
  for (const body of [{ ...h.body(), consent: false }, { ...h.body(), model: 'nvidia/override' }, { ...h.body(), pack: { ...pack, memory: ['PRIVATE'] } }, { ...h.body(), requestedModel: 'nvidia/changed' }, { ...h.body(), pack: { ...pack, title: 'x'.repeat(201) } }, { ...h.body(), context: [{ kind: 'note', text: 'x'.repeat(1001) }] }, { ...h.body(), context: [{ kind: 'source', text: 'ok', private: 'PRIVATE' }] }, { ...h.body(), context: Array(4).fill({ kind: 'note', text: 'extra' }) }]) {
    assert([400, 409].includes((await h.send('POST', body)).status));
  }
  assert.equal((await h.send('POST', h.body(), { origin: 'https://evil.test' })).status, 403);
  assert.equal((await h.send('POST', h.body(), { origin: '' })).status, 403);
  assert.equal((await h.send('POST', h.body(), { 'cf-connecting-ip': '' })).status, 503);
  assert.equal((await h.send('POST', 'x'.repeat(49153))).status, 413);
  assert.equal(h.calls, 0); assert.equal(h.reservations, 0);
});
test('daily reservation prevents further requests even after a provider failure', async t => {
  const h = harness(t);
  await h.send(); await h.send(); assert.equal((await h.send()).status, 429);
  assert.equal(h.calls, 2); assert.equal(h.reservations, 2);
});
test('private fields are excluded by browser projection and refused if supplied directly', () => {
  assert.deepEqual(projectTask({ ...pack, memory: ['PRIVATE'], owner: 'PRIVATE', id: 'PRIVATE' }), pack);
  assert.throws(() => validateTask({ ...pack, memory: [] }));
});
for (const [label, mutate] of [
  ['truncation', raw => { raw.choices[0].finish_reason = 'length'; }],
  ['wrong model', raw => { raw.model = 'other/model'; }],
  ['tools', raw => { raw.choices[0].message.tool_calls = [{}]; }],
  ['malformed tools', raw => { raw.choices[0].message.tool_calls = {}; }],
  ['non-JSON text', raw => { raw.choices[0].message.content = 'PRIVATE'; }],
  ['oversized next step', raw => { raw.choices[0].message.content = JSON.stringify({ ...proposal(), changes: { nextStep: 'x'.repeat(201) } }); }],
  ['extra fields', raw => { raw.choices[0].message.content = JSON.stringify({ ...proposal(), save: true }); }],
  ['unselected context reference', raw => { raw.choices[0].message.content = JSON.stringify({ ...proposal(), basis: ['context:0'] }); }],
  ['duplicate basis', raw => { raw.choices[0].message.content = JSON.stringify({ ...proposal(), basis: ['title', 'title'] }); }],
  ['bad usage', raw => { raw.usage.prompt_tokens = -1; }],
]) test(`invalid provider output refuses ${label}`, () => {
  const raw = output(); mutate(raw); assert.throws(() => validateSuggestion(raw, model, state), { code: 'invalid_model_output' });
});
test('task-change protocol validates status and update before provider admission', async t => {
  const h = harness(t);
  for (const modify of [body => { delete body.currentStatus; }, body => { delete body.update; },
    body => { body.currentStatus = 'complete'; }, body => { body.update = 'x'.repeat(1001); },
    body => { body.update = null; }, body => { body.update = 'bad\u0000'; },
    body => { body.promptVersion = 'next-step.v3'; }]) {
    const body = h.body(); modify(body);
    assert([400, 409].includes((await h.send('POST', body)).status));
  }
  assert.equal(h.calls, 0); assert.equal(h.reservations, 0);
});
test('status and update are transmitted verbatim with selected context only', async t => {
  const h = harness(t), body = { ...h.body(), currentStatus: 'draft', update: 'A deadline is still needed.\nAsk the owner.', context: [{ kind: 'note', text: 'Owner confirmation pending.' }] };
  assert.equal((await h.send('POST', body)).status, 200);
  assert.deepEqual(JSON.parse(JSON.parse(h.sent.options.body).messages[1].content), {
    pack, currentStatus: body.currentStatus, update: body.update, context: body.context,
  });
});
test('valid typed changes preserve omission and cite only supplied status/update/context', () => {
  const input = { ...state, update: 'Owner confirmed the blocker is resolved.', context: [{ kind: 'note', text: 'Confirmation received.' }] };
  const value = { ...proposal(), changes: { nextStep: 'Draft the plan.', blocker: 'None', status: 'active' }, basis: ['currentStatus', 'update', 'context:0'] };
  assert.deepEqual(validateSuggestionText(value, input), value);
  const minimal = validateSuggestionText(proposal(), { ...state, currentStatus: 'active' });
  assert.deepEqual(Object.keys(minimal.changes), ['nextStep']);
  assert.doesNotThrow(() => validateSuggestionText({ ...proposal(), changes: { nextStep: 'Clarify the next task.', status: 'draft' } }, state));
});
for (const [label, changes, input = state] of [
  ['empty step', { nextStep: ' ' }], ['missing step', { blocker: 'None' }],
  ['button command', { nextStep: 'Ask', next: 'Start' }], ['save flag', { nextStep: 'Ask', save: true }],
  ['completion', { nextStep: 'Ask', status: 'done' }], ['unknown status', { nextStep: 'Ask', status: 'review' }],
  ['reopening done', { nextStep: 'Ask', status: 'active' }, { ...state, currentStatus: 'done' }],
  ['blank blocker', { nextStep: 'Ask', blocker: '' }], ['overlong blocker', { nextStep: 'Ask', blocker: 'x'.repeat(201) }],
  ['noncanonical clearance', { nextStep: 'Ask', blocker: 'none' }], ['padded clearance', { nextStep: 'Ask', blocker: ' None ' }],
  ['blocker controls', { nextStep: 'Ask', blocker: 'Wait\n' }], ['step controls', { nextStep: 'Ask\n' }],
  ['active with retained blocker', { nextStep: 'Ask', status: 'active' }],
  ['blocked with cleared blocker', { nextStep: 'Ask', blocker: 'None' }],
  ['active with new blocker', { nextStep: 'Ask', blocker: 'Wait' }, { ...state, currentStatus: 'active', pack: { ...pack, blocker: 'None' } }],
  ['blocked without blocker', { nextStep: 'Ask', status: 'blocked' }, { ...state, currentStatus: 'draft', pack: { ...pack, blocker: '' } }],
]) test(`typed proposal refuses ${label}`, () => {
  assert.throws(() => validateSuggestionText({ ...proposal(), changes }, input));
});
test('old output shape, empty update basis and malformed explanations are refused', () => {
  for (const value of [{ nextStep: 'Ask', reason: 'Why', basis: ['title'], missingInformation: [] },
    { ...proposal(), basis: ['update'] }, { ...proposal(), reason: 'x'.repeat(1001) },
    { ...proposal(), missingInformation: ['x'.repeat(201)] }, { ...proposal(), basis: ['currentStatus', 'update', 'context:0', 'title'] }]) {
    assert.throws(() => validateSuggestionText(value, state));
  }
});
test('provider error text is redacted, is not retried, and consumes the reservation', async t => {
  const h = harness(t);
  t.mock.method(globalThis, 'fetch', async () => { h.calls++; return new Response('PRIVATE', { status: 401 }); });
  const response = await h.send(); assert.equal(response.status, 502); assert(!(await response.text()).includes('PRIVATE'));
  assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
});
test('provider byte limit cancels an oversized stream', async () => {
  let cancelled = false;
  await assert.rejects(suggestWithNebius({ model, apiKey: 'synthetic' }, { pack }, { fetcher: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(40000)); }, cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }) }), { code: 'invalid_model_output' });
  assert.equal(cancelled, true);
});
test('provider timeout aborts one stalled request', async () => {
  let signal, calls = 0;
  await assert.rejects(suggestWithNebius({ model, apiKey: 'synthetic' }, { pack }, { timeoutMs: 10,
    fetcher: async (_, options) => { calls++; signal = options.signal; return new Promise(() => {}); },
  }), { code: 'inference_timeout' });
  assert.equal(signal.aborted, true); assert.equal(calls, 1);
});
test('serialized daily budget reserves no more than the limit and rolls over UTC day', async () => {
  let row, queue = Promise.resolve();
  const storage = { transaction(callback) { const result = queue.then(() => callback({ get: async () => row, put: async (_, value) => { row = value; } })); queue = result.catch(() => {}); return result; } };
  const now = new Date('2026-09-27T23:59:00Z');
  const attempts = await Promise.all(Array.from({ length: 15 }, () => reserveDailyCall(storage, 3, now)));
  assert.equal(attempts.filter(Boolean).length, 3); assert.equal(row.count, 3);
  assert.equal(await reserveDailyCall(storage, 3, new Date('2026-09-28T00:00:00Z')), true); assert.equal(row.count, 1);
  row.count = -1; await assert.rejects(reserveDailyCall(storage, 3, now));
});
test('service worker never caches or supplies offline fallbacks for model APIs', () => {
  const handlers = new Map();
  runInNewContext(readFileSync(new URL('../svelte-frontend/static/sw.js', import.meta.url), 'utf8'), {
    URL, self: { location: { origin: 'https://app.test' }, addEventListener: (name, callback) => handlers.set(name, callback) },
  });
  for (const [method, path] of [['GET', 'config'], ['POST', 'suggest-next-step']]) {
    let intercepted = false;
    handlers.get('fetch')({ request: { method, url: `https://app.test/api/nebius/${path}`, mode: 'cors' }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false);
  }
});
