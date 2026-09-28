# Reviewer test plan

Run these checks in the ChatGPT or Codex in-app browser, the demonstrated WebMCP client path for this edition.

## Automated gate

```sh
npm ci --ignore-scripts
npm --prefix svelte-frontend ci --ignore-scripts
npm run verify
```

Expected: zero Svelte errors and warnings, all focused contracts pass, and `dist/static-publish` contains the prerendered challenge.

## Decision Workspace handoff to Review — August 30, 2026

This route keeps Decision Workspace's review action navigation-only. Work's visible action and read-only current-view recommendation use the same encoded Review destination; Review owns the arrival focus and does not change workspace data or select a substitute item. The existing `href` remains the canonical contextual Next destination, while the distinct `reviewHref` names the Review action without repointing that live contract.

Source baseline: merged `main` at `ffefa875cfac7a8ea98500c2dea50b2230b33c16` in the isolated PR-machine worktree.

| Contract | Reviewer check |
| --- | --- |
| One Review destination | Work's **Review in queue** action and `get_current_work_view.recommendation.reviewHref` both use `decisionWorkspaceReviewHref`, yielding `/review?focus=<exact percent-encoded canonical id>`. Surrounding whitespace and canonical IDs longer than 200 characters remain encoded exactly when accepted by canonical state. The existing recommendation `href` continues to use `decisionWorkspaceNextHref`. |
| Exact arrival | Review accepts exactly one `focus` value, matches that exact decoded ID only against its current rendered `ReviewView` queue, then passes the visible card through its existing `focusReviewScopeDestination` and `focusAndPulse` owner. |
| Fail closed | Missing, duplicate, non-review-eligible, filtered-out, or non-rendered IDs produce no focus, scope change, fallback selection, receipt, or workspace write. A focus request also bypasses Review's ordinary preferred-item selection during refresh. |
| Page and WebMCP boundary | Review retains its page-owned `get_current_review_queue` and `set_review_scope` registration and annotations. The Work reader is still read-only; the route handoff is an ordinary encoded href, not a tool call or workspace action. |
| Automated gate | `npm run verify` passed: public manifest 89/89, Svelte 0 errors and 0 warnings, WebMCP 95/95, completed production prerender, and static artifacts 6/6. Focused Work and Review contracts passed 40/40. |
| Rendered 499px result | Work's visible Review and Next actions matched `recommendation.reviewHref` and the existing `recommendation.href` respectively. Review focused and pulsed `garage-reset-choose-bike-rack` through the existing owner after route scroll settlement; the title was `:focus-visible`, fully in the viewport, and document client/scroll widths were 484/484px. |
| Rendered 320px result | The same exact requested title remained focus-visible, pulsed, and fully in view. Document client/scroll widths were 305/305px with no horizontal overflow. |
| Malformed request | `/review?focus=one&focus=two` left `BODY` active, selected no work item, rendered no arrival pulse, stayed at scroll position 0, and kept 484/484px client/scroll widths. The request parser retained `present: true` with no valid work ID so ordinary preferred-item selection could not run as a fallback. |
| Browser diagnostics | A clean stable-server replay of Work → Review, malformed duplicate focus, 499px, and 320px produced zero browser warnings or errors. |

## Decision Workspace context in Next — August 30, 2026

Source baseline: clean `origin/main` at `e8e28fbb85d00609e187fab0b5f95962b04f1384` in the isolated `newwork/decision-next-handoff` worktree.

| Gate | Exact result |
| --- | --- |
| One navigation contract | Work and its reader use the single `decisionWorkspaceNextHref` owner. The URL carries only the exact encoded canonical work id and bounded `context=decision-workspace` presentation marker; it carries no reason, title, decider, counts, purpose, proof target, source text, memory, or activity. Exact ids keep surrounding whitespace and ids longer than 200 characters instead of trimming or rejecting a valid saved-state identity. |
| Truthful context | The public marker is not treated as provenance. Next renders context only when the marker's exact requested id is still the visible pack and `isOpenDecision` still accepts that canonical loaded pack. Its fixed explanation states only the current open-decision fact and Decision Workspace's selection rule; it never claims that a person arrived from, or left, a prior Work view. |
| Visible human authority | The existing Next context now shows why Work selected the item and the current decision owner above the unchanged choice editor. Arrival created no pending draft: the reader returned `preparationReceipt: null`, `canSave: false`, and the no-pending-draft reason; the visible Save button remained disabled and workspace state remained unchanged. |
| WebMCP boundary | Work still owns exactly `get_current_work_view` and `show_work_search`; its rendered action and recommendation href matched exactly. Next still owns `get_current_next_editor` and `prepare_next_action`. The read-only getter adds only nullable `decisionContext` fields `mode`, fixed page-owned `reason`, and visible `decider`; the preparer remains truthfully non-read-only because it may persist a pending browser-local draft but cannot save workspace fields. |
| One draft and save path | No route, session, storage, fallback, or automatic draft path was added. Human choices and browser-agent preparations still converge on `savePendingNextActionDraft`; only the existing human Save action calls `setPackNextAction`, which atomically approves the exact non-stale draft through `approvePendingDraft` and the existing browser-state owner. |
| Focused contracts | `node --test tests/work-webmcp-page-contract.test.mjs tests/next-webmcp-page-contract.test.mjs` passed 42/42. Coverage includes bounded navigation, exact canonical-id preservation, allowlisted context cloning/redaction, duplicate/legacy marker rejection, current-state-only wording, UI/reader href parity, explicit no-fallback selection, unchanged canonical approval ownership, and exact blocked-denominator parity. |
| Full automated gate | `npm run verify` passed: public manifest 89/89, Svelte 0 errors and 0 warnings, WebMCP 93/93, static artifacts 6/6, and a completed production prerender. |
| Rendered 499px result | Work rendered `Garage reset: choose the bike rack`; its visible and WebMCP hrefs both ended in `&context=decision-workspace`. The Next getter returned the same work id plus mode `decision-workspace`, owner `Household`, the visible current-state-only reason, no preparation receipt, and disabled saving. At both routes the relevant panels and actions were contained; document client/scroll widths were 484/484px. |
| Rendered 320px result | At a requested 320 × 568 viewport, document client/scroll widths were 305/305px. The Decision Workspace context, full current-work surface, and choice/save editor all stayed inside the viewport; Save remained disabled and horizontal overflow was 0px. |
| Filtered-out decision | `show_work_search({ query: "request archive" })` produced one matching blocked item, no visible open decision, and `recommendation: null`. The read-only getter returned the same null recommendation, the panel was absent, and document client/scroll widths remained 484/484px. |
| Negative routes | Direct `/next?pack=garage-reset-sort-shelves` rendered no Decision Workspace context and returned `decisionContext: null`. `/next?pack=missing-decision&context=decision-workspace` rendered `Work item not found`, exposed no current-work or context surface, returned a null current-editor result, and did not fall back to persisted selection. Both remained free of horizontal overflow. |
| Browser diagnostics and cleanup | The final Work → Next, direct-route, invalid-route, 499px, and 320px replay produced zero browser warnings or errors. The temporary tab was closed, the viewport override was reset, and the local server was stopped. |

## Decision Workspace on Work — August 30, 2026

Source baseline: clean `origin/main` at `7c40b6e1b2912e172eb4a0d2c9b6aa209e1c043e` in the isolated `newwork/extension-decision-workspace` worktree.

| Gate | Exact result |
| --- | --- |
| One visible path | Work selects the first explicit open decision only from its already filtered, sorted, pinned, and Focus-scoped `visible` list. It does not introduce a global priority scorer, hidden recommendation model, draft, storage path, or automatic write. |
| Human authority | The compact Decision workspace panel names the selected work, explains current-view signals, and exposes only `Review in queue` and the existing Next editor. Neither control saves workspace state. |
| WebMCP boundary | Work still exposes exactly `get_current_work_view` and `show_work_search`. The existing read-only getter now allowlists the rendered recommendation's id, title, canonical Next href, reason, visible decider, and displayed counts. It rejects malformed or impossible denominator values and exposes no raw pack, activity, memory, proof target, or source text. |
| Focused contract | `node --test tests/work-webmcp-page-contract.test.mjs` passed 27/27, including visible recommendation projection, redaction, impossible-count rejection, navigation-only controls, and the current-`visible` derivation owner. |
| Full automated gate | `npm run verify` passed: public manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 92/92, static artifacts 6/6, and a completed production prerender. |
| Rendered 499px result | The panel showed `Garage reset: choose the bike rack`, 2 decisions, 3 blocked items, 1 overdue item, and 2 linked sources. Its border remained inside the parent, both actions remained inside the panel, and the document had no horizontal overflow. |
| Rendered scope transition | `show_work_search({ query: "request archive" })` returned one focused result with `recommendation: null`; the visible panel disappeared, the current Work reader returned the same null recommendation, and the document remained free of horizontal overflow. |
| Rendered 320px result | The panel stayed contained with no horizontal overflow. Both navigation-only actions stacked to full usable compact widths. |

## Work generic type cleanup — August 30, 2026

Source baseline: clean `origin/main` at `a0ff0b60874c0339533ae2dccef297c8ce00b3d9` in the isolated `newwork/fresh-observable-audit-44` worktree.

| Gate | Exact result |
| --- | --- |
| Before | All eight bundled records used the generic type `task`, so every compact Cards header rendered an unhelpful `task N days ago` fragment beside its title. |
| Owning-path change | WorkListCard now recognizes `task` and `general` as non-distinct types. Distinct future type labels still render through the existing card owner; no workflow data, action, storage, navigation, or WebMCP path changed. |
| Focused contract | `node --test tests/work-webmcp-page-contract.test.mjs` passed 26/26, including the new guard against restoring generic task headers. |
| Compact rendered result | At 390 × 844 in dark/reduced-motion/coarse-pointer mode, the local production build removed generic type-and-age clutter from every visible Work card while retaining card titles, workflow, blockers, due facts, owners, and primary actions. |

## Next approval notification ownership — August 30, 2026

Source baseline: clean `origin/main` at `6dc0cb70f56776108810ab31a2780857d69044c6` in the isolated `newwork/fresh-observable-audit-43` worktree.

