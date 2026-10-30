import { DurableObject } from 'cloudflare:workers';
import {
  RUN_LIMITS, RUN_MODEL_TIMEOUT_MS, RUN_VERSION, RUN_RECORD_FORMAT, RUN_EVIDENCE_LIMITS, TERMINAL_RUN_STATUSES, runFilesDigest, runJsonBytes, runSnapshotFromRecord,
  validRunId, validRunKey, validateRunInput, validateRunFiles, validateRunIntegrity, validateRunRecord, runToolRequirements,
} from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { RunProviderError, generateRunFiles, runModelConfiguration } from './nebius-run-provider.mjs';
import { SandboxError, cancelSandboxOperation, readSandboxOperation, sandboxConfiguration, spawnSandbox } from './nebius-sandbox.mjs';
import { renderRunPreview } from './nebius-run-preview.mjs';
import { validateGeneratedSource, boundedRunMessage } from './nebius-run-admission.mjs';
import { generationDiagnosticEvent } from './nebius-run-diagnostics.mjs';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_MS = 1500;
const MAX_JSON_BYTES = 131072;
const PHASES = new Set(['model-ready', 'model-submitting', 'model-validating', 'sandbox-ready', 'sandbox-submitting', 'sandbox-polling', 'retained']);
const SUBMITTING = new Set(['model-submitting', 'sandbox-submitting']);
const SUBMISSION_SETTLE_MS = 1000;
const MAX_PENDING_BYTES = RUN_LIMITS.maxTotalFileBytes * 2 + RUN_EVIDENCE_LIMITS.responseBytes + 8192;
const MAX_STATE_BYTES = RUN_EVIDENCE_LIMITS.recordBytes + MAX_PENDING_BYTES + 16384;
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
    // A cached client may be retrying a POST whose earlier response was lost.
    // Reject before admission, but never claim that its saved run cannot exist.
    fail(409, 'run_format_changed', 'Task execution was updated. Reload this page to use the current run format.');
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
  const rendered = await renderRunPreview(run.files, runToolRequirements(run));
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
    if (input.version !== RUN_VERSION) fail(409, 'run_input_changed', 'Reload and review the current task input requirements before starting a run.');
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

function lateGenerationFailureEvent(attempt, error, response, usage) {
  if (error === null || response) return null;
  const details = failureDetails(error, 'model-submitting', 'generation');
  const prefix = `Late generation failure evidence for attempt ${attempt}: `;
  const code = typeof details.code === 'string' && /^[a-z][a-z0-9_]{0,79}$/u.test(details.code) ? details.code : 'execution_failed';
  const base = { attempt, code, stage: details.stage, message: '', responseObserved: false, usageObserved: usage != null };
  const known = error instanceof RunProviderError || error instanceof SandboxError || error instanceof RunApiError;
  const codePoints = [...boundedRunMessage(known ? error : null, 'Late generation failed.')];
  const serialize = length => prefix + JSON.stringify({ ...base, message: codePoints.slice(0, length).join('') });
  if (serialize(0).length > 240) throw new Error('Late generation failure audit base exceeds its event bound.');
  let low = 0, high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (serialize(middle).length <= 240) low = middle; else high = middle - 1;
  }
  return { prefix, message: serialize(low) };
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

function retainGenerationDiagnostics(state, attempt, diagnostics) {
  if (attempt !== state.record.usage.modelCalls) return state;
  const event = generationDiagnosticEvent(attempt, diagnostics);
  if (!event || state.record.events.some(item => item.message.startsWith(event.prefix))) return state;
  return { ...state, record: addEvent(state.record, event.message) };
}

