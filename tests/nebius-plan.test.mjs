import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNebiusApi } from '../worker/nebius-api.mjs';
import { TOKEN_FACTORY_URL, planWithNebius, suggestWithNebius, reviewWithNebius, validatePlan } from '../worker/nebius-provider.mjs';
import { PLAN_GROUNDING_VERSION, PLAN_VERSION, PLAN_LIMITS, validatePlanInput, validateProjectPlan, validateAuthoredProjectPlan } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';
import { PROMPT_VERSION } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { REVIEW_VERSION } from '../svelte-frontend/src/lib/nebius-review-contract.mjs';

const model = 'nvidia/test-model';
const task = (id, dependsOn = null) => ({ id, title: 'Clarify requirements', purpose: 'Determine the needed facts.', nextStep: 'Ask for the missing requirements.', doneWhen: 'Requirements are confirmed.', dependsOn });
const plan = () => ({ title: 'Prepare a small project', summary: '', tasks: [task('clarify'), task('outline', 'clarify')], missingInformation: ['Confirmed scope'] });
const groundedReview = () => ({ assessment: 'grounded', findings: [] });
const envelope = (value = plan()) => ({ model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }], usage: { prompt_tokens: 30, completion_tokens: 100 } });
function harness(t) {
  const h = { calls: 0, reservations: 0, admissions: 0, requests: [] };
  h.env = { NEBIUS_ENABLED: 'true', NEBIUS_ALLOWED_ORIGIN: 'https://app.test', NEBIUS_MODEL_ROUTINE: model, NEBIUS_MODEL_REASONING: model, NEBIUS_API_KEY: 'synthetic-key', NEBIUS_DAILY_CALL_LIMIT: '2',
    NEBIUS_IP_RATE_LIMITER: { limit: async () => { h.admissions++; return { success: true }; } },
    NEBIUS_BUDGET: { idFromName: name => name, get: name => { h.bucket = name; return { reserve: async limit => { if (h.reservations >= limit) return false; h.reservations++; return true; } }; } },
  };
  h.respond = sent => Response.json(envelope(Object.hasOwn(JSON.parse(sent.messages[1].content), 'plan') ? groundedReview() : plan()));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    h.calls++; const sent = JSON.parse(options.body); h.sent = { url, options, body: sent }; h.requests.push(h.sent); return h.respond(sent, h.calls);
  });
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

test('consented plan makes two sequential bounded calls and returns only the reviewed proposal', async t => {
  const h = harness(t), input = h.body(), response = await h.send(input), body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.plan, plan()); assert.equal(body.applied, false);
  assert.equal(body.model, model); assert.equal(body.requestedModel, model); assert.equal(body.groundingModel, model);
  assert.equal(body.promptVersion, PLAN_VERSION); assert.equal(body.groundingVersion, PLAN_GROUNDING_VERSION);
  assert.equal(body.outcome, 'reviewable'); assert.deepEqual(body.groundingReview, groundedReview());
  assert.deepEqual(body.usage, { input_tokens: 60, output_tokens: 200 }); assert.equal(typeof body.requestId, 'string');
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(h.calls, 2); assert.equal(h.reservations, 2);
  assert.equal(h.bucket, 'token-factory-daily'); assert(h.requests.every(item => item.url === TOKEN_FACTORY_URL && item.options.redirect === 'manual'));
  const sent = h.requests[0].body, reviewSent = h.requests[1].body;
  assert.deepEqual(JSON.parse(sent.messages[1].content), { brief: input.brief }); assert.equal(sent.messages.length, 2);
  assert(sent.messages[0].content.includes(PLAN_VERSION)); assert.match(sent.messages[0].content, /untrusted/);
  assert.equal(sent.max_tokens, 4000); assert.equal(reviewSent.max_tokens, 2000); assert.equal(sent.tools, undefined); assert.equal(sent.stream, false);
  assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.deepEqual(JSON.parse(reviewSent.messages[1].content), { brief: input.brief, plan: plan() });
  assert.deepEqual(body.planningTrace.stages.map(stage => [stage.stage, stage.reservation, stage.outcome]),
    [['plan', 'reserved', 'passed'], ['grounding-review', 'reserved', 'passed']]);
});

