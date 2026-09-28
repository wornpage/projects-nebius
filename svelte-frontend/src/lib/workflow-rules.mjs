// @ts-nocheck -- plain ESM shared with the browser bundle.
// Pure workflow rules shared by the browser-local Projects state owner and
// the Svelte views. The surface models the durable workflow used by the demo.

import { canonicalizeText } from './canonical-text.mjs';

const DAY_MS = 86_400_000;
const SEED_DUE_ANCHOR = '2026-08-10';
const ISO_CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const ACTOR_SEPARATOR = ' · ';

const DEMO_BLOCKER_NONE = 'none';
const DEMO_BLOCKER_NONE_LABEL = 'None';
const PACK_ENERGIES = Object.freeze(['low', 'medium', 'high']);
const LOCAL_PACK_ACTIONS = Object.freeze(['start', 'unblock', 'block', 'done', 'open', 'archive']);
const STATE_FILTERS = Object.freeze(['all', 'active', 'blocked', 'draft', 'done', 'review', 'archived']);
const VALID_PACK_STATUSES = Object.freeze(['draft', 'active', 'blocked', 'done']);

function normalizeText(value, maxLength = 2000) {
	return [...canonicalizeText(value)].slice(0, maxLength).join('');
}

function normalizeStoredBlocker(value) {
	const blocker = normalizeText(value, 200)
		.replace(/Button-runs-next/gu, 'Button runs next')
		.replace(/Button Runs Next/gu, 'Button runs next')
		.replace(/missing Button runs next/gu, 'missing next action')
		.replace(/Button runs next/gu, 'Next action')
		.replace(/button runs next/gu, 'next action');
	return blocker && blocker.toLowerCase() !== DEMO_BLOCKER_NONE ? blocker : DEMO_BLOCKER_NONE;
}

function isUnblockedBlockerValue(value) {
	return normalizeStoredBlocker(value) === DEMO_BLOCKER_NONE;
}

function isPlaceholderNext(label) {
	const value = normalizeText(label, 120).toLowerCase();
	return !value
		|| value === 'choose action'
		|| value === 'choose next action'
		|| value === 'set next action'
		|| value === 'set button runs next'
		|| value === 'set next';
}

function recommendationDay(value) {
	const day = normalizeText(value, 40);
	if (!ISO_CALENDAR_DAY.test(day)) return null;
	const timestamp = Date.parse(`${day}T00:00:00.000Z`);
	return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day
		? timestamp
		: null;
}

function recommendationPriority(pack, todayMs) {
	let score = pack.pinned === true ? 10_000 : 0;
	const dueMs = recommendationDay(pack.due);
	if (dueMs === null) return score;
	const days = Math.round((dueMs - todayMs) / DAY_MS);
	if (days < 0) return score + 1_000 + Math.min(365, Math.abs(days));
	if (days === 0) return score + 900;
	if (days <= 7) return score + 700 - days;
	return score;
}

function recommendationReason(pack, todayMs) {
	const parts = [];
	if (pack.pinned === true) parts.push('Pinned');
	const dueMs = recommendationDay(pack.due);
	if (dueMs !== null) {
		const days = Math.round((dueMs - todayMs) / DAY_MS);
		if (days < 0) parts.push(`Overdue by ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'}`);
		else if (days === 0) parts.push('Due today');
		else if (days <= 7) parts.push(`Due in ${days} ${days === 1 ? 'day' : 'days'}`);
	}
	if (parts.length === 0) parts.push('Highest-priority active work');
	parts.push('No blocker or pending decision');
	return `${parts.join(' · ')}.`;
}

/**
 * Return the one recommendation Priority renders and its read-only page tool
 * exposes. The projection is deliberately smaller than a work item: page
 * agents receive only the same identity, link, and rationale a person sees.
 */
