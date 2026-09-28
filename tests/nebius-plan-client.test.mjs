import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanClient } from '../svelte-frontend/src/routes/work/nebius-plan-client.mjs';
const config = { available: true, requestedModel: 'nvidia/test-model', planVersion: 'project-plan.v1', operation: 'plan-project', modelRole: 'reasoning', maxOutputTokens: 4000 };
const result = () => ({ model: config.requestedModel, requestedModel: config.requestedModel, promptVersion: config.planVersion,
  applied: false, requestId: 'request-1', usage: { input_tokens: 12, output_tokens: 30 },
  plan: { title: 'Release', summary: 'Prepare a release.', missingInformation: ['Audience'], tasks: [
    { id: 'brief', title: 'Clarify brief', purpose: 'Agree the scope', nextStep: 'Ask the owner', doneWhen: 'Scope is written', dependsOn: null },
    { id: 'review', title: 'Review page', purpose: 'Check the result', nextStep: 'Read the page', doneWhen: 'Review is recorded', dependsOn: 'brief' },
  ] } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function harness(fetcher) {
  const views = [], calls = [];
  const client = createPlanClient({ onChange: view => views.push(view), fetcher: async (url, options) => {
    calls.push({ url, options }); return fetcher ? fetcher(url, options) : Response.json(options.method === 'POST' ? result() : config);
  } });
  return { client, calls, views, last: () => views.at(-1) };
}
test('planner requests planning configuration and refuses stale routing metadata', async () => {
  for (const override of [{ operation: 'replan-project' }, { modelRole: 'routine' }, { maxOutputTokens: 1200 }]) {
    const h = harness(() => Response.json({ ...config, ...override })); h.client.setBrief('Prepare a release'); await h.client.reload();
    assert.equal(h.calls[0].url, '/api/nebius/config?operation=plan-project'); assert.equal(h.last().config, null);
    await h.client.generate(); assert.equal(h.calls.length, 1);
  }
});
test('settings send no brief; explicit generation sends exactly the consented brief and returns an unsaved plan', async () => {
  const h = harness(); h.client.setBrief('Prepare a release'); await h.client.reload();
  assert.equal(h.calls[0].options.body, undefined); await h.client.generate();
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { brief: 'Prepare a release', requestedModel: config.requestedModel, promptVersion: config.planVersion, consent: true });
  assert.equal(h.calls[1].url, '/api/nebius/plan-project'); assert.equal(h.last().phase, 'complete');
  assert.deepEqual(h.last().plan, result().plan);
});
test('changed brief aborts a pending generation and rejects a late response even when transport ignores abort', async () => {
  const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
  h.client.setBrief('First brief'); await h.client.reload(); const generation = h.client.generate();
  h.client.setBrief('Second brief'); assert.equal(h.calls[1].options.signal.aborted, true);
  pending.resolve(Response.json(result())); await generation;
  assert.equal(h.last().phase, 'ready'); assert.equal(h.last().plan, null);
});
test('typing during initial settings load preserves that one request and generates with the latest brief', async () => {
  const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? Response.json(result()) : pending.promise);
  const loading = h.client.reload(); h.client.setBrief('First characters'); h.client.setBrief('Final brief');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.signal.aborted, false);
  assert.equal(h.last().phase, 'loading'); assert.equal(h.last().config, null);
  pending.resolve(Response.json(config)); await loading;
  assert.equal(h.last().phase, 'ready'); await h.client.generate();
  assert.equal(JSON.parse(h.calls[1].options.body).brief, 'Final brief'); assert.equal(h.last().phase, 'complete');
});
test('double generation and disposal do not publish a second request or late plan', async () => {
  const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
  h.client.setBrief('Brief'); await h.client.reload(); const generation = h.client.generate(); await h.client.generate();
  assert.equal(h.calls.length, 2); h.client.dispose(); const count = h.views.length;
  pending.resolve(Response.json(result())); await generation; assert.equal(h.views.length, count);
});
test('stale settings response cannot overwrite a later settings load', async () => {
  const first = deferred(); let calls = 0;
  const h = harness(() => ++calls === 1 ? first.promise : Response.json({ ...config, requestedModel: 'nvidia/new-model' }));
  const load = h.client.reload(); await h.client.reload(); first.resolve(Response.json(config)); await load;
  assert.equal(h.last().config.requestedModel, 'nvidia/new-model');
});
test('invalid input, settings, identity, token usage and cyclic plans are refused', async () => {
  for (const mutate of [body => { body.applied = true; }, body => { body.model = 'nvidia/other'; }, body => { body.requestId = ''; },
    body => { body.usage.input_tokens = -1; }, body => { body.plan.tasks[0].dependsOn = 'review'; },
    body => { body.plan.owner = 'Invented'; }]) {
    const h = harness((_, options) => { const body = options.method === 'POST' ? result() : config; if (options.method === 'POST') mutate(body); return Response.json(body); });
    h.client.setBrief('Brief'); await h.client.reload(); await h.client.generate();
    assert.equal(h.last().phase, 'error'); assert.equal(h.last().plan, null);
  }
  const invalid = harness(); await invalid.client.reload(); invalid.client.setBrief('bad\u0000'); await invalid.client.generate(); assert.equal(invalid.calls.length, 1);
  const settings = harness(() => Response.json({ ...config, planVersion: 'old' })); settings.client.setBrief('Brief'); await settings.client.reload(); await settings.client.generate(); assert.equal(settings.calls.length, 1);
});
test('missing configuration and inference failure never synthesize a manual or model plan', async () => {
  const absent = harness(() => new Response('', { status: 404 })); await absent.client.reload();
  assert.equal(absent.last().phase, 'unavailable'); assert.equal(absent.last().plan, null);
  const failed = harness((_, options) => options.method === 'POST' ? Response.json({ code: 'inference_timeout' }, { status: 504 }) : Response.json(config));
  failed.client.setBrief('Brief'); await failed.client.reload(); await failed.client.generate();
  assert.equal(failed.last().phase, 'error'); assert.equal(failed.last().plan, null);
});
