import { isRecord } from '../svelte-frontend/src/lib/nebius-contract.mjs';

// Fetch exposes the decoded response body, not compressed bytes on the wire.
// SSE repeats envelope metadata for each token. Its framing budget is separate
// from the unchanged 512 KiB content/reasoning and retained-source budgets.
export const GENERATION_STREAM_LIMITS = Object.freeze({
  wireBytes: 16 * 1024 * 1024, eventBytes: 512 * 1024,
  payloadBytes: 512 * 1024, events: 65536,
});
const MAX_EMPTY_READS = 1024, MAX_READS = GENERATION_STREAM_LIMITS.events * 16, YIELD_EVERY_READS = 256;

const MESSAGES = Object.freeze({
  response: 'Nebius returned an unsupported streaming response.',
  framing: 'Nebius returned an invalid streaming event.',
  identity: 'Nebius returned inconsistent streaming response identifiers.',
  shape: 'Nebius returned an invalid streaming completion.',
  usage: 'Nebius did not return one valid final streaming usage report.',
  wire_limit: 'Nebius exceeded the streaming response body byte bound.',
  event_limit: 'Nebius exceeded the streaming event byte bound.',
  payload_limit: 'Nebius exceeded the streaming content and reasoning byte bound.',
  count_limit: 'Nebius exceeded the streaming event count bound.',
  read_limit: 'Nebius exceeded the streaming read-operation bound.',
  empty_limit: 'Nebius exceeded the consecutive empty-read bound.',
  incomplete: 'The Nebius stream ended before its completion was confirmed.',
  aborted: 'The Nebius streaming outcome is unknown after cancellation or deadline.',
  stream_error: 'The Nebius streaming outcome is unknown after a read failure.',
});

// Fixed diagnostic labels only: never retain provider-supplied keys or values.
const SHAPE_DETAILS = new Set(['choices', 'multiple_choices', 'after_finish', 'usage_with_choice', 'choice', 'delta', 'extra_delta', 'tool', 'role', 'content', 'finish']);
export class GenerationStreamError extends Error {
  constructor(reason, usage = null, detail = null, event = null) {
    const context = reason === 'shape' && SHAPE_DETAILS.has(detail) && Number.isSafeInteger(event) && event > 0 && event <= GENERATION_STREAM_LIMITS.events
      ? ` (shape: ${detail}; event ${event})` : '';
    super((MESSAGES[reason] || MESSAGES.stream_error).replace(/\.$/u, '') + context + '.');
    this.name = 'GenerationStreamError';
    this.code = 'generation_uncertain'; this.uncertain = true;
    this.reason = reason; this.usage = usage;
  }
}

const bytes = text => new TextEncoder().encode(text).byteLength;
const safeCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 5000000;
const whitespaceByte = value => value === 9 || value === 10 || value === 13 || value === 32;

