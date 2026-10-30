// Keep this function self-contained. The preview and the synchronous Sandbox
// checker serialize this exact implementation into their fixed bootstraps.
export function validateTimelinePatch(rawPatch, outputFormat, isProxy = () => false,
  objectPrototype = Object.prototype, arrayPrototype = Array.prototype) {
  const identifier = /^[A-Za-z0-9_-]{1,80}$/u;
  const deny = message => { throw new TypeError(message); };
  const ownRecord = (value, label) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || isProxy(value)) deny(label + ' must be plain data.');
    let prototype, descriptors, keys;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
      keys = Reflect.ownKeys(value);
    } catch { deny(label + ' must be plain data.'); }
    if (prototype !== null && prototype !== objectPrototype) deny(label + ' must use the ordinary object prototype.');
    const data = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) deny(label + ' fields must be own enumerable data.');
      data[key] = descriptor.value;
    }
    return data;
  };
  const exactKeys = (value, expected, label) => {
    const keys = Object.keys(value).sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) deny(label + ' has unsupported fields.');
  };
  const ownArray = (value, limit, label) => {
    if (isProxy(value) || !Array.isArray(value) || value.length < 1 || value.length > limit) deny(label + ' must be a bounded array.');
    let prototype, keys;
    try { prototype = Object.getPrototypeOf(value); keys = Reflect.ownKeys(value); }
    catch { deny(label + ' must be a bounded array.'); }
    if (prototype !== arrayPrototype) deny(label + ' must use the ordinary array prototype.');
    if (keys.length !== value.length + 1 || keys.some(key => typeof key !== 'string'
      || (key !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(key)))) deny(label + ' must contain only indexed data.');
    const data = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) deny(label + ' entries must be own enumerable data.');
      data.push(descriptor.value);
    }
    return data;
  };
  const integer = (value, minimum, maximum, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
      deny(label + ' must be a bounded integer.');
    }
    return value;
  };

  const patch = ownRecord(rawPatch, 'Timeline patch');
  if (!Object.hasOwn(patch, 'timeline')) return null;
  if (outputFormat !== 'timeline') deny('Timeline data targets an undeclared output.');
  exactKeys(patch, ['id', 'text', 'timeline'], 'Timeline patch');
  if (typeof patch.id !== 'string' || typeof patch.text !== 'string' || !patch.text.trim() || patch.text.length > 16000) {
    deny('Timeline data must accompany bounded text in the same patch.');
  }
  const timeline = ownRecord(patch.timeline, 'Timeline');
  exactKeys(timeline, ['horizon', 'rows', 'unit'], 'Timeline');
  if (timeline.unit !== 'days') deny('Timeline unit must be days.');
  const horizon = integer(timeline.horizon, 1, 90, 'Timeline horizon');
  const rows = ownArray(timeline.rows, 12, 'Timeline rows');
  const seen = new Set();
  const normalizedRows = rows.map((rawRow, index) => {
    const row = ownRecord(rawRow, 'Timeline row ' + (index + 1));
    exactKeys(row, ['baselineEnd', 'baselineStart', 'end', 'id', 'label', 'start'], 'Timeline row ' + (index + 1));
    if (typeof row.id !== 'string' || !identifier.test(row.id) || seen.has(row.id)) deny('Timeline row IDs must be unique bounded ASCII identifiers.');
    seen.add(row.id);
    if (typeof row.label !== 'string' || row.label.length < 1 || row.label.length > 100 || !row.label.trim()) deny('Timeline row labels must be bounded nonblank text.');
    const start = integer(row.start, 0, horizon, 'Timeline row start');
    const end = integer(row.end, 0, horizon, 'Timeline row end');
    const baselineStart = integer(row.baselineStart, 0, horizon, 'Timeline baseline start');
    const baselineEnd = integer(row.baselineEnd, 0, horizon, 'Timeline baseline end');
    if (end <= start || baselineEnd <= baselineStart) deny('Timeline ranges must have a positive duration.');
    return { id: row.id, label: row.label, start, end, baselineStart, baselineEnd };
  });
  return { unit: 'days', horizon, rows: normalizedRows };
}

export const TIMELINE_VALIDATOR_SOURCE = `(${validateTimelinePatch.toString()})`;
