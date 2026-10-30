import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {FIXTURE_INPUT,FIXTURE_MODEL,authoredCheckerFiles,nativeFileBlocks} from '../tests/fixtures/nebius-release-checker.mjs';
import {streamEnvelope} from '../tests/helpers/nebius-stream-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare'),{build}=wranglerRequire('esbuild');
const output=process.env.NEBIUS_LIFECYCLE_EVIDENCE_DIR||path.join(root,'dist','lifecycle-'+Date.now());
await fs.mkdir(output,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const good=nativeFileBlocks(authoredCheckerFiles()),badFiles=authoredCheckerFiles();
badFiles[0].content=badFiles[0].content.replace(' data-input-format="json"','');
const bad=nativeFileBlocks(badFiles),image='00000000-0000-4000-8000-000000000003',operation='00000000-0000-4000-8000-000000008083';
const runId='00000000-0000-4000-8000-000000008081',admission='00000000-0000-4000-8000-000000008082',key='a'.repeat(64);

// This fixture subclass changes only test timing and exposes read-only state
// observations. It never replaces production alarm/submission/validation logic.
const fixtureEntry=`import worker,{NebiusRun as BaseRun,NebiusBudget,NebiusRunBudget} from ${JSON.stringify(path.join(root,'worker/index.mjs').replaceAll('\\','/'))};
export {NebiusBudget,NebiusRunBudget}; export default worker;
export class NebiusRun extends BaseRun {
  async startFixture(id,input,key,admission,limit,deadlineMs){
    if(this.env.NEBIUS_MODEL_REASONING!==${JSON.stringify(FIXTURE_MODEL)}) throw Error('Synthetic fixture only');
    const result=await this.startAdmitted(id,input,key,admission,limit);
    if(deadlineMs)await this.ctx.storage.transaction(async tx=>{const s=await tx.get('state');if(s.phase!=='model-ready'||s.record.usage.modelCalls)throw Error('Fixture setup arrived after submission');s.deadline=Math.min(s.deadline,Date.now()+deadlineMs);await tx.put('state',s);await tx.setAlarm(Date.now()+100);});
    return result;
  }
  async claimSubmission(expected,phase,maximum,update){
    const shorter=phase==='model-submitting'?Number(this.env.FIXTURE_MODEL_TIMEOUT_MS):0;
    return super.claimSubmission(expected,phase,shorter?Math.min(maximum,shorter):maximum,update);
  }
  async commit(expected,update){
    const next=await super.commit(expected,update);
    if(expected.phase==='model-submitting'&&next?.phase==='model-validating'&&next.record.usage.modelCalls===1&&Number(this.env.FIXTURE_RECEIPT_HOLD_MS))await new Promise(resolve=>setTimeout(resolve,Number(this.env.FIXTURE_RECEIPT_HOLD_MS)));
    return next;
  }
  async probe(){const s=await this.load();return s?{phase:s.phase,record:s.record,submission:s.submission??null,cancelSubmitted:s.cancelSubmitted,pending:!!s.pendingGeneration,alarm:await this.ctx.storage.getAlarm(),stateBytes:new TextEncoder().encode(JSON.stringify(s)).length}:null;}
}`;
const compiled=await build({stdin:{contents:fixtureEntry,resolveDir:root,sourcefile:'offline-lifecycle-fixture.mjs'},bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:*'],logLevel:'silent'});
const script=compiled.outputFiles[0].text;
await fs.writeFile(path.join(output,'worker-bundle.mjs'),script,{flag:'wx'});
const cases=[
  {name:'slow-provider',delay:40000,poll:1000,expected:'ready',models:1,sandboxes:1},
  {name:'restart-pending',delay:9000,responseWindow:5000,restart:'model-submitting',expected:'uncertain',models:1,sandboxes:0},
  {name:'restart-received',delay:5,hold:20000,restart:'model-validating',expected:'ready',models:1,sandboxes:1},
  {name:'cancel-received-restart',delay:5,hold:20000,restart:'model-validating',cancelBeforeRestart:true,expected:'cancelled',models:1,sandboxes:0},
  {name:'reject-received-restart',delay:5,hold:20000,restart:'model-validating',responses:[bad,good],expected:'ready',models:2,sandboxes:1},
  {name:'cancel-pending-sandbox',delay:5,sandboxDelay:2000,cancelAt:'sandbox-submitting',expected:'cancelled',models:1,sandboxes:1,deletes:1},
  {name:'restart-cancel-delete',delay:5,cancelAt:'sandbox-polling',cancelDelay:4000,restart:'cancel-submitted',expected:'cancelled',models:1,sandboxes:1,deletes:1},
];
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return realFetch(input,init);throw Error('External fetch forbidden in offline lifecycle verification');};
const report={startedAt:new Date().toISOString(),kind:'real local workerd with authored model/Sandbox transports and explicit timing controls',bundleSha256:sha(script),
 sourceHashes:{worker:sha(await fs.readFile(path.join(root,'worker/nebius-runs.mjs'))),provider:sha(await fs.readFile(path.join(root,'worker/nebius-run-provider.mjs'))),harness:sha(await fs.readFile(fileURLToPath(import.meta.url)))},
 providerCalls:0,sandboxExecutions:0,generatedCodeExecuted:false,results:[],passed:false};
try{
 for(const spec of cases){
  const caseDir=path.join(output,spec.name);await fs.mkdir(caseDir);
  const start=Date.now(),trace=[],pendingMockTimers=[];let modelCalls=0,sandboxStarts=0,cancelCalls=0,cancelComplete=false,unexpected=0,mf,stub,restarted=false,cancelRequested=false,waitingAfterRestart=false,submissionDeadline=null;
  const responses=spec.responses||[good];
  const timer=ms=>{const p=wait(ms);pendingMockTimers.push(p);return p;};
  const localTransport=async request=>{
   trace.push({elapsed:Date.now()-start,event:'outbound',method:request.method,url:request.url});
   if(request.method==='POST'&&request.url==='https://api.tokenfactory.nebius.com/v1/chat/completions'){
    const index=modelCalls++;assert(index<responses.length,'Unexpected extra model call');const body=await request.json();assert.equal(body.model,FIXTURE_MODEL);assert.equal(body.max_tokens,32000);
    await timer(spec.delay);trace.push({elapsed:Date.now()-start,event:'authored-model-response',attempt:index+1});
    assert.equal(body.stream,true);assert.deepEqual(body.stream_options,{include_usage:true});
    return streamEnvelope({model:FIXTURE_MODEL,usage:{prompt_tokens:10,completion_tokens:20},choices:[{finish_reason:'stop',message:{role:'assistant',content:responses[index],reasoning_content:'PRIVATE_REASONING_NOT_RETAINED'}}]});
   }
   if(request.method==='POST'&&request.url==='https://api.tokenfactory.nebius.com/sandboxes/v1/instances'){
    sandboxStarts++;assert.equal(sandboxStarts,1);if(spec.sandboxDelay)await timer(spec.sandboxDelay);
    return Response.json({uuid:admission,image},{status:201,headers:{location:'/sandboxes/v1/operations/'+operation}});
   }
   if(request.url==='https://api.tokenfactory.nebius.com/sandboxes/v1/operations/'+operation){
    if(request.method==='DELETE'){cancelCalls++;assert.equal(cancelCalls,1);if(spec.cancelDelay)await timer(spec.cancelDelay);cancelComplete=true;return new Response(null,{status:202});}
    if(request.method==='GET'){
     if(spec.cancelAt)return Response.json({uuid:operation,kind:'instance',status:cancelComplete?'CANCELLED':'EXECUTING',metadata:{image}});
     return Response.json({uuid:operation,kind:'instance',status:'SUCCESS',metadata:{image,result:{state:{exit_code:0},stdout:{encoding:'ascii',value:'Authored local result; no real Sandbox execution.'},stderr:{encoding:'ascii',value:''}}}});
    }
   }
   unexpected++;throw Error('Unmatched outbound request denied');
  };
  const options=convertV4MiniflareOptions({name:'offline-run80',modules:true,script,compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat','enable_request_signal'],host:'127.0.0.1',port:0,resourcePersistencePath:path.join(caseDir,'runtime-state'),telemetry:{enabled:false},
   durableObjects:{NEBIUS_RUNS:{className:'NebiusRun',useSQLite:true},NEBIUS_BUDGET:{className:'NebiusBudget',useSQLite:true},NEBIUS_RUN_BUDGET:{className:'NebiusRunBudget',useSQLite:true}},
   bindings:{NEBIUS_API_KEY:'synthetic-fixture-key',NEBIUS_MODEL_REASONING:FIXTURE_MODEL,NEBIUS_SANDBOX_IAM_TOKEN:'synthetic-fixture-token',NEBIUS_SANDBOX_PROJECT_ID:'fixture-project',NEBIUS_SANDBOX_NODE_IMAGE_UUID:image,FIXTURE_MODEL_TIMEOUT_MS:String(spec.responseWindow||0),FIXTURE_RECEIPT_HOLD_MS:String(spec.hold||0)},outboundService:localTransport});
  const result={name:spec.name,passed:false,trace};
  try{
   mf=new Miniflare(options);stub=(await mf.getDurableObjectNamespace('NEBIUS_RUNS')).getByName(runId);
   const admitted=await stub.startFixture(runId,FIXTURE_INPUT,key,admission,20,spec.name==='slow-provider'?0:15000);assert(admitted.ok&&admitted.created);
   let last='';
   for(;;){
    // probe reads state without calling ensureAlarm, proving the durable
    // watchdog works after restart without status-poll repair assistance.
    const state=JSON.parse(JSON.stringify(spec.name==='slow-provider'?(await stub.read(key),await stub.probe()):await stub.probe()));assert(state);
    const signature=JSON.stringify([state.phase,state.record.status,state.record.usage,state.cancelSubmitted]);
    if(signature!==last){trace.push({elapsed:Date.now()-start,event:'state',phase:state.phase,status:state.record.status,usage:state.record.usage,alarm:state.alarm});last=signature;}
    if(state.phase==='model-submitting'&&state.submission)submissionDeadline=state.submission.deadline;
    if(restarted&&spec.restart==='model-submitting'&&state.phase==='model-submitting'&&Date.now()<submissionDeadline)waitingAfterRestart=true;
    if(spec.cancelAt&&!cancelRequested&&state.phase===spec.cancelAt){await stub.cancel(key);cancelRequested=true;trace.push({elapsed:Date.now()-start,event:'owner-cancel'});}
    const restartDue=spec.restart==='cancel-submitted'?cancelCalls===1:state.phase===spec.restart;
    if(spec.restart&&!restarted&&restartDue&&modelCalls===1){
     if(spec.cancelBeforeRestart){await stub.cancel(key);cancelRequested=true;}
     assert.equal(modelCalls,1);trace.push({elapsed:Date.now()-start,event:'controlled-process-stop'});
     await mf.dispose();mf=new Miniflare(options);stub=(await mf.getDurableObjectNamespace('NEBIUS_RUNS')).getByName(runId);restarted=true;
     trace.push({elapsed:Date.now()-start,event:'controlled-process-restart'});
    }
    if(['ready','failed','cancelled','uncertain'].includes(state.record.status)){result.record=state.record;result.pendingCleared=!state.pending;break;}
    assert(Date.now()-start<(spec.name==='slow-provider'?55000:25000),'Offline runtime case deadline exceeded');
    await wait(spec.poll||75);
   }
   assert.equal(result.record.status,spec.expected,spec.name+' outcome');assert(result.pendingCleared);
   assert.equal(modelCalls,spec.models);assert.equal(sandboxStarts,spec.sandboxes);assert.equal(cancelCalls,spec.deletes||0);assert.equal(unexpected,0);
   assert.doesNotMatch(JSON.stringify(result.record),/PRIVATE_REASONING_NOT_RETAINED|pendingGeneration|synthetic-fixture-key/);
   if(spec.restart)assert(restarted);if(spec.restart==='model-submitting'){assert(waitingAfterRestart);assert(Date.parse(result.record.updatedAt)>=submissionDeadline);assert.equal(result.record.usage.totalsComplete,false);}
   result.passed=true;
  }catch(error){result.failure={message:error.message,stack:String(error.stack).slice(0,2400)};throw error;}
  finally{await mf?.dispose();await Promise.allSettled(pendingMockTimers);Object.assign(result,{mockModelCalls:modelCalls,mockSandboxStarts:sandboxStarts,mockCancelCalls:cancelCalls,unexpectedOutbound:unexpected,waitingAfterRestart,elapsedMs:Date.now()-start});report.results.push(result);await fs.writeFile(path.join(caseDir,'report.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({case:spec.name,passed:result.passed,status:result.record?.status,model:modelCalls,sandbox:sandboxStarts,cancel:cancelCalls,failure:result.failure?.message}));}
 }
 report.passed=true;
}finally{report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:report.passed,cases:report.results.length,providerCalls:0,sandboxExecutions:0,evidence:output}));}
