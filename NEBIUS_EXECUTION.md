# Task execution and preview

A person can authorize a bounded tool build for a saved task when inference and execution are explicitly configured. The request uses the selected task fields and declared tool requirements. The model may return an index.html page, DOM-free app.js logic and checks.cjs checks. The app validates the response, supplies its own bridge, and may request one repair under the configured run limits.

Nebius Sandbox executes bounded checks when enabled. Generated checks are model-authored; Wornpage also supplies structural validation and a check harness. Passing those checks does not by itself establish that every task-specific requirement is met. The person reviews the tool and evidence, and separately chooses whether to mark the task done.

## Preview and records

The application renders admitted output in an isolated preview frame. Its bridge limits the updates generated logic can request. Inspect and test the actual deployment configuration before relying on any security property. A saved run is tied to the request it received; a changed requirement makes its earlier evidence stale for the revised request.

Run references use access keys. Workspace backups may include those keys, task information and results; treat them as sensitive. A missing or uncertain response must not be treated as a free or unexecuted request. Do not retry an uncertain paid operation automatically.

## Local configuration

The default configuration keeps advisory inference and execution disabled. To configure a private local test, put operator-supplied values in an ignored local environment file or a server-side secret store, never browser assets or source control. The operator must supply an allowed origin, available model IDs, a Token Factory API key, and the relevant Sandbox project, image and bearer token before enabling execution. Configure and inspect the available call and run limits before consent.

The source reads NEBIUS_ENABLED, NEBIUS_EXECUTION_ENABLED, NEBIUS_ALLOWED_ORIGIN, NEBIUS_MODEL_ROUTINE, NEBIUS_MODEL_REASONING, NEBIUS_API_KEY, NEBIUS_SANDBOX_PROJECT_ID, NEBIUS_SANDBOX_NODE_IMAGE_UUID and NEBIUS_SANDBOX_IAM_TOKEN. See NEBIUS.md for setup and the execution contract for current validation and limits. Configuration alone does not prove provider availability or authorize a paid run.

For provider-free examples and checks, use the local preview and tests in README.md. Official service references: [Token Factory Sandboxes](https://docs.tokenfactory.nebius.com/sandboxes/overview) and [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
