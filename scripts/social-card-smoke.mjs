import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATIC_PUBLISH_FILES } from './build-static-publish.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relativeImagePath = 'assets/og-image-7876d230.png';
const socialImageUrl = `https://projects-webmcp-extension.pages.dev/${relativeImagePath}`;
const sourceImagePath = path.join(root, relativeImagePath);
const builtImagePath = path.join(root, 'dist', 'static-publish', relativeImagePath);
const sourceImage = readFileSync(sourceImagePath);
const builtImage = readFileSync(builtImagePath);

assert.deepEqual(
	[...sourceImage.subarray(0, 8)],
	[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
	'social card has the PNG signature'
);
assert.equal(sourceImage.readUInt32BE(16), 1200, 'social card width is 1200 pixels');
assert.equal(sourceImage.readUInt32BE(20), 630, 'social card height is 630 pixels');
assert.ok(statSync(sourceImagePath).size <= 100_000, 'social card stays below 100 KB');
assert.deepEqual(builtImage, sourceImage, 'the published social card matches the checked-in bytes');
assert.ok(STATIC_PUBLISH_FILES.includes(relativeImagePath), 'the static publisher includes the raster social card');

for (const relativeHtmlPath of ['landing.html', 'svelte-frontend/src/app.html']) {
	const html = readFileSync(path.join(root, relativeHtmlPath), 'utf8');
	assert.match(html, new RegExp(`<meta property="og:image" content="${socialImageUrl}"`, 'u'));
	assert.match(html, new RegExp(`<meta property="og:image:secure_url" content="${socialImageUrl}"`, 'u'));
	assert.match(html, /<meta property="og:image:type" content="image\/png"/u);
	assert.match(html, new RegExp(`<meta name="twitter:image" content="${socialImageUrl}"`, 'u'));
	assert.doesNotMatch(html, /(?:og:image|twitter:image)[^>]+og-image\.svg/u);
}

const headers = readFileSync(path.join(root, 'svelte-frontend', 'static', '_headers'), 'utf8');
assert.match(
	headers,
	/\/assets\/og-image-7876d230\.png\s+Cache-Control: public, max-age=31536000, immutable/u
);

console.log(JSON.stringify({
	socialCard: relativeImagePath,
	dimensions: '1200x630',
	bytes: sourceImage.length,
	metadata: 'image/png',
	published: true
}));
