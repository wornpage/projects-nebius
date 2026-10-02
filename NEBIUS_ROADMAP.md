# Projects: Nebius edition roadmap

Status: M1 and M2 have local completion evidence as of September 27, 2026.
M3 guidance and M4 review have local implementations; live model quality and
deployed operation remain open. M5 has local UI and portability checks; M6 has
synthetic scenarios and a video outline. Both remain open. Browser checks use
synthetic inference.

October 1 execution checkpoint: an existing task authorized a real Nemotron
Super browser-tool run, which passed Sandbox after one repair. Its retained
checker passed 24 independent packet cases at two widths and interaction in
the local app. A later renderer follow-up adds result announcements and visible
input declarations. Broader generation quality, the final video and public
judge access remain open. [Execution scope](NEBIUS_EXECUTION.md) and
[current readiness evidence](NEBIUS_READINESS.md#current-runtime-status--october-2-2026)
record the result and its limits. Defaults keep execution disabled; configured
local operation is available while hosted access is paused.

## Product direction

Make the Nebius edition useful for someone managing real work: describe the
task, select relevant context, get help with the next step, review the proposed
change, and record what actually happened.

Projects is the reference for interaction quality and workflow. Development in
this edition uses fresh implementation and the existing public demo foundation.
The owner's private application code and backend logic are outside the work.
Existing public Wornpage components can continue to supply the design language.

The public WebMCP challenge repository and its deployment remain frozen.
Development stays in the private Nebius checkout until the owner publishes it.

## Project workspace milestone

The owner selected the project workspace and brief-to-plan experience as the
next product milestone. It uses the existing Work route: enter a brief,
generate a bounded plan or deliberately outline one manually, edit tasks and
predecessors, review, and approve into a persistent project. The project
overview shows next work, blockers and pending approvals with their scope.

Three tracked assignments cover the plan contract/API, browser-state approval
and portability, and the workspace UI. Existing WebMCP behavior remains a
retained baseline; private Projects application logic is outside the implementation.
Local synthetic checks cannot establish the quality of a real model plan.

## Baseline gaps found before M1 and M2

| Area | Initial WebMCP demo | Useful direction from Projects |
| --- | --- | --- |
| Task details | Quick add offers a title, proof target and metadata; the saved schema also has purpose | A clear workspace for editing the task's purpose, blocker, written next step and completion criteria |
| Written next step | The generated sentence goes into the same `next` field used for button actions | Separate the written work instruction from the control that changes task state |
| Notes and sources | Sample items contain notes and source labels; inference receives neither | Let the person choose specific context and inspect the exact text being sent |
| Review | Review surfaces blockers and missing information; model output is one suggested action and reason | Help inspect supplied work against selected requirements and explain evidence gaps |
| Completion | The local Done action can record the completion target in a message labeled as proof | Distinguish the requirement, the evidence supplied, the model's assessment and the person's completion decision |
| Continuity | Browser persistence, pending approvals, undo, and workspace import/export already exist | Make those existing capabilities easy to discover and carry new public demo fields through them |
| Reuse | The entry is centered on the existing sample and ad hoc tasks | Offer a few useful scenario starters once the core flow is coherent |

Source inspection establishes these implementation differences. It does not
establish live Nebius quality, production behavior or hosted acceptance.

## Milestones

Effort describes relative scope: **small** is a contained view/content change;
**medium** spans UI and browser state; **large** adds a model contract or a new
end-to-end interaction. These are planning estimates, not delivery promises.

| Milestone | Reviewable result | Effort | Depends on | Status |
| --- | --- | --- | --- | --- |
| M1: coherent UI | Mobile and desktop flow from entry to one selected work item, with an obvious Nebius action | Medium | Existing demo | Local implementation and rendered check complete |
| M2: usable work context | Create and edit meaningful tasks, notes and source excerpts; distinguish instruction from button action | Medium | M1 | Local implementation and browser check complete |
| M3: useful Nebius guidance | Preview selected context, generate a proposal, compare and edit it, approve a specific change | Large | M2; owner-provided live configuration for runtime proof | Local implementation; live quality open |
| M4: review and completion | Compare supplied work to chosen criteria; show gaps and record a human decision | Large | M2 and M3 | Local implementation; live quality and full journey open |
| M5: continuity and polish | Usable empty/error/offline states, keyboard flow, recovery and portable local work | Medium | M1–M4 | Core local keyboard/offline/portability journey checked; live and device gates open |
| M6: submission demonstration | A reproducible real scenario, public source preparation and a concise video outline | Medium | Proven core flow | Four synthetic work items and video outline; real demonstration open |

### M1 — Coherent UI

Local implementation: Work has a selected-item Nebius entry; the workbench
offers direct task selection and displays an unavailable state when inference
is not configured. On Nebius Work and Next pages, the WebMCP status and action
trail no longer compete with the task; the Guide still shows them. Svelte
checking and the Nebius build passed. The synthetic browser journey passed at
375px and 1280px, including Work → Next navigation, task switching, no
inference on unavailable configuration, and no horizontal overflow. Screens
were reviewed at both widths. Actual Token Factory inference remains open.

- Make Work the everyday entry, with a stable selected-item workspace.
- Keep Nebius visible next to the work it helps with. Guide and WebMCP status
  support the workflow without competing with the primary action.
- Give users an understandable starting choice: open the sample or create work.
- Show the current item and meaningful selection control on mobile. Avoid making
  task selection depend on knowing where Advanced options are.
- Show unavailable inference as a clear state, so Try Nebius never feels like a
  dead end. Opening the app must not spend inference credits.

Ready when a person can reach a work item, understand what Nebius will do and
find the next control from either viewport without reading the guide first.
The first deliverable is the screen flow and interaction prototype; settle it
before expanding routes or changing persisted data.

### M2 — Usable work context

Local implementation: quick add accepts a purpose and written step. The
workbench has a save/discard task editor with a visible change review, stale
edit protection, editable ordinary notes and source text, and a separate
button-action editor. Existing records without `nextStep` remain readable.
Only explicitly selected notes/source entries join the five-field Nebius
preview; selection is bounded to three entries and never includes the private
note field. The synthetic mobile/desktop journey confirmed editing without an
inference call, selected-context transport, unselected-note exclusion, human
approval of the written step, and unchanged button action. Live inference and
the richer M3 guidance contract remain open.

- Add an explicit local editor for purpose, blocker, written instruction and
  completion criteria, with save/discard and protection against stale edits.
- Separate written guidance from executable button actions throughout the
  public demo state owner and its views. Preserve existing saved work when
  introducing the new field; do not infer that an old button label is a rich
  written instruction.
- Let people add and edit ordinary task notes and source excerpts. A URL or
  filename remains a reference unless its actual content has been supplied.
- Use explicit context selection before sending anything to Nebius. Existing
  private-note exclusion remains in place.

Ready when a person can create a meaningful task without editing JSON, reload
it, and distinguish the work instruction from the action a button performs.

### M3 — Useful Nebius guidance

Current revision: replace the separate suggestion-to-editor transfer with one
task-change draft. A selected task and optional update produce a proposed next
step, optional blocker/status changes, rationale, 1–3 references to submitted
input and up to three missing-information items. One editable before-and-after
review precedes the human Apply changes action. Two hosted Nano proposals were
observed, including a changed draft; neither was applied. The separate six-case
advisory evaluation and broader usefulness assessment remain open.

The owner approved this direction after reviewing excessive copy and the split
between model guidance and the inherited action editor. Three tracked child
assignments cover protocol validation, the integrated editor, and Work command
semantics. Unknown/custom button labels must never execute Start in this edition;
model prose is never an executable command. Blocker counts and task statuses
remain explicitly distinct. This revision's local checks and review findings
are recorded in NEBIUS.md. Live usefulness and hosted acceptance remain open.

- Display the exact selected task context and configured NVIDIA model.
- Present a next-step proposal with its rationale and any missing information.
  If evidence references are added, validate them against the submitted input.
- Show the current and proposed text together; allow editing before adoption.
- Carry input identity through the request and approval flow so changed context
  invalidates an old proposal. Show pending, failed, limited and stale states.
- Keep generation, editing and saving visibly distinct. The existing standalone
  Nebius service remains the provider boundary.

Ready when a real call produces a useful result on representative tasks and the
user can explain what was sent, what was suggested and exactly what was saved.
Useful results need observation; a working API request alone does not prove it.

### M4 — Review and completion

Local implementation: a separate bounded Nebius review endpoint accepts one
to three selected criteria and supplied evidence. It validates one assessment
per criterion, exact evidence quotes for supported/partial results, and a
separate consistency assessment. The UI shows selected-check coverage and
keeps review read only. Recording completion evidence and marking work done
require separate human actions; the Nebius activity text does not present a
completion target as proof. Synthetic API and browser checks pass at 375px
and 1280px. Live model results, broader review quality and hosted behavior
remain open. The Projects Acceptance M4 pack stays dependency-gated until
M3 is completed.

- Accept supplied work or a completion note plus selected criteria and evidence.
- Return a bounded advisory review with supported, partial, missing and unclear
  findings. Display selected-check coverage explicitly, such as 3 selected
  criteria reviewed; do not imply that every possible requirement was checked.
- Link each finding to the input being assessed. Keep a model judgment separate
  from observed facts and from the person's approval.
- Record actual completion evidence separately from the desired result. A
  requirement copied into an activity message is not proof of its satisfaction.
- Let the person revise the work, retain a concise review note, or make a
  deliberate completion decision.

Ready when the demo can show both a supported result and an incomplete result
without automatically turning either model output into a completed task.
This review is implemented afresh for the public demo; it is not a port of
Projects Acceptance or the private evaluation service.

### M5 — Continuity and polish

Local progress: long task details, evidence review and the inherited button
action are collapsed until needed; a pending button-action draft remains
visible. Keyboard activation of both disclosures and the core generation/save
controls passed in the browser journey. Stale changes from another tab are
refused, and both viewport checks showed no horizontal overflow. A browser
export/import roundtrip retained the written step, completion evidence and
notes. A return visit retained saved text, and an offline task edit saved
locally while inference stayed disabled.

The September 27 recovery pass also protects unsaved task/evidence edits from
task switching and route navigation, supplies an explicit evidence discard
action, and preserves typed evidence after a stale save fails. Task change
review receives keyboard focus; save/discard returns focus to the disclosure,
and the save receipt remains visible. A full Tab/Enter journey through Work,
Next guidance, change approval, evidence review/recording, the inherited button
action and Guide dialogs passed at both 375px and 1280px. Dialog focus stayed
inside each dialog and returned to its trigger on Escape.

The generated service worker now resolves an uncached task query URL to its
own static route shell. With the browser offline, an unvisited
`/next?pack=nebius-keyboard-review` loaded the selected item; approved local text
survived reload, and inference configuration bypassed even a deliberately stale
cache entry. This is local browser evidence. Physical-device behavior, hosted
recovery and real model quality remain open; the Acceptance pack retains its
M4 dependency.

- Make existing local save, pending approval, undo and import/export behavior
  visible and consistent across the new UI.
- Review focus, keyboard navigation, touch targets and narrow layouts across
  the entire journey, including dialogs and long model responses.
- Explain browser-local persistence in the places it affects a user decision.
- Label status, actual results, targets, missing evidence and timestamps
  separately. Any summary count states its population and filtering.
- Show the exact change in a receipt without duplicating sensitive task text
  into unrelated activity or diagnostic output.

Ready when the user can leave, return, recover from an error and understand the
saved state. The local browser checks use synthetic inference; hosted and
physical-device checks still need to be recorded separately.

### M6 — Submission demonstration

Local progress: the Nebius build seeds four synthetic Projects work items about
release readiness, onboarding, keyboard access and a customer handoff. The
baseline static edition keeps its original sample. A fresh browser session
loaded all four Nebius items. [NEBIUS_DEMO_SCRIPT.md](NEBIUS_DEMO_SCRIPT.md)
provides a sub-three-minute outline and a four-case live observation sheet.
These are input scenarios and plans, not measured model results or submission
evidence.

- Use one realistic scenario from task creation through model guidance and
  evidence review. Keep an imperfect case in the demonstration.
- Evaluate a small, recorded set of cases covering blockers, missing facts,
  contradictory evidence and useful ready-to-act tasks. Report the actual case
  count, observations and failures separately from planned cases.
- Add two or three lightweight scenario starters if time permits. Rich reusable
  template engines and generated pages are later candidates.
- Align the landing, README, public source, demo and video around what this
  edition actually does. Record inherited WebMCP work and new Nebius work.
- Prepare the existing public-source and live-access deliverables only after
  the owner has selected the publication and hosting targets.

## Four-week planning window

| Window | Target | Status |
| --- | --- | --- |
| Sep 28–Oct 4 | Owner model selection and first real M3 calls; revise the prompt from observations | Planned; M1/M2 completed locally Sep 27 |
| Oct 5–11 | Observe M3 quality and run M4 live review cases | Planned |
| Oct 12–18 | M4 and corrections from observed model behavior | Proposed |
| Oct 19–25 | M5 and a complete M6 rehearsal | Proposed |
| Oct 26–29 | Source/demo consistency, video and final corrections | Reserved buffer |

If the core journey needs more time, reduce scenario/template breadth. Preserve
the time needed to observe live model behavior and finish the UI.

## Source and product boundary

### Manual project workflow checkpoint

Project editors now use compact native disclosures, retain openness while
typing, and expose invalid fields with keyboard focus. Progress includes all
project tasks in a stable denominator, with archived unfinished work distinct
from open remaining work. Completion receipts name and link newly actionable
tasks, and dependency activity states that a predecessor was marked done
without inventing proof.

The complete local browser journey passed at 375px and 1280px: approve an
example, record supplied evidence, complete each prerequisite, follow Ready
next, revise remaining tasks, finish all three tasks and reload at 3/3 done.
An explicit filter choice wins over delayed arrival focus. The local suite has
349 passing checks; separate reviews covered both workers and coordinator
integration, including rework of a disclosure timing defect. Live model quality
and hosted acceptance remain unverified. See [readiness](NEBIUS_READINESS.md)
for the full requirement/evidence boundary.

### Best Apps and Agents track checkpoint

The primary product story is now plan, act, adapt and review one project. The
Coding and Agentic Engineering track is separately assessed in
[NEBIUS_TRACK_DESIGN.md](NEBIUS_TRACK_DESIGN.md); at this earlier checkpoint no
code-execution capability was present. Three human-written example plans make the app usable without a key,
while the live demo script includes real planning, guidance, revision and
evidence-review calls once configured.

Operation-specific model configuration replaces the single model setting.
Routine guidance and reasoning have explicit owner-selected models, validated
before generation. The same profiles drive visible and actual output caps.
There is no automatic retry or model escalation. Nano/Super are candidates;
Ultra is an explicit reasoning-profile evaluation option, not a silent fallback.

Local checkpoint: 326 Nebius tests, baseline verification (182 source paths,
140 WebMCP contracts and14 artifact/preflight checks), and browser journeys at
375px/1280px passed. Example selection was checked for zero inference and zero
workspace writes before approval, dirty replacement refusal, manual provenance
and reload. Separate reviews recommended local acceptance of both worker
handoffs and coordinator integration. Live quality and hosted acceptance remain
unverified. The earlier UI delegation is recorded as blocked/abandoned due to
its fixed read-only task binding; direct delivery and independent review are
retained without fabricating a worker report.

### Project workspace local checkpoint

The project workspace and brief-to-plan implementation passed 159 Nebius unit
checks, the baseline `npm run verify`, and browser flows at 375px and 1280px.
Browser coverage includes offline manual planning, synthetic model proposals
without writes, editable dependency cycles refused before approval, atomic
approval, reload, project scope, cross-project focus, export/replace and reset.
Offline caching and local workerd checks also passed; the latter exercised all
three disabled inference operations with zero provider calls. Separate workers
and reviewers checked the contract, persistence and UI assignments. These are
local qualification results; live model quality and hosted acceptance remain
unverified.

Project updates and replanning are also implemented locally: manual and guarded
Nebius proposals, editable before/after review, one atomic approval, and exact
snapshot/concurrent-write protection. The combined Nebius suite has 268 passing
tests. Browser checks at 375px and 1280px cover offline manual revisions,
synthetic generated revisions, quick-add draft preservation and refused
concurrent saves. Independent review recommends local acceptance of API and
state handoffs and coordinator UI source. UI implementation ran in the
coordinator after native subagent capacity prevented another worker; that
delegated UI receipt remains unresolved and is not represented as completed.
Live model quality and hosted acceptance remain separate pending work.

- Reference Projects for the human workflow and design conventions.
- Implement changes in this demo's existing public modules, with fresh code.
- Keep the private application, backend algorithms, authorization, billing,
  orchestration, readiness and Acceptance machinery outside the demo.
- Do not import production-only modules or bind the demo to a private service.
- Preserve existing WebMCP functionality as a supporting capability. New model
  authority requires its own explicit design; WebMCP does not silently acquire
  the ability to spend inference credits or approve generated changes.

See [NEBIUS_PROVENANCE.md](NEBIUS_PROVENANCE.md) for the submission contribution
record and [NEBIUS.md](NEBIUS.md) for the implementation already present.
