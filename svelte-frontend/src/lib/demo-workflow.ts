// Projects work-item derivations for the browser-local workflow. Browser-local mutations live in
// demo-client.ts; this module owns the small display and navigation contract
// shared by Work, Review, and Next.

import {
	DEMO_BLOCKER_NONE,
	DEMO_BLOCKER_NONE_LABEL,
	PACK_ENERGIES as RULE_PACK_ENERGIES,
	LOCAL_PACK_ACTIONS as RULE_PACK_ACTIONS,
	STATE_FILTERS as RULE_STATE_FILTERS,
	VALID_PACK_STATUSES as RULE_PACK_STATUSES,
	forwardPathStatusForBlocker,
	isPlaceholderNext,
	isUnblockedBlockerValue,
	normalizeStoredBlocker,
	normalizeText as normalizeRuleText,
	rebaseSeedPacks as rebasePacks
} from './workflow-rules.mjs';
import type { RunInput, RunRecord, ToolInputRequirement } from './nebius-execution-contract.mjs';

export interface DemoExecutionRunReference {
	id: string;
	key: string;
	input: RunInput;
	record: RunRecord | null;
}

export const RETIRED_EXECUTION_RUN_LIMIT = 8;

export interface DemoRetiredExecutionRun {
	reference: DemoExecutionRunReference;
	retiredAt: string;
	reason: 'server_not_found';
}

export interface DemoPack {
	id: string;
	projectId?: string;
	title?: string;
	type?: string;
	status?: string;
	blocker?: string;
	blockedBy?: string;
	next?: string;
	nextStep?: string;
	owner?: string;
	due?: string;
	doneWhen?: string;
	completionEvidence?: string;
	executionRun?: DemoExecutionRunReference;
	retiredExecutionRuns?: DemoRetiredExecutionRun[];
	executionInputs?: ToolInputRequirement[] | null;
	purpose?: string;
	pinned?: boolean;
	archived?: boolean;
	decision?: boolean;
	decider?: string;
	energy?: string;
	recurrence?: string;
	area?: string;
	activity?: string[];
	memory?: string[];
	sources?: string[];
	progress?: number;
	milestone?: string;
	location?: string;
	reactions?: Record<string, number>;
	[key: string]: unknown;
}

const NEBIUS_EDITION = typeof __NEBIUS_EDITION__ !== 'undefined' && __NEBIUS_EDITION__;

export interface DemoReceipt {
	summary?: string;
	pack?: DemoPack;
	unblockedWorkIds?: string[];
}

export interface DemoProject {
	id: string;
	title: string;
	summary: string;
	brief: string;
	createdAt: string;
	source: 'manual' | 'nebius';
}

export interface DemoState {
	packs: DemoPack[];
	projects?: DemoProject[];
	selectedProjectId?: string | null;
	pendingNextActionDrafts?: Array<{ workId: string; choice: string; mode: 'preset' | 'custom'; evidenceNote: string; evidence: Array<{ workId: string; field: 'workflow' | 'blocker'; expectedValue: string | null }>; originFingerprint: string; source: 'human' | 'webmcp'; }>;
	filter?: string;
	selectedId?: string;
	status?: string;
	actionReceipt?: DemoReceipt | null;
	energyFilter?: string;
	[key: string]: unknown;
}

export const PACK_ACTIONS: ReadonlySet<string> = new Set(RULE_PACK_ACTIONS);
export const PACK_ENERGIES: readonly string[] = RULE_PACK_ENERGIES;
export const ENERGY_OPTIONS = PACK_ENERGIES.map((value) => ({
	value,
	label: value.charAt(0).toUpperCase() + value.slice(1)
}));
export const STATE_FILTERS: readonly string[] = RULE_STATE_FILTERS;
export const VALID_PACK_STATUSES: ReadonlySet<string> = new Set(RULE_PACK_STATUSES);

