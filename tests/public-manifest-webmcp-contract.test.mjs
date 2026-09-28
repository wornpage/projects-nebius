import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatorSource = path.join(repoRoot, 'scripts', 'generate-public-manifest.mjs');
const reservedEntryNames = [
	'.git',
	'node_modules',
	'dist',
	'.svelte-kit',
	'.svelte-check',
	'.wrangler',
	'coverage'
];

function runGenerator(fixtureRoot, scriptsRoot) {
	return spawnSync(process.execPath, [path.join(scriptsRoot, 'generate-public-manifest.mjs')], {
		cwd: fixtureRoot,
		encoding: 'utf8',
		windowsHide: true
	});
}

async function createFixture(parentRoot, representation) {
	const fixtureRoot = path.join(parentRoot, representation);
	const scriptsRoot = path.join(fixtureRoot, 'scripts');
	const sourceRoot = path.join(fixtureRoot, 'src');
	await fs.mkdir(scriptsRoot, { recursive: true });
	await fs.mkdir(sourceRoot);
	await fs.copyFile(generatorSource, path.join(scriptsRoot, 'generate-public-manifest.mjs'));
	await fs.writeFile(path.join(fixtureRoot, 'visible.txt'), 'public\n', 'utf8');

	for (const name of reservedEntryNames) {
		const reservedRootEntry = path.join(fixtureRoot, name);
		if (representation === 'files') {
			await fs.writeFile(reservedRootEntry, `reserved root file: ${name}\n`, 'utf8');
		} else {
			await fs.mkdir(reservedRootEntry);
			await fs.writeFile(path.join(reservedRootEntry, 'ignored.txt'), 'generated\n', 'utf8');
		}
		await fs.writeFile(path.join(sourceRoot, name), `legitimate nested source: ${name}\n`, 'utf8');
	}

	const expectedPaths = [
		'PUBLIC_SOURCE_MANIFEST.txt',
		'scripts/generate-public-manifest.mjs',
		...reservedEntryNames.map((name) => `src/${name}`),
		'visible.txt'
	].sort((left, right) => left.localeCompare(right));
	await fs.writeFile(
		path.join(fixtureRoot, 'PUBLIC_SOURCE_MANIFEST.txt'),
		`${expectedPaths.join('\n')}\n`,
		'utf8'
	);

	return { fixtureRoot, scriptsRoot, expectedCount: expectedPaths.length };
}

test('public manifest excludes reserved root files and directories without hiding legitimate source', async (context) => {
	const parentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'projects-webmcp-manifest-'));
	context.after(() => fs.rm(parentRoot, { recursive: true, force: true }));

	for (const representation of ['files', 'directories']) {
		const fixture = await createFixture(parentRoot, representation);
		const matchingResult = runGenerator(fixture.fixtureRoot, fixture.scriptsRoot);
		assert.equal(matchingResult.status, 0, matchingResult.stderr);
		assert.match(
			matchingResult.stdout,
			new RegExp(`Public source manifest matches ${fixture.expectedCount} files\\.`, 'u')
		);

		await fs.writeFile(path.join(fixture.fixtureRoot, 'src', 'new-source.mjs'), 'export const visible = true;\n', 'utf8');
		const staleResult = runGenerator(fixture.fixtureRoot, fixture.scriptsRoot);
		assert.notEqual(staleResult.status, 0);
		assert.match(staleResult.stderr, /PUBLIC_SOURCE_MANIFEST\.txt is stale/u);
	}
});
