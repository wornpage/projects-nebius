import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {RECOVERY_BROWSER_CASES as CASES,RECOVERY_BROWSER_PROFILE as PROFILE} from './fixtures/nebius-recovery-browser-cases.mjs';
import {RECOVERY_CASES,PROJECT_TASKS} from './fixtures/nebius-recovery-cases.mjs';
import {FIXTURE_INPUT,nativeFileBlocks} from './fixtures/nebius-release-checker.mjs';
import {generateRunFiles} from '../worker/nebius-run-provider.mjs';
import {streamEnvelope} from './helpers/nebius-stream-fixture.mjs';
import {validateGeneratedSource,boundedRunMessage} from '../worker/nebius-run-admission.mjs';
import SCOPE from './fixtures/nebius-recovery-qualification-scope.json' with {type:'json'};
import {runFilesDigest,runSnapshotFromRecord} from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import {parseRecoveryQualificationArgs,readRecoveryRun,prepareRecoveryRun,assertRecoveryObservation,assertRecoveryCleared,assertRecoveryLoaderValues,recoveryCaseCounts,qualificationHash} from '../scripts/nebius-recovery-qualification.mjs';

const expected=CASES.find(item=>item.id==='valid-prewritten-03').expected;
// Independent hand-written visible observation for delivery+2 / assembly-1.
const observed=()=>({outputs:{'baseline-finish':'7 days','delayed-finish':'9 days','recovered-finish':'8 days','recovered-days':'1 day',impact:'Delivery moves the dependent work.',error:'',schedule:'Comparison'},
  visible:Object.fromEntries(PROFILE.outputs.map(output=>[output.id,true])),timelineRoots:1,horizon:10,horizontalOverflow:false,
  rows:[['Confirm brief',[0,1,0,1],[0,10,0,10]],['Delivery',[1,4,1,6],[10,30,10,50]],['Prepare workspace',[1,3,1,3],[10,20,10,20]],
    ['Assembly',[4,6,6,7],[40,20,60,10]],['Review',[6,7,7,8],[60,10,70,10]]].map(([label,ranges,geometry])=>({label,ranges,geometry}))});
test('independent oracle accepts correct ranges with a padded shared horizon and arbitrary row order',()=>{
  const value=observed();value.rows.reverse();assert.doesNotThrow(()=>assertRecoveryObservation(value,expected));
  value.rows.find(row=>row.label==='Delivery').label='delivery';assert.doesNotThrow(()=>assertRecoveryObservation(value,expected));
});
for(const[name,mutate,code]of[
  ['always baseline',value=>{value.outputs['delayed-finish']='7 days';},'metric_mismatch'],
  ['false recovery',value=>{value.outputs['recovered-days']='2 days';},'metric_mismatch'],
  ['bad singular',value=>{value.outputs['recovered-days']='1 days';},'metric_mismatch'],
  ['error with success',value=>{value.outputs.error='Invalid';},'unexpected_error'],
  ['empty impact',value=>{value.outputs.impact='';},'missing_impact'],
  ['hidden metrics',value=>{value.visible['baseline-finish']=false;},'hidden_result'],
  ['wrong range',value=>{value.rows[3].ranges[2]=5;},'timeline_range_mismatch'],
  ['wrong common scale',value=>{value.rows[3].geometry[2]=65;},'timeline_geometry_mismatch'],
  ['noninteger horizon',value=>{value.horizon=9.5;},'timeline_scale_invalid'],
  ['insufficient horizon',value=>{value.horizon=7;},'timeline_geometry_mismatch'],
  ['missing row',value=>{value.rows.pop();},'timeline_rows_invalid'],
  ['duplicate label',value=>{value.rows[1].label='Confirm brief';},'timeline_label_ambiguous'],
  ['invented label',value=>{value.rows[1].label='Something';},'timeline_label_ambiguous'],
  ['page overflow',value=>{value.horizontalOverflow=true;},'horizontal_overflow'],
])test('independent oracle detects '+name,()=>{const value=observed();mutate(value);assert.throws(()=>assertRecoveryObservation(value,expected),error=>error.code===code);});

