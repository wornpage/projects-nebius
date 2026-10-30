export type NebiusOperation = 'suggest-next-step' | 'review-evidence' | 'plan-project' | 'replan-project';
export type NebiusModelRole = 'routine' | 'reasoning';
export const OPERATION_PROFILES: Readonly<{
  'suggest-next-step': Readonly<{ modelRole: 'routine'; maxOutputTokens: 1200 }>;
  'review-evidence': Readonly<{ modelRole: 'reasoning'; maxOutputTokens: 1200 }>;
  'plan-project': Readonly<{ modelRole: 'reasoning'; maxOutputTokens: 4000; maxModelCalls: 2; groundingMaxOutputTokens: 2000; maxOutputTokensTotal: 6000; maxPipelineMs: 90000; groundingVersion: 'project-plan-grounding.v1' }>;
  'replan-project': Readonly<{ modelRole: 'reasoning'; maxOutputTokens: 4000 }>;
}>;
type ConfigBase = { [key: string]: unknown; available: true; requestedModel: string };
export type OperationConfigMap = {
  [Operation in NebiusOperation]: ConfigBase & (typeof OPERATION_PROFILES)[Operation] & { operation: Operation }
    & (Operation extends 'plan-project' ? { groundingModel: string } : {});
};
export type OperationConfig = OperationConfigMap[NebiusOperation];
export type PlanOperationConfig = OperationConfigMap['plan-project'];
export function isOperationConfig<Operation extends NebiusOperation>(value: unknown, operation: Operation): value is OperationConfigMap[Operation];
