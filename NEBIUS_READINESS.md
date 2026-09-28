# Local implementation and submission evidence

## Current runtime status — September 28, 2026

| Capability | Observed result | Remaining evidence |
| --- | --- | --- |
| Hosted next-step guidance | Two Nano responses recorded, including a changed next-step/status/blocker proposal | Broader quality evaluation; neither response was applied |
| Sandbox access | Existing Token Factory key authenticated; Node 24 image imported | Ongoing availability is not guaranteed by a past observation |
| Sandbox execution | One operator-written Node diagnostic: SUCCESS, exit 0, Node v24.21.0, UID/GID 1000, writable `/tmp`, networking off | This diagnostic does not prove a generated tool |
| Tool building | Six model calls across five retained attempts; the fifth reached Sandbox syntax checking, failed, and used its one repair, which was rejected | Passing assertions, a valid generated tool and interactive preview |
| Public delivery | Separate hosted Worker and MIT source are published; Devpost entry is submitted | Final demonstration video and judging-period capacity |
| Hosted capacity | Owner raised the allowance to 20 model calls and 3 task runs per UTC day | Existing attempts still count; remaining capacity is not yet shown in the UI |
| Development review | Runtime and product reviews recorded in Projects Acceptance with independent recommendations | Optional development tooling, outside the submitted app |

The first build (`28ac5dbc-7ffc-4b7e-83cf-3ba85cf51bf6`) stopped during generation.
Its specific error was lost by a double-formatting bug. The second
(`002e5e11-2bda-4f41-bef2-dafbf21a804f`) returned files that the isolation validator
rejected. Neither attempt reached Sandbox execution or produced an accepted
artifact. Each reserved one model call; provider token counts were not retained
on these failures and remain unknown. The exact rejected file condition cannot
be reconstructed from the retained response.

The separate Sandbox diagnostic operation
`01a0e8c8-7e47-748a-b4c5-709650b91a74` completed at 16:10:51 UTC, with a ten-second
execution ceiling and no model request. It confirms the imported image and
Sandbox API work together. It is not represented as model-generated code.

Failure reasons are now preserved and displayed in Build tool. The existing
isolation rules remain enforced, with separate messages for page, worker and
check-file rejection. Tool generation now requests a strict three-file schema
with thinking disabled. After those first two attempts, the then-current five
model calls and one task run per UTC day were restored. That is a historical
checkpoint; the current configured allowance is 20 model calls and 3 task runs,
including the restoration after the fifth attempt described below. This
evidence record does not itself authorize another inference request.

The follow-up UI/copy deployment is Worker version
`86c5457b-575a-49c7-abec-4a87cda32408`. Svelte checking reported zero errors and
warnings; JavaScript syntax checks and the frontend build completed. The hosted
Build tool view showed the second attempt's retained rejection reason after
reload. No repository test suite was added or run for this pass.

The Devpost public story and eight judge-facing feedback fields were updated
and read back on September 28. The entry remains Submitted. They now distinguish
successful Nano guidance and the Node diagnostic from the still-uncompleted
generated tool. The existing embedded video was retained and identified as an
earlier Projects demonstration. The current narration draft and recorder's
Sandbox segment were updated; no new video was recorded in this pass.

The sections below retain earlier milestone observations. This current-status
section supersedes their access, hosting, publication and pending-run statements.

## Fifth tool attempt and source guidance — September 28, 2026

Run `3c509da3-ac49-4557-be7b-aefc076d3c1b` ran from 19:58:40.976 to
19:58:56.368 UTC using the deployed style correction. Its first generation
returned three files. Sandbox operation `01a0e999-3824-7030-a0a1-20847d55dceb`
returned exit 1: `node --check app.js` found incomplete JavaScript. Neither
tool logic nor the model-authored assertions executed. The one repair then
failed `invalid_model_output` at `tool_worker` for a missing `self.onmessage`.
Repair source was rejected and was not retained.

The saved record retains the initial files, actual syntax-check output and
source digest. Usage totals are complete: two model calls, 3,284 input tokens
and 1,905 output tokens. The browser initially could not verify the start
response; one authenticated GET recovered the terminal record without a second
start. The normal 20-call/3-run limits were restored after that one uncertain
start, without resetting counters. Restoration deployment was
`5d86e5ca-6626-4221-ab88-d7d6d66fbc61` at 100%.

