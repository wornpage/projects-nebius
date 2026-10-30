import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleNebiusApi } from '../worker/nebius-api.mjs';
import { nebiusConfiguration, TOKEN_FACTORY_URL } from '../worker/nebius-provider.mjs';
import { OPERATION_PROFILES, isOperationConfig } from '../svelte-frontend/src/lib/nebius-routing-contract.mjs';
import { PROMPT_VERSION } from '../svelte-frontend/src/lib/nebius-contract.mjs';
import { REVIEW_VERSION } from '../svelte-frontend/src/lib/nebius-review-contract.mjs';
import { PLAN_GROUNDING_VERSION, PLAN_VERSION } from '../svelte-frontend/src/lib/nebius-plan-contract.mjs';
import { REPLAN_VERSION } from '../svelte-frontend/src/lib/nebius-replan-contract.mjs';

// Synthetic identities prove route selection; they do not claim model availability.
const models = { routine: 'nvidia/synthetic-routine', reasoning: 'nvidia/synthetic-reasoning' };
const operations = Object.keys(OPERATION_PROFILES);
const pack = { title: 'Clarify scope', purpose: 'Confirm the requirements.', nextStep: 'Ask for requirements.', doneWhen: 'Requirements confirmed.', blocker: 'None' };
const task = { id: 'project:clarify', ...pack, status: 'active', blockedBy: null, archived: false };
const snapshot = { project: { id: 'project', title: 'Clarify project', summary: '' }, tasks: [task] };
const versions = { 'suggest-next-step': PROMPT_VERSION, 'review-evidence': REVIEW_VERSION, 'plan-project': PLAN_VERSION, 'replan-project': REPLAN_VERSION };
function payload(operation) {
  const base = { requestedModel: models[OPERATION_PROFILES[operation].modelRole], promptVersion: versions[operation], consent: true };
  if (operation === 'suggest-next-step') return { ...base, pack, context: [], currentStatus: 'active', update: '' };
  if (operation === 'review-evidence') return { ...base, pack, review: { criteria: [{ id: 'c1', text: pack.doneWhen }], evidence: pack.doneWhen } };
  if (operation === 'plan-project') return { ...base, brief: 'Clarify the project requirements.' };
  return { ...base, snapshot, update: 'Requirements changed. Clarify the revised scope.' };
}
function output(sent) {
  const input = JSON.parse(sent.messages[1].content);
  if (input.snapshot) { const { archived, ...fields } = task; return { summary: 'Clarify the update.', changes: [{ ...fields, nextStep: 'Ask for revised requirements.', reason: 'Scope changed.' }], missingInformation: [] }; }
  if (input.plan) return { assessment: 'grounded', findings: [] };
  if (input.brief) return { title: 'Clarify project', summary: '', tasks: [{ id: 'clarify', title: pack.title, purpose: pack.purpose, nextStep: pack.nextStep, doneWhen: pack.doneWhen, dependsOn: null }], missingInformation: [] };
  if (input.criteria) return { checks: [{ id: 'c1', assessment: 'supported', reason: 'Criterion appears in submitted text.', quote: pack.doneWhen }], comparison: { assessment: 'unclear', reason: 'No separate observation is supplied.' } };
  return { changes: { nextStep: 'Ask for revised requirements.' }, reason: 'Scope needs clarification.', basis: ['title'], missingInformation: [] };
}
function harness(t) {
  const h = { calls: 0, reservations: 0, admissions: 0, sent: [] };
  h.env = { NEBIUS_ENABLED: 'true', NEBIUS_ALLOWED_ORIGIN: 'https://app.test', NEBIUS_MODEL_ROUTINE: models.routine,
    NEBIUS_MODEL_REASONING: models.reasoning, NEBIUS_API_KEY: 'synthetic-key', NEBIUS_DAILY_CALL_LIMIT: '2',
    NEBIUS_IP_RATE_LIMITER: { limit: async () => { h.admissions++; return { success: true }; } },
    NEBIUS_BUDGET: { idFromName: name => name, get: name => { h.bucket = name; return { reserve: async limit => { if (h.reservations >= limit) return false; h.reservations++; return true; } }; } } };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    h.calls++; const sent = JSON.parse(options.body); h.sent.push({ url, options, body: sent });
    if (h.providerStatus) return new Response('PRIVATE PROVIDER DATA', { status: h.providerStatus });
    return Response.json({ model: h.responseModel ?? sent.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output(sent)) } }], usage: { prompt_tokens: 40, completion_tokens: 100 } });
  });
  h.config = (query, headers = {}) => handleNebiusApi(new Request(`https://app.test/api/nebius/config${query}`, { headers }), h.env);
  h.post = (operation, body = payload(operation), headers = {}, query = '') => handleNebiusApi(new Request(`https://app.test/api/nebius/${operation}${query}`, {
    method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers }, body: JSON.stringify(body) }), h.env);
  return h;
}