function readWithSignal(reader, signal) {
  if (signal?.aborted) return Promise.reject(new GenerationStreamError('aborted'));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', aborted);
    const aborted = () => { cleanup(); reject(new GenerationStreamError('aborted')); };
    signal?.addEventListener('abort', aborted, { once: true });
    reader.read().then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export async function readGenerationStream(response, expectedModel, { signal } = {}) {
  const cancelBody = () => { void response.body?.cancel().catch(() => {}); };
  if (response.status !== 200 || (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'text/event-stream' || !response.body) {
    cancelBody(); throw new GenerationStreamError('response');
  }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bodyBytes = 0, frameBytes = 0, frameCount = 0, payloadBytes = 0, reads = 0, emptyReads = 0;
  let line = '', data = null, skipLF = false, ended = false;
  let identity = null, created = null, roleSeen = false, content = '', contentSeen = false;
  let reasoning = 'missing', finish = null, usage = null, usageEnvelope = null, provisionalUsage = null;
  const fail = (reason, detail = null) => { throw new GenerationStreamError(reason, reason === 'identity' || reason === 'usage' ? null : usage, detail, frameCount); };

  function validateUsage(rawUsage, provisional) {
    const invalid = () => provisional ? fail('shape', 'usage_with_choice') : fail('usage');
    if (!isRecord(rawUsage) || !safeCount(rawUsage.prompt_tokens) || !safeCount(rawUsage.completion_tokens)) invalid();
    if (Object.hasOwn(rawUsage, 'total_tokens') && (!Number.isSafeInteger(rawUsage.total_tokens)
      || rawUsage.total_tokens !== rawUsage.prompt_tokens + rawUsage.completion_tokens)) invalid();
    const details = rawUsage.completion_tokens_details;
    if (details != null && (!isRecord(details) || (Object.hasOwn(details, 'reasoning_tokens')
      && details.reasoning_tokens !== null && (!safeCount(details.reasoning_tokens) || details.reasoning_tokens > rawUsage.completion_tokens)))) invalid();
    if (provisionalUsage && (rawUsage.prompt_tokens !== provisionalUsage.prompt_tokens
      || rawUsage.completion_tokens < provisionalUsage.completion_tokens)) invalid();
    return { prompt_tokens: rawUsage.prompt_tokens, completion_tokens: rawUsage.completion_tokens };
  }

  function consumeChunk(raw) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 256
      || raw.model !== expectedModel || raw.object !== 'chat.completion.chunk') fail('identity');
    if (identity !== null && identity !== raw.id) fail('identity');
    identity = raw.id;
    if (Object.hasOwn(raw, 'created')) {
      if (!Number.isSafeInteger(raw.created) || raw.created < 0 || (created !== null && raw.created !== created)) fail('identity');
      created = raw.created;
    }
    if (!Array.isArray(raw.choices)) fail('shape', 'choices');
    if (raw.choices.length === 0) {
      if (!finish || usage) fail('usage');
      usageEnvelope = validateUsage(raw.usage, false);
      if (Object.hasOwn(raw.usage, 'total_tokens')) usageEnvelope.total_tokens = raw.usage.total_tokens;
      const details = raw.usage.completion_tokens_details;
      if (details != null) {
        if (Object.hasOwn(details, 'reasoning_tokens')) {
          usageEnvelope.completion_tokens_details = { reasoning_tokens: details.reasoning_tokens };
        }
      }
      usage = { inputTokens: raw.usage.prompt_tokens, outputTokens: raw.usage.completion_tokens };
      return;
    }
    if (usage) fail('usage');
    if (finish) fail('shape', 'after_finish');
    if (raw.choices.length !== 1) fail('shape', 'multiple_choices');
    // Some compatible servers send cumulative provisional usage on choice
    // frames. It is not final evidence and is never reported on interruption.
    if (raw.usage != null) provisionalUsage = validateUsage(raw.usage, true);
    const choice = raw.choices[0], delta = choice?.delta;
    if (!isRecord(choice) || choice.index !== 0 || choice.logprobs != null
      || !Object.hasOwn(choice, 'finish_reason') || (choice.finish_reason !== null && !['stop', 'length'].includes(choice.finish_reason))) fail('shape', 'choice');
    if (!isRecord(delta)) fail('shape', 'delta');
    // OpenAI-compatible providers may serialize unused optional properties as
    // null. Ignore only null unknown properties; never discard unknown content.
    for (const key of Object.keys(delta)) if (!['role', 'content', 'reasoning_content', 'reasoning', 'function_call', 'tool_calls', 'refusal'].includes(key) && delta[key] !== null) fail('shape', 'extra_delta');
    if (delta.function_call != null || (delta.tool_calls != null && (!Array.isArray(delta.tool_calls) || delta.tool_calls.length))
      || (delta.refusal != null && delta.refusal !== '')) fail('shape', 'tool');
    if (Object.hasOwn(delta, 'role')) {
      if (delta.role === 'assistant') roleSeen = true;
      else if (delta.role !== null) fail('shape', 'role');
    }
    for (const key of ['content', 'reasoning_content', 'reasoning']) {
      if (!Object.hasOwn(delta, key)) continue;
      // Buffer bounded fragments even if optional role has not appeared yet;
      // finish and DONE still require an explicit assistant role for this choice.
      if (delta[key] !== null && typeof delta[key] !== 'string') fail('shape', 'content');
      if (typeof delta[key] === 'string') {
        payloadBytes += bytes(delta[key]);
        if (payloadBytes > GENERATION_STREAM_LIMITS.payloadBytes) fail('payload_limit');
        if (key === 'content') { content += delta[key]; contentSeen = true; }
        else if (delta[key].length) reasoning = 'text';
        else if (reasoning !== 'text') reasoning = 'empty';
      } else if (key !== 'content' && reasoning === 'missing') reasoning = 'null';
    }
    if (choice.finish_reason !== null) {
      if (!roleSeen) fail('shape', 'finish');
      finish = choice.finish_reason;
    }
  }

  function dispatch() {
    if (++frameCount > GENERATION_STREAM_LIMITS.events) fail('count_limit');
    const value = data; data = null; frameBytes = 0;
    if (value === null) return;
    if (value === '[DONE]') {
      if (!identity || !roleSeen || !finish || !usage) fail('incomplete');
      ended = true; return;
    }
    let raw;
    try { raw = JSON.parse(value); } catch { fail('framing'); }
    consumeChunk(raw);
  }

  function endLine() {
    if (!line.length) dispatch();
    else if (!line.startsWith(':')) {
      if (!line.startsWith('data:')) fail('framing');
      let value = line.slice(5); if (value.startsWith(' ')) value = value.slice(1);
      // SSE joins repeated data fields with LF. JSON.parse still requires one
      // complete object, so two independent JSON values cannot masquerade as one.
      data = data === null ? value : data + '\n' + value;
    }
    line = '';
  }

  function consumeText(text) {
    let offset = 0;
    while (offset < text.length) {
      if (skipLF) { skipLF = false; if (text[offset] === '\n') { offset++; continue; } }
      const lf = text.indexOf('\n', offset), cr = text.indexOf('\r', offset);
      const end = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
      const stop = end < 0 ? text.length : end, part = text.slice(offset, stop);
      frameBytes += bytes(part);
      if (frameBytes > GENERATION_STREAM_LIMITS.eventBytes) fail('event_limit');
      line += part; offset = stop;
      if (end < 0) return;
      skipLF = text[offset++] === '\r'; endLine();
      if (ended) {
        if (!/^[\t \r\n]*$/u.test(text.slice(offset))) fail('framing');
        return;
      }
    }
  }

  try {
    while (!ended) {
      if (reads && reads % YIELD_EVERY_READS === 0) {
        // Fulfilled microtasks must not starve the model deadline's timer.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (signal?.aborted) fail('aborted');
      if (++reads > MAX_READS) fail('read_limit');
      const { value, done } = await readWithSignal(reader, signal);
      if (done) {
        consumeText(decoder.decode());
        if (!ended) fail('incomplete');
        break;
      }
      if (!(value instanceof Uint8Array)) fail('framing');
      if (!value.byteLength) {
        if (++emptyReads > MAX_EMPTY_READS) fail('empty_limit');
        continue;
      }
      emptyReads = 0;
      bodyBytes += value.byteLength;
      if (bodyBytes > GENERATION_STREAM_LIMITS.wireBytes) fail('wire_limit');
      // Decode bounded slices even if a reader supplies one very large chunk.
      for (let offset = 0; offset < value.length; offset += 32768) {
        const end = Math.min(value.length, offset + 32768);
        consumeText(decoder.decode(value.subarray(offset, end), { stream: true }));
        if (ended) {
          // Do not wait for EOF, but reject nonblank bytes already delivered
          // after DONE. Never read another chunk to hunt for more data.
          for (let index = end; index < value.length; index++) if (!whitespaceByte(value[index])) fail('framing');
          // A trailing partial UTF-8 sequence is not blank trailing data.
          const tail = decoder.decode(); if (tail && !/^[\t \r\n]*$/u.test(tail)) fail('framing');
          break;
        }
      }
    }
    const envelope = { id: identity, object: 'chat.completion', model: expectedModel,
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: contentSeen ? content : null } }], usage: usageEnvelope };
    if (created !== null) envelope.created = created;
    return { envelope, reasoning };
  } catch (error) {
    if (error instanceof GenerationStreamError) {
      if (error.reason === 'aborted' && !error.usage) error.usage = usage;
      throw error;
    }
    throw new GenerationStreamError(signal?.aborted ? 'aborted' : 'stream_error', usage);
  } finally {
    // Cancellation is best effort: a stalled cancel promise cannot extend the
    // model deadline. Releasing the lock also rejects a pending read safely.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
