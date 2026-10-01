import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';
import { CHECK_RUNNER, spawnSandbox } from '../worker/nebius-sandbox.mjs';
import { runPageContract } from '../worker/nebius-run-preview.mjs';
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

function runAuthoredChecks(t, appSource, checks, html = '<!doctype html>\n<html><body></body></html>') {
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
  writeFileSync(join(directory, 'control-contract.json'), JSON.stringify(runPageContract([
    { path: 'index.html', content: html }, { path: 'app.js', content: appSource }, { path: 'checks.cjs', content: checks },
  ])));
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
const checkerHtml = checkerFiles.find(file => file.path === 'index.html').content;

test('trusted runner exercises the authored checker event and validation assertions', t => {
  const result = runAuthoredChecks(t, checkerApp, checkerChecks, checkerHtml);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Observed successful assertions: 15; validate calls: 4; handleMessage calls: 7/u);
  assert.match(result.stdout, /Control events observed: 6\/6; declared JSON example loaders: 2\/2; inputs without a declared format: 0/u);
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
    const result = runAuthoredChecks(t, checkerApp.replace(before, after), checkerChecks, checkerHtml);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Generated checks failed:/u);
    assert.doesNotMatch(result.stdout, /Observed successful assertions:/u);
  });
}

test('both scripts are compiled before app or checks execute', t => {
  const result = runAuthoredChecks(t, 'throw new Error("app must not execute");\nconst broken = {', 'const broken = {\n');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JavaScript syntax failed: app\.js:/u);
  assert.match(result.stderr, /checks\.cjs:/u);
  assert.doesNotMatch(result.stderr, /app must not execute/u);
  assert.equal(result.stdout, '');
});

test('malformed check syntax retains its original source location', t => {
  const result = runAuthoredChecks(t, checkerApp, "const example = { candidate: 'authored' };\nconst message = { type: 'event', values: { packet: '{}' } );", checkerHtml);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JavaScript syntax failed: checks\.cjs: Unexpected token '\)'/u);
  assert.match(result.stderr, /Source locations: checks\.cjs:2/u);
});

for (const [name, before, after, expected] of [
  ['unknown output ID', "id: 'result'", "id: 'ghost'", /ID absent from the sanitized index\.html/u],
  ['text sent to textarea', "id: 'result'", "id: 'packet'", /patch field is incompatible/u],
  ['malformed JSON example', 'JSON.stringify(packet, null, 2)', "'{'", /JSON example loader returned malformed JSON/u],
]) {
  test(`control contract rejects authored defect: ${name}`, t => {
    assert.ok(checkerApp.includes(before));
    const result = runAuthoredChecks(t, checkerApp.replaceAll(before, after), checkerChecks, checkerHtml);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.equal(result.stdout, '');
  });
}

test('caught patch contract failures remain sticky', t => {
  const app = checkerApp.replaceAll("id: 'result'", "id: 'ghost'");
  const checks = "const assert = require('node:assert/strict');\nconst {validate, handleMessage} = require('./app.js');\ntry { handleMessage({type:'init',values:{packet:''}}); } catch {}\nassert.match(validate('{'), /^Input error:/);";
  const result = runAuthoredChecks(t, app, checks, checkerHtml);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Control contract failed: A patch targets an ID absent/u);
});

test('function call counts alone cannot replace complete control event coverage', t => {
  const checks = "const assert = require('node:assert/strict');\nconst {validate, handleMessage} = require('./app.js');\nhandleMessage({type:'init',values:{packet:''}});\nassert.match(validate('{'), /^Input error:/);";
  const result = runAuthoredChecks(t, checkerApp, checks, checkerHtml);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Control event coverage is incomplete: 1\/6/u);
  assert.match(result.stderr, /Missing input:packet, change:packet/u);
});

