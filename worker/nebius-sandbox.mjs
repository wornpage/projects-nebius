import { isRecord } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { RUN_LIMITS, validateRunFiles } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

export class SandboxError extends Error {
  constructor(code, message, uncertain = false) { super(message); this.code = code; this.uncertain = uncertain; }
}

const fail = (code, message, uncertain = false) => { throw new SandboxError(code, message, uncertain); };
const BASE_URL = 'https://api.tokenfactory.nebius.com/sandboxes/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_RESPONSE_BYTES = 786432;
// This instruments generated checks inside the existing Nebius container.
// node:vm is not the security boundary; container isolation remains required.
export const CHECK_RUNNER = String.raw`'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const realAssert = require('node:assert');
let validateCalls = 0, handleMessageCalls = 0, assertionCalls = 0, assertionFailed = false;
const harden = value => Object.freeze(Object.setPrototypeOf(value, null));
// Generated logging is discarded; only trusted assertion counts reach stdout.
const quietLog = harden(() => {});
const quietConsole = Object.freeze(Object.assign(Object.create(null), {
  log: quietLog, info: quietLog, warn: quietLog, error: quietLog, debug: quietLog
}));
const context = vm.createContext(Object.assign(Object.create(null), { console: quietConsole }), {
  codeGeneration: { strings: false, wasm: false }
});
const ContextError = vm.runInContext('Error', context);
const boundedMessage = error => String(error && error.message || error).slice(0, 800);
const sourceLocations = error => {
  const stack = String(error && error.stack || '').slice(0, 4096);
  const locations = [...new Set(stack.match(/\b(?:app\.js|checks\.cjs):\d{1,6}(?::\d{1,6})?/g) || [])].slice(0, 4);
  return locations.length ? '\nSource locations: ' + locations.join(', ') : '';
};
const deny = message => { throw new ContextError(message); };
function runModule(source, filename, requireValue) {
  const moduleValue = vm.runInContext('({ exports: {} })', context);
  context.__module = moduleValue;
  context.__require = requireValue;
  const wrapped = '(function(module, exports, require) { "use strict";\n' + source + '\n})(__module, __module.exports, __require);';
  new vm.Script(wrapped, { filename, lineOffset: -1 }).runInContext(context, { timeout: 4000 });
  return moduleValue.exports;
}
function assertFacade(target) {
  const wrap = fn => harden((...args) => {
    try { fn(...args); assertionCalls += 1; }
    catch (error) { assertionFailed = true; throw new ContextError(boundedMessage(error)); }
  });
  const facade = wrap(target);
  // The callable must receive properties before freezing.
  const callable = (...args) => facade(...args);
  Object.setPrototypeOf(callable, null);
  for (const name of ['ok', 'equal', 'notEqual', 'deepEqual', 'notDeepEqual', 'strictEqual', 'notStrictEqual', 'deepStrictEqual', 'notDeepStrictEqual', 'throws', 'doesNotThrow', 'ifError', 'match', 'doesNotMatch', 'fail']) {
    callable[name] = wrap(target[name].bind(target));
  }
  return callable;
}
try {
  const app = runModule(fs.readFileSync('app.js', 'utf8'), 'app.js', harden(() => deny('app.js must not import modules.')));
  if (typeof app.validate !== 'function') throw new Error('app.js must export a validate function.');
  if (typeof app.handleMessage !== 'function') throw new Error('app.js must export a handleMessage function.');
  const appFacade = Object.freeze(Object.assign(Object.create(null), {
    validate: harden((...args) => { const result = app.validate(...args); validateCalls += 1; return result; }),
    handleMessage: harden((...args) => {
      const patches = app.handleMessage(...args);
      if (!Array.isArray(patches)) return deny('handleMessage must return a patch array.');
      handleMessageCalls += 1;
      return patches;
    })
  }));
  const assertions = assertFacade(realAssert);
  const strictAssertions = assertFacade(realAssert.strict);
  assertions.strict = strictAssertions;
  strictAssertions.strict = strictAssertions;
  Object.freeze(assertions);
  Object.freeze(strictAssertions);
  const requireCheck = harden(name => {
    if (name === './app.js') return appFacade;
    if (name === 'node:assert') return assertions;
    if (name === 'node:assert/strict') return strictAssertions;
    return deny('checks.cjs may import only ./app.js and synchronous node:assert methods.');
  });
  runModule(fs.readFileSync('checks.cjs', 'utf8'), 'checks.cjs', requireCheck);
  if (assertionFailed || assertionCalls < 1 || validateCalls < 1 || handleMessageCalls < 1) {
    throw new Error('Checks must execute at least one successful Node assertion and successfully call the exported validate and handleMessage functions; no assertion may fail.');
  }
  process.stdout.write('Observed successful assertions: ' + assertionCalls + '; validate calls: ' + validateCalls + '; handleMessage calls: ' + handleMessageCalls + '\n');
  process.exit(0);
} catch (error) {
  process.stderr.write('Generated checks failed: ' + boundedMessage(error) + sourceLocations(error) + '\n');
  process.exit(1);
}`;
const HARNESS = String.raw`'use strict';
const fs = require('node:fs');
const cp = require('node:child_process');
let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { source += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(source);
    process.chdir(fs.mkdtempSync('/tmp/wornpage-run-'));
    for (const file of payload.files) fs.writeFileSync(file.path, file.content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const syntax = cp.spawnSync(process.execPath, ['--check', 'app.js'], { encoding: 'utf8', timeout: 12000, maxBuffer: 4096 });
    if (syntax.stdout) process.stdout.write(syntax.stdout);
    if (syntax.stderr) process.stderr.write(syntax.stderr);
    if (syntax.error || syntax.status !== 0) process.exit(Number.isInteger(syntax.status) ? syntax.status : 124);
    const checks = cp.spawnSync(process.execPath, ['-e', ${JSON.stringify(CHECK_RUNNER)}], { encoding: 'utf8', timeout: 12000, maxBuffer: 4096 });
    if (checks.stdout) process.stdout.write(checks.stdout);
    if (checks.stderr) process.stderr.write(checks.stderr);
    process.exit(Number.isInteger(checks.status) ? checks.status : 124);
  } catch (error) {
    process.stderr.write('Harness could not load the generated files.\n');
    process.exit(125);
  }
});`;

