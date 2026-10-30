import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preventFailedAssetCaching } from '../worker/asset-cache-guard.mjs';
test('successful asset is returned unchanged', () => {
  const response = new Response('js', {status: 200, headers: {'content-type':'application/javascript'}});
  assert.strictEqual(preventFailedAssetCaching(response), response);
});
for (const status of [404, 500]) test(`asset error ${status} forbids caching and preserves body and headers`, async () => {
  const original = new Response('error', {status, headers: {'cache-control':'public, max-age=31536000, immutable', 'content-type':'text/plain'}});
  const response = preventFailedAssetCaching(original);
  assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'text/plain'); assert.equal(await response.text(), 'error');
});
test('bodyless HEAD error is preserved and forbidden from caching', () => {
  const response = preventFailedAssetCaching(new Response(null, {status:404}));
  assert.equal(response.body, null); assert.equal(response.headers.get('cache-control'), 'no-store');
});
