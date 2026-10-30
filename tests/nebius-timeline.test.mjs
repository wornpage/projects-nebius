import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHECK_RUNNER } from '../worker/nebius-sandbox.mjs';
import { wrapRunChecks, validateRunChecksSyntax } from '../worker/nebius-run-checks.mjs';
import { Script } from 'node:vm';
import { renderRunPreview, runPageContract } from '../worker/nebius-run-preview.mjs';
import { TIMELINE_VALIDATOR_SOURCE, validateTimelinePatch } from '../svelte-frontend/src/lib/nebius-timeline-contract.mjs';
import recordedExample from '../examples/nebius-release-checker.json' with { type: 'json' };

const timeline = () => ({
  unit: 'days', horizon: 10,
  rows: [{ id: 'delivery', label: 'Delivery', start: 1, end: 6, baselineStart: 1, baselineEnd: 4 }],
});
const patch = () => ({ id: 'schedule', text: 'Projected schedule', timeline: timeline() });
const html = '<!doctype html>\n<output id="schedule" data-output-format="timeline" aria-label="Schedule comparison"></output>';
const app = `function validate(value) { return value; }
function handleMessage() { return [${JSON.stringify(patch())}]; }
module.exports = { validate, handleMessage };`;
const checks = `assert.equal(validate('ok'), 'ok');
const patches = handleMessage({ type: 'init', values: {} });
assert.equal(patches[0].text, 'Projected schedule');
assert.equal(patches[0].timeline.horizon, 10);
assert.equal(patches[0].timeline.rows[0].baselineEnd, 4);
assert.equal(patches[0].timeline.rows[0].end, 6);`;
const files = (page = html, appSource = app, checkSource = checks) => [
  { path: 'index.html', content: page },
  { path: 'app.js', content: appSource },
  { path: 'checks.cjs', content: checkSource },
];

function runChecks(t, appSource = app, page = html, checkSource = checks) {
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(join(parent, 'nebius-timeline-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), parent);
    assert.ok(basename(directory).startsWith('nebius-timeline-'));
    rmSync(directory, { recursive: true });
  });
  writeFileSync(join(directory, 'app.js'), appSource);
  writeFileSync(join(directory, 'checks.cjs'), checkSource);
  writeFileSync(join(directory, 'control-contract.json'), JSON.stringify(runPageContract(files(page, appSource, checkSource))));
  const result = spawnSync(process.execPath, ['-e', CHECK_RUNNER], {
    cwd: directory, encoding: 'utf8', timeout: 6000, maxBuffer: 8192, windowsHide: true,
  });
  assert.ifError(result.error);
  return result;
}

