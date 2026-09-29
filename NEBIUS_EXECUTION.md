# Task execution milestone

## Scope

Extend the existing task and Review journey with one browser tool per run. A
person authorizes the exact task preview and fixed run limits once. The agent
generates three files, executes its checks in a Nebius Token Factory Sandbox,
and may make one repair. A completed run waits for human review. It never marks
a task done, approves a release, publishes an app, or edits another task.

This is a new standalone implementation in the private Nebius edition. The
public WebMCP repository remains frozen; private Projects backend logic is not
an input. Live model/sandbox quality remains unverified until provider
execution is performed and its results are reviewed.

## Release-packet checker example

In **Work → New project**, choose **Release-packet checker example**, review the
editable plan, and approve its creation. Open the first task's **Build tool**
section to inspect the exact saved requirements and configured limits.

The first task carries the examples in its completion criteria, so they are
included in the five task fields sent to Nebius. The second task records the
human review of the actual output. Both begin as proposed work.

| Synthetic input | Expected result |
| --- | --- |
| `{"candidate":"demo-42","health":"missing","review":"pending","rollback":""}` | 3 gaps: Health must be passing; Review must be approved; Rollback step is required |
| `{"candidate":"demo-42","health":"passing","review":"approved","rollback":"Restore demo-41"}` | 0 gaps: Ready for human review |

The proposed tool accepts a JSON object with exactly these four string fields.
Malformed input shows an error. It should provide buttons to load either
example, a JSON editor and a Check packet button, all keyboard accessible.
Readiness is based only on supplied text; the tool does not probe a live service
or approve a release.

Retain the generated files, observed Sandbox output and actual preview results
when a live run is performed. These expected outcomes are not a record of a
successful generated tool. Existing daily and per-run limits still apply.

## Shared boundary

The source of limits and validation is `nebius-execution-contract.mjs`.

- GET `/api/nebius/runs/config`: availability, version, requestedModel, limits.
- POST `/api/nebius/runs/{id}`: start the exact RunInput. The browser creates a
  UUID and a 32-byte random hex access key before sending. Send the key only in
  `Authorization: Bearer <key>`, never a URL. Identical replay observes the
  existing run; different input or key conflicts. Starting requires the
  configured same origin, JSON, explicit consent and admission limits.
- GET `/api/nebius/runs/{id}`: authenticated read, no inference or execution.
- DELETE `/api/nebius/runs/{id}`: authenticated cancellation request. Report
  cancellation as pending until the provider confirms; lost responses stay
  uncertain. Never silently repeat a potentially paid operation.
- POST `/api/nebius/runs/{id}/preview`: an explicit same-origin form POST with
  exactly one `key` field authenticates the saved ready result. It opens a
  named sandboxed iframe; the key never appears in a URL. The response owns
  its CSP and can also be downloaded as a complete tool.
- Successful start/read/cancel returns `{ run: RunRecord }` with no access key.
  Errors use `{ code, error }`; responses are private/no-store.

JSON run requests, including configuration, send
`X-Nebius-Run-Format: run-diagnostics.v1`. The shared browser client owns this
header. An older or missing format is rejected with a clear page-reload message
before request admission. This keeps an already-open page from starting a run
whose diagnostic fields its old parser cannot read. The HTML preview form
still submits only its run key.

RunInput has exactly version, packId, pack (the existing five-field task
projection), currentStatus, context (zero to three selected notes/sources),
requestedModel and consent. Only draft/active tasks with completion criteria
can start. The browser additionally refuses archived, blocked, dependent,
dirty or pending-approval tasks. The server owns the submitted snapshot, not
the browser workspace. Saved input is sent to the model; files and check
output are also sent for the single repair when needed.

RunRecord has id, version, packId, pack, currentStatus, context, requestedModel,
status, attempt, createdAt, updatedAt, events, files, checks, usage and error.
The record also includes `failure: {code, stage} | null`. Its readable `error`
message stays separate. Provider bodies and rejected generated files are not
stored in diagnostics. Usage includes `totalsComplete`: false means token
counts are recorded subtotals or unknown, not complete billing totals. A repair
keeps previously recorded usage while its new response is pending. Valid
provider usage is retained on output rejection and before preview validation.
Cancellation also retains usage observed before it completes.

Statuses: queued, generating, checking, repairing, cancelling, ready, failed,
cancelled, uncertain. Files are exactly index.html, app.js and checks.cjs;
an unfinished run may have none. app.js contains DOM-free business logic with
a CommonJS export for checks.cjs and a worker message handler. index.html is
an inert UI template with optional local styles. No packages, remote resources or
user-supplied commands.

