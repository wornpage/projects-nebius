import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	activityPresentationGeometry,
	keepActivityPresenterVisible
} from '../svelte-frontend/src/lib/webmcp-activity-presentation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const activityStripSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/WebMcpActivityStrip.svelte'), 'utf8');
const workRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/work/+page.svelte'), 'utf8');
const reviewRouteSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/+page.svelte'), 'utf8');

function presentationFixture({ presenter, target, width, height }) {
	let presenterRect = { ...presenter };
	let targetRect = { ...target };
	const scrollCalls = [];
	const ownerDocument = {
		defaultView: {
			innerWidth: width,
			innerHeight: height,
			scrollBy(options) {
				scrollCalls.push(options);
				presenterRect = { ...presenterRect, top: presenterRect.top - options.top, bottom: presenterRect.bottom - options.top };
				targetRect = { ...targetRect, top: targetRect.top - options.top, bottom: targetRect.bottom - options.top };
			}
		}
	};
	const targetElement = { ownerDocument, getBoundingClientRect: () => targetRect };
	ownerDocument.activeElement = targetElement;
	return {
		presenter: { getBoundingClientRect: () => presenterRect },
		target: targetElement,
		scrollCalls
	};
}

test('normal viewport needs no correction and keeps presenter and focused result separate', () => {
	const fixture = presentationFixture({
		presenter: { left: 16, right: 784, top: 40, bottom: 156 },
		target: { left: 16, right: 784, top: 180, bottom: 300 },
		width: 800,
		height: 600
	});
	const receipt = keepActivityPresenterVisible(fixture.presenter, fixture.target);
	assert.equal(receipt.nonOccluded, true);
	assert.equal(receipt.presenterInViewport, true);
	assert.equal(receipt.targetInViewport, true);
	assert.equal(fixture.target.ownerDocument.activeElement, fixture.target);
	assert.deepEqual(fixture.scrollCalls, []);
});

test('short narrow wrapped presenter moves into view with its focused result and cannot overlay it', () => {
	const fixture = presentationFixture({
		presenter: { left: 8, right: 312, top: -40, bottom: 220 },
		target: { left: 8, right: 312, top: 252, bottom: 372 },
		width: 320,
		height: 480
	});
	const receipt = keepActivityPresenterVisible(fixture.presenter, fixture.target);
	assert.deepEqual(fixture.scrollCalls, [{ left: 0, top: -48, behavior: 'auto' }]);
	assert.equal(receipt.nonOccluded, true);
	assert.equal(receipt.presenterInViewport, true);
	assert.equal(receipt.targetInViewport, true);
	assert.equal(fixture.target.ownerDocument.activeElement, fixture.target);
});

test('overlap and impossible co-visibility fail instead of claiming a safe presentation', () => {
	const overlap = presentationFixture({
		presenter: { left: 8, right: 312, top: 0, bottom: 260 },
		target: { left: 8, right: 312, top: 220, bottom: 340 },
		width: 320,
		height: 480
	});
	assert.throws(
		() => keepActivityPresenterVisible(overlap.presenter, overlap.target),
		/Activity presenter obscured the focused result/u
	);
	const impossible = presentationFixture({
		presenter: { left: 8, right: 312, top: -300, bottom: 100 },
		target: { left: 8, right: 312, top: 140, bottom: 420 },
		width: 320,
		height: 480
	});
	assert.throws(
		() => keepActivityPresenterVisible(impossible.presenter, impossible.target),
		/do not fit in the viewport together/u
	);
	assert.equal(activityPresentationGeometry(
		{ left: 8, right: 312, top: 0, bottom: 260 },
		{ left: 8, right: 312, top: 220, bottom: 340 },
		{ width: 320, height: 480 }
	).nonOccluded, false);
});

test('Work and Review reverify the real focused target after rendering one non-overlay presenter', () => {
	assert.match(activityStripSource, /position: static;/u);
	assert.doesNotMatch(activityStripSource, /position: sticky|position: fixed|z-index:/u);
	for (const [route, source] of [['work', workRouteSource], ['review', reviewRouteSource]]) {
		assert.equal((source.match(/<WebMcpActivityStrip/gu) ?? []).length, 1, `${route} must render one shared presenter`);
		assert.match(source, /requireVisibleFocus && activityPresenter\) keepActivityPresenterVisible\(activityPresenter, (?:destination|focusTarget)\);/u);
		assert.doesNotMatch(source, new RegExp(`data-webmcp-receipt=["']${route}["']`, 'u'));
	}
});
