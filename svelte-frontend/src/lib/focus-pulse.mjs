// The arrival state gives a person a brief chance to orient after a cross-route
// jump. Keyboard focus remains after this interval; only the extra visual
// arrival treatment is removed.
const FOCUS_PULSE_DURATION_MS = 2400;

const focusPulseTimers = new WeakMap();
const FOCUSABLE_SELECTOR = 'a, button, input, select, textarea, [tabindex]';

/** @typedef {{ focused: boolean, focusVisible: boolean, inViewport: boolean, pulsed: boolean }} FocusReceipt */

function prefersReducedMotion() {
	return typeof globalThis.matchMedia === 'function' &&
		globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** @param {number} start @param {number} end @param {number} viewportSize */
function axisIsVisiblyInViewport(start, end, viewportSize) {
	const targetSize = end - start;
	if (viewportSize <= 0 || targetSize <= 0) return false;
	return targetSize <= viewportSize
		? start >= 0 && end <= viewportSize
		: end > 0 && start < viewportSize;
}

/**
 * Move the viewport and keyboard focus to a guided destination, then briefly
 * mark the arrival point without creating a second navigation path.
 *
 * @param {HTMLElement} target
 * @param {{ behavior?: ScrollBehavior, block?: ScrollLogicalPosition, pulseTarget?: HTMLElement, requireVisibleFocus?: boolean }} [options]
 * @returns {FocusReceipt}
 */
export function focusAndPulse(target, options = {}) {
	const behavior = prefersReducedMotion() ? 'auto' : (options.behavior || 'auto');
	const block = options.block || 'center';
	const pulseTarget = options.pulseTarget || target;

	pulseTarget.scrollIntoView({ behavior, block, inline: 'nearest' });
	if (!target.matches(FOCUSABLE_SELECTOR)) target.setAttribute('tabindex', '-1');
	if (options.requireVisibleFocus && target.ownerDocument.activeElement === target && !target.matches(':focus-visible')) {
		target.blur();
	}
	if (options.requireVisibleFocus) {
		target.focus({ preventScroll: true, focusVisible: true });
	} else {
		target.focus({ preventScroll: true });
	}

	const pendingTimer = focusPulseTimers.get(pulseTarget);
	if (pendingTimer !== undefined) globalThis.clearTimeout(pendingTimer);
	pulseTarget.classList.remove('demo-focus-pulse');
	void pulseTarget.offsetWidth;
	pulseTarget.setAttribute('data-focus-arrival', 'true');
	pulseTarget.classList.add('demo-focus-pulse');

	const timer = globalThis.setTimeout(() => {
		pulseTarget.classList.remove('demo-focus-pulse');
		pulseTarget.removeAttribute('data-focus-arrival');
		focusPulseTimers.delete(pulseTarget);
	}, FOCUS_PULSE_DURATION_MS);
	focusPulseTimers.set(pulseTarget, timer);

	const rect = target.getBoundingClientRect();
	const ownerWindow = target.ownerDocument.defaultView;
	const inViewport = ownerWindow
		? axisIsVisiblyInViewport(rect.left, rect.right, ownerWindow.innerWidth) &&
			axisIsVisiblyInViewport(rect.top, rect.bottom, ownerWindow.innerHeight)
		: false;
	const receipt = {
		focused: target.ownerDocument.activeElement === target,
		focusVisible: target.matches(':focus-visible'),
		inViewport,
		pulsed: pulseTarget.classList.contains('demo-focus-pulse')
	};
	if (options.requireVisibleFocus && Object.values(receipt).some((value) => !value)) {
		throw new Error(`Visible focus verification failed: ${JSON.stringify(receipt)}`);
	}
	return receipt;
}
