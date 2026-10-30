import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import example from '../examples/nebius-recovery-simulator.json' with { type: 'json' };
import { RUN_LIMITS, runFilesDigest } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { WORKER_BRIDGE } from '../worker/nebius-run-materialization.mjs';
import { validateGeneratedSource } from '../worker/nebius-run-admission.mjs';
import { renderRunPreview } from '../worker/nebius-run-preview.mjs';
import { handleRecoveryExample, validateRecoveryExample, isRecoveryExamplePath, RECOVERY_EXAMPLE_PATH, RECOVERY_DOWNLOAD_PATH, RECOVERY_REDIRECT_PATHS } from '../worker/nebius-recovery-example.mjs';

const url = 'http://localhost' + RECOVERY_EXAMPLE_PATH;
const sourceDigest = '1c30eea93daa97ff2e9a4961e75eefa6a4155e542b0925031cc9b766ecfc5c7d';
const copy = () => structuredClone(example);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const allPaths = [RECOVERY_EXAMPLE_PATH, RECOVERY_DOWNLOAD_PATH,
  ...RECOVERY_REDIRECT_PATHS.flatMap(path => [path, path + '/download'])];

// Execute the real router; only the platform base class is replaced. Generated
// app/checks remain strings throughout this suite, never host-executed modules.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'fixture:recovery-cloudflare-workers', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'fixture:recovery-cloudflare-workers') return { format: 'module', shortCircuit: true,
      source: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }' };
    return next(url, context);
  },
});
let worker;
try { worker = (await import('../worker/index.mjs')).default; } finally { hooks.deregister(); }

test('bundled fixture bytes, raw source hashes and materialized digest retain the qualified pins', async () => {
  assert.equal(sha256(await readFile(new URL('../examples/nebius-recovery-simulator.json', import.meta.url))),
    'f9621649f11cf919ab4f53b73f84344e4bff05274eea881b4beba86450a298e3');
  const value = await validateRecoveryExample(example);
  assert.equal(value.sourceDigest, sourceDigest);
  assert.equal(await runFilesDigest(value.files), sourceDigest);
  for (const [index, raw] of example.files.entries()) {
    assert.equal(sha256(raw.content), raw.sha256);
    const canonical = raw.content.replace(/\r\n/gu, '\n').slice(0, -1);
    assert.equal(value.files[index].content, canonical + (raw.path === 'app.js' ? WORKER_BRIDGE : ''));
  }
  assert.equal(value.originalOutcome, 'failed');
  assert.equal(value.sourceKind, 'assistant-authored-extension-of-failed-run');
  assert.equal(value.title, 'Recovery Simulator');
  assert.equal(value.requiredInputFormats.length, 6);
  assert.equal(value.requiredOutputs.length, 12);
  assert.match(example.files[0].content, /<title>Recovery Simulator<\/title>/u);
  assert.doesNotMatch(example.files[0].content, /locally repaired prototype/iu);
});

test('preview and download use the production renderer with the exact input/output admission contract', async () => {
  const value = await validateRecoveryExample(example);
  const requirements = { requiredInputFormats: value.requiredInputFormats, requiredOutputs: value.requiredOutputs };
  const expected = await renderRunPreview(value.files, requirements);
  const preview = await handleRecoveryExample(new Request(url));
  const download = await handleRecoveryExample(new Request('http://localhost' + RECOVERY_DOWNLOAD_PATH));
  assert.equal(preview.status, 200); assert.equal(download.status, 200);
  assert.equal(await preview.text(), expected.html);
  assert.equal(await download.text(), expected.html);
  assert.equal(preview.headers.get('content-security-policy'), expected.csp);
  assert.equal(download.headers.get('content-security-policy'), expected.csp);
  assert.equal(download.headers.get('content-disposition'), 'attachment; filename="recovery-simulator.html"');
  assert.equal(preview.headers.get('content-disposition'), null);
  await assert.rejects(validateGeneratedSource(value.files, { ...requirements,
    requiredOutputs: [{ id: 'missing-required-output', format: 'timeline' }] }));
  await assert.rejects(validateGeneratedSource(value.files, { ...requirements,
    requiredInputFormats: [{ id: 'delay-days', format: 'json' }] }));
});

