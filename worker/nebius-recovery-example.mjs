import recoveryExample from '../examples/nebius-recovery-simulator.json' with { type: 'json' };
import { RUN_LIMITS, runFilesDigest, validateToolRequirements } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { decodeSourceLines } from './nebius-run-provider.mjs';
import { validateGeneratedSource } from './nebius-run-admission.mjs';
import { renderRunPreview } from './nebius-run-preview.mjs';

export const RECOVERY_EXAMPLE_PATH = '/api/nebius/examples/recovery-simulator';
export const RECOVERY_DOWNLOAD_PATH = RECOVERY_EXAMPLE_PATH + '/download';
// Named links in retained demos keep working, with no independent source path.
export const RECOVERY_REDIRECT_PATHS = Object.freeze([
  '/api/nebius/examples/project-recovery', '/api/nebius/examples/project-recovery-repaired',
]);
export const RECOVERY_SOURCE_DIGEST = '1c30eea93daa97ff2e9a4961e75eefa6a4155e542b0925031cc9b766ecfc5c7d';
const metadata = Object.freeze({
  schemaVersion: 1,
  sourceKind: 'assistant-authored-extension-of-failed-run',
  title: 'Recovery Simulator',
  originalRunId: '9b9c8d06-35ce-499e-a330-f90f9c93a18f',
  originalOutcome: 'failed',
  model: 'nvidia/nemotron-3-super-120b-a12b',
  qualifiedOn: '2026-10-23',
  qualification: 'Private display accessibility update of the assistant-authored extension; offline source admission only. No successful new model or Sandbox run claim.',
});
const pins = Object.freeze({
  'index.html': 'fa235a92499a02b88aadc6440d1088ad11c0dc6614c27df583da2c83336bb070',
  'app.js': '8a2d7942559e860ec8f4e9e0d1c4279bea063013b78902db2beccdfebab5176c',
  'checks.cjs': '0e3184553a934e8adf8a9a6924cf0821043618752f0b741de2d9860e84e7384d',
});
const requiredInputFormats = [
  'delay-days', 'target-day', 'choice', 'delivery-days', 'prepare-days', 'assembly-days',
].map(id => ({ id, format: 'text' }));
const requiredOutputs = [
  'target-status', 'baseline-finish', 'delayed-finish', 'selected-finish',
  'option-none', 'option-expedite', 'option-help', 'option-both', 'decision-note', 'bottleneck', 'error',
].map(id => ({ id, format: 'text' })).concat({ id: 'schedule', format: 'timeline' });
const keys = [...Object.keys(metadata), 'requiredInputFormats', 'requiredOutputs', 'files'];
const exact = (value, names) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');

// Static admission only: raw application and check source remain strings.
// Only the fixed module-relative bundle can be selected by the route.
export async function validateRecoveryExample(value) {
  if (!exact(value, keys)) throw new TypeError('The recovery example has unexpected fields.');
  for (const [key, expected] of Object.entries(metadata)) {
    if (value[key] !== expected) throw new TypeError('The recovery example provenance does not match the pinned source.');
  }
  const requirements = validateToolRequirements(value.requiredInputFormats, value.requiredOutputs);
  if (JSON.stringify(requirements) !== JSON.stringify({ requiredInputFormats, requiredOutputs })) {
    throw new TypeError('The recovery example must retain its exact input and output requirements.');
  }
  const names = Object.keys(pins);
  if (!Array.isArray(value.files) || value.files.length !== names.length) throw new TypeError('The recovery example needs its three pinned source files.');
  let total = 0;
  const sources = [];
  for (const [index, file] of value.files.entries()) {
    const path = names[index];
    if (!exact(file, ['path', 'content', 'sha256']) || file.path !== path || file.sha256 !== pins[path]
      || typeof file.content !== 'string') throw new TypeError('The recovery example source metadata does not match.');
    const bytes = new TextEncoder().encode(file.content);
    total += bytes.byteLength;
    if (bytes.byteLength > RUN_LIMITS.maxFileBytes || total > RUN_LIMITS.maxTotalFileBytes) {
      throw new TypeError('The recovery example source exceeds its size limit.');
    }
    if (await sha256(bytes) !== pins[path]) throw new TypeError('The recovery example differs from the pinned raw source.');
    // The retained source has one closing-fence delimiter newline. Preserve
    // the v12 reader's sole transformation before the production decoder.
    const canonical = file.content.replace(/\r\n/gu, '\n');
    if (!canonical.endsWith('\n')) throw new TypeError('The recovery example is missing its delimiter newline.');
    sources.push({ path, lines: canonical.slice(0, -1).split('\n') });
  }
  const files = decodeSourceLines(sources);
  await validateGeneratedSource(files, requirements);
  const sourceDigest = await runFilesDigest(files);
  if (sourceDigest !== RECOVERY_SOURCE_DIGEST) throw new TypeError('The recovery example materialization differs from its pinned digest.');
  return { ...metadata, ...requirements, files, sourceDigest };
}

export async function recoveryExamplePreview() {
  const example = await validateRecoveryExample(recoveryExample);
  const preview = await renderRunPreview(example.files, {
    requiredInputFormats: example.requiredInputFormats, requiredOutputs: example.requiredOutputs,
  });
  return { ...preview, sourceDigest: example.sourceDigest };
}

export function isRecoveryExamplePath(path) {
  return path === RECOVERY_EXAMPLE_PATH || path === RECOVERY_DOWNLOAD_PATH
    || RECOVERY_REDIRECT_PATHS.some(legacy => path === legacy || path === legacy + '/download');
}

const headers = Object.freeze({
  'cache-control': 'no-store', 'content-type': 'text/plain;charset=utf-8',
  'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
});

export async function handleRecoveryExample(request) {
  const reply = (body, status, extra = {}) => new Response(request.method === 'HEAD' ? null : body, { status, headers: { ...headers, ...extra } });
  let url;
  try { url = new URL(request.url); } catch { return reply('Invalid request.', 400); }
  if (!isRecoveryExamplePath(url.pathname)) return reply('Not found.', 404);
  if (!['GET', 'HEAD'].includes(request.method)) return reply('Use GET or HEAD.', 405, { allow: 'GET, HEAD' });
  if (url.search || url.hash || /[?#]/u.test(request.url)) return reply('This example takes no parameters.', 400);
  if (url.pathname !== RECOVERY_EXAMPLE_PATH && url.pathname !== RECOVERY_DOWNLOAD_PATH) {
    return reply(null, 308, { location: url.pathname.endsWith('/download') ? RECOVERY_DOWNLOAD_PATH : RECOVERY_EXAMPLE_PATH });
  }
  try {
    const preview = await recoveryExamplePreview();
    return reply(preview.html, 200, {
      'content-type': 'text/html;charset=utf-8', 'content-security-policy': preview.csp,
      'x-nebius-example': 'assistant-authored-extension-offline', 'x-nebius-source-digest': preview.sourceDigest,
      ...(url.pathname === RECOVERY_DOWNLOAD_PATH ? { 'content-disposition': 'attachment; filename="recovery-simulator.html"' } : {}),
    });
  } catch { return reply('The recovery simulator is unavailable.', 503); }
}