The model supplies each file as a `path` and an array of physical source lines.
For app.js it defines top-level `validate` and `handleMessage` functions and
their helpers. The server joins those lines and appends one fixed runtime
bridge that checks both functions, handles Worker messages, verifies that a
reply is a patch array, and exports validate for Node checks. The model must
not define messaging or export plumbing. Its raw logic cannot reference the
reserved identifiers self, globalThis, onmessage, addEventListener,
postMessage, module or exports, including in comments or strings. These are
bounded source checks; they are not a JavaScript security parser.

Saved app.js is therefore generated logic plus the server bridge. Existing
per-file and total byte limits apply after the bridge is appended. Source
digests, Sandbox checks, downloads and preview all use those same materialized
files. Repair removes and verifies only that exact suffix before sending the
logic back to the model; a fresh suffix is appended to its replacement. Original
logic line numbers are preserved. The server never runs generated source while
decoding or materializing it. Missing required functions fail when the Sandbox
loads app.js and can use the existing single repair.

Checks record the observed provider operation ID, resulting checkpoint ID if
available, exit code, bounded stdout/stderr, attempt and source digest. These
are agent-authored checks, not independent acceptance or a guarantee that all
requirements are met. The fixed server harness writes the selected files as
data, checks JavaScript syntax, then runs checks.cjs. Generated code executes
only inside the remote sandbox or a dedicated worker in the explicitly opened
isolated preview. A ready result's source digest must match the checked files.

### Generated page rules

The provider owns the page rules in `PAGE_RULES`. Their instructions are included
in both generation and repair prompts; the same ordered rules validate each
response. The first matched rejection is retained at stage `tool_page`:

| Code | Rejected condition |
| --- | --- |
| `page_script_forbidden` | A script tag, including a reference to app.js |
| `page_resource_forbidden` | A quoted src/href outside fragment or data-image prefixes |
| `page_css_url_forbidden` | A url(...) expression anywhere in index.html |

These are bounded source checks, not an HTML/CSS security parser. The preview's
sanitizer, CSP and Worker isolation remain the execution boundary. Styling is
presentation advice: prefer a local style block for readable layout, while
semantic native controls remain valid without CSS. The removed
`page_style_missing` gate rejected a cosmetic omission before Sandbox; historical
receipts retain that code. Visual quality is assessed in the human preview.

Invalid output stops the run. Repair remains limited to an observed first
Sandbox check failure. Rejected source is not retained or silently rewritten,
and no new run is started automatically.

## Runtime and persistence

Use the existing Worker and a new per-run Durable Object, with alarms for
bounded background progress and a retention deadline. Persist intent before
each external side effect. On interruption without a known operation ID,
stop as uncertain rather than issue a second paid request. Poll known provider
operations through their fixed URL and keep cancellation available. The run
has at most two model calls, two 30-second sandbox executions, and a ten-minute
orchestration deadline. Each model call uses the existing daily inference
budget; starts also use a separate configured daily run count. These are
resource ceilings, not a dollar spending guarantee.

Sandbox endpoint: `https://api.tokenfactory.nebius.com/sandboxes/v1`.
Configure the Sandbox bearer-token binding, Nebius project ID and pre-imported
Node image UUID. Never put inference or sandbox credentials in the browser,
sandbox environment, generated files, logs or source. Sandbox networking is
disabled. Keep execution disabled by default.

The browser stores its run reference through the existing workspace owner.
Access keys are bearer capabilities for one run: they are not provider keys.
If included in a workspace backup, that backup grants access to its runs and
must be handled as private workspace data. Full run source/output is retained
server-side for seven days; the browser can save the current result for review.
Input changes make a saved result stale for acceptance. Human attachment of a
result must check the same task snapshot and must preserve existing evidence.

## Product surface

Next: Run this task, exact input/limits disclosure, live stage, Cancel,
then Review result. Review: isolated interactive preview, downloadable source,
observed check output, task criteria, and an explicit Save run evidence action.
Approval remains separate from task completion. Existing text review and task
editing continue through their owners. No inference occurs on page load.

The preview sanitizes the HTML template and permits only a fixed,
hash-authorized DOM bridge. Generated app.js runs in a Blob Web Worker, which
inherits the preview's CSP with network connections blocked. Its messages can
update only bounded text, field values, disabled/hidden state and select
options for existing element IDs. They cannot supply HTML, URLs, styles or
event handlers. The iframe has `sandbox="allow-scripts"` and no same-origin,
popup, navigation or form permission. Generated code has no DOM or browsing
context to navigate. It has no access to the parent workspace or run key.

Worker initialization sends `{type:'init', values}`; user events send
`{type:'event', event, id, values}`. Controls need unique
IDs. Replies are `{patches:[{id,text?,value?,disabled?,hidden?,options?}]}`;
options contain value/label pairs. These small tools use in-memory state and
restart when the preview is reopened. Node checks cover generated logic;
browser interactions and suitability still need live observation.

### Saved-record compatibility

