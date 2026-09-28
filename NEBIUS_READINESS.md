# Local implementation and submission evidence

## Sandbox access update — September 28, 2026

The existing Token Factory API key authenticated `GET /sandboxes/v1/whoami`
with HTTP 200 and granted import, spawn, list and cancellation permissions.
The official `docker://docker.io/library/node:24-bookworm-slim` image import
completed successfully as operation `01a0e8b3-b083-7256-8c32-47cd805a7f60`,
producing image `f9ac0575-e7bd-3a81-bfa4-7d7f7a92b89c`. Read-only image
inspection confirmed `/usr/local/bin/node` and a world-writable sticky `/tmp`.
No model call or Sandbox code execution was used for this setup.

The hosted demo configuration now enables execution with that pinned image,
the existing one-run daily limit, and the unchanged five-call daily inference
limit. The shared task-ID validator also accepts project-created task IDs.
Svelte checking reported zero errors and warnings and the frontend build passed.
These observations establish setup readiness; the first generated tool,
executed checks and interactive result still require a real run. The requested
Projects Acceptance connector currently requires reauthentication.

Worker version `d1176bd9-6c48-4761-bcb9-910cd75f46da` was deployed with the
Sandbox credential stored as a secret. The hosted `/api/nebius/runs/config`
returned HTTP 200 with `available: true`, the Super model, two model calls at
most, and two 30-second Sandbox executions at most. All 200 public tracked
files matched the private build source at deployment. The public checkout's
build attempt lacked installed dependencies; the matching private checkout's
frontend build completed. No test suite was run for this setup update.

## Product scope

The primary entry is a project copilot for the Best Apps and Agents track:
create a plan, choose useful work, adapt the plan, and review supplied evidence.
The new execution milestone connects an existing task to browser-tool generation,
Sandbox checks, one repair and result review. It is disabled by default;
live execution remains unverified. See [execution design](NEBIUS_EXECUTION.md)
and [track design](NEBIUS_TRACK_DESIGN.md).

## Requirement audit

| Requirement | Implementation or evidence | Current boundary |
| --- | --- | --- |
| A useful project journey | Work project creation, examples, next-step guidance, project updates, evidence recording and completion | Local browser journey passed at 375px and 1280px, including all three tasks completed and replanning after a prerequisite finished |
| Human control | Exact request previews, explicit generation, editable proposals, separate approval and completion | Model output never directly writes work or proves completion |
| Reliable local state | Atomic plan/replan saves, stale revisions, reload, import/export, dependency release and undo checks | Browser-local workspace; no shared private backend |
| Concise responsive UI | Native task disclosures, explicit progress counts, current Ready next links | Phone/desktop, keyboard disclosure/error focus, and explicit-filter precedence checks passed locally |
| Nemotron model strategy | Separate routine/reasoning roles, verified official model/JSON documentation, exact configured model in each preview | Nano/Super candidates; Ultra requires deliberate owner selection and live comparison |
| Usage and spend controls | Shared daily/IP admission, bounded inputs/output tokens, one call per request, provider-reported token usage | Call/token caps are not a dollar budget; failed requests can still cost money |
| Independent review | Separate workers and reviewers; concrete local handoffs and rework recorded in Projects Acceptance | No hosted GitHub acceptance is claimed |
| Reproducible source | Public source manifest, pinned dependencies, MIT license, setup/build/check commands in NEBIUS.md | Separate public repository published with fresh history |
| Private/public boundaries | Fresh demo modules, existing public UI dependencies, no private Projects backend port | Frozen WebMCP repository and its deployment are separate |
| Reviewable delivery | Separate public repository and hosted Worker; live routine inference observed | Broader model evaluation, Sandbox execution and formal acceptance remain outstanding |

## Local verification

### Demo presentation — September 28, 2026

Unchanged model suggestions now show a no-change message and an Add an update
action. They do not open an empty task review. Comparison tables show changed
fields only, with a short preservation note. A review can be discarded even
when its normalized fields are unchanged.

Build tool now names Nebius Sandbox and presents its Build, Check and Review
workflow as **Preview only — execution disabled** when unavailable. The hosted
keyboard path opened its explanation; no run was started or inferred. The
preview describes an example release checklist without presenting a generated
artifact or successful Sandbox result.

Svelte checks completed with zero errors and warnings; the production frontend
build and whitespace check completed. No test suite or new model call was run,
and the no-change model path still needs observation on a future live response.
Worker version: `b0bacb0a-881c-4695-aed0-d2337124a282`. Projects Acceptance again
reported UNAUTHORIZED and requires reconnection; no acceptance receipt exists
for this change.

### Hosted inference repair — September 28, 2026

The original connection failures were caused by `redirect: 'error'`, which the
installed Workers runtime rejects before sending HTTP. All five Token Factory
and Sandbox fetch sites now use `manual` and reject redirect responses through
their existing status checks. The same runtime reached the unauthenticated
Token Factory model endpoint with manual mode and received the expected HTTP 401.

