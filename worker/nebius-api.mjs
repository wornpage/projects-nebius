import { PROMPT_VERSION, isRecord, providerFailureDetails, validateTask, validateSelectedContext, validateCurrentStatus, validateUpdate } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { REVIEW_VERSION, validateReviewInput } from '../svelte-frontend/src/lib/nebius-review-contract.mjs';
import { PLAN_VERSION, validatePlanInput, validatePlanningResult } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';
import { REPLAN_VERSION, validateReplanInput } from '../svelte-frontend/src/lib/nebius-replan-contract.mjs';
import { OPERATION_PROFILES } from '../svelte-frontend/src/lib/nebius-routing-contract.mjs';
import { InferenceError, nebiusConfiguration, suggestWithNebius, reviewWithNebius, planWithNebius, replanWithNebius } from './nebius-provider.mjs';

const fail = (status, code, message) => { throw new InferenceError(status, code, message); };
// Replan includes the complete 8-task snapshot. Its larger, independent cap
// accommodates 4,000-character criteria, including JSON escape expansion.
// Other operations retain their existing 49 KiB limit.
export const REPLAN_REQUEST_LIMIT = 524288;
async function readBody(request, limit = 49152) {
  if (!request.body) fail(400, 'invalid_request', 'Send a task preview.');
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) fail(413, 'invalid_request', 'Task preview is too large.');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof InferenceError) throw error;
    fail(400, 'invalid_request', 'Send a valid task preview.');
  } finally { reader.releaseLock(); }
}

