import { writable } from 'svelte/store';
import {
	emptyWebMcpHandoffSession,
	recordWebMcpDraftDecisionState,
	recordWebMcpHandoffStepState
} from './webmcp-handoff-session.mjs';

type WebMcpHandoffStepBase = {
	title: string;
	summary: string;
};

type WebMcpHandoffStep = WebMcpHandoffStepBase & (
	| { id: 'work-scope' | 'review-scope'; status: 'complete'; outcome: 'scope-verified' }
	| { id: 'next-proposal'; status: 'complete'; outcome: 'proposal-prepared' }
	| { id: 'draft-batch'; status: 'complete'; outcome: 'drafts-created'; count: number }
	| { id: 'human-decision'; status: 'pending'; outcome: 'proposal-pending' }
	| { id: 'human-decision'; status: 'complete'; outcome: 'proposal-approved' | 'proposal-discarded' }
);

type WebMcpHandoffSession = {
	steps: WebMcpHandoffStep[];
};

export const webMcpHandoffSession = writable<WebMcpHandoffSession>(
	emptyWebMcpHandoffSession() as WebMcpHandoffSession
);

export function recordWebMcpHandoffStep(step: WebMcpHandoffStep) {
	webMcpHandoffSession.update((session) =>
		recordWebMcpHandoffStepState(session, step) as WebMcpHandoffSession
	);
}

export function recordWebMcpDraftDecision(
	draft: { source: 'human' | 'webmcp' },
	outcome: 'proposal-approved' | 'proposal-discarded'
) {
	webMcpHandoffSession.update((session) =>
		recordWebMcpDraftDecisionState(session, draft, outcome) as WebMcpHandoffSession
	);
}

export function resetWebMcpHandoffSession() {
	webMcpHandoffSession.set(emptyWebMcpHandoffSession() as WebMcpHandoffSession);
}
