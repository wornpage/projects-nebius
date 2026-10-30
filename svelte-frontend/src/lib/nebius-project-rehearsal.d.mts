import type { ProjectProgress } from './nebius-project-progress.mjs';

export type RehearsalProjectInput = { id: string; title: string; summary: string };
/** Compatible with saved tasks; only the declared visible fields are projected. */
export type RehearsalTaskInput = {
  id: string; projectId?: string; title?: string; status?: string; archived?: boolean;
  blockedBy?: string | null; blocker?: string; executionRun?: unknown;
};
export type RehearsalTask = {
  id: string; title: string; status: 'draft' | 'active' | 'blocked' | 'done';
  archived: boolean; blockedBy: string | null; blocker: string; hasSavedRun: boolean;
  change: 'unchanged' | 'added' | 'changed';
};
export type RehearsalSnapshot = {
  project: { id: string; title: string; goal: string }; tasks: RehearsalTask[];
  progress: ProjectProgress; signature: string;
};
export type RehearsalPreview = {
  sourceSignature: string; addedId: string; changedId: string;
  tasks: RehearsalTask[]; progress: ProjectProgress;
};
export const REHEARSAL_EXAMPLE: Readonly<{
  project: Readonly<RehearsalProjectInput>; tasks: readonly Readonly<RehearsalTaskInput>[];
}>;
export function captureRehearsal(project: RehearsalProjectInput | null, tasks: readonly RehearsalTaskInput[]):
  { ok: true; snapshot: RehearsalSnapshot } | { ok: false; error: string };
export function previewRehearsal(snapshot: RehearsalSnapshot, input: { title: string; targetId: string }):
  { ok: true; preview: RehearsalPreview } | { ok: false; error: string };
