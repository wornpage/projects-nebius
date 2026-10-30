import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanningTrace, validatePlanningTrace, providerFailureDetails } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { PLAN_VERSION, PLAN_GROUNDING_VERSION, validatePlanGroundingReview, createDiagnosticCandidate,
  validateDiagnosticCandidate, validatePlanningResult, planInputDigest, projectPlanDigest } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';

// Authored fixtures exercise structure and control flow, not model semantics.
const model = 'nvidia/test-grounding-model', requestId = 'contract-test-request';
const brief = 'Prepare a report. Topic is unknown. Clarify the topic, then write a draft.';
const plan = { title: 'Report', summary: '', tasks: [
  { id: 'topic', title: 'Clarify topic', purpose: 'Identify the topic.', nextStep: 'Confirm the topic.', doneWhen: 'The topic is recorded.', dependsOn: null },
  { id: 'draft', title: 'Write draft', purpose: 'Prepare the requested draft.', nextStep: 'Write the draft for the confirmed topic.', doneWhen: 'The draft is ready for human review.', dependsOn: 'topic' },
], missingInformation: ['What topic should the report cover?'] };
const grounded = { assessment: 'grounded', findings: [] };
const unknownFinding = { category: 'missing_unknown', planPath: '/missingInformation', planQuote: '', briefQuote: 'Topic is unknown.', reason: 'Confirm the missing topic.' };
const blockedReview = { assessment: 'unclear', findings: [unknownFinding] };
const first = () => ({ stage: 'plan', reservation: 'reserved', providerAttempted: true, outcome: 'passed', model, usage: { input_tokens: 10, output_tokens: 20 }, usageKnown: true });
const second = () => ({ stage: 'grounding-review', reservation: 'reserved', providerAttempted: true, outcome: 'passed', model, usage: { input_tokens: 30, output_tokens: 40 }, usageKnown: true });
const trace = (review = second(), initial = first()) => createPlanningTrace([initial, review]);
async function result(outcome = 'reviewable', changes = {}) {
  const candidate = await createDiagnosticCandidate(plan, { requestId, brief, model });
  const planningTrace = changes.planningTrace ?? trace(outcome === 'blocked' ? { ...second(), outcome: 'blocked' } : second());
  const usage = planningTrace.providerAttempts > 0 && planningTrace.unknownUsageCalls === 0
    ? { input_tokens: planningTrace.knownInputTokens, output_tokens: planningTrace.knownOutputTokens } : null;
  return { requestId, model, requestedModel: model, groundingModel: model, promptVersion: PLAN_VERSION, groundingVersion: PLAN_GROUNDING_VERSION,
    applied: false, outcome, briefDigest: candidate.briefDigest, candidateDigest: candidate.candidateDigest,
    plan: outcome === 'reviewable' ? structuredClone(plan) : null, diagnosticCandidate: outcome === 'reviewable' ? null : candidate,
    groundingReview: outcome === 'reviewable' ? grounded : outcome === 'blocked' ? blockedReview : null,
    planningTrace, providerAttempted: planningTrace.providerAttempts > 0, usageUnknown: planningTrace.unknownUsageCalls > 0, usage, ...changes };
}
const expected = { requestId, brief, model };

test('trace derives attempts, reservations and known usage from both stages', () => {
  const value = trace();
  assert.deepEqual([value.providerAttempts, value.budgetReservations, value.knownUsageCalls, value.unknownUsageCalls], [2, 2, 2, 0]);
  assert.equal(value.knownInputTokens, 40); assert.equal(value.knownOutputTokens, 60);
  assert.deepEqual(validatePlanningTrace(value, model), value);
});
test('an unknown second usage receipt preserves first-stage subtotals', () => {
  const value = trace({ ...second(), outcome: 'failed', usage: null, usageKnown: false });
  assert.equal(value.providerAttempts, 2); assert.equal(value.unknownUsageCalls, 1);
  assert.equal(value.knownInputTokens, 10); assert.equal(value.knownOutputTokens, 20);
  const failure = providerFailureDetails({ providerAttempted: true, usageUnknown: true, usage: null, planningTrace: value, diagnostic: 'Review failed.' });
  assert.equal(failure.planningTrace.knownUsageCalls, 1); assert.equal(failure.usage, null);
});
test('second reservation refusal is not an unknown provider attempt', () => {
  const value = trace({ ...second(), reservation: 'refused', providerAttempted: false, outcome: 'refused', usage: null, usageKnown: false });
  assert.deepEqual([value.providerAttempts, value.budgetReservations, value.unknownUsageCalls], [1, 1, 0]);
  assert.equal(value.knownOutputTokens, 20);
});
test('an uncertain reservation remains distinct from definite refusal', () => {
  const value = trace({ ...second(), reservation: 'unknown', providerAttempted: false, outcome: 'failed', usage: null, usageKnown: false });
  assert.equal(value.unknownReservations, 1); assert.equal(value.budgetReservations, 1); assert.equal(value.providerAttempts, 1);
});
test('forged trace summaries, missing fields and fabricated usage are rejected', () => {
  for (const value of [ { ...trace(), knownOutputTokens: 0 }, { ...trace(), unknownReservations: undefined },
    { ...trace(), stages: [{ ...first(), providerAttempted: false }, second()] },
    { ...trace(), stages: [first(), { ...second(), usageKnown: false }] } ]) assert.throws(() => validatePlanningTrace(value));
});
test('review cannot reserve or run after failed planning', () => {
  assert.throws(() => trace(second(), { ...first(), outcome: 'failed' }));
  assert.throws(() => trace(second(), { ...first(), outcome: 'blocked' }));
  assert.throws(() => trace({ ...second(), reservation: 'not_requested', providerAttempted: false,
    outcome: 'cancelled', usage: null, usageKnown: false }, { ...first(), outcome: 'failed' }));
});

