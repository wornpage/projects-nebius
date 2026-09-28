import type { NebiusTask, NebiusContextItem, NebiusSuggestion, NebiusCurrentStatus } from '$lib/nebius-contract.mjs';
export type SuggestionView = {
  phase: 'hidden' | 'loading' | 'unavailable' | 'ready' | 'generating' | 'complete' | 'error';
  task: NebiusTask | null; config: { requestedModel: string; promptVersion: string; modelRole: 'routine'; maxOutputTokens: number } | null;
  currentStatus: NebiusCurrentStatus | null; update: string;
  result: NebiusSuggestion | null; usage?: { input_tokens: number; output_tokens: number }; error: string;
};
export function emptySuggestionView(): SuggestionView;
export function createSuggestionClient(options: { fetcher?: typeof fetch; onChange: (view: SuggestionView) => void }): {
  setTask(key: string, pack: unknown, selectedContext?: NebiusContextItem[], update?: string): Promise<void>; reload(): Promise<void>; generate(): Promise<void>; dispose(): void;
};
