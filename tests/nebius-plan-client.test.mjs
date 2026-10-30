import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanClient } from '../svelte-frontend/src/routes/work/nebius-plan-client.mjs';
import { PLAN_VERSION, PLAN_GROUNDING_VERSION, planInputDigest, projectPlanDigest, createDiagnosticCandidate } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';
import { createPlanningTrace } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { OPERATION_PROFILES } from '../svelte-frontend/src/lib/nebius-routing-contract.mjs';
const config = { available: true, requestedModel: 'nvidia/test-model', groundingModel: 'nvidia/test-model', planVersion: PLAN_VERSION, operation: 'plan-project', ...OPERATION_PROFILES['plan-project'] };
const plan = () => ({ title: 'Release', summary: 'Prepare a release.', missingInformation: ['Audience'], tasks: [
  { id: 'brief', title: 'Clarify brief', purpose: 'Agree the scope', nextStep: 'Ask the owner', doneWhen: 'Scope is written', dependsOn: null },
  { id: 'review', title: 'Review page', purpose: 'Check the result', nextStep: 'Read the page', doneWhen: 'Review is recorded', dependsOn: 'brief' },
] });
const stage = (stage, override = {}) => ({ stage, reservation: 'reserved', providerAttempted: true, outcome: 'passed', model: config.requestedModel,
  usage: { input_tokens: 12, output_tokens: 30 }, usageKnown: true, ...override });
