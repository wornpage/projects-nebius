// @ts-nocheck -- plain ESM shared by browser state and WebMCP contracts.

export const WORK_TITLE_MAX_LENGTH = 200;

/** @param {unknown} value @returns {string} */
export function canonicalizeText(value) {
	return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * Canonicalize user-visible text without truncating a Unicode scalar value.
 * The limit is measured after NFC and whitespace normalization so every caller
 * validates the exact value that persistence would store.
 *
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string | null}
 */
export function normalizeBoundedText(value, maxLength) {
	if (typeof value !== 'string' || !Number.isSafeInteger(maxLength) || maxLength < 0 || /\p{Cc}/u.test(value)) {
		return null;
	}
	const normalized = canonicalizeText(value);
	return [...normalized].length <= maxLength ? normalized : null;
}

/** @param {unknown} value @returns {string | null} */
export function normalizeWorkTitle(value) {
	return normalizeBoundedText(value, WORK_TITLE_MAX_LENGTH);
}
