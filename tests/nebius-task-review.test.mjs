import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskRunReview } from '../svelte-frontend/src/lib/nebius-task-review.mjs';

test('Task brief exposes saved notes and sources as counted, escaped read-only lists', () => {
  const source = readFileSync(new URL('../svelte-frontend/src/routes/next/NebiusTaskContext.svelte', import.meta.url), 'utf8');
  assert.match(source, /let notes = \$derived\(pack\.memory \?\? \[\]\);/u);
  assert.match(source, /let sources = \$derived\(pack\.sources \?\? \[\]\);/u);
  assert.match(source, /\{#if notes\.length \|\| sources\.length\}[\s\S]*?<details[^>]*data-nebius-captured-context/u);
  const block = source.slice(source.indexOf('<details class="full-brief captured-context"'), source.indexOf('<div class="task-switcher"'));
  assert.match(block, /Notes and sources · \{notes\.length\}[\s\S]*?\{sources\.length\}/u);
  assert.match(block, /<ul aria-label="Notes">\{#each notes as note\}<li>\{note\}<\/li>/u);
  assert.match(block, /<ul aria-label="Sources">\{#each sources as source\}<li>\{source\}<\/li>/u);
  assert.doesNotMatch(block, /\{@html|<a\b|<input\b|<textarea\b|onclick=|onchange=/u);
  assert.match(source, /\.captured-context li \{[^}]*overflow-wrap: anywhere;[^}]*white-space: pre-wrap;/u);
});

function fixture(status = 'ready') {
  const pack = { title: 'Analyze rows', purpose: 'Understand data', nextStep: 'Build a tool', blocker: '', doneWhen: 'Rows are summarized' };
  const input = { version: 'browser-tool.v2', packId: 'task-example', pack, currentStatus: 'active',
    context: [{ id: 'context-id', content: 'PRIVATE_CONTEXT' }], requestedModel: 'test-model',
    requiredInputFormats: [{ id: 'rows', format: 'json' }], consent: true };
  const record = { ...structuredClone(input), id: 'run-example', status, attempt: 2,
    createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:01:00.000Z',
    events: [{ at: '2026-10-20T00:01:00.000Z', message: 'PRIVATE_EVENT' }],
    files: [{ path: 'index.html', content: 'SOURCE_é' }, { path: 'app.js', content: 'PRIVATE_SOURCE' }],
    checks: [{ attempt: 1, exitCode: 1, stdout: 'PRIVATE_STDOUT' }, { attempt: 2, exitCode: 0, stderr: 'PRIVATE_STDERR' }],
    usage: { modelCalls: 2, inputTokens: 100, outputTokens: 40, totalsComplete: true },
    failure: null, error: null, generationAttempts: [{ outcome: 'rejected', responseText: 'PRIVATE_RESPONSE' }] };
  delete record.consent;
  return { currentTask: structuredClone(pack), currentInputFormats: [{ id: 'rows', format: 'json' }],
    reference: { id: record.id, input: structuredClone(input), key: 'PRIVATE_KEY' },
    record, verified: structuredClone(record), integrityError: '', currentTaskMatches: true,
    taskStatus: 'active', completionEvidence: '', archived: false };
}
function noTrustedDetails(view) {
  assert.deepEqual(view.proposal.files, []);
  assert.equal(view.proposal.rejectedResponses, null);
  assert.deepEqual(view.evidence, { checkCount: null, passedCheckCount: null, modelCalls: null,
    inputTokens: null, outputTokens: null, totalsComplete: null, sourceValidated: false });
  assert.equal(view.evidenceExplanation.authoredExample, false);
  assert.match(view.evidenceExplanation.author, /Unavailable/);
  assert.match(view.evidenceExplanation.result, /No verified result/);
}

test('evidence explanation separates recorded author, execution, result and owner decision', () => {
  const input = fixture();
  for (const record of [input.record, input.verified]) record.files.push({ path: 'checks.cjs', content: 'PRIVATE_CHECKS' });
  const view = taskRunReview(input);
  assert.match(view.evidenceExplanation.author, /Model recorded for this build: test-model/);
  assert.match(view.evidenceExplanation.execution, /checks\.cjs.*Nebius Sandbox/);
  assert.equal(view.evidenceExplanation.result, '1 of 2 recorded runs exited successfully (code 0).');
  assert.match(view.evidenceExplanation.decision, /decide whether to mark the task done/);
  assert.ok(!JSON.stringify(view.evidenceExplanation).includes('PRIVATE_CHECKS'));
});

test('authored sample labels never represent synthetic figures as live execution', () => {
  const input = fixture();
  for (const record of [input.reference.input, input.record, input.verified]) record.requestedModel = 'nvidia/synthetic-checker-fixture';
  const view = taskRunReview(input);
  assert.equal(view.state, 'ready');
  assert.equal(view.label, 'Tool ready for review');
  assert.equal(view.evidenceExplanation.authoredExample, true);
  assert.match(view.evidenceExplanation.author, /author of this offline example/);
  assert.match(view.evidenceExplanation.execution, /No live Sandbox execution/);
  assert.match(view.evidenceExplanation.result, /1 of 2 sample runs/);
  assert.match(view.decision.description, /do not establish a live model or Sandbox outcome/);
  input.integrityError = 'Record rejected';
  noTrustedDetails(taskRunReview(input));
});

test('sample provenance does not hide failed or unknown outcomes or invent retained tools', () => {
  for (const status of ['failed', 'uncertain', 'cancelled', 'generating']) {
    const input = fixture(status);
    const expectedLabel = taskRunReview(input).label;
    for (const record of [input.reference.input, input.record, input.verified]) record.requestedModel = 'nvidia/synthetic-checker-fixture';
    for (const record of [input.record, input.verified]) { record.files = []; record.checks = []; }
    const view = taskRunReview(input);
    assert.equal(view.label, expectedLabel);
    assert.equal(view.evidenceExplanation.authoredExample, true);
    assert.match(view.proposal.summary, /No tool source is retained/);
    assert.doesNotMatch(view.summary, /tool and run figures are authored sample data/);
  }
});

test('non-ready records do not attribute recorded execution to the retained checks file', () => {
  for (const status of ['failed', 'uncertain', 'cancelled']) {
    const input = fixture(status);
    for (const record of [input.record, input.verified]) record.files.push({ path: 'checks.cjs', content: 'unverified candidate' });
    const view = taskRunReview(input);
    assert.match(view.evidenceExplanation.execution, /not verified against the retained source/);
    assert.doesNotMatch(view.evidenceExplanation.execution, /supplied checks\.cjs program ran/);
    assert.equal(view.evidence.checkCount, 2);
  }
});

test('evidence wording distinguishes absent source, no recorded execution and unknown records', () => {
  const input = fixture('failed');
  for (const record of [input.record, input.verified]) record.checks = [];
  const view = taskRunReview(input);
  assert.equal(view.evidenceExplanation.author, 'Not established; no check source is retained.');
  assert.equal(view.evidenceExplanation.execution, 'No Sandbox check run is recorded.');
  assert.equal(view.evidenceExplanation.result, 'No check result is recorded.');
  assert.match(view.evidenceExplanation.decision, /Review the failure/);
  input.record = null; input.verified = null;
  const unknown = taskRunReview(input);
  assert.equal(unknown.evidence.checkCount, null);
  assert.match(unknown.evidenceExplanation.execution, /No verified execution record/);
});

test('evidence decision wording keeps stale, completed and archived outcomes separate', () => {
  const input = fixture(); input.currentTaskMatches = false;
  assert.match(taskRunReview(input).evidenceExplanation.decision, /saved request only/);
  input.taskStatus = 'done';
  assert.match(taskRunReview(input).evidenceExplanation.decision, /marked done.*saved history/);
  input.taskStatus = 'active'; input.archived = true;
  assert.match(taskRunReview(input).evidenceExplanation.decision, /archived.*without making a new decision/);
});

test('no run preserves the current request without inventing saved fields or counts', () => {
  const input = fixture();
  input.reference = null;
  const view = taskRunReview(input);
  assert.equal(view.state, 'no-run');
  assert.equal(view.decision.title, 'Record completion evidence');
  assert.equal(view.request.fields.length, 5);
  assert.ok(view.request.fields.every(field => field.requested === null && !field.changed));
  assert.equal(view.request.changedFieldCount, 0);
  assert.equal(view.request.inputFormatsChanged, false);
  assert.equal(view.request.requestedInputFormats, null);
  noTrustedDetails(view);
});

test('missing, unverified and invalid records remain distinct and hide candidate details', () => {
  const input = fixture();
  input.record = null;
  input.verified = null;
  assert.equal(taskRunReview(input).state, 'pending');
  noTrustedDetails(taskRunReview(input));
  input.record = fixture().record;
  assert.equal(taskRunReview(input).state, 'verifying');
  noTrustedDetails(taskRunReview(input));
  input.integrityError = 'PRIVATE_INTEGRITY_ERROR';
  assert.equal(taskRunReview(input).state, 'invalid');
  noTrustedDetails(taskRunReview(input));
  assert.ok(!JSON.stringify(taskRunReview(input)).includes('PRIVATE_INTEGRITY_ERROR'));
});

test('verified identity and snapshot mismatches cannot expose ready source or evidence', () => {
  const mutations = [
    input => { input.verified.id = 'other'; },
    input => { input.record.id = 'other'; },
    input => { input.verified.packId = 'other'; },
    input => { input.verified.files[0].content = 'stale-source'; },
    input => { input.verified.status = 'failed'; },
    input => { input.reference.input.pack.title = 'other request'; },
    input => { input.reference.input.requiredInputFormats = []; },
    input => { input.reference.input.context = []; },
    input => { input.record = null; }
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    const view = taskRunReview(input);
    assert.equal(view.state, 'invalid');
    noTrustedDetails(view);
  }
});

test('ready projection records model-authored denominator and byte counts without acceptance', () => {
  const view = taskRunReview(fixture());
  assert.equal(view.state, 'ready');
  assert.deepEqual(view.proposal.files, [{ path: 'index.html', bytes: 9 }, { path: 'app.js', bytes: 14 }]);
  assert.equal(view.proposal.rejectedResponses, 1);
  assert.deepEqual(view.evidence, { checkCount: 2, passedCheckCount: 1, modelCalls: 2,
    inputTokens: 100, outputTokens: 40, totalsComplete: true, sourceValidated: true });
  assert.match(view.summary, /model-authored/);
  assert.match(view.proposal.summary, /new browser tool/);
  assert.match(view.decision.description, /do not establish independent acceptance or human acceptance/);
});

test('terminal outcomes and each nonterminal status preserve recorded run results', () => {
  for (const status of ['failed', 'cancelled', 'uncertain', 'queued', 'generating', 'checking', 'repairing', 'cancelling']) {
    const view = taskRunReview(fixture(status));
    assert.equal(view.state, ['failed', 'cancelled', 'uncertain'].includes(status) ? status : 'running');
    assert.equal(view.evidence.checkCount, 2);
    assert.equal(view.evidence.sourceValidated, false);
    assert.equal(view.decision.title, status === 'failed' ? 'Review the failed attempt' : 'Resolve the run outcome');
  }
});

test('task drift remains separate from historical evidence, status, archive and saved evidence', () => {
  const input = fixture('failed');
  for (const key of ['title', 'purpose', 'nextStep', 'blocker', 'doneWhen']) input.currentTask[key] += ' edited';
  input.currentTaskMatches = false;
  input.taskStatus = 'done'; input.archived = true; input.completionEvidence = 'PRIVATE_SAVED_EVIDENCE';
  const view = taskRunReview(input);
  assert.equal(view.state, 'failed');
  assert.equal(view.decision.title, 'Task marked done');
  assert.equal(view.request.changedFieldCount, 5);
  assert.equal(view.evidence.checkCount, 2);
  assert.match(view.decision.description, /does not match the current task/);
  assert.match(view.decision.description, /marked done/);
  assert.match(view.decision.description, /archived/);
  assert.match(view.decision.description, /saving evidence does not approve or complete/);
  assert.ok(!JSON.stringify(view).includes('PRIVATE_SAVED_EVIDENCE'));
});

test('input format comparison preserves unspecified versus empty and detects format drift', () => {
  for (const [saved, current, expected] of [[null, [], true], [[], null, true], [null, null, false], [[], [], false],
    [[{ id: 'rows', format: 'json' }], [{ id: 'rows', format: 'text' }], true]]) {
    const input = fixture();
    input.reference.input.requiredInputFormats = saved;
    input.record.requiredInputFormats = structuredClone(saved);
    input.verified = structuredClone(input.record);
    input.currentInputFormats = current;
    const view = taskRunReview(input);
    assert.equal(view.request.inputFormatsChanged, expected);
    assert.equal(view.request.changedFieldCount, 0);
  }
  const legacy = fixture();
  delete legacy.reference.input.requiredInputFormats;
  delete legacy.record.requiredInputFormats;
  legacy.reference.input.version = legacy.record.version = 'browser-tool.v1';
  legacy.verified = structuredClone(legacy.record);
  legacy.currentInputFormats = [];
  assert.equal(taskRunReview(legacy).request.inputFormatsChanged, true);
});

test('missing usage stays unknown while observed zero checks and usage stay zero', () => {
  const input = fixture('failed');
  input.record.usage = { modelCalls: 1, inputTokens: null, outputTokens: null, totalsComplete: false };
  input.verified = structuredClone(input.record);
  let view = taskRunReview(input);
  assert.equal(view.evidence.inputTokens, null);
  assert.equal(view.evidence.outputTokens, null);
  assert.equal(view.evidence.totalsComplete, false);
  input.record.usage = null; input.verified = structuredClone(input.record);
  view = taskRunReview(input);
  assert.equal(view.evidence.modelCalls, null);
  assert.equal(view.evidence.totalsComplete, null);
  input.record.checks = []; input.record.usage = { modelCalls: 0, inputTokens: 0, outputTokens: 0, totalsComplete: true };
  input.verified = structuredClone(input.record);
  view = taskRunReview(input);
  assert.equal(view.evidence.checkCount, 0);
  assert.equal(view.evidence.passedCheckCount, 0);
  assert.equal(view.evidence.inputTokens, 0);
});

test('legacy normalization is matched without trusting newer or modified content', () => {
  const input = fixture();
  delete input.record.failure; delete input.record.generationAttempts; delete input.record.usage.totalsComplete;
  input.verified = { ...structuredClone(input.record), failure: null, generationAttempts: [],
    usage: { ...input.record.usage, totalsComplete: true } };
  assert.equal(taskRunReview(input).state, 'ready');
  input.verified.usage.inputTokens++;
  assert.equal(taskRunReview(input).state, 'invalid');
});

test('projection allowlist redacts secrets, source and diagnostics and does not alias inputs', () => {
  const input = fixture();
  input.currentTask.extra = 'PRIVATE_EXTRA';
  const before = structuredClone(input);
  const view = taskRunReview(input);
  assert.deepEqual(input, before);
  const encoded = JSON.stringify(view);
  for (const secret of ['PRIVATE_', 'SOURCE_é', 'consent', 'requestedModel', 'context', 'run-example']) assert.ok(!encoded.includes(secret), secret);
  assert.deepEqual(Object.keys(view), ['state', 'label', 'summary', 'evidenceExplanation', 'request', 'proposal', 'evidence', 'decision']);
  assert.deepEqual(Object.keys(view.evidenceExplanation), ['authoredExample', 'author', 'execution', 'result', 'decision']);
  view.request.currentInputFormats[0].format = 'text';
  view.request.requestedInputFormats[0].id = 'changed';
  view.proposal.files[0].path = 'changed';
  assert.deepEqual(input, before);
});

test('v3 output snapshots are immutable review evidence and current minima show drift', () => {
  const input = fixture();
  for (const snapshot of [input.reference.input, input.record, input.verified]) {
    snapshot.version = 'browser-tool.v3';
    snapshot.requiredOutputs = [{ id: 'schedule', format: 'timeline' }];
  }
  input.currentOutputs = [{ id: 'schedule', format: 'timeline' }];
  const original = JSON.stringify(input);
  assert.equal(taskRunReview(input).request.outputsChanged, false);
  input.currentOutputs = [{ id: 'summary', format: 'text' }];
  const view = taskRunReview(input);
  assert.equal(view.state, 'ready');
  assert.equal(view.request.outputsChanged, true);
  assert.deepEqual(view.request.requestedOutputs, [{ id: 'schedule', format: 'timeline' }]);
  input.currentOutputs = [{ id: 'schedule', format: 'timeline' }];
  assert.equal(JSON.stringify(input), original);
  input.reference.input.requiredOutputs = [];
  assert.equal(taskRunReview(input).state, 'invalid');
});

test('legacy review never infers required outputs from current task declarations', () => {
  const input = fixture();
  const saved = JSON.stringify(input.reference.input);
  input.currentOutputs = [];
  assert.equal(taskRunReview(input).request.outputsChanged, true);
  assert.equal(taskRunReview(input).request.requestedOutputs, null);
  assert.equal(JSON.stringify(input.reference.input), saved);
  input.currentOutputs = null;
  assert.equal(taskRunReview(input).request.outputsChanged, false);
});
