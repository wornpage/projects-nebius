const ALL_WORK = { label: 'All work', href: '/work?scope=all' };

// Keep imported titles literal. Only an actually blank title needs a fallback.
function title(value) {
  return typeof value === 'string' && value.trim() ? value : 'Untitled';
}

/** Pure projection of the caller's current scope and existing task order. */
export function projectNavigation({ packs = [], projects = [], selectedProjectId = null, currentTaskId = null, pathname = '', orderedIds = [] } = {}) {
  const onTask = pathname === '/next';
  const task = onTask ? packs.find((pack) => pack.id === currentTaskId) : null;
  const model = (project, scopeLabel, scopeKey, tasks) => ({ project, scopeLabel, scopeKey, tasks, allWork: { ...ALL_WORK } });
  if (onTask && !task) {
    return model(null, 'Task unavailable', typeof currentTaskId === 'string' && currentTaskId.trim() ? `missing-task:${currentTaskId}` : 'invalid-task', []);
  }

  const projectId = onTask ? task.projectId : selectedProjectId;
  const project = projectId ? projects.find((item) => item.id === projectId) : null;
  if (projectId && !project) return model(null, 'Project unavailable', `missing-project:${projectId}`, []);
  const ungrouped = onTask && !projectId;
  const scopeKey = project ? `project:${project.id}` : ungrouped ? 'ungrouped' : 'all';
  const scoped = project ? packs.filter((pack) => pack.projectId === project.id)
    : ungrouped ? packs.filter((pack) => !pack.projectId) : packs;

  // A caller may supply the established Work order for this exact scope.
  // Unknown/duplicate IDs are ignored; newly arrived tasks retain input order.
  const byId = new Map(scoped.map((pack) => [pack.id, pack]));
  const seen = new Set();
  const ordered = [];
  for (const id of orderedIds) {
    if (byId.has(id) && !seen.has(id)) {
      ordered.push(byId.get(id));
      seen.add(id);
    }
  }
  for (const pack of scoped) {
    if (!seen.has(pack.id)) {
      ordered.push(pack);
      seen.add(pack.id);
    }
  }
  return model(project ? { id: project.id, title: title(project.title) } : null,
    project ? title(project.title) : ungrouped ? 'Ungrouped tasks' : 'All work', scopeKey,
    ordered.map((pack) => ({
      id: pack.id,
      title: title(pack.title),
      href: `/next?pack=${encodeURIComponent(pack.id)}&view=brief`,
      current: pack.id === currentTaskId,
      status: typeof pack.status === 'string' ? pack.status : '',
      archived: pack.archived === true
    })));
}

/** Search uses literal title substrings, never user-provided regular expressions. */
export function filterCommandNavigation(model, query = '') {
  const needle = query.trim().toLowerCase();
  const tasks = needle ? model.tasks.filter((task) => task.title.toLowerCase().includes(needle)) : [...model.tasks];
  return { ...model, tasks, matched: tasks.length, total: model.tasks.length };
}
