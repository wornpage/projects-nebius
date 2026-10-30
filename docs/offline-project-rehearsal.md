# Offline project rehearsal — private UI lab

Open **Work → Project rehearsal** in the isolated UI lab. The disclosure is closed by default. This is a temporary frontend prototype: it makes no model or Sandbox calls and cannot save a revised project.

## Try it

1. Use the clearly labeled authored offline example, or select a saved project in Work first.
2. Enter a new requirement and choose the task that would wait for it.
3. Choose **Preview change**. Compare **Current** with **Preview** using the diagrams or the keyboard-accessible task lists.
4. Edit an input or choose **Reset preview** to clear the proposed change. Selecting another project also invalidates it.

The proposed task is inserted immediately before its chosen successor. It inherits that task's existing dependency; the chosen task waits for the new requirement. Existing tasks retain their relative order. Completed and archived tasks cannot be selected as the successor. No ranking, dates or duration estimates are invented.

## What the comparison means

| Display | Definition |
|---|---|
| Current | Read-only projection of the complete selected project, in the current Work sort order, before task filters |
| Preview | Temporary projection with one additional draft task and one changed dependency/status |
| Marked done / total | Uses the existing project progress definition; the total includes archived tasks |
| Preview total | Current total plus one; no completed task is added |
| Added / Changed / Unchanged | Explicit text labels for proposed changes; color is supplementary |
| Saved run attached | An existing attachment only; it does not establish correctness or verify the new requirement |
| Authored offline example | Human-written illustrative tasks; not a saved project, provider result or Sandbox receipt |

The view copies only project identity/goal and visible task identity, title, status, archive/dependency/blocker fields plus a saved-run attachment boolean. It does not copy run keys, generated source, completion evidence or other private task content. Rehearsal state lives only in the mounted component. No Apply or Save action exists.

## Isolation and checks

The model has focused tests for graph insertion, immutability, malformed input, privacy and denominators. The browser check exercises Current/Preview, reset, source invalidation, task links and native keyboard navigation at 375px and 1280px in all four explicit palettes. Browser checks serve local static files, refuse writes and external requests, and use authored fixtures only.

This prototype is not a live Nebius evaluation, release, submission or formal acceptance. It leaves the existing Work/Task workflow, saved-work model and approval logic intact.
