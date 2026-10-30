// Independent authored protocol fixtures. No retained model output, generated
// program execution, live credentials, provider calls, or source admission.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('Independent stream tests forbid network fetches.'); };
const { readGenerationStream, GenerationStreamError, GENERATION_STREAM_LIMITS: LIMITS } =
  await import('../worker/nebius-generation-stream.mjs');
after(() => assert.equal(networkAttempts, 0, 'The parser must not initiate or retry any network request.'));

const MODEL = 'nvidia/test-88', ID = 'authored88', CREATED = 1792886400;
const encoder = new TextEncoder();
const usage = { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 };
const normalizedUsage = { inputTokens: 7, outputTokens: 11 };
const chunk = (delta = {}, finish_reason = null, overrides = {}) => ({ id: ID, object: 'chat.completion.chunk',
  created: CREATED, model: MODEL, choices: [{ index: 0, delta, finish_reason }], ...overrides });
const usageChunk = (stats = usage, overrides = {}) => ({ id: ID, object: 'chat.completion.chunk',
  created: CREATED, model: MODEL, choices: [], usage: stats, ...overrides });
const frame = (value, eol = '\n', multiline = false) => JSON.stringify(value, null, multiline ? 2 : undefined)
  .split('\n').map(line => 'data: ' + line).join(eol) + eol + eol;
const done = (eol = '\n') => 'data: [DONE]' + eol + eol;
const begin = (content = 'AUTHORED ') => chunk({ role: 'assistant', content });
const ending = (finish = 'stop') => [chunk({}, finish), usageChunk()];
const transcript = (values, { terminal = true, eol = '\n', multiline = false } = {}) =>
  values.map(value => typeof value === 'string' ? value : frame(value, eol, multiline)).join('') + (terminal ? done(eol) : '');

function responseFromBytes(bytes, { pieceBytes = 16384, holdOpen = false, failure = null } = {}) {
  let offset = 0, cancellations = 0, cancelledReason;
  const body = new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) {
        const next = Math.min(bytes.length, offset + pieceBytes);
        controller.enqueue(bytes.subarray(offset, next)); offset = next; return;
      }
      if (failure) controller.error(failure);
      else if (!holdOpen) controller.close();
    },
    cancel(reason) { cancellations++; cancelledReason = reason; }
  });
  return { response: new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }),
    cancellations: () => cancellations, cancelledReason: () => cancelledReason };
}
const responseFor = (text, options) => responseFromBytes(encoder.encode(text), options);
async function read(text, options) {
  const fixture = responseFor(text, options);
  const result = await readGenerationStream(fixture.response, MODEL, {});
  assert.equal(fixture.response.body.locked, false, 'Completed reader lock must be released.');
  return result;
}
async function rejected(text, { expectedUsage = null, limit = false, ...options } = {}) {
  const fixture = responseFor(text, { holdOpen: false, ...options });
  await assert.rejects(readGenerationStream(fixture.response, MODEL, {}), error => {
    assert(error instanceof GenerationStreamError);
    assert.equal(error.code, 'generation_uncertain');
    assert.equal(error.uncertain, true);
    assert.deepEqual(error.usage, expectedUsage);
    assert.equal(typeof error.message, 'string');
    assert(error.message.length <= 500, 'Protocol errors must remain bounded.');
    assert(!error.message.includes('PRIVATE_FIXTURE_VALUE'), 'Do not echo untrusted payload text.');
    if (limit) assert.match(error.message, /limit|large|exceed|bound/iu, 'A bound test must fail because of a bound, not later incomplete EOF.');
    return true;
  });
  assert.equal(fixture.response.body.locked, false, 'Rejected reader lock must be released.');
  return fixture;
}
function assertEnvelope(result, content, finish = 'stop', stats = usage) {
  assert.deepEqual(Object.keys(result).sort(), ['envelope', 'reasoning']);
  const envelope = result.envelope;
  assert.equal(envelope.id, ID);
  assert.equal(envelope.model, MODEL);
  assert.equal(envelope.choices.length, 1);
  assert.equal(envelope.choices[0].index, 0);
  assert.equal(envelope.choices[0].message.role, 'assistant');
  assert.equal(envelope.choices[0].message.content, content);
  assert.equal(envelope.choices[0].finish_reason, finish);
  assert.deepEqual(envelope.usage, stats);
  assert(!JSON.stringify(result).includes('PRIVATE_FIXTURE_VALUE'));
}

