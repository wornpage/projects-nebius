<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { WornAccordion, WornBadge, WornButton, WornDialog, WornPage, WornReceipt } from '$lib/components';
	import AgentBriefEditor from '$lib/AgentBriefEditor.svelte';
	import { ChallengeStateError, demoState, displayToast, exportWorkspaceState, importWorkspaceState, previewWorkspaceImport, resetDemoSampleState, type WorkspaceImportPreview } from '$lib/demo-client';
	import { filterPacks, type DemoPack } from '$lib/demo-workflow';
	import { registerPageTools } from '$lib/webmcp.mjs';
	import { resetWebMcpHandoffSession } from '$lib/webmcp-handoff-store';
	import seedPacks from '../../../../data/demo-packs.json';
	import nebiusSeedPacks from '../../../../data/nebius-demo-packs.json';
	import {
		PROJECTS_HANDOFF_GUIDE_TOOL_NAME,
		createWebMcpChallengeGuideTool,
		deriveGuideWorkScopeCatalog,
		readRenderedWebMcpChallengeGuide
	} from './webmcp-challenge-webmcp.mjs';

	const steps = [
		{
			title: 'Observe',
			description: 'On Work, read the visible items, priorities, and explicit counts.',
			action: 'Start in Work',
			href: '/work'
		},
		{
			title: 'Narrow',
			description: 'On Review, narrow the queue and surface the evidence behind each priority.',
			action: 'Continue to Review',
			href: '/review'
		},
		{
			title: 'Prepare',
			description: 'On Next, prepare a clear next action from exact workspace facts, then stop before Save.',
			action: 'Open the draft editor',
			href: '/next'
		}
	] as const;
	const safety = [
		'Agent: read the exact state currently rendered.',
		'Agent: change page-local scope, prepare an unsaved next action, or create up to three Draft items through the bounded Work tool.',
		'Person: control Start, final Save, blocking, completion, and deletion.'
	] as const;
	let webMcpGuideReceipt = $state<{
		summary: string;
		cells: Array<{ label: string; value: string }>;
	} | null>(null);
	let webMcpInvocationCount = $state(0);
	let resettingSample = $state(false);
	let selectedScopeId = $state('all');
	let workQuery = $state('');
	let guidePacks = $derived(($demoState?.packs ?? (__NEBIUS_EDITION__ ? nebiusSeedPacks : seedPacks)) as DemoPack[]);
	let guideVisiblePacks = $derived(filterPacks(guidePacks, 'all', ''));
	let guideScopeCatalog = $derived.by(() => deriveGuideWorkScopeCatalog(
		guidePacks.length,
		guideVisiblePacks,
		(query) => filterPacks(guidePacks, 'all', query).length
	));
	let selectedMatchingCount = $derived(filterPacks(guidePacks, 'all', workQuery).length);
	let importBusy = $state(false);
	let importReadGeneration = 0;
	let importPreview = $state<WorkspaceImportPreview | null>(null);
	let importError = $state('');
	let importInput = $state<HTMLInputElement | null>(null);
	let exportHref = $state('');
	let replaceConfirmOpen = $state(false);
	let resetConfirmOpen = $state(false);
	onDestroy(() => { importReadGeneration++; });

	function prepareWorkspaceExport() {
		if (exportHref) URL.revokeObjectURL(exportHref);
		exportHref = URL.createObjectURL(new Blob([exportWorkspaceState()], { type: 'application/json' }));
		displayToast('Workspace export is ready to download.', 'success');
	}

	async function selectWorkspaceFile(event: Event) {
		if (importBusy) return;
		const generation = ++importReadGeneration;
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		importPreview = null;
		importError = '';
		if (!file) return;
		try {
			const serialized = await file.text();
			if (generation !== importReadGeneration) return;
			importPreview = previewWorkspaceImport(serialized);
		} catch (error) {
			if (generation === importReadGeneration) importError = error instanceof Error ? error.message : 'The workspace export is invalid.';
		}
	}

	async function applyWorkspaceImport(mode: 'replace' | 'merge') {
		if (!importPreview || importBusy) return;
		importBusy = true;
		try {
			const result = await importWorkspaceState(importPreview.serialized, mode);
			displayToast(mode === 'replace' ? `Workspace replaced with ${result.packs} work items.` : `Workspace merged with ${result.packs} new work items${result.skipped ? ` (${result.skipped} existing skipped)` : ''}.`, 'success');
			importPreview = null;
			if (importInput) importInput.value = '';
		} catch (error) {
			importError = error instanceof Error ? error.message : 'The workspace could not be imported.';
		} finally {
			importBusy = false;
		}
	}

	function requestWorkspaceImport(mode: 'replace' | 'merge') {
		if (mode === 'replace') {
			replaceConfirmOpen = true;
			return;
		}
		void applyWorkspaceImport(mode);
	}

	async function resetLiveSample() {
		if (resettingSample) return;
		resettingSample = true;
		try {
			await resetDemoSampleState();
			resetWebMcpHandoffSession();
			displayToast('Live sample reset. Previous local results were cleared.', 'success');
		} catch (error) {
			displayToast(
				error instanceof ChallengeStateError ? error.message : 'The live sample could not be reset.',
				'error'
			);
		} finally {
			resettingSample = false;
		}
	}

	onMount(() => {
		if (__NEBIUS_EDITION__) return;
		return registerPageTools(document, [
			createWebMcpChallengeGuideTool(() => readRenderedWebMcpChallengeGuide(document))
		], {
		onInvocationError: async () => {
			webMcpGuideReceipt = null;
			await tick();
		},
		onResult: async ({ toolName, result }) => {
			if (toolName !== PROJECTS_HANDOFF_GUIDE_TOOL_NAME) return;
			const guide = result as {
				steps?: unknown[];
				agentBrief?: unknown;
				workQuery?: unknown;
				workScope?: {
					workspaceCount?: unknown;
					selected?: { label?: unknown; matchingCount?: unknown };
				};
			};
			webMcpInvocationCount += 1;
			webMcpGuideReceipt = {
				summary: 'WebMCP read the current Guide, brief, and visible Work scope.',
				cells: [
					{ label: 'Tool', value: toolName },
					{ label: 'Invocation', value: `#${webMcpInvocationCount}` },
					{ label: 'What it read', value: `${guide.steps?.length ?? 0} workflow steps and the visible authority boundary` },
					{ label: 'Editable brief', value: typeof guide.agentBrief === 'string' ? guide.agentBrief : 'Unavailable' },
					{ label: 'Work scope', value: typeof guide.workScope?.selected?.label === 'string' ? guide.workScope.selected.label : 'Unavailable' },
					{ label: 'Work query', value: typeof guide.workQuery === 'string' && guide.workQuery ? guide.workQuery : 'Any text' },
					{ label: 'Matches', value: typeof guide.workScope?.selected?.matchingCount === 'number' && typeof guide.workScope.workspaceCount === 'number' ? `${guide.workScope.selected.matchingCount} of ${guide.workScope.workspaceCount} workspace` : 'Unavailable' },
					{ label: 'Page-local presentation', value: 'Unchanged' },
					{ label: 'Saved workspace changes', value: 'None' }
				]
			};
			await tick();
		}
		});
	});
