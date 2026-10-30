export type RequestDiffSegment = { kind: 'added' | 'removed' | 'unchanged'; text: string } | { kind: 'omission'; count: number };
export type RequestTextDiff = {
  saved: string;
  current: string;
  whitespaceOnly: boolean;
  status: 'unchanged' | 'compared' | 'cutoff';
  segments: RequestDiffSegment[];
};
export function requestTextDiff(saved: string, current: string): RequestTextDiff;
