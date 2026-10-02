import { isRecord, validateTask, validateSelectedContext, validModelId } from './nebius-contract.mjs';

export const RUN_VERSION = 'browser-tool.v2';
export const RUN_RECORD_FORMAT = 'run-diagnostics.v3';
export const TOOL_INPUT_LIMITS = Object.freeze({ items: 8, id: 80 });
// Serialized byte limits include JSON escaping. Leave room below the client's
// 512 KiB response ceiling for the enclosing API object.
export const RUN_EVIDENCE_LIMITS = Object.freeze({ responseBytes: 65536, recordBytes: 491520 });
export const RUN_LIMITS = Object.freeze({ maxModelCalls: 2, maxSandboxRuns: 2, maxOutputTokens: 8000, sandboxSeconds: 30, runSeconds: 600, maxFileBytes: 32768, maxTotalFileBytes: 65536 });
export const RUN_FILES = Object.freeze(['index.html', 'app.js', 'checks.cjs']);
export const RUN_STATUSES = Object.freeze(['queued', 'generating', 'checking', 'repairing', 'cancelling', 'ready', 'failed', 'cancelled', 'uncertain']);
export const TERMINAL_RUN_STATUSES = Object.freeze(['ready', 'failed', 'cancelled', 'uncertain']);
export const RUN_FAILURE_STAGES = Object.freeze(['configuration', 'generation', 'response', 'tool_files', 'tool_page', 'tool_worker', 'tool_checks', 'preview', 'sandbox', 'orchestration']);
export const validRunId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
export const validRunKey = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const validProviderId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const exact = (value, keys) => isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value, limit) => typeof value === 'string' && value.length <= limit;
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value));
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
export const runJsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const fail = message => { throw new TypeError(message); };

// null is an explicit unspecified requirement, never a guessed format. The
// task owner can instead supply the complete set, including [] for no inputs.
export function validateToolInputRequirements(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > TOOL_INPUT_LIMITS.items) fail('Specify at most eight tool inputs, or leave formats unspecified.');
  const ids = new Set();
  return Array.from(value, input => {
    if (!exact(input, ['id', 'format']) || typeof input.id !== 'string'
      || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(input.id) || ids.has(input.id)
      || !['text', 'json'].includes(input.format)) fail('Each tool input needs a unique ID starting with a letter (up to 80 letters, digits, underscores or hyphens) and a text or JSON format.');
    ids.add(input.id);
    return { id: input.id, format: input.format };
  });
}

export function validateRunInput(value) {
  const legacy = isRecord(value) && value.version === 'browser-tool.v1';
  const keys = ['version', 'packId', 'pack', 'currentStatus', 'context', 'requestedModel', 'consent'];
  if (!legacy) keys.push('requiredInputFormats');
  if (!exact(value, keys)
    || ![RUN_VERSION, 'browser-tool.v1'].includes(value.version) || value.consent !== true
    || typeof value.packId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}(?::[a-z][a-z0-9_-]{0,39})?$/u.test(value.packId)
    || !['draft', 'active'].includes(value.currentStatus) || !validModelId(value.requestedModel)) fail('Choose an open task and review the run settings.');
  const pack = validateTask(value.pack);
  if (!pack.doneWhen.trim() || !pack.nextStep.trim()) fail('Add a next step and completion criteria before running this task.');
  if (pack.blocker.trim() && pack.blocker.trim().toLowerCase() !== 'none') fail('Resolve this task’s blocker before running it.');
  // Retained v1 snapshots and backups keep their original shape and digest.
  // Current writers and start admission use v2; this reader infers no metadata.
  return { version: value.version, packId: value.packId, pack, currentStatus: value.currentStatus,
    context: validateSelectedContext(value.context), requestedModel: value.requestedModel,
    ...(!legacy ? { requiredInputFormats: validateToolInputRequirements(value.requiredInputFormats) } : {}), consent: true };
}

