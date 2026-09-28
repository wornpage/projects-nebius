import type { ProjectPlan } from '$lib/nebius-plan-contract.mjs';
export type PlanView = {
  phase: 'idle' | 'loading' | 'ready' | 'generating' | 'complete' | 'unavailable' | 'error';
  config: { requestedModel: string; planVersion: string; modelRole: 'reasoning'; maxOutputTokens: number } | null;
  plan: ProjectPlan | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  error: string;
};
export function emptyPlanView(): PlanView;
export function createPlanClient(options: { fetcher?: typeof fetch; onChange: (view: PlanView) => void }): {
  setBrief(brief: string): void; reload(): Promise<void>; generate(): Promise<void>; dispose(): void;
};
