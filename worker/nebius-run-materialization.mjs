import { validateRunFiles } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

export const WORKER_BRIDGE = '\n' + [
  ';',
  '// Wornpage runtime bridge: supplied by the server, not the model.',
  "if (typeof validate !== 'function' || typeof handleMessage !== 'function') {",
  "  throw new TypeError('Generated app must define validate and handleMessage.');",
  '}',
  "if (typeof self !== 'undefined') {",
  '  self.onmessage = ({ data }) => {',
  '    const patches = handleMessage(data);',
  "    if (!Array.isArray(patches)) throw new TypeError('handleMessage must return a patch array.');",
  '    self.postMessage({ patches });',
  '  };',
  '}',
  "if (typeof module !== 'undefined') {",
  '  module.exports = { validate, handleMessage };',
  '}',
].join('\n');

// Materialization is not model admission. Model responses must enter through
// decodeSourceLines, which applies its syntax/bridge-ownership policy. The only
// other production caller is the parameterless hardcoded recovery factory.
export function appendServerBridge(rawFiles) {
  const files = validateRunFiles(rawFiles);
  return validateRunFiles(files.map(file => ({ path:file.path,
    content:file.content + (file.path === 'app.js' ? WORKER_BRIDGE : '') })));
}
