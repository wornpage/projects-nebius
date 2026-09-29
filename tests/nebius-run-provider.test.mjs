import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { generateRunFiles } from '../worker/nebius-run-provider.mjs';

const model = 'nvidia/synthetic-code-model';
const fixture = () => [
  {path:'index.html',lines:['<!doctype html>','<output id="result"></output>']},
  {path:'app.js',lines:[
    'function validate(value) { return value; }',
    "function handleMessage(message) { return [{id:'result',text:validate(message.values.input)}]; }",
  ]},
  {path:'checks.cjs',lines:[
    "const assert = require('node:assert/strict');",
    "const {validate} = require('./app.js');",
    "assert.equal(validate('ok'), 'ok');",
  ]},
];

function fileBlocks(files) {
  return files.map(file => '```' + (file.path === 'index.html' ? 'html' : 'javascript') + ' ' + file.path + '\n' + file.lines.join('\n') + '\n```').join('\n\n');
}

function mockedProvider(files, inspect = () => {}) {
  return async (url, options) => {
    assert.equal(url, 'https://api.tokenfactory.nebius.com/v1/chat/completions');
    inspect(JSON.parse(options.body));
    return Response.json({model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{
      finish_reason:'stop',message:{role:'assistant',content:typeof files==='string'?files:fileBlocks(files)},
    }]});
  };
}
const generate = (files, inspect, repair = null) => generateRunFiles({apiKey:'synthetic-key',model},{},repair,{fetcher:mockedProvider(files,inspect)});

test('native file blocks become materialized files with one server runtime bridge', async () => {
  const files = fixture();
  const result = await generate(files, request => {
    assert.equal(Object.hasOwn(request,'response_format'),false);
    assert.equal(request.max_tokens, 8000);
    assert.deepEqual(request.chat_template_kwargs, {enable_thinking:true,force_nonempty_content:true});
    assert.match(request.messages[0].content, /The server appends its own message handler and Node export/u);
  });
  for (const file of result.files) {
    const logic=files.find(source=>source.path===file.path).lines.join('\n');
    if (file.path==='app.js') {
      assert.ok(file.content.startsWith(logic+'\n;\n'));
      assert.equal(file.content.match(/self\.onmessage/g)?.length,1);
      assert.equal(file.content.match(/module\.exports/g)?.length,1);
    } else assert.equal(file.content,logic);
  }
  assert.deepEqual(result.usage,{inputTokens:10,outputTokens:20});
});

for (const [name, mutate] of [
  ['one packed line', files => { files[2].lines=[files[2].lines.join(' ')]; }],
  ['bare carriage return', files => { files[2].lines[0]+='\rx'; }],
  ['Unicode line separator', files => { files[2].lines[0]+='\u2028'; }],
  ['oversized line', files => { files[2].lines[0]='x'.repeat(1025); }],
  ['oversized Unicode line', files => { files[0].lines[1]=String.fromCodePoint(0x1f680).repeat(1025); }],
  ['too many lines', files => { files[2].lines=Array(1025).fill(''); }],
  ['file byte limit', files => { files[1].lines.push(...Array(40).fill('x'.repeat(1000))); }],
]) {
  test(`source generation rejects ${name}`, async () => {
    const files=fixture(); mutate(files);
    await assert.rejects(generate(files), error => error.code==='invalid_model_output'
      && ['tool_files','tool_checks'].includes(error.stage) && error.usage.outputTokens===20);
  });
}

test('Unicode line limit counts code points', async () => {
  const files=fixture();
  files[0].lines[1]=String.fromCodePoint(0x1f680).repeat(1024);
  const result=await generate(files);
  assert.equal(result.files[0].content,files[0].lines.join('\n'));
});

test('ordinary comments and logging reach the trusted runtime assertion gate', async () => {
  const files=fixture();
  files[2].lines.splice(2,0,'// Check the supplied value','/* Synchronous assertion follows. */');
  files[2].lines.push("console.log('Untrusted success claim');");
  const result=await generate(files);
  assert.equal(result.files[2].content,files[2].lines.join('\n'));
});

