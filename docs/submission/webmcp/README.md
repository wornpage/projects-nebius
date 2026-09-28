# Submission record

## Positioning

> A visible agent-to-human handoff: the browser agent finds the next move, explains it from page evidence, and stops at an unsaved proposal for the person to decide.

The agent reads bounded page projections, can change reversible page scope, can atomically add at most three browser-local Draft items, and can prepare—but not silently save—a next action from exact Work or Review facts. Next requires one to three structured references, rejects stale or mismatched values, and generates the visible evidence note from the verified facts rather than agent prose. Successful actions leave a visible, screen-reader-announced receipt derived from the resulting page state; read-only getters do not impersonate a change. Scope and preparation receipts state that the workspace is unchanged; draft-creation receipts disclose the exact before/after workspace counts and require a visible human Start.

Those scoped successes now compose into one transient **Verified action trail** shared across Work, Review, and Next. It accumulates only recorded outcomes: narrowed Work, verified Review, an unsaved Next proposal, optional staged Drafts, and the pending or completed human decision. Draft staging is not presented as a mandatory phase, and a pending decision remains pending until a person approves and saves or discards it. The outcome summary names created Drafts, confirms none were started, and distinguishes a pending, approved, or discarded proposal without claiming a fixed completion denominator. The trail uses no storage, request, navigation, or workspace mutation path; Guide **Reset live sample** clears it together with the browser-local sample.

Priority adds a deliberately smaller read-only checkpoint: one canonical selector chooses the visible actionable recommendation, and the route-owned `get_next_recommendation` tool returns only that same id, title, destination, and reason. It cannot navigate, fetch, or write, returns `null` for the visible empty state, and is removed with the page catalog on navigation.

Work keeps active execution human-owned. Its single Quick Add form is available in both density modes and can disclose optional owner, area, type, due, energy, recurrence, and proof-target fields; every value travels through the existing `createPack` state owner. Quick Add and the bounded `create_work_drafts` tool share one NFC title normalizer and the same 200-Unicode-character reject-before-write boundary. The tool uses one state transaction to add at most three browser-local items in Draft status. Workspace persistence remains one browser-local path: a strict schema-v1 envelope carries the state plus an opaque revision, and legacy migration, normal writes, and reset removal all use the same exclusive browser lock. Revision-checked writes make stale-tab conflicts fail without overwrite or revival after reset. Its one visible activity receipt names every created Draft even when the current Work filter hides those cards. It cannot start, block, complete, or delete them; a person must use the existing visible controls. No request or compatibility route is added.

The exact under-three-minute Chrome choreography, keyboard preflight, narration, settle windows, and abort conditions are in [chrome-recording-script.md](chrome-recording-script.md). Run `npm run preflight:recording` before capture to execute that same cue in a temporary isolated Chrome profile; the focused contract deep-compares the human instructions with the frozen executable specification.

## Eligibility record

Projects is a pre-existing product. The submitted work is the WebMCP extension and the challenge-only public static edition documented in the repository-root `SOURCE_PROVENANCE.md`.

The public Git history begins during the official submission period and is intentionally fresh so unrelated production source is not recoverable from earlier commits.

## Submission checklist

- Working static URL accessible without an account during judging.
- Public source repository with a visible MIT license.
- Complete source, deterministic sample data, locked dependencies, and build instructions.
- Text description covering WebMCP fit, shared person-agent capability, and implementation.
- Public demonstration video under three minutes with audio.
- The recording follows the checked-in 1:50 Chrome-only cue sheet, passes `npm run preflight:recording`, uses the persistent handoff rail to preserve context, and ends on the visible human approval boundary in one continuous take without route cuts, speeding, or hidden failed transitions.
- Dated public commits and `SOURCE_PROVENANCE.md` distinguishing prior work from the challenge extension.
