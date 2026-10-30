import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

const root=await realpath(path.resolve('dist/static-publish'));
const output=path.resolve(process.env.NEBIUS_PROJECT_EVIDENCE_DIR || 'dist/nebius-project-evidence');
const key='projects-webmcp-challenge-state-v1';
const project={id:'reference-project',title:'Recover the handoff',summary:'Record the option and remaining assumptions.',brief:'Authored offline test fixture.',source:'manual',createdAt:'2026-10-24T00:00:00.000Z'};
const task=(id,title,status,extra={})=>({id,projectId:project.id,title,status,type:'task',next:'Review',nextStep:'Review saved observations.',blocker:'None',purpose:'Keep the decision and its assumptions together.',doneWhen:'Record the option to investigate.',...extra});
const compare=task('comparison-done','Compare recovery options','done',{completionEvidence:'Day 7: expedited delivery meets the earlier target.\n\nDay 6: expedite plus assembly help meets the revised target. Supplier and staffing availability remain unconfirmed.'});
const archived=task('archived-done','W'.repeat(120),'done',{archived:true,completionEvidence:'Authored <img src=x onerror=alert(1)> note.\nSecond line stays text.'});
const current=task('record-decision','Record the recovery decision','active',{completionEvidence:'Own saved evidence.'});
const outside=task('outside-project','Compare recovery options','done',{projectId:'other-project',completionEvidence:'OUTSIDE_SCOPE_SENTINEL'});
const unfinished=task('unfinished','Unfinished work','active',{completionEvidence:'UNFINISHED_SENTINEL'});
const empty=task('empty','No observations','done',{completionEvidence:'   '});
const fixture={packs:[archived,current,outside,unfinished,compare,empty],projects:[project,{...project,id:'other-project',title:'Other project'}],selectedProjectId:project.id,selectedId:current.id,pendingNextActionDrafts:[]};
const report={private:true,paidCalls:0,providerCalls:0,sandboxRuns:0,cases:[],external:[],writes:[],errors:[],passed:false};
await mkdir(output,{recursive:true});
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(!['GET','HEAD'].includes(req.method)){report.writes.push(url.pathname);res.writeHead(405);res.end();return;}
  if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({available:false,code:url.pathname.startsWith('/api/nebius/runs')?'execution_disabled':'nebius_disabled'}));return;}
  let relative;try{relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';}catch{res.writeHead(400);res.end();return;}
  const target=path.resolve(root,path.extname(relative)?relative:relative+'.html');if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const file=await realpath(target);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
async function stored(page){return page.evaluate(k=>{const raw=JSON.parse(localStorage.getItem(k));return raw?.state||raw;},key);}
async function tabTo(page,target){for(let n=0;n<200;n++){if(await target.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Native Tab did not reach reference control');}
async function openReference(page,panel){const reference=panel.locator('[data-project-evidence]'),summary=reference.locator(':scope > summary');await summary.waitFor();await tabTo(page,summary);await page.keyboard.press('Enter');await reference.locator('[data-project-evidence-task]').first().waitFor();return reference;}
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH});
  for(const width of [375,1280])for(const palette of ['neutral-dark','neutral-light','original-dark','original-light']){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){report.external.push(url.href);return route.abort();}if(url.pathname==='/sw.js')return route.abort();return route.continue();});
    await context.addInitScript(({key,fixture,palette})=>{if(window.top!==window)return;if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(fixture));localStorage.setItem('wornpage-nebius-theme-v1',palette);},{key,fixture,palette});
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));
    try{
      await page.goto(origin+`/next?pack=${current.id}&view=brief`);await page.locator('#nebius-work-item').waitFor();const before=await stored(page),brief=page.locator('#task-panel-brief'),ref=brief.locator('[data-project-evidence]');
      assert.equal(await ref.getAttribute('open'),null);assert.equal(await ref.locator('[data-project-evidence-task]').count(),0,'reference content is lazy');
      let visible=await openReference(page,brief);assert.deepEqual(await visible.locator('[data-project-evidence-task]').evaluateAll(nodes=>nodes.map(n=>n.dataset.projectEvidenceTask)),[archived.id,compare.id],'scope/order comes from existing project data');
      const rendered=await visible.innerText();assert(!rendered.includes('OUTSIDE_SCOPE_SENTINEL'));assert(!rendered.includes('UNFINISHED_SENTINEL'));assert(!rendered.includes('Own saved evidence.'));assert(rendered.includes('Archived'));
      assert.equal(await visible.locator('img,script').count(),0,'HTML-like note is escaped');assert.equal(await visible.locator(`[data-project-evidence-task="${compare.id}"] .saved-evidence`).textContent(),compare.completionEvidence);
      assert.equal(await visible.locator('.saved-evidence').first().evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');
      const bounds=await visible.locator('h3').first().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const b=el.getBoundingClientRect(),t=r.getBoundingClientRect();return{right:b.right,textRight:t.right,viewport:innerWidth};});assert(bounds.right<=width&&bounds.textRight<=bounds.right+1,'long names stay visible');
      assert.deepEqual((await stored(page)).packs,before.packs,'reading a reference does not change saved work');await visible.screenshot({path:path.join(output,`brief-reference-${palette}-${width}.png`)});
      await page.getByRole('tab',{name:'Review',exact:true}).click();const review=page.locator('#task-panel-review'),own=page.locator('#nebius-review-evidence');await own.waitFor();assert.equal(await own.inputValue(),current.completionEvidence);
      const draft='Own unsaved observation.\n\nSupplier availability is still unconfirmed.';await own.fill(draft);visible=await openReference(page,review);assert.equal(await own.inputValue(),draft,'opening the reference keeps the current draft');assert.equal((await stored(page)).packs.find(p=>p.id===current.id).completionEvidence,current.completionEvidence,'reference is not automatically saved as evidence');
      const item=visible.locator(`[data-project-evidence-task="${compare.id}"]`),link=item.getByRole('link');assert.equal(await link.getAttribute('href'),`/next?pack=${compare.id}&view=review`);assert.equal(await link.getAttribute('target'),'_blank');assert((await link.getAttribute('rel')).includes('noopener'));assert((await link.innerText()).includes('new tab'));
      await tabTo(page,link);const focus=await link.evaluate(el=>({outline:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth),height:el.getBoundingClientRect().height}));assert(focus.outline!=='none'&&focus.width>=2&&focus.height>=44);
      const popupPromise=context.waitForEvent('page');await page.keyboard.press('Enter');const popup=await popupPromise;popup.setDefaultTimeout(12000);await popup.locator('#nebius-review-evidence').waitFor();assert.equal(await popup.locator('#nebius-review-evidence').inputValue(),compare.completionEvidence);assert.equal(await popup.locator('#nebius-review-evidence').evaluate(el=>el.readOnly),true);assert.equal(await popup.evaluate(()=>window.opener===null),true);await popup.close();await page.bringToFront();
      assert.equal(await own.inputValue(),draft,'history in a new tab cannot discard the current draft');assert.equal(new URL(page.url()).searchParams.get('pack'),current.id);assert.deepEqual((await stored(page)).packs,before.packs);
      await visible.screenshot({path:path.join(output,`review-reference-${palette}-${width}.png`)});await own.fill(current.completionEvidence);
      await page.goto(origin+`/next?pack=${outside.id}&view=brief`);await page.locator('#nebius-work-item').waitFor();assert.equal(await page.locator('[data-project-evidence]').count(),0,'no same-project references means no reference control');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.cases.push({width,palette,scoped:true,ordered:true,lazy:true,escaped:true,sourceReadonly:true,draftPreserved:true,noAutomaticEvidence:true,newTabSafe:true,focus,passed:true});
    }finally{await context.close();}
  }
  assert.deepEqual(report.external,[]);assert.deepEqual(report.writes,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'reference-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,external:report.external.length,writes:report.writes.length,errors:report.errors}));}
