import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {FIXTURE_INPUT} from '../tests/fixtures/nebius-release-checker.mjs';
const root=await realpath('dist/static-publish');
const out=path.resolve(process.env.NEBIUS_BRIEF_EVIDENCE_DIR||'dist/nebius-brief-preview');
await mkdir(out,{recursive:true});
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/nebius-brief-preview.json',import.meta.url),'utf8'));
const key='projects-webmcp-challenge-state-v1';
const report={passed:false,cases:[],writes:[],external:[],errors:[],providerCalls:0};
const types={'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!=='127.0.0.1:'+server.address().port)return res.writeHead(400).end();
  const url=new URL(req.url,'http://'+req.headers.host);
  if(!['GET','HEAD'].includes(req.method)){report.writes.push(url.pathname);return res.writeHead(405).end();}
  if(url.pathname.startsWith('/api/'))return res.writeHead(404,{'content-type':'application/json'}).end('{"available":false,"code":"execution_disabled"}');
  const relative=decodeURIComponent(url.pathname).replace(/^\/+/,'')||'index.html';
  const candidate=path.resolve(root,path.extname(relative)?relative:relative+'.html');
  if(!candidate.startsWith(root+path.sep))return res.writeHead(403).end();
  let file;try{file=await realpath(candidate);}catch{return res.writeHead(404).end();}
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','cache-control':'no-store'}).end(await readFile(file));
 }catch(error){report.errors.push(error.message);res.writeHead(500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true});
 for(const width of [375,1280])for(const palette of ['neutral-dark','neutral-light','original-dark','original-light']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(report.external.push(route.request().url()),route.abort()));
  await context.addInitScript(({key,fixture,palette})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(fixture));localStorage.setItem('wornpage-nebius-theme-v1',palette);},{key,fixture,palette});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>report.errors.push(error.message));
  const result={width,palette,passed:false};report.cases.push(result);
  try{
   await page.goto(origin+'/next?pack=brief-long&view=brief');
   await page.getByRole('button',{name:'Show more purpose',exact:true}).waitFor();
   const savedBefore=await page.evaluate(key=>localStorage.getItem(key),key);
   const pack=fixture.packs.find(p=>p.id==='brief-long');
   for(const [label,field] of [['Purpose','purpose'],['Completion criteria','doneWhen']]){
    const section=page.locator('[data-nebius-brief-fields]').locator('[data-nebius-brief-preview="'+label+'"]');
    const text=section.locator('[data-brief-preview-text]');
    assert.equal(await text.textContent(),pack[field]);
    const geometry=await text.evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight)}));
    assert(geometry.height<=geometry.line*3+2,'three-line preview');
    const toggle=section.getByRole('button');await toggle.focus();
    await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    assert.equal(await toggle.evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Space');assert.equal(await toggle.getAttribute('aria-expanded'),'false');
   }
   assert.equal(await page.locator('[data-nebius-saved-next-step]').textContent(),pack.nextStep);
   assert.equal(await page.locator('[data-nebius-saved-next-step]').evaluate(el=>getComputedStyle(el).webkitLineClamp),'none');
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),savedBefore);
   await page.screenshot({path:path.join(out,'brief-'+palette+'-'+width+'.png'),fullPage:true});
   await page.getByRole('tab',{name:'Review',exact:true}).click();
   await page.getByRole('button',{name:'Show more completion criteria',exact:true}).waitFor();
   assert.equal(await page.locator('[data-current-full-criteria]').textContent(),pack.doneWhen);
   await page.getByRole('button',{name:'Show more completion criteria',exact:true}).press('Enter');
   assert.equal(await page.getByRole('button',{name:'Show less completion criteria',exact:true}).getAttribute('aria-expanded'),'true');
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),savedBefore);
   // Synthetic saved-request reference exercises the second Review branch.
   const savedFixture=structuredClone(fixture),target=savedFixture.packs.find(p=>p.id==='brief-long');
   target.executionRun={id:'00000000-0000-4000-8000-000000000001',key:'0'.repeat(64),input:{...structuredClone(FIXTURE_INPUT),packId:target.id,pack:{title:target.title,purpose:target.purpose,nextStep:target.nextStep,doneWhen:target.doneWhen,blocker:target.blocker},currentStatus:target.status},record:null};
   await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key,value:savedFixture});
   await page.goto(origin+'/next?pack=brief-long&view=review');await page.locator('.current-criteria > summary').press('Enter');
   const current=page.locator('.current-criteria');
   await current.getByRole('button',{name:'Show more completion criteria',exact:true}).waitFor();
   const savedRequestBefore=await page.evaluate(key=>localStorage.getItem(key),key);
   await current.getByRole('button').press('Enter');
   assert.equal(await current.getByRole('button').getAttribute('aria-expanded'),'true');
   assert.equal(await current.locator('[data-current-full-criteria]').textContent(),target.doneWhen);
   await current.getByRole('button').press('Space');
   assert.equal(await current.getByRole('button').getAttribute('aria-expanded'),'false');
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),savedRequestBefore);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.join(out,'review-'+palette+'-'+width+'.png'),fullPage:true});
   result.passed=true;
  }catch(error){result.error=error.stack;await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw error;}
  finally{await context.close();}
 }
 assert.deepEqual(report.writes,[]);assert.deepEqual(report.external,[]);assert.deepEqual(report.errors,[]);report.passed=true;
}finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,completed:report.cases.filter(x=>x.passed).length,writes:report.writes.length,external:report.external.length,errors:report.errors.length}));
}