function retainGeneration(state, response, error = null) {
  if (!response) return state;
  if (state.record.generationAttempts.some(entry => entry.attempt === state.record.usage.modelCalls)) return state;
  const entry = { attempt: state.record.usage.modelCalls, outcome: error ? 'rejected' : 'accepted', ...response,
    diagnostic: error ? { ...failureDetails(error, state.phase), message: boundedRunMessage(error, 'Source validation failed.') } : null };
  // Reserve space for bounded Sandbox outputs and remaining run events.
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


function sameStep(current, expected) {
  return current && current.phase === expected.phase && current.inputDigest === expected.inputDigest
    && current.admissionId === expected.admissionId && current.operationId === expected.operationId
    && current.record.usage.modelCalls === expected.record.usage.modelCalls && current.record.attempt === expected.record.attempt
    && current.sourceDigest === expected.sourceDigest && current.record.checks.length === expected.record.checks.length
    && (current.submission?.id ?? null) === (expected.submission?.id ?? null);
}

function submissionWindow(state) {
  const value = state.submission;
  if (!value || Object.keys(value).sort().join(',') !== 'attempt,deadline,id,phase,responseDeadline,startedAt'
    || !validRunId(value.id) || value.phase !== state.phase || !SUBMITTING.has(value.phase)
    || value.attempt !== (state.phase === 'model-submitting' ? state.record.usage.modelCalls : state.record.attempt)
    || ![value.startedAt, value.responseDeadline, value.deadline].every(Number.isSafeInteger)
    || value.startedAt < Date.parse(state.record.createdAt) || value.responseDeadline <= value.startedAt
    || value.deadline < value.responseDeadline || value.deadline > state.deadline
    || value.deadline - value.responseDeadline > SUBMISSION_SETTLE_MS
    || value.responseDeadline - value.startedAt > (state.phase === 'model-submitting' ? RUN_MODEL_TIMEOUT_MS : 15000)) return null;
  return value;
}

function validResponseEvidence(value) {
  return value && Object.keys(value).sort().join(',') === 'responseText,retention'
    && (value.retention === 'size_limit' ? value.responseText === null
      : value.retention === 'retained' && typeof value.responseText === 'string' && runJsonBytes(value.responseText) <= RUN_EVIDENCE_LIMITS.responseBytes);
}

function pendingGeneration(state) {
  const value = state.pendingGeneration;
  if (!value || Object.keys(value).sort().join(',') !== 'attempt,files,response'
    || value.attempt !== state.record.usage.modelCalls || !submissionWindow({ ...state, phase: 'model-submitting' })
    || !validResponseEvidence(value.response) || runJsonBytes(value) > MAX_PENDING_BYTES) {
    throw new RunApiError(503, 'invalid_generation_receipt', 'The saved generation receipt cannot be validated.');
  }
  return { attempt: value.attempt, files: validateRunFiles(value.files), response: value.response };
}

function checkStoredState(state) {
  validateRunRecord(state.record);
  if (state.phase === 'model-validating') pendingGeneration(state);
  else if (state.pendingGeneration != null) throw new RunApiError(503, 'invalid_generation_receipt', 'Pending generation data cannot outlive its validation phase.');
  if (runJsonBytes(state) > MAX_STATE_BYTES) throw new RunApiError(503, 'run_state_too_large', 'The run state exceeds its bounded storage size.');
  return state;
}

function alarmTime(state) {
  if (state.phase === 'retained') return state.retentionAt;
  if (SUBMITTING.has(state.phase)) return submissionWindow(state)?.deadline ?? Date.now() + 100;
  return Date.now() + (state.phase === 'sandbox-polling' ? POLL_MS : 100);
}

function terminalState(state, status, message, error = null, stage = null) {
  const pending = state.pendingGeneration;
  if (pending?.attempt === state.record.usage.modelCalls && validResponseEvidence(pending.response)) {
    state = retainGeneration(state, pending.response,
      new RunProviderError('source_validation_stopped', 'The run stopped before this received source completed local validation.', false, 'preview'));
  }
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
  return { ...state, pendingGeneration: null, phase: 'retained', retentionAt: Date.parse(state.record.createdAt) + RETENTION_MS,
    record: { ...addEvent(state.record, message, at), status, usage, error: error === null ? null : boundedRunMessage(error, 'The run stopped.'),
      failure: failureDetails(error, state.phase, stage) } };
}

export class NebiusRun extends DurableObject {
  async load() {
    const state = await this.ctx.storage.get('state');
    if (state === undefined) return null;
    if (!state || typeof state !== 'object' || !PHASES.has(state.phase)) throw new Error('Invalid run state.');
    return { ...state, record: await validateRunIntegrity(state.record) };
  }

  async commit(expected, update) {
    let saved = null;
    await this.ctx.storage.transaction(async transaction => {
      saved = null;
      const current = await transaction.get('state');
      if (!current || current.phase === 'retained') return;
      current.record = validateRunRecord(current.record);
      if (!sameStep(current, expected)) return;
      const next = update(current);
      if (!next) return;
      checkStoredState(next);
      await transaction.put('state', next);
      await transaction.setAlarm(alarmTime(next));
      saved = next;
    });
    return saved;
  }

  async claimSubmission(expected, phase, maximum, update) {
    const id = crypto.randomUUID();
    return this.commit(expected, current => {
      if (current.cancelRequested) return terminalState(current, 'cancelled', 'Run cancelled before another provider operation started.');
      const startedAt = Date.now(), responseDeadline = Math.min(current.deadline, startedAt + maximum);
      if (responseDeadline <= startedAt) return terminalState(current, 'failed', 'The run reached its orchestration deadline.', 'The run did not finish within ten minutes.');
      const submission = { id, phase,
        attempt: phase === 'model-submitting' ? current.record.usage.modelCalls + 1 : current.record.attempt,
        startedAt, responseDeadline, deadline: Math.min(current.deadline, responseDeadline + SUBMISSION_SETTLE_MS) };
      return { ...update(current), phase, submission, pendingGeneration: null };
    });
  }

  async abandonUnsentClaim(state) {
    return this.commit(state, current => {
      const stopped = current.phase === 'model-submitting' && current.usageBase
        ? { ...current, usageBase: null, record: { ...current.record, usage: current.usageBase } } : current;
      // The budget reservation remains consumed. Only this owner's known-unsent
      // record is corrected; no persisted daily counter is refunded or reset.
      return terminalState(stopped, 'failed', 'The claimed provider request did not start before its deadline.',
        new RunApiError(503, 'submission_deadline', 'The provider request was not sent before its submission deadline.'));
    });
  }

  async ensureAlarm() {
    // A running alarm normally has no scheduled alarm. Recover from current
    // durable ownership, not a caller's stale snapshot or a presumed restart.
    await this.ctx.storage.transaction(async transaction => {
      if (await transaction.getAlarm() !== null) return;
      const current = await transaction.get('state');
      if (!current) return;
      current.record = validateRunRecord(current.record);
      await transaction.setAlarm(alarmTime(current));
    });
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
    if (input.version !== RUN_VERSION) return { ok: false, status: 409, code: 'run_input_changed', error: 'Review the current input requirements before starting a run.' };
    if (!validRunId(id) || !validRunKey(key)) {
      return { ok: false, status: 400, code: 'invalid_request', error: 'The run admission request is invalid.' };
    }
    const [accessHash, inputDigest] = await Promise.all([sha256Hex(key), sha256Hex(JSON.stringify(input))]);
    const existing = await this.load();
    if (!existing) return { ok: true, exists: false };
    if (!constantTimeHexEqual(existing.accessHash, accessHash)) return { ok: false, status: 409, code: 'run_conflict', error: 'This run ID is already in use.' };
    if (!constantTimeHexEqual(existing.inputDigest, inputDigest)) return { ok: false, status: 409, code: 'run_conflict', error: 'This run already has a different reviewed input.' };
    await this.ensureAlarm();
    return { ok: true, exists: true, run: existing.record };
  }

  async startAdmitted(id, rawInput, key, admissionId, dailyCallLimit) {
    let input;
    try { input = validateRunInput(rawInput); }
    catch { return { ok: false, status: 400, code: 'invalid_request', error: 'The reviewed run input is invalid.' }; }
    if (input.version !== RUN_VERSION) return { ok: false, status: 409, code: 'run_input_changed', error: 'Review the current input requirements before starting a run.' };
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
      retentionAt: null, dailyCallLimit, admissionId, usageBase: null, submission: null, pendingGeneration: null };
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
      checkStoredState(state);
      await transaction.put('state', state);
      await transaction.setAlarm(Date.now() + 100);
      result = { ok: true, created: true, run: record };
    });
    if (result?.ok) await validateRunIntegrity(result.run);
    return result;
  }

  async read(key) {
    const { state, error } = await this.authorize(key);
    if (error) return error;
    await this.ensureAlarm();
    return { ok: true, run: state.record };
  }

  async cancel(key) {
    if (!validRunKey(key)) return { ok: false, status: 401, code: 'run_unauthorized', error: 'Provide this run’s access key.' };
    const suppliedHash = await sha256Hex(key);
    let result;
    await this.ctx.storage.transaction(async transaction => {
      const state = await transaction.get('state');
      if (!state) { result = { ok: false, status: 404, code: 'not_found', error: 'Run not found.' }; return; }
      state.record = validateRunRecord(state.record);
      if (!constantTimeHexEqual(state.accessHash, suppliedHash)) {
        result = { ok: false, status: 401, code: 'run_unauthorized', error: 'Provide this run’s access key.' };
        return;
      }
      if (TERMINAL_RUN_STATUSES.includes(state.record.status)) { result = { ok: true, run: state.record }; return; }
      if (!state.operationId && !SUBMITTING.has(state.phase) && state.phase !== 'model-validating') {
        const done = terminalState({ ...state, cancelRequested: true }, 'cancelled', 'Run cancelled before another provider operation started.');
        validateRunRecord(done.record);
        await transaction.put('state', done);
        await transaction.setAlarm(done.retentionAt);
        result = { ok: true, run: done.record };
        return;
      }
      const updated = { ...state, cancelRequested: true, record: { ...addEvent(state.record, state.phase === 'model-validating'
        ? 'Cancellation requested. Received source validation is pending.' : 'Cancellation requested. Provider confirmation is pending.'), status: 'cancelling' } };
      validateRunRecord(updated.record);
      await transaction.put('state', updated);
      await transaction.setAlarm(SUBMITTING.has(state.phase) ? alarmTime(updated) : Date.now() + 100);
      result = { ok: true, run: updated.record };
    });
    if (result?.ok) await validateRunIntegrity(result.run);
    return result;
  }

  async finish(state, status, event, error = null, stage = null) {
    const candidate = terminalState(state, status, event, error, stage);
    await validateRunIntegrity(candidate.record);
    let saved = null;
    await this.ctx.storage.transaction(async transaction => {
      saved = null;
      const current = await transaction.get('state');
      if (!current) return;
      current.record = validateRunRecord(current.record);
      if (current.phase === 'retained') { saved = current; return; }
      if (!sameStep(current, state)) {
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
      checkStoredState(saved);
      await transaction.put('state', saved);
      await transaction.setAlarm(saved.retentionAt);
    });
    return saved;
  }

  async reserveInference(state, attempt) {
    const budget = this.env.NEBIUS_BUDGET.getByName('token-factory-daily');
    return budget.reserveExecution(state.record.id, state.admissionId, attempt, state.dailyCallLimit);
  }

  async retainLateGeneration(attempt, submissionId, usage, response, error, diagnostics = null) {
    // A cancellation/interrupted-submission stop may win while its original
    // response is still returning. Enrich only that terminal attempt; never
    // reopen it, promote readiness, or schedule another provider operation.
    await this.ctx.storage.transaction(async transaction => {
      let current = await transaction.get('state');
      if (!current || current.phase !== 'retained' || current.record.usage.modelCalls !== attempt
        || current.submission?.id !== submissionId) return;
      current.record = validateRunRecord(current.record);
      const newResponse = response && !current.record.generationAttempts.some(entry => entry.attempt === attempt);
      const event = generationDiagnosticEvent(attempt, diagnostics);
      const newDiagnostics = event && !current.record.events.some(item => item.message.startsWith(event.prefix));
      const failureEvent = lateGenerationFailureEvent(attempt, error, response, usage);
      const newFailure = failureEvent && !current.record.events.some(item => item.message.startsWith(failureEvent.prefix));
      if (!newResponse && !newDiagnostics && !newFailure && !(usage && current.usageBase)) return;
      if (usage) current = retainModelUsage(current, usage);
      if (newDiagnostics) current = retainGenerationDiagnostics(current, attempt, diagnostics);
      if (newResponse) current = retainGeneration(current, response, error);
      current.record = validateRunRecord(addEvent(current.record, newFailure ? failureEvent.message
        : 'Recorded late generation evidence; the stopped run remains terminal.'));
      await transaction.put('state', current);
    });
  }

  async handleCancellation(state, sandboxConfig) {
    if (state.phase === 'model-validating') return false;
    if (!state.operationId) {
      if (SUBMITTING.has(state.phase)) {
        const window = submissionWindow(state);
        if (window && Date.now() < window.deadline) {
          await this.commit(state, current => current);
        } else {
          await this.finish(state, 'uncertain', 'Cancellation could not recover a provider receipt within the bounded submission window.', 'The provider submission outcome is unknown.');
        }
      } else await this.finish(state, 'cancelled', 'Run cancelled before another provider operation started.');
      return true;
    }
    if (state.cancelSubmitted) return false;
    const claimed = await this.commit(state, current => current.cancelSubmitted ? null : { ...current, cancelSubmitted: true });
    if (!claimed) return true;
    try { await cancelSandboxOperation(sandboxConfig, claimed.operationId, { timeoutMs: remainingMs(claimed, 15000) }); }
    catch (error) {
      if (error instanceof SandboxError && error.uncertain) {
        await this.finish(claimed, 'uncertain', 'The sandbox cancellation response was lost.', error);
        return true;
      }
      throw error;
    }
    await this.commit(claimed, current => current);
    return true;
  }

  async alarm() {
    let state = await this.load(), ownerState = state;
    let failureStage = 'orchestration';
    let generatedResponse = null, generatedDiagnostics = null, generatedUsage = null;
    let submittedAttempt = null, submissionId = null;
    if (!state) return;
    if (state.phase === 'retained') {
      if (Date.now() >= state.retentionAt) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); }
      else await this.ctx.storage.setAlarm(state.retentionAt);
      return;
    }
    try {
      if (state.record.version !== RUN_VERSION && ['model-ready', 'sandbox-ready'].includes(state.phase)) {
        await this.finish(state, 'failed', 'The saved request needs current input requirements.',
          new RunApiError(409, 'run_input_changed', 'Review the current input requirements before starting a new run.'));
        return;
      }
      if (Date.now() >= state.deadline) {
        if (state.operationId) {
          state = await this.commit(state, current => ({ ...current, cancelRequested: true,
            record: { ...addEvent(current.record, 'The orchestration deadline passed; sandbox cancellation is pending.'), status: 'cancelling' } }));
          if (!state) return;
          ownerState = state;
        } else {
          await this.finish(state, SUBMITTING.has(state.phase) ? 'uncertain' : 'failed',
            'The run reached its orchestration deadline.', 'The run did not finish within ten minutes.');
          return;
        }
      }
      let sandboxConfig = null;
      if (state.operationId || state.phase === 'sandbox-ready' || state.phase === 'sandbox-submitting') sandboxConfig = sandboxConfiguration(this.env);
      if (state.cancelRequested && await this.handleCancellation(state, sandboxConfig)) return;

      if (SUBMITTING.has(state.phase)) {
        const window = submissionWindow(state);
        if (window && Date.now() < window.deadline) {
          await this.commit(state, current => current);
        } else {
          await this.finish(state, 'uncertain', window
            ? 'No committed submission receipt was recovered by the submission deadline.'
            : 'The pending provider submission has no valid recovery ownership metadata.',
          window ? new RunApiError(503, 'submission_receipt_deadline', 'The provider submission outcome is unknown.')
            : new RunApiError(503, 'submission_ownership_invalid', 'The pending submission has no valid recovery ownership metadata.'));
        }
        return;
      }

      if (state.phase === 'model-ready') {
        failureStage = 'generation';
        const attempt = state.record.usage.modelCalls + 1;
        if (attempt > RUN_LIMITS.maxModelCalls) {
          await this.finish(state, 'failed', 'The model-call limit was reached.', new RunApiError(429, 'run_limit', 'The run has used its model-call allowance.'));
          return;
        }
        const reserved = await this.reserveInference(state, attempt);
        const current = await this.load();
        if (!current || current.phase === 'retained' || !sameStep(current, state)) return;
        state = current; ownerState = current;
        if (state.cancelRequested) { await this.handleCancellation(state, null); return; }
        if (Date.now() >= state.deadline) { await this.finish(state, 'failed', 'The run reached its orchestration deadline.', 'The run did not finish within ten minutes.'); return; }
        if (reserved === false) { await this.finish(state, 'failed', 'Run stopped at the daily inference ceiling.', new RunApiError(429, 'daily_limit', 'The demo has reached its daily generation limit.')); return; }
        if (reserved !== true) throw new Error('Inference budget unavailable.');
        const config = runModelConfiguration(this.env, state.record.requestedModel);
        state = await this.claimSubmission(state, 'model-submitting', RUN_MODEL_TIMEOUT_MS, current => ({
          ...current, usageBase: { ...current.record.usage },
          record: { ...addEvent(current.record, attempt === 1 ? 'Generating the three browser tool files.' : `Using model call ${attempt} to repair the observed failure.`),
            status: attempt === 1 ? 'generating' : 'repairing', usage: { modelCalls: attempt,
              inputTokens: attempt === 1 ? null : current.record.usage.inputTokens,
              outputTokens: attempt === 1 ? null : current.record.usage.outputTokens, totalsComplete: false } }
        }));
        if (!state || state.phase !== 'model-submitting') return;
        ownerState = state; submittedAttempt = attempt; submissionId = state.submission.id;
        if (Date.now() >= state.submission.responseDeadline) { await this.abandonUnsentClaim(state); return; }
        const rejected = state.record.generationAttempts.at(-1);
        const repair = attempt === 1 ? null : rejected?.outcome === 'rejected'
          ? { rejected } : { files: state.record.files, check: state.record.checks.at(-1) };
        const generated = await generateRunFiles(config, runSnapshotFromRecord(state.record), repair,
          { timeoutMs: Math.max(1, state.submission.responseDeadline - Date.now()) });
        generatedResponse = generated.response; generatedDiagnostics = generated.responseDiagnostics; generatedUsage = generated.usage;
        const observed = await this.load();
        if (!observed) return;
        if (observed.phase === 'retained') {
          await validateGeneratedSource(generated.files, runToolRequirements(observed.record));
          await this.retainLateGeneration(attempt, submissionId, generated.usage, generatedResponse, null, generatedDiagnostics);
          return;
        }
        if (!sameStep(observed, ownerState)) return;
        state = await this.commit(observed, current => {
          let next = retainModelUsage(current, generated.usage);
          next = retainGenerationDiagnostics(next, attempt, generatedDiagnostics);
          next = { ...next, phase: 'model-validating', pendingGeneration: {
            attempt, files: generated.files, response: generated.response
          } };
          pendingGeneration(next);
          return next;
        });
        if (!state) return;
        ownerState = state;
      }

      if (state.phase === 'model-validating') {
        failureStage = 'preview';
        submittedAttempt = state.record.usage.modelCalls; submissionId = state.submission?.id ?? null;
        const pending = pendingGeneration(state);
        generatedResponse = pending.response;
        await validateGeneratedSource(pending.files, runToolRequirements(state.record));
        const digest = await runFilesDigest(pending.files);
        const observed = await this.load();
        if (!observed) return;
        if (observed.phase === 'retained') {
          await this.retainLateGeneration(submittedAttempt, submissionId, generatedUsage, generatedResponse, null, generatedDiagnostics);
          return;
        }
        if (!sameStep(observed, ownerState)) return;
        await this.commit(observed, current => {
          if (Date.now() >= current.deadline) return terminalState(current, current.cancelRequested ? 'cancelled' : 'failed',
            'The run stopped before received source completed validation within its deadline.', current.cancelRequested ? null : 'Source validation did not finish within the run deadline.', 'preview');
          const failedCheck = current.record.checks.at(-1);
          if (failedCheck && failedCheck.exitCode !== 0 && failedCheck.sourceDigest === digest) {
            throw new RunProviderError('unchanged_repair', 'The repair returned the same files that already failed Sandbox checks. No duplicate check was submitted.', false, 'tool_files');
          }
          let next = retainGeneration({ ...current, pendingGeneration: null,
            record: { ...current.record, attempt: pending.attempt, files: pending.files } }, pending.response);
          if (next.cancelRequested) return terminalState(next, 'cancelled', 'Run cancelled after generation; source was retained without executing it.');
          return { ...next, phase: 'sandbox-ready', submission: null, sourceDigest: digest, usageBase: null,
            record: { ...addEvent(next.record, 'Generated files are ready for isolated syntax, control-contract and model-authored checks.'), status: 'checking' } };
        });
        return;
      }

      if (state.phase === 'sandbox-ready') {
        failureStage = 'sandbox';
        if (state.record.attempt > RUN_LIMITS.maxModelCalls || state.record.checks.length >= RUN_LIMITS.maxSandboxRuns) {
          await this.finish(state, 'failed', 'The isolated-check limit was reached.', new RunApiError(429, 'run_limit', 'The run has used its current execution allowance.'));
          return;
        }
        sandboxConfig ||= sandboxConfiguration(this.env);
        state = await this.claimSubmission(state, 'sandbox-submitting', 15000, current => ({ ...current,
          record: addEvent(current.record, `Submitting isolated check attempt ${current.record.attempt}.`) }));
        if (!state || state.phase !== 'sandbox-submitting') return;
        ownerState = state; submissionId = state.submission.id;
        if (Date.now() >= state.submission.responseDeadline) { await this.abandonUnsentClaim(state); return; }
        const operationId = await spawnSandbox(sandboxConfig, state.record.files,
          { timeoutMs: Math.max(1, state.submission.responseDeadline - Date.now()), ...runToolRequirements(state.record) });
        const observed = await this.load();
        if (!observed || observed.phase === 'retained' || !sameStep(observed, ownerState)) return;
        await this.commit(observed, current => ({ ...current, phase: 'sandbox-polling', submission: null,
          operationId, cancelSubmitted: false, record: addEvent(current.record, `Isolated check attempt ${current.record.attempt} accepted by the provider.`) }));
        return;
      }

      if (state.phase === 'sandbox-polling') {
        failureStage = 'sandbox'; sandboxConfig ||= sandboxConfiguration(this.env);
        const polledOperationId = state.operationId;
        const observed = await readSandboxOperation(sandboxConfig, polledOperationId, { timeoutMs: remainingMs(state, 15000) });
        const current = await this.load();
        if (!current || current.phase === 'retained' || !sameStep(current, ownerState)) return;
        state = current; ownerState = current;
        if (!observed.terminal) { await this.commit(state, next => next); return; }
        if (observed.status === 'CANCELLED') {
          await this.finish(state, state.cancelRequested ? 'cancelled' : 'failed', state.cancelRequested
            ? 'The sandbox confirmed cancellation.' : 'The sandbox cancelled without a local request.', state.cancelRequested ? null : 'The isolated check was cancelled.');
          return;
        }
        const check = { attempt: state.record.attempt, operationId: state.operationId, checkpointId: observed.checkpointId,
          exitCode: observed.exitCode, stdout: observed.stdout, stderr: observed.stderr, sourceDigest: state.sourceDigest };
        if (await runFilesDigest(state.record.files) !== state.sourceDigest) throw new RunApiError(503, 'source_integrity_failed', 'The returned check does not match the saved source.');
        await this.commit(state, current => {
          const checked = { ...current, record: { ...current.record, checks: [...current.record.checks, check] } };
          if (checked.cancelRequested) return terminalState(checked, 'cancelled', 'The check finished during cancellation; its observed result was retained but not accepted.');
          if (Date.now() >= checked.deadline) return terminalState(checked, 'failed', 'The run reached its orchestration deadline.', 'The run did not finish within ten minutes.');
          if (observed.exitCode === 0 && observed.status === 'SUCCESS') return terminalState(checked, 'ready', 'Observed syntax, control-contract and model-authored checks passed in the isolated sandbox.');
          if (checked.record.usage.modelCalls < RUN_LIMITS.maxModelCalls) return { ...checked, phase: 'model-ready', submission: null, pendingGeneration: null,
            operationId: null, sourceDigest: null, cancelSubmitted: false,
            record: { ...addEvent(checked.record, 'An isolated check failed; another conditional repair is available.'), status: 'repairing' } };
          return terminalState(checked, 'failed', 'The isolated checks did not pass.', 'The generated browser tool did not pass its isolated checks.');
        });
      }
    } catch (error) {
      const current = await this.load();
      if (!current) return;
      if (current.phase === 'retained') {
        if (submittedAttempt !== null && submissionId !== null) {
          await this.retainLateGeneration(submittedAttempt, submissionId,
            error instanceof RunProviderError ? error.usage || generatedUsage : generatedUsage,
            error instanceof RunProviderError ? error.response || generatedResponse : generatedResponse,
            error, error instanceof RunProviderError ? error.responseDiagnostics || generatedDiagnostics : generatedDiagnostics);
        }
        return;
      }
      if (!sameStep(current, ownerState)) return;
      state = current;
      if (state.phase === 'model-submitting' || state.phase === 'model-validating') {
        await this.commit(state, current => {
          let next = current;
          const usage = error instanceof RunProviderError ? error.usage || generatedUsage : generatedUsage;
          if (usage) next = retainModelUsage(next, usage);
          next = retainGenerationDiagnostics(next, submittedAttempt, error instanceof RunProviderError ? error.responseDiagnostics || generatedDiagnostics : generatedDiagnostics);
          next = retainGeneration(next, error instanceof RunProviderError ? error.response || generatedResponse : generatedResponse, error);
          const rejected = next.record.generationAttempts.at(-1);
          if (!next.cancelRequested && Date.now() < next.deadline && sourceRejection(error)
            && next.record.usage.modelCalls < RUN_LIMITS.maxModelCalls && next.record.usage.totalsComplete
            && rejected?.attempt === next.record.usage.modelCalls && rejected.retention === 'retained') {
            return { ...next, phase: 'model-ready', submission: null, pendingGeneration: null,
              record: { ...addEvent(next.record, 'Source validation rejected the response; retained it and scheduled a conditional repair before Sandbox.'), status: 'repairing' } };
          }
          const uncertain = error instanceof RunProviderError && error.uncertain;
          return terminalState(next, uncertain ? 'uncertain' : next.cancelRequested ? 'cancelled' : 'failed',
            uncertain ? 'A provider response was lost after submission.' : next.cancelRequested ? 'Cancellation completed after the provider step returned.' : 'The run stopped safely after a bounded provider error.',
            next.cancelRequested && !uncertain ? null : error, failureStage);
        });
        return;
      }
      if (state.cancelRequested && state.operationId && error instanceof SandboxError && !error.uncertain) {
        await this.finish(state, 'uncertain', 'Cancellation could not confirm the sandbox operation state.', error);
      } else if (state.cancelRequested && error instanceof SandboxError && error.code === 'execution_unavailable') {
        await this.finish(state, 'uncertain', 'Cancellation could not reach the sandbox after its configuration became unavailable.', error);
      } else if ((error instanceof RunProviderError || error instanceof SandboxError) && error.uncertain) {
        await this.finish(state, 'uncertain', 'A provider response was lost after submission.', error);
      } else if (error instanceof SandboxError && error.code === 'sandbox_status_unavailable' && Date.now() < state.deadline) {
        await this.commit(state, current => current);
      } else {
        await this.finish(state, 'failed', 'The run stopped safely after a bounded provider error.', error, failureStage);
      }
    }
  }
}
