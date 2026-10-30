const TASK_VIEWS = ['brief', 'tool', 'review'];
export const TASK_LOCATION_CONTEXT = 'nebius:task-location';

/** Accept only the shell's existing local Task destination, never an external URL. */
export function taskNavigationHref(value) {
  if (typeof value !== 'string' || !value.startsWith('/next') || value.includes('\\')) return '/next';
  try {
    const url = new URL(value, 'https://navigation.invalid');
    if (url.origin !== 'https://navigation.invalid' || url.pathname !== '/next') return '/next';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/next';
  }
}

/** Task detail links require one explicit selection. No stored/default pack is inferred. */
export function shellNavigation({ taskHref = '/next', pathname = '/', currentView = '' } = {}) {
  const href = taskNavigationHref(taskHref);
  const url = new URL(href, 'https://navigation.invalid');
  const packs = url.searchParams.getAll('pack');
  const pack = packs.length === 1 && packs[0].trim() ? packs[0] : '';
  const views = url.searchParams.getAll('view');
  const view = TASK_VIEWS.includes(currentView) ? currentView
    : views.length === 1 && TASK_VIEWS.includes(views[0]) ? views[0] : 'brief';
  return [
    { label: 'Work', href: '/work', current: pathname === '/work', detail: false },
    { label: 'Task', href, current: pathname === '/next', detail: false },
    ...(pack ? TASK_VIEWS.map((item) => ({
      label: item[0].toUpperCase() + item.slice(1),
      href: `/next?pack=${encodeURIComponent(pack)}&view=${item}`,
      current: pathname === '/next' && view === item,
      detail: true
    })) : [])
  ];
}

/** This only observes clicks; anchors retain all browser navigation semantics. */
export function isPlainNavigationClick(event) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
