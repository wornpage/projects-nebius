import { DurableObject } from 'cloudflare:workers';
import {
  RUN_LIMITS, RUN_VERSION, RUN_RECORD_FORMAT, RUN_EVIDENCE_LIMITS, TERMINAL_RUN_STATUSES, runFilesDigest, runJsonBytes, runSnapshotFromRecord,
  validRunId, validRunKey, validateRunInput, validateRunIntegrity, validateRunRecord,
} from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { RunProviderError, generateRunFiles, runModelConfiguration } from './nebius-run-provider.mjs';
import { SandboxError, cancelSandboxOperation, readSandboxOperation, sandboxConfiguration, spawnSandbox } from './nebius-sandbox.mjs';
import { renderRunPreview, runPageContract } from './nebius-run-preview.mjs';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_MS = 1500;
const MAX_JSON_BYTES = 131072;
const PHASES = new Set(['model-ready', 'model-submitting', 'sandbox-ready', 'sandbox-submitting', 'sandbox-polling', 'retained']);
const remainingMs = (state, maximum) => Math.max(1, Math.min(maximum, state.deadline - Date.now()));

class RunApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const fail = (status, code, message) => { throw new RunApiError(status, code, message); };
const nowIso = () => new Date().toISOString();
const nextIso = previous => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
const responseHeaders = { 'cache-control': 'private, no-store', 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...responseHeaders, ...extra } });

function publicError(error) {
  if (error instanceof RunApiError) return json({ code: error.code, error: error.message }, error.status);
  return json({ code: 'execution_unavailable', error: 'Task execution is temporarily unavailable.' }, 503);
}

function configuredOrigin(env, requestUrl) {
  const value = env.NEBIUS_ALLOWED_ORIGIN;
  try {
    if (typeof value !== 'string' || !value || new URL(value).origin !== value) throw new Error();
    return value;
  } catch { return requestUrl.origin; }
}

function assertSameOrigin(request, env) {
  const url = new URL(request.url);
  const origin = configuredOrigin(env, url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.origin !== origin
    || request.headers.get('sec-fetch-site') === 'cross-site'
    || (request.headers.has('origin') && request.headers.get('origin') !== origin)
    || (request.method !== 'GET' && request.headers.get('origin') !== origin)) {
    fail(403, 'origin_refused', 'Use the configured app to access this run.');
  }
  return { url, local };
}

function parsePositiveLimit(value, maximum = 10000) {
  return typeof value === 'string' && /^[1-9][0-9]{0,4}$/u.test(value) && Number(value) <= maximum ? Number(value) : NaN;
}

function startConfiguration(env) {
  if (env.NEBIUS_EXECUTION_ENABLED !== 'true') fail(404, 'execution_disabled', 'Task execution is not configured here.');
  try {
    if (typeof env.NEBIUS_ALLOWED_ORIGIN !== 'string' || !env.NEBIUS_ALLOWED_ORIGIN
      || new URL(env.NEBIUS_ALLOWED_ORIGIN).origin !== env.NEBIUS_ALLOWED_ORIGIN) throw new Error();
  } catch { fail(503, 'execution_unavailable', 'Task execution origin is not configured.'); }
  const requestedModel = env.NEBIUS_MODEL_REASONING;
  runModelConfiguration(env, requestedModel);
  sandboxConfiguration(env);
  const dailyRunLimit = parsePositiveLimit(env.NEBIUS_DAILY_RUN_LIMIT);
  const dailyCallLimit = parsePositiveLimit(env.NEBIUS_DAILY_CALL_LIMIT);
  if (!Number.isSafeInteger(dailyRunLimit) || !Number.isSafeInteger(dailyCallLimit)
    || typeof env.NEBIUS_IP_RATE_LIMITER?.limit !== 'function' || !env.NEBIUS_RUNS || !env.NEBIUS_RUN_BUDGET || !env.NEBIUS_BUDGET) {
    fail(503, 'execution_unavailable', 'Task execution limits are not configured.');
  }
  return { requestedModel, dailyRunLimit, dailyCallLimit };
}

async function readBoundedBody(request, maximum) {
  if (!request.body) fail(400, 'invalid_request', 'Send a request body.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, body = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) fail(413, 'request_too_large', 'The run request is too large.');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof RunApiError) throw error;
    fail(400, 'invalid_request', 'The run request body is invalid.');
  } finally { reader.releaseLock(); }
}

