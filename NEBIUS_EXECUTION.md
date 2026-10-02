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
Unsupported health/review enum values are input errors, not release gaps.
The task specifies `Input error: ` followed by a useful reason for invalid
input, `1 gap: <reason>` for one gap and `<N> gaps: <reasons>` otherwise.
Reasons appear in Health, Review, Rollback order, separated by `; `.
Editing or loading another packet clears or replaces the previous result.
Readiness is based only on supplied text; the tool does not probe a live service
or approve a release.

Retain the generated files, observed Sandbox output and actual preview results
when a live run is performed. These expected outcomes are not a record of a
successful generated tool. Existing daily and per-run limits still apply.

Starter changes apply to future proposals. For an older saved task, review the
current starter requirements in the task editor and save them through the
normal human approval flow before authorizing a new build. Inspect its displayed
RunInput to confirm the exact task snapshot; older run criteria remain historical.
The independent test corpus stays outside generation input.

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

Nebius host pages use `Referrer-Policy: same-origin` so native preview form
POSTs retain their app Origin header. Cross-origin referrers are withheld. The
API still rejects null or foreign origins and requires the exact run key.
Generated preview responses retain their own `no-referrer` policy and opaque
sandbox. The WebMCP build retains its original host-page policy.

JSON run requests, including configuration, send
`X-Nebius-Run-Format: run-diagnostics.v3`. The shared browser client owns this
header. An older or missing format is rejected with `409:run_format_changed`
and a clear page-reload message before request admission. This code is excluded
from earlier cached clients' definitive start rejections: an earlier POST may
have succeeded even when its response was lost. Resuming a saved request never
clears its reference on a rejected POST; the browser observes that same run ID.
Only the separate owner-confirmed retirement path, after a fresh parsed
`404:not_found`, can retire an unresolved historical reference.
This keeps an already-open page from starting a run
whose diagnostic fields its old parser cannot read. The HTML preview form
still submits only its run key.

New RunInput uses `browser-tool.v2` and has exactly version, packId, pack (the existing five-field task
projection), currentStatus, context (zero to three selected notes/sources),
requestedModel, requiredInputFormats and consent. Only draft/active tasks with completion criteria
can start. The browser additionally refuses archived, blocked, dependent,
dirty or pending-approval tasks. The server owns the submitted snapshot, not
the browser workspace. Saved input is sent to the model; rejected final text
and its diagnostic, or validated files and check output, are also sent for the
single repair when needed.

New RunRecord has id, version, packId, pack, currentStatus, context, requestedModel, requiredInputFormats,
status, attempt, createdAt, updatedAt, events, files, checks, usage, generationAttempts and error.
The record also includes `failure: {code, stage} | null`. Its readable `error`
message stays separate. Identified final responses have a separate bounded
generation history; raw provider envelopes are not stored. Usage includes `totalsComplete`: false means token
counts are recorded subtotals or unknown, not complete billing totals. A repair
keeps previously recorded usage while its new response is pending. Valid
provider usage is retained on output rejection and before preview validation.
Cancellation also retains usage observed before it completes.

File-format rejection messages retain the specific safe parser reason: the
expected header's response line, a repeated or missing allowed file, an
unclosed/nested fence, a source-line limit, or the shared file-size rejection.
They keep `invalid_model_output` at `tool_files`. Diagnostics contain only
server-authored descriptions, allowed filenames and numeric positions; unknown
headers and rejected source are not echoed through the error message. Retained
final source is available only in the separate history; reasoning is excluded.
This does not reconstruct a reason discarded by an older run or establish that
a tool works.

Statuses: queued, generating, checking, repairing, cancelling, ready, failed,
cancelled, uncertain. Files are exactly index.html, app.js and checks.cjs;
an unfinished run may have none. app.js contains DOM-free business logic with
a CommonJS export for checks.cjs and a worker message handler. index.html is
an inert UI template with optional local styles. No packages, remote resources or
user-supplied commands.

