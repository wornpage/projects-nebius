# Nebius edition: live demo and observation sheet

The plans below use synthetic work inputs. They do not establish that their
unexecuted advisory calls succeeded. The retained-checker rehearsals replay
actual saved model/Sandbox runs and identify their dates. Record the actual
model ID, outputs, failures and usage for any fresh call.

As of October 3, 2026, the [repository](https://github.com/wornpage/projects-nebius)
is private and the
[earlier manual preview](https://projects-nebius.ayivx-do-lmf-982.workers.dev/)
is disabled. Develop locally using [README](README.md#run-without-credentials).
That hosted release had AI guidance and Sandbox execution disabled and did not
provide private workspace or saved-run access. Restoring public judge access is
a separate release step. Do not modify the earlier WebMCP challenge repository
or present the private Projects app as this edition's public source.

## Current JSON checker rehearsal — October 2, 2026

Use saved run `2947cffc-84e3-4f71-8325-1e35f29c170a` in the local app. It is
the qualified task-owned JSON checker: 28 successful assertions, 6/6 observed
control events, 2/2 declared JSON example loaders and 2/2 post-output edits.
Its two recorded model calls used 7,815 input and 7,425 output tokens. This
rehearsal replays those retained results and requests no new generation.

Replaying this exact saved run requires the original private browser workspace,
its checker task, and access to the original local server's retained run state.
Those private records and access credentials are not distributed in the public
repository. Cloning the source or supplying a new provider key does not create
this saved run. For a new locally owned run, follow the
[execution setup](NEBIUS_EXECUTION.md) with your own Token Factory and Sandbox
credentials. Keep a fresh result separate from this dated replay.

Run the same tab-bound helper with these observations, captured from Review:

```js
const take = await startRetainedToolRecording({
  tab, surface, cdp, outputBase,
  expectedRunId: '2947cffc-84e3-4f71-8325-1e35f29c170a',
  expectedSourceDigest: '7971b1ae17bbcaa02f1a6e8dea9a637b28f6343bd13b01ec8a06b0472bd50ccc',
  bindings: { input: 'input-json', output: 'output', check: 'check-button',
    incomplete: 'load-example1', corrected: 'load-example2' },
  inputAccessibleName: 'input-json',
  expectedChecks: {
    failedCheckText: "'Input error: Expected exactly four fields'",
    successfulAssertions: 28, jsonLoaders: { observed: 2, total: 2 },
    inputFormatLabel: 'JSON',
  },
  onProgress: event => nodeRepl.write(event),
});
await take.next(); // Continue through the seven bounded stages.
```

The helper checks the exact retained failure, successful check counts and
source digest before showing the tool. Its receipt records the supplied
observations so a newer recording cannot silently reuse the October 1 counts.
The actual cue receipt owns the final timing. Keep the raw take and any failed
take when preparing narration or captions.

Draft narration, in one paragraph with pauses specified in tenths of a second:

Wornpage Projects turns a task into a tool you can try. [0.4s] This is a saved October second run from Nebius Token Factory using Nemotron Super. [0.4s] It used two model calls, with seven thousand eight hundred fifteen input tokens and seven thousand four hundred twenty-five output tokens. [0.6s] The first Sandbox check caught an inconsistent expected error message. [0.4s] One repair passed the next check, with twenty-eight assertions, all six control events and both JSON example loaders observed. [0.6s] Now I can try the actual result. [0.3s] The incomplete packet has three gaps: health, review and rollback. [0.5s] The corrected packet has zero gaps and is ready for human review. [0.6s] Editing replaces the old result, and malformed JSON produces an input error. [0.5s] This input declares JSON, matching the task's requirement. [0.5s] The generated files, original failure and repaired check remain available in Review. [0.4s] Saving evidence and completing the task are separate human decisions. [0.5s] This recording replays a retained local result. The public preview is currently unavailable during private local development. The source includes instructions for running the Nebius integration.

### Verified scripted local take — October 3, 2026

The committed helper completed all seven stages against the actual retained
JSON checker in the local app. The selected continuous take is 95.5 seconds,
with 74 native key presses during capture and nine before capture. It visibly shows three gaps, zero
gaps, an edit clearing the old result, and an invalid-JSON error. The first
149.0-second take remains preserved; pauses between tool calls made it slower.

Both request audits contain only the selected run's preview POST. All 18
retained run records, both provider budget counters and the credential-file
hash remained unchanged. No new model or Sandbox call, evidence save, task
completion, public upload or Devpost edit was performed.

Private media and receipts are retained locally in
`C:/Users/jared/Videos/Nebius/scripted-replay-2026-10-03/`. They require local
file access and are not supplied by cloning this repository. The 95.5-second
narrated draft uses the installed Microsoft Zira voice. Its ten speech blocks
fit the observed action intervals; adding audio preserves the playback video's
H264 stream. The original AV1 capture is retained separately. Human listening,
pronunciation and comprehension remain unverified.

Measured narration in one paragraph; each pause marker rounds inserted silence
to 0.1 seconds, while pauses within speech remain part of the voice recording:

Projects built this release checker with Nemotron Super on Nebius. [1.6s] This saved run used two model calls. The first Sandbox check caught an incorrect expected error message. [1.6s] One repair passed twenty-eight assertions, all six control events and both JSON example loaders. The checked source and original failure remain available. [4.7s] Now I can try the generated tool. This incomplete packet has three gaps: health, review and rollback. [3.9s] I load the corrected packet and check it with the keyboard. It shows zero gaps and is ready for human review. A release decision still belongs to the person reviewing it. [9.8s] Editing the packet clears the old ready result. [2.9s] Malformed JSON produces an input error instead of retaining that earlier result. [4.3s] The input declares JSON, matching the task. Both example loaders were observed in the saved checks. [3.3s] The generated files, checked source digest and Sandbox logs remain available. [1.7s] Evidence and completion are separate human decisions. This is a private local replay. [0.8s]

## Historical retained checker rehearsal (target 2:45)

Use saved run `5fddeeaa-cfa6-4a80-a3a2-ceb9709e67d1` in the local app. Label
the run October 1, 2026; its source and receipts are unchanged. This is a replay
of an observed result, not a new generation. No new provider call is needed.
This rehearsal predates the public source and manual-preview release. Live AI
judge access and publication of the updated video remain owner release gates.

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

Wornpage Projects brings the next step into the work itself. [0.4s] This task asks for a small release-packet checker, with an incomplete example and a corrected example. [0.6s] I am opening a saved October first run. Nebius Token Factory used Nemotron Super to write the tool and its checks. [0.4s] These are the actual two model calls and their recorded token totals. [0.6s] The first Sandbox check found that the generated tests had missed the input-change event. [0.3s] One repair passed the next check, with fourteen assertions and all six control events covered. [0.7s] Now I can try the result. [0.3s] The incomplete packet shows three gaps: health, review and rollback. [0.5s] I load the corrected packet and check it with the keyboard. [0.4s] It shows zero gaps and is ready for human review. [0.6s] Editing clears that old result. [0.3s] Malformed JSON produces an input error. [0.6s] The generated input still declares plain text, and that mismatch stays visible here. Its original JSON-loader check count remains zero of two. [0.7s] The files, failed check and successful repair remain available in Review. [0.4s] I can save evidence, then make a separate human decision about completion. [0.6s] This rehearsal uses the local Nebius edition. The earlier public manual preview had AI guidance and Sandbox execution disabled and did not expose this private saved run.

### Repeatable tab-bound recording

The optional development helper
[nebius-retained-tool-recording.mjs](scripts/nebius-retained-tool-recording.mjs)
imports into an initialized CUA JavaScript session. It uses that session's bound
local Review tab, native keyboard surface and CDP recording capability. It does
not launch a test browser or substitute authored output for the saved tool.

Close the volatile preview first. Supply the observed run ID, checked digest and
five HTML control IDs and the input's accessible name; they are not run-access
or provider keys. The native accessibility tree names the empty text entry
without exposing its HTML ID, so the helper requires that name separately for
the initial preview check. After loading an example, it seeks every control by
its observed HTML ID. With the tab
and capability handles already bound, use:

```js
const { startRetainedToolRecording } = await import(
  'file:///ABSOLUTE-REPOSITORY-PATH/scripts/nebius-retained-tool-recording.mjs'
);
const take = await startRetainedToolRecording({
  tab, surface, cdp, outputBase: 'C:/path/to/new-take',
  expectedRunId, expectedSourceDigest, bindings, inputAccessibleName,
  expectedChecks: { failedCheckText: 'Missing change:', successfulAssertions: 14,
    jsonLoaders: { observed: 0, total: 2 }, inputFormatLabel: 'Plain text' },
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

1. **Local manual workflow:** follow
   [Run without credentials](README.md#run-without-credentials).
   Create a project, edit tasks, save evidence and check persistence. This
   credential-free workflow does not reproduce a model call or a privately
   retained checker. The previous public preview is currently disabled.
2. **Optional fresh local execution:** follow [NEBIUS.md](NEBIUS.md) and
   [NEBIUS_EXECUTION.md](NEBIUS_EXECUTION.md) with reviewer-owned credentials.
   Confirm the configured model, submitted task, spending limits and execution
   approval before making a call. Preserve the new input, source, failures,
   Sandbox results and usage rather than assigning the historical run's claims
   to that new result.
3. **Retained recording:** the October 1 and October 2 replays require their
   original private local task/run state and access. Their source digests and
   receipts identify observed results; they do not grant public judge access or
   establish general generation reliability.
4. Check a fresh browser, narrow viewport, keyboard, offline/reconnect path,
   import/export and a return visit. Record actual hosted and configured local
   observations separately from provider-free browser checks.
5. Before submission review, restore public access to the
   [repository](https://github.com/wornpage/projects-nebius) and a working demo.
   Confirm the Worker, static frontend, sample assets, setup instructions and
   visible MIT license remain available. Check the demo, source and video
   against the same edition, including their actual capability limits.
6. [README](README.md) records the earlier source release, manual-preview URL
   and October 1 video. The newer October 2 narrated draft remains local,
   pending human review and publication. Any future live judge access needs its
   own explicit setup and observed evidence; it is not enabled by these instructions.