function bearerKey(request) {
  const match = /^Bearer ([0-9a-f]{64})$/u.exec(request.headers.get('authorization') || '');
  if (!match || !validRunKey(match[1])) fail(401, 'run_unauthorized', 'Provide this run’s access key.');
  return match[1];
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function runStub(env, id) { return env.NEBIUS_RUNS.getByName(id); }

function assertRecordFormat(request) {
  if (request.headers.get('x-nebius-run-format') !== RUN_RECORD_FORMAT) {
    // Cached clients already treat invalid_request as a definitive rejection.
    // Reject before admission so an old parser never spends a run it cannot read.
    fail(400, 'invalid_request', 'Task execution was updated. Reload this page to use the current run format.');
  }
}

function rpcResult(result) {
  if (!result?.ok) fail(result?.status || 503, result?.code || 'execution_unavailable', result?.error || 'Task execution is temporarily unavailable.');
  return result.run;
}

async function handlePreview(request, env, id) {
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    fail(400, 'invalid_request', 'Send the run access key as form data.');
  }
  const body = await readBoundedBody(request, 100);
  const params = [...new URLSearchParams(body)];
  if (params.length !== 1 || params[0][0] !== 'key' || !validRunKey(params[0][1])) fail(401, 'run_unauthorized', 'Provide this run’s access key.');
  const run = rpcResult(await runStub(env, id).read(params[0][1]));
  if (run.status !== 'ready') fail(409, 'run_not_ready', 'The isolated preview is available only after checks pass.');
  const rendered = await renderRunPreview(run.files);
  return new Response(rendered.html, { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'content-security-policy': rendered.csp,
    'x-frame-options': 'SAMEORIGIN', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  } });
}

export async function handleNebiusRuns(request, env) {
  try {
    const { url, local } = assertSameOrigin(request, env);
    if (url.search) fail(400, 'invalid_request', 'Run endpoints do not accept query parameters.');
    if (url.pathname === '/api/nebius/runs/config') {
      if (request.method !== 'GET') fail(405, 'method_not_allowed', 'Use GET for run configuration.');
      assertRecordFormat(request);
      if (env.NEBIUS_EXECUTION_ENABLED !== 'true') return json({ available: false, code: 'execution_disabled', error: 'Task execution is not configured here.' }, 404);
      const config = startConfiguration(env);
      return json({ available: true, version: RUN_VERSION, requestedModel: config.requestedModel, limits: RUN_LIMITS });
    }
    const match = /^\/api\/nebius\/runs\/([^/]+)(\/preview)?$/u.exec(url.pathname);
    if (!match || !validRunId(match[1])) fail(404, 'not_found', 'Run not found.');
    const id = match[1];
    if (match[2]) {
      if (request.method !== 'POST') fail(405, 'method_not_allowed', 'Use POST for isolated preview.');
      return await handlePreview(request, env, id);
    }
    assertRecordFormat(request);
    if (request.method === 'GET') return json({ run: rpcResult(await runStub(env, id).read(bearerKey(request))) });
    if (request.method === 'DELETE') return json({ run: rpcResult(await runStub(env, id).cancel(bearerKey(request))) });
    if (request.method !== 'POST') fail(405, 'method_not_allowed', 'Use POST, GET or DELETE for a run.');
    if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
      fail(400, 'invalid_request', 'Send the reviewed run input as JSON.');
    }
    const bodyText = await readBoundedBody(request, MAX_JSON_BYTES);
    let input;
    try { input = validateRunInput(JSON.parse(bodyText)); }
    catch { fail(400, 'invalid_request', 'The reviewed run input is invalid or exceeds its limits.'); }
    const key = bearerKey(request);
    const stub = runStub(env, id);
    const existing = await stub.inspectStart(id, input, key);
    if (!existing?.ok) fail(existing?.status || 503, existing?.code || 'execution_unavailable', existing?.error || 'Task execution is temporarily unavailable.');
    if (existing.exists) return json({ run: existing.run });
    const config = startConfiguration(env);
    if (input.requestedModel !== config.requestedModel) fail(409, 'model_changed', 'Model settings changed. Reload the run preview.');
    const ip = request.headers.get('cf-connecting-ip') || (local ? 'local-development' : '');
    if (!ip || ip.length > 64) fail(503, 'execution_unavailable', 'Run admission limits are unavailable.');
    const rateKey = await sha256Hex(`nebius-run:${ip}`);
    const admission = await env.NEBIUS_IP_RATE_LIMITER.limit({ key: rateKey });
    if (admission?.success === false) fail(429, 'rate_limited', 'Wait before starting another task run.');
    if (admission?.success !== true) fail(503, 'execution_unavailable', 'Run admission limits are unavailable.');
    const runBudget = env.NEBIUS_RUN_BUDGET.getByName('token-factory-runs-daily');
    const runReserved = await runBudget.reserve(id, config.dailyRunLimit);
    if (runReserved === false) fail(429, 'daily_limit', 'The demo has reached its daily task run limit.');
    if (runReserved !== true) fail(503, 'execution_unavailable', 'Run admission limits are unavailable.');
    const started = await stub.startAdmitted(id, input, key, crypto.randomUUID(), config.dailyCallLimit);
    if (!started?.ok) fail(started?.status || 503, started?.code || 'execution_unavailable', started?.error || 'Task execution is temporarily unavailable.');
    return json({ run: started.run }, started.created ? 202 : 200);
  } catch (error) { return publicError(error); }
}

