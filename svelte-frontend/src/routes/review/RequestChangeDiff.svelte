<script lang="ts">
	import { requestTextDiff } from '$lib/nebius-request-diff.mjs';
	type Props = { label: string; saved: string; current: string };
	let { label, saved, current }: Props = $props();
	let diff = $derived(requestTextDiff(saved, current));
	const valueState = (value: string) => value === '' ? 'Empty text' : /^\s+$/u.test(value) ? 'Whitespace-only text' : '';
</script>

<div class="request-text-diff" data-request-inline-diff aria-label={`${label} changes`}>
	{#if diff.whitespaceOnly}<p class="diff-note">Whitespace-only change. Spacing and line breaks are preserved below.</p>{/if}
	{#if saved === '' || current === ''}
		<p class="diff-note">{saved === '' ? 'Saved request: empty text.' : 'Current task: empty text.'}</p>
	{/if}
	{#if diff.status === 'cutoff'}
		<p class="diff-note" data-diff-fallback>Showing the complete saved and current text for this change.</p>
	{:else}
		<div class="diff-flow">{#each diff.segments as segment}{#if segment.kind === 'omission'}<span class="diff-omission" data-diff-kind="omission" data-omitted-count={segment.count}>[… unchanged text omitted …]</span>{:else if segment.kind === 'added'}<ins data-diff-kind="added" aria-label="Added to current task"><span class="diff-cue">[+ Added] </span>{segment.text}{#if /^\s+$/u.test(segment.text)}<span class="diff-cue"> [whitespace]</span>{/if}</ins>{:else if segment.kind === 'removed'}<del data-diff-kind="removed" aria-label="Removed from saved request"><span class="diff-cue">[− Removed] </span>{segment.text}{#if /^\s+$/u.test(segment.text)}<span class="diff-cue"> [whitespace]</span>{/if}</del>{:else}<span data-diff-kind="unchanged">{segment.text}</span>{/if}{/each}</div>
	{/if}
	<details class="diff-originals" data-diff-originals open={diff.status === 'cutoff'}>
		<summary>Full saved and current text · {label}</summary>
		<dl>
			<div><dt>Saved request{#if valueState(saved)} · {valueState(saved)}{/if}</dt><dd data-diff-saved>{saved}</dd></div>
			<div><dt>Current task{#if valueState(current)} · {valueState(current)}{/if}</dt><dd data-diff-current>{current}</dd></div>
		</dl>
	</details>
</div>

<style>
	.request-text-diff { min-inline-size: 0; font-size: .875rem; line-height: 1.6; }
	.diff-note { color: var(--worn-text-muted); margin-block: .5rem; }
	.diff-flow { white-space: pre-wrap; overflow-wrap: anywhere; margin-block: .5rem .75rem; }
	ins, del { color: var(--worn-text); border-radius: .2rem; padding-block: .1rem; }
	ins { background: color-mix(in srgb, var(--worn-accent) 14%, transparent); text-decoration-style: double; }
	del { background: color-mix(in srgb, var(--worn-text-muted) 12%, transparent); text-decoration-thickness: 1px; }
	.diff-cue { display: inline-block; margin-inline: .2em; font-size: .75rem; font-weight: 650; text-decoration: none; }
	.diff-omission { color: var(--worn-text-muted); font-size: .8rem; font-style: italic; }
	.diff-originals { margin-block-start: .5rem; }
	.diff-originals summary { min-block-size: 44px; align-content: center; cursor: pointer; font-size: .8rem; }
	.diff-originals summary:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	dl { display: grid; gap: .75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-block: .5rem; }
	dl > div { min-inline-size: 0; border-inline-start: 1px solid var(--worn-field-border); padding-inline-start: .75rem; }
	dt { font-size: .8rem; font-weight: 650; margin-block-end: .35rem; }
	dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; min-block-size: 1.5em; }
	@media (max-width: 600px) { dl { grid-template-columns: minmax(0, 1fr); } }
</style>
