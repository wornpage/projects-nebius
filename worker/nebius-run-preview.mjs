import { parse, serialize } from 'parse5';
import { validateRunFiles } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const ALLOWED_TAGS = new Set(('html head body title style main header footer nav section article aside div span p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd a button input label select option optgroup textarea form fieldset legend output progress meter details summary table caption thead tbody tfoot tr th td colgroup col br hr strong em b i small s u sub sup code pre blockquote figure figcaption img time datalist').split(' '));
const ATTRIBUTES = new Set(('id class style title role lang dir hidden tabindex name type value placeholder min max step minlength maxlength required checked selected disabled readonly multiple for rows cols size width height alt scope colspan rowspan open datetime autocomplete inputmode pattern list start reversed wrap').split(' '));

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

/** Untrusted generated markup is never inserted into the host application. */
export async function renderRunPreview(rawFiles) {
  const files = validateRunFiles(rawFiles);
  const source = Object.fromEntries(files.map(file => [file.path, file.content]));
  const document = parse(source['index.html']);
  const root = document.childNodes.find(node => node.tagName === 'html');
  const head = root?.childNodes?.find(node => node.tagName === 'head');
  const body = root?.childNodes?.find(node => node.tagName === 'body');
  if (!head || !body) throw new TypeError('The generated page cannot be previewed.');
  sanitize(head);
  sanitize(body);
  // Only this fixed bridge has DOM access. Generated code runs in a Worker:
  // workers have no browsing context to navigate, and Blob workers inherit
  // this document's CSP (including connect-src none). No generated markup,
  // URL, event handler, CSS or script is accepted through the message bridge.
  const appBytes = new TextEncoder().encode(source['app.js']);
  const encoded = btoa(String.fromCharCode(...appBytes));
  const bootstrap = `(()=>{
    const elements = new Map(Array.from(document.body.querySelectorAll('[id]')).slice(0,200).map(el=>[el.id,el]));
    const status = document.createElement('p'); status.setAttribute('role','status'); document.body.append(status);
    const bytes = Uint8Array.from(atob("${encoded}"), c=>c.charCodeAt(0));
    const notify = state=>{if(parent!==window)parent.postMessage({type:'nebius-tool-preview',status:state},'*');};
    let worker;let url;
    try{url=URL.createObjectURL(new Blob([bytes], {type:'text/javascript'}));worker=new Worker(url);}
    catch{status.textContent='This browser could not start the tool preview.';notify('failed');return;}
    finally{if(url)URL.revokeObjectURL(url);}
    let timer; let stopped = false; let busy = false; let editRevision = 0; let activeRevision = 0;
    const pending = [];
    const stop = message=>{if(stopped)return;stopped=true;clearTimeout(timer);pending.length=0;worker.terminate();status.textContent=message;notify('failed');};
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
      if(activeRevision===editRevision)for(const patch of data.patches){
        if(!patch||typeof patch!=='object'||typeof patch.id!=='string')continue;
        const el=elements.get(patch.id);if(!el)continue;
        if(typeof patch.text==='string'&&patch.text.length<=16000)el.textContent=patch.text;
        if(typeof patch.value==='string'&&patch.value.length<=4000&&(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement))el.value=patch.value;
        if(typeof patch.disabled==='boolean'&&(el instanceof HTMLButtonElement||el instanceof HTMLInputElement||el instanceof HTMLSelectElement||el instanceof HTMLTextAreaElement))el.disabled=patch.disabled;
        if(typeof patch.hidden==='boolean')el.hidden=patch.hidden;
        if(el instanceof HTMLSelectElement&&Array.isArray(patch.options)&&patch.options.length<=100){
          const options=patch.options.filter(item=>item&&typeof item.value==='string'&&item.value.length<=500&&typeof item.label==='string'&&item.label.length<=500);
          el.replaceChildren(...options.map(item=>new Option(item.label,item.value)));
        }
      }
      notify('ready');busy=false;
      if(pending.length)dispatch(pending.shift());
    };
    for(const eventName of ['click','input','change','submit'])document.body.addEventListener(eventName,event=>{
      if(eventName==='submit')event.preventDefault();
      const el=event.target instanceof Element ? event.target.closest('[id]') : null;
      if(el&&elements.get(el.id)===el){
        if(eventName==='input'||eventName==='change')editRevision++;
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
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${resourcePolicy}"><meta name="viewport" content="width=device-width,initial-scale=1">${serialize(head)}</head><body>${serialize(body)}<script>${bootstrap}</script></body></html>`,
    csp,
  };
}
