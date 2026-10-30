import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RUN_VERSION,validateRunIntegrity,runSnapshotFromRecord,runToolRequirements,runFilesDigest} from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import {generateRunFiles,RunProviderError} from '../worker/nebius-run-provider.mjs';
import {streamEnvelope} from '../tests/helpers/nebius-stream-fixture.mjs';
import {renderRunPreview} from '../worker/nebius-run-preview.mjs';
import {validateGeneratedSource,boundedRunMessage} from '../worker/nebius-run-admission.mjs';
import {historicalRecoveryFiles as materializeRecoveryExample} from '../tests/fixtures/nebius-historical-recovery.mjs';
import {RECOVERY_BROWSER_PROFILE as PROFILE,RECOVERY_BROWSER_CASES as CASES} from '../tests/fixtures/nebius-recovery-browser-cases.mjs';
import {PROJECT_TASKS} from '../tests/fixtures/nebius-recovery-cases.mjs';
import SCOPE from '../tests/fixtures/nebius-recovery-qualification-scope.json' with {type:'json'};

export const QUALIFICATION_LIMITS=Object.freeze({recordBytes:524288,wholeRunMs:300000,caseMs:12000,responseMs:6000,viewports:Object.freeze([375,1280])});
export const qualificationHash=value=>createHash('sha256').update(value).digest('hex');
const scopeOf=value=>({pack:value.pack,context:value.context,currentStatus:value.currentStatus});
export const RECOVERY_SCOPE_SHA256='ace8ff47d00781324938397f87eb450442fcf2da2362c4a6f8e5359f564a7078';
const RECOVERY_SCOPE_VERSION='recovery-task-scope.v1';
const RECOVERY_SOURCE_REQUEST_SHA256='b66c92911c4151f6a0dfb7b60c0ac93118a9dcb93ef25015c7da9332c7a0f43c';
if(SCOPE.version!==RECOVERY_SCOPE_VERSION||SCOPE.sourceRequestSha256!==RECOVERY_SOURCE_REQUEST_SHA256
  ||qualificationHash(JSON.stringify(scopeOf(SCOPE)))!==RECOVERY_SCOPE_SHA256||SCOPE.semanticScopeSha256!==RECOVERY_SCOPE_SHA256)throw new Error('The fixed recovery qualification scope or provenance metadata changed.');