test('independent transport limits are frozen at the reviewed exact bounds', () => {
  assert(Object.isFrozen(LIMITS));
  assert.deepEqual(LIMITS, { wireBytes: 16 * 1024 * 1024, eventBytes: 512 * 1024, payloadBytes: 512 * 1024, events: 65536 });
});

test('single-byte wire chunks reconstruct split UTF-8 and every SSE boundary exactly', async () => {
  const content = 'AUTHORED café 🧪 \nSecond line.';
  const result = await read(transcript([begin('AUTHORED '), chunk({ content: 'café 🧪 \nSecond line.' }), ...ending()]), { pieceBytes: 1 });
  assertEnvelope(result, content);
  assert.equal(result.reasoning, 'missing');
});

test('later nullable optional role and unused null fields preserve identified assistant content', async () => {
  const values = [begin('first '), chunk({ role: null, content: 'second', audio: null }), ...ending()];
  assertEnvelope(await read(transcript(values)), 'first second');
});

test('nullable and omitted roles may precede an explicit assistant without exposing reasoning', async () => {
  const values = [chunk({ role: null, reasoning_content: 'PRIVATE_FIXTURE_VALUE', content: 'first ' }),
    chunk({ content: 'second' }), chunk({ role: 'assistant', content: null }), ...ending()];
  const result = await read(transcript(values));
  assertEnvelope(result, 'first second');
  assert.equal(result.reasoning, 'text');
});

test('pre-role content cannot bypass the payload limit or become a partial result', async () => {
  const text = 'x'.repeat(300000);
  await rejected(transcript([chunk({ content: text }), chunk({ content: text }), chunk({ role: 'assistant' }), ...ending()]), { limit: true });
});

for (const [name, values, category] of [
  ['null role without identification', [chunk({ role: null, content: 'x' }), ...ending()], 'finish'],
  ['incorrect late role', [chunk({ content: 'PRIVATE_FIXTURE_VALUE' }), chunk({ role: 'user' }), ...ending()], 'role'],
  ['unknown non-null optional field', [begin(), chunk({ PRIVATE_FIXTURE_VALUE: 'PRIVATE_FIXTURE_VALUE' }), ...ending()], 'extra_delta'],
  ['unsupported tool payload', [begin(), chunk({ tool_calls: [{ id: 'PRIVATE_FIXTURE_VALUE' }] }), ...ending()], 'tool'],
  ['non-string content', [begin(), chunk({ content: { PRIVATE_FIXTURE_VALUE: 'secret' } }), ...ending()], 'content'],
  ['bad choice index', [chunk({}, null, { choices: [{ index: 1, delta: {}, finish_reason: null }] }), ...ending()], 'choice'],
]) {
  test(`unsafe ${name} remains uncertain with only an allowlisted diagnostic`, async () => {
    const fixture = responseFor(transcript(values));
    await assert.rejects(readGenerationStream(fixture.response, MODEL, {}), error => {
      assert.equal(error.code, 'generation_uncertain');
      assert.match(error.message, new RegExp(`shape: ${category}; event [1-9][0-9]*`));
      assert(!error.message.includes('PRIVATE_FIXTURE_VALUE'));
      assert(!error.message.includes(ID));
      return true;
    });
  });
}

test('CRLF, comment heartbeats, blank lines and multiline data fields preserve the authored completion', async () => {
  const text = ': authored heartbeat\r\n\r\n' + transcript([begin('CRLF ✓'), ...ending()], { eol: '\r\n', multiline: true });
  assertEnvelope(await read(text, { pieceBytes: 7 }), 'CRLF ✓');
});

test('terminal DONE suffices without EOF and cancels the remaining held-open response body', async () => {
  const fixture = responseFor(transcript([begin('Complete'), ...ending()]), { holdOpen: true, pieceBytes: 13 });
  const result = await readGenerationStream(fixture.response, MODEL, {});
  assertEnvelope(result, 'Complete');
  assert.equal(fixture.cancellations(), 1);
  assert.equal(fixture.response.body.locked, false);
});

test('a received length finish keeps its actual content and usage for the existing rejection policy', async () => {
  assertEnvelope(await read(transcript([begin('Authored truncated content'), ...ending('length')])), 'Authored truncated content', 'length');
});

