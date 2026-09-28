// @ts-nocheck -- pure storage-envelope rules shared by the browser owner and tests.

export const DEMO_STATE_SCHEMA_VERSION = 1;

const ENVELOPE_FIELDS = new Set(['schemaVersion', 'revision', 'state']);
const REVISION_PATTERN = /^[A-Za-z0-9._@+/-]{1,200}$/u;

/**
 * Execute one complete storage operation under the browser-wide exclusive
 * lock. Callers must perform their read, comparison, and mutation inside the
 * callback so queued operations always re-read after acquiring the lock.
 *
 * @template T
 * @param {{ request: (name: string, options: { mode: 'exclusive' }, operation: () => T | Promise<T>) => Promise<T> }} lockManager
 * @param {string} lockName
 * @param {() => T | Promise<T>} operation
 * @returns {Promise<T>}
 */
export function withExclusiveStateStorageLock(lockManager, lockName, operation) {
	if (!lockManager || typeof lockManager.request !== 'function' || typeof lockName !== 'string' || !lockName || typeof operation !== 'function') {
		throw new TypeError('Browser state storage requires an exclusive lock manager.');
	}
	return lockManager.request(lockName, { mode: 'exclusive' }, operation);
}

/** @param {unknown} value */
function looksLikeEnvelope(value) {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
		Object.keys(value).some((key) => ENVELOPE_FIELDS.has(key)));
}

/**
 * Read the current envelope. A legacy raw state is returned in a new v1
 * envelope so the caller can replace that exact serialized value in storage.
 *
 * @template T
 * @param {string | null} serialized
 * @param {{ assertState: (value: unknown) => asserts value is T, migrateLegacyState: (value: T) => T, createRevision: () => string, recoverState?: (value: T) => T }} options
 * @returns {{ envelope: { schemaVersion: 1, revision: string, state: T }, migrated: boolean } | null}
 */
export function readStateEnvelope(serialized, { assertState, migrateLegacyState, createRevision, recoverState }) {
	if (serialized === null) return null;
	const parsed = JSON.parse(serialized);
	if (!Array.isArray(parsed?.packs) && looksLikeEnvelope(parsed)) {
		if (
			!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
			Object.keys(parsed).length !== ENVELOPE_FIELDS.size ||
			Object.keys(parsed).some((key) => !ENVELOPE_FIELDS.has(key)) ||
			parsed.schemaVersion !== DEMO_STATE_SCHEMA_VERSION ||
			typeof parsed.revision !== 'string' || !REVISION_PATTERN.test(parsed.revision)
		) {
			throw new TypeError('Saved workspace envelope is invalid or uses an unsupported schema version.');
		}
		const recoveredState = recoverState ? recoverState(parsed.state) : parsed.state;
		assertState(recoveredState);
		return { envelope: { ...parsed, state: recoveredState }, migrated: false, recovered: recoveredState !== parsed.state };
	}
	const state = migrateLegacyState(/** @type {T} */ (parsed));
	assertState(state);
	return {
		envelope: {
			schemaVersion: DEMO_STATE_SCHEMA_VERSION,
			revision: createRevision(),
			state
		},
		migrated: true
	};
}

/**
 * Compare the explicit expected revision immediately before one serialized
 * write, then rotate the token in the same synchronous storage operation.
 *
 * @template T
 * @param {{ serialized: string | null, expectedRevision: string | null, state: T, assertState: (value: unknown) => asserts value is T, migrateLegacyState: (value: T) => T, createRevision: () => string }} options
 * @returns {{ schemaVersion: 1, revision: string, state: T }}
 */
export function nextStateEnvelope({ serialized, expectedRevision, state, assertState, migrateLegacyState, createRevision }) {
	assertState(state);
	const current = readStateEnvelope(serialized, { assertState, migrateLegacyState, createRevision });
	const actualRevision = current?.envelope.revision ?? null;
	if (actualRevision !== expectedRevision) {
		throw new TypeError('Workspace revision conflict.');
	}
	return {
		schemaVersion: DEMO_STATE_SCHEMA_VERSION,
		revision: createRevision(),
		state
	};
}