| Gate | Exact result |
| --- | --- |
| Untouched baseline | `npm run verify` passed before edits: public manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 69/69, static artifacts 6/6, and a completed production prerender. |
| Ordinary human path | At 320 × 568 in dark/reduced-motion/coarse-pointer mode, choosing `Focus` created one human-owned pending draft, exposed the visible pending-approval authority copy, and enabled `Approve and save`; no tool invocation was required. |
| Before | One approval rendered two simultaneous success notifications: generic `Next action saved.` from `setPackNextAction` and receipt-derived `Next action set to "Focus".` from the Next page. The saved receipt and workspace state were otherwise correct. |
| Owning-path change | Removed the generic toast side effect from the storage mutation. Next remains the sole presentation owner and emits the exact canonical receipt summary; pending-draft approval, storage, receipt, focus, WebMCP preparation, and toast dismissal paths were unchanged. No fallback or second notification path was added. |
| Focused contract | After excluding one malformed-regex harness run, the corrected contract failed 12/13 before the source change solely on the lower-layer toast and passed 13/13 after the change. It requires zero toast calls in `setPackNextAction` and exactly one receipt-derived success call in `saveChoice`. |
| Final automated gate | `npm run verify` passed after the fix: public manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed production prerender. |
| Compact rendered result | The patched `Focus` approval produced exactly one dismissible toast, `Next action set to "Focus".`; document and scroll widths both measured 305px. Focus moved to `next-action-preview`, remained `:focus-visible`, and the receipt showed the same saved action and proof target. |
| Reload persistence | Reload preserved `Focus`, showed no pending-approval link, left Save disabled until a new draft, and restored with zero stale toasts. |
| Desktop rendered result | At 1440 × 1000 in light/normal-motion/fine-pointer mode, a human `Start` approval produced exactly one receipt-derived toast, document and scroll widths both measured 1440px, and the focused preview remained fully in the viewport. The human path rendered zero WebMCP activity receipts. |
| WebMCP and fallback boundary | Next still exposed exactly `get_current_next_editor` and `prepare_next_action` with unchanged descriptors. The ordinary choice/draft/Save chain contains no model-context dependency, while the existing unsupported-browser contract continues to reject registration reads when the API is absent. |
| Browser cleanup | The visible Guide `Reset live sample` action restored the bundled sample after each mutation; emulated media/touch/viewport state was reset, the audit tab was closed, and the local preview was stopped. |

## Review queue terminal-state correction — August 30, 2026

This local checkpoint changes the one shared Review classifier. It does not add a route fallback, storage path, WebMCP operation, commit, deployment, or hosted-access claim.

| Gate | Exact result |
| --- | --- |
| Before baseline | The 5-item Review denominator hid a membership error: Done items `garage-reset-clear-floor` and `garden-study-tag-field-notes` were included because their saved next action was empty, while active items `garage-reset-choose-bike-rack` and `garden-study-choose-followup-sample` were excluded even though their explicit next action was `Review`. Review therefore reported 2 missing-next items and silently selected the Done clear-floor item for a direct Next load. |
| One canonical selector | `isReview` now rejects done or archived work before classification and accepts the existing `review-work` action alongside blocker and missing-next signals. The shared selector continues to serve Review preference, Review filtering and summary, standup text, the Work review count, and Next's review projection; no consumer owns a route-level terminal-state patch. |
| Membership and denominators | The total remains truthfully 5 and blocked remains 3; missing-next changes from 2 to 0. The two active explicit Review decisions replace the two Done items. `garage-reset-sort-shelves` remains Up next, followed by 2 blocked items and the 2 active decision items. |
| Red-first and focused contracts | The new selector contract first failed 1/8 against the old implementation, then Review, Work, and Next passed 32/32 together after the shared fix. The contract fixes all four sample ids and rejects route-level done-status filtering. |
| Automated gate | `npm run verify` passed: manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed production prerender. |
| Compact rendered result | At 390 × 844 in dark mode with reduced motion and a coarse pointer, the live Review getter returned 5 total / 5 filtered / 5 shown / 3 blocked / 0 missing-next. The document had no horizontal overflow, the active decision items were rendered, and neither Done item appeared. Every on-page control measured at least 44px high; the off-canvas skip link is exposed when focused. |
| Wide rendered result | At 1440 × 1000 in forced light mode with normal motion, the same exact queue rendered with no horizontal overflow and no terminal item text. A direct Next load after Review projected `garage-reset-sort-shelves`, custom action `Clear the garage floor`, and blocker `Waiting on storage bins`. |
| WebMCP boundary | Review still exposed exactly `get_current_review_queue` and `set_review_scope`; Next still exposed exactly `get_current_next_editor` and `prepare_next_action`. Getter metadata remained read-only and action metadata remained mutation-truthful. Browser verification changed no workspace field, and the visible Guide reset cleared the browser-local sample state afterward. |

## Review card drag boundary — August 30, 2026

Source baseline: clean `origin/main` at `6dc0cb70f56776108810ab31a2780857d69044c6` in the isolated `newwork/fresh-observable-audit-42` worktree.

| Gate | Exact result |
| --- | --- |
| Untouched baseline | `npm run verify` passed before edits: public manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 69/69, static artifacts 6/6, and a completed production prerender. |
| Fresh rendered audit | Guide, Review, and Next were inspected at 320 × 568 in dark/reduced-motion/coarse-pointer mode and at 1440 × 1000 in light/normal-motion/fine-pointer mode. All three routes kept document width equal to scroll width and exposed no horizontally clipped control. |
| Before | Every one of Review's four follow-on cards rendered `draggable="true"` even though Review had no drag-start, drag-over, drag-end, drop, reorder, or persistence handler. Repository search confirmed that Work remains the only route with an owned drag interaction. |
| Owning-path change | Removed only Review's false `draggable` attribute. The existing focusable-card keyboard path, links, mutations, Work drag implementation, shared Wornpage API, and page-owned WebMCP registration were unchanged; no compatibility path was added. |
| Focused contract | The new contract failed 7/8 before the source change solely on the advertised drag attribute, then passed 8/8 after the change. It also rejects future Review drag handlers unless a real interaction is deliberately introduced. |
| Final automated gate | `npm run verify` passed after the fix: public manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed production prerender. |
| Compact rendered result | At 320 × 568, all four Review cards had no `draggable` attribute, the DOM `draggable` property was `false`, and every drag-event property was `null`. The 305px document and scroll widths matched; card bounds stayed between 8px and 297px. |
| Desktop rendered result | At 1440 × 1000, all four cards again had no drag attribute and `draggable === false`; every card remained within the 1425px document width and scroll width. |
| Keyboard regression check | Arrow Down moved visible focus from `garage-reset-sort-shelves` to `garage-reset-haul-donations`; Enter opened `/next?pack=garage-reset-haul-donations`, whose settled title was `Next — Wornpage Projects™` and current-work label matched the requested item. |
| WebMCP lifecycle | Review exposed exactly `get_current_review_queue` and `set_review_scope`. After the keyboard navigation, the old Review handle failed as stale and Next exposed exactly `get_current_next_editor` and `prepare_next_action`; the descriptors and side-effect metadata were unchanged. |
| Browser cleanup | The visible Guide `Reset live sample` action restored the bundled sample, emulated media/touch/viewport state was reset, the audit tab was closed, and the local preview was stopped. |

## Work Focus-mode F shortcut — August 30, 2026

This local checkpoint makes Work's existing Focus-mode keyboard promise executable. It changes no workspace field, storage owner, route, WebMCP registration, component API, commit, deployment, or hosted state.

| Gate | Exact result |
| --- | --- |
| Before baseline | The Focus control advertised `Focus on selected work (F)`, and activation announced `Focus on. Press F to exit.` The route's only window-key owner had no F branch: after a real `f` keypress, the control remained `aria-pressed="true"` and the document retained `focus-mode`. |
| One route owner | Work's existing `handleWindowKeys` now handles lowercase or uppercase F once, prevents the default, and calls the existing `toggleFocusMode`. It ignores inputs, textareas, selects, Ctrl/Meta/Alt combinations, and repeated keydown events; no parallel shortcut helper or focus-mode path was added. |
| Visible shortcut truth | The existing Keyboard shortcuts dialog now includes `F — Toggle focus mode`, aligning its visible help, button title, toast instruction, and executable behavior. |
| Red-first and focused contract | The new Work contract failed 1/13 on the missing F branch, then passed 13/13 after the route and visible help used the same shortcut. |
| Automated gate | `npm run verify` passed: manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed production prerender. |
| Compact rendered result | At 390 × 844 in dark mode with reduced motion and a coarse pointer, Focus changed to pressed and the visible work count became 1. A real F keypress changed it back to unpressed, removed `focus-mode`, retained keyboard-visible focus on the 44px control, and produced no horizontal overflow. With Focus active, typing `f` in Quick Add inserted the character and left Focus active, proving the editable-field guard. |
| Wide rendered result | At 1440 × 1000 in light mode with normal motion, the live Work getter projected focus mode as 1 shown / 1 matching / 8 workspace / 0 blocked. Pressing F projected focus mode off and restored 8 shown / 8 matching / 8 workspace / 3 blocked; the 36px control retained visible keyboard focus and the document had no horizontal overflow. |
| WebMCP boundary | Work still exposed exactly `get_current_work_view` and `show_work_search`. The read-only getter truthfully reflected the local Focus scope before and after F; no tool, schema, annotation, request, or workspace write changed. |

## Work O-shortcut destination truth — August 30, 2026

This local checkpoint corrects one stale Work shortcut label. It changes no navigation handler, workspace field, storage owner, component API, WebMCP registration, commit, deployment, or hosted state.