test('real edit responses must refresh an already observed output even if model assertions accept a no-op', t => {
  const app = checkerApp.replace("return [{ id: 'result', text: 'Input changed. Check packet again.' }];", 'return [];');
  const checks = "const assert = require('node:assert/strict');\nconst {validate, handleMessage} = require('./app.js');\nhandleMessage({type:'init',values:{packet:''}});\nassert.match(validate('{'), /^Input error:/);\nassert.deepEqual(handleMessage({type:'event',event:'input',id:'packet',values:{packet:'{'}}),[]);";
  const result = runAuthoredChecks(t, app, checks, checkerHtml);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /input edit or loader must refresh every previously observed output/u);
});

test('a valid empty output patch clears the result', t => {
  const app = checkerApp.replace("text: 'Input changed. Check packet again.'", "text: ''");
  const checks = checkerChecks.replace("'Input changed. Check packet again.'", "''");
  const result = runAuthoredChecks(t, app, checks, checkerHtml);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Control events observed: 6\/6/u);
});

test('undeclared JSON formats are reported as unknown rather than certified', t => {
  const html = checkerHtml.replace(' data-input-format="json"', '');
  const result = runAuthoredChecks(t, checkerApp, checkerChecks, html);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /declared JSON example loaders: 0\/2; inputs without a declared format: 1/u);
});

for (const [name, message, expected] of [
  ['missing event type', "{type:'event',id:'packet',values:{packet:''}}", /only the browser message fields as plain data/u],
  ['incomplete input snapshot', "{type:'init',values:{}}", /complete page input snapshot/u],
  ['unknown value key', "{type:'init',values:{other:''}}", /snapshot must match the declared input controls/u],
]) {
  test(`control contract rejects handler check with ${name}`, t => {
    const checks = "const {handleMessage}=require('./app.js');\nhandleMessage(" + message + ');';
    const result = runAuthoredChecks(t, checkerApp, checks, checkerHtml);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  });
}

test('server contract is derived from sanitized markup, including declared loader relationships', () => {
  const html = checkerHtml.replace('</main>', '<script id="removed-script"></script><iframe id="removed-frame"></iframe></main>');
  const contract = runPageContract(checkerFiles.map(file => file.path === 'index.html' ? { ...file, content: html } : file));
  assert.equal(contract.elements.length, 5);
  assert.equal(contract.elements.some(element => element.id.startsWith('removed')), false);
  assert.deepEqual(contract.elements.find(element => element.id === 'packet').events, ['input', 'change']);
  assert.equal(contract.elements.find(element => element.id === 'packet').format, 'json');
  assert.equal(contract.elements.find(element => element.id === 'load-corrected').exampleFor, 'packet');
  assert.deepEqual(contract.elements.find(element => element.id === 'result').fields, ['hidden', 'text']);
});

test('edit events before the first output do not qualify post-output invalidation', t => {
  const html = '<!doctype html>\n<textarea id="field" data-input-format="text"></textarea><button id="check">Check</button><output id="result"></output>';
  const app = "function validate(value){return value;}\nfunction handleMessage(message){return message.id==='check'?[{id:'result',text:'Observed answer'}]:[];}\nmodule.exports={validate,handleMessage};";
  const checks = "const assert=require('node:assert/strict');\nconst {validate,handleMessage}=require('./app.js');\nassert.equal(validate('x'),'x');\nhandleMessage({type:'init',values:{field:''}});\nfor(const event of ['input','change'])handleMessage({type:'event',event,id:'field',values:{field:'changed'}});\nhandleMessage({type:'event',event:'click',id:'check',values:{field:'changed'}});";
  const result = runAuthoredChecks(t, app, checks, html);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Post-output edit coverage is incomplete: 0\/2/u);
});

test('declared JSON loader validates the final effective input value', t => {
  const app = checkerApp.replace("return [{ id: 'packet', value }, { id: 'result', text: validate(value) }];", "return [{ id: 'packet', value }, { id: 'packet', value: '{' }, { id: 'result', text: validate(value) }];");
  const result = runAuthoredChecks(t, app, checkerChecks, checkerHtml);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON example loader returned malformed JSON/u);
});