Generation uses ordinary chat text output, without a JSON `response_format`.
The prompt demonstrates each exact opening fence with a matching closing fence,
with its language and filename on one line. It selects one output instruction:
initial generation and source-rejection repair return all three complete files;
Sandbox repair returns only complete replacements for changed files. It directs
the model to stop after the final closing fence. The former consecutive opening
fences and overlapping operation instructions have been removed. The parser
still rejects prose, bare/unknown headers, duplicate files and malformed fences.
Local tests establish prompt construction, not reliable live model compliance.
The model supplies three native source-code blocks labelled `html index.html`,
`javascript app.js`, and `javascript checks.cjs`. Each label follows three
backticks at the start of a line. Each block ends with three backticks on their
own line. The parser rejects prose outside
the blocks, duplicate/unknown paths, nested/unterminated fences and missing
files. It normalizes CRLF to LF, preserves code indentation and escaping, and
applies the existing 2–1,024-line and 1,024-character-per-line limits. The prior
JSON source-line envelope is no longer accepted; there is one provider format.

For app.js the model defines top-level `validate` and `handleMessage` functions
and their helpers. The server appends one fixed runtime
bridge that checks both functions, handles Worker messages, verifies that a
reply is a patch array, and exports validate and handleMessage for Node checks. The model must
not define messaging or export plumbing. Its raw logic cannot reference the
reserved identifiers self, globalThis, onmessage, addEventListener,
postMessage, module or exports, including in comments or strings. These are
bounded source checks; they are not a JavaScript security parser.

Saved app.js is therefore generated logic plus the server bridge. Existing
per-file and total byte limits apply after the bridge is appended. Source
digests, Sandbox checks, downloads and preview all use those same materialized
files. Repair removes and verifies only that exact suffix before sending the
logic back as native fenced code, with the task and diagnostic fields in
separate JSON-labelled sections. The response may replace one to three named
files; omitted files remain byte-for-byte unchanged. All merged files pass the
same validation and receive exactly one runtime bridge. Original
logic line numbers are preserved. The server never runs generated source while
decoding or materializing it. Missing required functions fail when the Sandbox
loads app.js and can use the existing single repair.

The shared prompt demonstrates a syntactically valid event object using a named
values snapshot and a separate edited-text variable. Invalid JSON text remains
test data instead of being embedded in nested event literals. Both `input` and
`change`, every enabled action including the main button, and task-specific
assertions remain required. This addresses the retained missing/extra-brace
mistakes without altering generated source or weakening the Sandbox gates.

### Deterministic control contract

Each new Sandbox submission derives a control manifest from the exact files'
sanitized body using the production preview sanitizer. It records unique IDs,
control kinds, compatible patch fields and required events. Duplicate IDs,
controls without IDs and exceeding the bridge's 200-element binding limit are
rejected before submission. Generated source is never evaluated by this step.
The manifest travels as trusted data in the existing operation's stdin, with
the same three source files, timeout, network isolation and operation ceiling.

The trusted runner compiles **both app.js and checks.cjs** before either executes,
so one diagnostic can identify syntax failures in both files. The runner then
exposes only the actual exported `validate` and
`handleMessage` functions through frozen wrappers. Each call is counted only
after it returns successfully; a handler reply must be a bounded array of patches
for existing page IDs and compatible fields. Handler messages need real event
types and the full current input snapshot. At least one
successful call to each function and one successful synchronous assertion are
required. A caught assertion or patch-contract failure still fails the check.

Checks must exercise init, each enabled action's click (or a form's submit),
and both input and change for every editable input after output exposure.
Edits before the first output do not satisfy that separate denominator. The
trusted preview clears dynamic output immediately on input/change and before
applying a batch that changes an input value or select options. Clearing happens
once before the batch, so a fresh result is kept even when its patch precedes
the value patch. An edit handler may return no patches. Stale replies remain
discarded by the existing edit revision check. Every output element and pre with `data-output="true"`
receives an observed text patch; static pre samples need no refresh. Messages
have exact own browser fields and are normalized as plain JSON data before app
execution. Observations are captured before generated checks can mutate them.
An output patch establishes a refresh; it does not prove correct recomputation.

