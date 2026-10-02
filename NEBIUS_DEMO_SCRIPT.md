# Nebius edition: live demo and observation sheet

The plans below use synthetic work inputs. They do not establish that their
unexecuted advisory calls succeeded. The retained-checker rehearsal uses an
actual saved model/Sandbox run and labels it accordingly. Record the actual
model ID, outputs, failures and usage for any fresh call. Use this edition's
eventual public source and hosted app for submission; do not modify the earlier
WebMCP challenge repository or present the private Projects app as the public
source of this edition.

## Retained checker rehearsal (target 2:45)

Use saved run `5fddeeaa-cfa6-4a80-a3a2-ceb9709e67d1` in the local app. Label
the run October 1, 2026; its source and receipts are unchanged. This is a replay
of an observed result, not a new generation. No new provider call is needed.
Public judge access and final video publication remain owner release gates.

| Time | Show | Evidence or action |
| --- | --- | --- |
| 0:00–0:20 | Work, then the release-packet checker task | Two synthetic packet inputs have distinct expected outputs: three gaps and zero gaps |
| 0:20–0:45 | Review saved run | Super model ID, two model calls, 6,700 input and 9,083 output tokens in total |
| 0:45–1:05 | Expand both recorded Sandbox checks | Missing input-change coverage in the first check, then 14 assertions and 6/6 events after repair |
| 1:05–1:35 | Try your tool; load and check incomplete, then complete example | Three actual gaps become zero; activate Check with Tab and Enter |
| 1:35–1:55 | Edit the input, then check malformed JSON | The old ready result clears and the named result shows an input error |
| 1:55–2:20 | Restore the complete example; open Input formats, then close preview | The saved input declares Plain text; historical JSON-loader coverage remains 0/2 |
| 2:20–2:45 | Show source, saved evidence and the separate completion control | Keep the task open; final publication must use the released edition's source and working judge URL |

The narration below is a straight paragraph with pause durations in tenths of
a second. It is a draft to align with actual recorded actions; it does not
guarantee a 2:45 spoken duration. Keep provider waiting and any edits clear in
the final recording.

Wornpage Projects brings the next step into the work itself. [0.4s] This task asks for a small release-packet checker, with an incomplete example and a corrected example. [0.6s] I am opening a saved October first run. Nebius Token Factory used Nemotron Super to write the tool and its checks. [0.4s] These are the actual two model calls and their recorded token totals. [0.6s] The first Sandbox check found that the generated tests had missed the input-change event. [0.3s] One repair passed the next check, with fourteen assertions and all six control events covered. [0.7s] Now I can try the result. [0.3s] The incomplete packet shows three gaps: health, review and rollback. [0.5s] I load the corrected packet and check it with the keyboard. [0.4s] It shows zero gaps and is ready for human review. [0.6s] Editing clears that old result. [0.3s] Malformed JSON produces an input error. [0.6s] The generated input still declares plain text, and that mismatch stays visible here. Its original JSON-loader check count remains zero of two. [0.7s] The files, failed check and successful repair remain available in Review. [0.4s] I can save evidence, then make a separate human decision about completion. [0.6s] This rehearsal uses the local Nebius edition. The released source and judge demo must reproduce this same workflow.

### Repeatable tab-bound recording

The optional development helper
[nebius-retained-tool-recording.mjs](scripts/nebius-retained-tool-recording.mjs)
imports into an initialized CUA JavaScript session. It uses that session's bound
local Review tab, native keyboard surface and CDP recording capability. It does
not launch a test browser or substitute authored output for the saved tool.

Close the volatile preview first. Supply the observed run ID, checked digest and
five HTML control IDs; they are not run-access or provider keys. With the tab
and capability handles already bound, use:

```js
const { startRetainedToolRecording } = await import(
  'file:///ABSOLUTE-REPOSITORY-PATH/scripts/nebius-retained-tool-recording.mjs'
);
const take = await startRetainedToolRecording({
  tab, surface, cdp, outputBase: 'C:/path/to/new-take',
  expectedRunId, expectedSourceDigest, bindings,
  onProgress: event => nodeRepl.write(event),
});
await take.next(); // Repeat in bounded tool calls until take.done is true.
```

