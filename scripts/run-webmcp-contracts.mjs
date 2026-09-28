#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsRoot = path.join(repoRoot, 'tests');
const tests = readdirSync(testsRoot, { withFileTypes: true })
	.filter((entry) => entry.isFile() && entry.name.includes('webmcp') && entry.name.endsWith('.test.mjs'))
	.map((entry) => path.join(testsRoot, entry.name))
	.sort((left, right) => left.localeCompare(right));

if (tests.length === 0) {
	throw new Error('No WebMCP contract tests were found in tests/.');
}

const result = spawnSync(process.execPath, ['--test', ...tests], {
	cwd: repoRoot,
	stdio: 'inherit',
	windowsHide: true
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