The prompt declares textual inputs with `data-input-format="text"` or `"json"`
and example buttons with `data-example-for="<input id>"`. Only explicitly
declared JSON example loaders are parsed as JSON, using the final effective
value when a response patches an input more than once. Invalid user input and clear
actions remain valid interactions and are not mistakenly treated as examples.
New source admission requires an explicit format on every textual value control;
omissions use the existing bounded source-repair path before Sandbox submission.
Historical missing declarations remain readable as unknown. Explicit `text`
declarations stay `text`: task prose, labels, examples and use of JSON.parse are
not an authoritative input specification. The preview exposes an Input formats
disclosure so these declarations can be reviewed against the task. It never
changes stored source or retroactively upgrades JSON qualification.
Label text and task wording are not used to infer input types or loader roles.

### Task-owned input requirements

New runs copy the task's reviewed `executionInputs` into the immutable
`requiredInputFormats` snapshot. There are three explicit meanings:

| Saved requirement | Meaning |
| --- | --- |
| `null` | Input formats are unspecified; declarations remain model choices. |
| `[]` | The tool must have no textual value controls. |
| `[{"id":"input-json","format":"json"}]` | The complete set of textual value controls, with exact IDs and formats. |

At most eight unique IDs are accepted. IDs start with a letter and contain
only letters, digits, underscores and hyphens, up to 80 characters. Formats
are `text` or `json`. Checkbox and action controls are outside this textual
set. This metadata does not certify field semantics or tool correctness.

The existing task editor reviews and saves input changes through
`savePackPath`, with stale-state and unfinished-run guards. A proposed project
may include `executionInputs`; approval preserves the explicit value. Older
tasks without the field remain unspecified. The new checker starter specifies
`input-json` as JSON. Creating that starter does not modify existing tasks.

Initial generation, both repair paths, preview admission and Sandbox
preparation use the same saved requirement. Specified IDs and formats must
match the complete textual control set: changing JSON to text, adding a dummy
JSON input, or omitting a required control is rejected before execution. The
existing second-call repair can correct a mismatch within the same limits.
Current-task matching also includes these requirements before run evidence
can be attached. Preview rendering never rewrites a retained declaration.

stdout records assertion/actual-function-call counts, observed/required control
events and post-output edits, JSON-declared/all example loaders, and inputs without a
declared format. These separate denominators describe structural observations,
not independent task-semantic acceptance. Neither model assertions nor this gate
establish that the release-packet outputs are correct. The frozen independent
case set and actual rendered preview remain the separate qualification gate.

The generation prompt asks for assertions on example-loader patches, edits
after a valid result and invalid enum input. The authored checker fixture tests
those behaviors through this same runner; deliberate broken fixtures must fail.
The independent packet cases remain separate and are not sent to the model.

`checks.cjs` is a synchronous assertion body. The trusted runner supplies
immutable lexical bindings for strict `assert`, `validate`, and `handleMessage`.
Generated checks use them directly; there is no generated-import requirement
or import-regex admission path. Unsupported imports, redeclarations and binding
replacement fail inside the existing isolated runner. Assertion failure remains
sticky even if caught. Source line numbers still identify the original body.

### Retained generation responses and bounded repair

The current run format is `run-diagnostics.v3`. Older clients must reload before starting
a run. Historical records with no generation evidence normalize to an empty
history; their missing source and causes remain unknown.

Each identified model response records its producing attempt, source-validation
outcome, safe diagnostic and exact assistant `content` text. Only a matching model,
single assistant choice, numeric usage and a content string qualify for retention.
Separate reasoning fields, raw provider envelopes, headers and credentials are
excluded. Provider parsing may already have placed explanatory or reasoning-like
text into `content`; the history preserves that text as received. Rejected
text is inert escaped text in the authenticated run review, never a preview.
Each response has a 64 KiB serialized JSON limit; the entire run record has a
480 KiB limit below the browser's 512 KiB response ceiling. New text is explicitly
omitted when it cannot fit, reserving room for remaining checks and events.
The existing run access key and seven-day server retention apply.

A known source rejection can use the second model call before Sandbox. The
rejected response and exact diagnostic are retained before repair is scheduled.
That repair returns all three complete files and passes the same validation.
After an actual Sandbox failure, repair may replace selected validated files.
Both paths share the same two-call ceiling: calls are counted by submitted model
requests, not by completed Sandbox checks. Cancellation, unknown submission
outcomes, configuration errors, unavailable response text, quota refusal and
elapsed deadlines cannot initiate a repair. Existing terminal runs are not retried.

