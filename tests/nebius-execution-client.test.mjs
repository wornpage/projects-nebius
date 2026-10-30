import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as contract from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const require = createRequire(new URL('../svelte-frontend/package.json', import.meta.url));
const ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../svelte-frontend/src/lib/nebius-execution-client.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

function client(fetcher) {
  const exports = {};
  new Function('exports', 'require', 'fetch', compiled)(exports, specifier => {
    assert.equal(specifier, './nebius-execution-contract.mjs');
    return contract;
  }, fetcher);
  return exports;
}

for (const fixture of [
  { name: 'unexpected content type', headers: { 'content-type': 'text/html' }, chunk: new TextEncoder().encode('<html>'), message: /unexpected text\/html content type/u },
  { name: 'oversized declared body', headers: { 'content-type': 'application/json', 'content-length': String(512 * 1024 + 1) }, chunk: new TextEncoder().encode('{'), message: /size limit/u },
  { name: 'invalid UTF-8', headers: { 'content-type': 'application/json' }, chunk: Uint8Array.of(0xff), message: /valid UTF-8/u },
  { name: 'oversized streamed body', headers: { 'content-type': 'application/json' }, chunk: new Uint8Array(512 * 1024 + 1), message: /size limit/u }
]) {
  test(`execution client cancels a rejected ${fixture.name} response`, async () => {
    let cancellations = 0;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(fixture.chunk); },
      cancel() { cancellations++; }
    }), { headers: fixture.headers });
    const api = client(async () => response);
    await assert.rejects(api.getRunConfig(), fixture.message);
    assert.equal(cancellations, 1, 'Rejected response must release its unread stream.');
    assert.equal(response.body.locked, false);
  });
}

test('execution client preserves its diagnostic when cancelling a rejected stream fails', async () => {
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(Uint8Array.of(0xff)); },
    cancel() { throw new Error('Synthetic cancellation failure'); }
  }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(client(async () => response).getRunConfig(), /valid UTF-8/u);
  assert.equal(response.body.locked, false);
});

test('execution client preserves valid UTF-8 across chunks and releases a completed response', async () => {
  const message = 'Execution unavailable: café 🚀';
  const bytes = new TextEncoder().encode(JSON.stringify({ available: false, code: 'execution_disabled', error: message }));
  const split = bytes.indexOf(0xf0) + 1;
  const chunks = [bytes.subarray(0, split), bytes.subarray(split)];
  let cancellations = 0;
  const response = new Response(new ReadableStream({
    pull(controller) { if (chunks.length) controller.enqueue(chunks.shift()); else controller.close(); },
    cancel() { cancellations++; }
  }), { status: 404, headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await client(async () => response).getRunConfig(), { available: false, message });
  assert.equal(cancellations, 0);
  assert.equal(response.body.locked, false);
});

const runId = '00000000-0000-4000-8000-000000000001';
const runKey = 'a'.repeat(64);
const input = contract.validateRunInput({
  version: contract.RUN_VERSION, packId: 'session-feedback-fixture', currentStatus: 'active', context: [],
  requestedModel: 'nvidia/synthetic-fixture', requiredInputFormats: null, requiredOutputs: null, consent: true,
  pack: { title: 'Authored session fixture', purpose: '', nextStep: 'Read the saved run.', doneWhen: 'Preserve its identity.', blocker: 'None' }
});
const operations = [
  { name: 'configuration', method: 'GET', invoke: api => api.getRunConfig() },
  { name: 'saved-run read', method: 'GET', invoke: api => api.readRun(runId, runKey, input.packId) },
  { name: 'start', method: 'POST', uncertain: true, invoke: api => api.startRun(runId, runKey, input) },
  { name: 'cancellation', method: 'DELETE', uncertain: true, invoke: api => api.cancelRun(runId, runKey, input.packId) },
  { name: 'preview download', method: 'POST', invoke: api => api.downloadRunPreviewHtml(runId, runKey) }
];

for (const operation of operations) {
  for (const opaque of [false, true]) {
    test(`execution client stops ${opaque ? 'opaque' : 'visible'} redirects during ${operation.name}`, async () => {
      let calls = 0;
      const api = client(async (url, options) => {
        calls++;
        assert.equal(options.redirect, 'manual', 'Run keys must never be replayed to a redirect destination.');
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.method || 'GET', operation.method);
        assert.match(url, /^\/api\/nebius\/runs\//u);
        assert(!url.includes(runKey));
        if (opaque) {
          const response = Response.error();
          Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
          return response;
        }
        return Response.redirect('https://signin.invalid/cdn-cgi/access/login/private?private-token=DO_NOT_ECHO', 302);
      });
      await assert.rejects(operation.invoke(api), error => {
        assert(error instanceof api.NebiusRunClientError);
        assert.equal(error.code, 'session_required');
        assert.equal(error.uncertain, operation.uncertain === true);
        assert.equal(error.definitiveStartRejection, false);
        assert.match(error.message, /Sign-in may be required/u);
        assert(!/DO_NOT_ECHO|private-token|signin\.invalid/u.test(error.message));
        return true;
      });
      assert.equal(calls, 1, 'Redirect handling must neither follow nor retry the request.');
    });
  }
}

test('execution client cancels the unread redirect body without reading its location', async () => {
  let cancellations = 0;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('Private redirect content')); },
    cancel() { cancellations++; }
  }), { status: 307 });
  await assert.rejects(client(async () => response).getRunConfig(), error => error.code === 'session_required');
  assert.equal(cancellations, 1);
  assert.equal(response.body.locked, false);
});

