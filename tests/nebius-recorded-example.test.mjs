import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import example from '../examples/nebius-release-checker.json' with { type: 'json' };
import { handleRecordedExample, RECORDED_EXAMPLE_PATH, RECORDED_EXAMPLE_DIGEST, validateRecordedExample } from '../worker/nebius-recorded-example.mjs';
import { assertPreviewInputDeclaration } from '../scripts/nebius-retained-checker.mjs';

const url = 'http://localhost' + RECORDED_EXAMPLE_PATH;
const copy = () => structuredClone(example);

test('the recorded sample contains only selected source and necessary provenance', async () => {
  assert.deepEqual(Object.keys(example).sort(), ['files', 'format', 'model', 'recordedOn', 'requiredInputFormats', 'title']);
  const value = await validateRecordedExample(example);
  assert.equal(value.sourceDigest, 'bef3f967a4f28d06cc27a2d9ce46039472847b7dfeb02077d455ee16b97a2bac');
  assert.equal(value.sourceDigest, RECORDED_EXAMPLE_DIGEST);
  assert.deepEqual(value.files.map(file => file.path), ['index.html', 'app.js', 'checks.cjs']);
});

test('GET renders unchanged recorded source with the current renderer without a provider or workspace request', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('No network is needed for recorded source.'); });
  const response = await handleRecordedExample(new Request(url, { headers: { authorization: 'Bearer synthetic-unused-key' } }));
  assert.equal(response.status, 200);
  const html = await response.text();
  // The current renderer applies neutral button styling and 44px input targets.
  // Source identity remains independently checked by RECORDED_EXAMPLE_DIGEST.
  assert.equal(createHash('sha256').update(html).digest('hex'), '62a3af930809f5589924980ea07adfcaf5d0b461b0d033be7b790af79e49eb03');
  assert.match(html, /:where\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="hidden"\]\), select\) \{ min-height: 44px; \}/u);
  assert.match(html, /background: #fffefa; border-color: #6c8b76; color: #24352d; margin: \.25rem/u);
  assert.equal(fetch.mock.calls.length, 0);
  assert.match(html, /http-equiv="Content-Security-Policy"/u);
  assert.equal(html.includes('synthetic-unused-key'), false);
  const csp = response.headers.get('content-security-policy');
  for (const policy of ["connect-src 'none'", "frame-ancestors 'self'", 'sandbox allow-scripts', 'worker-src blob:', "form-action 'none'"]) assert(csp.includes(policy), policy);
  assert.equal(csp.includes('allow-same-origin'), false);
  assert.equal(response.headers.get('x-frame-options'), null);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-nebius-source-digest'), RECORDED_EXAMPLE_DIGEST);
});

