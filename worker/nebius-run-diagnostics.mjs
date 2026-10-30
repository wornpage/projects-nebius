// Bounded response metadata only. Do not copy provider strings, headers,
// final text or separate reasoning fields into these diagnostics.
import { isRecord } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { RUN_RECORD_LIMITS } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const FINISH = new Set(['stop', 'length', 'content_filter', 'tool_calls', 'function_call']);
const FIELDS = ['finish', 'model', 'choices', 'role', 'content', 'contentBytes', 'reasoning', 'reasoningTokens'];
const FINISH_VALUES = new Set([...FINISH, 'missing', 'invalid', 'other', 'unavailable']);
const MODEL_VALUES = new Set(['match', 'mismatch', 'missing', 'invalid', 'unavailable']);
const CHOICE_VALUES = new Set(['none', 'one', 'multiple', 'missing', 'invalid', 'unavailable']);
const ROLE_VALUES = new Set(['assistant', 'other', 'missing', 'invalid', 'unavailable']);
const TEXT_VALUES = new Set(['text', 'empty', 'null', 'missing', 'invalid', 'unavailable']);
const boundedInteger = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;

function textKind(message, key) {
  if (!isRecord(message)) return 'unavailable';
  if (!Object.hasOwn(message, key)) return 'missing';
  const value = message[key];
  if (value === null) return 'null';
  return typeof value === 'string' ? (value.length ? 'text' : 'empty') : 'invalid';
}

export function describeGenerationResponse(raw, requestedModel) {
  const envelope = isRecord(raw) ? raw : null;
  const choices = envelope?.choices;
  const choice = Array.isArray(choices) && choices.length === 1 && isRecord(choices[0]) ? choices[0] : null;
  const message = isRecord(choice?.message) ? choice.message : null;
  const model = !envelope ? 'unavailable' : !Object.hasOwn(envelope, 'model') ? 'missing'
    : typeof envelope.model !== 'string' || !envelope.model ? 'invalid'
      : envelope.model === requestedModel ? 'match' : 'mismatch';
  const finish = !choice ? 'unavailable' : !Object.hasOwn(choice, 'finish_reason') ? 'missing'
    : typeof choice.finish_reason !== 'string' ? 'invalid'
      : FINISH.has(choice.finish_reason) ? choice.finish_reason : 'other';
  const role = !message ? 'unavailable' : !Object.hasOwn(message, 'role') ? 'missing'
    : typeof message.role !== 'string' ? 'invalid' : message.role === 'assistant' ? 'assistant' : 'other';
  const content = textKind(message, 'content');
  const contentBytes = ['text', 'empty'].includes(content) ? new TextEncoder().encode(message.content).byteLength : null;
  const details = isRecord(envelope?.usage?.completion_tokens_details) ? envelope.usage.completion_tokens_details : null;
  let reasoningTokens = null;
  if (details && Object.hasOwn(details, 'reasoning_tokens')) {
    const value = details.reasoning_tokens, total = envelope.usage.completion_tokens;
    reasoningTokens = value === null ? null : boundedInteger(value, 5000000)
      && (!boundedInteger(total, 5000000) || value <= total) ? value : 'invalid';
  }
  return {
    finish, model,
    choices: !envelope ? 'unavailable' : !Object.hasOwn(envelope, 'choices') ? 'missing'
      : !Array.isArray(choices) ? 'invalid' : choices.length === 0 ? 'none' : choices.length === 1 ? 'one' : 'multiple',
    role, content, contentBytes, reasoning: textKind(message, 'reasoning_content'), reasoningTokens,
  };
}

export function generationDiagnosticEvent(attempt, diagnostics) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > RUN_RECORD_LIMITS.maxModelCalls || !isRecord(diagnostics)
    || Object.keys(diagnostics).sort().join(',') !== [...FIELDS].sort().join(',')) return null;
  const d = diagnostics;
  if (!FINISH_VALUES.has(d.finish) || !MODEL_VALUES.has(d.model) || !CHOICE_VALUES.has(d.choices)
    || !ROLE_VALUES.has(d.role) || !TEXT_VALUES.has(d.content) || !TEXT_VALUES.has(d.reasoning)
    || !(d.contentBytes === null || boundedInteger(d.contentBytes, 524288))
    || !(d.reasoningTokens === null || d.reasoningTokens === 'invalid' || boundedInteger(d.reasoningTokens, 5000000))) return null;
  const prefix = `Generation ${attempt} response: `;
  const message = `${prefix}finish=${d.finish}; model=${d.model}; choices=${d.choices}; role=${d.role}; content=${d.content}; final_bytes=${d.contentBytes ?? 'unknown'}; reasoning=${d.reasoning}; reasoning_tokens=${d.reasoningTokens ?? 'unknown'}.`;
  return message.length <= 240 ? { prefix, message } : null;
}
