import { RUN_VERSION, RUN_RECORD_FORMAT, RUN_LIMITS } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

// Read-only deployment identity for exact hosted verification. This endpoint
// does not inspect credentials, workspace data, run records or budget objects.
export function handleBuildInfo(request, env) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  const reply = (value, status = 200, extra = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(value), { status, headers: { ...headers, ...extra } });
  if (!['GET', 'HEAD'].includes(request.method)) return reply({ code: 'method_not_allowed' }, 405, { allow: 'GET, HEAD' });
  if (new URL(request.url).search) return reply({ code: 'invalid_request' }, 400);
  const versionId = env.NEBIUS_VERSION?.id;
  if (typeof versionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(versionId)) {
    return reply({ available: false, code: 'version_unavailable' }, 503);
  }
  return reply({ available: true, versionId, runVersion: RUN_VERSION, recordFormat: RUN_RECORD_FORMAT, limits: RUN_LIMITS,
    guidanceEnabled: env.NEBIUS_ENABLED === 'true', executionEnabled: env.NEBIUS_EXECUTION_ENABLED === 'true' });
}