for (const [name, value, expected] of [['text', 'PRIVATE_FIXTURE_VALUE reasoning only', 'text'], ['empty', '', 'empty'], ['null', null, 'null']]) {
  test(`separate ${name} reasoning is described by enum without retaining its text`, async () => {
    const result = await read(transcript([chunk({ role: 'assistant', reasoning_content: value }), chunk({ content: 'Visible only' }), ...ending()]));
    assertEnvelope(result, 'Visible only');
    assert.equal(result.reasoning, expected);
  });
}

test('reason-only length completion never invents assistant source content', async () => {
  const result = await read(transcript([chunk({ role: 'assistant', reasoning_content: 'PRIVATE_FIXTURE_VALUE' }), ...ending('length')]));
  assertEnvelope(result, null, 'length');
  assert.equal(result.reasoning, 'text');
});

test('explicitly received zero usage is preserved rather than replaced with invented nonzero counts', async () => {
  const zero = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  assertEnvelope(await read(transcript([begin('Zero usage fixture'), chunk({}, 'stop'), usageChunk(zero)])), 'Zero usage fixture', 'stop', zero);
});

test('initial and later choice-frame usage is provisional; final usage alone qualifies the result', async () => {
  const values = [chunk({ role: 'assistant', content: 'Valid' }, null, { usage: { prompt_tokens: 7, completion_tokens: 0, total_tokens: 7 } }),
    chunk({ content: ' result' }, null, { usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 } }),
    chunk({}, 'stop', { usage: { prompt_tokens: 7, completion_tokens: 10, total_tokens: 17 } }), usageChunk()];
  assertEnvelope(await read(transcript(values)), 'Valid result');
});

test('provisional counts do not replace missing final usage', async () => {
  await rejected(transcript([chunk({ role: 'assistant', content: 'x' }, null,
    { usage: { prompt_tokens: 7, completion_tokens: 0, total_tokens: 7 } }), chunk({}, 'stop')]));
});

test('interruption after provisional counts keeps usage unknown', async () => {
  await rejected(transcript([chunk({ role: 'assistant', content: 'x' }, null,
    { usage: { prompt_tokens: 7, completion_tokens: 1 } })], { terminal: false }));
});

for (const [name, first, next] of [
  ['non-object', 'PRIVATE_FIXTURE_VALUE', null],
  ['missing count', { prompt_tokens: 7 }, null],
  ['negative count', { prompt_tokens: 7, completion_tokens: -1 }, null],
  ['bad total', { prompt_tokens: 7, completion_tokens: 1, total_tokens: 100 }, null],
  ['decreasing counts', { prompt_tokens: 7, completion_tokens: 3 }, { prompt_tokens: 7, completion_tokens: 2 }],
  ['changed prompt count', { prompt_tokens: 7, completion_tokens: 1 }, { prompt_tokens: 8, completion_tokens: 2 }],
]) {
  test(`invalid provisional usage (${name}) stays uncertain without exposing values`, async () => {
    const values = [chunk({ role: 'assistant', content: 'x' }, null, { usage: first })];
    if (next) values.push(chunk({ content: 'y' }, null, { usage: next }));
    values.push(...ending());
    const fixture = responseFor(transcript(values));
    await assert.rejects(readGenerationStream(fixture.response, MODEL, {}), error => {
      assert.equal(error.code, 'generation_uncertain'); assert.equal(error.usage, null);
      assert.match(error.message, /shape: usage_with_choice; event [1-9][0-9]*/u);
      assert(!error.message.includes('PRIVATE_FIXTURE_VALUE'));
      return true;
    });
  });
}

test('a final usage report contradicting provisional counts cannot qualify', async () => {
  await rejected(transcript([chunk({ role: 'assistant', content: 'x' }, null,
    { usage: { prompt_tokens: 7, completion_tokens: 12 } }), ...ending()]));
});

test('a final usage report with a different prompt count cannot qualify', async () => {
  await rejected(transcript([chunk({ role: 'assistant', content: 'x' }, null,
    { usage: { prompt_tokens: 7, completion_tokens: 1 } }), chunk({}, 'stop'),
    usageChunk({ prompt_tokens: 8, completion_tokens: 11, total_tokens: 19 })]));
});

test('multiple choices and a post-finish choice retain separate safe diagnostics', async () => {
  for (const [values, category] of [
    [[chunk({}, null, { choices: [{index:0,delta:{role:'assistant'},finish_reason:null}, {index:1,delta:{},finish_reason:null}] })], 'multiple_choices'],
    [[begin(), chunk({}, 'stop'), chunk({content:'late'})], 'after_finish'],
  ]) {
    const fixture = responseFor(transcript(values));
    await assert.rejects(readGenerationStream(fixture.response, MODEL, {}), error => {
      assert.equal(error.code, 'generation_uncertain'); assert(error.message.includes(`shape: ${category};`)); return true;
    });
  }
});

