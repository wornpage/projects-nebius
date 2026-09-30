import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHECK_RUNNER } from '../worker/nebius-sandbox.mjs';
import { authoredCheckerFiles, materializeAuthoredChecker } from './fixtures/nebius-release-checker.mjs';

// Exercise the actual trusted runner with authored fixtures only. Never execute
// model-generated files on the host: Nebius container isolation is still required.
const cases = [
  ['real functions and deep assertion', "const assert=require('node:assert/strict'); const {validate,handleMessage}=require('./app.js'); handleMessage({type:'init',values:{}}); assert.deepStrictEqual(validate('ok'),{value:'ok'});", 0],
  ['commented-out assertions', "const assert=require('node:assert'); const {validate}=require('./app.js'); // assert.ok(validate('ok'));", 1],
  ['assertion without validate', "const assert=require('node:assert'); assert.ok(true);", 1],
  ['caught assertion failure', "const assert=require('node:assert'); const {validate,handleMessage}=require('./app.js'); handleMessage({type:'init',values:{}}); try { assert.strictEqual(validate('ok').value,'wrong'); } catch {} assert.ok(true);", 1],
  ['callable strict assertions', "const assert=require('node:assert').strict; const {validate,handleMessage}=require('./app.js'); handleMessage({type:'init',values:{}}); assert(validate('ok').value==='ok');", 0],
  ['comments and discarded logging with real assertions', "const assert=require('node:assert/strict'); const {validate,handleMessage}=require('./app.js');\n// Ordinary check commentary\nconsole.log('Untrusted success claim');\nhandleMessage({type:'init',values:{}});\nassert.equal(validate('ok').value,'ok');", 0],
  ['logging cannot replace commented-out assertions', "const assert=require('node:assert'); const {validate}=require('./app.js');\nconsole.log('Untrusted success claim'); // assert.ok(validate('ok'));", 1],
  ['unapproved import', "require('node:fs');", 1],
  ['runtime errors identify original source lines',
    "const assert=require('node:assert/strict');\nconst {validate}=require('./app.js');\nassert.equal(validate(),1);", 1,
    'function validate() {\n  if (true) {\n    const scoped = 1;\n  }\n  return scoped;\n}\nfunction handleMessage() { return []; }\nmodule.exports = {validate,handleMessage};',
    /Generated checks failed: scoped is not defined/u],
  ['validate assertions without a handler call', "const assert=require('node:assert/strict'); const {validate}=require('./app.js'); assert.equal(validate('ok').value,'ok');", 1],
  ['handler assertions without a validate call', "const assert=require('node:assert/strict'); const {handleMessage}=require('./app.js'); assert.deepEqual(handleMessage({type:'init',values:{}}),[]);", 1],
  ['a caught validate throw is not a successful call', "const assert=require('node:assert/strict'); const {validate,handleMessage}=require('./app.js'); assert.throws(()=>validate('bad')); handleMessage({type:'init',values:{}});", 1,
    "function validate() { throw new Error('bad'); }\nfunction handleMessage() { return []; }\nmodule.exports={validate,handleMessage};"],
  ['a caught handler throw is not a successful call', "const assert=require('node:assert/strict'); const {validate,handleMessage}=require('./app.js'); validate('ok'); assert.throws(()=>handleMessage({type:'init',values:{}}));", 1,
    "function validate(value) { return value; }\nfunction handleMessage() { throw new Error('bad'); }\nmodule.exports={validate,handleMessage};"],
  ['a non-array handler reply cannot be counted', "const assert=require('node:assert/strict'); const {validate,handleMessage}=require('./app.js'); assert.equal(validate('ok'),'ok'); assert.ok(handleMessage({type:'init',values:{}}));", 1,
    "function validate(value) { return value; }\nfunction handleMessage() { return {}; }\nmodule.exports={validate,handleMessage};", /handleMessage must return a patch array/u],
  ['an async handler reply cannot be counted', "const assert=require('node:assert/strict'); const {validate,handleMessage}=require('./app.js'); assert.equal(validate('ok'),'ok'); assert.ok(handleMessage({type:'init',values:{}}));", 1,
    "function validate(value) { return value; }\nfunction handleMessage() { return Promise.resolve([]); }\nmodule.exports={validate,handleMessage};", /handleMessage must return a patch array/u],
  ['missing handler export fails before checks', "const assert=require('node:assert/strict'); const {validate}=require('./app.js'); assert.ok(validate('ok'));", 1,
    'module.exports.validate = value => value;', /app.js must export a handleMessage function/u],
  ['the actual function facade cannot be replaced', "const assert=require('node:assert/strict'); const app=require('./app.js'); app.handleMessage=()=>[]; assert.ok(app.validate('ok'));", 1,
    undefined, /Cannot assign to read only property/u],
];

