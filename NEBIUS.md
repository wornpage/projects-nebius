# Nebius edition

## Scope

This edition extends the earlier public WebMCP challenge source. That repository
and its challenge deployment remain frozen. The submission source is prepared separately
as `wornpage/projects-nebius`; the development fork retains its private history.

The Next page uses an NVIDIA model to propose task changes. It previews the
selected browser-local item's title, purpose, next step, blocker, completion
criteria and current status, plus an optional update and up to three notes or
source entries explicitly selected by the person. Generation makes one Token
Factory call. A proposal contains a next step and may also suggest a blocker
or status change. One before-and-after draft shows the changes for the person
to edit and approve. A dirty draft cannot be overwritten by a suggestion.
Model text is a proposal, not verified evidence.

No new WebMCP tool can invoke inference or save the model output. Generation
does not write the browser workspace. Changed task text, context selection or
navigation discards late responses. Unselected notes, source entries and
unrelated items are excluded. Selected fields can themselves contain sensitive
text, so review the preview before consenting. Provider
processing follows Nebius's terms/account settings. No provider-retention
guarantee is made here.

## Run locally

### Project workspace

Start on **Work** and choose **New project**. Enter a brief, then either outline
the plan yourself or explicitly send the brief to Nebius. The manual option is
available without a provider key and is labeled human-created. A model error
never substitutes a manual or fabricated response.

Edit the project title, summary, and one to eight tasks. Each task has a purpose,
next step, completion criteria and at most one predecessor. Review the whole
plan before choosing **Approve and create project**. Approval creates the project and its
tasks atomically; tasks with an unfinished predecessor begin blocked. The
project selector scopes Work without changing the full-workspace denominator.
The overview defines next work, recorded blockers and pending approvals.

Projects and membership stay with workspace export/import and reload. A full
sample reset deliberately removes them together with the rest of local work.
The existing sample tasks remain available under **All work**.

Task plans use expandable summaries so you can scan the sequence before editing
individual fields. Validation opens the fields that need attention. Project
progress shows actual Done status against every task in the project, including
archived tasks; open remaining and archived unfinished work are identified
separately, and list filters never change that denominator.

Completing a prerequisite releases its dependent task through the existing
workflow. Independent blockers remain; ambiguous blocker text after a renamed
predecessor is retained for a person to resolve. The saved receipt links to currently actionable successors under
**Ready next**. Those links disappear if the target becomes blocked, archived,
completed or leaves the selected scope. **All tasks marked done** describes
work status, not evidence verification or publication approval.

### Project updates

Select a project and choose **Update project**. Describe the changed circumstance,
then edit manually or consent to a Nebius revision proposal. Both paths let you
edit existing open tasks and review every changed field before **Approve and save changes**.
The project snapshot and update are visible before sending. Completed and
archived tasks provide context but cannot be changed by this operation.

Approval saves the reviewed task revisions together. A changed project snapshot,
pending next-action draft on a target task, invalid dependency or concurrent
browser write refuses the whole update. Other tasks and metadata are preserved.
Replanning currently supports all of a project's one to eight tasks; it does
not silently truncate a larger project, create/delete tasks or mark work done.
Manual revision works offline. Model output remains a proposal rather than
evidence that work happened.
The approved summary and each changed task's reason are saved in its bounded
activity history and included in workspace backups.

### Setup and verification

Use Node.js 24 and npm. Install both root and frontend dependencies from the
lockfiles; public npm/GitHub access is required. No private Projects service or
Cloudflare account is required for local manual use.

The Nebius edition starts with four synthetic Projects work items. Its source
is `data/nebius-demo-packs.json`; the baseline static build retains its
original WebMCP sample. Resetting the Nebius workspace restores only the
synthetic Nebius items in that browser.

```sh
npm ci --ignore-scripts
npm --prefix svelte-frontend ci --ignore-scripts
npm run dev:nebius
```

Open `http://127.0.0.1:8787/`, then choose **Start a project**. With no
`.dev.vars`, inference is disabled and manual workflows remain available.
Stop the preview before verification or rebuilding, especially on Windows.

The non-browser gate runs without a provider key:

```sh
npm run verify:nebius
```

