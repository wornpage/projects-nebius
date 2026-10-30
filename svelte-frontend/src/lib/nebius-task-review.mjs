const fields = [
  ['title', 'Title'], ['purpose', 'Purpose'], ['nextStep', 'Next step'],
  ['blocker', 'Blocker'], ['doneWhen', 'Done when']
];
const formats = value => value == null ? null : value.map(({ id, format }) => ({ id, format }));
const same = (left, right) => {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
};
const snapshotKeys = ['version', 'packId', 'pack', 'currentStatus', 'context', 'requestedModel'];
const snapshotMatches = (record, input) => snapshotKeys.every(key => same(record[key], input[key]))
  && (input.version === 'browser-tool.v1' || same(formats(record.requiredInputFormats), formats(input.requiredInputFormats)))
  && (input.version !== 'browser-tool.v3' || same(formats(record.requiredOutputs), formats(input.requiredOutputs)));
// The existing integrity owner normalizes historical records. Compare those
// documented defaults without treating a stale verified record as current.
const comparable = record => ({ ...record, failure: record.failure ?? null,
  generationAttempts: record.generationAttempts ?? [],
  usage: record.usage ? { ...record.usage, totalsComplete: record.usage.totalsComplete
    ?? (record.usage.inputTokens != null && record.usage.outputTokens != null) } : null });
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const statuses = {
  'no-run': ['No saved run', 'No build evidence is attached to this task.'],
  pending: ['Result unavailable', 'A saved request exists, but its run record is unavailable.'],
  verifying: ['Verifying saved result', 'Checking the saved result before showing the tool.'],
  invalid: ['Saved result invalid', 'The saved result could not be matched and verified for this request.'],
  ready: ['Tool ready for review', 'A generated browser tool and recorded model-authored checks are available for human review.'],
  failed: ['Run failed', 'The recorded run failed. Any retained candidate requires review.'],
  cancelled: ['Run cancelled', 'The recorded run was cancelled. Cancellation does not establish a completed tool.'],
  uncertain: ['Run outcome uncertain', 'The recorded run outcome is uncertain. Review available evidence before deciding.'],
  running: ['Run in progress', 'The recorded run has not reached a final result.']
};

