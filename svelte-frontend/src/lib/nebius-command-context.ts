export const COMMANDS_CONTEXT = 'nebius:commands';

export function isAllWorkScopeUrl(url: URL | null | undefined): boolean {
	return url?.pathname === '/work' && url.searchParams.getAll('scope').length === 1 && url.searchParams.get('scope') === 'all';
}

export interface WorkCommandContribution {
	id: string;
	label: string;
	description: string;
	disabled?: boolean;
	run: () => void;
}

export interface WorkCommandScope {
	commands: WorkCommandContribution[];
	scopeKey: string;
	orderedIds: string[];
}

export interface CommandsHost {
	open(): void;
	publish(owner: symbol, contribution: WorkCommandScope | null): void;
}