test('a model-blocked review is HTTP 200 read-only evidence with the exact hash-bound candidate', async t => {
  const h = harness(t);
  const finding = { category: 'unsupported_detail', planPath: '/tasks/0/nextStep', planQuote: 'Ask for the missing requirements.',
    briefQuote: '', reason: 'The brief does not choose this method.' };
  h.respond = (sent, call) => Response.json(envelope(call === 1 ? plan() : { assessment: 'not_grounded', findings: [finding] }));
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.outcome, 'blocked'); assert.equal(body.plan, null);
  assert.deepEqual(body.diagnosticCandidate.plan, plan()); assert.match(body.diagnosticCandidate.candidateDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(body.groundingReview, { assessment: 'not_grounded', findings: [finding] });
  assert.deepEqual(body.planningTrace.stages.map(stage => stage.outcome), ['passed', 'blocked']);
  assert.equal(JSON.stringify(body).includes('editable'), false); assert.equal(h.calls, 2); assert.equal(h.reservations, 2);
});

test('a refused second reservation preserves known plan usage and dispatches no review', async t => {
  const h = harness(t); h.env.NEBIUS_DAILY_CALL_LIMIT = '1';
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 429); assert.equal(body.outcome, 'failed'); assert.equal(body.plan, null);
  assert.deepEqual(body.diagnosticCandidate.plan, plan()); assert.deepEqual(body.usage, { input_tokens: 30, output_tokens: 100 });
  assert.equal(body.usageUnknown, false); assert.equal(body.planningTrace.providerAttempts, 1);
  assert.deepEqual(body.planningTrace.stages.map(stage => [stage.reservation, stage.outcome]), [['reserved', 'passed'], ['refused', 'refused']]);
  assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
});

test('an unknown second reservation remains unknown while retaining first-stage evidence', async t => {
  const h = harness(t); let attempts = 0;
  h.env.NEBIUS_BUDGET.get = () => ({ reserve: async () => ++attempts === 1 ? true : null });
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.outcome, 'failed'); assert.equal(body.plan, null);
  assert.deepEqual(body.diagnosticCandidate.plan, plan()); assert.deepEqual(body.usage, { input_tokens: 30, output_tokens: 100 });
  assert.equal(body.planningTrace.unknownReservations, 1); assert.equal(body.planningTrace.stages[1].reservation, 'unknown');
  assert.equal(body.planningTrace.stages[1].providerAttempted, false); assert.equal(h.calls, 1); assert.equal(attempts, 2);
});

test('a malformed grounding review preserves both known calls and never releases the candidate as a plan', async t => {
  const h = harness(t);
  h.respond = (sent, call) => Response.json(envelope(call === 1 ? plan() : { assessment: 'grounded', findings: [{ extra: 'PRIVATE' }] }));
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.outcome, 'failed'); assert.equal(body.plan, null);
  assert.deepEqual(body.diagnosticCandidate.plan, plan()); assert.equal(body.groundingReview, null);
  assert.deepEqual(body.usage, { input_tokens: 60, output_tokens: 200 }); assert.equal(body.usageUnknown, false);
  assert.deepEqual(body.planningTrace.stages.map(stage => stage.outcome), ['passed', 'failed']);
  assert(!JSON.stringify(body).includes('PRIVATE')); assert.equal(h.calls, 2); assert.equal(h.reservations, 2);
});

test('unknown review-call usage makes only the aggregate unknown and retains known plan-stage usage', async t => {
  const h = harness(t);
  h.respond = (sent, call) => { if (call === 2) throw new Error('PRIVATE_REVIEW_FAILURE'); return Response.json(envelope(plan())); };
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.outcome, 'failed'); assert.equal(body.plan, null);
  assert.equal(body.usageUnknown, true); assert.equal(body.usage, null);
  assert.deepEqual(body.planningTrace.stages[0].usage, { input_tokens: 30, output_tokens: 100 });
  assert.equal(body.planningTrace.stages[1].usage, null); assert.equal(body.planningTrace.knownUsageCalls, 1);
  assert.equal(body.planningTrace.unknownUsageCalls, 1); assert(!JSON.stringify(body).includes('PRIVATE_REVIEW_FAILURE'));
});

