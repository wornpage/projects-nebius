import recordedExample from '../examples/nebius-release-checker.json' with { type: 'json' };
import { runFilesDigest, validateRunFiles, validateToolInputRequirements } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { renderRunPreview } from './nebius-run-preview.mjs';

export const RECORDED_EXAMPLE_PATH = '/api/nebius/examples/release-packet-checker';
export const RECORDED_EXAMPLE_DIGEST = 'bef3f967a4f28d06cc27a2d9ce46039472847b7dfeb02077d455ee16b97a2bac';
const metadata = Object.freeze({ format: 'nebius-recorded-example.v1', title: 'Release packet checker', model: 'nvidia/nemotron-3-super-120b-a12b', recordedOn: '2026-10-19' });
const keys = [...Object.keys(metadata), 'requiredInputFormats', 'files'].sort();

export async function validateRecordedExample(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) throw new TypeError('The recorded example has unexpected fields.');
  for (const [key, expected] of Object.entries(metadata)) if (value[key] !== expected) throw new TypeError('The recorded example metadata does not match its observed provenance.');
  const requiredInputFormats = validateToolInputRequirements(value.requiredInputFormats);
  if (JSON.stringify(requiredInputFormats) !== JSON.stringify([{ id: 'input-json', format: 'json' }])) throw new TypeError('The recorded example must retain its task-owned JSON input.');
  const files = validateRunFiles(value.files);
  if (await runFilesDigest(files) !== RECORDED_EXAMPLE_DIGEST) throw new TypeError('The recorded example differs from the observed source.');
  return { ...metadata, files, requiredInputFormats, sourceDigest: RECORDED_EXAMPLE_DIGEST };
}

// This fixed public-safe example has no provider, budget, workspace or run-key
// dependency. Model code is data here and runs only in the existing preview.
export async function handleRecordedExample(request) {
  const headers = { 'cache-control': 'no-store', 'content-type': 'text/plain;charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'same-origin', 'x-robots-tag': 'noindex, nofollow, noarchive' };
  const url = new URL(request.url);
  if (url.pathname !== RECORDED_EXAMPLE_PATH) return new Response('Not found.', { status: 404, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Use GET or HEAD for the recorded example.', { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
  if (url.search) return new Response('The recorded example takes no request parameters.', { status: 400, headers });
  try {
    const example = await validateRecordedExample(recordedExample);
    const preview = await renderRunPreview(example.files, { requiredInputFormats: example.requiredInputFormats });
    return new Response(request.method === 'HEAD' ? null : preview.html, { headers: {
      ...headers, 'content-type': 'text/html;charset=utf-8', 'content-security-policy': preview.csp,
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'x-nebius-example': 'recorded-2026-10-19', 'x-nebius-source-digest': example.sourceDigest,
    } });
  } catch {
    return new Response('The recorded example is unavailable.', { status: 503, headers });
  }
}
