import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { STATIC_PUBLISH_FILES, SVELTE_PUBLIC_FILES } from './build-static-publish.mjs';
import { collectInlineScriptBodies } from './inline-script-bodies.mjs';
import { resolveSocialImageUrl, rewriteSocialImageMetadata, SOCIAL_IMAGE_PATH } from './social-image-metadata.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(root, 'dist', 'static-publish');
const deniedRuntimePatterns = [
	/projectsdemo\.org/u,
	/["'`]\/(?:about|achievements|activity|adopt|agents|authorize|billing|blocked|calendar|catalog|changelog|compare|create|decisions|design|export|gantt|heartbeat|home|inbox|insights|login|mcp-tools|memory|more|notifications|pack|profile|scenarios|search|settings|team|templates)(?=[\/?#"'`])/u,
	/mcp-token|includeBudget/u
];

function collectFiles(directory, files = []) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const target = path.join(directory, entry.name);
		if (entry.isDirectory()) collectFiles(target, files);
		else if (entry.isFile()) files.push(target);
	}
	return files;
}

function collectText(directory) {
	const socialImageUrl = resolveSocialImageUrl(process.env.NEBIUS_PUBLIC_ORIGIN);
	return collectFiles(directory)
		.filter((file) => /\.(?:css|html|js|json|svg|txt)$/u.test(file))
		.map((file) => {
			const text = readFileSync(file, 'utf8');
			// An explicitly selected public image URL is allowed only in its two
			// metadata attributes; all other private-route checks still see it.
			return socialImageUrl && file.endsWith('.html')
				? rewriteSocialImageMetadata(text, SOCIAL_IMAGE_PATH, { expectedImage: socialImageUrl }).html
				: text;
		});
}





test('inline script extraction follows HTML parsing semantics', () => {
	assert.deepEqual(
		collectInlineScriptBodies(
			'<SCRIPT nonce="one">window.bootstrap = "<tag>";</SCRIPT foo="ignored"><script SRC="app.js">ignored()</script><script>  </script>'
		),
		['window.bootstrap = "<tag>";']
	);
});

test('the privacy scan masks a selected image URL only in social metadata', () => {
	const origin = ['https://projects', 'demo.org.invalid'].join('');
	const image = `${origin}${SOCIAL_IMAGE_PATH}`;
	const meta = `<meta property="og:image" content="${image}"><meta name="twitter:image" content="${image}">`;
	const onlyMeta = rewriteSocialImageMetadata(meta, SOCIAL_IMAGE_PATH, { expectedImage: image }).html;
	assert.doesNotMatch(onlyMeta, deniedRuntimePatterns[0]);
	const elsewhere = rewriteSocialImageMetadata(`${meta}<p>${origin}/private</p>`, SOCIAL_IMAGE_PATH, { expectedImage: image }).html;
	assert.match(elsewhere, deniedRuntimePatterns[0]);
});

test('Nebius landing keeps its public path without the retired WebMCP replay', () => {
	const landing = readFileSync(path.join(artifactRoot, 'landing.html'), 'utf8');
	assert.match(landing, /id="nebius-title"/u);
	assert.equal(STATIC_PUBLISH_FILES.includes('assets/landing.js'), false);
	assert.equal(existsSync(path.join(artifactRoot, 'assets/landing.js')), false);
	assert.doesNotMatch(landing, /\/assets\/landing\.js|id="replay-demo"/u);
});