After the connection repair, a hosted suggestion failed envelope validation;
disabling Nano thinking produced a complete but invalid suggestion. A strict
JSON schema was then added. Its initial request exceeded the 15-second deadline;
another returned HTTP 400. Removing `uniqueItems` and `pattern` from the provider
schema, retaining full local validation, and allowing a bounded 45 seconds
produced a valid live response. The exact cause of the earlier envelope and
schema rejection was not captured; those causes must not be overstated.

Observed success: HTTP 200, request `82549970-6ccf-4dfe-a4d4-e42342f06082`, model
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, 537 input tokens and 139 output tokens.
The browser showed **Suggestion ready. Nothing has been saved.** The proposed
next step retained the sample's health-probe requirement and listed missing
health, review and rollback evidence. No suggestion was applied.

The owner authorized three additional requests beyond the five-call ceiling.
All three were used; the ceiling was restored to five after success. Final
Worker version: `02755cac-505f-4f23-a89b-771ac06e1ae2`. Failed attempts remain
counted; further calls wait for the next UTC daily reset. Syntax and whitespace
checks completed; no test suite was run. This proves one routine suggestion,
not planning, evidence review, Sandbox execution or formal Projects Acceptance.

### Public source and initial hosted demo

On September 28, 2026, the standalone 200-file source snapshot was published as
[wornpage/projects-nebius](https://github.com/wornpage/projects-nebius), with
fresh Git history and the MIT license. The initial source commit is
`d7bea460b605b94f82077c9a69ce651a975f810c`. Documentation follow-ups do not change
the uploaded application code. The development fork retains private visibility.

The separate `projects-nebius` Cloudflare Worker serves
https://projects-nebius.ayivx-do-lmf-982.workers.dev/. Initial code upload version:
`fd9f202c-e750-4a17-899c-1601901e4da5`; adding the server-held Token Factory secret
created version `06d0629e-05d7-45ea-8861-df1b142947e8`, observed at 100% allocation.
The landing route returned HTTP 200. Read-only configuration requests for
next-step guidance and project planning returned the configured Nano and Super
models. These observations establish hosting and configuration, not successful
inference or Sandbox execution. Execution remains disabled; the hosted inference
ceiling is five requests per UTC day.

No live model or Sandbox call was made for this deployment, and no test suite was
run during this publication pass. Formal Projects Acceptance, end-to-end model
results and rollback qualification remain outstanding. Devpost registration and
entry submission are separate from GitHub publication and app hosting.

### Wornpage component enhancement

Next step now has a task brief and Wornpage tabs for guidance, tool building and
evidence. Tab panels retain mounted editors and the existing save/approval
guards. Work adds Wornpage metrics and an actual task-completion progress bar;
sandbox history renders only recorded run events. All components come from the
public packages already pinned in this fork. No private Projects modules were
copied and the frozen public repository was not changed.

`npm run check` reports zero errors and warnings, and `npm run build:nebius`
completed. Independent read-only source review found no actionable issues in
draft preservation, focus recovery, approval gates or count definitions. No test
suites or live generation/sandbox calls were run for this UI change. Projects
Acceptance requires reconnection, so this milestone has no Acceptance receipt.
The local preview retains its configured Token Factory models; sandbox execution
remains disabled while beta access is pending.

The current publication snapshot contains 200 manifest-listed paths. The
configured API key and private-key markers were checked against those files;
no matches were found. The export excludes local credential files, installed
dependencies, local run state and private Git history.

### Task execution source milestone

The current change adds the run service, browser integration and isolated tool
preview. Static checks and compilation completed: `npm run check` reported zero
errors and warnings, `npm run build:nebius` passed, and the Wrangler Worker
bundle dry run passed with all three Durable Object bindings. JavaScript syntax
checks and `git diff --check` passed. At that milestone the source manifest had
198 paths (188 previously); the current publication count is recorded above.

No new tests, test suites, live model calls, sandbox calls or deployment were
performed. No generated preview runtime was exercised. The historical
374-check and browser results below belong to preceding source milestones and
do not qualify this execution path. At that milestone the local preview on port
8797 had both inference and execution explicitly disabled.

Independent read-only review supported both source scopes. The UI handoff was
recorded; the server handoff was refused by an evidence-recording guard, and
the normal rework path also refused to proceed. Those internal records remain
open. Source review does not constitute formal hosted acceptance or parent
completion.

### Clean-source reproduction

On September 28, 2026 UTC, a source archive from the preceding implementation
milestone was extracted outside the development checkout. It contained no
installed dependencies or local provider configuration.
Both `npm ci --ignore-scripts` installs passed using empty user/global npm
configuration and a fresh npm cache. No private Projects service was used.

`npm run verify:nebius` then passed all 374 tests, checking, build, dry-run
bundle and local runtime checks (four disabled operations, zero inference calls).
The documented `npm run dev:nebius` command served the Nebius landing at
`http://127.0.0.1:8787/` with inference disabled.

This was a clean source/dependency run on the existing Windows host with Node
24.19.0 and npm 11.17.0, not a fresh operating-system or hosted deployment test.
Browser suites additionally need a compatible Chromium executable; it is not
installed by `playwright-core`. Public npm/GitHub network access is required
for dependency installation. The publication and live-model gates below remain.

### Usability refinement

The Nebius Guide now describes the complete project workflow. The inherited
`/webmcp-challenge` address is retained for existing links, but the Nebius build
does not show or register the old Guide's browser-agent tutorial/tool. Optional
WebMCP tools remain on Work, Review and Next; the static WebMCP build retains
its own Guide and navigation. The frozen public repository was not changed.

Task pages show the saved next step before editing, with direct links to resolve
pending actions or unsaved edits. Evidence recording appears before optional
Nebius analysis. Empty update inputs are absent when inference is unavailable;
existing text is retained offline. Project buttons say whether they draft,
review, create or save. All saves still require the existing explicit action.

Focused browser assertions cover pending-draft resolution without writes,
validation revealing/focusing a hidden title field, offline update preservation,
manual evidence saving, keyboard access and the Guide at 375px and 1280px.
The broader journey suites cover creation, replanning, completion, backups,
stale writes and consistent progress counts. These are local engineering checks,
not a first-time-user study or proof that model suggestions are useful.

### Workshop rehearsal

A separate local browser workspace was used to rehearse a workshop moving
online after a venue problem. This exposed a real bug: completing its first
task erased the next task's independent meeting-link blocker. Dependency
release now preserves independent or ambiguous blockers, and only actionable
tasks appear in the unblocked receipt. A person can resolve the remaining
blocker explicitly. Default dependency-only tasks still advance normally.

Saved completion criteria are now visible beside manual evidence, including an
explicit missing-criteria state. Optional AI review has its own selected
criteria and does not change those saved requirements. Approved project-update
summaries and task reasons are kept in the existing bounded activity history
and survive reload/export. Old updates are not reconstructed.

The browser regression repeats this full manual scenario at 375px and 1280px,
checks the retained blocker after reload, and makes zero inference requests.
This is an agent-run rehearsal with synthetic workshop facts, not external
user feedback or a live Nebius quality result.

The rehearsal adds 25 focused checks, bringing the Nebius suite from 349 to
374 passing tests. Dependency-release cases cover all three completion paths,
custom blockers, stored/display title differences, Unicode truncation,
terminal tasks, storage failures and undo. Replan-history checks cover the
maximum approved explanation, bounded history, reload and export.

The preceding advisory and manual project workflow milestone passed 349 Nebius checks. The preserved static gate
passed 140 WebMCP contracts and 14 artifact/preflight checks. Local browser
coverage includes manual and synthetic model paths, disclosure state while
editing, exact approval, dependency release, fresh replanning after completion,
all-tasks-done reload and a stable project denominator while filtering.
These counts describe local verification, not live-model observations.

Run the current checks rather than treating this document as a test receipt:

```sh
npm run test:nebius
npm run verify
npm run build:nebius
npm run test:nebius:projects
npm run test:nebius:browser
npm run test:nebius:offline
npm run test:nebius:runtime
```

On Windows, stop the local preview before rebuilding. `verify` builds the
preserved static edition; rebuild the Nebius edition before its browser/runtime
checks. The browser suites use test-owned data and synthetic inference. The
runtime check keeps inference disabled. None establishes real model quality.

The fourteen pinned Wornpage UI archive URLs in `svelte-frontend/package.json`
returned HTTP 200 to unauthenticated HEAD requests on September 28, 2026 UTC.
This confirms public dependency accessibility at that time, not a hosted demo
or a fresh-machine installation. Their exact revisions remain in the lockfile.

## Evidence still required for submission

| Gate | Actual evidence collected |
| --- | --- |
| Live model quality | 0 of 6 planned cases run; see NEBIUS_DEMO_SCRIPT.md |
| Exact model/JSON compatibility | Pending owner key, model selection and live calls |
| Measured latency and cost comparison | Pending actual calls; no fabricated estimates or benchmark claims |
| Hosted demo and judge access | Not deployed by this work |
| Public submission repository | Private fork; owner publication pending |
| Submission video | Rehearsal script prepared; no finished public video asserted |
| Formal hosted acceptance | No independent hosted run/review receipt asserted |

These pending gates are separate from local implementation. Optional Nebius
Serverless Endpoints or Jobs remain architectural candidates and have not been
provisioned. Configure credentials locally when ready; never put them in a
public source commit or browser code.