Independent source inspection confirmed that the saved files were not sliced
by the app. Both scripts ended at the start of an embedded JSON example. The
source correction adds complete multiline-source guidance, object examples
serialized with JSON.stringify, concrete guarded worker/CommonJS scaffolding,
and value patches for form inputs. It preserves the schema, reasoning setting,
validators, Sandbox path and one-repair limit. A separate client correction
schedules one saved-run read after an uncertain start or explicit resume;
further polling requires an observed nonterminal record. It never starts a new
run automatically. Source `be06c9973bef01b42726111f24771acf380704fb` is deployed
as Worker `fda3257b-4352-4c99-b60e-3165ddf9313c`, at 100% in deployment
`e2dd1d03-3f47-440c-9b72-2bb1df6897dc`. All bindings and the 20-call/3-run
limits match the restored baseline. Eight rebuilt frontend assets were uploaded;
runtime settings differ only in the corresponding CSP script hashes, which
match the built headers. No fresh live run has exercised these changes.

Independent review accepted the provider and client source after correcting
stale-read identity and message-ordering races. JavaScript syntax and whitespace
checks, Svelte checking (zero errors/warnings), frontend build and Worker
dry-run compilation passed. No repository test suite was added or run.

The first complete generated checker remains outstanding. This attempt proves
an actual Sandbox syntax check on model-generated source, not a passing tool.
The exact authenticated receipt is retained by the operator with SHA-256
`049e16be1a6beb3b59b618fbea447b81c82c0de6ea84adb276166fec107c9fdc`.
Projects Acceptance currently returns a reauthentication error, including after
the owner reported reconnecting; this attempt has not been recorded there or
formally accepted. The public Devpost story and six affected judge-feedback
fields were updated and read back after deployment; the entry remains Submitted
with 5/5 steps done, and its existing video is retained.

## Fourth tool attempt and page-style correction — September 28, 2026

The concrete release-packet checker starter was published at
`4988e6f320bd7fa34f963078e2dbee483f82e6ec`. It places the two synthetic JSON
examples and their exact expected outputs in the task fields sent to Nebius.
Manual local and hosted walkthroughs confirmed plan approval, two created tasks,
the build/review dependency and the exact generation input.

With one additional task run authorized, run
`5a233968-8ba3-4ab3-a1ff-e0a63cc01d11` ran from 19:11:42 to 19:11:55 UTC.
Its single model call failed at `tool_page` with `page_style_missing`; the
generated HTML lacked a literal style block. Reported usage was 894 input and
921 output tokens, with complete totals. The authenticated saved-run read
returned the same failure, empty accepted files and no Sandbox checks.

The temporary four-run allowance was restored to three after admission, with
the 20-model-call ceiling retained. No daily counters were reset. All four
attempts remain counted; the unused second model call within this failed run
does not authorize another task run.

Independent source review found that style-block presence is a presentation
requirement. The correction gives styling advice without rejecting a semantic
page solely for lacking CSS. Source `6deb6439f8fa9e78c59fb7ffa82ff006b999b7ec`
is deployed as Worker version `5ad767d5-d841-4e3c-991f-e9357f8b8c00`, at 100% in
deployment `f5dd993f-72d7-4827-ab22-26c4ae3f25cc`. Provider readback confirms
unchanged bindings and asset/runtime configuration, including the 20-call/3-run
limits. At that checkpoint, no fresh model call had exercised this corrected version.
Script/resource/CSS-URL restrictions, preview
sanitization, CSP, Worker isolation and the existing repair boundary remain.
The failed source was not retained, so it cannot be replayed or claimed to meet
the remaining rules. A new complete tool, Sandbox result and interactive preview
remain outstanding after the correction.

The public Devpost story and four affected judge-feedback fields now report
the fourth attempt, its exact usage and this deployed source correction. Saved
values were read back; the entry remains Submitted with 5/5 steps done. The
existing video was retained.

## Initialization and diagnostics update — September 28, 2026

Published source `26889c35ca1b789eab4d505f8feaa4b52f28ca65` aligns preview
initialization with the generated worker contract. Run records now retain a
structured failure code/stage and any reported token counts, with incomplete
totals explicitly labeled. Existing saved runs and backups normalize through
the current validator; unknown historical usage remains unknown. Older open
clients receive a reload instruction before a new run can be admitted.