test('the actual Worker routes both fixed URLs before generic API and never touches network or bindings', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('No network allowed.'); });
  const env = new Proxy({}, { get() { throw new Error('No environment binding allowed.'); } });
  for (const path of [RECOVERY_EXAMPLE_PATH, RECOVERY_DOWNLOAD_PATH]) {
    const response = await worker.fetch(new Request('http://localhost' + path, { headers: { authorization: 'Bearer unused-fixture-key' } }), env);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /data-output-format="timeline"/u);
    assert.equal(html.includes('unused-fixture-key'), false);
    assert.equal(response.headers.get('x-nebius-example'), 'assistant-authored-extension-offline');
    assert.equal(response.headers.get('x-nebius-source-digest'), sourceDigest);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('content-type'), 'text/html;charset=utf-8');
    for (const header of ['set-cookie', 'access-control-allow-origin', 'x-frame-options']) assert.equal(response.headers.get(header), null);
    const csp = response.headers.get('content-security-policy');
    for (const policy of ["connect-src 'none'", "frame-ancestors 'self'", 'sandbox allow-scripts', 'worker-src blob:', "form-action 'none'"]) assert(csp.includes(policy), policy);
    assert.equal(csp.includes('allow-same-origin'), false);
    assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(), payment=()');
  }
  assert.equal(fetch.mock.calls.length, 0);
  assert.equal((await worker.fetch(new Request(url + '?source=ignored'), env)).status, 400);
  assert.equal((await worker.fetch(new Request(url, { method: 'POST', body: 'ignored' }), env)).status, 405);
});

test('HEAD preserves preview/download provenance and policy with no body', async () => {
  for (const path of [RECOVERY_EXAMPLE_PATH, RECOVERY_DOWNLOAD_PATH]) {
    const get = await handleRecoveryExample(new Request('http://localhost' + path));
    const head = await handleRecoveryExample(new Request('http://localhost' + path, { method: 'HEAD' }));
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.deepEqual([...head.headers], [...get.headers]);
  }
});

test('request guards accept only exact fixed paths and parameterless GET/HEAD', async () => {
  for (const path of [RECOVERY_EXAMPLE_PATH + '/', RECOVERY_DOWNLOAD_PATH + '/', RECOVERY_EXAMPLE_PATH + '/other', '/api/nebius/examples/other']) {
    assert.equal((await handleRecoveryExample(new Request('http://localhost' + path))).status, 404);
  }
  for (const path of allPaths) {
    for (const suffix of ['?source=unused-secret', '?', '#fragment', '#']) {
      const response = await handleRecoveryExample({ url: 'http://localhost' + path + suffix, method: 'GET' });
      assert.equal(response.status, 400); assert.equal((await response.text()).includes('unused-secret'), false);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await handleRecoveryExample({ url: 'http://localhost' + path, method,
        get body() { throw new Error('Mutation bodies must never be read.'); } });
      assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD');
    }
  }
  assert.equal((await handleRecoveryExample({ url: 'invalid', method: 'HEAD' })).status, 400);
  assert.equal(await (await handleRecoveryExample({ url: url + '?x', method: 'HEAD' })).text(), '');
});

test('named retained links redirect GET/HEAD to the sole canonical preview and download through the real Worker', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('No network allowed.'); });
  const env = new Proxy({}, { get() { throw new Error('No environment binding allowed.'); } });
  for (const legacy of RECOVERY_REDIRECT_PATHS) {
    for (const suffix of ['', '/download']) {
      for (const method of ['GET', 'HEAD']) {
        const path = legacy + suffix;
        assert.equal(isRecoveryExamplePath(path), true);
        const response = await worker.fetch(new Request('http://localhost' + path, { method }), env);
        assert.equal(response.status, 308);
        assert.equal(response.headers.get('location'), RECOVERY_EXAMPLE_PATH + suffix);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('x-nebius-source-digest'), null);
        assert.equal(await response.text(), '');
      }
    }
  }
  for (const path of allPaths) {
    assert.equal(isRecoveryExamplePath(path + '/'), false);
    for (const suffix of ['?source=unused-secret', '?', '#fragment', '#']) {
      const response = await worker.fetch({ url: 'http://localhost' + path + suffix, method: 'HEAD' }, env);
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('location'), null);
      assert.equal(await response.text(), '');
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await worker.fetch({ url: 'http://localhost' + path, method,
        get body() { throw new Error('Do not read a mutation body.'); } }, env);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('location'), null);
    }
  }
  assert.equal(fetch.mock.calls.length, 0);
});