Compatibility retained:
- Consumer: existing `browser-tool.v1` run records and exported workspace backups,
  including the two retained failed attempts from September 28.
- Owner: `validateRunRecord` and the existing Durable Object load path.
- Removal condition: retire v1 backup imports through an explicit migration
  after all retained v1 runs have expired or been migrated.
- Test coverage: no new tests added or run in this correction; source review
  uses the retained old records, which omit failure metadata and completeness.
- Why hard cutover is unsafe now: rejecting those records would hide the user's
  saved failures and break existing backups. Their missing diagnostics normalize
  to null and unknown counts remain unknown. New writes use the current shape.

The server has one active response shape. Cached older clients must reload
through the format gate; no older response serializer is retained.

## Enable execution locally

Keep all values in the ignored local `.dev.vars` file. In addition to the
existing inference settings and exact allowed origin, configure:

```dotenv
NEBIUS_EXECUTION_ENABLED="true"
NEBIUS_DAILY_RUN_LIMIT="1"
NEBIUS_SANDBOX_PROJECT_ID="<your Nebius project ID>"
NEBIUS_SANDBOX_NODE_IMAGE_UUID="<pre-imported image UUID with Node.js 24>"
NEBIUS_SANDBOX_IAM_TOKEN="<sandbox IAM bearer token>"
```

An existing Token Factory API key can be supplied as the Sandbox bearer token
when that key has Sandbox access for the selected project. Confirm access with
`GET /sandboxes/v1/whoami`; the runner needs `spawn`, `list` and `cancel`, and
image setup needs `import`. Keep the value in `.dev.vars` or a Worker secret.
No new key is required solely because the setting is named `IAM_TOKEN`.

The inference model uses `NEBIUS_MODEL_REASONING`. The fixed sandbox command
uses `/usr/local/bin/node`; the selected image must provide that executable
and a `/tmp` directory writable by UID/GID 1000. The trusted harness creates
its own unique directory before writing the three fixed filenames.
There is no automatic image import, credential exchange or fallback provider.
The default configuration keeps execution disabled; the hosted `demo`
environment enables it with its configured secret and pinned image. Availability
means the settings exist; it is not a successful live-provider observation.

Before a hosted demo, configure the added `NEBIUS_RUNS` and
`NEBIUS_RUN_BUDGET` Durable Object migrations through the existing Worker
configuration. The source change itself neither provisions nor deploys them.

## Official references

- [Sandbox overview](https://docs.tokenfactory.nebius.com/sandboxes/overview)
- [Spawn instance](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/instances/spawn-a-new-container-instance)
- [Operation status](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/get-an-operation-status)
- [Cancel operation](https://docs.tokenfactory.nebius.com/api-reference/sandboxes/operations/cancel-an-operation)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Web Worker CSP inheritance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy)

## Verification status

Sandbox access is enabled in the hosted demo. On September 28, a real isolated
Node 24 diagnostic returned exit code 0 with networking disabled, UID/GID 1000
and writable `/tmp`. It used operator-written diagnostic code, not model output.

The first four tool attempts stopped before Sandbox. The fourth exposed the
cosmetic `page_style_missing` gate, which was removed and deployed as Worker
`5ad767d5-d841-4e3c-991f-e9357f8b8c00`.

The fifth attempt returned three files and reached a real Sandbox syntax check.
Incomplete app.js source caused exit 1 before tool logic or assertions executed.
Its one repair was rejected for a missing worker message handler. That run
retains the first files, observed check and complete totals: two model calls,
3,284 input / 1,905 output tokens. Six model calls were used across the five
attempts; token counts for the first two remain unknown. No successful generated
tool or interactive result is claimed.

The generation instructions now include guarded worker/CommonJS scaffolding,
complete multiline files, JSON.stringify for embedded examples and value patches
for form inputs. The schema, validators and execution limits are unchanged.
An uncertain start or explicit resume schedules a saved-run read; a read failure
stops polling, and no read starts another run. Live validation of these source
changes is still pending. Source `be06c9973bef01b42726111f24771acf380704fb`
is deployed as Worker `fda3257b-4352-4c99-b60e-3165ddf9313c`, retaining the
normal 20-call/3-run daily limits.

The original five-call and one-run limits were restored after the first two attempts.
The owner subsequently raised the hosted allowance to 20 model calls and
3 task runs per UTC day. Existing daily counts were retained; per-run limits
remain two model calls, 8,000 output tokens per call, and two 30-second Sandbox
executions. See [current runtime evidence](NEBIUS_READINESS.md#current-runtime-status--september-28-2026).

Runtime and product reviews are recorded in Projects Acceptance as development
evidence. That review tooling is outside this app and is not a required service
for running or judging the submission. The app's model calls use Nebius Token
Factory; generated-code execution uses Nebius Sandbox.