test('operation profiles are deeply frozen with exact roles and output allowances', () => {
  assert.deepEqual(OPERATION_PROFILES, { 'suggest-next-step': { modelRole: 'routine', maxOutputTokens: 1200 }, 'review-evidence': { modelRole: 'reasoning', maxOutputTokens: 1200 },
    'plan-project': { modelRole: 'reasoning', maxOutputTokens: 4000, maxModelCalls: 2, groundingMaxOutputTokens: 2000,
      maxOutputTokensTotal: 6000, maxPipelineMs: 90000, groundingVersion: PLAN_GROUNDING_VERSION },
    'replan-project': { modelRole: 'reasoning', maxOutputTokens: 4000 } });
  assert(Object.isFrozen(OPERATION_PROFILES)); for (const profile of Object.values(OPERATION_PROFILES)) assert(Object.isFrozen(profile));
  assert.throws(() => { OPERATION_PROFILES['plan-project'].maxOutputTokens = 5000; });
});
for (const operation of operations) {
  test(`${operation} config reports its exact selected model, role, cap and existing versions without quota`, async t => {
    const h = harness(t), response = await h.config(`?operation=${operation}`), config = await response.json();
    assert.equal(response.status, 200); assert(isOperationConfig(config, operation)); assert.equal(config.requestedModel, models[OPERATION_PROFILES[operation].modelRole]);
    assert.equal(config.promptVersion, PROMPT_VERSION); assert.equal(config.reviewVersion, REVIEW_VERSION); assert.equal(config.planVersion, PLAN_VERSION); assert.equal(config.replanVersion, REPLAN_VERSION);
    assert.equal(h.calls + h.reservations + h.admissions, 0); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert(!JSON.stringify(config).includes('synthetic-key'));
  });
  test(`${operation} routes its bounded provider calls with exactly the displayed allowances and unsaved output`, async t => {
    const h = harness(t), config = await (await h.config(`?operation=${operation}`)).json(), response = await h.post(operation), value = await response.json();
    assert.equal(response.status, 200); assert.equal(value.applied, false); assert.equal(value.model, config.requestedModel); assert.equal(value.requestedModel, config.requestedModel); assert.equal(value.promptVersion, versions[operation]);
    const expectedCalls = operation === 'plan-project' ? 2 : 1;
    assert.equal(h.calls, expectedCalls); assert.equal(h.reservations, expectedCalls); assert.equal(h.admissions, 1); assert.equal(h.bucket, 'token-factory-daily');
    assert.equal(h.sent[0].body.max_tokens, config.maxOutputTokens); assert.equal(h.sent[0].body.model, config.requestedModel); assert.equal(h.sent[0].url, TOKEN_FACTORY_URL); assert.equal(h.sent[0].options.redirect, 'manual');
    assert.equal(h.sent[0].body.tools, undefined); assert.equal(h.sent[0].body.stream, false); assert.equal(h.sent[0].body.response_format.type, operation === 'suggest-next-step' ? 'json_schema' : 'json_object');
    if (operation === 'plan-project') {
      assert.equal(value.groundingModel, config.requestedModel); assert.equal(value.groundingVersion, PLAN_GROUNDING_VERSION);
      assert.equal(h.sent[1].body.max_tokens, config.groundingMaxOutputTokens); assert.equal(h.sent[1].body.model, config.groundingModel);
      assert.equal(value.outcome, 'reviewable'); assert.deepEqual(value.groundingReview, { assessment: 'grounded', findings: [] });
    }
  });
  test(`${operation} rejects wrong-role or stale requested model before budget/inference`, async t => {
    const h = harness(t), wrongRole = OPERATION_PROFILES[operation].modelRole === 'routine' ? 'reasoning' : 'routine';
    for (const requestedModel of [models[wrongRole], 'nvidia/synthetic-stale']) assert.equal((await h.post(operation, { ...payload(operation), requestedModel })).status, 409);
    assert.equal(h.calls + h.reservations, 0);
  });
  test(`${operation} requires its own model setting even when the other role is valid`, async t => {
    const h = harness(t), key = OPERATION_PROFILES[operation].modelRole === 'routine' ? 'NEBIUS_MODEL_ROUTINE' : 'NEBIUS_MODEL_REASONING';
    for (const bad of [undefined, '', 'other/model', ' nvidia/synthetic', 'nvidia/synthetic\n']) {
      h.env[key] = bad; assert.equal((await h.config(`?operation=${operation}`)).status, 503); assert.equal((await h.post(operation)).status, 503);
    }
    assert.equal(h.calls + h.reservations + h.admissions, 0);
  });
  test(`${operation} does not require the unused role setting`, async t => {
    const h = harness(t), unused = OPERATION_PROFILES[operation].modelRole === 'routine' ? 'NEBIUS_MODEL_REASONING' : 'NEBIUS_MODEL_ROUTINE';
    h.env[unused] = 'INVALID UNUSED VALUE'; assert.equal((await h.config(`?operation=${operation}`)).status, 200); assert.equal((await h.post(operation)).status, 200);
    assert.equal(h.calls, operation === 'plan-project' ? 2 : 1);
  });
  test(`${operation} refuses the legacy single-model environment without alias/fallback`, async t => {
    const h = harness(t); delete h.env.NEBIUS_MODEL_ROUTINE; delete h.env.NEBIUS_MODEL_REASONING; h.env.NEBIUS_MODEL = models.routine;
    assert.equal((await h.config(`?operation=${operation}`)).status, 503); assert.equal((await h.post(operation)).status, 503); assert.equal(h.calls + h.reservations + h.admissions, 0);
  });
  test(`${operation} refuses provider identity mismatch without retry or escalation`, async t => {
    const h = harness(t); h.responseModel = models[OPERATION_PROFILES[operation].modelRole === 'routine' ? 'reasoning' : 'routine'];
    const response = await h.post(operation), body = await response.json(); assert.equal(response.status, 502); assert.equal(body.code, 'invalid_model_output'); assert.equal(h.calls, 1); assert.equal(h.reservations, 1);
  });
  test(`${operation} keeps exact input/consent/protocol and query guards`, async t => {
    const h = harness(t);
    for (const [patch, expected] of [[{ consent: false }, 400], [{ extra: 'PRIVATE' }, 400], [{ promptVersion: 'old' }, 409]]) assert.equal((await h.post(operation, { ...payload(operation), ...patch })).status, expected);
    assert.equal((await h.post(operation, payload(operation), {}, '?operation=suggest-next-step')).status, 400); assert.equal(h.calls + h.reservations, 0);
  });
}