Its seven stages use real Tab, Shift+Tab, Enter, PageDown and typing. Each stage
checks the resulting accessibility state before proceeding. The last stage
stops the tab-bound recording and saves raw video, actual cue times and a
credential-free receipt. Existing output files are never overwritten. Early
failure retains a stopped take; an uncertain recorder stop is labeled uncertain
and permits one explicit stop recovery with a separate receipt.

If start acknowledgement fails, the thrown error exposes `recordingRecovery`
and the helper writes a separate `.start-uncertain.json` receipt. It does not
retry start or stop automatically. Inspect the bound recorder and establish
that the capture belongs to this take before calling
`error.recordingRecovery.stop({ confirmOwnedCapture: true })`. An already
active recorder from another take must be left with its original controller.

The helper requests no generation and never activates Save evidence or Mark
done. Its request audit permits only the selected run's preview POST; it strips
headers, bodies and query strings. Confirm unchanged budgets and records
separately. The capture is silent and uses the current viewport. Keep the raw
capture and receipt when converting video for playback or adding narration.

On October 1, 2026, the helper completed all seven stages in a continuous
108.0-second local take with 75 native key presses. Visual frame review showed
the distinct three-gap and zero-gap results, cleared output, invalid-JSON error,
the unchanged format declaration and generated source. One earlier completed
take was retained after its second scroll moved the zero-gap result out of view;
the helper now focuses the footer disclosure during result holds. The observed
request audit contained only the saved run's preview POST. All 15 retained runs,
provider budgets and the credential-file hash were unchanged after recording.

This is a silent rehearsal of saved output. Its companion narration is one
paragraph with pauses rounded to tenths and an estimated 160-word-per-minute
pace mapped to observed action cues; recorded speech remains unverified.
Independent source review accepted the helper. The scoped documentation-count
test, syntax and diff checks passed; the full application suite was not rerun
for this helper change. Projects Acceptance returned an internal error, so no
formal acceptance receipt was produced. Publication and the judge demo remain
release work.

## Project copilot story (target 2:55)

Use one website-release project throughout. All scenario facts below are
synthetic demonstration inputs. The example plan is hand-written; if used,
show its label. A submission rehearsal must also show an actual configured
Token Factory call and its actual output. Record the configured routine and
reasoning model IDs separately. Model-family recommendations are not results.

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:25 | Work → New project. Start from the website-release example or enter a brief for a small page update. | The user has a goal but needs an executable sequence of work. Example content is editable and unsaved. |
| 0:25–0:55 | Preview the brief and reasoning model, request a real plan, inspect missing facts/dependencies, edit and approve. | Generation proposes work; approval creates the local project. Describe the actual output, including gaps. |
| 0:55–1:20 | Open the first task, supply a specific new fact, preview the routine model and request a next step. | A smaller routine role handles everyday guidance. Report actual token usage and a useful or flawed suggestion. |
| 1:20–1:55 | Return to the project. Update: “The release goal changed from signups to helping existing customers find support.” Request revisions. | The reasoning role proposes affected task changes; show one Before/After comparison and a deliberate human edit or rejection. |
| 1:55–2:30 | Review one task against deliberately incomplete supplied evidence. | Advisory review distinguishes supplied support from missing proof. Do not mark a task complete merely because the response is valid JSON. |
| 2:30–2:55 | Reload the project, show preserved work and source/license/setup. | The runnable submission contains its own frontend and provider boundary; private Projects is the product reference. |

Respect the actual request limiter; use deliberate cuts for provider waiting
time while keeping an unedited local observation record. Do not hide failed
calls or present example text as generated output. If credentials are still
absent, rehearse manual creation/replanning and label the live steps pending.

