<script lang="ts">
	import { onMount } from 'svelte';
	import { WornButton } from '$lib/components';

	let { text, label, currentCriteria = false }: { text: string; label: string; currentCriteria?: boolean } = $props();
	const uid = $props.id();
	const textId = `${uid}-text`;
	const toggleId = `${uid}-toggle`;
	let content: HTMLParagraphElement;
	let expanded = $state(false);
	let overflowing = $state(false);
	let measured = $state(false);
	let mounted = false;
	let frame: number | null = null;

	function measure() {
		if (!mounted || !content) return;
		const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
		// scrollHeight retains all text, including the visually clamped lines.
		const exceedsThreeLines = content.scrollHeight > lineHeight * 3 + 1;
		if (!exceedsThreeLines && !expanded && document.activeElement?.id === toggleId) {
			content.focus({ preventScroll: true });
		}
		overflowing = exceedsThreeLines;
		measured = true;
	}

	function scheduleMeasure() {
		if (!mounted || frame !== null) return;
		frame = requestAnimationFrame(() => { frame = null; measure(); });
	}

	$effect(() => {
		void text;
		expanded = false;
		scheduleMeasure();
	});

	function toggle() {
		if (expanded && !overflowing) content.focus({ preventScroll: true });
		expanded = !expanded;
		scheduleMeasure();
	}

	onMount(() => {
		mounted = true;
		const observer = new ResizeObserver(scheduleMeasure);
		observer.observe(content);
		window.addEventListener('resize', scheduleMeasure);
		document.fonts.addEventListener('loadingdone', scheduleMeasure);
		void document.fonts.ready.then(() => { if (mounted) scheduleMeasure(); });
		measure();
		return () => {
			mounted = false;
			observer.disconnect();
			window.removeEventListener('resize', scheduleMeasure);
			document.fonts.removeEventListener('loadingdone', scheduleMeasure);
			if (frame !== null) cancelAnimationFrame(frame);
		};
	});
</script>

<div class="brief-preview" data-nebius-brief-preview={label}>
	<p bind:this={content} id={textId} class:clamped={measured && !expanded} tabindex="-1" data-brief-preview-text data-current-full-criteria={currentCriteria || undefined}>{text}</p>
	{#if overflowing || expanded}
		<div class="preview-controls">
			<WornButton id={toggleId} type="button" size="sm" aria-expanded={expanded} aria-controls={textId}
				aria-label={`${expanded ? 'Show less' : 'Show more'} ${label.toLowerCase()}`}
				data-brief-preview-toggle onclick={toggle}>{expanded ? 'Show less' : 'Show more'}</WornButton>
		</div>
	{/if}
</div>

<style>
	.brief-preview { min-inline-size: 0; }
	p { margin: 0; font: inherit; line-height: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
	p.clamped { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
	p:focus-visible { outline: 2px solid var(--worn-focus); outline-offset: 3px; }
	.preview-controls { margin-block-start: 4px; }
	.preview-controls :global(.worn-btn) { min-block-size: 44px; font-family: inherit; font-size: .875rem; }
</style>
