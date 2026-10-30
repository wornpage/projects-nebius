import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {AUTHORING_EXAMPLE} from '../worker/nebius-run-authoring-example.mjs';
import {generateRunFiles} from '../worker/nebius-run-provider.mjs';
import {validateGeneratedSource} from '../worker/nebius-run-admission.mjs';
import {wrapRunChecks,validateRunChecksSyntax} from '../worker/nebius-run-checks.mjs';
import {streamEnvelope} from './helpers/nebius-stream-fixture.mjs';

const model='nvidia/authored-test-model';
const requirements={
  requiredInputFormats:[{id:'quantity',format:'text'},{id:'addons',format:'text'}],
  requiredOutputs:[{id:'result',format:'text'},{id:'error',format:'text'}],
};
async function receive(text, repair=null, inspect=()=>{}) {
  return generateRunFiles({apiKey:'authored-test-key',model},requirements,repair,{fetcher:async(url,options)=>{
    assert.equal(url,'https://api.tokenfactory.nebius.com/v1/chat/completions');
    inspect(JSON.parse(options.body));
    return streamEnvelope({model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{
      finish_reason:'stop',message:{role:'assistant',content:text},
    }]});
  }});
}
const native=JSON.stringify(AUTHORING_EXAMPLE);
const plain=value=>JSON.parse(JSON.stringify(value));
// Only this audited, repository-authored constant executes here. Neither
// retained model response is ever passed to VM, Function, require or eval.
function authoredApi(source=AUTHORING_EXAMPLE['app.js']) {
  return runInNewContext(source+'\n({validate,handleMessage})',Object.create(null),{timeout:1000});
}
function authoredChecks(source=AUTHORING_EXAMPLE['app.js'],checks=AUTHORING_EXAMPLE['checks.cjs'],observe=()=>{}) {
  return runInNewContext(source+'\nconst __checks={assert:fixtureAssert,validate,handleMessage:message=>{fixtureObserve(message);return handleMessage(message);}};\n'
    +wrapRunChecks(checks),{fixtureAssert:assert,fixtureObserve:message=>observe(plain(message))},{timeout:1000});
}
const patchText=(patches,id)=>patches.find(p=>p.id===id)?.text;

test('authored example round-trips native JSON source and passes actual static admission',async()=>{
  assert.deepEqual(JSON.parse(native),AUTHORING_EXAMPLE);
  const actual=await receive(native);
  await validateGeneratedSource(actual.files,requirements);
  assert.equal(actual.files.find(f=>f.path==='index.html').content,AUTHORING_EXAMPLE['index.html']);
  assert.equal(actual.files.find(f=>f.path==='checks.cjs').content,AUTHORING_EXAMPLE['checks.cjs']);
  assert.doesNotThrow(()=>validateRunChecksSyntax(AUTHORING_EXAMPLE['checks.cjs']));
});

test('authored example initializes from the complete current snapshot',()=>{
  const api=authoredApi();
  for(const [quantity,addons,total]of [['2','none',2],['5','both',8],['1','label',2],['9','wrap',11]]){
    assert.deepEqual(plain(api.handleMessage({type:'init',values:{quantity,addons}})),[
      {id:'result',text:'Total: '+total},{id:'error',text:''},
    ]);
  }
});

test('combined choice applies both independent effects on input and change',()=>{
  const api=authoredApi();
  for(const event of ['input','change'])for(const [addons,total]of [['none',2],['label',3],['wrap',4],['both',5]]){
    const patches=api.handleMessage({type:'event',event,id:'addons',values:{quantity:'2',addons}});
    assert.equal(patchText(patches,'result'),'Total: '+total);
    assert.equal(patchText(patches,'error'),'');
  }
});

test('full numeric validation rejects invalid prefixes, fractions, blanks, types and ranges',()=>{
  const api=authoredApi();
  for(const quantity of ['',' ','1.5','2x','1e1','-1','0','10','Infinity',null,2,{},[]]){
    assert.notEqual(api.validate({quantity,addons:'none'}).error,'');
    for(const event of ['input','change']){
      const patches=api.handleMessage({type:'event',event,id:'quantity',values:{quantity,addons:'none'}});
      assert.equal(patchText(patches,'result'),'');
      assert.equal(patchText(patches,'error'),'Enter a whole quantity from 1 to 9.');
    }
  }
});