| Gate | Exact result |
| --- | --- |
| Fresh compact audit | Guide, Priority, Work, Review, and Next were inspected at 320 × 568 in dark mode with reduced motion and a coarse pointer. All 5/5 routes had no horizontal overflow, clipped visible control, missing visible control name, or sub-44px visible touch target. |
| Before baseline | Work's visible shortcut dialog said `O — Open details`. Pressing lowercase O on the first focused card navigated to `/next?pack=garden-study-request-archive`, whose H1 was `Set the next action`; the route has no details destination. |
| One route owner | The existing O handler still calls the existing `selectPack`, and `selectPack` remains the sole owner of `/next?pack=…` navigation. Only the existing dialog row changes to `O — Open next-action editor`; no alias, wrapper, fallback, second shortcut handler, or alternate navigation path was added. |
| Red-first and focused contract | The new Work contract fixed the O handler, `selectPack` destination, corrected visible label, and rejected `Open details`. It failed 1/13 on the old label, then passed 13/13 after the one-line copy correction. |
| Automated gate | `npm run verify` passed: manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed production prerender. |
| Compact rendered result | At 320 × 568 dark/reduced/coarse, the corrected 201.6px label remained on one 19.5px line; neither the shortcut dialog nor document overflowed. Lowercase O opened the exact first card at `/next?pack=garden-study-request-archive`, rendered `Set the next action`, and retained the requested work title. |
| Wide rendered result | At 1440 × 1000 light/normal, ArrowDown moved visible keyboard focus from the first Work card to `garage-reset-sort-shelves`; uppercase O then opened `/next?pack=garage-reset-sort-shelves`. The destination rendered the exact title and H1 without horizontal overflow. |
| WebMCP boundary | Work still exposed exactly `get_current_work_view` and `show_work_search`. Navigation invalidated the prior Work handle as stale and exposed exactly Next's two page-owned tools; no descriptor, schema, annotation, invocation, or workspace write changed. |

## Priority and Quick Add production release — August 29, 2026

