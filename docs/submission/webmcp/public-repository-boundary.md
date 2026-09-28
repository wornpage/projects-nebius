# Public repository boundary

## Included

- The landing page and five judge routes: Guide, Priority, Work, Review, and Next.
- Route-owned WebMCP descriptors and one lifecycle-safe registration helper.
- Deterministic synthetic sample data and browser-local state.
- Only the shared workflow and Wornpage UI pieces required by those routes.
- Static build scripts, locked dependencies, focused contracts, and submission documentation.
- `PUBLIC_SOURCE_MANIFEST.txt`, generated from the final tracked tree.

## Excluded

- Every unrelated product route.
- Production Worker and server entry points, Pages Functions, Durable Objects, queues, storage, and MCP servers.
- Authentication, authorization, billing, account, team, token, backup, export, and private-content implementation.
- Cloudflare account configuration, deployment identifiers, API tokens, Access policy, and local environment files.
- Private repository history, internal notes, generated audits, screenshots, logs, dependencies, caches, and build output.
- Customer, account, payment, workspace, or private-note data.

## Publication and license consequence

The boundary reduces what is published; it does not make published code secret. The MIT License permits reuse, modification, redistribution, sublicensing, and commercial use when its conditions are followed. Publication should be treated as irreversible even if repository visibility changes later.

The production product remains outside this repository. No compatibility copy, dormant route, or fallback implementation is retained here.