## Focused task demonstration (alternative, target 2:40)

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:20 | Nebius landing, then Work with four synthetic items | “This edition adds Nebius Token Factory guidance to a human-controlled Projects demo. The browser workspace and WebMCP tools came from our earlier entry.” |
| 0:20–0:45 | Select **Decide whether the release is ready**, open Next, optionally add an update, and expand the exact task/status/context preview | “I choose the work item and the exact text sent to the NVIDIA model. Notes and sources stay out unless I select them.” |
| 0:45–1:15 | Show the configured model, request a next step, then show the actual returned proposal, basis, missing information and token usage | “Nebius proposes a next step and any supported blocker or status changes. Generation changes no saved work.” Describe the actual result; do not narrate a planned result as observed. |
| 1:15–1:40 | Review the proposed changes together, edit if needed, then **Apply changes** only if sound | “This preview shows exactly what will change. I decide what gets saved.” If the result is poor, edit or discard it and show that decision. |
| 1:40–2:10 | Open **Evidence and completion**, enter an incomplete release note, then expand **Optional · review with Nebius**. Show the actual advisory finding and selected-count denominator. | “The review assesses only what I submitted. It does not verify hosted health or complete the task.” Choose **Save evidence** if useful; leave the release item blocked while health is unobserved. |
| 2:10–2:40 | Show the separate human **Mark done** control without using it for this incomplete case; show README, Worker boundary and open-source license in the eventual public repository | “The public source includes the runnable demo and Nebius Worker. The prior WebMCP work is identified, and the new Nebius flow is findable.” |

If either live call fails or the output does not meet its contract, record that
outcome and repair the integration before recording a submission video. Keep a
real imperfect case in the video; do not fabricate a favorable review.

## Small live evaluation set

Run these after an available NVIDIA model with supported JSON mode is configured.
Use the exact bundled input unless a change is recorded. A result is “useful”
only if it proposes a concrete, safe next action grounded in submitted fields,
identifies a material missing fact when present, and can be accepted or edited
without pretending the model verified facts. Review findings must quote supplied
evidence for supported or partial assessments and state the selected criterion
count. An API 200 or valid JSON alone is not a quality pass.

| Case | Work item / supplied situation | What to inspect | Observation |
| --- | --- | --- | --- |
| 1 · blocker | Release readiness: local checks passed; hosted health not observed | Does guidance request the missing hosted check and avoid a release approval claim? | Pending live call |
| 2 · missing fact | Customer handoff: packet draft exists; meeting time unconfirmed | Does guidance ask for confirmation before sending or completing? | Pending live call |
| 3 · contradictory evidence | Onboarding criterion includes workspace selection. Supply: “Draft: Sign in, then open Work. Observed test: a workspace chooser appeared and blocked opening Work until a workspace was selected.” | Does review identify the conflict between instructions and observed flow instead of calling the criterion fully supported? | Pending live call |
| 4 · ready action | Keyboard access: keyboard run is the next concrete action | Is guidance specific enough to perform and record the run? | Pending live call |
| 5 · planning | Website-release brief with no named owner/date and an unconfirmed audience | Does the reasoning model propose a coherent graph and identify the missing audience without inventing approvals? | Pending live call |
| 6 · replanning | Same project; goal changes from signups to customer support | Do revisions address affected tasks, preserve unrelated work, and remain useful after the human edits them? | Pending live call |

For each call, record date, exact model ID, prompt version, selected context,
the actual response or error, reported input/output tokens, human verdict and
any correction in a separate local record. Do not put a key, private customer
text or provider response containing sensitive input into a public commit.
Report the observed denominator (for example, 3 of 6 cases run), not just the
planned six. Re-run changed cases after prompt or contract edits. Compare Ultra
only for a named hard case using the same input and record the added usage and
elapsed time; there is no automatic model escalation.

## Reproduction and submission checks

1. Install and run from [NEBIUS.md](NEBIUS.md) using a reviewer-owned Token
   Factory key. Confirm the configured model is shown before sending text.
2. Use Work → Next for the bundled synthetic items. Generation and review must
   each make an actual Token Factory runtime call in the hosted demo.
3. Check a fresh browser, narrow viewport, keyboard, offline/reconnect path,
   import/export and a return visit. Record hosted results separately from the
   local synthetic browser gate.
4. Confirm the eventual public repository contains the Worker, static frontend,
   sample assets, setup instructions and visible MIT license. Its hosted demo,
   repository URL and video should all describe the same Nebius edition.
5. Before submission, record the actual working URL, public repository URL,
   video URL, model ID and judge-access window. These fields are intentionally
   unset while the fork remains private and no deployment has been approved.