const PACK_STATUS_LABELS: Readonly<Record<string, string>> = {
	active: 'Active',
	blocked: 'Blocked',
	draft: 'Draft',
	done: 'Done'
};

interface PrimaryCommand {
	label: string;
	action: string;
	targetPackId?: string;
}

function normalizeText(value: string | undefined, maxLength: number): string {
	return (value || '').trim().slice(0, maxLength);
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatWorkTitle(value: unknown): string {
	const raw = normalizeText(typeof value === 'string' ? value : '', 200);
	if (!raw) return 'Untitled';
	if (!/[-_]/u.test(raw)) return raw;
	const tokens = raw.replace(/[-_]+/gu, ' ').split(' ').filter(Boolean);
	if (tokens.length === 0) return 'Untitled';
	return tokens.map((token, index) => {
		if (/[A-Z]/u.test(token)) return token;
		const lower = token.toLowerCase();
		return index === 0 ? capitalize(lower) : lower;
	}).join(' ');
}

export function workTitle(pack: DemoPack): string {
	return formatWorkTitle(pack?.title);
}

export function canSetNextAction(pack: DemoPack): boolean {
	return pack.status !== 'done' && !pack.archived;
}

export function isMissingNextAction(pack: DemoPack): boolean {
	return isPlaceholderNext(pack.next);
}

export function hasBlocker(pack: DemoPack): boolean {
	return !isUnblockedBlockerValue(pack.blocker);
}

// Receipts retain the exact dependency changes. Ready links are a live view,
// so removed, terminal, archived, blocked or out-of-scope work is excluded.
export function receiptReadyPacks(receipt: DemoReceipt | null, packs: DemoPack[], projectId: string | null): DemoPack[] {
	if (!Array.isArray(receipt?.unblockedWorkIds)) return [];
	const ids = new Set(receipt.unblockedWorkIds.filter((id) => typeof id === 'string' && id.length > 0));
	return packs.filter((pack) => ids.has(pack.id) && pack.status === 'active' && !pack.archived
		&& !pack.blockedBy && !hasBlocker(pack) && !isMissingNextAction(pack)
		&& (!projectId || pack.projectId === projectId));
}

export function isReview(pack: DemoPack): boolean {
	if (!canSetNextAction(pack)) return false;
	const action = commandActionForLabel(pack.next || '').action;
	return hasBlocker(pack)
		|| isMissingNextAction(pack)
		|| action === 'review'
		|| action === 'review-work';
}

export function rebaseSeedPacks(packs: DemoPack[], todayIso?: string): DemoPack[] {
	return rebasePacks(packs, todayIso) as DemoPack[];
}

export function blockerText(pack: DemoPack): string {
	const blocker = normalizeStoredBlocker(pack.blocker);
	return blocker === DEMO_BLOCKER_NONE ? DEMO_BLOCKER_NONE_LABEL : blocker;
}

export function isMissingOwnerValue(value: string | undefined): boolean {
	const owner = normalizeText(value, 120).toLowerCase();
	return !owner || owner === 'unassigned' || owner === 'no owner' || owner === 'unowned';
}

export function ownerLabel(value: string | undefined): string {
	const owner = normalizeText(value, 120);
	return isMissingOwnerValue(owner) ? 'Unassigned' : owner;
}

export function packStatusLabel(value: string | undefined): string {
	const status = normalizeText(value || 'active', 40);
	return PACK_STATUS_LABELS[status] || status;
}

export function energyLabel(value: string | undefined): string {
	return ENERGY_OPTIONS.find((option) => option.value === value)?.label || value || '';
}

export function commandActionForLabel(label: string, nebiusEdition = NEBIUS_EDITION): PrimaryCommand {
	const value = normalizeText(label || 'Open', 120) || 'Open';
	const normalized = value.toLowerCase();
	if (normalized === 'review blocker') {
		return { label: 'Review blocker', action: 'review' };
	}
	if (normalized === 'needs review') return { label: 'Review', action: 'review' };
	if (normalized === 'review' || normalized === 'review work') {
		return { label: 'Review work', action: 'review-work' };
	}
	if (
		normalized === 'set next'
		|| normalized === 'set next action'
		|| normalized === 'set button runs next'
		|| normalized === 'choose next action'
	) {
		return { label: 'Set next action', action: 'set-next' };
	}
	if (normalized === 'focus') return { label: value, action: 'focus' };
	if (normalized === 'unblock' || normalized === 'set blocker: none' || normalized === 'set blocker none') {
		return { label: 'Set Blocker: None', action: 'unblock' };
	}
	if (normalized === 'start') return { label: 'Start', action: 'start' };
	if (normalized === 'done' || normalized === 'complete' || normalized === 'finish with proof' || normalized === 'mark done') {
		return { label: nebiusEdition ? 'Mark done' : 'Finish with proof', action: 'done' };
	}
	if (normalized === 'block') return { label: 'Block', action: 'block' };
	if (normalized === 'open' || normalized === 'set-energy') {
		return nebiusEdition
			? { label: 'Open task', action: 'edit' }
			: { label: 'Open', action: 'start' };
	}
	if (nebiusEdition) {
		// A written next step is guidance, not a command. Unknown prose opens
		// the task editor so a person can review it before changing state.
		return { label: 'Open task', action: 'edit' };
	}
	return { label: value, action: 'start' };
}

export function primaryCommand(pack: DemoPack): PrimaryCommand {
	if (isMissingNextAction(pack)) {
		return { label: 'Set next action', action: 'set-next', targetPackId: pack.id };
	}
	const command = commandActionForLabel(pack.next || 'Open');
	if (hasBlocker(pack)) {
		return command.action === 'unblock'
			? { label: 'Set Blocker: None', action: 'unblock', targetPackId: pack.id }
			: { label: 'Review blocker', action: 'review', targetPackId: pack.id };
	}
	return { ...command, targetPackId: pack.id };
}

export function primaryCommandNavigation(pack: DemoPack): string {
	const action = primaryCommand(pack).action;
	const id = encodeURIComponent(pack.id || '');
	if (action === 'review') return `/review?focus=${id}`;
	if (action === 'review-work') return isReview(pack) ? `/review?focus=${id}` : '/review';
	if (action === 'set-next' || action === 'edit') return `/next?pack=${id}`;
	return `/work?focus=${id}`;
}

export const NEXT_ACTION_CHOICES = [
	'Review',
	'Open',
	'Focus',
	'Set Blocker: None',
	'Start',
	NEBIUS_EDITION ? 'Mark done' : 'Finish with proof'
] as const;

export function nextChoiceForwardPath(
	pack: DemoPack,
	value: string
): Pick<DemoPack, 'next' | 'blocker' | 'status'> {
	const next = normalizeRuleText(value, 200) || 'Open';
	const blocker = normalizeRuleText(pack.blocker, 200).toLowerCase() === 'missing next action'
		? DEMO_BLOCKER_NONE
		: normalizeStoredBlocker(pack.blocker);
	return {
		next,
		blocker,
		status: forwardPathStatusForBlocker(pack.status, blocker, next)
	};
}

export function workflowLabel(pack: DemoPack): string {
	if (pack.status === 'done') return 'Done';
	if (isMissingNextAction(pack)) return 'Needs next action';
	if (hasBlocker(pack)) return 'Blocked';
	if (primaryCommand(pack).action === 'done') return 'Proof ready';
	if (pack.status === 'draft') return 'Draft';
	return 'Ready';
}

export function evidenceFacts(pack: DemoPack): { workflow: string; blocker: string | null } {
	return {
		workflow: workflowLabel(pack),
		blocker: hasBlocker(pack) ? blockerText(pack) : null
	};
}

export function parseDateOnly(value: string | undefined): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalizeText(value, 40));
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(year, month - 1, day);
	return parsed.getFullYear() === year
		&& parsed.getMonth() === month - 1
		&& parsed.getDate() === day
		? parsed
		: null;
}

