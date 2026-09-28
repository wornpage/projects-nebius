import type { DemoPack } from './demo-workflow';

interface WorkItemIssue {
	message: string;
}

function add(issues: WorkItemIssue[], message: string): void {
	issues.push({ message });
}

function isPastDate(value: string | undefined): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value || '')) return false;
	const due = new Date(`${value}T00:00:00`);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return !Number.isNaN(due.getTime()) && due < today;
}

/** Visible consistency checks for the sample workspace data. */
export function workItemIssues(pack: DemoPack): WorkItemIssue[] {
	const issues: WorkItemIssue[] = [];
	const blocker = String(pack.blocker || '').trim();
	const hasBlocker = blocker !== '' && blocker.toLowerCase() !== 'none';

	if (!String(pack.title || '').trim()) add(issues, 'This work item needs a title.');
	if (!String(pack.owner || '').trim()) add(issues, 'No owner is assigned.');
	if (pack.status === 'blocked' && !hasBlocker) {
		add(issues, 'The item is marked blocked but has no blocker.');
	}
	if (hasBlocker && pack.status !== 'blocked' && pack.status !== 'done') {
		add(issues, 'The item has a blocker but is not marked blocked.');
	}
	if (pack.status === 'active' && !String(pack.next || '').trim()) {
		add(issues, 'The active item needs a next action.');
	}
	if (pack.status === 'done' && !String(pack.doneWhen || '').trim()) {
		add(issues, 'The finished item needs a proof target.');
	}
	if (pack.status !== 'done' && isPastDate(pack.due)) {
		add(issues, `Due date ${pack.due} is in the past and the item is not done.`);
	}

	return issues;
}