test('observed cancellation during planning prevents a second reservation and call', async () => {
  const controller = new AbortController(); let calls = 0, reservations = 0;
  const fetcher = async (_, options) => {
    calls++;
    setTimeout(() => controller.abort(), 0);
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('PRIVATE_ABORT')), { once: true }));
  };
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan.' }, {
    requestId: 'cancel-plan', signal: controller.signal, reserveCall: async () => { reservations++; return true; }, fetcher,
  }), error => {
    assert.equal(error.code, 'inference_cancelled'); assert.equal(error.planningResult.outcome, 'failed');
    assert.deepEqual(error.planningResult.planningTrace.stages.map(stage => [stage.reservation, stage.outcome]),
      [['reserved', 'cancelled'], ['not_requested', 'not_started']]);
    assert.equal(error.planningResult.usageUnknown, true); return true;
  });
  assert.equal(calls, 1); assert.equal(reservations, 1);
});

test('cancellation after a valid plan prevents the grounding reservation and provider call', async t => {
  const controller = new AbortController(); let calls = 0, reservations = 0, digests = 0;
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(globalThis.crypto.subtle, 'digest', async (...args) => {
    const result = await digest(...args);
    if (++digests === 2) controller.abort();
    return result;
  });
  const fetcher = async () => {
    calls++;
    if (calls !== 1) throw new Error('PRIVATE_UNEXPECTED_RETRY');
    return Response.json(envelope(plan()));
  };
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan.' }, {
    requestId: 'between-stages-cancel', signal: controller.signal,
    reserveCall: async () => { reservations++; return true; }, fetcher,
  }), error => {
    assert.equal(error.code, 'inference_cancelled');
    const result = error.planningResult;
    assert.equal(result.outcome, 'failed'); assert.equal(result.plan, null); assert.deepEqual(result.diagnosticCandidate.plan, plan());
    assert.equal(result.planningTrace.stages[0].outcome, 'passed'); assert.equal(result.planningTrace.stages[0].usageKnown, true);
    assert.deepEqual(result.planningTrace.stages[0].usage, { input_tokens: 30, output_tokens: 100 });
    assert.equal(result.planningTrace.stages[1].reservation, 'not_requested'); assert.equal(result.planningTrace.stages[1].outcome, 'cancelled');
    assert.equal(result.planningTrace.stages[1].providerAttempted, false); assert.equal(result.planningTrace.providerAttempts, 1);
    assert.equal(result.planningTrace.budgetReservations, 1); assert.equal(result.usageUnknown, false);
    assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 100 });
    assert(!JSON.stringify(result).includes('PRIVATE_UNEXPECTED_RETRY'));
    return true;
  });
  assert.equal(reservations, 1); assert.equal(calls, 1);
});

test('deadline after candidate hashing leaves grounding unstarted before reservation', async t => {
  let now = 0, calls = 0, reservations = 0, digests = 0;
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis.crypto.subtle, 'digest', async (...args) => {
    const result = await digest(...args);
    if (++digests === 2) now = 1000;
    return result;
  });
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan.' }, {
    requestId: 'pre-review-deadline', pipelineMs: 1000,
    reserveCall: async () => { reservations++; return true; },
    fetcher: async () => { calls++; return Response.json(envelope(plan())); },
  }), error => {
    assert.equal(error.code, 'inference_timeout');
    const result = error.planningResult;
    assert.equal(result.outcome, 'failed'); assert.equal(result.plan, null); assert.deepEqual(result.diagnosticCandidate.plan, plan());
    assert.equal(result.planningTrace.stages[0].outcome, 'passed'); assert.equal(result.planningTrace.stages[0].usageKnown, true);
    assert.equal(result.planningTrace.stages[1].reservation, 'not_requested'); assert.equal(result.planningTrace.stages[1].outcome, 'not_started');
    assert.equal(result.planningTrace.stages[1].providerAttempted, false); assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 100 });
    return true;
  });
  assert.equal(reservations, 1); assert.equal(calls, 1);
});

test('expired candidate precheck never starts a rejecting hash factory or an unhandled rejection', async t => {
  let now = 0, calls = 0, reservations = 0, candidateDigestCalls = 0, unhandled = 0;
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.removeListener('unhandledRejection', onUnhandled));
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis.crypto.subtle, 'digest', (...args) => {
    if (new Error().stack.includes('createDiagnosticCandidate')) {
      candidateDigestCalls++;
      return Promise.reject(new Error('PRIVATE_EAGER_CANDIDATE_DIGEST'));
    }
    return digest(...args);
  });
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan.' }, {
    requestId: 'expired-candidate-precheck', pipelineMs: 1000,
    reserveCall: async () => { reservations++; return true; },
    fetcher: async () => { calls++; const response = Response.json(envelope(plan())); now = 1000; return response; },
  }), error => {
    assert.equal(error.code, 'inference_timeout'); assert(!error.message.includes('PRIVATE_EAGER_CANDIDATE_DIGEST'));
    assert.equal(error.planningResult.outcome, 'failed'); assert.equal(error.planningResult.plan, null);
    assert.equal(error.planningResult.diagnosticCandidate, null); assert.equal(error.planningResult.planningTrace.stages[0].outcome, 'failed');
    assert.deepEqual(error.planningResult.planningTrace.stages[0].usage, { input_tokens: 30, output_tokens: 100 });
    return true;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(candidateDigestCalls, 0); assert.equal(unhandled, 0); assert.equal(reservations, 1); assert.equal(calls, 1);
});

