# Source provenance and challenge-period work

Historical record for the earlier WebMCP entry. The Nebius edition's
Nebius contribution and remaining evidence are tracked separately in
[NEBIUS_PROVENANCE.md](NEBIUS_PROVENANCE.md).

This file distinguishes the pre-existing Projects product from the WebMCP work submitted to the 2026 WebMCP Challenge.

## Timing

The official submission period began August 25, 2026 at 11:00 a.m. Pacific Time and ends September 3, 2026 at 1:00 p.m. Pacific Time. Projects existed before that period. The WebMCP extension and this independently buildable public edition were created after the period began.

This repository's Git history is intentionally new and is never backdated. Its dated commits, this file, the focused contracts, and the route-level source are the public evidence for the challenge work. Earlier private product history is not published because it contains unrelated implementation.

The public-edition baseline is commit `57d0fe1de5c3ef8d1d22a38cf363394968f0870c`, created August 26, 2026 at 5:31:15 p.m. EDT (`2026-08-26T17:31:15-04:00`). It records the complete challenge-only source after the official submission period opened.

## Development lineage

This public repository explains the development story without making either
private product repository part of the submission:

1. **Pre-app:** a private predecessor records the earlier blocker-first product,
   human interaction model, and broad application history. Its work predates the
   challenge and is not claimed as new competition work.
2. **WebMCP extension:** this repository is the independently buildable public
   and sanitized extension created during the challenge period. It narrows the
   product to the Guide → Work → Review → Next loop and adds the page-owned
   WebMCP catalog, visible receipts, human-controlled save boundary, and focused
   evidence.
3. **Current production app:** later product development remains private and is
   neither a build dependency nor evidence required to judge this submission.

This is an extension of a pre-existing project, not an edition label applied to
old work. The competition claim is the new browser-agent orchestration and the
bounded public implementation that makes it reviewable.

## Boundary of prior and new work

The 14 pre-existing `@wornpage/*` packages are reused dependencies, not claimed as challenge-period authorship: `svelte-frontend/package.json` consumes their public archives at 40-character Git revisions, and `svelte-frontend/package-lock.json` records archive integrity. The challenge work claim remains the WebMCP orchestration, four-route judge experience, and focused verification described here.

| Area | Existed before the challenge | Added or materially extended during the submission period |
| --- | --- | --- |
| Product concept | Work items with blockers, next actions, review, and proof | A browser-agent collaboration story grounded in the same visible pages |
| User interface | General Projects visual language and reusable Wornpage components | A four-route public judge edition and a challenge-specific guide |
| Data | Synthetic sample work | A static, browser-local state owner with no production API or account data |
| Browser integration | Human-operated pages | Lifecycle-safe `document.modelContext.registerTool` registration and teardown |
| Work | Filtered work list | Exact bounded projection plus reversible `show_work_search` |
| Review | Human review queue | Exact bounded projection plus reversible `set_review_scope` |
| Next | Human next-action editor | Readable editor projection plus non-persisting `prepare_next_action` |
| Verification | General application checks | Focused schemas, privacy projections, abort behavior, lifecycle, and prerender contracts |

## Public evidence map

| Claim | Public evidence |
| --- | --- |
| Shared registration owner | `svelte-frontend/src/lib/webmcp.mjs` |
| Guide tool and judge path | `svelte-frontend/src/routes/webmcp-challenge/` |
| Work reader and reversible search | `svelte-frontend/src/routes/work/work-webmcp.mjs` and `+page.svelte` |
| Review reader and reversible scope | `svelte-frontend/src/routes/review/review-webmcp.mjs` and `+page.svelte` |
| Next reader and unsaved preparation | `svelte-frontend/src/routes/next/next-webmcp.mjs` and `+page.svelte` |
| Tool and lifecycle contracts | `tests/*webmcp*.test.mjs` |
| Buildable static edition | `package.json`, `scripts/`, and `svelte-frontend/` |
| Exact published-file inventory | `PUBLIC_SOURCE_MANIFEST.txt` |

## History policy

- The fresh public history prevents removed production source from remaining reachable in old Git objects.
- Public commits use their real creation timestamps.
- No claim is made that the underlying Projects concept or general UI was created during the challenge.
- The submission claim is limited to the WebMCP extension, judge experience, focused verification, and public static extraction described above.