Verified at `2026-08-29T11:54:56-04:00`. Pull request [#39](https://github.com/wornpage/projects-webmcp-extension/pull/39) merged as `dbd0d5f6fc77f4e4f261ee66808b18b41438d55b`. The reviewed branch and squash merge have the identical tree `9a26589d3dcb9f3909b613b9b064215596f77f4f`.

Public judge URL (no account required): <https://projects-webmcp-extension.pages.dev/webmcp-challenge>

| Gate | Exact result |
| --- | --- |
| Automated gate | `npm run verify` passed: public manifest 87/87, Svelte 0 errors and 0 warnings, WebMCP 67/67, static artifacts 6/6, and a completed production prerender. |
| Cloudflare production | Deployment `41ab7c04-aa5e-4aca-850f-f48556061f59` recorded Production, branch `main`, and source `dbd0d5f`; the version URL is <https://41ab7c04.projects-webmcp-extension.pages.dev>. |
| Public route ledger | Guide, Priority, Work, Review, and Next each returned HTTP 200 from the production alias. The retired `/heartbeat` route returned HTTP 404; no compatibility route was deployed. |
| Priority rendered parity | The live page rendered one recommendation with id `garden-study-log-interviews`, title `Garden study: log interviews`, href `/next?pack=garden-study-log-interviews`, and the current due-date reason. Browser discovery exposed exactly `get_next_recommendation`; its descriptor remained read-only and stated that it cannot navigate, fetch, or write. |
| Work Quick Add | The live Work page exposed one native `Proof target · Optional` disclosure and one focusable proof-target textbox while preserving the honest 8 shown / 8 matching / 8 workspace / 3 blocked denominator. |
| Work tool boundary | Browser discovery exposed exactly `get_current_work_view` and `show_work_search`; no create tool or second draft/storage path was present. |
| Human write evidence | In the production preview, explicit Add submitted title plus proof target through the canonical `createPack` owner, produced one visible success receipt, changed every workspace denominator from 8 to 9, and cleared both fields. The visible Guide reset restored the bundled sample afterward. |

## Local verification record — August 26, 2026

Source baseline: `57d0fe1de5c3ef8d1d22a38cf363394968f0870c`, committed at `2026-08-26T17:31:15-04:00` with the message `Create minimal static WebMCP challenge edition`.

| Gate | Result |
| --- | --- |
| Clean dependency install | Root and frontend installs completed with 0 reported vulnerabilities |
| Svelte diagnostics | 0 errors, 0 warnings |
| Focused WebMCP contracts | 21 passed, 0 failed |
| Static artifact contracts | 4 passed, 0 failed |
| Production build | Completed; final artifact contains static files only and no `_worker.js` or Functions directory |
| Codex in-app browser | Exact tool catalog discovered on all four routes; no console errors or warnings |
| 390px responsive check | No horizontal document overflow on Work, Review, or Next |
| Previously clipped title | `Garage reset: clear the floor` rendered in a full 18.2px line box with visible overflow |
| Reversibility | Work search and Review scope matched their visible pages; prepared Next choice reverted after reload |

That baseline preceded the dated hosted pass recorded below. This historical record does not establish current submission accessibility.

## Podium-pass verification — August 26, 2026

Verified at `2026-08-26T18:51:22-04:00` from source `c88575e0cfd9b24a4de3c958adc8bbeb70e6f9dc`. The main product pass is `fb2e7366f30e06683a8649e63472350ed3fdbf19`; `c88575e` is the narrow deterministic-Work follow-up.

Public judge URL (no account required): <https://projects-webmcp-extension.pages.dev/webmcp-challenge>

| Gate | Exact result |
| --- | --- |
| Source boundary | Public manifest matched exactly 76 files; four Svelte app routes plus the landing artifact; no Worker, Pages Function, backend, auth, billing, secret, or production-domain fallback |
| Automated gate | Svelte 0 errors/0 warnings; WebMCP 21 passed/0 failed; static artifact 4 passed/0 failed; production static build accepted |
| Historical GitHub verification | Run `33020885056` completed successfully for exact source `c88575e0cfd9b24a4de3c958adc8bbeb70e6f9dc`; it is retained as dated evidence, not a claim about the current tree. |
| Cloudflare production | Deployment `ffd5ac2b` recorded branch `main`, source `c88575e`, and Production environment |
| Tool inventory | 7 total: Guide 1; Work 2; Review 2; Next 2; route navigation invalidated the prior page catalog |
| Guide | Exact rendered projection returned 3 steps, 3 authority statements, and the `Confirm storage bin delivery` prompt |
| Work | Started 8 shown/8 matching/8 workspace/3 blocked; `Garage reset` returned 4 shown/4 matching/8 workspace/2 blocked, including `Garage reset: clear the floor` with workflow `Done` |
| Review | Started 5 shown/5 filtered/5 total review/3 blocked; blocked `Garage reset` scope returned 2 shown/2 filtered/3 search matches/5 total review/2 blocked and the visible reason `Blocked: Waiting on storage bins.` |
| Next | Started with exact custom action `Clear the garage floor`; prepared `Confirm storage bin delivery` with the visible evidence note; receipt reported `workspaceChanged: false` and `requiresHumanSave: true`; exact repeat returned `changed: false`; reload retained the pending approval and the shared navigation showed its exact resume count |
| Receipt truthfulness | Work and Review receipts each measured 1 immediately after their tool action and 0 after a later human search edit made the receipt stale |
| Focus | Work result, Review result, and Next receipt were all the active `:focus-visible` destination and fully in viewport; Next focus contrast measured 15.76:1 |
| 390 × 844 dark matrix | Guide, Work, Review, and Next each applied `rgb(15, 23, 20)` body background with one navigation row and no horizontal overflow; landing also had no horizontal overflow |
| Public request ledger | 79/79 captured requests used `https://projects-webmcp-extension.pages.dev`; 0 `/api/` requests; 0 external requests; 0 browser errors or warnings |
| Human authority | No tool called Save or wrote workspace data; `Approve and save` remained the only consequential boundary and was not invoked during verification |

## Natural-prompt discovery recheck — August 26, 2026

### Browser-observed evidence

Observed in the Codex in-app browser against the local Vite server at `http://127.0.0.1:5197` from source `80f9804b265d48eb7829e0ac35bc4239556f5fa6`. This is browser evidence from the assigned worktree, not a hosted-access or automated-contract result.

For each verbatim prompt below, the browser agent used only the current route catalog; the prompt itself did not contain a registered tool name. A pass required the catalog to supply the matching page capability, the returned projection to agree with the rendered page, and any page-local action to leave a visible receipt without saving workspace data.

| # | Route | Natural prompt (verbatim; tool-name-free) | Browser-observed result |
| --- | --- | --- | --- |
| 1 | Guide | What does this demo recommend I do, and which decisions stay mine? | Returned 3/3 guide steps and 3/3 authority statements; approval, saving, and discard stayed person-owned. |
| 2 | Work | How much work is visible right now, what is blocked, and what remains outside the visible page? | Returned 8 shown / 8 matching / 8 workspace / 0 remaining, with 3 blocked. |
| 3 | Work | Show only the Garage reset work and keep the full workspace denominator visible. | Returned 4 shown / 4 matching / 8 workspace / 0 remaining, with 2 blocked; the visible receipt repeated `4 shown of 4 matching · 8 workspace` and `Workspace data: Unchanged`. |
| 4 | Review | What currently needs attention in Review, and what are the total, filtered, shown, and remaining counts? | Returned 5 total review / 5 filtered / 5 shown / 0 remaining, with 3 blocked. |
| 5 | Review | Narrow Review to blocked Garage reset items and tell me why each one needs attention. | Returned 2 shown / 2 filtered / 3 search matches / 5 total review / 0 remaining, with 2 blocked; visible reasons were `Waiting on storage bins` and `Donation center pickup is not confirmed`, and the receipt said workspace data was unchanged. |
| 6 | Next | For Garage reset: sort shelves, what is currently in the next-action editor and what blocker is visible? | Returned custom action `Clear the garage floor`, blocker `Waiting on storage bins`, and no preparation receipt. |
| 7 | Next | Prepare “Confirm storage bin delivery” for my review, with a short note that the floor is already done and shelf sorting still waits on storage bins. Stop before saving. | Returned `changed: true`, `workspaceChanged: false`, and `requiresHumanSave: true`; the visible receipt repeated the action and note and ended with `Authority: Awaiting your Save`. |

| Route | Passed | Prompt denominator |
| --- | ---: | ---: |
| Guide | 1 | 1 |
| Work | 2 | 2 |
| Review | 2 | 2 |
| Next | 2 | 2 |
| **Total** | **7** | **7** |

Result: 7/7 natural prompts passed; 0/7 prompts contained a registered tool name.

### Automated contract evidence

The automated contracts are a separate denominator and are not counted as natural-prompt passes. `npm run test:webmcp` reported 24 passed / 24 total / 0 failed after the focused manifest rework. Its manifest fixture checks every reserved root entry once as a file and once as a directory, keeps all seven same-named nested source files in the exact manifest, and confirms that adding one legitimate source file makes the stale-manifest gate fail in both fixture shapes.

## Merged-main cold-start portability recheck — August 26, 2026

This recheck started from clean merged source `ba7efb131448b9f24f178a36ba9c897ce576f257`. It is the current cold-start record; the earlier records above remain dated historical evidence rather than claims about the present source tree.

The root and frontend locked installs completed from empty dependency directories with 0 reported vulnerabilities. `npm run verify` then matched 78/78 public source files, reported 0 Svelte errors and 0 warnings, passed 24/24 WebMCP contracts and 4/4 static-artifact contracts, and completed the production prerender. The built artifact was served with `npm --prefix svelte-frontend run preview -- --host 127.0.0.1 --port 5197` before any browser check.

| Client path | Tested | Supported | Exact result |
| --- | ---: | ---: | --- |
| Codex in-app browser | 1/1 | 1/1 | All four direct routes loaded and exposed their route-scoped WebMCP catalogs. |
| Connected Chrome extension | 0/1 | 0/1 | Unavailable in this environment; no Chrome WebMCP execution is claimed. |
| Independent Playwright Chrome | 0/1 | 0/1 | Chrome was not installed at the expected local channel; no execution is claimed. |
| Independent installed Edge (Chromium) | 0/1 | 0/1 observable runs | The browser process exited before a page session became observable; this is recorded as unavailable, not as a product pass or failure. |
| No-WebMCP registration path | 1/1 contract | 1/1 | The ordinary page path returned without inspecting tool descriptors; browser-level comparison was unavailable because neither independent Chromium path produced an observable session. |

| Route | Direct loads | Catalog tools | Exact observed catalog |
| --- | ---: | ---: | --- |
| Guide | 1/1 | 1/1 | `get_projects_handoff_guide` |
| Work | 1/1 | 2/2 | `get_current_work_view`, `show_work_search` |
| Review | 1/1 | 2/2 | `get_current_review_queue`, `set_review_scope` |
| Next | 1/1 | 2/2 | `get_current_next_editor`, `prepare_next_action` |
| **Total** | **4/4** | **7/7** | No cross-route or extra tools were present. |

| Behavior | Exact observed result |
| --- | --- |
| Registration teardown | 1/1 prior-route handle rejected after navigation as stale; registration contracts passed 6/6, including synchronous and asynchronous mixed-failure aborts. |
| Tool aborts | 7/7 route tools retain an explicit already-aborted execution contract in the 24/24 focused gate. |
| Work scope | 8 shown / 8 matching / 8 workspace / 3 blocked became 4 shown / 4 matching / 8 workspace / 2 blocked for `Garage reset`. |
| Review scope | 5 total review / 5 filtered / 5 shown / 3 blocked became 5 total review / 3 search matches / 2 filtered / 2 shown / 2 blocked. |
| Visible focus | Work result, Review result, and Next receipt passed 3/3 active-focus, `:focus-visible`, and in-viewport checks. |
| Reduced motion | 1/1 emulated reduced-motion Work action retained verified visible focus with the reduced-motion media query active. |
| Next authority | 1/1 current-editor read preserved `Clear the garage floor`; preparation reported `workspaceChanged: false` and `requiresHumanSave: true`; 1/1 exact repeat returned `changed: false`; 1/1 reload retained the proposal and note as a pending approval. |
| Clone-safe results | All 7/7 unique route tools returned through the browser WebMCP boundary without a serialization failure. |
| Request ledger | 79/79 requests used `http://127.0.0.1:5197`; 0/79 targeted `/api/`; 0/79 used an external origin; 0 browser errors or warnings were observed. |

Supported-client denominator: 1 tested / 1 supported. Independent Chrome-family denominator: 0 observable / 3 attempted paths (connected Chrome, local Chrome, installed Edge). The independent denominator is deliberately not combined with the in-app browser pass and does not imply Chrome WebMCP support.

## Current assigned-worktree reviewer-readiness state — August 28, 2026

This record covers the discoverable Guide scope rework on top of the earlier reviewer-readiness work. It supersedes the current-source counts in the earlier dated records without rewriting their historical observations.

| Gate | Current result |
| --- | --- |
| Public source boundary | 84 tracked public paths, including the route-owned editable Guide brief, scope chooser, Work action mapping, and verified Next evidence contract; no replacement CI or compatibility path remains. |
| Local automated gate | `npm run verify` passes with 84 tracked public paths, 0 Svelte errors, 0 warnings, 62/62 WebMCP contracts, 6/6 static-artifact contracts, and a completed static build. The earlier 47-contract denominator is superseded, not combined with this one. |
| Guide default | `All visible work` is selected immediately and exposes `Open all 8 work items` to `/work` in the current sample. |
| Discovered choices | The current sample renders `Household · 4` and `Research · 4` from observed area data and Work's shared search counter; these names are not fixed chooser behavior. |
| Custom truth | Custom keeps the shared 120-character/control-character validation; an unmatched term projects 0 matching of 8 workspace and exposes disabled `No work matches`, without a fallback Work link or invented work. |
| Focused arrival state | `/work?focus=garage-reset-sort-shelves` focuses and centers the matching card, applies a selected-surface wash, accent rail, 4px ring, and `Focused item` label for 4.2 seconds, then removes the arrival treatment while visible keyboard focus remains. |
| Action accountability | Work and Review getters leave no agent-change receipt. Successful scope presenters show the normalized visible scope and exact live denominators. Next accepts 1–3 exact Work or Review field/value references, requires one for the current item, rejects stale or mismatched facts, and generates its visible evidence note from the verified values. The draft remains unsaved and Save stays human-owned. Human edits or route teardown clear the affected attribution. |
| Verified Next evidence | Bare `/next` resumes the visible work item's human draft without agent provenance; a differing-choice WebMCP takeover presents Focus, rolls back exactly to the human draft on failure, and retains the WebMCP draft after success. Reload retains pending drafts, Discard restores the saved editor baseline without workspace writes, and approval atomically updates the target workspace item and consumes its draft. |

## Priority read-only checkpoint — August 29, 2026

This local checkpoint starts from merged source `b6d79be54124c8a94479023cf5369c3c9e5ca90e` on `newwork/priority-next-recommendation`. It is not a hosted-access claim. **Priority** is the competition-facing name and has one canonical `/priority` route; no prior route alias is retained.

| Gate | Exact result |
| --- | --- |
| Public source boundary | Manifest matched 87/87 paths; the artifact contains `priority.html`, while the retired route name remains in the forbidden-route contract only. |
| Automated gate | `npm run verify` passed: 0 Svelte errors, 0 warnings, 65/65 WebMCP contracts, 6/6 static-artifact contracts, and a completed static build. The focused Priority subset passed 3/3. |
| Visible projection | Priority rendered one recommendation with 4/4 fields: id `garden-study-log-interviews`, title `Garden study: log interviews`, href `/next?pack=garden-study-log-interviews`, and reason `Due in 6 days · No blocker or pending decision.` |
| Tool parity | The route catalog contained exactly 1/1 tool, `get_next_recommendation`. Its returned 4/4 fields matched the visible projection exactly, and the page URL was unchanged after invocation. |
| Read-only authority | The descriptor is closed and declares `readOnlyHint: true`, `openWorldHint: false`, and `untrustedContentHint: true`. Focused source contracts reject navigation, fetch, storage, and workspace mutation paths; the browser invocation used no write-capable operation. |
| Empty and unsupported fallback | With page scripts disabled, 1/1 direct `/priority` render showed `No actionable recommendation`, retained ordinary Guide/Priority/Work/Review/Next links, and exposed 0 WebMCP tools. |
| Lifecycle teardown | After navigation, the prior Priority handle failed as stale and `get_next_recommendation` was absent from the destination route catalog. |
| Responsive themes | At 390 × 844 with the single dark theme and reduced motion, document width was exactly 390px, horizontal overflow was false, all 5 nav links occupied 1 grid row, the recommendation stayed contained, and route animation was `none`. At 1280 × 720 in light mode, horizontal overflow was false and the 760px recommendation remained contained. |
| Browser console | 0 warnings and 0 errors on a fresh direct Priority load. |

## Priority single-destination focus — August 29, 2026

This local follow-up keeps Priority's visible and WebMCP projection unchanged while removing redundant navigation semantics from the recommendation card. It does not change selection, page registration, data, storage, or Wornpage.

| Gate | Exact result |
| --- | --- |
| Before baseline | The recommendation card exposed 3 links to the identical Next URL: its title, the literal Destination value, and `Open next action`. Under compact coarse-pointer emulation, the standalone Destination link was 288.2 × 21.5px. |
| One explicit action | The title and Destination remain visible text, while `Open next action` is the sole linked control. A red-first contract observed 3 destination bindings before the change and now requires exactly 1 plus all four visible projection fields. |
| Focused and full gates | Priority passed 3/3 focused contracts. `npm run verify` passed: manifest 87/87, Svelte 0 errors and 0 warnings, WebMCP 66/66, static artifacts 6/6, and a completed production build. |
| Compact rendered result | At 390 × 844 in dark mode with reduced motion and a coarse pointer, the card exposed exactly 1 link, `Open next action`, at 156.3 × 44px. Its real focus-visible state used a dashed 1.74px outline; route animation was `none` and horizontal overflow was false. |
| Rendered/tool parity | Title, reason, id, and href remained visible and matched the `get_next_recommendation` result exactly 4/4. Calling the getter did not change the URL. |
| Wide rendered result | At 1280 × 720 in forced light mode, the 759.9px card retained exactly 1 destination control at 147.5 × 36px with no horizontal overflow. |
| Lifecycle and fallback | Navigating to Work made the prior Priority handle fail as stale and exposed only Work's two page tools. With scripts disabled, Priority retained its empty explanation, `Open Work`, all five workflow links, no recommendation card, and 0 WebMCP tools. |
| Ownership and console | Route-specific composition stayed in Projects; no Wornpage extraction or compatibility path was added. Browser console remained at 0 warnings and 0 errors, and validation performed no workspace write or network mutation. |

## Work Quick Add density and compact parity — August 29, 2026

This local checkpoint keeps Quick Add on Work's existing `createPack` path. It makes the form density-independent and adds one optional, human-owned proof-target disclosure without adding storage, requests, or a WebMCP write operation.

| Gate | Exact result |
| --- | --- |
| Before baseline | Cards rendered 0 Quick Add forms while Grid rendered 1. At a requested 390 × 844 compact viewport (375px document client width), the form remained in the DOM but computed to `display: none`; the form, input, and button were all 0 × 0. The workspace stayed at `8 shown · 8 matching · 8 workspace · 3 blocked`. |
| One active path | The route now renders exactly 1 density-independent form before the repeated density panels. Its submit handler trims both values and calls the one canonical `createPack` owner with `doneWhen`; the focused contract rejects direct storage, state-save, and fetch paths. No Wornpage extraction was warranted for this route-specific composition. |
| Optional proof target | A native `details` disclosure labels the field `Proof target · Optional`, bounds it to 1,000 characters, and keeps the title-only path valid. Both fields reset after a successful create. Priority remains a separate read-only projection. |
| Focused contract | `node --test tests/work-webmcp-page-contract.test.mjs` passed 11/11, including form cardinality, density independence, compact availability, proof-target bounds, field reset, and canonical create-path assertions. |
| Automated gate | `npm run verify` passed: manifest 87/87, Svelte 0 errors and 0 warnings, WebMCP 67/67, static artifacts 6/6, and a completed production build. |
| Compact Cards | With dark color scheme, reduced motion, and coarse pointer enabled, Cards rendered exactly 1 form at 359.3 × 44px. Its 16px input was 307.1 × 44px and Add was 44.2 × 44px. Document width and scroll width were both 375px, horizontal overflow was false, and route animation was `none`. |
| Compact Grid | Switching to Grid retained exactly 1 form with the same dimensions and no horizontal overflow. Returning to Cards and collapsing filters left the input keyboard-focusable; the active element was `Quick-add a work item`, its value remained empty, and the workspace denominator stayed 8/8. |
| Wide and theme parity | At 1265 × 720, Cards and Grid each rendered exactly 1 visible 1176px-wide form with no horizontal overflow. Forced light mode rendered the light surface and retained the form; the default dark surface also retained it. |
| Rendered proof flow | In the production preview, opening the disclosure exposed one focusable proof-target textbox. Submitting title `Release proof target check` with proof `A reviewer can open the published proof note.` produced one success receipt, increased every honest workspace denominator from 8 to 9, rendered one new Work item, and cleared both inputs. The visible Guide reset restored the bundled 8-item sample afterward. |
| WebMCP boundary | The live Work catalog remained exactly `get_current_work_view` and `show_work_search`; no create tool was registered. Only the explicit human Add submission changed browser-local workspace state; tool discovery and inspection performed no workspace write, navigation, or network mutation. |
| Browser console | 0 warnings and 0 errors across the fresh production-preview acceptance. |
| Remaining boundary | Quick Add is intentionally human-owned browser-local demo state. Exposing creation as a WebMCP write remains a separate authority decision and is not implied by the optional proof target. |

## Work Recent activity heading hierarchy — August 29, 2026

This local checkpoint corrects the expanded Recent activity outline through Worn Timeline's existing public API. It changes no activity data, disclosure behavior, navigation, storage, or WebMCP operation.

| Gate | Exact result |
| --- | --- |
| Before baseline | With Recent activity expanded, the accessibility tree moved from Work's level-1 heading directly to 6 timeline entry headings at level 3. The accordion summary is a native disclosure control, not a level-2 heading. |
| Ownership decision | Work already supplied Worn Timeline's public `headingLevel` prop, so the route changed that value from 3 to 2. `@wornpage/data-display` remains unmodified; its installed source-delivery v2 package explicitly supports levels 2–6 and passed its complete 20/20 package contract. |
| Red-first contract | The new Work assertion failed with 10/11 passing while the route still supplied level 3, then passed 11/11 after the one-line correction. |
| Automated gate | `npm run verify` passed: manifest 87/87, Svelte 0 errors and 0 warnings, WebMCP 67/67, static artifacts 6/6, and a completed production build. |
| Compact rendered result | At a requested 390 × 844 compact viewport (375px document width) in dark mode with reduced motion and a coarse pointer, the expanded tree exposed exactly 6 level-2 and 0 level-3 entries. Cards and Grid retained the same six levels, no horizontal overflow, and `8 shown · 8 matching · 8 workspace · 3 blocked`. The disclosure was 359.3 × 44px and activity links were at least 65.1px tall. |
| Wide rendered result | At 1265 × 720 in forced light mode, the expanded timeline retained exactly 6 level-2 entries, no horizontal overflow, and the same 8/8 denominator. The disclosure was 1176 × 44px with a dashed 1.74px focus-visible outline; activity links were at least 48.1px tall. |
| WebMCP and console | Work's page catalog remained exactly `get_current_work_view` and `show_work_search`. Browser console remained at 0 warnings and 0 errors, and validation performed no workspace write or network mutation. |

## Shared toast lifecycle checkpoint — August 29, 2026

This checkpoint starts from Projects source `bdefb75eaaaf808b7b93812bdf9407ffe5975a59` and the prior immutable WornToast source `bdc6f6d6f7d4124cda84dbb8efa6fd3644a1356b`. The accepted WornToast `0.1.6` candidate is published at immutable commit `f8b12dbab5b5072e7a2f009ef52a9417a3cbde64` and Projects pins that exact archive.

| Gate | Exact result |
| --- | --- |
| Before baseline | Projects scheduled unconditional store removal at 4 seconds in `displayToast` and 5 seconds in receipt undo while WornToast already owned a 3-second interaction-aware timer. At 390 × 844, a focused Dismiss control disappeared by 4.3 seconds and focus fell to `BODY`. Route-specific producers and capped `slice(-4)` paths could also evict a focused toast. |
| One active path | Routes and undo now append through `displayToast`; WornToast emits `ondismiss`; and the layout filters only that id. Both store-level timers, both capped eviction paths, all direct route-store producers, and the undo-only wrapper were deleted. The recursive ownership contract permits exactly one append mutation and one component-event removal mutation across production source. |
| WornToast contract | The component bumps to `0.1.6` without changing its public props, exports, or custom-element events. Its open composed-tree recovery walks following sibling shadow roots and assigned slots, rejects hidden, inert, disabled, untabbable, or toast-owned targets, then falls back to the nearest previous eligible target. Source and behavioral suites passed 29/29 with 77 assertions; build and the nine-entry package dry-run passed. |
| Automated gate | With the prior immutable dependency, the exact local candidate overlay, and finally the published immutable SHA, `npm run verify` passed: manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 68/68, static artifacts 6/6, and completed static builds. The prior package built 357 SSR / 328 client modules; `0.1.6` built 358 / 329. The focused ownership contract also verifies the exact package URL, lockfile version, and resolved archive because this extraction does not expose the larger repository's component-check script. |
| Compact focus hold | At 390 × 844 in dark mode with normal motion and a fine pointer, the focused Dismiss control remained connected and `:focus-visible` with 1 toast after 4.3 seconds. Moving focus to `Reset live sample` resumed the shared timer; after 3.3 seconds the toast count was 0 and Reset retained focus. Horizontal overflow was 0px. |
| Six-toast stress | Six rapid ordinary Reset actions rendered 6/6 simultaneous toasts. With the first Dismiss control focused, the five unheld toasts dismissed through WornToast while the original remained connected, active, and `:focus-visible` after 4.3 seconds; moving focus away then removed the final toast. Horizontal overflow remained 0px. |
| Wide and pointer checks | At 1280 × 900 in dark mode, the 32 × 32px fine-pointer Dismiss control passed the same 4.3-second focus hold and resumed removal without horizontal overflow. A real pointer dismissal removed the toast and left focus on `BODY`, so pointer use does not force keyboard recovery. Manual keyboard recovery is covered by the component's focus-visible and `MouseEvent.detail === 0` behavioral contracts; the in-app browser key helper focused the button but did not synthesize its activation, so this checkpoint makes no rendered Enter-key claim. |
| WebMCP and data boundary | Guide discovery remained exactly one page-owned, read-only `get_projects_handoff_guide` tool with the same descriptor. No WebMCP tool was invoked. This slice changed no registration, request, workspace storage, pending draft, save, or Quick Add transaction path; rendered toast checks used only the visible browser-local sample reset. |

## Compact Quick Add focus boundary checkpoint — August 29, 2026

This checkpoint addresses the user-observed clipped Quick Add focus outline below 500px without changing its canonical `createPack` transaction or optional proof-target mapping.

| Gate | Exact result |
| --- | --- |
| Before baseline | At 390 × 844, the Quick Add input and compact `.demo-list-panel` both began at x = 8.0px. WornInput's 1.74px dashed outline plus 1.74px offset extended 3.49px beyond the input, while the panel used `overflow: hidden`, producing −3.49px start clearance and clipping the outline. |
| Ownership decision | The shared WornInput focus treatment is correct, and the folded surface only establishes its decorative boundary. Work now insets its route-owned Quick Add grid by 4px inline only while the compact panel clips; no shared Wornpage API or generic panel behavior changed. |
| Focused contract | The existing Quick Add contract now requires the exact compact inset while continuing to prove one form, one `createPack` call, one optional proof target mapped to `doneWhen`, and no direct storage or network shortcut. The focused Work suite passed 11/11. |
| Rendered compact matrix | At 499px the focused title input had +0.51px clearance beyond its full outline and 0px horizontal overflow. At both 390px and 320px, the focused title input, enabled Add button, and expanded proof-target input each had +0.51px inline clipping clearance, remained `:focus-visible`, and produced 0px horizontal overflow. The Add control remained 44px high at 390px and 320px. |
| Boundary control | At the 500px compact boundary, the panel remains `overflow: hidden` and the 4px route inset remains active, so the outline keeps its reserved clearance. At 501px, panel overflow becomes visible and the compact inset is absent, allowing the full outline to paint outside the panel without adding wide-layout indentation. |
| WebMCP and data boundary | Work discovery remained exactly `get_current_work_view` and `show_work_search`. No tool was invoked. Browser validation filled only unsaved page-local Quick Add fields, performed no submit, and changed no workspace, draft, storage, or network state. |
## Work terminal due-date truthfulness — August 29, 2026

This local checkpoint keeps completed and archived work out of Work's urgency semantics while preserving their historical due dates. It changes no work data, filter control, storage path, page-tool registration, or workspace-write authority.

| Gate | Exact result |
| --- | --- |
| Before baseline | Work displayed `Overdue 3`; selecting it rendered 3/3 matching of 8 workspace: one blocked item plus two completed items. Both completed cards and `get_current_work_view` called their past due dates overdue. The same two completed records also carried overdue wording in Review. |
| Expected observable improvement | Terminal work keeps a neutral `Due YYYY-MM-DD` fact, receives no overdue styling, and never contributes to or appears in Work's Overdue scope. Open past-due work remains explicitly overdue. Human and page-tool counts and labels must stay exact. |
| One active path | The existing `dueUrgency` and `dueDateLabel` owners now accept the complete work item and suppress urgency when status is done or the item is archived. Work metadata, urgency sorting/filtering, both Work card densities, Work and Review projections, and Review copy all migrated to that pack-aware contract. The date-only call path was removed; no compatibility wrapper, alias, fallback, or Wornpage change was added. |
| Red-first and focused contract | The new Work contract first failed with 11/12 passing because metadata supplied only the due string and therefore could not distinguish terminal work. After the hard cutover, `node --test --test-reporter=spec tests/work-webmcp-page-contract.test.mjs` passed 12/12 and Svelte diagnostics passed with 0 errors and 0 warnings. |
| Compact dark result | At 390 × 844 with a coarse pointer, dark color scheme, and reduced motion, the default Grid rendered `Overdue 1`; the two Done cards retained `Due 2026-08-25` and `Due 2026-08-23` with zero overdue classes. Selecting the focused `Overdue 1` chip rendered exactly one Blocked item and `1 shown · 1 matching · 8 workspace · 1 blocked`; the chip was focus-visible, fully inside the viewport, route animation was none, and horizontal overflow was zero. |
| Density parity | Compact Cards preserved the exact one-item overdue scope and getter result. Clearing filters restored 8/8 work, two neutral Done dates, zero Done overdue classes, and `Overdue 1`, with zero horizontal overflow. |
| Wide light result | At 1280 × 900 in light mode, Cards retained the two neutral Done dates, zero Done overdue classes, and `Overdue 1`. Selecting it again rendered the exact one blocked item with 1/1/8 counts, a focus-visible chip fully inside the viewport, and zero horizontal overflow. |
| Page-tool truthfulness and lifecycle | Work retained exactly `get_current_work_view` and `show_work_search`; the overdue getter result matched the one rendered blocked item and exact 1/1/8/1 denominators. Review returned completed items with neutral dates. Navigating to Review made the prior Work handle fail as stale and exposed only `get_current_review_queue` and `set_review_scope`. Only read-only getters were invoked; no receipt, storage write, workspace mutation, or network mutation occurred. |
| Bundle and cleanup | The production build remained 357 SSR and 328 client modules. Work changed from 78.98 / 16.39 to 78.94 / 16.39 kB gzip; Review from 37.69 / 9.16 to 37.68 / 9.15; their shared client nodes decreased from 48.55 / 15.34 to 48.52 / 15.32 and from 25.09 / 8.61 to 25.08 / 8.60. Cleanup restored Grid, unfiltered 8/8 work, normal motion, default Guide state, no pending navigation, and closed the temporary tab and preview. |

## Work Cards landmark naming — August 29, 2026

This local checkpoint starts from `6dc0cb70f56776108810ab31a2780857d69044c6` and gives every Cards-density work-item landmark the exact title already projected by Work. It changes no work data, action, navigation, focus owner, storage path, draft path, or page-tool registration.

| Gate | Exact result |
| --- | --- |
| Before baseline | Work's default Grid was already correct: the full accessibility tree exposed one `Work items grid` list with 8 list items and no article landmarks. Switching to Cards exposed 8 nonignored article landmarks, but every article name was empty. |
| Expected observable improvement | Cards must expose 8 identifiable article landmarks named `Work <visible title>` while Grid retains its existing one-list/eight-list-item collection semantics. Work's visible cards, counts, density projection, and keyboard behavior must otherwise remain unchanged. |
| One active path | The existing route-owned `WorkListCard` now supplies ``aria-label={`Work ${workTitle(pack)}`}`` directly to its existing `WornFoldedSurface` article. The canonical `workTitle(pack)` owner remains the single title source; no wrapper, alias, fallback, parallel component, or Wornpage change was added. |
| Red-first and focused contract | The new two-density collection assertion first failed with 12/13 passing because `WorkListCard` supplied no label. After the direct owner fix, `node --test --test-reporter=spec tests/work-webmcp-page-contract.test.mjs` passed 13/13 and Svelte diagnostics passed with 0 errors and 0 warnings. |
| Compact rendered result | At requested 390 × 844 and 320 × 568 viewports in dark mode with reduced motion and a coarse pointer, the full accessibility tree exposed all 8 exact `Work <title>` article names. Document client/scroll widths were 375/375px and 305/305px. The first article retained a visible focus ring and fit within each viewport after focus presentation; animation and transition durations reduced to `0.000001s`. |
| Wide rendered result | At 1280 × 900 in light mode, all 8 article names remained exact. Document client and scroll widths were both 1265px; the first article was focus-visible and fully inside the viewport. Normal motion retained the existing 0.26-second settle animation. |
| Density and page-tool truthfulness | Returning to Grid restored exactly one named list, 8 list items, and 0 article landmarks. `get_current_work_view` reported density `card` or `grid` to match the selected visible tab and retained exact 8 shown / 8 matching / 8 workspace / 0 remaining / 3 blocked counts. Invoking the getter added no visible resource or receipt. |
| Registration lifecycle | Work discovery remained exactly `get_current_work_view` and `show_work_search`, with the getter read-only and the page-local search setter correctly non-read-only. Navigating to Review made the prior Work handle fail as stale and exposed only `get_current_review_queue` and `set_review_scope`. No workspace write, storage mutation, draft mutation, or network mutation was performed. |
| Automated gate and bundle | `npm run verify` passed: manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and the production build at 358 SSR / 329 client modules. The Work server entry changed from 78.80 / 16.31 to 78.85 / 16.32 kB gzip. |
| Fresh preview and cleanup | A fresh production preview repeated the compact 390px result with all 8 exact article names, 375/375px document widths, visible in-viewport article focus, truthful `card` density, and unchanged 8/8/8/0/3 counts. Cleanup restored Grid, collapsed secondary filters, default Guide state, normal media emulation, zero temporary tabs, and a closed preview port. |

## Work Quick Add form landmark — August 29, 2026

This local checkpoint starts from `6dc0cb70f56776108810ab31a2780857d69044c6` and gives Work's existing Quick Add form a stable accessible name. It changes no field, submission, work data, storage path, draft path, navigation, or page-tool registration.

| Gate | Exact result |
| --- | --- |
| Before baseline | At compact 390px dark/reduced/coarse and wide 1280px light, the full accessibility tree exposed exactly one form landmark on Work and its name was empty. The title textbox itself was already named `Quick-add a work item`; the failure belonged to the containing form landmark. A five-route compact audit found no other new unnamed primary surface outside Review's already-isolated featured-article candidate. |
| Expected observable improvement | Work must expose exactly one form named `Quick add a work item` at compact and wide widths while retaining the independently named textbox, one density-independent form, the canonical `createPack` transaction, optional proof target, existing focus treatment, and zero horizontal overflow. |
| One active path | The route-owned native `.quick-create-row` form now carries `aria-label="Quick add a work item"`. The existing input, button, submit handler, `quickCreate`, and canonical `createPack` call remain the only active path. No component, wrapper, alias, fallback, compatibility layer, or Wornpage change was added. |
| Red-first and focused contract | The strengthened existing Quick Add assertion first failed with 11/12 passing because the form had no label, then `node --test --test-reporter=spec tests/work-webmcp-page-contract.test.mjs` passed 12/12 after the direct owner fix. Svelte diagnostics passed with 0 errors and 0 warnings. |
| Compact rendered result | At requested 390 × 844 and 320 × 568 viewports in dark mode with reduced motion and a coarse pointer, the full tree exposed exactly `form "Quick add a work item"`. Document client/scroll widths were 375/375px and 305/305px. The title textbox retained its exact independent name and visible focus ring; the form stayed fully in view at 351.3 × 96.0px and 281.0 × 96.0px, and animation/transition durations reduced to `0.000001s`. |
| Wide rendered result | At 1280 × 900 in light mode, the tree retained exactly the same one named form. Its 1175.9 × 88.0px boundary and focused textbox remained inside the 1280px document, client and scroll widths both stayed 1280px, and the visible Grid and 8/8 workspace were unchanged. |
| Page-tool truthfulness and lifecycle | Work discovery remained exactly `get_current_work_view` and `show_work_search`. The read-only getter stayed silent, reported Grid density, and retained exact 8 shown / 8 matching / 8 workspace / 0 remaining / 3 blocked counts. Navigating to Review made the prior Work handle fail as stale and exposed only `get_current_review_queue` and `set_review_scope`. No setter, form submission, receipt, workspace write, storage mutation, draft mutation, or network mutation was performed. |
| Automated gate and bundle | `npm run verify` passed: manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 69/69, static artifacts 6/6, and the production build at 358 SSR / 329 client modules. The Work server entry changed from 78.80 / 16.31 to 78.84 / 16.33 kB gzip. |
| Cleanup | Validation restored default Grid, unfiltered 8/8 work, default Guide state, normal media emulation, zero temporary tabs, and a closed preview port. The slice remains local, uncommitted, and unpushed. |

## Work primary-action names — August 29, 2026

This local checkpoint gives Work's repeated primary commands exact work-item context without changing their visible labels, destinations, mutations, card interactions, data projection, or page tools.

| Gate | Exact result |
| --- | --- |
| Before baseline | The default Grid rendered eight primary actions with no `aria-label`. Its accessibility tree exposed `Review blocker` three times, `Review work` twice, and `Set next action` twice under unnamed list items; only `Start` was unique. The five-route compact and wide audits otherwise found no new overflow, clipped controls, empty interactive names, duplicate IDs, heading jumps, or broken references beyond the separately recorded immutable disclosure-pin boundary. |
| Expected observable improvement | Each primary action keeps its complete visible command as the accessible-name prefix and adds `for <work title>`, making all eight names unique in both Work densities. Visible copy, navigation URLs, mutation selection, focus behavior, counts, and workspace state must remain unchanged. |
| One active path | The existing `WorkGridCard` and `WorkListCard` owners add one contextual `aria-label` to each of their existing navigation and mutation branches. No wrapper, alternate action, shared Wornpage change, route helper, fallback, compatibility path, or second data owner was added. |
| Red-first and focused gates | The new contract first failed with 12/13 passing because all four action branches lacked contextual names. After the owner fix, `node --test tests/work-webmcp-page-contract.test.mjs` passed 13/13 and Svelte diagnostics passed with 0 errors and 0 warnings. |
| Complete gate | `npm run verify` passed: manifest 88/88, Svelte 0/0, WebMCP 70/70, production build 358 SSR / 329 client modules, and static artifact 6/6. `git diff --check` passed. |
| Compact rendered result | At 390 × 844 in dark mode with reduced motion and a coarse pointer, Grid and Cards each exposed 8/8 nonempty and 8/8 unique contextual names while retaining the exact visible strings `Review blocker` ×3, `Review work` ×2, `Start` ×1, and `Set next action` ×2. Every focused Grid action was `:focus-visible`, fully in viewport, and 44px tall. Both densities retained `8 shown · 8 matching · 8 workspace · 3 blocked` and 0px horizontal overflow. |
| Wide rendered result | At 1280 × 900 in light mode with normal motion and a fine pointer, Cards and Grid each retained the same 8/8 unique accessibility-tree names, visible strings, and exact counts with 0px horizontal overflow. All eight focused Card actions were visible, `:focus-visible`, and 35.99px tall, above the 32px desktop threshold. |
| Page-tool and data boundary | Work still exposed exactly `get_current_work_view` and `show_work_search`; the read-only getter returned 8 shown / 8 matching / 8 workspace / 0 remaining / 3 blocked. Navigating to Review made the old Work handle reject as stale and exposed only `get_current_review_queue` and `set_review_scope`. No setter, form submission, navigation action, storage write, workspace mutation, or network mutation was invoked; browser diagnostics contained 0 entries. |
| Bundle delta | The Work server route moved from 78.80 / 16.31 to 79.05 / 16.35 kB raw/gzip, and its client node from 48.41 / 15.28 to 48.72 / 15.31 kB. Shared chunks and every other route stayed unchanged. |

## Next custom-action length parity — August 29, 2026

This local checkpoint makes the human Next editor and its page-owned WebMCP metadata enforce the same existing 200-character action boundary. It adds no route, draft owner, storage owner, save path, or Wornpage component change.

| Gate | Exact result |
| --- | --- |
| Before baseline | `prepare_next_action` declared and rejected choices over 200 characters, and the canonical workspace write normalized the saved action to 200, but the human custom input had no `maxlength`. Its existing input handler could therefore persist an over-limit browser-local pending draft before approval. |
| One explicit boundary | `NEXT_ACTION_MAX_LENGTH` is exported once by Next's page helper and now owns the choice and expected-choice schemas, runtime validation, action projection bounds, the rendered WornInput `maxlength`, and the existing human input handler's bound. The handler still calls the same `savePendingNextActionDraft`; approval still calls the same `setPackNextAction`; no compatibility or fallback path was added. |
| Red-first and focused contract | The new boundary contract observed 12/13 passing while the shared constant and rendered bound were absent, then again while the human handler still accepted a programmatic over-limit value. After the hard cutover, `node --test --test-reporter=spec tests/next-webmcp-page-contract.test.mjs` passed 13/13. |
| Automated gate | `npm run verify` passed: manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed 358-SSR / 329-client-module production build. |
| Compact rendered bound | At a requested 390 × 844 viewport (375px document width) with dark color scheme, reduced motion, and a coarse pointer, the custom input exposed `maxlength=200`. A 225-character browser-automation input event left both the rendered value and its single human pending draft at exactly 200; the saved workspace action remained `Clear the garage floor`, document overflow was 0px, and browser diagnostics were empty. |
| Page-tool truthfulness | Next exposed exactly `get_current_next_editor` and `prepare_next_action`. After cleanup, the getter returned the visible 22-character custom action and no preparation receipt. A 201-character preparation failed with `choice must be 200 characters or fewer`; it created no pending link, receipt, storage snapshot, or workspace write. |
| Wide and cleanup | At 1280 × 900 in light mode, the 1121.7 × 44px input remained fully in the viewport with `maxlength=200` and 0px horizontal overflow. The visible Guide reset removed the temporary pending draft; the final Next state had no pending navigation, retained the original saved action, and produced 0 browser warnings or errors. |

## Work search length parity — August 29, 2026

This local checkpoint keeps the visible Work search inside the same existing 120-character contract as its page-owned WebMCP operation and exact current-view projection. It changes no workspace field, search algorithm, URL route, registration owner, storage owner, or Wornpage package.

| Gate | Exact result |
| --- | --- |
| Before baseline | The visible search had no `maxlength` and accepted 121 characters, rendering `0 shown · 0 matching · 8 workspace`. Work still exposed exactly two page tools, but `get_current_work_view` returned `null` because the canonical projection already rejects search values over 120. |
| One explicit boundary | The existing constant is now exported as `WORK_SEARCH_MAX_LENGTH = 120` and continues to own tool metadata, caller validation, route normalization, and exact projection validation. Route-specific `WorkFilterControls` imports that constant for WornInput `maxlength` and bounds the existing human `query` binding in its input handler. No second query, filter, receipt, registration, or persistence path was added. |
| Red-first and focused contract | The new source contract first failed with 12/13 passing because the human control did not share the canonical limit, then passed 13/13 after the hard cutover. |
| Automated gate | `npm run verify` passed: manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed 358-SSR / 329-client-module production build. |
| Compact rendered parity | At a requested 390 × 844 viewport (375px document width) with dark color scheme, reduced motion, and a coarse pointer, a 121-character browser-automation input event produced a 120-character visible value. The input exposed `maxlength=120`, measured 346.2 × 44px, stayed fully in the viewport, and had 0px document overflow. The getter returned search and applied-search lengths of 120 with exact 0 shown / 0 matching / 8 workspace / 0 items. Browser diagnostics were empty. |
| Page-tool truthfulness | Work exposed exactly `get_current_work_view` and `show_work_search`; the setter schema retained `maxLength: 120`. A 121-character tool input failed with `Work search query must be 120 characters or fewer.`, retained the existing human 120-character scope, rendered 0 agent receipts, and created no workspace storage snapshot. |
| Wide and cleanup | At 1280 × 900 in light mode, the same bound produced a 120-character getter-visible scope; the 926.9 × 44px input stayed fully visible with 0px overflow and no workspace storage. Visible Clear search restored 8 shown / 8 matching / 8 workspace / 3 blocked, returned focus to `Filter work items by text`, and left browser diagnostics empty. |
| Bundle boundary | The build stayed at 358 SSR / 329 client modules. Work moved from 78.80 / 16.31 to 78.96 / 16.38 kB gzip; its client node moved from 48.41 / 15.28 to 48.49 / 15.32. The shared `work-webmcp` server chunk moved from 12.81 / 3.69 to 12.73 / 3.67. No other route or shared component source changed. |

## Work Quick Add title-length parity — August 29, 2026

This local checkpoint makes Quick Add's visible unsaved title agree with the canonical create owner's stored-title boundary. It adds no create tool, storage path, request, draft, or compatibility behavior.

| Gate | Exact result |
| --- | --- |
| Before baseline | Quick Add exposed no `maxlength`; a 225-character automation fill remained 225 characters and enabled Add. The only canonical `createPack` transaction normalized the title to 200 characters, so the visible pre-submit value could disagree with the value that a human submission stored. No submit was performed. |
| Expected observable improvement | Human typing and programmatic input must settle to the same explicit 200-character title accepted by `createPack`, while the ordinary 1-form Quick Add flow, optional proof target, workspace data, and Work page-tool catalog stay unchanged. |
| One active boundary | `DEMO_WORK_TITLE_MAX_LENGTH = 200` is exported by the existing browser-state owner. `createPack` and Work's route-owned Quick Add input consume that exact constant. The input exposes native `maxlength`, and its input handler clamps the live DOM value before WornInput's binding reads it; no second create or persistence path was added. |
| Red-first and focused contract | The added source contract first failed with 12/13 Work checks passing because the shared constant was absent. After the cutover, `node --test tests/work-webmcp-page-contract.test.mjs` passed 13/13, including the one canonical `createPack` path and the native-plus-handler boundary. |
| Automated gate | `npm run verify` passed on the implementation tree: public manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed production build with 358 SSR and 329 client modules. |
| Compact rendered result | At a requested 390 × 844 viewport in dark mode with reduced motion and a coarse pointer, the 375px document received 225 characters and settled to exactly 200. The DOM reported `maxlength="200"` and `maxLength = 200`; Add was enabled, the input occupied x = 12.0–311.1px inside its x = 12.0–363.3px row, and document client/scroll widths both remained 375px. Canonical workspace storage remained absent. |
| Wide rendered result | At a requested 1280 × 900 viewport in light mode with normal motion and a fine pointer, the 1265px document again settled 225 characters to exactly 200. The 1127.1px input stayed inside its 1176.0px row, document client/scroll widths both remained 1265px, and workspace storage remained absent. |
| Bundle observation | Module cardinality stayed at 358 SSR / 329 client. Work SSR moved from 78.80 / 16.31 to 79.05 / 16.38 kB gzip and its client node from 48.41 / 15.28 to 48.53 / 15.33 kB gzip; no new module, request, or active path accounts for the bounded handler cost. |
| WebMCP and data boundary | Work discovery remained exactly `get_current_work_view` and `show_work_search`; no create tool was registered or invoked. Rendered checks did not submit Quick Add. A final reload cleared the unsaved field, disabled Add, retained 8/8 workspace state, and confirmed canonical workspace storage was still absent. |

## Review search human/WebMCP parity — August 29, 2026

This local checkpoint keeps Review's visible human search inside the same page-local boundary already declared and enforced by `set_review_scope`. It changes no queue data, filter semantics, storage path, receipt, registration, or Wornpage API.

| Gate | Exact result |
| --- | --- |
| Before baseline | Review exposed native `maxlength="120"`, but a 121-character automation fill remained visibly 121 and rendered `0 of 5 scoped · 0 blocked`. The WebMCP setter rejected 121, and `reviewPageView` could not project that over-limit human scope, so the visible page and its current-view getter owner could disagree. |
| Expected observable improvement | Human typing and programmatic input must settle to the same explicit 120-character query accepted by the Review projector and advertised by the page tool, while exact queue denominators, page-local authority, and workspace data remain unchanged. |
| One active boundary | `REVIEW_SEARCH_MAX_LENGTH = 120` is exported by the existing Review WebMCP helper. The tool schema, validator, error, normalizer, route input, and bound Review filter control consume that one constant. The control clamps the live DOM value before WornInput's binding reads it; no alias, fallback, second scope setter, or compatibility path was added. |
| Red-first and focused contract | The new invariant first failed with 7/8 Review checks passing. The implementation then exposed one obsolete literal-max assertion; migrating that assertion completed the hard cutover. `node --test tests/review-webmcp-page-contract.test.mjs` passed 8/8, including exact acceptance at 120 and rejection at 121. |
| Automated gate | `npm run verify` passed on the implementation tree: public manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed production build with 358 SSR and 329 client modules. |
| Compact rendered result | At a requested 320 × 844 viewport in dark mode with reduced motion and a coarse pointer, 121 characters settled to exactly 120. The input remained focused and `:focus-visible`, reported native and DOM maxima of 120, occupied x = 14.6–305.5px, and rendered the exact `0 of 5 scoped · 0 blocked` denominator. Document client/scroll widths both remained 320px, and the 5,630-character workspace snapshot was byte-for-byte unchanged. |
| Wide rendered result | At a requested 1280 × 900 viewport in light mode with normal motion and a fine pointer, 121 again settled to exactly 120. The focused 472.2px input stayed contained at x = 745.4–1217.7px, document client/scroll widths both remained 1280px, and workspace storage was byte-for-byte unchanged. |
| Bundle observation | Module cardinality stayed at 358 SSR / 329 client. Review SSR moved from 37.37 / 9.09 to 37.58 / 9.15 kB gzip and its client node from 24.85 / 8.55 to 24.96 / 8.57 kB gzip; the bounded handler added no module, request, or active state path. |
| WebMCP, data, and cleanup boundary | Review discovery remained exactly `get_current_review_queue` and `set_review_scope`, with `query.maxLength = 120`; no tool was invoked. Reloading cleared the unsaved query, restored `5 to review · 3 blocked`, kept client/scroll widths equal, and left workspace storage byte-for-byte unchanged. |

## Review header denominator truthfulness — August 29, 2026

This local checkpoint makes Review's compact page status name the denominator behind every scoped count. It changes only route-owned status copy; queue selection, cards, filters, receipts, storage, page-tool projections, and Wornpage remain unchanged.

| Gate | Exact result |
| --- | --- |
| Before baseline | Selecting `No next 2` rendered exactly 2 Review articles but announced `2 of 5 scoped · 3 blocked`. The 3 blocked items belonged to the broader 5-item search-match set, not the 2-item filtered scope, so the unlabeled denominator made the compact status internally impossible to interpret. Client and scroll widths were both 305px. |
| Expected observable improvement | Preserve the concise default `5 to review · 3 blocked`; make search-only states name search matches and total review; and make subfiltered states name filtered scope, search matches, and total review without changing any underlying count. |
| Route ownership | Review's existing derived `reviewTitle` remains the only status owner. Its All branch distinguishes default and search-only states; its subfilter branch uses the already-derived `filteredVisible`, `visible`, and `reviewTotal` counts. No shared component, helper alias, compatibility path, or second denominator calculation was added. |
| Red-first and focused contract | The new source contract first failed with 7/8 Review checks passing on the old mixed status. After the narrow copy change, `node --test tests/review-webmcp-page-contract.test.mjs` passed 8/8 and rejects restoration of the unnamed blocked count. |
| Automated gate | `npm run verify` passed on the implementation tree: public manifest 88/88, Svelte 0 errors and 0 warnings, WebMCP 70/70, static artifacts 6/6, and a completed production build with 358 SSR and 329 client modules. |
| Compact dark result | At a requested 320 × 844 viewport with reduced motion and a coarse pointer, `No next 2` rendered exactly 2 articles and `2 scoped · 5 search matches · 5 total review`. Client/scroll widths remained 305/305px, and workspace storage was byte-for-byte unchanged. Returning to All and entering `Garage reset` rendered exactly 3 articles and `3 search matches · 5 total review`. |
| Wide light result | At a requested 1280 × 900 viewport with normal motion and a fine pointer, `Blocked 3` rendered exactly 3 articles and `3 scoped · 5 search matches · 5 total review`. The 234.9px status stayed inside x = 977.8–1212.7px, client/scroll widths remained 1265/1265px, and workspace storage was byte-for-byte unchanged. |
| Bundle observation | Module cardinality stayed at 358 SSR / 329 client. Review SSR moved from 37.37 / 9.09 to 37.48 / 9.12 kB gzip and its client node from 24.85 / 8.55 to 24.95 / 8.56 kB gzip; the copy-only branch added no module, request, or state path. |
| WebMCP, data, and cleanup boundary | Review discovery remained exactly `get_current_review_queue` and `set_review_scope`; no tool was invoked and their explicit returned denominators were unchanged. Reloading restored 5 visible articles, empty search, `5 to review · 3 blocked`, equal client/scroll widths, and byte-identical workspace storage. |

## Browser-agent path

1. Open `/webmcp-challenge`.
   - Keep **All visible work** selected. It is the default and exposes **Open all 8 work items** to `/work`; no taxonomy knowledge or editing is needed.
   - Ask the browser agent: `Follow the brief on this page.` Verify the returned projection contains the exact default `agentBrief`, empty `workQuery`, selected All scope, 8 matching, and 8 workspace for the current sample.
   - Click **Use fast-create brief**. Verify the visible 453-character brief and Guide reader both authorize exactly three browser-local Drafts, forbid Save/Start/block/completion/deletion, and stop on the `create_work_drafts` receipt. Click **Reset** and confirm the original no-workspace-change brief returns before continuing.
   - Choose one displayed alternative. In the current sample, the observed data-backed choices are `Household · 4` and `Research · 4`; verify the selected label, deterministic query, 4 matching, and 8 workspace agree in the visible Guide and tool result.
   - Choose **Research** and verify **Open 4 Research items** leads to `/work?search=Research`, where Work immediately shows 4 matching of 8. Choose **Custom**, enter `Definitely absent work term`, and verify disabled **No work matches** replaces the link; then ask `Follow the brief on this page.` Verify the Guide returns the exact normalized query with 0 matching of 8 workspace and Work reports 0 matching and 0 shown, preserves the full denominator, and invents no result.
   - Open the compact global **WebMCP** pill. Verify it shows exactly `1 tool` on Guide and that the dialog names `get_projects_handoff_guide`, reproduces its descriptor description, labels it **Read only**, and reports the truthful native browser status.
   - `Ready` is allowed only after the native registration promise resolves; API detection alone must remain `Connecting`. If the dialog reports native WebMCP unavailable, use Copy brief and follow the three visible buttons. A nonempty derived or Custom scope must remain in the copied instructions.
   - In a compatible browser, discover `get_projects_handoff_guide`.
   - Confirm its result matches the visible three-step workflow, safety copy, current editable brief, every displayed scope choice and count, the selected query, and the workspace denominator.
2. Open `/priority`.
   - Discover `get_next_recommendation` only.
   - Verify its id, title, href, and reason match the single visible recommendation exactly, and that invoking it neither navigates nor changes workspace data.
   - If no item is actionable, verify the visible empty state and a `null` result instead of an invented recommendation.
3. Open `/work`.
   - Discover exactly `get_current_work_view`, `show_work_search`, and `create_work_drafts`.
   - Read the view; verify workspace, matching, shown, and remaining denominators are explicit and that the getter does not create an agent-change receipt.
   - Set search to `  Garage reset  `; verify the visible query and receipt use normalized `Garage reset`, report exact shown/matching/workspace denominators, identify only the visible Work search as changed, and state `Workspace data: Unchanged`.
   - Change the search as a person; verify the now-stale agent attribution clears.
   - Reset to the original 8-item sample, clear Work search, read the latest workspace count, and call `create_work_drafts` once with that exact count plus three distinct titles. Verify one atomic `8 → 11` receipt, all three exact titles, Draft status, three visible human **Start** controls, and no server request or automatically started work.
   - Retry with the stale count `8` and a new title; verify rejection with 11 workspace items and the prior successful receipt preserved. Read the fresh count `11`, retry one existing title, and verify duplicate-title rejection with no partial item.
   - Use **Reset live sample** and verify the exact original 8-item workspace, no reviewer Draft titles, and no pending agent receipt before continuing.
4. Open `/review`.
   - Discover `get_current_review_queue` and `set_review_scope` only.
   - Read the queue and verify the getter does not create an agent-change receipt.
   - Apply query `Garage reset` and the blocked scope; verify shown, filtered, search-match, and total-review denominators remain distinct in both the returned projection and visible receipt, alongside the current blocked/missing-next/missing-owner evidence counts.
   - Verify each returned `attentionReasons` entry is rendered verbatim beside the corresponding item.
   - Change either human filter; verify the stale agent attribution clears.
5. Open `/next`.
   - Discover `get_current_next_editor` and `prepare_next_action` only.
   - Open `?pack=garage-reset-sort-shelves`, read the editor without creating a receipt, and confirm the exact stored action `Clear the garage floor` is not collapsed to a generic command.
   - Prepare `Confirm storage bin delivery` with two structured facts already returned by Work or Review: `{ workId: "garage-reset-sort-shelves", field: "blocker", expectedValue: "Waiting on storage bins" }` and `{ workId: "garage-reset-clear-floor", field: "workflow", expectedValue: "Done" }`.
   - Verify the visible receipt identifies an unsaved browser-agent draft and displays the page-generated note `Garage reset: sort shelves — Blocker: Waiting on storage bins. Garage reset: clear the floor — Workflow: Done.` Verify the returned receipt preserves both structured facts, says `workspaceChanged: false`, and says `requiresHumanSave: true`.
   - Retry with either expected value changed. Verify the tool rejects the stale evidence and preserves the prior valid draft.
   - Repeat the exact call and verify `changed` is `false`; reload and verify the pending count and resume link retain the proposal without changing workspace fields. Choose Discard and verify the draft clears without a workspace write.
6. Navigate between routes.
   - Verify tools from the previous page are aborted and no longer active.
   - Verify ordinary page use still works when `document.modelContext` is unavailable.

## Security and scope checks

- Network activity contains static GET requests only during WebMCP operations.
- No `/api`, authentication, billing, account, or production-domain request is made.
- No secret, customer record, or private workspace data appears in source or rendered output.
- Unknown routes use the bounded challenge 404 page.
