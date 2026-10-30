# Recovery Simulator

## Use the example

Choose **Work → Try recovery simulator**, or open `/recovery-rehearsal`. Follow [local setup](../README.md#run-without-credentials) to build and start the provider-blocking loopback preview.

| Purpose | Canonical path |
| --- | --- |
| Isolated preview | `/api/nebius/examples/recovery-simulator` |
| Same tool as HTML download | `/api/nebius/examples/recovery-simulator/download` |
| Source bundle | `examples/nebius-recovery-simulator.json` |

The old `project-recovery` and `project-recovery-repaired` example paths, including download variants, redirect to the canonical route. They do not identify additional active simulator implementations.

Compatibility retained:
- Consumer: the owner's existing bookmarks and private demo links for the two preceding example paths and their downloads.
- Owner: the Wornpage Nebius edition maintainer.
- Removal condition: the owner confirms those saved links have been migrated or retired.
- Test coverage: `tests/nebius-recovery-example.test.mjs` exercises all four redirects through the actual Worker, including request guards.
- Why hard cutover is unsafe now: the user explicitly asked to preserve saved links; redirects retain access without another source owner or runtime implementation.

## Inputs, outputs and assumptions

The six inputs are delivery delay (0–10 days), target day (1–40), recovery choice, original delivery duration (1–10), preparation duration (1–10) and assembly duration (1–10). Numeric inputs accept canonical unsigned ASCII integers. Choice is one of `none`, `expedite`, `help`, `both`.

The twelve outputs comprise original, delayed and selected finish; target status; four option comparisons; limiting-task explanation; decision note; five-row timeline; and validation error. Invalid input clears all eleven non-error outputs and disables the suggestion action. Valid edits restore calculated output.

The fixed plan is **Brief → parallel Delivery and Preparation → Assembly → Review**. Brief and review each last one day. Assembly waits for both parallel tasks. Baseline finish is `2 + max(delivery, preparation) + assembly`. Expediting removes up to two added delay days without shortening the original delivery. Help removes one assembly day, with a one-day minimum.

This bundled example has a fixed five-task topology. The separately reviewed `project-recovery` model starter requests scheduling from arbitrary one-to-eight-task JSON; that starter is unchanged. The bundled example does not qualify arbitrary project graphs or that generation task.

| Quantity | Definition |
| --- | --- |
| Original finish | Finish using original durations and no delay or intervention |
| Delayed finish | Finish with added delivery delay and no intervention |
| Selected finish | Finish with current delay and manually selected intervention |
| Saved days | Delayed finish minus selected finish |
| Lateness | Positive difference between selected finish and target |
| Target status | Whether the modeled selected finish meets the target |
| Timeline | Projected elapsed-day intervals; original ranges remain visible |

These are projections, not actual progress or calendar dates. Cost, feasibility, working calendars and shared-resource constraints are not modeled. Every option shares the same timeline horizon for the current inputs. The original ranges do not change when only delay or choice changes.

## Compare before deciding

Defaults are delay 2, target 7, no action, delivery 3, preparation 2 and assembly 2. Original finish is Day 7; delayed finish is Day 9. Expedite reaches Day 7, help Day 8, and both Day 6. The default suggestion is expedite.

The preparation preset sets preparation to 6 and target to 8: original and delayed finishes are Day 10. Expediting cannot help because preparation controls assembly start. Help reaches Day 9 and still leaves one day late.

Suggestions first prefer options meeting the target with the fewest interventions, then earlier finish, then stable option order. If no option meets the target, the earliest modeled finish wins, then fewest interventions and stable order. This is deterministic calculation. It never automatically changes the selected choice; using the suggestion is a separate manual decision.

## Development provenance and evidence limits

The bundled example includes assistant-authored repairs and extensions after an earlier model attempt failed. It is not a fresh successful model or Sandbox result. See repaired-recovery-provenance.md.

Local tests and recorded examples apply only to the sources and environments they exercise; they do not establish hosted access or acceptance for a later candidate.