for (const query of ['', '?', '?operation=', '?operation=unknown', '?operation=constructor', '?operation=__proto__', '?operation=plan-project&operation=plan-project', '?operation=plan-project&operation=replan-project', '?operation=plan-project&extra=1', '?other=plan-project', '?operation[]=plan-project']) {
  test(`config refuses query ${JSON.stringify(query)} before inference/admission`, async t => {
    const h = harness(t); assert.equal((await h.config(query)).status, 400); assert.equal(h.calls + h.reservations + h.admissions, 0);
  });
}
test('configuration validator rejects wrong operation/role/cap/model and unavailable config', () => {
  for (const operation of operations) {
    const good = { available: true, operation, ...OPERATION_PROFILES[operation], requestedModel: models[OPERATION_PROFILES[operation].modelRole],
      ...(operation === 'plan-project' ? { groundingModel: models.reasoning } : {}), requestId: 'receipt', promptVersion: 'checked separately by client' };
    assert(isOperationConfig(good, operation));
    for (const patch of [{ available: false }, { available: 'true' }, { operation: 'other' }, { modelRole: 'other' }, { maxOutputTokens: 1 }, { maxOutputTokens: String(good.maxOutputTokens) }, { requestedModel: 'other/model' }, { requestedModel: '' }, { requestedModel: null }]) assert.equal(isOperationConfig({ ...good, ...patch }, operation), false);
    for (const field of ['available', 'operation', 'modelRole', 'maxOutputTokens', 'requestedModel', ...(operation === 'plan-project' ? ['groundingModel'] : [])]) {
      const bad = { ...good }; delete bad[field]; assert.equal(isOperationConfig(bad, operation), false);
    }
  }
  for (const value of [null, [], true, 'config', 1]) assert.equal(isOperationConfig(value, 'suggest-next-step'), false);
  for (const operation of ['unknown', 'constructor', '__proto__', undefined, null]) assert.equal(isOperationConfig({}, operation), false);
});
test('provider configuration validates only the named operation, with no implicit operation', () => {
  const env = { NEBIUS_API_KEY: 'synthetic', NEBIUS_MODEL_ROUTINE: models.routine, NEBIUS_MODEL_REASONING: models.reasoning };
  for (const operation of operations) assert.equal(nebiusConfiguration(env, operation).model, models[OPERATION_PROFILES[operation].modelRole]);
  for (const operation of [undefined, null, 'unknown', 'constructor']) assert.throws(() => nebiusConfiguration(env, operation), { code: 'invalid_request' });
});
test('enabled/origin/credential/limits guards still protect operation-scoped config', async t => {
  const h = harness(t);
  assert.equal((await h.config('?operation=plan-project', { origin: 'https://other.test' })).status, 403);
  assert.equal((await h.config('?operation=plan-project', { 'sec-fetch-site': 'cross-site' })).status, 403);
  delete h.env.NEBIUS_API_KEY; assert.equal((await h.config('?operation=plan-project')).status, 503); h.env.NEBIUS_API_KEY = 'synthetic';
  delete h.env.NEBIUS_IP_RATE_LIMITER; assert.equal((await h.config('?operation=plan-project')).status, 503);
  h.env.NEBIUS_ENABLED = 'false'; assert.equal((await h.config('?operation=plan-project')).status, 404); assert.equal(h.calls + h.reservations + h.admissions, 0);
});
test('all operation models share the same bounded daily bucket', async t => {
  const h = harness(t); assert.equal((await h.post('suggest-next-step')).status, 200); assert.equal((await h.post('review-evidence')).status, 200); assert.equal((await h.post('plan-project')).status, 429); assert.equal(h.calls, 2); assert.equal(h.reservations, 2); assert.equal(h.bucket, 'token-factory-daily');
});
test('provider failure is sanitized with one call, no retry or role escalation', async t => {
  const h = harness(t); h.providerStatus = 401; const response = await h.post('suggest-next-step'), body = await response.json(); assert.equal(response.status, 502); assert.equal(body.code, 'nebius_request_failed'); assert(!JSON.stringify(body).includes('PRIVATE')); assert.equal(h.calls, 1); assert.equal(h.sent[0].body.model, models.routine);
});
test('checked-in source configuration disables inference with blank routine/reasoning values and no old key', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.nebius.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.vars.NEBIUS_ENABLED, 'false'); assert.equal(config.vars.NEBIUS_MODEL_ROUTINE, ''); assert.equal(config.vars.NEBIUS_MODEL_REASONING, ''); assert.equal(Object.hasOwn(config.vars, 'NEBIUS_MODEL'), false);
  assert(config.compatibility_flags.includes('enable_request_signal'));
});