export class RecoveryQualificationError extends Error{constructor(code,message){super(message);this.name='RecoveryQualificationError';this.code=code;}}
const fail=(code,message)=>{throw new RecoveryQualificationError(code,message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const normalize=value=>String(value??'').replace(/\s+/gu,' ').trim();
const days=value=>value+' '+(value===1?'day':'days');
export const recoveryCaseCounts=()=>Object.fromEntries(['valid','invalid','example','stale','keyboard'].map(category=>[category,CASES.filter(item=>item.category===category).length]));

export function parseRecoveryQualificationArgs(args){
  const values=new Map();let authored=false;
  for(let index=0;index<args.length;index++){
    const name=args[index];
    if(name==='--authored-example'){if(authored)fail('invalid_arguments','Choose exactly one source mode.');authored=true;continue;}
    if(!['--run-record','--out','--chromium'].includes(name)||values.has(name)||!args[index+1]||args[index+1].startsWith('--'))fail('invalid_arguments','Use one source mode, --out and --chromium; no extra options.');
    values.set(name,args[++index]);
  }
  if(authored===values.has('--run-record')||!values.has('--out')||!values.has('--chromium'))fail('invalid_arguments','Use --run-record PATH or --authored-example, plus --out PATH and --chromium PATH.');
  for(const value of values.values())if(!path.isAbsolute(value)||/^\\\\/u.test(value))fail('invalid_arguments','Use absolute local filesystem paths.');
  if(values.has('--run-record')&&path.extname(values.get('--run-record')).toLowerCase()!=='.json')fail('invalid_arguments','The saved run must be a JSON file.');
  return {mode:authored?'authored-example':'retained-record',recordPath:values.get('--run-record')??null,outputDir:path.resolve(values.get('--out')),chromiumPath:values.get('--chromium')};
}

export async function readRecoveryRun(file){
  if(!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.json'||/^\\\\/u.test(file))fail('record_file_invalid','Use an absolute local JSON record file.');
  let handle;
  try{handle=await fs.open(file,'r');}catch{fail('record_file_unavailable','The saved run file could not be opened.');}
  try{
    const before=await handle.stat({bigint:true});
    if(!before.isFile()||before.size>BigInt(QUALIFICATION_LIMITS.recordBytes))fail('record_file_invalid','The saved run must be a regular JSON file of at most 512 KiB.');
    const buffer=Buffer.alloc(QUALIFICATION_LIMITS.recordBytes+1);let length=0;
    while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
    const after=await handle.stat({bigint:true});
    if(BigInt(length)!==before.size||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ino!==before.ino||length>QUALIFICATION_LIMITS.recordBytes)fail('record_file_changed','The saved run file changed or exceeded its read bound.');
    const bytes=buffer.subarray(0,length);let record;
    try{record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('record_json_invalid','The saved run is not valid UTF-8 JSON.');}
    return {record,fileSha256:qualificationHash(bytes)};
  }finally{await handle.close();}
}

export async function prepareRecoveryRun(value,fileSha256){
  let record;try{record=await validateRunIntegrity(value);}catch{fail('record_invalid','The saved run failed record or checked-source validation.');}
  if(record.status!=='ready')fail('run_not_ready','The saved run is not ready; no preview or generated source was started.');
  if(record.version!==RUN_VERSION)fail('profile_not_bound','This profile requires a v3 request with reviewed input and output requirements.');
  const requirements=runToolRequirements(record);
  if(record.requestedModel!==PROFILE.model||!same(requirements.requiredInputFormats,PROFILE.inputs)||!same(requirements.requiredOutputs,PROFILE.outputs))fail('profile_mismatch','The saved model and ordered input/output requirements do not match the recovery profile.');
  if(qualificationHash(JSON.stringify(scopeOf(record)))!==RECOVERY_SCOPE_SHA256)fail('task_scope_mismatch','The saved task, context and status do not match the fixed recovery benchmark.');
  if(!record.usage.totalsComplete||record.usage.inputTokens<=0||record.usage.outputTokens<=0)fail('usage_incomplete','The saved run needs complete, positive recorded token counts.');
  const entries=record.generationAttempts;
  if(entries.length!==record.usage.modelCalls||entries.some((entry,index)=>entry.attempt!==index+1||entry.retention!=='retained')||entries.at(-1)?.outcome!=='accepted')fail('generation_trace_incomplete','The saved run needs its complete retained generation trace.');
  const snapshot=runSnapshotFromRecord(record);let previousFiles=null,offlineParserReplays=0;const trace=[];
  for(const entry of entries){
    const prior=entries[entry.attempt-2];let repair=null;
    if(prior){
      if(prior.outcome==='rejected')repair={rejected:prior};
      else{const check=record.checks.find(item=>item.attempt===prior.attempt);if(!previousFiles||!check||check.exitCode===0||await runFilesDigest(previousFiles)!==check.sourceDigest)fail('generation_trace_invalid','The repair is not bound to a prior failed checked source.');repair={files:previousFiles,check};}
    }
    let parsed,rejection=null;
    try{
      parsed=await generateRunFiles({apiKey:'offline-qualification-no-credential',model:record.requestedModel},snapshot,repair,{timeoutMs:1000,fetcher:async()=>{
        offlineParserReplays++;
        // Authored SSE wrapper only. These zeros are not provider usage and
        // cannot establish the retained run's original transport/finish reason.
        return streamEnvelope({model:record.requestedModel,usage:{prompt_tokens:0,completion_tokens:0},choices:[{finish_reason:'stop',message:{role:'assistant',content:entry.responseText}}]});
      }});
      await validateGeneratedSource(parsed.files,requirements);
    }catch(error){rejection=error;}
    if(entry.outcome==='rejected'){
      if(!(rejection instanceof RunProviderError)||rejection.uncertain||!['tool_files','tool_page','tool_worker','preview','tool_checks'].includes(rejection.stage)
        ||!same({code:rejection.code,stage:rejection.stage,message:boundedRunMessage(rejection,'Source validation failed.')},entry.diagnostic))fail('rejection_binding_failed','The retained rejection does not reproduce its recorded source-validation diagnostic.');
    }else{
      if(rejection)fail('source_binding_failed','The retained accepted response cannot pass the current source validator.');
      previousFiles=parsed.files;
    }
    trace.push({attempt:entry.attempt,outcome:entry.outcome,responseSha256:qualificationHash(entry.responseText),diagnosticSha256:qualificationHash(JSON.stringify(entry.diagnostic))});
  }
  if(!previousFiles||!same(previousFiles,record.files))fail('source_binding_failed','Saved tool files differ from the retained accepted source trace.');
  const checks=record.checks,expectedAttempts=entries.filter(entry=>entry.outcome==='accepted').map(entry=>entry.attempt);
  if(!same(checks.map(check=>check.attempt),expectedAttempts)||checks.at(-1).exitCode!==0)fail('generation_trace_invalid','Recorded checks do not match the accepted generation attempts.');
  let preview;try{await validateGeneratedSource(record.files,requirements);preview=await renderRunPreview(record.files,requirements);}catch{fail('static_admission_failed','The retained source fails the current page or checks-syntax contract.');}
  return {files:record.files,preview,identity:{sourceKind:'caller-supplied-ready-record',providerProvenanceAuthenticated:false,recordFileSha256:fileSha256,
    requestSnapshotSha256:qualificationHash(JSON.stringify(snapshot)),checkedSourceDigest:checks.at(-1).sourceDigest,renderedHtmlSha256:qualificationHash(preview.html),
    runId:record.id,claimedModel:record.requestedModel,attempt:record.attempt,recordedOperationId:checks.at(-1).operationId,recordReportedUsage:record.usage,
    packId:record.packId,semanticScopeSha256:RECOVERY_SCOPE_SHA256,scopeSourceRequestSha256:SCOPE.sourceRequestSha256,
    retainedTrace:trace,offlineParserReplays,originalTransportAndFinishReasonQualified:false}};
}

export async function prepareAuthoredRecovery(){
  const files=materializeRecoveryExample(),requirements={requiredInputFormats:PROFILE.inputs,requiredOutputs:PROFILE.outputs};
  await validateGeneratedSource(files,requirements);
  const preview=await renderRunPreview(files,requirements);
  return {files,preview,identity:{sourceKind:'authored-example',providerProvenanceAuthenticated:false,sourceDigest:await runFilesDigest(files),renderedHtmlSha256:qualificationHash(preview.html),offlineParserReplays:0}};
}

export function assertRecoveryObservation(actual,expected){
  const names=['baseline-finish','delayed-finish','recovered-finish','recovered-days'];
  const values=[...expected.finishes,expected.daysRecovered];
  for(let index=0;index<names.length;index++)if(normalize(actual.outputs[names[index]])!==days(values[index]))fail('metric_mismatch','The '+names[index]+' metric differs from the independent expectation.');
  if([...names,'impact','schedule'].some(id=>actual.visible?.[id]!==true))fail('hidden_result','A successful result is not visibly available.');
  if(normalize(actual.outputs.error))fail('unexpected_error','A valid scenario displays an error.');
  if(!normalize(actual.outputs.impact))fail('missing_impact','A valid scenario needs an impact explanation.');
  if(actual.timelineRoots!==1||!Number.isSafeInteger(actual.horizon)||actual.horizon<1||actual.horizon>90)fail('timeline_scale_invalid','The timeline needs one consistent integer horizon from 1 to 90.');
  if(!Array.isArray(actual.rows)||actual.rows.length!==expected.baseline.length)fail('timeline_rows_invalid','The timeline must show exactly one row for each input task.');
  const used=new Set();
  for(const [id,start,end] of expected.baseline){
    const label=normalize(expected.labels[id]);
    const candidates=actual.rows.map((row,index)=>({row,index})).filter(({row})=>[label,id].includes(normalize(row.label)));
    if(candidates.length!==1||used.has(candidates[0].index))fail('timeline_label_ambiguous','A timeline task label is missing, duplicated or ambiguous.');
    const {row,index}=candidates[0];used.add(index);
    const recovered=expected.recovered.find(item=>item[0]===id),want=[start,end,recovered[1],recovered[2]];
    if(!same(row.ranges,want))fail('timeline_range_mismatch','A baseline or scenario range differs from the independent expectation.');
    if(want.some(value=>value>actual.horizon))fail('timeline_scale_invalid','A task range exceeds the declared common horizon.');
    const geometry=[start/actual.horizon*100,(end-start)/actual.horizon*100,recovered[1]/actual.horizon*100,(recovered[2]-recovered[1])/actual.horizon*100];
    if(!Array.isArray(row.geometry)||row.geometry.length!==4||row.geometry.some((value,n)=>!Number.isFinite(value)||Math.abs(value-geometry[n])>0.01))fail('timeline_geometry_mismatch','The visible bars do not use the declared common scale.');
  }
  if(actual.horizontalOverflow)fail('horizontal_overflow','The tool overflows the viewport horizontally.');
}

export function assertRecoveryCleared(actual){
  if(!normalize(actual.outputs.error))fail('missing_error','Invalid input needs a useful error result.');
  if(actual.visible?.error!==true)fail('hidden_error','The invalid-input error is not visibly available.');
  for(const id of ['baseline-finish','delayed-finish','recovered-finish','recovered-days','impact','schedule'])if(normalize(actual.outputs[id]))fail('stale_result','A previous success output remains after invalid input.');
  if(actual.timelineRoots!==0||actual.rows.length)fail('stale_timeline','Previous timeline bars remain after invalid input.');
  if(actual.horizontalOverflow)fail('horizontal_overflow','The tool overflows the viewport horizontally.');
}

export function assertRecoveryLoaderValues(values,index){
  let plan;try{plan=JSON.parse(values['plan-json']);}catch{fail('example_values_invalid','An example loader did not supply valid plan JSON.');}
  const canonical=tasks=>tasks.map(task=>{if(Object.keys(task).sort().join(',')!=='dependsOn,duration,id,title')fail('example_values_invalid','An example task has unsupported fields.');return{id:task.id,title:task.title,duration:task.duration,dependsOn:[...task.dependsOn].sort()};}).sort((a,b)=>a.id.localeCompare(b.id));
  try{if(!same(Object.keys(plan),['tasks'])||!same(canonical(plan.tasks),canonical(PROJECT_TASKS)))fail('example_values_invalid','An example loader changed the supplied seed task data.');}catch{fail('example_values_invalid','An example loader changed the supplied seed task data.');}
  const delay=Number(values['delay-days']),recovery=Number(values['recover-days']);
  if(!values['delay-days'].trim()||!values['recover-days'].trim()||delay!==(index?2:0)||recovery!==(index===2?1:0)
    ||(index&&values['delay-task']!=='delivery')||(index===2&&values['recover-task']!=='assemble'))fail('example_values_invalid','An example loader did not set the prescribed scenario controls.');
}
