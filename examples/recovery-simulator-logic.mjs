// Pure authored scheduling logic. Source functions are also used in the browser tool.
export function recoveryRecord(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return false;
  if (required.some(key => !keys.includes(key))) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

export function recoveryInteger(value, min, max) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function recoveryDays(value) {
  return value + (value === 1 ? ' day' : ' days');
}

export function recoveryList(value, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < min || value.length > max) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => typeof key !== 'string'
    || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

export function recoveryIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(value)
    && !['constructor', 'prototype', '__proto__'].includes(value);
}

export function recoveryPlan(tasks) {
  if (!recoveryList(tasks, 1, 8)) {
    throw new TypeError('Use 1 to 8 tasks.');
  }
  const identifiers = new Set();
  for (const task of tasks) {
    if (!recoveryRecord(task, ['id', 'title', 'duration', 'dependsOn'])) {
      throw new TypeError('Each task needs exactly id, title, duration and dependsOn.');
    }
    if (!recoveryIdentifier(task.id) || identifiers.has(task.id)) {
      throw new TypeError('Task IDs must be unique safe identifiers, beginning with a letter (1 to 80 characters).');
    }
    identifiers.add(task.id);
    if (typeof task.title !== 'string' || !task.title.trim() || task.title.trim().length > 100
      || /[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(task.title)) {
      throw new TypeError('Task titles must be plain readable text, 1 to 100 characters, without markup or control characters.');
    }
    if (!recoveryInteger(task.duration, 1, 30)) throw new TypeError('Task durations must be whole days from 1 to 30.');
    if (!recoveryList(task.dependsOn, 0, 7)
      || task.dependsOn.some(id => !recoveryIdentifier(id))
      || new Set(task.dependsOn).size !== task.dependsOn.length) {
      throw new TypeError('Dependencies must be a list of unique safe task IDs (at most 7).');
    }
  }
  for (const task of tasks) {
    if (task.dependsOn.some(id => !identifiers.has(id))) throw new TypeError('Every dependency must refer to a task in this plan.');
  }
  return tasks.map(task => ({ ...task, title: task.title.trim(), dependsOn: [...task.dependsOn] }));
}

export function recoverySchedule(tasks, adjustments = {}) {
  const pending = [...tasks].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const completed = new Map();
  const rows = [];
  while (pending.length) {
    const index = pending.findIndex(task => task.dependsOn.every(id => completed.has(id)));
    if (index < 0) throw new TypeError('Dependencies contain a cycle; remove it before calculating.');
    const [task] = pending.splice(index, 1);
    const start = Math.max(0, ...task.dependsOn.map(id => completed.get(id).end));
    const end = start + task.duration + (Object.hasOwn(adjustments, task.id) ? adjustments[task.id] : 0);
    if (end > 90) throw new TypeError('Each comparison schedule must finish within 90 elapsed days.');
    const row = { id: task.id, label: task.title, start, end };
    completed.set(task.id, row);
    rows.push(row);
  }
  return { finish: Math.max(...rows.map(row => row.end)), rows };
}

export function validate(input) {
  try {
    const fields = ['tasks', 'delayTask', 'delayDays', 'recoverTask', 'recoverDays'];
    if (!recoveryRecord(input, fields, ['tasks'])) throw new TypeError('The plan must be an object with tasks and optional delay/recovery fields only.');
    const tasks = recoveryPlan(input.tasks);
    const delayTask = Object.hasOwn(input, 'delayTask') ? input.delayTask : '';
    const recoverTask = Object.hasOwn(input, 'recoverTask') ? input.recoverTask : '';
    const delayDays = Object.hasOwn(input, 'delayDays') ? input.delayDays : 0;
    const recoverDays = Object.hasOwn(input, 'recoverDays') ? input.recoverDays : 0;
    for (const [kind, id, days] of [['Delay', delayTask, delayDays], ['Recovery', recoverTask, recoverDays]]) {
      if (!recoveryInteger(days, 0, 30)) throw new TypeError(kind + ' must be a whole number of days from 0 to 30.');
      if (typeof id !== 'string' || (id !== '' && !tasks.some(task => task.id === id)) || (days > 0 && id === '')) {
        throw new TypeError(kind + ' task must match a task ID in this plan; choose one when days are greater than zero.');
      }
    }
    const delayedAdjustments = Object.create(null);
    if (delayDays) delayedAdjustments[delayTask] = delayDays;
    const recoveredAdjustments = { ...delayedAdjustments };
    if (recoverDays) {
      const task = tasks.find(candidate => candidate.id === recoverTask);
      if (task.duration + (delayedAdjustments[recoverTask] || 0) - recoverDays < 1) {
        throw new TypeError('Recovery cannot reduce a task below 1 day. Use a smaller reduction.');
      }
      recoveredAdjustments[recoverTask] = (recoveredAdjustments[recoverTask] || 0) - recoverDays;
    }
    const baseline = recoverySchedule(tasks);
    const delayed = recoverySchedule(tasks, delayedAdjustments);
    const recovered = recoverySchedule(tasks, recoveredAdjustments);
    const affected = baseline.rows.filter((row, index) => {
      const delayedRow = delayed.rows[index], recoveredRow = recovered.rows[index];
      return row.start !== delayedRow.start || row.end !== delayedRow.end
        || row.start !== recoveredRow.start || row.end !== recoveredRow.end;
    }).map(row => row.id);
    const delayedTask = tasks.find(task => task.id === delayTask);
    const recoveredTask = tasks.find(task => task.id === recoverTask);
    const delayNote = delayDays ? 'Delay: ' + delayedTask.title + ' gains ' + recoveryDays(delayDays) + '. ' : 'Delay: none. ';
    const recoveryNote = recoverDays ? 'Recovery: ' + recoveredTask.title + ' loses ' + recoveryDays(recoverDays) + ' of duration. ' : 'Recovery: none. ';
    const movement = 'Plan finish: baseline ' + recoveryDays(baseline.finish) + ', delayed '
      + recoveryDays(delayed.finish) + ', recovered ' + recoveryDays(recovered.finish) + '. ';
    const affectedNote = affected.length ? 'Affected task ranges (baseline → delayed → recovered):\n' + affected.map(id => {
      const a = baseline.rows.find(row => row.id === id), b = delayed.rows.find(row => row.id === id), c = recovered.rows.find(row => row.id === id);
      return a.label + ': ' + a.start + '–' + a.end + ' → ' + b.start + '–' + b.end + ' → ' + c.start + '–' + c.end;
    }).join('\n') : 'No task ranges changed.';
    const parallelNote = delayDays && delayed.finish === baseline.finish
      ? '\nThe delayed branch fits within parallel work, so the plan finish does not move.' : '';
    return { ok: true, baseline, delayed, recovered, daysRecovered: delayed.finish - recovered.finish, affected,
      explanation: delayNote + recoveryNote + movement + '\n' + affectedNote + parallelNote };
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? error.message : 'The plan could not be calculated. Check all task fields.' };
  }
}