test('repair preserves the maximum line count and canonical content exactly', async () => {
  const files=fixture();
  files[0].lines=[...files[0].lines,...Array(1022).fill('')];
  files[1].lines=[...files[1].lines,...Array(1022).fill('')];
  const generated=await generate(files);
  const repaired=await generate(files, request => {
    const prompt=request.messages[1].content;
    assert.ok(prompt.includes(fileBlocks(files)));
    assert.match(prompt, /"exitCode": 1/u);
    assert.equal(prompt.includes('self.onmessage'),false);
    assert.deepEqual(request.chat_template_kwargs, {enable_thinking:true,force_nonempty_content:true});
    assert.equal(request.max_tokens,8000);
  }, {files:generated.files,check:{exitCode:1,stderr:'A controlled check failed.'}});
  assert.deepEqual(repaired.files,generated.files);
});

test('server bridge dispatches worker messages and exports the actual validation function', async () => {
  const {files}=await generate(fixture());
  const script=files.find(file=>file.path==='app.js').content;
  const node={module:{exports:{}}};
  runInNewContext(script,node,{timeout:1000});
  assert.equal(node.module.exports.validate('ok'),'ok');
  let reply;
  const worker={self:{postMessage:value=>{reply=value;}}};
  runInNewContext(script,worker,{timeout:1000});
  worker.self.onmessage({data:{type:'init',values:{input:'ok'}}});
  assert.deepEqual(JSON.parse(JSON.stringify(reply)),{patches:[{id:'result',text:'ok'}]});
});

test('server bridge rejects non-array message replies', async () => {
  const files=fixture();
  files[1].lines[1]='function handleMessage() { return {}; }';
  const generated=await generate(files);
  const worker={self:{postMessage:()=>assert.fail('An invalid reply must not be posted.')}};
  runInNewContext(generated.files[1].content,worker,{timeout:1000});
  assert.throws(()=>worker.self.onmessage({data:{type:'init',values:{}}}),/must return a patch array/u);
});

for (const missing of ['validate','handleMessage']) {
  test(`server bridge exposes missing ${missing} during isolated module loading`, async () => {
    const files=fixture();
    files[1].lines=files[1].lines.map(line=>line.startsWith('function '+missing+'(')?'// Missing required function':line);
    const generated=await generate(files);
    assert.throws(()=>runInNewContext(generated.files[1].content,{module:{exports:{}}},{timeout:1000}),/must define validate and handleMessage/u);
  });
}

test('a trailing line comment cannot hide the appended bridge', async () => {
  const files=fixture(); files[1].lines.push('// Last source line');
  const generated=await generate(files);
  const context={module:{exports:{}}};
  runInNewContext(generated.files[1].content,context,{timeout:1000});
  assert.equal(context.module.exports.validate('ok'),'ok');
});

test('app file size includes the server bridge', async () => {
  const files=fixture();
  while (files[1].lines.join('\n').length+1001<32768) files[1].lines.push(' '.repeat(1000));
  files[1].lines.push(' '.repeat(32768-files[1].lines.join('\n').length-1));
  assert.equal(files[1].lines.join('\n').length,32768);
  await assert.rejects(generate(files),error=>error.code==='invalid_model_output'&&error.stage==='tool_files');
});

for (const name of ['self','globalThis','onmessage','addEventListener','postMessage','module','exports']) {
  test(`generated logic cannot own the runtime bridge identifier ${name}`, async () => {
    const files=fixture(); files[1].lines.push('// '+name);
    await assert.rejects(generate(files),error=>error.code==='invalid_model_output'&&error.stage==='tool_worker'&&error.usage.outputTokens===20);
  });
}

test('generated logic still cannot reference forbidden browser APIs', async () => {
  const files=fixture(); files[1].lines.push('// fetch');
  await assert.rejects(generate(files),error=>error.code==='invalid_model_output'&&error.stage==='tool_worker');
});

test('repair refuses source without its exact bridge before requesting inference', async () => {
  const files=fixture(); const generated=await generate(files);
  generated.files[1].content+='\n';
  let called=false;
  await assert.rejects(generate(files,()=>{called=true;},{files:generated.files,check:{exitCode:1,stderr:'Controlled failure'}}),error=>error.code==='invalid_run_source');
  assert.equal(called,false);
});

