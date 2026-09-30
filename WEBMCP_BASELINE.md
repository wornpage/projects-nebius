# Preserved WebMCP baseline documentation

These instructions describe the earlier WebMCP edition. Its public URL is not the Nebius demo. For the Nebius edition, start with [README.md](README.md). The public WebMCP repository and deployment remain frozen.

A small, static edition of Wornpage Projects built for the 2026 WebMCP Challenge. People and browser agents operate the same visible Priority, Work, Review, and Next screens; the agent receives a bounded projection of what the person can already see.

Live submission: <https://projects-webmcp-extension.pages.dev/webmcp-challenge>

The submission URL is publicly accessible without an account. Deployment-specific preview URLs remain separate from this production judge path.

The deployment is intentionally static. It has no sign-in, payment flow, Worker Function, database, secret, or production API. Sample changes stay in this browser.

## Where this edition came from

Projects was not invented during the challenge. A private predecessor records
the earlier, human-operated workflow and broad application history. During the
submission period, that foundation was extended in this separate, sanitized
public repository with page-scoped WebMCP tools, a bounded five-route judge
experience, lifecycle and fallback contracts, and an independently buildable
static artifact.

The predecessor and current production application remain private because their
broader history and application logic are outside the submission boundary.
Neither is needed to build, run, or verify this submission. The exact boundary
between prior work and challenge-period work is recorded in
[SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md), alongside the dated commit history.

## Why WebMCP fits

Ordinary browser automation has to infer meaning from layout and scrape a page that was designed for people. This demo lets each page publish a small, explicit tool catalog instead:

| Page | Tool | Authority |
| --- | --- | --- |
| Guide | `get_projects_handoff_guide` | Read the visible guide, editable brief, discovered Work scopes, selected query, and exact workspace denominator |
| Priority | `get_next_recommendation` | Read the one visible actionable recommendation as its id, title, destination, and reason; no navigation, fetch, or write |
| Work | `get_current_work_view` | Read the bounded, filtered list, its denominators, and the visible Decision Workspace recommendation |
| Work | `show_work_search` | Change only the visible search scope |
| Work | `create_work_drafts` | Atomically add 1–3 browser-local items in Draft status; cannot start, block, complete, or delete them |
| Review | `get_current_review_queue` | Read the bounded queue, denominators, and visible reasons each item surfaced |
| Review | `set_review_scope` | Change only the visible review filter and query |
| Next | `get_current_next_editor` | Read the visible next-action editor and its validated Decision Workspace context when present |
| Next | `prepare_next_action` | Prepare an unsaved choice from 1–3 exact Work or Review facts; stale or mismatched facts are rejected and the page generates the visible evidence note |

The page owns registration and teardown through `document.modelContext.registerTool`. Every successful presentation-changing or draft-creation invocation leaves a polite, screen-reader-announced receipt naming the tool and its exact effect. Read receipts remain visually silent; search, scope, and Next preparation state that nothing was saved; `create_work_drafts` truthfully reports the browser-local workspace count change and Draft status. On Next, the agent submits exact `workId` / `field` / `expectedValue` references already observed on Work or Review; an absent blocker is consistently represented as `null`. The page requires a current-item fact, checks every value against the live workspace without coercion, and deterministically generates the displayed evidence note; arbitrary agent prose cannot enter that field. Starting work and final saves remain visible, human-owned controls.

Shared WornReceipt dismissal preserves keyboard focus through the immutable `@wornpage/receipt` dependency. Projects keeps only route-specific receipt composition and state removal; it does not duplicate the shared recovery behavior or change the package API.

Work's Decision Workspace composes the selected open decision, current workflow and blocker evidence, browser-local draft preparation, and the human-only final Save in one surface. It reuses the same pending-draft fingerprint, stale check, and `setPackNextAction` owner as Next. Preparing or revising a draft leaves the work item unchanged; approval consumes that exact settled draft atomically. Pending approvals resume through one bounded `focus` value plus the explicit `pending-decision` context marker. Work revalidates the exact id after browser state loads, gives a valid open decision priority without rewriting saved filters, and labels a resumed decision that sits outside the current list scope. Invalid, duplicate, missing, archived, completed, and non-decision requests fail closed. The global shell keeps Work, Pending, and Guide top-level; Priority, Review, and Next remain accessible focused views inside Tools rather than presenting the old routes as mandatory numbered steps. When a deep link carries the exact work id and bounded context marker into Next, Next still verifies the loaded item independently; no recommendation prose, workspace facts, new storage path, or expanded WebMCP authority is serialized. The modernized shell, Decision Workspace, Pending approvals center, and disclosure boundaries consume one shared spacing, type, and radius scale from `assets/demo.css`, keeping visual changes centralized without changing package APIs.