test('every provenance field is required, exact and rejects injected run history', async () => {
  for (const key of ['schemaVersion', 'sourceKind', 'title', 'originalRunId', 'originalOutcome', 'model', 'qualifiedOn', 'qualification']) {
    const missing = copy(); delete missing[key]; await assert.rejects(validateRecoveryExample(missing), /unexpected fields/u);
    const changed = copy(); changed[key] = 'changed'; await assert.rejects(validateRecoveryExample(changed), /provenance/u);
  }
  for (const key of ['runKey', 'generationAttempts', 'checks', 'status', 'sourceDigest', 'credentials']) {
    const value = copy(); value[key] = 'unexpected'; await assert.rejects(validateRecoveryExample(value), /unexpected fields/u);
  }
});

test('all fixed input and output requirements are required and cannot be weakened or extended', async () => {
  for (const key of ['requiredInputFormats', 'requiredOutputs']) {
    const missing = copy(); delete missing[key]; await assert.rejects(validateRecoveryExample(missing));
    for (const changed of [null, [], example[key].slice(1), [...example[key], { id: 'extra', format: 'text' }],
      example[key].map((item, index) => index ? item : { ...item, format: key === 'requiredOutputs' ? 'timeline' : 'json' })]) {
      const value = copy(); value[key] = changed; await assert.rejects(validateRecoveryExample(value));
    }
  }
});

test('source drift, replacement digests, file substitutions and oversize data fail before materialization', async () => {
  for (const index of [0, 1, 2]) {
    const changed = copy(); changed.files[index].content += '\n';
    await assert.rejects(validateRecoveryExample(changed), /pinned raw source/u);
    changed.files[index].sha256 = sha256(changed.files[index].content);
    await assert.rejects(validateRecoveryExample(changed), /source metadata/u);
    const oversized = copy(); oversized.files[index].content = 'é'.repeat(RUN_LIMITS.maxFileBytes / 2 + 1);
    await assert.rejects(validateRecoveryExample(oversized), /size limit/u);
    for (const key of ['path', 'content', 'sha256']) {
      const missing = copy(); delete missing.files[index][key]; await assert.rejects(validateRecoveryExample(missing));
    }
  }
  for (const files of [[], example.files.slice(1), [...example.files, example.files[0]], [...example.files].reverse(),
    [example.files[0], example.files[0], example.files[2]]]) {
    const value = copy(); value.files = structuredClone(files); await assert.rejects(validateRecoveryExample(value));
  }
});

test('unavailable pinned source fails closed without preview or success headers', async t => {
  t.mock.method(crypto.subtle, 'digest', async () => new Uint8Array(32).buffer);
  for (const method of ['GET', 'HEAD']) {
    const response = await handleRecoveryExample(new Request(url, { method }));
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-nebius-source-digest'), null);
    assert.equal(response.headers.get('x-nebius-example'), null);
    assert.equal(response.headers.get('content-security-policy'), null);
    assert.equal(await response.text(), method === 'HEAD' ? '' : 'The recovery simulator is unavailable.');
  }
});

test('an unexpected production materialization digest fails closed after raw pins pass', async t => {
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let materializationDigests = 0;
  t.mock.method(crypto.subtle, 'digest', async (algorithm, bytes) => {
    // runFilesDigest hashes the JSON file array, unlike raw files or bootstrap.
    if (new TextDecoder().decode(bytes).startsWith('[{"path":"index.html"')) {
      materializationDigests += 1;
      return new Uint8Array(32).buffer;
    }
    return digest(algorithm, bytes);
  });
  await assert.rejects(validateRecoveryExample(example), /materialization differs/u);
  const response = await handleRecoveryExample(new Request(url));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-nebius-source-digest'), null);
  assert.equal(response.headers.get('content-security-policy'), null);
  assert.equal(materializationDigests, 2);
});

test('active recovery source stays module-relative and retains the production decoder/admission calls', async () => {
  const source = await readFile(new URL('../worker/nebius-recovery-example.mjs', import.meta.url), 'utf8');
  assert.match(source, /import recoveryExample from '\.\.\/examples\/nebius-recovery-simulator\.json' with \{ type: 'json' \}/u);
  assert.match(source, /const files = decodeSourceLines\(sources\);\s+await validateGeneratedSource\(files, requirements\);/u);
  assert.doesNotMatch(source, /node:fs|file:\/\/|[A-Za-z]:[\\/]|Videos|repaired-endpoint|\beval\s*\(|new Function/u);
});