function selectNextRecommendation(packs, { todayIso = new Date().toISOString().slice(0, 10) } = {}) {
	if (!Array.isArray(packs)) return null;
	const todayMs = calendarDayTimestamp(todayIso);
	const doneIds = new Set(
		packs
			.filter((pack) => pack && typeof pack === 'object' && pack.status === 'done')
			.map((pack) => normalizeText(pack.id, 200))
			.filter(Boolean)
	);
	let winner = null;
	for (const [index, pack] of packs.entries()) {
		if (!pack || typeof pack !== 'object' || pack.archived === true || pack.status !== 'active') continue;
		if (pack.decision === true || !isUnblockedBlockerValue(pack.blocker)) continue;
		const dependency = normalizeText(pack.blockedBy, 200);
		if (dependency && dependency.toLowerCase() !== DEMO_BLOCKER_NONE && !doneIds.has(dependency)) continue;
		const id = normalizeText(pack.id, 200);
		const title = normalizeText(pack.title, 200);
		if (!id || !title) continue;
		const score = recommendationPriority(pack, todayMs);
		if (!winner || score > winner.score) winner = { pack, id, title, score, index };
	}
	if (!winner) return null;
	return {
		id: winner.id,
		title: winner.title,
		href: `/next?pack=${encodeURIComponent(winner.id)}`,
		reason: recommendationReason(winner.pack, todayMs)
	};
}

function forwardPathStatusForBlocker(status, blocker, next = '') {
	const normalizedStatus = normalizeText(status, 40) || 'active';
	if (normalizedStatus === 'done') return 'done';
	if (isPlaceholderNext(next)) return 'draft';
	return isUnblockedBlockerValue(blocker) ? 'active' : 'blocked';
}

function packActionEffect(pack, action) {
	if (action === 'start') {
		return {
			status: 'active',
			blocker: pack.blocker === 'missing setup' ? DEMO_BLOCKER_NONE : pack.blocker,
			next: isPlaceholderNext(pack.next) ? 'Open' : pack.next
		};
	}
	if (action === 'unblock') {
		return { status: 'active', blocker: DEMO_BLOCKER_NONE, blockedBy: '', next: 'Open' };
	}
	if (action === 'block') {
		return { status: 'blocked', blocker: 'blocked in this demo', next: 'Set Blocker: None' };
	}
	if (action === 'done') {
		return { status: 'done', blocker: DEMO_BLOCKER_NONE, blockedBy: '', progress: 100 };
	}
	return {};
}

function unblockPacksBlockedBy(packs, finishedPack, { onActivity, workTitle }) {
	const unblocked = [];
	const finishedTitle = workTitle(finishedPack);
	// Match only the generated dependency-only text, using the same persisted
	// limit as project creation. Old names and compound/custom blockers are
	// ambiguous without provenance; retain them for a human to resolve.
	// Creation uses the saved title; workTitle is only a display formatter and
	// can turn a stored slug into different text. Keep producer and comparison
	// representations identical, while Activity still uses the display title.
	const dependencyBlocker = typeof finishedPack.title === 'string' && finishedPack.title
		? normalizeStoredBlocker(`Waiting for ${finishedPack.title}`.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, ''))
		: null;
	for (const pack of packs) {
		if (pack.id === finishedPack.id || pack.blockedBy !== finishedPack.id) continue;
		const dependencyOnly = isUnblockedBlockerValue(pack.blocker) || normalizeStoredBlocker(pack.blocker) === dependencyBlocker;
		const retainBlocker = !dependencyOnly || pack.archived === true || pack.status === 'done';
		pack.blockedBy = '';
		if (!retainBlocker) {
			pack.blocker = DEMO_BLOCKER_NONE;
			pack.status = forwardPathStatusForBlocker(pack.status, DEMO_BLOCKER_NONE, pack.next);
		}
		const ready = !pack.archived && pack.status === 'active' && isUnblockedBlockerValue(pack.blocker) && !isPlaceholderNext(pack.next);
		onActivity(pack, ready
			? `Unblocked: ${finishedTitle} was marked done.`
			: `Dependency released: ${finishedTitle} was marked done.${retainBlocker ? ' Existing blocker retained.' : ''}`);
		if (ready) unblocked.push(pack);
	}
	return unblocked;
}