export function recoveryExamplePlan() {
  return { tasks: [
    { id: 'brief', title: 'Confirm brief', duration: 1, dependsOn: [] },
    { id: 'delivery', title: 'Delivery', duration: 3, dependsOn: ['brief'] },
    { id: 'prepare', title: 'Prepare workspace', duration: 2, dependsOn: ['brief'] },
    { id: 'assemble', title: 'Assembly', duration: 2, dependsOn: ['delivery', 'prepare'] },
    { id: 'review', title: 'Review', duration: 1, dependsOn: ['assemble'] },
  ] };
}

export function recoveryCleared(error) {
  return ['baseline-finish', 'delayed-finish', 'recovered-finish', 'recovered-days', 'schedule', 'impact']
    .map(id => ({ id, text: '' })).concat([{ id: 'error', text: error }]);
}

export function recoveryResults(result) {
  if (!result.ok) return recoveryCleared(result.error);
  const rows = result.recovered.rows.map((row, index) => ({ ...row,
    baselineStart: result.baseline.rows[index].start, baselineEnd: result.baseline.rows[index].end }));
  return [
    { id: 'baseline-finish', text: recoveryDays(result.baseline.finish) },
    { id: 'delayed-finish', text: recoveryDays(result.delayed.finish) },
    { id: 'recovered-finish', text: recoveryDays(result.recovered.finish) },
    { id: 'recovered-days', text: recoveryDays(result.daysRecovered) },
    { id: 'schedule', text: 'Baseline vs recovered schedule · elapsed days from 0. Finish: '
      + recoveryDays(result.baseline.finish) + ' → ' + recoveryDays(result.recovered.finish) + '.',
      timeline: { unit: 'days', horizon: Math.max(result.baseline.finish, result.delayed.finish, result.recovered.finish), rows } },
    { id: 'impact', text: result.explanation },
    { id: 'error', text: '' },
  ];
}

export function recoveryFromValues(values) {
  const ids = ['plan-json', 'delay-task', 'delay-days', 'recover-task', 'recover-days'];
  if (!recoveryRecord(values, ids) || ids.some(id => typeof values[id] !== 'string' || values[id].length > 4000)) {
    return { ok: false, error: 'Supply the plan JSON and all four scenario fields as text.' };
  }
  let plan;
  try { plan = JSON.parse(values['plan-json']); }
  catch { return { ok: false, error: 'Plan JSON is not valid JSON. Check commas, quotes and brackets.' }; }
  if (!recoveryRecord(plan, ['tasks'])) return { ok: false, error: 'Plan JSON must contain exactly one tasks field.' };
  for (const id of ['delay-days', 'recover-days']) {
    if (!/^(?:0|[1-9][0-9]?)$/u.test(values[id].trim())) return { ok: false, error: 'Delay and recovery days must be whole numbers from 0 to 30.' };
  }
  return validate({ tasks: plan.tasks, delayTask: values['delay-task'].trim(), delayDays: Number(values['delay-days'].trim()),
    recoverTask: values['recover-task'].trim(), recoverDays: Number(values['recover-days'].trim()) });
}

export function handleMessage(message) {
  const ids = ['plan-json', 'delay-task', 'delay-days', 'recover-task', 'recover-days'];
  const buttons = ['baseline', 'delay-delivery', 'recover-day'];
  if (!message || !['init', 'event'].includes(message.type)) return recoveryCleared('Unsupported calculation request.');
  if (message.type === 'event' && message.event === 'click' && buttons.includes(message.id)) {
    const values = { 'plan-json': JSON.stringify(recoveryExamplePlan(), null, 2), 'delay-task': 'delivery',
      'delay-days': message.id === 'baseline' ? '0' : '2', 'recover-task': 'assemble',
      'recover-days': message.id === 'recover-day' ? '1' : '0' };
    return ids.map(id => ({ id, value: values[id] })).concat(recoveryResults(recoveryFromValues(values)));
  }
  if (message.type === 'init' || (message.type === 'event' && ['input', 'change'].includes(message.event) && ids.includes(message.id))) {
    return recoveryResults(recoveryFromValues(message.values));
  }
  return recoveryCleared('Unsupported calculation request.');
}