A repair whose materialized file digest equals the preceding failed Sandbox
check is rejected as `unchanged_repair` at `tool_files`, before another Sandbox
submission. Both final responses and observed token totals remain recorded;
the original files/check stay attached to their producing attempt. A different
digest alone does not prove that a repair fixed anything.

Sandbox syntax diagnostics include a bounded excerpt around the reported
source position, alongside the original filename and line. This gives the
repair call the offending statement without adding another compilation or
executing generated code on the host. Compiler feedback still cannot establish
task semantics; model-generated checks and the independent browser gate remain
separate requirements.

`record.attempt` and `check.attempt` identify the model call producing the files.
Thus a rejected first response followed by a valid repair has one Sandbox check
with attempt 2. `checks.length` is the physical check count. Readiness still needs
a successful observed check bound to the latest files' digest, complete recorded
usage and no failure. Source validation or a successful mocked sequence does not
establish useful live model output.

This bridge revision does not add an old-suffix repair fallback. Before applying
it to a runtime, confirm no earlier nonterminal run may still need repair.
Older retained runs stay readable and previewable with their original checked
files; their historical assertion counts are not reinterpreted as new coverage.

Native code blocks remove the need for the model to JSON-escape every source
line. This is a coding-format choice, not proof that structured JSON caused the
previous syntax failures or that the new output will pass. Real Sandbox checks
and interactive preview results remain required. The request retains the
configured NVIDIA model, existing sampling settings and the
8,000-output-token ceiling; it makes no extra inference call.

The request uses `enable_thinking: true` and `force_nonempty_content: false` for
both generation and repair. It omits the low-effort hint to request the standard
reasoning mode documented in NVIDIA's [model card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16/blob/main/README.md).
Its [reasoning parser](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16/blob/main/super_v3_reasoning_parser.py)
can substitute an unfinished reasoning trace for absent final content when
`force_nonempty_content` is true. This code-file workflow does not request that
substitution. A length-limited response still fails, and the app never extracts
files from reasoning fields. This is not proof of the exact parser deployed by
Nebius. The live trial on 91ad4ee exhausted its repair output limit with prose in
the content field. Subsequent low-effort trials on f70f72d and 98ed25e returned
complete files but failed the required incomplete-input result. Their records
are preserved. Standard reasoning may consume more reasoning tokens or hit the
unchanged output ceiling. One retained trial on 179a00a, run
`5fddeeaa-cfa6-4a80-a3a2-ceb9709e67d1`, passed Sandbox after one repair. Its unchanged
files passed 24 independent packet cases at two browser widths (48 observations)
and 60 total production-renderer checks in a local test host. Both examples and
removal of a stale ready result were also observed in the authenticated local app.
This is evidence for that run, not generation reliability or whole-app readiness.
The Sandbox reported declared JSON-loader coverage of 0/2 because the generated
textarea declared text; the browser case results do not change that denominator.
That generated source has no explicit result label or live-region declaration.
The renderer now supplies named output groups and one pre-existing polite,
atomic status region. Anonymous outputs receive visible Result labels; authored
names are retained. Final visible results are announced after a complete accepted
patch batch; edits announce invalidation once, stale replies are suppressed, and
runtime failure messages remain distinct. Focus stays on the user's control.
The retained files passed the metadata renderer qualification: 48/48 packet
observations and 64/64 total checks, including declaration display, repeat-result
updates, focus and stale-announcement clearing. A readability follow-up adds one
check per width, bringing the retained total to 66/66 and the authored-fixture
total to 86/86. The saved checker now displays 16px input/result text, 44px
actions and a 3px keyboard-focus outline at both widths. These DOM observations do not
establish actual screen-reader speech or full accessibility compliance.

Checks record the observed provider operation ID, resulting checkpoint ID if
available, exit code, bounded stdout/stderr, attempt and source digest. These
are agent-authored checks, not independent acceptance or a guarantee that all
requirements are met. The fixed server harness writes the selected files and
derived manifest as data, compiles both scripts, validates observed control
interactions, then runs the model assertions. Generated code executes
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

