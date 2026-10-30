// Full browser-local project journey. Actual pinned simulator in its production
// sandbox renderer; authored project/decisions only, no provider or Sandbox run.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {handleRecoveryExample,isRecoveryExamplePath,RECOVERY_EXAMPLE_PATH} from '../worker/nebius-recovery-example.mjs';
import {revealNativeControl} from './nebius-recovery-browser-navigation.mjs';

const root=await realpath(path.resolve('dist/static-publish'));
const output=path.resolve(process.env.NEBIUS_RECOVERY_FLOW_EVIDENCE_DIR || 'dist/nebius-recovery-project-flow');
const key='projects-webmcp-challenge-state-v1';
const existingProject={id:'unrelated-existing-project',title:'W'.repeat(120),summary:'An unrelated project with a valid unbroken title.',brief:'Existing authored fixture work.',source:'manual',createdAt:'2026-10-24T00:00:00.000Z'};
const existing={id:'unrelated-existing-task',projectId:existingProject.id,title:'Keep existing work',status:'active',type:'task',blocker:'None',next:'Review',nextStep:'Preserve this task.',purpose:'Unrelated saved work.',doneWhen:'Its contents stay unchanged.',completionEvidence:'Unrelated existing evidence.'};
const initial={packs:[existing],projects:[existingProject],selectedId:existing.id,pendingNextActionDrafts:[]};
const criteria7='Compare the fixed five-task reference. Record an option finishing by day 7 and its assumptions; this is an offline review, not a supplier commitment.';
const criteria6='Compare the fixed five-task reference. Record an option finishing by day 6 and its assumptions; this is an offline review, not a supplier commitment.';
const report={private:true,kind:'offline-recovery-project-journey',paidCalls:0,providerCalls:0,sandboxRuns:0,external:[],writes:[],errors:[],cases:[],passed:false};
await mkdir(output,{recursive:true});
// Even accidental server-side use cannot reach a provider.
globalThis.fetch=async()=>{throw Error('Outbound fetch is disabled in this offline journey.');};
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{
  try{
    const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);
    if(req.headers.host!==new URL(origin).host){res.writeHead(400);res.end();return;}
    if(!['GET','HEAD'].includes(req.method)){report.writes.push(url.pathname);res.writeHead(405);res.end();return;}
    if(isRecoveryExamplePath(url.pathname)){const reply=await handleRecoveryExample(new Request(url,{method:req.method}));res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(Buffer.from(await reply.arrayBuffer()));return;}
    if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});res.end('{"available":false,"code":"execution_disabled"}');return;}
    let relative;try{relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';}catch{res.writeHead(400);res.end();return;}
    const candidate=path.resolve(root,path.extname(relative)?relative:relative+'.html');
    if(!candidate.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    let file;try{file=await realpath(candidate);}catch{res.writeHead(404);res.end();return;}
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){report.errors.push(String(error.message));res.writeHead(500);res.end('Offline fixture unavailable.');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
async function state(page){return page.evaluate(k=>{const raw=JSON.parse(localStorage.getItem(k));return raw?.state||raw;},key);}
async function tabTo(page,control){await control.waitFor({state:'visible'});for(let n=0;n<160;n++){if(await control.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Native Tab did not reach the requested control');}
async function fillTask(fieldset,{title,purpose,nextStep,doneWhen}){await fieldset.getByLabel('Task title',{exact:true}).fill(title);await fieldset.getByLabel('Why it matters',{exact:true}).fill(purpose);await fieldset.getByLabel('Next step',{exact:true}).fill(nextStep);await fieldset.getByLabel('Completion criteria',{exact:true}).fill(doneWhen);}
async function createProject(page){
  await page.getByRole('button',{name:'New project',exact:true}).click();await page.getByLabel('Project brief',{exact:true}).fill('Recover a delayed handoff. Compare the five-task reference against a target, then record which option to investigate and the assumptions still needing confirmation.');
  await page.getByRole('button',{name:'Write plan myself',exact:true}).click();await page.getByLabel('Project title',{exact:true}).fill('Recover the handoff');await page.getByLabel('Project summary',{exact:true}).fill('Choose a recovery option and record the remaining assumptions before changing the real plan.');
  const first=page.locator('[data-plan-task]').first();await fillTask(first,{title:'Compare recovery options',purpose:'Understand how a delivery delay moves the finish in the fixed five-task example.',nextStep:'Try the offline reference and compare no action with expedited delivery.',doneWhen:criteria7});
  const firstId=await first.locator('input[id^="task-title-"]').getAttribute('id');
  await page.getByRole('button',{name:'Add task',exact:true}).click();const second=page.locator('[data-plan-task]').nth(1);await second.waitFor({state:'visible'});await fillTask(second,{title:'Record the recovery decision',purpose:'Keep the human choice and unconfirmed assumptions together.',nextStep:'Review the comparison and record the option to investigate.',doneWhen:'The review names an option to investigate and the supplier or staffing assumptions still needing confirmation. It does not approve a real schedule change.'});
  await second.getByLabel('Predecessor',{exact:true}).selectOption(firstId.slice('task-title-'.length));
  await page.getByRole('button',{name:'Review plan',exact:true}).click();await page.getByRole('button',{name:'Create project',exact:true}).click();await page.locator('[data-project-goal]').waitFor();
  const saved=await state(page),project=saved.projects.find(p=>p.title==='Recover the handoff'),tasks=saved.packs.filter(p=>p.projectId===project.id);assert.equal(tasks.length,2);return{project,first:tasks.find(p=>p.title==='Compare recovery options'),second:tasks.find(p=>p.title==='Record the recovery decision')};
}
async function enterExample(page,id){
  await page.goto(origin+`/next?pack=${encodeURIComponent(id)}&view=tool`);await page.locator('#nebius-work-item').waitFor();const link=page.getByRole('link',{name:'Try offline Recovery Simulator',exact:true});assert.equal(await link.getAttribute('href'),`/recovery-rehearsal?pack=${encodeURIComponent(id)}`);await tabTo(page,link);await page.keyboard.press('Enter');await page.waitForURL(u=>u.pathname==='/recovery-rehearsal');await page.locator('[data-recovery-task-context]').waitFor();
  assert.equal(await page.locator('iframe').getAttribute('src'),RECOVERY_EXAMPLE_PATH,'task context never enters the pinned example API URL');assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts');const frame=page.frames().find(f=>f.parentFrame());assert(frame);await frame.locator('#selected-finish').waitFor();return frame;
}
async function finishEquals(frame,day){await frame.waitForFunction(expected=>document.querySelector('#selected-finish')?.textContent.trim()===`Day ${expected}`,day);}
async function readOutputs(frame){return frame.evaluate(()=>Object.fromEntries(['baseline-finish','delayed-finish','selected-finish','target-status','decision-note'].map(id=>[id,document.getElementById(id).textContent.trim()])));}
async function returnReview(page,id){const link=page.getByRole('link',{name:'Review this task',exact:true});await tabTo(page,link);await page.keyboard.press('Enter');await page.waitForURL(u=>u.pathname==='/next'&&u.searchParams.get('pack')===id&&u.searchParams.get('view')==='review');await page.locator('#nebius-review-evidence').waitFor();}
async function saveEvidence(page,note){await page.locator('#nebius-review-evidence').fill(note);const save=page.getByRole('button',{name:'Save evidence',exact:true});await tabTo(page,save);await page.keyboard.press('Enter');await page.waitForFunction(({key,note})=>{const raw=JSON.parse(localStorage.getItem(key));return(raw?.state||raw).packs.some(p=>p.completionEvidence===note);},{key,note});}
async function reviseCriteria(page,value){await page.getByRole('tab',{name:'Brief',exact:true}).click();await page.getByRole('link',{name:'Edit brief',exact:true}).click();
  // Edit brief opens its editor after a Svelte tick. Wait for that intended
  // state before using native keyboard activation for the nested disclosure;
  // otherwise the delayed open and our Enter can toggle the same panel shut.
  await page.waitForFunction(()=>document.querySelector('#nebius-task-editor')?.open===true);
  const field=page.locator('#nebius-task-done-when');await revealNativeControl(field);await field.fill(value);await page.getByRole('button',{name:'Review changes',exact:true}).click();assert((await page.locator('[data-nebius-task-preview]').innerText()).includes(value));await page.getByRole('button',{name:'Apply changes',exact:true}).click();await page.waitForFunction(({key,value})=>{const raw=JSON.parse(localStorage.getItem(key));return(raw?.state||raw).packs.some(p=>p.doneWhen===value);},{key,value});}
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH});
  for(const width of [375,1280])for(const palette of ['neutral-dark','neutral-light','original-dark','original-light']){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    // Block registration at its local URL, without injecting a forbidden
    // navigator.serviceWorker getter into the opaque sandboxed tool frame.
    await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){report.external.push(req.url());return route.abort();}if(url.pathname==='/sw.js')return route.abort();return route.continue();});
    await context.addInitScript(({key,initial,palette})=>{if(window.top!==window)return;localStorage.setItem('wornpage-nebius-theme-v1',palette);if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(initial));},{key,initial,palette});
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));const result={width,palette,phase:'project',passed:false};report.cases.push(result);
    try{
      await page.goto(origin+'/work');await page.locator('[data-nebius-project-workspace]').waitFor();const preserved=(await state(page)).packs.find(p=>p.id===existing.id);const journey=await createProject(page);assert.equal(journey.first.status,'active');assert.equal(journey.second.status,'blocked');
      assert.equal(await page.getByRole('link',{name:'Try recovery simulator',exact:true}).getAttribute('href'),`/recovery-rehearsal?pack=${encodeURIComponent(journey.first.id)}`);
      await page.screenshot({path:path.join(output,`project-${palette}-${width}.png`)});
      result.phase='tool';let frame=await enterExample(page,journey.first.id);assert((await page.locator('[data-recovery-task-context]').innerText()).includes(journey.project.summary));assert((await page.locator('[data-recovery-provenance]').innerText()).includes('Authored offline reference'));
      await page.locator('.source-history > summary').press('Enter');assert.match(await page.locator('.source-history').innerText(),/attempt that failed its checks/);
      await frame.waitForFunction(()=>document.querySelector('#delayed-finish')?.textContent.trim()==='Day 9');let observed=await readOutputs(frame);assert.equal(observed['baseline-finish'],'Day 7');assert.equal(observed['selected-finish'],'Day 9');
      await frame.locator('#choice').selectOption('expedite');await finishEquals(frame,7);observed=await readOutputs(frame);assert.match(observed['target-status'],/target|meets/i);
      // Native Tab crosses into the actual opaque iframe and reaches its inputs.
      await page.getByRole('link',{name:'Review this task',exact:true}).focus();let reached=false;for(let n=0;n<90;n++){await page.keyboard.press('Tab');if(await frame.locator('#delay-days').evaluate(el=>el===document.activeElement)){reached=true;break;}}assert(reached,'native Tab reaches the real simulator controls');
      await frame.locator('#delay-days').fill('-1');await frame.waitForFunction(()=>document.querySelector('#error')?.textContent.trim().length>0);assert.notEqual((await readOutputs(frame))['selected-finish'],'Day 7','invalid edits clear the old selected finish');
      await revealNativeControl(frame.locator('#reset'));await frame.locator('#reset').press('Enter');await finishEquals(frame,7);assert.equal(await frame.locator('#delay-days').inputValue(),'0','Reset returns to the original plan without a delay');await frame.locator('#delay-days').fill('2');await finishEquals(frame,9);await frame.locator('#choice').selectOption('expedite');await finishEquals(frame,7);
      assert.equal((await state(page)).packs.find(p=>p.id===journey.first.id).completionEvidence,undefined,'trying the simulator records no automatic evidence');assert.equal((await state(page)).packs.some(p=>p.executionRun),false,'offline reference never becomes a provider run');
      await page.screenshot({path:path.join(output,`simulator-${palette}-${width}.png`)});
      result.phase='evidence';await returnReview(page,journey.first.id);const note7='Offline reference reviewed: delivery delay 2; expedited delivery finishes day 7 against target day 7. Supplier feasibility remains unconfirmed. No new model or Sandbox run.';await saveEvidence(page,note7);assert.equal((await state(page)).packs.find(p=>p.id===journey.first.id).status,'active','saving evidence is separate from completion');
      // Mounted tabs may switch without discarding drafts. Leaving the task
      // still requires resolving the unsaved evidence through the existing guard.
      const unsaved=note7+' Unsaved review note.';await page.locator('#nebius-review-evidence').fill(unsaved);await page.getByRole('tab',{name:'Tool',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'Tool',exact:true}).getAttribute('aria-selected'),'true');
      await page.waitForFunction(()=>document.querySelector('[data-task-run-offline-example] a')?.getAttribute('aria-disabled')==='true');await page.getByRole('link',{name:'Try offline Recovery Simulator',exact:true}).press('Enter');assert.equal(new URL(page.url()).pathname,'/next','disabled reference action cannot abandon unsaved evidence');
      await page.getByRole('link',{name:/View in Work/}).click();await page.waitForFunction(()=>document.activeElement?.matches('#nebius-evidence-recording > summary'));assert.equal(new URL(page.url()).pathname,'/next');assert.equal(await page.locator('#nebius-review-evidence').inputValue(),unsaved);await page.locator('#nebius-review-evidence').fill(note7);
      result.phase='changed-request';await reviseCriteria(page,criteria6);let saved=(await state(page)).packs.find(p=>p.id===journey.first.id);assert.equal(saved.status,'active');assert.equal(saved.completionEvidence,note7,'older human observations remain visible history');
      frame=await enterExample(page,journey.first.id);await page.locator('[data-recovery-task-context] details > summary').press('Enter');assert((await page.locator('[data-recovery-task-context]').innerText()).includes('day 6'));
      await frame.locator('#target-day').fill('6');await frame.locator('#choice').selectOption('expedite');await finishEquals(frame,7);assert.match((await readOutputs(frame))['target-status'],/miss|late|1 day/i);
      await frame.locator('#choice').selectOption('both');await finishEquals(frame,6);const changed=await readOutputs(frame);assert.equal(changed['baseline-finish'],'Day 7');assert.equal(changed['delayed-finish'],'Day 9');
      result.phase='decision';await returnReview(page,journey.first.id);assert.equal(await page.locator('#nebius-review-evidence').inputValue(),note7);const note6='Offline reference reviewed for revised target day 6: expedite delivery plus assembly help finishes day 6; no action finishes day 9. These are calculated assumptions, with supplier and staffing feasibility still unconfirmed. No new model or Sandbox run.';await saveEvidence(page,note6);
      const done=page.getByRole('button',{name:'Mark done with recorded evidence',exact:true});await tabTo(page,done);await page.keyboard.press('Enter');await page.waitForURL(u=>u.pathname==='/work');await page.locator('[data-project-progress-summary]').waitFor();assert.match(await page.locator('[data-project-progress-summary]').innerText(),/1\s*\/\s*2/);
      saved=await state(page);assert.equal(saved.packs.find(p=>p.id===journey.second.id).status,'active','completion uses the existing dependency release');
      await page.goto(origin+`/next?pack=${encodeURIComponent(journey.second.id)}&view=review`);await page.locator('#nebius-review-evidence').waitFor();await saveEvidence(page,'Authored rehearsal decision: investigate expedited delivery plus assembly help. Confirm supplier availability and staffing before any real schedule change.');await page.getByRole('button',{name:'Mark done with recorded evidence',exact:true}).press('Enter');await page.waitForURL(u=>u.pathname==='/work');await page.locator('[data-project-progress-summary]').waitFor();assert.match(await page.locator('[data-project-progress-summary]').innerText(),/2\s*\/\s*2/);
      saved=await state(page);assert.deepEqual(saved.packs.find(p=>p.id===existing.id),preserved);assert.equal(saved.packs.some(p=>p.executionRun),false);assert.equal(saved.packs.filter(p=>p.projectId===journey.project.id).every(p=>p.status==='done'),true);
      // Completed tasks retain contextual inspection, without a promise to edit evidence.
      await page.goto(origin+`/recovery-rehearsal?pack=${encodeURIComponent(journey.first.id)}`);await page.locator('[data-recovery-task-context]').waitFor();assert.equal(await page.getByRole('link',{name:'Back to Task',exact:true}).getAttribute('href'),`/next?pack=${encodeURIComponent(journey.first.id)}&view=tool`);
      await page.goto(origin+'/recovery-rehearsal?pack=missing&pack=other');await page.getByText('Task context is unavailable.',{exact:false}).waitFor();assert.equal(await page.locator('[data-recovery-task-context]').count(),0,'invalid duplicate context never picks another saved task');
      await page.goto(origin+'/recovery-rehearsal');await page.getByRole('link',{name:'Back to Work',exact:true}).waitFor();assert.equal(await page.locator('[data-recovery-task-context]').count(),0,'standalone links stay usable');
      await page.goto(origin+`/recovery-rehearsal?pack=${existing.id}`);await page.locator('[data-recovery-task-context]').waitFor();const linkBounds=await page.locator('.project-link').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const b=el.getBoundingClientRect(),text=range.getBoundingClientRect(),context=el.closest('[data-recovery-task-context]').getBoundingClientRect();return{left:b.left,right:b.right,contextRight:context.right,textRight:text.right,viewport:innerWidth};});assert(linkBounds.left>=16&&linkBounds.right<=linkBounds.viewport-12&&linkBounds.textRight<=linkBounds.right+1,'valid long project names wrap within real visible bounds');assert(linkBounds.right<=linkBounds.contextRight+1);result.longTitleBounds=linkBounds;
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);result.phase='complete';result.passed=true;result.projectId=journey.project.id;result.observedInitial=observed;result.observedRevised=changed;result.savedWorkPreserved=true;
    }catch(error){result.error=error.stack;result.failureUI=await page.evaluate(()=>({url:location.href,focusedId:document.activeElement?.id,focusedTag:document.activeElement?.tagName,selectedTabs:Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).map(e=>e.textContent.trim()),visibleAlerts:Array.from(document.querySelectorAll('[role="alert"]')).map(e=>e.textContent.trim())})).catch(()=>null);await page.screenshot({path:path.join(output,`failure-${palette}-${width}.png`),fullPage:true}).catch(()=>{});throw error;}
    finally{await context.close();}
  }
  assert.deepEqual(report.external,[]);assert.deepEqual(report.writes,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'flow-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,completed:report.cases.filter(c=>c.passed).length,external:report.external.length,writes:report.writes.length,errors:report.errors}));}