test('deadline after confirmed grounding reservation fails that reserved stage without dispatch', async t => {
  let now = 0, calls = 0, reservations = 0;
  t.mock.method(Date, 'now', () => now);
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan.' }, {
    requestId: 'post-review-reservation-deadline', pipelineMs: 1000,
    reserveCall: async () => { if (++reservations === 2) now = 1000; return true; },
    fetcher: async () => { calls++; return Response.json(envelope(plan())); },
  }), error => {
    assert.equal(error.code, 'inference_timeout');
    const result = error.planningResult;
    assert.equal(result.outcome, 'failed'); assert.equal(result.plan, null); assert.deepEqual(result.diagnosticCandidate.plan, plan());
    assert.equal(result.planningTrace.stages[0].outcome, 'passed'); assert.equal(result.planningTrace.stages[1].reservation, 'reserved');
    assert.equal(result.planningTrace.stages[1].outcome, 'failed'); assert.equal(result.planningTrace.stages[1].providerAttempted, false);
    assert.equal(result.planningTrace.budgetReservations, 2); assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 100 });
    return true;
  });
  assert.equal(reservations, 2); assert.equal(calls, 1);
});

test('deadline after grounding validation retains the review and both known usages but releases no plan', async t => {
  let now = 0, calls = 0, reservations = 0;
  t.mock.method(Date, 'now', () => now);
  const fetcher = async () => {
    calls++;
    if (calls === 2) now = 1000;
    return Response.json(envelope(calls === 1 ? plan() : groundedReview()));
  };
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan.' }, {
    requestId: 'post-review-validation-deadline', pipelineMs: 1000,
    reserveCall: async () => { reservations++; return true; }, fetcher,
  }), error => {
    assert.equal(error.code, 'inference_timeout');
    const result = error.planningResult;
    assert.equal(result.outcome, 'failed'); assert.equal(result.plan, null); assert.deepEqual(result.diagnosticCandidate.plan, plan());
    assert.deepEqual(result.groundingReview, groundedReview()); assert.deepEqual(result.usage, { input_tokens: 60, output_tokens: 200 });
    assert.equal(result.planningTrace.stages[0].outcome, 'passed'); assert.equal(result.planningTrace.stages[1].outcome, 'failed');
    assert.equal(result.planningTrace.stages[1].usageKnown, true); return true;
  });
  assert.equal(reservations, 2); assert.equal(calls, 2);
});

test('deadline during final canonical hashing keeps completed review evidence and no editable plan', async t => {
  let now = 0, calls = 0, reservations = 0, digests = 0;
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis.crypto.subtle, 'digest', async (...args) => {
    const result = await digest(...args);
    if (++digests === 3) now = 1000;
    return result;
  });
  const fetcher = async () => Response.json(envelope(++calls === 1 ? plan() : groundedReview()));
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan.' }, {
    requestId: 'final-hash-deadline', pipelineMs: 1000,
    reserveCall: async () => { reservations++; return true; }, fetcher,
  }), error => {
    assert.equal(error.code, 'inference_timeout');
    const result = error.planningResult;
    assert.equal(result.outcome, 'failed'); assert.equal(result.plan, null); assert.deepEqual(result.diagnosticCandidate.plan, plan());
    assert.deepEqual(result.groundingReview, groundedReview()); assert.deepEqual(result.usage, { input_tokens: 60, output_tokens: 200 });
    assert.deepEqual(result.planningTrace.stages.map(stage => stage.outcome), ['passed', 'failed']); return true;
  });
  assert.equal(reservations, 2); assert.equal(calls, 2);
});

