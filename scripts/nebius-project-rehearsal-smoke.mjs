import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

const root=path.resolve('dist/static-publish');
const output=path.resolve(process.env.NEBIUS_REHEARSAL_EVIDENCE_DIR || 'dist/nebius-rehearsal-evidence');
const key='projects-webmcp-challenge-state-v1';
const project={id:'rehearsal-browser-project',title:'Release review',summary:'Prepare a review packet and a clear handoff.',brief:'Authored browser fixture only.',createdAt:'2026-10-24T00:00:00.000Z',source:'manual'};
const other={...project,id:'rehearsal-other-project',title:'Other project'};
const task=(id,title,status,extra={})=>({id,projectId:project.id,title,status,type:'task',blocker:'None',next:'Review',nextStep:'Check supplied work.',purpose:'PRIVATE_PURPOSE_SENTINEL',doneWhen:'Supplied work is reviewed.',...extra});
const fixture={projects:[project,other],selectedProjectId:project.id,selectedId:'handoff',pendingNextActionDrafts:[],packs:[task('handoff','Prepare handoff','blocked',{blockedBy:'checker',blocker:'Owner review is still needed.'}),task('checker','Review packet','done',{completionEvidence:'PRIVATE_EVIDENCE_SENTINEL'}),task('archive','Review packet','active',{archived:true}),task('other-task','Other task','active',{projectId:other.id})]};
const report={private:true,paidCalls:0,providerCalls:0,sandboxRuns:0,cases:[],external:[],writes:[],errors:[],passed:false};
await mkdir(output,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(!['GET','HEAD'].includes(req.method)){report.writes.push(url.pathname);res.writeHead(405);res.end();return;}
  if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json'});res.end('{"available":false,"code":"nebius_disabled"}');return;}
  let relative;try{relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';}catch{res.writeHead(400);res.end();return;}
  const file=path.resolve(root,path.extname(relative)?relative:relative+'.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
async function tabTo(page,target){for(let i=0;i<180;i++){if(await target.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Tab failed to reach target');}
async function storage(page){return page.evaluate(k=>localStorage.getItem(k),key);}
async function ids(section){return section.locator('[data-rehearsal-task]').evaluateAll(nodes=>nodes.map(node=>node.dataset.rehearsalTask));}
async function waitNoPreview(rehearsal){await rehearsal.locator('[data-rehearsal-preview] [data-rehearsal-task]').first().waitFor({state:'hidden'});}
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH});
  for(const width of [375,1280])for(const palette of ['neutral-light','neutral-dark','original-light','original-dark']){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){report.external.push(route.request().url());return route.abort();}return route.continue();});
    await context.addInitScript(({key,fixture,palette})=>{localStorage.setItem('wornpage-nebius-theme-v1',palette);if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(fixture));},{key,fixture,palette});
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message));
    try{
      await page.goto(origin+'/work');await page.locator('[data-nebius-work-entry]').waitFor();
      const rehearsal=page.locator('[data-project-rehearsal]'),summary=rehearsal.locator(':scope > summary');
      assert.equal(await rehearsal.getAttribute('open'),null,'rehearsal is optional and collapsed');
      assert.equal(await rehearsal.locator('[data-rehearsal-current]').count(),0,'closed prototype does not duplicate task content');
      const before=await storage(page);
      await tabTo(page,summary);await page.keyboard.press('Enter');
      const current=rehearsal.locator('[data-rehearsal-current]'),preview=rehearsal.locator('[data-rehearsal-preview]');
      await current.waitFor();
      const currentIds=await ids(current);assert.equal(currentIds.length,3,'full project includes archived task');assert(!currentIds.includes('other-task'));
      assert.match(await current.locator('[data-rehearsal-count]').innerText(),/1\s*\/\s*3/);
      assert(!/PRIVATE_(PURPOSE|EVIDENCE)_SENTINEL/.test(await rehearsal.innerText()),'private fields are not in the projection');
      const title=rehearsal.getByLabel('New requirement',{exact:true}),target=rehearsal.getByLabel('Task that will wait',{exact:true});
      assert.equal(await target.inputValue(),'','real task choice is explicit');
      const choices=await target.locator('option').evaluateAll(options=>options.map(o=>({value:o.value,disabled:o.disabled})));
      assert(!choices.some(o=>['checker','archive'].includes(o.value)&&!o.disabled),'done and archived tasks cannot be proposed successors');
      await target.selectOption('handoff');
      const build=rehearsal.getByRole('button',{name:'Preview change',exact:true});await tabTo(page,build);await page.keyboard.press('Enter');
      await preview.locator('[data-rehearsal-task]').first().waitFor();
      const previewIds=await ids(preview);assert.equal(previewIds.length,4);assert.deepEqual(previewIds.filter(id=>currentIds.includes(id)),currentIds,'existing order survives');
      assert.match(await preview.locator('[data-rehearsal-count]').innerText(),/1\s*\/\s*4/);
      assert.match(await preview.locator('[data-rehearsal-task="handoff"]').innerText(),/Changed/i);
      assert.match(await preview.locator('[data-rehearsal-task="handoff"]').innerText(),/blocked/i);
      const addedId=previewIds.find(id=>!currentIds.includes(id));
      assert.equal(previewIds.indexOf(addedId)+1,previewIds.indexOf('handoff'));
      assert.equal(await preview.locator(`[data-rehearsal-task="${addedId}"] a`).count(),0,'temporary task has no fake saved route');
      assert.deepEqual(await ids(current),currentIds,'Current remains unchanged');
      assert.equal(await storage(page),before,'preview does not persist');
      const row=current.locator('[data-rehearsal-task="handoff"]'),detail=row.locator('summary').first();
      await tabTo(page,detail);await page.keyboard.press('Enter');
      assert((await row.innerText()).includes(`Task ${currentIds.indexOf('checker')+1}: Review packet`),'duplicate-title predecessors are identified by their list ordinal');
      assert((await preview.innerText()).includes(`Task ${previewIds.indexOf('checker')+1}: Review packet`),'inherited dependency uses the Preview ordinal');
      const link=row.getByRole('link',{name:/Open saved task/i});await link.waitFor();await tabTo(page,link);
      assert.equal(await link.getAttribute('href'),'/next?pack=handoff&view=brief');
      const focus=await link.evaluate(el=>({style:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth)}));assert(focus.style!=='none'&&focus.width>0,'native list focus is visible');
      await page.keyboard.press('Shift+Tab');await page.keyboard.press('Enter');
      for(const control of [summary,title,target,build]){const box=await control.boundingBox();assert(box&&box.height>=44,'controls retain44px targets');}
      const a=await current.boundingBox(),b=await preview.boundingBox();assert(a&&b);
      if(width===375)assert(b.y>=a.y+a.height-1,'narrow comparison stacks');else assert(b.x>=a.x+a.width-1,'desktop comparison is side by side');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page overflow');
      assert.equal(await rehearsal.locator('svg').evaluateAll(nodes=>nodes.every(node=>node.closest('[aria-hidden="true"]'))),true,'lists carry the diagram information; sketches are excluded from the accessibility tree');
      await rehearsal.screenshot({path:path.join(output,`comparison-${palette}-${width}.png`)});
      await title.fill('Also include a CSV export');await waitNoPreview(rehearsal);assert.equal(await storage(page),before);
      await build.click();await preview.locator('[data-rehearsal-task]').first().waitFor();
      const reset=rehearsal.getByRole('button',{name:'Reset preview',exact:true});await tabTo(page,reset);await page.keyboard.press('Enter');await waitNoPreview(rehearsal);assert.equal(await storage(page),before);
      assert.equal(await title.evaluate(el=>el===document.activeElement),true,'Enter reset returns keyboard focus to the requirement field');
      await build.click();await preview.locator('[data-rehearsal-task]').first().waitFor();await tabTo(page,reset);await page.keyboard.press('Space');await waitNoPreview(rehearsal);
      assert.equal(await title.evaluate(el=>el===document.activeElement),true,'Space reset returns keyboard focus to the requirement field');
      assert.equal(await storage(page),before);
      await title.fill('<img src=x onerror=alert(1)>');await target.selectOption('handoff');await build.click();await preview.locator('[data-rehearsal-task]').first().waitFor();
      assert.equal(await preview.locator('img').count(),0,'requirement renders as escaped text');assert((await preview.innerText()).includes('<img src=x onerror=alert(1)>'));
      await title.fill('');await waitNoPreview(rehearsal);assert.equal(await build.isDisabled(),true,'blank title cannot create a preview');
      await title.fill('Add CSV export');await build.click();await preview.locator('[data-rehearsal-task]').first().waitFor();
      await page.locator('#project-scope').selectOption(other.id);await waitNoPreview(rehearsal);
      await page.waitForFunction(()=>document.querySelector('[data-rehearsal-current]')?.textContent.includes('Other task'));
      const scoped=await storage(page);await rehearsal.locator('[data-rehearsal-source]').selectOption('example');
      await page.waitForFunction(()=>document.querySelector('[data-rehearsal-current]')?.textContent.includes('Define packet'));
      assert.match(await rehearsal.innerText(),/Authored offline example/i);await build.click();await preview.locator('[data-rehearsal-task]').first().waitFor();
      assert.match(await current.locator('[data-rehearsal-count]').innerText(),/2\s*\/\s*3/);assert.match(await preview.locator('[data-rehearsal-count]').innerText(),/2\s*\/\s*4/);
      assert.equal(await current.getByRole('link').count(),0,'authored tasks do not link to nonexistent saved tasks');
      assert.equal(await storage(page),scoped,'example does not replace saved project');
      await summary.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
      assert.equal(await summary.evaluate(el=>el===document.activeElement),true,'disclosure focus survives closing and reopening');
      await page.reload();await summary.waitFor();assert.equal(await rehearsal.getAttribute('open'),null,'preview is not restored from persistence');
      assert.equal(await storage(page),scoped);
      report.cases.push({width,palette,currentTasks:3,previewTasks:4,archivedIncluded:true,keyboard:true,escaped:true,noOverflow:true,reset:true,sourceInvalidation:true,storagePreserved:true,passed:true});
    }finally{await context.close();}
  }
  assert.deepEqual(report.writes,[]);assert.deepEqual(report.external,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,writes:report.writes.length,external:report.external.length,errors:report.errors}));}