The renderer supplies local typography, control-size and focus defaults using
the edition's public Wornpage palette. They occupy the first CSS cascade layer,
so authored tool styles retain precedence. They load no fonts or assets and do
not modify stored files, control IDs, the message bridge or its isolation.
They are presentation defaults, not a new source-admission requirement.

Known source rejections and observed first Sandbox failures share one repair
within the run. Every replacement passes the same validation; no separate run
is started automatically and no third model call is allowed.

### Offline preview qualification

Build the current UI with `npm run build:nebius`, then run
`npm run test:nebius:tool-preview` to qualify the committed authored checker
through the actual production renderer. Set `CHROME_EXECUTABLE_PATH` to an
existing Chromium executable and optionally `NEBIUS_PREVIEW_EVIDENCE_DIR` for
the local report and screenshots. It does not download a browser or call Nebius.

The same verifier can inspect an existing ready result:

```text
npm run test:nebius:tool-preview -- --run-record run-record.json --bindings bindings.json
```

The record file must be one raw `RunRecord`, not a response envelope or workspace
backup. Its ready status and checked source digest are validated. The original
materialized files are previewed unchanged; no bridge is stripped or replaced.
The bindings file has exactly five unique HTML IDs matching the actual template:

```json
{"input":"jsonInput","output":"output","check":"checkButton","incomplete":"exampleIncompleteBtn","corrected":"exampleCompleteBtn"}
```

Those IDs are an example, not guessed defaults for generated output. The verifier
checks the sanitized controls before interaction. Record files are bounded to
1 MiB and bindings to 4 KiB; selectors, extra keys and ambiguous options fail.
Do not include provider credentials or run-access keys in either file.

Each of the 24 frozen packet cases gets a fresh page, opaque frame and Worker at
375 and 1280 pixels. The report retains all 48 outcomes, explicit observed/pass/
fail counts, actual output, and separate loader/edit checks. A semantic failure
does not stop later cases; any failed check exits nonzero. The strict oracle is
unchanged: exact wording mismatches remain failures and can be discussed
separately from behavior defects. Source runs only in the isolated browser Worker.

This is a local test-host renderer check of a caller-supplied record, not an
authenticated provider read, a new model/Sandbox run or independent project
acceptance. File integrity is not a provenance signature. The real application
route, provider receipts, generated assertions and human decision remain separate.

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

The DOM bridge sends one request at a time and retains up to 32 pending native
events in order, with field values captured when each event occurs. A reply
computed before a newer input/change event is discarded so it cannot overwrite
the user's newer fields or publish a result for old values. The event is still
handled in the Worker, then the next captured request is sent. Each dispatched
request keeps the existing five-second deadline. Overflow, timeout, invalid
reply or script error stops the Worker, clears pending events and reports an
explicit failure. Reopening is the only restart; there is no automatic retry.

The provider-free authored preview verifier also uses a deliberately slow
authored handler for four scenarios at 375 px and 1280 px: Check
followed by an edit, two example loaders with result-before-value patch order,
a loader followed by an edit, and an input-only loader. This fixture returns
no edit patches, so clearing must come from the real preview.
These eight bridge checks have their own denominator and source digest; they
are separate from the unchanged 48 packet checks and never alter or stand in
for retained model source.

The parent review page keeps its status subscription for the entire active
iframe lifetime. The first valid ready message clears only the eight-second
startup deadline; a later failure changes the parent status and ends the
subscription. Close, component destruction, record replacement and reopening
remove the old listener and deadline. Reopening replaces the iframe rather
than reusing its WindowProxy, and closing returns keyboard focus to its Open
preview trigger. Only the current opaque frame's exact two-field message
shape is accepted.

The default authored verifier also mounts the actual compiled review component
in an isolated browser workspace with an explicitly synthetic run reference.
It checks later Worker failure, a fresh frame on reopen, close-focus return,
inert rejected-source history and stale-result inspection at both widths,
plus page-error/network guards: twelve separately counted
parent checks. The reference's modeled usage/check receipt is not provider
evidence; only the preview API is served by the synthetic host and every other
API is disabled. No real workspace is changed. Explicit retained-record mode
continues to qualify its unchanged files in the renderer without seeding the
synthetic parent workspace or requiring compiled UI assets.

### Saved-record compatibility

