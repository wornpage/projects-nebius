# Generated source byte budget

The file limits apply after the fixed server bridge is appended. For the current 566-byte bridge:

| Model-written source | Maximum raw UTF-8 bytes |
| --- | ---: |
| `index.html` | 32,768 |
| `app.js` | 32,202 |
| `checks.cjs` | 32,768 |
| Combined raw source | 64,970 |

The materialized limits remain 32,768 bytes per file and 65,536 bytes in total. These limits are separate from model output tokens. The prompt derives the raw budgets from the actual bridge and protocol constants and recommends keeping `app.js` below 24,576 bytes for headroom.

Initial generation, source-rejection repair and Sandbox repair receive the same budgets. Byte diagnostics report the actual materialized size, bridge contribution, raw limit and required reduction. Preserve every requested behavior and meaningful check when reducing repetition. Source framing, bridge ownership, validators, Sandbox execution and human approval are unchanged.

Offline tests and retained-response diagnosis do not establish that a new model response will pass. A live build still needs its own bounded authorization, passing Sandbox result and independent hosted verification.
