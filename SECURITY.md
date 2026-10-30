# Security — draft for private review

This draft describes the Nebius edition rather than the older static-only challenge application. It has not been approved or installed in a release.

## Reporting

Report suspected vulnerabilities privately through the security-advisory mechanism for the repository selected for release. Do not include secrets, run access keys, private task data or personal data in a public issue. Confirm that private reporting is enabled for that repository before publication.

## Application surface

The application includes a Svelte frontend and a Cloudflare Worker. The Worker serves the frontend and handles Nebius API and run routes; Durable Objects maintain execution records and budget counters. When separately configured and enabled, server-side routes can send selected task information to Nebius Token Factory and use Nebius Sandbox. Do not describe this edition as having no server functions or production API.

The credential-free local preview described in the README loads no provider credentials, disables its provider API routes and rejects server-side fetch. It is not an operating-system network sandbox. Live inference and Sandbox execution require separate configuration. Review the actual deployment's Access, origin restrictions, limits, headers and authentication; a private development setting is not proof of a public deployment's security.

## Secrets and saved work

Keep Nebius credentials and other secrets in the hosting platform's secret mechanism, outside source files, browser-delivered assets, logs and version control. Do not commit `.dev.vars`, `.env` files, keys, workspace exports or local runtime state. Review the intended source package and history before making it public.

Project work is stored in the browser. Workspace backups may contain private task data, saved run results and run access keys; treat them as sensitive and share them only intentionally. Clearing browser storage removes that local data, so make an intentional backup before relying on it for recovery.

## Generated tools

Generated source is untrusted. The application validates admitted source, supplies its own bridge and previews tools in an isolated browser frame; separately configured Nebius Sandbox checks execute within a bounded run. Inspect the actual implementation and the deployed configuration before relying on those controls. A model-authored check is not an independent security review, and the local Node `vm` used by the check runner is not the container security boundary.