for (const [name, output] of [
  ['legacy JSON source lines',()=>JSON.stringify({files:fixture()})],
  ['legacy JSON content',()=>JSON.stringify({files:fixture().map(file=>({path:file.path,content:file.lines.join('\n')}))})],
  ['missing initial file',()=>fileBlocks(fixture().slice(0,2))],
  ['unknown path',()=>fileBlocks([...fixture(),{path:'extra.js',lines:['// extra','// file']}])],
  ['traversal path',()=>fileBlocks([{path:'../app.js',lines:['// extra','// file']},...fixture()])],
  ['duplicate file',()=>fileBlocks([...fixture(),fixture()[0]])],
  ['leading prose',()=> 'Here are your files:\n'+fileBlocks(fixture())],
  ['trailing prose',()=>fileBlocks(fixture())+'\nAll tests pass.'],
  ['unterminated block',()=>fileBlocks(fixture()).slice(0,-3)],
  ['nested fence',()=>fileBlocks(fixture()).replace('<!doctype html>','```javascript extra.js')],
  ['empty file',()=>fileBlocks([{path:'index.html',lines:[]},...fixture().slice(1)])],
  ['wrong language',()=>fileBlocks(fixture()).replace('```javascript app.js','```python app.js')],
]) {
  test(`native file parser rejects ${name}`,async()=>{
    await assert.rejects(generate(output()),error=>error.code==='invalid_model_output'&&error.stage==='tool_files'&&error.usage.outputTokens===20);
  });
}

test('native files preserve JavaScript escaping, indentation and trailing blank lines',async()=>{
  const files=fixture();
  files[1].lines.push('const quoted = "a\\nb\\\"c";','  // preserve indentation','');
  const generated=await generate(files);
  assert.ok(generated.files[1].content.startsWith(files[1].lines.join('\n')+'\n;\n'));
  const context={module:{exports:{}}};
  runInNewContext(generated.files[1].content,context,{timeout:1000});
  assert.equal(context.module.exports.validate('ok'),'ok');
});

test('CRLF file blocks normalize to LF without trimming source',async()=>{
  const files=fixture();files[0].lines.push('');
  const generated=await generate(fileBlocks(files).replace(/\n/g,'\r\n'));
  assert.equal(generated.files[0].content,files[0].lines.join('\n'));
});

test('repair replaces only named files and preserves other source exactly',async()=>{
  const original=await generate(fixture());
  const changed=fixture()[1];
  changed.lines[0]='function validate(value) { return value.trim(); }';
  const repaired=await generate([changed],request=>{
    assert.equal(Object.hasOwn(request,'response_format'),false);
    assert.match(request.messages[0].content,/Omitted files remain byte-for-byte unchanged/u);
    assert.ok(request.messages[1].content.includes(fileBlocks(fixture())));
  },{files:original.files,check:{exitCode:1,stderr:'Controlled fixture error'}});
  assert.deepEqual(repaired.files[0],original.files[0]);
  assert.deepEqual(repaired.files[2],original.files[2]);
  assert.ok(repaired.files[1].content.startsWith(changed.lines.join('\n')+'\n;\n'));
  assert.equal(repaired.files[1].content.match(/self\.onmessage/g)?.length,1);
});

test('repair refuses an empty replacement without masking the failed check',async()=>{
  const original=await generate(fixture());
  await assert.rejects(generate('',undefined,{files:original.files,check:{exitCode:1,stderr:'Controlled failure'}}),error=>error.code==='invalid_model_output'&&error.stage==='tool_files');
});

test('changed repair files still pass ownership validation',async()=>{
  const original=await generate(fixture());
  const changed=fixture()[1];changed.lines.push('// self');
  await assert.rejects(generate([changed],undefined,{files:original.files,check:{exitCode:1,stderr:'Controlled failure'}}),error=>error.code==='invalid_model_output'&&error.stage==='tool_worker');
});