test('async final canonical rejection is caught and relabels the completed review stage as failed', async t => {
  let calls = 0, reservations = 0, digests = 0;
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  t.mock.method(globalThis.crypto.subtle, 'digest', async (...args) => {
    if (++digests === 3) throw new Error('PRIVATE_FINAL_DIGEST');
    return digest(...args);
  });
  const fetcher = async () => Response.json(envelope(++calls === 1 ? plan() : groundedReview()));
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan.' }, {
    requestId: 'final-hash-rejection', reserveCall: async () => { reservations++; return true; }, fetcher,
  }), error => {
    assert.equal(error.code, 'nebius_unavailable'); assert(!error.message.includes('PRIVATE_FINAL_DIGEST'));
    const result = error.planningResult;
    assert.equal(result.outcome, 'failed'); assert.equal(result.plan, null); assert.deepEqual(result.diagnosticCandidate.plan, plan());
    assert.deepEqual(result.groundingReview, groundedReview()); assert.deepEqual(result.planningTrace.stages.map(stage => stage.outcome), ['passed', 'failed']);
    assert.deepEqual(result.usage, { input_tokens: 60, output_tokens: 200 }); return true;
  });
  assert.equal(reservations, 2); assert.equal(calls, 2);
});

test('planning v4 prioritizes outcomes and preserves prerequisite and missing-authority rules', async t => {
  const h = harness(t), input = h.body();
  assert.equal((await h.send(input)).status, 200);
  const sent = h.requests[0].body, system = sent.messages[0].content;
  assert.equal(PLAN_VERSION, 'project-plan.v4');
  const groundingAt = system.indexOf('outcome-oriented'), schemaAt = system.indexOf('Return only a JSON object');
  assert(groundingAt >= 0 && schemaAt >= 0, 'Both grounding and schema instructions must be present.');
  assert(groundingAt < schemaAt, 'Grounding governs before the output schema.');
  assert.match(system, /unless the brief itself supplies a method/);
  assert.match(system, /Preserve methods explicitly supplied by the brief; do not choose absent methods/);
  assert.match(system, /put a concise question in missingInformation/);
  assert.match(system, /Include only review, approval or waiver gates explicitly required by the brief/);
  assert.match(system, /authority to accept unresolved issues/);
  assert.match(system, /first propose identifying the authorized person/);
  assert.match(system, /checking or approval task must follow every task whose result it checks or approves/);
  assert.match(system, /ordered prerequisite chain/);
  assert.match(system, /trace each checking and approval task backward/);
  assert.match(system, /Rewrite unsupported specifics as outcomes/);
  assert.match(system, /remove unrequested approval or waiver gates/);
  assert.deepEqual(JSON.parse(sent.messages[1].content), { brief: input.brief });
  assert.equal(sent.max_tokens, 4000); assert.equal(h.calls, 2);
});

for (const version of ['project-plan.v1', 'project-plan.v2', 'project-plan.v3']) test(`obsolete ${version} planning preview is rejected before budget or provider use`, async t => {
  const h = harness(t), input = { ...h.body(), promptVersion: version };
  assert.equal((await h.send(input)).status, 409);
  assert.equal(h.calls + h.reservations, 0);
  assert.equal(h.admissions, 1); // Existing IP admission still protects request parsing.
});

for (const brief of [
  'Prepare a neighborhood meeting. Confirm the attendees and agenda; the room and organizer are unknown.',
  'Review a laboratory observation sheet. The review method and authorized reviewer have not been supplied.',
  'Move a collection to another location. The route, equipment and storage destination are undecided.',
]) test(`planning v4 wires generic grounding policy without changing the supplied domain: ${brief}`, async t => {
  const h = harness(t), input = { ...h.body(), brief };
  assert.equal((await h.send(input)).status, 200);
  const sent = h.requests[0].body;
  assert.deepEqual(JSON.parse(sent.messages[1].content), { brief });
  assert.match(sent.messages[0].content, /method, process or authority details absent from the brief/);
  assert.equal(sent.max_tokens, 4000); assert.equal(sent.tools, undefined);
  assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.equal(h.calls, 2); assert.equal(h.reservations, 2); assert.equal(h.admissions, 1);
});

test('rejected plan retains canonical failure evidence without echoing model content', async t => {
  const h = harness(t), raw = envelope({ ...plan(), owner: 'PRIVATE_MODEL_CONTENT' });
  h.respond = () => Response.json(raw);
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.code, 'invalid_model_output');
  assert.equal(body.providerAttempted, true); assert.equal(body.usageUnknown, false);
  assert.deepEqual(body.usage, { input_tokens: 30, output_tokens: 100 });
  assert.equal(body.outcome, 'failed'); assert.equal(body.plan, null); assert.equal(body.diagnosticCandidate, null);
  assert.equal(body.planningTrace.stages[0].outcome, 'failed');
  assert(!JSON.stringify(body).includes('PRIVATE_MODEL_CONTENT')); assert(!JSON.stringify(body).includes('synthetic-key'));
  assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
});

