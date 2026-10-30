import { parse, serialize } from 'parse5';
import { validateRunFiles, validateToolRequirements } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { isRecord } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { TIMELINE_VALIDATOR_SOURCE } from '../svelte-frontend/src/lib/nebius-timeline-contract.mjs';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const ALLOWED_TAGS = new Set(('html head body title style main header footer nav section article aside div span p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd a button input label select option optgroup textarea form fieldset legend output progress meter details summary table caption thead tbody tfoot tr th td colgroup col br hr strong em b i small s u sub sup code pre blockquote figure figcaption img time datalist').split(' '));
const ATTRIBUTES = new Set(('id class style title role lang dir hidden tabindex name type value placeholder min max step minlength maxlength required checked selected disabled readonly multiple for rows cols size width height alt scope colspan rowspan open datetime autocomplete inputmode pattern list start reversed wrap').split(' '));

// Local preview defaults use the edition's public Wornpage palette. The first
// cascade layer keeps authored tool styling in control. Renderer-owned result
// captions retain essential visibility; no font or asset fetch is needed, and
// stored source is not changed.
const PREVIEW_STYLE = `@layer nebius-preview-base {
  :root { color-scheme: light; font: 100%/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #24352d; background: #f6f4ee; }
  *, ::before, ::after { box-sizing: border-box; }
  body { inline-size: min(100%, 80ch); margin: 0 auto; overflow-wrap: anywhere; padding: clamp(20px, 4vw, 32px); }
  :where(h1, h2, h3, h4, h5, h6) { line-height: 1.25; margin-block: 0 1rem; }
  :where(h1) { font-size: clamp(1.5rem, 4vw, 2rem); }
  :where(label:not([hidden]), legend) { display: inline-block; font-weight: 650; margin-block-end: .5rem; }
  :where(input, textarea, select, button) { font: inherit; }
  :where(input, textarea, select) { max-inline-size: 100%; min-inline-size: 0; border: 1px solid #6c8b76; border-radius: 8px; background: #fffefa; color: #24352d; padding: .875rem; }
  :where(input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select) { min-height: 44px; }
  :where(textarea) { width: 100%; min-height: 10rem; resize: vertical; }
  :where(pre, code, textarea) { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 1rem; line-height: 1.5; }
  :where(pre, output) { max-inline-size: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
  :where(output:not([hidden])) { background: #fffefa; border: 1px solid #b6c3b9; border-radius: 8px; display: block; line-height: 1.65; min-block-size: 4rem; padding: 1rem; }
  :where([data-nebius-output-label]) { color: #526459; font-size: .75rem; font-weight: 700; letter-spacing: .04em; margin: 1.25rem 0 .5rem; }
  :where(button, input[type="button"], input[type="submit"], input[type="reset"], summary) { min-height: 44px; max-inline-size: 100%; padding: .75rem 1rem; border: 1px solid #b6c3b9; border-radius: 8px; background: #fffefa; color: #24352d; cursor: pointer; overflow-wrap: anywhere; }
  :where(button, input[type="button"], input[type="submit"], input[type="reset"]) { background: #fffefa; border-color: #6c8b76; color: #24352d; margin: .25rem .5rem .25rem 0; font-weight: 650; }
  :where(button[data-example-for], input[data-example-for]) { background: #fffefa; border-color: #b6c3b9; color: #24352d; }
  :where(button:hover, input[type="button"]:hover, input[type="submit"]:hover, input[type="reset"]:hover) { background: #e8eee7; border-color: #6c8b76; color: #24352d; }
  :where(button[data-example-for]:hover, input[data-example-for]:hover, summary:hover) { background: #e8eee7; border-color: #6c8b76; color: #24352d; }
  :where(button:disabled, input:disabled, select:disabled, textarea:disabled) { cursor: default; opacity: .65; }
  :where(a) { color: #0f766e; }
  :where(button, input, select, textarea, summary, a):focus-visible { outline: 3px solid #0f766e; outline-offset: 3px; }
  :where(fieldset) { min-inline-size: 0; border: 1px solid #cbd4ca; border-radius: 8px; padding: 1rem; }
  :where(details) { margin-block: 1rem; }
  :where(dt) { font-weight: 600; }
  :where(dd) { margin: 0 0 .75rem; }
  :where(img, table) { max-inline-size: 100%; }
}`;

