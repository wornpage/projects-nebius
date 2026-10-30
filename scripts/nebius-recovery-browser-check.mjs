import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {revealNativeControl,openFocusedNativeDisclosure,nativeScrollState,nativeScrollMoved} from './nebius-recovery-browser-navigation.mjs';
import {RECOVERY_BROWSER_CASES as CASES,RECOVERY_BROWSER_PROFILE as PROFILE} from '../tests/fixtures/nebius-recovery-browser-cases.mjs';
import {QUALIFICATION_LIMITS as LIMITS,RecoveryQualificationError as Failure,parseRecoveryQualificationArgs,readRecoveryRun,prepareRecoveryRun,prepareAuthoredRecovery,
  recoveryCaseCounts,qualificationHash,assertRecoveryObservation,assertRecoveryCleared,assertRecoveryLoaderValues} from './nebius-recovery-qualification.mjs';

let options;
try{options=parseRecoveryQualificationArgs(process.argv.slice(2));}
catch{console.error(JSON.stringify({status:'blocked',code:'invalid_arguments',message:'Use exactly one source mode, a new absolute --out directory and an absolute --chromium executable.'}));process.exit(2);}
try{await fs.mkdir(options.outputDir);}catch{console.error(JSON.stringify({status:'blocked',code:'output_directory_unavailable',message:'Choose a new output directory with an existing parent.'}));process.exit(2);}
globalThis.fetch=async()=>{throw new Failure('network_forbidden','Qualification cannot call providers.');};
const outcomes=LIMITS.viewports.flatMap(width=>CASES.map(item=>({width,id:item.id,category:item.category,status:'not_run',targetExecuted:false})));
const report={version:'recovery-browser-qualification.v1',startedAt:new Date().toISOString(),mode:options.mode,profile:PROFILE.version,
  recordAuthority:options.mode==='retained-record'?'Caller-supplied file; internal consistency checked, provider provenance not authenticated.':'Fixed authored reference; not model evidence.',
  caseCatalogSha256:qualificationHash(JSON.stringify(CASES)),baseCases:CASES.length,caseCounts:recoveryCaseCounts(),viewports:LIMITS.viewports,
  plannedExecutions:outcomes.length,executedCases:0,browserStarted:false,sourceExecutionAttempted:false,generatedSourceExecutionAttempted:false,sourceExecuted:false,generatedSourceExecuted:false,
  modelCalls:0,liveSandboxCalls:0,providerProvenanceAuthenticated:false,formalAcceptance:false,status:'blocked',outcomes,
  limitations:['Finite profile only; impact wording and broader tool reliability need human review.','Native blur journeys include preceding input; separate change-handler dispatch is not proved.','UI-prevented inputs are reported as unreachable, never counted as passes.'],
  externalRequestCount:0,unexpectedRequestCount:0,pageErrorCount:0,pageErrors:[],serviceWorkerCount:0,contextServiceWorkers:[]};
let prepared,server,browser,deadlineTimer,deadline=Date.now()+LIMITS.wholeRunMs,timedOut=false,currentPage,origin;
const fail=(code,message)=>{throw new Failure(code,message);};
const safeError=error=>error instanceof Failure?{code:error.code,message:error.message.slice(0,240)}:
  {code:error?.name==='TimeoutError'?'browser_timeout':'qualification_error',message:error?.name==='TimeoutError'?'The preview did not reach the expected state before the timeout.':'Qualification could not complete this observation.'};
