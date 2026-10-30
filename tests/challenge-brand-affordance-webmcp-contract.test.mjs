import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const layoutSource = readFileSync(path.join(repoRoot, 'svelte-frontend', 'src', 'routes', '+layout.svelte'), 'utf8');

const workRouteSource = readFileSync(path.join(repoRoot, 'svelte-frontend', 'src', 'routes', 'work', '+page.svelte'), 'utf8');

const nextRouteSource = readFileSync(path.join(repoRoot, 'svelte-frontend', 'src', 'routes', 'next', '+page.svelte'), 'utf8');
const demoCssSource = readFileSync(path.join(repoRoot, 'assets', 'demo.css'), 'utf8');
const decisionWorkspaceSource = readFileSync(path.join(repoRoot, 'svelte-frontend', 'src', 'routes', 'work', 'WorkDecisionWorkspace.svelte'), 'utf8');
const pendingApprovalsSource = readFileSync(path.join(repoRoot, 'svelte-frontend', 'src', 'lib', 'PendingApprovalsCenter.svelte'), 'utf8');
const interactiveSurfaceSource = readFileSync(path.join(repoRoot, 'svelte-frontend', 'src', 'lib', 'components', 'WornInteractiveSurface.svelte'), 'utf8');

test('shared challenge brand keeps a padded, keyboard-visible landing affordance', () => {
	assert.match(
		layoutSource,
		/<a\s+class="challenge-brand"[\s\S]*?href="\/landing\.html"[\s\S]*?aria-label="Wornpage Projects landing page"/u
	);
	assert.match(
		layoutSource,
		/\.challenge-brand \{[\s\S]*?min-height: 44px;[\s\S]*?padding: 0 var\(--worn-space-3\);[\s\S]*?text-decoration: none;/u
	);
	assert.match(layoutSource, /\.challenge-brand:focus-visible,[\s\S]*?outline: 2px solid var\(--challenge-focus-mint\);/u);
	assert.match(layoutSource, /\.challenge-brand:hover,[\s\S]*?background: var\(--worn-hover-bg\);/u);
	assert.match(layoutSource, /\.challenge-brand span \{[\s\S]*?text-overflow: ellipsis;/u);
});

test('shared challenge layout keeps content compact and receipts comfortably separated', () => {
	assert.match(layoutSource, /\.challenge-shell \{[\s\S]*?align-content: start;/u);
	assert.match(
		layoutSource,
		/\.challenge-route :global\(\.worn-receipt\) \{[\s\S]*?margin-block: var\(--worn-space-4\);[\s\S]*?padding: var\(--worn-space-4\) var\(--worn-space-5\);/u
	);
	assert.match(layoutSource, /@media \(max-width: 700px\) \{[\s\S]*?\.challenge-route :global\(\.worn-receipt\) \{[\s\S]*?padding: var\(--worn-space-4\);/u);

});


test('modernized decision surfaces share one visual rhythm scale', () => {
	const expectedTokens = [
		['--worn-space-1', '4px'],
		['--worn-space-2', '8px'],
		['--worn-space-3', '12px'],
		['--worn-space-4', '16px'],
		['--worn-space-5', '20px'],
		['--worn-space-6', '24px'],
		['--worn-radius-md', '10px'],
		['--worn-radius-lg', '14px'],
		['--worn-text-xs', '11px'],
		['--worn-text-sm', '12px'],
		['--worn-text-md', '14px'],
		['--worn-text-lg', '17px']
	];
	for (const [token, value] of expectedTokens) {
		assert.equal(
			demoCssSource.split(`${token}: ${value};`).length - 1,
			1,
			`${token} must have one canonical declaration`
		);
	}

	const lightSemantics = [
		'--worn-accent: #0f766e;',
		'--worn-success-text: #134e4a;',
		'--worn-warning-text: #a85200;',
		'--worn-text-muted: #59625d;'
	];
	const darkSemantics = [
		'--worn-accent: #2f7665;',
		'--worn-success-text: #a7f3d0;',
		'--worn-warning-text: #fde68a;',
		'--worn-text-muted: #b0bcb4;'
	];
	assert.equal(new Set(lightSemantics.map((entry) => entry.split(': ')[1])).size, 4);
	assert.equal(new Set(darkSemantics.map((entry) => entry.split(': ')[1])).size, 4);
	for (const declaration of [...lightSemantics, ...darkSemantics]) {
		assert.match(demoCssSource, new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
	}

	assert.match(layoutSource, /\.challenge-shell \{[\s\S]*?gap: var\(--worn-space-5\);/u);
	assert.match(layoutSource, /\.challenge-shell-nav \{[\s\S]*?border-radius: var\(--worn-radius-md\);[\s\S]*?gap: var\(--worn-space-4\);/u);

	assert.match(decisionWorkspaceSource, /\.decision-workspace \{[\s\S]*?border-radius: var\(--worn-radius-md\);[\s\S]*?padding: var\(--worn-space-5\);/u);
	assert.match(decisionWorkspaceSource, /\.decision-editor-panel \{[\s\S]*?border: 0;[\s\S]*?gap: var\(--worn-space-4\);[\s\S]*?padding: var\(--worn-space-4\);/u);
	assert.match(decisionWorkspaceSource, /\.decision-workspace-explanation \{ padding-block-start: var\(--worn-space-4\); \}/u);
	assert.doesNotMatch(decisionWorkspaceSource, /var\(--worn-radius-md,\s*10px\)/u);

	assert.match(pendingApprovalsSource, /\.pending-center-item \{[\s\S]*?gap: var\(--worn-space-3\);[\s\S]*?padding: var\(--worn-space-4\);/u);
	assert.match(pendingApprovalsSource, /\.status-fresh \{[\s\S]*?var\(--worn-success-text\)/u);
	assert.match(pendingApprovalsSource, /\.status-stale \{[\s\S]*?var\(--worn-warning-text\)/u);

	assert.match(interactiveSurfaceSource, /\.advanced-options-spacing \{[\s\S]*?padding-block-start: var\(--worn-space-4\);/u);
	assert.match(interactiveSurfaceSource, /@media \(max-width: 500px\) \{[\s\S]*?padding-block-start: var\(--worn-space-3\);/u);
});



test('challenge motion is visible by default and removed for reduced motion', () => {
	assert.match(layoutSource, /animation: challenge-route-arrive 380ms/u);
	const routeArrival = layoutSource.match(/@keyframes challenge-route-arrive \{[\s\S]*?\n\t\}/u)?.[0] ?? '';
	assert.doesNotMatch(routeArrival, /opacity:/u, 'route arrival must not hide first-painted content');
	assert.match(
		layoutSource,
		/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?challenge-route[\s\S]*?animation: none;/u
	);
});
