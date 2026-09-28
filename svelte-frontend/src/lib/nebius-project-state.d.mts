import type { DemoPack, DemoProject, DemoState } from './demo-workflow';
import type { ProjectPlan } from './nebius-plan-contract.mjs';
/** Limits count project records and project member tasks; ungrouped work is excluded. */
export const PROJECT_STATE_LIMITS: Readonly<{ projects: number; tasks: number }>;
export function assertProjectRecord(project: unknown): asserts project is DemoProject;
export function assertProjectState(state: unknown): asserts state is DemoState;
export function createProjectPlanState(state: DemoState, input: { brief: string; plan: ProjectPlan; approvalId: string; source: 'manual' | 'nebius'; createdAt: string }): { state: DemoState; project: DemoProject; tasks: DemoPack[] };
export function mergedProjectRecords(current: DemoState, imported: DemoState): DemoProject[];