for (const fixture of [
  { name: 'DONE before any content', values: [] },
  { name: 'missing final finish', values: [begin(), usageChunk()] },
  { name: 'missing final usage', values: [begin(), chunk({}, 'stop')] },
  { name: 'usage before finish', values: [begin(), usageChunk(), chunk({}, 'stop')] },
  { name: 'duplicate final usage', values: [begin(), chunk({}, 'stop'), usageChunk(), usageChunk()] },
  { name: 'content after finish', values: [begin(), chunk({}, 'stop'), chunk({ content: 'late' }), usageChunk()] },
  { name: 'second finish', values: [begin(), chunk({}, 'stop'), chunk({}, 'stop'), usageChunk()] },
  { name: 'finish content_filter', values: [begin(), ...ending('content_filter')] },
  { name: 'finish tool_calls', values: [begin(), ...ending('tool_calls')] },
  { name: 'missing explicit assistant role', values: [chunk({ content: 'No role' }), ...ending()] },
  { name: 'non-assistant role', values: [chunk({ role: 'user', content: 'Wrong role' }), ...ending()] },
  { name: 'changed model', values: [begin(), chunk({ content: 'Wrong model' }, null, { model: 'nvidia/other' }), ...ending()] },
  { name: 'changed completion id', values: [begin(), chunk({ content: 'Wrong id' }, null, { id: 'other-completion' }), ...ending()] },
  { name: 'missing completion id', values: [chunk({ role: 'assistant', content: 'Missing id' }, null, { id: undefined }), ...ending()] },
  { name: 'choice index one', values: [chunk({ role: 'assistant', content: 'Wrong choice' }, null,
    { choices: [{ index: 1, delta: { role: 'assistant', content: 'Wrong choice' }, finish_reason: null }] }), ...ending()] },
  { name: 'multiple choices', values: [chunk({}, null, { choices: [
    { index: 0, delta: { role: 'assistant', content: 'First' }, finish_reason: null },
    { index: 1, delta: { role: 'assistant', content: 'Second' }, finish_reason: null }] }), ...ending()] },
  { name: 'tool call fragment', values: [begin(), chunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'unsafe', arguments: '{}' } }] }), ...ending()] },
  { name: 'legacy function call', values: [begin(), chunk({ function_call: { name: 'unsafe', arguments: '{}' } }), ...ending()] },
  { name: 'non-string content', values: [chunk({ role: 'assistant', content: 42 }), ...ending()] },
  { name: 'wrong final usage identity', values: [begin(), chunk({}, 'stop'), usageChunk(usage, { id: 'other-completion' })] },
  { name: 'wrong final usage model', values: [begin(), chunk({}, 'stop'), usageChunk(usage, { model: 'nvidia/other' })] },
  { name: 'missing usage count', values: [begin(), chunk({}, 'stop'), usageChunk({ prompt_tokens: 7 })] },
  { name: 'negative usage count', values: [begin(), chunk({}, 'stop'), usageChunk({ ...usage, completion_tokens: -1 })] },
  { name: 'fractional usage count', values: [begin(), chunk({}, 'stop'), usageChunk({ ...usage, prompt_tokens: 1.5 })] },
  { name: 'string usage count', values: [begin(), chunk({}, 'stop'), usageChunk({ ...usage, prompt_tokens: '7' })] },
  { name: 'mid-stream provider error', values: [begin(), { error: { message: 'PRIVATE_FIXTURE_VALUE', code: 'authored-error' } }] },
]) {
  test(`rejects ${fixture.name} without qualifying source or inventing usage`, async () => rejected(transcript(fixture.values)));
}

test('malformed JSON after validated final usage stays uncertain and preserves attributable counts', async () => {
  await rejected(transcript([begin(), ...ending(), 'data: {"PRIVATE_FIXTURE_VALUE":\n\n']), { expectedUsage: normalizedUsage });
});

test('EOF after valid final usage remains uncertain while preserving those actually received counts', async () => {
  await rejected(transcript([begin(), ...ending()], { terminal: false }), { expectedUsage: normalizedUsage });
});