const TIMELINE_STYLE = `
@layer nebius-preview-timeline {
  [data-nebius-timeline] { display: grid; gap: .875rem; white-space: normal; }
  [data-nebius-timeline-summary] { display: block; font-weight: 650; }
  [data-nebius-timeline-axis] { color: #526459; display: flex; font-size: .75rem; justify-content: space-between; }
  [data-nebius-timeline-row] { display: grid; gap: .35rem; grid-template-columns: minmax(7rem, 1fr) minmax(10rem, 2fr); }
  [data-nebius-timeline-label] { font-weight: 650; }
  [data-nebius-timeline-plot] { background: #e8eee7; border-radius: 6px; min-height: 2.75rem; overflow: hidden; position: relative; }
  [data-nebius-timeline-bar] { border-radius: 4px; height: .75rem; min-width: 2px; position: absolute; }
  [data-nebius-timeline-bar="baseline"] { background: repeating-linear-gradient(135deg,#5e7067 0 4px,#fffefa 4px 6px); border: 1px solid #526459; top: .45rem; }
  [data-nebius-timeline-bar="scenario"] { background: #276456; bottom: .45rem; }
  [data-nebius-timeline-range] { color: #526459; font-size: .75rem; grid-column: 2; }
  @media (max-width: 375px) {
    [data-nebius-timeline-row] { grid-template-columns: minmax(0, 1fr); }
    [data-nebius-timeline-range] { grid-column: 1; }
  }
}`;

function sanitize(node) {
  if (node.nodeName === '#text') return node;
  if (!node.tagName || node.namespaceURI !== HTML_NAMESPACE || !ALLOWED_TAGS.has(node.tagName)) return null;
  node.attrs = (node.attrs || []).filter(attribute => {
    if (attribute.namespace || attribute.prefix) return false;
    const name = attribute.name.toLowerCase();
    if (ATTRIBUTES.has(name) || /^aria-[a-z-]+$/u.test(name) || /^data-[a-z0-9_-]+$/u.test(name)) return true;
    if (node.tagName === 'a' && name === 'href') return /^#[A-Za-z0-9_-]*$/u.test(attribute.value);
    if (node.tagName === 'img' && name === 'src') return /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/u.test(attribute.value);
    return false;
  });
  node.childNodes = (node.childNodes || []).map(sanitize).filter(Boolean);
  return node;
}

function sanitizedPage(html) {
  const document = parse(html);
  const root = document.childNodes.find(node => node.tagName === 'html');
  const head = root?.childNodes?.find(node => node.tagName === 'head');
  const body = root?.childNodes?.find(node => node.tagName === 'body');
  if (!head || !body) throw new TypeError('The generated page cannot be previewed.');
  sanitize(head);
  sanitize(body);
  return { head, body };
}

