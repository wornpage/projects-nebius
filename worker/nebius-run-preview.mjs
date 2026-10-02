import { parse, serialize } from 'parse5';
import { validateRunFiles } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const ALLOWED_TAGS = new Set(('html head body title style main header footer nav section article aside div span p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd a button input label select option optgroup textarea form fieldset legend output progress meter details summary table caption thead tbody tfoot tr th td colgroup col br hr strong em b i small s u sub sup code pre blockquote figure figcaption img time datalist').split(' '));
const ATTRIBUTES = new Set(('id class style title role lang dir hidden tabindex name type value placeholder min max step minlength maxlength required checked selected disabled readonly multiple for rows cols size width height alt scope colspan rowspan open datetime autocomplete inputmode pattern list start reversed wrap').split(' '));

// Local preview defaults use the edition's public Wornpage palette. The first
// cascade layer keeps authored tool styling in control; no font or asset fetch
// is needed, and stored source is not changed.
const PREVIEW_STYLE = `@layer nebius-preview-base {
  :root { color-scheme: light; font: 100%/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2522; background: #f3f4f3; }
  *, ::before, ::after { box-sizing: border-box; }
  body { margin: 1rem; overflow-wrap: anywhere; }
  :where(h1, h2, h3, h4, h5, h6) { line-height: 1.25; margin-block: 0 1rem; }
  :where(h1) { font-size: clamp(1.5rem, 4vw, 2rem); }
  :where(label:not([hidden]), legend) { font-weight: 600; }
  :where(input, textarea, select, button) { font: inherit; }
  :where(input, textarea, select) { max-inline-size: 100%; min-inline-size: 0; border: 1px solid #b8bfba; border-radius: 6px; background: #fff; color: #1f2522; padding: .625rem; }
  :where(textarea) { width: 100%; min-height: 8rem; resize: vertical; }
  :where(pre, code, textarea) { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 1rem; line-height: 1.5; }
  :where(pre, output) { max-inline-size: 100%; white-space: pre-wrap; overflow-wrap: anywhere; }
  :where(output:not([hidden])) { display: block; }
  :where(button, input[type="button"], input[type="submit"], input[type="reset"], summary) { min-height: 44px; padding: .625rem .875rem; border: 1px solid #b8bfba; border-radius: 6px; background: #fff; color: #1f2522; cursor: pointer; }
  :where(button, input[type="button"], input[type="submit"], input[type="reset"]) { margin: .25rem .5rem .25rem 0; font-weight: 600; }
  :where(button:hover, summary:hover) { background: #eef1ef; }
  :where(button:disabled, input:disabled, select:disabled, textarea:disabled) { cursor: default; opacity: .65; }
  :where(a) { color: #0f766e; }
  :where(button, input, select, textarea, summary, a):focus-visible { outline: 3px solid #0f766e; outline-offset: 3px; }
  :where(fieldset) { min-inline-size: 0; border: 1px solid #d4d8d5; border-radius: 8px; }
  :where(details) { margin-block: 1rem; }
  :where(dt) { font-weight: 600; }
  :where(dd) { margin: 0 0 .75rem; }
  :where(img, table) { max-inline-size: 100%; }
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
export function runPageContract(rawFiles) {
  const files = validateRunFiles(rawFiles);
  const { body } = sanitizedPage(files.find(file => file.path === 'index.html').content);
  const elements = [], ids = new Set();
  function visit(node, ancestorDisabled = false) {
    if (!node.tagName) return;
    const attrs = Object.fromEntries((node.attrs || []).map(attr => [attr.name, attr.value]));
    const inputType = (attrs.type || 'text').toLowerCase();
    const valueControl = ['input', 'select', 'textarea'].includes(node.tagName);
    const disabled = ancestorDisabled || (['button', 'input', 'select', 'textarea', 'fieldset'].includes(node.tagName) && Object.hasOwn(attrs, 'disabled'));
    const action = node.tagName === 'button' || (node.tagName === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType));
    const readonly = Object.hasOwn(attrs, 'readonly') && (node.tagName === 'textarea'
      || (node.tagName === 'input' && !['hidden', 'range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file'].includes(inputType)));
    const requiresText = node.tagName === 'output' || (node.tagName === 'pre' && attrs['data-output'] === 'true');
    const control = ['button', 'input', 'select', 'textarea', 'form', 'output'].includes(node.tagName) || requiresText;
    if (control && !attrs.id) throw new TypeError('Every generated control and output needs an ID.');
    if (attrs.id) {
      if (attrs.id.length > 200 || ids.has(attrs.id)) throw new TypeError('Generated page IDs must be unique and bounded.');
      ids.add(attrs.id);
      if (ids.size > 200) throw new TypeError('The generated page exceeds its 200-element binding limit.');
      const editable = valueControl && !action && inputType !== 'hidden' && !disabled && !readonly;
      const fields = ['hidden'];
      if (['pre', 'output'].includes(node.tagName)) fields.push('text');
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
        format: attrs['data-input-format'] ?? null, exampleFor: attrs['data-example-for'] ?? null });
    }
    const legend = node.tagName === 'fieldset' ? node.childNodes?.find(child => child.tagName === 'legend') : null;
    const childDisabled = ancestorDisabled || (node.tagName === 'fieldset' && Object.hasOwn(attrs, 'disabled'));
    for (const child of node.childNodes || []) visit(child, child === legend ? ancestorDisabled : childDisabled);
  }
  for (const child of body.childNodes || []) visit(child);
  for (const element of elements) {
    if (element.exampleFor !== null && !elements.some(target => target.id === element.exampleFor && target.valueControl && !target.booleanValue)) {
      throw new TypeError('An example-loader target must be a declared text value control.');
    }
  }
  return { version: 1, elements };
}

/** Untrusted generated markup is never inserted into the host application. */
export async function renderRunPreview(rawFiles) {
  const files = validateRunFiles(rawFiles);
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
    const valueControl = el=>el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement;
    const textControl = el=>valueControl(el)&&!(el instanceof HTMLInputElement&&['checkbox','radio','button','submit','reset','image'].includes(el.type));
    const tidy = value=>String(value||'').replace(/\\s+/g,' ').trim().slice(0,200);
    const nameOf = (el,fallback)=>{
      const references=(el.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean);
      const author=tidy(references.map(id=>document.getElementById(id)?.textContent||'').join(' '))||tidy(el.getAttribute('aria-label'))||tidy(Array.from(el.labels||[]).map(label=>label.textContent).join(' '));
      return {text:author||fallback,authored:Boolean(author)};
    };
    const visible = el=>!el.closest('[hidden],[aria-hidden="true"]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility==='visible';
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
      if(!name.authored){const label=document.createElement('p');label.textContent=name.text;label.setAttribute('aria-hidden','true');el.before(label);outputLabels.set(el,label);}
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
    const refreshLabels=()=>{for(const [el,label] of outputLabels)label.hidden=!visible(el);};
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
      // A response computed before a newer field edit cannot overwrite that
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
        if(typeof patch.text==='string'&&patch.text.length<=16000&&(el.tagName==='PRE'||el.tagName==='OUTPUT')){outputs.add(el);presentOutput(el);el.textContent=patch.text;touchedOutputs.add(el);}
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
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${resourcePolicy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${PREVIEW_STYLE}</style>${serialize(head)}</head><body>${serialize(body)}<script>${bootstrap}</script></body></html>`,
    csp,
  };
}
