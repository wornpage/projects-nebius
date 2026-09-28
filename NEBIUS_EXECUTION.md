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

RunInput has exactly version, packId, pack (the existing five-field task
projection), currentStatus, context (zero to three selected notes/sources),
requestedModel and consent. Only draft/active tasks with completion criteria
can start. The browser additionally refuses archived, blocked, dependent,
dirty or pending-approval tasks. The server owns the submitted snapshot, not
the browser workspace. Saved input is sent to the model; files and check
output are also sent for the single repair when needed.

RunRecord has id, version, packId, pack, currentStatus, context, requestedModel,
status, attempt, createdAt, updatedAt, events, files, checks, usage and error.
Statuses: queued, generating, checking, repairing, cancelling, ready, failed,
cancelled, uncertain. Files are exactly index.html, app.js and checks.cjs;
an unfinished run may have none. app.js contains DOM-free business logic with
a CommonJS export for checks.cjs and a worker message handler. index.html is
an inert UI template with its own styles. No packages, remote resources or
user-supplied commands.

Checks record the observed provider operation ID, resulting checkpoint ID if
available, exit code, bounded stdout/stderr, attempt and source digest. These
are agent-authored checks, not independent acceptance or a guarantee that all
requirements are met. The fixed server harness writes the selected files as
data, checks JavaScript syntax, then runs checks.cjs. Generated code executes
only inside the remote sandbox or a dedicated worker in the explicitly opened
isolated preview. A ready result's source digest must match the checked files.

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

Worker input is `{type:'init'|'event', event, id, values}`. Controls need unique
IDs. Replies are `{patches:[{id,text?,value?,disabled?,hidden?,options?}]}`;
options contain value/label pairs. These small tools use in-memory state and
restart when the preview is reopened. Node checks cover generated logic;
browser interactions and suitability still need live observation.

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

Two model calls for a release-packet checker stopped before Sandbox execution.
The second returned files rejected by the isolation validator. No generated
tool, successful generated checks or interactive result is claimed. Failure
messages are now preserved and displayed, and future validation failures
identify the page, worker or check-file requirement without relaxing it.

The original five-call and one-run limits were restored after those attempts.
The owner subsequently raised the hosted allowance to 20 model calls and
3 task runs per UTC day. Existing daily counts were retained; per-run limits
remain two model calls, 8,000 output tokens per call, and two 30-second Sandbox
executions. See [current runtime evidence](NEBIUS_READINESS.md#current-runtime-status--september-28-2026).

Projects Acceptance is reconnected and the runtime and product reviews are
recorded. Its separate Jev preview returned `inference_not_authorized`, so no
new automated assessment ran. Independent review recommendations do not supply
the GitHub evidence required for formal handoff acceptance.
