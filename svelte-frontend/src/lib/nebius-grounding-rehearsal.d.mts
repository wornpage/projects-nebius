export type GroundingRehearsalCase = 'grounded' | 'rejected' | 'unclear' | 'failed';
export const GROUNDING_REHEARSAL_BRIEF: string;
export const GROUNDING_REHEARSAL_CASES: ReadonlyArray<{ id: GroundingRehearsalCase; label: string; description: string }>;
export function createGroundingRehearsalFetcher(getCase: () => GroundingRehearsalCase): typeof fetch;
