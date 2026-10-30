// @ts-nocheck -- runtime boundary validation; the public contract is in .d.mts.
import { projectProgress } from './nebius-project-progress.mjs';

const STATES = new Set(['draft', 'active', 'blocked', 'done']);
const TASK_KEYS = ['id', 'title', 'status', 'archived', 'blockedBy', 'blocker', 'hasSavedRun', 'change'];
const PROGRESS_KEYS = ['total', 'done', 'remaining', 'archived', 'archivedUnfinished', 'allDone'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

function text(value, name, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new TypeError(`${name} must be ${allowEmpty ? '' : 'nonblank '}text.`);
  return value;
}

function taskFields(value, snapshot = false) {
  if (!record(value)) throw new TypeError('Each task must be a record.');
  if (snapshot && !exactKeys(value, TASK_KEYS)) throw new TypeError('Snapshot task fields are invalid.');
  if (!STATES.has(value.status)) throw new TypeError('Task status is unsupported.');
  if (value.archived !== undefined && typeof value.archived !== 'boolean') throw new TypeError('Task archived flag must be boolean.');
  const blockedBy = value.blockedBy === undefined || value.blockedBy === '' || value.blockedBy === null
    ? null : text(value.blockedBy, 'Dependency id');
  if (snapshot && (typeof value.archived !== 'boolean' || typeof value.hasSavedRun !== 'boolean'
    || value.change !== 'unchanged' || value.blockedBy !== blockedBy || typeof value.blocker !== 'string')) {
    throw new TypeError('Snapshot task flags or dependency are invalid.');
  }
  return {
    id: text(value.id, 'Task id'), title: text(value.title, 'Task title'), status: value.status,
    archived: value.archived ?? false, blockedBy,
    blocker: text(value.blocker === undefined ? '' : value.blocker, 'Blocker', true),
    // The reference is never traversed, serialized, cloned, or validated here.
    hasSavedRun: snapshot ? value.hasSavedRun : value.executionRun !== undefined && value.executionRun !== null,
    change: 'unchanged'
  };
}

function validateGraph(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  if (byId.size !== tasks.length) throw new TypeError('Task ids must be unique.');
  const complete = new Set();
  for (const task of tasks) {
    const path = new Set();
    let id = task.id;
    while (id !== null && !complete.has(id)) {
      if (!byId.has(id)) throw new TypeError('Every dependency must reference a task in this project.');
      if (path.has(id)) throw new TypeError('Project dependencies cannot contain cycles.');
      path.add(id);
      id = byId.get(id).blockedBy;
    }
    for (const visited of path) complete.add(visited);
  }
}

// A canonical visible projection, not a digest of private task/run contents.
function signature(project, tasks) {
  return JSON.stringify({ project, tasks });
}

function checkedSnapshot(value) {
  if (!exactKeys(value, ['project', 'tasks', 'progress', 'signature'])
    || !exactKeys(value.project, ['id', 'title', 'goal'])
    || !Array.isArray(value.tasks) || !value.tasks.length) throw new TypeError('Capture a valid nonempty project first.');
  const project = { id: text(value.project.id, 'Project id'), title: text(value.project.title, 'Project title'),
    goal: text(value.project.goal, 'Project goal', true) };
  const tasks = Array.from(value.tasks, task => taskFields(task, true));
  validateGraph(tasks);
  const progress = projectProgress(tasks);
  if (!exactKeys(value.progress, PROGRESS_KEYS) || PROGRESS_KEYS.some(key => value.progress[key] !== progress[key])
    || value.signature !== signature(project, tasks)) throw new TypeError('Project snapshot changed; capture it again.');
  return { project, tasks, progress, signature: value.signature };
}

/** Capture only the visible project context and attachment-presence flag. */
export function captureRehearsal(project, tasks) {
  try {
    if (!record(project) || !Array.isArray(tasks) || !tasks.length) throw new TypeError('Select a nonempty project to rehearse.');
    const capturedProject = { id: text(project.id, 'Project id'), title: text(project.title, 'Project title'),
      goal: text(project.summary, 'Project summary', true) };
    const capturedTasks = Array.from(tasks, task => {
      if (!record(task) || task.projectId !== capturedProject.id) throw new TypeError('Every task must belong to the selected project.');
      return taskFields(task);
    });
    validateGraph(capturedTasks);
    return { ok: true, snapshot: { project: capturedProject, tasks: capturedTasks,
      progress: projectProgress(capturedTasks), signature: signature(capturedProject, capturedTasks) } };
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? error.message : 'Project context could not be captured.' };
  }
}

/** Insert one temporary requirement without changing the captured actuals. */
export function previewRehearsal(snapshot, input) {
  try {
    const source = checkedSnapshot(snapshot);
    if (!record(input)) throw new TypeError('Provide a requirement title and explicit target.');
    const title = text(input.title, 'Requirement title').trim();
    if (input.title.length > 160) throw new TypeError('Requirement title must be at most 160 characters.');
    const targetId = text(input.targetId, 'Target id');
    const index = source.tasks.findIndex(task => task.id === targetId);
    if (index < 0) throw new TypeError('Choose a target by its saved task id.');
    const target = source.tasks[index];
    if (target.status === 'done' || target.archived) throw new TypeError('Choose an unfinished, unarchived target.');
    const ids = new Set(source.tasks.map(task => task.id));
    let addedId = 'rehearsal-requirement', suffix = 2;
    while (ids.has(addedId)) addedId = `rehearsal-requirement-${suffix++}`;
    const added = { id: addedId, title, status: 'draft', archived: false, blockedBy: target.blockedBy,
      blocker: '', hasSavedRun: false, change: 'added' };
    const changed = { ...target, blockedBy: addedId, status: 'blocked', change: 'changed' };
    const tasks = [...source.tasks.slice(0, index), added, changed, ...source.tasks.slice(index + 1)];
    return { ok: true, preview: { sourceSignature: source.signature, addedId, changedId: targetId,
      tasks, progress: projectProgress(tasks) } };
  } catch (error) {
    return { ok: false, error: error instanceof TypeError ? error.message : 'Project preview could not be prepared.' };
  }
}

/** Authored offline context, with no fabricated execution or provider record. */
export const REHEARSAL_EXAMPLE = Object.freeze({
  project: Object.freeze({ id: 'authored-release-review', title: 'Release review',
    summary: 'Prepare a clear release review packet and handoff.' }),
  tasks: Object.freeze([
    Object.freeze({ id: 'authored-define-packet', projectId: 'authored-release-review', title: 'Define packet', status: 'done', blocker: 'None' }),
    Object.freeze({ id: 'authored-build-checker', projectId: 'authored-release-review', title: 'Build checker', status: 'done', blocker: 'None' }),
    Object.freeze({ id: 'authored-prepare-handoff', projectId: 'authored-release-review', title: 'Prepare handoff', status: 'active', blocker: 'None' })
  ])
});