export function validateRunFiles(value) {
  if (!Array.isArray(value) || value.length !== RUN_FILES.length) fail('The tool must contain its page, script and checks.');
  let total = 0;
  const byName = new Map();
  for (const file of value) {
    if (!exact(file, ['path', 'content']) || !RUN_FILES.includes(file.path) || byName.has(file.path)
      || typeof file.content !== 'string' || !file.content.trim() || file.content.includes('\u0000')) fail('The generated files are invalid.');
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (bytes > RUN_LIMITS.maxFileBytes) fail('A generated file exceeds its size limit.');
    total += bytes;
    byName.set(file.path, { path: file.path, content: file.content });
  }
  if (total > RUN_LIMITS.maxTotalFileBytes) fail('The generated tool exceeds its total size limit.');
  return RUN_FILES.map(path => byName.get(path));
}

export function validateRunRecord(value) {
  const keys = ['id', 'version', 'packId', 'pack', 'currentStatus', 'context', 'requestedModel', 'status', 'attempt', 'createdAt', 'updatedAt', 'events', 'files', 'checks', 'usage', 'error'];
  if (isRecord(value) && Object.hasOwn(value, 'failure')) keys.push('failure');
  if (isRecord(value) && Object.hasOwn(value, 'generationAttempts')) keys.push('generationAttempts');
  if (isRecord(value) && value.version === RUN_VERSION) keys.push('requiredInputFormats');
  if (!exact(value, keys)
    || !validRunId(value.id) || !RUN_STATUSES.includes(value.status) || !integer(value.attempt, 2)
    || !iso(value.createdAt) || !iso(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
    || !(value.error === null || text(value.error, 500))) fail('The saved execution record is invalid.');
  const input = validateRunInput({ version: value.version, packId: value.packId, pack: value.pack,
    currentStatus: value.currentStatus, context: value.context, requestedModel: value.requestedModel,
    ...(value.version === RUN_VERSION ? { requiredInputFormats: value.requiredInputFormats } : {}), consent: true });
  if (!Array.isArray(value.events) || value.events.length > 24 || value.events.some(event => !exact(event, ['at', 'message']) || !iso(event.at) || !text(event.message, 240))) fail('The execution history is invalid.');
  if (!Array.isArray(value.files)) fail('The execution files are invalid.');
  const files = value.files.length ? validateRunFiles(value.files) : [];
  if (!Array.isArray(value.checks) || value.checks.length > 2 || value.checks.some((check, index) =>
    !exact(check, ['attempt', 'operationId', 'checkpointId', 'exitCode', 'stdout', 'stderr', 'sourceDigest'])
    || !integer(check.attempt, RUN_LIMITS.maxModelCalls) || check.attempt <= (value.checks[index - 1]?.attempt ?? 0)
    || !validProviderId(check.operationId)
    || !(check.checkpointId === null || validProviderId(check.checkpointId))
    || !Number.isSafeInteger(check.exitCode) || check.exitCode < 0 || check.exitCode > 255
    || !text(check.stdout, 4096) || !text(check.stderr, 4096) || !hash(check.sourceDigest))) fail('The execution check record is invalid.');
  const usageKeys = ['modelCalls', 'inputTokens', 'outputTokens'];
  const legacyUsage = isRecord(value.usage) && !Object.hasOwn(value.usage, 'totalsComplete');
  if (!legacyUsage) usageKeys.push('totalsComplete');
  if (!exact(value.usage, usageKeys) || !integer(value.usage.modelCalls, 2)
    || ![value.usage.inputTokens, value.usage.outputTokens].every(count => count === null || integer(count, 10000000))) fail('The execution usage is invalid.');
  // Persisted v1 runs and workspace backups predate diagnostics. Normalize only
  // at this owner: missing failure metadata stays unknown, and missing token
  // counts stay unknown. Numeric legacy totals covered all submitted calls.
  const usage = { ...value.usage, totalsComplete: legacyUsage
    ? value.usage.inputTokens !== null && value.usage.outputTokens !== null : value.usage.totalsComplete };
  if (typeof usage.totalsComplete !== 'boolean' || (usage.totalsComplete && (usage.inputTokens === null || usage.outputTokens === null))) fail('The execution usage coverage is invalid.');
  if (value.attempt > usage.modelCalls || value.checks.some(check => check.attempt > value.attempt)) fail('The execution attempt counts are invalid.');
  // Historical runs have no retained generation response. Do not invent one.
  const generationAttempts = Object.hasOwn(value, 'generationAttempts') ? value.generationAttempts : [];
  if (!Array.isArray(generationAttempts) || generationAttempts.length > RUN_LIMITS.maxModelCalls || generationAttempts.some((entry, index) =>
    !exact(entry, ['attempt', 'outcome', 'responseText', 'retention', 'diagnostic'])
    || !integer(entry.attempt, usage.modelCalls) || entry.attempt <= (generationAttempts[index - 1]?.attempt ?? 0)
    || !['accepted', 'rejected'].includes(entry.outcome)
    || !['retained', 'size_limit'].includes(entry.retention)
    || (entry.retention === 'retained' ? typeof entry.responseText !== 'string' || runJsonBytes(entry.responseText) > RUN_EVIDENCE_LIMITS.responseBytes : entry.responseText !== null)
    || (entry.outcome === 'accepted' ? entry.diagnostic !== null
      : !exact(entry.diagnostic, ['code', 'stage', 'message']) || typeof entry.diagnostic.code !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/u.test(entry.diagnostic.code)
        || !RUN_FAILURE_STAGES.includes(entry.diagnostic.stage) || !text(entry.diagnostic.message, 500)))) fail('The generation evidence is invalid.');
  if (value.checks.some(check => generationAttempts.some(entry => entry.attempt === check.attempt && entry.outcome === 'rejected'))) {
    fail('An execution check cannot reference rejected generation source.');
  }
  const failure = Object.hasOwn(value, 'failure') ? value.failure : null;
  if (failure !== null && (!exact(failure, ['code', 'stage']) || typeof failure.code !== 'string'
    || !/^[a-z][a-z0-9_]{0,79}$/u.test(failure.code) || !RUN_FAILURE_STAGES.includes(failure.stage)
    || value.error === null || !['failed', 'uncertain'].includes(value.status))) fail('The execution failure details are invalid.');
  if (value.status === 'ready' && (!files.length || value.checks.at(-1)?.exitCode !== 0 || value.checks.at(-1)?.attempt !== value.attempt
    || usage.modelCalls !== value.attempt || !usage.totalsComplete || value.error !== null || failure !== null)) fail('A ready result needs observed successful checks and complete usage.');
  const { consent, ...snapshot } = input;
  const record = { ...value, ...snapshot, files, usage, failure, generationAttempts };
  if (runJsonBytes(record) > RUN_EVIDENCE_LIMITS.recordBytes) fail('The saved execution record exceeds its serialized size limit.');
  return record;
}

export function isRunConfig(value) {
  return isRecord(value) && value.available === true && value.version === RUN_VERSION && validModelId(value.requestedModel)
    && exact(value.limits, Object.keys(RUN_LIMITS)) && Object.entries(RUN_LIMITS).every(([key, limit]) => value.limits[key] === limit);
}

export function runSnapshotFromRecord(record) {
  const { consent, ...snapshot } = validateRunInput({ version: record.version, packId: record.packId, pack: record.pack, currentStatus: record.currentStatus,
    context: record.context, requestedModel: record.requestedModel,
    ...(record.version === RUN_VERSION ? { requiredInputFormats: record.requiredInputFormats } : {}), consent: true });
  return snapshot;
}

export async function runFilesDigest(files) {
  const bytes = new TextEncoder().encode(JSON.stringify(validateRunFiles(files)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function validateRunIntegrity(value) {
  const record = validateRunRecord(value);
  if (record.status === 'ready' && await runFilesDigest(record.files) !== record.checks.at(-1).sourceDigest) {
    fail('The generated files do not match the source that was checked.');
  }
  return record;
}