Browser checks additionally require an existing compatible Chromium executable.
`playwright-core` does not download a browser. Set `CHROME_EXECUTABLE_PATH` to
its absolute path (see the PowerShell example in [README.md](README.md)), then:

```sh
npm run test:nebius:browser
npm run test:nebius:projects
npm run test:nebius:offline
```

On Windows, stop an existing local preview before rebuilding; its asset watcher
can keep the generated output directory open.

The offline gate uses synthetic model responses, performs a real frontend
build, bundles the Worker without uploading it, and starts local workerd with
inference explicitly disabled to check runtime compatibility and routing.
It does not make a live inference call. To try a real call, create an ignored
`.dev.vars` locally:

```text
NEBIUS_ENABLED="true"
NEBIUS_ALLOWED_ORIGIN="http://127.0.0.1:8787"
NEBIUS_MODEL_ROUTINE="<exact available NVIDIA model ID for routine guidance>"
NEBIUS_MODEL_REASONING="<exact available NVIDIA model ID for planning and review>"
NEBIUS_API_KEY="<your Token Factory key>"
NEBIUS_DAILY_CALL_LIMIT="50"
```

Choose currently available NVIDIA open-source models and check their licenses and
JSON-mode support in the Token Factory catalog. Nano is the initial candidate
for routine guidance; Super is the initial candidate for planning and review.
Ultra is an explicit owner choice for the reasoning role after live evaluation
justifies its cost and latency. See [NEBIUS_TRACK_DESIGN.md](NEBIUS_TRACK_DESIGN.md).
The former single `NEBIUS_MODEL` setting is no longer read. There is no default model or
alternate provider. Never put credentials into browser configuration or Git.
Then run `npm run dev:nebius`, open `http://127.0.0.1:8787/`, create or select a task,
review its fields, and explicitly select Generate suggestion. That call may
incur provider charges. Model availability and output quality need live proof.

## Task execution

The Next page also has **Run this task** for a small browser tool. This is a
separately enabled execution path: it uses the reasoning model, a persistent
run record, up to two sandbox checks and one repair, then returns the artifact
to Review. Saving its evidence and marking the task done are separate actions.
See [NEBIUS_EXECUTION.md](NEBIUS_EXECUTION.md) for its credentials, fixed limits,
preview isolation and retention. Sandbox access and a Node 24 diagnostic are
confirmed; a complete generated tool and interactive preview remain unverified.
See the current status in [NEBIUS_READINESS.md](NEBIUS_READINESS.md).

## Advisory runtime and limits

`worker/index.mjs` serves the existing static build and `/api/nebius/*` only.
The Worker uses compatibility date `2026-09-01`, which the pinned Wrangler
4.126.0 local runtime supports. Raising that date requires a compatible runtime
and an actual local startup check; a bundle dry run does not establish startup.
GET `/api/nebius/config?operation=<operation>` supplies model identity, role and
output-token ceiling for exactly one named operation, with no task
input or inference. POST `/api/nebius/suggest-next-step` accepts the five
previewed task fields, `currentStatus`, an optional `update` string of at most
1,000 characters, a bounded selected-context array, the preview's model/prompt
identity and `consent: true`. The protocol is `task-change.v1`; the earlier
`next-step.v3` proposal format is no longer accepted by this edition.

POST `/api/nebius/review-evidence` accepts the same bounded task projection,
one to three selected criteria, supplied evidence, the review version and
explicit consent. The model's findings are advisory and never save or complete
a task. Supplied evidence is recorded in a separate browser-local field only
after a human action. Marking work done is another human action. Both inference
operations share the same IP limiter and daily request ceiling.

POST `/api/nebius/plan-project` accepts only a brief of up to 4,000 characters,
model identity, `project-plan.v1` and explicit consent. It returns a bounded
project plan with one to eight tasks and missing-information notes. Duplicate,
missing, self-referencing and cyclic task dependencies are refused. No existing
workspace or unrelated task fields are sent by this operation. Planning uses
the same request admission and daily quota as task suggestions and reviews.