function runAuthoredChecks(t, appSource, checks) {
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(join(parent, 'nebius-check-fixture-'));
  t.after(() => {
    const target = resolve(directory);
    assert.equal(dirname(target), parent);
    assert.ok(basename(target).startsWith('nebius-check-fixture-'));
    rmSync(target, {recursive:true});
  });
  writeFileSync(join(directory, 'app.js'), appSource);
  writeFileSync(join(directory, 'checks.cjs'), checks);
  const result = spawnSync(process.execPath, ['-e', CHECK_RUNNER], {
    cwd:directory, encoding:'utf8', timeout:6000, maxBuffer:8192, windowsHide:true,
  });
  assert.ifError(result.error);
  return result;
}

for (const [name, checks, expectedExit, appSource, expectedFailure] of cases) {
  test(`trusted check runner: ${name}`, t => {
    const result = runAuthoredChecks(t, appSource ?? 'function validate(value) { return {value}; }\nfunction handleMessage() { return []; }\nmodule.exports = {validate,handleMessage};', checks);
    assert.equal(result.status, expectedExit, result.stderr);
    assert.doesNotMatch(result.stdout, /Untrusted success claim/u);
    if (expectedExit === 0) {
      assert.match(result.stdout, /Observed successful assertions: 1; validate calls: 1; handleMessage calls: 1/u);
    } else {
      assert.match(result.stderr, expectedFailure ?? /Generated checks failed: (Checks must execute|checks\.cjs may import only)/u);
      if (name === 'runtime errors identify original source lines') {
        assert.match(result.stderr, /\bapp\.js:5:\d+/u);
        assert.match(result.stderr, /\bchecks\.cjs:3:\d+/u);
        assert.doesNotMatch(result.stderr, /\[eval\]|node:vm|jkbSoft|\/tmp\/wornpage/u);
      }
    }
  });
}

const checkerFiles = await materializeAuthoredChecker();
const checkerApp = checkerFiles.find(file => file.path === 'app.js').content;
const checkerChecks = checkerFiles.find(file => file.path === 'checks.cjs').content;

test('trusted runner exercises the authored checker event and validation assertions', t => {
  const result = runAuthoredChecks(t, checkerApp, checkerChecks);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Observed successful assertions: 15; validate calls: 4; handleMessage calls: 7/u);
});

for (const [name, before, after] of [
  ['missing edit invalidation', "return [{ id: 'result', text: 'Input changed. Check packet again.' }];", 'return [];'],
  ['missing example output', "return [{ id: 'packet', value }, { id: 'result', text: validate(value) }];", "return [{ id: 'packet', value }];"],
  ['unsupported health enum accepted', "if (!['missing', 'failing', 'passing'].includes(packet.health))", 'if (false)'],
  ['unsupported review enum accepted', "if (!['pending', 'rejected', 'approved'].includes(packet.review))", 'if (false)'],
  ['always-ready validation', 'function validate(text) {', "function validate(text) {\n  return '0 gaps: Ready for human review';"],
]) {
  test(`trusted runner rejects authored checker mutant: ${name}`, t => {
    assert.equal(checkerApp.split(before).length, 2, 'The authored mutation must replace one exact source site.');
    const result = runAuthoredChecks(t, checkerApp.replace(before, after), checkerChecks);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Generated checks failed:/u);
    assert.doesNotMatch(result.stdout, /Observed successful assertions:/u);
  });
}
