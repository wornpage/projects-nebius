# File-opening boundaries and feedback

The prompt requests the three existing exact opening headers and standalone
closing fences. The same active parser also recognizes two narrow boundary
forms emitted by the live producer: bare `` ```html `` when the first body line is
exactly `<!doctype html>` (case-insensitive), and bare `` ```javascript `` when the
first body line is exactly `// app.js`. At a block boundary it may ignore one
unindented, unpadded standalone duplicate fence only when the following line is
a recognizable opening. Alternative boundaries must follow index, app, checks
order. They do not synthesize missing files, change source body lines, or bypass
the existing worker, page, checks, preview or Sandbox validators. As before,
CRLF is normalized to LF before source lines are joined. Initial generation
and source-rejection repair still require all three files. After a confirmed
Sandbox failure, the existing partial-replacement path may retain previously
admitted files unchanged; it does not fill missing files in an initial response.

Compatibility retained:
- Consumer: Nemotron 3 Super, which emitted these boundaries in a retained response.
- Owner: `worker/nebius-run-provider.mjs` and its single file-block parser.
- Removal condition: the producer emits canonical headers reliably and previously accepted alternate-framing records have been migrated or expired.
- Test coverage: canonical and alternate blocks, retained-response replay, partial and adversarial boundaries, and unchanged admission guards.
- Why hard cutover is unsafe now: the live producer emitted these unambiguous boundaries even though the task requested canonical headers.

When the first rejected top-level opening is a recognized split language/filename pair, the diagnostic reports every such opening for the three known paths within the first 4,096 response lines. It gives their original response-line numbers and exact expected headers in one message shorter than 240 characters. Only fixed filenames/headers and line numbers appear; unknown provider text and paths remain excluded.

Other malformed framing keeps the existing rejection. Split-opening diagnostics
remain feedback for the one bounded repair. The retained run's first response
still fails because checks are missing and app.js is invalid; its second still
fails checks syntax. The task requirements, bridge ownership, byte/token/time
limits, Sandbox and human-decision gates are unchanged.
