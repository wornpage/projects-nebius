import type { DemoState } from './demo-workflow';
import type { ProjectSnapshot, ProjectReplan } from './nebius-replan-contract.mjs';
export function projectSnapshot(state: DemoState, projectId: string): ProjectSnapshot;
export function applyProjectReplanState(state: DemoState, input: { snapshot: ProjectSnapshot; replan: ProjectReplan; source: 'manual' | 'nebius' }): { state: DemoState; changedIds: string[] };
