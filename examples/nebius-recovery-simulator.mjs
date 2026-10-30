// Historical authored reference for isolated tests; never served by an active endpoint.
import {
  recoveryRecord, recoveryInteger, recoveryDays, recoveryList, recoveryIdentifier, recoveryPlan, recoverySchedule, validate,
  recoveryExamplePlan, recoveryCleared, recoveryResults, recoveryFromValues, handleMessage,
} from './recovery-simulator-logic.mjs';

export const RECOVERY_INPUT_FORMATS = Object.freeze([
  { id: 'plan-json', format: 'json' },
  { id: 'delay-task', format: 'text' },
  { id: 'delay-days', format: 'text' },
  { id: 'recover-task', format: 'text' },
  { id: 'recover-days', format: 'text' },
].map(Object.freeze));

export const RECOVERY_EXAMPLE_INPUT = recoveryExamplePlan();

export const RECOVERY_BRIEF = [
  'Build a project recovery simulator with editable task JSON and four scenario controls.',
  'This is an authored offline reference, not generated or verified by Nemotron. No AI call. No Sandbox run.',
  'Plan JSON contains exactly tasks. Each of 1 to 8 tasks has exactly id, title, duration and dependsOn.',
  'Use unique safe ASCII task IDs (1 to 80 characters, starting with a letter), readable plain titles (1 to 100 characters), integer durations 1 to 30, unique known dependency IDs and no cycles.',
  'Compute earliest starts from elapsed day 0; independent tasks run in parallel. This is an estimate, with no resource, holiday or calendar model.',
  'Delay adds 0 to 30 whole days to a selected task. Recovery subtracts 0 to 30 whole days from a selected task after delay, never below 1. Reject impossible reductions instead of clamping. Each comparison must finish within 90 days.',
  'Use exact inputs plan-json:json, delay-task:text, delay-days:text, recover-task:text and recover-days:text.',
  'Provide Baseline, Delay delivery and Recover one day example buttons. The supplied plan finishes in 7 days; delivery +2 finishes in 9; with assembly -1 it finishes in 8. Prepare +1 still finishes in 7; prepare +2 finishes in 8.',
  'Show baseline finish, delayed finish, recovered finish and days recovered (delayed finish minus recovered finish) as distinct metrics. Show a dependency timeline comparing baseline with recovered ranges, and explain affected tasks.',
  'Recalculate from the full current values on every input/change. Clear all old results and timeline on invalid input; show a useful error. Do not retain saved work or request a network.',
].join('\n');