test('zero follows the specified range, including when excluded',()=>{
  const excluded=authoredApi();
  const inclusiveSource=AUTHORING_EXAMPLE['app.js'].replace('quantity < 1','quantity < 0');
  assert.notEqual(inclusiveSource,AUTHORING_EXAMPLE['app.js']);
  const included=authoredApi(inclusiveSource);
  assert.notEqual(excluded.validate({quantity:'0',addons:'none'}).error,'');
  assert.equal(included.validate({quantity:'0',addons:'none'}).error,'');
  assert.notEqual(included.validate({quantity:'-1',addons:'none'}).error,'');
});

test('authored checks retain both numeric boundary rejections',()=>{
  for(const [from,to] of [['quantity < 1','quantity < 0'],['quantity > 9','quantity > 10']]){
    const wrong=AUTHORING_EXAMPLE['app.js'].replace(from,to);
    assert.notEqual(wrong,AUTHORING_EXAMPLE['app.js']);
    assert.throws(()=>authoredChecks(wrong),error=>error.code==='ERR_ASSERTION');
  }
});

test('unknown choice clears the result and valid correction clears the error',()=>{
  const api=authoredApi();
  for(const event of ['input','change']){
    const invalid=api.handleMessage({type:'event',event,id:'addons',values:{quantity:'2',addons:'unknown'}});
    assert.equal(patchText(invalid,'result'),'');
    assert.equal(patchText(invalid,'error'),'Choose a listed add-on.');
    const valid=api.handleMessage({type:'event',event,id:'addons',values:{quantity:'2',addons:'both'}});
    assert.equal(patchText(valid,'result'),'Total: 5');
    assert.equal(patchText(valid,'error'),'');
  }
});

test('Reset replaces all inputs and derives output from its preset, even after invalid values',()=>{
  const api=authoredApi();
  for(const values of [{quantity:'bad',addons:'unknown'},{quantity:'9',addons:'both'}]){
    const before=structuredClone(values);
    assert.deepEqual(plain(api.handleMessage({type:'event',event:'click',id:'reset',values})),[
      {id:'quantity',value:'2'},{id:'addons',value:'none'},
      {id:'result',text:'Total: 2'},{id:'error',text:''},
    ]);
    assert.deepEqual(values,before);
  }
});

test('authored checks execute against the authored logic in the actual strict wrapper',()=>{
  assert.doesNotThrow(()=>authoredChecks());
});

test('output assertions accept Reset inputs without weakening required output checks',()=>{
  const helpers=AUTHORING_EXAMPLE['checks.cjs'].split('const starting = ')[0];
  const api=runInNewContext(helpers+'\n({expectResult,expectResetInputs})',{assert},{timeout:1000});
  const outputs=[{id:'result',text:'Total: 2'},{id:'error',text:''}];
  const inputs=[{id:'quantity',value:'2'},{id:'addons',value:'none'}];
  assert.doesNotThrow(()=>api.expectResult(outputs,2));
  assert.doesNotThrow(()=>api.expectResult([...inputs,...outputs],2));
  assert.doesNotThrow(()=>api.expectResetInputs([...inputs,...outputs]));
  for(const wrong of [outputs.slice(0,1),[outputs[0],outputs[0],outputs[1]]]){
    assert.throws(()=>api.expectResult(wrong,2),error=>error.code==='ERR_ASSERTION');
  }
  for(const wrong of [[inputs[0],...outputs],[...inputs,inputs[0],...outputs]]){
    assert.throws(()=>api.expectResetInputs(wrong),error=>error.code==='ERR_ASSERTION');
  }
});

