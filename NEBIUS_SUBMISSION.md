# Devpost submission

## Repository status correction — September 28, 2026

`wornpage/projects-nebius` is temporarily **private** during submission
preparation and retains its original [MIT License](LICENSE). A public MIT
release is planned for submission week after separate owner authorization.
The entry observation below is dated history. This file is the updated local
submission draft; it has not been saved to Devpost. The hosted app is paused
and the repository is private. See [LICENSING.md](LICENSING.md).

## Entry

**Project:** Wornpage Projects — Nebius edition

**Tagline:** From next step to working tool.

**Primary track:** Best Apps and Agents

**Additional track candidate:** Coding and Agentic Engineering. A generated
checker now has successful Sandbox and local browser evidence; final track
selection and the judging demonstration remain to be confirmed.

Devpost displayed **Project submitted!** on September 28, 2026 for
[Wornpage Projects — Nebius edition](https://devpost.com/software/wornpage-projects-nebius-edition).
The entry links the hosted demo and public GitHub source and remains editable
until the submission deadline. Submission status does not establish technical
readiness or judging eligibility.

## Inspiration

A plan is useful only if it leads to work someone can act on. Wornpage Projects
keeps a project's brief, tasks, dependencies and evidence together, then brings
AI assistance into that same workflow. The Nebius edition extends the idea
from deciding the next step to building a small tool for it.

## What it does

Turn a brief into an editable project plan, ask for a useful next step, adapt
tasks when circumstances change, and review evidence against completion
criteria. Proposed changes remain drafts until a person approves them.

The implemented Sandbox workflow takes a selected task and its requirements,
generates a small browser tool, runs model-authored checks, and allows one repair.
The result returns to the workspace for an isolated preview, source inspection
and evidence review. A run never marks the task done or publishes its output.

**Current evidence boundary:** Two hosted Nano suggestions were observed on
September 28, including a changed proposal after a hypothetical release update;
both stayed unsaved. On October 1, Nemotron Super produced a release-packet
checker. The first Sandbox check identified missing change-event test coverage; one
repair passed with 14 assertions, 6/6 control events and 2/2 post-output edits.
The run used two model calls and reported 6,700 input / 9,083 output tokens in
total. Its unchanged retained files passed 24 independent packet cases at two
screen widths and were exercised through Review in the local app.

This is one observed working tool. Its saved input declares text, so historical
declared JSON-loader coverage remains 0/2. Broader generation quality, actual
screen-reader speech, the final video and restored public judge access remain
open. See [current evidence](NEBIUS_READINESS.md#current-runtime-status--october-2-2026)
for source, usage, checks and historical failures.

## How we built it

The app uses Svelte 5, public Wornpage components and browser-local project
storage. A separate Cloudflare Worker serves the app and calls NVIDIA Nemotron
models through Nebius Token Factory. Nano is configured for routine next-step
guidance; Super is configured for planning, evidence review and tool generation.
Provider credentials remain on the server.

Task execution uses persistent run records, fixed inputs, bounded model output,
up to two 30-second Sandbox executions and one repair. The generated preview
isolates code from the workspace. People retain control of proposal approval,
evidence saving and task completion.

## Significant updates during the challenge

The earlier WebMCP edition supplied the browser workspace, public UI components
and approval pattern. This edition adds the Token Factory server integration,
project planning and revision proposals, task guidance, evidence review, usage
controls, and the Sandbox tool-building workflow. The frozen WebMCP challenge
repository and deployment are separate. No private Projects backend was ported.

## Nebius feedback draft

The Token Factory model catalog made the Nano/Super split clear, and the API key
successfully authenticated the model-list request. The Sandbox browser tutorial
is a useful introduction but its responses are simulated. Agent API access
required a beta request; API access is now confirmed. The existing Token Factory
key also authenticates Sandbox requests for the selected project. Importing an
official Node 24 image and running a network-disabled diagnostic succeeded.
Our early tool-generation attempts produced incomplete or incompatible source.
The app now requests native named source blocks, supplies the Worker bridge,
validates source before execution and retains rejected responses and usage.
The successful Super run used standard reasoning. Its first Sandbox check
identified the missing change-event test coverage, giving the one repair a concrete
target; the repaired tool passed that check and independent local packet cases.
We still need broader evaluation before claiming reliable generation across
tasks. The saved input-format mismatch is visible during review.

## Assets to finish

- Local application: http://127.0.0.1:8787/. The previous hosted address,
  https://projects-nebius.ayivx-do-lmf-982.workers.dev/, is paused; release-day
  judge access must be restored and checked after owner authorization.
- Submission repository: https://github.com/wornpage/projects-nebius, currently
  private with MIT license and setup; authorized public release is pending.
- Final Nebius demonstration video: still outstanding; keep it under three
  minutes. The latest local 87-second guidance cut includes a real request and
  a changed, unsaved proposal. It predates Sandbox enablement and does not show
  a successful generated tool. The older video remains on Devpost.
- Live inference: two successful hosted Nano suggestions and one repaired
  Super-generated checker are recorded. Broader model evaluation remains open.
- Devpost: [submitted entry](https://devpost.com/software/wornpage-projects-nebius-edition),
  confirmed by the submission-success message on September 28, 2026.

## Video outline for the available demo

Use the retained successful checker for a new local rehearsal, clearly labeled
as a saved October 1 run. The existing 87-second guidance cut and its narration
remain historical evidence. A fresh generation for a future recording needs its
own bounded run authorization; replaying the saved tool makes no provider call.

1. Show the release-packet checker task and its two synthetic examples with
   distinct expected results.
2. Open the saved run in Review. Show the actual model, two calls and token
   totals, then the failed first Sandbox check and successful repaired check.
3. Try the tool: incomplete input shows three gaps; corrected input shows zero
   gaps; editing clears the previous result; malformed JSON shows an input error.
4. Show the retained files and input declaration, then the separate human
   evidence-saving and completion controls. Keep the task open during rehearsal.
5. Close with the edition's source and setup. In the final cut, use the actual
   public repository and working judge URL after their release gates pass.

Timing and straight-paragraph narration for this saved-run rehearsal are in
[NEBIUS_DEMO_SCRIPT.md](NEBIUS_DEMO_SCRIPT.md#retained-checker-rehearsal-target-245).

## Rules checked

[Official rules](https://nebiusglobalaihackathon.devpost.com/rules), checked
September 28, 2026: working demo/test build, public licensed source with setup,
English description, track selection, Nebius/NVIDIA feedback, significant-update
explanation and a public YouTube video under three minutes. Submission deadline:
October 30, 2026, 10:00 a.m. Pacific. Final entry submission accepts the official
rules as a contract; obtain the owner's action-time confirmation at that step.
