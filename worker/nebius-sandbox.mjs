import { isRecord } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { RUN_LIMITS, validateRunFiles } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { TIMELINE_VALIDATOR_SOURCE } from '../svelte-frontend/src/lib/nebius-timeline-contract.mjs';
import { runPageContract } from './nebius-run-preview.mjs';
import { wrapRunChecks } from './nebius-run-checks.mjs';

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
const { types } = require('node:util');
const validateTimelinePatch = ${TIMELINE_VALIDATOR_SOURCE};
let validateCalls = 0, handleMessageCalls = 0, assertionCalls = 0, assertionFailed = false;
let contractFailure = null;
const harden = value => Object.freeze(Object.setPrototypeOf(value, null));
// Generated logging is discarded; only trusted assertion counts reach stdout.
const quietLog = harden(() => {});
const quietConsole = Object.freeze(Object.assign(Object.create(null), {
  log: quietLog, info: quietLog, warn: quietLog, error: quietLog, debug: quietLog
}));
const context = vm.createContext(Object.assign(Object.create(null), { console: quietConsole }), {
  codeGeneration: { strings: false, wasm: false }
});
const contextObjectPrototype = vm.runInContext('Object.prototype', context);
const contextArrayPrototype = vm.runInContext('Array.prototype', context);
const ContextError = vm.runInContext('Error', context);
const parseMessage = vm.runInContext('((parse) => value => parse(value))(JSON.parse)', context);
const boundedMessage = error => String(error && error.message || error).slice(0, 800);
const sourceLocations = error => {
  const stack = String(error && error.stack || '').slice(0, 4096);
  const locations = [...new Set(stack.match(/\b(?:app\.js|checks\.cjs):\d{1,6}(?::\d{1,6})?/g) || [])].slice(0, 4);
  return locations.length ? '\nSource locations: ' + locations.join(', ') : '';
};
const syntaxExcerpt = (error, filename, source) => {
  const stack = String(error && error.stack || '').slice(0, 4096).split('\n');
  const prefix = filename + ':';
  const at = stack.findIndex(line => line.startsWith(prefix));
  const lineNumber = at < 0 ? NaN : Number(stack[at].slice(prefix.length).split(':')[0]);
  const line = Number.isSafeInteger(lineNumber) && lineNumber > 0 ? source.split('\n')[lineNumber - 1] : null;
  if (typeof line !== 'string') return '';
  const marker = stack[at + 2] || '';
  const column = /^ *\^/.test(marker) ? marker.indexOf('^') : 0;
  const start = Math.max(0, column - 80);
  const excerpt = line.slice(start, start + 160).replace(/[\u0000-\u001f\u007f]/g, ' ');
  return '\nSource excerpt ' + filename + ':' + lineNumber + ':' + (column + 1) + ': '
    + (start ? '…' : '') + excerpt + (line.length > start + 160 ? '…' : '');
};
const deny = message => { throw new ContextError(message); };
function runModule(source, filename, requireValue) {
  const moduleValue = vm.runInContext('({ exports: {} })', context);
  context.__module = moduleValue;
  context.__require = requireValue;
  const wrapped = '(function(module, exports, require) { "use strict";\n' + source + '\n})(__module, __module.exports, __require);';
  try { new vm.Script(wrapped, { filename, lineOffset: -1 }).runInContext(context, { timeout: 4000 }); }
  finally { delete context.__module; delete context.__require; }
  return moduleValue.exports;
}
const checksWrapper = ${wrapRunChecks.toString()};
const contractDeny = message => { contractFailure ||= message; return deny(message); };
const ownRecord = value => value !== null && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value);
function plainData(value) {
  if (!ownRecord(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), data = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    data[key] = descriptor.value;
  }
  return data;
}
function dataArray(value, limit) {
  if (types.isProxy(value) || !Array.isArray(value) || value.length > limit) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => typeof key !== 'string' || (key !== 'length' && !/^(?:0|[1-9]\d*)$/.test(key)))) return null;
  const data = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
    data.push(descriptor.value);
  }
  return data;
}
function checkPatches(message, patches, elements, refreshed, refreshedTimelines) {
  const patchData = dataArray(patches, 100);
  if (!patchData) return contractDeny('handleMessage must return a patch array containing bounded plain-data patches.');
  const snapshot = [];
  for (const rawPatch of patchData) {
    const patch = plainData(rawPatch);
    if (!patch) return contractDeny('Patch fields must be own enumerable plain data.');
    if (typeof patch.id !== 'string' || !elements.has(patch.id)) return contractDeny('A patch targets an ID absent from the sanitized index.html.');
    const element = elements.get(patch.id), keys = Object.keys(patch);
    if (keys.length < 2 || keys.some(key => key !== 'id' && !element.fields.includes(key))) return contractDeny('A patch field is incompatible with its declared element.');
    const observed = { id: patch.id };
    let timeline = null;
    try { timeline = validateTimelinePatch(rawPatch, element.outputFormat, types.isProxy, contextObjectPrototype, contextArrayPrototype); }
    catch (error) { return contractDeny(boundedMessage(error)); }
    for (const field of keys.filter(key => key !== 'id')) {
      const value = patch[field];
      if (field === 'text' || field === 'value') {
        if (typeof value !== 'string' || value.length > (field === 'text' ? 16000 : 4000)) return contractDeny('A patch string exceeds its type or size limit.');
        observed[field] = value;
      } else if (field === 'hidden' || field === 'disabled') {
        if (typeof value !== 'boolean') return contractDeny('A patch toggle must be boolean.');
        observed[field] = value;
      } else if (field === 'options') {
        const items = dataArray(value, 100);
        if (!items || items.some(rawItem => {
          const item = plainData(rawItem);
          return !item || Object.keys(item).sort().join(',') !== 'label,value' || typeof item.label !== 'string'
            || typeof item.value !== 'string' || item.label.length > 500 || item.value.length > 500;
        })) return contractDeny('Select options exceed the supported patch shape.');
      }
    }
    if (timeline) observed.timeline = timeline;
    snapshot.push(observed);
  }
  const outputIds = snapshot.filter(patch => Object.hasOwn(patch, 'text')).map(patch => patch.id);
  if (message.type === 'event') {
    const control = elements.get(message.id);
    if (control.exampleFor !== null) {
      const example = snapshot.filter(patch => patch.id === control.exampleFor && Object.hasOwn(patch, 'value')).at(-1);
      if (!example) return contractDeny('A declared example loader must supply its target input value.');
      if (elements.get(control.exampleFor).format === 'json') {
        try { JSON.parse(example.value); }
        catch { return contractDeny('A declared JSON example loader returned malformed JSON.'); }
      }
    }
  }
  for (const id of outputIds) refreshed.add(id);
  for (const patch of snapshot) if (patch.timeline) refreshedTimelines.add(patch.id);
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
  const page = JSON.parse(fs.readFileSync('control-contract.json', 'utf8'));
  if (page.version !== 1 || !Array.isArray(page.elements) || page.elements.length > 200) throw new Error('The server control contract is invalid.');
  const elements = new Map(page.elements.map(element => [element.id, element]));
  const observedEvents = new Set(), postOutputEdits = new Set(), refreshed = new Set(), refreshedTimelines = new Set();
  const requiredEvents = ['init', ...page.elements.flatMap(element => element.events.map(event => event + ':' + element.id))];
  const requiredEdits = page.elements.flatMap(element => element.events.filter(event => ['input', 'change'].includes(event)).map(event => event + ':' + element.id));
  const sources = new Map(['app.js', 'checks.cjs'].map(path => [path, fs.readFileSync(path, 'utf8')]));
  const syntaxFailures = [];
  for (const [path, source] of sources) {
    try { new vm.Script(path === 'checks.cjs' ? checksWrapper(source) : '(function(module, exports, require) { "use strict";\n' + source + '\n});', { filename: path, lineOffset: -1 }); }
    catch (error) { syntaxFailures.push(path + ': ' + boundedMessage(error).slice(0, 120) + sourceLocations(error) + syntaxExcerpt(error, path, source)); }
  }
  if (syntaxFailures.length) throw new Error('JavaScript syntax failed: ' + syntaxFailures.join('\n'));
  const app = runModule(sources.get('app.js'), 'app.js', harden(() => deny('app.js must not import modules.')));
  if (typeof app.validate !== 'function') throw new Error('app.js must export a validate function.');
  if (typeof app.handleMessage !== 'function') throw new Error('app.js must export a handleMessage function.');
  const appFacade = Object.freeze(Object.assign(Object.create(null), {
    validate: harden((...args) => { const result = app.validate(...args); validateCalls += 1; return result; }),
    handleMessage: harden((...args) => {
      const message = plainData(args[0]);
      if (args.length !== 1 || !ownRecord(message) || !ownRecord(message.values)
        || !['init', 'event'].includes(message.type)) return contractDeny('A handler check must use the real init or event message shape.');
      const messageKeys = message.type === 'init' ? 'type,values' : 'event,id,type,values';
      if (Object.keys(message).sort().join(',') !== messageKeys) return contractDeny('A handler message must contain only the browser message fields as plain data.');
      if (message.type === 'event' && (!elements.has(message.id) || !['click', 'input', 'change', 'submit'].includes(message.event))) return contractDeny('A handler event must name a declared page ID and real event type.');
      if (Object.keys(message.values).length !== page.elements.filter(element => element.valueControl).length) return contractDeny('A handler check must supply the complete page input snapshot.');
      message.values = plainData(message.values);
      if (!message.values) return contractDeny('Handler input values must be own plain data.');
      for (const [id, value] of Object.entries(message.values)) {
        const element = elements.get(id);
        if (!element?.valueControl || (element.booleanValue ? typeof value !== 'boolean' : typeof value !== 'string' || value.length > 4000)) return contractDeny('A handler values snapshot must match the declared input controls.');
      }
      // Keep observations outside generated objects before calling the app. The
      // app and checks may mutate their messages or return values afterwards.
      const observedMessage = message.type === 'init' ? { type: 'init', values: { ...message.values } }
        : { type: 'event', event: message.event, id: message.id, values: { ...message.values } };
      const afterOutput = refreshed.size > 0;
      let normalized;
      try { normalized = parseMessage(JSON.stringify(observedMessage)); }
      catch { return contractDeny('The handler message could not be normalized to browser data.'); }
      const patches = app.handleMessage(normalized);
      checkPatches(observedMessage, patches, elements, refreshed, refreshedTimelines);
      observedEvents.add(observedMessage.type === 'init' ? 'init' : observedMessage.event + ':' + observedMessage.id);
      if (afterOutput && ['input', 'change'].includes(observedMessage.event)) postOutputEdits.add(observedMessage.event + ':' + observedMessage.id);
      handleMessageCalls += 1;
      return patches;
    })
  }));
  const assertions = assertFacade(realAssert.strict);
  assertions.strict = assertions;
  Object.freeze(assertions);
  context.__checks = Object.freeze(Object.assign(Object.create(null), { assert: assertions, ...appFacade }));
  new vm.Script(checksWrapper(sources.get('checks.cjs')), { filename: 'checks.cjs', lineOffset: -1 }).runInContext(context, { timeout: 4000 });
  delete context.__checks;
  if (contractFailure) throw new Error('Control contract failed: ' + contractFailure);
  if (assertionFailed || assertionCalls < 1 || validateCalls < 1 || handleMessageCalls < 1) {
    throw new Error('Checks must execute at least one successful Node assertion and successfully call the exported validate and handleMessage functions; no assertion may fail.');
  }
  const missingEvents = requiredEvents.filter(event => !observedEvents.has(event));
  if (missingEvents.length) throw new Error('Control event coverage is incomplete: ' + (requiredEvents.length - missingEvents.length) + '/' + requiredEvents.length + '. Missing ' + missingEvents.slice(0, 8).join(', '));
  const missingEdits = requiredEdits.filter(event => !postOutputEdits.has(event));
  if (missingEdits.length) throw new Error('Post-output edit coverage is incomplete: ' + (requiredEdits.length - missingEdits.length) + '/' + requiredEdits.length + '.');
  if (page.elements.some(element => element.requiresText && !refreshed.has(element.id))) throw new Error('Each declared textual output must receive an observed refresh patch.');
  if (page.elements.some(element => element.outputFormat === 'timeline' && !refreshedTimelines.has(element.id))) throw new Error('Each declared timeline output must receive an observed timeline patch.');
  process.stdout.write('Observed successful assertions: ' + assertionCalls + '; validate calls: ' + validateCalls + '; handleMessage calls: ' + handleMessageCalls + '\n');
  const loaders = page.elements.filter(element => element.exampleFor !== null);
  const jsonLoaders = loaders.filter(element => elements.get(element.exampleFor).format === 'json');
  process.stdout.write('Control events observed: ' + requiredEvents.length + '/' + requiredEvents.length + '; declared JSON example loaders: ' + jsonLoaders.length + '/' + loaders.length + '; inputs without a declared format: ' + page.elements.filter(element => element.valueControl && element.format === null).length + '\n');
  process.stdout.write('Post-output edits observed: ' + requiredEdits.length + '/' + requiredEdits.length + '\n');
  process.stdout.write('Output invalidation is supplied by the preview; task-specific output correctness is not certified by this structural gate.\n');
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
    fs.writeFileSync('control-contract.json', JSON.stringify(payload.pageContract), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
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

export async function spawnSandbox(config, files, { fetcher = globalThis.fetch, timeoutMs = 15000, requiredInputFormats = null, requiredOutputs = null } = {}) {
  const admittedFiles = validateRunFiles(files);
  const pageContract = runPageContract(admittedFiles, { requiredInputFormats, requiredOutputs });
  const body = {
    command: '/usr/local/bin/node', args: ['-e', HARNESS], shell: false,
    image: config.imageId, disposable: false, preserve_env: false, cwd: '/tmp', uid: 1000, gid: 1000,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, resources_limits: { max_layer_bytes: 8388608 },
    networking: { enabled: false }, stdin: { value: encodeBase64(JSON.stringify({ files: admittedFiles, pageContract })), encoding: 'base64', close: true },
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
      // A timeout, server failure or unexpected success/redirect cannot prove
      // that the POST was rejected. Keep its outcome unknown without retrying.
      const uncertain = response.status < 400 || response.status === 408 || response.status >= 500;
      if (uncertain) fail('sandbox_submission_uncertain', 'The isolated runner submission outcome is unknown.', true);
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
