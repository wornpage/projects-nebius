import { isRecord } from './nebius-contract.mjs';
import { PLAN_LIMITS } from './nebius-plan-contract.mjs';

export const REPLAN_VERSION = 'project-replan.v1';
export const REPLAN_LIMITS = Object.freeze({ projectId: 120, id: 200, title: PLAN_LIMITS.title, summary: 600,
  tasks: 8, taskTitle: PLAN_LIMITS.taskTitle, purpose: PLAN_LIMITS.purpose, nextStep: PLAN_LIMITS.nextStep,
  doneWhen: PLAN_LIMITS.doneWhen, blocker: 200, update: 2000, reason: 400, missingInformation: 5, missingInformationText: 200 });
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const badControl = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const taskFields = ['title', 'purpose', 'nextStep', 'doneWhen', 'status', 'blocker', 'blockedBy'];
const taskKeys = ['id', ...taskFields];
function text(value, limit, field, { empty = false, multiline = false } = {}) {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())
    || (multiline ? badControl : /\p{Cc}/u).test(value)) throw new TypeError(`${field} must be bounded ${empty ? '' : 'nonempty '}text.`);
  return value;
}
function task(value, snapshot) {
  if (!exactKeys(value, [...taskKeys, snapshot ? 'archived' : 'reason'])) throw new TypeError('Task fields must match the replan contract exactly.');
  const status = value.status;
  if (!(snapshot ? ['active', 'blocked', 'done', 'draft'] : ['active', 'blocked']).includes(status)) throw new TypeError('Invalid replan task status.');
  const result = { id: text(value.id, REPLAN_LIMITS.id, 'Task id'),
    title: text(value.title, REPLAN_LIMITS.taskTitle, 'Task title'),
    purpose: text(value.purpose, REPLAN_LIMITS.purpose, 'Task purpose', { multiline: true }),
    nextStep: text(value.nextStep, REPLAN_LIMITS.nextStep, 'Next step'),
    doneWhen: text(value.doneWhen, REPLAN_LIMITS.doneWhen, 'Completion criteria', { multiline: true }), status,
    blocker: text(value.blocker, REPLAN_LIMITS.blocker, 'Blocker'),
    blockedBy: value.blockedBy === null ? null : text(value.blockedBy, REPLAN_LIMITS.id, 'Predecessor id') };
  if (snapshot) {
    if (typeof value.archived !== 'boolean') throw new TypeError('Archived must be a boolean.');
    // Saved browser work uses lowercase none. Canonicalize only that recognized
    // sentinel (case insensitive) so changing its spelling is never a real edit.
    if (result.blocker.toLowerCase() === 'none') result.blocker = 'None';
    result.archived = value.archived;
  } else {
    result.reason = text(value.reason, REPLAN_LIMITS.reason, 'Change reason', { multiline: true });
    const realBlocker = result.blocker.trim().toLowerCase() !== 'none';
    if ((status === 'blocked' && !realBlocker) || (status === 'active' && (result.blocker !== 'None' || result.blockedBy !== null))
      || (result.blockedBy !== null && status !== 'blocked')) throw new TypeError('Proposed status, blocker and predecessor must agree.');
  }
  return result;
}
function graph(tasks) {
  const byId = new Map(tasks.map(item => [item.id, item]));
  if (byId.size !== tasks.length) throw new TypeError('Task ids must be unique.');
  for (const item of tasks) {
    const realBlocker = item.blocker.trim().toLowerCase() !== 'none';
    if ((item.status === 'blocked' && !realBlocker) || (item.status === 'active' && (item.blocker !== 'None' || item.blockedBy !== null))
      || (item.blockedBy !== null && item.status !== 'blocked')) throw new TypeError('Project status, blocker and predecessor must agree.');
    const seen = new Set([item.id]);
    let predecessor = item.blockedBy;
    while (predecessor !== null) {
      if (!byId.has(predecessor)) throw new TypeError('Predecessors must belong to this project snapshot.');
      if (seen.has(predecessor)) throw new TypeError('Project dependencies cannot be self references or cyclic.');
      seen.add(predecessor);
      predecessor = byId.get(predecessor).blockedBy;
    }
  }
}
const sortTasks = tasks => tasks.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function validateProjectSnapshot(value) {
  if (!exactKeys(value, ['project', 'tasks']) || !exactKeys(value.project, ['id', 'title', 'summary'])
    || !Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > REPLAN_LIMITS.tasks) throw new TypeError('Snapshot exactly one project and all of its 1 to 8 tasks.');
  const project = { id: text(value.project.id, REPLAN_LIMITS.projectId, 'Project id'),
    title: text(value.project.title, REPLAN_LIMITS.title, 'Project title'),
    summary: text(value.project.summary, REPLAN_LIMITS.summary, 'Project summary', { empty: true, multiline: true }) };
  const tasks = sortTasks(Array.from(value.tasks, value => task(value, true)));
  graph(tasks);
  return { project, tasks };
}
export function validateReplanInput(value) {
  if (!exactKeys(value, ['snapshot', 'update'])) throw new TypeError('Preview exactly the snapshot and update.');
  return { snapshot: validateProjectSnapshot(value.snapshot), update: text(value.update, REPLAN_LIMITS.update, 'Project update', { multiline: true }) };
}
export function validateProjectReplan(value, snapshot) {
  const context = validateProjectSnapshot(snapshot);
  if (!exactKeys(value, ['summary', 'changes', 'missingInformation']) || !Array.isArray(value.changes)
    || value.changes.length < 1 || value.changes.length > REPLAN_LIMITS.tasks
    || !Array.isArray(value.missingInformation) || value.missingInformation.length > REPLAN_LIMITS.missingInformation) throw new TypeError('Replan exactly a summary, 1 to 8 changes and missingInformation.');
  const changes = sortTasks(Array.from(value.changes, value => task(value, false)));
  if (new Set(changes.map(change => change.id)).size !== changes.length) throw new TypeError('Changed task ids must be unique.');
  const byId = new Map(context.tasks.map(item => [item.id, item]));
  for (const change of changes) {
    const original = byId.get(change.id);
    if (!original || original.archived || original.status === 'done') throw new TypeError('Change only existing nonarchived, unfinished project tasks.');
    if (taskFields.every(field => change[field] === original[field])) throw new TypeError('Each targeted task must have a real field change.');
    byId.set(change.id, { ...original, ...change });
  }
  graph([...byId.values()]);
  return { summary: text(value.summary, REPLAN_LIMITS.summary, 'Replan summary', { empty: true, multiline: true }), changes,
    missingInformation: Array.from(value.missingInformation, item => text(item, REPLAN_LIMITS.missingInformationText, 'Missing information')) };
}