test('ordinary input cannot silently change the selected value',()=>{
  const wrong=AUTHORING_EXAMPLE['app.js'].replace(
    'return [{id:"result",text:"Total: " + total},{id:"error",text:""}];',
    'return [{id:"quantity",value:"9"},{id:"result",text:"Total: " + total},{id:"error",text:""}];');
  assert.notEqual(wrong,AUTHORING_EXAMPLE['app.js']);
  assert.throws(()=>authoredChecks(wrong),error=>error.code==='ERR_ASSERTION');
});

test('varied valid, invalid and corrected edits preserve inputs and options',()=>{
  const original='return [{id:"result",text:"Total: " + total},{id:"error",text:""}];';
  const invalid='return [{id:"result",text:""},{id:"error",text:checked.error}];';
  const cases=[
    [original,'return [{id:"result",text:"Total: " + total},{id:"error",text:""},...(checked.addons === "both" ? [{id:"addons",value:"none"}] : [])];'],
    [invalid,'return [{id:"result",text:""},{id:"error",text:checked.error},{id:"quantity",value:"2"}];'],
    [original,'return [{id:"result",text:"Total: " + total},{id:"error",text:""},...(checked.addons === "both" ? [{id:"addons",options:[{value:"none",label:"None"}]}] : [])];'],
    [original,'return [{id:"result",text:"Total: " + total},{id:"error",text:""},...(checked.addons === "both" ? [{id:"addons",disabled:true}] : [])];'],
    [invalid,'return [{id:"result",text:""},{id:"error",text:checked.error},{id:"quantity",hidden:true}];'],
  ];
  for(const [before,after] of cases){
    const wrong=AUTHORING_EXAMPLE['app.js'].replace(before,after);
    assert.notEqual(wrong,AUTHORING_EXAMPLE['app.js']);
    assert.throws(()=>authoredChecks(wrong),error=>error.code==='ERR_ASSERTION');
  }
});

test('example patch helper returns one complete patch object using only patches and id',()=>{
  const helperSource=AUTHORING_EXAMPLE['checks.cjs'].split('function expectResult(')[0];
  assert(helperSource.includes('function getPatch(patches, id)'));
  assert(!AUTHORING_EXAMPLE['checks.cjs'].includes('patchField('));
  const getPatch=runInNewContext(helperSource+'\ngetPatch',{assert},{timeout:1000});
  const patch={id:'result',text:'Total: 2'};
  assert.equal(getPatch([patch],'result'),patch);
  assert.equal(getPatch([patch],'result').text,'Total: 2');
  for(const malformed of [null, undefined, {}, 'result']){
    assert.throws(()=>getPatch(malformed,'result'),error=>error.code==='ERR_ASSERTION');
  }
  for(const patches of [[], [null], [{id:'other',text:''}], [patch,patch]]){
    assert.throws(()=>getPatch(patches,'result'),error=>error.code==='ERR_ASSERTION');
  }
});

test('the explicit example matrix executes input and change for every declared control with unchanged valid values',()=>{
  const observed=[];authoredChecks(undefined,undefined,message=>observed.push(message));
  for(const id of ['quantity','addons'])for(const event of ['input','change']){
    assert(observed.some(message=>message.type==='event'&&message.id===id&&message.event===event
      &&JSON.stringify(message.values)===JSON.stringify({quantity:'2',addons:'none'})),event+':'+id);
  }
});

for(const expression of ['"TOTAL:" + total','"  total  " + total + "."','"Total :   " + total + " . "'])test('authored checks accept equivalent total wording '+expression,()=>{
  const varied=AUTHORING_EXAMPLE['app.js'].replace('"Total: " + total',expression);
  assert.notEqual(varied,AUTHORING_EXAMPLE['app.js']);
  assert.doesNotThrow(()=>authoredChecks(varied));
});

test('invalid-input checks accept changed error prose while requiring rejection and clearing',()=>{
  const varied=AUTHORING_EXAMPLE['app.js']
    .replaceAll('Enter a whole quantity from 1 to 9.','Quantity must be an integer in the allowed range.')
    .replaceAll('Choose a listed add-on.','That option is not listed.');
  assert.notEqual(varied,AUTHORING_EXAMPLE['app.js']);
  assert.doesNotThrow(()=>authoredChecks(varied));
});