POST `/api/nebius/replan-project` accepts the exact selected project snapshot,
an update of up to 2,000 characters, model identity, `project-replan.v1` and
explicit consent. Its response proposes one to eight existing task changes and
missing-information notes. Full dependency validation covers unchanged tasks
too. Replanning has a 160-KiB request cap to accommodate bounded Unicode and
JSON escaping (maximum canonical fixture: 161,159 bytes); other operations
retain their 49,152-byte request cap. All four operations share admission and
the same daily request ceiling.

This API validates browser-supplied content; it does not authenticate a saved
server workspace. The configured origin must match. Cloudflare's native IP
limiter admits 3 requests per minute. A SQLite Durable Object atomically limits
all calls to 50 attempts per UTC day by default. The daily limit is explicit
configuration; failures remain counted because the provider may have billed.
It is a request ceiling, not a precise dollar budget. These counters hold no
task text. Configure sufficient judge access before any submission.

Calls use the fixed Token Factory HTTPS endpoint, refuse redirects through
Workers-compatible manual handling, and have a 45-second deadline. Task suggestion
and review calls have a 32-KiB response limit
and request at most 1,200 output tokens; project planning and replanning permit 128 KiB and
4,000 output tokens. The proposed next step and optional blocker are each limited to 200
characters. Proposed status is restricted to draft, active or blocked;
completion and reopening completed work are not model actions. Model proposals
cannot set an executable button command. Saving an approved next step preserves
other fields unless their changes were also reviewed. Existing dependencies
cannot be silently cleared by model output.

Routine suggestions explicitly disable Nemotron thinking and request a strict
JSON schema with input-relative basis IDs. The provider schema uses core shape,
type, enum and size constraints; local validation additionally enforces unique
basis IDs, single-line text and consistent status/blocker changes. The other
advisory operations retain their existing model reasoning settings and JSON-object
mode. Tool generation separately requests a strict three-file schema and disables
thinking to reserve its 8,000-token ceiling for the generated files.
Truncated responses, wrong model identity, malformed JSON, tool calls and
invalid output are refused. The four advisory operations have no automatic
retries, fallback model or automatic task writes. The execution path may make
one explicitly authorized repair using actual failed sandbox output. The
service worker excludes all Nebius APIs from caching.

The default Worker configuration disables inference and public routing. The
named `demo` environment uses a separate `projects-nebius` Worker, the configured
workers.dev origin, the Nano/Super model pair, and a five-call daily ceiling.
Sandbox execution is enabled in that environment with a pinned Node 24 image
and a one-run daily limit. It must not reuse the frozen WebMCP
deployment. Configure your own Worker name and origin before deploying a fork.

Build and inspect a deployment bundle with:

```sh
npm run build:nebius
npx wrangler deploy --dry-run --config wrangler.nebius.jsonc --env demo
```

For an owner-authorized hosted deployment, deploy that environment and store
`NEBIUS_API_KEY` with `wrangler secret put NEBIUS_API_KEY --config
wrangler.nebius.jsonc --env demo`. Enter the key only at the protected prompt;
never include it in source or command arguments. A missing key keeps inference
unavailable. The deployment and runtime evidence belong in
[NEBIUS_READINESS.md](NEBIUS_READINESS.md), separately from local build results.

## Build boundary

`npm run build` retains the baseline static edition with no Nebius card or API
requests. `npm run build:nebius` sets `PROJECTS_NEBIUS_EDITION=true` and mounts
the feature in the same Next route. Both use the existing static build path.

Compatibility retained:
- Consumer: the frozen WebMCP static edition and this Nebius edition.
- Owner: Jared Bidlow.
- Removal condition: retire the baseline build in this edition explicitly;
  the public challenge artifact is never changed by this branch.
- Test coverage: existing static/WebMCP contracts plus Nebius API/client and
  rendered Next-flow checks.
- Why hard cutover is unsafe now: the previous challenge edition must remain
  reproducible and frozen while the new feature is developed separately.

## Local verification record

The current rehearsal milestone passed 374 Nebius tests, 140 WebMCP contracts,
Svelte checking with zero errors/warnings, and local runtime checks with all
four inference operations disabled. Project/task journeys passed at 375px and
1280px, including independent-blocker preservation, manual completion criteria,
approved explanation retention and offline recovery. See
[NEBIUS_READINESS.md](NEBIUS_READINESS.md) for current evidence and limitations.

