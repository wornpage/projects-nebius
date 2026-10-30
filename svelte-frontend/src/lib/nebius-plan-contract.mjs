import { isRecord, validModelId, validatePlanningTrace } from './nebius-contract.mjs';
import { validateToolRequirements } from './nebius-execution-contract.mjs';

export const PLAN_VERSION = 'project-plan.v4';
export const PLAN_GROUNDING_VERSION = 'project-plan-grounding.v1';
export const PLAN_PIPELINE_LIMITS = Object.freeze({ maxModelCalls: 2, planOutputTokens: 4000, groundingOutputTokens: 2000,
  maxOutputTokensTotal: 6000, stageMs: 45000, pipelineMs: 90000, findings: 4 });
export const PLAN_LIMITS = Object.freeze({ brief: 4000, title: 120, summary: 600, tasks: 8, taskTitle: 200, purpose: 1000, nextStep: 200, doneWhen: 1000, missingInformation: 5 });
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const badControl = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
function text(value, limit, field, { empty = false, multiline = false } = {}) {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())
    || (multiline ? badControl : /\p{Cc}/u).test(value)) {
    throw new TypeError(`${field} must be ${empty ? '' : 'nonempty '}text of at most ${limit} characters.`);
  }
  return value;
}

export function validatePlanInput(value) {
  if (!exactKeys(value, ['brief'])) throw new TypeError('Preview exactly the project brief.');
  return { brief: text(value.brief, PLAN_LIMITS.brief, 'Brief', { multiline: true }) };
}