test('distributed notices retain the MIT license and accompany the browser artifact', () => {
	for (const file of ['LICENSE', 'LICENSING.md', 'THIRD_PARTY_LICENSES.txt']) {
		assert.ok(STATIC_PUBLISH_FILES.includes(file), `${file} is selected for browser distribution`);
		assert.deepEqual(readFileSync(path.join(artifactRoot, file)), readFileSync(path.join(root, file)), `${file} is distributed without alteration`);
	}
	const baseline = readFileSync(path.join(root, 'LICENSE'), 'utf8').replaceAll('\r\n', '\n');
	assert.equal(createHash('sha256').update(baseline, 'utf8').digest('hex'), '8759f34b16b82f284085f5880657fa69a6209e5fe4744b92c7c3e9d5863e4eb9', 'complete original MIT notice remains intact');
	assert.match(baseline, /^MIT License\n\nCopyright \(c\) 2026 Jared Bidlow\n/u);
	assert.match(baseline, /Permission is hereby granted, free of charge/u);
	assert.match(baseline, /THE SOFTWARE IS PROVIDED "AS IS"/u);
	const policy = readFileSync(path.join(root, 'LICENSING.md'), 'utf8');
	const accessPolicy = policy.replace(/\s+/gu, ' ');
	assert.match(accessPolicy, /Source publication, hosted access and provider spending are separate owner-authorized actions\./u);
	assert.match(accessPolicy, /keeping AI guidance and Sandbox execution disabled\./u);
	assert.match(accessPolicy, /does not itself authorize a future visibility, hosting or provider-setting change\./u);
	for (const directory of ['', 'svelte-frontend']) {
		const metadata = JSON.parse(readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
		const lock = JSON.parse(readFileSync(path.join(root, directory, 'package-lock.json'), 'utf8'));
		assert.equal(metadata.private, true);
		assert.equal(metadata.license, 'MIT');
		assert.equal(lock.packages[''].license, metadata.license);
	}
});

test('static artifact publishes the complete challenge input and security metadata', () => {
	for (const file of [
		'landing.html',
		'THIRD_PARTY_LICENSES.txt',
		'manifest.json',
		'assets/og-image.svg',
		'assets/not-found.css',
		'assets/icon-192.svg',
		'assets/icon-512.svg',
		'data/demo-packs.json'
	]) {
		assert.ok(STATIC_PUBLISH_FILES.includes(file), `${file} is published`);
	}
	const sourceAliases = {
		'landing.html': 'nebius-landing.html',
		'data/demo-packs.json': 'data/nebius-demo-packs.json'
	};
	for (const file of STATIC_PUBLISH_FILES) {
		const source = sourceAliases[file] ?? file;
		assert.ok(existsSync(path.join(root, source)), `${source} exists as the source for ${file}`);
		assert.ok(existsSync(path.join(artifactRoot, file)), `${file} exists in the browser artifact`);
		let expected = readFileSync(path.join(root, source));
		const socialImageUrl = resolveSocialImageUrl(process.env.NEBIUS_PUBLIC_ORIGIN);
		if (file === 'landing.html' && socialImageUrl) expected = Buffer.from(rewriteSocialImageMetadata(expected.toString('utf8'), socialImageUrl).html);
		assert.deepEqual(readFileSync(path.join(artifactRoot, file)), expected, `${file} matches its source`);
	}
	const landingSource = readFileSync(path.join(root, 'nebius-landing.html'), 'utf8');
	const socialImageUrl = resolveSocialImageUrl(process.env.NEBIUS_PUBLIC_ORIGIN);
	const expectedIndex = socialImageUrl ? rewriteSocialImageMetadata(landingSource, socialImageUrl).html : landingSource;
	assert.equal(readFileSync(path.join(artifactRoot, 'index.html'), 'utf8'), expectedIndex, 'root HTML matches the Nebius landing source');
	assert.equal(STATIC_PUBLISH_FILES.includes('index.html'), false, 'root HTML is derived from the landing source');
	for (const file of ['_headers', 'robots.txt', 'sw.js']) {
		assert.ok(SVELTE_PUBLIC_FILES.includes(file), `${file} is published`);
		assert.ok(existsSync(path.join(root, 'svelte-frontend', 'static', file)), `${file} exists`);
	}
	const serviceWorker = readFileSync(path.join(root, 'svelte-frontend', 'static', 'sw.js'), 'utf8');
	assert.match(serviceWorker, /CACHE_NAME = 'projects-webmcp-v2'[\s\S]*?PRECACHE[\s\S]*?pathname === '\/sw\.js'[\s\S]*?event\.request\.mode === 'navigate'/u);
	const layout = readFileSync(path.join(root, 'svelte-frontend', 'src', 'routes', '+layout.svelte'), 'utf8');
	assert.match(layout, /serviceWorker\.register\('\/sw\.js', \{ updateViaCache: 'none' \}\)/u);
	assert.equal(existsSync(path.join(root, 'svelte-frontend', 'static', 'sitemap.xml')), false);
	assert.equal(STATIC_PUBLISH_FILES.includes('assets/runtime-config.js'), false);
	const notices = readFileSync(path.join(root, 'THIRD_PARTY_LICENSES.txt'), 'utf8');
	assert.match(notices, /Copyright \(c\) 2026 Lucide Icons and Contributors/u);
	assert.match(notices, /Copyright \(c\) 2013-present Cole Bemis/u);
	assert.match(notices, /Copyright \(c\) 2016-2025 \[Svelte Contributors\]/u);
	assert.match(notices, /Copyright \(c\) 2020 \[these people\]/u);
	assert.match(notices, /Copyright \(c\) 2026 Wornpage/u);
});

test('Svelte prerender validates one static adapter and no server output', () => {
	const config = readFileSync(path.join(root, 'svelte-frontend', 'svelte.config.js'), 'utf8');
	const build = readFileSync(path.join(root, 'scripts', 'build-svelte-frontend.mjs'), 'utf8');
	const staticPublish = readFileSync(path.join(root, 'scripts', 'build-static-publish.mjs'), 'utf8');
	assert.match(config, /nebius-static-adapter/u);
	assert.match(config, /builder\.writeClient\(output\)/u);
	assert.match(config, /builder\.writePrerendered\(output\)/u);
	assert.doesNotMatch(config, /writeServer|cloudflare|worker\/index/iu);
	assert.match(build, /buildStaticPublish\(stagedPublicDir\)/u);
	assert.match(build, /PROJECTS_SVELTE_ASSET_DIR: stagedPublicDir/u);
	assert.match(build, /async function buildSvelteFrontend\(args\)[\s\S]*?spawnSync\(process\.execPath, \[viteCli, 'build', \.\.\.args\]/u);
	assert.match(build, /await buildSvelteFrontend\(process\.argv\.slice\(2\)\);/u);
	assert.doesNotMatch(build, /export async function buildSvelteFrontend|args = process\.argv/u);
	assert.match(staticPublish, /export async function buildStaticPublish\(outputDir\)/u);
	assert.doesNotMatch(staticPublish, /^#!|isMainModule|process\.argv|Built static input/mu);
});



test('built artifact exposes the Nebius screens and saved-link routes', () => {
  const expectedHtml = ['404.html','grounding-rehearsal.html','guide.html','index.html','landing.html','next.html','priority.html','recovery-rehearsal.html','review.html','webmcp-challenge.html','work.html'];
  assert.deepEqual(readdirSync(artifactRoot).filter(name => name.endsWith('.html')).sort(), expectedHtml);
  assert.equal(readFileSync(path.join(artifactRoot,'index.html'),'utf8'),readFileSync(path.join(artifactRoot,'landing.html'),'utf8'));
  assert.equal(existsSync(path.join(artifactRoot,'_worker.js')),false);
  assert.equal(existsSync(path.join(artifactRoot,'functions')),false);
  assert.equal(collectFiles(artifactRoot).some(file => file.endsWith('.map')),false);
  const headers=readFileSync(path.join(artifactRoot,'_headers'),'utf8');
  assert.doesNotMatch(headers,/__PROJECTS_SVELTE_SCRIPT_HASHES__|script-src[^;]*'unsafe-inline'/u);
  assert.ok(headers.includes("form-action 'self'"));
  assert.ok(headers.includes('Referrer-Policy: same-origin'));
  for(const name of expectedHtml) for(const body of collectInlineScriptBodies(readFileSync(path.join(artifactRoot,name),'utf8'))) {
    assert.ok(headers.includes("'sha256-"+createHash('sha256').update(body,'utf8').digest('base64')+"'"));
  }
  for(const name of ['priority.html','review.html','guide.html','webmcp-challenge.html']) {
    const html=readFileSync(path.join(artifactRoot,name),'utf8');
    assert.match(html,/Opening the current page/u);
    assert.doesNotMatch(html,/data-agent-brief-input|challenge-guide-rail|data-review-card|data-priority-next-recommendation/u);
  }
  const privateRoutePattern = deniedRuntimePatterns[1];
  for (const route of ['"/activity"', "'/settings?tab=profile'", '`/memory/${id}`']) {
    assert.match(route, privateRoutePattern, 'private application routes remain forbidden');
  }
  assert.doesNotMatch('"/_app/immutable/assets/activity.CSseBKfJ.css"', privateRoutePattern, 'a generated asset basename is not an application route');
  for(const pattern of deniedRuntimePatterns) assert.doesNotMatch(collectText(artifactRoot).join('\n'),pattern);
});
