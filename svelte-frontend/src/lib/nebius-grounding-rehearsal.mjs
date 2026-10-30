import { PLAN_VERSION, PLAN_GROUNDING_VERSION, createDiagnosticCandidate, validatePlanningResult } from './nebius-plan-contract.mjs';
import { createPlanningTrace } from './nebius-contract.mjs';
import { OPERATION_PROFILES } from './nebius-routing-contract.mjs';

// Explicit authored demonstration transport. Never calls fetch or falls back to a provider.
export const GROUNDING_REHEARSAL_BRIEF = 'Prepare a support handoff report. Audience is unknown. Confirm the audience and outline the report before writing the draft.';
export const GROUNDING_REHEARSAL_CASES = Object.freeze([
  { id: 'grounded', label: 'Grounded', description: 'Edit the draft, then review it. Changing a field removes review coverage.' },
  { id: 'rejected', label: 'Rejected', description: 'An unsupported storage choice blocks the draft.' },
  { id: 'unclear', label: 'Unclear', description: 'Uncertainty keeps the editor closed.' },
  { id: 'failed', label: 'Review failed', description: 'The draft stays read-only; the trace retains illustrative first-step usage.' },
]);
const model = 'nvidia/authored-offline-example';
const config = { available: true, operation: 'plan-project', ...OPERATION_PROFILES['plan-project'], requestedModel: model, groundingModel: model, planVersion: PLAN_VERSION };
const authoredPlan = () => ({ title: 'Support handoff report', summary: 'Confirm the missing audience, outline the report, then write the draft.',
  tasks: [
    { id: 'outline', title: 'Confirm audience and outline', purpose: 'Establish who the report is for and its outline.', nextStep: 'Ask who the report is for, then outline it.', doneWhen: 'The audience and outline are recorded.', dependsOn: null },
    { id: 'draft', title: 'Write the draft', purpose: 'Prepare the support handoff report for the confirmed audience.', nextStep: 'Write the draft from the confirmed outline.', doneWhen: 'The support handoff draft is written.', dependsOn: 'outline' },
  ], missingInformation: ['Who is the report for?'] });

export function createGroundingRehearsalFetcher(getCase) {
  return async (input, init = {}) => {
    if (init.signal?.aborted) throw new DOMException('Rehearsal cancelled', 'AbortError');
    if (input === '/api/nebius/config?operation=plan-project' && (!init.method || init.method === 'GET')) return Response.json(config);
    if (input !== '/api/nebius/plan-project' || init.method !== 'POST') throw new TypeError('The offline rehearsal does not support this request.');
    const id = getCase();
    if (!GROUNDING_REHEARSAL_CASES.some(item => item.id === id)) throw new TypeError('Choose a supported authored example.');
    const request = JSON.parse(init.body);
    if (request.brief !== GROUNDING_REHEARSAL_BRIEF || request.requestedModel !== model || request.promptVersion !== PLAN_VERSION || request.consent !== true) throw new TypeError('Use the fixed authored rehearsal input.');
    const plan = authoredPlan();
    if (id === 'rejected') plan.tasks[1].nextStep = 'Upload the draft to Shared Drive.';
    if (id === 'unclear') plan.tasks[1].nextStep = 'Write the draft for the team.';
    const requestId = 'authored-offline-' + id;
    const candidate = await createDiagnosticCandidate(plan, { requestId, brief: request.brief, model });
    const review = id === 'failed' ? null : { assessment: id === 'grounded' ? 'grounded' : id === 'rejected' ? 'not_grounded' : 'unclear', findings: id === 'grounded' ? [] : [
      { category: id === 'rejected' ? 'unsupported_detail' : 'unclear', planPath: '/tasks/1/nextStep', planQuote: plan.tasks[1].nextStep,
        briefQuote: id === 'unclear' ? 'Audience is unknown.' : '', reason: id === 'rejected' ? 'The brief does not choose a storage service.' : 'The audience has not been confirmed.' },
    ] };
    const planningTrace = createPlanningTrace([
      { stage: 'plan', reservation: 'reserved', providerAttempted: true, outcome: 'passed', model, usage: { input_tokens: 120, output_tokens: 80 }, usageKnown: true },
      { stage: 'grounding-review', reservation: 'reserved', providerAttempted: true, outcome: id === 'grounded' ? 'passed' : id === 'failed' ? 'failed' : 'blocked', model,
        usage: id === 'failed' ? null : { input_tokens: 220, output_tokens: 60 }, usageKnown: id !== 'failed' },
    ]);
    const outcome = id === 'grounded' ? 'reviewable' : id === 'failed' ? 'failed' : 'blocked';
    const result = await validatePlanningResult({ requestId, model, requestedModel: model, groundingModel: model, promptVersion: PLAN_VERSION, groundingVersion: PLAN_GROUNDING_VERSION,
      applied: false, outcome, briefDigest: candidate.briefDigest, candidateDigest: candidate.candidateDigest,
      plan: outcome === 'reviewable' ? plan : null, diagnosticCandidate: outcome === 'reviewable' ? null : candidate, groundingReview: review, planningTrace,
      providerAttempted: true, usageUnknown: id === 'failed', usage: id === 'failed' ? null : { input_tokens: 340, output_tokens: 140 },
    }, { requestId, brief: request.brief, model });
    if (init.signal?.aborted) throw new DOMException('Rehearsal cancelled', 'AbortError');
    return Response.json(id === 'failed' ? { ...result, code: 'inference_timeout' } : result, { status: id === 'failed' ? 504 : 200 });
  };
}