test('reservation and outcome pairs reject invented unstarted or refused stages', () => {
  for (const outcome of ['not_started', 'refused']) {
    assert.throws(() => trace({ ...second(), providerAttempted: false, outcome, usage: null, usageKnown: false }));
  }
});

test('a boundary before review reservation preserves the valid first-stage receipt', () => {
  for (const outcome of ['not_started', 'cancelled']) {
    const value = trace({ ...second(), reservation: 'not_requested', providerAttempted: false, outcome, usage: null, usageKnown: false });
    assert.equal(value.providerAttempts, 1); assert.equal(value.budgetReservations, 1);
    assert.equal(value.knownOutputTokens, 20); assert.deepEqual(validatePlanningTrace(value, model), value);
  }
});
test('trace model identity and arithmetic overflow fail loudly', () => {
  assert.throws(() => trace({ ...second(), model: 'nvidia/other' }));
  assert.throws(() => validatePlanningTrace(trace(), 'nvidia/other'));
  assert.throws(() => trace({ ...second(), usage: { input_tokens: 1, output_tokens: 1 } }, { ...first(), usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 } }));
});
test('audit paths and quotes bind to exact allowed plan text', () => {
  const value = { assessment: 'not_grounded', findings: [{ category: 'unsupported_detail', planPath: '/tasks/1/nextStep',
    planQuote: 'Write the draft', briefQuote: 'write a draft', reason: 'Authored review fixture, not a semantic assertion.' }] };
  assert.deepEqual(validatePlanGroundingReview(value, { brief, plan }), value);
});
test('grounded requires zero findings and blocked assessments need findings', () => {
  assert.deepEqual(validatePlanGroundingReview(grounded, { brief, plan }), grounded);
  assert.throws(() => validatePlanGroundingReview({ assessment: 'grounded', findings: [unknownFinding] }, { brief, plan }));
  assert.throws(() => validatePlanGroundingReview({ assessment: 'unclear', findings: [] }, { brief, plan }));
});
test('unknown-information findings require an exact brief quote and no invented plan quote', () => {
  assert.deepEqual(validatePlanGroundingReview(blockedReview, { brief, plan }), blockedReview);
  for (const finding of [{ ...unknownFinding, briefQuote: '' }, { ...unknownFinding, planQuote: 'absent' },
    { ...unknownFinding, planPath: '/title' }, { ...unknownFinding, briefQuote: 'The owner said yes.' }]) {
    assert.throws(() => validatePlanGroundingReview({ assessment: 'unclear', findings: [finding] }, { brief, plan }));
  }
});
test('prototype, out-of-range, noncanonical and nontext paths are rejected', () => {
  for (const planPath of ['/__proto__/title', '/tasks/7/title', '/tasks/01/title', '/tasks/1/dependsOn', '/tasks/1/executionInputs']) {
    assert.throws(() => validatePlanGroundingReview({ assessment: 'not_grounded', findings: [
      { category: 'unsupported_detail', planPath, planQuote: 'draft', briefQuote: '', reason: 'Fixture' },
    ] }, { brief, plan }));
  }
});
test('duplicate, unquoted, excessive and control-bearing findings are rejected', () => {
  for (const findings of [[unknownFinding, unknownFinding], Array(5).fill(unknownFinding), [{ ...unknownFinding, reason: 'bad\u0000text' }],
    [{ ...unknownFinding, extra: true }], [{ ...unknownFinding, category: 'unsupported_detail', planPath: '/title', planQuote: 'not in field' }]]) {
    assert.throws(() => validatePlanGroundingReview({ assessment: 'not_grounded', findings }, { brief, plan }));
  }
});
test('candidate hashes use the canonical plan and exact brief', async () => {
  const value = await createDiagnosticCandidate(plan, expected);
  assert.equal(value.briefDigest, await planInputDigest({ brief })); assert.equal(value.candidateDigest, await projectPlanDigest(plan));
  assert.deepEqual(await validateDiagnosticCandidate(value, expected), value);
  await assert.rejects(validateDiagnosticCandidate({ ...value, candidateDigest: '0'.repeat(64) }, expected));
  await assert.rejects(validateDiagnosticCandidate(value, { ...expected, brief: brief + ' changed' }));
  await assert.rejects(validateDiagnosticCandidate(value, { ...expected, requestId: 'other' }));
});
test('only a complete grounded result releases a reviewable plan', async () => {
  const value = await result();
  const checked = await validatePlanningResult(value, expected);
  assert.deepEqual(checked.plan, plan); assert.equal(checked.diagnosticCandidate, null); assert.equal(checked.outcome, 'reviewable');
  for (const changes of [{ groundingReview: blockedReview }, { groundingVersion: 'old' }, { promptVersion: 'project-plan.v3' },
    { briefDigest: '0'.repeat(64) }, { candidateDigest: null }, { usage: { input_tokens: 0, output_tokens: 0 } }]) {
    await assert.rejects(validatePlanningResult({ ...value, ...changes }, expected));
  }
});
test('blocked evidence retains the exact diagnostic candidate and never a top-level plan', async () => {
  const value = await result('blocked'), checked = await validatePlanningResult(value, expected);
  assert.equal(checked.plan, null); assert.deepEqual(checked.diagnosticCandidate.plan, plan); assert.equal(checked.groundingReview.assessment, 'unclear');
  await assert.rejects(validatePlanningResult({ ...value, plan }, expected));
  await assert.rejects(validatePlanningResult({ ...value, diagnosticCandidate: null }, expected));
  await assert.rejects(validatePlanningResult({ ...value, groundingReview: grounded }, expected));
});
test('failed review retains first usage and its candidate despite unknown second usage', async () => {
  const planningTrace = trace({ ...second(), outcome: 'failed', usage: null, usageKnown: false });
  const checked = await validatePlanningResult(await result('failed', { planningTrace }), expected);
  assert.equal(checked.plan, null); assert.equal(checked.usage, null); assert.equal(checked.usageUnknown, true);
  assert.equal(checked.planningTrace.knownOutputTokens, 20); assert.deepEqual(checked.diagnosticCandidate.plan, plan);
});
test('second budget refusal retains one actual known call and no fake second usage', async () => {
  const planningTrace = trace({ ...second(), reservation: 'refused', providerAttempted: false, outcome: 'refused', usage: null, usageKnown: false });
  const checked = await validatePlanningResult(await result('failed', { planningTrace }), expected);
  assert.deepEqual(checked.usage, { input_tokens: 10, output_tokens: 20 }); assert.equal(checked.planningTrace.providerAttempts, 1);
});
test('a failure cannot silently drop its valid candidate or relabel completed stages', async () => {
  const failed = await result('failed', { planningTrace: trace({ ...second(), outcome: 'failed' }) });
  await assert.rejects(validatePlanningResult({ ...failed, diagnosticCandidate: null }, expected));
  await assert.rejects(validatePlanningResult(await result('failed'), expected));
  await assert.rejects(validatePlanningResult({ ...(await result('blocked')), outcome: 'failed' }, expected));
});
test('uncalled first stage is not fabricated as a zero-token provider receipt', async () => {
  const initial = { ...first(), reservation: 'refused', providerAttempted: false, outcome: 'refused', usage: null, usageKnown: false };
  const later = { ...second(), reservation: 'not_requested', providerAttempted: false, outcome: 'not_started', usage: null, usageKnown: false };
  const planningTrace = trace(later, initial);
  const value = await result('failed', { planningTrace, candidateDigest: null, diagnosticCandidate: null });
  const checked = await validatePlanningResult(value, expected);
  assert.equal(checked.providerAttempted, false); assert.equal(checked.usage, null); assert.equal(checked.usageUnknown, false);
});
test('false grounded model verdict remains a semantic risk, not a lexical oracle', async () => {
  // A dishonest but structurally valid model verdict is indistinguishable here.
  // Independent live review must assess this risk; no test claims to solve it.
  const unsafe = structuredClone(plan); unsafe.tasks[0].nextStep = 'Gather stakeholder input and analytics.';
  const candidate = await createDiagnosticCandidate(unsafe, expected);
  const checked = await validatePlanningResult({ ...(await result()), plan: unsafe, candidateDigest: candidate.candidateDigest }, expected);
  assert.equal(checked.outcome, 'reviewable');
});
