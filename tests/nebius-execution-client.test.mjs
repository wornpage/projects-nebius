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
