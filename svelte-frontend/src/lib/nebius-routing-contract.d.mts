export type NebiusOperation = 'suggest-next-step' | 'review-evidence' | 'plan-project' | 'replan-project';
export type NebiusModelRole = 'routine' | 'reasoning';
export const OPERATION_PROFILES: Readonly<{
  'suggest-next-step': Readonly<{ modelRole: 'routine'; maxOutputTokens: 1200 }>;
  'review-evidence': Readonly<{ modelRole: 'reasoning'; maxOutputTokens: 1200 }>;
  'plan-project': Readonly<{ modelRole: 'reasoning'; maxOutputTokens: 4000 }>;
  'replan-project': Readonly<{ modelRole: 'reasoning'; maxOutputTokens: 4000 }>;
}>;
export type OperationConfig = { [key: string]: unknown; available: true; operation: NebiusOperation; modelRole: NebiusModelRole; maxOutputTokens: 1200 | 4000; requestedModel: string };
export function isOperationConfig(value: unknown, operation: NebiusOperation): value is OperationConfig;
