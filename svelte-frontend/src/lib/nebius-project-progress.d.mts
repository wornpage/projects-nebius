import type { DemoPack } from './demo-workflow';
export type ProjectProgress = { total: number; done: number; remaining: number; archived: number; archivedUnfinished: number; allDone: boolean };
/** Total includes archived tasks; archived overlaps done; remaining excludes both. */
export function projectProgress(packs: readonly Pick<DemoPack, 'status' | 'archived'>[]): ProjectProgress;
