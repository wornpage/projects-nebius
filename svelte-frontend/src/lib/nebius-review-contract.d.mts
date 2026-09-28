import type { NebiusTask } from './nebius-contract.mjs';
export const REVIEW_VERSION: 'nebius-review.v1';
export const REVIEW_LIMITS: Readonly<{ criteria: 3; criterionText: 500; evidence: 2000; explanation: 600; quote: 500 }>;
export type ReviewCriterion = { id: string; text: string };
export type ReviewInput = { pack: NebiusTask; criteria: ReviewCriterion[]; evidence: string };
export type ReviewCheck = { id: string; assessment: 'supported' | 'partial' | 'not_evidenced' | 'unclear'; reason: string; quote: string };
export type ReviewOutput = { checks: ReviewCheck[]; consistency: { assessment: 'consistent' | 'conflicting' | 'unclear'; reason: string }; selectedCount: number; exhaustive: false };
export function validateReviewInput(value: unknown): ReviewInput;
export function validateReviewOutput(value: unknown, input: unknown): ReviewOutput;
