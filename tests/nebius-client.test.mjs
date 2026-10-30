import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuggestionClient } from '../svelte-frontend/src/routes/next/nebius-client.mjs';
const pack = { id: 'task-test', title: 'Plan', purpose: '', next: '', status: 'draft', blocker: '', doneWhen: '', memory: ['PRIVATE'] };
const config = { available: true, requestedModel: 'nvidia/synthetic-model', promptVersion: 'task-change.v1', operation: 'suggest-next-step', modelRole: 'routine', maxOutputTokens: 1200 };
const result = () => ({ ...config, model: config.requestedModel, applied: false, suggestion: { changes: { nextStep: 'Ask the owner.' }, reason: 'A detail is missing.', basis: ['title'], missingInformation: ['Owner response'] }, usage: { input_tokens: 30, output_tokens: 20 } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function harness(fetcher) {
  const views = [], calls = [];
  const client = createSuggestionClient({ onChange: v => views.push(v), fetcher: async (url, options) => {
    calls.push({ url, options }); return fetcher ? fetcher(url, options) : Response.json(options.method === 'POST' ? result() : config);
  } });
  return { client, calls, views, last: () => views.at(-1) };
}
test('routine failure details retain known or unknown usage without creating changes', async () => {
  for (const usage of [{ input_tokens: 30, output_tokens: 20 }, null]) {
    const failure = { providerAttempted: true, usageUnknown: usage === null, usage, diagnostic: 'Invalid task-change fields.' };
    const h = harness((_, options) => Response.json(options.method === 'POST' ? { code: 'invalid_model_output', ...failure } : config, { status: options.method === 'POST' ? 502 : 200 }));
    await h.client.setTask('one', pack); await h.client.generate();
    assert.equal(h.last().phase, 'error'); assert.equal(h.last().result, null); assert.deepEqual(h.last().failure, failure);
    await h.client.setTask('two', { ...pack, title: 'Another task' }); assert.equal(h.last().failure, null);
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1);
  }
});

test('routine late failure cannot restore old diagnostics after a task change', async () => {
  const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
  await h.client.setTask('one', pack); const generation = h.client.generate();
  await h.client.setTask('two', { ...pack, title: 'New task' });
  pending.resolve(Response.json({ code: 'invalid_model_output', providerAttempted: true, usageUnknown: true, usage: null, diagnostic: 'Old failure.' }, { status: 502 }));
  await generation; assert.equal(h.last().phase, 'ready'); assert.equal(h.last().failure, null); assert.equal(h.last().result, null);
});

test('routine client asks for its operation and refuses another role or token cap', async () => {
  for (const override of [{ operation: 'review-evidence' }, { modelRole: 'reasoning' }, { maxOutputTokens: 4000 }]) {
    const h = harness(() => Response.json({ ...config, ...override })); await h.client.setTask('one', pack);
    assert.equal(h.calls[0].url, '/api/nebius/config?operation=suggest-next-step');
    assert.equal(h.last().phase, 'error'); await h.client.generate(); assert.equal(h.calls.length, 1);
  }
});
test('loading sends no task text and generation sends exactly the shown task/status/update', async () => {
  const h = harness(); await h.client.setTask('one', pack);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.body, undefined); assert.equal(h.last().phase, 'ready');
  await h.client.generate(); const sent = JSON.parse(h.calls[1].options.body);
  assert.equal(sent.consent, true); assert.equal(sent.pack.id, undefined); assert.equal(sent.pack.memory, undefined); assert.deepEqual(sent.context, []);
  assert.equal(sent.currentStatus, 'draft'); assert.equal(sent.update, ''); assert.equal(sent.promptVersion, 'task-change.v1');
  assert.equal(h.last().phase, 'complete'); assert.equal(pack.next, ''); assert.equal(sent.pack.nextStep, ''); assert.equal(sent.pack.next, undefined);
});
test('the preview matches bounded update and status sent and result never mutates the task', async () => {
  const before = structuredClone(pack), context = [{ kind: 'source', text: 'Selected source text.' }], update = 'Ask for a date.\nNo date confirmed.';
  const h = harness(); await h.client.setTask('one', pack, context, update);
  assert.equal(h.last().currentStatus, pack.status); assert.equal(h.last().update, update);
  context[0].text = 'PRIVATE CHANGED AFTER PREVIEW';
  await h.client.generate(); const sent = JSON.parse(h.calls[1].options.body);
  assert.equal(sent.update, update); assert.equal(sent.currentStatus, 'draft'); assert.deepEqual(sent.context, [{ kind: 'source', text: 'Selected source text.' }]);
  assert.deepEqual(pack, before); assert.deepEqual(h.last().result.changes, { nextStep: 'Ask the owner.' });
});
test('changing update or status under the same key aborts a pending proposal', async () => {
  for (const modify of [(value) => ({ pack: value, update: 'New context.' }), (value) => ({ pack: { ...value, status: 'active' }, update: '' })]) {
    const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
    await h.client.setTask('one', pack); const p = h.client.generate();
    const changed = modify(pack); await h.client.setTask('one', changed.pack, [], changed.update);
    assert.equal(h.calls[1].options.signal.aborted, true); pending.resolve(Response.json(result())); await p;
    assert.equal(h.last().phase, 'ready'); assert.equal(h.last().result, null);
    assert.equal(h.last().update, changed.update); assert.equal(h.last().currentStatus, changed.pack.status);
  }
});
test('invalid status/update never loads settings or calls inference', async () => {
  for (const [value, update] of [[{ ...pack, status: undefined }, ''], [{ ...pack, status: 'other' }, ''], [pack, 'x'.repeat(1001)], [pack, 'bad\u0000']]) {
    const h = harness(); await h.client.setTask('one', value, [], update); await h.client.generate();
    assert.equal(h.last().phase, 'error'); assert.equal(h.calls.length, 0);
  }
});
test('legacy prompt configuration is refused before generation', async () => {
  const h = harness(() => Response.json({ ...config, promptVersion: 'next-step.v3' }));
  await h.client.setTask('one', pack); await h.client.generate();
  assert.equal(h.last().phase, 'error'); assert.equal(h.calls.length, 1);
});
test('client rejects commands, completion, empty-update basis and inconsistent state', async () => {
  for (const change of [v => { v.suggestion.changes.next = 'Start'; }, v => { v.suggestion.changes.status = 'done'; },
    v => { v.suggestion.basis = ['update']; }, v => { v.suggestion.changes.status = 'blocked'; }]) {
    const h = harness((_, options) => { const value = options.method === 'POST' ? result() : { ...config }; if (options.method === 'POST') change(value); return Response.json(value); });
    await h.client.setTask('one', pack); await h.client.generate();
    assert.equal(h.last().phase, 'error'); assert.equal(h.last().result, null);
  }
});
test('double click issues one model request', async () => {
  const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
  await h.client.setTask('one', pack); const p = h.client.generate(); await h.client.generate();
  assert.equal(h.calls.length, 2); pending.resolve(Response.json(result())); await p;
});
test('changed task aborts and discards a late model answer', async () => {
  const pending = deferred(), h = harness((_, options) => options.method === 'POST' ? pending.promise : Response.json(config));
  await h.client.setTask('one', pack); const p = h.client.generate();
  await h.client.setTask('two', { ...pack, title: 'New task' });
  assert.equal(h.calls[1].options.signal.aborted, true); pending.resolve(Response.json(result())); await p;
  assert.equal(h.last().phase, 'ready'); assert.equal(h.last().result, null); assert.equal(h.last().task.title, 'New task');
});
test('unmount ignores a late configuration response', async () => {
  const pending = deferred(), h = harness(() => pending.promise); const p = h.client.setTask('one', pack);
  h.client.dispose(); const count = h.views.length; pending.resolve(Response.json(config)); await p;
  assert.equal(h.views.length, count); assert.equal(h.calls[0].options.signal.aborted, true);
});
test('disabled or absent API shows an unavailable state without inference', async () => {
  const h = harness(() => new Response('Not found', { status: 404 }));
  await h.client.setTask('one', pack); await h.client.generate(); assert.equal(h.last().phase, 'unavailable'); assert.equal(h.calls.length, 1);
});
test('model mismatch, save claim and overlong response cannot reach the editor', async () => {
  for (const change of [v => { v.model = 'other'; }, v => { v.applied = true; }, v => { v.suggestion.changes.nextStep = 'x'.repeat(201); }]) {
    const h = harness((_, options) => { const value = options.method === 'POST' ? result() : { ...config }; if (options.method === 'POST') change(value); return Response.json(value); });
    await h.client.setTask('one', pack); await h.client.generate();
    assert.equal(h.last().phase, 'error'); assert.equal(h.last().result, null); assert.equal(h.calls.length, 2);
  }
});
test('failed inference never retries automatically or echoes raw provider errors', async () => {
  const h = harness((_, options) => options.method === 'POST' ? Response.json({ error: 'PRIVATE', code: 'unknown' }, { status: 502 }) : Response.json(config));
  await h.client.setTask('one', pack); await h.client.generate(); await h.client.generate();
  assert.equal(h.calls.length, 2); assert.equal(h.last().error.includes('PRIVATE'), false);
});