test('malformed plan JSON retains known usage and never exposes the parser snippet', async t => {
  const h = harness(t), raw = envelope(); raw.choices[0].message.content = '{"PRIVATE_MODEL_CONTENT":';
  h.respond = () => Response.json(raw);
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.outcome, 'failed'); assert.equal(body.plan, null);
  assert.deepEqual(body.usage, { input_tokens: 30, output_tokens: 100 });
  assert.equal(body.usageUnknown, false); assert(!JSON.stringify(body).includes('PRIVATE_MODEL_CONTENT')); assert.equal(h.calls, 1);
});

test('output-limit rejection preserves provider usage instead of a zero or missing charge', async t => {
  const h = harness(t), raw = envelope(); raw.choices[0].finish_reason = 'length'; raw.usage.completion_tokens = 4000;
  h.respond = () => Response.json(raw);
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.providerAttempted, true); assert.equal(body.usageUnknown, false);
  assert.deepEqual(body.usage, { input_tokens: 30, output_tokens: 4000 }); assert.equal(h.calls, 1);
});

test('reported plan usage above the 4000-token request cap fails with known usage and no review call', async t => {
  const h = harness(t), raw = envelope(); raw.usage.completion_tokens = 4001;
  h.respond = () => Response.json(raw);
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.code, 'invalid_model_output'); assert.equal(body.outcome, 'failed');
  assert.equal(body.plan, null); assert.equal(body.diagnosticCandidate, null); assert.deepEqual(body.usage, { input_tokens: 30, output_tokens: 4001 });
  assert.equal(body.usageUnknown, false); assert.equal(body.planningTrace.stages[0].outcome, 'failed');
  assert.equal(body.planningTrace.stages[0].usageKnown, true); assert.equal(body.planningTrace.stages[1].outcome, 'not_started');
  assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
});

test('reported review usage above the 2000-token request cap retains candidate and both known usages', async t => {
  const h = harness(t);
  h.respond = (sent, call) => {
    const raw = envelope(call === 1 ? plan() : groundedReview());
    if (call === 2) raw.usage.completion_tokens = 2001;
    return Response.json(raw);
  };
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.code, 'invalid_model_output'); assert.equal(body.outcome, 'failed');
  assert.equal(body.plan, null); assert.deepEqual(body.diagnosticCandidate.plan, plan()); assert.equal(body.groundingReview, null);
  assert.deepEqual(body.usage, { input_tokens: 60, output_tokens: 2101 }); assert.equal(body.usageUnknown, false);
  assert.equal(body.planningTrace.stages[0].outcome, 'passed'); assert.equal(body.planningTrace.stages[1].outcome, 'failed');
  assert.equal(body.planningTrace.stages[1].usageKnown, true); assert.equal(h.calls, 2); assert.equal(h.reservations, 2);
});

test('invalid usage stays unknown after a provider attempt and is never invented as zero', async t => {
  const h = harness(t), raw = envelope(); raw.usage.completion_tokens = -1;
  h.respond = () => Response.json(raw);
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.providerAttempted, true); assert.equal(body.usageUnknown, true);
  assert.equal(body.usage, null); assert.equal(h.calls, 1);
});

test('connection failure reports an attempted request with unknown usage and no private exception', async t => {
  const h = harness(t); h.respond = () => { throw new Error('PRIVATE_CONNECTION_DETAIL'); };
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.providerAttempted, true); assert.equal(body.usageUnknown, true);
  assert.equal(body.usage, null); assert(!JSON.stringify(body).includes('PRIVATE_CONNECTION_DETAIL')); assert.equal(h.calls, 1);
});

test('a refused preview never claims a provider attempt or fabricated usage', async t => {
  const h = harness(t), response = await h.send({ ...h.body(), consent: false }), body = await response.json();
  assert.equal(response.status, 400); assert.equal(h.calls, 0); assert.equal(h.reservations, 0);
  assert.equal(Object.hasOwn(body, 'providerAttempted'), false); assert.equal(Object.hasOwn(body, 'usage'), false);
});

