import type { ProjectSnapshot, ProjectReplan } from '$lib/nebius-replan-contract.mjs';
export type ReplanView = {
  phase: 'idle' | 'loading' | 'ready' | 'generating' | 'complete' | 'unavailable' | 'error';
  config: { requestedModel: string; replanVersion: string; modelRole: 'reasoning'; maxOutputTokens: number } | null;
  replan: ProjectReplan | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  error: string;
};
export function emptyReplanView(): ReplanView;
export function createReplanClient(options: { fetcher?: typeof fetch; onChange: (view: ReplanView) => void }): {
  setInput(snapshot: ProjectSnapshot | null, update: string): void;
  reload(): Promise<void>; generate(consent: boolean): Promise<void>; dispose(): void;
};