function assertNebiusReviewStateContract(source) {
	assert.match(source, /staleRun = \$derived\(Boolean\(reference && !currentTaskMatches\)\)/u);
	assert.match(source, /class:stale-run=\{staleRun\}/u);
	assert.match(source, /requestContentChanged = \$derived\(Boolean\(changedRequestFields\.length \|\| review\.request\.inputFormatsChanged \|\| review\.request\.outputsChanged\)\)/u);
	assert.match(source, /statusOnlyDrift = \$derived\(staleRun && !requestContentChanged && reference\?\.input\.currentStatus !== pack\.status\)/u);
	assert.match(source, /savedToolHistory = \$derived\(Boolean\(reference\) && !requestContentChanged && \(readOnly \|\| statusOnlyDrift\)\)/u);
	assert.match(source, /toolSectionLabel = \$derived\(savedToolHistory \? 'Saved tool' : staleRun \? 'Previous tool' : 'Tool'\)/u);
	assert.match(source, /1 · Request[\s\S]*?<h3[^>]*>2 · \{toolSectionLabel\}<\/h3>[\s\S]*?3 · Build evidence[\s\S]*?4 · Decision/u);
	assert.match(source, /toolStatusText = \$derived\(ready \? \(savedToolHistory \|\| staleRun \? 'Tool retained' : 'Tool ready to try'\) : review\.label\)/u);
	assert.match(source, /<a href=\{`#\$\{sectionIds\.proposal\}`\} data-review-section-link="proposal" onclick=\{event => jumpToSection\(event, sectionIds\.proposal\)\}>\{toolStatusText\}<\/a>/u);
	assert.match(source, /busy === 'download' \? 'Downloading…' : savedToolHistory \? 'Download saved tool' : currentTaskMatches \? 'Download tool' : 'Download previous tool'/u);
	assert.match(source, /staleRun && ready \? 'This tool was built for an earlier version of the task\.' : review\.proposal\.summary/u);
	assert.match(source, /savedToolHistory && ready \? 'Tool requirements are unchanged\. This result is retained with the task\.'/u);
	assert.match(source, /class="review-body" class:has-tool=\{ready\}/u);
	assert.match(source, /\.review-body\.has-tool \{[^}]*grid-template-areas: 'preview request' 'preview evidence' 'preview decision'/u);
}

