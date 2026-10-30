// Authored provider transport fixtures only. No network or generated code runs.
const encode = value => 'data: ' + JSON.stringify(value) + '\n\n';
export function streamEnvelopeBytes(raw) {
  const identity = { id: 'authored-completion', object: 'chat.completion.chunk', model: raw.model, created: 0 };
  const choice = raw.choices[0], events = [];
  const delta = value => events.push(encode({ ...identity, choices: [{ index: 0, delta: value, finish_reason: null }] }));
  delta({ role: choice.message.role });
  for (const key of ['function_call', 'tool_calls', 'refusal']) {
    if (Object.hasOwn(choice.message, key)) delta({ [key]: choice.message[key] });
  }
  for (const key of ['reasoning_content', 'reasoning', 'content']) {
    if (!Object.hasOwn(choice.message, key)) continue;
    const value = choice.message[key];
    if (typeof value !== 'string' || !value.length) { delta({ [key]: value }); continue; }
    for (let offset = 0; offset < value.length;) {
      let end = Math.min(offset + 4096, value.length);
      if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end++;
      delta({ [key]: value.slice(offset, end) }); offset = end;
    }
  }
  events.push(encode({ ...identity, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] }));
  events.push(encode({ ...identity, choices: [], usage: raw.usage }));
  events.push('data: [DONE]\n\n');
  return new TextEncoder().encode(events.join(''));
}
export function streamEnvelope(raw) {
  return new Response(streamEnvelopeBytes(raw), { headers: { 'content-type': 'text/event-stream' } });
}