for (const failure of [new TypeError('Synthetic network outage'), new DOMException('Synthetic abort', 'AbortError')]) {
  for (const operation of operations) {
    test(`${operation.name} does not label ${failure.name} as a session redirect`, async () => {
      let calls = 0;
      const api = client(async () => { calls++; throw failure; });
      await assert.rejects(operation.invoke(api), error => {
        assert(error instanceof api.NebiusRunClientError);
        assert.notEqual(error.code, 'session_required');
        assert.equal(error.uncertain, operation.uncertain === true);
        assert.equal(error.definitiveStartRejection, false);
        return true;
      });
      assert.equal(calls, 1);
    });
  }
}

for (const status of [401, 403]) {
  test(`ordinary API ${status} invalid run-key responses remain authorization errors`, async () => {
    const api = client(async () => Response.json({ code: 'run_unauthorized', error: 'Provide this run access key.' }, { status }));
    for (const invoke of [() => api.readRun(runId, runKey, input.packId), () => api.cancelRun(runId, runKey, input.packId)]) {
      await assert.rejects(invoke(), error => error instanceof api.NebiusRunClientError && error.code === 'run_unauthorized'
        && error.status === status && error.uncertain === false && error.definitiveStartRejection === false);
    }
    await assert.rejects(api.startRun(runId, runKey, input), error => error.code !== 'session_required'
      && error.uncertain === true && error.definitiveStartRejection === false);
  });
}

test('an unexpected HTML response alone does not assert that sign-in is required', async () => {
  const api = client(async () => new Response('<html>Upstream error</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(api.readRun(runId, runKey, input.packId), error => error.code !== 'session_required'
    && /unexpected text\/html/u.test(error.message));
});

test('a JSON error label alone cannot create the client-owned session redirect signal', async () => {
  const api = client(async () => Response.json({ code: 'session_required', error: 'Authored JSON label without a redirect.' }, { status: 403 }));
  for (const operation of operations) {
    await assert.rejects(operation.invoke(api), error => error instanceof api.NebiusRunClientError
      && error.code !== 'session_required' && error.definitiveStartRejection === false);
  }
});

test('an explicit refresh after sign-in reads the same saved UUID without an automatic retry or new start', async () => {
  const { consent, ...snapshot } = input;
  const run = { ...snapshot, id: runId, status: 'generating', attempt: 0,
    createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', events: [], files: [], checks: [],
    usage: { modelCalls: 1, inputTokens: null, outputTokens: null, totalsComplete: false }, error: null, failure: null, generationAttempts: [] };
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, method: options.method });
    return calls.length === 1 ? Response.redirect('https://signin.invalid/', 302) : Response.json({ run });
  });
  await assert.rejects(api.readRun(runId, runKey, input.packId), error => error.code === 'session_required');
  assert.equal(calls.length, 1);
  assert.deepEqual(await api.readRun(runId, runKey, input.packId), run);
  assert.deepEqual(calls, [
    { url: `/api/nebius/runs/${runId}`, method: 'GET' },
    { url: `/api/nebius/runs/${runId}`, method: 'GET' }
  ]);
});
