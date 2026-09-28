# Chrome-only WebMCP recording cue sheet

Target final length: **1:50**. Hard stop: **2:00**. Record one continuous Google Chrome clip. Do not speed up footage, remove pauses inside the accepted take, or hide a failed state transition with an edit.

## Fixed setup

- Use Google Chrome at 100% zoom in one clean profile window with the installed recording extension. Put the captured tab in Chrome fullscreen so the browser toolbar is hidden. Keep the Codex task outside the captured Chrome tab; this workflow does not assume a Chrome browser-agent side panel.
- Keep the laptop's native fullscreen Chrome viewport; do not apply a viewport override. Record its observed dimensions and require zero horizontal overflow before T0.
- Production URL: `https://projects-webmcp-extension.pages.dev/`.
- Before the take, use Guide **Reset live sample**. Require exactly 8 workspace items, no Pending link, and a clean **Verified action trail** showing `Ready for one bounded run` and `No action recorded`.
- Keep the safe default Guide brief for the opening Guide and Priority shots. After returning from Priority, activate **Use fast-create brief** with Shift+Tab and Enter; do not load it before navigating away because this page-local state does not survive Guide → Priority → Guide.
- Codex controller instruction: `Follow the brief on this page.` Arm that instruction before T0, but do not invoke the Guide reader until **Use fast-create brief** is visibly active. No prompt is typed in Chrome during the take. Codex then uses only the current page's native `RegisteredTool` objects from `document.modelContext.getTools()` and invokes them with serialized input through `document.modelContext.executeTool(...)`; it must stop without Save or Start.
- Exact current-page catalogs: Guide 1 / Priority 1 / Work 3 / Review 2 / Next 2.
- Registered tool sequence: `get_projects_handoff_guide` → `get_current_work_view` → `show_work_search` → `get_current_review_queue` → `set_review_scope` → `get_current_next_editor` → `prepare_next_action` → `get_current_work_view` → `create_work_drafts`.
- Exact bounded inputs: Work/Review query `Garage reset`; Review filter `blocked`; Next choice `Confirm storage bin delivery`.
- Executable target timeline: `landing-hold@00:00.000` → `landing-to-guide@00:06.000` → `guide-body-page-down@00:12.000` → `guide-to-priority@00:18.000` → `priority-to-guide@00:25.000` → `guide-to-work@00:30.000` → `work-to-review@00:46.000` → `review-to-next@01:00.000` → `next-body-arrow-downs@01:10.000` → `next-to-work@01:18.000` → `create-drafts@01:26.000` → `work-to-pending@01:36.000` → `final-body-arrow-downs@01:43.000` → `final-acceptance@01:49.500`.
- Park the pointer in the bottom-right corner before T0 and leave it there for the entire clip.
- Disable unrelated notifications. Keep the URL, keyboard focus rings, activity receipts, denominators, and human-authority copy readable.

## Browser-control ownership

- Codex browser control launches Chrome fullscreen, suppresses the Playwright automation infobar, and requires the toolbar-hidden viewport to remain stable before T0. It observes—but does not override—that native viewport and owns the monotonic timeline, route navigation, fixed holds, DOM checkpoints, focus checks, native WebMCP calls, and abort decision.
- Every timed route change uses real Tab or Shift+Tab focus movement. Work and Guide remain direct header links; Priority, Review, and Next are selected through the visible **Tools** dialog, and the final pending proposal is selected through **Pending 1** and **Review on Next**. Each trigger and destination is activated with Enter.
- Vertical reveals are keyboard-only and body-owned: Guide uses one PageDown, the prepared Next hold uses four ArrowDown presses, and the restored final Next hold uses eight ArrowDown presses so the receipt and human controls remain together in the native fullscreen viewport. The pointer stays parked; do not use the wheel or drag a scrollbar.
- Visible focus is required when each presentation-changing or Draft-creation WebMCP receipt first appears. The Guide reader must return the exact brief and render its read-only receipt, but it does not invent an action-focus promise. Only after an action receipt's focus proof may the page body own the reveal keys; acceptance depends on the named action receipt and controls remaining simultaneously visible, not on claiming the receipt retained focus during the scroll.
- Do not click route links, use full-document `goto`, address-bar navigation, browser Back, pointer activation, retry a transition, or extend a hold to hide late execution.
- Codex invokes only the native descriptors returned for the current page. Browser control never substitutes a DOM/state shortcut, direct workspace API, server request, or second mutation path.
- Record a four-second setup pad on the settled landing hero. Remove only that setup pad afterward; all timestamps below are final-video timestamps after the trim.