for (const [name, message] of [
  ['extra own test flag', "{type:'init',values:{packet:''},testFlag:true}"],
  ['non-enumerable test flag', "Object.defineProperty({type:'init',values:{packet:''}},'testFlag',{value:true})"],
  ['value accessor', "{type:'init',get values(){return {packet:''};}}"],
]) {
  test(`plain browser messages reject ${name}`, t => {
    const checks = "const {handleMessage}=require('./app.js');\nhandleMessage(" + message + ');';
    const result = runAuthoredChecks(t, checkerApp, checks, checkerHtml);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /only the browser message fields as plain data|real init or event message shape/u);
  });
}

test('inherited test flags are removed before the actual app handles a message', t => {
  const app = checkerApp.replace('function handleMessage(message) {', "function handleMessage(message) {\n  if(message.testFlag) return [{id:'ghost',text:'Test-only behavior'}];");
  const checks = checkerChecks.replace("{ type: 'init', values: { packet: '' } }", "Object.assign(Object.create({testFlag:true}),{ type: 'init', values: { packet: '' } })");
  const result = runAuthoredChecks(t, app, checks, checkerHtml);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Post-output edits observed: 2\/2/u);
});

test('native input kinds, readonly applicability and disabled fieldsets match browser behavior', () => {
  const html = '<!doctype html>\n<fieldset disabled><legend><input id="legend-check" type="CHECKBOX"></legend><input id="blocked"><fieldset><legend><input id="also-blocked"></legend></fieldset></fieldset><input id="checkbox" type="CHECKBOX" readonly><input id="submit" type="SUBMIT"><input id="image" type="IMAGE"><select id="choice" readonly></select><textarea id="read-only" readonly></textarea>';
  const contract = runPageContract(checkerFiles.map(file => file.path === 'index.html' ? {...file,content:html} : file));
  const element = id => contract.elements.find(item => item.id === id);
  assert.equal(element('checkbox').booleanValue, true);
  assert.deepEqual(element('checkbox').events, ['input','change']);
  assert.deepEqual(element('legend-check').events, ['input','change']);
  assert.deepEqual(element('blocked').events, []);
  assert.deepEqual(element('also-blocked').events, []);
  assert.deepEqual(element('submit').events, ['click']);
  assert.deepEqual(element('image').events, ['click']);
  assert.deepEqual(element('choice').events, ['input','change']);
  assert.deepEqual(element('read-only').events, []);
});

test('static pre content needs no ID or refresh; declared dynamic pre outputs do', () => {
  const html = checkerHtml.replace('</main>', '<pre>Static sample</pre><pre id="code-sample">Static code</pre><pre id="dynamic" data-output="true"></pre></main>');
  const contract = runPageContract(checkerFiles.map(file => file.path === 'index.html' ? {...file,content:html} : file));
  assert.equal(contract.elements.find(element => element.id === 'code-sample').requiresText, false);
  assert.equal(contract.elements.find(element => element.id === 'dynamic').requiresText, true);
});

for (const [name, replacement, expected] of [
  ['custom patch iterator conceals bad indexed contents', "const patches=[{id:'ghost',text:'Bad indexed patch'}]; patches[Symbol.iterator]=function*(){yield {id:'result',text:'Concealed patch'};}; return patches;", /bounded plain-data patches/u],
  ['inherited patch ID', "const patch=Object.create({id:'result'}); patch.text='Inherited ID'; patch.hidden=false; return [patch];", /ID absent from the sanitized index\.html/u],
  ['accessor patch field', "return [{id:'result',get text(){return 'Accessor output';}}];", /own enumerable plain data/u],
  ['proxy patch array', "return new Proxy([{id:'result',text:'Proxy output'}],{});", /bounded plain-data patches/u],
  ['non-data array property', "const patches=[{id:'result',text:'Output'}]; patches.helper=()=>{}; return patches;", /bounded plain-data patches/u],
]) {
  test(`trusted patch observations reject ${name}`, t => {
    const app = checkerApp.replace("return [{ id: 'result', text: 'Load an example or enter a packet to check.' }];", replacement);
    const result = runAuthoredChecks(t, app, checkerChecks, checkerHtml);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.equal(result.stdout, '');
  });
}