Independent source review recommended acceptance after three compatibility and
accounting corrections. Svelte/TypeScript checking reported zero errors and
warnings; JavaScript syntax, whitespace checks and the frontend build passed.
No repository test suite was added or run for this correction.

Worker version `17a6bc7b-c628-4755-aca0-b0876f04285b` was deployed at 100%
in deployment `75d88679-0687-4f21-a8c5-4579794e04c5`. Provider readback
confirmed the unchanged 20-model-call and 3-task-run daily limits.

The fresh release-packet-checker run,
`6664f366-d7d6-4ed9-95f0-4f0b26fd5268`, ran from 17:22:38 to 17:22:44 UTC.
It failed at `tool_page` with `invalid_model_output`: the generated page
did not meet the inline-style/no-script/no-external-resource contract. The
retained message does not identify which clause failed, and rejected source
was not retained. Its one model call reported 655 input and 976 output tokens;
`totalsComplete` is true for this run. The authenticated saved-run read
returned the same failure and counts, with empty files and checks.

This demonstrates the new diagnostics and persistence on a real failed call.
It does not establish generated-code execution, a working preview or full
acceptance. Three observed tool attempts have now used the day's task-run
ceiling; no additional attempt was started. The next runtime work is to
qualify generation against the page/worker/check contract before another
bounded live run.

## Review and capacity update — September 28, 2026

The owner requested a larger demo allowance. A configuration-only deployment,
Worker version `20204e58-dff1-496d-add6-3a80ae1f2cd3`, now permits 20 shared
model calls and 3 task runs per UTC day. Cloudflare reports this version at
100% of the configured deployment. Its Worker script etag and static assets
match the preceding version. No daily counters were reset and no model call or
Sandbox execution was used to confirm the new bindings.

Two scoped source reviews at commit `2055df7` now have independent local accept
recommendations after rework. They found a mismatch between the generated
worker's initialization contract and the preview message, lost structured
failure details and usage on output rejection, and incomplete continuity for
Nebius proposals. The project-update footer and approval-count headline also
need clearer wording. These are source findings, not reconstructed causes of
the two historical failures.

At the capacity checkpoint, the next milestone was to align initialization, retain useful failure
metadata and observed usage, qualify a known-good tool through the existing
validation/preview/Sandbox boundary, then obtain one complete live result.
That qualification fixture has not been added or run. Existing Sandbox network
and credential isolation remains required; a JavaScript capability allowlist
would be additional contract hardening, not proof of safe arbitrary execution.

Projects Acceptance records the engineering reviews and retained evidence.
Its optional assessments are development aids, outside the submitted app.
Submission readiness depends on the app, public source, demonstration and
observed Nebius results; it does not require that internal review service.

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
executed checks and interactive result still require a real run. At that setup
checkpoint, Projects Acceptance required reauthentication; the connection was
restored in the later review described above.

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
inference or Sandbox execution. Execution was disabled at this initial deployment;
the hosted inference ceiling was five requests per UTC day.

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
At that UI milestone, the local preview retained its configured Token Factory
models and Sandbox execution was disabled while access was pending. The current
runtime-status section above records the subsequent enablement and run attempts.

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
| Live model quality | Two ad-hoc routine responses observed; 0 of the separate 6 planned evaluation cases completed |
| Exact model/JSON compatibility | Nano guidance succeeded; Super returned files that reached Sandbox syntax checking but failed, and its repair was rejected; planning/replanning/evidence-review quality is not yet qualified |
| Measured latency and cost comparison | Pending actual calls; no fabricated estimates or benchmark claims |
| Hosted demo and judge access | Hosted app is public; owner-approved limits are 20 model calls and 3 task runs per UTC day; remaining-capacity visibility is still pending |
| Public submission repository | Published at wornpage/projects-nebius under MIT, separately from the private fork |
| Submission video | Devpost has a video; the newer live-guidance recording and final Sandbox footage have not replaced it |

These pending gates are separate from local implementation. Optional Nebius
Serverless Endpoints or Jobs remain architectural candidates and have not been
provisioned. Configure credentials locally when ready; never put them in a
public source commit or browser code.