## Keyboard preflight

Complete this exact path once immediately before recording. Any mismatch cancels the take.

Work-first navigation calibration (September 4, 2026): application commit `4b9630e`. The recording contract targets a fullscreen Google Chrome inner viewport 1116 × 698, document client viewport 1101 × 698 and scroll width 1101. The current topology is Guide → **Tools** → Priority, Work → **Tools** → Review, Review → **Tools** → Next, and Work → **Pending 1** → **Review on Next**. The exact calibrated transition counts are encoded below and in the executable specification. This application-only calibration proves focus topology; it does not replace the fresh fullscreen production-Chrome preflight, which must still prove the 1:50 timeline, native geometry, receipts, diagnostics, and final human-only frame.

The preflight requires stable focus across two consecutive rendered frames after every exact Tab or Shift+Tab press, including the body-owned focus reclaims, so page-owned focus recovery completes before the next key. After each settled key, it aborts if the declared destination arrives before the declared count. It still requires the declared count and destination; it never searches for an alternate target.

After the Guide reader inserts its receipt, reclaim page focus with one body-owned Tab, then use nine additional Tabs to reach **Work**.

1. Landing → Guide: press Tab on the page body to reclaim focus, then use five additional Tab presses to reach **Open the handoff workflow** and press Enter; any earlier or later destination fails the take.
2. Guide → Priority: five Tab presses to reach **Tools**, then Enter; two Tab presses in the dialog reach **Priority**, then Enter.
3. Priority → Guide: five Shift+Tab presses, then Enter.
4. Returned Guide → fast brief: five Shift+Tab presses, then Enter on **Use fast-create brief**.
5. Fast brief → Work: press Tab once on the page body to reclaim page focus from the completed reader, then use nine additional Tab presses to reach **Work** and press Enter; any earlier or later destination fails the take.
6. Work receipt → Review: eleven Shift+Tab presses to reach **Tools**, then Enter; three Tab presses in the dialog reach **Review**, then Enter.
7. Review receipt → Next: three Shift+Tab presses to reach **Tools**, then Enter; four Tab presses in the dialog reach **Next**, then Enter.
8. Prepared Next receipt → Work: five Shift+Tab presses, then Enter on **Work**.
9. Work Draft receipt → pending decision: thirteen Shift+Tab presses to reach **Pending 1**, then Enter; two Tab presses in the dialog reach **Review on Next**, then Enter.
10. Guide: the upper view must first show the counted scope; one PageDown pressed on the page body must then reveal brief `Use the WebMCP tools on Work, Review, and Next to inspect the visible project state, narrow the items that need attention, and prepare an evidence-based next action for my review. Do not save or change workspace data.` and `Use fast-create brief` control, both fully visible.
11. Next: four ArrowDown presses on the page body must keep the prepared WebMCP receipt fully visible; after returning through **Pending 1** and **Review on Next**, eight ArrowDown presses must keep the WebMCP receipt visible while bringing **Discard draft** and **Approve and save** fully into view.
12. Opening Guide frame: scope `8 visible of 8 workspace`; trail `Ready for one bounded run` / `No agent action recorded.` / `No action recorded` / `0 verified actions, 0 pending`; tool `WebMCP 1 tool`; no Pending navigation and no action receipt. The pill is ready only after Guide registration; require visible focus at every destination and no browser error or warning.
13. Priority hold: title `Garden study: log interviews`; reason `Due in 6 days · No blocker or pending decision.`; Work ID `garden-study-log-interviews`; destination `/next?pack=garden-study-log-interviews`; action `Open next action`; entire recommendation fully visible.
14. Confirm the shared trail advances from 1 verified → 2 verified → 3 verified + 1 pending → 4 verified + 1 pending. Drafts appear only after the optional create call, and Decide remains pending.
15. Work hold: complete `Step 1 · Narrow Work` / `WebMCP · show_work_search` receipt fully visible with `Work search updated for “Garage reset”.`, `“Garage reset”`, `4 shown · 4 matching · 8 workspace`, `2 blocked in the matching work`, `Visible search updated · Not saved`, and `Page view only · Workspace unchanged`.
16. Review hold: complete `Step 2 · Verify Review` / `WebMCP · set_review_scope` receipt fully visible with `Review scope updated: “Garage reset” · Blocked.`, `“Garage reset” · Blocked`, `2 shown · 2 filtered · 3 search matches · 5 total review`, `2 blocked · 0 missing next · 0 missing owner`, `Visible queue updated · Not saved`, and `Page view only · Workspace unchanged`.
17. Next hold: complete `Step 3 · Prepare Next` / `WebMCP · prepare_next_action` receipt fully visible with `Draft prepared — waiting for your approval.`, `Garage reset: sort shelves — Workflow: Blocked. Garage reset: sort shelves — Blocker: Waiting on storage bins.`, `Draft — waiting for your approval`, `Not saved`, and `Unsaved proposal · Human approval required`.
18. Draft hold: complete `Step 4 · Stage Drafts` / `WebMCP · create_work_drafts` receipt fully visible with `3 draft work items created for human review.`, `3 · Draft`, `Confirm donation pickup window · Print shelf labels · Prepare bike rack checklist`, `8 → 11`, `No work started · Human Start required`, and `Draft only · Human Start required`.
19. Final restored receipt must repeat the exact Step 3 Next presenter contract after Pending navigation and the eight-arrow reveal; visibility alone is not sufficient.
20. Landing hold: headline `Let an agent find the next move. Keep the final say.`; lede `Browser workers read and narrow the same work you see, can add bounded Draft items, then prepare an unsaved next action for you to approve.`; facts `No backend` and `No automatic starts`; action `Open the handoff workflow →`; preview `WebMCP handoff in Review: the agent narrows visible work, explains a blocker, and prepares a next action for human approval.`; both hero columns fully visible before T0.

