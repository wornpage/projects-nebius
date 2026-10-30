import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

const root=path.resolve('dist/static-publish');
const output=path.resolve(process.env.NEBIUS_SHELL_EVIDENCE_DIR || 'dist/nebius-shell-evidence');
const workspaceKey='projects-webmcp-challenge-state-v1',themeKey='wornpage-nebius-theme-v1';
const sample=JSON.parse(await readFile(path.join(root,'data/demo-packs.json'),'utf8'));
const projectA={id:'project-navigation-alpha',title:'Prepare the release review',summary:'Keep tasks together.',brief:'Review the project tasks in their existing order.',source:'manual',createdAt:'2026-10-24T00:00:00.000Z'};
const projectB={...projectA,id:'project-navigation-beta',title:'Other project'};
const taskOrder=['nebius-onboarding-copy','nebius-release-health','nebius-keyboard-review'];
const fixture={packs:[...taskOrder.map(id=>({...sample.find(p=>p.id===id),projectId:projectA.id})),{...sample.find(p=>!taskOrder.includes(p.id)),projectId:projectB.id}],projects:[projectA,projectB],selectedId:taskOrder[0],selectedProjectId:projectA.id,pendingNextActionDrafts:[]};
const report={kind:'private offline shell interaction',paidCalls:0,providerCalls:0,cases:[],external:[],writes:[],errors:[],passed:false};
await mkdir(output,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'){report.writes.push(url.pathname);res.writeHead(405);res.end();return;}
  if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({available:false,code:url.pathname.includes('/runs/')?'execution_disabled':'nebius_disabled'}));return;}
  let relative;try{relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';}catch{res.writeHead(400);res.end();return;}
  const file=path.resolve(root,path.extname(relative)?relative:relative+'.html');
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
async function tabTo(page,locator){for(let i=0;i<80;i++){if(await locator.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Tab did not reach '+await locator.textContent());}
async function settle(page){await page.evaluate(async()=>{const animations=document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity);await Promise.all(animations.map(a=>a.finished.catch(()=>{})));});}
async function openAppearance(page){const trigger=page.locator('[data-appearance-trigger]');await tabTo(page,trigger);await page.keyboard.press('Enter');await page.locator('[data-appearance-popover]').waitFor({state:'visible'});await settle(page);return trigger;}
async function openNavigate(page){const trigger=page.viewportSize().width<=700?page.getByRole('button',{name:'Navigate',exact:true}):new URL(page.url()).pathname==='/work'?page.getByRole('button',{name:'Command palette',exact:true}):page.getByRole('button',{name:'Commands',exact:true});await tabTo(page,trigger);await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Commands',exact:true});await dialog.waitFor();return dialog;}
async function contained(locator,page){const bounds=await locator.boundingBox(),size=page.viewportSize();assert(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=size.width+1&&bounds.y+bounds.height<=size.height+1,'surface fits viewport');}
async function state(page){return page.evaluate(key=>localStorage.getItem(key),workspaceKey);}
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH});
  for(const width of [375,1280])for(const theme of ['neutral-light','neutral-dark','original-light','original-dark']){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
    await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==origin){report.external.push(route.request().url());return route.abort();}return route.continue();});
    await context.addInitScript(({key,theme,workspaceKey,fixture})=>{localStorage.setItem(key,theme);if(!localStorage.getItem(workspaceKey))localStorage.setItem(workspaceKey,JSON.stringify(fixture));},{key:themeKey,theme,workspaceKey,fixture});
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
    try{
      await page.goto(origin+'/work');await page.locator('[data-nebius-work-entry]').waitFor();
      const before=await state(page),trigger=await openAppearance(page),panel=page.locator('[data-appearance-popover]');
      assert.equal(await page.locator(`input[name="appearance-palette"][value="${theme.split('-')[0]}"]`).isChecked(),true);
      assert.equal(await page.locator(`input[name="appearance-mode"][value="${theme.split('-')[1]}"]`).isChecked(),true);
      await contained(panel,page);assert.equal(await page.getByRole('group',{name:'Palette',exact:true}).count(),1);assert.equal(await page.getByRole('group',{name:'Mode',exact:true}).count(),1);
      await page.screenshot({path:path.join(output,`appearance-${theme}-${width}.png`)});
      await tabTo(page,page.locator(`input[name="appearance-palette"]:checked`));await page.keyboard.press('ArrowRight');
      const switched=theme.startsWith('neutral')?'original':'neutral';
      assert.equal(await page.locator('html').getAttribute('data-theme-choice'),`${switched}-${theme.split('-')[1]}`);
      assert.equal(await panel.isVisible(),true,'theme change keeps settings open');
      await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Escape restores Appearance');
      await trigger.press('Enter');await panel.waitFor();await page.locator('[data-appearance-close]').click();assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
      await trigger.press('Enter');await panel.waitFor();await page.keyboard.press('?');
      await page.getByRole('dialog',{name:'Keyboard shortcuts',exact:true}).waitFor();
      assert.equal(await panel.isVisible(),false,'Appearance yields to the existing keyboard-help dialog');await page.keyboard.press('Escape');
      await trigger.press('Enter');await panel.waitFor();await page.mouse.click(2,899);await panel.waitFor({state:'hidden'});
      await trigger.press('Enter');await panel.waitFor();await tabTo(page,page.locator('input[name="appearance-mode"]:checked'));await page.keyboard.press('Tab');
      assert.equal(await panel.evaluate(el=>el.contains(document.activeElement)),false,'nonmodal Appearance allows Tab to leave');await page.keyboard.press('Escape');
      // Cross-tab updates use the unchanged authoritative theme key and event.
      const peer=await context.newPage();await peer.goto(origin+'/work');await peer.locator('[data-appearance-trigger]').click();
      await peer.locator(`input[name="appearance-palette"][value="${theme.split('-')[0]}"]`).check();await peer.locator('input[name="appearance-mode"][value="system"]').check();
      await page.waitForFunction(expected=>document.documentElement.dataset.themeChoice===expected,`${theme.split('-')[0]}-system`);
      await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
      await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
      await peer.close();
      assert.equal(await state(page),before,'appearance preserves saved work exactly');
      await trigger.click();await panel.waitFor();
      await page.locator(`input[name="appearance-palette"][value="${theme.split('-')[0]}"]`).check();
      await page.locator(`input[name="appearance-mode"][value="${theme.split('-')[1]}"]`).check();
      await page.keyboard.press('Escape');await settle(page);
      assert.equal(await page.locator('html').getAttribute('data-theme-choice'),theme,'Navigate is inspected in the named palette');
      let dialog=await openNavigate(page);await contained(dialog,page);
      const dialogId=await dialog.getAttribute('id');
      assert.deepEqual(await dialog.locator('[data-command-key^="task:"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.commandKey.slice(5))),taskOrder,'menu retains established project task order');
      await dialog.getByRole('group',{name:projectA.title,exact:true}).waitFor();
      assert.equal(await dialog.locator(`[data-command-key="task:${taskOrder[0]}"]`).getAttribute('aria-current'),'true');
      assert((await dialog.locator(`[data-command-key="task:${taskOrder[0]}"]`).innerText()).includes('Current task'));
      assert.equal(await dialog.locator('[data-command-key^="view:"]').count(),0,'Work keeps its task list without duplicate task-view choices');
      assert.equal(await page.locator('[data-nebius-command-search]').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Tab');
      assert.equal(await dialog.getByRole('button',{name:'Close commands',exact:true}).evaluate(el=>el===document.activeElement),true,'Tab skips combobox results');
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('[data-nebius-command-search]').evaluate(el=>el===document.activeElement),true,'Tab returns to the search field');
      await page.screenshot({path:path.join(output,`commands-${theme}-${width}.png`)});
      for(let i=0;i<10;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,'modal focus stays within shared Commands');}
      const bounds=await dialog.boundingBox();await page.mouse.move(bounds.x+20,bounds.y+10);await page.mouse.down();await page.mouse.move(2,2);await page.mouse.up();assert.equal(await dialog.isVisible(),true);await page.mouse.click(2,2);await dialog.waitFor({state:'hidden'});
      dialog=await openNavigate(page);
      const search=dialog.getByRole('combobox',{name:'Find tasks or commands',exact:true});
      await search.fill('keyboard access');assert.equal(await dialog.locator('[data-command-key^="task:"]').count(),1);await search.press('Enter');
      await page.waitForURL(url=>url.searchParams.get('pack')==='nebius-keyboard-review');await page.waitForFunction(()=>document.activeElement?.id==='challenge-main');
      dialog=await openNavigate(page);assert.equal(await dialog.getAttribute('id'),dialogId);assert.equal(await dialog.locator('[data-command-key^="command:"]').count(),0,'Work-only commands are removed on Task');
      await dialog.locator('[data-command-key="all-work"]').press('Enter');await page.waitForURL(url=>url.pathname==='/work'&&!url.searchParams.has('scope'));await page.waitForFunction(()=>document.querySelector('#project-scope')?.value==='');
      const allState=JSON.parse(await state(page)),initialState=JSON.parse(before);assert.deepEqual((allState.state||allState).packs,(initialState.state||initialState).packs);assert.equal((allState.state||allState).selectedProjectId,null,'All work clears only project scope');
      await page.getByRole('button',{name:'Command palette',exact:true}).click();dialog=page.getByRole('dialog',{name:'Commands',exact:true});await dialog.waitFor();assert.equal(await dialog.getAttribute('id'),dialogId,'Commands and Navigate share one instance');
      assert.equal(await page.getByRole('dialog').count(),1);await dialog.locator('[data-command-key="command:search"]').click();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Filter work items by text');
      await page.getByRole('button',{name:'Command palette',exact:true}).click();await dialog.locator('[data-command-key="command:add-work"]').click();await page.waitForFunction(()=>document.activeElement?.id==='work-quick-title');await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.goto(origin+'/next?pack=nebius-onboarding-copy&view=brief');await page.locator('#nebius-work-item').waitFor();await page.getByRole('tab',{name:'Review',exact:true}).click();
      dialog=await openNavigate(page);assert.equal(await dialog.locator('[data-command-key="view:Review"]').getAttribute('aria-current'),'true','current view follows the visible Task tab');
      await dialog.locator('[data-command-key="view:Review"]').press('Enter');await page.waitForURL(url=>url.searchParams.get('view')==='review');
      const evidence=page.locator('#nebius-review-evidence');await evidence.fill('Unsaved keyboard review evidence.');const dirtyScope=(JSON.parse(await state(page)).state||JSON.parse(await state(page))).selectedProjectId;
      dialog=await openNavigate(page);await page.goBack().catch(()=>{});await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>{const region=document.querySelector('#nebius-evidence-recording');return region===document.activeElement||region?.contains(document.activeElement);});assert.equal(new URL(page.url()).searchParams.get('view'),'review');
      dialog=await openNavigate(page);await dialog.locator('[data-command-key="view:Review"]').press('Enter');await dialog.waitFor({state:'hidden'});await settle(page);await page.waitForFunction(()=>{const region=document.querySelector('#nebius-evidence-recording');return region===document.activeElement||region?.contains(document.activeElement);});
      dialog=await openNavigate(page);await dialog.locator('[data-command-key="all-work"]').press('Enter');await dialog.waitFor({state:'hidden'});await page.getByText('Apply or discard your unsaved changes before leaving this page.',{exact:true}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('pack'),'nebius-onboarding-copy');assert.equal(await evidence.inputValue(),'Unsaved keyboard review evidence.');assert.equal((JSON.parse(await state(page)).state||JSON.parse(await state(page))).selectedProjectId,dirtyScope);
      assert.equal(await page.locator('#nebius-evidence-recording').evaluate(el=>el===document.activeElement||el.contains(document.activeElement)),true);
      dialog=await openNavigate(page);await dialog.locator('[data-command-key="task:nebius-release-health"]').press('Enter');await dialog.waitFor({state:'hidden'});assert.equal(new URL(page.url()).searchParams.get('pack'),'nebius-onboarding-copy');assert.equal(await evidence.inputValue(),'Unsaved keyboard review evidence.');
      dialog=await openNavigate(page);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:width<=700?'Navigate':'Commands',exact:true}).evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      report.cases.push({width,theme,passed:true,keyboard:true,workspacePreserved:true});
    }finally{await context.close();}
  }
  assert.deepEqual(report.external,[]);assert.deepEqual(report.writes,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error={message:error.message,stack:error.stack};throw error;}
finally{await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve));console.log(JSON.stringify(report));}
