# Nebius edition

Wornpage Projects connects project goals, tasks, tools and evidence. The Nebius edition adds optional NVIDIA Nemotron inference and Sandbox checks to the Work → Task → Brief/Tool/Review workflow. Saving evidence and marking work done are separate human actions.

## Provider-free local preview

Follow README.md to install from the lockfiles, build and start the loopback preview. The default configuration has AI and execution disabled. Manual work and the bundled examples do not require provider credentials or paid calls.

Choose Work → Try recovery simulator to compare modeled recovery options. These projections do not establish supplier availability, staffing feasibility or a real project outcome. The bundled recovery example includes assistant-authored changes to an earlier failed model attempt.

## Optional provider configuration

An operator can configure exact model IDs, the allowed origin, server-held Token Factory credentials and usage limits in an ignored local environment file. For tool builds, the separately configured Sandbox project, image and token are also required. The default source contains no live credentials or account-specific deployment IDs.

Enabling a provider path does not itself establish that a response will be useful or that a deployment is accessible to judges. A person should review the data and limits before authorizing a call, inspect returned files and checks, and avoid retrying uncertain paid outcomes. See NEBIUS_EXECUTION.md for the execution boundary and NEBIUS_PROVENANCE.md for model and dependency terms.

## Verification

The repository includes unit, frontend, runtime and browser checks. Start with the locked installation and commands in README.md; some browser checks require an installed compatible Chromium executable. Keep offline test results, actual provider observations, hosted behavior and human acceptance separate.
