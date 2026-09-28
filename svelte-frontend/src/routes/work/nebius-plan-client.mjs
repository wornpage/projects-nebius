import { PLAN_VERSION, validatePlanInput, validateProjectPlan } from '../../lib/nebius-plan-contract.mjs';
import { isOperationConfig } from '../../lib/nebius-routing-contract.mjs';

export const emptyPlanView = () => ({ phase: 'idle', config: null, plan: null, usage: null, error: '' });
const messages = {
  model_changed: 'Model settings changed. Reload settings before generating again.',
  rate_limited: 'Wait before requesting another plan.',
  daily_limit: 'The demo has reached its daily generation limit.',
  inference_timeout: 'Nebius did not finish in time. You can retry deliberately or outline manually.',
};
async function read(response) {
  if (response.status === 404) throw Object.assign(new Error('Unavailable'), { code: 'nebius_disabled' });
  let body;
  try { body = await response.json(); } catch { throw new Error('Invalid response'); }
  if (!response.ok) throw Object.assign(new Error('Request failed'), { code: body?.code });
  return body;
}

export function createPlanClient({ fetcher = globalThis.fetch, onChange }) {
  let brief = '', generation = 0, active = null, configGeneration = 0, activeConfig = null, disposed = false, view = emptyPlanView();
  const publish = next => { view = next; if (!disposed) onChange(next); };
  const cancel = () => { generation++; active?.abort(); active = null; };
  const current = token => !disposed && token === generation;
  const currentConfig = token => !disposed && token === configGeneration;
  const cancelConfig = () => { configGeneration++; activeConfig?.abort(); activeConfig = null; };
  const fail = (error, token, settings = false) => {
    if (!(settings ? currentConfig(token) : current(token))) return;
    publish({ ...emptyPlanView(), config: view.config, phase: error?.code === 'nebius_disabled' ? 'unavailable' : 'error',
      error: error?.code === 'nebius_disabled' ? 'Nebius planning is not configured. Manual outlining is available.'
        : messages[error?.code] || 'A plan is unavailable. Reload settings to try again, or choose manual outlining.' });
  };
  return {
    setBrief(nextBrief) {
      if (disposed || nextBrief === brief) return;
      brief = nextBrief; cancel();
      publish({ ...emptyPlanView(), config: view.config, phase: activeConfig ? 'loading' : view.config ? 'ready' : 'idle' });
    },
    async reload() {
      if (disposed) return;
      cancel(); cancelConfig(); const token = configGeneration;
      activeConfig = new AbortController(); publish({ ...emptyPlanView(), phase: 'loading' });
      try {
        const config = await read(await fetcher('/api/nebius/config?operation=plan-project', { cache: 'no-store', credentials: 'same-origin', signal: activeConfig.signal }));
        if (!currentConfig(token)) return;
        if (!isOperationConfig(config, 'plan-project') || config.planVersion !== PLAN_VERSION) throw new Error('Invalid settings');
        activeConfig = null;
        publish({ ...emptyPlanView(), phase: 'ready', config });
      } catch (error) { if (currentConfig(token)) activeConfig = null; fail(error, token, true); }
    },
    async generate() {
      if (disposed || !view.config || !['ready', 'error', 'complete'].includes(view.phase)) return;
      let input;
      try { input = validatePlanInput({ brief }); } catch (error) {
        publish({ ...view, phase: 'error', plan: null, usage: null, error: error.message }); return;
      }
      cancel(); const token = generation, config = view.config;
      active = new AbortController(); publish({ ...view, phase: 'generating', plan: null, usage: null, error: '' });
      try {
        const body = await read(await fetcher('/api/nebius/plan-project', {
          method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: active.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, requestedModel: config.requestedModel, promptVersion: PLAN_VERSION, consent: true }),
        }));
        if (!current(token)) return;
        if (body?.applied !== false || body.requestedModel !== config.requestedModel || body.model !== config.requestedModel
          || body.promptVersion !== PLAN_VERSION || typeof body.requestId !== 'string' || !body.requestId.trim()) throw new Error('Invalid plan identity');
        const plan = validateProjectPlan(body.plan), usage = body.usage;
        if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0 || !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0) throw new Error('Invalid usage');
        publish({ ...view, phase: 'complete', plan, usage });
      } catch (error) { fail(error, token); }
    },
    dispose() { disposed = true; cancel(); cancelConfig(); },
  };
}
