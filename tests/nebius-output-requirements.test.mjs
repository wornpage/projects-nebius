import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_VERSION, validateRunInput, validateToolOutputRequirements, validateToolRequirements, runToolRequirements, runSnapshotFromRecord } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { runPageContract, renderRunPreview } from '../worker/nebius-run-preview.mjs';
import { spawnSandbox } from '../worker/nebius-sandbox.mjs';
import { FIXTURE_INPUT, authoredCheckerFiles } from './fixtures/nebius-release-checker.mjs';
import { getProjectStarter } from '../svelte-frontend/src/lib/nebius-project-starters.mjs';
import { historicalRecoveryFiles as materializeRecoveryExample } from './fixtures/nebius-historical-recovery.mjs';

const outputs = [{id:'result',format:'text'}];
const pageFiles = html => authoredCheckerFiles().map(file => file.path === 'index.html' ? {...file,content:'<!doctype html>\n'+html} : file);

test('output requirements distinguish unspecified, no minimum and a copied minimum set', () => {
  assert.equal(validateToolOutputRequirements(null),null);
  assert.deepEqual(validateToolOutputRequirements([]),[]);
  const validated = validateToolOutputRequirements(outputs); assert.deepEqual(validated,outputs);
  validated[0].id='different';assert.equal(outputs[0].id,'result');
  assert.equal(validateToolOutputRequirements(Array.from({length:12},(_,n)=>({id:'output'+n,format:n%2?'text':'timeline'}))).length,12);
});

for(const [name,value] of [
  ['missing',undefined],['object',{}],['scalar','text'],['sparse',Array(1)],
  ['extra field',[{id:'result',format:'text',extra:true}]],['duplicate',[...outputs,...outputs]],
  ['bad ID',[{id:'#result',format:'text'}]],['overlong ID',[{id:'a'.repeat(81),format:'text'}]],
  ['unsupported format',[{id:'result',format:'json'}]],['too many',Array.from({length:13},(_,n)=>({id:'o'+n,format:'text'}))],
]) test('output requirements reject '+name,()=>assert.throws(()=>validateToolOutputRequirements(value)));

test('combined task requirements reject conflicting control ownership', () => {
  assert.throws(()=>validateToolRequirements([{id:'result',format:'json'}],outputs),/different IDs/u);
  assert.deepEqual(validateToolRequirements([{id:'input',format:'json'}],outputs),{requiredInputFormats:[{id:'input',format:'json'}],requiredOutputs:outputs});
  assert.throws(()=>validateRunInput({...FIXTURE_INPUT,requiredInputFormats:[{id:'result',format:'text'}],requiredOutputs:outputs}),/different IDs/u);
});

test('v1 and v2 readers preserve exact request shapes while v3 requires both contracts', () => {
  assert.equal(RUN_VERSION,'browser-tool.v3');
  const v1={...FIXTURE_INPUT,version:'browser-tool.v1'};delete v1.requiredInputFormats;delete v1.requiredOutputs;
  const v2={...v1,version:'browser-tool.v2',requiredInputFormats:[{id:'input',format:'json'}]};
  const v3={...v2,version:RUN_VERSION,requiredOutputs:outputs};
  for(const input of [v1,v2,v3]) {
    const validated=validateRunInput(input);assert.deepEqual(validated,input);
    const snapshot=runSnapshotFromRecord(input);const {consent,...expected}=input;
    assert.deepEqual(snapshot,expected);
    assert.equal(Object.hasOwn(snapshot,'requiredOutputs'),input.version===RUN_VERSION);
  }
  assert.throws(()=>validateRunInput({...v1,requiredInputFormats:null}));
  assert.throws(()=>validateRunInput({...v2,requiredOutputs:null}));
  const missing={...v3};delete missing.requiredOutputs;assert.throws(()=>validateRunInput(missing));
  assert.deepEqual(runToolRequirements(v1),{requiredInputFormats:null,requiredOutputs:null});
  assert.deepEqual(runToolRequirements(v2),{requiredInputFormats:v2.requiredInputFormats,requiredOutputs:null});
  assert.deepEqual(runToolRequirements(v3),{requiredInputFormats:v3.requiredInputFormats,requiredOutputs:outputs});
  assert.throws(()=>runToolRequirements({...v3,version:'browser-tool.v99'}));
});

for(const [name,html,required,pattern] of [
  ['missing','<output id="other"></output>',outputs,/result is missing/u],
  ['span','<span id="result"></span>',outputs,/result must use an output/u],
  ['div','<div id="result"></div>',outputs,/result must use an output/u],
  ['pre','<pre id="result" data-output="true"></pre>',outputs,/result must use an output/u],
  ['timeline absent','<output id="result"></output>',[{id:'result',format:'timeline'}],/must declare data-output-format="timeline"/u],
  ['text upgraded to timeline','<output id="result" data-output-format="timeline"></output>',outputs,/must be plain text/u],
]) test('required output '+name+' fails consistently before Sandbox',async()=>{
  const files=pageFiles(html),before=JSON.stringify(files),requirements={requiredOutputs:required};let submissions=0;
  assert.throws(()=>runPageContract(files,requirements),pattern);
  await assert.rejects(renderRunPreview(files,requirements),pattern);
  await assert.rejects(spawnSandbox({iamToken:'fixture',projectId:'fixture',imageId:'fixture'},files,{...requirements,fetcher:async()=>{submissions++;throw Error('Unexpected sandbox request');}}),pattern);
  assert.equal(submissions,0);assert.equal(JSON.stringify(files),before);
});

test('a required minimum permits additional status and timeline outputs',async()=>{
  const files=pageFiles('<output id="result"></output><output id="error"></output><output id="schedule" data-output-format="timeline"></output>');
  const requirements={requiredOutputs:outputs};const page=runPageContract(files,requirements);
  assert.equal(page.elements.length,3);assert(page.elements.find(e=>e.id==='schedule').fields.includes('timeline'));
  assert.match((await renderRunPreview(files,requirements)).html,/data-nebius-timeline/u);
  for(const value of [null,[]])assert.doesNotThrow(()=>runPageContract(files,{requiredOutputs:value}));
});

test('page contract refuses unnamed options and cannot lose input/output conflicts',()=>{
  const files=pageFiles('<output id="result"></output>');
  for(const options of [null,[],{requiredOutput:outputs},{requiredOutputs:undefined}])assert.throws(()=>runPageContract(files,options));
  assert.throws(()=>runPageContract(files,{requiredInputFormats:[{id:'result',format:'text'}],requiredOutputs:outputs}),/different IDs/u);
});

test('recovery starter owns seven outputs matching the authored reference',()=>{
  const starter=getProjectStarter('project-recovery');
  assert(starter); const task=starter.plan.tasks[0];
  assert.deepEqual([...task.executionOutputs].sort((a,b)=>a.id.localeCompare(b.id)),[
    {id:'baseline-finish',format:'text'},{id:'delayed-finish',format:'text'},{id:'error',format:'text'},
    {id:'impact',format:'text'},{id:'recovered-days',format:'text'},{id:'recovered-finish',format:'text'},{id:'schedule',format:'timeline'}
  ]);
  const page=runPageContract(materializeRecoveryExample(),{requiredInputFormats:task.executionInputs,requiredOutputs:task.executionOutputs});
  assert.equal(page.elements.filter(e=>e.tag==='output').length,7);
});