test('timeline validator accepts and normalizes the exact bounded contract', () => {
  assert.deepEqual(validateTimelinePatch(patch(), 'timeline'), timeline());
  assert.match(TIMELINE_VALIDATOR_SOURCE, /^\(function validateTimelinePatch/u);
});

for (const [name, mutate, expected] of [
  ['undeclared output', value => value, /undeclared output/u],
  ['missing accompanying text', value => { delete value.text; }, /unsupported fields/u],
  ['blank accompanying text', value => { value.text = '   '; }, /accompany bounded text/u],
  ['extra patch field', value => { value.style = 'position:fixed'; }, /unsupported fields/u],
  ['HTML payload field', value => { value.timeline.html = '<svg></svg>'; }, /unsupported fields/u],
  ['unsupported unit', value => { value.timeline.unit = 'hours'; }, /unit must be days/u],
  ['fractional horizon', value => { value.timeline.horizon = 10.5; }, /bounded integer/u],
  ['oversized horizon', value => { value.timeline.horizon = 91; }, /bounded integer/u],
  ['empty rows', value => { value.timeline.rows = []; }, /bounded array/u],
  ['duplicate row ID', value => { value.timeline.rows.push({ ...value.timeline.rows[0] }); }, /unique bounded ASCII/u],
  ['blank label', value => { value.timeline.rows[0].label = '   '; }, /nonblank text/u],
  ['nonfinite time', value => { value.timeline.rows[0].end = Infinity; }, /bounded integer/u],
  ['reversed scenario range', value => { value.timeline.rows[0].end = 1; }, /positive duration/u],
  ['boxed numeric coercion', value => { value.timeline.rows[0].start = new Number(1); }, /bounded integer/u],
]) test(`timeline validator rejects ${name}`, () => {
  const value = patch();
  mutate(value);
  const outputFormat = name === 'undeclared output' ? null : 'timeline';
  assert.throws(() => validateTimelinePatch(value, outputFormat), expected);
});

test('timeline validator rejects accessors and custom prototypes without invoking coercion', () => {
  let getterCalls = 0;
  const getter = patch();
  Object.defineProperty(getter.timeline.rows[0], 'label', { enumerable: true, get() { getterCalls += 1; return 'Delivery'; } });
  assert.throws(() => validateTimelinePatch(getter, 'timeline'), /own enumerable data/u);
  assert.equal(getterCalls, 0);

  const inherited = patch();
  inherited.timeline = Object.assign(Object.create({ unit: 'days' }), inherited.timeline);
  assert.throws(() => validateTimelinePatch(inherited, 'timeline'), /ordinary object prototype/u);

  const inheritedPatch = Object.assign(Object.create({ injected: true }), patch());
  assert.throws(() => validateTimelinePatch(inheritedPatch, 'timeline'), /ordinary object prototype/u);
});

test('page contract admits only a declared output timeline and keeps ordinary text outputs', () => {
  const contract = runPageContract(files());
  const output = contract.elements.find(element => element.id === 'schedule');
  assert.equal(output.outputFormat, 'timeline');
  assert.deepEqual(output.fields, ['hidden', 'text', 'timeline']);
  assert.equal(output.requiresText, true);

  const ordinary = runPageContract(files('<output id="schedule"></output>')).elements[0];
  assert.equal(ordinary.outputFormat, null);
  assert.deepEqual(ordinary.fields, ['hidden', 'text']);
  for (const invalid of [
    '<pre id="schedule" data-output="true" data-output-format="timeline"></pre>',
    '<output id="schedule" data-output-format="chart"></output>',
    '<div id="schedule" data-output-format="timeline"></div>',
  ]) assert.throws(() => runPageContract(files(invalid)), /output format must be timeline on an output element/u);
});

test('timeline diagnostics name the valid element and give exact supported markup', () => {
  assert.throws(() => runPageContract(files('<pre id="schedule" data-output="true" data-output-format="timeline"></pre>')), error => {
    assert.match(error.message, /index\.html: <pre id="schedule">/u);
    assert.match(error.message, /Use <output data-output-format="timeline">/u);
    assert(error.message.length <= 280);
    return true;
  });
});

for (const [name, id] of [['long safe ID', 'a'.repeat(80)], ['hostile ID', 'PRIVATE_ID_DO_NOT_ECHO &lt;payload&gt;'], ['overlong ID', 'PRIVATE_LONG_ID_DO_NOT_ECHO' + 'a'.repeat(200)]]) {
  test(`timeline diagnostic stays bounded with ${name}`, () => {
    assert.throws(() => runPageContract(files('<pre id="' + id + '" data-output-format="PRIVATE_FORMAT_DO_NOT_ECHO"></pre>')), error => {
      assert(error.message.length <= 280);
      assert.doesNotMatch(error.message, /PRIVATE_(?:ID|LONG_ID|FORMAT)_DO_NOT_ECHO/u);
      if (name === 'long safe ID') assert(error.message.includes(id));
      return true;
    });
  });
}

test('static checks admission and isolated execution share the exact prior wrapper bytes', () => {
  const body = 'assert.equal(validate(1), 1);\nhandleMessage({type:"init",values:{}});';
  assert.equal(wrapRunChecks(body), '(function() { "use strict"; const {assert, validate, handleMessage} = __checks;\n' + body + '\n})();');
  assert(CHECK_RUNNER.includes('const checksWrapper = ' + wrapRunChecks.toString() + ';'));
});

for (const [name, body, valid] of [
  ['ordinary assertions', 'assert.equal(validate(1), 1);\nhandleMessage({type:"init",values:{}});', true],
  ['permitted function return syntax', 'assert.equal(1, 1);\nreturn;', true],
  ['invalid JSON as test data', 'const malformed = "{bad JSON}";\nassert.throws(() => JSON.parse(malformed));', true],
  ['comments and templates', 'const text = `self-dependency`;\n/* } ] ) */ assert.equal(text.length, 15);', true],
  ['mismatched delimiters', 'assert.equal(1, 1);\nassert.deepEqual({a:1], {});', false],
  ['unterminated string', 'assert.equal(1, 1);\nconst PRIVATE_SOURCE_DO_NOT_ECHO = "unterminated;', false],
  ['fixed binding redeclaration', 'const assert = {};\nvoid assert;', false],
  ['strict duplicate parameters', 'function local(a, a) {}\nassert.equal(1, 1);', false],
  ['nonasync await', 'await validate(1);\nassert.equal(1, 1);', false],
  ['module import', 'import x from "module";\nassert.equal(1, 1);', false],
]) test(`static checks syntax agrees with Node compilation for ${name}`, () => {
  if (valid) {
    assert.doesNotThrow(() => new Script(wrapRunChecks(body)));
    assert.doesNotThrow(() => validateRunChecksSyntax(body));
  } else {
    assert.throws(() => new Script(wrapRunChecks(body)), SyntaxError);
    assert.throws(() => validateRunChecksSyntax(body), error => {
      assert(error instanceof TypeError);
      if (name === 'fixed binding redeclaration') assert.match(error.message, /^checks\.cjs:\d+:\d+ redeclares supplied assert/u);
      else assert.match(error.message, /^checks\.cjs:\d+:\d+ cannot compile/u);
      assert.doesNotMatch(error.message, /PRIVATE_SOURCE_DO_NOT_ECHO/u);
      assert(error.message.length < 180);
      return true;
    });
  }
});

test('static checks parser enforces UTF-8 byte bounds before parsing', () => {
  assert.throws(() => validateRunChecksSyntax('😀'.repeat(8193)), /source file byte limit/u);
  assert.throws(() => validateRunChecksSyntax({toString() { throw new Error('must not coerce'); }}), /source file byte limit/u);
});

test('synchronous Sandbox checker observes a valid authored timeline patch', t => {
  const result = runChecks(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Observed successful assertions: 5; validate calls: 1; handleMessage calls: 1/u);
});

for (const [name, replacement, expected, page = html] of [
  ['accessor row field', `function handleMessage() {
  const value = ${JSON.stringify(patch())};
  Object.defineProperty(value.timeline.rows[0], 'label', { enumerable: true, get() { return 'Delivery'; } });
  return [value];
}`, /own enumerable data/u],
  ['custom timeline prototype', `function handleMessage() {
  const value = ${JSON.stringify(patch())};
  value.timeline = Object.assign(Object.create({ injected: true }), value.timeline);
  return [value];
}`, /ordinary object prototype/u],
  ['custom outer patch prototype', `function handleMessage() {
  const value = ${JSON.stringify(patch())};
  return [Object.assign(Object.create({ injected: true }), value)];
}`, /ordinary object prototype/u],
  ['undeclared timeline output', `function handleMessage() { return [${JSON.stringify(patch())}]; }`, /patch field is incompatible/u, '<output id="schedule"></output>'],
]) test(`synchronous Sandbox checker rejects ${name}`, t => {
  const appSource = `function validate(value) { return value; }\n${replacement}\nmodule.exports = { validate, handleMessage };`;
  const result = runChecks(t, appSource, page);
  assert.equal(result.status, 1);
  assert.match(result.stderr, expected);
});

test('preview adds a trusted accessible comparison renderer only for declared timelines', async () => {
  const worker = `self.onmessage = () => self.postMessage({ patches: [${JSON.stringify(patch())}] });`;
  const preview = await renderRunPreview(files(html, worker));
  assert.match(preview.html, /@media \(max-width: 375px\)/u);
  assert.match(preview.html, /data-nebius-timeline-bar/u);
  assert.match(preview.html, /setAttribute\('role','img'\)/u);
  assert.match(preview.html, /setAttribute\('aria-label'/u);
  assert.match(preview.html, /Baseline.*Scenario/u);
  assert.match(preview.html, /activeRevision===editRevision/u);
  assert.match(preview.html, /clearOutputs\(\)/u);
  assert.doesNotMatch(preview.html, /innerHTML|insertAdjacentHTML/u);
  assert.match(preview.html, /baseline\.style\.left=.*baseline\.style\.width=/u);
  assert.match(preview.html, /scenario\.style\.left=.*scenario\.style\.width=/u);

  const ordinary = await renderRunPreview(files('<output id="schedule"></output>', worker));
  assert.doesNotMatch(ordinary.html, /data-nebius-timeline-bar/u);
  const retained = await renderRunPreview(recordedExample.files, { requiredInputFormats: recordedExample.requiredInputFormats });
  // The trusted base-layer button palette changes deterministic export bytes.
  assert.equal(createHash('sha256').update(retained.html).digest('hex'), '62a3af930809f5589924980ea07adfcaf5d0b461b0d033be7b790af79e49eb03');
});
