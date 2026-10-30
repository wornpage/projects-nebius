# Demo access

## Hosted judge workspace

Open https://judge-nebius.projectsdemo.org/work and enter the credentials in the submission’s private instructions under “Judge sign-in — Work and Task.” No registration, email code or provider API key is needed. Access is free to judges through December 23, 2026. Do not put credentials in this repository.

The judge deployment uses `nvidia/Nemotron-3.5-Super-VL` through Nebius Token Factory’s shared serverless endpoint. Live planning, next-step suggestions, evidence review and tool builds share an initial allowance of **20 model calls total**, without an automatic refill. A build permits at most two model calls of 32,000 output tokens each, one conditional repair and two Sandbox checks of 30 seconds each, within ten minutes. Planning can use two calls; next-step guidance, evidence review and replanning each use one. If the allowance is exhausted, contact the submitter; recorded examples remain available.

Projects and notes are stored in the judge’s browser, and generated runs use separate judge storage. The owner’s drafts and saved runs are not shared. The owner workspace at `nebius.projectsdemo.org/work` remains behind Cloudflare Access with generation disabled.

## Recorded walkthrough

The public interactive checker is https://nebius.projectsdemo.org/landing#recorded-example and needs no sign-in. The public workflow video is https://www.youtube.com/watch?v=Vzg4or-2-Xg. They replay the retained Nemotron 3 Super checker; neither is evidence of a new 3.5 Super VL generation. No new model or Sandbox call is made when trying the recorded checker.

For an independently runnable preview without credentials, follow README.md and open the loopback address printed by the preview process.

## Try the local preview

1. In Work, select or create a project and review its goal, tasks and dependencies. Open a task to inspect Brief, Tool and Review. Saving evidence and completing work are separate human actions.
2. Choose Work → Try recovery simulator to compare modeled options against a target finish. A modeled suggestion does not confirm supplier or staffing availability.
3. Use the landing-page recorded checker example to inspect its supplied packet inputs and bundled tool. A replay is historical and makes no new model or Sandbox call.

The credential-free preview has AI and execution disabled and does not provide saved-run preview POSTs. A configured Worker and explicitly authorized provider calls are required for fresh generation; see NEBIUS.md and NEBIUS_EXECUTION.md.

Local browser observations do not establish judge access or full accessibility conformance. The deployment owner must separately configure and verify hosting, access, provider settings and spending.
