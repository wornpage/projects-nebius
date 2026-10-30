import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';

// These are trusted application validators and an authored test statement.
// No model-produced app.js or checks.cjs is evaluated by this regression.
const root=fileURLToPath(new URL('../',import.meta.url));
const config=JSON.parse(await readFile(new URL('../wrangler.nebius.jsonc',import.meta.url),'utf8'));
const modules=new Map();
async function bundled(keepNames){
 if(!modules.has(keepNames))modules.set(keepNames,(async()=>{
  const output=await build({stdin:{contents:`export { TIMELINE_VALIDATOR_SOURCE } from './svelte-frontend/src/lib/nebius-timeline-contract.mjs';
export { wrapRunChecks } from './worker/nebius-run-checks.mjs';
export { CHECK_RUNNER } from './worker/nebius-sandbox.mjs';`,resolveDir:root,sourcefile:'trusted-validator-entry.mjs'},bundle:true,write:false,platform:'node',format:'esm',target:'es2024',keepNames,minify:false,logLevel:'silent'});
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
 })());
 return modules.get(keepNames);
}
const patch=()=>({id:'schedule',text:'Projected schedule',timeline:{unit:'days',horizon:12,rows:[{id:'delivery',label:'Delivery',start:1,end:6,baselineStart:1,baselineEnd:4}]}});
const execute=(source,value)=>runInNewContext('const validate='+source+';validate('+JSON.stringify(value)+',"timeline");',{}, {timeout:1000});

test('the default name-preservation transform reproduces the retained free-helper failure',async()=>{
 const artifact=await bundled(true);
 assert.match(artifact.TIMELINE_VALIDATOR_SOURCE,/__name/u);
 assert.throws(()=>execute(artifact.TIMELINE_VALIDATOR_SOURCE,patch()),/__name is not defined/u);
});
test('the configured Worker build keeps the serialized timeline validator self-contained',async()=>{
 assert.equal(config.keep_names,false,'Serialized validators require name-helper-free Worker output.');
 const artifact=await bundled(config.keep_names);
 assert.doesNotMatch(artifact.TIMELINE_VALIDATOR_SOURCE,/\b__name\b/u);
 assert.deepEqual(JSON.parse(JSON.stringify(execute(artifact.TIMELINE_VALIDATOR_SOURCE,patch()))),patch().timeline);
});
test('the compiled validator continues to reject invalid bounds and unexpected fields',async()=>{
 const artifact=await bundled(config.keep_names);
 const wrong=patch();wrong.timeline.rows[0].end=13;
 assert.throws(()=>execute(artifact.TIMELINE_VALIDATOR_SOURCE,wrong),/bounded integer/u);
 const injected=patch();injected.timeline.html='<svg></svg>';
 assert.throws(()=>execute(artifact.TIMELINE_VALIDATOR_SOURCE,injected),/unsupported fields/u);
});
test('the Sandbox runner embeds the same closed validator and executable trusted check wrapper',async()=>{
 const artifact=await bundled(config.keep_names);
 assert.ok(artifact.CHECK_RUNNER.includes('const validateTimelinePatch = '+artifact.TIMELINE_VALIDATOR_SOURCE));
 assert.ok(artifact.CHECK_RUNNER.includes('const checksWrapper = '+artifact.wrapRunChecks.toString()));
 const source=runInNewContext('('+artifact.wrapRunChecks.toString()+')('+JSON.stringify('assert.equal(validate(7), 7);')+');',{}, {timeout:1000});
 assert.doesNotMatch(source,/\b__name\b/u);
 let calls=0;
 runInNewContext(source,{__checks:{assert,validate:value=>{calls++;return value;},handleMessage:()=>[]}}, {timeout:1000});
 assert.equal(calls,1);
});