function safeMessage(error, fallback) {
  const message = typeof error === 'string' ? error : error instanceof Error && typeof error.message === 'string' ? error.message : fallback;
  return message.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 500) || fallback;
}

function constantTimeHexEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== 64 || right.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function addEvent(record, message, at = null) {
  const timestamp = at === null ? nextIso(record.updatedAt) : at;
  return { ...record, updatedAt: timestamp, events: [...record.events, { at: timestamp, message: message.slice(0, 240) }].slice(-24) };
}

function failureDetails(error, phase, stage) {
  if (error === null) return null;
  const known = error instanceof RunProviderError || error instanceof SandboxError || error instanceof RunApiError;
  return {
    code: known ? error.code : 'execution_failed',
    stage: error instanceof RunProviderError && error.stage ? error.stage : error instanceof SandboxError ? 'sandbox'
      : stage || (phase.startsWith('model-') ? 'generation' : phase.startsWith('sandbox-') ? 'sandbox' : 'orchestration'),
  };
}

function retainModelUsage(state, observed) {
  if (!state.usageBase) return state;
  const base = state.usageBase;
  // Older in-flight records stored only the two totals in usageBase.
  const totalsComplete = typeof base.totalsComplete === 'boolean' ? base.totalsComplete
    : base.inputTokens !== null && base.outputTokens !== null;
  return { ...state, usageBase: null, record: { ...addEvent(state.record, 'Recorded provider-reported token usage.'), usage: {
    modelCalls: state.record.usage.modelCalls,
    inputTokens: base.inputTokens === null ? observed.inputTokens : base.inputTokens + observed.inputTokens,
    outputTokens: base.outputTokens === null ? observed.outputTokens : base.outputTokens + observed.outputTokens,
    totalsComplete,
  } } };
}

function retainGeneration(state, response, error = null) {
  if (!response) return state;
  if (state.record.generationAttempts.some(entry => entry.attempt === state.record.usage.modelCalls)) return state;
  const entry = { attempt: state.record.usage.modelCalls, outcome: error ? 'rejected' : 'accepted', ...response,
    diagnostic: error ? { ...failureDetails(error, state.phase), message: safeMessage(error, 'Source validation failed.') } : null };
  // Reserve space for two bounded Sandbox outputs and remaining run events.
  // Earlier evidence is immutable; omit the new text explicitly if needed.
  let record = { ...state.record, generationAttempts: [...state.record.generationAttempts, entry] };
  if (runJsonBytes(record) > RUN_EVIDENCE_LIMITS.recordBytes - 114688) {
    entry.responseText = null;
    entry.retention = 'size_limit';
  }
  return { ...state, record: validateRunRecord(record) };
}

const sourceRejection = error => error instanceof RunProviderError && !error.uncertain
  && ['tool_files', 'tool_page', 'tool_worker', 'tool_checks', 'preview'].includes(error.stage);

async function validateGeneratedPreview(files) {
  try {
    const page = runPageContract(files);
    const missing = page.elements.filter(element => element.textValue && element.format === null);
    if (missing.length) throw new TypeError('Every textual input needs an explicit data-input-format="text" or "json" declaration. Missing: ' + missing.map(element => element.id).join(', '));
    await renderRunPreview(files);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new RunProviderError('invalid_model_output', safeMessage(error, 'The generated page could not be prepared for preview.'), false, 'preview');
  }
}

