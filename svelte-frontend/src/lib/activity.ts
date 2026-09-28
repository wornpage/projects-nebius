// Activity-entry helpers for the synthetic browser-local work list. Entries
// are strings shaped "[YYYY-MM-DD HH:MM] text".

import type { DemoPack } from '$lib/demo-workflow';

const ACTIVITY_STAMP_RE = /^\[([\d-]+\s[\d:]+)\]\s*/u;
const ACTIVITY_AT_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/u;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function newestActivityFirst<T extends { at: string }>(entries: T[]): T[] {
	return entries
		.map((entry, sequence) => ({ entry, sequence }))
		.sort((left, right) => right.entry.at.localeCompare(left.entry.at) || right.sequence - left.sequence)
		.map(({ entry }) => entry);
}

interface ActivityEntry {
	text: string;
	at: string;
}

interface PackActivityEntry extends ActivityEntry {
	packId: string;
	packTitle: string;
}

function packActivityEntries(pack: DemoPack): unknown[] {
	return Array.isArray(pack?.activity) ? pack.activity : [];
}

function activityTime(at: string): number {
	const normalized = normalizedActivityAt(at);
	return normalized ? Date.parse(`${normalized.replace(' ', 'T')}Z`) : 0;
}

function normalizedActivityAt(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const match = ACTIVITY_AT_RE.exec(value.trim());
	if (!match) return null;
	const normalized = `${match[1]} ${match[2]}:${match[3] ?? '00'}`;
	const timestamp = new Date(`${normalized.replace(' ', 'T')}Z`);
	if (Number.isNaN(timestamp.getTime())) return null;
	return timestamp.toISOString().replace('T', ' ').slice(0, 19) === normalized ? normalized : null;
}

function activityParts(entry: unknown): ActivityEntry {
	const value = typeof entry === 'string' ? entry : '';
	const match = ACTIVITY_STAMP_RE.exec(value);
	return match ? { text: value.slice(match[0].length), at: match[1] } : { text: value, at: '' };
}

function latestActivityCandidate(
	pack: DemoPack,
	accepts: (entry: ActivityEntry) => boolean,
	preferLaterTie = false
): ActivityEntry | null {
	let latest: ActivityEntry | null = null;
	let latestTime = Number.NEGATIVE_INFINITY;
	const entries = packActivityEntries(pack);
	for (let index = 0; index < entries.length; index += 1) {
		const candidate = activityParts(entries[index]);
		if (!candidate.text || !accepts(candidate)) continue;
		const time = activityTime(candidate.at);
		if (!latest || time > latestTime || (preferLaterTie && time === latestTime)) {
			latest = candidate;
			latestTime = time;
		}
	}
	return latest;
}

export function relativeActivityTime(at: string): string {
	const normalized = normalizedActivityAt(at);
	const then = normalized ? new Date(`${normalized.replace(' ', 'T')}Z`) : null;
	if (!then || Number.isNaN(then.getTime())) {
		return 'earlier';
	}
	const mins = Math.round((Date.now() - then.getTime()) / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 7) return `${days}d ago`;
	return `${MONTHS[then.getUTCMonth()]} ${then.getUTCDate()}`;
}

export function recentPackActivity(packs: DemoPack[], limit = 6): PackActivityEntry[] {
	if (!Array.isArray(packs) || !Number.isInteger(limit) || limit <= 0) return [];
	const entries: PackActivityEntry[] = [];
	for (const pack of packs) {
		if (pack?.archived) continue;
		const packId = typeof pack?.id === 'string' ? pack.id.trim() : '';
		const packTitle = typeof pack?.title === 'string' ? pack.title.trim() : '';
		if (!packId || !packTitle) continue;
		// Retain the later source entry among same-time usable ties because
		// newestActivityFirst's sequence tie-breaker selected it after the old
		// global sort-and-dedupe path.
		const latest = latestActivityCandidate(
			pack,
			(entry) => Boolean(
				normalizedActivityAt(entry.at)
				&& entry.text.trim()
				&& activityTextWithoutActor(entry).trim().toLowerCase() !== 'archived.'
			),
			true
		);
		if (!latest) continue;
		const at = normalizedActivityAt(latest.at);
		if (!at) continue;
		entries.push({ at, text: latest.text.trim(), packId, packTitle });
	}
	return newestActivityFirst(entries).slice(0, limit);
}

// Trailing " · <actor>" suffix from a stamped string entry (for example,
// "Started. · Reviewer" → "Reviewer"). Entries without a suffix return null.
const ACTOR_SUFFIX_RE = / · ([^·]+)$/u;
export function activityActor(entry: unknown): string | null {
	if (entry && typeof entry === 'object' && 'actor' in entry && typeof (entry as { actor?: unknown }).actor === 'string') {
		return (entry as { actor: string }).actor;
	}
	const text = entry && typeof entry === 'object' && 'text' in entry
		? (entry as { text: string }).text || ''
		: activityParts(entry).text;
	const match = ACTOR_SUFFIX_RE.exec(text);
	return match ? match[1].trim() : null;
}

// Text without the trailing " · <actor>" suffix — for surfaces that render the
// actor separately as a chip, so it isn't shown twice. Accepts either the raw
// entry (string or structured object) or the parsed {text, at, actor} shape.
export function activityTextWithoutActor(entry: unknown): string {
	const parsed = entry && typeof entry === 'object' && 'text' in entry
		? entry as { text: string }
		: activityParts(entry);
	const text = parsed.text || '';
	const actor = activityActor(entry);
	if (!actor) return text;
	return text.replace(ACTOR_SUFFIX_RE, '').trimEnd();
}

export function activityEvidenceText(entry: unknown): string {
	const text = activityTextWithoutActor(entry).trim();
	const concise = text.replace(/^Proof saved:\s*(?:(?:Verified|Proof):\s*)?/iu, '').trim();
	return concise || 'Completed.';
}
