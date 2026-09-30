import { validatePlanInput, validateProjectPlan } from './nebius-plan-contract.mjs';

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

// Human-written examples describe proposed work; they contain no observed results.
export const PROJECT_STARTERS = freeze([
  {
    id: 'release-packet-checker', label: 'Release-packet checker',
    brief: 'Build a small browser tool for checking supplied release packets. Give it an incomplete synthetic packet and a corrected packet, with visibly different outputs. Use the first task to generate the files and run isolated checks, then review the actual tool. Readiness here means ready for human review; no release is approved or deployed by the tool.',
    plan: { title: 'Build a release-packet checker', summary: 'Turn one concrete task into a browser tool, then compare incomplete and corrected inputs in its preview.',
      tasks: [
        { id: 'build-checker', title: 'Build the release-packet checker', purpose: 'Build a small release-packet checker with a JSON textarea, Check packet button, clearly labelled outputs and buttons to load both synthetic examples. Require a JSON object with exactly candidate, health, review and rollback string fields; candidate must contain non-whitespace text. Health values: missing, failing or passing. Review values: pending, rejected or approved. Health must be passing, review approved and rollback nonblank for zero gaps. Use "1 gap: <reason>" for one gap and "<N> gaps: <reasons>" otherwise. List reasons in Health, Review, Rollback order, joined by "; ". Invalid JSON or fields start exactly "Input error: " followed by a useful reason, never readiness. The tool evaluates supplied text only; it does not contact services, verify evidence or approve a release.',
          nextStep: 'Open Build tool, review these requirements and run settings, then ask Nebius to generate the checker and execute its Node assertions in Sandbox.',
          doneWhen: "Incomplete input {\"candidate\":\"demo-42\",\"health\":\"missing\",\"review\":\"pending\",\"rollback\":\"\"} must show \"3 gaps: Health must be passing; Review must be approved; Rollback step is required\". Complete input {\"candidate\":\"demo-42\",\"health\":\"passing\",\"review\":\"approved\",\"rollback\":\"Restore demo-41\"} must show \"0 gaps: Ready for human review\". Invalid enums show an input error, never a gap count. Editing or loading another input clears or replaces the old result. Include meaningful Node assertions using the actual validate and handleMessage functions for both examples, invalid input, loader patches and edits. Generated files and Sandbox output are available in Review. Zero gaps means ready for human review, never approval.", dependsOn: null },
        { id: 'review-checker', title: 'Review both packet examples', purpose: 'Check whether the generated browser tool makes the difference between incomplete and complete supplied packets clear. Use the two synthetic examples from the build task. Record actual output and any missing behavior.',
          nextStep: 'Open the build task in Review, load each example in its tool preview, and compare the actual output with the saved criteria.',
          doneWhen: 'The incomplete packet visibly reports its three gaps; the corrected packet shows zero gaps and Ready for human review. Invalid input shows an error. The observed output and any remaining changes are recorded for a human decision.', dependsOn: 'build-checker' }
      ], missingInformation: ['Do the actual generated checks cover both examples and invalid input?', 'Does the actual preview display the expected differences and remain keyboard usable?'] }
  },
  {
    id: 'website-release', label: 'Website release',
    brief: 'Prepare a small website release. Confirm the audience and release goal, update the page, then review the proposed release before publishing. The audience, page location and approval requirements still need confirmation. Do not invent owners, dates or completed results.',
    plan: { title: 'Prepare a website release', summary: 'Clarify the release goal, update the page and review it before deciding whether to publish.',
      tasks: [
        { id: 'release-brief', title: 'Confirm the release brief', purpose: 'Give the page update a clear audience and outcome.', nextStep: 'Ask which audience and release goal the page must serve.', doneWhen: 'The audience, release goal and page location are recorded in a brief.', dependsOn: null },
        { id: 'update-page', title: 'Update the page', purpose: 'Prepare a page that addresses the confirmed release brief.', nextStep: 'Review the current page against the confirmed brief and list the required edits.', doneWhen: 'The proposed page edits are available for review and tied to the release goal.', dependsOn: 'release-brief' },
        { id: 'review-release', title: 'Review release readiness', purpose: 'Make an explicit review decision before any publication.', nextStep: 'Compare the proposed page with the brief and record any remaining changes.', doneWhen: 'The review records outstanding changes and the decision needed before publication.', dependsOn: 'update-page' }
      ], missingInformation: ['Who is the intended audience and what is the release goal?', 'Where is the page and which content should change?', 'What review and approval are required before publication?'] }
  },
  {
    id: 'workshop', label: 'Workshop',
    brief: 'Prepare a workshop. Confirm participant needs and the session goal, draft an agenda and materials, then check readiness. The participants, session format and available time are not yet confirmed. Do not invent a schedule, owner or successful outcome.',
    plan: { title: 'Prepare a workshop', summary: 'Agree the session goal, prepare supporting materials and check the workshop plan for gaps.',
      tasks: [
        { id: 'session-goal', title: 'Confirm participant needs', purpose: 'Anchor the workshop in a useful learning or working outcome.', nextStep: 'Ask who will attend and what they need to leave the workshop able to do.', doneWhen: 'Participant needs, the session goal, format and available time are recorded.', dependsOn: null },
        { id: 'prepare-materials', title: 'Draft the agenda and materials', purpose: 'Give participants a practical path toward the agreed session goal.', nextStep: 'Outline activities and materials that address the confirmed participant needs.', doneWhen: 'A draft agenda and the required materials are available for review.', dependsOn: 'session-goal' },
        { id: 'check-readiness', title: 'Check workshop readiness', purpose: 'Identify practical gaps before inviting participants to a prepared session.', nextStep: 'Walk through the draft agenda and list missing materials or arrangements.', doneWhen: 'The readiness review records gaps and the decisions required to resolve them.', dependsOn: 'prepare-materials' }
      ], missingInformation: ['Who will participate and what outcome do they need?', 'What session format and time allowance are available?', 'What venue, tools or accessibility arrangements are required?'] }
  },
  {
    id: 'customer-handoff', label: 'Customer handoff',
    brief: 'Prepare a customer handoff. Confirm what the recipient needs, assemble the agreed handoff package, then review it with the recipient. Deliverables, access requirements and acceptance criteria still need confirmation. Do not invent customer details, owners, dates or acceptance results.',
    plan: { title: 'Prepare a customer handoff', summary: 'Agree the handoff scope, assemble a usable package and review unresolved questions with the recipient.',
      tasks: [
        { id: 'handoff-scope', title: 'Confirm the handoff scope', purpose: 'Make the recipient expectations and acceptance boundary explicit.', nextStep: 'Ask the recipient which deliverables, instructions and access they need.', doneWhen: 'The required deliverables, access requirements and acceptance criteria are recorded.', dependsOn: null },
        { id: 'assemble-package', title: 'Assemble the handoff package', purpose: 'Provide the materials needed to use and maintain the delivered work.', nextStep: 'Collect the agreed deliverables and draft the supporting instructions.', doneWhen: 'A reviewable package includes the agreed deliverables, instructions and open questions.', dependsOn: 'handoff-scope' },
        { id: 'review-handoff', title: 'Review the package with the recipient', purpose: 'Record whether the package meets expectations and what remains unresolved.', nextStep: 'Review the package against the agreed acceptance criteria with the recipient.', doneWhen: 'The review records recipient feedback, unresolved gaps and the acceptance decision still required.', dependsOn: 'assemble-package' }
      ], missingInformation: ['Who is the recipient and which deliverables are expected?', 'What instructions and access requirements apply?', 'What criteria and decision process will establish acceptance?'] }
  }
].map(starter => ({ id: starter.id, label: starter.label, brief: validatePlanInput({ brief: starter.brief }).brief, plan: validateProjectPlan(starter.plan) })));

export function getProjectStarter(id) {
  const starter = PROJECT_STARTERS.find(item => item.id === id);
  if (!starter) throw new TypeError('Unknown project starter.');
  return { id: starter.id, label: starter.label, brief: validatePlanInput({ brief: starter.brief }).brief, plan: validateProjectPlan(starter.plan) };
}