test('HEAD preserves preview policy without a body', async () => {
  const response = await handleRecordedExample(new Request(url, { method: 'HEAD' }));
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
  assert.match(response.headers.get('content-security-policy'), /sandbox allow-scripts/u);
});

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) test(method + ' cannot execute or alter the recorded example', async () => {
  const response = await handleRecordedExample({ url, method, get body() { throw new Error('Mutating request bodies must not be read.'); } });
  assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('only the fixed exact path and no parameters are accepted', async () => {
  for (const path of [RECORDED_EXAMPLE_PATH + '/', '/api/nebius/examples/other']) assert.equal((await handleRecordedExample(new Request('http://localhost' + path))).status, 404);
  const response = await handleRecordedExample(new Request(url + '?key=synthetic-unused-key'));
  assert.equal(response.status, 400); assert.equal((await response.text()).includes('synthetic-unused-key'), false);
});

for (const name of ['runKey', 'generationAttempts', 'sourceDigest', 'credentials']) test('the sample rejects the extra field ' + name, async () => {
  const value = copy(); value[name] = 'unexpected'; await assert.rejects(validateRecordedExample(value), /unexpected fields/u);
});
for (const name of ['format', 'title', 'model', 'recordedOn']) test('the sample rejects changed provenance ' + name, async () => {
  const value = copy(); value[name] = 'changed'; await assert.rejects(validateRecordedExample(value), /provenance/u);
});
for (const files of [[], example.files.slice(0, 2), [...example.files, example.files[0]], [{ path: 'other.html', content: 'wrong' }, ...example.files.slice(1)]]) test('the sample rejects invalid file paths or cardinality ' + JSON.stringify(files.map(file => file.path)), async () => {
  const value = copy(); value.files = structuredClone(files); await assert.rejects(validateRecordedExample(value));
});
test('substituted source cannot supply its own replacement digest', async () => {
  const value = copy(); value.files[0].content += '\n<!-- Changed after the observed run. -->';
  await assert.rejects(validateRecordedExample(value), /observed source/u);
});
test('oversized source is rejected before rendering', async () => {
  const value = copy(); value.files[0].content = 'a'.repeat(32769); await assert.rejects(validateRecordedExample(value));
});
for (const requirement of [null, [], [{ id: 'input-json', format: 'text' }], [{ id: 'other', format: 'json' }]]) test('task-owned JSON requirements cannot drift: ' + JSON.stringify(requirement), async () => {
  const value = copy(); value.requiredInputFormats = requirement; await assert.rejects(validateRecordedExample(value));
});

const replayOrigin = 'http://127.0.0.1:4317';
const retainedRunId = '36a89cac-1234-4234-8234-123456789abc';
function nativePreview({ runId = retainedRunId, expanded = true, declaration = 'JSON' } = {}) {
  return [
    '  1 AXWebArea Review, URL: http://127.0.0.1:4317/review',
    '    2 heading 1 · Request',
    '      3 text JSON',
    '        4 AXWebArea Isolated tool, URL: http://127.0.0.1:4317/api/nebius/runs/' + runId + '/preview',
    `         5 button (${expanded ? 'expanded' : 'collapsed'}) Input formats`,
    '          6 text Input formats',
    '         7 definition list',
    '          8 container Packet JSON',
    '           9 text Packet JSON',
    '          10 text ' + declaration,
    '         11 text Declared by the tool. Check these against your task.',
    '         12 container Tool updates',
    '    13 heading 4 · Decision'
  ].join('\n');
}

test('native preview JSON assertion handles the summary and definition list as siblings', () => {
  assert.doesNotThrow(() => assertPreviewInputDeclaration(nativePreview(), retainedRunId, 'JSON', replayOrigin));
  assert.doesNotThrow(() => assertPreviewInputDeclaration(nativePreview().replace('definition list', 'definitionlist').replaceAll('URL:', 'URL'), retainedRunId, 'JSON', replayOrigin));
});

test('native preview JSON assertion accepts the observed CUA Collapse annotation only on expanded disclosure', () => {
  const decorated = nativePreview().replace('5 button (expanded) Input formats', '81 button (expanded) Input formats, Secondary Actions: Collapse');
  assert.doesNotThrow(() => assertPreviewInputDeclaration(decorated, retainedRunId, 'JSON', replayOrigin));
  const collapsed = decorated.replace('button (expanded) Input formats, Secondary Actions: Collapse', 'button (collapsed) Input formats, Secondary Actions: Expand');
  assert.throws(() => assertPreviewInputDeclaration(collapsed, retainedRunId, 'JSON', replayOrigin), /expanded Input formats/u);
  assert.throws(() => assertPreviewInputDeclaration(decorated.replace('Secondary Actions: Collapse', 'Secondary Actions: Expand'), retainedRunId, 'JSON', replayOrigin), /expanded Input formats/u);
  assert.throws(() => assertPreviewInputDeclaration(decorated.replace('Secondary Actions: Collapse', 'Secondary Actions: Other'), retainedRunId, 'JSON', replayOrigin), /expanded Input formats/u);
});

test('native preview JSON assertion binds the observed scheme-free URL to the exact replay origin', () => {
  // Relevant lines transcribed from the saved native-preview-AX.txt observation.
  const observedRun = '36a89cac-8c56-4a47-aad8-aff67803ca9e';
  const observedOrigin = 'http://127.0.0.1:63954';
  const observed = [
    [7, '73 AXWebArea Release Packet Checker, URL: 127.0.0.1:63954/api/nebius/runs/' + observedRun + '/preview'],
    [9, '81 button (expanded) Input formats, Secondary Actions: Collapse'],
    [10, '82 text Input formats'],
    [9, '84 definition list'],
    [10, '85 container Packet JSON:'],
    [11, '86 text Packet JSON:'],
    [10, '87 text JSON'],
    [9, '88 text Declared by the tool. Check these against your task.']
  ].map(([depth, text]) => '\t'.repeat(depth) + text).join('\n');
  assert.doesNotThrow(() => assertPreviewInputDeclaration(observed, observedRun, 'JSON', observedOrigin));
  assert.doesNotThrow(() => assertPreviewInputDeclaration(observed.replace('URL: 127.', 'URL: http://127.'), observedRun, 'JSON', observedOrigin));
  for (const address of ['127.0.0.1:63955', 'http://127.0.0.1:63955', 'localhost:63954', 'example.test:63954', 'https://127.0.0.1:63954']) {
    assert.throws(() => assertPreviewInputDeclaration(observed.replace('127.0.0.1:63954', address), observedRun, 'JSON', observedOrigin), /preview AXWebArea/u);
  }
  for (const suffix of ['?key=unused', '#fragment', '/']) {
    assert.throws(() => assertPreviewInputDeclaration(observed.replace('/preview\n', '/preview' + suffix + '\n'), observedRun, 'JSON', observedOrigin), /preview AXWebArea/u);
  }
  assert.throws(() => assertPreviewInputDeclaration(observed + '\n' + observed, observedRun, 'JSON', observedOrigin), /unambiguous preview/u);
});

test('native preview JSON assertion requires a credential-free exact HTTP loopback origin', () => {
  for (const origin of [undefined, null, '', 'http://localhost:4317', 'https://127.0.0.1:4317',
    'http://127.0.0.1:4317/', 'http://127.0.0.1:4317/review', 'http://127.0.0.1:4317?key=unused',
    'http://127.0.0.1:4317#fragment', 'http://user:secret@127.0.0.1:4317', 'http://example.test:4317']) {
    assert.throws(() => assertPreviewInputDeclaration(nativePreview(), retainedRunId, 'JSON', origin), /exact HTTP loopback replay origin/u);
  }
});

test('native preview JSON assertion rejects outer-page JSON, wrong or missing run frame', () => {
  assert.throws(() => assertPreviewInputDeclaration(nativePreview({ runId: 'other-run' }), retainedRunId, 'JSON', replayOrigin), /preview AXWebArea/u);
  assert.throws(() => assertPreviewInputDeclaration('1 heading Request\n  2 text JSON', retainedRunId, 'JSON', replayOrigin), /preview AXWebArea/u);
  assert.throws(() => assertPreviewInputDeclaration(nativePreview({ declaration: 'Plain text' }), retainedRunId, 'JSON', replayOrigin), /JSON declaration/u);
  for (const replacement of ['https://127.0.0.1:4317', 'http://localhost:4317', 'http://example.test']) {
    assert.throws(() => assertPreviewInputDeclaration(nativePreview().replaceAll('http://127.0.0.1:4317', replacement), retainedRunId, 'JSON', replayOrigin), /preview AXWebArea/u);
  }
  assert.throws(() => assertPreviewInputDeclaration(nativePreview().replace('/preview\n', '/preview?key=unused\n'), retainedRunId, 'JSON', replayOrigin), /preview AXWebArea/u);
});

test('native preview JSON assertion rejects collapsed or ambiguous frame and disclosure', () => {
  assert.throws(() => assertPreviewInputDeclaration(nativePreview({ expanded: false }), retainedRunId, 'JSON', replayOrigin), /expanded Input formats/u);
  assert.throws(() => assertPreviewInputDeclaration(nativePreview() + '\n' + nativePreview(), retainedRunId, 'JSON', replayOrigin), /unambiguous preview/u);
  assert.throws(() => assertPreviewInputDeclaration(nativePreview().replace('         12 container Tool updates', '         12 button (expanded) Input formats'), retainedRunId, 'JSON', replayOrigin), /expanded Input formats/u);
  assert.throws(() => assertPreviewInputDeclaration(nativePreview().replace('         12 container Tool updates', '         12 AXWebArea Nested, URL: http://127.0.0.1/other'), retainedRunId, 'JSON', replayOrigin), /Nested preview/u);
});

test('native preview JSON assertion rejects missing, unrelated and inexact declaration text', () => {
  for (const declaration of ['JSON extra', 'Not JSON', 'json', 'Plain text', '']) {
    assert.throws(() => assertPreviewInputDeclaration(nativePreview({ declaration }), retainedRunId, 'JSON', replayOrigin), /JSON declaration/u);
  }
  const noList = nativePreview().replace('         7 definition list', '         7 container Unrelated');
  assert.throws(() => assertPreviewInputDeclaration(noList, retainedRunId, 'JSON', replayOrigin), /declaration list/u);
  const interveningSibling = nativePreview().replace('         7 definition list', '         7 text Other content\n         8 definition list');
  assert.throws(() => assertPreviewInputDeclaration(interveningSibling, retainedRunId, 'JSON', replayOrigin), /declaration list/u);
  const jsonOutsideList = nativePreview({ declaration: 'Plain text' }).replace('         12 container Tool updates', '         12 text JSON');
  assert.throws(() => assertPreviewInputDeclaration(jsonOutsideList, retainedRunId, 'JSON', replayOrigin), /JSON declaration/u);
  const jsonInSummary = nativePreview({ declaration: 'Plain text' }).replace('          6 text Input formats', '          6 text JSON');
  assert.throws(() => assertPreviewInputDeclaration(jsonInSummary, retainedRunId, 'JSON', replayOrigin), /JSON declaration/u);
});
