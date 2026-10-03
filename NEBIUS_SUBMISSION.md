# Devpost submission

## Current local draft — October 3, 2026

`wornpage/projects-nebius` is temporarily **private** during submission
preparation and retains its original [MIT License](LICENSE). Public source and
judge access await separate owner release authorization.
The entry observation below is dated history. This file is the updated local
submission draft; it has not been saved to Devpost. The hosted app is disabled
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
That dated entry observation linked the hosted demo and GitHub source. Those
addresses currently have no public app/source access. The local draft below
does not update the entry or establish technical readiness or judging eligibility.

## Inspiration

A plan is useful only if it leads to work someone can act on. Wornpage Projects
keeps a project's brief, tasks, dependencies and evidence together, then brings
AI assistance into that same workflow. The Nebius edition extends the idea
from deciding the next step to building a small tool for it.

## What it does

Turn a selected task into a small browser tool you can try. Review its
requirements and execution limits, then explicitly authorize the build.
The implemented Sandbox workflow takes that task and its requirements,
generates a small browser tool, runs model-authored checks, and allows one repair.
The result returns to the workspace for an isolated preview, source inspection
and evidence review. A run never marks the task done or publishes its output.

The project workspace keeps the brief, tasks, dependencies and evidence around
the result. Planning, next-step suggestions, revisions and evidence assessments
remain editable drafts until a person approves them.

**Current observed result:** October 2 Nemotron Super run `2947cffc` produced a
JSON release-packet checker. The first Sandbox check caught contradictory
expected error wording; one repair passed with 28 authored assertions, 6/6
control events, 2/2 declared JSON example loaders and 2/2 post-output edits.
Its two model calls reported 7,815 input and 7,425 output tokens. The unchanged
generated files then passed 24 independent packet cases at two widths (48/48)
and 66/66 total local renderer observations. October 3's actual local scripted
replay showed three gaps, zero gaps, an edit clearing the old result and an
invalid-JSON error. Zero gaps concerns the supplied text; it does not validate
external evidence or approve a release.

This establishes one working result, not general generation reliability or a
fresh reproduction. Human listening/comprehension, broader model quality,
actual screen-reader speech and restored public judge access remain open.
See [current evidence](NEBIUS_READINESS.md#local-checkpoint--october-3-2026).

**Historical results:** Two hosted Nano suggestions on September 28 stayed
unsaved. The separate October 1 Super checker used 6,700 input / 9,083 output
tokens, passed after repair with 14 authored assertions and declared text input.
Its original JSON-loader denominator remains 0/2. That older result is the
captioned video published October 2; it does not demonstrate the newer JSON run.

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
The October 1 Super run used standard reasoning; its first Sandbox check
identified missing change-event coverage. The October 2 JSON run's first check
instead caught inconsistent expected input-error wording. Its repair passed
28 authored assertions and both JSON loaders; independent local packet cases
then checked the unchanged generated source.
We still need broader evaluation before claiming reliable generation across
tasks. The older input-format mismatch remains historical evidence; the current
JSON run matches the task's declared input format.

## Assets to finish

- Local application: http://127.0.0.1:8787/. The previous hosted address,
  https://projects-nebius.ayivx-do-lmf-982.workers.dev/, is disabled; release-day
  judge access must be restored and checked after owner authorization.
- Submission repository: https://github.com/wornpage/projects-nebius, currently
  private with MIT license and setup; authorized public release is pending.
- Final Nebius demonstration video: the newest local draft is the 95.5-second
  October 3 scripted/narrated JSON-checker replay. It awaits human listening,
  comprehension and publication. The public captioned video published October 2
  shows the older October 1 checker; the 87-second guidance cut remains history.
- Live inference: two historical hosted Nano suggestions and the dated Super
  checker runs are retained. Fresh reproduction and broader evaluation remain open.
- Devpost: [submitted entry](https://devpost.com/software/wornpage-projects-nebius-edition),
  confirmed by the submission-success message on September 28, 2026.

## Video outline for the available demo

Use saved October 2 JSON run `2947cffc`, as replayed by the committed script
on October 3. The older October 1 checker video and 87-second guidance cut
remain historical evidence. A fresh generation for a future recording needs
its own bounded authorization; replaying the saved tool makes no provider call.

1. Show the release-packet checker task and its two synthetic examples with
   distinct expected results.
2. Open the saved run in Review. Show the actual model, two calls and token
   totals, then the failed first Sandbox check and successful repaired check.
3. Try the tool: incomplete input shows three gaps; corrected input shows zero
   gaps; editing clears the previous result; malformed JSON shows an input error.
4. Show the retained files, declared JSON input and 2/2 observed loaders, then the separate human
   evidence-saving and completion controls. Keep the task open during rehearsal.
5. Close with the edition's source and setup. In the final cut, use the actual
   public repository and working judge URL after their release gates pass.

Timing and straight-paragraph narration for this saved-run rehearsal are in
[NEBIUS_DEMO_SCRIPT.md](NEBIUS_DEMO_SCRIPT.md#verified-scripted-local-take--october-3-2026).
The [human review sheet](NEBIUS_DEMO_SCRIPT.md#human-review-of-the-narrated-draft)
identifies the exact private media and records listening and viewer
comprehension before the final video is selected. Its observations are pending.

## Rules checked

[Official rules](https://nebiusglobalaihackathon.devpost.com/rules), checked
September 28, 2026: working demo/test build, public licensed source with setup,
English description, track selection, Nebius/NVIDIA feedback, significant-update
explanation and a public YouTube video under three minutes. Submission deadline:
October 30, 2026, 10:00 a.m. Pacific. Final entry submission accepts the official
rules as a contract; obtain the owner's action-time confirmation at that step.
