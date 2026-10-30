import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplanClient } from '../svelte-frontend/src/routes/work/nebius-replan-client.mjs';
const config = { available: true, requestedModel: 'nvidia/test-model', replanVersion: 'project-replan.v1', operation: 'replan-project', modelRole: 'reasoning', maxOutputTokens: 4000 };
const snapshot = { project: { id: 'project-a', title: 'Workshop', summary: 'Prepare workshop' }, tasks: [
  { id: 'project-a:venue', title: 'Confirm venue', purpose: 'Find a place', nextStep: 'Call venue', doneWhen: 'Venue confirmed', status: 'active', blocker: 'None', blockedBy: null, archived: false },
] };
const result = () => {
  const { archived, ...task } = snapshot.tasks[0];
  return { model: config.requestedModel, requestedModel: config.requestedModel, promptVersion: config.replanVersion,
    applied: false, requestId: 'replan-1', usage: { input_tokens: 20, output_tokens: 30 },
    replan: { summary: 'Venue unavailable', changes: [{ ...task, nextStep: 'Find another venue', reason: 'Venue declined' }], missingInformation: [] } };
};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function harness(fetcher) {
  const calls = [], views = [];
  const client = createReplanClient({ onChange: view => views.push(view), fetcher: async (url, options) => {
    calls.push({ url, options }); return fetcher ? fetcher(url, options) : Response.json(options.method === 'POST' ? result() : config);
  } });
  return { client, calls, views, last: () => views.at(-1) };
}
test('replan failure details retain known or unknown usage and clear on new input', async () => {
  for (const usage of [{ input_tokens: 20, output_tokens: 30 }, null]) {
    const failure = { providerAttempted: true, usageUnknown: usage === null, usage, diagnostic: 'Invalid project changes.' };
    const h = harness((_, options) => Response.json(options.method === 'POST' ? { code: 'invalid_model_output', ...failure } : config, { status: options.method === 'POST' ? 502 : 200 }));
    const before = structuredClone(snapshot); h.client.setInput(snapshot, 'Update'); await h.client.reload(); await h.client.generate(true);
    assert.equal(h.last().phase, 'error'); assert.equal(h.last().replan, null); assert.deepEqual(h.last().failure, failure);
    h.client.setInput(snapshot, 'Different update'); assert.equal(h.last().failure, null); assert.deepEqual(snapshot, before);
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1);
  }
});

test('late replan failure cannot publish diagnostics for a replaced update', async () => {
  const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
  h.client.setInput(snapshot, 'Old update'); await h.client.reload(); const generation = h.client.generate(true);
  h.client.setInput(snapshot, 'New update');
  pending.resolve(Response.json({ code: 'invalid_model_output', providerAttempted: true, usageUnknown: true, usage: null, diagnostic: 'Old failure.' }, { status: 502 }));
  await generation; assert.equal(h.last().phase, 'ready'); assert.equal(h.last().failure, null); assert.equal(h.last().replan, null);
});

test('replanner requests its operation and refuses a planning config despite same role', async () => {
  const h = harness(() => Response.json({ ...config, operation: 'plan-project' }));
  h.client.setInput(snapshot, 'Changed circumstances'); await h.client.reload();
  assert.equal(h.calls[0].url, '/api/nebius/config?operation=replan-project'); assert.equal(h.last().config, null);
  await h.client.generate(true); assert.equal(h.calls.length, 1);
});
test('exact project context goes only with explicit generation consent; result is unsaved', async () => {
  const h = harness(); h.client.setInput(snapshot, 'Venue unavailable'); await h.client.reload();
  assert.equal(h.calls[0].options.body, undefined); await h.client.generate(false); assert.equal(h.calls.length, 1);
  await h.client.generate(true); assert.equal(h.calls[1].url, '/api/nebius/replan-project');
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { snapshot, update: 'Venue unavailable', consent: true, requestedModel: config.requestedModel, promptVersion: config.replanVersion });
  assert.equal(h.last().phase, 'complete'); assert.deepEqual(h.last().replan, result().replan);
});
test('typing during config load preserves configuration request and latest update', async () => {
  const pending = deferred(), h = harness((_, o) => o.method === 'POST' ? Response.json(result()) : pending.promise);
  const loading = h.client.reload(); h.client.setInput(snapshot, 'First update'); h.client.setInput(snapshot, 'Latest update');
  assert.equal(h.calls[0].options.signal.aborted, false); pending.resolve(Response.json(config)); await loading;
  await h.client.generate(true); assert.equal(JSON.parse(h.calls[1].options.body).update, 'Latest update');
});
test('input change aborts generation and ignores late response even if fetch ignores abort', async () => {
  const pending = deferred(), h = harness((_, o) => o.method === 'POST' ? pending.promise : Response.json(config));
  h.client.setInput(snapshot, 'First'); await h.client.reload(); const work = h.client.generate(true);
  h.client.setInput(snapshot, 'Second'); assert.equal(h.calls[1].options.signal.aborted, true);
  pending.resolve(Response.json(result())); await work; assert.equal(h.last().replan, null); assert.equal(h.last().phase, 'ready');
});
test('double generation and disposal cannot issue a duplicate or publish a late proposal', async () => {
  const pending = deferred(), h = harness((_, o) => o.method === 'POST' ? pending.promise : Response.json(config));
  h.client.setInput(snapshot, 'Update'); await h.client.reload(); const work = h.client.generate(true); await h.client.generate(true);
  assert.equal(h.calls.length, 2); h.client.dispose(); const count = h.views.length;
  pending.resolve(Response.json(result())); await work; assert.equal(h.views.length, count);
});
test('malformed authority, identity, task change and usage are refused', async () => {
  for (const mutate of [b => { b.applied = true; }, b => { b.model = 'nvidia/other'; }, b => { b.requestId = ''; },
    b => { b.usage.output_tokens = -1; }, b => { b.replan.changes[0].id = 'foreign'; }, b => { b.replan.changes[0].status = 'done'; }]) {
    const h = harness((_, o) => { const body = o.method === 'POST' ? result() : config; if (o.method === 'POST') mutate(body); return Response.json(body); });
    h.client.setInput(snapshot, 'Update'); await h.client.reload(); await h.client.generate(true);
    assert.equal(h.last().phase, 'error'); assert.equal(h.last().replan, null);
  }
});
test('absent config, invalid input and model change never invent proposals', async () => {
  const absent = harness(() => new Response('', { status: 404 })); await absent.client.reload(); assert.equal(absent.last().phase, 'unavailable');
  const invalid = harness(); await invalid.client.reload(); invalid.client.setInput(snapshot, ''); await invalid.client.generate(true); assert.equal(invalid.calls.length, 1);
  const changed = harness((_, o) => o.method === 'POST' ? Response.json({ code: 'model_changed' }, { status: 409 }) : Response.json(config));
  changed.client.setInput(snapshot, 'Update'); await changed.client.reload(); await changed.client.generate(true);
  assert.equal(changed.last().config, null); assert.equal(changed.last().replan, null);
});
