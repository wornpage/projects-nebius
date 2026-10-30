import { PLAN_VERSION, validatePlanInput, validatePlanningResult } from '../../lib/nebius-plan-contract.mjs';
import { isOperationConfig } from '../../lib/nebius-routing-contract.mjs';
import { providerFailureDetails } from '../../lib/nebius-contract.mjs';

export const emptyPlanView = () => ({ phase: 'idle', config: null, plan: null, usage: null, planningResult: null, error: '', failure: null });
const messages = {
  model_changed: 'Model settings changed. Check model settings before generating again.',
  rate_limited: 'Wait before requesting another plan.',
  daily_limit: 'The demo has reached its daily generation limit.',
  invalid_model_output: 'Nebius did not return a reviewable plan. You can change the brief or outline manually.',
  inference_timeout: 'Nebius did not finish in time. You can retry deliberately or outline manually.',
};
async function read(response, planning = false) {
  if (response.status === 404 && !planning) throw Object.assign(new Error('Unavailable'), { code: 'nebius_disabled' });
  let body;
  try { body = await response.json(); } catch { throw new Error('Invalid response'); }
  if (response.status === 404 && !Object.hasOwn(body ?? {}, 'outcome')) throw Object.assign(new Error('Unavailable'), { code: 'nebius_disabled' });
  if (!response.ok && !planning) throw Object.assign(new Error('Request failed'), { code: body?.code, failure: providerFailureDetails(body) });
  return planning ? { body, ok: response.ok } : body;
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
    publish({ ...emptyPlanView(), config: view.config, failure: error?.failure ?? null, planningResult: error?.planningResult ?? null, phase: error?.code === 'nebius_disabled' ? 'unavailable' : 'error',
      error: error?.code === 'nebius_disabled' ? 'Nebius planning is not configured. Manual outlining is available.'
        : messages[error?.code] || 'A plan is unavailable. Check model settings or write the plan yourself.' });
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
      if (disposed || !view.config || !['ready', 'error', 'blocked', 'complete'].includes(view.phase)) return;
      let input;
      try { input = validatePlanInput({ brief }); } catch (error) {
        publish({ ...emptyPlanView(), config: view.config, phase: 'error', error: error.message }); return;
      }
      cancel(); const token = generation, config = view.config;
      active = new AbortController(); publish({ ...emptyPlanView(), config, phase: 'generating' });
      try {
        const { body, ok } = await read(await fetcher('/api/nebius/plan-project', {
          method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: active.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, requestedModel: config.requestedModel, promptVersion: PLAN_VERSION, consent: true }),
        }), true);
        if (!current(token)) return;
        if (!ok && !Object.hasOwn(body ?? {}, 'outcome')) {
          throw Object.assign(new Error('Request failed'), { code: body?.code, failure: providerFailureDetails(body) });
        }
        const planningResult = await validatePlanningResult(body, { brief: input.brief, model: config.requestedModel });
        // Digest validation is asynchronous. A newer input or cancellation wins.
        if (!current(token)) return;
        if (!ok) {
          if (planningResult.outcome !== 'failed') throw new Error('Invalid error outcome');
          throw Object.assign(new Error('Planning failed'), { code: body.code, planningResult });
        }
        if (planningResult.outcome === 'failed') throw new Error('Invalid success outcome');
        active = null;
        publish({ ...emptyPlanView(), config, planningResult, phase: planningResult.outcome === 'blocked' ? 'blocked' : 'complete',
          plan: planningResult.plan, usage: planningResult.usage,
          error: planningResult.outcome === 'blocked' ? 'The model review did not clear this draft. Change the brief or outline manually.' : '' });
      } catch (error) { fail(error, token); }
    },
    cancel() {
      if (disposed) return;
      cancel(); publish({ ...emptyPlanView(), config: view.config, phase: view.config ? 'ready' : 'idle' });
    },
    dispose() { disposed = true; cancel(); cancelConfig(); view = emptyPlanView(); },
  };
}
