import {
	blockerText,
	filterPacks,
	hasBlocker,
	isMissingNextAction,
	isMissingOwnerValue,
	isReview,
	orderPacks,
	ownerLabel,
	primaryCommand,
	workTitle,
	type DemoPack
} from '$lib/demo-workflow';

export type ReviewSubFilter = 'all' | 'blocked' | 'missing-next' | 'owner-gap';

interface ReviewQueueSummary {
	reviewTotal: number;
	visible: DemoPack[];
	blockedCount: number;
	missingNextCount: number;
	ownerGapCount: number;
	filteredVisible: DemoPack[];
}

export function preferredReviewPack(packs: DemoPack[]): DemoPack | null {
	return packs.find((pack) => isReview(pack) && isMissingNextAction(pack))
		|| packs.find((pack) => isReview(pack) && hasBlocker(pack))
		|| packs.find(isReview)
		|| packs[0]
		|| null;
}

export function summarizeReviewQueue(
	packs: DemoPack[],
	query: string,
	reviewSubFilter: ReviewSubFilter = 'all'
): ReviewQueueSummary {
	const reviewTotal = packs.filter(isReview).length;
	const visible = orderPacks(filterPacks(packs, 'review', query));
	let blockedCount = 0;
	let missingNextCount = 0;
	let ownerGapCount = 0;
	const filteredVisible: DemoPack[] = [];
	for (const pack of visible) {
		const blocked = hasBlocker(pack);
		const missingNext = isMissingNextAction(pack);
		const ownerGap = isMissingOwnerValue(pack.owner);
		if (blocked) blockedCount += 1;
		if (missingNext) missingNextCount += 1;
		if (ownerGap) ownerGapCount += 1;
		if (
			reviewSubFilter === 'all'
			|| (reviewSubFilter === 'blocked' && blocked)
			|| (reviewSubFilter === 'missing-next' && missingNext)
			|| (reviewSubFilter === 'owner-gap' && ownerGap)
		) filteredVisible.push(pack);
	}
	return { reviewTotal, visible, blockedCount, missingNextCount, ownerGapCount, filteredVisible };
}

export function buildStandupText(packs: DemoPack[]): string {
	const review = packs.filter(isReview);
	if (review.length === 0) {
		return 'Standup — every work item has a clear next action. Nothing needs a decision.';
	}
	const blockedCount = review.filter(hasBlocker).length;
	const missingNextCount = review.filter(isMissingNextAction).length;
	const noun = review.length === 1 ? 'work item' : 'work items';
	const needs = review.length === 1 ? 'needs' : 'need';
	const header = `Standup — ${review.length} ${noun} ${needs} a decision (${blockedCount} blocked, ${missingNextCount} missing action).`;
	const lines = review.map((pack) =>
		`- ${workTitle(pack)} — ${blockerText(pack)} (owner: ${ownerLabel(pack.owner)}) -> ${primaryCommand(pack).label}`
	);
	return [header, ...lines, `Up next: ${workTitle(review[0])}.`].join('\n');
}
