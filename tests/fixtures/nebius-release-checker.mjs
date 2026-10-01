import assert from 'node:assert/strict';
import { generateRunFiles } from '../../worker/nebius-run-provider.mjs';
import { runFilesDigest, validateRunInput, validateRunIntegrity } from '../../svelte-frontend/src/lib/nebius-execution-contract.mjs';

// Authored test input, never a retained model response or an app starter result.
// Do not load provider credentials, emit run records, or persist this fixture in a workspace.
export const FIXTURE_MODEL = 'nvidia/synthetic-checker-fixture';
export const FIXTURE_INPUT = validateRunInput({
  version: 'browser-tool.v1', packId: 'authored-release-checker', currentStatus: 'active',
  pack: {
    title: 'Authored release-packet checker fixture', blocker: 'None',
    purpose: 'Check supplied packet text only; never approve or deploy a release.',
    nextStep: 'Exercise the provider-free validation and preview path.',
    doneWhen: 'Incomplete and corrected packets differ; invalid inputs never claim readiness.',
  },
  context: [], requestedModel: FIXTURE_MODEL, consent: true,
});

export function authoredCheckerFiles() {
  return [
    { path: 'index.html', content: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Authored release-packet checker fixture</title>
<style>
body { font: 16px system-ui, sans-serif; margin: 0; padding: 1rem; }
main { max-width: 48rem; margin: auto; }
textarea { box-sizing: border-box; width: 100%; font: inherit; }
button { font: inherit; padding: .6rem; margin: .4rem .2rem .4rem 0; }
output { display: block; white-space: pre-wrap; overflow-wrap: anywhere; padding: .75rem 0; }
</style>
</head>
<body>
<main>
<h1>Release-packet checker</h1>
<p>Authored test fixture, not AI-generated output. Checks supplied text only.</p>
<label for="packet">Packet JSON</label>
<textarea id="packet" rows="8" spellcheck="false" data-input-format="json"></textarea>
<div>
<button id="load-incomplete" type="button" data-example-for="packet">Load incomplete example</button>
<button id="load-corrected" type="button" data-example-for="packet">Load corrected example</button>
<button id="check-packet" type="button">Check packet</button>
</div>
<output id="result" for="packet" aria-live="polite"></output>
<p>Zero gaps means ready for human review, not release approval.</p>
</main>
</body>
</html>` },
    { path: 'app.js', content: String.raw`function validate(text) {
  let packet;
  try {
    packet = JSON.parse(text);
  } catch {
    return 'Input error: Enter valid JSON.';
  }
  if (packet === null || typeof packet !== 'object' || Array.isArray(packet)) {
    return 'Input error: Supply a JSON object.';
  }
  const fields = ['candidate', 'health', 'review', 'rollback'];
  if (Object.keys(packet).sort().join(',') !== fields.join(',')) {
    return 'Input error: Supply exactly candidate, health, review and rollback.';
  }
  if (fields.some(field => typeof packet[field] !== 'string')) {
    return 'Input error: All four fields must be strings.';
  }
  if (!packet.candidate.trim()) {
    return 'Input error: Candidate must not be blank.';
  }
  if (!['missing', 'failing', 'passing'].includes(packet.health)) {
    return 'Input error: Health must be missing, failing or passing.';
  }
  if (!['pending', 'rejected', 'approved'].includes(packet.review)) {
    return 'Input error: Review must be pending, rejected or approved.';
  }
  const gaps = [];
  if (packet.health !== 'passing') {
    gaps.push('Health must be passing');
  }
  if (packet.review !== 'approved') {
    gaps.push('Review must be approved');
  }
  if (!packet.rollback.trim()) {
    gaps.push('Rollback step is required');
  }
  return gaps.length
    ? String(gaps.length) + (gaps.length === 1 ? ' gap: ' : ' gaps: ') + gaps.join('; ')
    : '0 gaps: Ready for human review';
}

function handleMessage(message) {
  if (message.type === 'init') {
    return [{ id: 'result', text: 'Load an example or enter a packet to check.' }];
  }
  if (message.type !== 'event') {
    return [];
  }
  if (message.id === 'packet' && ['input', 'change'].includes(message.event)) {
    return [{ id: 'result', text: 'Input changed. Check packet again.' }];
  }
  if (message.event !== 'click') {
    return [];
  }
  let packet;
  if (message.id === 'load-incomplete') {
    packet = { candidate: 'demo-42', health: 'missing', review: 'pending', rollback: '' };
  } else if (message.id === 'load-corrected') {
    packet = { candidate: 'demo-42', health: 'passing', review: 'approved', rollback: 'Restore demo-41' };
  }
  if (packet) {
    const value = JSON.stringify(packet, null, 2);
    return [{ id: 'packet', value }, { id: 'result', text: validate(value) }];
  }
  if (message.id === 'check-packet') {
    return [{ id: 'result', text: validate(message.values.packet) }];
  }
  return [];
}` },
    { path: 'checks.cjs', content: `const assert = require('node:assert/strict');
const { validate, handleMessage } = require('./app.js');
const incomplete = { candidate: 'demo-42', health: 'missing', review: 'pending', rollback: '' };
const corrected = { candidate: 'demo-42', health: 'passing', review: 'approved', rollback: 'Restore demo-41' };
assert.equal(validate(JSON.stringify(incomplete)), '3 gaps: Health must be passing; Review must be approved; Rollback step is required');
assert.equal(validate(JSON.stringify(corrected)), '0 gaps: Ready for human review');
assert.match(validate('null'), /^Input error:/);
assert.match(validate('{'), /^Input error:/);
assert.doesNotMatch(handleMessage({ type: 'init', values: { packet: '' } })[0].text, /Ready for human review|0 gaps/);
for (const [id, example, expected] of [
  ['load-incomplete', incomplete, '3 gaps: Health must be passing; Review must be approved; Rollback step is required'],
  ['load-corrected', corrected, '0 gaps: Ready for human review'],
]) {
  const patches = handleMessage({ type: 'event', event: 'click', id, values: { packet: '' } });
  assert.deepEqual(JSON.parse(patches.find(patch => patch.id === 'packet').value), example);
  assert.equal(patches.find(patch => patch.id === 'result').text, expected);
}
for (const event of ['input', 'change']) {
  const patches = handleMessage({ type: 'event', event, id: 'packet', values: { packet: '{' } });
  assert.equal(patches.find(patch => patch.id === 'result').text, 'Input changed. Check packet again.');
  assert.doesNotMatch(patches.find(patch => patch.id === 'result').text, /Ready for human review|0 gaps/);
}
for (const packet of [{ ...corrected, health: 'green' }, { ...corrected, review: 'yes' }]) {
  const patches = handleMessage({ type: 'event', event: 'click', id: 'check-packet', values: { packet: JSON.stringify(packet) } });
  assert.match(patches.find(patch => patch.id === 'result').text, /^Input error:/);
}` },
  ];
}

export function nativeFileBlocks(files) {
  return files.map(file => '```' + (file.path === 'index.html' ? 'html' : 'javascript')
    + ' ' + file.path + '\n' + file.content + '\n```').join('\n\n');
}

// Only the transport is substituted. The real response parser, validators and
// runtime-bridge materialization run unchanged. The fake usage is not spend evidence.
export async function materializeAuthoredChecker(files = authoredCheckerFiles(), repair = null) {
  let fixtureResponses = 0;
  const result = await generateRunFiles({ apiKey: 'synthetic-fixture-no-credential', model: FIXTURE_MODEL },
    FIXTURE_INPUT, repair, {
      fetcher: async (url, options) => {
        fixtureResponses += 1;
        assert.equal(url, 'https://api.tokenfactory.nebius.com/v1/chat/completions');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'manual');
        const request = JSON.parse(options.body);
        assert.equal(request.model, FIXTURE_MODEL);
        assert.equal(request.max_tokens, 8000);
        assert.equal(Object.hasOwn(request, 'response_format'), false);
        return Response.json({ model: FIXTURE_MODEL,
          usage: { prompt_tokens: 0, completion_tokens: 0 },
          choices: [{ finish_reason: 'stop', message: {
            role: 'assistant', content: nativeFileBlocks(files),
          } }],
        });
      },
    });
  assert.equal(fixtureResponses, 1);
  return result.files;
}

// Browser-test seed only. Its modeled usage/check receipt is synthetic; never
// save this reference to a real workspace or count it as provider evidence.
export async function authoredPreviewReference(files) {
  const { consent, ...snapshot } = FIXTURE_INPUT;
  const sourceDigest = await runFilesDigest(files);
  const record = await validateRunIntegrity({
    id: '00000000-0000-4000-8000-000000000001', ...snapshot,
    status: 'ready', attempt: 1, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
    events: [], files, checks: [{ attempt: 1, operationId: '00000000-0000-4000-8000-000000000002', checkpointId: null,
      exitCode: 0, stdout: 'Synthetic authored test record, not a provider receipt.', stderr: '', sourceDigest }],
    usage: { modelCalls: 1, inputTokens: 0, outputTokens: 0, totalsComplete: true }, error: null, failure: null,
  });
  return { id: record.id, key: '0'.repeat(64), input: structuredClone(FIXTURE_INPUT), record };
}
