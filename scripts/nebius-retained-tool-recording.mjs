// Import inside the initialized CUA JavaScript session. Uses its bound tab and
// native keyboard surface; it does not open a browser or issue inference.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { THREE_GAPS, READY } from '../tests/fixtures/nebius-release-packet-cases.mjs';
import { validRunId } from '../svelte-frontend/src/lib/nebius-execution-contract.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const controlNames = ['input', 'output', 'check', 'incomplete', 'corrected'];

function focusedLine(state) {
  const line = state.split(/\r?\n/u).find(value => value.startsWith('The focused UI element is '));
  if (!line) throw new Error('This recording needs the native CUA accessibility surface.');
  return line;
}

function outputSubtree(state, id) {
  const lines = state.split(/\r?\n/u), index = lines.findIndex(line => line.endsWith('ID: ' + id));
  if (index < 0) throw new Error('The declared result is absent from the preview.');
  const indentation = lines[index].match(/^\s*/u)[0].length;
  const children = [];
  for (let next = index + 1; next < lines.length && lines[next].match(/^\s*/u)[0].length > indentation; next++) children.push(lines[next].trim());
  return children.join('\n');
}

/** Advance next() in bounded stages; the last stage stops and saves capture. */
export async function startRetainedToolRecording({ tab, surface, cdp, outputBase, expectedRunId, expectedSourceDigest, bindings, inputAccessibleName, expectedChecks, onProgress = () => {} }) {
  const pageUrl = new URL(await tab.url());
  if (pageUrl.protocol !== 'http:' || pageUrl.hostname !== '127.0.0.1' || pageUrl.pathname !== '/review') throw new Error('Open the local Review page before recording.');
  if (!validRunId(expectedRunId) || !/^[0-9a-f]{64}$/u.test(expectedSourceDigest)) throw new Error('Supply the exact retained run ID and checked source digest.');
  if (!bindings || Object.keys(bindings).sort().join() !== [...controlNames].sort().join()
    || !Object.values(bindings).every(id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,199}$/u.test(id))
    || new Set(Object.values(bindings)).size !== controlNames.length) throw new Error('Supply five unique observed HTML control IDs.');
  bindings = Object.freeze({ ...bindings });
  if (typeof inputAccessibleName !== 'string' || !inputAccessibleName.trim() || inputAccessibleName !== inputAccessibleName.trim()
    || inputAccessibleName.length > 200 || /[\u0000-\u001f\u007f]/u.test(inputAccessibleName)) throw new Error('Supply the observed accessible name of the generated text entry.');
  const matchesInput = line => line.match(/^(?:\s*\d+|The focused UI element is \d+) text entry area \(settable\) (.+)$/u)?.[1] === inputAccessibleName;
  if (!expectedChecks || Object.keys(expectedChecks).sort().join() !== ['failedCheckText', 'inputFormatLabel', 'jsonLoaders', 'successfulAssertions'].sort().join()
    || typeof expectedChecks.failedCheckText !== 'string' || !expectedChecks.failedCheckText.trim() || expectedChecks.failedCheckText.length > 400
    || /[\u0000-\u001f\u007f]/u.test(expectedChecks.failedCheckText)
    || !['Plain text', 'JSON'].includes(expectedChecks.inputFormatLabel)
    || !Number.isSafeInteger(expectedChecks.successfulAssertions) || expectedChecks.successfulAssertions < 1 || expectedChecks.successfulAssertions > 1000
    || !expectedChecks.jsonLoaders || Object.keys(expectedChecks.jsonLoaders).sort().join() !== 'observed,total'
    || !Number.isSafeInteger(expectedChecks.jsonLoaders.observed) || !Number.isSafeInteger(expectedChecks.jsonLoaders.total)
    || expectedChecks.jsonLoaders.total < 1 || expectedChecks.jsonLoaders.total > 100
    || expectedChecks.jsonLoaders.observed < 0 || expectedChecks.jsonLoaders.observed > expectedChecks.jsonLoaders.total) {
    throw new Error('Supply the failed-check text, assertion count, JSON-loader counts and input format observed in this saved run.');
  }
  expectedChecks = Object.freeze({ ...expectedChecks, jsonLoaders: Object.freeze({ ...expectedChecks.jsonLoaders }) });
  const jsonLoaderCoverage = `${expectedChecks.jsonLoaders.observed}/${expectedChecks.jsonLoaders.total}`;
  if (!outputBase || !/^[A-Za-z]:[\\/]/u.test(outputBase)) throw new Error('Use an absolute Windows output base.');
  await mkdir(dirname(outputBase), { recursive: true });
  for (const suffix of ['.mp4', '.json', '.start-uncertain.json']) {
    try { await access(outputBase + suffix); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Recording output exists; choose a new take name.');
  }
  const pane = tab.playwright.locator('[data-nebius-run-review]');
  const runLabel = await pane.locator('.run-review-id').innerText();
  const header = await pane.locator('.run-review-head').innerText();
  const preview = pane.getByRole('button', { name: 'Try your tool', exact: true });
  if (runLabel.trim() !== 'Run ' + expectedRunId || !header.split(/\r?\n/u).some(line => line.trim() === 'ready')
    || !(await preview.isVisible()) || !(await preview.isEnabled())) throw new Error('The expected ready run and enabled preview are not displayed.');
  let lastState = await surface.getAXState({ disableDiffing: true, emit: false });
  if (lastState.includes('button Close preview')) throw new Error('Close the volatile preview or reload Review before recording.');
  focusedLine(lastState);

  const events = [], requests = [];
  let startedAt = 0, recording = false, startUncertain = false, stageIndex = 0, inFlight = false, receipt = null;
  let keyboardCount = 0, typedCharacters = 0, observedSourceDigest = false, captureBytes = 0, stopAttempts = 0;
  let requestAuditComplete = false, unexpectedNebiusWrites = [];
  await cdp.send('Network.enable');
  const networkCursor = (await cdp.readEvents({ methods: ['Network.requestWillBeSent'] })).cursor;
  const state = async () => { lastState = await surface.getAXState({ disableDiffing: true, emit: false }); return lastState; };
  const cue = async label => {
    const event = { seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)), label, focus: focusedLine(lastState).slice(0, 240) };
    events.push(event); await onProgress(event);
  };
  const key = async value => {
    await surface.pressKey(null, value); keyboardCount++;
    await state();
  };
  const seek = async (matches, reverse = false, maximum = 20) => {
    for (let count = 0; count <= maximum; count++) {
      if (matches(focusedLine(lastState))) return;
      if (count < maximum) await key(reverse ? 'Shift+Tab' : 'Tab');
    }
    throw new Error('A bounded keyboard target could not be reached.');
  };
  const seekName = (name, reverse = false, maximum = 20) => seek(line => line.includes(name), reverse, maximum);
  const seekControl = (name, reverse = false, maximum = 10) => seek(line => line.endsWith('ID: ' + bindings[name]), reverse, maximum);
  const expectOutput = expected => {
    if (!outputSubtree(lastState, bindings.output).includes(expected)) throw new Error('The actual result did not match this recording stage.');
  };

  const stop = async (failure = null) => {
    if (!recording && !startUncertain) return receipt;
    if (stopAttempts >= 2) throw new Error('Recorder stop remains uncertain; inspect the bound recorder before any further action.');
    const attempt = ++stopAttempts;
    let captureError = null, captureStopped = false;
    const captureEnd = Date.now();
    const readDeadline = captureEnd + 20000;
    try {
      const stopped = await cdp.send('Page.stopScreenRecording', {}, { timeoutMs: 10000 });
      if (typeof stopped?.stream !== 'string' || !stopped.stream) throw new Error('Recorder stop was not confirmed with a stream.');
      captureStopped = true; recording = false; startUncertain = false;
      const chunks = [];
      try {
        let eof = false;
        for (let read = 0; read < 256; read++) {
          if (Date.now() >= readDeadline) throw new Error('Recording stream read deadline expired.');
          const part = await cdp.send('IO.read', { handle: stopped.stream, size: 1048576 }, { timeoutMs: Math.min(10000, readDeadline - Date.now()) });
          const chunk = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8');
          if (!chunk.length && !part.eof) throw new Error('Recording stream made no progress.');
          captureBytes += chunk.length;
          if (captureBytes > 134217728) throw new Error('Recording exceeded the 128 MiB local capture bound.');
          chunks.push(chunk);
          if (part.eof) { eof = true; break; }
        }
        if (!eof || !captureBytes) throw new Error('Recording stream did not complete with video bytes.');
        await writeFile(outputBase + '.mp4', Buffer.concat(chunks), { flag: 'wx' });
      } finally { await cdp.send('IO.close', { handle: stopped.stream }, { timeoutMs: 5000 }); }
      let cursor = networkCursor, more = true;
      const auditDeadline = Date.now() + 5000;
      for (let page = 0; more && page < 20; page++) {
        if (Date.now() >= auditDeadline) throw new Error('Network observation deadline expired.');
        const batch = await cdp.readEvents({ afterSequence: cursor, methods: ['Network.requestWillBeSent'], limit: 1000, timeoutMs: 0 });
        if (batch.truncated) throw new Error('Network observation was truncated; zero paid requests is unverified.');
        if (batch.hasMore && (!Number.isSafeInteger(batch.cursor) || batch.cursor <= cursor)) throw new Error('Network observation cursor made no progress.');
        cursor = batch.cursor; more = batch.hasMore;
        for (const event of batch.events) {
          const request = event.params.request, url = new URL(request.url);
          // Retain no headers, bodies, query strings, cookies or access keys.
          if (url.origin === pageUrl.origin) requests.push({ method: request.method, path: url.pathname });
        }
      }
      if (more) throw new Error('Network observation exceeded its page bound.');
      requestAuditComplete = true;
      unexpectedNebiusWrites = requests.filter(request => request.method === 'POST' && request.path.startsWith('/api/nebius/') && request.path !== '/api/nebius/runs/' + expectedRunId + '/preview');
      if (unexpectedNebiusWrites.length) throw new Error('An unexpected Nebius write occurred during the saved-run replay.');
    } catch (error) { captureError = error; }
    receipt = { kind: 'retained-tool-keyboard-replay', runId: expectedRunId, expectedSourceDigest, bindings, inputAccessibleName, expectedChecks, observedSourceDigest,
      url: pageUrl.origin + pageUrl.pathname, continuous: true, audio: false, viewportOverride: false, captureStopped, stopAttempt: attempt, durationSeconds: Number(((captureEnd - startedAt) / 1000).toFixed(1)),
      outcome: !captureStopped ? 'capture-uncertain' : failure || captureError ? 'stopped' : 'recorded', error: failure?.message || captureError?.message || null,
      captureError: captureError?.message || null,
      helperRequestedGeneration: false, requestAuditComplete, unexpectedNebiusWrites, evidenceSaved: false, taskMarkedDone: false,
      stagesCompleted: stageIndex, plannedStages: stages.length, keyboardCount, preflightKeyboardCount, typedCharacters, captureBytes, requests, events };
    await writeFile(outputBase + (attempt === 1 ? '' : '.recovery-' + attempt) + '.json', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    if (captureError) throw captureError;
    return receipt;
  };

  const stages = [
    async () => {
      await cue('Saved run introduction and recorded model usage'); await pause(5000);
      await seekName('Model attempt 1 · Sandbox exit 1', false, 12); await key('Return');
      if (!lastState.includes(expectedChecks.failedCheckText)) throw new Error('The actual failed Sandbox check is not displayed.');
      await cue('First Sandbox check: retained failure'); await key('PageDown'); await pause(7000);
      await key('Return');
    },
    async () => {
      await seekName('Model attempt 2 · Sandbox exit 0', false, 4); await key('Return');
      if (!lastState.includes(`Observed successful assertions: ${expectedChecks.successfulAssertions};`)
        || !lastState.includes(`declared JSON example loaders: ${jsonLoaderCoverage};`)
        || !lastState.includes(expectedSourceDigest)) throw new Error('The retained successful Sandbox result, loader coverage or digest is missing.');
      observedSourceDigest = true;
      await cue(`Repaired Sandbox check: ${expectedChecks.successfulAssertions} assertions, ${jsonLoaderCoverage} JSON loaders and checked source digest`); await key('PageDown'); await pause(8000);
      await key('Return');
    },
    async () => {
      await seekName('button Try your tool', true, 10); await key('Return');
      await tab.playwright.getByText('Isolated preview · Preview running', { exact: true }).waitFor({ state: 'visible', timeoutMs: 5000 });
      await state();
      for (const name of controlNames.filter(name => name !== 'input')) if (!lastState.includes('ID: ' + bindings[name])) throw new Error('The observed generated controls do not match the supplied bindings.');
      if (lastState.split(/\r?\n/u).filter(line => /^\s*\d+ /u.test(line) && matchesInput(line)).length !== 1) throw new Error('The observed generated input does not uniquely match the supplied accessible name.');
      await seekControl('incomplete'); await key('Return'); await pause(2000);
      await seekControl('check', true, 4); await key('Return'); expectOutput(THREE_GAPS);
      await seekName('Input formats', false, 5);
      await cue('Incomplete packet: three actual gaps'); await pause(7000);
    },
    async () => {
      await seekControl('corrected', true, 5); await key('Return'); await pause(2000);
      await seekControl('check', true, 5); await key('Return'); expectOutput(READY);
      await seekName('Input formats', false, 5);
      await cue('Corrected packet: zero gaps, ready for human review'); await pause(8000);
    },
    async () => {
      await seekControl('input', true, 5); await key('Control_L+a');
      await surface.typeText(null, '{'); typedCharacters++; await state();
      if (outputSubtree(lastState, bindings.output).includes(READY)) throw new Error('Editing left the old readiness result visible.');
      await seekName('Input formats', false, 6);
      await cue('Editing clears the old readiness result'); await pause(4000);
      await seekControl('check', true, 5); await key('Return'); expectOutput('Input error: Invalid JSON');
      await seekName('Input formats', false, 5);
      await cue('Malformed JSON: actual input error'); await pause(7000);
    },
    async () => {
      await seekControl('corrected', true, 5); await key('Return');
      await seekControl('check', true, 5); await key('Return'); expectOutput(READY);
      await seekName('Input formats', false, 6); await key('Return');
      if (!lastState.includes('text ' + expectedChecks.inputFormatLabel)) throw new Error('The unchanged input declaration is not displayed.');
      await cue(`Retained declaration: ${expectedChecks.inputFormatLabel}, observed JSON-loader coverage ${jsonLoaderCoverage}`); await key('PageDown'); await pause(7000);
      await key('Return');
    },
    async () => {
      await seekName('button Close preview', true, 15); await key('Return');
      await seekName('index.html', false, 8); await key('Return');
      await cue('Inspect the unchanged generated source'); await key('PageDown'); await pause(5000); await key('Return');
      await seekName('button Save run evidence', false, 7);
      await cue('Separate human evidence action; leave task open'); await pause(6000);
    },
  ];

  const controller = {
    get done() { return !recording && !startUncertain; },
    get state() { return startUncertain ? 'start-uncertain' : recording ? 'recording' : 'stopped'; },
    get stage() { return stageIndex; },
    async next() {
      if (inFlight) throw new Error('A recording stage is already running.');
      if (startUncertain) throw new Error('Recorder start is uncertain; inspect the bound recorder before explicit recovery.');
      if (!recording) return receipt;
      if (receipt) throw new Error('The prior take failed; do not continue its choreography.');
      inFlight = true;
      let finalizing = false;
      try {
        if (Date.now() - startedAt > 165000) throw new Error('The take exceeded its planned timing; preserve it instead of cutting the failure.');
        await stages[stageIndex](); stageIndex++;
        if (stageIndex === stages.length) { finalizing = true; return await stop(); }
        return { stage: stageIndex, plannedStages: stages.length, recording: true, seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)) };
      } catch (error) { if (!finalizing) await stop(error); throw error; }
      finally { inFlight = false; }
    },
    async stop({ confirmOwnedCapture = false } = {}) {
      if (inFlight) throw new Error('Finish the current bounded stage before stopping.');
      if (startUncertain && confirmOwnedCapture !== true) throw new Error('Confirm that this take owns the bound capture before stopping an uncertain start.');
      return stop(new Error('Stopped by the operator before choreography completion.'));
    },
  };
  await seekName('button Try your tool', true, 20);
  const preflightKeyboardCount = keyboardCount;
  keyboardCount = 0;
  startedAt = Date.now();
  try {
    await cdp.send('Page.startScreenRecording', { audio: false, maxWidth: 1920, maxHeight: 1080, frameRate: 30 }, { timeoutMs: 10000 });
    recording = true;
  } catch (error) {
    startUncertain = true;
    receipt = { kind: 'retained-tool-keyboard-replay', runId: expectedRunId, expectedSourceDigest, bindings, inputAccessibleName, expectedChecks, preflightKeyboardCount,
      outcome: 'start-uncertain', captureStopped: false, error: String(error?.message || error).slice(0, 500),
      helperRequestedGeneration: false, requestAuditComplete: false, stagesCompleted: 0 };
    const recoveryError = new Error('Recorder start was not confirmed; inspect the bound tab before using recordingRecovery.stop({ confirmOwnedCapture: true }).', { cause: error });
    recoveryError.recordingRecovery = controller;
    // Never stop automatically: a definite refusal may belong to another take.
    try { await writeFile(outputBase + '.start-uncertain.json', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); }
    catch (receiptError) { recoveryError.receiptWriteError = receiptError.message; }
    throw recoveryError;
  }
  return controller;
}