Use a fixed **2.25-second settle window** after every route activation. Abort instead of retrying, double-activating, clicking, or relaxing a checkpoint.

## One continuous Chrome clip — 00:00–01:50

| Final time | Keyboard/WebMCP action | Required visible checkpoint | Narration track |
| --- | --- | --- | --- |
| 00:00–00:06 | Hold the canonical landing hero. | `Let an agent find the next move. Keep the final say.`; browser-worker lede; `No backend`; `No automatic starts`; workflow CTA and Review handoff preview. | “Projects gives a browser agent bounded access to visible work while the person keeps the final say.” |
| 00:06–00:18 | Tab to Guide, show the clean action trail and upper scope, then press PageDown on the page body at 00:12. | Guide ready by 00:08.25; 8 visible of 8; trail says `Ready for one bounded run` and `No action recorded`; lower view shows the complete brief and fast-create control. | “The shared action trail will preserve each verified outcome across the workflow.” |
| 00:18–00:25 | Tab to **Tools**, open it, then tab to Priority and hold the single recommendation. | Priority ready by 00:20.25; one exact title, reason, and Next destination. | “Priority contributes one read-only recommendation—nothing more.” |
| 00:25–00:30 | Tab back to Guide, activate **Use fast-create brief**, then let Codex invoke the registered Guide reader and follow the returned brief. | Guide ready by 00:27.25; fast brief selected only now; reader returns the exact brief; workspace remains 8. | “The page-owned brief permits Draft staging but still forbids Save and Start.” |
| 00:30–00:46 | Tab to Work; read the 8-item view and show `Garage reset`. | Larger Step 1 `WebMCP · show_work_search` receipt; 4 matching of 8; 2 blocked; trail reports 1 verified action and `Read-only actions verified`. | “Work narrows the visible list and records the first verified action.” |
| 00:46–01:00 | Use eleven Shift+Tab presses to open **Tools**, then three Tab presses to open Review and apply `Garage reset` + Blocked. | Larger Step 2 `WebMCP · set_review_scope` receipt; 2 shown, 2 filtered, 3 search matches, 5 total; trail retains Work and reports 2 verified actions. | “Review verifies the blocker evidence without changing workspace data.” |
| 01:00–01:18 | Use three Shift+Tab presses to open **Tools**, then four Tab presses to open Next and prepare `Confirm storage bin delivery`; hold the receipt, then send ArrowDown to the page body four times at 01:10. | Larger Step 3 `WebMCP · prepare_next_action` receipt; exact evidence; trail reports 3 verified actions, 1 pending decision, and `Proposal pending`; the proposal remains Not saved. | “Next prepares an evidence-backed proposal and stops before Save.” |
| 01:18–01:26 | Use five Shift+Tab presses to return to Work and invoke `get_current_work_view` for the exact denominator. | Workspace is still 8; no work was started or saved. | “Before creation, the agent rereads the live workspace count.” |
| 01:26–01:36 | Invoke one `create_work_drafts` call and hold the Step 4 receipt. | `Confirm donation pickup window`, `Print shelf labels`, and `Prepare bike rack checklist`; `3 · Draft`; `8 → 11`; Human Start required; trail reports `3 Drafts created · none started · Proposal pending`. | “One atomic call stages three Drafts. It cannot start them.” |
| 01:36–01:50 | Use thirteen Shift+Tab presses and Enter on **Pending 1**, then two Tab presses and Enter on **Review on Next**; hold the restored receipt, then send ArrowDown to the page body eight times at 01:43. | `Review the proposed next action`; trail remains 4 verified + 1 pending; final viewport shows the preserved receipt, `Draft: pending approval`, the unchanged Next proposal, human-only final Save, and untouched **Discard draft** / **Approve and save**. | “The run ends where consequential work should end: with a person deciding.” |

