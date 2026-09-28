// Shared by the browser-local preview and the optional inference backend.
export const PROMPT_VERSION = 'task-change.v1';
export const UPDATE_LIMIT = 1000;
export const FIELD_LIMITS = Object.freeze({ title: 200, purpose: 4000, nextStep: 2000, blocker: 2000, doneWhen: 4000 });
export const CONTEXT_LIMITS = Object.freeze({ items: 3, text: 1000 });
export const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const validModelId = value => typeof value === 'string' && /^nvidia\/[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/u.test(value);
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
