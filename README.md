# Wornpage Projects — Nebius edition

A project copilot for turning a goal into tasks, choosing the next step,
recording evidence and adapting a plan when circumstances change.
NVIDIA models through Nebius Token Factory propose plans, task changes and
evidence assessments. The task execution milestone adds a bounded browser-tool
build, sandbox checks and result review. You authorize a run's selected task
and limits; accepting the result remains a separate action.

**[Open the hosted demo](https://projects-nebius.ayivx-do-lmf-982.workers.dev/)**

**Development status:** a public submission candidate with local build and
source-review evidence. Live model evaluation and Sandbox execution are still
pending. The private Projects application is not needed to run it.
[wornpage/projects-nebius](https://github.com/wornpage/projects-nebius) contains
the standalone MIT-licensed source; the earlier WebMCP entry remains separate.

## Run without credentials

Requires **Node.js 24 with npm** and network access for the locked dependency
installs. `.node-version` records the original 24.18.0 baseline. From the
repository root:

```sh
npm ci --ignore-scripts
npm --prefix svelte-frontend ci --ignore-scripts
npm run dev:nebius
```

Open [http://127.0.0.1:8787/](http://127.0.0.1:8787/) and choose **Start with a
project**. A normal browser is sufficient; no WebMCP extension, private Projects
service, Cloudflare account or provider key is needed for the manual workflow.
The checked-in configuration disables inference. “Nebius is unavailable” is
expected until you configure it; it does not prevent manual work.

The two installs are both required. `dev:nebius` builds and serves the Nebius
edition; `npm run build` builds the preserved WebMCP edition. Stop a running
preview before rebuilding on Windows.

## Try the project journey

1. In **Work**, choose **New project → Workshop example**. The example is
   human-written, editable and unsaved.
2. Edit the plan, then choose **Review plan → Approve and create project**.
3. Open a task’s **Next step**. Edit its next step or blocker and review the
   changes before applying them.
4. Open the **Evidence** tab to see the saved criteria and record what
   happened. **Save evidence** and **Mark done** are separate actions.
5. Return to **Work → Update project** when plans change. Review revisions
   before saving; the approved explanation is retained in task activity.

Work stays in this browser. Use **Guide → Backup and restore** to keep a copy
or move it to another browser. Completing a prerequisite releases its dependency;
an independent blocker remains until a person resolves it.

## Enable real Nebius inference

Follow [NEBIUS.md](NEBIUS.md#setup-and-verification) to set an ignored local
`.dev.vars` file with a Token Factory key, allowed origin and exact NVIDIA model
IDs. Routine next-step guidance and planning/review use separately configured
model roles. The UI shows the configured model and request limits before sending.

The four advisory operations are project planning, next-step suggestions,
evidence review and project replanning. They never save task changes automatically.
The [live evaluation plan](NEBIUS_DEMO_SCRIPT.md) records what still needs real
model observations; synthetic test responses are not model-quality evidence.

## Run a task and review its tool

Open an active, unblocked task's **Next step → Build tool → Run this task**. The
first execution milestone produces a small browser tool, runs agent-authored
checks in a Token Factory Sandbox, and allows one repair. Open **Review** to
inspect the tool, its source and observed check output, then explicitly save
run evidence. A successful run does not mark the task done.

Execution has separate sandbox credentials and limits, and stays disabled by
default. [Execution setup and boundaries](NEBIUS_EXECUTION.md) describes the
contract, image requirements, cancellation and seven-day server retention.
Live model/sandbox behavior remains unverified. Workspace backups include run
access keys and any saved results; treat them as private workspace data.

## Verify locally

Without a browser or provider credentials:

```sh
npm run verify:nebius
```

This checks source paths, tests, Svelte types, the frontend build, a Worker
bundle dry run and local runtime routing with inference disabled. It does not
deploy. [NEBIUS_READINESS.md](NEBIUS_READINESS.md) records the evidence and limits.

The optional browser suites need a Chromium-based browser. `playwright-core`
does not install one. Set `CHROME_EXECUTABLE_PATH` to an existing compatible
executable; for example, in PowerShell 7:

```powershell
$env:CHROME_EXECUTABLE_PATH = "C:/path/to/chrome.exe"
npm run test:nebius:projects
npm run test:nebius:browser
npm run test:nebius:offline
```

These suites use isolated test workspaces and synthetic responses. Run them
after `verify:nebius`, which creates the required Nebius build.

## Source and prior work

- [MIT license](LICENSE) and [third-party licenses](THIRD_PARTY_LICENSES.txt).
- [Nebius contribution and prior-work boundary](NEBIUS_PROVENANCE.md).
- [Track direction and model strategy](NEBIUS_TRACK_DESIGN.md).
- [Setup, architecture and limits](NEBIUS.md).
- [Demo script and live evaluation cases](NEBIUS_DEMO_SCRIPT.md).
- [Preserved WebMCP documentation](WEBMCP_BASELINE.md), including its historical
  public URL and baseline verification commands.

The earlier public WebMCP repository and deployment remain frozen. This edition
uses its own frontend and narrow inference Worker; it does not include or
require the private Projects backend, authentication or billing services.
