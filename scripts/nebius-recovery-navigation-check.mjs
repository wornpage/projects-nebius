// Offline authored fixtures for the browser driver's native navigation helpers.
// This is not generated-tool, provider, Sandbox, or production-renderer evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {revealNativeControl,openFocusedNativeDisclosure,nativeScrollState,nativeScrollMoved} from './nebius-recovery-browser-navigation.mjs';

const args=process.argv.slice(2),options=new Map();
for(let index=0;index<args.length;index+=2){
  assert(['--chromium','--out'].includes(args[index])&&!options.has(args[index])&&args[index+1]&&path.isAbsolute(args[index+1]),'Use absolute --chromium and new --out paths.');
  options.set(args[index],args[index+1]);
}
assert.equal(options.size,2);
await fs.mkdir(options.get('--out'));
globalThis.fetch=async()=>{throw Error('Network is forbidden.');};
const report={version:'recovery-navigation-check.v1',authoredFixtureOnly:true,modelCalls:0,sandboxCalls:0,externalRequests:0,planned:10,outcomes:[]};
let browser;
const escaped=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const content=nested=>'<details id="outer"><summary>Outer controls</summary>'+(nested?'<details id="inner"><summary>Inner controls</summary>':'')+'<label for="input">Scenario</label><input id="input">'+(nested?'</details>':'')+'</details>';
try{
  browser=await chromium.launch({executablePath:options.get('--chromium'),headless:true});
  for(const width of [375,1280]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    await context.route('**/*',route=>{report.externalRequests++;return route.abort();});
    try{
      for(const scenario of ['reveal-single','reveal-nested','tab-single','tab-nested','nested-scroll']){
        const page=await context.newPage();page.setDefaultTimeout(3000);
        const outcome={width,scenario,status:'running'};report.outcomes.push(outcome);
        try{
          const child=scenario==='nested-scroll'?'<label for="input">Long plan</label><textarea id="input" style="display:block;width:90%;height:250px">'+Array.from({length:100},(_,index)=>'Line '+index).join('\n')+'</textarea>':content(scenario.endsWith('nested'));
          const doc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{margin:8px;font:16px system-ui}input{display:block}summary{padding:8px}</style>'+child;
          await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{display:block;width:100%;height:400px;border:0}</style><button id="before">Before preview</button><iframe id="fixture" title="Authored navigation fixture" sandbox="allow-scripts" srcdoc="'+escaped(doc)+'"></iframe><button id="after">After preview</button>');
          const frame=page.frames().find(item=>item.parentFrame());assert(frame);
          await frame.locator('#input').waitFor({state:'attached'});
          if(scenario.startsWith('reveal')){
            const count=await revealNativeControl(frame.locator('#input'));
            assert.equal(count,scenario.endsWith('nested')?2:1);assert.equal(await frame.locator('#input').isVisible(),true);
            await frame.locator('#input').fill('Edited natively');assert.equal(await frame.locator('#input').inputValue(),'Edited natively');outcome.openedDisclosures=count;
          }else if(scenario.startsWith('tab')){
            await page.locator('#before').click();let visited=false,left=false,count=0;
            for(let index=0;index<20;index++){
              await page.keyboard.press('Tab');
              if(await page.locator('#after').evaluate(element=>element===document.activeElement)){left=true;break;}
              if(await page.locator('#fixture').evaluate(element=>element===document.activeElement)){
                if(await openFocusedNativeDisclosure(page,frame,['input']))count++;
                if(await frame.locator('#input').evaluate(element=>element===document.activeElement))visited=true;
              }
            }
            assert.equal(visited,true);assert.equal(left,true);assert.equal(count,scenario.endsWith('nested')?2:1);
            await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('#fixture').evaluate(element=>element===document.activeElement),true);
            outcome.openedDisclosures=count;outcome.nativeTabReachedInput=true;outcome.nativeTabExited=true;outcome.nativeShiftTabReentered=true;
          }else{
            const before=await nativeScrollState(frame);assert.equal(before.documentOverflow,false);assert.equal(before.needed,true);
            const box=await frame.locator('#input').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,400);await page.waitForTimeout(100);
            const after=await nativeScrollState(frame);assert.equal(after.documentTop,before.documentTop);assert.equal(nativeScrollMoved(before,after),true);
            outcome.nestedScrollMoved=true;outcome.documentScrollMoved=false;
          }
          outcome.status='passed';
        }catch(error){outcome.status='failed';outcome.error=String(error.message).slice(0,300);}
        finally{await page.close();}
      }
    }finally{await context.close();}
  }
}finally{
  if(browser)await browser.close();
  report.passed=report.outcomes.filter(item=>item.status==='passed').length;report.failed=report.outcomes.filter(item=>item.status==='failed').length;
  report.status=report.passed===report.planned&&report.externalRequests===0?'passed':'failed';
  await fs.writeFile(path.join(options.get('--out'),'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report));if(report.status!=='passed')process.exitCode=1;
}
