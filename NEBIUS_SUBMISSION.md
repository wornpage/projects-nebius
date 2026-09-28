# Devpost submission preparation

## Entry

**Project:** Wornpage Projects — Nebius edition

**Tagline:** From next step to working tool.

**Primary track:** Best Apps and Agents

**Additional track to consider after live Sandbox execution:** Coding and Agentic Engineering

The owner wants to establish the Devpost entry now and add the video later.
The public GitHub repository and hosted demo are being prepared first because
Devpost requires those project links.
This document is draft material, not evidence that Devpost has accepted a
submission. A saved draft and a submitted entry are different states.

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

**Current evidence boundary:** Live Sandbox execution is awaiting provider beta
access. Model authentication and available model IDs have been confirmed; a
successful end-to-end inference result has not yet been recorded. Do not label
an illustrative workflow or a simulated tutorial as a successful live run.

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
requires a separate beta request; that request has been submitted. Add feedback
on output quality, latency and Sandbox execution only after observing real runs.

## Assets to finish

- Hosted application: https://projects-nebius.ayivx-do-lmf-982.workers.dev/
- Public repository: https://github.com/wornpage/projects-nebius, published with
  fresh history, MIT license and setup; private fork visibility is retained.
- Public YouTube video: owner will provide later; keep it under three minutes.
- Successful live inference and Sandbox evidence: outstanding.
- Devpost: the signed-in account has not joined this hackathon. Registration is
  open at https://nebiusglobalaihackathon.devpost.com/register and awaits the
  owner's personal answers and eligibility/terms confirmation. No project entry
  has been created or submitted yet.

## Video outline for later

1. **0:00–0:20:** State the problem and show the project brief.
2. **0:20–0:55:** Generate a plan with Nebius, edit it, and approve the tasks.
3. **0:55–1:45:** Select a suitable task, show authorized inputs, and run the
   tool-building workflow. Record real Sandbox output once access is enabled.
4. **1:45–2:25:** Try the returned tool, inspect source and checks, then save
   evidence without confusing model checks with independent acceptance.
5. **2:25–2:50:** Show the public repository, explain the new Nebius contribution,
   and close with the human completion decision.

## Rules checked

[Official rules](https://nebiusglobalaihackathon.devpost.com/rules), checked
September 28, 2026: working demo/test build, public licensed source with setup,
English description, track selection, Nebius/NVIDIA feedback, significant-update
explanation and a public YouTube video under three minutes. Submission deadline:
October 30, 2026, 10:00 a.m. Pacific. Final entry submission accepts the official
rules as a contract; obtain the owner's action-time confirmation at that step.
