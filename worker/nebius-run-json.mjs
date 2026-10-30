// Strict, bounded parser for a flat JSON object of source strings. JSON.parse
// alone cannot detect duplicate keys, including escaped-equivalent keys.
export function parseSourceObject(text, { maxBytes, allowed, requireAll }) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new TypeError('Source JSON is missing or exceeds its response limit.');
  }
  let i = 0;
  const whitespace = () => { while (i < text.length && /[\x20\x09\x0a\x0d]/u.test(text[i])) i++; };
  const string = () => {
    if (text[i] !== '"') throw new TypeError('Expected a JSON string.');
    const start = i++;
    while (i < text.length) {
      const ch = text[i++];
      if (ch === '\\') { if (i >= text.length) break; i++; continue; }
      if (ch === '"') {
        try {
          const value = JSON.parse(text.slice(start, i));
          if (!value.isWellFormed()) throw new TypeError('Invalid Unicode.');
          return value;
        }
        catch { throw new TypeError('Invalid JSON string.'); }
      }
    }
    throw new TypeError('Unterminated JSON string.');
  };
  whitespace();
  if (text[i++] !== '{') throw new TypeError('Expected a JSON source object.');
  const values = new Map();
  whitespace();
  if (text[i] !== '}') {
    while (true) {
      whitespace(); const key = string();
      if (!allowed.includes(key)) throw new TypeError('Unknown source file.');
      if (values.has(key)) throw new TypeError('Duplicate source file.');
      whitespace(); if (text[i++] !== ':') throw new TypeError('Expected a JSON colon.');
      whitespace(); const value = string();
      values.set(key, value);
      whitespace();
      if (text[i] === '}') break;
      if (text[i++] !== ',') throw new TypeError('Expected a JSON comma.');
    }
  }
  i++; whitespace();
  if (i !== text.length || values.size === 0) throw new TypeError('Invalid JSON source object.');
  if (requireAll && allowed.some(key => !values.has(key))) throw new TypeError('Missing source file.');
  return allowed.filter(key => values.has(key)).map(path => ({ path, lines: values.get(path).replace(/\r\n/gu, '\n').split('\n') }));
}