On the Guide, **All visible work** is selected immediately with the full workspace denominator. Compact alternatives are derived from the current workspace's area fields and counted through the same shared text search used by Work; no sample family name is embedded in the chooser logic. **Custom** reveals the bounded query input only when a person wants another visible term or an honest zero-match result. The safe default brief forbids workspace changes; **Use fast-create brief** is an explicit human choice that authorizes only the existing three-Draft creation path and still forbids Start, Save, block, completion, and deletion. The shared compact WebMCP pill replaces the verbose Guide-only reader panel: it shows the exact current-page count, turns green only after every native registration promise resolves, and opens an accessible WornDialog with the native status plus the exact descriptor names, descriptions, and authority. The reader returns the live DOM choices, selection, counts, query, and editable brief, but has no navigation, persistence, server, telemetry, or decision authority. When the API is unavailable, Copy brief and the three ordinary route buttons remain usable.

## WebMCP implementation

The challenge documentation's `search_products` descriptor illustrates the imperative API shape. Wornpage Projects registers project-specific tools instead. A minimal direct registration of the Guide reader has that same shape:

```js
const registrationController = new AbortController();

document.modelContext.registerTool({
	name: 'get_projects_handoff_guide',
	description: 'Read the current Projects handoff guide and editable browser-agent brief rendered on this page.',
	inputSchema: {
		type: 'object',
		properties: {},
		additionalProperties: false
	},
	annotations: {
		readOnlyHint: true,
		openWorldHint: false,
		untrustedContentHint: true
	},
	execute: async () => readRenderedWebMcpChallengeGuide(document)
}, {
	signal: registrationController.signal
});
```

The shipped implementation adds exact-input rejection, validated current-page projections, truthful annotations, and complete descriptors in each route. Priority derives one actionable recommendation from the same browser-local workspace used by the visible page; its read-only tool returns only the rendered id, title, destination, and reason. Work's human-owned Quick Add and `create_work_drafts` both reuse one NFC title normalizer. Their 200-character limit counts Unicode scalar values after normalization, so valid emoji and flags are never split; an overlong title is rejected before the one workspace transaction begins. Browser workspace data is stored in a schema-versioned envelope with an opaque revision. Every storage mutation—including legacy migration, normal saves, and explicit reset—holds the same browser-wide exclusive lock. Saves compare the exact revision captured by the tab and rotate it with the state write; queued migration and reset operations re-read only after acquiring the lock, so a stale tab fails without overwriting or reviving removed state. Existing raw browser state is migrated in place to the v1 envelope without dropping its state fields. The draft tool adds at most three Draft-status items and cannot Start or complete them. The Guide projection normalizes line endings, accepts an empty brief, permits only normal text plus tabs and newlines, and limits the brief to 1,000 characters. Its scope catalog is bounded to 24 derived choices and exposes shown, discovered, omitted, visible, matching, and workspace counts without hiding denominator changes. `workQuery` remains the deterministic Work-search mapping: All maps to empty, a derived choice maps to its displayed area text, and Custom maps to the bounded input. It trims boundary whitespace, accepts empty for all visible work, rejects control characters, and is limited to 120 characters. Duplicate, negative, inconsistent, or selected-choice-mismatched DOM projections are rejected. [`registerPageTools`](svelte-frontend/src/lib/webmcp.mjs) performs registration with one abort signal for the page-owned catalog and publishes that same descriptor array to the global status dialog—there is no parallel route catalog. Its state is `connecting` while registrations are pending, `ready` only after all resolve, `unavailable` when the native API is absent, and `error` after the first failure. Navigation aborts and clears the page catalog; lifecycle identity prevents late settlements from replacing the next route's catalog. Toast producers only append messages through `displayToast`. The immutable WornToast component owns automatic timing and interaction pauses, and the layout removes a toast only after that component emits its dismissal event; Projects has no competing timer, capped eviction path, or route-specific producer.

## Run locally

Requirements: Node.js 24.18.0 (pinned in `.node-version`).

```sh
npm ci --ignore-scripts
npm --prefix svelte-frontend ci --ignore-scripts
npm run verify
npm --prefix svelte-frontend run dev
```

