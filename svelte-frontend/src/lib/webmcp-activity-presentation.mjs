const DEFAULT_VIEWPORT_GAP = 8;

/** @param {{ left: number, right: number, top: number, bottom: number }} rect */
function rectWidth(rect) {
	return rect.right - rect.left;
}

/** @param {{ left: number, right: number, top: number, bottom: number }} rect */
function rectHeight(rect) {
	return rect.bottom - rect.top;
}

/**
 * Plan the smallest vertical correction that keeps a regular-flow activity
 * presenter and its focused result fully visible together.
 *
 * @param {{ left: number, right: number, top: number, bottom: number }} presenterRect
 * @param {{ left: number, right: number, top: number, bottom: number }} targetRect
 * @param {{ width: number, height: number }} viewport
 * @param {{ gap?: number }} [options]
 */
export function activityPresentationGeometry(presenterRect, targetRect, viewport, options = {}) {
	const gap = options.gap ?? DEFAULT_VIEWPORT_GAP;
	const horizontallyOverlapping = presenterRect.left < targetRect.right && presenterRect.right > targetRect.left;
	const verticallyOverlapping = presenterRect.top < targetRect.bottom && presenterRect.bottom > targetRect.top;
	const unionTop = Math.min(presenterRect.top, targetRect.top);
	const unionBottom = Math.max(presenterRect.bottom, targetRect.bottom);
	const unionHeight = unionBottom - unionTop;
	const fitsTogether =
		rectWidth(presenterRect) <= viewport.width &&
		rectWidth(targetRect) <= viewport.width &&
		rectHeight(presenterRect) <= viewport.height &&
		rectHeight(targetRect) <= viewport.height &&
		unionHeight + gap * 2 <= viewport.height;
	let scrollBy = 0;
	if (fitsTogether) {
		if (unionTop < gap) scrollBy = unionTop - gap;
		else if (unionBottom > viewport.height - gap) scrollBy = unionBottom - (viewport.height - gap);
	}
	return {
		fitsTogether,
		nonOccluded: !(horizontallyOverlapping && verticallyOverlapping),
		presenterInViewport:
			presenterRect.left >= 0 && presenterRect.right <= viewport.width &&
			presenterRect.top >= 0 && presenterRect.bottom <= viewport.height,
		targetInViewport:
			targetRect.left >= 0 && targetRect.right <= viewport.width &&
			targetRect.top >= 0 && targetRect.bottom <= viewport.height,
		scrollBy
	};
}

/**
 * Keep the explanation co-visible with the focused result without using an
 * overlay. Scrolling does not change active-element or focus-visible state;
 * callers retain the strict focusAndPulse verification.
 *
 * @param {HTMLElement} presenter
 * @param {HTMLElement} target
 * @param {{ gap?: number }} [options]
 */
export function keepActivityPresenterVisible(presenter, target, options = {}) {
	const ownerWindow = target.ownerDocument.defaultView;
	if (!ownerWindow) throw new Error('Activity presentation requires a viewport.');
	const viewport = { width: ownerWindow.innerWidth, height: ownerWindow.innerHeight };
	const initial = activityPresentationGeometry(
		presenter.getBoundingClientRect(),
		target.getBoundingClientRect(),
		viewport,
		options
	);
	if (!initial.nonOccluded) throw new Error('Activity presenter obscured the focused result.');
	if (!initial.fitsTogether) throw new Error('Activity presenter and focused result do not fit in the viewport together.');
	if (initial.scrollBy !== 0) ownerWindow.scrollBy({ left: 0, top: initial.scrollBy, behavior: 'auto' });

	const settled = activityPresentationGeometry(
		presenter.getBoundingClientRect(),
		target.getBoundingClientRect(),
		viewport,
		options
	);
	if (!settled.nonOccluded || !settled.presenterInViewport || !settled.targetInViewport) {
		throw new Error('Activity presenter and focused result did not settle co-visible without overlap.');
	}
	return settled;
}
