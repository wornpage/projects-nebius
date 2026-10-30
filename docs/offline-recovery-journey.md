# Offline recovery journey — private UI lab

Use a project whose goal is to compare recovery options and record assumptions. The retained Recovery Simulator is a fixed five-task reference with editable delivery, preparation and assembly durations, a delivery delay, a target finish and four recovery options. The broader **Build a project recovery simulator** starter remains a separate build request; the reference does not establish that request's completion.

## Walk the flow

1. Create or choose a project and open a task's Brief. State the target finish and what observations will support your decision.
2. Open Tool and choose **Try offline Recovery Simulator**. The example keeps the exact task ID and shows its project goal and saved requirements.
3. Try the options in the actual simulator. With default durations and a two-day delivery delay, the original finish is day 7 and waiting finishes day 9. Expediting finishes day 7; expediting plus assembly help finishes day 6.
4. Choose **Review this task**. Record the option, finish day and assumptions you actually observed. Saving evidence keeps the task open.
5. If the requirement changes, edit Brief and review/apply that change. Reopen the reference, enter the revised target and compare again. Earlier observations remain history; they do not establish the revised target.
6. Record the new observations, then make the separate human completion decision. Existing project progress and dependency release continue through the normal Task actions.

Back to Task returns to the Tool tab. The Work entry also carries the explicitly selected task when one exists. Opening the route without a task keeps its standalone Back to Work path. Missing, empty or duplicate task parameters do not select another task implicitly. Larger view and download contain only the standalone tool.

Brief and Review also offer **Other completed work in this project** when another task has saved evidence. Open it to read the comparison while composing the current decision. The reference does not fill or save the current task's evidence. Its history link opens a separate tab so a draft stays available.

Future evidence saves retain separate lines and paragraphs. Existing records are unchanged. Completed and archived evidence is read only and can be reached and selected with the keyboard. Saving evidence and marking a task done remain separate actions.

## Evidence boundaries

The page labels the tool **Authored offline reference** and exposes its source history. It includes authored changes to an earlier Nemotron attempt that failed its checks. Trying it does not create a run reference, model call, Sandbox receipt, completion evidence or completed task. Its input/output source and admission pins stay unchanged.

The task context uses the existing local workspace owner and refreshes on window focus. It does not feed task text into the simulator iframe or any service. The iframe keeps the same fixed API URL and `sandbox="allow-scripts"` boundary. Human observations and completion use the existing Review flow and its dirty/stale guards.

Run `npm run test:nebius:recovery-flow` on a built local artifact to exercise the journey. It uses a new browser context with authored fixture work, the real UI forms and pinned simulator rendered by the existing production renderer. The test host refuses writes and external requests, and disables server-side outbound fetch. Actual owner browser storage, credentials, original repository, competition demo and approved video are outside this test state.
