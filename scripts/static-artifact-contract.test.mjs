import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { STATIC_PUBLISH_FILES, SVELTE_PUBLIC_FILES } from './build-static-publish.mjs';
import { collectInlineScriptBodies } from './inline-script-bodies.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(root, 'dist', 'static-publish');
const deniedRuntimePatterns = [
	/projectsdemo\.org/u,
	/\/api\//u,
	/\/(?:about|achievements|activity|adopt|agents|authorize|billing|blocked|calendar|catalog|changelog|compare|create|decisions|design|export|gantt|guide|heartbeat|home|inbox|insights|login|mcp-tools|memory|more|notifications|pack|profile|scenarios|search|settings|team|templates)(?:\/|\b)/u,
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
	return collectFiles(directory)
		.filter((file) => /\.(?:css|html|js|json|svg|txt)$/u.test(file))
		.map((file) => readFileSync(file, 'utf8'));
}

function collectCss(directory) {
	return collectFiles(directory)
		.filter((file) => file.endsWith('.css'))
		.map((file) => readFileSync(file, 'utf8'))
		.join('\n');
}

function getAttribute(element, name) {
	const match = element.match(new RegExp(`\\b${name}="([^"]*)"`, 'u'));
	return match?.[1] ?? null;
}

test('inline script extraction follows HTML parsing semantics', () => {
	assert.deepEqual(
		collectInlineScriptBodies(
			'<SCRIPT nonce="one">window.bootstrap = "<tag>";</SCRIPT foo="ignored"><script SRC="app.js">ignored()</script><script>  </script>'
		),
		['window.bootstrap = "<tag>";']
	);
});

function countTopLevelTests(source) {
	return source.match(/^test\(/gmu)?.length ?? 0;
}

function findCssBlocks(css, atRuleName) {
	const blocks = [];
	let searchFrom = 0;
	while (searchFrom < css.length) {
		const atRuleIndex = css.indexOf(`@${atRuleName}`, searchFrom);
		if (atRuleIndex === -1) break;
		const openBrace = css.indexOf('{', atRuleIndex);
		assert.notEqual(openBrace, -1, `built CSS opens @${atRuleName}`);
		let depth = 1;
		let closeBrace = openBrace + 1;
		for (; closeBrace < css.length && depth > 0; closeBrace += 1) {
			if (css[closeBrace] === '{') depth += 1;
			if (css[closeBrace] === '}') depth -= 1;
		}
		assert.equal(depth, 0, `built CSS closes @${atRuleName}`);
		blocks.push({
			prelude: css.slice(atRuleIndex + atRuleName.length + 1, openBrace).trim(),
			body: css.slice(openBrace + 1, closeBrace - 1)
		});
		searchFrom = closeBrace;
	}
	return blocks;
}

function isCompactWidthMedia(prelude) {
	const upperBounds = [
		...[...prelude.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gu)].map((match) => Number(match[1])),
		...[...prelude.matchAll(/width\s*<=\s*(\d+(?:\.\d+)?)px/gu)].map((match) => Number(match[1]))
	];
	return upperBounds.some((upperBound) => upperBound <= 700);
}

function parseCssRules(css) {
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
		selectors: match[1].split(',').map((selector) => selector.trim()),
		declarations: new Map(
			match[2]
				.split(';')
				.filter(Boolean)
				.map((declaration) => {
					const colon = declaration.indexOf(':');
					return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
				})
		)
	}));
}

function findRule(rules, selectorPattern) {
	const rule = rules.find(({ selectors }) => selectors.some((selector) => selectorPattern.test(selector)));
	assert.ok(rule, `built CSS contains a rule matching ${selectorPattern}`);
	return rule;
}