test('EOF after content without finish/usage is uncertain with unknown usage', async () => {
  await rejected(transcript([begin()], { terminal: false }));
});

test('invalid UTF-8 is rejected without replacement characters or leaked fixture text', async () => {
  const prefix = encoder.encode(frame(begin()));
  const bytes = new Uint8Array(prefix.length + 1); bytes.set(prefix); bytes[prefix.length] = 0xff;
  const fixture = responseFromBytes(bytes);
  await assert.rejects(readGenerationStream(fixture.response, MODEL, {}), error => error instanceof GenerationStreamError
    && error.code === 'generation_uncertain' && error.uncertain === true && error.usage === null);
  assert.equal(fixture.response.body.locked, false);
});

test('exact decoded payload limit is accepted across individually bounded events', async () => {
  const half = 'é'.repeat(LIMITS.payloadBytes / 4);
  const result = await read(transcript([begin(half), chunk({ content: half }), ...ending()]));
  assertEnvelope(result, half + half);
  assert.equal(encoder.encode(result.envelope.choices[0].message.content).byteLength, LIMITS.payloadBytes);
});

test('one decoded UTF-8 byte beyond the aggregate payload cap is rejected', async () => {
  const half = 'é'.repeat(LIMITS.payloadBytes / 4);
  await rejected(transcript([begin(half), chunk({ content: half + 'x' }), ...ending()]), { limit: true });
});

test('discarded reasoning bytes still count toward the aggregate payload cap', async () => {
  const half = 'é'.repeat(LIMITS.payloadBytes / 4);
  await rejected(transcript([chunk({ role: 'assistant', reasoning_content: half }), chunk({ reasoning_content: half }),
    chunk({ content: 'x' }), ...ending()]), { limit: true });
});

test('oversized complete data event is rejected before it can qualify a result', async () => {
  await rejected(transcript([begin('x'.repeat(LIMITS.eventBytes)), ...ending()]), { limit: true });
});

test('unterminated oversized SSE event is bounded while its producer remains open', async () => {
  const fixture = await rejected('data: ' + 'x'.repeat(LIMITS.eventBytes + 1), { limit: true, holdOpen: true });
  assert.equal(fixture.cancellations(), 1);
});

test('wire cap includes bounded comment heartbeat bytes even without decoded payload growth', async () => {
  const comment = ':' + 'h'.repeat(128 * 1024) + '\n\n';
  const text = frame(begin('Small')) + comment.repeat(Math.ceil(LIMITS.wireBytes / encoder.encode(comment).byteLength))
    + transcript(ending());
  assert(encoder.encode(text).byteLength > LIMITS.wireBytes);
  await rejected(text, { limit: true });
});

test('event count cap rejects many empty content events below the wire and payload caps', async () => {
  const text = frame(begin('Small')) + frame(chunk({ content: '' })).repeat(LIMITS.events + 1) + transcript(ending());
  assert(encoder.encode(text).byteLength < LIMITS.wireBytes, 'Event-count fixture must not hit the wire cap first.');
  await rejected(text, { limit: true });
});

for (const afterUsage of [false, true]) {
  test(`abort of a stalled body ${afterUsage ? 'after attributable usage preserves it' : 'before usage keeps counts unknown'}`, { timeout: 2000 }, async () => {
    const values = afterUsage ? [begin(), ...ending()] : [begin()];
    const fixture = responseFor(transcript(values, { terminal: false }), { holdOpen: true });
    const controller = new AbortController();
    const pending = readGenerationStream(fixture.response, MODEL, { signal: controller.signal });
    const timer = setTimeout(() => controller.abort('authored deadline'), 25);
    try {
      await assert.rejects(pending, error => error instanceof GenerationStreamError && error.code === 'generation_uncertain'
        && error.uncertain === true && assert.deepEqual(error.usage, afterUsage ? normalizedUsage : null) === undefined);
    } finally { clearTimeout(timer); }
    assert.equal(fixture.cancellations(), 1);
    assert.equal(fixture.response.body.locked, false);
  });
}

test('an already-aborted signal cancels an unread body without inventing usage', async () => {
  const fixture = responseFor(transcript([begin(), ...ending()]), { holdOpen: true });
  const controller = new AbortController(); controller.abort('authored pre-abort');
  await assert.rejects(readGenerationStream(fixture.response, MODEL, { signal: controller.signal }), error => error instanceof GenerationStreamError
    && error.code === 'generation_uncertain' && error.uncertain === true && error.usage === null);
  assert.equal(fixture.cancellations(), 1);
  assert.equal(fixture.response.body.locked, false);
});

