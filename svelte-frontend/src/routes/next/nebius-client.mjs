import { PROMPT_VERSION, projectTask, validModelId, providerFailureDetails, validateSelectedContext, validateSuggestionText, validateCurrentStatus, validateUpdate } from '../../lib/nebius-contract.mjs';
import { isOperationConfig } from '../../lib/nebius-routing-contract.mjs';
export const emptySuggestionView = () => ({ phase: 'hidden', task: null, currentStatus: null, update: '', config: null, result: null, error: '', failure: null });
const messages = {
  model_changed: 'The model settings changed. Reload the preview.',
  rate_limited: 'Wait before requesting another suggestion.',
  daily_limit: 'The demo has reached its daily generation limit.',
  invalid_model_output: 'Nebius did not return usable task changes. Your draft is unchanged.',
  inference_timeout: 'Nebius did not finish in time. Reload the preview before trying again.',
};
async function read(response) {
  if (response.status === 404) throw Object.assign(new Error('disabled'), { code: 'nebius_disabled' });
  let body;
  try { body = await response.json(); } catch { throw new Error('Invalid response'); }
  if (!response.ok) throw Object.assign(new Error('Request failed'), { code: body?.code, failure: providerFailureDetails(body) });
  return body;
}
export function createSuggestionClient({ fetcher = globalThis.fetch, onChange }) {
  let task = null, context = [], currentStatus = null, update = '', scopeKey = '', selectionKey = '', generation = 0, active = null, disposed = false;
  let view = emptySuggestionView();
  const publish = next => { view = next; if (!disposed) onChange(next); };
  const clear = () => { generation++; active?.abort(); active = null; publish(emptySuggestionView()); };
  const current = token => !disposed && generation === token;
  const failed = (error, token) => {
    if (!current(token)) return;
    publish(error?.code === 'nebius_disabled' ? { ...emptySuggestionView(), phase: 'unavailable' } : {
      ...emptySuggestionView(), phase: 'error', failure: error?.failure ?? null, error: messages[error?.code] || 'A suggestion is unavailable. Reload the preview to try again.',
    });
  };
  async function load() {
    if (disposed || !task) return;
    clear(); const token = generation, selected = { ...task }, selectedStatus = currentStatus, selectedUpdate = update;
    active = new AbortController(); publish({ ...emptySuggestionView(), phase: 'loading' });
    try {
      const config = await read(await fetcher('/api/nebius/config?operation=suggest-next-step', { cache: 'no-store', credentials: 'same-origin', signal: active.signal }));
      if (!current(token)) return;
      if (!isOperationConfig(config, 'suggest-next-step') || config.promptVersion !== PROMPT_VERSION) throw new Error('Invalid model settings');
      publish({ ...emptySuggestionView(), phase: 'ready', task: selected, currentStatus: selectedStatus, update: selectedUpdate, config });
    } catch (error) { failed(error, token); }
  }
  async function generate() {
    if (disposed || view.phase !== 'ready' || !view.config || !view.task) return;
    const token = generation, config = view.config, selected = { ...view.task };
    const selectedContext = context.map(item => ({ ...item })), selectedStatus = view.currentStatus, selectedUpdate = view.update;
    active?.abort(); active = new AbortController();
    publish({ ...view, phase: 'generating', result: null, error: '' });
    try {
      const body = await read(await fetcher('/api/nebius/suggest-next-step', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: active.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack: selected, context: selectedContext, currentStatus: selectedStatus, update: selectedUpdate, requestedModel: config.requestedModel, promptVersion: PROMPT_VERSION, consent: true }),
      }));
      if (!current(token)) return;
      if (body?.applied !== false || body.requestedModel !== config.requestedModel || body.model !== config.requestedModel || body.promptVersion !== PROMPT_VERSION) throw new Error('Invalid suggestion identity');
      const result = validateSuggestionText(body.suggestion, { pack: selected, context: selectedContext, currentStatus: selectedStatus, update: selectedUpdate });
      const usage = body.usage;
      if (!Number.isSafeInteger(usage?.input_tokens) || usage.input_tokens < 0
        || !Number.isSafeInteger(usage?.output_tokens) || usage.output_tokens < 0) throw new Error('Invalid usage');
      publish({ ...view, phase: 'complete', result, usage });
    } catch (error) { failed(error, token); }
  }
  return {
    setTask(key, pack, selectedContext = [], selectedUpdate = '') {
      if (disposed) return Promise.resolve();
      let projected, projectedContext, projectedStatus, projectedUpdate, fingerprint;
      try {
        if (pack) {
          projected = projectTask(pack); projectedContext = validateSelectedContext(selectedContext);
          projectedStatus = validateCurrentStatus(pack.status); projectedUpdate = validateUpdate(selectedUpdate);
        }
        fingerprint = JSON.stringify([projected, projectedContext, projectedStatus, projectedUpdate]);
      } catch {
        scopeKey = key; selectionKey = ''; task = null; context = []; currentStatus = null; update = '';
        generation++; active?.abort(); active = null;
        publish({ ...emptySuggestionView(), phase: 'error', error: 'This work item exceeds the preview limits or has invalid fields.' });
        return Promise.resolve();
      }
      if (key === scopeKey && fingerprint === selectionKey) return Promise.resolve();
      const retainedConfig = view.config;
      scopeKey = key; selectionKey = fingerprint; generation++; active?.abort(); active = null;
      publish(emptySuggestionView());
      task = projected ?? null; context = projectedContext ?? []; currentStatus = projectedStatus ?? null; update = projectedUpdate ?? '';
      if (!pack) return Promise.resolve();
      if (retainedConfig?.promptVersion === PROMPT_VERSION && validModelId(retainedConfig.requestedModel)) {
        publish({ ...emptySuggestionView(), phase: 'ready', task: { ...task }, currentStatus, update, config: retainedConfig });
        return Promise.resolve();
      }
      return load();
    },
    reload: load, generate,
    dispose() { disposed = true; clear(); task = null; },
  };
}
