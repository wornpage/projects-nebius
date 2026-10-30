import { parse } from 'acorn';
import { RUN_LIMITS } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

// Shared verbatim by static admission and the isolated Node assertion runner.
// Keep generated source on its own physical lines and never execute it here.
export function wrapRunChecks(source) {
  return '(function() { "use strict"; const {assert, validate, handleMessage} = __checks;\n' + source + '\n})();';
}

// Acorn messages may contain private source identifiers. Only recognize the
// runner's three public bindings. A second parse only explains a rejection;
// it can never admit code. A body that is also invalid keeps generic wording
// and contributes its own original-source location when one is available.
function inspectBindingFailure(source, error) {
  const match = typeof error?.message === 'string'
    ? /^Identifier '(assert|validate|handleMessage)' has already been declared \(\d+:\d+\)$/u.exec(error.message) : null;
  if (!match) return null;
  try {
    parse('(function() { "use strict";\n' + source + '\n})();',
      { ecmaVersion: 2024, sourceType: 'script', allowHashBang: false, locations: true });
    return { binding: match[1], bodyError: null };
  } catch (bodyError) {
    return { binding: null, bodyError };
  }
}

function originalLocation(error, lines) {
  const bodyLine = Number.isSafeInteger(error.loc?.line) ? error.loc.line - 1 : null;
  const line = bodyLine === null ? null : Math.max(1, Math.min(lines.length, bodyLine));
  const exact = bodyLine !== null && bodyLine >= 1 && bodyLine <= lines.length
    && Number.isSafeInteger(error.loc?.column) && error.loc.column >= 0
    && error.loc.column <= lines[bodyLine - 1].length;
  const column = exact ? error.loc.column + 1 : 1;
  return { text: line === null ? '' : ':' + line + ':' + column, exact };
}

// Diagnostic only, after the trusted wrapper has already rejected the source.
// Body context permits return/await here, but cannot change wrapper admission.
// Recognize only a parser-owned category, exact source coordinates and public
// punctuation. Never copy exception text or source identifiers into feedback.
function unexpectedClosingToken(source, lines) {
  try {
    parse(source, { ecmaVersion: 2024, sourceType: 'script', allowHashBang: false,
      allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, locations: true });
  } catch (error) {
    const line = error.loc?.line, column = error.loc?.column, position = error.pos;
    if (!Number.isSafeInteger(line) || line < 1 || line > lines.length
      || !Number.isSafeInteger(column) || column < 0 || column >= lines[line - 1].length
      || !Number.isSafeInteger(position) || position < 0 || position >= source.length
      || error.message !== 'Unexpected token (' + line + ':' + column + ')') return null;
    const token = source[position];
    if (!['}', ']', ')'].includes(token) || lines[line - 1][column] !== token) return null;
    return { location: ':' + line + ':' + (column + 1), token };
  }
  return null;
}

export function validateRunChecksSyntax(source) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > RUN_LIMITS.maxFileBytes) {
    throw new TypeError('checks.cjs must satisfy the source file byte limit before syntax validation.');
  }
  try {
    parse(wrapRunChecks(source), { ecmaVersion: 2024, sourceType: 'script', allowHashBang: false, locations: true });
  } catch (error) {
    const lines = source.split('\n');
    const location = originalLocation(error, lines).text;
    const failure = inspectBindingFailure(source, error);
    if (failure?.binding) {
      throw new TypeError('checks.cjs' + location + ' redeclares supplied ' + failure.binding
        + '; use runner-provided assert, validate and handleMessage without importing or redeclaring them.');
    }
    // Parser exception text can include private identifiers. Return only a
    // bounded file location and instructions owned by the application.
    const bodyLocation = failure?.bodyError ? originalLocation(failure.bodyError, lines) : null;
    if (bodyLocation?.exact && bodyLocation.text !== location) {
      throw new TypeError('checks.cjs' + location + ' cannot compile in the trusted assertion wrapper.'
        + ' | checks.cjs' + bodyLocation.text + ' has invalid JavaScript.');
    }
    const closing = unexpectedClosingToken(source, lines);
    if (closing) {
      throw new TypeError('checks.cjs' + closing.location + ' cannot compile in the trusted assertion wrapper.'
        + ' Unexpected closing token ' + JSON.stringify(closing.token) + '. Check nearby expressions and delimiter pairs.');
    }
    throw new TypeError('checks.cjs' + location + ' cannot compile in the trusted assertion wrapper. Complete expressions and closing delimiters.');
  }
}