test('producer failure is uncertain and does not retain its arbitrary private message', async () => {
  const fixture = await rejected(frame(begin()), { failure: new Error('PRIVATE_FIXTURE_VALUE') });
  assert.equal(fixture.response.body.locked, false);
});

test('unexpected MIME and absent response body are uncertain protocol failures', async () => {
  for (const response of [new Response('data: [DONE]\n\n', { headers: { 'content-type': 'application/json' } }),
    new Response(null, { headers: { 'content-type': 'text/event-stream' } })]) {
    await assert.rejects(readGenerationStream(response, MODEL, {}), error => error instanceof GenerationStreamError
      && error.code === 'generation_uncertain' && error.uncertain === true && error.usage === null);
    assert.equal(response.body?.locked ?? false, false);
  }
});

test('consecutive empty reads are bounded and release the active reader', async () => {
  let reads = 0, cancelled = 0;
  const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array()); },
    cancel() { cancelled++; } }, { highWaterMark: 0 });
  await assert.rejects(readGenerationStream(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), MODEL),
    error => error instanceof GenerationStreamError && error.uncertain && /empty-read bound/u.test(error.message) && error.usage === null);
  assert.equal(reads, 1025); assert.equal(cancelled, 1); assert.equal(body.locked, false);
});

test('nonempty chunks reset the consecutive empty-read bound', async () => {
  const parts = [frame(begin('AUTHORED ')), frame(chunk({ content: 'reset' })), transcript(ending())].map(text => encoder.encode(text));
  let part = 0, empty = 0, cancelled = 0;
  const body = new ReadableStream({ pull(controller) {
    if (empty++ < 1024) { controller.enqueue(new Uint8Array()); return; }
    empty = 0; controller.enqueue(parts[part++]);
  }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  assertEnvelope(await readGenerationStream(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), MODEL), 'AUTHORED reset');
  assert.equal(part, 3); assert.equal(cancelled, 1); assert.equal(body.locked, false);
});

test('immediately fulfilled byte reads yield so the existing abort timer can run', async () => {
  let reads = 0, cancelled = 0; const abort = new AbortController();
  const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array([32])); },
    cancel() { cancelled++; } }, { highWaterMark: 0 });
  const timer = setTimeout(() => abort.abort(), 3);
  try {
    await assert.rejects(readGenerationStream(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), MODEL, { signal: abort.signal }),
      error => error instanceof GenerationStreamError && error.uncertain && error.reason === 'aborted');
  } finally { clearTimeout(timer); }
  assert(reads > 0 && reads <= 4096); assert.equal(cancelled, 1); assert.equal(body.locked, false);
});

test('total reads are bounded after validated usage without erasing received counts', { timeout: 60000 }, async t => {
  // Exercise a million read operations without making Windows timer resolution
  // the test's subject. setImmediate preserves a real macrotask yield here;
  // the separate abort case above keeps the production timer path unmocked.
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => delay === 0
    ? setImmediate(callback, ...args) : timeout(callback, delay, ...args));
  const prefix = encoder.encode(transcript([begin(), ...ending()], { terminal: false }));
  let reads = 0, cancelled = 0;
  const body = new ReadableStream({ pull(controller) {
    const current = reads++;
    controller.enqueue(current === 0 ? prefix : current % 2 ? new Uint8Array() : new Uint8Array([32]));
  }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  await assert.rejects(readGenerationStream(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), MODEL), error => {
    assert(error instanceof GenerationStreamError && error.uncertain && /read-operation bound/u.test(error.message));
    assert.deepEqual(error.usage, normalizedUsage); return true;
  });
  assert.equal(reads, 1048576); assert.equal(cancelled, 1); assert.equal(body.locked, false);
});

test('a never-settling producer cancellation cannot hold up a confirmed completed stream', async () => {
  const bytes = encoder.encode(transcript([begin(), ...ending()])); let reads = 0, cancelled = 0;
  const body = new ReadableStream({ pull(controller) { if (!reads++) controller.enqueue(bytes); },
    cancel() { cancelled++; return new Promise(() => {}); } }, { highWaterMark: 0 });
  assertEnvelope(await readGenerationStream(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), MODEL), 'AUTHORED ');
  assert.equal(cancelled, 1); assert.equal(body.locked, false);
});