// Derived from the same sanitized body the browser sees. No generated script is
// evaluated here. This manifest is trusted runner data, never a model assertion.
export function runPageContract(rawFiles, requirements = {}) {
  if (!isRecord(requirements) || Object.keys(requirements).some(key => !['requiredInputFormats', 'requiredOutputs'].includes(key))) {
    throw new TypeError('Pass named tool input and output requirements.');
  }
  const { requiredInputFormats: required, requiredOutputs } = validateToolRequirements(
    Object.hasOwn(requirements, 'requiredInputFormats') ? requirements.requiredInputFormats : null,
    Object.hasOwn(requirements, 'requiredOutputs') ? requirements.requiredOutputs : null);
  const files = validateRunFiles(rawFiles);
  const { body } = sanitizedPage(files.find(file => file.path === 'index.html').content);
  const elements = [], ids = new Set(), editableTextIds = new Set();
  function visit(node, ancestorDisabled = false, ancestorHidden = false) {
    if (!node.tagName) return;
    const attrs = Object.fromEntries((node.attrs || []).map(attr => [attr.name, attr.value]));
    const inputType = (attrs.type || 'text').toLowerCase();
    const hidden = ancestorHidden || Object.hasOwn(attrs, 'hidden') || attrs['aria-hidden']?.toLowerCase() === 'true';
    const valueControl = ['input', 'select', 'textarea'].includes(node.tagName);
    const disabled = ancestorDisabled || (['button', 'input', 'select', 'textarea', 'fieldset'].includes(node.tagName) && Object.hasOwn(attrs, 'disabled'));
    const action = node.tagName === 'button' || (node.tagName === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType));
    const readonly = Object.hasOwn(attrs, 'readonly') && (node.tagName === 'textarea'
      || (node.tagName === 'input' && !['hidden', 'range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(inputType)));
    const requiresText = node.tagName === 'output' || (node.tagName === 'pre' && attrs['data-output'] === 'true');
    const outputFormat = attrs['data-output-format'] ?? null;
    if (outputFormat !== null && (node.tagName !== 'output' || outputFormat !== 'timeline')) {
      const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(attrs.id || '') ? ' id="' + attrs.id + '"' : '';
      throw new TypeError('index.html: <' + node.tagName + identifier + '>: output format must be timeline on an output element. Use <output data-output-format="timeline"> or remove the declaration; preserve the ID.');
    }
    const control = ['button', 'input', 'select', 'textarea', 'form', 'output'].includes(node.tagName) || requiresText;
    if (control && !attrs.id) throw new TypeError('Every generated control and output needs an ID.');
    if (attrs.id) {
      if (attrs.id.length > 200 || ids.has(attrs.id)) throw new TypeError('Generated page IDs must be unique and bounded.');
      ids.add(attrs.id);
      if (ids.size > 200) throw new TypeError('The generated page exceeds its 200-element binding limit.');
      const editable = valueControl && !action && inputType !== 'hidden' && !disabled && !readonly;
      const textualInput = ['textarea', 'select'].includes(node.tagName) || (node.tagName === 'input'
        && ['text', 'search', 'tel', 'url', 'email', 'password'].includes(inputType));
      if (editable && textualInput && !hidden) editableTextIds.add(attrs.id);
      const fields = ['hidden'];
      if (['pre', 'output'].includes(node.tagName)) fields.push('text');
      if (outputFormat === 'timeline') fields.push('timeline');
      if (valueControl) fields.push('value', 'disabled');
      if (node.tagName === 'button') fields.push('disabled');
      if (node.tagName === 'select') fields.push('options');
      const events = disabled ? [] : editable ? ['input', 'change']
        : action ? ['click'] : node.tagName === 'form' ? ['submit'] : [];
      if (attrs['data-input-format'] !== undefined && (!valueControl || !['text', 'json'].includes(attrs['data-input-format']))) {
        throw new TypeError('A declared input format must be text or json on a value control.');
      }
      if (attrs['data-example-for'] !== undefined && (!action || !attrs['data-example-for'])) {
        throw new TypeError('An example-loader declaration needs an action and target input.');
      }
      elements.push({ id: attrs.id, tag: node.tagName, fields, events, valueControl, requiresText,
        booleanValue: node.tagName === 'input' && ['checkbox', 'radio'].includes(inputType),
        textValue: valueControl && !action && !(node.tagName === 'input' && ['checkbox', 'radio'].includes(inputType)),
        format: attrs['data-input-format'] ?? null, outputFormat, exampleFor: attrs['data-example-for'] ?? null });
    }
    const legend = node.tagName === 'fieldset' ? node.childNodes?.find(child => child.tagName === 'legend') : null;
    const childDisabled = ancestorDisabled || (node.tagName === 'fieldset' && Object.hasOwn(attrs, 'disabled'));
    for (const child of node.childNodes || []) visit(child, child === legend ? ancestorDisabled : childDisabled, hidden);
  }
  for (const child of body.childNodes || []) visit(child);
  for (const element of elements) {
    if (element.exampleFor !== null && !elements.some(target => target.id === element.exampleFor && target.valueControl && !target.booleanValue)) {
      throw new TypeError('An example-loader target must be a declared text value control.');
    }
  }
  if (required !== null) {
    const textual = elements.filter(element => element.textValue);
    if (textual.length !== required.length || textual.some(element => !required.some(input => input.id === element.id))) {
      throw new TypeError('Generated text inputs must exactly match the task-owned input IDs.');
    }
    for (const input of required) {
      const element = textual.find(candidate => candidate.id === input.id);
      if (!element || element.format !== input.format) {
        throw new TypeError('Input ' + input.id + ' must declare data-input-format="' + input.format + '" as required by the task.');
      }
      if (!editableTextIds.has(input.id) || !element.events.includes('input') || !element.events.includes('change')) {
        throw new TypeError('Input ' + input.id + ' must be an editable text control, without hidden, disabled or readonly markup.');
      }
    }
  }
  if (requiredOutputs !== null) {
    const problems = [];
    for (const output of requiredOutputs) {
      const element = elements.find(candidate => candidate.id === output.id);
      if (!element) problems.push('Required output ' + output.id + ' is missing.');
      else if (element.tag !== 'output') problems.push('Required output ' + output.id + ' must use an output element.');
      else if (output.format === 'timeline' && element.outputFormat !== 'timeline') problems.push('Required output ' + output.id + ' must declare data-output-format="timeline".');
      else if (output.format === 'text' && element.outputFormat !== null) problems.push('Required output ' + output.id + ' must be plain text, without data-output-format.');
    }
    if (problems.length) throw new TypeError(problems.slice(0, 3).join(' ') + (problems.length > 3 ? ' Additional required outputs also need correction.' : ''));
  }
  return { version: 1, elements };
}

/** Untrusted generated markup is never inserted into the host application. */
export async function renderRunPreview(rawFiles, requirements = {}) {
  const files = validateRunFiles(rawFiles);
  const pageContract = runPageContract(files, requirements);
  const timelineEnabled = pageContract.elements.some(element => element.outputFormat === 'timeline');
  const source = Object.fromEntries(files.map(file => [file.path, file.content]));
  const { head, body } = sanitizedPage(source['index.html']);
  // Only this fixed bridge has DOM access. Generated code runs in a Worker:
  // workers have no browsing context to navigate, and Blob workers inherit
  // this document's CSP (including connect-src none). No generated markup,
  // URL, event handler, CSS or script is accepted through the message bridge.
  const appBytes = new TextEncoder().encode(source['app.js']);
  const encoded = btoa(String.fromCharCode(...appBytes));
  const bootstrap = `(()=>{
    const elements = new Map(Array.from(document.body.querySelectorAll('[id]')).slice(0,200).map(el=>[el.id,el]));
    const outputs = new Set(Array.from(elements.values()).filter(el=>el.tagName==='OUTPUT'||(el.tagName==='PRE'&&el.dataset.output==='true')));
${timelineEnabled ? `    const validateTimelinePatch=${TIMELINE_VALIDATOR_SOURCE};
    const renderTimeline=(el,text,timeline)=>{
      const root=document.createElement('span');root.setAttribute('data-nebius-timeline','');
      const summary=document.createElement('span');summary.setAttribute('data-nebius-timeline-summary','');summary.textContent=text;
      const axis=document.createElement('span');axis.setAttribute('data-nebius-timeline-axis','');
      const axisStart=document.createElement('span'),axisEnd=document.createElement('span');axisStart.textContent='Day 0';axisEnd.textContent='Day '+timeline.horizon;axis.append(axisStart,axisEnd);
      const descriptions=[];root.append(summary,axis);
      for(const row of timeline.rows){
        const rowElement=document.createElement('span');rowElement.setAttribute('data-nebius-timeline-row','');
        const label=document.createElement('span');label.setAttribute('data-nebius-timeline-label','');label.textContent=row.label;
        const plot=document.createElement('span');plot.setAttribute('data-nebius-timeline-plot','');plot.setAttribute('aria-hidden','true');
        const baseline=document.createElement('span');baseline.setAttribute('data-nebius-timeline-bar','baseline');
        baseline.style.left=(row.baselineStart/timeline.horizon*100)+'%';baseline.style.width=((row.baselineEnd-row.baselineStart)/timeline.horizon*100)+'%';
        const scenario=document.createElement('span');scenario.setAttribute('data-nebius-timeline-bar','scenario');
        scenario.style.left=(row.start/timeline.horizon*100)+'%';scenario.style.width=((row.end-row.start)/timeline.horizon*100)+'%';
        plot.append(baseline,scenario);
        const range=document.createElement('span');range.setAttribute('data-nebius-timeline-range','');
        range.textContent='Baseline '+row.baselineStart+'–'+row.baselineEnd+' days · Scenario '+row.start+'–'+row.end+' days';
        descriptions.push(row.label+': baseline days '+row.baselineStart+' to '+row.baselineEnd+'; scenario days '+row.start+' to '+row.end+'.');
        rowElement.append(label,plot,range);root.append(rowElement);
      }
      root.setAttribute('role','img');root.setAttribute('aria-label',text+' Horizon '+timeline.horizon+' days. '+descriptions.join(' '));
      el.replaceChildren(root);
    };
` : ''}    const valueControl = el=>el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement;
    const textControl = el=>valueControl(el)&&!(el instanceof HTMLInputElement&&['checkbox','radio','button','submit','reset','image'].includes(el.type));
    const tidy = value=>String(value||'').replace(/\\s+/g,' ').trim().slice(0,200);
    const nameOf = (el,fallback)=>{
      const references=(el.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean);
      const referenced=references.map(id=>document.getElementById(id)).filter(Boolean),labels=Array.from(el.labels||[]);
      const referencedText=tidy(referenced.map(label=>label.textContent).join(' ')),labelText=tidy(labels.map(label=>label.textContent).join(' '));
      const author=referencedText||tidy(el.getAttribute('aria-label'))||labelText;
      return {text:author||fallback,namingGroups:[referenced,labels]};
    };
    const visible = el=>!el.closest('[hidden],[aria-hidden="true"]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility==='visible';
    // Keep focus local to this opaque preview; no parent access or Worker event.
    let lastFocusedControl=null,focusFrame=false;
    document.body.addEventListener('focusin',event=>{
      const el=event.target;
      if(el instanceof HTMLElement&&el!==document.body&&el!==document.documentElement)lastFocusedControl=el;
    });
    addEventListener('focus',()=>{
      if(focusFrame)return;
      focusFrame=true;
      requestAnimationFrame(()=>{
        focusFrame=false;
        const el=lastFocusedControl;
        if(document.hasFocus()&&document.activeElement===document.body&&el?.isConnected&&
          !el.matches(':disabled')&&!el.closest('[inert]')&&visible(el))el.focus({preventScroll:true});
      });
    });
    const readableLabel = el=>{
      if(!visible(el))return false;
      const box=el.getBoundingClientRect();
      if(box.width<=1||box.height<=1||box.right<=0||box.bottom<=0||box.left>=document.documentElement.clientWidth||box.top>=document.documentElement.clientHeight)return false;
      for(let node=el;node;node=node.parentElement){
        const style=getComputedStyle(node);
        if(Number(style.opacity)===0||(style.clip&&style.clip!=='auto')||(style.clipPath&&style.clipPath!=='none'))return false;
      }
      return true;
    };
    const outputNames=new Map(),outputLabels=new Map();
    // The fixed renderer owns announcements. Generated live regions cannot
    // duplicate the result notifications below.
    for(const el of document.body.querySelectorAll('[aria-live],[role="status"],[role="alert"],[role="log"],[role="marquee"],[role="timer"]'))el.setAttribute('aria-live','off');
    const presentOutput=el=>{
      if(outputNames.has(el))return;
      const name=nameOf(el,outputNames.size?'Result '+(outputNames.size+1):'Result');
      outputNames.set(el,name.text);
      el.removeAttribute('aria-labelledby');
      el.setAttribute('aria-label',name.text);
      el.setAttribute('role','group');
      el.setAttribute('aria-live','off');
      const label=document.createElement('p');label.textContent=name.text;label.setAttribute('aria-hidden','true');label.setAttribute('data-nebius-output-label','');
      // Only this renderer-owned caption has fixed essential presentation.
      // In particular, authored p rules cannot turn its visible name off.
      label.style.cssText='position:static!important;visibility:visible!important;opacity:1!important;clip:auto!important;clip-path:none!important;transform:none!important;width:auto!important;height:auto!important;overflow:visible!important;font:700 .75rem/1.5 ui-sans-serif,system-ui,sans-serif!important;color:#526459!important;margin:1.25rem 0 .5rem!important;padding:0!important;animation:none!important;transition:none!important';
      el.before(label);outputLabels.set(el,{label,namingGroups:name.namingGroups});
    };
    for(const el of outputs)presentOutput(el);
    const formats=document.createElement('details'),formatHeading=document.createElement('summary'),formatList=document.createElement('dl');
    formatHeading.textContent='Input formats';formats.append(formatHeading,formatList);formats.style.cssText='margin-top:1rem;overflow-wrap:anywhere';
    for(const el of elements.values())if(textControl(el)){
      const term=document.createElement('dt'),description=document.createElement('dd');
      term.textContent=nameOf(el,el.id).text;
      const format=el.dataset.inputFormat;
      description.textContent=format==='json'?'JSON':format==='text'?'Plain text':format===undefined?'Not declared':'Unsupported declaration';
      formatList.append(term,description);
    }
    if(formatList.childNodes.length){const note=document.createElement('p');note.textContent='Declared by the tool. Check these against your task.';formats.append(note);document.body.append(formats);}
    const status = document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');status.setAttribute('aria-label','Tool updates');
    status.style.cssText='position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0';document.body.append(status);
    let announcementRevision=0;
    const results=()=>Array.from(outputs).filter(el=>visible(el)&&el.textContent.trim()).map(el=>outputNames.get(el)+': '+el.textContent.trim());
    const refreshLabels=()=>{for(const [el,{label,namingGroups}] of outputLabels){
      const matchingName=namingGroups.some(group=>group.length&&tidy(group.map(node=>node.textContent).join(' '))===outputNames.get(el)&&group.every(readableLabel));
      label.hidden=!visible(el)||matchingName;
      label.style.setProperty('display',label.hidden?'none':'block','important');
    }};
    const clearOutputs=()=>{const hadResult=results().length>0;for(const el of outputs)el.textContent='';return hadResult;};
    const announce=getMessage=>{
      if(stopped)return;
      const revision=++announcementRevision;status.textContent='';
      requestAnimationFrame(()=>{
        if(stopped||revision!==announcementRevision)return;
        const message=getMessage();
        status.textContent=message.length>4000?message.slice(0,3950)+'… Full results remain in the tool.':message;
      });
    };
    refreshLabels();
    const bytes = Uint8Array.from(atob("${encoded}"), c=>c.charCodeAt(0));
    const notify = state=>{if(parent!==window)parent.postMessage({type:'nebius-tool-preview',status:state},'*');};
    let worker;let url;
    try{url=URL.createObjectURL(new Blob([bytes], {type:'text/javascript'}));worker=new Worker(url);}
    catch{status.style.cssText='';status.textContent='This browser could not start the tool preview.';notify('failed');return;}
    finally{if(url)URL.revokeObjectURL(url);}
    let timer; let stopped = false; let busy = false; let editRevision = 0; let activeRevision = 0;
    const pending = [];
    const stop = message=>{if(stopped)return;stopped=true;announcementRevision++;clearTimeout(timer);pending.length=0;worker.terminate();status.style.cssText='';status.textContent=message;notify('failed');};
    const values = ()=>Object.fromEntries(Array.from(elements).filter(([,el])=>el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement).map(([id,el])=>[id,el instanceof HTMLInputElement && (el.type==='checkbox'||el.type==='radio') ? el.checked : el.value.slice(0,4000)]));
    const dispatch = request=>{busy=true;activeRevision=request.revision;timer=setTimeout(()=>stop('The tool stopped responding. Reopen the preview to restart it.'),5000);worker.postMessage(request.message);};
    const send = message=>{
      if(stopped)return;
      const request={message:{...message,values:values()},revision:editRevision};
      if(busy){
        if(pending.length>=32){stop('Too many tool interactions are waiting. Reopen the preview to restart it.');return;}
        pending.push(request);
      }else dispatch(request);
    };
    worker.onerror=event=>{event.preventDefault();stop('The tool encountered a script error. Review its source and checks.');};
    worker.onmessage=event=>{
      if(stopped || !busy)return;
      clearTimeout(timer);
      const data=event.data;
      if(!data||typeof data!=='object'||!Array.isArray(data.patches)||data.patches.length>100){stop('The tool returned an unsupported update.');return;}
${timelineEnabled ? `      const timelines=new Map();
      try{for(const patch of data.patches){const timeline=validateTimelinePatch(patch,elements.get(patch&&patch.id)?.dataset.outputFormat||null);if(timeline)timelines.set(patch,timeline);}}
      catch{stop('The tool returned an unsupported timeline update.');return;}
` : ''}      // A response computed before a newer field edit cannot overwrite that
      // edit or publish an answer for the previous values. Still validate its
      // envelope, then deliver the queued event with its captured values.
      if(activeRevision===editRevision){
        const priorResults=results();
        const touchedOutputs=new Set();
        // Clear the old result once before the entire batch, independent of
        // whether the new result patch precedes its input-value patch.
        if(data.patches.some(patch=>patch&&valueControl(elements.get(patch.id))&&
          ((typeof patch.value==='string'&&patch.value.length<=4000)||(elements.get(patch.id) instanceof HTMLSelectElement&&Array.isArray(patch.options)&&patch.options.length<=100))))clearOutputs();
        for(const patch of data.patches){
        if(!patch||typeof patch!=='object'||typeof patch.id!=='string')continue;
        const el=elements.get(patch.id);if(!el)continue;
        ${timelineEnabled ? `if(timelines.has(patch)){outputs.add(el);presentOutput(el);renderTimeline(el,patch.text,timelines.get(patch));touchedOutputs.add(el);}else ` : ''}if(typeof patch.text==='string'&&patch.text.length<=16000&&(el.tagName==='PRE'||el.tagName==='OUTPUT')){outputs.add(el);presentOutput(el);el.textContent=patch.text;touchedOutputs.add(el);}
        if(typeof patch.value==='string'&&patch.value.length<=4000&&(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement))el.value=patch.value;
        if(typeof patch.disabled==='boolean'&&(el instanceof HTMLButtonElement||el instanceof HTMLInputElement||el instanceof HTMLSelectElement||el instanceof HTMLTextAreaElement))el.disabled=patch.disabled;
        if(typeof patch.hidden==='boolean')el.hidden=patch.hidden;
        if(el instanceof HTMLSelectElement&&Array.isArray(patch.options)&&patch.options.length<=100){
          const options=patch.options.filter(item=>item&&typeof item.value==='string'&&item.value.length<=500&&typeof item.label==='string'&&item.label.length<=500);
          el.replaceChildren(...options.map(item=>new Option(item.label,item.value)));
        }
        }
        refreshLabels();
        const currentResults=results();
        if(currentResults.length&&(Array.from(touchedOutputs).some(el=>visible(el)&&el.textContent.trim())||currentResults.join('\\n')!==priorResults.join('\\n')))announce(()=>results().join('\\n'));
        else if(priorResults.length&&!currentResults.length)announce(()=>'Results cleared. Check the updated input.');
      }
      notify('ready');busy=false;
      if(pending.length)dispatch(pending.shift());
    };
    for(const eventName of ['click','input','change','submit'])document.body.addEventListener(eventName,event=>{
      if(eventName==='submit')event.preventDefault();
      const el=event.target instanceof Element ? event.target.closest('[id]') : null;
      if(el&&elements.get(el.id)===el){
        if(eventName==='input'||eventName==='change'){editRevision++;if(clearOutputs())announce(()=>'Results cleared. Check the updated input.');}
        send({type:'event',event:eventName,id:el.id});
      }
    });
    let labelFrame=false;
    const refreshViewportLabels=()=>{if(labelFrame||stopped)return;labelFrame=true;requestAnimationFrame(()=>{labelFrame=false;if(!stopped)refreshLabels();});};
    addEventListener('resize',refreshViewportLabels);
    addEventListener('scroll',refreshViewportLabels,{passive:true});
    addEventListener('pagehide',()=>stop('Preview closed.'),{once:true});
    send({type:'init'});
  })();`;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bootstrap)));
  const scriptHash = btoa(String.fromCharCode(...digest));
  const resourcePolicy = `default-src 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; connect-src 'none'; script-src 'sha256-${scriptHash}'; script-src-attr 'none'; worker-src blob:; style-src 'unsafe-inline'; img-src data:; font-src 'none'`;
  const csp = `${resourcePolicy}; frame-ancestors 'self'; sandbox allow-scripts`;
  // The response CSP applies before parsing; no inherited host CSP relaxation
  // or allow-same-origin sandbox permission is needed for this document.
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${resourcePolicy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${PREVIEW_STYLE}${timelineEnabled ? TIMELINE_STYLE : ''}</style>${serialize(head)}</head><body>${serialize(body)}<script>${bootstrap}</script></body></html>`,
    csp,
  };
}
