import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = fileURLToPath(new URL('../svelte-frontend/src/', import.meta.url));
const toastArchive = 'https://codeload.github.com/wornpage/toast/tar.gz/f8b12dbab5b5072e7a2f009ef52a9417a3cbde64';
const receiptArchive = 'https://codeload.github.com/wornpage/receipt/tar.gz/6710499b30a410a5e4b12aef2cbde4e3883e249f';
const frontendPackage = JSON.parse(readFileSync(
	new URL('../svelte-frontend/package.json', import.meta.url),
	'utf8'
));
const frontendLock = JSON.parse(readFileSync(
	new URL('../svelte-frontend/package-lock.json', import.meta.url),
	'utf8'
));

function sourceFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : [path];
	});
}

const demoClientSource = readFileSync(
	new URL('../svelte-frontend/src/lib/demo-client.ts', import.meta.url),
	'utf8'
);
const layoutSource = readFileSync(
	new URL('../svelte-frontend/src/routes/+layout.svelte', import.meta.url),
	'utf8'
);
const undoSource = readFileSync(
	new URL('../svelte-frontend/src/lib/undo.ts', import.meta.url),
	'utf8'
);
const wornToastSource = readFileSync(
	new URL('../svelte-frontend/src/lib/components/WornToast.svelte', import.meta.url),
	'utf8'
);
const componentIndexSource = readFileSync(
	new URL('../svelte-frontend/src/lib/components/index.ts', import.meta.url),
	'utf8'
);
const producerRouteSources = ['work', 'review', 'next'].map((route) => readFileSync(
	new URL(`../svelte-frontend/src/routes/${route}/+page.svelte`, import.meta.url),
	'utf8'
));
const receiptRouteSources = ['next', 'webmcp-challenge', 'work'].map((route) => readFileSync(
	new URL(`../svelte-frontend/src/routes/${route}/+page.svelte`, import.meta.url),
	'utf8'
));

test('shared WornToast dismissal is the only toast-removal owner', () => {
	assert.equal(frontendPackage.dependencies['@wornpage/toast'], toastArchive);
	assert.equal(frontendLock.packages[''].dependencies['@wornpage/toast'], toastArchive);
	assert.equal(frontendLock.packages['node_modules/@wornpage/toast'].version, '0.1.6');
	assert.equal(frontendLock.packages['node_modules/@wornpage/toast'].resolved, toastArchive);

	const mutationOwners = sourceFiles(sourceRoot)
		.map((path) => ({
			path: relative(sourceRoot, path).replaceAll('\\', '/'),
			count: readFileSync(path, 'utf8').match(/\btoasts\s*\.\s*update\s*\(/gu)?.length ?? 0
		}))
		.filter(({ count }) => count > 0);
	assert.deepEqual(mutationOwners, [
		{ path: 'lib/demo-client.ts', count: 1 },
		{ path: 'routes/+layout.svelte', count: 1 }
	]);

	assert.match(layoutSource, /import WornToast from '\$lib\/components\/WornToast\.svelte';/u);
	assert.match(layoutSource, /function dismissToast\(id: string\)[\s\S]*?items\.filter\(\(item\) => item\.id !== id\)/u);
	assert.match(layoutSource, /<WornToast \{toast\} ondismiss=\{\(\) => dismissToast\(toast\.id\)\} \/>/u);
	assert.match(wornToastSource, /import \{ Toast \} from '@wornpage\/toast';/u);
	assert.match(wornToastSource, /<Toast[\s\S]*?\{ondismiss\}[\s\S]*?\/>/u);
	assert.doesNotMatch(wornToastSource, /\bduration\s*=/u);

	const displayToastSource = demoClientSource.match(/export function displayToast\([\s\S]*?^\}/mu)?.[0] ?? '';
	assert.match(displayToastSource, /toasts\.update\(\(items\) => \[\.\.\.items, \{ id, message, kind \}\]\);/u);
	assert.doesNotMatch(displayToastSource, /setTimeout|\.slice|\.filter/u);

	assert.match(undoSource, /import \{ demoState, displayToast, saveBrowserState, savePackPath \} from '\$lib\/demo-client';/u);
	assert.match(undoSource, /displayToast\(`Undo complete\.[\s\S]*?'success'\);/u);
	assert.match(undoSource, /displayToast\([\s\S]*?'Undo failed — the local state is unchanged\.'[\s\S]*?'error'/u);
	assert.match(undoSource, /export function commitActionUndo\(snapshot: ReceiptUndo \| null\): void \{\s*receiptUndo\.set\(snapshot\);\s*\}/u);
	assert.match(undoSource, /export function buildBatchUndoSnapshot\([\s\S]*?type: 'batch'[\s\S]*?targets/u);
	assert.match(undoSource, /if \(undo\.type === 'batch'\)[\s\S]*?saveBrowserState\([\s\S]*?Restored \$\{undo\.targets\.length\} work items/u);
	assert.doesNotMatch(undoSource, /function notify|\btoasts\b|setTimeout/u);
	const runPackActionSource = demoClientSource.match(/export async function runPackAction\([\s\S]*?^\}/mu)?.[0] ?? '';
	assert.match(runPackActionSource, /displayToast\(receipt\.summary, 'success'\)/u);
	assert.doesNotMatch(runPackActionSource, /Undo is available/u);

	for (const routeSource of producerRouteSources) {
		assert.match(routeSource, /import[\s\S]*?displayToast[\s\S]*?from '\$lib\/demo-client';/u);
		assert.match(routeSource, /displayToast\(/u);
		assert.doesNotMatch(routeSource, /\btoasts\b|\.slice\(-4\)|function toast\s*\(/u);
	}
});

test('Projects consumes immutable WornReceipt focus recovery without a local fallback', () => {
	assert.equal(frontendPackage.dependencies['@wornpage/receipt'], receiptArchive);
	assert.equal(frontendLock.packages[''].dependencies['@wornpage/receipt'], receiptArchive);
	assert.equal(frontendLock.packages['node_modules/@wornpage/receipt'].resolved, receiptArchive);
	assert.match(frontendLock.packages['node_modules/@wornpage/receipt'].integrity, /^sha512-/u);
	assert.match(componentIndexSource, /export \{ WornReceipt \} from '@wornpage\/receipt';/u);

	for (const routeSource of receiptRouteSources) {
		assert.match(routeSource, /<WornReceipt/u);
		assert.match(routeSource, /ondone=/u);
		assert.doesNotMatch(routeSource, /dismissWithFocusRecovery|focus-recovery/u);
	}
});