export function sandboxConfiguration(env) {
  const iamToken = env.NEBIUS_SANDBOX_IAM_TOKEN;
  const projectId = env.NEBIUS_SANDBOX_PROJECT_ID;
  const imageId = env.NEBIUS_SANDBOX_NODE_IMAGE_UUID;
  if (typeof iamToken !== 'string' || !iamToken.trim() || iamToken.length > 4096 || /\s/u.test(iamToken)
    || typeof projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(projectId)
    || typeof imageId !== 'string' || !UUID.test(imageId)) {
    fail('execution_unavailable', 'The isolated execution sandbox is not configured.');
  }
  return { iamToken, projectId, imageId: imageId.toLowerCase() };
}

const headers = config => ({ authorization: `Bearer ${config.iamToken}`, project: config.projectId, accept: 'application/json' });

async function boundedJson(response) {
  if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json') || !response.body) {
    await response.body?.cancel();
    fail('sandbox_invalid_response', 'The isolated runner returned an unsupported response.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, body = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) fail('sandbox_invalid_response', 'The isolated runner returned an oversized response.');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof SandboxError) throw error;
    fail('sandbox_invalid_response', 'The isolated runner returned an invalid response.');
  } finally { reader.releaseLock(); }
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function operationIdFromLocation(location) {
  try {
    const url = new URL(location, BASE_URL);
    if (url.origin !== new URL(BASE_URL).origin || url.search || url.hash) return null;
    return url.pathname.match(/\/operations\/([0-9a-f-]{36})$/iu)?.[1]?.toLowerCase() ?? null;
  } catch { return null; }
}

export async function spawnSandbox(config, files, { fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const body = {
    command: '/usr/local/bin/node', args: ['-e', HARNESS], shell: false,
    image: config.imageId, disposable: false, preserve_env: false, cwd: '/tmp', uid: 1000, gid: 1000,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, resources_limits: { max_layer_bytes: 8388608 },
    networking: { enabled: false }, stdin: { value: encodeBase64(JSON.stringify({ files: validateRunFiles(files) })), encoding: 'base64', close: true },
    timeout: RUN_LIMITS.sandboxSeconds, truncate_output_at: 4096,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Manual mode is supported by Workers; only the expected status is accepted.
    const response = await fetcher(`${BASE_URL}/instances`, { method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { ...headers(config), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (response.status !== 201) {
      await response.body?.cancel();
      fail('sandbox_submission_failed', 'The isolated runner refused the execution request.');
    }
    const operationId = operationIdFromLocation(response.headers.get('location') || '');
    let raw;
    try { raw = await boundedJson(response); }
    catch { fail('sandbox_submission_uncertain', 'The isolated runner accepted a request without a usable operation receipt.', true); }
    if (!UUID.test(operationId || '') || !isRecord(raw) || typeof raw.image !== 'string' || raw.image.toLowerCase() !== config.imageId
      || typeof raw.uuid !== 'string' || !UUID.test(raw.uuid)) {
      fail('sandbox_submission_uncertain', 'The isolated runner accepted a request without a usable operation receipt.', true);
    }
    return operationId;
  } catch (error) {
    if (error instanceof SandboxError) throw error;
    fail('sandbox_submission_uncertain', 'The isolated runner submission outcome is unknown.', true);
  } finally { clearTimeout(timer); }
}

function decodeStream(value) {
  if (!isRecord(value) || typeof value.value !== 'string' || value.value.length > 8192 || !['ascii', 'base64'].includes(value.encoding)) {
    fail('sandbox_invalid_response', 'The isolated runner returned an invalid output stream.');
  }
  try {
    if (value.encoding === 'ascii') return value.value.slice(0, 4096);
    const binary = atob(value.value);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, 4096);
  } catch { fail('sandbox_invalid_response', 'The isolated runner returned an invalid output stream.'); }
}

export async function readSandboxOperation(config, operationId, { fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!UUID.test(operationId)) fail('sandbox_invalid_response', 'The isolated runner operation identity is invalid.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${BASE_URL}/operations/${operationId}`, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: headers(config) });
    if (!response.ok) { await response.body?.cancel(); fail('sandbox_status_unavailable', 'The isolated runner status is temporarily unavailable.'); }
    const raw = await boundedJson(response);
    if (!isRecord(raw) || typeof raw.uuid !== 'string' || raw.uuid.toLowerCase() !== operationId || raw.kind !== 'instance'
      || !['PENDING', 'ASSIGNED', 'EXECUTING', 'SUCCESS', 'FAILED', 'CANCELLED'].includes(raw.status)
      || !isRecord(raw.metadata) || typeof raw.metadata.image !== 'string' || raw.metadata.image.toLowerCase() !== config.imageId) {
      fail('sandbox_invalid_response', 'The isolated runner returned a mismatched operation record.');
    }
    if (!['SUCCESS', 'FAILED', 'CANCELLED'].includes(raw.status)) return { terminal: false, status: raw.status };
    if (raw.status === 'CANCELLED') return { terminal: true, status: 'CANCELLED' };
    const result = raw.metadata.result;
    if (!isRecord(result) || !isRecord(result.state) || !Number.isSafeInteger(result.state.exit_code)
      || result.state.exit_code < 0 || result.state.exit_code > 255) {
      fail('sandbox_invalid_response', 'The isolated runner returned no observed process exit code.');
    }
    const checkpointId = raw.result_image_uuid == null ? null : String(raw.result_image_uuid).toLowerCase();
    if (checkpointId !== null && !UUID.test(checkpointId)) fail('sandbox_invalid_response', 'The isolated runner returned an invalid checkpoint identity.');
    return { terminal: true, status: raw.status, exitCode: result.state.exit_code,
      stdout: decodeStream(result.stdout), stderr: decodeStream(result.stderr), checkpointId };
  } catch (error) {
    if (controller.signal.aborted) fail('sandbox_status_unavailable', 'The isolated runner status is temporarily unavailable.');
    if (error instanceof SandboxError) throw error;
    fail('sandbox_status_unavailable', 'The isolated runner status is temporarily unavailable.');
  } finally { clearTimeout(timer); }
}

export async function cancelSandboxOperation(config, operationId, { fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!UUID.test(operationId)) fail('sandbox_invalid_response', 'The isolated runner operation identity is invalid.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${BASE_URL}/operations/${operationId}`, { method: 'DELETE', redirect: 'manual', signal: controller.signal, headers: headers(config) });
    await response.body?.cancel();
    if (response.status === 202) return true;
    if ([404, 409].includes(response.status)) return false;
    fail('sandbox_cancellation_failed', 'The isolated runner refused the cancellation request.');
  } catch (error) {
    if (error instanceof SandboxError) throw error;
    fail('sandbox_cancellation_uncertain', 'The isolated runner cancellation outcome is unknown.', true);
  } finally { clearTimeout(timer); }
}
