// Shared by the browser-local preview and the optional inference backend.
export const PROMPT_VERSION = 'task-change.v1';
export const UPDATE_LIMIT = 1000;
export const FIELD_LIMITS = Object.freeze({ title: 200, purpose: 4000, nextStep: 2000, blocker: 2000, doneWhen: 4000 });
export const CONTEXT_LIMITS = Object.freeze({ items: 3, text: 1000 });
export const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const validModelId = value => typeof value === 'string' && /^nvidia\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/u.test(value);
export const PLANNING_TRACE_VERSION = 'project-plan-trace.v1';
const exactTraceKeys = (value, keys) => isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const validUsage = value => exactTraceKeys(value, ['input_tokens', 'output_tokens'])
  && Number.isSafeInteger(value.input_tokens) && value.input_tokens >= 0
  && Number.isSafeInteger(value.output_tokens) && value.output_tokens >= 0;
const stageNames = ['plan', 'grounding-review'];
function planningStages(value, expectedModel) {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError('Planning evidence needs both stages.');
  const stages = Array.from(value, (stage, index) => {
    if (!exactTraceKeys(stage, ['stage', 'reservation', 'providerAttempted', 'outcome', 'model', 'usage', 'usageKnown'])
      || stage.stage !== stageNames[index] || !validModelId(stage.model)
      || (expectedModel !== undefined && stage.model !== expectedModel)
      || !['not_requested', 'reserved', 'refused', 'unknown'].includes(stage.reservation)
      || typeof stage.providerAttempted !== 'boolean' || typeof stage.usageKnown !== 'boolean'
      || !['not_started', 'passed', 'blocked', 'refused', 'failed', 'cancelled'].includes(stage.outcome)) throw new TypeError('Invalid planning stage evidence.');
    if (stage.usageKnown ? !stage.providerAttempted || !validUsage(stage.usage) : stage.usage !== null) throw new TypeError('Invalid stage usage.');
    if (stage.providerAttempted && (stage.reservation !== 'reserved' || ['not_started', 'refused'].includes(stage.outcome))) throw new TypeError('Invalid provider attempt.');
    if (!stage.providerAttempted && (stage.usageKnown || ['passed', 'blocked'].includes(stage.outcome))) throw new TypeError('Uncalled stages cannot have provider results.');
    if (['passed', 'blocked'].includes(stage.outcome) && !stage.usageKnown) throw new TypeError('Accepted stage output needs reported usage.');
    if (stage.reservation === 'refused' && stage.outcome !== 'refused') throw new TypeError('Refused reservation needs a refused stage.');
    if (stage.outcome === 'refused' && stage.reservation !== 'refused') throw new TypeError('A refused stage needs a refused reservation.');
    if (stage.outcome === 'not_started' && stage.reservation !== 'not_requested') throw new TypeError('An unstarted stage cannot consume a reservation.');
    if (stage.reservation === 'unknown' && stage.outcome !== 'failed') throw new TypeError('An uncertain reservation must fail closed.');
    if (stage.reservation === 'not_requested' && !['not_started', 'cancelled'].includes(stage.outcome)) throw new TypeError('Unrequested stage has an invalid outcome.');
    if (index === 0 && stage.outcome === 'blocked') throw new TypeError('Only grounding review can block a valid candidate.');
    return { stage: stage.stage, reservation: stage.reservation, providerAttempted: stage.providerAttempted,
      outcome: stage.outcome, model: stage.model, usage: stage.usageKnown ? { ...stage.usage } : null, usageKnown: stage.usageKnown };
  });
  if (stages[0].model !== stages[1].model) throw new TypeError('Planning stages must use the configured reasoning model.');
  if (stages[0].outcome !== 'passed' && (stages[1].reservation !== 'not_requested' || stages[1].providerAttempted
    || stages[1].outcome !== 'not_started')) throw new TypeError('Review requires a valid first-stage plan.');
  return stages;
}
function planningCounts(stages) {
  const known = stages.filter(stage => stage.usageKnown);
  const result = { providerAttempts: stages.filter(stage => stage.providerAttempted).length,
    budgetReservations: stages.filter(stage => stage.reservation === 'reserved').length,
    unknownReservations: stages.filter(stage => stage.reservation === 'unknown').length,
    knownUsageCalls: known.length, unknownUsageCalls: stages.filter(stage => stage.providerAttempted && !stage.usageKnown).length,
    knownInputTokens: known.reduce((sum, stage) => sum + stage.usage.input_tokens, 0),
    knownOutputTokens: known.reduce((sum, stage) => sum + stage.usage.output_tokens, 0) };
  if (!Object.values(result).every(Number.isSafeInteger)) throw new TypeError('Planning totals exceed the supported integer range.');
  return result;
}
export function createPlanningTrace(stages) {
  const projected = planningStages(stages);
  return { version: PLANNING_TRACE_VERSION, stages: projected, ...planningCounts(projected) };
}
export function validatePlanningTrace(value, expectedModel) {
  const counts = ['providerAttempts', 'budgetReservations', 'unknownReservations', 'knownUsageCalls', 'unknownUsageCalls', 'knownInputTokens', 'knownOutputTokens'];
  if (!exactTraceKeys(value, ['version', 'stages', ...counts]) || value.version !== PLANNING_TRACE_VERSION) throw new TypeError('Invalid planning trace identity.');
  const stages = planningStages(value.stages, expectedModel), expected = planningCounts(stages);
  if (counts.some(key => value[key] !== expected[key])) throw new TypeError('Planning totals do not match stage evidence.');
  return { version: PLANNING_TRACE_VERSION, stages, ...expected };
}
// A failed provider attempt is not a zero-cost or successful response.
// Project only bounded diagnostic text and explicitly known/unknown usage.
export function providerFailureDetails(value) {
  if (!isRecord(value) || value.providerAttempted !== true || typeof value.usageUnknown !== 'boolean') return null;
  const diagnostic = value.diagnostic === undefined ? '' : value.diagnostic;
  if (typeof diagnostic !== 'string' || diagnostic.length > 600 || /\p{Cc}/u.test(diagnostic)) return null;
  let planningTrace;
  if (value.planningTrace !== undefined) {
    try { planningTrace = validatePlanningTrace(value.planningTrace); } catch { return null; }
    if (planningTrace.providerAttempts < 1 || value.usageUnknown !== (planningTrace.unknownUsageCalls > 0)
      || (!value.usageUnknown && (value.usage?.input_tokens !== planningTrace.knownInputTokens || value.usage?.output_tokens !== planningTrace.knownOutputTokens))) return null;
  }
  if (value.usageUnknown) {
    if (value.usage !== undefined && value.usage !== null) return null;
    return { providerAttempted: true, usageUnknown: true, usage: null, diagnostic, ...(planningTrace ? { planningTrace } : {}) };
  }
  if (!isRecord(value.usage) || !Number.isSafeInteger(value.usage.input_tokens) || value.usage.input_tokens < 0
    || !Number.isSafeInteger(value.usage.output_tokens) || value.usage.output_tokens < 0) return null;
  return { providerAttempted: true, usageUnknown: false,
    usage: { input_tokens: value.usage.input_tokens, output_tokens: value.usage.output_tokens }, diagnostic, ...(planningTrace ? { planningTrace } : {}) };
}
export function validateTask(value) {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== Object.keys(FIELD_LIMITS).sort().join(',')) throw new TypeError('Preview exactly the five task fields.');
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (typeof value[field] !== 'string' || value[field].length > limit) throw new TypeError(`The ${field} field must be text of at most ${limit} characters.`);
  }
  if (!value.title.trim()) throw new TypeError('Choose a titled work item first.');
  return Object.fromEntries(Object.keys(FIELD_LIMITS).map(field => [field, value[field]]));
}
export function projectTask(pack) {
  return validateTask(Object.fromEntries(Object.keys(FIELD_LIMITS).map(field => [field, pack?.[field] ?? ''])));
}
export function validateSelectedContext(value) {
  if (!Array.isArray(value) || value.length > CONTEXT_LIMITS.items) throw new TypeError('Select at most three context entries.');
  return value.map((item) => {
    if (!isRecord(item) || Object.keys(item).sort().join(',') !== 'kind,text'
      || (item.kind !== 'note' && item.kind !== 'source') || typeof item.text !== 'string'
      || !item.text.trim() || item.text.length > CONTEXT_LIMITS.text || /\p{Cc}/u.test(item.text)) {
      throw new TypeError('Selected context must be bounded note or source text.');
    }
    return { kind: item.kind, text: item.text };
  });
}
export function validateCurrentStatus(value) {
  if (!['draft', 'active', 'blocked', 'done'].includes(value)) throw new TypeError('Preview a supported current status.');
  return value;
}
export function validateUpdate(value) {
  if (typeof value !== 'string' || value.length > UPDATE_LIMIT || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) {
    throw new TypeError('The update must be text of at most 1000 characters.');
  }
  return value;
}
export function validateSuggestionText(value, state) {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'basis,changes,missingInformation,reason'
    || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000
    || /\p{Cc}/u.test(value.reason)
    || !Array.isArray(value.basis) || value.basis.length < 1 || value.basis.length > 3
    || !Array.isArray(value.missingInformation) || value.missingInformation.length > 3
    || value.missingInformation.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200 || /\p{Cc}/u.test(item))) {
    throw new TypeError('Invalid task-change suggestion.');
  }
  const pack = validateTask(state?.pack);
  const context = validateSelectedContext(state?.context);
  const currentStatus = validateCurrentStatus(state?.currentStatus);
  const update = validateUpdate(state?.update);
  const changes = value.changes;
  if (!isRecord(changes) || !Object.hasOwn(changes, 'nextStep')
    || Object.keys(changes).some(key => !['nextStep', 'blocker', 'status'].includes(key))
    || typeof changes.nextStep !== 'string' || !changes.nextStep.trim() || changes.nextStep.length > 200
    || /\p{Cc}/u.test(changes.nextStep)) throw new TypeError('Invalid proposed changes.');
  if (Object.hasOwn(changes, 'blocker') && (typeof changes.blocker !== 'string' || !changes.blocker.trim()
    || changes.blocker.length > 200 || /\p{Cc}/u.test(changes.blocker)
    || (changes.blocker.trim().toLowerCase() === 'none' && changes.blocker !== 'None'))) {
    throw new TypeError('Use a bounded blocker or canonical None for clearance.');
  }
  if (Object.hasOwn(changes, 'status') && (!['draft', 'active', 'blocked'].includes(changes.status) || currentStatus === 'done')) {
    throw new TypeError('A proposal cannot complete or reopen work.');
  }
  const effectiveStatus = changes.status ?? currentStatus;
  const effectiveBlocker = changes.blocker ?? pack.blocker;
  const blocked = Boolean(effectiveBlocker.trim() && effectiveBlocker.trim().toLowerCase() !== 'none');
  if ((Object.hasOwn(changes, 'status') || Object.hasOwn(changes, 'blocker'))
    && ((effectiveStatus === 'active' && blocked) || (effectiveStatus === 'blocked' && !blocked))) {
    throw new TypeError('Proposed status and blocker disagree.');
  }
  const allowed = new Set(Object.keys(pack).filter((field) => pack[field].trim()));
  allowed.add('currentStatus');
  if (update.trim()) allowed.add('update');
  context.forEach((_, index) => allowed.add(`context:${index}`));
  if (value.basis.some((id) => typeof id !== 'string' || !allowed.has(id))
    || new Set(value.basis).size !== value.basis.length) throw new TypeError('Invalid suggestion basis.');
  return { changes: { ...changes }, reason: value.reason, basis: [...value.basis], missingInformation: [...value.missingInformation] };
}
