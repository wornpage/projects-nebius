import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { focusAndPulse } from '../svelte-frontend/src/lib/focus-pulse.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const focusPulseSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/focus-pulse.mjs'), 'utf8');
const layoutSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/+layout.svelte'), 'utf8');
const workGridCardSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/components/WorkGridCard.svelte'), 'utf8');
const workListCardSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/components/WorkListCard.svelte'), 'utf8');
const reviewSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/review/+page.svelte'), 'utf8');
const nextSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/next/+page.svelte'), 'utf8');
const demoCssSource = fs.readFileSync(path.join(repoRoot, 'assets/demo.css'), 'utf8');

function focusTarget(rect, { width = 320, height = 180 } = {}) {
	let focusVisible = false;
	const attributes = new Map();
	const classes = new Set();
	const ownerDocument = {
		activeElement: null,
		defaultView: { innerWidth: width, innerHeight: height }
	};
	const calls = { blur: 0, focus: [] };
	const target = {
		ownerDocument,
		classList: {
			add(value) { classes.add(value); },
			contains(value) { return classes.has(value); },
			remove(value) { classes.delete(value); }
		},
		offsetWidth: rect.right - rect.left,
		blur() {
			calls.blur += 1;
			ownerDocument.activeElement = null;
			focusVisible = false;
		},
		focus(options) {
			calls.focus.push(options);
			ownerDocument.activeElement = target;
			focusVisible = options.focusVisible === true;
		},
		getBoundingClientRect() { return rect; },
		matches(selector) { return selector === ':focus-visible' ? focusVisible : true; },
		scrollIntoView() {},
		getAttribute(name) { return attributes.get(name) ?? null; },
		removeAttribute(name) { attributes.delete(name); },
		setAttribute(name, value) { attributes.set(name, value); }
	};
	ownerDocument.activeElement = target;
	return { calls, target };
}

test('required visible focus accepts an on-screen target taller than a tiny viewport', (t) => {
	t.mock.method(globalThis, 'setTimeout', () => 1);
	t.mock.method(globalThis, 'clearTimeout', () => {});
	const { calls, target } = focusTarget({ left: 0, right: 320, top: -50, bottom: 230 });

	const receipt = focusAndPulse(target, { behavior: 'auto', requireVisibleFocus: true });

	assert.deepEqual(receipt, { focused: true, focusVisible: true, inViewport: true, pulsed: true });
	assert.equal(calls.blur, 1);
	assert.deepEqual(calls.focus, [{ preventScroll: true, focusVisible: true }]);
	assert.equal(target.getAttribute('data-focus-arrival'), 'true');
});

test('the route arrival treatment is calm, perceptible, and clears cleanly', (t) => {
	let scheduled;
	t.mock.method(globalThis, 'setTimeout', (callback) => {
		scheduled = callback;
		return 1;
	});
	t.mock.method(globalThis, 'clearTimeout', () => {});
	const { target } = focusTarget({ left: 0, right: 320, top: 0, bottom: 120 });

	focusAndPulse(target, { behavior: 'auto' });
	assert.equal(target.getAttribute('data-focus-arrival'), 'true');
	assert.equal(target.classList.contains('demo-focus-pulse'), true);
	scheduled();
	assert.equal(target.getAttribute('data-focus-arrival'), null);
	assert.equal(target.classList.contains('demo-focus-pulse'), false);
	assert.match(focusPulseSource, /FOCUS_PULSE_DURATION_MS = 2400/u);
	assert.match(layoutSource, /\.demo-focus-pulse\[data-focus-arrival='true'\]/u);
	assert.match(layoutSource, /outline: 2px solid var\(--challenge-focus-mint\) !important;/u);
	assert.match(layoutSource, /outline-offset: 2px;/u);
	assert.match(layoutSource, /animation: challenge-focus-pulse 900ms ease-out both;/u);
	assert.match(layoutSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?demo-focus-pulse[\s\S]*?animation: none;/u);
	assert.doesNotMatch(layoutSource, /content: 'Focused item'/u);
	assert.doesNotMatch(layoutSource, /inset 5px 0 0 var\(--worn-accent\)/u);
	assert.doesNotMatch(layoutSource, /0 10px 24px rgb\(0 0 0 \/ 0\.28\)/u);
});