for(const [name,expression]of [
  ['wrong number','"Total: " + (total + 1)'],
  ['negative number','"Total: -" + total'],
  ['negated label','"Not total: " + total'],
  ['negated result','"Total: " + total + " is not correct"'],
  ['ambiguous numbers','"Total: " + total + " or " + (total + 1)'],
  ['repeated result','"Total: " + total + "; Total: " + total'],
  ['unknown label','"Subtotal: " + total'],
  ['non-string result','total'],
  ['unbounded text','" ".repeat(41) + "Total: " + total'],
])test('bounded semantic total rejects '+name,()=>{
  const wrong=AUTHORING_EXAMPLE['app.js'].replace('"Total: " + total',expression);
  assert.notEqual(wrong,AUTHORING_EXAMPLE['app.js']);
  assert.throws(()=>authoredChecks(wrong),error=>error.code==='ERR_ASSERTION');
});

test('authored checks detect a broken combined-choice implementation',()=>{
  const wrong=AUTHORING_EXAMPLE['app.js'].replaceAll(' || checked.addons === "both"','');
  assert.notEqual(wrong,AUTHORING_EXAMPLE['app.js']);
  assert.throws(()=>authoredChecks(wrong),error=>error.code==='ERR_ASSERTION');
});

test('authored checks permit independent output patches in either cross-target order',()=>{
  const reordered=AUTHORING_EXAMPLE['app.js']
    .replace('return [{id:"result",text:""},{id:"error",text:checked.error}];',
      'return [{id:"error",text:checked.error},{id:"result",text:""}];')
    .replace('return [{id:"result",text:"Total: " + total},{id:"error",text:""}];',
      'return [{id:"error",text:""},{id:"result",text:"Total: " + total}];');
  assert.notEqual(reordered,AUTHORING_EXAMPLE['app.js']);
  assert.doesNotThrow(()=>authoredChecks(reordered));
});

for(const [name,replacement] of [
  ['missing required error patch','return [{id:"result",text:"Total: " + total}];'],
  ['duplicate result target','return [{id:"result",text:"Total: " + total},{id:"result",text:"Total: " + total},{id:"error",text:""}];'],
  ['wrong result value','return [{id:"result",text:"Wrong value"},{id:"error",text:""}];'],
  ['extra result field','return [{id:"result",text:"Total: " + total,hidden:false},{id:"error",text:""}];'],
])test(`by-ID example assertions still reject ${name}`,()=>{
  const wrong=AUTHORING_EXAMPLE['app.js'].replace('return [{id:"result",text:"Total: " + total},{id:"error",text:""}];',replacement);
  assert.notEqual(wrong,AUTHORING_EXAMPLE['app.js']);
  assert.throws(()=>authoredChecks(wrong),error=>error.code==='ERR_ASSERTION');
});

for(const [name,before,after]of [
  ['wrong Reset value','{id:"quantity",value:preset.quantity}','{id:"quantity",value:"3"}'],
  ['wrong Reset value type','{id:"quantity",value:preset.quantity}','{id:"quantity",value:2}'],
  ['missing Reset value','      {id:"addons",value:preset.addons},\n',''],
  ['Reset uses stale input','...resultPatches(preset)','...resultPatches(message.values)'],
  ['stale invalid output','return [{id:"result",text:""},{id:"error",text:checked.error}];','return [{id:"result",text:"Total: 2"},{id:"error",text:checked.error}];'],
  ['blank invalid error','{id:"error",text:checked.error}','{id:"error",text:"   "}'],
  ['non-string invalid error','{id:"error",text:checked.error}','{id:"error",text:true}'],
  ['stale error after valid input','{id:"error",text:""}','{id:"error",text:"Still invalid"}'],
])test('semantic checks retain exact clearing and Reset: '+name,()=>{
  const wrong=AUTHORING_EXAMPLE['app.js'].replace(before,after);
  assert.notEqual(wrong,AUTHORING_EXAMPLE['app.js']);
  assert.throws(()=>authoredChecks(wrong),error=>error.code==='ERR_ASSERTION');
});

