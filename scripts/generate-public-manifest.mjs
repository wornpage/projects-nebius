#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'PUBLIC_SOURCE_MANIFEST.txt');
const excludedEntries = new Set([
	'.git',
	'node_modules',
	'dist',
	'.svelte-kit',
	'.svelte-check',
	'.wrangler',
	'coverage'
]);

async function collect(directory, files = [], isRoot = true) {
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		if (/^\.dev\.vars(?:\.|$)|^\.env(?:\.|$)|\.(?:pem|key)$/iu.test(entry.name)) continue;
		if (excludedEntries.has(entry.name) && (isRoot || entry.isDirectory())) continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await collect(absolute, files, false);
		} else if (entry.isFile()) {
			files.push(path.relative(root, absolute).split(path.sep).join('/'));
		}
	}
	return files;
}

const files = (await collect(root)).sort((left, right) => left.localeCompare(right));
const expected = `${files.join('\n')}\n`;

if (process.argv.includes('--write')) {
	await fs.writeFile(manifestPath, expected, 'utf8');
	console.log(`Wrote ${files.length} source inventory paths; this is not publication permission.`);
} else {
	let actual = '';
	try {
		actual = await fs.readFile(manifestPath, 'utf8');
	} catch {}
	if (actual !== expected) {
		throw new Error('PUBLIC_SOURCE_MANIFEST.txt is stale. Run npm run manifest:write and review the boundary change.');
	}
	console.log(`Source inventory matches ${files.length} files.`);
}