const cleared=()=>({outputs:Object.fromEntries(PROFILE.outputs.map(output=>[output.id,output.id==='error'?'Check the task duration.':''])),visible:{error:true},timelineRoots:0,rows:[],horizontalOverflow:false});
test('invalid-input oracle requires all prior results and chart to clear',()=>{
  assert.doesNotThrow(()=>assertRecoveryCleared(cleared()));
  for(const id of PROFILE.outputs.filter(output=>output.id!=='error').map(output=>output.id)){const value=cleared();value.outputs[id]='7 days';assert.throws(()=>assertRecoveryCleared(value),error=>error.code==='stale_result');}
  const chart=cleared();chart.timelineRoots=1;assert.throws(()=>assertRecoveryCleared(chart),error=>error.code==='stale_timeline');
  const error=cleared();error.outputs.error='';assert.throws(()=>assertRecoveryCleared(error),failure=>failure.code==='missing_error');
});
test('example loader oracle permits task ordering and different zero-day targets, but rejects wrong seeds or amounts',()=>{
  const values={'plan-json':JSON.stringify({tasks:[...PROJECT_TASKS].reverse()}),'delay-task':'prepare','delay-days':'0','recover-task':'review','recover-days':'0'};
  assert.doesNotThrow(()=>assertRecoveryLoaderValues(values,0));
  assert.throws(()=>assertRecoveryLoaderValues({...values,'delay-days':'1'},0));
  const wrong=structuredClone(PROJECT_TASKS);wrong[0].duration=2;assert.throws(()=>assertRecoveryLoaderValues({...values,'plan-json':JSON.stringify({tasks:wrong})},0));
  wrong[0]={...PROJECT_TASKS[0],extra:true};assert.throws(()=>assertRecoveryLoaderValues({...values,'plan-json':JSON.stringify({tasks:wrong})},0));
});

test('qualification arguments have exactly one mode and absolute local paths',()=>{
  const out=path.resolve('qualification-out'),browser=path.resolve('chromium.exe'),record=path.resolve('record.json');
  assert.equal(parseRecoveryQualificationArgs(['--authored-example','--out',out,'--chromium',browser]).mode,'authored-example');
  assert.equal(parseRecoveryQualificationArgs(['--run-record',record,'--out',out,'--chromium',browser]).mode,'retained-record');
  for(const args of [[],['--authored-example','--run-record',record,'--out',out,'--chromium',browser],['--authored-example','--out','relative','--chromium',browser],
    ['--authored-example','--out',out,'--chromium',browser,'--retry'],['--run-record',path.resolve('record.txt'),'--out',out,'--chromium',browser]])assert.throws(()=>parseRecoveryQualificationArgs(args));
  assert.deepEqual(recoveryCaseCounts(),{valid:19,invalid:74,example:3,stale:10,keyboard:4});assert.equal(CASES.length,110);
});

test('record reader bounds bytes and rejects invalid JSON without echoing its contents',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nebius-qualification-'));
  try{const file=path.join(dir,'record.json');await fs.writeFile(file,'{"private":"test"}');const result=await readRecoveryRun(file);assert.equal(result.fileSha256,qualificationHash('{"private":"test"}'));
    await fs.writeFile(file,'PRIVATE_SOURCE_DO_NOT_ECHO');await assert.rejects(readRecoveryRun(file),error=>error.code==='record_json_invalid'&&!error.message.includes('PRIVATE_SOURCE'));
    await fs.writeFile(file,Buffer.alloc(524289));await assert.rejects(readRecoveryRun(file),error=>error.code==='record_file_invalid');
  }finally{assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});