test('each operation receives the complete tested example with bounded low-effort reasoning',async()=>{
  const previous=await receive(native);
  for(const repair of [null,{files:previous.files,check:{exitCode:1,stderr:'Authored failed check.'}},
    {rejected:{responseText:'Authored invalid JSON',diagnostic:{message:'Invalid.'}}}]){
    let inspected=false;
    await receive(native,repair,request=>{
      inspected=true;
      const text=request.messages[0].content;
      const marker='ILLUSTRATIVE CONTRACT EXAMPLE\n';
      const after=text.slice(text.indexOf(marker)+marker.length);
      const start=after.indexOf('{"index.html":');
      const end=after.indexOf('\n\nCurrent operation:');
      assert(start>=0&&end>start);
      assert.deepEqual(JSON.parse(after.slice(start,end)),AUTHORING_EXAMPLE);
      assert.match(text,/Encode each source string once/u);
      assert.match(text,/decoded quote delimiters must be native quotes, not backslash-escaped source delimiters/u);
      assert.match(text,/Escapes inside source string literals remain valid JavaScript/u);
      assert.match(text,/parseInt alone accepts invalid prefixes and fractions/u);
      assert.match(text,/string "both" does not contain/u);
      assert.match(text,/Independent patches with unique target IDs have no required cross-target array order/u);
      assert.match(text,/Repeated target IDs or select options\/value updates can have meaningful order/u);
      assert.match(text,/Preserve any task-required ordering inside output data, lists or timeline rows/u);
      assert.match(text,/Build fixtures, messages and actual patch results as separate named locals/u);
      assert.match(text,/Keep every task-required warning or caveat visible/u);
      assert.match(text,/Comments or assertions in checks\.cjs do not satisfy visible content requirements/u);
      assert.match(text,/including invalid-value cases: change the value under test, never the declared control ID/u);
      assert.match(text,/use explicit value-to-visible-label mappings consistently across the page, displayed selected\/suggested results and checks/u);
      assert.match(text,/Capitalizing a wire value is not a reliable visible label/u);
      assert.match(text,/a RegExp object is not equal to a string/u);
      assert.match(text,/Assert exact numeric results, option identities, statuses, required facts and patch IDs\/key shapes separately from incidental prose/u);
      assert.match(text,/Match output wording exactly only when the reviewed task explicitly requires it/u);
      assert.match(text,/bounded anchored parser or task-defined label mapping/u);
      assert.match(text,/reject wrong values, negation, ambiguous multiple values and unknown labels/u);
      assert.match(text,/Broad substring matches or nonempty text alone do not establish correct results/u);
      assert.match(text,/Keep empty clearing and Reset\/control values exact/u);
      assert.match(text,/Check option selection and tie rules, and require every caveat without accepting its negation/u);
      assert(request.messages[1].content.startsWith('Reviewed task input (untrusted data):\n'+JSON.stringify(requirements,null,2)));
      assert.match(text,/Exercise BOTH input and change for EVERY editable input, textarea and select ID, even with unchanged valid values/u);
      assert.match(text,/Reconcile it with the actual page: disabled, readonly, hidden and action inputs do not have native edit events/u);
      assert.equal(request.max_tokens,32000);
      assert.deepEqual(request.chat_template_kwargs,{enable_thinking:true,low_effort:true,force_nonempty_content:true});
      assert.equal(request.stream,true);
      assert.deepEqual(request.stream_options,{include_usage:true});
      assert.equal(request.response_format.json_schema.strict,true);
      assert.equal(request.response_format.json_schema.schema.additionalProperties,false);
      if(repair)assert.match(text,/Recheck paired object braces, call parentheses and string delimiters in the complete replacement checks body/u);
      if(repair?.rejected)assert.match(text,/Recheck the complete repaired app and checks/u);
    });
    assert(inspected);
  }
});
