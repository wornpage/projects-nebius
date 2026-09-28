# Devpost submission

## Entry

**Project:** Wornpage Projects — Nebius edition

**Tagline:** From next step to working tool.

**Primary track:** Best Apps and Agents

**Additional track to consider after live Sandbox execution:** Coding and Agentic Engineering

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
September 28, including a changed proposal after a hypothetical release update.
Both stayed unsaved. Sandbox API access is enabled, and a real isolated Node 24
diagnostic succeeded with networking off. Four tool-generation attempts stopped
before executing generated code. The latest identified a missing style block;
its saved record retains `page_style_missing` and 894 input / 921 output tokens.
The source correction removes that cosmetic rejection and makes styling
presentation guidance. The correction is deployed; a fresh generated-tool result
remains pending.
The first complete generated tool and interactive preview remain outstanding.
See NEBIUS_READINESS.md for the retained outcomes.

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
Tool generation needs further work: model files can fail the app's worker/page/
check contract even when structured JSON is returned. The app now retains the
failure stage and reported usage; the latest call exposed our unnecessary
mandatory-style-block check, which this reviewed source correction removes.
Qualifying generated files against the remaining contract remains the
next step toward a complete tool-building demonstration.

## Assets to finish

- Hosted application: https://projects-nebius.ayivx-do-lmf-982.workers.dev/
- Public repository: https://github.com/wornpage/projects-nebius, published with
  fresh history, MIT license and setup; private fork visibility is retained.
- Final Nebius demonstration video: still outstanding; keep it under three
  minutes. The latest local 87-second guidance cut includes a real request and
  a changed, unsaved proposal. It predates Sandbox enablement and does not show
  a successful generated tool. The older video remains on Devpost.
- Live routine inference: two successful hosted suggestions recorded. A Node
  Sandbox diagnostic succeeded; the complete generated-tool result and broader
  model evaluation remain outstanding.
- Devpost: [submitted entry](https://devpost.com/software/wornpage-projects-nebius-edition),
  confirmed by the submission-success message on September 28, 2026.

## Video outline for the available demo

Target roughly 80–100 seconds. The latest local 87-second cut shows real
guidance and changed task fields. Keep its original receipt and narration as
historical evidence; use updated narration for the next take.

1. Show a release task waiting for a health check.
2. Enter an explicitly hypothetical demo update: health passed, rollback steps
   recorded, reviewer approval pending.
3. Show selected inputs, make a real Token Factory request, and review the
   actual changed fields. Record this when the daily allowance permits a call;
   do not substitute a scripted proposal or force a change for the camera.
4. Open Build tool and preview the task and run limits. Sandbox API access and
   the Node diagnostic are confirmed. The first tool-building attempts failed
   before generated-code execution; do not present the example as a working
   generated artifact. Record checks or a repair only when they actually occur.
5. Close on the human decision and public repository. Record real Sandbox
   output and revise this section after a successful end-to-end run.

## Rules checked

[Official rules](https://nebiusglobalaihackathon.devpost.com/rules), checked
September 28, 2026: working demo/test build, public licensed source with setup,
English description, track selection, Nebius/NVIDIA feedback, significant-update
explanation and a public YouTube video under three minutes. Submission deadline:
October 30, 2026, 10:00 a.m. Pacific. Final entry submission accepts the official
rules as a contract; obtain the owner's action-time confirmation at that step.
