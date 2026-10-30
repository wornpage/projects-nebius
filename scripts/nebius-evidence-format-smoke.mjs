// Browser-local evidence formatting/history regression. No provider or Sandbox.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

const root=await realpath(path.resolve('dist/static-publish'));
const output=path.resolve(process.env.NEBIUS_EVIDENCE_FORMAT_DIR || 'dist/nebius-evidence-format');
const key='projects-webmcp-challenge-state-v1';
const project={id:'format-project',title:'Evidence formatting check',summary:'Private authored browser fixture.',brief:'Check local evidence only.',source:'manual',createdAt:'2026-10-24T00:00:00.000Z'};
const task=(id,extra={})=>({id,projectId:project.id,title:`Evidence ${id}`,status:'active',type:'task',blocker:'None',next:'Review',nextStep:'Read the supplied notes.',purpose:'Preserve human observations.',doneWhen:'A person records observations and makes a separate completion decision.',...extra});
const flat='Preexisting flattened note. Keep its original spacing and content.';
const archived='Archived observation\nSecond line\n\nRemaining question.';
const fixture={projects:[project],selectedProjectId:project.id,selectedId:'editable',pendingNextActionDrafts:[],packs:[task('editable'),task('flat',{status:'done',completionEvidence:flat}),task('archived',{archived:true,completionEvidence:archived})]};
const report={private:true,kind:'browser-local-evidence-format',paidCalls:0,providerCalls:0,sandboxRuns:0,cases:[],external:[],writes:[],errors:[],passed:false};
await mkdir(output,{recursive:true});
globalThis.fetch=async()=>{throw Error('Outbound fetch is disabled in the evidence formatting harness.');};
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{
  try{
    const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);
    if(req.headers.host!==new URL(origin).host){res.writeHead(400);res.end();return;}
    if(!['GET','HEAD'].includes(req.method)){report.writes.push(url.pathname);res.writeHead(405);res.end();return;}
    if(url.pathname.startsWith('/api/')){res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});res.end('{"available":false,"code":"execution_disabled"}');return;}
    let relative;try{relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';}catch{res.writeHead(400);res.end();return;}
    const candidate=path.resolve(root,path.extname(relative)?relative:relative+'.html');
    if(!candidate.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    let file;try{file=await realpath(candidate);}catch{res.writeHead(404);res.end();return;}
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){report.errors.push(error.message);res.writeHead(500);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
async function state(page){return page.evaluate(k=>{const raw=JSON.parse(localStorage.getItem(k));return raw?.state||raw;},key);}
async function saved(page,id){return(await state(page)).packs.find(p=>p.id===id);}
async function openReview(page,id){await page.goto(`${origin}/next?pack=${encodeURIComponent(id)}&view=review`);await page.locator('#nebius-review-evidence').waitFor();return page.locator('#nebius-review-evidence');}
async function tabTo(page,target){for(let n=0;n<180;n++){if(await target.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Native Tab did not reach evidence control');}
async function save(page,text,expected=text){
  await page.locator('#nebius-review-evidence').fill(text);
  const button=page.getByRole('button',{name:'Save evidence',exact:true});await tabTo(page,button);await page.keyboard.press('Enter');
  await page.waitForFunction(({key,expected})=>{const raw=JSON.parse(localStorage.getItem(key));return(raw?.state||raw).packs.find(p=>p.id==='editable')?.completionEvidence===expected;},{key,expected});
  assert.equal(await page.locator('#nebius-review-evidence').inputValue(),expected);
  assert.equal((await saved(page,'editable')).status,'active','saving evidence leaves the task open');
}
async function readableHistory(page,id,expected){
  const field=await openReview(page,id),before=await saved(page,id);
  assert.equal(await field.inputValue(),expected);
  assert.equal(await field.evaluate(el=>el.readOnly),true,'history uses native readonly');
  assert.equal(await field.isDisabled(),false,'readonly history stays keyboard focusable');
  await tabTo(page,field);await page.keyboard.press('Control+A');
  assert.equal(await field.evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd)),expected,'full history can be selected for native copying');
  const focus=await field.evaluate(el=>({outline:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth)}));
  assert(focus.outline!=='none'&&focus.width>0,'keyboard focus is visible');
  await page.keyboard.type('Attempted replacement');await page.keyboard.press('Backspace');
  assert.equal(await field.inputValue(),expected,'keyboard editing cannot mutate history');
  assert.equal(await page.getByRole('button',{name:'Save evidence',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Mark done with recorded evidence',exact:true}).count(),0);
  for(const button of await page.getByRole('button',{name:/^(?:Review with Nebius|Build with Nebius|Run|Resume|Cancel run|Retire run)$/}).all()) assert.equal(await button.isDisabled(),true,'paid and run actions remain disabled');
  await page.getByRole('tab',{name:'Brief',exact:true}).click();await page.locator('[data-nebius-readonly-brief]').waitFor();assert.equal(await page.getByRole('link',{name:'Edit brief',exact:true}).count(),0,'history cannot edit its brief');
  await page.getByRole('tab',{name:'Tool',exact:true}).click();await page.locator('[data-nebius-readonly-tool]').waitFor();assert.equal(await page.getByRole('button',{name:/Build with Nebius|Start run|Resume run/}).count(),0,'history cannot create or resume tool runs');
  await page.getByRole('tab',{name:'Review',exact:true}).click();await field.waitFor();
  assert.deepEqual(await saved(page,id),before,'reading and attempted typing do not write saved history');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'history fits the viewport');
}
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE_PATH});
  for(const width of [375,1280])for(const palette of ['neutral-dark','original-light']){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){report.external.push(request.url());return route.abort();}if(url.pathname==='/sw.js')return route.abort();return route.continue();});
    await context.addInitScript(({key,fixture,palette})=>{if(window.top!==window)return;localStorage.setItem('wornpage-nebius-theme-v1',palette);if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(fixture));},{key,fixture,palette});
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>report.errors.push(error.message));
    const result={width,palette,phase:'load',passed:false};report.cases.push(result);
    try{
      await openReview(page,'editable');const flatBefore=await saved(page,'flat');
      result.phase='multiline';
      const note='Observed delivery delay: 2 days.\nExpedited finish: day 7.\n\nSupplier availability remains unconfirmed. 📝\nLiteral <b>observation</b>.';
      await save(page,note);await page.reload();await page.locator('#nebius-review-evidence').waitFor();assert.equal(await page.locator('#nebius-review-evidence').inputValue(),note,'reload preserves every internal newline and blank paragraph');
      assert.equal((await saved(page,'editable')).executionRun,undefined,'human notes create no execution receipt');
      result.phase='line-endings';await save(page,note+'\r\n\rFollow-up line.',note+'\n\nFollow-up line.');
      result.phase='append';const appended=note+'\n\nFollow-up: confirm staffing before changing the real schedule.';await save(page,appended);assert((await saved(page,'editable')).completionEvidence.startsWith(note),'append preserves old paragraphs');
      result.phase='whitespace';const cleaned=appended+'\n\n  Indented note retains  two spaces.\n\tTab remains meaningful.';await save(page,'  \n'+cleaned+'\n  ',cleaned);await page.reload();await page.locator('#nebius-review-evidence').waitFor();assert.equal(await page.locator('#nebius-review-evidence').inputValue(),cleaned);
      result.phase='invalid-text';
      for(const invalid of ['\u0001'+cleaned,cleaned+'\u007f',cleaned+'\ud800']){
        const before=await saved(page,'editable'),field=page.locator('#nebius-review-evidence');
        // Chromium insertText converts lone surrogates to U+FFFD. Set the
        // native input value for this hostile DOM case, then use the real
        // input event/controller and Save button, never mutate app state.
        if(invalid.endsWith('\ud800')) await field.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},invalid);
        else await field.fill(invalid);
        assert.equal(await field.inputValue(),invalid,'invalid fixture reaches the native form without protocol replacement');
        if(invalid.endsWith('\ud800')) assert.equal(await field.evaluate(el=>el.value.charCodeAt(el.value.length-1)),0xd800,'native DOM still contains the lone high surrogate before Save');
        await page.getByRole('button',{name:'Save evidence',exact:true}).click();await page.getByRole('alert').filter({hasText:/invalid text/}).waitFor();assert.deepEqual(await saved(page,'editable'),before,'invalid text is rejected atomically');
      }
      result.phase='limit';const full='x'.repeat(1998)+'📝';assert.equal(full.length,2000);await save(page,full);assert.equal((await saved(page,'editable')).completionEvidence.length,2000);await save(page,cleaned);
      result.phase='complete';const done=page.getByRole('button',{name:'Mark done with recorded evidence',exact:true});await tabTo(page,done);await page.keyboard.press('Enter');await page.waitForURL(url=>url.pathname==='/work');assert.equal((await saved(page,'editable')).status,'done','completion requires its separate human action');assert.equal((await saved(page,'editable')).completionEvidence,cleaned);
      await readableHistory(page,'editable',cleaned);await page.screenshot({path:path.join(output,`completed-${palette}-${width}.png`)});
      result.phase='archived';await readableHistory(page,'archived',archived);await page.screenshot({path:path.join(output,`archived-${palette}-${width}.png`)});
      result.phase='old-flat-note';await readableHistory(page,'flat',flat);await page.reload();await page.locator('#nebius-review-evidence').waitFor();assert.deepEqual(await saved(page,'flat'),flatBefore,'preexisting flat history is never migrated');
      result.phase='complete';result.passed=true;result.multilineExact=true;result.appendPreserved=true;result.invalidTextRejected=3;result.maximumLength=2000;result.completionSeparate=true;result.readonlyHistories=3;result.flatRecordUnchanged=true;
    }catch(error){result.error=error.stack;await page.screenshot({path:path.join(output,`failure-${palette}-${width}.png`),fullPage:true}).catch(()=>{});throw error;}
    finally{await context.close();}
  }
  assert.deepEqual(report.external,[]);assert.deepEqual(report.writes,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await writeFile(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,completed:report.cases.filter(c=>c.passed).length,external:report.external.length,writes:report.writes.length,errors:report.errors}));}