// This edition has browser-local workspaces. The API validates a submitted
// preview; it does not claim to authenticate or own the browser's saved state.
export async function handleNebiusApi(request, env) {
  const requestId = crypto.randomUUID();
  let planningExpected = null;
  const json = (value, status = 200) => Response.json({ requestId, ...value }, {
    status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  });
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const configRequest = path === '/api/nebius/config' && request.method === 'GET';
    const suggestionRequest = path === '/api/nebius/suggest-next-step' && request.method === 'POST';
    const reviewRequest = path === '/api/nebius/review-evidence' && request.method === 'POST';
    const planRequest = path === '/api/nebius/plan-project' && request.method === 'POST';
    const replanRequest = path === '/api/nebius/replan-project' && request.method === 'POST';
    if (!configRequest && !suggestionRequest && !reviewRequest && !planRequest && !replanRequest) {
      return json({ code: 'not_found', error: 'Unknown inference operation.' }, 404);
    }
    if (env.NEBIUS_ENABLED !== 'true') return json({ available: false, code: 'nebius_disabled' }, 404);
    const configuredOrigin = env.NEBIUS_ALLOWED_ORIGIN;
    if (typeof configuredOrigin !== 'string' || !configuredOrigin || new URL(configuredOrigin).origin !== configuredOrigin) {
      fail(503, 'nebius_unavailable', 'Suggestions are not configured.');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.origin !== configuredOrigin
      || request.headers.get('sec-fetch-site') === 'cross-site'
      || (request.headers.has('origin') && request.headers.get('origin') !== configuredOrigin)
      || (!configRequest && request.headers.get('origin') !== configuredOrigin)) {
      fail(403, 'origin_refused', 'Use the configured app to request suggestions.');
    }
    let operation = path.slice('/api/nebius/'.length);
    if (configRequest) {
      const params = [...url.searchParams];
      if (params.length !== 1 || params[0][0] !== 'operation' || !Object.hasOwn(OPERATION_PROFILES, params[0][1])) {
        fail(400, 'invalid_request', 'Choose exactly one supported inference operation.');
      }
      operation = params[0][1];
    }
    const config = nebiusConfiguration(env, operation);
    const dailyLimit = typeof env.NEBIUS_DAILY_CALL_LIMIT === 'string' && /^[1-9][0-9]{0,4}$/u.test(env.NEBIUS_DAILY_CALL_LIMIT) ? Number(env.NEBIUS_DAILY_CALL_LIMIT) : NaN;
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit > 10000 || typeof env.NEBIUS_IP_RATE_LIMITER?.limit !== 'function'
      || !env.NEBIUS_BUDGET) fail(503, 'nebius_unavailable', 'Suggestion limits are not configured.');
    if (configRequest) return json({ available: true, operation, ...OPERATION_PROFILES[operation], requestedModel: config.model,
      ...(operation === 'plan-project' ? { groundingModel: config.model } : {}),
      promptVersion: PROMPT_VERSION, reviewVersion: REVIEW_VERSION, planVersion: PLAN_VERSION, replanVersion: REPLAN_VERSION });
    if (url.search || (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      fail(400, 'invalid_request', 'Send a JSON preview without query parameters.');
    }
    // Cloudflare supplies this header at the edge. A shared local bucket is
    // allowed only on an explicitly configured loopback development origin.
    const ip = request.headers.get('cf-connecting-ip') || (local ? 'local-development' : '');
    if (!ip || ip.length > 64) fail(503, 'nebius_unavailable', 'Request limits are unavailable.');
    const admission = await env.NEBIUS_IP_RATE_LIMITER.limit({ key: `nebius:${ip}` });
    if (admission?.success === false) fail(429, 'rate_limited', 'Wait before requesting another suggestion.');
    if (admission?.success !== true) fail(503, 'nebius_unavailable', 'Request limits are unavailable.');
    const body = await readBody(request, replanRequest ? REPLAN_REQUEST_LIMIT : 49152);
    const expectedKeys = suggestionRequest ? 'consent,context,currentStatus,pack,promptVersion,requestedModel,update'
      : replanRequest ? 'consent,promptVersion,requestedModel,snapshot,update'
      : planRequest ? 'brief,consent,promptVersion,requestedModel' : 'consent,pack,promptVersion,requestedModel,review';
    if (!isRecord(body) || Object.keys(body).sort().join(',') !== expectedKeys || body.consent !== true) {
      fail(400, 'invalid_request', 'Send the reviewed task and explicit consent.');
    }
    const promptVersion = replanRequest ? REPLAN_VERSION : suggestionRequest ? PROMPT_VERSION : planRequest ? PLAN_VERSION : REVIEW_VERSION;
    if (body.requestedModel !== config.model || body.promptVersion !== promptVersion) {
      fail(409, 'model_changed', 'Model settings changed. Reload the preview.');
    }
    let state;
    try {
      if (reviewRequest && (!isRecord(body.review) || Object.keys(body.review).sort().join(',') !== 'criteria,evidence')) {
        throw new TypeError('Review input keys are invalid.');
      }
      state = replanRequest ? validateReplanInput({ snapshot: body.snapshot, update: body.update }) : planRequest ? validatePlanInput({ brief: body.brief }) : suggestionRequest
        ? { pack: validateTask(body.pack), context: validateSelectedContext(body.context), currentStatus: validateCurrentStatus(body.currentStatus), update: validateUpdate(body.update) }
        : validateReviewInput({ pack: body.pack, criteria: body.review.criteria, evidence: body.review.evidence });
    }
    catch { fail(400, 'invalid_request', 'The task preview is invalid or exceeds its field limits.'); }
    const budget = env.NEBIUS_BUDGET.get(env.NEBIUS_BUDGET.idFromName('token-factory-daily'));
    let result;
    if (planRequest) {
      planningExpected = { requestId, brief: state.brief, model: config.model };
      result = await planWithNebius(config, state, { requestId, signal: request.signal,
        reserveCall: () => budget.reserve(dailyLimit) });
      return json(result);
    }
    const reserved = await budget.reserve(dailyLimit);
    if (reserved === false) fail(429, 'daily_limit', 'The demo has reached its daily generation limit.');
    if (reserved !== true) fail(503, 'nebius_unavailable', 'The daily limit is unavailable.');
    result = suggestionRequest ? await suggestWithNebius(config, state)
      : replanRequest ? await replanWithNebius(config, state) : await reviewWithNebius(config, state);
    return json({ ...result, requestedModel: config.model, promptVersion, applied: false });
  } catch (error) {
    if (error instanceof InferenceError) {
      if (error.planningResult && planningExpected) {
        const planningResult = await validatePlanningResult(error.planningResult, planningExpected);
        return json({ code: error.code, error: error.message, ...planningResult }, error.status);
      }
      return json({ code: error.code, error: error.message, ...(providerFailureDetails(error) ?? {}) }, error.status);
    }
    return json({ code: 'nebius_unavailable', error: 'Suggestions are unavailable. No task was changed.' }, 503);
  }
}