test('card-like arrivals use a complete radius-aware ring inside their real boundary', () => {
	assert.match(layoutSource, /\.demo-focus-surface:focus-visible\),?\s*:global\(\.demo-focus-surface\.demo-focus-pulse/u);
	assert.match(layoutSource, /\.demo-focus-surface\.demo-focus-pulse\[data-focus-arrival='true'\][\s\S]*?border-radius: var\(--worn-radius\);[\s\S]*?outline: 0 !important;/u);
	assert.match(layoutSource, /\.demo-focus-surface:focus-visible::after\),?\s*:global\(\.demo-focus-surface\.demo-focus-pulse/u);
	assert.match(layoutSource, /\.demo-focus-surface:focus-visible::after\),?[\s\S]*?\.demo-focus-surface\.demo-focus-pulse\[data-focus-arrival='true'\]::after[\s\S]*?border-radius: var\(--demo-focus-ring-radius, inherit\);[\s\S]*?inset: var\(--demo-focus-ring-inset, 0\);[\s\S]*?pointer-events: none;/u);
	assert.match(layoutSource, /\.demo-focus-surface:focus-visible::after\)\s*\{[\s\S]*?border: 2px solid var\(--challenge-focus-mint\);/u);
	assert.match(layoutSource, /\.demo-focus-surface\.demo-focus-pulse\[data-focus-arrival='true'\]::after\)\s*\{[\s\S]*?animation: challenge-focus-pulse 900ms ease-out both;[\s\S]*?border: 2px solid var\(--challenge-focus-mint\);/u);
	assert.doesNotMatch(`${layoutSource}\n${demoCssSource}`, /outline:\s*2px dashed|border:\s*2px dashed/u);
	assert.match(workGridCardSource, /class="demo-grid-card demo-focus-surface"/u);
	assert.match(workListCardSource, /demo-work-card demo-focus-surface/u);
	assert.match(reviewSource, /review-priority demo-focus-surface/u);
	assert.match(reviewSource, /demo-review-card demo-focus-surface/u);
	assert.match(reviewSource, /\.review-priority-shell,\s*\.review-priority\s*\{[\s\S]*?border-radius: var\(--worn-radius\);/u);
	assert.match(reviewSource, /\.review-priority\s*\{[\s\S]*?--demo-focus-ring-inset: -8px;[\s\S]*?--demo-focus-ring-radius: calc\(var\(--worn-radius\) \+ 8px\);/u);
	assert.match(nextSource, /demo-command-lines compact demo-focus-surface/u);
	assert.match(nextSource, /\.demo-command-lines\.demo-focus-surface\s*\{[\s\S]*?--demo-focus-ring-inset: -6px;[\s\S]*?--demo-focus-ring-radius: calc\(var\(--worn-radius\) \+ 6px\);/u);
	assert.doesNotMatch(workGridCardSource, /\.demo-grid-card:focus-visible\s*\{[^}]*outline:/u);
	assert.doesNotMatch(workListCardSource, /\.demo-work-card:focus-visible\)\s*\{[^}]*outline:/u);
	assert.match(demoCssSource, /\.demo-card-title:focus-visible\s*\{[\s\S]*?text-decoration: underline;[\s\S]*?text-decoration-thickness: 2px;/u);
	assert.doesNotMatch(demoCssSource, /\.demo-card-title:focus-visible\s*\{[^}]*outline:\s*2px dashed/u);
	assert.match(demoCssSource, /\.demo-card-receipt:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--worn-link\);/u);
	assert.match(workGridCardSource, /\.grid-card-fact\{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:auto minmax\(0,1fr\);[\s\S]*?overflow:visible;[\s\S]*?white-space:normal\}/u);
	assert.match(workGridCardSource, /\.grid-card-fact strong\{[\s\S]*?overflow-wrap:anywhere;[\s\S]*?white-space:normal\}/u);
});

test('required visible focus still rejects fit-sized clipping and wholly off-screen oversized targets', (t) => {
	t.mock.method(globalThis, 'setTimeout', () => 1);
	t.mock.method(globalThis, 'clearTimeout', () => {});
	const clipped = focusTarget({ left: 0, right: 320, top: -1, bottom: 100 }).target;
	const offscreen = focusTarget({ left: 0, right: 320, top: 181, bottom: 461 }).target;

	assert.throws(
		() => focusAndPulse(clipped, { behavior: 'auto', requireVisibleFocus: true }),
		/Visible focus verification failed: .*"inViewport":false/u
	);
	assert.throws(
		() => focusAndPulse(offscreen, { behavior: 'auto', requireVisibleFocus: true }),
		/Visible focus verification failed: .*"inViewport":false/u
	);
});
