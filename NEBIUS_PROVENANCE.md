# Nebius edition: prior work and new contribution

## Baseline

This edition builds on our earlier WebMCP challenge entry. It does not claim the
Projects concept, workspace, UI components, browser-local persistence, WebMCP
tools or human approval workflow as new Nebius work.

The Nebius source snapshot has fresh Git history. The original public WebMCP
repository and deployment remain frozen. See [SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md)
for the earlier entry's historical provenance.

The next phase is a series of UI and product milestones documented in
[NEBIUS_ROADMAP.md](NEBIUS_ROADMAP.md). Projects is a reference for interaction
quality; its private code and backend logic are not being ported. Those planned
milestones are separate from the local implementation evidence below.

## Contribution and evidence

### Wornpage component enhancement

The task workspace now uses the existing pinned public Wornpage Panel, Tabs,
Badge and Select components, with separate Next step, Build tool and Evidence
views. Editors remain mounted across tab changes. Work uses MetricGrid, Metric
and Progress; run history uses Timeline for actual recorded events. These are
UI adaptations built in this fork, not imports of private Projects logic.
Public component reuse is prior work, not a new model or backend contribution.

| Area | Earlier WebMCP entry | Nebius contribution | Evidence/status |
| --- | --- | --- | --- |
| Project planning | Individual browser-local tasks | Brief-to-plan inference, editable tasks/dependencies, atomic approval and project scope | `NebiusProjectWorkspace.svelte`, `nebius-plan-contract.mjs`, `nebius-project-state.mjs`; live planning quality pending |
| Model inference | No Token Factory backend | Server-held credential and one bounded NVIDIA model call | `worker/nebius-provider.mjs`; live call pending |
| Task input | Visible browser workspace | Preview of task fields, status, optional update and selected context with consent to send | `NebiusSuggestion.svelte`, `nebius-contract.mjs` |
| Model output | Existing button-action editor | Validated next-step, blocker and status proposals in one change draft | `NebiusTaskEditor.svelte`, `nebius-client.mjs`; live usefulness remains unverified |
| Saving | Prepare and human approval for button action | One editable before-and-after draft and explicit Apply changes | Next route; no automatic save or model execution |
| Evidence review | Existing Review queue, no Token Factory review | Selected-criterion Nebius advisory review and separate completion evidence | `NebiusEvidenceReview.svelte`, `nebius-review-contract.mjs`; synthetic API/browser checks passed, live result pending |
| Demonstration data | Existing WebMCP garage sample | Four synthetic Projects scenarios for the Nebius edition | `data/nebius-demo-packs.json`; fresh browser session rendered all four |
| Continuity | Browser persistence and cache-backed shell | Unsaved evidence protection, task-editor focus return, and offline task-query recovery | Keyboard journeys at 375px/1280px and generated service-worker offline checks passed locally |
| Usage controls | Static app | IP rate limit and transactional daily call ceiling | `worker/nebius-api.mjs`, `worker/nebius-budget.mjs`; hosted verification pending |
| Task execution | No model-driven artifact execution | Existing task authorizes browser-tool files, fixed sandbox checks, one repair and human result review | `worker/nebius-runs.mjs`, `worker/nebius-sandbox.mjs`, `NebiusTaskRun.svelte`, `NebiusRunReview.svelte`; static source review only, live runtime pending |
| Presentation | WebMCP guide and landing | Nebius landing, direct navigation and contribution explanation | Local 375px/1280px browser journey passed; hosted review pending |

Renaming the edition is presentation work. The substantive contribution is the
inference workflow, bounded task execution and their controls. The organizers determine whether that
contribution satisfies the significant-update requirement.

## Evidence to collect before October 30, 2026

- Commit the actual changes with their real dates and retain the baseline SHA.
  Include a baseline-to-submission diff in the final release notes.
- Select an eligible NVIDIA model and record its exact ID and license.
- Demonstrate a real Token Factory request through the UI. Record the model,
  date and result without publishing credentials or private task content.
- Evaluate suggestions on representative tasks: actionable work, blockers,
  incomplete information and conflicting instructions. Record the number of
  cases, the rubric, outcomes and failures; synthetic tests do not measure quality.
- Verify the deployed Suggest → review/edit proposed changes → Apply changes path, failure handling
  and judge access. Set usage limits appropriate for the judging period.
- Publish this edition's complete source and setup instructions separately from
  the frozen WebMCP entry. Provide a working demo, video and Nebius feedback.

## Private Projects and the submission demo

The rules permit a login-protected hosted demo when judges receive credentials
and free access throughout judging. This does not remove the public-source
requirement for the submitted project.

The broader private Projects application can remain private. If footage shows
it, identify broader product features as context and demonstrate the submitted
Nebius functionality in the supplied working demo/test build. The public source
must contain everything needed to run that submitted functionality. Do not
present private-only behavior as reproducible from this edition. This is our
reading of the rules; an exception for a closed-source submitted feature would
need organizer clarification.

## Working schedule

The Nebius edition now adds brief-to-plan project creation and project revision
proposals. These include fresh strict contracts, bounded Token Factory calls,
manual offline editing, task dependency review, project-scoped Work and atomic
browser approval with stale-state protection. They use this fork's local demo
state; no private Projects backend modules were ported. Synthetic and local
checks establish implementation behavior, not live NVIDIA model quality.

The milestone sequence, relative effort and planning dates are maintained in
[NEBIUS_ROADMAP.md](NEBIUS_ROADMAP.md). M1 and M2 are locally complete;
M3 and M4 have local implementations awaiting live evaluation. M5 has local
portability/offline checks, and M6 has scenarios and a video outline in
[NEBIUS_DEMO_SCRIPT.md](NEBIUS_DEMO_SCRIPT.md); both remain open.

This is a preparation plan, not an acceptance receipt or a claim of a wholly new
product. See the [official rules](https://nebiusglobalaihackathon.devpost.com/rules).