function terminalState(state, status, message, error = null, stage = null) {
  const at = nextIso(state.record.updatedAt);
  let usage = state.record.usage;
  // A pre-diagnostics in-flight repair cleared totals but retained the first
  // call in usageBase. Recover that known subtotal when the run stops; the
  // interrupted call remains unknown. No first-call zero is invented.
  if (state.phase === 'model-submitting' && state.usageBase && usage.modelCalls > 1) {
    usage = { ...usage,
      inputTokens: usage.inputTokens === null ? state.usageBase.inputTokens : usage.inputTokens,
      outputTokens: usage.outputTokens === null ? state.usageBase.outputTokens : usage.outputTokens,
      totalsComplete: false,
    };
  }
  return { ...state, phase: 'retained', retentionAt: Date.parse(state.record.createdAt) + RETENTION_MS,
    record: { ...addEvent(state.record, message, at), status, usage, error: error === null ? null : safeMessage(error, 'The run stopped.'),
      failure: failureDetails(error, state.phase, stage) } };
}

export class NebiusRun extends DurableObject {
  async load() {
    const state = await this.ctx.storage.get('state');
    if (state === undefined) return null;
    if (!state || typeof state !== 'object' || !PHASES.has(state.phase)) throw new Error('Invalid run state.');
    return { ...state, record: await validateRunIntegrity(state.record) };
  }

  async save(state, alarmAt = null) {
    await this.ctx.storage.put('state', state);
    if (alarmAt !== null) await this.ctx.storage.setAlarm(alarmAt);
  }

  async ensureAlarm(state) {
    if (await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(state.phase === 'retained' ? state.retentionAt : Date.now() + 100);
    }
  }

  async authorize(key) {
    if (!validRunKey(key)) return { state: null, error: { ok: false, status: 401, code: 'run_unauthorized', error: 'Provide this run’s access key.' } };
    const suppliedHash = await sha256Hex(key);
    const state = await this.load();
    if (!state) return { state: null, error: { ok: false, status: 404, code: 'not_found', error: 'Run not found.' } };
    if (!constantTimeHexEqual(state.accessHash, suppliedHash)) return { state: null, error: { ok: false, status: 401, code: 'run_unauthorized', error: 'Provide this run’s access key.' } };
    return { state, error: null };
  }

  async inspectStart(id, rawInput, key) {
    let input;
    try { input = validateRunInput(rawInput); }
    catch { return { ok: false, status: 400, code: 'invalid_request', error: 'The reviewed run input is invalid.' }; }
    if (!validRunId(id) || !validRunKey(key)) {
      return { ok: false, status: 400, code: 'invalid_request', error: 'The run admission request is invalid.' };
    }
    const [accessHash, inputDigest] = await Promise.all([sha256Hex(key), sha256Hex(JSON.stringify(input))]);
    const existing = await this.load();
    if (!existing) return { ok: true, exists: false };
    if (!constantTimeHexEqual(existing.accessHash, accessHash)) return { ok: false, status: 409, code: 'run_conflict', error: 'This run ID is already in use.' };
    if (!constantTimeHexEqual(existing.inputDigest, inputDigest)) return { ok: false, status: 409, code: 'run_conflict', error: 'This run already has a different reviewed input.' };
    await this.ensureAlarm(existing);
    return { ok: true, exists: true, run: existing.record };
  }

