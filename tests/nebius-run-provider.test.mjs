import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { generateRunFiles } from '../worker/nebius-run-provider.mjs';
import { validateRunRecord } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const model = 'nvidia/synthetic-code-model';
const fixture = () => [
  {path:'index.html',lines:['<!doctype html>','<output id="result"></output>']},
  {path:'app.js',lines:[
    'function validate(value) { return value; }',
    "function handleMessage(message) { return [{id:'result',text:validate(message.values.input)}]; }",
  ]},
  {path:'checks.cjs',lines:[
    "const assert = require('node:assert/strict');",
    "const {validate, handleMessage} = require('./app.js');",
    "assert.equal(validate('ok'), 'ok');",
    "assert.equal(handleMessage({type:'event',event:'input',id:'input',values:{input:'ok'}})[0].text, 'ok');",
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
    assert.match(request.messages[0].content, /call the actual exported validate and handleMessage functions/u);
    assert.match(request.messages[0].content, /Never keep a readiness or success result for an earlier input/u);
    assert.match(request.messages[0].content, /an invalid enum must produce an input error/u);
    assert.match(request.messages[0].content, /Preserve and assert any exact output prefixes, capitalization, separators and singular\/plural forms specified by the task/u);
    assert.doesNotMatch(request.messages[0].content, /Input error:|1 gap:|demo-42/u);
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
    assert.match(request.messages[0].content, /Preserve and assert any exact output prefixes, capitalization, separators and singular\/plural forms specified by the task/u);
  }, {files:generated.files,check:{exitCode:1,stderr:'A controlled check failed.'}});
  assert.deepEqual(repaired.files,generated.files);
});