### Earlier milestones

The integrated `task-change.v1` revision passed 63 API/client contracts,
140 WebMCP contracts, Svelte checking with zero errors/warnings, and the
retained static edition's build plus 14 artifact/recording contracts.
The Nebius browser run at 375px and 1280px covered next-step-only preservation,
multi-field before/after approval, typed-update navigation protection, mobile
comparison width, navigation labels, existing pending-draft approval/discard,
and refusal to clear a linked dependency. Previous stale-tab, evidence,
keyboard and import/export journeys remain covered. The service-worker
offline check passed, and local workerd startup/routing passed with inference
disabled and zero model calls. Three tracked workers and independent reviewers
participated; responsive and baseline-compatibility findings were reworked.
These are local source and synthetic-browser results. Formal hosted acceptance
and useful real NVIDIA output remain unproven.

The M5 recovery pass checked unsaved task/evidence navigation guards, visible
save/discard focus, retained text after a stale evidence write, and an actual
Tab/Enter journey through Work, Next and Guide dialogs at 375px and 1280px.
The service-worker browser check also loaded an unvisited task query URL
offline, saved and reloaded a written step, preserved unrelated caches, and
refused stale cached inference configuration. These checks use synthetic input
and local browser state; no hosted service or real model output is implied.

M3/M4 local source update: 37 Nebius API/client contracts passed, including
unsupported review quotes and selected-context references. Synthetic browser
journeys at 375px and 1280px covered proposal comparison, read-only review,
completion evidence recorded before the person's Done action, truthful
activity wording, keyboard activation of core controls, an offline browser-local
save with inference disabled, a return visit, and an export/import roundtrip
retaining the Nebius fields.
A fresh browser session also loaded four synthetic Nebius work items. The
baseline static build passed 140 WebMCP contracts and 14 artifact/recording
contracts. These do not measure live NVIDIA model quality or hosted operation.

M2 context update: 33 Nebius API/client contracts passed. The synthetic
browser journey at 375px and 1280px covered ordinary context editing without
inference, selected-note/source transport, unselected-note exclusion, review
before save, unchanged button action, meaningful quick creation, and rejection
of a stale edit from another tab. Svelte checking passed with zero diagnostics.
The baseline static build passed 140 WebMCP contracts and 14 artifact/recording
contracts after removing the Nebius API bypass from its generated service worker.
The M2 checks do not include a real Token Factory call.

M1 UI update: the Work entry and task selector are visible at 375px and 1280px;
the offline browser run follows Work to Next, switches tasks, and confirms an
unconfigured model makes no inference call. Svelte checking returned 0 errors
and warnings; the Nebius build passed. The browser run uses synthetic responses.

The initial September 27 prototype checks passed 33 API/client contracts, 140
existing WebMCP contracts, Svelte checking, the Nebius frontend build and
Worker bundle dry run. That prototype's browser run covered generation without
a write, adoption through the old button-action editor and human approval. M2
replaced model adoption with the separate written-step editor described above.

These results do not establish a live Token Factory call, deployed access,
hackathon eligibility or submission approval. Development remains in the private
checkout; the local checks did not deploy or publish the edition.

## Submission preparation

The [demo script and observation sheet](NEBIUS_DEMO_SCRIPT.md) identify what
must be recorded from real model calls before claiming useful results. The
official rules permit extending existing/open-source work with significant
new functionality during August 26–October 30, 2026. A real Token Factory call
qualifies. The eventual public submission must include all necessary source,
assets, license and setup instructions. The public source snapshot is prepared
as `wornpage/projects-nebius` with a separate history;
never change the frozen WebMCP repository. Provide a working demo, narrated
public YouTube video under three minutes, feedback and an explanation of the
new work. Judge access must remain free through December 15, 2026.

References checked September 27, 2026:
- [Official rules](https://nebiusglobalaihackathon.devpost.com/rules)
- [Token Factory quickstart](https://docs.tokenfactory.nebius.com/quickstart)
- [JSON mode](https://docs.tokenfactory.nebius.com/ai-models-inference/json)
