import type { ProjectPlan, ProjectPlanTask } from './nebius-plan-contract.mjs';
export type ProjectStarter = { id: string; label: string; brief: string; plan: ProjectPlan };
export type ReadonlyProjectStarter = Readonly<{ id: string; label: string; brief: string; plan: Readonly<{ title: string; summary: string; tasks: readonly Readonly<ProjectPlanTask>[]; missingInformation: readonly string[] }> }>;
/** Human-written examples frozen throughout their nested plan data. */
export const PROJECT_STARTERS: readonly ReadonlyProjectStarter[];
/** Return a fresh validated editable example; unknown ids throw. */
export function getProjectStarter(id: string): ProjectStarter;