</script>

<svelte:head>
	<title>{__NEBIUS_EDITION__ ? 'Nebius guide' : 'Projects handoff guide'} — Wornpage Projects™</title>
	<meta
		name="description"
	content={__NEBIUS_EDITION__ ? 'Plan a project, choose the next step, review evidence and adapt your plan with NVIDIA models on Nebius.' : 'A practical Projects handoff workflow: WebMCP tools read visible work, can create bounded Drafts, and prepare an unsaved next action while people control Start and final Save.'}
	/>
</svelte:head>

<WornPage sectionLabel={__NEBIUS_EDITION__ ? 'Nebius edition · Getting started' : 'Projects workflow · guided handoff'} title={__NEBIUS_EDITION__ ? 'From a plan to your next step' : 'Projects handoff guide'}>
	{#if __NEBIUS_EDITION__}
		<div class="nebius-guide" data-nebius-guide>
			<p class="nebius-guide-intro">Turn a goal into tasks, work through them, and adapt when something changes. NVIDIA models on Nebius can help at each step; you review every proposed change.</p>
			<p>The <a href="https://projects-nebius.ayivx-do-lmf-982.workers.dev/">public v0.1.0 preview</a> supports manual project workflows. AI guidance and Sandbox execution are disabled in that preview. Follow local setup to run the Nebius integration with your own credentials.</p>
			<WornButton href="/work" variant="primary">Open Work</WornButton>
			<WornButton href="https://github.com/wornpage/projects-nebius#run-without-credentials">Source and local setup</WornButton>
			<WornButton href="https://devpost.com/software/wornpage-projects-nebius-edition">Recorded tool demonstration</WornButton>
			<ol class="nebius-guide-steps" aria-label="Project workflow">
				<li><h2>1. Make a plan</h2><p>In Work, choose New project. Try an example, write your own tasks, or ask Nebius to turn a brief into a plan. Review and approve it to save.</p></li>
				<li><h2>2. Take the next step</h2><p>Open a task’s Next step for guidance or Run this task to build a small browser tool. A run can build, check and repair once within the limits you approve.</p></li>
				<li><h2>3. Review the result</h2><p>Open a generated tool in Review to try it, inspect its checks and save evidence. Other tasks use Evidence and completion. Mark the task done when you decide it is complete.</p></li>
				<li><h2>4. Adapt the project</h2><p>Back in Work, update the project when priorities or dependencies change. Review the proposed changes together before saving.</p></li>
			</ol>
			<section class="nebius-guide-note" aria-labelledby="nebius-guide-title">
				<h2 id="nebius-guide-title">Using Nebius</h2>
				<p>Each request shows the text to send, the model and its response limit. Suggestions stay unsaved until you approve them. If Nebius is unavailable, you can still plan, edit tasks and save evidence manually.</p>
				<p>Your workspace stays in this browser. Authorized runs also keep their selected task and results on the server for seven days. Use a backup below to keep saved results and run access.</p>
			</section>
			<details class="nebius-origin"><summary>About this edition</summary><p>This edition adds project planning, task suggestions, evidence review, replanning and bounded browser-tool execution through Nebius Token Factory. It builds on the earlier WebMCP workspace. Browser-agent tools remain optional on the work pages.</p></details>
		</div>
	{/if}
	<div
		class="challenge-guide"
		data-webmcp-challenge-guide
		data-webmcp-challenge-title="Projects handoff guide"
		data-webmcp-challenge-purpose="People and browser agents share the same live project page while consequential decisions remain human-owned."
	>
		{#if !__NEBIUS_EDITION__}
		<div class="challenge-hero">
			<div class="challenge-guide-rail">
				<div class="challenge-intro">
					<p class="challenge-kicker">WebMCP project workspace · live sample · no login</p>
					<p class="challenge-purpose">Choose visible work and edit the brief; the browser agent can inspect, prepare, or add bounded Drafts while you control Start and final Save.</p>
					<div class="challenge-role-split" aria-label="Authority handoff">
						<WornBadge variant="accent" size="sm" label="Agent · inspect + prepare" />
						<span class="challenge-role-arrow" aria-hidden="true">→</span>
						<WornBadge size="sm" label="You · decide + save" />
					</div>
					<div class="challenge-sample-reset">
						<WornButton type="button" size="sm" disabled={resettingSample} onclick={() => (resetConfirmOpen = true)}>
							{resettingSample ? 'Resetting sample…' : 'Reset live sample'}
						</WornButton>
						<span>Explicitly restores this browser’s bundled sample and clears its prior local results.</span>
					</div>
				</div>
				<ol class="challenge-steps" aria-label="Three-step Projects handoff workflow">
					{#each steps as step, index (step.href)}
						<li data-webmcp-challenge-step>
							<span class="challenge-number" aria-hidden="true">{index + 1}</span>
							<div>
								<h2>{step.title}</h2>
								<p>{step.description}</p>
							</div>
							<WornButton href={step.href} size="sm">{step.action}</WornButton>
						</li>
					{/each}
				</ol>
			</div>
			<div class="challenge-agent-column">
				<AgentBriefEditor scopeCatalog={guideScopeCatalog} bind:selectedScopeId bind:workQuery {selectedMatchingCount} />
			</div>
		</div>

		{#if webMcpGuideReceipt}
			<div data-webmcp-receipt="guide" aria-label="Latest Guide WebMCP tool receipt">
				<WornReceipt
					summary={webMcpGuideReceipt.summary}
					cells={webMcpGuideReceipt.cells}
					ondone={() => (webMcpGuideReceipt = null)}
				/>
			</div>
		{/if}

		<WornAccordion label="Authority boundary">
			<section class="challenge-safety" data-webmcp-challenge-safety aria-labelledby="challenge-safety-title">
				<h2 id="challenge-safety-title">Who controls changes</h2>
				<ul>
					{#each safety as guarantee (guarantee)}
						<li>{guarantee}</li>
					{/each}
				</ul>
			</section>
		</WornAccordion>
		{/if}

		<WornAccordion label={__NEBIUS_EDITION__ ? 'Backup and restore' : 'Workspace portability'}>
			<section class="challenge-portability" aria-labelledby="workspace-portability-title">
				<h2 id="workspace-portability-title">{__NEBIUS_EDITION__ ? 'Backup and restore' : 'Workspace portability'}</h2>
				<p>{__NEBIUS_EDITION__ ? 'Download your projects and tasks as a backup. Review a backup before merging it or replacing this workspace.' : 'Export a validated local backup or preview an export before replacing or merging it.'}</p>
				{#if __NEBIUS_EDITION__ && $demoState?.packs.some((pack) => pack.executionRun)}<p>Keep this backup private: it includes saved tool results and access to their runs. Resetting or replacing this workspace removes that access here; it does not cancel a running job.</p>{/if}
				<div class="challenge-portability-actions">
					<WornButton class="challenge-export-primary" type="button" size="sm" onclick={prepareWorkspaceExport}>Prepare export</WornButton>
					{#if exportHref}<a class="challenge-export-link" href={exportHref} download="projects-workspace.json">Download export</a>{/if}
					<label class="challenge-import-label">Import export<input bind:this={importInput} type="file" accept="application/json" disabled={importBusy} onchange={selectWorkspaceFile} /></label>
				</div>
				{#if importError}<p class="challenge-import-error" role="alert">{importError}</p>{/if}
				{#if importPreview}
					<div class="challenge-import-preview" aria-live="polite"><strong>Preview:</strong> {importPreview.packs} work items · {importPreview.pendingApprovals} pending approvals · {importPreview.collisions} existing ID collisions{importPreview.collisionIds.length ? ` (${importPreview.collisionIds.join(', ')})` : ''}.</div>
					<div class="challenge-portability-actions"><WornButton size="sm" variant="primary" disabled={importBusy} onclick={() => requestWorkspaceImport('merge')}>Merge</WornButton><WornButton size="sm" variant="danger" disabled={importBusy} onclick={() => requestWorkspaceImport('replace')}>Replace</WornButton></div>
				{/if}
			</section>
		</WornAccordion>
		{#if __NEBIUS_EDITION__}
			<details class="nebius-origin"><summary>Reset sample workspace</summary><p>Reset removes this browser’s projects, tasks and pending drafts. Download a backup first if you want to keep them.</p><WornButton type="button" size="sm" disabled={resettingSample} onclick={() => (resetConfirmOpen = true)}>{resettingSample ? 'Resetting sample…' : 'Reset sample'}</WornButton></details>
		{/if}
	</div>
</WornPage>

<WornDialog bind:open={replaceConfirmOpen} title="Confirm workspace replacement" size="sm">
	<p class="challenge-replace-warning">Replace will discard the current browser-local workspace and restore the imported file. This cannot be undone unless you export a backup first.</p>
	<div class="challenge-portability-actions">
		<WornButton type="button" onclick={() => (replaceConfirmOpen = false)}>Cancel</WornButton>
		<WornButton type="button" variant="danger" disabled={importBusy} onclick={() => { replaceConfirmOpen = false; void applyWorkspaceImport('replace'); }}>Confirm Replace</WornButton>
	</div>
</WornDialog>

<WornDialog bind:open={resetConfirmOpen} title={__NEBIUS_EDITION__ ? 'Confirm sample reset' : 'Confirm live sample reset'} size="sm">
	<p class="challenge-replace-warning">{__NEBIUS_EDITION__ ? 'Reset will discard this browser’s projects, tasks and pending approvals, then restore the bundled sample. Export a backup first if you may need them again.' : 'Reset will discard this browser’s local workspace results and pending approvals, then restore the bundled sample. Export a backup first if you may need them again.'}</p>
	<div class="challenge-portability-actions">
		{#if exportHref}
			<a class="challenge-export-link" href={exportHref} download="projects-workspace.json">Download backup</a>
		{:else}
			<WornButton type="button" onclick={prepareWorkspaceExport}>Prepare export first</WornButton>
		{/if}
		<WornButton type="button" onclick={() => (resetConfirmOpen = false)}>Cancel</WornButton>
		<WornButton type="button" variant="danger" disabled={resettingSample} onclick={() => { resetConfirmOpen = false; void resetLiveSample(); }}>Confirm reset</WornButton>
	</div>
</WornDialog>

<style>
	.nebius-guide { display: grid; gap: 1.25rem; margin-block-end: 1.5rem; max-inline-size: 70rem; }
	.nebius-guide p, .nebius-origin p { margin: 0; line-height: 1.6; color: var(--worn-text-secondary); }
	.nebius-guide-intro { max-inline-size: 62ch; font-size: 1.1rem; }
	.nebius-guide :global(.worn-btn) { justify-self: start; }
	.nebius-guide-steps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; padding: 0; margin: 0; list-style: none; }
	.nebius-guide-steps li, .nebius-guide-note { display: grid; align-content: start; gap: .65rem; padding: 1rem; border: 1px solid var(--worn-border); border-radius: var(--worn-radius); }
	.nebius-guide h2 { margin: 0; font-size: 1.15rem; }
	.nebius-origin { display: grid; gap: .75rem; }
	.nebius-origin summary { cursor: pointer; padding-block: .75rem; font-weight: 650; }
	.nebius-origin p { margin-block: .5rem 1rem; max-inline-size: 72ch; }
	@media (max-width: 650px) { .nebius-guide-steps { grid-template-columns: minmax(0, 1fr); } }
	.challenge-guide {
		display: grid;
		gap: 24px;
		min-width: 0;
	}
	.challenge-hero {
		align-items: start;
		display: grid;
		gap: 20px;
		grid-template-columns: minmax(0, 0.82fr) minmax(360px, 1.18fr);
	}
	.challenge-guide-rail {
		display: grid;
		gap: 24px;
		min-width: 0;
	}
	.challenge-agent-column {
		display: grid;
		gap: 12px;
		min-width: 0;
	}
	.challenge-intro {
		align-content: start;
		display: grid;
		gap: 16px;
	}
	.challenge-kicker {
		color: var(--worn-text-secondary);
		font-family: var(--font-typewriter);
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.04em;
		margin: 0;
		text-transform: uppercase;
	}
	.challenge-purpose {
		color: var(--worn-text-secondary);
		font-size: 17px;
		line-height: 1.6;
		margin: 0;
	}
	.challenge-role-split {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.challenge-role-arrow {
		color: var(--worn-text-muted);
		font-family: var(--font-typewriter);
		font-size: 13px;
		font-weight: 700;
	}
	.challenge-sample-reset {
		align-items: center;
		color: var(--worn-text-muted);
		display: flex;
		flex-wrap: wrap;
		font-size: 12px;
		gap: 8px;
		line-height: 1.45;
	}
	.challenge-portability { background: var(--worn-surface); border: 1px solid var(--worn-border); border-radius: var(--worn-radius); display: grid; gap: 8px; padding: 14px; }
	.challenge-portability h2 { font-size: 16px; margin: 0; }
	.challenge-portability p { color: var(--worn-text-secondary); font-size: 13px; line-height: 1.45; margin: 0; }
	.challenge-portability-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
	:global(.challenge-export-primary.worn-btn), .challenge-import-label { inline-size: 124px; }
	.challenge-import-label { align-items: center; background: var(--worn-surface); block-size: 32px; border: 1px solid var(--worn-border); border-radius: var(--worn-radius); box-sizing: border-box; cursor: pointer; display: inline-flex; font-family: var(--font-typewriter); font-size: 12px; font-weight: 610; justify-content: center; line-height: 14.4px; padding: 4px 10px; }
	@media (pointer: coarse) { .challenge-import-label { block-size: 44px; } }
	.challenge-import-label:focus-within { outline: 2px dashed var(--worn-focus); outline-offset: 2px; }
	.challenge-import-label input { max-width: 1px; opacity: 0; position: absolute; }
	.challenge-import-preview { color: var(--worn-text-secondary); font-size: 13px; }
	.challenge-import-error { color: var(--worn-danger-text) !important; }
	.challenge-replace-warning { color: var(--worn-text-secondary); line-height: 1.5; margin: 0 0 12px; }
	.challenge-safety h2 {
		font-size: 14px;
		margin: 0 0 8px;
	}
	.challenge-steps {
		display: grid;
		gap: 10px;
		grid-template-columns: minmax(0, 1fr);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.challenge-steps li {
		align-content: start;
		background: var(--worn-surface);
		border: 1px solid var(--worn-border);
		border-radius: var(--worn-radius);
		display: grid;
		gap: 12px;
		grid-template-rows: auto minmax(0, 1fr) auto;
		padding: 16px;
	}
	.challenge-number {
		align-items: center;
		background: var(--worn-accent);
		border: 1px solid var(--worn-accent);
		border-radius: 50%;
		color: var(--worn-accent-text);
		display: flex;
		font-family: var(--font-typewriter);
		font-size: 12px;
		font-weight: 700;
		height: 28px;
		justify-content: center;
		width: 28px;
	}
	.challenge-steps h2 {
		font-size: 17px;
		margin: 0;
	}
	.challenge-steps p {
		color: var(--worn-text-secondary);
		font-size: 15px;
		line-height: 1.55;
		margin: 3px 0 0;
	}
	.challenge-steps :global(.worn-btn) {
		justify-self: start;
	}
	.challenge-safety ul {
		color: var(--worn-text-secondary);
		font-size: 15px;
		line-height: 1.6;
		margin: 0;
		padding-left: 20px;
	}
	@media (max-width: 860px) {
		.challenge-hero {
			grid-template-columns: minmax(0, 1fr);
		}
		.challenge-steps {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
