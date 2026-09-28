import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CHECK_RUNNER } from '../worker/nebius-sandbox.mjs';

// Exercise the actual trusted runner with authored fixtures only. Never execute
// model-generated files on the host: Nebius container isolation is still required.
const cases = [
  ['real validate and deep assertion', "const assert=require('node:assert/strict'); const {validate}=require('./app.js'); assert.deepStrictEqual(validate('ok'),{value:'ok'});", 0],
  ['commented-out assertions', "const assert=require('node:assert'); const {validate}=require('./app.js'); // assert.ok(validate('ok'));", 1],
  ['assertion without validate', "const assert=require('node:assert'); assert.ok(true);", 1],
  ['caught assertion failure', "const assert=require('node:assert'); const {validate}=require('./app.js'); try { assert.strictEqual(validate('ok').value,'wrong'); } catch {} assert.ok(true);", 1],
  ['callable strict assertions', "const assert=require('node:assert').strict; const {validate}=require('./app.js'); assert(validate('ok').value==='ok');", 0],
  ['comments and discarded logging with real assertions', "const assert=require('node:assert/strict'); const {validate}=require('./app.js');\n// Ordinary check commentary\nconsole.log('Untrusted success claim');\nassert.equal(validate('ok').value,'ok');", 0],
  ['logging cannot replace commented-out assertions', "const assert=require('node:assert'); const {validate}=require('./app.js');\nconsole.log('Untrusted success claim'); // assert.ok(validate('ok'));", 1],
  ['unapproved import', "require('node:fs');", 1],
  ['runtime errors identify original source lines',
    "const assert=require('node:assert/strict');\nconst {validate}=require('./app.js');\nassert.equal(validate(),1);", 1,
    'function validate() {\n  if (true) {\n    const scoped = 1;\n  }\n  return scoped;\n}\nmodule.exports = {validate};',
    /Generated checks failed: scoped is not defined/u],
];

for (const [name, checks, expectedExit, appSource, expectedFailure] of cases) {
  test(`trusted check runner: ${name}`, t => {
    const parent = resolve(tmpdir());
    const directory = mkdtempSync(join(parent, 'nebius-check-fixture-'));
    t.after(() => {
      const target = resolve(directory);
      assert.equal(dirname(target), parent);
      assert.ok(basename(target).startsWith('nebius-check-fixture-'));
      rmSync(target, {recursive:true});
    });
    writeFileSync(join(directory, 'app.js'), appSource ?? 'module.exports.validate = value => ({value});');
    writeFileSync(join(directory, 'checks.cjs'), checks);
    const result = spawnSync(process.execPath, ['-e', CHECK_RUNNER], {
      cwd:directory, encoding:'utf8', timeout:6000, maxBuffer:8192, windowsHide:true,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expectedExit, result.stderr);
    assert.doesNotMatch(result.stdout, /Untrusted success claim/u);
    if (expectedExit === 0) {
      assert.match(result.stdout, /Observed successful assertions: 1; validate calls: 1/u);
    } else {
      assert.match(result.stderr, expectedFailure ?? /Generated checks failed: (Checks must execute|checks\.cjs may import only)/u);
      if (appSource) {
        assert.match(result.stderr, /\bapp\.js:5:\d+/u);
        assert.match(result.stderr, /\bchecks\.cjs:3:\d+/u);
        assert.doesNotMatch(result.stderr, /\[eval\]|node:vm|jkbSoft|\/tmp\/wornpage/u);
      }
    }
  });
}