Stop the recorder at 01:50 on the human approval frame. Do not activate **Approve and save**, **Start**, or **Discard** during capture.

## Abort conditions

Abort the take immediately if any of these occurs:

- A route misses its 2.25-second settle window or any section crosses its hard timestamp.
- The pointer leaves its corner, a route uses a click, or the expected Tab/Shift+Tab destination differs.
- A keyboard reveal hides the required receipt, overshoots the named controls, or causes horizontal overflow.
- Guide does not begin at 8, the fast brief is loaded before the final Guide return, or the native Guide reader returns a different brief.
- `getTools()` returns a different current-page catalog, `executeTool(...)` is unavailable or rejects the accepted input, or any step uses a DOM/state shortcut instead of the registered descriptor.
- Work, Review, or Next names a different item, fact, query, filter, or denominator than the visible receipt.
- Next Save or any Draft Start is activated.
- Draft creation does not reread workspace 8, creates anything other than the three exact titles, reports a partial batch, or performs a server write.
- The final Pending navigation does not restore the exact verified Next receipt, unchanged Next proposal, and visible human Save/Discard controls.
- Focus is not visible at a required receipt or destination.
- A browser error, warning, CSP violation, duplicate tool, unexpected request, or horizontal overflow appears.

The video is accepted only when this one continuous Chrome clip passes every checkpoint, ends no later than 02:00 on the human approval frame, and remains below the official three-minute limit after narration.

## Post-capture cleanup and edit

1. In the same Chrome profile, use Guide **Reset live sample**; confirm the pending Next proposal and all three recording Drafts are absent, no Pending link remains, and the workspace is exactly 8.
2. Trim only the four-second setup pad. Do not add a route cut, speed up the clip, or remove an in-take pause.
3. Add narration and export MP4 with H.264 video and AAC audio on a 1920 × 1080, 30 fps canvas. Preserve the native Chrome aspect ratio without cropping; letterbox when needed. Target approximately -16 LUFS integrated audio with a peak no higher than -1.5 dB.
4. Watch the complete export twice. Confirm intelligible audio, readable URL and receipts, no private tabs or notifications, and a final duration below three minutes before public YouTube upload.
