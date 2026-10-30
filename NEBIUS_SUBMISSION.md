# Wornpage Projects — Nebius edition

Wornpage Projects connects a project goal to tasks, working tools and the evidence behind a human decision. When configured and enabled, a person can ask NVIDIA Nemotron through Nebius Token Factory to build a small browser tool for a task, inspect its generated source and checks, and decide what to keep.

The workflow is aimed at project owners coordinating work whose requirements may change. Work shows the project context; Task brings the brief, tool and review together. A changed request leaves the earlier result available as history but does not make the old checks evidence for the new requirement.

## Demonstration and limitations

A recorded release-packet checker illustrates the workflow. It examines supplied packet text and reports missing fields; it does not inspect live services or approve a release. A historical checker run passed a Sandbox check after one repair. Model-authored checks and separate independent observations must be identified separately.

The Recovery Simulator is a bundled modeled example with assistant-authored repairs and extensions after an earlier failed model attempt. It should not be described as a fresh successful model generation without new evidence.

## Model approach

The application uses task-specific prompts and structured output requirements rather than fine-tuning Nemotron. It validates generated files, can run bounded Sandbox checks and allow one conditional repair, and leaves evidence and task completion to a person.

## Submission links

- [Hosted app](https://nebius.projectsdemo.org/work), protected by Cloudflare Access. Working judge access instructions must be supplied separately.
- [Workflow video](https://www.youtube.com/watch?v=Vzg4or-2-Xg), 2:56.
- [Source repository](https://github.com/wornpage/projects-nebius), with the MIT license. Public visibility must be confirmed before submission.
- [Devpost entry](https://devpost.com/software/wornpage-projects-nebius-edition).

The hosted deployment is managed separately. This source update does not enable fresh generation, change judge access or modify the approved video.