test('all four advisory validators preserve usage when the returned JSON is unusable', async () => {
  const pack = { title: 'Clarify', purpose: 'Confirm facts', nextStep: 'Ask', blocker: 'None', doneWhen: 'Facts recorded' };
  const snapshot = { project: { id: 'project', title: 'Project', summary: '' }, tasks: [{ id: 'project:task', ...pack, status: 'active', blockedBy: null, archived: false }] };
  const cases = [
    [suggestWithNebius, { pack, context: [], currentStatus: 'active', update: '' }],
    [reviewWithNebius, { pack, criteria: [{ id: 'c1', text: 'Facts recorded' }], evidence: 'Nothing observed.' }],
    [planWithNebius, { brief: 'Clarify the facts.' }],
  ];
  const { replanWithNebius } = await import('../worker/nebius-provider.mjs');
  cases.push([replanWithNebius, { snapshot, update: 'Clarify the changed facts.' }]);
  for (const [run, state] of cases) {
    let calls = 0;
    const fetcher = async () => { calls++; const raw = envelope(); raw.choices[0].message.content = 'PRIVATE_NON_JSON'; return Response.json(raw); };
    const options = run === planWithNebius ? { fetcher, requestId: 'direct-plan', reserveCall: async () => true } : { fetcher };
    await assert.rejects(() => run({ apiKey: 'synthetic-key', model }, state, options), error => {
      assert.equal(error.code, 'invalid_model_output'); assert.equal(error.providerAttempted, true); assert.equal(error.usageUnknown, false);
      assert.deepEqual(error.usage, { input_tokens: 30, output_tokens: 100 }); assert.equal(error.diagnostic, 'The response is not valid JSON.');
      assert(!error.message.includes('PRIVATE_NON_JSON')); return true;
    });
    assert.equal(calls, 1);
  }
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
  assert.equal((await h.send({ pack, context: [], currentStatus: 'active', update: '', requestedModel: model, promptVersion: PROMPT_VERSION, consent: true }, { operation: 'suggest-next-step' })).status, 429);
  assert.equal(h.calls, 2); assert.equal(h.reservations, 2);
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
  assert.equal(response.status, 502); assert.equal(body.code, 'invalid_model_output'); assert.equal(body.plan, null); assert.equal(body.outcome, 'failed');
  assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
});

for (const status of [401, 403, 429, 500]) test(`provider ${status} is redacted, consumes budget and is not retried`, async t => {
  const h = harness(t);
  t.mock.method(globalThis, 'fetch', async () => { h.calls++; return new Response('PRIVATE secret provider detail', { status }); });
  const response = await h.send(), body = await response.json();
  assert.equal(response.status, status === 429 ? 429 : 502); assert.equal(body.code, 'nebius_request_failed');
  assert(!JSON.stringify(body).includes('PRIVATE')); assert.equal(body.plan, null); assert.equal(body.outcome, 'failed'); assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
});

test('planning timeout aborts one stalled call with no retry', async () => {
  let calls = 0, signal;
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan' }, { requestId: 'timeout-plan', reserveCall: async () => true,
    timeoutMs: 10, fetcher: async (_, options) => { calls++; signal = options.signal; return new Promise(() => {}); } }), error => {
    assert.equal(error.code, 'inference_timeout'); assert.equal(error.planningResult.outcome, 'failed');
    assert.deepEqual(error.planningResult.planningTrace.stages.map(stage => [stage.reservation, stage.outcome]),
      [['reserved', 'failed'], ['not_requested', 'not_started']]);
    assert.equal(error.planningResult.usageUnknown, true); return true;
  });
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});

test('a grounding timeout keeps known first-stage usage and does not retry', async () => {
  let calls = 0, reservations = 0;
  const fetcher = async (_, options) => {
    calls++;
    if (calls === 1) return Response.json(envelope(plan()));
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('PRIVATE_TIMEOUT')), { once: true }));
  };
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan' }, {
    requestId: 'review-timeout', timeoutMs: 10, reserveCall: async () => { reservations++; return true; }, fetcher,
  }), error => {
    const result = error.planningResult;
    assert.equal(error.code, 'inference_timeout'); assert.equal(result.outcome, 'failed'); assert.equal(result.plan, null);
    assert.deepEqual(result.diagnosticCandidate.plan, plan()); assert.equal(result.usageUnknown, true); assert.equal(result.usage, null);
    assert.deepEqual(result.planningTrace.stages[0].usage, { input_tokens: 30, output_tokens: 100 });
    assert.equal(result.planningTrace.stages[1].providerAttempted, true); assert.equal(result.planningTrace.stages[1].usage, null);
    return true;
  });
  assert.equal(calls, 2); assert.equal(reservations, 2);
});

