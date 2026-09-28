import { isRecord } from './nebius-contract.mjs';

export const PLAN_VERSION = 'project-plan.v1';
export const PLAN_LIMITS = Object.freeze({ brief: 4000, title: 120, summary: 600, tasks: 8, taskTitle: 200, purpose: 1000, nextStep: 200, doneWhen: 1000, missingInformation: 5 });
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const badControl = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
function text(value, limit, field, { empty = false, multiline = false } = {}) {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())
    || (multiline ? badControl : /\p{Cc}/u).test(value)) {
    throw new TypeError(`${field} must be ${empty ? '' : 'nonempty '}text of at most ${limit} characters.`);
  }
  return value;
}

export function validatePlanInput(value) {
  if (!exactKeys(value, ['brief'])) throw new TypeError('Preview exactly the project brief.');
  return { brief: text(value.brief, PLAN_LIMITS.brief, 'Brief', { multiline: true }) };
}

// Shared by explicit manual outlines, model output and atomic local approval.
// Validation returns a fresh projection and never mutates or creates work.
export function validateProjectPlan(value) {
  if (!exactKeys(value, ['title', 'summary', 'tasks', 'missingInformation'])
    || !Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > PLAN_LIMITS.tasks
    || !Array.isArray(value.missingInformation) || value.missingInformation.length > PLAN_LIMITS.missingInformation) {
    throw new TypeError('A project plan needs exactly title, summary, 1 to 8 tasks and missingInformation.');
  }
  const title = text(value.title, PLAN_LIMITS.title, 'Project title');
  const summary = text(value.summary, PLAN_LIMITS.summary, 'Summary', { empty: true, multiline: true });
  const tasks = Array.from(value.tasks, task => {
    if (!exactKeys(task, ['id', 'title', 'purpose', 'nextStep', 'doneWhen', 'dependsOn'])
      || typeof task.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/u.test(task.id)
      || !(task.dependsOn === null || typeof task.dependsOn === 'string')) {
      throw new TypeError('Every task needs an id, title, purpose, nextStep, doneWhen and dependsOn.');
    }
    return { id: task.id, title: text(task.title, PLAN_LIMITS.taskTitle, 'Task title'),
      purpose: text(task.purpose, PLAN_LIMITS.purpose, 'Task purpose', { multiline: true }),
      nextStep: text(task.nextStep, PLAN_LIMITS.nextStep, 'Task next step'),
      doneWhen: text(task.doneWhen, PLAN_LIMITS.doneWhen, 'Task completion criteria', { multiline: true }),
      dependsOn: task.dependsOn };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new TypeError('Task ids must be unique.');
  for (const task of tasks) {
    if (task.dependsOn !== null && (!byId.has(task.dependsOn) || task.dependsOn === task.id)) {
      throw new TypeError('A predecessor must name another task in this plan.');
    }
    const seen = new Set([task.id]);
    let predecessor = task.dependsOn;
    while (predecessor !== null) {
      if (seen.has(predecessor)) throw new TypeError('Task dependencies cannot contain a cycle.');
      seen.add(predecessor);
      const dependency = byId.get(predecessor);
      if (!dependency) throw new TypeError('A predecessor must name a task in this plan.');
      predecessor = dependency.dependsOn;
    }
  }
  const missingInformation = Array.from(value.missingInformation, item => text(item, 200, 'Missing information'));
  return { title, summary, tasks, missingInformation };
}
