import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(repoRoot, 'dist');
export const DEFAULT_STATIC_PUBLISH_DIR = path.join(distRoot, 'static-publish');

export const STATIC_PUBLISH_FILES = Object.freeze([
	'landing.html',
	'THIRD_PARTY_LICENSES.txt',
	'manifest.json',
	'assets/demo.css',
	'assets/landing.css',
	'assets/landing.js',
	'assets/not-found.css',
	'assets/favicon.png',
	'assets/favicon.svg',
	'assets/icon-192.svg',
	'assets/icon-512.svg',
	'assets/og-image-7876d230.png',
	'assets/og-image.svg',
	'data/demo-packs.json'
]);

export const SVELTE_PUBLIC_FILES = Object.freeze([
	'_headers',
	'robots.txt',
	'sw.js'
]);

const static404Page = (nebiusEdition) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Not found — ${nebiusEdition ? 'Nebius edition' : 'WebMCP Challenge'}</title>
<link rel="stylesheet" href="/assets/not-found.css">
</head>
<body><main><h1>This route is not in the ${nebiusEdition ? 'Nebius' : 'challenge'} build</h1><p>${nebiusEdition ? 'Open Work to try the Nebius workbench with four synthetic tasks.' : 'The public edition contains only the judge Guide, Priority, Work, Review, and Next screens.'}</p><p><a href="${nebiusEdition ? '/work' : '/webmcp-challenge'}">${nebiusEdition ? 'Open Work' : 'Open the guide'}</a></p></main></body>
</html>
`;

export async function buildStaticPublish(outputDir) {
	const resolvedOutputDir = path.resolve(outputDir);
	assertSafeOutputDir(resolvedOutputDir);
	await fs.rm(resolvedOutputDir, { recursive: true, force: true });

	const landingSource = process.env.PROJECTS_NEBIUS_EDITION === 'true' ? 'nebius-landing.html' : 'landing.html';
	const sampleSource = process.env.PROJECTS_NEBIUS_EDITION === 'true' ? 'data/nebius-demo-packs.json' : 'data/demo-packs.json';
	for (const relativeFile of STATIC_PUBLISH_FILES) {
		const source = path.join(repoRoot, relativeFile === 'landing.html' ? landingSource : relativeFile === 'data/demo-packs.json' ? sampleSource : relativeFile);
		const target = path.join(resolvedOutputDir, relativeFile);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.copyFile(source, target);
	}

	// The landing page is the single source for both the canonical root and its
	// explicit alias. Avoid a meta refresh and a second clean-URL redirect.
	await fs.copyFile(path.join(repoRoot, landingSource), path.join(resolvedOutputDir, 'index.html'));

	for (const relativeFile of SVELTE_PUBLIC_FILES) {
		const source = path.join(repoRoot, 'svelte-frontend', 'static', relativeFile);
		const target = path.join(resolvedOutputDir, relativeFile);
		await fs.copyFile(source, target);
	}

	await fs.writeFile(path.join(resolvedOutputDir, '404.html'), static404Page(process.env.PROJECTS_NEBIUS_EDITION === 'true'), 'utf8');
}

function assertSafeOutputDir(outputDir) {
	const relativeToDist = path.relative(distRoot, outputDir);
	if (!relativeToDist || relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) {
		throw new Error('Static output must be a child of dist/.');
	}
}
