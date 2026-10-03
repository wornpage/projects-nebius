# Wornpage Projects — Nebius edition

This standalone edition retains its original [MIT License](LICENSE).
See [LICENSING.md](LICENSING.md) for source, hosting and provider-access
boundaries and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependencies.

Turn a task into a small browser tool with NVIDIA Nemotron through Nebius Token
Factory. Review the task and limits, authorize a bounded build with Sandbox
checks, then try the generated result in an isolated preview. Source, failed
checks and usage stay available; evidence saving and completion are separate
human decisions.

The project workspace keeps the brief, tasks, dependencies and evidence around
that result. Nebius also proposes plans, next steps and evidence assessments;
these remain drafts until a person approves them.

**Current access — October 3, 2026:** the repository is private and the hosted
Cloudflare site is disabled during local development. Public judge access
will need to be restored before submission review.

Run the app locally at [http://127.0.0.1:8787/](http://127.0.0.1:8787/).
The setup below needs no provider credentials. Enabling real Nebius features
is a separate configuration and spending decision.

The [earlier manual preview](https://projects-nebius.ayivx-do-lmf-982.workers.dev/)
is currently unavailable. That release supported manual project work with AI
guidance and Sandbox execution disabled; it did not expose private retained runs.

**Development status:** A real Nemotron Super run produced a release-packet
checker, repaired a failed Sandbox check, and passed the next check. Its retained
tool passed 24 independent packet cases at two screen widths and was exercised
in the local app. This establishes one working result; broader model quality
and live AI access for judges remain open. See
[current evidence](NEBIUS_READINESS.md#local-checkpoint--october-3-2026).
The [published captioned demonstration](https://www.youtube.com/watch?v=ssBXmrdvHdE)
records the earlier October 1 checker. The October 2 JSON-checker result and its
2/2 declared JSON loaders are separate, newer evidence; the video does not
demonstrate that newer run.
The [October 3 scripted replay](NEBIUS_DEMO_SCRIPT.md#verified-scripted-local-take--october-3-2026)
of the JSON checker is the newest local narrated draft. It awaits human review
and publication; its private saved-run state and media are not included in a clone.
The private Projects application is not needed to run it.
[wornpage/projects-nebius](https://github.com/wornpage/projects-nebius) is the
MIT-licensed continuation; the earlier WebMCP entry remains separate.
Private workspace backups and server-run credentials are excluded from the
source release. Local storage is separate: use Guide's backup and restore
controls to move browser work. Local AI actions still call Nebius online and
use its normal account credits; starting the app does not initiate a model run.

## Run without credentials

Use the exact **Node.js version in `.node-version` (24.18.0)** with its bundled
npm. The package's `engines.node` range permits newer Node versions; the pin is
the reproducible setup target. Locked installs require public npm and GitHub
codeload access. From the repository root, confirm the versions before installing:

```sh
node --version
npm --version
npm ci --ignore-scripts
npm --prefix svelte-frontend ci --ignore-scripts
npm run dev:nebius
```

Open [http://127.0.0.1:8787/](http://127.0.0.1:8787/) and choose **Open workspace
→ New project**. A normal browser is sufficient; no WebMCP extension, private Projects
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

For a concrete starting point, choose **Work → New project → Release-packet
checker example**. Review and create its two-task plan, then open **Build the
release-packet checker**. Its saved requirements include two synthetic inputs:
an incomplete packet should show three gaps; the corrected packet should show
**0 gaps: Ready for human review**. The example is a human-written specification;
the generated files and observed results appear only after a real run.

Open an active, unblocked task's **Next step → Build tool → Run this task**. The
first execution milestone produces a small browser tool, runs agent-authored
checks in a Token Factory Sandbox, and allows one repair. Open **Review** to
inspect the tool, its source and observed check output, then explicitly save
run evidence. A successful run does not mark the task done.

Execution has a separate Sandbox credential binding and limits. The source
`demo` environment describes a live setup with public routing disabled. The
manual-preview deployment explicitly overrides both AI switches to false;
local defaults also keep them off. A Token Factory key with Sandbox
access can supply both credential bindings. [Execution setup and boundaries](NEBIUS_EXECUTION.md) describes the
contract, image requirements, cancellation and seven-day server retention.
The retained checker has successful Sandbox and local browser observations.
The configured demo allowance is 20 model calls and 3 task runs per UTC day;
failed attempts count. Workspace backups include run
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
npm run test:nebius:tool-preview
npm run test:nebius:projects
npm run test:nebius:browser
npm run test:nebius:offline
npm run test:nebius:portability
```

These suites use isolated test workspaces and synthetic responses. Run them
after `verify:nebius`, which creates the required Nebius build.
The tool-preview suite exercises the production renderer with an authored
checker and a synthetic parent run. Passing it does not establish the quality
of a Nebius-generated tool.

Earlier local Windows qualification used Node 24.18.0, its bundled npm 11.16.0
and Chromium 153.0.8010.12. The October 3 clean checkout of `ac0e049` passed with
Node 24.19.0, npm 11.17.0 and that Chromium version. The dated results retain
their separate source revisions and do not qualify other environments.
The GitHub workflow preserves the WebMCP `verify` and `test:browser` job and
defines a separate Nebius job on Ubuntu 24.04. That job uses `.node-version`,
both locked installs and its own hosted Chrome lookup, then runs
`verify:nebius` and all five browser suites above in order. It supplies no
provider credentials or deployment step. Local qualification, a prepared
workflow and an observed passing GitHub run remain separate results. Check
the [workflow history](https://github.com/wornpage/projects-nebius/actions)
for the exact revision being evaluated.

## Source and prior work

- [MIT license](LICENSE), [access and publication policy](LICENSING.md), and
  [third-party licenses](THIRD_PARTY_LICENSES.txt).
- [Nebius contribution and prior-work boundary](NEBIUS_PROVENANCE.md).
- [Track direction and model strategy](NEBIUS_TRACK_DESIGN.md).
- [Setup, architecture and limits](NEBIUS.md).
- [Demo script and live evaluation cases](NEBIUS_DEMO_SCRIPT.md).
- [Preserved WebMCP documentation](WEBMCP_BASELINE.md), including its historical
  public URL and baseline verification commands.

The earlier public WebMCP repository and deployment remain frozen. This edition
uses its own frontend and narrow inference Worker; it does not include or
require the private Projects backend, authentication or billing services.

## Licensing and source inventory

The original MIT license remains in force. Earlier public or private MIT grants
remain effective; dependencies retain their own licenses and notices.
Source publication does not grant access to provider credentials, private
workspace backups or saved-run keys.

The current source inventory contains 210/210 paths. The historical filename
`PUBLIC_SOURCE_MANIFEST.txt` describes an inventory, not permission to publish
private source. [WEBMCP_BASELINE.md](WEBMCP_BASELINE.md) records the corresponding
verification denominators and the earlier demo's documentation.
