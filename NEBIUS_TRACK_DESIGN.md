# Track fit and model routing

## Product decision

Primary track: **Best Apps and Agents**. The product is a project copilot for a
person turning an uncertain goal into work they can carry out: plan, choose a
next step, adapt when circumstances change, and review supplied evidence.
Success is an understandable, useful project journey rather than a catalog of
AI buttons. Browser-local persistence and explicit approval remain core.

The current build offers hand-written website-release, workshop and handoff
examples as editable unsaved plans. These are labeled examples and use the
manual path. They do not masquerade as live model results.

## Explicit routing policy

| Operation | Configured role | Initial model candidate | Output ceiling |
| --- | --- | --- | ---: |
| Suggest next step | Routine | Nemotron 3 Nano | 1,200 tokens |
| Review evidence | Reasoning | Nemotron 3 Super | 1,200 tokens |
| Plan project | Reasoning | Nemotron 3 Super | 4,000 tokens |
| Replan project | Reasoning | Nemotron 3 Super | 4,000 tokens |

The deployment owner supplies exact catalog IDs through `NEBIUS_MODEL_ROUTINE`
and `NEBIUS_MODEL_REASONING`. The app does not infer an ID from a family name.
The reasoning role can deliberately use Ultra for difficult dependency or
evidence cases after a comparison justifies it. There is no automatic upgrade,
model fallback or retry. The old single-model setting has been removed.

The client requests configuration for its exact operation. The server chooses
that operation's role before validating the request's model identity. A changed
model setting rejects the request before budget reservation/inference. The
displayed output ceiling and provider `max_tokens` use the same profile.

The candidate choices are based on Nebius's descriptions of Nano for efficient
everyday work, Super for balanced reasoning, and Ultra for demanding reasoning.
They are hypotheses to evaluate, not measured app quality or latency claims.
[Official model overview](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference)
and [official Nemotron cookbook](https://github.com/nebius/token-factory-cookbook/tree/main/models/nemotron).

## Spend and evidence

Each explicit advisory generation makes at most one provider call. Task execution
permits at most two model calls within the run, including its one repair.
All operations share
the configured daily call ceiling and IP limit. A bounded input and output cap
constrain request size; these limits are not a dollar budget. Displayed token
usage is provider-reported actual usage for a successful response, not an
estimate of money spent. Failed calls may also incur charges and consume a
reservation. No credentials or live calls are required for example/manual use.

Model availability, account entitlement, exact JSON mode, response envelope,
quality and latency need live validation when the owner configures access.
Nebius documents `json_object` and `json_schema`; model-specific support is
indicated by the catalog's JSON-mode tag. This app retains local structural
validation regardless of format support.
[Structured output documentation](https://docs.tokenfactory.nebius.com/ai-models-inference/json)
and [API quickstart](https://docs.tokenfactory.nebius.com/quickstart).

## Coding and Agentic Engineering assessment

Nebius documents Sandboxes as a beta code-execution service with checkpoints,
branching and asynchronous operations. That is relevant to a future developer
workflow: run a supplied example repository's checks, propose a repair, and
attach observed logs/artifacts to a project task. Such a feature needs explicit
repository/file selection, execution authorization, runtime/resource limits,
cancellation, artifact provenance and a separate spend policy.
[Official Sandbox overview](https://docs.tokenfactory.nebius.com/sandboxes/overview).

The owner selected a bounded execution milestone: one existing task produces
a browser tool, checks its generated logic in a Sandbox, optionally repairs
it once, and returns files and execution evidence to Review. The implementation
uses the existing task, criteria, state and approval owners. Its generated
checks are agent-authored; they are not independent acceptance. See
[execution design and setup](NEBIUS_EXECUTION.md).

Execution is disabled by default. One configured local Super run has actual
provider evidence: a failed Sandbox check, one repair and a passing check.
Its unchanged retained files passed independent packet cases and interaction
in Review. This gives the coding-track story a working example; broader quality,
the final demonstration video and track eligibility remain separate gates. See
[current readiness](NEBIUS_READINESS.md#current-runtime-status--october-2-2026).

## Hosting and remaining gates

The current architecture uses a bounded Token Factory inference call behind the
existing Worker. Optional Nebius Serverless Endpoints/Jobs remain candidates
for later hosting/background workloads under the user's track description.
This design does not authorize new infrastructure or deployment.

1. Run and assess live Nano/Super cases with actual model IDs and token usage.
2. Compare an Ultra reasoning profile only for identified hard cases; record
   quality, elapsed time and usage against the same input.
3. Rehearse the complete project story, including an imperfect outcome.
4. Record hosted access, public-source/license consistency and video evidence
   before submission; local checks do not pass these gates.