/** Read-only presentation; integrity validation and action guards remain with their existing owners. */
export function taskRunReview(input) {
  const { currentTask, reference, record, verified, integrityError, currentTaskMatches,
    taskStatus, completionEvidence, archived } = input;
  const saved = reference?.input ?? null;
  const requestedInputFormats = formats(saved?.requiredInputFormats);
  const currentInputFormats = formats(input.currentInputFormats);
  const requestedOutputs = formats(saved?.requiredOutputs);
  const currentOutputs = formats(input.currentOutputs);
  const requestFields = fields.map(([key, label]) => ({ key, label,
    requested: saved ? saved.pack[key] : null, current: currentTask[key],
    changed: Boolean(saved && saved.pack[key] !== currentTask[key]) }));
  let state;
  if (!reference) state = 'no-run';
  else if (integrityError) state = 'invalid';
  else if (!record) state = verified ? 'invalid' : 'pending';
  else if (record.id !== reference.id || !snapshotMatches(record, saved)) state = 'invalid';
  else if (!verified) state = 'verifying';
  else if (verified.id !== reference.id || !same(comparable(record), comparable(verified))) state = 'invalid';
  else state = ['ready', 'failed', 'cancelled', 'uncertain'].includes(verified.status) ? verified.status : 'running';
  const trusted = !['no-run', 'pending', 'verifying', 'invalid'].includes(state) ? verified : null;
  const [stateLabel, stateSummary] = statuses[state];
  const checks = trusted?.checks;
  const usage = trusted?.usage;
  const sourceFiles = trusted?.files ?? [];
  // Reserved fixture model names affect wording only, never verification or eligibility.
  const authoredExample = Boolean(trusted?.requestedModel.startsWith('nvidia/synthetic-'));
  const hasCheckSource = sourceFiles.some(file => file.path === 'checks.cjs');
  const label = stateLabel;
  const summary = authoredExample && state === 'ready' ? 'The tool and run figures are authored sample data for UI review.' : stateSummary;
  const evidenceExplanation = {
    authoredExample,
    author: !trusted ? 'Unavailable until the saved run is verified.'
      : authoredExample ? 'Supplied by the author of this offline example.'
      : hasCheckSource ? `Model recorded for this build: ${trusted.requestedModel}.`
      : 'Not established; no check source is retained.',
    execution: !trusted ? (state === 'no-run' ? 'No build run is saved.' : 'No verified execution record is available.')
      : authoredExample ? 'No live Sandbox execution. The entries below are sample data.'
      : checks.length === 0 ? 'No Sandbox check run is recorded.'
      : state === 'ready' && hasCheckSource ? 'The supplied checks.cjs program ran in Nebius Sandbox.'
      : 'Sandbox check processes are recorded; they are not verified against the retained source.',
    result: !trusted ? 'No verified result is available.'
      : checks.length === 0 ? 'No check result is recorded.'
      : `${checks.filter(check => check.exitCode === 0).length} of ${checks.length} ${authoredExample ? 'sample' : 'recorded'} runs exited successfully (code 0).`,
    decision: taskStatus === 'done' ? 'The task is marked done. These results remain its saved history.'
      : archived ? 'The task is archived. Inspect the saved history without making a new decision.'
      : reference && !currentTaskMatches ? 'The request changed. Review the differences; earlier checks cover the saved request only.'
      : state === 'ready' ? 'Compare the tool with the completion criteria, then decide whether to mark the task done.'
      : state === 'no-run' ? 'Review your supplied evidence against the completion criteria.'
      : state === 'failed' ? 'Review the failure details. This run does not verify the tool.'
      : 'Resolve the run outcome before using it as build evidence.'
  };
  const decisionFacts = [summary];
  if (reference && !currentTaskMatches) decisionFacts.push('The saved request does not match the current task; review the changes before using this result for the current task.');
  if (taskStatus === 'done') decisionFacts.push('The task is marked done; task status is separate from the run result.');
  else decisionFacts.push(`Current task status: ${taskStatus}. Task status is separate from the run result.`);
  if (archived) decisionFacts.push('The task is archived; archival is separate from the run result.');
  if (completionEvidence?.trim()) decisionFacts.push('Completion evidence is saved separately; saving evidence does not approve or complete the task.');
  decisionFacts.push(authoredExample
    ? 'Try the authored tool to review the interface. Sample results do not establish a live model or Sandbox outcome.'
    : state === 'no-run'
    ? 'Review supplied evidence against the current criteria.'
    : 'Inspect the generated source and behavior against the saved request. Recorded model-authored checks do not establish independent acceptance or human acceptance.');
  return {
    state, label, summary, evidenceExplanation,
    request: { fields: requestFields, requestedInputFormats, currentInputFormats,
      inputFormatsChanged: Boolean(saved && !same(requestedInputFormats, currentInputFormats)),
      requestedOutputs, currentOutputs,
      outputsChanged: Boolean(saved && (saved.version !== 'browser-tool.v3' ? currentOutputs !== null : !same(requestedOutputs, currentOutputs))),
      changedFieldCount: requestFields.filter(field => field.changed).length },
    proposal: {
      summary: state === 'no-run' ? 'No saved tool is attached to this task.' : authoredExample && sourceFiles.length ? 'An authored tool is supplied for this offline example.' : trusted ? (sourceFiles.length
        ? 'A new browser tool is proposed for the saved request.'
        : 'No tool source is retained in this verified record.')
        : 'Saved tool details are unavailable until this result is verified.',
      files: sourceFiles.map(({ path, content }) => ({ path, bytes: new TextEncoder().encode(content).byteLength })),
      rejectedResponses: trusted ? (trusted.generationAttempts ?? []).filter(entry => entry.outcome === 'rejected').length : null
    },
    evidence: {
      checkCount: checks ? checks.length : null,
      passedCheckCount: checks ? checks.filter(check => check.exitCode === 0).length : null,
      modelCalls: count(usage?.modelCalls), inputTokens: count(usage?.inputTokens), outputTokens: count(usage?.outputTokens),
      totalsComplete: usage ? usage.totalsComplete === true : null,
      sourceValidated: Boolean(trusted && trusted.status === 'ready' && sourceFiles.length)
    },
    decision: { title: taskStatus === 'done' ? 'Task marked done' : archived ? 'Task archived'
      : reference && !currentTaskMatches ? 'Review task changes'
      : state === 'ready' ? 'Decide whether the task is done'
      : state === 'failed' ? 'Review the failed attempt'
      : state === 'no-run' ? 'Record completion evidence' : 'Resolve the run outcome', description: decisionFacts.join(' ') }
  };
}
