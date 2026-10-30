import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_LIMITS, RUN_RECORD_LIMITS, RUN_VERSION, isRunConfig, validateRunIntegrity } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { FIXTURE_MODEL, authoredThreeAttemptReference } from './fixtures/nebius-release-checker.mjs';

test('historical read ceiling does not raise new run limits', () => {
  assert.deepEqual(RUN_RECORD_LIMITS, { maxModelCalls: 3, maxSandboxRuns: 3 });
  assert.equal(RUN_LIMITS.maxModelCalls, 2);
  assert.equal(RUN_LIMITS.maxSandboxRuns, 2);
  const config = { available: true, version: RUN_VERSION, requestedModel: FIXTURE_MODEL, limits: RUN_LIMITS };
  assert.equal(isRunConfig(config), true);
  assert.equal(isRunConfig({ ...config, limits: { ...RUN_LIMITS, maxModelCalls: 3, maxSandboxRuns: 3 } }), false);
});

for (const status of ['ready', 'failed', 'cancelled', 'uncertain']) {
  test(`retain a historical three-attempt ${status} record`, async () => {
    const reference = await authoredThreeAttemptReference(status);
    assert.deepEqual(await validateRunIntegrity(structuredClone(reference.record)), reference.record);
  });
}