export const PLAN_VERSION: 'project-plan.v1';
export const PLAN_LIMITS: Readonly<{ brief: 4000; title: 120; summary: 600; tasks: 8; taskTitle: 200; purpose: 1000; nextStep: 200; doneWhen: 1000; missingInformation: 5 }>;
export type ProjectPlanTask = { id: string; title: string; purpose: string; nextStep: string; doneWhen: string; dependsOn: string | null };
export type ProjectPlan = { title: string; summary: string; tasks: ProjectPlanTask[]; missingInformation: string[] };
export type PlanInput = { brief: string };
export function validatePlanInput(value: unknown): PlanInput;
export function validateProjectPlan(value: unknown): ProjectPlan;
