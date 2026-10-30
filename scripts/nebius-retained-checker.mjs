import { createHash } from 'node:crypto';
import { runFilesDigest, validateRunIntegrity, runToolRequirements } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';
import { renderRunPreview } from '../worker/nebius-run-preview.mjs';

const controlNames = ['input', 'output', 'check', 'incomplete', 'corrected'];

export async function planCheckerReplay(runRecord, bindings) {
  const record = await validateRunIntegrity(runRecord);
  if (record.status !== 'ready') throw new Error('Only a retained ready checker can be recorded.');
  if (!bindings || Object.keys(bindings).sort().join() !== [...controlNames].sort().join()
    || !Object.values(bindings).every(id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,199}$/u.test(id))
    || new Set(Object.values(bindings)).size !== controlNames.length) throw new Error('Supply five unique observed HTML control IDs.');
  if (record.requiredInputFormats?.find(input => input.id === bindings.input)?.format !== 'json') throw new Error('This checker recording requires its task-owned JSON input declaration.');
  const successful = record.checks.at(-1);
  const assertions = successful.stdout.match(/Observed successful assertions: (\d+);/u);
  const loaders = successful.stdout.match(/declared JSON example loaders: (\d+)\/(\d+);/u);
  if (!assertions || !loaders || Number(assertions[1]) < 1 || Number(assertions[1]) > 1000
    || Number(loaders[2]) < 1 || Number(loaders[2]) > 100 || Number(loaders[1]) > Number(loaders[2])) throw new Error('The retained check lacks bounded observed assertion/JSON-loader counts.');
  const rejected = record.generationAttempts.find(entry => entry.outcome === 'rejected');
  const failedCheck = record.checks.find(check => check.exitCode !== 0);
  const failure = rejected ? { kind: 'source', attempt: rejected.attempt, text: rejected.diagnostic.message }
    : failedCheck ? { kind: 'sandbox', attempt: failedCheck.attempt,
      text: (failedCheck.stderr || failedCheck.stdout).split(/\r?\n/u).find(line => line.trim())?.trim().slice(0, 200) } : null;
  if (failure && !failure.text) throw new Error('The recorded failure has no visible diagnostic.');
  const rendered = await renderRunPreview(record.files, runToolRequirements(record));
  return { runId: record.id, sourceDigest: await runFilesDigest(record.files),
    exportDigest: createHash('sha256').update(rendered.html).digest('hex'),
    checks: { failure, successfulAttempt: successful.attempt, successfulAssertions: Number(assertions[1]),
      jsonLoaders: { observed: Number(loaders[1]), total: Number(loaders[2]) }, inputFormatLabel: 'JSON', sandboxResults: record.checks.length } };
}

export function assertPreviewInputDeclaration(state, expectedRunId, expectedLabel, expectedOrigin) {
  if (typeof state !== 'string' || typeof expectedRunId !== 'string' || !/^[A-Za-z0-9-]+$/u.test(expectedRunId)
    || expectedLabel !== 'JSON') throw new Error('Supply the expected retained preview and JSON declaration.');
  let origin;
  try { origin = new URL(expectedOrigin); } catch { throw new Error('Supply the exact HTTP loopback replay origin.'); }
  if (typeof expectedOrigin !== 'string' || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1'
    || origin.username || origin.password || expectedOrigin !== origin.origin) {
    throw new Error('Supply the exact HTTP loopback replay origin.');
  }
  const frameAddress = `${expectedOrigin}/api/nebius/runs/${expectedRunId}/preview`;
  // CUA omits the scheme in its native URL display. Accept that exact display
  // only for the caller's validated origin, including its bound port.
  const nativeFrameAddress = frameAddress.slice('http://'.length);
  const lines = state.split(/\r?\n/u).filter(line => line.trim()).map(line => ({
    indent: line.match(/^\s*/u)[0].length, text: line.trim().replace(/^\d+\s+/u, '')
  }));
  const webArea = line => /^AXWebArea\b/u.test(line.text);
  const matches = lines.flatMap((line, index) => {
    if (!webArea(line)) return [];
    const address = line.text.match(/\bURL:?\s+(\S+)$/u)?.[1];
    return address === frameAddress || address === nativeFrameAddress ? [index] : [];
  });
  if (matches.length !== 1) throw new Error('The retained run needs one unambiguous preview AXWebArea.');
  const frameIndex = matches[0], frame = lines[frameIndex];
  let end = frameIndex + 1;
  while (end < lines.length && lines[end].indent > frame.indent) end++;
  const descendants = lines.slice(frameIndex + 1, end);
  if (descendants.some(webArea)) throw new Error('Nested preview AXWebAreas make the declaration ambiguous.');
  const disclosures = descendants.flatMap((line, index) => /^button\s*(?:\([^)]*\)\s*)*Input formats(?:, Secondary Actions: (?:Expand|Collapse))?$/u.test(line.text) ? [index] : []);
  if (disclosures.length !== 1 || !/^button\s*\(expanded\)\s*Input formats(?:, Secondary Actions: Collapse)?$/u.test(descendants[disclosures[0]].text)) {
    throw new Error('The preview needs one expanded Input formats disclosure.');
  }
  const disclosureIndex = disclosures[0], disclosure = descendants[disclosureIndex];
  let listIndex = disclosureIndex + 1;
  while (listIndex < descendants.length && descendants[listIndex].indent > disclosure.indent) listIndex++;
  const list = descendants[listIndex];
  if (!list || list.indent !== disclosure.indent || !/^definition\s*list$/u.test(list.text)) {
    throw new Error('The preview declaration list must follow its Input formats disclosure.');
  }
  const declaration = [];
  for (let index = listIndex + 1; index < descendants.length && descendants[index].indent > list.indent; index++) declaration.push(descendants[index]);
  if (!declaration.some(line => line.text === 'text ' + expectedLabel)) {
    throw new Error('The unchanged JSON declaration is absent from the preview definition list.');
  }
}
