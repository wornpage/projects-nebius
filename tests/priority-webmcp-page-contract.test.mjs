import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routePath = path.join(repoRoot, 'svelte-frontend/src/routes/priority/+page.svelte');
const helperPath = path.join(repoRoot, 'svelte-frontend/src/routes/priority/priority-webmcp.mjs');
const rulesPath = path.join(repoRoot, 'svelte-frontend/src/lib/workflow-rules.mjs');
const rulesSource = fs.readFileSync(rulesPath, 'utf8');
const workflowSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/lib/demo-workflow.ts'), 'utf8');
const layoutSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/src/routes/+layout.svelte'), 'utf8');
const configSource = fs.readFileSync(path.join(repoRoot, 'svelte-frontend/svelte.config.js'), 'utf8');

async function loadPriorityModules() {
	assert.equal(fs.existsSync(routePath), true, 'Priority owns a current public route');
	assert.equal(fs.existsSync(helperPath), true, 'Priority owns its page-local WebMCP descriptor');
	return Promise.all([
		import(pathToFileURL(helperPath).href),
		import(pathToFileURL(rulesPath).href)
	]);
}

test('canonical recommendation selects only the highest-priority actionable work', async () => {
	assert.doesNotMatch(`${rulesSource}\n${workflowSource}`, /blockedByBlockerText/u);
	const [, { selectNextRecommendation }] = await loadPriorityModules();
	const packs = [
		{ id: 'blocked', title: 'Blocked', status: 'blocked', blocker: 'Waiting', due: '2026-08-20' },
		{ id: 'decision', title: 'Decision', status: 'active', blocker: 'none', decision: true, due: '2026-08-21' },
		{ id: 'done', title: 'Done', status: 'done', blocker: 'none', due: '2026-08-19' },
		{ id: 'draft', title: 'Draft', status: 'draft', blocker: 'none', due: '2026-08-18' },
		{ id: 'waiting', title: 'Waiting', status: 'active', blocker: 'none', blockedBy: 'unfinished', due: '2026-08-17' },
		{ id: 'later', title: 'Later', status: 'active', blocker: 'none', due: '2026-09-10' },
		{ id: 'urgent item', title: 'Urgent item', status: 'active', blocker: 'none', due: '2026-08-28' },
		{ id: 'unfinished', title: 'Unfinished dependency', status: 'draft', blocker: 'none' }
	];

	assert.deepEqual(selectNextRecommendation(packs, { todayIso: '2026-08-29' }), {
		id: 'urgent item',
		title: 'Urgent item',
		href: '/next?pack=urgent%20item',
		reason: 'Overdue by 1 day · No blocker or pending decision.'
	});
	assert.equal(selectNextRecommendation(packs.map((pack) => ({ ...pack, status: 'done' })), { todayIso: '2026-08-29' }), null);
});

test('Priority descriptor is narrow, truthful, clone-safe, and abort-aware', async () => {
	const [{ PRIORITY_RECOMMENDATION_TOOL_NAME, createPriorityRecommendationTool }] = await loadPriorityModules();
	const recommendation = {
		id: 'urgent item',
		title: 'Urgent item',
		href: '/next?pack=urgent%20item',
		reason: 'Overdue by 1 day · No blocker or pending decision.'
	};
	const tool = createPriorityRecommendationTool(() => recommendation);

	assert.equal(PRIORITY_RECOMMENDATION_TOOL_NAME, 'get_next_recommendation');
	assert.equal(tool.name, PRIORITY_RECOMMENDATION_TOOL_NAME);
	assert.equal(tool.title, 'Get next recommendation');
	assert.match(tool.description, /currently visible on Priority/u);
	assert.match(tool.description, /does not navigate, fetch, or write/u);
	assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
	assert.deepEqual(tool.annotations, {
		readOnlyHint: true,
		openWorldHint: false,
		untrustedContentHint: true
	});
	assert.deepEqual(await tool.execute({}), recommendation);
	assert.notEqual(await tool.execute({}), recommendation);
	await assert.rejects(tool.execute({ extra: true }), /empty object/u);
	await assert.rejects(tool.execute(null), /empty object/u);

	const controller = new AbortController();
	controller.abort();
	await assert.rejects(tool.execute({}, { signal: controller.signal }), /aborted/iu);
	assert.equal(await createPriorityRecommendationTool(() => null).execute({}), null);
	assert.throws(() => createPriorityRecommendationTool(null), /recommendation getter/u);
});

test('Priority owns one visible projection and one page-lifetime read-only registration', async () => {
	await loadPriorityModules();
	const routeSource = fs.readFileSync(routePath, 'utf8');

	assert.match(routeSource, /selectNextRecommendation\(packs\)/u);
	assert.match(routeSource, /createPriorityRecommendationTool\(\(\) => recommendation\)/u);
	assert.match(routeSource, /onMount\(\(\) => registerPageTools\(document, \[/u);
	assert.match(routeSource, /data-priority-next-recommendation/u);
	assert.match(routeSource, /\{recommendation\.title\}[\s\S]*?\{recommendation\.reason\}[\s\S]*?\{recommendation\.id\}[\s\S]*?\{recommendation\.href\}[\s\S]*?href=\{recommendation\.href\}/u);
	assert.equal([...routeSource.matchAll(/href=\{recommendation\.href\}/gu)].length, 1, 'Priority exposes one explicit destination focus stop');
	assert.match(routeSource, /<h2 id="priority-recommendation-title">\s*\{recommendation\.title\}\s*<\/h2>/u);
	assert.match(routeSource, /<dd class="priority-destination">\{recommendation\.href\}<\/dd>/u);
	assert.match(routeSource, /<WornButton href=\{recommendation\.href\} variant="primary">\{__NEBIUS_EDITION__ \? 'Open next step' : 'Open next action'\}<\/WornButton>/u);
	assert.match(routeSource, /loading=\{\$demoState === null \|\| \(\$demoStateLoading && packs\.length === 0\)\}/u);
	assert.match(routeSource, /\{:else if \$demoState !== null && !\$demoStateLoading && !\$demoStateError\}/u);
	assert.doesNotMatch(routeSource, /fetch\(|localStorage|sessionStorage|saveBrowserState|createPack|runPackAction|savePack|goto\(/u);
	assert.match(layoutSource, /href: '\/priority'[\s\S]*?label: 'Priority'/u);
	assert.match(configSource, /prerender: \{ entries: \[[^\]]*'\/priority'/u);
});