async function structuralFixture(){
  // Synthetic transport/record only; these files never execute or count as a
  // generated recovery result. The handler intentionally does no useful work.
  const raw=[{path:'index.html',lines:['<!doctype html>',...PROFILE.inputs.map(input=>`<textarea id="${input.id}" data-input-format="${input.format}"></textarea>`),...PROFILE.outputs.map(output=>`<output id="${output.id}"${output.format==='timeline'?' data-output-format="timeline"':''}></output>`)]},
    {path:'app.js',lines:['function validate(value) { return value; }','function handleMessage(message) { return []; }']},
    {path:'checks.cjs',lines:['assert.equal(validate(1),1);','assert.deepEqual(handleMessage({type:"init",values:{}}),[]);']}];
  const input={...FIXTURE_INPUT,pack:SCOPE.pack,context:SCOPE.context,currentStatus:SCOPE.currentStatus,requestedModel:PROFILE.model,requiredInputFormats:PROFILE.inputs,requiredOutputs:PROFILE.outputs};
  const text=nativeFileBlocks(raw.map(file=>({path:file.path,content:file.lines.join('\n')})));const parsed=await generateRunFiles({apiKey:'synthetic',model:PROFILE.model},input,null,{fetcher:async()=>streamEnvelope({model:PROFILE.model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]})});
  const {consent,...snapshot}=input;const digest=await runFilesDigest(parsed.files);
  return{id:'00000000-0000-4000-8000-000000000001',...snapshot,status:'ready',attempt:1,createdAt:'2026-10-22T00:00:00.000Z',updatedAt:'2026-10-22T00:00:01.000Z',events:[],files:parsed.files,
    checks:[{attempt:1,operationId:'00000000-0000-4000-8000-000000000002',checkpointId:null,exitCode:0,stdout:'Synthetic structural fixture, not provider evidence.',stderr:'',sourceDigest:digest}],
    usage:{modelCalls:1,inputTokens:10,outputTokens:20,totalsComplete:true},error:null,failure:null,generationAttempts:[{attempt:1,outcome:'accepted',retention:'retained',responseText:text,diagnostic:null}]};
}
test('record gate binds accepted response bytes to checked source without asserting provider authenticity',async()=>{
  const record=await structuralFixture();const prepared=await prepareRecoveryRun(record,'a'.repeat(64));
  assert.equal(prepared.identity.providerProvenanceAuthenticated,false);assert.equal(prepared.identity.offlineParserReplays,1);assert.equal(prepared.identity.originalTransportAndFinishReasonQualified,false);
  const changed=structuredClone(record);changed.files[1].content+='\n// substituted source';changed.checks[0].sourceDigest=await runFilesDigest(changed.files);
  await assert.rejects(prepareRecoveryRun(changed,'a'.repeat(64)),error=>error.code==='source_binding_failed');
});
for(const[name,mutate,code]of[
  ['failed run',record=>{record.status='failed';record.error='Synthetic failure';record.failure={code:'invalid_model_output',stage:'preview'};},'run_not_ready'],
  ['wrong model',record=>{record.requestedModel='nvidia/different';},'profile_mismatch'],
  ['old request',record=>{record.version='browser-tool.v2';delete record.requiredOutputs;},'profile_not_bound'],
  ['missing output profile',record=>{record.requiredOutputs=null;},'profile_mismatch'],
  ['different task with identical interface',record=>{record.pack={...record.pack,title:'A different recovery task'};},'task_scope_mismatch'],
  ['different context with identical interface',record=>{record.context=[];},'task_scope_mismatch'],
  ['missing trace',record=>{record.generationAttempts=[];},'generation_trace_incomplete'],
  ['unretained response',record=>{record.generationAttempts[0].responseText=null;record.generationAttempts[0].retention='size_limit';},'generation_trace_incomplete'],
  ['zero claimed tokens',record=>{record.usage.inputTokens=0;},'usage_incomplete'],
])test('record gate refuses '+name+' before preparing a preview',async()=>{const record=await structuralFixture();mutate(record);await assert.rejects(prepareRecoveryRun(record,'a'.repeat(64)),error=>error.code===code);});

