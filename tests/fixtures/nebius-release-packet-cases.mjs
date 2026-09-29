// Independent expected outputs fixed from issue #1, not computed by the tool.
// This module is never sent to the generation function or embedded in app.js.
export const INCOMPLETE = '{"candidate":"demo-42","health":"missing","review":"pending","rollback":""}';
export const CORRECTED = '{"candidate":"demo-42","health":"passing","review":"approved","rollback":"Restore demo-41"}';
export const THREE_GAPS = '3 gaps: Health must be passing; Review must be approved; Rollback step is required';
export const READY = '0 gaps: Ready for human review';

export const PACKET_CASES = Object.freeze([
  { name: 'incomplete example', input: INCOMPLETE, expected: THREE_GAPS },
  { name: 'corrected example', input: CORRECTED, expected: READY },
  { name: 'whitespace rollback', input: '{"candidate":"case-a","health":"passing","review":"approved","rollback":"  \\t "}', expected: '1 gap: Rollback step is required' },
  { name: 'failing health', input: '{"candidate":"case-b","health":"failing","review":"approved","rollback":"Restore"}', expected: '1 gap: Health must be passing' },
  { name: 'rejected review', input: '{"candidate":"case-c","health":"passing","review":"rejected","rollback":"Restore"}', expected: '1 gap: Review must be approved' },
  { name: 'missing health only', input: '{"candidate":"case-d","health":"missing","review":"approved","rollback":"Restore"}', expected: '1 gap: Health must be passing' },
  { name: 'pending review only', input: '{"candidate":"case-e","health":"passing","review":"pending","rollback":"Restore"}', expected: '1 gap: Review must be approved' },
  { name: 'two distinct gaps', input: '{"candidate":"case-f","health":"failing","review":"rejected","rollback":"Restore"}', expected: '2 gaps: Health must be passing; Review must be approved' },
  { name: 'null', input: 'null', invalid: true },
  { name: 'array', input: '[]', invalid: true },
  { name: 'number', input: '42', invalid: true },
  { name: 'string', input: '"packet"', invalid: true },
  { name: 'empty object', input: '{}', invalid: true },
  { name: 'malformed JSON', input: '{', invalid: true },
  { name: 'empty text', input: '', invalid: true },
  { name: 'missing field', input: '{"candidate":"x","health":"passing","review":"approved"}', invalid: true },
  { name: 'extra field', input: '{"candidate":"x","health":"passing","review":"approved","rollback":"Restore","extra":"x"}', invalid: true },
  { name: 'blank candidate', input: '{"candidate":"  ","health":"passing","review":"approved","rollback":"Restore"}', invalid: true },
  { name: 'candidate type', input: '{"candidate":42,"health":"passing","review":"approved","rollback":"Restore"}', invalid: true },
  { name: 'health type', input: '{"candidate":"x","health":true,"review":"approved","rollback":"Restore"}', invalid: true },
  { name: 'review type', input: '{"candidate":"x","health":"passing","review":[],"rollback":"Restore"}', invalid: true },
  { name: 'rollback type', input: '{"candidate":"x","health":"passing","review":"approved","rollback":null}', invalid: true },
  { name: 'health enum', input: '{"candidate":"x","health":"green","review":"approved","rollback":"Restore"}', invalid: true },
  { name: 'review enum', input: '{"candidate":"x","health":"passing","review":"yes","rollback":"Restore"}', invalid: true },
].map(Object.freeze));

export function assertPacketResult(assert, result, scenario) {
  assert.equal(typeof result, 'string', scenario.name);
  if (scenario.invalid) {
    assert.match(result, /^Input error: .+/u, scenario.name);
    assert.doesNotMatch(result, /Ready for human review|0 gaps/u, scenario.name);
  } else {
    assert.equal(result, scenario.expected, scenario.name);
  }
}