async function result(brief, { outcome = 'reviewable', assessment = 'not_grounded', second = {}, first = {}, draft = plan() } = {}) {
  const stages = [stage('plan', first), stage('grounding-review', { ...(outcome === 'blocked' ? { outcome: 'blocked' } : {}), ...second })];
  const planningTrace = createPlanningTrace(stages), candidate = stages[0].outcome === 'passed' ? draft : null;
  return { model: config.requestedModel, requestedModel: config.requestedModel, groundingModel: config.requestedModel, promptVersion: PLAN_VERSION, groundingVersion: PLAN_GROUNDING_VERSION,
    applied: false, requestId: 'request-1', briefDigest: await planInputDigest({ brief }), candidateDigest: candidate ? await projectPlanDigest(candidate) : null, outcome,
    plan: outcome === 'reviewable' ? candidate : null,
    diagnosticCandidate: outcome !== 'reviewable' && candidate ? await createDiagnosticCandidate(candidate, { requestId: 'request-1', brief, model: config.requestedModel }) : null,
    groundingReview: outcome === 'reviewable' ? { assessment: 'grounded', findings: [] } : outcome === 'blocked' ? { assessment, findings: [
      { category: 'unsupported_detail', planPath: '/title', planQuote: draft.title, briefQuote: '', reason: 'The brief does not establish this title.' },
    ] } : null,
    planningTrace, providerAttempted: planningTrace.providerAttempts > 0, usageUnknown: planningTrace.unknownUsageCalls > 0,
    usage: planningTrace.providerAttempts && !planningTrace.unknownUsageCalls ? { input_tokens: planningTrace.knownInputTokens, output_tokens: planningTrace.knownOutputTokens } : null };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function harness(fetcher) {
  const views = [], calls = [];
  const client = createPlanClient({ onChange: view => views.push(view), fetcher: async (url, options) => {
    calls.push({ url, options }); return fetcher ? fetcher(url, options) : Response.json(options.method === 'POST' ? await result(JSON.parse(options.body).brief) : config);
  } });
  return { client, calls, views, last: () => views.at(-1) };
}
async function generate(h, brief = 'Prepare a release') { h.client.setBrief(brief); await h.client.reload(); await h.client.generate(); }
const noEditor = h => { assert.equal(h.last().plan, null); assert.notEqual(h.last().phase, 'complete'); };
const fixture = (options = {}, status = 200, mutate = () => {}) => harness(async (_, request) => {
  if (request.method !== 'POST') return Response.json(config);
  const body = await result(JSON.parse(request.body).brief, options); mutate(body); return Response.json(body, { status });
});

test('settings require exact v4 model identities and two-call caps before sending any brief', async () => {
  for (const override of [{ operation: 'replan-project' }, { modelRole: 'routine' }, { maxOutputTokens: 1200 }, { planVersion: 'project-plan.v3' },
    { maxModelCalls: 1 }, { groundingMaxOutputTokens: 4000 }, { maxOutputTokensTotal: 4000 }, { maxPipelineMs: 90001 }, { groundingModel: 'nvidia/other' }]) {
    const h = harness(() => Response.json({ ...config, ...override })); await generate(h);
    assert.equal(h.calls[0].url, '/api/nebius/config?operation=plan-project'); assert.equal(h.last().config, null); assert.equal(h.calls.length, 1);
  }
});
test('consented generation returns only a fully reviewed unsaved plan with both usage stages', async () => {
  const h = harness(); await generate(h);
  assert.equal(h.calls[0].options.body, undefined);
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { brief: 'Prepare a release', requestedModel: config.requestedModel, promptVersion: PLAN_VERSION, consent: true });
  assert.equal(h.last().phase, 'complete'); assert.deepEqual(h.last().plan, plan());
  assert.deepEqual(h.last().usage, { input_tokens: 24, output_tokens: 60 }); assert.equal(h.last().planningResult.planningTrace.providerAttempts, 2);
  assert.equal(h.last().planningResult.applied, false); assert.equal(h.calls.length, 2);
});
test('not grounded and unclear outcomes preserve exact diagnostic identity and text without exposing an editor', async () => {
  for (const assessment of ['not_grounded', 'unclear']) {
    const draft = plan(); draft.title = '<img src=x onerror=alert(1)>';
    const h = fixture({ outcome: 'blocked', assessment, draft }); await generate(h); noEditor(h); assert.equal(h.last().phase, 'blocked');
    const evidence = h.last().planningResult.diagnosticCandidate;
    assert.equal(evidence.plan.title, draft.title); assert.equal(evidence.candidateDigest, await projectPlanDigest(draft));
    assert.equal(evidence.briefDigest, await planInputDigest({ brief: 'Prepare a release' })); assert.equal(h.calls.length, 2);
  }
});
test('pipeline HTTP errors preserve known usage, unknown review usage, refusal and cancellation evidence', async () => {
  for (const second of [
    { reservation: 'refused', providerAttempted: false, outcome: 'refused', usage: null, usageKnown: false },
    { reservation: 'unknown', providerAttempted: false, outcome: 'failed', usage: null, usageKnown: false },
    { outcome: 'failed', usage: null, usageKnown: false }, { outcome: 'failed' },
    { reservation: 'not_requested', providerAttempted: false, outcome: 'cancelled', usage: null, usageKnown: false },
  ]) {
    const h = fixture({ outcome: 'failed', second }, 502, b => { b.code = 'inference_timeout'; b.error = 'PRIVATE_RAW'; });
    await generate(h); noEditor(h); assert.equal(h.last().phase, 'error'); assert(h.last().planningResult.diagnosticCandidate);
    assert(h.last().planningResult.planningTrace.knownInputTokens >= 12);
    assert.equal(h.last().planningResult.planningTrace.stages[1].reservation, second.reservation ?? 'reserved');
    assert(!JSON.stringify(h.last()).includes('PRIVATE_RAW')); assert.equal(h.calls.length, 2);
  }
});
test('initial budget refusal reports zero attempts with no fabricated usage or candidate', async () => {
  const h = fixture({ outcome: 'failed',
    first: { reservation: 'refused', providerAttempted: false, outcome: 'refused', usage: null, usageKnown: false },
    second: { reservation: 'not_requested', providerAttempted: false, outcome: 'not_started', usage: null, usageKnown: false } }, 429);
  await generate(h); noEditor(h); assert.equal(h.last().planningResult.planningTrace.providerAttempts, 0);
  assert.equal(h.last().planningResult.diagnosticCandidate, null); assert.equal(h.last().planningResult.usage, null);
});
test('a pipeline error retains validated evidence regardless of HTTP error status', async () => {
  const h = fixture({ outcome: 'failed', second: { outcome: 'failed' } }, 404);
  await generate(h); noEditor(h); assert.equal(h.last().phase, 'error'); assert(h.last().planningResult.diagnosticCandidate);
});
test('invalid identity, digest, review, usage, cyclic plan or partial trace exposes neither plan nor evidence', async () => {
  for (const mutate of [b => { b.applied = true; }, b => { b.model = 'nvidia/other'; }, b => { b.groundingModel = 'nvidia/other'; },
    b => { b.requestId = ''; }, b => { b.briefDigest = '0'.repeat(64); }, b => { b.candidateDigest = '0'.repeat(64); },
    b => { b.usage.input_tokens = -1; }, b => { b.plan.tasks[0].dependsOn = 'review'; }, b => { b.plan.owner = 'Invented'; },
    b => { b.promptVersion = 'project-plan.v3'; }, b => { b.groundingReview.assessment = 'not_grounded'; },
    b => { b.planningTrace = { providerAttempted: true, usage: 0 }; }, b => { b.planningTrace.providerAttempts = 1; },
    b => { b.planningTrace.stages[1].usageKnown = false; }]) {
    const h = fixture({}, 200, mutate); await generate(h); noEditor(h); assert.equal(h.last().planningResult, null); assert.equal(h.last().failure, null);
  }
});
test('tampered diagnostic identity, hash, quote or wrapper fields are never retained', async () => {
  for (const mutate of [b => { b.diagnosticCandidate.requestId = 'wrong'; }, b => { b.diagnosticCandidate.briefDigest = '0'.repeat(64); },
    b => { b.diagnosticCandidate.candidateDigest = '0'.repeat(64); }, b => { b.diagnosticCandidate.model = 'nvidia/other'; },
    b => { b.diagnosticCandidate.extra = true; }, b => { b.groundingReview.findings[0].planQuote = 'not present'; }]) {
    const h = fixture({ outcome: 'blocked' }, 200, mutate); await generate(h); noEditor(h); assert.equal(h.last().planningResult, null);
  }
});
test('HTTP status must agree with the validated outcome', async () => {
  for (const [outcome, status] of [['reviewable', 502], ['blocked', 502], ['failed', 200]]) {
    const h = fixture({ outcome, ...(outcome === 'failed' ? { second: { outcome: 'failed' } } : {}) }, status);
    await generate(h); noEditor(h); assert.equal(h.last().planningResult, null);
  }
});
test('brief edits, reload, next generation and cancellation clear all previous model state', async () => {
  for (const action of ['brief', 'reload', 'generate', 'cancel']) {
    const pending = deferred(); let posts = 0;
    const h = harness(async (_, options) => options.method !== 'POST' ? Response.json(config) : ++posts === 1
      ? Response.json(await result(JSON.parse(options.body).brief, { outcome: 'blocked' })) : pending.promise);
    await generate(h); assert(h.last().planningResult);
    if (action === 'brief') h.client.setBrief('New brief');
    else if (action === 'reload') await h.client.reload();
    else if (action === 'cancel') h.client.cancel();
    else { const loading = h.client.generate(); assert.equal(h.last().planningResult, null); h.client.cancel(); pending.resolve(Response.json(await result('Prepare a release'))); await loading; }
    noEditor(h); assert.equal(h.last().planningResult, null); assert.equal(h.last().usage, null); assert.equal(h.last().failure, null);
  }
});
test('a transport ignoring abort cannot replace new input with an old success or diagnostic', async () => {
  for (const outcome of ['reviewable', 'blocked', 'failed']) {
    const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
    h.client.setBrief('Old brief'); await h.client.reload(); const generation = h.client.generate();
    h.client.setBrief('New brief'); assert.equal(h.calls[1].options.signal.aborted, true);
    pending.resolve(Response.json(await result('Old brief', { outcome, ...(outcome === 'failed' ? { second: { outcome: 'failed' } } : {}) }), { status: outcome === 'failed' ? 502 : 200 }));
    await generation; assert.equal(h.last().phase, 'ready'); assert.equal(h.last().planningResult, null); noEditor(h);
  }
});
for (const outcome of ['reviewable', 'blocked', 'failed']) test(`an edit during asynchronous ${outcome} digest validation wins over old output`, async () => {
  const body = await result('Old brief', { outcome, ...(outcome === 'failed' ? { second: { outcome: 'failed' } } : {}) });
  const gate = deferred(), entered = deferred(), original = crypto.subtle.digest;
  const h = harness((_, options) => Response.json(options.method === 'POST' ? body : config, { status: options.method === 'POST' && outcome === 'failed' ? 502 : 200 }));
  try {
    crypto.subtle.digest = async function (...args) { entered.resolve(); await gate.promise; return original.apply(this, args); };
    h.client.setBrief('Old brief'); await h.client.reload(); const generation = h.client.generate();
    await entered.promise; h.client.setBrief('New brief'); gate.resolve(); await generation;
    assert.equal(h.last().phase, 'ready'); noEditor(h); assert.equal(h.last().planningResult, null);
  } finally { gate.resolve(); crypto.subtle.digest = original; }
});
test('double generation, explicit cancellation and disposal cannot publish late results', async () => {
  for (const action of ['cancel', 'dispose']) {
    const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
    h.client.setBrief('Brief'); await h.client.reload(); const generation = h.client.generate(); await h.client.generate();
    assert.equal(h.calls.length, 2); h.client[action](); const count = h.views.length;
    pending.resolve(Response.json(await result('Brief'))); await generation; assert.equal(h.views.length, count);
    if (action === 'cancel') noEditor(h);
  }
});
test('typing during initial settings load retains that request and generates with current brief', async () => {
  const pending = deferred(), h = harness(async (_, options) => options.method === 'POST' ? Response.json(await result(JSON.parse(options.body).brief)) : pending.promise);
  const loading = h.client.reload(); h.client.setBrief('First'); h.client.setBrief('Final brief');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.signal.aborted, false); assert.equal(h.last().phase, 'loading');
  pending.resolve(Response.json(config)); await loading; await h.client.generate(); assert.equal(h.last().phase, 'complete');
  assert.equal(JSON.parse(h.calls[1].options.body).brief, 'Final brief');
});
test('stale settings, invalid brief and disabled inference cannot expose a plan', async () => {
  const first = deferred(); let calls = 0;
  const h = harness(() => ++calls === 1 ? first.promise : Response.json({ ...config, requestedModel: 'nvidia/new-model', groundingModel: 'nvidia/new-model' }));
  const load = h.client.reload(); await h.client.reload(); first.resolve(Response.json(config)); await load;
  assert.equal(h.last().config.requestedModel, 'nvidia/new-model');
  const invalid = harness(); await invalid.client.reload(); invalid.client.setBrief('bad\u0000'); await invalid.client.generate(); assert.equal(invalid.calls.length, 1); noEditor(invalid);
  const absent = harness(() => new Response('', { status: 404 })); await absent.client.reload(); assert.equal(absent.last().phase, 'unavailable'); noEditor(absent);
});
test('pre-pipeline HTTP errors never fabricate stage evidence and clear on new brief', async () => {
  const h = harness((_, options) => Response.json(options.method === 'POST' ? { code: 'daily_limit', error: 'PRIVATE' } : config, { status: options.method === 'POST' ? 429 : 200 }));
  await generate(h); noEditor(h); assert.equal(h.last().planningResult, null); assert.equal(h.last().failure, null);
  assert(!JSON.stringify(h.last()).includes('PRIVATE')); h.client.setBrief('Different'); assert.equal(h.last().failure, null);
});
