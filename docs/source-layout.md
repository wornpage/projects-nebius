# Active Nebius source

This private successor has one application build. `npm run build` creates the
Nebius frontend and its static assets; `npm run preview` opens a credential-free,
read-only loopback preview. Direct frontend Vite entry points use the same
Nebius landing page, seed and policy. There is no public WebMCP build command.

## Owners

- Token Factory streaming is owned by `worker/nebius-generation-stream.mjs`;
  `nebius-run-provider.mjs` submits once and passes a completed envelope through
  the existing source validators. The parser starts no network request.

- Work owns task intake, project scope, backup/import/reset and saved browser work.
- Task (`/next`) owns Brief, Tool and Review. Its review components remain in
  `routes/review/NebiusRunReview.svelte` and `routes/next/NebiusEvidenceReview.svelte`.
- The existing browser storage key and revision/locking protocol are unchanged.
- The Theme preference and both Neutral/Original palettes are unchanged.
- Build finalization owns CSP hashes, the service-worker asset list and cache generation.
- Current verification helpers remain under `tests/` and `scripts/`; filenames
  inherited from WebMCP do not by themselves make shared regression logic obsolete.

## Saved browser state

Compatibility retained:
- Consumer: browser profiles and backups created before the WebMCP removal,
  including existing work and pending action drafts.
- Owner: the browser-state and backup code in `demo-client.ts` and the pending
  approvals interface.
- Removal condition: explicit owner authorization and a verified migration of
  existing saved data.
- Test coverage: the state-integrity and orphan-draft backup contracts, plus
  browser checks for legacy-state recovery and absent page-tool registration.
- Why hard cutover is unsafe now: changing the storage key or discarding
  unresolved drafts could lose a person's saved work.

Well-formed drafts with unresolved or ambiguous references remain available to
inspect or discard, but cannot be approved or revised. An ambiguous backup
merge is refused without writing either workspace.

## Saved URLs

Compatibility retained:
- Consumer: saved Priority, Review, Guide and WebMCP-guide URLs, including
  backup bookmarks and task focus links in retained work/history.
- Owner: `savedNebiusLinkDestination` and `SavedLinkRedirect.svelte`.
- Removal condition: explicit owner authorization to retire the saved URL contract.
- Test coverage: existing navigation/workspace checks remain; the current change
  is qualified separately by source review, build and recorded browser observations.
  No previous test count automatically qualifies this successor.
- Why hard cutover is unsafe now: deleting URLs would break existing saved links.

Priority redirects to Work's review filter. A Review URL with one nonempty
`focus` redirects to Task Review; missing/empty/duplicate focus redirects to
Work. Guide and WebMCP-guide backup bookmarks open Work backup; other links
open landing/help. Existing query values and hashes are retained. These routes
contain only redirects and a fallback link, with no old queue or guide screen.

Compatibility retained:
- Consumer: older shared metadata or links to `/assets/og-image-7876d230.png`.
- Owner: static asset build and cache headers.
- Removal condition: explicit owner authorization to retire the old image URL.
- Test coverage: `tests/nebius-social-image.test.mjs` verifies the old and new
  URLs contain the same repaired image and use the intended cache policies.
- Why hard cutover is unsafe now: older shared URLs can still request the old path.

New metadata uses `/assets/og-image-511ed6d2.png`, whose content hash matches its
versioned name. Existing cached responses for the old URL cannot be forcibly
invalidated. When a public host is chosen, set `NEBIUS_PUBLIC_ORIGIN` and run
`npm run build:release` to embed its absolute image URL in the generated HTML.
The release build requires a valid HTTPS origin; ordinary local builds may keep
the relative path. Verify public crawler access separately after release.

## Historical material

The frozen public WebMCP repository, source-25 snapshot and sealed evaluation
packets remain separate. Historical recording/staging programs and rejected
SDK experiments do not belong in this application's active build or command
surface. The five preparatory runtime modules in packet 31 are not integrated
or treated as a finished runner here. Their failed attempts, hashes and review
records remain intact in the private evidence archive.

Source publication, hosted access, provider evaluation and formal acceptance
remain separate owner decisions. This consolidation makes no provider call.

## Verification scope changes

The current static-artifact file retains five existing cases adapted to Nebius;
four public-guide/recording cases were retired. Two source-inspection cases for
the removed recorder were retired while its two pure replay/AX validators were
moved intact to `scripts/nebius-retained-checker.mjs`. Three obsolete page-tool
contract suites were removed with their screens/helpers. Shared current
workspace and state regression files remain. Browser helpers now target Work
backup and Task tabs; old queue-tool restoration, normal Guide reset and Guide
Tools-dialog scenarios were retired. These source changes are not executed
test outcomes, and previous suite denominators remain historical.

The supported `verify` command explicitly retains 12 shared regression files
under `test:shared`, alongside the Nebius and static-artifact suites. State
migration/locking, stale writes, backup, toast ownership, focus and source
inventory coverage stay in the current contract. Only references to retired
full Guide/Review screens were removed or retargeted. No automated suite was
run for this consolidation unless a separate evidence receipt says otherwise.

The Task browser helpers use Brief / Tool / Review, explicitly open the Evidence
disclosure before entering new text, and read criteria from Current completion
criteria. They no longer exercise the former screen's optional AI-evidence-review
controls: its response-state loop, keyboard segment and offline-control assertion
were retired. Synthetic provider-failure scenarios in that helper change from
12 to 6 (two widths, three failure modes, suggestion only). The API/client/contract
suites remain; this does not claim equivalent browser coverage or a passing run.

The compiled-parent preview count is 25 observations per viewport (75 across
three viewports). Its old count of 26 included the Review queue restoration
scenario retired during consolidation; that historical denominator was not
updated with the removal. Packet cases remain 24 per viewport (72 total).