test('a caught revoked-proxy response still fails the complete run', t => {
  const app = checkerApp.replace('function handleMessage(message) {', "function handleMessage(message) {\n  if(message.values.packet==='revoked'){const pair=Proxy.revocable([],{});pair.revoke();return pair.proxy;}");
  const checks = "const {handleMessage:probe}=require('./app.js');\ntry{probe({type:'init',values:{packet:'revoked'}});}catch{}\n" + checkerChecks;
  const result = runAuthoredChecks(t, app, checks, checkerHtml);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Control contract failed: handleMessage must return a patch array/u);
  assert.equal(result.stdout, '');
});

test('a caught revoked-proxy message still fails the complete run', t => {
  const checks = "const {handleMessage:probe}=require('./app.js');\nconst pair=Proxy.revocable({},{});pair.revoke();\ntry{probe(pair.proxy);}catch{}\n" + checkerChecks;
  const result = runAuthoredChecks(t, checkerApp, checks, checkerHtml);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Control contract failed: A handler check must use the real init or event message shape/u);
});

for (const [name, html, expected] of [
  ['duplicate IDs', checkerHtml.replace('</main>', '<output id="result"></output></main>'), /IDs must be unique/u],
  ['missing control ID', checkerHtml.replace('id="packet"', ''), /control and output needs an ID/u],
  ['over 200 bound elements', '<!doctype html>\n' + Array.from({length:201}, (_, index) => '<div id="item-' + index + '"></div>').join(''), /200-element binding limit/u],
  ['invalid example target', checkerHtml.replace('data-example-for="packet"', 'data-example-for="ghost"'), /example-loader target/u],
  ['unsupported declared format', checkerHtml.replace('data-input-format="json"', 'data-input-format="yaml"'), /format must be text or json/u],
]) {
  test(`sanitized page contract rejects ${name}`, () => {
    assert.throws(() => runPageContract(checkerFiles.map(file => file.path === 'index.html' ? { ...file, content: html } : file)), expected);
  });
}

test('sandbox submission carries the actual page contract without adding an operation or changing limits', async () => {
  let requests = 0;
  const operationId = '00000000-0000-4000-8000-000000000010';
  const imageId = '00000000-0000-4000-8000-000000000011';
  const actual = await spawnSandbox({iamToken:'synthetic',projectId:'synthetic',imageId}, checkerFiles, {
    fetcher: async (url, options) => {
      requests += 1;
      const body = JSON.parse(options.body);
      assert.equal(url, 'https://api.tokenfactory.nebius.com/sandboxes/v1/instances');
      assert.equal(options.method, 'POST');
      assert.equal(body.timeout, 30);
      assert.deepEqual(body.networking, {enabled:false});
      assert.equal(body.shell, false);
      const payload = JSON.parse(Buffer.from(body.stdin.value, 'base64').toString('utf8'));
      assert.deepEqual(payload.files, checkerFiles);
      assert.deepEqual(payload.pageContract, runPageContract(checkerFiles));
      assert.match(body.args[1], /control-contract\.json/u);
      assert.doesNotThrow(() => new Script(body.args[1]), 'The actual trusted harness passed to Sandbox must compile.');
      assert.doesNotMatch(body.args[1], /\['--check', 'app\.js'\]/u);
      return Response.json({image:imageId,uuid:'00000000-0000-4000-8000-000000000012'}, {
        status:201,headers:{location:'https://api.tokenfactory.nebius.com/sandboxes/v1/operations/' + operationId},
      });
    },
  });
  assert.equal(actual, operationId);
  assert.equal(requests, 1);
});