test('Nebius review source contract rejects stale-label and availability regressions', () => {
	const source = readFileSync(new URL('../svelte-frontend/src/routes/review/NebiusRunReview.svelte', import.meta.url), 'utf8');
	assertNebiusReviewStateContract(source);
	// These are deliberate source mutations, not rendered-state observations.
	const regressions = [
		['missing saved reference', 'Boolean(reference && !currentTaskMatches)', 'Boolean(!currentTaskMatches)'],
		['reversed stale predicate', 'Boolean(reference && !currentTaskMatches)', 'Boolean(reference && currentTaskMatches)'],
		['fixed section label', '>2 · {toolSectionLabel}</h3>', '>2 · Tool</h3>'],
		['fixed navigation label', '{toolStatusText}</a>', 'Tool ready to try</a>'],
		['missing history reference', 'Boolean(reference) && !requestContentChanged', '!requestContentChanged'],
		['hidden requirement drift', '!requestContentChanged && (readOnly || statusOnlyDrift)', '(readOnly || statusOnlyDrift)'],
		['status-only without stale guard', 'staleRun && !requestContentChanged && reference?.input.currentStatus', '!requestContentChanged && reference?.input.currentStatus'],
		['ambiguous download', ": 'Download previous tool'", ": 'Download tool'"],
		['unverified built-tool claim', 'staleRun && ready ?', 'staleRun ?'],
		['unverified split layout', 'class="review-body" class:has-tool={ready}', 'class="review-body" class:has-tool={reference}'],
		['missing evidence section', '3 · Build evidence', '3 · Other']
	];
	for (const [label, before, after] of regressions) {
		assert(source.includes(before), `Mutation target missing: ${label}`);
		assert.throws(() => assertNebiusReviewStateContract(source.replace(before, after)), { code: 'ERR_ASSERTION' }, label);
	}
});

test('completed and archived evidence history omits instructions to save or complete again', () => {
	const source = readFileSync(new URL('../svelte-frontend/src/routes/next/NebiusEvidenceReview.svelte', import.meta.url), 'utf8');
	assert.match(source, /onMount\(\(\) => \{\s*if \(\(expanded \|\| pack\.completionEvidence\?\.trim\(\) \|\| \(decisionOnly && !history && !disabled\)\) && detailsElement\) detailsElement\.open = true;/u);
	assert.match(source, /history = \$derived\(pack\.status === 'done' \|\| Boolean\(pack\.archived\)\)/u);
	assert.match(source, /history \? pack\.completionEvidence\?\.trim\(\) \? 'Evidence saved with this task\.' : 'No completion evidence was saved\.'/u);
	assert.match(source, /\{#if !history \|\| dirty\}<div class="review-actions">[\s\S]*?\{#if !history\}<WornButton[\s\S]*?>Save evidence<\/WornButton>\{\/if\}/u);
	assert.match(source, /\{#if dirty\}<WornButton type="button" disabled=\{pending \|\| saving\} onclick=\{discardEvidence\}>Discard evidence edits<\/WornButton>\{\/if\}/u);
	assert.match(source, /\{#if evidenceRecorded && !history\}[\s\S]*?before marking done[\s\S]*?Mark done with recorded evidence/u);
	assert.match(source, /<fieldset disabled=\{\(!history && disabled\) \|\| pending \|\| saving\}>/u);
	assert.match(source, /<WornTextarea[^>]*readonly=\{history\}[^>]*bind:value=\{evidence\}/u);
	assert.match(source, /<fieldset disabled=\{history \|\| disabled \|\| pending \|\| saving\}>/u);
	assert.match(source, /async function recordEvidence\(\) \{\s*if \(pending \|\| saving \|\| history \|\| disabled \|\| stale/u);
	assert.match(source, /async function markDone\(\) \{\s*if \(pending \|\| saving \|\| history \|\| disabled \|\| dirty/u);
});
