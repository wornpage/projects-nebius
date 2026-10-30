<script lang="ts">
	import { onMount } from 'svelte';
	import { splitThemeChoice, replaceThemePart, appearancePosition } from '$lib/nebius-theme-choice.mjs';

	type ThemeApi = {
		getChoice(): string;
		setChoice(choice: string): { choice: string; persisted: boolean };
	};
	const saveFailure = 'Theme changed for this tab; your browser could not save it.';
	const unavailable = 'Theme controls are unavailable. Reload this page to try again.';
	let choice = $state('neutral-system');
	let ready = $state(false);
	let message = $state('');
	let opened = $state(false);
	let trigger: HTMLButtonElement;
	let panel: HTMLDivElement;
	const parts = $derived(splitThemeChoice(choice));

	function themeApi(): ThemeApi | undefined {
		return (window as Window & { WornpageTheme?: ThemeApi }).WornpageTheme;
	}

	function syncChoice() {
		try {
			const api = themeApi();
			if (!api) throw new Error('Unavailable');
			choice = api.getChoice();
			ready = true;
		} catch {
			ready = false;
			message = unavailable;
		}
	}

	function position() {
		if (!panel || !trigger) return;
		const point = appearancePosition(trigger.getBoundingClientRect(), panel.getBoundingClientRect(), window.innerWidth, window.innerHeight);
		panel.style.left = `${point.left}px`;
		panel.style.top = `${point.top}px`;
	}

	onMount(() => {
		syncChoice();
		const yieldToModal = (event: FocusEvent) => {
			const target = event.target;
			if (panel?.matches(':popover-open') && target instanceof Element &&
				target.closest('[role="dialog"][aria-modal="true"], dialog:modal') && !panel.contains(target)) {
				// Existing app dialogs use their own modal layer. Let their requested
				// focus win instead of leaving this native top-layer panel above them.
				panel.hidePopover();
			}
		};
		const sync = (event: Event) => {
			syncChoice();
			const persisted = (event as CustomEvent<{ persisted: boolean | null }>).detail?.persisted;
			if (ready && typeof persisted === 'boolean') message = persisted ? '' : saveFailure;
			requestAnimationFrame(position);
		};
		window.addEventListener('wornpage:themechange', sync);
		window.addEventListener('resize', position);
		window.addEventListener('scroll', position, true);
		document.addEventListener('focusin', yieldToModal);
		return () => {
			window.removeEventListener('wornpage:themechange', sync);
			window.removeEventListener('resize', position);
			window.removeEventListener('scroll', position, true);
			document.removeEventListener('focusin', yieldToModal);
		};
	});

	function beforeToggle(event: Event) {
		if ((event as ToggleEvent).newState === 'open') {
			syncChoice();
			requestAnimationFrame(position);
		}
	}

	function close() {
		panel.hidePopover();
		trigger.focus();
	}

	function restoreRadioSelection() {
		// Native radios update before change fires. Undo that visual change if the API rejects it.
		for (const input of panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
			input.checked = input.value === (input.name === 'appearance-palette' ? parts.palette : parts.mode);
		}
	}

	function changeTheme(part: 'palette' | 'mode', value: string) {
		const api = themeApi();
		if (!api) {
			ready = false;
			message = unavailable;
			restoreRadioSelection();
			requestAnimationFrame(position);
			return;
		}
		try {
			// Read the authority again so a cross-tab update cannot be overwritten by stale state.
			const result = api.setChoice(replaceThemePart(api.getChoice(), part, value));
			choice = result.choice;
			message = result.persisted ? '' : saveFailure;
		} catch {
			syncChoice();
			if (ready) message = 'The theme could not be changed. Reload this page to try again.';
			restoreRadioSelection();
		} finally {
			requestAnimationFrame(position);
		}
	}
</script>

<div class="theme-picker" data-theme-picker>
	<button bind:this={trigger} class="appearance-trigger" data-appearance-trigger popovertarget="appearance-options" aria-expanded={opened}>Appearance</button>
	<div bind:this={panel} id="appearance-options" class="appearance-panel" data-appearance-popover popover="auto" onbeforetoggle={beforeToggle} ontoggle={(event) => opened = event.newState === 'open'} aria-labelledby="appearance-title">
		<div class="appearance-heading"><h2 id="appearance-title">Appearance</h2><button type="button" data-appearance-close onclick={close} aria-label="Close appearance">Close</button></div>
		<fieldset disabled={!ready}>
			<legend>Palette</legend>
			{#each ['neutral', 'original'] as palette}
				<label><input type="radio" name="appearance-palette" value={palette} checked={parts.palette === palette} onchange={() => changeTheme('palette', palette)} /><span>{palette === 'neutral' ? 'Neutral' : 'Original'}</span><span class="selection-cue" aria-hidden="true">{parts.palette === palette ? '✓' : ''}</span></label>
			{/each}
		</fieldset>
		<fieldset disabled={!ready}>
			<legend>Mode</legend>
			{#each ['system', 'light', 'dark'] as mode}
				<label><input type="radio" name="appearance-mode" value={mode} checked={parts.mode === mode} onchange={() => changeTheme('mode', mode)} /><span>{mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}</span><span class="selection-cue" aria-hidden="true">{parts.mode === mode ? '✓' : ''}</span></label>
			{/each}
		</fieldset>
		<p class="preference-note">System follows your device’s light or dark setting.</p>
		{#if message}<p role="status">{message}</p>{/if}
	</div>
</div>

<style>
	.theme-picker { flex: 0 0 auto; min-inline-size: 0; }
	button { min-block-size: 44px; border: 1px solid var(--worn-field-border); border-radius: var(--worn-radius); padding: .5rem .75rem; background: var(--worn-surface); color: var(--worn-text); font: inherit; cursor: pointer; }
	.appearance-trigger { font-size: .875rem; }
	button:focus-visible, input:focus-visible { outline: 2px solid var(--worn-text); outline-offset: 3px; }
	.appearance-panel { position: fixed; inset: auto; margin: 0; box-sizing: border-box; inline-size: min(20rem, calc(100vw - 2rem)); max-block-size: calc(100dvh - 2rem); overflow-y: auto; border: 1px solid var(--worn-field-border); border-radius: var(--worn-radius); padding: 1rem; color: var(--worn-text); background: var(--worn-surface); box-shadow: 0 .5rem 2rem #0003; }
	.appearance-heading { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
	h2 { margin: 0; font-size: 1rem; }
	fieldset { margin: .75rem 0 0; padding: .25rem 0 0; border: 0; min-inline-size: 0; }
	legend { padding: 0; font-size: .875rem; font-weight: 650; }
	label { display: flex; align-items: center; gap: .625rem; min-block-size: 44px; padding-inline: .5rem; border-radius: var(--worn-radius); font-size: .875rem; cursor: pointer; }
	label:has(input:checked) { outline: 1px solid var(--worn-field-border); outline-offset: -1px; font-weight: 650; }
	input { margin: 0; accent-color: var(--worn-text); inline-size: 1.125rem; block-size: 1.125rem; flex-shrink: 0; }
	.selection-cue { margin-inline-start: auto; min-inline-size: 1em; }
	p { margin: .75rem 0 0; font-size: .8125rem; line-height: 1.4; color: var(--worn-text); overflow-wrap: anywhere; }
	.preference-note { opacity: .85; }
</style>
