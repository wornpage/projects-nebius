import type { NebiusTask } from './nebius-contract.mjs';
import type { RunInput, RunRecord, ToolInputRequirement, ToolOutputRequirement } from './nebius-execution-contract.mjs';

export type TaskRunReviewInput = {
  currentTask: NebiusTask;
  currentInputFormats: ToolInputRequirement[] | null;
  currentOutputs?: ToolOutputRequirement[] | null;
  reference: { id: string; input: RunInput } | null;
  record: RunRecord | null;
  verified: RunRecord | null;
  integrityError: string;
  currentTaskMatches: boolean;
  taskStatus: string;
  completionEvidence: string;
  archived: boolean;
};
export type TaskRunReview = {
  state: 'no-run' | 'pending' | 'verifying' | 'invalid' | 'ready' | 'failed' | 'cancelled' | 'uncertain' | 'running';
  label: string;
  summary: string;
  evidenceExplanation: {
    authoredExample: boolean; author: string; execution: string; result: string; decision: string;
  };
  request: {
    fields: { key: keyof NebiusTask; label: string; requested: string | null; current: string; changed: boolean }[];
    requestedInputFormats: ToolInputRequirement[] | null;
    currentInputFormats: ToolInputRequirement[] | null;
    inputFormatsChanged: boolean;
    requestedOutputs: ToolOutputRequirement[] | null;
    currentOutputs: ToolOutputRequirement[] | null;
    outputsChanged: boolean;
    changedFieldCount: number;
  };
  proposal: { summary: string; files: { path: string; bytes: number }[]; rejectedResponses: number | null };
  evidence: {
    checkCount: number | null; passedCheckCount: number | null; modelCalls: number | null;
    inputTokens: number | null; outputTokens: number | null; totalsComplete: boolean | null; sourceValidated: boolean;
  };
  decision: { title: string; description: string };
};
export function taskRunReview(input: TaskRunReviewInput): TaskRunReview;