function unblockedReceiptSentence(count) {
	return count ? `Unblocked ${count} work item${count === 1 ? '' : 's'}.` : '';
}

function activityTimestamp(value) {
	if (!value) return null;
	const source = String(value);
	const parsed = Date.parse(source.includes('T') ? source : `${source.replace(' ', 'T')}Z`);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function activityActor(value) {
	const actor = normalizeText(value, 120);
	return actor || null;
}

function formatActivityEntry(
	detail,
	{ actor = '', timestamp = new Date().toISOString(), maxLength = 400 } = {}
) {
	const parsedTimestamp = activityTimestamp(timestamp) || new Date().toISOString();
	const stamp = parsedTimestamp.replace('T', ' ').slice(0, 19);
	const normalizedActor = activityActor(actor);
	const actorSuffix = normalizedActor ? ACTOR_SEPARATOR + normalizedActor : '';
	const prefix = `[${stamp}] `;
	const normalizedDetail = normalizeText(detail, Math.max(1, maxLength - prefix.length - actorSuffix.length));
	return normalizedDetail ? prefix + normalizedDetail + actorSuffix : '';
}

function calendarDayTimestamp(day) {
	const timestamp = typeof day === 'string' && ISO_CALENDAR_DAY.test(day) ? Date.parse(day) : NaN;
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) {
		throw new TypeError('Seed todayIso must be a valid YYYY-MM-DD calendar date.');
	}
	return timestamp;
}

function shiftIsoDate(iso, days) {
	const timestamp = Date.parse(iso);
	return Number.isNaN(timestamp) ? iso : new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

function rebaseSeedActivityTimestamps(packs, todayMs) {
	let newestMs = 0;
	for (const pack of packs) {
		for (const entry of Array.isArray(pack?.activity) ? pack.activity : []) {
			if (typeof entry !== 'string') continue;
			const match = /^\[(\d{4}-\d{2}-\d{2}) /u.exec(entry);
			if (!match) continue;
			const timestamp = Date.parse(match[1]);
			if (Number.isFinite(timestamp) && timestamp > newestMs) newestMs = timestamp;
		}
	}
	if (newestMs === 0) return packs;
	const offsetDays = Math.round((todayMs - newestMs) / DAY_MS);
	if (offsetDays === 0) return packs;
	return packs.map((pack) => {
		if (!Array.isArray(pack?.activity)) return pack;
		const activity = pack.activity.map((entry) => {
			if (typeof entry !== 'string') return entry;
			const match = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\](.*)$/u.exec(entry);
			if (!match) return entry;
			const shifted = shiftIsoDate(match[1].slice(0, 10), offsetDays);
			return `[${shifted} ${match[1].slice(11)}]${match[2]}`;
		});
		return { ...pack, activity };
	});
}

function rebaseSeedPacks(packs, todayIso = new Date().toISOString().slice(0, 10)) {
	if (!Array.isArray(packs)) throw new TypeError('Seed packs must be an array.');
	const anchor = calendarDayTimestamp(SEED_DUE_ANCHOR);
	const today = calendarDayTimestamp(todayIso);
	const offsetDays = Math.round((today - anchor) / DAY_MS);
	const dueRebased = offsetDays === 0
		? packs
		: packs.map((pack) => pack?.due ? { ...pack, due: shiftIsoDate(pack.due, offsetDays) } : pack);
	return rebaseSeedActivityTimestamps(dueRebased, today);
}

export {
	DEMO_BLOCKER_NONE,
	DEMO_BLOCKER_NONE_LABEL,
	PACK_ENERGIES,
	LOCAL_PACK_ACTIONS,
	STATE_FILTERS,
	VALID_PACK_STATUSES,
	formatActivityEntry,
	forwardPathStatusForBlocker,
	isPlaceholderNext,
	isUnblockedBlockerValue,
	selectNextRecommendation,
	normalizeStoredBlocker,
	normalizeText,
	packActionEffect,
	rebaseSeedPacks,
	unblockPacksBlockedBy,
	unblockedReceiptSentence
};