Compatibility retained:
- Consumer: retained `browser-tool.v1` run records, local references and exported
  workspace backups, including earlier failed attempts and the successful checker.
- Owner: the shared input/record validators, the existing browser-state owner and
  Durable Object load path. New request writers use `browser-tool.v2` only.
- Removal condition: the owner explicitly retires or migrates every retained v1
  record/reference and imported backup while preserving its evidence. Server
  expiry alone cannot retire copies in exported backups.
- Test coverage: unchanged v1 snapshot reads, absent historical diagnostics,
  denied legacy starts/resume and queued provider submission, current-task
  requirement matching, and reviewed local retirement with preserved history.
- Why hard cutover is unsafe now: rejecting those records would hide the user's
  saved failures and break existing backups. Their missing diagnostics normalize
  to null and unknown counts remain unknown. New writes use the current shape.

The server has one active response shape. Cached older clients must reload
through the format gate; no older response serializer is retained.

A v1 request cannot initiate a new model or Sandbox submission. An already
submitted operation can still be observed by its existing ID. Old receipts
retain their original files, declarations, checks and unknown coverage.

An unresolved v1 local reference can be retired only after a parsed
`404:not_found` observation, review of its original snapshot, explicit owner
confirmation and a fresh authenticated server read. The state owner verifies
the exact ID/key/input and absent local record, preserves the original reference
with an `outcome unknown` interpretation, then releases the local reservation.
Wrong credentials, other errors, changed references and aborted writes cannot
retire it. This does not confirm remote cancellation or automatically start a
replacement. Up to eight retired references are retained per task; full
history refuses another retirement without deleting or truncating entries.
History survives workspace backup export/import and remains visibly separate
from an actual successful run.

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

One configured local Super run now has successful Sandbox and browser evidence.
Run `5fddeeaa-cfa6-4a80-a3a2-ceb9709e67d1` passed after one repair; its retained
files passed 48/48 independent packet observations at two widths. The current
renderer passed 66/66 checks on those files, including result labels,
announcements, readable control sizes and keyboard focus. The original declared
JSON-loader coverage remains 0/2.
See [current evidence](NEBIUS_READINESS.md#current-runtime-status--october-2-2026).
The original failures below remain historical evidence. Public hosting is paused.

### Input-requirement qualification — October 1, 2026

The task-owned input slice passed 620/620 Nebius tests and 140/140 preserved
WebMCP contract tests on the pinned Node 24.18.0 runtime. Svelte reported zero
errors and warnings, and the Nebius static build completed. Independent
read-only source review accepted the input boundary and legacy retirement path.

Actual CUA keyboard interaction in a separate loopback workspace, with provider
execution disabled, verified review/keep/confirm retirement, exact snapshot
preservation in the downloaded backup, input add/remove focus, explicit no-input
and JSON saving, invalid-ID rejection, unsaved-navigation protection and reload
persistence. The editor and history fit 375 px and 1280 px without horizontal
overflow. The legacy reference was a labelled synthetic fixture; this is local
workflow evidence without a provider receipt. An initial Svelte snapshot-cloning
error was observed and corrected before confirmation passed.

Two fresh live v2 evaluations on October 2 failed their generated checks or
repair file format; details are in the current readiness checkpoint. Successful
v2 generation and task-semantic browser qualification are still required.
The successful v1 checker's original source and JSON-loader 0/2
remain unchanged. Projects Acceptance returned an internal error, so no formal
acceptance receipt was created for this slice.

### Historical attempts — September 28, 2026

Sandbox access was enabled in the hosted demo. On September 28, a real isolated
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
then-configured 20-call/3-run daily limits.

The original five-call and one-run limits were restored after the first two attempts.
The owner subsequently raised the hosted allowance to 20 model calls and
3 task runs per UTC day. Existing daily counts were retained; per-run limits
remain two model calls, 8,000 output tokens per call, and two 30-second Sandbox
executions. See [current runtime evidence](NEBIUS_READINESS.md#current-runtime-status--october-2-2026).

Runtime and product reviews are recorded in Projects Acceptance as development
evidence. That review tooling is outside this app and is not a required service
for running or judging the submission. The app's model calls use Nebius Token
Factory; generated-code execution uses Nebius Sandbox.
