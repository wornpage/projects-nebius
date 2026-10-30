# Wornpage Projects — Nebius edition

Turn a task requirement into a tool you can inspect and keep. Work selects the task; Task keeps its **Brief**, **Tool**, **Review**, evidence and human completion decision together.

## Try the app

Start in **Work**, then open a **Task** for Brief, Tool and Review.

- [Hosted demo](https://nebius.projectsdemo.org/work) — Cloudflare Access sign-in is required. Judge access instructions belong in the submission, not this repository.
- [Watch the 2:56 workflow demo](https://www.youtube.com/watch?v=Vzg4or-2-Xg).
- Run locally without credentials using the instructions below.

[Demo access](docs/demo-access.md) explains the available paths. The hosted app is configured separately from this source; fresh generation is currently disabled there. Recorded examples remain usable without a new model or Sandbox call.

## Run without credentials

Use **Node.js 24.18.0** (the `.node-version` pin) and its bundled npm. From this source directory:

```sh
node --version
npm --version
npm ci --ignore-scripts
npm --prefix svelte-frontend ci --ignore-scripts
npm run build
npm run preview
```

Open the loopback address printed by the preview server. Installation requires public npm/GitHub package access. The preview binds only to loopback, loads no provider credentials, disables its provider API routes and rejects server-side fetch. It is not an operating-system network sandbox. Default AI and execution remain disabled. No provider or paid call is needed to use the bundled examples; no Cloudflare account, private Projects service or saved workspace is required. Stop the preview before rebuilding on Windows.

## Prepare social metadata for release

Once a public host is chosen, set `NEBIUS_PUBLIC_ORIGIN` to its HTTPS origin
and run `npm run build:release`. For example, in PowerShell 7:

```powershell
$env:NEBIUS_PUBLIC_ORIGIN = "https://your-public-host.example"
npm run build:release
npm run test:static
Remove-Item Env:NEBIUS_PUBLIC_ORIGIN
```

Replace the example with the real host before a release. The release build
requires an origin without credentials, a path, query or fragment, and writes
an absolute image URL into the generated Open Graph and Twitter metadata. A
normal `npm run build` without the setting keeps the local relative image path.
Keep the setting present while running `npm run test:static` against the release
artifact; a later normal build without it restores the local relative path.
Building does not publish the app or enable paid services. After an authorized
release, check that both the page metadata and the image are reachable by social
crawlers without a sign-in; a private host cannot provide a public preview.

## Try Recovery Simulator

Choose **Work → Try recovery simulator**, or open `/recovery-rehearsal`. Compare a fixed five-task plan against a target finish using no action, expedited delivery, assembly help, or both.

| Default example | Modeled finish | Days saved against delayed plan |
| --- | ---: | ---: |
| Original plan | Day 7 | — |
| Two-day delay; no action | Day 9 | 0 |
| Expedite delivery | Day 7 | 2 |
| Assembly help | Day 8 | 1 |
| Both changes | Day 6 | 3 |

A calculated suggestion appears before you choose it. In the preparation example, faster delivery saves nothing; assembly help reaches Day 9 against a Day 8 target, leaving one day late visible. All durations are planning assumptions; cost, calendars and shared resources are outside this model.

The canonical bundled source is [examples/nebius-recovery-simulator.json](examples/nebius-recovery-simulator.json). Preview and download use `/api/nebius/examples/recovery-simulator` and its `/download` path. See [the simulator guide](docs/recovery-simulator.md).

## Work and evidence

The **Appearance** menu offers Neutral and Original green palettes, each with System, Light and Dark appearance. The choice is saved in this browser and shared between the landing page and app; it does not change workspace data. App selections use labels and underlines as well as color. Embedded tools retain their own design.

For a single task, choose **Work → Add work**. Enter a title; optionally add notes, a source link and a project. **Save draft** saves the fields together without calling AI. The confirmation offers **Open task** and **Undo**. Undo removes only the unchanged new task; if it has been edited or referenced, the app keeps it. Undo is available while that creation confirmation remains open.

The form uses visible labels and linked errors, keeps entered values when saving fails, and is also available from the command palette. Paste relevant text into Notes; a source link records the reference without fetching its contents. A bookmarklet is not included in this version.

Choose **Work → New project → Workshop example**, edit the authored draft, then **Review plan → Create project**. Work shows one primary task action above its filters; project totals stay available under **Details**. Open a task to inspect its brief, try a tool and retain evidence. Saving evidence and marking the task done are separate decisions. Use **Work menu → Workspace backup → Prepare backup / Import backup** to transfer browser work; backups may contain private saved results and run access keys.

The credential-free preview serves bundled examples; it does not include interactive replay of saved execution runs. See the [review checklist](docs/private-review-checklist.md) for verification and evidence boundaries.

## How Nebius fits the Wornpage UI

| Step | Responsibility |
| --- | --- |
| Describe and approve | Wornpage owns Work, Task, the editable brief, input/output requirements and build approval. |
| Generate | After approval, Wornpage's server sends selected task fields and declared requirements to NVIDIA Nemotron through Nebius Token Factory. The current build request sends no additional workspace context. |
| Check | Nemotron returns `index.html`, DOM-free `app.js` and `checks.cjs`. Wornpage validates the source, supplies its runtime bridge and can request a bounded repair. Nebius Sandbox runs the Node checks. |
| Try and keep | Wornpage renders the result in an isolated preview using its base palette and supported controls. Subsequent tool inputs execute locally in the browser. Source, usage and evidence remain available for review. |
| Decide | A person saves evidence and decides whether the task is complete. The surrounding Wornpage Svelte interface remains app-owned. |

The retained Nemotron checker and bundled Recovery Simulator have separate provenance. The bundled simulator includes assistant-authored changes after its earlier model attempt failed before Sandbox. In a later, separate recovery run, model-authored Sandbox checks passed, but independent testing found an incorrect recommendation and a missing availability caveat. That result does not qualify the bundled simulator. The saved checker has its own successful historical Sandbox result. Earlier recordings and checks are evidence for the specific artifacts they show; they do not automatically qualify changed source. See [evidence and review](docs/current-private-review.md), [recovery provenance](docs/repaired-recovery-provenance.md) and [readiness](NEBIUS_READINESS.md) for the remaining checks.

Source retains the [MIT License](LICENSE); see [LICENSING.md](LICENSING.md). A deployment owner must separately review source and dependency ownership, sensitive information, judge access and provider configuration before release.