  async startAdmitted(id, rawInput, key, admissionId, dailyCallLimit) {
    let input;
    try { input = validateRunInput(rawInput); }
    catch { return { ok: false, status: 400, code: 'invalid_request', error: 'The reviewed run input is invalid.' }; }
    if (!validRunId(id) || !validRunKey(key) || !validRunId(admissionId) || !Number.isSafeInteger(dailyCallLimit)) {
      return { ok: false, status: 400, code: 'invalid_request', error: 'The admitted run request is invalid.' };
    }
    const [accessHash, inputDigest] = await Promise.all([sha256Hex(key), sha256Hex(JSON.stringify(input))]);
    const at = nowIso();
    const { consent, ...snapshot } = input;
    const record = validateRunRecord({ id, ...snapshot, status: 'queued', attempt: 0, createdAt: at, updatedAt: at,
      events: [{ at, message: 'Run queued with the reviewed task snapshot.' }], files: [], checks: [],
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, totalsComplete: true }, error: null, failure: null });
    const state = { record, accessHash, inputDigest, phase: 'model-ready', operationId: null, sourceDigest: null,
      deadline: Date.now() + RUN_LIMITS.runSeconds * 1000, cancelRequested: false, cancelSubmitted: false,
      retentionAt: null, dailyCallLimit, admissionId, usageBase: null };
    let result;
    await this.ctx.storage.transaction(async transaction => {
      const existing = await transaction.get('state');
      if (existing) {
        existing.record = validateRunRecord(existing.record);
        result = !constantTimeHexEqual(existing.accessHash, accessHash)
          ? { ok: false, status: 409, code: 'run_conflict', error: 'This run ID is already in use.' }
          : !constantTimeHexEqual(existing.inputDigest, inputDigest)
            ? { ok: false, status: 409, code: 'run_conflict', error: 'This run already has a different reviewed input.' }
            : { ok: true, created: false, run: existing.record };
        return;
      }
      await transaction.put('state', state);
      result = { ok: true, created: true, run: record };
    });
    if (result?.ok) await validateRunIntegrity(result.run);
    if (result.created) await this.ctx.storage.setAlarm(Date.now() + 100);
    return result;
  }

  async read(key) {
    const { state, error } = await this.authorize(key);
    if (error) return error;
    await this.ensureAlarm(state);
    return { ok: true, run: state.record };
  }

  async cancel(key) {
    if (!validRunKey(key)) return { ok: false, status: 401, code: 'run_unauthorized', error: 'Provide this run’s access key.' };
    const suppliedHash = await sha256Hex(key);
    let result, alarmAt = null;
    await this.ctx.storage.transaction(async transaction => {
      const state = await transaction.get('state');
      if (!state) { result = { ok: false, status: 404, code: 'not_found', error: 'Run not found.' }; return; }
      state.record = validateRunRecord(state.record);
      if (!constantTimeHexEqual(state.accessHash, suppliedHash)) {
        result = { ok: false, status: 401, code: 'run_unauthorized', error: 'Provide this run’s access key.' };
        return;
      }
      if (TERMINAL_RUN_STATUSES.includes(state.record.status)) { result = { ok: true, run: state.record }; return; }
      if (!state.operationId && !['model-submitting', 'sandbox-submitting'].includes(state.phase)) {
        const done = terminalState({ ...state, cancelRequested: true }, 'cancelled', 'Run cancelled before another provider operation started.');
        validateRunRecord(done.record);
        await transaction.put('state', done);
        alarmAt = done.retentionAt;
        result = { ok: true, run: done.record };
        return;
      }
      const updated = { ...state, cancelRequested: true, record: { ...addEvent(state.record, 'Cancellation requested. Provider confirmation is pending.'), status: 'cancelling' } };
      validateRunRecord(updated.record);
      await transaction.put('state', updated);
      alarmAt = Date.now() + 100;
      result = { ok: true, run: updated.record };
    });
    if (result?.ok) await validateRunIntegrity(result.run);
    if (alarmAt !== null) await this.ctx.storage.setAlarm(alarmAt);
    return result;
  }

  async finish(state, status, event, error = null, stage = null) {
    const candidate = terminalState(state, status, event, error, stage);
    await validateRunIntegrity(candidate.record);
    let saved = null;
    await this.ctx.storage.transaction(async transaction => {
      const current = await transaction.get('state');
      if (!current) return;
      current.record = validateRunRecord(current.record);
      if (current.phase === 'retained') { saved = current; return; }
      if (current.phase !== state.phase || current.operationId !== state.operationId || current.inputDigest !== state.inputDigest) {
        saved = current;
        return;
      }
      const cancelled = current.cancelRequested && status !== 'uncertain';
      const at = nextIso(current.record.updatedAt);
      const terminalEvent = cancelled
        ? { at, message: 'Cancellation completed after the in-flight provider step returned.' }
        : { at, message: candidate.record.events.at(-1).message };
      const record = validateRunRecord({ ...candidate.record, status: cancelled ? 'cancelled' : status, updatedAt: at,
        error: cancelled ? null : candidate.record.error, failure: cancelled ? null : candidate.record.failure,
        events: [...current.record.events, terminalEvent].slice(-24) });
      saved = { ...candidate, cancelRequested: current.cancelRequested || candidate.cancelRequested,
        cancelSubmitted: current.cancelSubmitted || candidate.cancelSubmitted, record };
      await transaction.put('state', saved);
    });
    if (saved?.phase === 'retained') await this.ctx.storage.setAlarm(saved.retentionAt);
    return saved;
  }

  async reserveInference(state, attempt) {
    const budget = this.env.NEBIUS_BUDGET.getByName('token-factory-daily');
    return budget.reserveExecution(state.record.id, state.admissionId, attempt, state.dailyCallLimit);
  }

  async retainLateGeneration(attempt, usage, response, error) {
    // A cancellation/interrupted-submission stop may win while its original
    // response is still returning. Enrich only that terminal attempt; never
    // reopen it, promote readiness, or schedule another provider operation.
    await this.ctx.storage.transaction(async transaction => {
      let current = await transaction.get('state');
      if (!current || current.phase !== 'retained' || current.record.usage.modelCalls !== attempt) return;
      current.record = validateRunRecord(current.record);
      const newResponse = response && !current.record.generationAttempts.some(entry => entry.attempt === attempt);
      if (!newResponse && !(usage && current.usageBase)) return;
      if (usage) current = retainModelUsage(current, usage);
      if (newResponse) current = retainGeneration(current, response, error);
      current.record = validateRunRecord(addEvent(current.record, 'Recorded a late generation response; the stopped run remains terminal.'));
      await transaction.put('state', current);
    });
  }

  async handleCancellation(state, sandboxConfig) {
    if (!state.operationId) {
      if (['model-submitting', 'sandbox-submitting'].includes(state.phase)) {
        await this.finish(state, 'uncertain', 'Cancellation found a provider submission without a durable receipt.', 'The provider submission outcome is unknown.');
      } else await this.finish(state, 'cancelled', 'Run cancelled before another provider operation started.');
      return true;
    }
    if (!state.cancelSubmitted) {
      const submitting = { ...state, cancelSubmitted: true };
      await this.ctx.storage.put('state', submitting);
      try { await cancelSandboxOperation(sandboxConfig, state.operationId, { timeoutMs: remainingMs(state, 15000) }); }
      catch (error) {
        if (error instanceof SandboxError && error.uncertain) {
          await this.finish(submitting, 'uncertain', 'The sandbox cancellation response was lost.', error);
          return true;
        }
        throw error;
      }
      await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
      return true;
    } else {
      return false;
    }
  }

  async alarm() {
    let state = await this.load();
    let failureStage = 'orchestration';
    let generatedResponse = null;
    let submittedAttempt = null, generatedUsage = null;
    if (!state) return;
    if (state.phase === 'retained') {
      if (Date.now() >= state.retentionAt) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); }
      else await this.ctx.storage.setAlarm(state.retentionAt);
      return;
    }
    try {
      if (Date.now() >= state.deadline) {
        if (state.operationId) {
          state = { ...state, cancelRequested: true, record: { ...addEvent(state.record, 'The orchestration deadline passed; sandbox cancellation is pending.'), status: 'cancelling' } };
          await this.ctx.storage.put('state', state);
        } else {
          await this.finish(state, ['model-submitting', 'sandbox-submitting'].includes(state.phase) ? 'uncertain' : 'failed',
            'The run reached its orchestration deadline.', 'The run did not finish within ten minutes.');
          return;
        }
      }
      let sandboxConfig = null;
      if (state.operationId || state.phase === 'sandbox-ready' || state.phase === 'sandbox-submitting') sandboxConfig = sandboxConfiguration(this.env);
      if (state.cancelRequested && await this.handleCancellation(state, sandboxConfig)) return;

      if (state.phase === 'model-submitting' || state.phase === 'sandbox-submitting') {
        await this.finish(state, 'uncertain', 'A provider submission restarted without a durable receipt.', 'The provider submission outcome is unknown.');
        return;
      }

      if (state.phase === 'model-ready') {
        failureStage = 'generation';
        const attempt = state.record.usage.modelCalls + 1;
        if (attempt > RUN_LIMITS.maxModelCalls) {
          await this.finish(state, 'failed', 'The model-call limit was reached.', new RunApiError(429, 'run_limit', 'The run has used both model calls.'));
          return;
        }
        const reserved = await this.reserveInference(state, attempt);
        state = await this.load();
        if (!state || state.phase === 'retained') return;
        if (state.phase !== 'model-ready') return;
        if (state.cancelRequested) { await this.handleCancellation(state, null); return; }
        if (Date.now() >= state.deadline) { await this.finish(state, 'failed', 'The run reached its orchestration deadline.', 'The run did not finish within ten minutes.'); return; }
        if (reserved === false) { await this.finish(state, 'failed', 'Run stopped at the daily inference ceiling.', new RunApiError(429, 'daily_limit', 'The demo has reached its daily generation limit.')); return; }
        if (reserved !== true) throw new Error('Inference budget unavailable.');
        const config = runModelConfiguration(this.env, state.record.requestedModel);
        const usageBase = { ...state.record.usage };
        const submitting = { ...state, phase: 'model-submitting', usageBase, record: { ...addEvent(state.record,
          attempt === 1 ? 'Generating the three browser tool files.' : 'Using the second model call to repair the observed failure.'),
          status: attempt === 1 ? 'generating' : 'repairing', usage: { modelCalls: attempt,
            inputTokens: attempt === 1 ? null : usageBase.inputTokens,
            outputTokens: attempt === 1 ? null : usageBase.outputTokens, totalsComplete: false } } };
        await this.ctx.storage.put('state', submitting);
        submittedAttempt = attempt;
        const rejected = state.record.generationAttempts.at(-1);
        const repair = attempt === 1 ? null : rejected?.outcome === 'rejected'
          ? { rejected } : { files: state.record.files, check: state.record.checks.at(-1) };
        const generated = await generateRunFiles(config, runSnapshotFromRecord(state.record), repair, { timeoutMs: remainingMs(state, 60000) });
        generatedResponse = generated.response;
        generatedUsage = generated.usage;
        state = await this.load();
        if (!state) return;
        if (state.phase === 'retained') {
          await validateGeneratedPreview(generated.files);
          await this.retainLateGeneration(attempt, generated.usage, generatedResponse, null);
          return;
        }
        if (state.phase !== 'model-submitting') return;
        state = retainModelUsage(state, generated.usage);
        // Persist usage before any subsequent source validation.
        await this.save(state);
        failureStage = 'preview';
        await validateGeneratedPreview(generated.files);
        const digest = await runFilesDigest(generated.files);
        state = await this.load();
        if (!state) return;
        if (state.phase === 'retained') { await this.retainLateGeneration(attempt, generated.usage, generatedResponse, null); return; }
        if (state.phase !== 'model-submitting') return;
        const failedCheck = state.record.checks.at(-1);
        if (failedCheck && failedCheck.exitCode !== 0 && failedCheck.sourceDigest === digest) {
          throw new RunProviderError('unchanged_repair', 'The repair returned the same files that already failed Sandbox checks. No duplicate check was submitted.', false, 'tool_files');
        }
        state = retainGeneration({ ...state, record: { ...state.record, attempt, files: generated.files } }, generatedResponse);
        await this.save(state);
        if (state.cancelRequested) { await this.finish(state, 'cancelled', 'Run cancelled after generation; source was retained without executing it.'); return; }
        state = { ...state, phase: 'sandbox-ready', sourceDigest: digest,
          record: { ...addEvent(state.record, 'Generated files are ready for isolated syntax, control-contract and model-authored checks.'), attempt,
            status: 'checking', files: generated.files }, usageBase: null };
        await this.save(state, Date.now() + 100);
        return;
      }

      if (state.phase === 'sandbox-ready') {
        failureStage = 'sandbox';
        sandboxConfig ||= sandboxConfiguration(this.env);
        const submitting = { ...state, phase: 'sandbox-submitting', record: addEvent(state.record, `Submitting isolated check attempt ${state.record.attempt}.`) };
        await this.ctx.storage.put('state', submitting);
        const operationId = await spawnSandbox(sandboxConfig, state.record.files, { timeoutMs: remainingMs(state, 15000) });
        state = await this.load();
        if (!state || state.phase === 'retained' || state.phase !== 'sandbox-submitting') return;
        state = { ...state, phase: 'sandbox-polling', operationId, cancelSubmitted: false,
          record: addEvent(state.record, `Isolated check attempt ${state.record.attempt} accepted by the provider.`) };
        await this.save(state, Date.now() + POLL_MS);
        return;
      }

      if (state.phase === 'sandbox-polling') {
        failureStage = 'sandbox';
        sandboxConfig ||= sandboxConfiguration(this.env);
        const polledOperationId = state.operationId;
        const observed = await readSandboxOperation(sandboxConfig, polledOperationId, { timeoutMs: remainingMs(state, 15000) });
        state = await this.load();
        if (!state || state.phase === 'retained' || state.phase !== 'sandbox-polling' || state.operationId !== polledOperationId) return;
        if (!observed.terminal) { await this.ctx.storage.setAlarm(Date.now() + POLL_MS); return; }
        if (observed.status === 'CANCELLED') {
          await this.finish(state, state.cancelRequested ? 'cancelled' : 'failed', state.cancelRequested
            ? 'The sandbox confirmed cancellation.' : 'The sandbox cancelled without a local request.', state.cancelRequested ? null : 'The isolated check was cancelled.');
          return;
        }
        const check = { attempt: state.record.attempt, operationId: state.operationId, checkpointId: observed.checkpointId,
          exitCode: observed.exitCode, stdout: observed.stdout, stderr: observed.stderr, sourceDigest: state.sourceDigest };
        state = { ...state,
          record: { ...state.record, checks: [...state.record.checks, check] } };
        if (state.cancelRequested) { await this.finish(state, 'cancelled', 'The check finished during cancellation; its observed result was retained but not accepted.'); return; }
        if (observed.exitCode === 0 && observed.status === 'SUCCESS') {
          await this.finish(state, 'ready', 'Observed syntax, control-contract and model-authored checks passed in the isolated sandbox.');
          return;
        }
        if (state.record.usage.modelCalls < RUN_LIMITS.maxModelCalls) {
          state = { ...state, phase: 'model-ready', operationId: null, sourceDigest: null, cancelSubmitted: false,
            record: { ...addEvent(state.record, 'The first isolated check failed; one repair is available.'), status: 'repairing' } };
          await this.save(state, Date.now() + 100);
          return;
        }
        await this.finish(state, 'failed', 'The isolated checks still failed after the one repair.', 'The generated browser tool did not pass its isolated checks.');
      }
    } catch (error) {
      state = await this.load() || state;
      if (error instanceof RunProviderError && error.usage && state.phase === 'model-submitting') {
        state = retainModelUsage(state, error.usage);
      }
      if (state.phase === 'retained') {
        if (submittedAttempt !== null && error instanceof RunProviderError) {
          await this.retainLateGeneration(submittedAttempt, error.usage || generatedUsage, error.response || generatedResponse, error);
        }
        return;
      }
      if (state.phase === 'model-submitting') {
        state = retainGeneration(state, error instanceof RunProviderError ? error.response || generatedResponse : null, error);
        await this.save(state);
        const rejected = state.record.generationAttempts.at(-1);
        if (!state.cancelRequested && Date.now() < state.deadline && sourceRejection(error)
          && state.record.usage.modelCalls < RUN_LIMITS.maxModelCalls && state.record.usage.totalsComplete
          && rejected?.attempt === state.record.usage.modelCalls && rejected.retention === 'retained') {
          state = { ...state, phase: 'model-ready', record: { ...addEvent(state.record,
            'Source validation rejected the first response; retained it and scheduled the one repair before Sandbox.'), status: 'repairing' } };
          await this.save(state, Date.now() + 100);
          return;
        }
      }
      if (state.cancelRequested && state.operationId && error instanceof SandboxError && !error.uncertain) {
        await this.finish(state, 'uncertain', 'Cancellation could not confirm the sandbox operation state.', error);
      } else if (state.cancelRequested && error instanceof SandboxError && error.code === 'execution_unavailable') {
        await this.finish(state, 'uncertain', 'Cancellation could not reach the sandbox after its configuration became unavailable.', error);
      } else if ((error instanceof RunProviderError || error instanceof SandboxError) && error.uncertain) {
        await this.finish(state, 'uncertain', 'A provider response was lost after submission.', error);
      } else if (error instanceof SandboxError && error.code === 'sandbox_status_unavailable' && Date.now() < state.deadline) {
        await this.ctx.storage.setAlarm(Date.now() + 5000);
      } else {
        await this.finish(state, 'failed', 'The run stopped safely after a bounded provider error.', error, failureStage);
      }
    }
  }
}