test('a reservation crossing the pipeline deadline is retained as unknown with no dispatch', async () => {
  let calls = 0, reservations = 0;
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan' }, {
    requestId: 'reservation-timeout', pipelineMs: 10,
    reserveCall: async () => { reservations++; return new Promise(() => {}); },
    fetcher: async () => { calls++; return Response.json(envelope()); },
  }), error => {
    assert.equal(error.code, 'inference_timeout'); assert.equal(error.planningResult.providerAttempted, false);
    assert.equal(error.planningResult.planningTrace.unknownReservations, 1);
    assert.deepEqual(error.planningResult.planningTrace.stages.map(stage => [stage.reservation, stage.outcome]),
      [['unknown', 'failed'], ['not_requested', 'not_started']]);
    return true;
  });
  assert.equal(reservations, 1); assert.equal(calls, 0);
});

test('planning has no permissive reservation default', async () => {
  let calls = 0;
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan' }, {
    requestId: 'missing-reservation', fetcher: async () => { calls++; return Response.json(envelope()); },
  }), error => {
    assert.equal(error.code, 'nebius_unavailable'); assert.equal(error.planningResult.providerAttempted, false);
    assert.deepEqual(error.planningResult.planningTrace.stages.map(stage => stage.reservation), ['not_requested', 'not_requested']);
    return true;
  });
  assert.equal(calls, 0);
});

test('planning response stream remains byte bounded and cancels excess output', async () => {
  let cancelled = false;
  await assert.rejects(planWithNebius({ model, apiKey: 'synthetic' }, { brief: 'Make a plan' }, { requestId: 'bounded-plan', reserveCall: async () => true,
    fetcher: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(140000)); }, cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }) }), { code: 'invalid_model_output' });
  assert.equal(cancelled, true);
});

test('suggestion and review retain their 1200-token provider allowance', async () => {
  const config = { model, apiKey: 'synthetic' }, pack = { title: 'Clarify', purpose: 'Confirm', nextStep: 'Ask', blocker: 'None', doneWhen: 'Requirements confirmed' };
  const state = { pack, context: [], currentStatus: 'active', update: '' };
  const suggestion = { changes: { nextStep: 'Ask for requirements.' }, reason: 'Requirements needed.', basis: ['title'], missingInformation: [] };
  const reviewState = { pack, criteria: [{ id: 'c1', text: pack.doneWhen }], evidence: 'Requirements confirmed' };
  const review = { checks: [{ id: 'c1', assessment: 'supported', reason: 'Claim is present.', quote: 'Requirements confirmed' }], comparison: { assessment: 'unclear', reason: 'No separate observation is supplied.' } };
  for (const [operation, input, output] of [[suggestWithNebius, state, suggestion], [reviewWithNebius, reviewState, review]]) {
    let sent;
    await operation(config, input, { fetcher: async (_, options) => { sent = JSON.parse(options.body); return Response.json(envelope(output)); } });
    assert.equal(sent.max_tokens, 1200); assert.equal(sent.tools, undefined);
  }
});

test('model plan v4 stays strict while authored metadata validates output minima and disjoint ids', () => {
  const value = plan();
  value.tasks[0].executionInputs = [{ id: 'plan', format: 'json' }];
  value.tasks[0].executionOutputs = [{ id: 'schedule', format: 'timeline' }];
  assert.throws(() => validateProjectPlan(value));
  assert.throws(() => validatePlan(value));
  const approved = validateAuthoredProjectPlan(value);
  assert.deepEqual(approved.tasks[0].executionOutputs, value.tasks[0].executionOutputs);
  assert.notEqual(approved.tasks[0].executionOutputs, value.tasks[0].executionOutputs);
  for (const outputs of [[], null]) {
    value.tasks[0].executionOutputs = outputs;
    assert.deepEqual(validateAuthoredProjectPlan(value).tasks[0].executionOutputs, outputs);
  }
  for (const outputs of [[{ id: 'plan', format: 'text' }], [{ id: 'schedule', format: 'json' }], undefined]) {
    value.tasks[0].executionOutputs = outputs;
    assert.throws(() => validateAuthoredProjectPlan(value));
  }
});