const replay=(record,text,repair=null)=>generateRunFiles({apiKey:'synthetic',model:PROFILE.model},runSnapshotFromRecord(record),repair,{fetcher:async()=>streamEnvelope({model:PROFILE.model,usage:{prompt_tokens:10,completion_tokens:20},choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]})});
async function rejectedRepairFixture(staticRejection=false){
  const record=await structuralFixture(),accepted=record.generationAttempts[0];
  const malformed=JSON.parse(accepted.responseText);
  malformed['index.html']=malformed['index.html'].replace('<output id="schedule"','<pre id="schedule"').replace('data-output-format="timeline"></output>','data-output-format="timeline"></pre>');
  const text=staticRejection?JSON.stringify(malformed):'Authored malformed source fixture.';
  let rejection;try{const generated=await replay(record,text);await validateGeneratedSource(generated.files,{requiredInputFormats:PROFILE.inputs,requiredOutputs:PROFILE.outputs});}catch(error){rejection=error;}
  assert(rejection,'Fixture must actually fail static admission.');
  const first={attempt:1,outcome:'rejected',retention:'retained',responseText:text,diagnostic:{code:rejection.code,stage:rejection.stage,message:boundedRunMessage(rejection,'Source validation failed.')}};
  return {...record,attempt:2,usage:{...record.usage,modelCalls:2},checks:[{...record.checks[0],attempt:2}],generationAttempts:[first,{...accepted,attempt:2}]};
}
for(const staticRejection of [false,true])test('replays '+(staticRejection?'page-contract':'framing')+' rejection before full replacement',async()=>{
  const record=await rejectedRepairFixture(staticRejection),prepared=await prepareRecoveryRun(record,'a'.repeat(64));
  assert.equal(prepared.identity.offlineParserReplays,2);assert.equal(prepared.identity.retainedTrace.length,2);
  const changedText=structuredClone(record);changedText.generationAttempts[0].responseText=record.generationAttempts[1].responseText;
  await assert.rejects(prepareRecoveryRun(changedText,'a'.repeat(64)),error=>error.code==='rejection_binding_failed');
  const changedDiagnostic=structuredClone(record);changedDiagnostic.generationAttempts[0].diagnostic.message+=' changed';
  await assert.rejects(prepareRecoveryRun(changedDiagnostic,'a'.repeat(64)),error=>error.code==='rejection_binding_failed');
});
async function partialRepairFixture(){
  const first=await structuralFixture(),check={...first.checks[0],exitCode:1,stderr:'Synthetic check failure.'};
  const text=nativeFileBlocks([{path:'app.js',content:'function validate(value) { return value; }\nfunction handleMessage(message) { return []; }\n// Authored replacement.'}]);
  const generated=await replay(first,text,{files:first.files,check});
  return {...first,attempt:2,files:generated.files,usage:{...first.usage,modelCalls:2},checks:[check,{...first.checks[0],attempt:2,operationId:'00000000-0000-4000-8000-000000000003',sourceDigest:await runFilesDigest(generated.files)}],
    generationAttempts:[first.generationAttempts[0],{attempt:2,outcome:'accepted',retention:'retained',responseText:text,diagnostic:null}]};
}
test('binds partial repair to failed checked source and exact replacement',async()=>{
  const record=await partialRepairFixture(),prepared=await prepareRecoveryRun(record,'b'.repeat(64));assert.equal(prepared.identity.offlineParserReplays,2);
  const badCheck=structuredClone(record);badCheck.checks[0].sourceDigest='0'.repeat(64);
  await assert.rejects(prepareRecoveryRun(badCheck,'b'.repeat(64)),error=>error.code==='generation_trace_invalid');
  const badRepair=structuredClone(record);badRepair.generationAttempts[1].responseText=badRepair.generationAttempts[1].responseText.replace('Authored replacement.','Changed replacement.');
  await assert.rejects(prepareRecoveryRun(badRepair,'b'.repeat(64)),error=>error.code==='source_binding_failed');
});
