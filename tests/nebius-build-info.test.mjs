import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBuildInfo } from '../worker/nebius-build-info.mjs';
const url='https://example.invalid/api/nebius/build-info',id='00000000-0000-4000-8000-000000000001';
test('hosted identity exposes only platform version, capabilities and bounded limits',async()=>{
  const env={NEBIUS_VERSION:{id,tag:'PRIVATE_TAG_NOT_NEEDED'},NEBIUS_ENABLED:'false',NEBIUS_EXECUTION_ENABLED:'true'};
  for(const name of ['NEBIUS_API_KEY','NEBIUS_SANDBOX_IAM_TOKEN','NEBIUS_RUNS','NEBIUS_BUDGET'])Object.defineProperty(env,name,{get(){throw Error('Must not inspect '+name);}});
  const response=handleBuildInfo(new Request(url),env),body=await response.json();assert.equal(response.status,200);assert.equal(body.versionId,id);assert.equal(body.guidanceEnabled,false);assert.equal(body.executionEnabled,true);assert.deepEqual(Object.keys(body).sort(),['available','executionEnabled','guidanceEnabled','limits','recordFormat','runVersion','versionId']);
  assert.equal(body.limits.maxModelCalls,2);assert.equal(body.limits.maxOutputTokens,32000);assert.equal(body.limits.maxSandboxRuns,2);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.doesNotMatch(JSON.stringify(body),/PRIVATE_TAG|API_KEY|IAM_TOKEN/);
});
test('missing or invalid platform identity is unavailable rather than a guessed revision',async()=>{
  for(const env of [{},{NEBIUS_VERSION:{id:'local'}},{NEBIUS_VERSION:{id:null}}]){const response=handleBuildInfo(new Request(url),env);assert.equal(response.status,503);assert.deepEqual(await response.json(),{available:false,code:'version_unavailable'});}
});
test('HEAD has identical status and no response body',async()=>{const response=handleBuildInfo(new Request(url,{method:'HEAD'}),{NEBIUS_VERSION:{id}});assert.equal(response.status,200);assert.equal(await response.text(),'');});
test('mutating methods never access version or run bindings',async()=>{
  const env={get NEBIUS_VERSION(){throw Error('Unexpected read');}};for(const method of ['POST','PUT','PATCH','DELETE']){const response=handleBuildInfo(new Request(url,{method}),env);assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD');}
});
test('query parameters are refused without selecting another version',async()=>{const response=handleBuildInfo(new Request(url+'?version=other'),{NEBIUS_VERSION:{id}});assert.equal(response.status,400);});


test('distribution configuration excludes owner bindings and keeps provider execution disabled',async()=>{
  const config=JSON.parse(await readFile(new URL('../wrangler.nebius.jsonc',import.meta.url),'utf8'));
  assert.equal(Object.hasOwn(config,'account_id'),false);
  assert.equal(Object.hasOwn(config.env.demo,'routes'),false);
  assert.equal(config.name,'wornpage-nebius-example');
  assert.equal(config.env.demo.name,'wornpage-nebius-demo-example');
  assert.equal(config.workers_dev,false);
  assert.equal(config.env.demo.workers_dev,false);
  assert.equal(config.preview_urls,false);
  assert.equal(config.env.demo.preview_urls,false);
  for(const vars of [config.vars,config.env.demo.vars]){
    assert.equal(vars.NEBIUS_ENABLED,'false');
    assert.equal(vars.NEBIUS_EXECUTION_ENABLED,'false');
    assert.equal(vars.NEBIUS_ALLOWED_ORIGIN,'');
    assert.equal(vars.NEBIUS_SANDBOX_PROJECT_ID,'');
    assert.equal(vars.NEBIUS_SANDBOX_NODE_IMAGE_UUID,'');
    assert.equal(vars.NEBIUS_DAILY_CALL_LIMIT,'20');
    assert.equal(vars.NEBIUS_DAILY_RUN_LIMIT,'3');
  }
  const types=await readFile(new URL('../worker/env.d.ts',import.meta.url),'utf8');
  for(const key of ['NEBIUS_ALLOWED_ORIGIN','NEBIUS_SANDBOX_PROJECT_ID','NEBIUS_SANDBOX_NODE_IMAGE_UUID']){
    assert.match(types,new RegExp(`\\b${key}:\\s*string;`));
  }
});
