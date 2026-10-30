import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRunChecksSyntax} from '../worker/nebius-run-checks.mjs';

function rejected(source){
  let result;
  try{validateRunChecksSyntax(source);}catch(error){result=error;}
  assert(result instanceof TypeError, 'The trusted wrapper must reject this source.');
  assert(result.message.length<=180, 'Diagnostic must fit the admission bound.');
  return result.message;
}
for(const name of ['assert','validate','handleMessage'])test(`single supplied ${name} collision remains specialized`,()=>{
  const message=rejected('const '+name+' = 1;');
  assert.match(message,new RegExp('redeclares supplied '+name));
  assert(!message.includes(' | '));
});

test('nested duplicate never claims a supplied-binding collision or duplicate location',()=>{
  const message=rejected('function nested() {\n  let assert = 1;\n  let assert = 2;\n}');
  assert.match(message,/checks\.cjs:3:7 cannot compile in the trusted assertion wrapper/u);
  assert.doesNotMatch(message,/redeclares supplied| \| /u);
});

test('a supplied collision plus a nested duplicate reports both generically',()=>{
  const message=rejected('const assert = 1;\nfunction nested() {\n  let assert = 1;\n  let assert = 2;\n}');
  assert.match(message,/checks\.cjs:1:7 cannot compile/u);
  assert.match(message,/checks\.cjs:4:7 has invalid JavaScript/u);
  assert.doesNotMatch(message,/redeclares supplied/u);
});

test('legal nested shadowing is still accepted',()=>{
  assert.doesNotThrow(()=>validateRunChecksSyntax('function nested(assert, validate, handleMessage) {\n  return assert && validate && handleMessage;\n}'));
});

test('private parser messages and module names never enter either diagnostic',()=>{
  const message=rejected('const assert = require("PRIVATE_MODULE_PATH");\nconst PRIVATE_IDENTIFIER = "PRIVATE_LITERAL');
  assert.match(message,/checks\.cjs:1:7 /u);
  assert.match(message,/checks\.cjs:2:/u);
  assert.doesNotMatch(message,/PRIVATE_|Unterminated|Identifier|require/u);
});

test('a diagnostic parse error in appended wrapper bytes is never exposed as a second source location',()=>{
  const message=rejected('const assert = 1;\nfunction unfinished() {');
  assert.match(message,/checks\.cjs:1:7 cannot compile/u);
  assert.doesNotMatch(message,/ \| |checks\.cjs:3:|checks\.cjs:4:/u);
});

test('CRLF preserves source coordinates',()=>{
  const message=rejected('const assert = 1;\r\nconst PRIVATE_VALUE = ;');
  assert.match(message,/checks\.cjs:1:7 /u);
  assert.match(message,/checks\.cjs:2:/u);
  assert.doesNotMatch(message,/PRIVATE_VALUE/u);
});
test('large source keeps diagnostic size bounded and does not echo private source',()=>{
  const source='const assert = 1;\n'+'\n'.repeat(1000)+'const PRIVATE_FINAL = ;';
  const message=rejected(source);
  assert.match(message,/checks\.cjs:1002:/u);
  assert.doesNotMatch(message,/PRIVATE_FINAL/u);
});

test('unrelated invalid syntax remains one generic rejection',()=>{
  const message=rejected('const PRIVATE_VALUE = ;');
  assert.match(message,/checks\.cjs:1:/u);
  assert.doesNotMatch(message,/ \| |PRIVATE_VALUE|redeclares supplied/u);
});

for(const token of ['}',']',')'])test(`diagnostic recognizes only the parser-reported closing ${token} and exact coordinates`,()=>{
  const source='assert.equal(1, 1);\n  '+token;
  assert.equal(rejected(source),'checks.cjs:2:3 cannot compile in the trusted assertion wrapper. Unexpected closing token '+JSON.stringify(token)+'. Check nearby expressions and delimiter pairs.');
});

test('strings, templates, comments and regular expressions containing closing tokens stay valid',()=>{
  const source='const tokens = "}])";\nconst template = `}])`;\n// }])\n/* }]) */\nconst pattern = /[})\\]]/;\nassert.ok(tokens);';
  assert.doesNotThrow(()=>validateRunChecksSyntax(source));
});

test('unrelated syntax with later closing tokens in data remains generic and private',()=>{
  const source='const PRIVATE_IDENTIFIER = ;\nconst text = "}])";\n// }])';
  const message=rejected(source);
  assert.match(message,/checks\.cjs:1:/u);assert.doesNotMatch(message,/PRIVATE_|Unexpected closing token/u);
});

test('valid return and async await retain trusted-wrapper admission',()=>{
  assert.doesNotThrow(()=>validateRunChecksSyntax('if (true) return;\nassert.equal(1, 1);'));
  assert.doesNotThrow(()=>validateRunChecksSyntax('async function local() {\n  await Promise.resolve();\n  return;\n}'));
});

test('diagnostic body context permits return and await but can never admit a wrapper rejection',()=>{
  for(const statement of ['return;','await Promise.resolve();','return await Promise.resolve();']){
    const source=statement+'\n}';
    assert.match(rejected(source),/checks\.cjs:2:1 .*Unexpected closing token "\}"/u);
  }
  assert.match(rejected('await Promise.resolve();'),/cannot compile in the trusted assertion wrapper/u,
    'Diagnostic-only await permission cannot promote a source body to acceptance.');
});

test('a private duplicate declaration before a closing token keeps generic privacy handling',()=>{
  const message=rejected('const PRIVATE_DUPLICATE = 1;\nconst PRIVATE_DUPLICATE = 2;\n}');
  assert.match(message,/checks\.cjs:2:/u);assert.doesNotMatch(message,/PRIVATE_|Unexpected closing token|Identifier/u);
});

test('recognized closing token does not claim a valid supplied-binding body',()=>{
  const message=rejected('const assert = 1;\n}');
  assert.match(message,/checks\.cjs:2:1 .*Unexpected closing token "\}"/u);
  assert.doesNotMatch(message,/redeclares supplied/u);
});

test('CRLF and deep original line coordinates stay bounded for closing-token feedback',()=>{
  assert.match(rejected('\r\n'.repeat(63)+'}'),/checks\.cjs:64:1 .*Unexpected closing token "\}"/u);
  const message=rejected('\n'.repeat(1000)+'  }');
  assert.match(message,/checks\.cjs:1001:3 .*Unexpected closing token "\}"/u);
  assert(message.length<=180);
});
