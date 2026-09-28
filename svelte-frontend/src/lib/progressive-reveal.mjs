import { focusAndPulse } from './focus-pulse.mjs';

/**
 * Settle a progressive render, preserve the continuing trigger's context, or
 * hand terminal focus to the first newly rendered destination.
 *
 * @param {{
 *   settled: PromiseLike<unknown>,
 *   removesTrigger: boolean,
 *   trigger: { scrollIntoView(options: ScrollIntoViewOptions): void } | null,
 *   getDestination: () => { focusTarget: HTMLElement, pulseTarget?: HTMLElement } | null,
 *   block?: ScrollLogicalPosition
 * }} options
 * @returns {Promise<'continuing' | 'terminal-focused' | 'terminal-missing'>}
 */
export async function settleProgressiveReveal(options) {
	if (!options || typeof options !== 'object') {
		throw new TypeError('Progressive reveal requires an options contract.');
	}
	const { settled, removesTrigger, trigger, getDestination, block = 'center' } = options;
	if (!settled || typeof settled.then !== 'function') {
		throw new TypeError('Progressive reveal requires a settled Promise.');
	}
	if (typeof removesTrigger !== 'boolean') {
		throw new TypeError('Progressive reveal requires a removesTrigger boolean.');
	}
	if (typeof getDestination !== 'function') {
		throw new TypeError('Progressive reveal requires a destination resolver.');
	}

	await settled;
	if (!removesTrigger) {
		if (!trigger || typeof trigger.scrollIntoView !== 'function') {
			throw new TypeError('Progressive reveal requires a continuing trigger.');
		}
		trigger.scrollIntoView({ block: 'center', inline: 'nearest' });
		return 'continuing';
	}

	const destination = getDestination();
	if (!destination?.focusTarget) return 'terminal-missing';
	focusAndPulse(destination.focusTarget, {
		block,
		pulseTarget: destination.pulseTarget
	});
	return 'terminal-focused';
}