const guard=()=>{if(timedOut||Date.now()>deadline)fail('whole_run_deadline','The whole-run qualification deadline was reached.');};
let seq=0;
async function waitReady(page,after){
  await page.waitForFunction(after=>{const state=document.getElementById('preview-status');return state.dataset.status==='failed'||Number(state.dataset.count)>after;},after,{timeout:LIMITS.responseMs});
  if(await page.locator('#preview-status').getAttribute('data-status')==='failed')fail('preview_failed','The production preview stopped after a runtime or patch-contract error.');
}
async function openCase(page,previewPath){
  guard();await page.goto(origin+'/');
  await page.getByRole('button',{name:'Open preview',exact:true}).click();
  await waitReady(page,0);
  const frame=page.frames().find(frame=>frame.url()===origin+previewPath);
  if(!frame)fail('preview_frame_missing','The isolated preview frame did not load.');
  report.sourceExecuted=true;if(options.mode==='retained-record')report.generatedSourceExecuted=true;
  return frame;
}
async function setValue(page,frame,id,value,blur=true){
  guard();const field=frame.locator('#'+id);await revealNativeControl(field);
  const before=await field.inputValue();if(before===value)return;
  const tag=await field.evaluate(el=>el.tagName);
  const count=Number(await page.locator('#preview-status').getAttribute('data-count'));
  if(tag==='SELECT'){
    if(!await field.locator('option').evaluateAll((options,wanted)=>options.some(option=>option.value===wanted),value))fail('input_unreachable','The native control prevents this case value; handler semantics were not exercised.');
    await field.selectOption(value);
  }else await field.fill(value);
  if(await field.inputValue()!==value)fail('input_unreachable','The native control prevents this case value; handler semantics were not exercised.');
  await waitReady(page,count);
  if(blur){const beforeBlur=Number(await page.locator('#preview-status').getAttribute('data-count'));await field.press('Tab');
    // Text edits produce native change on blur; some controls already dispatch
    // it with input. The final observation is a user journey, not event isolation.
    if(tag!=='SELECT')await waitReady(page,beforeBlur);
  }
}
async function setValues(page,frame,values){for(const item of PROFILE.inputs)await setValue(page,frame,item.id,values[item.id]);}
async function valuesOf(frame){const values={};for(const item of PROFILE.inputs)values[item.id]=await frame.locator('#'+item.id).inputValue();return values;}
async function observe(frame){
  return frame.evaluate(ids=>{
    const outputs={},visible={};
    for(const id of ids){const el=document.getElementById(id);if(!el)throw Error('Missing output');const text=el.textContent||'';if(text.length>20000)throw Error('Oversized output');outputs[id]=text;
      let shown=true;for(let node=el;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||node.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)shown=false;}
      const box=el.getBoundingClientRect();visible[id]=shown&&box.width>0&&box.height>0&&box.right>0&&box.left<innerWidth;
    }
    const schedule=document.getElementById('schedule'),roots=schedule.querySelectorAll('[data-nebius-timeline]');
    const axis=roots[0]?.querySelector('[data-nebius-timeline-axis]')?.lastElementChild?.textContent||'';
    const match=axis.match(/^Day (\d+)$/u),horizon=match?Number(match[1]):null;
    const rows=Array.from(schedule.querySelectorAll('[data-nebius-timeline-row]'),row=>{
      const range=row.querySelector('[data-nebius-timeline-range]')?.textContent||'';
      const times=range.match(/^Baseline (\d+)–(\d+) days · Scenario (\d+)–(\d+) days$/u);
      const bars=['baseline','scenario'].map(kind=>row.querySelector('[data-nebius-timeline-bar="'+kind+'"]'));
      return{label:row.querySelector('[data-nebius-timeline-label]')?.textContent||'',ranges:times?times.slice(1).map(Number):null,
        geometry:bars.flatMap(bar=>bar?[parseFloat(bar.style.left),parseFloat(bar.style.width)]:[null,null])};
    });
    return{outputs,visible,timelineRoots:roots.length,horizon,rows,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};
  },PROFILE.outputs.map(item=>item.id));
}
async function activateLoader(page,frame,name,key='Enter'){
  const target=frame.getByRole('button',{name,exact:true,includeHidden:true});await revealNativeControl(target);
  const count=Number(await page.locator('#preview-status').getAttribute('data-count'));
  await target.focus();await page.keyboard.press(key);await waitReady(page,count);
}
async function keyboardCase(page,frame,journey){
  if(journey==='enter'||journey==='space'){
    for(let index=0;index<PROFILE.loaders.length;index++){await activateLoader(page,frame,PROFILE.loaders[index],journey==='enter'?'Enter':'Space');assertRecoveryLoaderValues(await valuesOf(frame),index);assertRecoveryObservation(await observe(frame),CASES[index].expected);}
    return{loaderActivations:3,key:journey==='enter'?'Enter':'Space'};
  }
  const named=[];
  for(const item of PROFILE.inputs){const field=frame.locator('#'+item.id);await field.waitFor({state:'attached'});if(!await field.isEnabled())fail('keyboard_control_unavailable','A required control is disabled.');
    const name=await field.evaluate(el=>{const refs=(el.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||'').join(' ');return refs.trim()||(el.getAttribute('aria-label')||'').trim()||Array.from(el.labels||[],label=>label.textContent||'').join(' ').trim();});
    if(!name)fail('control_name_missing','A required control lacks an accessible name.');named.push(item.id);
  }
  for(const name of PROFILE.loaders){const button=frame.getByRole('button',{name,exact:true,includeHidden:true});const id=await button.getAttribute('id');if(!id||!await button.isEnabled())fail('keyboard_control_unavailable','An example button is not available to keyboard users.');named.push(id);}
  await page.getByRole('button',{name:'Before preview',exact:true}).click();
  const visited=new Set();let left=false,tabCount=0,openedDisclosures=0;
  for(;tabCount<220;tabCount++){guard();await page.keyboard.press('Tab');
    if(await page.getByRole('button',{name:'After preview',exact:true}).evaluate(el=>el===document.activeElement)){left=true;break;}
    if(await page.locator('#fixture').evaluate(el=>el===document.activeElement)){
      if(await openFocusedNativeDisclosure(page,frame,named)){if(++openedDisclosures>12)fail('keyboard_disclosure_depth','Native disclosure depth exceeds the qualification bound.');}
      const id=await frame.evaluate(()=>document.activeElement?.id||'');if(named.includes(id))visited.add(id);
    }
  }
  if(!left||visited.size!==named.length)fail('keyboard_traversal_failed','Native Tab did not reach every required control and example button, then leave the preview.');
  if(journey==='exit'){
    await page.keyboard.press('Shift+Tab');if(!await page.locator('#fixture').evaluate(el=>el===document.activeElement))fail('keyboard_reentry_failed','Native Shift+Tab did not re-enter the preview.');
    await page.locator('#fixture').scrollIntoViewIfNeeded();
    const box=await page.locator('#fixture').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);const before=await nativeScrollState(frame);
    await page.mouse.wheel(0,600);await page.waitForTimeout(100);let moved=nativeScrollMoved(before,await nativeScrollState(frame));
    if(before.needed&&!moved){await page.mouse.wheel(0,-600);await page.waitForTimeout(100);moved=nativeScrollMoved(before,await nativeScrollState(frame));if(!moved)fail('native_scroll_failed','Native scrolling did not move an overflowing preview or nested control.');}
    return{tabCount,visitedControls:[...visited],openedDisclosures,leftPreview:true,reentered:true,nativeScrollObserved:moved};
  }
  return{tabCount,visitedControls:[...visited],openedDisclosures,leftPreview:true};
}
try{
  if(options.mode==='retained-record'){const input=await readRecoveryRun(options.recordPath);report.recordFileSha256=input.fileSha256;prepared=await prepareRecoveryRun(input.record,input.fileSha256);}
  else prepared=await prepareAuthoredRecovery();
  report.identity=prepared.identity;
  const action=randomBytes(24).toString('hex'),nonce=randomBytes(24).toString('base64'),previewPath='/preview/'+action;
  const host=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private recovery qualification</title><link rel="icon" href="data:,"><style nonce="${nonce}">body{margin:0;font:14px system-ui}h1,p{margin:8px}iframe{display:block;width:100%;height:720px;border:0}button{min-height:36px;margin:4px}</style><h1>Private recovery qualification</h1><p>${options.mode==='authored-example'?'Authored reference; no model result.':'Exact caller-supplied saved source; provider provenance is not authenticated.'}</p><form method="post" action="${previewPath}" target="fixture"><button>Open preview</button></form><button>Before preview</button><iframe id="fixture" name="fixture" title="Recovery tool preview" src="about:blank" sandbox="allow-scripts"></iframe><button>After preview</button><output id="preview-status" data-count="0" data-status="loading"></output><script nonce="${nonce}">addEventListener('message',event=>{const frame=document.getElementById('fixture'),data=event.data;if(event.source!==frame.contentWindow||event.origin!=='null'||!data||Object.keys(data).sort().join(',')!=='status,type'||data.type!=='nebius-tool-preview'||!['ready','failed'].includes(data.status))return;const status=document.getElementById('preview-status');status.dataset.count=String(Number(status.dataset.count)+1);status.dataset.status=data.status;status.textContent=data.status;});</script></html>`;
  const hostCsp=`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src 'self'; form-action 'self'; img-src data:; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`;
  server=createServer((request,response)=>{
    const expected='127.0.0.1:'+server.address().port;request.resume();
    if(request.headers.host!==expected){response.writeHead(400);response.end();return;}
    const headers={'content-type':'text/html;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'};
    if(request.method==='GET'&&request.url==='/'){response.writeHead(200,{...headers,'content-security-policy':hostCsp});response.end(host);return;}
    if(request.method==='POST'&&request.url===previewPath){report.sourceExecutionAttempted=true;if(options.mode==='retained-record')report.generatedSourceExecutionAttempted=true;response.writeHead(200,{...headers,'content-security-policy':prepared.preview.csp});response.end(prepared.preview.html);return;}
    report.unexpectedRequestCount++;response.writeHead(404);response.end();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  guard();const {chromium}=await import('playwright-core');browser=await chromium.launch({executablePath:options.chromiumPath,headless:true,timeout:Math.min(30000,deadline-Date.now())});report.browserStarted=true;report.browserVersion=browser.version();
  guard();deadlineTimer=setTimeout(()=>{timedOut=true;void browser.close().catch(()=>{});},Math.max(1,deadline-Date.now()));
  for(const width of LIMITS.viewports){
    // Playwright's serviceWorkers:block init script throws in opaque frames.
    // Keep native sandbox/CSP isolation, exact request blocking and explicit
    // zero-service-worker observations instead of injecting that script.
    guard();const context=await browser.newContext({viewport:{width,height:900}});let failedScreens=0,failureNotices=0;
    const serviceWorkers={width,atStart:context.serviceWorkers().length,atEnd:null};report.contextServiceWorkers.push(serviceWorkers);
    if(serviceWorkers.atStart)fail('service_worker_boundary_failed','A fresh context unexpectedly contains a service worker.');
    context.on('serviceworker',()=>{report.serviceWorkerCount++;});
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin&&(url.pathname==='/'||url.pathname===previewPath)&&!url.search&&!url.hash)return route.continue();report.externalRequestCount++;return route.abort();});
    try{
      for(const item of CASES){guard();const outcome=outcomes.find(entry=>entry.width===width&&entry.id===item.id);outcome.status='running';outcome.startedAt=new Date().toISOString();report.executedCases++;
        currentPage=await context.newPage();currentPage.setDefaultTimeout(LIMITS.responseMs);currentPage.on('pageerror',error=>{report.pageErrorCount++;if(report.pageErrors.length<5)report.pageErrors.push({case:item.id,width,message:String(error.message).replace(/[\u0000-\u001f\u007f]/gu,' ').slice(0,240)});});
        let frame,caseTimedOut=false;const ownedPage=currentPage,caseTimer=setTimeout(()=>{caseTimedOut=true;void ownedPage.close().catch(()=>{});},Math.min(LIMITS.caseMs,deadline-Date.now()));
        try{
          frame=await openCase(currentPage,previewPath);
          if(item.category==='valid'){await setValues(currentPage,frame,item.values);outcome.targetExecuted=true;assertRecoveryObservation(await observe(frame),item.expected);}
          else if(item.category==='invalid'||item.category==='stale'){
            await setValues(currentPage,frame,item.baseValues);assertRecoveryObservation(await observe(frame),item.baseExpected);outcome.baseVerified=true;
            await setValue(currentPage,frame,item.field,item.value,item.phase!=='input');outcome.targetExecuted=true;assertRecoveryCleared(await observe(frame));
          }else if(item.category==='example'){
            await setValues(currentPage,frame,CASES[2].values);assertRecoveryObservation(await observe(frame),CASES[2].expected);
            await activateLoader(currentPage,frame,item.loader);outcome.targetExecuted=true;assertRecoveryLoaderValues(await valuesOf(frame),PROFILE.loaders.indexOf(item.loader));assertRecoveryObservation(await observe(frame),item.expected);
          }else{outcome.keyboard=await keyboardCase(currentPage,frame,item.journey);outcome.targetExecuted=true;}
          outcome.status='passed';
          if(['valid-prewritten-03','invalid-json-syntax','keyboard-traversal'].includes(item.id)){
            if(item.category!=='keyboard')await frame.locator(item.category==='valid'?'#schedule':'#error').scrollIntoViewIfNeeded();
            const name=width+'-'+item.id+'.png';await currentPage.screenshot({path:path.join(options.outputDir,name)});outcome.screenshot=name;
          }
        }catch(error){outcome.status=error instanceof Failure&&error.code==='input_unreachable'?'unreachable':'failed';outcome.error=caseTimedOut?{code:'case_deadline',message:'The case deadline was reached.'}:safeError(error);
          if(failedScreens<3&&!timedOut){const name=width+'-failed-'+item.id+'.png';await currentPage.screenshot({path:path.join(options.outputDir,name)}).then(()=>{outcome.screenshot=name;failedScreens++;}).catch(()=>{});}
        }finally{clearTimeout(caseTimer);outcome.finishedAt=new Date().toISOString();await ownedPage.close().catch(()=>{});currentPage=null;}
        if(outcome.status!=='passed'&&failureNotices++<3)console.log(JSON.stringify({width,case:outcome.id,status:outcome.status,code:outcome.error?.code}));
        if(++seq%20===0)console.log(JSON.stringify({progress:seq,planned:outcomes.length,width}));
        if(report.serviceWorkerCount)fail('service_worker_boundary_failed','A service worker appeared in the isolated qualification context.');
        if(report.externalRequestCount||report.unexpectedRequestCount)fail('network_boundary_failed','A request crossed the exact local qualification allowlist.');
      }
    }finally{serviceWorkers.atEnd=context.serviceWorkers().length;await context.close().catch(()=>{});currentPage=null;}
  }
  report.status=outcomes.every(item=>item.status==='passed')&&report.pageErrorCount===0&&report.serviceWorkerCount===0&&report.contextServiceWorkers.every(item=>item.atStart===0&&item.atEnd===0)?'passed':'needs-work';
}catch(error){report.error=safeError(error);report.status=report.browserStarted?'incomplete':'blocked';}
finally{
  clearTimeout(deadlineTimer);if(browser)await browser.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));
  for(const item of outcomes)if(item.status==='running'){item.status='interrupted';item.error={code:'interrupted',message:'The browser journey was interrupted.'};}
  report.finishedAt=new Date().toISOString();report.counts=Object.fromEntries(['passed','failed','unreachable','not_run','interrupted'].map(status=>[status,outcomes.filter(item=>item.status===status).length]));
  report.targetExecutions=outcomes.filter(item=>item.targetExecuted).length;
  report.byViewport=LIMITS.viewports.map(width=>({width,planned:CASES.length,counts:Object.fromEntries(['passed','failed','unreachable','not_run','interrupted'].map(status=>[status,outcomes.filter(item=>item.width===width&&item.status===status).length]))}));
  report.exactSuppliedSourceBrowserPassed=options.mode==='retained-record'&&report.status==='passed';report.authoredSelfQualificationPassed=options.mode==='authored-example'&&report.status==='passed';
  await fs.writeFile(path.join(options.outputDir,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({mode:report.mode,status:report.status,planned:report.plannedExecutions,executed:report.executedCases,counts:report.counts,browserStarted:report.browserStarted,modelCalls:0,liveSandboxCalls:0,error:report.error}));
  if(report.status!=='passed')process.exitCode=report.status==='blocked'?2:1;
}
