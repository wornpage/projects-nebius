# Private generation streaming

The tool builder consumes Token Factory server-sent events incrementally with
`stream: true`, `stream_options: { include_usage: true }` and
`Accept: text/event-stream`. This replaces the complete-JSON response path.
There is one submission and one parser; no reconnect, replay or JSON fallback.

The model, reasoning settings, 32,000 output-token request limit, four-minute
response deadline, ten-minute run deadline and existing two-call/one-repair
limits are unchanged. Streaming can reduce idle waiting when the provider emits
chunks promptly. It cannot guarantee avoidance of a timeout before the first
chunk, an intermediary that buffers data, or a slow model. This private change
has offline qualification only; it does not establish live Nebius reliability.

## Completion and evidence

The reader requires HTTP 200 and an SSE content type, a consistent completion ID
and requested model, one choice at index zero, an explicitly observed assistant
role, one stop/length finish, one final usage event and `[DONE]`. Standard
multiline `data:` values, CRLF/LF/CR boundaries, split UTF-8 and comment
heartbeats are supported. Unknown SSE fields are rejected; no Last-Event-ID is
used. A repeated identical assistant role is harmless; a different role is not
accepted. A supplied creation timestamp must remain consistent.

Only whitelisted assistant content is assembled. Separate `reasoning_content`
and `reasoning` deltas are counted toward limits and discarded; only their
bounded presence/type summary is retained. Provider headers, arbitrary extra
fields, chunks and reasoning text do not become evidence or logs.

A completed response passes through the existing envelope, file framing, page,
worker, checks and preview validators. No partial new source reaches saved
files, a repair, Sandbox or the tool preview. A complete `length` result keeps
its reported usage and follows the existing incomplete-source rejection path.

An interrupted, malformed or incomplete stream is uncertain and cannot trigger
a repair or another submission. HTTP 408, redirects and 5xx responses including
524 are also uncertain. Clearly definitive provider 4xx refusals retain their
existing failure treatment. Previously validated final usage survives a later
framing failure, EOF or abort. Conflicting identity or invalid/duplicate usage
clears attribution instead of choosing a report. Known usage does not establish
that the tool build completed. Historical records are not rewritten.

## Resource bounds

| Item | Bound | Definition |
|---|---:|---|
| Decoded HTTP response body | 16 MiB | Includes SSE framing and repeated metadata; Fetch does not prove compressed network bytes. |
| Buffered SSE frame | 512 KiB | Sum of retained line bodies in one frame, including comments. |
| Content plus separate reasoning | 512 KiB | Cumulative UTF-8 bytes of decoded text fragments, including discarded reasoning. |
| Frames | 65,536 | Includes empty and comment-only frames. |
| Reader operations | 1,048,576 | Includes empty reads; prevents unbounded read-loop work. |
| Consecutive empty reads | 1,024 | Resets after a nonempty chunk. |
| Cooperative event-loop yield | Every 256 reads | Allows the existing abort/deadline timer to run. |

The former 512 KiB complete JSON envelope included little metadata. SSE repeats
metadata for many token deltas, so its transport-body allowance is explicitly
16 MiB while decoded text, source-file and retained-evidence bounds stay fixed.
Large delivered chunks are decoded in bounded slices. Readers are cancelled and
released on completion or error; a stalled cancellation promise cannot extend
the response deadline. `[DONE]` does not wait for EOF. Nonblank trailing data
already delivered with the terminal chunk is rejected.

## Offline verification

Use the repository-pinned Node 24.18.0. `npm test` includes the independently
authored protocol cases, provider-source checks and actual orchestration tests
with synthetic transports. They use no provider credentials or live services.
`npm run test:nebius:lifecycle` runs local workerd lifecycle cases with the same
SSE fixture contract and isolated storage; no generated program is executed.

The million-read stress fixture uses `setImmediate` for zero-delay cooperative
yields to avoid depending on Windows timer resolution. A separate unmocked
abort test verifies that the production timer can fire. Prior failing outputs
and the explicit usage-contract review remain in the private evidence packet.

Offline recovery qualification wraps retained assistant text in authored SSE
solely to replay the current source validators. Its existing report continues
to mark original transport and finish-reason qualification false. It never
changes a historical receipt or establishes that an earlier run was streamed.

Protocol reference: [Token Factory chat completions](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion).
