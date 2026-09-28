import { isRecord, validModelId } from './nebius-contract.mjs';

// One source for the public allowance and the actual provider max_tokens.
export const OPERATION_PROFILES = Object.freeze({
  'suggest-next-step': Object.freeze({ modelRole: 'routine', maxOutputTokens: 1200 }),
  'review-evidence': Object.freeze({ modelRole: 'reasoning', maxOutputTokens: 1200 }),
  'plan-project': Object.freeze({ modelRole: 'reasoning', maxOutputTokens: 4000 }),
  'replan-project': Object.freeze({ modelRole: 'reasoning', maxOutputTokens: 4000 }),
});

export function isOperationConfig(value, operation) {
  if (typeof operation !== 'string' || !Object.hasOwn(OPERATION_PROFILES, operation)) return false;
  const profile = OPERATION_PROFILES[operation];
  return isRecord(value) && value.available === true && value.operation === operation
    && value.modelRole === profile.modelRole && value.maxOutputTokens === profile.maxOutputTokens
    && validModelId(value.requestedModel);
}
