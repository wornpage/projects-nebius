import type { ProjectPlan, PlanningResult } from '$lib/nebius-plan-contract.mjs';
import type { NebiusFailureDetails } from '$lib/nebius-contract.mjs';
import type { PlanOperationConfig } from '$lib/nebius-routing-contract.mjs';
export type PlanView = {
  phase: 'idle' | 'loading' | 'ready' | 'generating' | 'complete' | 'blocked' | 'unavailable' | 'error';
  config: (PlanOperationConfig & { planVersion: string }) | null;
  plan: ProjectPlan | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  error: string;
  failure: NebiusFailureDetails | null;
  planningResult: PlanningResult | null;
};
export function emptyPlanView(): PlanView;
export function createPlanClient(options: { fetcher?: typeof fetch; onChange: (view: PlanView) => void }): {
  setBrief(brief: string): void; reload(): Promise<void>; generate(): Promise<void>; cancel(): void; dispose(): void;
};