Open the URL printed by Vite, then visit `/webmcp-challenge` in a compatible browser for WebMCP tool discovery. Open the global **WebMCP** pill for native status and the exact current-page catalog. `Ready` means every page registration resolved; API detection alone remains `Connecting`. If native WebMCP is unavailable, the ordinary page remains usable with browser-local sample data.

Run the focused production recording preflight separately:

```sh
npm run preflight:recording
```

It launches installed Google Chrome (or the explicit `CHROME_EXECUTABLE_PATH`) in a temporary isolated profile, executes the exact 1:50 cue through a test-only native registration probe, prints actual/expected receipts, and removes the isolated 11-item rehearsal state on exit. It does not modify the deployed UI or the normal Chrome profile.

`npm run build` creates the complete static deployment in `dist/static-publish`. That directory can be uploaded directly to Cloudflare Pages; no Pages Functions or Worker are required.

For a Cloudflare Pages Git deployment, use:

| Setting | Value |
| --- | --- |
| Build command | `npm run build:pages` |
| Build output directory | `dist/static-publish` |
| Node version | Read from `.node-version` (`24.18.0`) |

The Pages build script performs the nested locked frontend install before building, so it does not depend on a pre-existing `node_modules` directory.

## Reviewer path

1. Open `/webmcp-challenge`. Keep the selected **All visible work** default, or choose one of the displayed counted scopes. No workspace taxonomy knowledge or editing is required.
2. In a compatible browser, ask the browser agent: `Follow the brief on this page.`
3. Verify the Guide result includes the exact current `agentBrief`, `workQuery`, selected scope, matching count, and workspace denominator, and that no workspace data changed.
4. Optional: choose **Custom** to enter another visible term or a deliberately absent term. A no-match query must stay at zero on Work.
5. If the WebMCP pill reports native WebMCP unavailable, use Copy brief; a nonempty Work scope is included with the brief. Continue through the three visible route buttons instead.

## Repository boundary

The earlier WebMCP submission was a fresh public extraction rather than the production repository or its history. Its static edition contains five Svelte routes, deterministic sample data, their required shared UI, route-owned WebMCP descriptors, focused contracts, and a static build. Production authentication, billing, storage, private content, MCP servers, deployment credentials, and unrelated routes remain outside this private fork. The new Nebius edition adds its own narrow inference Worker; the baseline static build does not include that runtime.

See [SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md) for the required pre-existing-versus-new-work record and [docs/submission/webmcp/public-repository-boundary.md](docs/submission/webmcp/public-repository-boundary.md) for the exact publication policy.

| Directory | Why it is present |
| --- | --- |
| `svelte-frontend/src/routes/` | Guide, Priority, Work, Review, Next, their WebMCP descriptors, and the shared 404 shell |
| `svelte-frontend/src/lib/` | Browser-local state, visible work-item rules, and only the UI pieces those routes import |
| `assets/` and `data/` | Challenge styling, landing media, and synthetic sample work |
| `tests/` and `scripts/` | Focused WebMCP contracts and the reproducible static build |
| `docs/` and root policy files | Eligibility evidence, public boundary, security policy, licensing, and reviewer instructions |

There is no `server/`, `worker/`, Pages Functions, or hidden compatibility route in the source tree.

## Verification

```sh
npm run verify
```

The gate runs Svelte diagnostics, focused WebMCP contracts, recording-preflight and static-artifact contracts, the content-addressed raster social-card smoke, and a production prerender. Current expected denominators are 207/207 source inventory paths, 140/140 WebMCP contracts, 6/6 recording-preflight contracts, and 9/9 static-artifact contracts. A static contract derives those values from the current manifest and test sources so this reviewer-facing summary cannot silently drift. The historical `PUBLIC_SOURCE_MANIFEST.txt` filename identifies an inventory and does not authorize publication during private submission preparation. Manual WebMCP checks are listed in [docs/submission/webmcp/reviewer-tests.md](docs/submission/webmcp/reviewer-tests.md).

## License and trademarks

Code remains under the [MIT License](LICENSE), including during temporary private submission preparation. MIT permits copying, modification, redistribution, sublicensing, and commercial use subject to its terms. See [LICENSING.md](LICENSING.md) for the planned public MIT release and access policy. Earlier public and private MIT grants remain unaffected. Dependency licenses are summarized in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The Wornpage and Wornpage Projects names and marks are not licensed as product branding; see [TRADEMARKS.md](TRADEMARKS.md).