export function dueUrgency(pack: DemoPack): '' | 'overdue' | 'today' | 'soon' {
	if (pack.status === 'done' || pack.archived) return '';
	const due = parseDateOnly(pack.due);
	if (!due) return '';
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
	if (days < 0) return 'overdue';
	if (days === 0) return 'today';
	return days <= 7 ? 'soon' : '';
}

export function dueDateLabel(pack: DemoPack): string {
	const date = normalizeText(pack.due, 40);
	if (!parseDateOnly(date)) return '';
	const urgency = dueUrgency(pack);
	if (urgency === 'overdue') return `Due ${date} (overdue)`;
	if (urgency === 'today') return 'Due today';
	return `Due ${date}`;
}

export interface DecisionWorkspaceRecommendation {
	pack: DemoPack;
	visibleDecisionCount: number;
	visibleBlockedCount: number;
	visibleOverdueCount: number;
	sameAreaBlockedCount: number;
}

export function isOpenDecision(pack: DemoPack): boolean {
	return pack.decision === true && canSetNextAction(pack);
}

// Work supplies its already filtered, sorted, pinned, and focus-scoped list.
// Selecting the first explicit open decision from that list keeps the panel on
// the same human-visible path as the cards instead of introducing a competing
// global scorer or hidden recommendation model.
export function recommendedDecisionWork(visiblePacks: DemoPack[]): DecisionWorkspaceRecommendation | null {
	const decisions = visiblePacks.filter(isOpenDecision);
	if (decisions.length === 0) return null;
	const pack = decisions[0];
	return {
		pack,
		visibleDecisionCount: decisions.length,
		visibleBlockedCount: visiblePacks.filter(hasBlocker).length,
		visibleOverdueCount: visiblePacks.filter((candidate) => dueUrgency(candidate) === 'overdue').length,
		sameAreaBlockedCount: pack.area
			? visiblePacks.filter((candidate) => candidate.area === pack.area && hasBlocker(candidate)).length
			: 0
	};
}

