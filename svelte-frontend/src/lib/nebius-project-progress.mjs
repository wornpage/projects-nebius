/** Actual task states only. The caller supplies the complete selected project. */
export function projectProgress(packs) {
  let done = 0, remaining = 0, archived = 0, archivedUnfinished = 0;
  for (const pack of packs) {
    const isDone = pack.status === 'done', isArchived = pack.archived === true;
    if (isDone) done++;
    if (isArchived) {
      archived++;
      if (!isDone) archivedUnfinished++;
    } else if (!isDone) remaining++;
  }
  return { total: packs.length, done, remaining, archived, archivedUnfinished, allDone: packs.length > 0 && done === packs.length };
}