function exampleHtml() {
  const plan = JSON.stringify(recoveryExamplePlan(), null, 2);
  return `<!doctype html>
<html lang="en">
<head>
<title>Project recovery simulator</title>
<style>
:root { color: #203e34; background: #f6f4ec; font-family: ui-sans-serif, system-ui, sans-serif; }
body { width: min(100%, 1120px); margin: auto; padding: 24px; }
main { display: grid; gap: 20px; }
h1 { font-size: clamp(1.7rem, 4vw, 2.8rem); letter-spacing: -.04em; margin: 6px 0 12px; }
h2 { font-size: 1.15rem; margin: 0 0 10px; }
p { margin: 8px 0; }
.eyebrow { font-size: .78rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.provenance { display: inline-block; padding: 7px 12px; border: 1px solid #9ead9e; border-radius: 30px; background: #edf0e6; }
.intro { max-width: 72ch; color: #52665a; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
button { padding: 11px 18px; border: 1px solid #245b48; background: #245b48; color: #fffdf6; border-radius: 8px; font-weight: 700; cursor: pointer; min-height: 44px; }
button[data-example-for] { background: #245b48; color: #fffdf6; border-color: #245b48; }
button#recover-day { background: #a3412f; border-color: #a3412f; color: #fff; }
button:hover { filter: brightness(.93); }
button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid #a3412f; outline-offset: 3px; }
.metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.metric { border: 1px solid #c7d0c1; border-radius: 12px; padding: 15px; background: #fffdf6; }
.metric p { font-size: .82rem; margin: 0; font-weight: 700; color: #52665a; }
.metric output { display: block; border: 0; min-height: 2.4rem; padding: 6px 0 0; font-size: clamp(1.5rem, 3vw, 2.1rem); line-height: 1.2; font-weight: 750; background: transparent; }
.metric [data-nebius-output-label] { margin: 0 !important; }
.metric small { display: block; margin-top: 8px; color: #52665a; }
.recovery { background: #e9eee2; border-color: #a3b59e; }
.panel { border: 1px solid #c7d0c1; border-radius: 12px; padding: 18px; background: #fffdf6; min-width: 0; }
output { white-space: pre-wrap; overflow-wrap: anywhere; }
#error { color: #933a2a; border: 0; padding: 0; min-height: 0; background: transparent; }
#error:empty { display: none; }
#impact { font-size: .9rem; padding: 12px; min-height: 0; }
#schedule { padding: 12px; min-height: 4rem; }
.controls { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
label { display: grid; gap: 6px; font-size: .85rem; font-weight: 700; }
input, textarea { width: 100%; max-width: 100%; min-width: 0; padding: 10px; border: 1px solid #aebdab; border-radius: 7px; font: inherit; color: #203e34; background: #fffdf8; box-sizing: border-box; }
textarea { font: .85rem/1.4 ui-monospace, monospace; min-height: 16rem; resize: vertical; }
summary { cursor: pointer; font-weight: 700; min-height: 44px; }
.rules { color: #52665a; font-size: .85rem; }
@media (max-width: 650px) { body { padding: 16px; } .metrics, .controls { grid-template-columns: repeat(2, 1fr); } .panel { padding: 12px; } }
</style>
</head>
<body>
<main>
<header>
<p class="eyebrow">Project → useful tool</p>
<p class="provenance">Authored offline example · No AI call · No Sandbox run</p>
<h1>One delay. A clearer recovery plan.</h1>
<p class="intro">Delay a delivery, follow its dependencies, then compare a one-day recovery. Estimates use elapsed days from 0.</p>
<div class="actions" aria-label="Load example scenario">
<button id="baseline" type="button" data-example-for="plan-json">Baseline</button>
<button id="delay-delivery" type="button" data-example-for="plan-json">Delay delivery +2 days</button>
<button id="recover-day" type="button" data-example-for="plan-json">Recover one day</button>
</div>
</header>
<output id="error" aria-label="Input error"></output>
<section class="metrics" aria-label="Schedule comparison">
<div class="metric"><p id="baseline-finish-label">Baseline finish</p><output id="baseline-finish" aria-labelledby="baseline-finish-label"></output><small>Original task durations</small></div>
<div class="metric"><p id="delayed-finish-label">Delayed finish</p><output id="delayed-finish" aria-labelledby="delayed-finish-label"></output><small>After added delay</small></div>
<div class="metric recovery"><p id="recovered-finish-label">Recovered finish</p><output id="recovered-finish" aria-labelledby="recovered-finish-label"></output><small>After duration reduction</small></div>
<div class="metric recovery"><p id="recovered-days-label">Days recovered</p><output id="recovered-days" aria-labelledby="recovered-days-label"></output><small>Delayed − recovered finish</small></div>
</section>
<section class="panel" aria-labelledby="timeline-heading">
<h2 id="timeline-heading">Follow the dependency timeline</h2>
<p class="rules">Baseline bars compare with the recovered scenario. With zero recovery, the recovered scenario equals the delayed schedule.</p>
<output id="schedule" data-output-format="timeline" aria-label="Dependency timeline"></output>
</section>
<section class="panel" aria-labelledby="impact-heading">
<h2 id="impact-heading">What moved, and why</h2>
<output id="impact" aria-label="Affected tasks and calculation"></output>
</section>
<details class="panel">
<summary>Edit the plan and scenario</summary>
<p class="rules">Use task IDs from the JSON. A zero-day adjustment makes no change. Every edit recalculates; errors clear the comparison.</p>
<div class="controls">
<label for="delay-task">Delay task ID<input id="delay-task" type="text" data-input-format="text" value="delivery" maxlength="80"></label>
<label for="delay-days">Added days<input id="delay-days" type="text" data-input-format="text" value="0" inputmode="numeric" maxlength="2"></label>
<label for="recover-task">Recovery task ID<input id="recover-task" type="text" data-input-format="text" value="assemble" maxlength="80"></label>
<label for="recover-days">Reduced days<input id="recover-days" type="text" data-input-format="text" value="0" inputmode="numeric" maxlength="2"></label>
</div>
<label for="plan-json">Task plan JSON<textarea id="plan-json" data-input-format="json" maxlength="4000" rows="18" spellcheck="false">${plan}</textarea></label>
</details>
<footer class="rules">
<strong>Calculation assumptions</strong>
<p>Earliest starts follow dependencies; independent tasks run in parallel. No resource limits, holidays or calendar dates are modeled. These are projected durations, not actuals or commitments.</p>
<p>Use 1–8 tasks, integer durations 1–30 days, and delay/recovery 0–30 days. Each comparison must finish within 90 elapsed days. Recovery is rejected if any task would fall below 1 day.</p>
<p>Calculations stay in this preview. Edits are not saved.</p>
</footer>
</main>
</body>
</html>`;
}