function activityDate(entry: string | undefined): Date | null {
	const timestamp = /^\[([\d-]+\s[\d:]+)\]/u.exec(entry || '')?.[1];
	if (!timestamp) return null;
	const date = new Date(`${timestamp.replace(' ', 'T')}Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function packAge(pack: DemoPack): string {
	const date = activityDate(pack.activity?.[0]);
	if (!date) return '';
	const days = Math.round((Date.now() - date.getTime()) / 86_400_000);
	if (days < 1) return 'today';
	if (days === 1) return '1 day ago';
	if (days < 30) return `${days} days ago`;
	return `${Math.round(days / 30)} months ago`;
}

function packAgeDetail(pack: DemoPack): string {
	return /^\[([\d-]+\s[\d:]+)\]/u.exec(pack.activity?.at(-1) || '')?.[1] || '';
}

function isStalePack(pack: DemoPack): boolean {
	const date = activityDate(pack.activity?.at(-1));
	return date ? (Date.now() - date.getTime()) / 86_400_000 > 30 : false;
}

export function workflowCardClass(
	pack: DemoPack,
	selected: boolean,
	recentlyUnblocked: boolean
): string {
	const classes = [
		pack.status === 'done'
			? 'is-done'
			: hasBlocker(pack)
				? 'is-blocked'
				: isMissingNextAction(pack)
					? 'is-needs-action'
					: 'is-ready'
	];
	if (selected) classes.push('selected');
	if (hasBlocker(pack)) classes.push('has-blocker');
	if (isMissingNextAction(pack)) classes.push('needs-next');
	if (isStalePack(pack)) classes.push('is-stale');
	if (recentlyUnblocked) classes.push('demo-just-unblocked');
	return classes.join(' ');
}

export function orderPacks(packs: DemoPack[], sortBy = 'urgency', manualOrder: string[] = []): DemoPack[] {
	if (sortBy === 'manual') {
		const positions = new Map(manualOrder.map((id, index) => [id, index]));
		return packs
			.map((pack, index) => ({ pack, index }))
			.sort((a, b) => (positions.get(a.pack.id) ?? manualOrder.length + a.index) - (positions.get(b.pack.id) ?? manualOrder.length + b.index))
			.map(({ pack }) => pack);
	}
	const urgencyRank = (pack: DemoPack): number => {
		const urgency = dueUrgency(pack);
		return urgency === 'overdue' ? 0 : urgency === 'today' ? 1 : urgency === 'soon' ? 2 : 3;
	};
	const compare = (a: DemoPack, b: DemoPack): number => {
		switch (sortBy) {
			case 'due':
				if (!a.due || !b.due) return a.due ? -1 : b.due ? 1 : 0;
				return a.due.localeCompare(b.due);
			case 'title':
				return (a.title || '').localeCompare(b.title || '');
			case 'status': {
				const order = ['active', 'blocked', 'draft', 'done'];
				return order.indexOf(a.status || '') - order.indexOf(b.status || '');
			}
			case 'energy': {
				const order = [...PACK_ENERGIES].reverse();
				return order.indexOf(a.energy || 'medium') - order.indexOf(b.energy || 'medium');
			}
			case 'recent':
				return packAgeDetail(b).localeCompare(packAgeDetail(a));
			default:
				return urgencyRank(a) - urgencyRank(b);
		}
	};
	const ordered = packs
		.map((pack, index) => ({ pack, index }))
		.sort((a, b) => compare(a.pack, b.pack) || a.index - b.index)
		.map(({ pack }) => pack);
	return ordered.some((pack) => pack.pinned)
		? [...ordered.filter((pack) => pack.pinned), ...ordered.filter((pack) => !pack.pinned)]
		: ordered;
}

export function filterPacks(
	packs: DemoPack[],
	filter: string,
	query: string,
	energyFilter = 'all',
	areaFilter = 'all',
	recurrenceFilter = 'all',
	ownerFilter = 'all',
	hideDone = false
): DemoPack[] {
	const q = query.trim().toLowerCase();
	return packs.filter((pack) => {
		const filterMatch = filter === 'all'
			? !pack.archived
			: filter === 'archived'
				? pack.archived
				: filter === 'review'
					? isReview(pack)
					: !pack.archived && pack.status === filter;
		if (!filterMatch || (hideDone && filter === 'all' && pack.status === 'done')) return false;
		if (energyFilter !== 'all' && pack.energy !== energyFilter) return false;
		if (areaFilter !== 'all' && (areaFilter === '_none' ? !!pack.area : pack.area !== areaFilter)) return false;
		if (recurrenceFilter !== 'all' && (pack.recurrence || 'none') !== recurrenceFilter) return false;
		if (ownerFilter !== 'all' && !(ownerFilter === '_unassigned'
			? isMissingOwnerValue(pack.owner)
			: pack.owner === ownerFilter)) return false;
		if (!q) return true;
		return [
			pack.title,
			pack.type,
			pack.next,
			pack.owner,
			pack.due,
			pack.blocker,
			pack.area
		].join(' ').toLowerCase().includes(q);
	});
}

export function receiptCells(pack: DemoPack | undefined): Array<{ label: string; value: string }> {
	if (!pack) return [];
	return [
		{ label: 'Where', value: workTitle(pack) },
		{ label: 'Blocker', value: blockerText(pack) },
		{ label: 'Next action', value: primaryCommand(pack).label },
		{ label: 'Proof target', value: normalizeText(pack.doneWhen, 200) || 'Not set' }
	];
}
