// Browser qualification navigation only. DOM reads identify native controls;
// every disclosure change is a real keyboard activation, never an .open write.
export async function revealNativeControl(control){
  await control.waitFor({state:'attached'});
  let opened=0;
  for(;opened<12;opened++){
    const closed=control.locator('xpath=ancestor::details[not(@open)]').first();
    if(!await closed.count())break;
    const summary=closed.locator(':scope > summary').first();
    await summary.waitFor({state:'visible'});
    // Retain this node for the observation: the closed-only locator resolves
    // to a different ancestor (or none) once native activation opens it.
    const owner=await closed.elementHandle();
    try{
      await summary.press('Enter');
      if(!owner||!await owner.evaluate(element=>element.open))throw Error('Native disclosure did not open.');
    }finally{await owner?.dispose();}
  }
  if(await control.locator('xpath=ancestor::details[not(@open)]').count())throw Error('Native disclosure depth exceeds the qualification bound.');
  await control.waitFor({state:'visible'});
  return opened;
}

export async function openFocusedNativeDisclosure(page,frame,requiredIds){
  const shouldOpen=await frame.evaluate(ids=>{
    const summary=document.activeElement,details=summary?.parentElement;
    return summary?.tagName==='SUMMARY'&&details?.tagName==='DETAILS'&&!details.open
      &&ids.some(id=>{const control=document.getElementById(id);return control&&details.contains(control);});
  },requiredIds);
  if(!shouldOpen)return false;
  await page.keyboard.press('Enter');
  if(!await frame.evaluate(()=>document.activeElement?.parentElement?.open===true))throw Error('Native disclosure did not open.');
  return true;
}

export async function nativeScrollState(frame){
  return frame.evaluate(()=>{
    const elements=Array.from(document.querySelectorAll('*'));
    const containers=elements.flatMap((element,index)=>{
      const style=getComputedStyle(element),box=element.getBoundingClientRect();
      const canScroll=element.scrollHeight>element.clientHeight+2&&['auto','scroll','overlay'].includes(style.overflowY);
      return canScroll?[{index,top:element.scrollTop,left:element.scrollLeft,
        visible:box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight&&box.right>0&&box.left<innerWidth}]:[];
    });
    return{documentOverflow:document.documentElement.scrollHeight>innerHeight+2,
      needed:document.documentElement.scrollHeight>innerHeight+2||containers.some(item=>item.visible),
      documentTop:scrollY,documentLeft:scrollX,containers};
  });
}

export function nativeScrollMoved(before,after){
  if(before.documentTop!==after.documentTop||before.documentLeft!==after.documentLeft)return true;
  return before.containers.some(item=>{const current=after.containers.find(candidate=>candidate.index===item.index);
    return current&&(current.top!==item.top||current.left!==item.left);});
}