// Shared by explicit manual outlines, model output and atomic local approval.
// Validation returns a fresh projection and never mutates or creates work.
export function validateProjectPlan(value) { return projectPlan(value, false); }
// Task-owned output metadata is accepted only on the explicit authored/manual path.
export function validateAuthoredProjectPlan(value) { return projectPlan(value, true); }
function projectPlan(value, authored) {
  if (!exactKeys(value, ['title', 'summary', 'tasks', 'missingInformation'])
    || !Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > PLAN_LIMITS.tasks
    || !Array.isArray(value.missingInformation) || value.missingInformation.length > PLAN_LIMITS.missingInformation) {
    throw new TypeError('A project plan needs exactly title, summary, 1 to 8 tasks and missingInformation.');
  }
  const title = text(value.title, PLAN_LIMITS.title, 'Project title');
  const summary = text(value.summary, PLAN_LIMITS.summary, 'Summary', { empty: true, multiline: true });
  const tasks = Array.from(value.tasks, task => {
    const taskKeys = ['id', 'title', 'purpose', 'nextStep', 'doneWhen', 'dependsOn'];
    if (isRecord(task) && Object.hasOwn(task, 'executionInputs')) taskKeys.push('executionInputs');
    if (authored && isRecord(task) && Object.hasOwn(task, 'executionOutputs')) taskKeys.push('executionOutputs');
    if (!exactKeys(task, taskKeys)
      || typeof task.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/u.test(task.id)
      || !(task.dependsOn === null || typeof task.dependsOn === 'string')) {
      throw new TypeError('Every task needs an id, title, purpose, nextStep, doneWhen and dependsOn.');
    }
    const requirements = validateToolRequirements(Object.hasOwn(task, 'executionInputs') ? task.executionInputs : null, Object.hasOwn(task, 'executionOutputs') ? task.executionOutputs : null);
    return { id: task.id, title: text(task.title, PLAN_LIMITS.taskTitle, 'Task title'),
      purpose: text(task.purpose, PLAN_LIMITS.purpose, 'Task purpose', { multiline: true }),
      nextStep: text(task.nextStep, PLAN_LIMITS.nextStep, 'Task next step'),
      doneWhen: text(task.doneWhen, PLAN_LIMITS.doneWhen, 'Task completion criteria', { multiline: true }),
      dependsOn: task.dependsOn,
      ...(Object.hasOwn(task, 'executionInputs') ? { executionInputs: requirements.requiredInputFormats } : {}),
      ...(Object.hasOwn(task, 'executionOutputs') ? { executionOutputs: requirements.requiredOutputs } : {}) };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new TypeError('Task ids must be unique.');
  for (const task of tasks) {
    if (task.dependsOn !== null && (!byId.has(task.dependsOn) || task.dependsOn === task.id)) {
      throw new TypeError('A predecessor must name another task in this plan.');
    }
    const seen = new Set([task.id]);
    let predecessor = task.dependsOn;
    while (predecessor !== null) {
      if (seen.has(predecessor)) throw new TypeError('Task dependencies cannot contain a cycle.');
      seen.add(predecessor);
      const dependency = byId.get(predecessor);
      if (!dependency) throw new TypeError('A predecessor must name a task in this plan.');
      predecessor = dependency.dependsOn;
    }
  }
  const missingInformation = Array.from(value.missingInformation, item => text(item, 200, 'Missing information'));
  return { title, summary, tasks, missingInformation };
}

// A model's assessment remains advisory. These checks bind its findings to the
// exact supplied text; they do not establish that the assessment is true.
export function validatePlanGroundingReview(value, state) {
  const input = validatePlanInput({ brief: state?.brief }), plan = validateProjectPlan(state?.plan);
  if (!exactKeys(value, ['assessment', 'findings']) || !['grounded', 'not_grounded', 'unclear'].includes(value.assessment)
    || !Array.isArray(value.findings) || value.findings.length > PLAN_PIPELINE_LIMITS.findings
    || (value.assessment === 'grounded' ? value.findings.length !== 0 : value.findings.length === 0)) throw new TypeError('Invalid grounding review.');
  const findings = Array.from(value.findings, finding => {
    if (!exactKeys(finding, ['category', 'planPath', 'planQuote', 'briefQuote', 'reason'])
      || !['unsupported_detail', 'unrequested_gate', 'missing_unknown', 'dependency', 'unclear'].includes(finding.category)) throw new TypeError('Invalid grounding finding.');
    const planPath = text(finding.planPath, 100, 'Plan path');
    const planQuote = text(finding.planQuote, 240, 'Plan quote', { empty: true, multiline: true });
    const briefQuote = text(finding.briefQuote, 240, 'Brief quote', { empty: true, multiline: true });
    const reason = text(finding.reason, 400, 'Grounding reason');
    if (briefQuote && !input.brief.includes(briefQuote)) throw new TypeError('Brief quote must match supplied text.');
    if (finding.category === 'missing_unknown') {
      if (planPath !== '/missingInformation' || planQuote !== '' || !briefQuote) throw new TypeError('Missing-information findings need their exact brief quote.');
    } else {
      let target;
      if (planPath === '/title') target = plan.title;
      else if (planPath === '/summary') target = plan.summary;
      else {
        const match = /^\/tasks\/([0-7])\/(title|purpose|nextStep|doneWhen)$/u.exec(planPath);
        if (!match || !plan.tasks[Number(match[1])]) throw new TypeError('Plan path is not an allowed text field.');
        target = plan.tasks[Number(match[1])][match[2]];
      }
      if (!planQuote || !target.includes(planQuote)) throw new TypeError('Plan quote must match the addressed field.');
    }
    return { category: finding.category, planPath, planQuote, briefQuote, reason };
  });
  if (new Set(findings.map(item => JSON.stringify([item.category, item.planPath, item.planQuote, item.briefQuote]))).size !== findings.length) throw new TypeError('Grounding findings must be unique.');
  return { assessment: value.assessment, findings };
}
async function digest(value) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const planInputDigest = value => digest(validatePlanInput(value));
export const projectPlanDigest = value => digest(validateProjectPlan(value));
export async function createDiagnosticCandidate(plan, { requestId, brief, model }) {
  text(requestId, 200, 'Request id');
  if (!validModelId(model)) throw new TypeError('Invalid diagnostic model.');
  const projected = validateProjectPlan(plan);
  return { requestId, briefDigest: await planInputDigest({ brief }), candidateDigest: await projectPlanDigest(projected),
    model, promptVersion: PLAN_VERSION, plan: projected };
}
export async function validateDiagnosticCandidate(value, expected) {
  if (!exactKeys(value, ['requestId', 'briefDigest', 'candidateDigest', 'model', 'promptVersion', 'plan'])
    || value.requestId !== expected.requestId || value.model !== expected.model || value.promptVersion !== PLAN_VERSION) throw new TypeError('Invalid diagnostic candidate identity.');
  const candidate = await createDiagnosticCandidate(value.plan, expected);
  if (value.briefDigest !== candidate.briefDigest || value.candidateDigest !== candidate.candidateDigest) throw new TypeError('Diagnostic candidate digest mismatch.');
  return candidate;
}

// One response contract for both provider and browser. Rejected candidates are
// evidence only: a blocked/error outcome never projects a top-level plan.
export async function validatePlanningResult(value, expected) {
  if (!isRecord(value) || !validModelId(expected.model) || value.model !== expected.model || value.requestedModel !== expected.model
    || value.groundingModel !== expected.model || value.promptVersion !== PLAN_VERSION || value.groundingVersion !== PLAN_GROUNDING_VERSION
    || value.applied !== false || !['reviewable', 'blocked', 'failed'].includes(value.outcome)) throw new TypeError('Invalid planning result identity.');
  const requestId = text(value.requestId, 200, 'Request id');
  if (expected.requestId !== undefined && requestId !== expected.requestId) throw new TypeError('Planning request identity changed.');
  const planningTrace = validatePlanningTrace(value.planningTrace, expected.model);
  const briefDigest = await planInputDigest({ brief: expected.brief });
  if (value.briefDigest !== briefDigest) throw new TypeError('Planning brief changed.');
  let plan = null, diagnosticCandidate = null, groundingReview = null, candidateDigest = null;
  if (value.outcome === 'reviewable') {
    if (value.diagnosticCandidate !== null || planningTrace.stages.some(stage => stage.outcome !== 'passed')) throw new TypeError('Only a complete reviewed plan is editable.');
    plan = validateProjectPlan(value.plan); candidateDigest = await projectPlanDigest(plan);
    groundingReview = validatePlanGroundingReview(value.groundingReview, { brief: expected.brief, plan });
    if (groundingReview.assessment !== 'grounded') throw new TypeError('The plan did not pass grounding review.');
  } else {
    if (value.plan !== null) throw new TypeError('Rejected planning output must not expose an editable plan.');
    if (planningTrace.stages[0].outcome === 'passed') {
      diagnosticCandidate = await validateDiagnosticCandidate(value.diagnosticCandidate, { requestId, brief: expected.brief, model: expected.model });
      candidateDigest = diagnosticCandidate.candidateDigest;
      if (value.groundingReview !== null) groundingReview = validatePlanGroundingReview(value.groundingReview, { brief: expected.brief, plan: diagnosticCandidate.plan });
    } else if (value.diagnosticCandidate !== null || value.groundingReview !== null) throw new TypeError('Invalid first-stage evidence.');
    if (value.outcome === 'blocked') {
      if (!diagnosticCandidate || !groundingReview || groundingReview.assessment === 'grounded'
        || planningTrace.stages[1].outcome !== 'blocked') throw new TypeError('Invalid blocked planning evidence.');
    } else if (planningTrace.stages.every(stage => stage.outcome === 'passed') || planningTrace.stages[1].outcome === 'blocked') throw new TypeError('A successful or blocked review cannot be relabeled as an error.');
  }
  if (value.candidateDigest !== candidateDigest) throw new TypeError('Reviewed candidate digest changed.');
  if (value.outcome !== 'failed' && (planningTrace.providerAttempts !== 2 || planningTrace.knownUsageCalls !== 2
    || planningTrace.stages[0].usage.output_tokens > PLAN_PIPELINE_LIMITS.planOutputTokens
    || planningTrace.stages[1].usage.output_tokens > PLAN_PIPELINE_LIMITS.groundingOutputTokens)) throw new TypeError('Planning stage completion is invalid.');
  const usageUnknown = planningTrace.unknownUsageCalls > 0;
  const usage = planningTrace.providerAttempts > 0 && !usageUnknown
    ? { input_tokens: planningTrace.knownInputTokens, output_tokens: planningTrace.knownOutputTokens } : null;
  if (value.usageUnknown !== usageUnknown || value.providerAttempted !== (planningTrace.providerAttempts > 0)
    || (usage === null ? value.usage !== null : !exactKeys(value.usage, ['input_tokens', 'output_tokens'])
      || value.usage.input_tokens !== usage.input_tokens || value.usage.output_tokens !== usage.output_tokens)) throw new TypeError('Planning usage does not match stage evidence.');
  return { requestId, model: expected.model, requestedModel: expected.model, groundingModel: expected.model,
    promptVersion: PLAN_VERSION, groundingVersion: PLAN_GROUNDING_VERSION, applied: false, outcome: value.outcome,
    briefDigest, candidateDigest, plan, diagnosticCandidate, groundingReview, planningTrace,
    providerAttempted: planningTrace.providerAttempts > 0, usageUnknown, usage };
}