test('server bridge dispatches worker messages and exports both actual functions', async () => {
  const {files}=await generate(fixture());
  const script=files.find(file=>file.path==='app.js').content;
  const node={module:{exports:{}}};
  runInNewContext(script,node,{timeout:1000});
  assert.equal(node.module.exports.validate('ok'),'ok');
  assert.deepEqual(Object.keys(node.module.exports).sort(),['handleMessage','validate']);
  assert.equal(node.module.exports.handleMessage({type:'event',event:'input',id:'input',values:{input:'changed'}})[0].text,'changed');
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

for (const [name, output, reason] of [
  ['legacy JSON source lines',()=>JSON.stringify({files:fixture()}), /exact allowed file header on response line 1/u],
  ['legacy JSON content',()=>JSON.stringify({files:fixture().map(file=>({path:file.path,content:file.lines.join('\n')}))}), /exact allowed file header on response line 1/u],
  ['missing initial file',()=>fileBlocks(fixture().slice(0,2)), /Missing required source files: checks\.cjs\./u],
  ['unknown path',()=>fileBlocks([...fixture(),{path:'extra.js',lines:['// extra','// file']}]), /exact allowed file header on response line \d+/u],
  ['traversal path',()=>fileBlocks([{path:'../app.js',lines:['// extra','// file']},...fixture()]), /exact allowed file header on response line 1/u],
  ['duplicate file',()=>fileBlocks([...fixture(),fixture()[0]]), /index\.html is repeated on response line \d+/u],
  ['leading prose',()=> 'Here are your files:\n'+fileBlocks(fixture()), /exact allowed file header on response line 1/u],
  ['trailing prose',()=>fileBlocks(fixture())+'\nAll tests pass.', /exact allowed file header on response line \d+/u],
  ['unterminated block',()=>fileBlocks(fixture()).slice(0,-3), /checks\.cjs is missing its closing file fence/u],
  ['nested fence',()=>fileBlocks(fixture()).replace('<!doctype html>','```javascript extra.js'), /Nested or indented file fence in index\.html on response line 2/u],
  ['empty file',()=>fileBlocks([{path:'index.html',lines:[]},...fixture().slice(1)]), /index\.html must contain 2 to 1024 source lines/u],
  ['wrong language',()=>fileBlocks(fixture()).replace('```javascript app.js','```python app.js'), /exact allowed file header on response line \d+/u],
]) {
  test(`native file parser rejects ${name}`,async()=>{
    await assert.rejects(generate(output()),error=>{
      assert.equal(error.code,'invalid_model_output');
      assert.equal(error.stage,'tool_files');
      assert.deepEqual(error.usage,{inputTokens:10,outputTokens:20});
      assert.match(error.message,reason);
      assert.equal(error.uncertain,false);
      return true;
    });
  });
}

for (const [name, mutate, reason] of [
  ['empty reply',()=>'', /At least one source file block is required/u],
  ['bare CR',text=>text.replace('<!doctype html>','<!doctype\rhtml>'), /LF or CRLF source line separators/u],
  ['Unicode separator',text=>text.replace('<!doctype html>','<!doctype\u2028html>'), /LF or CRLF source line separators/u],
  ['indented closing fence',text=>text.replace('\n```','\n ```'), /Nested or indented file fence in index\.html/u],
  ['overlong source line',text=>text.replace('<!doctype html>','x'.repeat(1025)), /index\.html source line 1 exceeds 1024 characters/u],
  ['too many source lines',text=>text.replace('<!doctype html>',Array(1024).fill('// line').join('\n')), /index\.html must contain 2 to 1024 source lines/u],
  ['blank page',text=>text.replace('<!doctype html>\n<output id="result"></output>',' \n '), /The generated files are invalid/u],
  ['NUL in page',text=>text.replace('<!doctype html>','<!doctype html>\u0000'), /The generated files are invalid/u],
  ['oversized file',text=>text.replace('<!doctype html>',Array(33).fill('x'.repeat(1024)).join('\n')), /A generated file exceeds its size limit/u],
]) {
  test(`file diagnostics retain ${name} reason without the rejected reply`,async()=>{
    const reply=mutate(fileBlocks(fixture()));
    await assert.rejects(generate(reply),error=>{
      assert.match(error.message,reason);
      assert.equal(error.stage,'tool_files');
      assert.equal(error.code,'invalid_model_output');
      assert.deepEqual(error.usage,{inputTokens:10,outputTokens:20});
      assert.deepEqual(Object.keys(error).sort(),['code','stage','uncertain','usage']);
      assert.ok(error.message.length<240);
      return true;
    });
  });
}

test('file diagnostics never echo unknown headers or private provider text',async()=>{
  const marker='SYNTHETIC_PRIVATE_PROVIDER_TEXT';
  await assert.rejects(generate(marker+'\n'+fileBlocks(fixture())),error=>{
    assert.match(error.message,/exact allowed file header on response line 1/u);
    assert.doesNotMatch(error.message,new RegExp(marker));
    assert.doesNotMatch(JSON.stringify(error),new RegExp(marker));
    return true;
  });
});

test('shared total-size rejection retains its safe diagnostic',async()=>{
  const files=fixture().map(file=>({...file,lines:[...file.lines,...Array(23).fill('x'.repeat(1024))]}));
  await assert.rejects(generate(files),error=>{
    assert.match(error.message,/The generated tool exceeds its total size limit/u);
    assert.equal(error.stage,'tool_files');
    assert.deepEqual(error.usage,{inputTokens:10,outputTokens:20});
    return true;
  });
});

test('failed RunRecord preserves the parser reason and usage without inventing files or checks',async()=>{
  let failure;
  try { await generate('SYNTHETIC_REJECTED_SOURCE'); }
  catch (error) { failure=error; }
  assert.ok(failure);
  const record=validateRunRecord({
    id:'00000000-0000-4000-8000-000000000000',version:'browser-tool.v1',packId:'synthetic-task',
    pack:{title:'Build a tool',purpose:'Diagnose file format',nextStep:'Build the tool',blocker:'none',doneWhen:'Return the required files'},
    currentStatus:'active',context:[],requestedModel:model,status:'failed',attempt:0,
    createdAt:'2026-09-30T00:00:00.000Z',updatedAt:'2026-09-30T00:00:01.000Z',events:[],files:[],checks:[],
    usage:{modelCalls:1,...failure.usage,totalsComplete:true},error:failure.message,
    failure:{code:failure.code,stage:failure.stage},
  });
  assert.equal(record.error,failure.message);
  assert.match(record.error,/exact allowed file header on response line 1/u);
  assert.deepEqual(record.failure,{code:'invalid_model_output',stage:'tool_files'});
  assert.deepEqual(record.usage,{modelCalls:1,inputTokens:10,outputTokens:20,totalsComplete:true});
  assert.deepEqual(record.files,[]);
  assert.deepEqual(record.checks,[]);
  assert.doesNotMatch(JSON.stringify(record),/SYNTHETIC_REJECTED_SOURCE/u);
  assert.throws(()=>validateRunRecord({...record,status:'ready'}),/The execution failure details are invalid/u);
  assert.throws(()=>validateRunRecord({...record,status:'ready',error:null,failure:null}),/A ready result needs observed successful checks/u);
});

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
