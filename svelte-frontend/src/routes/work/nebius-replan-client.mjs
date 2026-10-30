import { REPLAN_VERSION, validateReplanInput, validateProjectSnapshot, validateProjectReplan } from '../../lib/nebius-replan-contract.mjs';
import { isOperationConfig } from '../../lib/nebius-routing-contract.mjs';
import { providerFailureDetails } from '../../lib/nebius-contract.mjs';

export const emptyReplanView = () => ({ phase: 'idle', config: null, replan: null, usage: null, error: '', failure: null });
async function read(response) {
  if (response.status === 404) throw Object.assign(new Error('Unavailable'), { code: 'nebius_disabled' });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error('Request failed'), { code: body?.code, failure: providerFailureDetails(body) });
  return body;
}
export function createReplanClient({ fetcher = globalThis.fetch, onChange }) {
  let input = null, serial = 0, settingsSerial = 0, active = null, settings = null, disposed = false, view = emptyReplanView();
  const publish = next => { view = next; if (!disposed) onChange(next); };
  const cancel = () => { serial++; active?.abort(); active = null; };
  const current = token => !disposed && token === serial;
  const fail = error => publish({ ...emptyReplanView(), config: error?.code === 'model_changed' ? null : view.config, failure: error?.failure ?? null,
    phase: error?.code === 'nebius_disabled' ? 'unavailable' : 'error',
    error: error?.code === 'nebius_disabled' ? 'Nebius is unavailable here. You can edit the plan manually.'
      : error?.code === 'daily_limit' ? 'The daily generation limit has been reached.'
      : error?.code === 'rate_limited' ? 'Wait before requesting another proposal.'
      : error?.code === 'invalid_model_output' ? 'Nebius did not return usable changes. Nothing was saved.'
      : 'A proposal is unavailable. Check model settings or edit tasks yourself.' });
  return {
    setInput(snapshot, update) {
      if (disposed) return;
      input = snapshot ? { snapshot: validateProjectSnapshot(snapshot), update } : null;
      cancel(); publish({ ...emptyReplanView(), config: view.config, phase: settings ? 'loading' : view.config ? 'ready' : 'idle' });
    },
    async reload() {
      if (disposed) return;
      cancel(); settings?.abort(); const token = ++settingsSerial;
      settings = new AbortController(); publish({ ...emptyReplanView(), phase: 'loading' });
      try {
        const config = await read(await fetcher('/api/nebius/config?operation=replan-project', { cache: 'no-store', credentials: 'same-origin', signal: settings.signal }));
        if (disposed || token !== settingsSerial) return;
        if (!isOperationConfig(config, 'replan-project') || config.replanVersion !== REPLAN_VERSION) throw new Error('Invalid settings');
        settings = null; publish({ ...emptyReplanView(), phase: 'ready', config });
      } catch (error) { if (!disposed && token === settingsSerial) { settings = null; fail(error); } }
    },
    async generate(consent) {
      if (disposed || consent !== true || !view.config || !['ready', 'error', 'complete'].includes(view.phase)) return;
      let submitted;
      try { submitted = validateReplanInput(input); }
      catch (error) { publish({ ...view, phase: 'error', replan: null, failure: null, error: error.message }); return; }
      cancel(); const token = serial, config = view.config;
      active = new AbortController(); publish({ ...view, phase: 'generating', replan: null, usage: null, failure: null, error: '' });
      try {
        const body = await read(await fetcher('/api/nebius/replan-project', {
          method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: active.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...submitted, requestedModel: config.requestedModel, promptVersion: REPLAN_VERSION, consent: true }),
        }));
        if (!current(token)) return;
        if (body?.applied !== false || body.requestedModel !== config.requestedModel || body.model !== config.requestedModel
          || body.promptVersion !== REPLAN_VERSION || typeof body.requestId !== 'string' || !body.requestId.trim()) throw new Error('Invalid identity');
        const replan = validateProjectReplan(body.replan, submitted.snapshot), usage = body.usage;
        if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0) throw new Error('Invalid usage');
        publish({ ...view, phase: 'complete', replan, usage });
      } catch (error) { if (current(token)) fail(error); }
    },
    dispose() { disposed = true; cancel(); settingsSerial++; settings?.abort(); settings = null; },
  };
}