test('preserved WebMCP documentation denominators match the current manifest and contract sources', () => {
	const readme = readFileSync(path.join(root, 'WEBMCP_BASELINE.md'), 'utf8');
	const entry = readFileSync(path.join(root, 'README.md'), 'utf8');
	assert.match(entry, /^# Wornpage Projects — Nebius edition/mu);
	assert.match(entry, /## Run without credentials[\s\S]*?npm ci --ignore-scripts[\s\S]*?npm --prefix svelte-frontend ci --ignore-scripts[\s\S]*?npm run dev:nebius/u);
	assert.match(entry, /\[Preserved WebMCP documentation\]\(WEBMCP_BASELINE\.md\)/u);
	assert.doesNotMatch(entry, /^Live submission:/mu);
	const manifestCount = readFileSync(path.join(root, 'PUBLIC_SOURCE_MANIFEST.txt'), 'utf8')
		.trim()
		.split(/\r?\n/u).length;
	const webMcpContractCount = readdirSync(path.join(root, 'tests'))
		.filter((name) => name.includes('webmcp') && name.endsWith('.test.mjs'))
		.reduce(
			(total, name) =>
				total + countTopLevelTests(readFileSync(path.join(root, 'tests', name), 'utf8')),
			0
		);
	const artifactContractCount = countTopLevelTests(
		readFileSync(path.join(root, 'scripts', 'static-artifact-contract.test.mjs'), 'utf8')
	);
	const recordingPreflightContractCount = countTopLevelTests(
		readFileSync(path.join(root, 'scripts', 'webmcp-recording-preflight-contract.test.mjs'), 'utf8')
	);

	assert.match(
		readme,
		new RegExp(
			`Current expected denominators are ${manifestCount}/${manifestCount} source inventory paths, ${webMcpContractCount}/${webMcpContractCount} WebMCP contracts, ${recordingPreflightContractCount}/${recordingPreflightContractCount} recording-preflight contracts, and ${artifactContractCount}/${artifactContractCount} static-artifact contracts\\.`,
			'u'
		)
	);
	assert.ok(entry.includes(`The current source inventory contains ${manifestCount}/${manifestCount} paths.`));
	assert.match(readme, /npm run preflight:recording[\s\S]*?installed Google Chrome[\s\S]*?CHROME_EXECUTABLE_PATH[\s\S]*?temporary isolated profile[\s\S]*?test-only native registration probe[\s\S]*?does not modify the deployed UI or the normal Chrome profile/u);
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
	assert.match(policy, /public MIT-licensed release during submission\nweek/u);
	assert.match(policy, /publication separately authorized by the owner/u);
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
		assert.ok(existsSync(path.join(root, file)), `${file} exists`);
	}
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
	assert.match(config, /webmcp-challenge-static-adapter/u);
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

test('static mode identifies its bounded routes without production fallbacks', () => {
	const landing = readFileSync(path.join(root, 'landing.html'), 'utf8');
	const landingScript = readFileSync(path.join(root, 'assets', 'landing.js'), 'utf8');
	const landingCss = readFileSync(path.join(root, 'assets', 'landing.css'), 'utf8');
	const demoCss = readFileSync(path.join(root, 'assets', 'demo.css'), 'utf8');
	const app = readFileSync(path.join(root, 'svelte-frontend', 'src', 'app.html'), 'utf8');
	const headers = readFileSync(path.join(root, 'svelte-frontend', 'static', '_headers'), 'utf8');
	const submissionReadme = readFileSync(path.join(root, 'docs', 'submission', 'webmcp', 'README.md'), 'utf8');
	const recordingScript = readFileSync(path.join(root, 'docs', 'submission', 'webmcp', 'chrome-recording-script.md'), 'utf8');
	const reviewerTests = readFileSync(path.join(root, 'docs', 'submission', 'webmcp', 'reviewer-tests.md'), 'utf8');
	const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
	const rootLock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
	const publicManifest = readFileSync(path.join(root, 'PUBLIC_SOURCE_MANIFEST.txt'), 'utf8').trim().split(/\r?\n/u);
	const thirdPartyNotices = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
	const browserAgentPath = reviewerTests.match(/## Browser-agent path[\s\S]*?## Security and scope checks/u)?.[0] ?? '';
	for (const html of [landing, app]) {
		assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive"/u);
	}
	assert.match(landing, /href="\/work"/u);
	assert.match(landing, /href="assets\/landing\.css"/u);
	assert.doesNotMatch(landing, /href="assets\/demo\.css"/u);
	assert.match(landing, /lp-pill lp-pill-warn[\s\S]*?lp-pill lp-pill-accent[\s\S]*?lp-pill lp-pill-muted/u);
	assert.match(landingCss, /\.lp-pill\s*\{[\s\S]*?\.lp-pill-warn[\s\S]*?\.lp-pill-accent[\s\S]*?\.lp-pill-muted/u);
	assert.doesNotMatch(demoCss, /\.lp-pill/u);
	assert.match(landing, /href="\/review\?tour=landing"/u);
	assert.match(landing, /<a class="lp-skip" href="#main-content">Skip to main content<\/a>/u);
	assert.match(landing, /<main id="main-content" tabindex="-1">/u);
	assert.match(landing, /Let an agent find the next move\. Keep the final say\./u);
	assert.match(landing, /No automatic starts/u);
	assert.match(landing, /Open the handoff workflow/u);
	assert.match(landing, /<span class="lp-insight-value">9<\/span>[\s\S]*?<strong>Route-owned tools<\/strong>/u);
	assert.match(landing, /<span class="lp-insight-value">4<\/span>[\s\S]*?<strong>Bounded page actions<\/strong>[\s\S]*?search, scope, Draft creation, and unsaved preparation/u);
	assert.doesNotMatch(landing, /Reversible page actions/u);
	assert.match(landing, /Press play — four steps, about ten seconds/u);
	assert.match(landingScript, /function advance\(wrap\)[\s\S]*?if \(index >= steps\.length - 1\)[\s\S]*?if \(wrap === false\) \{ pause\(\); return; \}[\s\S]*?selectStep\(0\)[\s\S]*?selectStep\(index \+ 1\)/u);
	assert.match(landingScript, /advance\(true\);[\s\S]*?setInterval\(function \(\) \{ advance\(false\); \}, STEP_MS\)/u);
	assert.match(landingScript, /if \(reduced\)[\s\S]*?advance\(true\); \/\/ wraps: 1 → 2 → 3 → 4 → 1/u);
	assert.doesNotMatch(landingScript, /selectStep\(\(index \+ 1\) % steps\.length\)/u);
	assert.match(landing, /Public static sample, no login, no backend, and five focused workflow pages/u);
	assert.match(landing, /WebMCP can add at most three browser-local Draft items at once; only visible human controls can Start work or approve a final Save/u);
	assert.doesNotMatch(landing, /judge|contest|garage reset|recording/iu);
	assert.doesNotMatch(`${landing}\n${app}`, /projectsdemo\.org|\/agents|\/billing/u);
	assert.match(app, /<div class="sveltekit-body">%sveltekit\.body%<\/div>/u);
	assert.doesNotMatch(app, /\sstyle=/u);
	assert.match(demoCss, /\.sveltekit-body\s*\{\s*display: contents;\s*\}/u);
	assert.equal(headers.match(/Content-Security-Policy:/gu)?.length, 1);
	assert.match(headers, /\/\*[\s\S]*?Content-Security-Policy: default-src 'self';[\s\S]*?script-src 'self' __PROJECTS_SVELTE_SCRIPT_HASHES__; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline';[\s\S]*?connect-src 'self'/u);
	assert.match(submissionReadme, /\[chrome-recording-script\.md\]\(chrome-recording-script\.md\)/u);
	assert.match(submissionReadme, /npm run preflight:recording[\s\S]*?temporary isolated Chrome profile[\s\S]*?focused contract deep-compares the human instructions with the frozen executable specification/u);
	assert.equal(rootPackage.scripts['preflight:recording'], 'node scripts/webmcp-recording-preflight.mjs');
	assert.equal(rootPackage.scripts['test:artifact'], 'node --test scripts/webmcp-recording-preflight-contract.test.mjs scripts/static-artifact-contract.test.mjs');
	assert.equal(rootPackage.devDependencies['playwright-core'], '1.62.1');
	assert.equal(rootLock.packages[''].devDependencies['playwright-core'], '1.62.1');
	assert.equal(rootLock.packages['node_modules/playwright-core'].version, '1.62.1');
	assert.equal(rootLock.packages['node_modules/playwright-core'].dev, true);
	assert.equal(rootLock.packages['node_modules/playwright-core'].license, 'Apache-2.0');
	for (const sourcePath of ['scripts/webmcp-recording-preflight.mjs', 'scripts/webmcp-recording-preflight-contract.test.mjs']) {
		assert.ok(publicManifest.includes(sourcePath), `${sourcePath} is in the source inventory`);
		assert.ok(existsSync(path.join(root, sourcePath)), `${sourcePath} exists`);
	}
	assert.match(thirdPartyNotices, /Playwright Core is used only by the isolated local recording-preflight command and is Apache-2\.0-licensed\. It is not bundled into the deployed browser artifact\./u);
	assert.match(recordingScript, /Target final length: \*\*1:50\*\*\. Hard stop: \*\*2:00\*\*[\s\S]*?one continuous Google Chrome clip[\s\S]*?Do not speed up footage/u);
	assert.match(recordingScript, /Put the captured tab in Chrome fullscreen so the browser toolbar is hidden[\s\S]*?Keep the laptop's native fullscreen Chrome viewport; do not apply a viewport override[\s\S]*?require zero horizontal overflow before T0/u);
	assert.match(recordingScript, /Codex browser control launches Chrome fullscreen[\s\S]*?suppresses the Playwright automation infobar[\s\S]*?requires the toolbar-hidden viewport to remain stable before T0[\s\S]*?observes—but does not override—that native viewport/u);
	assert.match(recordingScript, /Park the pointer in the bottom-right corner before T0 and leave it there for the entire clip/u);
	assert.match(recordingScript, /Every timed route change uses real Tab or Shift\+Tab focus movement[\s\S]*?Work and Guide remain direct header links[\s\S]*?Priority, Review, and Next are selected through the visible \*\*Tools\*\* dialog[\s\S]*?final pending proposal is selected through \*\*Pending 1\*\* and \*\*Review on Next\*\*[\s\S]*?trigger and destination is activated with Enter[\s\S]*?Do not click route links, use full-document `goto`, address-bar navigation, browser Back, pointer activation, retry a transition/u);
	assert.match(recordingScript, /Vertical reveals are keyboard-only and body-owned[\s\S]*?Guide uses one PageDown[\s\S]*?prepared Next hold uses four ArrowDown presses[\s\S]*?restored final Next hold uses eight ArrowDown presses[\s\S]*?native fullscreen viewport[\s\S]*?pointer stays parked[\s\S]*?do not use the wheel or drag a scrollbar/u);
	assert.doesNotMatch(recordingScript, /Guide and Next both send PageDown|Next keeps PageDown on its focused receipt/u);
	assert.match(recordingScript, /Visible focus is required when each presentation-changing or Draft-creation WebMCP receipt first appears[\s\S]*?Guide reader must return the exact brief and render its read-only receipt[\s\S]*?does not invent an action-focus promise[\s\S]*?Only after an action receipt's focus proof may the page body own the reveal keys[\s\S]*?action receipt and controls remaining simultaneously visible[\s\S]*?not on claiming the receipt retained focus during the scroll/u);
	assert.match(recordingScript, /fixed \*\*2\.25-second settle window\*\*/u);
	assert.match(recordingScript, /Work-first navigation calibration \(September 4, 2026\)[\s\S]*?application commit `4b9630e`[\s\S]*?fullscreen Google Chrome inner viewport 1116 × 698[\s\S]*?document client viewport 1101 × 698 and scroll width 1101[\s\S]*?Guide → \*\*Tools\*\* → Priority[\s\S]*?Work → \*\*Tools\*\* → Review[\s\S]*?Review → \*\*Tools\*\* → Next[\s\S]*?Work → \*\*Pending 1\*\* → \*\*Review on Next\*\*[\s\S]*?application-only calibration proves focus topology[\s\S]*?does not replace the fresh fullscreen production-Chrome preflight/u);
	assert.match(recordingScript, /preflight requires stable focus across two consecutive rendered frames after every exact Tab or Shift\+Tab press, including the body-owned focus reclaims[\s\S]*?After each settled key, it aborts if the declared destination arrives before the declared count[\s\S]*?requires the declared count and destination[\s\S]*?never searches for an alternate target/u);
	assert.match(recordingScript, /After the Guide reader inserts its receipt[\s\S]*?one body-owned Tab[\s\S]*?nine additional Tabs to reach \*\*Work\*\*/u);
	assert.match(recordingScript, /Landing → Guide: press Tab on the page body to reclaim focus[\s\S]*?five additional Tab presses to reach \*\*Open the handoff workflow\*\*[\s\S]*?any earlier or later destination fails the take[\s\S]*?Guide → Priority: five Tab presses to reach \*\*Tools\*\*[\s\S]*?two Tab presses in the dialog reach \*\*Priority\*\*[\s\S]*?Priority → Guide: five Shift\+Tab presses[\s\S]*?Returned Guide → fast brief: five Shift\+Tab presses[\s\S]*?Fast brief → Work: press Tab once on the page body to reclaim page focus[\s\S]*?nine additional Tab presses to reach \*\*Work\*\*[\s\S]*?any earlier or later destination fails the take[\s\S]*?Work receipt → Review: eleven Shift\+Tab presses to reach \*\*Tools\*\*[\s\S]*?three Tab presses in the dialog reach \*\*Review\*\*[\s\S]*?Review receipt → Next: three Shift\+Tab presses to reach \*\*Tools\*\*[\s\S]*?four Tab presses in the dialog reach \*\*Next\*\*[\s\S]*?Prepared Next receipt → Work: five Shift\+Tab presses[\s\S]*?Work Draft receipt → pending decision: thirteen Shift\+Tab presses to reach \*\*Pending 1\*\*[\s\S]*?two Tab presses in the dialog reach \*\*Review on Next\*\*[\s\S]*?upper view must first show the counted scope[\s\S]*?one PageDown pressed on the page body must then reveal brief `Use the WebMCP tools on Work, Review, and Next[\s\S]*?Do not save or change workspace data\.` and `Use fast-create brief` control, both fully visible[\s\S]*?Next: four ArrowDown presses on the page body must keep the prepared WebMCP receipt fully visible[\s\S]*?Pending 1[\s\S]*?eight ArrowDown presses[\s\S]*?Opening Guide frame:[\s\S]*?tool `WebMCP 1 tool`[\s\S]*?pill is ready only after Guide registration/u);
	assert.doesNotMatch(recordingScript, /advance visibly with Tab until \*\*Open the handoff workflow\*\*|within five additional moves|Guide → Priority: four Tab presses|Priority → Guide: seven Shift\+Tab presses|Returned Guide → fast brief: three Shift\+Tab presses|then use (?:five|ten) additional Tabs to reach \*\*1 Work\*\*|Work receipt → Review: seven Shift\+Tab presses|Review receipt → Next: three Shift\+Tab presses, then Enter on \*\*3 Next\*\*|Prepared Next receipt → Work:[^\n]*?\*\*1 Work\*\*|Work Draft receipt → pending decision: ten Shift\+Tab presses/u);
	assert.match(recordingScript, /Opening Guide frame: scope `8 visible of 8 workspace`; trail `Ready for one bounded run` \/ `No agent action recorded\.` \/ `No action recorded` \/ `0 verified actions, 0 pending`; tool `WebMCP 1 tool`; no Pending navigation and no action receipt[\s\S]*?shared trail advances from 1 verified → 2 verified → 3 verified \+ 1 pending → 4 verified \+ 1 pending[\s\S]*?Drafts appear only after the optional create call[\s\S]*?Decide remains pending/u);
	assert.match(recordingScript, /Priority hold: title `Garden study: log interviews`; reason `Due in 6 days · No blocker or pending decision\.`; Work ID `garden-study-log-interviews`; destination `\/next\?pack=garden-study-log-interviews`; action `Open next action`; entire recommendation fully visible\./u);
	assert.match(recordingScript, /Work hold: complete `Step 1 · Narrow Work` \/ `WebMCP · show_work_search` receipt fully visible with `Work search updated for “Garage reset”\.`, `“Garage reset”`, `4 shown · 4 matching · 8 workspace`, `2 blocked in the matching work`, `Visible search updated · Not saved`, and `Page view only · Workspace unchanged`\./u);
	assert.match(recordingScript, /Review hold: complete `Step 2 · Verify Review` \/ `WebMCP · set_review_scope` receipt fully visible with `Review scope updated: “Garage reset” · Blocked\.`, `“Garage reset” · Blocked`, `2 shown · 2 filtered · 3 search matches · 5 total review`, `2 blocked · 0 missing next · 0 missing owner`, `Visible queue updated · Not saved`, and `Page view only · Workspace unchanged`\./u);
	assert.match(recordingScript, /Next hold: complete `Step 3 · Prepare Next` \/ `WebMCP · prepare_next_action` receipt fully visible with `Draft prepared — waiting for your approval\.`, `Garage reset: sort shelves — Workflow: Blocked\. Garage reset: sort shelves — Blocker: Waiting on storage bins\.`, `Draft — waiting for your approval`, `Not saved`, and `Unsaved proposal · Human approval required`\./u);
	assert.match(recordingScript, /Draft hold: complete `Step 4 · Stage Drafts` \/ `WebMCP · create_work_drafts` receipt fully visible with `3 draft work items created for human review\.`, `3 · Draft`, `Confirm donation pickup window · Print shelf labels · Prepare bike rack checklist`, `8 → 11`, `No work started · Human Start required`, and `Draft only · Human Start required`\./u);
	assert.match(recordingScript, /Final restored receipt must repeat the exact Step 3 Next presenter contract after Pending navigation and the eight-arrow reveal; visibility alone is not sufficient\./u);
	assert.match(recordingScript, /Landing hold: headline `Let an agent find the next move\. Keep the final say\.`; lede `Browser workers read and narrow the same work you see, can add bounded Draft items, then prepare an unsaved next action for you to approve\.`; facts `No backend` and `No automatic starts`; action `Open the handoff workflow →`; preview `WebMCP handoff in Review: the agent narrows visible work, explains a blocker, and prepares a next action for human approval\.`; both hero columns fully visible before T0\./u);
	assert.match(recordingScript, /does not assume a Chrome browser-agent side panel[\s\S]*?Codex controller instruction: `Follow the brief on this page\.`[\s\S]*?No prompt is typed in Chrome during the take[\s\S]*?document\.modelContext\.getTools\(\)[\s\S]*?document\.modelContext\.executeTool\(\.\.\.\)[\s\S]*?native descriptors returned for the current page[\s\S]*?never substitutes a DOM\/state shortcut, direct workspace API, server request, or second mutation path/u);
	assert.match(recordingScript, /Exact bounded inputs: Work\/Review query `Garage reset`; Review filter `blocked`; Next choice `Confirm storage bin delivery`/u);
	assert.match(recordingScript, /Executable target timeline: `landing-hold@00:00\.000` → `landing-to-guide@00:06\.000` → `guide-body-page-down@00:12\.000` → `guide-to-priority@00:18\.000` → `priority-to-guide@00:25\.000` → `guide-to-work@00:30\.000` → `work-to-review@00:46\.000` → `review-to-next@01:00\.000` → `next-body-arrow-downs@01:10\.000` → `next-to-work@01:18\.000` → `create-drafts@01:26\.000` → `work-to-pending@01:36\.000` → `final-body-arrow-downs@01:43\.000` → `final-acceptance@01:49\.500`/u);
	assert.doesNotMatch(recordingScript, /Side-panel instruction|side-panel agent owns/u);
	assert.equal((recordingScript.match(/side[- ]panel/giu) ?? []).length, 1, 'only the explicit no-side-panel statement may remain');
	assert.doesNotMatch(recordingScript, /AGENT_SHORTCUT|replace this|placeholder/iu);
	assert.match(recordingScript, /do not load it before navigating away because this page-local state does not survive Guide → Priority → Guide/u);
	const recordingIntervals = [...recordingScript.matchAll(/^\| (\d{2}:\d{2}–\d{2}:\d{2}) \|/gmu)].map((match) => match[1]);
	assert.deepEqual(recordingIntervals, [
		'00:00–00:06',
		'00:06–00:18',
		'00:18–00:25',
		'00:25–00:30',
		'00:30–00:46',
		'00:46–01:00',
		'01:00–01:18',
		'01:18–01:26',
		'01:26–01:36',
		'01:36–01:50'
	]);
	assert.match(recordingScript, /\| 00:25–00:30 \|[\s\S]*?let Codex invoke the registered Guide reader and follow the returned brief[\s\S]*?\| 01:00–01:18 \| Use three Shift\+Tab presses to open \*\*Tools\*\*, then four Tab presses to open Next[\s\S]*?hold the receipt, then send ArrowDown to the page body four times at 01:10[\s\S]*?\| 01:18–01:26 \| Use five Shift\+Tab presses to return to Work[\s\S]*?\| 01:36–01:50 \| Use thirteen Shift\+Tab presses and Enter on \*\*Pending 1\*\*, then two Tab presses and Enter on \*\*Review on Next\*\*[\s\S]*?hold the restored receipt, then send ArrowDown to the page body eight times at 01:43/u);
	assert.doesNotMatch(recordingScript, /\| 00:00–00:06 \|[^\n]*?9 tools; 4 bounded actions/u);
	assert.doesNotMatch(recordingScript, /\| 00:25–00:30 \|[^\n]*?side-panel reader|\| 01:00–01:18 \| Use one Shift\+Tab|\| 01:18–01:26 \| Use four Shift\+Tab|\| 01:36–01:50 \| Use nine Shift\+Tab/u);
	assert.match(recordingScript, /show_work_search[\s\S]*?set_review_scope[\s\S]*?prepare_next_action[\s\S]*?get_current_work_view[\s\S]*?one `create_work_drafts` call/u);
	assert.match(recordingScript, /Confirm donation pickup window[\s\S]*?Print shelf labels[\s\S]*?Prepare bike rack checklist[\s\S]*?`3 · Draft`[\s\S]*?`8 → 11`[\s\S]*?Human Start required/u);
	assert.match(recordingScript, /Review the proposed next action[\s\S]*?Draft: pending approval[\s\S]*?unchanged Next proposal[\s\S]*?human-only final Save[\s\S]*?Discard draft[\s\S]*?Approve and save[\s\S]*?Stop the recorder at 01:50 on the human approval frame/u);
	assert.match(recordingScript, /press PageDown on the page body at 00:12[\s\S]*?send ArrowDown to the page body four times at 01:10[\s\S]*?send ArrowDown to the page body eight times at 01:43[\s\S]*?final viewport shows the preserved receipt/u);
	assert.match(recordingScript, /## Post-capture cleanup and edit[\s\S]*?same Chrome profile[\s\S]*?pending Next proposal and all three recording Drafts are absent[\s\S]*?Trim only the four-second setup pad[\s\S]*?Do not add a route cut/u);
	assert.match(recordingScript, /Abort the take immediately[\s\S]*?Focus is not visible[\s\S]*?CSP violation[\s\S]*?horizontal overflow/u);
	assert.doesNotMatch(recordingScript, /in-app browser|hybrid|hard cut at 02:05/iu);
	assert.match(browserAgentPath, /Use fast-create brief[\s\S]*?453-character brief[\s\S]*?forbid Save\/Start\/block\/completion\/deletion[\s\S]*?Reset[\s\S]*?original no-workspace-change brief/u);
	assert.match(browserAgentPath, /Discover exactly `get_current_work_view`, `show_work_search`, and `create_work_drafts`\./u);
	assert.match(browserAgentPath, /create_work_drafts[\s\S]*?one atomic `8 → 11` receipt[\s\S]*?three visible human \*\*Start\*\* controls[\s\S]*?stale count `8`[\s\S]*?duplicate-title rejection[\s\S]*?Reset live sample[\s\S]*?exact original 8-item workspace/u);
	assert.doesNotMatch(browserAgentPath, /Discover `get_current_work_view` and `show_work_search` only/u);
	assert.match(headers, /X-Content-Type-Options: nosniff/u);
	assert.match(headers, /X-Robots-Tag: noindex, nofollow, noarchive/u);
});

test('built artifact exposes exactly the intended HTML routes and no executable edge path', () => {
	const expectedHtml = [
		'404.html',
		'index.html',
		'landing.html',
		'next.html',
		'priority.html',
		'review.html',
		'webmcp-challenge.html',
		'work.html'
	];
	const actualHtml = readdirSync(artifactRoot)
		.filter((name) => name.endsWith('.html'))
		.sort((left, right) => left.localeCompare(right));
	assert.deepEqual(actualHtml, expectedHtml);
	assert.equal(
		readFileSync(path.join(artifactRoot, 'index.html'), 'utf8'),
		readFileSync(path.join(artifactRoot, 'landing.html'), 'utf8'),
		'canonical root and landing alias share one HTML source'
	);
	assert.equal(existsSync(path.join(artifactRoot, '_worker.js')), false);
	assert.equal(existsSync(path.join(artifactRoot, 'functions')), false);
	assert.equal(collectFiles(artifactRoot).some((file) => file.endsWith('.map')), false);
	assert.ok(existsSync(path.join(artifactRoot, 'THIRD_PARTY_LICENSES.txt')));
	const builtHeaders = readFileSync(path.join(artifactRoot, '_headers'), 'utf8');
	assert.doesNotMatch(builtHeaders, /__PROJECTS_SVELTE_SCRIPT_HASHES__|script-src[^;]*'unsafe-inline'/u);
	const inlineScriptHashes = new Set();
	for (const name of actualHtml) {
		const html = readFileSync(path.join(artifactRoot, name), 'utf8');
		for (const body of collectInlineScriptBodies(html)) {
			inlineScriptHashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
		}
	}
	assert.ok(inlineScriptHashes.size > 0, 'built Svelte routes contain bootstrap scripts to hash');
	for (const hash of inlineScriptHashes) assert.ok(builtHeaders.includes(hash), `built CSP includes ${hash}`);
	const notFoundHtml = readFileSync(path.join(artifactRoot, '404.html'), 'utf8');
	assert.match(notFoundHtml, /<meta name="robots" content="noindex,nofollow,noarchive"/u);
	assert.match(notFoundHtml, /<link rel="stylesheet" href="\/assets\/not-found\.css">/u);
	assert.doesNotMatch(notFoundHtml, /<style|\sstyle=/u);
	const artifactText = collectText(artifactRoot).join('\n');
	for (const route of ['webmcp-challenge.html', 'priority.html', 'work.html', 'review.html', 'next.html']) {
		const html = readFileSync(path.join(artifactRoot, route), 'utf8');
		const brand = html.match(/<a\b[^>]*\bclass="[^"]*\bchallenge-brand\b[^"]*"[^>]*>[\s\S]*?<\/a>/u)?.[0];
		assert.ok(brand, `${route} contains the interactive challenge-brand anchor`);
		assert.equal(getAttribute(brand, 'href'), '/landing.html', `${route} preserves the static landing route`);
		assert.equal(
			getAttribute(brand, 'aria-label'),
			'Wornpage Projects landing page',
			`${route} preserves the brand accessible name`
		);
		assert.match(brand, /<span[^>]*>Wornpage Projects<\/span>/u, `${route} preserves the visible brand name`);
	}
	const priorityHtml = readFileSync(path.join(artifactRoot, 'priority.html'), 'utf8');
	assert.match(priorityHtml, /Priority/u);
	assert.match(priorityHtml, /aria-label="Loading"/u);
	assert.doesNotMatch(priorityHtml, /No actionable recommendation/u, 'prerender does not claim a false empty state before browser hydration');
	const guideHtml = readFileSync(path.join(artifactRoot, 'webmcp-challenge.html'), 'utf8');
	assert.match(guideHtml, /data-agent-brief-input/u);
	assert.match(guideHtml, /data-agent-scope-chooser/u);
	assert.match(guideHtml, /challenge-guide-rail/u);
	assert.match(guideHtml, /<a href="\/work"[^>]*data-agent-scope-action-link[^>]*>.*?Open all 8 work items/u);
	assert.doesNotMatch(guideHtml, /8 matching of 8 workspace · All visible work/u);
	const railIndex = guideHtml.indexOf('challenge-guide-rail');
	const stepsIndex = guideHtml.indexOf('challenge-steps', railIndex);
	const editorIndex = guideHtml.indexOf('agent-brief-editor', railIndex);
	assert.ok(railIndex >= 0 && railIndex < stepsIndex && stepsIndex < editorIndex, 'built Guide keeps steps in the left rail before the editor');
	for (const href of ['/work', '/review', '/next']) {
		assert.match(guideHtml, new RegExp(`<a href="${href}"[^>]*>.*?(?:Start in Work|Continue to Review|Open the draft editor)`, 'u'));
	}
	assert.match(guideHtml, /maxlength="1000"/u);
	assert.doesNotMatch(guideHtml, /data-agent-work-query-input/u);
	assert.match(guideHtml, /All visible work is ready by default/u);
	assert.match(guideHtml, /Follow the brief on this page\./u);
	assert.match(guideHtml, /Agent · inspect \+ prepare/u);
	assert.match(guideHtml, /You · decide \+ save/u);
	assert.match(guideHtml, /data-agent-brief-fast-create[^>]*>.*?Use fast-create brief/u);
	assert.match(guideHtml, /Local draft · not saved · workspace unchanged/u);
	assert.match(guideHtml, /data-webmcp-status-pill/u);
	assert.doesNotMatch(guideHtml, /data-webmcp-guide-reader-status|Checking reader API…|Guide reader status/u);
	assert.match(guideHtml, /Authority boundary/u);
	assert.doesNotMatch(guideHtml, /Authority and browser status/u);
	assert.match(guideHtml, /create up to three Draft items through the bounded Work tool/u);
	assert.match(guideHtml, /control Start, final Save, blocking, completion, and deletion/u);
	assert.doesNotMatch(guideHtml, /approve, save, or discard every workspace change/u);
	assert.doesNotMatch(guideHtml, /challenge-facts|Projects workflow capabilities/u);
	assert.match(artifactText, /data-agent-work-query-input/u);
	assert.match(artifactText, /Custom Work search term \(optional\)/u);
	assert.match(artifactText, /an unmatched term stays at zero/u);
	assert.doesNotMatch(guideHtml, /A useful handoff, in order/u);

	const css = collectCss(artifactRoot);
	const rules = parseCssRules(css);
	assert.equal(rules.filter(({ declarations }) => declarations.size === 0).length, 0, 'built CSS contains no empty rules');
	const brandRule = findRule(rules, /^\.challenge-brand(?:\.[\w-]+)?$/u);
	assert.equal(brandRule.declarations.get('min-height'), '44px');
	assert.equal(brandRule.declarations.get('padding'), '0 var(--worn-space-3)');
	assert.equal(brandRule.declarations.get('min-width'), '0');

	const landingRules = parseCssRules(readFileSync(path.join(artifactRoot, 'assets', 'landing.css'), 'utf8'));
	const landingButtonRule = findRule(landingRules, /\.lp-btn$/u);
	assert.equal(landingButtonRule.declarations.get('min-height'), '44px');

	const brandTextRule = findRule(rules, /^\.challenge-brand(?:\.[\w-]+)? span(?::where\([^)]*\))?$/u);
	assert.equal(brandTextRule.declarations.get('overflow'), 'hidden');
	assert.equal(brandTextRule.declarations.get('text-overflow'), 'ellipsis');
	assert.equal(brandTextRule.declarations.get('white-space'), 'nowrap');

	const focusRule = findRule(rules, /^\.challenge-brand(?:\.[\w-]+)?:focus-visible$/u);
	assert.equal(focusRule.declarations.get('outline'), '2px solid var(--challenge-focus-mint)');
	assert.equal(focusRule.declarations.get('outline-offset'), '2px');

	const hoverRule = findRule(rules, /^\.challenge-brand(?:\.[\w-]+)?:hover$/u);
	assert.equal(hoverRule.declarations.get('background'), 'var(--worn-hover-bg)');

	const compiledSvelteCss = collectCss(path.join(artifactRoot, '_app', 'immutable', 'assets'));
	const compactMediaBlocks = findCssBlocks(compiledSvelteCss, 'media').filter(({ prelude }) =>
		isCompactWidthMedia(prelude)
	);
	assert.ok(compactMediaBlocks.length > 0, 'compiled Svelte CSS contains compact width media blocks');
	assert.ok(
		compactMediaBlocks.some(({ prelude }) => /\(width<=700px\)/u.test(prelude)),
		'compiled Svelte CSS contains the emitted @media (width<=700px) block'
	);
	const compactBrandGridPlacements = [];
	for (const { prelude, body } of compactMediaBlocks) {
		const compactBrandRules = parseCssRules(body).filter(({ selectors }) =>
			selectors.some(
				(selector) =>
					/^\.challenge-brand(?:\.[\w-]+)?$/u.test(selector) ||
					/^\.challenge-brand(?:\.[\w-]+)? span(?::where\([^)]*\))?$/u.test(selector)
			)
		);
		compactBrandGridPlacements.push(...compactBrandRules
			.filter(({ declarations }) => declarations.has('grid-area') || declarations.has('grid-column') || declarations.has('grid-row'))
			.map(({ declarations }) => ({
				gridArea: declarations.get('grid-area') ?? null,
				gridColumn: declarations.get('grid-column') ?? null,
				gridRow: declarations.get('grid-row') ?? null
			})));
		const compactBrandPresentationOverrides = compactBrandRules.filter(({ declarations }) =>
			['padding', 'padding-inline', 'overflow', 'text-overflow', 'white-space'].some((property) => declarations.has(property))
		);
		assert.deepEqual(
			compactBrandPresentationOverrides,
			[],
			`compact compiled Svelte CSS ${prelude} does not override challenge-brand padding or ellipsis containment`
		);
	}
	assert.deepEqual(
		compactBrandGridPlacements,
		[{ gridArea: '1/1', gridColumn: null, gridRow: null }],
		'compact compiled Svelte CSS keeps only the explicit challenge-brand grid placement'
	);
	for (const pattern of deniedRuntimePatterns) assert.doesNotMatch(artifactText, pattern);
});

test('built artifact keeps page-action receipts truthful and read-only getters silent', () => {
	const artifactText = collectText(artifactRoot).join('\n');
	for (const copy of [
		'Work search cleared to show all work.',
		'Current scope',
		'Visible search updated · Not saved',
		'Visible Review scope',
		'Current queue',
		'Search-match evidence',
		'Visible queue updated · Not saved',
		'Browser agent prepared an unsaved draft. No workspace data was saved.',
		'Verified evidence',
		'rejects stale or mismatched facts',
		'Draft — waiting for your approval',
		'Not saved'
	]) {
		assert.match(artifactText, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
	}
	assert.doesNotMatch(artifactText, /Unsaved draft shown in this editor only/u);
	assert.match(artifactText, /Reset live sample/u);
	assert.doesNotMatch(artifactText, /WebMCP read \d+ visible (?:Work|Review)/u);
	assert.doesNotMatch(artifactText, /WebMCP read the unsaved Next editor/u);
	assert.doesNotMatch(artifactText, /agentNote/u);
});

test('built Guide publishes exact default and discovered scope denominators', () => {
	const guideHtml = readFileSync(path.join(artifactRoot, 'webmcp-challenge.html'), 'utf8');
	assert.match(
		guideHtml,
		/data-agent-scope-chooser=""[^>]*data-workspace-count="8"[^>]*data-visible-count="8"[^>]*data-discovered-choice-count="2"[^>]*data-shown-choice-count="2"[^>]*data-omitted-choice-count="0"[^>]*data-selected-scope-id="all"[^>]*data-selected-scope-kind="all"[^>]*data-selected-work-query=""[^>]*data-selected-match-count="8"/u
	);
	assert.match(guideHtml, /8 visible of 8 workspace/u);
	assert.match(guideHtml, /data-scope-id="all"[^>]*data-scope-kind="all"[^>]*data-scope-match-count="8"[\s\S]*?All visible work · 8/u);
	assert.match(guideHtml, /data-scope-kind="derived"[^>]*data-scope-label="Household"[^>]*data-scope-query="Household"[^>]*data-scope-match-count="4"[\s\S]*?Household · 4/u);
	assert.match(guideHtml, /data-scope-kind="derived"[^>]*data-scope-label="Research"[^>]*data-scope-query="Research"[^>]*data-scope-match-count="4"[\s\S]*?Research · 4/u);
	assert.match(guideHtml, /data-scope-id="custom"[^>]*data-scope-kind="custom"[^>]*data-scope-label="Custom"[\s\S]*?Custom…/u);
	assert.match(guideHtml, /<a href="\/work"[^>]*data-agent-scope-action-link[^>]*>.*?Open all 8 work items/u);
	assert.doesNotMatch(guideHtml, /8 matching of 8 workspace · All visible work/u);
	assert.match(guideHtml, /aria-pressed="true"[\s\S]*?All visible work · 8/u);
});