// This body becomes checks.cjs and executes against the actual app functions.
function exampleChecks() {
  const tasks = [
    { id: 'brief', title: 'Confirm brief', duration: 1, dependsOn: [] },
    { id: 'delivery', title: 'Delivery', duration: 3, dependsOn: ['brief'] },
    { id: 'prepare', title: 'Prepare workspace', duration: 2, dependsOn: ['brief'] },
    { id: 'assemble', title: 'Assembly', duration: 2, dependsOn: ['delivery', 'prepare'] },
    { id: 'review', title: 'Review', duration: 1, dependsOn: ['assemble'] },
  ];
  const plan = { tasks };
  assert.equal(validate(plan).baseline.finish, 7);
  const delayed = validate({ tasks, delayTask: 'delivery', delayDays: 2 });
  assert.equal(delayed.delayed.finish, 9);
  const recovered = validate({ tasks, delayTask: 'delivery', delayDays: 2, recoverTask: 'assemble', recoverDays: 1 });
  assert.equal(recovered.recovered.finish, 8);
  assert.equal(recovered.daysRecovered, 1);
  assert.deepEqual(recovered.recovered.rows.map(row => [row.id, row.start, row.end]), [
    ['brief', 0, 1], ['delivery', 1, 6], ['prepare', 1, 3], ['assemble', 6, 7], ['review', 7, 8],
  ]);
  assert.equal(validate({ tasks, delayTask: 'prepare', delayDays: 1 }).delayed.finish, 7);
  assert.equal(validate({ tasks, delayTask: 'prepare', delayDays: 2 }).delayed.finish, 8);
  assert.equal(validate({ tasks, recoverTask: 'assemble', recoverDays: 2 }).ok, false);
  assert.equal(validate({ tasks: [...tasks, tasks[0]] }).ok, false);
  assert.equal(validate({ tasks: [{ id: 'x', title: 'X', duration: 1, dependsOn: ['missing'] }] }).ok, false);
  const initialValues = { 'plan-json': JSON.stringify(plan), 'delay-task': 'delivery', 'delay-days': '0', 'recover-task': 'assemble', 'recover-days': '0' };
  function output(patches, id) {
    return patches.find(patch => patch.id === id);
  }
  const initial = handleMessage({ type: 'init', values: initialValues });
  assert.equal(output(initial, 'baseline-finish').text, '7 days');
  assert.equal(output(initial, 'delayed-finish').text, '7 days');
  assert.equal(output(initial, 'recovered-finish').text, '7 days');
  assert.equal(output(initial, 'recovered-days').text, '0 days');
  assert.equal(output(initial, 'error').text, '');
  assert.equal(output(initial, 'schedule').timeline.horizon, 7);
  assert.match(output(initial, 'impact').text, /No task ranges changed/u);
  for (const [id, expected] of [['baseline', 7], ['delay-delivery', 9], ['recover-day', 8]]) {
    const patches = handleMessage({ type: 'event', event: 'click', id, values: initialValues });
    assert.equal(output(patches, 'recovered-finish').text, expected + ' days');
    assert.equal(output(patches, 'recovered-days').text, id === 'recover-day' ? '1 day' : '0 days');
    assert.equal(JSON.parse(output(patches, 'plan-json').value).tasks.length, 5);
    assert.equal(output(patches, 'schedule').timeline.rows.length, 5);
  }
  for (const id of ['plan-json', 'delay-task', 'delay-days', 'recover-task', 'recover-days']) {
    for (const event of ['input', 'change']) {
      handleMessage({ type: 'init', values: initialValues });
      const editedValues = { ...initialValues };
      if (id === 'plan-json') editedValues[id] = JSON.stringify({ tasks: [{ id: 'only', title: 'Only task', duration: 4, dependsOn: [] }] });
      if (id === 'plan-json') { editedValues['delay-task'] = 'only'; editedValues['recover-task'] = 'only'; }
      if (id === 'delay-task') { editedValues[id] = 'prepare'; editedValues['delay-days'] = '2'; }
      if (id === 'delay-days') editedValues[id] = '2';
      if (id === 'recover-task') { editedValues[id] = 'delivery'; editedValues['recover-days'] = '1'; }
      if (id === 'recover-days') editedValues[id] = '1';
      const patches = handleMessage({ type: 'event', event, id, values: editedValues });
      const expected = { 'plan-json': 4, 'delay-task': 8, 'delay-days': 9, 'recover-task': 6, 'recover-days': 6 };
      assert.equal(output(patches, 'recovered-finish').text, expected[id] + ' days');
      assert.equal(output(patches, 'error').text, '');
      assert.ok(output(patches, 'schedule').timeline.rows.length > 0);
    }
  }
  for (const malformed of ['{', 'null', '{"tasks":[]}']) {
    handleMessage({ type: 'init', values: initialValues });
    const invalidValues = { ...initialValues, 'plan-json': malformed };
    const patches = handleMessage({ type: 'event', event: 'input', id: 'plan-json', values: invalidValues });
    assert.ok(output(patches, 'error').text.length > 0);
    for (const id of ['baseline-finish', 'delayed-finish', 'recovered-finish', 'recovered-days', 'schedule', 'impact']) {
      assert.equal(output(patches, id).text, '');
      assert.equal(Object.hasOwn(output(patches, id), 'timeline'), false);
    }
  }
}

export function recoveryExampleFiles() {
  const functions = [recoveryRecord, recoveryInteger, recoveryDays, recoveryList, recoveryIdentifier, recoveryPlan, recoverySchedule, validate,
    recoveryExamplePlan, recoveryCleared, recoveryResults, recoveryFromValues, handleMessage];
  const body = exampleChecks.toString();
  return [
    { path: 'index.html', content: exampleHtml() },
    { path: 'app.js', content: functions.map(fn => fn.toString()).join('\n\n') + '\n' },
    { path: 'checks.cjs', content: body.slice(body.indexOf('{') + 1, body.lastIndexOf('}')).trim() + '\n' },
  ];
}
